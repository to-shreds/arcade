const WORKER_VERSION = '2026-09-01-arcade-rooms-v1';
const SNAPSHOT_PREFIX = 'family-arcade-snapshot-';
const META_CACHE = 'family-arcade-snapshot-meta';
const ACTIVE_KEY = new URL('__arcade_active_snapshot__', self.registration.scope).href;
const MANIFEST_URL = new URL('offline-manifest.json', self.registration.scope).href;
const SCOPE_PATH = new URL(self.registration.scope).pathname;
const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const MAX_ARCHIVE_BYTES = 250 * 1024 * 1024;
const MAX_FILES = 10000;
let refreshTask = null;
let validatedSnapshotKey = null;
let validationTask = null;

function timeoutFetch(input, options = {}, timeoutMs = 6500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(input, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
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

async function fetchManifest() {
  const response = await timeoutFetch(MANIFEST_URL, { cache: 'no-store', redirect: 'error' }, 6500);
  if (!response.ok || response.redirected) throw new Error(`Manifest HTTP ${response.status}`);
  const bytes = await response.arrayBuffer();
  if (!bytes.byteLength || bytes.byteLength > MAX_MANIFEST_BYTES) throw new Error('Manifest size is invalid');
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const manifest = validateManifest(JSON.parse(text));
  return { manifest, bytes, digest: await sha256(bytes) };
}

async function activeMarker() {
  const response = await (await caches.open(META_CACHE)).match(ACTIVE_KEY);
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

function markerKey(marker) {
  return marker ? `${marker.cache}:${marker.manifestSha256}` : '';
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
      await (await caches.open(META_CACHE)).put(ACTIVE_KEY, new Response(JSON.stringify(marker), { headers: { 'content-type': 'application/json' } }));
      return marker;
    } catch (_) {}
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

async function verifiedResponse(file) {
  const url = new URL(file.path, self.registration.scope).href;
  const response = await timeoutFetch(url, { cache: 'no-store', redirect: 'error' }, 12000);
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

async function buildSnapshot() {
  const remote = await fetchManifest();
  const oldMarker = await activeMarker();
  if (oldMarker && oldMarker.version === remote.manifest.version && oldMarker.manifestSha256 === remote.digest &&
      await validateSnapshot(oldMarker, remote.manifest, remote.digest)) return oldMarker;

  const suffix = `${remote.manifest.version.replace(/[^A-Za-z0-9._-]/g, '_')}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const cacheName = `${SNAPSHOT_PREFIX}${suffix}`;
  const snapshot = await caches.open(cacheName);
  const oldSnapshot = oldMarker ? await caches.open(oldMarker.cache) : null;
  try {
    for (let start = 0; start < remote.manifest.files.length; start += 4) {
      const batch = remote.manifest.files.slice(start, start + 4);
      await Promise.all(batch.map(async file => {
        const response = await reusableResponse(oldSnapshot, file) || await verifiedResponse(file);
        await snapshot.put(new URL(file.path, self.registration.scope).href, response);
      }));
    }
    const manifestHeaders = new Headers({ 'content-type': 'application/json; charset=utf-8', 'x-arcade-manifest-sha256': remote.digest });
    await snapshot.put(MANIFEST_URL, new Response(remote.bytes, { status: 200, headers: manifestHeaders }));
    if (!await snapshot.match(new URL('index.html', self.registration.scope).href) ||
        !await snapshot.match(new URL('catalog.json', self.registration.scope).href)) throw new Error('Snapshot validation failed');

    const marker = { cache: cacheName, version: remote.manifest.version, manifestSha256: remote.digest, worker: WORKER_VERSION };
    await (await caches.open(META_CACHE)).put(ACTIVE_KEY, new Response(JSON.stringify(marker), { headers: { 'content-type': 'application/json' } }));
    validatedSnapshotKey = markerKey(marker);
    return marker;
  } catch (error) {
    await caches.delete(cacheName);
    throw error;
  }
}

function refreshSnapshot() {
  if (refreshTask) return refreshTask;
  refreshTask = buildSnapshot().finally(() => { refreshTask = null; });
  return refreshTask;
}

async function cachedFallback(request) {
  const marker = await verifiedActiveMarker();
  if (!marker) return null;
  const cache = await caches.open(marker.cache);
  let response = await cache.match(request, { ignoreSearch: true });
  if (!response && request.mode === 'navigate') response = await cache.match(new URL('index.html', self.registration.scope).href);
  return response || null;
}

async function onlineFirst(request) {
  try {
    const response = await timeoutFetch(request, { cache: 'no-store' }, request.mode === 'navigate' ? 5500 : 8000);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response;
  } catch (error) {
    const fallback = await cachedFallback(request);
    if (fallback) return fallback;
    throw error;
  }
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    try {
      await refreshSnapshot();
    } catch (error) {
      if (!await verifiedActiveMarker()) throw error;
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    await verifiedActiveMarker();
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'REFRESH_CORE') event.waitUntil(refreshSnapshot().catch(() => null));
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(SCOPE_PATH)) return;
  event.respondWith(onlineFirst(request));
});
