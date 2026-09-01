const WORKER_VERSION = '2026-09-01-nearby-pwa-v3';
const SNAPSHOT_PREFIX = 'family-arcade-snapshot-';
const META_CACHE = 'family-arcade-snapshot-meta';
const ACTIVE_KEY = new URL('__arcade_active_snapshot__', self.registration.scope).href;
const PREVIOUS_KEY = new URL('__arcade_previous_snapshot__', self.registration.scope).href;
const NETWORK_MODES_KEY = new URL('__arcade_client_network_modes__', self.registration.scope).href;
const MANIFEST_URL = new URL('offline-manifest.json', self.registration.scope).href;
const SCOPE_PATH = new URL(self.registration.scope).pathname;
const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const MAX_ARCHIVE_BYTES = 250 * 1024 * 1024;
const MAX_FILES = 10000;
const NETWORK_MODES = new Set(['online', 'nearby', 'offline']);
const clientNetworkModes = new Map();
let networkModePruneTask = null;
let networkModesLoaded = false;
let networkModesLoadTask = null;
let networkModesPersistTask = Promise.resolve();
let refreshTask = null;
let refreshAbortController = null;
let refreshOwnerClientId = '';
let deferredRefreshOwnerClientId = '';
let validatedSnapshotKey = null;
let validationTask = null;
let latestProgress = null;

function timeoutFetch(input, options = {}, timeoutMs = 6500) {
  const controller = new AbortController();
  const upstreamSignal = options.signal;
  const abortFromUpstream = () => controller.abort();
  if (upstreamSignal) {
    if (upstreamSignal.aborted) controller.abort();
    else upstreamSignal.addEventListener('abort', abortFromUpstream, { once: true });
  }
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(input, { ...options, signal: controller.signal }).finally(() => {
    clearTimeout(timer);
    if (upstreamSignal) upstreamSignal.removeEventListener('abort', abortFromUpstream);
  });
}

function safePath(path) {
  return typeof path === 'string' &&
    /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(path) &&
    !path.includes('//') &&
    !path.split('/').some(part => part === '.' || part === '..') &&
    path !== 'offline-manifest.json';
}

function hex(bytes) {
  return [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2, '0')).join('');
}

async function sha256(bytes) {
  return hex(await crypto.subtle.digest('SHA-256', bytes));
}

function validateManifest(value) {
  if (!value || value.schema !== 1 || typeof value.version !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9._+-]{0,99}$/.test(value.version) ||
      !Array.isArray(value.files) || value.files.length < 1 || value.files.length > MAX_FILES ||
      value.fileCount !== value.files.length || !Number.isSafeInteger(value.totalBytes) ||
      value.totalBytes < 1 || value.totalBytes > MAX_ARCHIVE_BYTES) {
    throw new Error('Invalid offline manifest header');
  }
  const seen = new Set();
  let totalBytes = 0;
  for (const file of value.files) {
    if (!file || !safePath(file.path) || seen.has(file.path) ||
        !Number.isSafeInteger(file.bytes) || file.bytes < 0 || file.bytes > MAX_FILE_BYTES ||
        typeof file.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(file.sha256)) {
      throw new Error('Invalid offline manifest entry');
    }
    seen.add(file.path);
    totalBytes += file.bytes;
    if (!Number.isSafeInteger(totalBytes) || totalBytes > MAX_ARCHIVE_BYTES) throw new Error('Offline archive is too large');
  }
  if (totalBytes !== value.totalBytes || !seen.has('index.html') || !seen.has('catalog.json') || !seen.has('sw.js')) {
    throw new Error('Incomplete offline manifest');
  }
  return value;
}

async function fetchManifest(signal) {
  const response = await timeoutFetch(MANIFEST_URL, { cache: 'no-store', redirect: 'error', signal }, 6500);
  if (!response.ok || response.redirected) throw new Error(`Manifest HTTP ${response.status}`);
  const bytes = await response.arrayBuffer();
  if (!bytes.byteLength || bytes.byteLength > MAX_MANIFEST_BYTES) throw new Error('Manifest size is invalid');
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const manifest = validateManifest(JSON.parse(text));
  return { manifest, bytes, digest: await sha256(bytes) };
}

async function readMarker(key) {
  const response = await (await caches.open(META_CACHE)).match(key);
  if (!response) return null;
  try {
    const marker = await response.json();
    if (!marker || typeof marker.cache !== 'string' || !marker.cache.startsWith(SNAPSHOT_PREFIX) ||
        typeof marker.version !== 'string' || !/^[a-f0-9]{64}$/.test(marker.manifestSha256 || '')) return null;
    if (!(await caches.has(marker.cache))) return null;
    return marker;
  } catch (_) {
    return null;
  }
}

async function writeMarker(key, marker) {
  const meta = await caches.open(META_CACHE);
  if (!marker) {
    await meta.delete(key);
    return;
  }
  await meta.put(key, new Response(JSON.stringify(marker), { headers: { 'content-type': 'application/json' } }));
}

function activeMarker() {
  return readMarker(ACTIVE_KEY);
}

function previousMarker() {
  return readMarker(PREVIOUS_KEY);
}

function markerKey(marker) {
  return marker ? `${marker.cache}:${marker.manifestSha256}` : '';
}

async function manifestFromSnapshot(marker) {
  if (!marker || !(await caches.has(marker.cache))) return null;
  const stored = await (await caches.open(marker.cache)).match(MANIFEST_URL);
  if (!stored) return null;
  try {
    const bytes = await stored.arrayBuffer();
    if (!bytes.byteLength || bytes.byteLength > MAX_MANIFEST_BYTES || await sha256(bytes) !== marker.manifestSha256) return null;
    return validateManifest(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
  } catch (_) {
    return null;
  }
}

async function validateSnapshot(marker, expectedManifest = null, expectedDigest = null) {
  if (!marker || !(await caches.has(marker.cache))) return null;
  const cache = await caches.open(marker.cache);
  const storedManifest = await cache.match(MANIFEST_URL);
  if (!storedManifest) return null;
  try {
    const manifestBytes = await storedManifest.arrayBuffer();
    if (!manifestBytes.byteLength || manifestBytes.byteLength > MAX_MANIFEST_BYTES) return null;
    const digest = await sha256(manifestBytes);
    if (digest !== marker.manifestSha256 || (expectedDigest && digest !== expectedDigest)) return null;
    const manifest = validateManifest(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(manifestBytes)));
    if (manifest.version !== marker.version || (expectedManifest && manifest.version !== expectedManifest.version)) return null;
    if (expectedManifest && JSON.stringify(manifest.files) !== JSON.stringify(expectedManifest.files)) return null;
    for (let start = 0; start < manifest.files.length; start += 4) {
      const batch = manifest.files.slice(start, start + 4);
      const valid = await Promise.all(batch.map(file => reusableResponse(cache, file)));
      if (valid.some(response => !response)) return null;
    }
    validatedSnapshotKey = markerKey(marker);
    return marker;
  } catch (_) {
    return null;
  }
}

async function recoverSnapshot() {
  const names = (await caches.keys())
    .filter(name => name.startsWith(SNAPSHOT_PREFIX))
    .sort((left, right) => {
      const leftTime = Number((left.match(/-(\d{10,})-[^-]+$/) || [])[1] || 0);
      const rightTime = Number((right.match(/-(\d{10,})-[^-]+$/) || [])[1] || 0);
      return rightTime - leftTime || right.localeCompare(left);
    });
  let recovered = null;
  for (const cacheName of names) {
    const cache = await caches.open(cacheName);
    const storedManifest = await cache.match(MANIFEST_URL);
    if (!storedManifest) continue;
    try {
      const bytes = await storedManifest.clone().arrayBuffer();
      if (!bytes.byteLength || bytes.byteLength > MAX_MANIFEST_BYTES) continue;
      const manifest = validateManifest(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
      const marker = { cache: cacheName, version: manifest.version, manifestSha256: await sha256(bytes), worker: WORKER_VERSION };
      if (!await validateSnapshot(marker, manifest, marker.manifestSha256)) continue;
      if (!recovered) {
        recovered = marker;
        await writeMarker(ACTIVE_KEY, marker);
      } else {
        await writeMarker(PREVIOUS_KEY, marker);
        return recovered;
      }
    } catch (_) {}
  }
  if (recovered) {
    await writeMarker(PREVIOUS_KEY, null);
    return recovered;
  }
  validatedSnapshotKey = null;
  return null;
}

async function verifiedActiveMarker() {
  const marker = await activeMarker();
  if (marker && validatedSnapshotKey === markerKey(marker)) return marker;
  if (validationTask) return validationTask;
  validationTask = (async () => await validateSnapshot(marker) || await recoverSnapshot())()
    .finally(() => { validationTask = null; });
  return validationTask;
}

async function verifiedResponse(file, signal) {
  const url = new URL(file.path, self.registration.scope).href;
  const response = await timeoutFetch(url, { cache: 'no-store', redirect: 'error', signal }, 12000);
  if (!response.ok || response.redirected) throw new Error(`${file.path}: HTTP ${response.status}`);
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength !== file.bytes || await sha256(bytes) !== file.sha256) throw new Error(`${file.path}: integrity check failed`);
  const headers = new Headers(response.headers);
  headers.delete('content-encoding');
  headers.delete('content-length');
  headers.set('x-arcade-sha256', file.sha256);
  return new Response(bytes, { status: 200, headers });
}

async function reusableResponse(cache, file) {
  if (!cache) return null;
  const response = await cache.match(new URL(file.path, self.registration.scope).href);
  if (!response || response.headers.get('x-arcade-sha256') !== file.sha256) return null;
  const bytes = await response.clone().arrayBuffer();
  if (bytes.byteLength !== file.bytes || await sha256(bytes) !== file.sha256) return null;
  return response;
}

async function broadcast(message) {
  let clients;
  try {
    clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  } catch (_) {
    return;
  }
  for (const client of clients) {
    try { client.postMessage(message); } catch (_) {}
  }
}

async function publishProgress(progress) {
  latestProgress = { type: 'ARCADE_OFFLINE_PROGRESS', workerVersion: WORKER_VERSION, ...progress };
  await broadcast(latestProgress);
}

async function cleanupSnapshots(active, previous) {
  const keep = new Set([active && active.cache, previous && previous.cache].filter(Boolean));
  const names = await caches.keys();
  await Promise.all(names.map(name => name.startsWith(SNAPSHOT_PREFIX) && !keep.has(name) ? caches.delete(name) : null));
}

function retainSnapshotError(error, cacheName) {
  const retained = new Error(String(error && error.message || error || 'Offline snapshot activation failed'));
  retained.name = error && typeof error.name === 'string' ? error.name : 'SnapshotActivationError';
  retained.arcadeRetainSnapshot = cacheName;
  return retained;
}

async function discardFailedSnapshot(cacheName, error) {
  // Once ACTIVE may reference the candidate, keeping an extra validated cache
  // is always safer than deleting the only cache named by the active marker.
  if (error && error.arcadeRetainSnapshot === cacheName) return false;
  return caches.delete(cacheName);
}

async function commitSnapshot(marker, previous, signal) {
  let activeMayReferenceCandidate = false;
  await writeMarker(PREVIOUS_KEY, previous);
  if ((signal && signal.aborted) || await anyLiveStrictNetworkMode()) {
    throw new Error('Offline snapshot activation paused for Nearby Arcade');
  }
  try {
    // CacheStorage.put() has no transaction spanning this marker and the
    // candidate cache. From this point until a confirmed rollback, treat the
    // candidate as potentially active even when a metadata operation throws.
    activeMayReferenceCandidate = true;
    await writeMarker(ACTIVE_KEY, marker);
    if ((signal && signal.aborted) || await anyLiveStrictNetworkMode()) {
      await writeMarker(ACTIVE_KEY, previous);
      activeMayReferenceCandidate = false;
      validatedSnapshotKey = markerKey(previous);
      throw new Error('Offline snapshot activation paused for Nearby Arcade');
    }
    validatedSnapshotKey = markerKey(marker);
  } catch (error) {
    if (activeMayReferenceCandidate) throw retainSnapshotError(error, marker.cache);
    throw error;
  }
  // Cleanup is intentionally post-commit and best effort. A storage error while
  // deleting an obsolete cache must never invalidate the newly active snapshot.
  try { await cleanupSnapshots(marker, previous); } catch (_) {}
}

async function buildSnapshot(signal, ownerClientId) {
  const oldMarker = await verifiedActiveMarker();
  await publishProgress({ phase: 'checking', ready: !!oldMarker });
  if (signal && signal.aborted) throw new DOMException('Offline preparation canceled', 'AbortError');
  if (await anyLiveStrictNetworkMode()) {
    deferredRefreshOwnerClientId = validClientId(ownerClientId) ? ownerClientId : deferredRefreshOwnerClientId;
    const error = new Error('Offline preparation is paused while Nearby Arcade is active');
    await publishProgress({ phase: 'error', ready: !!oldMarker, version: oldMarker ? oldMarker.version : null, error: error.message });
    throw error;
  }
  let remote;
  try {
    remote = await fetchManifest(signal);
  } catch (error) {
    await publishProgress({
      phase: 'error', ready: !!oldMarker, version: oldMarker ? oldMarker.version : null,
      error: String(error && error.message || 'Offline preparation failed').slice(0, 240)
    });
    throw error;
  }
  if (oldMarker && oldMarker.version === remote.manifest.version && oldMarker.manifestSha256 === remote.digest &&
      await validateSnapshot(oldMarker, remote.manifest, remote.digest)) {
    await publishProgress({
      phase: 'ready', ready: true, version: remote.manifest.version,
      completedFiles: remote.manifest.fileCount, totalFiles: remote.manifest.fileCount,
      completedBytes: remote.manifest.totalBytes, totalBytes: remote.manifest.totalBytes
    });
    return oldMarker;
  }

  const suffix = `${remote.manifest.version.replace(/[^A-Za-z0-9._-]/g, '_')}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const cacheName = `${SNAPSHOT_PREFIX}${suffix}`;
  const snapshot = await caches.open(cacheName);
  const oldSnapshot = oldMarker ? await caches.open(oldMarker.cache) : null;
  let completedFiles = 0;
  let completedBytes = 0;
  await publishProgress({
    phase: 'downloading', ready: !!oldMarker, version: remote.manifest.version,
    completedFiles, totalFiles: remote.manifest.fileCount,
    completedBytes, totalBytes: remote.manifest.totalBytes
  });
  try {
    for (let start = 0; start < remote.manifest.files.length; start += 4) {
      const batch = remote.manifest.files.slice(start, start + 4);
      await Promise.all(batch.map(async file => {
        const response = await reusableResponse(oldSnapshot, file) || await verifiedResponse(file, signal);
        await snapshot.put(new URL(file.path, self.registration.scope).href, response);
      }));
      completedFiles += batch.length;
      completedBytes += batch.reduce((sum, file) => sum + file.bytes, 0);
      await publishProgress({
        phase: 'downloading', ready: !!oldMarker, version: remote.manifest.version,
        completedFiles, totalFiles: remote.manifest.fileCount,
        completedBytes, totalBytes: remote.manifest.totalBytes
      });
    }
    const manifestHeaders = new Headers({ 'content-type': 'application/json; charset=utf-8', 'x-arcade-manifest-sha256': remote.digest });
    await snapshot.put(MANIFEST_URL, new Response(remote.bytes, { status: 200, headers: manifestHeaders }));
    const marker = { cache: cacheName, version: remote.manifest.version, manifestSha256: remote.digest, worker: WORKER_VERSION };
    await publishProgress({
      phase: 'validating', ready: !!oldMarker, version: remote.manifest.version,
      completedFiles, totalFiles: remote.manifest.fileCount,
      completedBytes, totalBytes: remote.manifest.totalBytes
    });
    if (!await validateSnapshot(marker, remote.manifest, remote.digest)) throw new Error('Snapshot validation failed');

    await commitSnapshot(marker, oldMarker, signal);
    await publishProgress({
      phase: 'ready', ready: true, version: remote.manifest.version,
      completedFiles, totalFiles: remote.manifest.fileCount,
      completedBytes, totalBytes: remote.manifest.totalBytes
    });
    return marker;
  } catch (error) {
    await discardFailedSnapshot(cacheName, error);
    const fallback = await verifiedActiveMarker();
    await publishProgress({
      phase: 'error', ready: !!fallback, version: fallback ? fallback.version : null,
      error: String(error && error.message || 'Offline preparation failed').slice(0, 240)
    });
    throw error;
  }
}

function refreshSnapshot(ownerClientId) {
  if (refreshTask) return refreshTask;
  refreshAbortController = new AbortController();
  refreshOwnerClientId = validClientId(ownerClientId) ? ownerClientId : '';
  refreshTask = buildSnapshot(refreshAbortController.signal, refreshOwnerClientId).finally(() => {
    refreshTask = null;
    refreshAbortController = null;
    refreshOwnerClientId = '';
    // The last Nearby client can leave while an aborted download is still
    // unwinding. Re-check after the task has actually released its slot so a
    // deferred update cannot get stranded until another manual refresh.
    resumeDeferredRefreshIfPossible().catch(() => null);
  });
  return refreshTask;
}

async function resumeDeferredRefreshIfPossible() {
  if (!deferredRefreshOwnerClientId || refreshTask || await anyLiveStrictNetworkMode()) return false;
  const owner = deferredRefreshOwnerClientId;
  deferredRefreshOwnerClientId = '';
  refreshSnapshot(owner).catch(() => null);
  return true;
}

async function snapshotStatus() {
  const marker = await verifiedActiveMarker();
  const manifest = marker ? await manifestFromSnapshot(marker) : null;
  return {
    type: 'ARCADE_OFFLINE_STATUS',
    workerVersion: WORKER_VERSION,
    ready: !!(marker && manifest),
    version: manifest ? manifest.version : null,
    fileCount: manifest ? manifest.fileCount : 0,
    totalBytes: manifest ? manifest.totalBytes : 0,
    updating: !!refreshTask,
    progress: latestProgress
  };
}

function reply(event, message) {
  const payload = event.data && typeof event.data.requestId === 'string'
    ? { ...message, requestId: event.data.requestId.slice(0, 100) }
    : message;
  try {
    if (event.ports && event.ports[0]) event.ports[0].postMessage(payload);
    else if (event.source && typeof event.source.postMessage === 'function') event.source.postMessage(payload);
  } catch (_) {}
}

function validClientId(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\u0000-\u001f\u007f]/.test(value);
}

async function loadClientNetworkModes() {
  if (networkModesLoaded) return;
  if (networkModesLoadTask) return networkModesLoadTask;
  networkModesLoadTask = (async () => {
    try {
      const response = await (await caches.open(META_CACHE)).match(NETWORK_MODES_KEY);
      const stored = response ? await response.json() : null;
      if (stored && stored.version === 1 && stored.modes && typeof stored.modes === 'object' && !Array.isArray(stored.modes)) {
        for (const [id, mode] of Object.entries(stored.modes)) {
          if (validClientId(id) && (mode === 'nearby' || mode === 'offline') && !clientNetworkModes.has(id)) {
            clientNetworkModes.set(id, mode);
          }
        }
      }
    } catch (_) {}
    networkModesLoaded = true;
  })().finally(() => { networkModesLoadTask = null; });
  return networkModesLoadTask;
}

function persistClientNetworkModes() {
  networkModesPersistTask = networkModesPersistTask.catch(() => null).then(async () => {
    await loadClientNetworkModes();
    const modes = Object.fromEntries(clientNetworkModes);
    const meta = await caches.open(META_CACHE);
    if (!Object.keys(modes).length) {
      await meta.delete(NETWORK_MODES_KEY);
      return;
    }
    await meta.put(NETWORK_MODES_KEY, new Response(JSON.stringify({ version: 1, modes }), {
      headers: { 'content-type': 'application/json' }
    }));
  });
  return networkModesPersistTask;
}

async function setClientNetworkMode(id, mode) {
  if (!validClientId(id) || !NETWORK_MODES.has(mode)) return Promise.resolve(false);
  await loadClientNetworkModes();
  if (mode === 'online') clientNetworkModes.delete(id);
  else clientNetworkModes.set(id, mode);
  await persistClientNetworkModes();
  return true;
}

async function pruneClientNetworkModes() {
  if (networkModePruneTask) return networkModePruneTask;
  networkModePruneTask = (async () => {
    await loadClientNetworkModes();
    try {
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const live = new Set(clients.map(client => client.id));
      let changed = false;
      for (const id of clientNetworkModes.keys()) {
        if (!live.has(id)) {
          clientNetworkModes.delete(id);
          changed = true;
        }
      }
      if (changed) await persistClientNetworkModes();
    } catch (_) {}
  })()
    .finally(() => { networkModePruneTask = null; });
  return networkModePruneTask;
}

async function clientNetworkMode(clientId) {
  await loadClientNetworkModes();
  return validClientId(clientId) ? clientNetworkModes.get(clientId) || 'online' : 'online';
}

async function anyLiveStrictNetworkMode() {
  await loadClientNetworkModes();
  try {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    return clients.some(client => {
      const mode = clientNetworkModes.get(client.id);
      return mode === 'nearby' || mode === 'offline';
    });
  } catch (_) {
    return [...clientNetworkModes.values()].some(mode => mode === 'nearby' || mode === 'offline');
  }
}

function normalizedCacheUrl(requestUrl) {
  const url = new URL(requestUrl);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(SCOPE_PATH)) return null;
  let relative = url.pathname.slice(SCOPE_PATH.length);
  try { relative = decodeURIComponent(relative); } catch (_) { return null; }
  if (!relative) relative = 'index.html';
  else if (relative.endsWith('/')) relative += 'index.html';
  else if (!relative.split('/').pop().includes('.')) relative += '/index.html';
  if (!safePath(relative)) return null;
  return new URL(relative, self.registration.scope).href;
}

async function cachedSnapshotResponse(request) {
  const marker = await verifiedActiveMarker();
  if (!marker) return null;
  const cache = await caches.open(marker.cache);
  let response = await cache.match(request, { ignoreSearch: true });
  if (!response && request.mode === 'navigate') {
    const normalized = normalizedCacheUrl(request.url);
    if (normalized) response = await cache.match(normalized);
  }
  if (!response && request.mode === 'navigate') response = await cache.match(new URL('index.html', self.registration.scope).href);
  return response || null;
}

function unavailableResponse(request) {
  const navigation = request.mode === 'navigate';
  return new Response(navigation
    ? '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Arcade Offline</title><body style="font:18px system-ui;background:#090d1e;color:white;padding:2rem"><h1>Arcade is offline</h1><p>This part of the Arcade has not been prepared on this device yet.</p></body>'
    : 'Arcade resource unavailable offline', {
    status: 503,
    statusText: 'Offline',
    headers: { 'content-type': navigation ? 'text/html; charset=utf-8' : 'text/plain; charset=utf-8' }
  });
}

async function cacheFirst(request, strictOffline) {
  const cached = await cachedSnapshotResponse(request);
  if (cached) return cached;
  if (strictOffline) return unavailableResponse(request);
  try {
    const response = await timeoutFetch(request, { cache: 'no-store' }, request.mode === 'navigate' ? 5500 : 8000);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response;
  } catch (error) {
    const fallback = await cachedSnapshotResponse(request);
    if (fallback) return fallback;
    throw error;
  }
}

async function bindShellIframeMode(event, url) {
  if (event.request.mode !== 'navigate' || url.origin !== self.location.origin || !url.pathname.startsWith(SCOPE_PATH) ||
      url.searchParams.get('_arcadeTransport') !== 'nearby') return '';
  const resultingClientId = validClientId(event.resultingClientId) ? event.resultingClientId : '';
  if (!resultingClientId) return '';
  await setClientNetworkMode(resultingClientId, 'nearby');
  return resultingClientId;
}

async function handleFetch(event) {
  const request = event.request;
  const url = new URL(request.url);
  const boundClientId = await bindShellIframeMode(event, url);
  const mode = await clientNetworkMode(boundClientId || event.clientId);
  const strictOffline = mode === 'nearby' || mode === 'offline';
  if (strictOffline) {
    if (request.method !== 'GET' || url.origin !== self.location.origin || !url.pathname.startsWith(SCOPE_PATH)) {
      return unavailableResponse(request);
    }
    return cacheFirst(request, true);
  }
  if (request.method === 'GET' && url.origin === self.location.origin && url.pathname.startsWith(SCOPE_PATH)) {
    return cacheFirst(request, false);
  }
  return fetch(request);
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    await verifiedActiveMarker();
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const active = await verifiedActiveMarker();
    const previous = await previousMarker();
    if (active) await cleanupSnapshots(active, previous);
    await self.clients.claim();
    await pruneClientNetworkModes();
  })());
});

self.addEventListener('message', event => {
  const data = event.data && typeof event.data === 'object' ? event.data : {};
  if (data.type === 'ARCADE_OFFLINE_STATUS') {
    event.waitUntil(snapshotStatus().then(status => reply(event, status)));
    return;
  }
  if (data.type === 'ARCADE_PREPARE_OFFLINE' || data.type === 'REFRESH_CORE') {
    reply(event, { type: 'ARCADE_OFFLINE_ACCEPTED', updating: true, workerVersion: WORKER_VERSION });
    event.waitUntil(refreshSnapshot(event.source && event.source.id)
      .then(() => snapshotStatus())
      .then(status => reply(event, status))
      .catch(() => snapshotStatus().then(status => reply(event, status))));
    return;
  }
  if (data.type === 'ARCADE_SET_NETWORK_MODE') {
    const mode = typeof data.mode === 'string' ? data.mode.toLowerCase() : '';
    if (!NETWORK_MODES.has(mode) || !event.source || !event.source.id) {
      reply(event, { type: 'ARCADE_NETWORK_MODE', ok: false, mode: 'online' });
      return;
    }
    const clientId = event.source.id;
    if (mode !== 'online' && refreshAbortController) {
      deferredRefreshOwnerClientId = refreshOwnerClientId || deferredRefreshOwnerClientId;
      refreshAbortController.abort();
    }
    event.waitUntil(setClientNetworkMode(clientId, mode)
      .then(async ok => {
        reply(event, { type: 'ARCADE_NETWORK_MODE', ok, mode: ok ? mode : 'online' });
        if (ok && mode === 'online') await resumeDeferredRefreshIfPossible();
      })
      .catch(() => reply(event, { type: 'ARCADE_NETWORK_MODE', ok: false, mode: 'online' })));
  }
});

self.addEventListener('fetch', event => {
  event.respondWith(handleFetch(event));
});
