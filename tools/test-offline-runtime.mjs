#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import vm from 'node:vm';

const toolDirectory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(toolDirectory, '..');
const manifestPath = process.env.ARCADE_OFFLINE_MANIFEST
  ? path.resolve(process.env.ARCADE_OFFLINE_MANIFEST)
  : path.join(root, 'offline-manifest.json');

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    let errorOutput = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { errorOutput += chunk; });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(output) : reject(new Error(errorOutput || `${command} exited ${code}`)));
  });
}

function manifestMap(manifest) {
  return new Map(manifest.files.map(file => [file.path, file]));
}

function comparableFiles(manifest) {
  return manifest.files.map(file => ({ path: file.path, bytes: file.bytes, sha256: file.sha256 }));
}

function localReference(reference) {
  const clean = String(reference || '').trim();
  if (!clean || /^(?:#|%23|data:|blob:|https?:|javascript:|mailto:|tel:|\/\/)/i.test(clean)) return null;
  return clean.replace(/[?#].*$/, '');
}

function resolveReference(from, reference) {
  const local = localReference(reference);
  if (!local) return null;
  let resolved = path.posix.normalize(path.posix.join(path.posix.dirname(from), local));
  if (resolved.startsWith('../') || resolved.startsWith('/')) return null;
  if (!resolved || resolved.endsWith('/')) resolved += 'index.html';
  return resolved;
}

function staticReferences(file, source) {
  const references = [];
  const patterns = [];
  if (/\.html?$/i.test(file)) {
    patterns.push(/\b(?:src|href|poster)\s*=\s*["']([^"']+)["']/gi);
  }
  if (/\.(?:css|html?)$/i.test(file)) {
    patterns.push(/(?<![A-Za-z0-9_$])url\(\s*["']?([^"')]+)["']?\s*\)/gi);
  }
  if (/\.(?:js|mjs)$/i.test(file)) {
    patterns.push(/\bimport\s+(?:[^"']+?\s+from\s+)?["']([^"']+)["']/g);
    patterns.push(/\bimport\(\s*["']([^"']+)["']\s*\)/g);
    patterns.push(/\bnew\s+(?:SharedWorker|Worker)\(\s*["']([^"']+)["']/g);
    patterns.push(/\bnew\s+URL\(\s*["']([^"']+)["']\s*,\s*import\.meta\.url\s*\)/g);
  }
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(source))) references.push(match[1]);
  }
  return references;
}

async function verifyManifestFiles(manifest) {
  assert.equal(manifest.schema, 1, 'offline manifest schema');
  assert.equal(manifest.fileCount, manifest.files.length, 'offline manifest fileCount');
  const seen = new Set();
  let totalBytes = 0;
  for (const entry of manifest.files) {
    assert.match(entry.path, /^[A-Za-z0-9][A-Za-z0-9._/-]*$/, `safe path: ${entry.path}`);
    assert(!seen.has(entry.path), `duplicate path: ${entry.path}`);
    seen.add(entry.path);
    const bytes = await readFile(path.join(root, entry.path));
    totalBytes += bytes.byteLength;
    assert.equal(bytes.byteLength, entry.bytes, `${entry.path}: byte count`);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256, `${entry.path}: SHA-256`);
  }
  assert.equal(totalBytes, manifest.totalBytes, 'offline manifest totalBytes');
}

async function verifyGeneratedManifest(committed) {
  const output = path.join(tmpdir(), `arcade-offline-${process.pid}-${Date.now()}.json`);
  try {
    await run(process.execPath, [path.join(root, 'tools/generate-offline-manifest.mjs'), '--version', committed.version, '--output', output]);
    const generated = JSON.parse(await readFile(output, 'utf8'));
    assert.equal(generated.fileCount, committed.fileCount, 'generated fileCount matches committed manifest');
    assert.equal(generated.totalBytes, committed.totalBytes, 'generated totalBytes matches committed manifest');
    assert.deepEqual(comparableFiles(generated), comparableFiles(committed), 'generated paths and hashes match committed manifest');
  } finally {
    try { await import('node:fs/promises').then(({ unlink }) => unlink(output)); } catch (_) {}
  }
}

async function verifyPwaManifest(files) {
  const pwa = JSON.parse(await readFile(path.join(root, 'manifest.webmanifest'), 'utf8'));
  const index = await readFile(path.join(root, 'index.html'), 'utf8');
  const shell = await readFile(path.join(root, 'arcade-shell.js'), 'utf8');
  assert(files.has('manifest.webmanifest'), 'PWA manifest is available offline');
  assert(files.has('arcade-shell.js'), 'persistent Arcade shell is available offline');
  assert.match(index, /<script\b(?=[^>]*\bsrc=["']arcade-shell\.js["'])[^>]*>/i, 'index loads the persistent Arcade shell');
  assert.match(index, /<link\b(?=[^>]*\brel=["']manifest["'])(?=[^>]*\bhref=["']manifest\.webmanifest["'])[^>]*>/i, 'index links the PWA manifest');
  assert.match(index, /<link\b(?=[^>]*\brel=["']apple-touch-icon["'])(?=[^>]*\bhref=["']apple-touch-icon\.png["'])[^>]*>/i, 'index links the Apple touch icon');
  assert.equal(pwa.start_url, './');
  assert.equal(pwa.scope, './');
  assert.equal(pwa.display, 'standalone');
  assert(Array.isArray(pwa.icons) && pwa.icons.length >= 2, 'PWA has install icons');
  for (const icon of pwa.icons) {
    assert(files.has(icon.src), `PWA icon is offline: ${icon.src}`);
    const information = await stat(path.join(root, icon.src));
    assert(information.isFile() && information.size > 0, `PWA icon exists: ${icon.src}`);
  }

  const { offlineRuntimeReady } = await import(pathToFileURL(path.join(root, 'multiplayer/arcade-shell-core.mjs')).href);
  assert.equal(offlineRuntimeReady({ hostname: 'to-shreds.github.io' }), false, 'unprepared browser cannot start Nearby');
  assert.equal(offlineRuntimeReady({ hostname: 'to-shreds.github.io', offlineReady: true }), true, 'prepared browser can start Nearby');
  assert.equal(offlineRuntimeReady({ hostname: 'to-shreds.github.io', nativeArchiveReady: false }), false, 'first-run APK without an archive is blocked');
  assert.equal(offlineRuntimeReady({ hostname: 'to-shreds.github.io', nativeArchiveReady: true }), true, 'APK with a validated archive can start Nearby');
  assert.equal(offlineRuntimeReady({ hostname: 'arcade.local' }), true, 'selected local Arcade folder is inherently offline-ready');
  assert.match(shell, /_chooseRole\(role\)\{[\s\S]{0,400}?if\(!this\._offlineRuntimeReady\(\)\)/, 'Start and Join use the readiness gate');
  assert.match(shell, /async _resumeHost\(\)\{[\s\S]*?if\(!this\._offlineRuntimeReady\(\)\)/, 'Nearby resume uses the readiness gate');
}

async function verifyStaticReferences(manifest) {
  const files = manifestMap(manifest);
  const missing = [];
  for (const file of files.keys()) {
    if (!/\.(?:html?|css|js|mjs)$/i.test(file)) continue;
    const source = await readFile(path.join(root, file), 'utf8');
    for (const reference of staticReferences(file, source)) {
      const resolved = resolveReference(file, reference);
      if (resolved && !files.has(resolved)) missing.push(`${file} -> ${reference} (${resolved})`);
    }
  }
  assert.deepEqual(missing, [], `static local references missing from offline manifest:\n${missing.join('\n')}`);
}

async function verifyNoRemoteRuntimeAssets(manifest) {
  const remote = /^(?:https?:)?\/\//i;
  const violations = [];
  for (const file of manifest.files.map(entry => entry.path)) {
    if (!/\.(?:html?|css|js|mjs)$/i.test(file)) continue;
    const source = await readFile(path.join(root, file), 'utf8');
    const references = [];
    if (/\.html?$/i.test(file)) {
      for (const pattern of [
        /\b(?:src|poster)\s*=\s*["']([^"']+)["']/gi,
        /<link\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>/gi
      ]) {
        let match;
        while ((match = pattern.exec(source))) references.push(match[1]);
      }
    }
    if (/\.(?:css|html?)$/i.test(file)) {
      let match;
      const pattern = /(?<![A-Za-z0-9_$])url\(\s*["']?([^"')]+)["']?\s*\)/gi;
      while ((match = pattern.exec(source))) references.push(match[1]);
    }
    if (/\.(?:js|mjs)$/i.test(file)) {
      for (const pattern of [
        /\bimport\s+(?:[^"']+?\s+from\s+)?["']([^"']+)["']/g,
        /\bimport\(\s*["']([^"']+)["']\s*\)/g,
        /\bnew\s+(?:SharedWorker|Worker)\(\s*["']([^"']+)["']/g,
        /\bnew\s+URL\(\s*["']([^"']+)["']\s*,\s*import\.meta\.url\s*\)/g
      ]) {
        let match;
        while ((match = pattern.exec(source))) references.push(match[1]);
      }
    }
    for (const reference of references) if (remote.test(reference.trim())) violations.push(`${file} -> ${reference}`);
  }
  assert.deepEqual(violations, [], `remote runtime assets prevent zero-Internet use:\n${violations.join('\n')}`);
}

async function verifyScopedNearbyNetworkGuard() {
  const listeners = {};
  let liveClients = [
    { id: 'shell-client', postMessage() {} },
    { id: 'unrelated-client', postMessage() {} },
    { id: 'game-iframe-client', postMessage() {} }
  ];
  let networkFetches = 0;
  let holdNetworkFetch = false;
  let releaseNetworkStart = null;
  let networkFetchAborted = false;
  let delayAbortedFetchSettlement = false;
  let settleAbortedFetch = null;
  let cacheNames = [];
  const deletedCaches = [];
  const cacheContents = new Map();
  const cacheKey = request => typeof request === 'string' ? request : request.url;
  const activeMarkerUrl = 'https://to-shreds.github.io/arcade/__arcade_active_snapshot__';
  let cleanupFailure = false;
  let failActiveMarkerPut = 0;
  let activeMarkerPutCount = 0;
  const context = {
    AbortController,
    Date,
    Headers,
    Map,
    Math,
    Promise,
    Request,
    Response,
    Set,
    TextDecoder,
    URL,
    Uint8Array,
    clearTimeout,
    console,
    crypto: globalThis.crypto,
    fetch: async (request, options = {}) => {
      networkFetches += 1;
      if (holdNetworkFetch) {
        if (releaseNetworkStart) releaseNetworkStart();
        return new Promise((resolve, reject) => {
          const abort = () => {
            networkFetchAborted = true;
            const settle = () => reject(new Error('injected abort'));
            if (delayAbortedFetchSettlement) settleAbortedFetch = settle;
            else settle();
          };
          if (options.signal?.aborted) abort();
          else options.signal?.addEventListener('abort', abort, { once: true });
        });
      }
      return new Response(`network:${new URL(request.url || request).hostname}`);
    },
    setTimeout,
    caches: {
      async has(name) { return cacheNames.includes(name); },
      async keys() { return cacheNames.slice(); },
      async delete(name) {
        deletedCaches.push(name);
        if (cleanupFailure && name.endsWith('-obsolete')) throw new Error('injected cleanup failure');
        cacheNames = cacheNames.filter(item => item !== name);
        cacheContents.delete(name);
        return true;
      },
      async open(name) {
        if (!cacheContents.has(name)) cacheContents.set(name, new Map());
        const contents = cacheContents.get(name);
        return {
          async match(request) {
            const response = contents.get(cacheKey(request));
            return response ? response.clone() : null;
          },
          async put(request, response) {
            const key = cacheKey(request);
            if (name === 'family-arcade-snapshot-meta' && key === activeMarkerUrl) {
              activeMarkerPutCount += 1;
              if (failActiveMarkerPut && activeMarkerPutCount === failActiveMarkerPut) {
                throw new Error('injected active marker write failure');
              }
            }
            contents.set(key, response.clone());
          },
          async delete(request) { return contents.delete(cacheKey(request)); }
        };
      }
    },
    self: {
      location: { origin: 'https://to-shreds.github.io' },
      registration: { scope: 'https://to-shreds.github.io/arcade/' },
      clients: {
        async matchAll() { return liveClients; },
        async claim() {}
      },
      addEventListener(type, listener) { listeners[type] = listener; },
      async skipWaiting() {}
    }
  };
  const workerSource = await readFile(path.join(root, 'sw.js'), 'utf8');
  vm.runInNewContext(`${workerSource}\nself.__arcadeSwTest={normalizedCacheUrl,cleanupSnapshots,commitSnapshot,discardFailedSnapshot,validateSnapshot,activeMarker,verifiedActiveMarker,clientNetworkMode,currentRefresh(){return refreshTask;},resetModes(){clientNetworkModes.clear();networkModesLoaded=false;networkModesLoadTask=null;}};`, context, { filename: 'sw.js' });
  assert.equal(typeof listeners.message, 'function', 'service worker message listener registered');
  assert.equal(typeof listeners.fetch, 'function', 'service worker fetch listener registered');
  assert.equal(
    context.self.__arcadeSwTest.normalizedCacheUrl('https://to-shreds.github.io/arcade/chess/'),
    'https://to-shreds.github.io/arcade/chess/index.html',
    'offline directory navigation resolves to its game index'
  );

  cacheNames = ['family-arcade-snapshot-current', 'family-arcade-snapshot-previous', 'family-arcade-snapshot-obsolete', 'unrelated-cache'];
  await context.self.__arcadeSwTest.cleanupSnapshots(
    { cache: 'family-arcade-snapshot-current' },
    { cache: 'family-arcade-snapshot-previous' }
  );
  assert.deepEqual(deletedCaches, ['family-arcade-snapshot-obsolete'], 'only obsolete Arcade snapshots are removed');

  const oldMarker = { cache: 'family-arcade-snapshot-previous', version: 'old', manifestSha256: 'a'.repeat(64) };
  const newMarker = { cache: 'family-arcade-snapshot-current', version: 'new', manifestSha256: 'b'.repeat(64) };
  cleanupFailure = true;
  cacheNames = ['family-arcade-snapshot-current', 'family-arcade-snapshot-previous', 'family-arcade-snapshot-obsolete'];
  await context.self.__arcadeSwTest.commitSnapshot(newMarker, oldMarker);
  assert.equal((await context.self.__arcadeSwTest.activeMarker()).cache, newMarker.cache, 'cleanup failure keeps the new active marker');
  assert.equal((await context.self.__arcadeSwTest.verifiedActiveMarker()).cache, newMarker.cache, 'cleanup failure keeps the new snapshot ready');
  cleanupFailure = false;

  const retainedBodies = new Map([
    ['index.html', '<!doctype html><title>retained</title>'],
    ['catalog.json', '{"items":[]}'],
    ['sw.js', 'self.retained=true;']
  ]);
  const retainedFiles = [...retainedBodies].map(([filePath, body]) => ({
    path: filePath,
    bytes: Buffer.byteLength(body),
    sha256: createHash('sha256').update(body).digest('hex')
  }));
  const retainedManifest = {
    schema: 1,
    version: 'retained',
    fileCount: retainedFiles.length,
    totalBytes: retainedFiles.reduce((sum, file) => sum + file.bytes, 0),
    files: retainedFiles
  };
  const retainedManifestBytes = JSON.stringify(retainedManifest);
  const retainedMarker = {
    cache: 'family-arcade-snapshot-retained',
    version: retainedManifest.version,
    manifestSha256: createHash('sha256').update(retainedManifestBytes).digest('hex')
  };
  cacheNames.push(retainedMarker.cache);
  const retainedCache = await context.caches.open(retainedMarker.cache);
  for (const file of retainedFiles) {
    await retainedCache.put(`https://to-shreds.github.io/arcade/${file.path}`, new Response(retainedBodies.get(file.path), {
      headers: { 'x-arcade-sha256': file.sha256 }
    }));
  }
  await retainedCache.put('https://to-shreds.github.io/arcade/offline-manifest.json', new Response(retainedManifestBytes));
  assert.equal(
    (await context.self.__arcadeSwTest.validateSnapshot(retainedMarker, retainedManifest, retainedMarker.manifestSha256)).cache,
    retainedMarker.cache,
    'fault-injection candidate is a complete validated snapshot'
  );

  let signalReads = 0;
  const pauseAfterActive = { get aborted() { signalReads += 1; return signalReads > 1; } };
  activeMarkerPutCount = 0;
  failActiveMarkerPut = 2;
  let markerFailure;
  try {
    await context.self.__arcadeSwTest.commitSnapshot(retainedMarker, newMarker, pauseAfterActive);
  } catch (error) {
    markerFailure = error;
  }
  assert(markerFailure, 'rollback metadata failure rejects activation');
  assert.equal(markerFailure.arcadeRetainSnapshot, retainedMarker.cache, 'activation error protects the potentially active cache');
  await context.self.__arcadeSwTest.discardFailedSnapshot(retainedMarker.cache, markerFailure);
  assert(cacheNames.includes(retainedMarker.cache), 'outer failure cleanup retains a cache that ACTIVE may reference');
  assert.equal(
    (await context.self.__arcadeSwTest.verifiedActiveMarker()).cache,
    retainedMarker.cache,
    'metadata rollback failure still resolves a complete active snapshot'
  );
  failActiveMarkerPut = 0;
  activeMarkerPutCount = 0;
  await context.self.__arcadeSwTest.commitSnapshot(newMarker, retainedMarker);

  const canceledCandidate = { cache: 'family-arcade-snapshot-candidate', version: 'candidate', manifestSha256: 'c'.repeat(64) };
  const canceledActivation = new AbortController();
  canceledActivation.abort();
  await assert.rejects(
    context.self.__arcadeSwTest.commitSnapshot(canceledCandidate, newMarker, canceledActivation.signal),
    /paused/,
    'Nearby transition cancels snapshot activation'
  );
  assert.equal((await context.self.__arcadeSwTest.activeMarker()).cache, newMarker.cache, 'canceled activation preserves the last working snapshot');

  holdNetworkFetch = true;
  const networkStarted = new Promise(resolve => { releaseNetworkStart = resolve; });
  const activeRefreshTasks = [];
  listeners.message({
    data: { type: 'REFRESH_CORE' },
    source: { id: 'shell-client', postMessage() {} },
    ports: [],
    waitUntil(task) { activeRefreshTasks.push(task); }
  });
  await networkStarted;

  const shellReplies = [];
  const modeTasks = [];
  listeners.message({
    data: { type: 'ARCADE_SET_NETWORK_MODE', mode: 'nearby' },
    source: { id: 'shell-client', postMessage(message) { shellReplies.push(message); } },
    ports: [],
    waitUntil(task) { modeTasks.push(task); }
  });
  await Promise.all(modeTasks);
  await Promise.all(activeRefreshTasks);
  assert.equal(shellReplies.at(-1).ok, true, 'shell enabled Nearby network guard');
  assert.equal(networkFetchAborted, true, 'entering Nearby aborts an in-progress offline refresh');

  holdNetworkFetch = false;
  releaseNetworkStart = null;
  networkFetches = 0;
  const refreshTasks = [];
  listeners.message({
    data: { type: 'REFRESH_CORE' },
    source: { id: 'shell-client', postMessage() {} },
    ports: [],
    waitUntil(task) { refreshTasks.push(task); }
  });
  await Promise.all(refreshTasks);
  assert.equal(networkFetches, 0, 'offline refresh makes no network request while Nearby is active');

  const unrelatedRefreshTasks = [];
  listeners.message({
    data: { type: 'REFRESH_CORE' },
    source: { id: 'unrelated-client', postMessage() {} },
    ports: [],
    waitUntil(task) { unrelatedRefreshTasks.push(task); }
  });
  await Promise.all(unrelatedRefreshTasks);
  assert.equal(networkFetches, 0, 'snapshot update is deferred while another tab has a live Nearby session');

  const shellOnlineTasks = [];
  listeners.message({
    data: { type: 'ARCADE_SET_NETWORK_MODE', mode: 'online' },
    source: { id: 'shell-client', postMessage() {} },
    ports: [],
    waitUntil(task) { shellOnlineTasks.push(task); }
  });
  await Promise.all(shellOnlineTasks);
  await context.self.__arcadeSwTest.currentRefresh()?.catch(() => null);
  assert.equal(networkFetches, 1, 'deferred snapshot update resumes after the Nearby tab leaves');

  const shellNearbyAgainTasks = [];
  listeners.message({
    data: { type: 'ARCADE_SET_NETWORK_MODE', mode: 'nearby' },
    source: { id: 'shell-client', postMessage() {} },
    ports: [],
    waitUntil(task) { shellNearbyAgainTasks.push(task); }
  });
  await Promise.all(shellNearbyAgainTasks);
  networkFetches = 0;

  let shellResponse;
  listeners.fetch({
    clientId: 'shell-client',
    request: new Request('https://arcade-chess.jonathanjablon.workers.dev/api/arcade/rooms'),
    respondWith(task) { shellResponse = Promise.resolve(task); }
  });
  assert.equal((await shellResponse).status, 503, 'Nearby shell client cannot reach Cloudflare');
  assert.equal(networkFetches, 0, 'Nearby shell made no network request');

  let unrelatedResponse;
  listeners.fetch({
    clientId: 'unrelated-client',
    request: new Request('https://arcade-chess.jonathanjablon.workers.dev/api/arcade/rooms'),
    respondWith(task) { unrelatedResponse = Promise.resolve(task); }
  });
  assert.equal((await unrelatedResponse).status, 200, 'unrelated Arcade tab remains online');
  assert.equal(networkFetches, 1, 'unrelated tab reached its Cloudflare transport');

  let iframeNavigation;
  listeners.fetch({
    clientId: 'shell-client',
    resultingClientId: 'game-iframe-client',
    request: {
      url: 'https://to-shreds.github.io/arcade/chess/?_arcadeTransport=nearby',
      method: 'GET',
      mode: 'navigate'
    },
    respondWith(task) { iframeNavigation = Promise.resolve(task); }
  });
  assert.equal((await iframeNavigation).status, 503, 'uncached test navigation stays local while binding the iframe');

  let iframeResponse;
  listeners.fetch({
    clientId: 'game-iframe-client',
    request: new Request('https://arcade-chess.jonathanjablon.workers.dev/api/arcade/rooms'),
    respondWith(task) { iframeResponse = Promise.resolve(task); }
  });
  const blocked = await iframeResponse;
  assert.equal(blocked.status, 503, 'iframe cross-origin request blocked while shell is Nearby');
  assert.equal(networkFetches, 1, 'Nearby iframe made no additional network request');

  context.self.__arcadeSwTest.resetModes();
  assert.equal(await context.self.__arcadeSwTest.clientNetworkMode('game-iframe-client'), 'nearby', 'iframe mode survives service-worker process restart');
  let persistedIframeResponse;
  listeners.fetch({
    clientId: 'game-iframe-client',
    request: new Request('https://arcade-chess.jonathanjablon.workers.dev/api/arcade/rooms'),
    respondWith(task) { persistedIframeResponse = Promise.resolve(task); }
  });
  assert.equal((await persistedIframeResponse).status, 503, 'restored iframe declaration remains cache-only');

  let directResponse;
  listeners.fetch({
    clientId: 'direct-game-client',
    request: new Request('https://arcade-chess.jonathanjablon.workers.dev/api/arcade/rooms'),
    respondWith(task) { directResponse = Promise.resolve(task); }
  });
  assert.equal((await directResponse).status, 200, 'direct game link outside the shell remains online');
  assert.equal(networkFetches, 2, 'direct game link reached Cloudflare');

  const iframeModeTasks = [];
  listeners.message({
    data: { type: 'ARCADE_SET_NETWORK_MODE', mode: 'online' },
    source: { id: 'game-iframe-client', postMessage() {} },
    ports: [],
    waitUntil(task) { iframeModeTasks.push(task); }
  });
  await Promise.all(iframeModeTasks);
  let releasedIframeResponse;
  listeners.fetch({
    clientId: 'game-iframe-client',
    request: new Request('https://arcade-chess.jonathanjablon.workers.dev/api/arcade/rooms'),
    respondWith(task) { releasedIframeResponse = Promise.resolve(task); }
  });
  assert.equal((await releasedIframeResponse).status, 200, 'iframe returns online only after its own explicit declaration');
  assert.equal(networkFetches, 3, 'released iframe can reach Cloudflare');

  const shellReleaseTasks = [];
  listeners.message({
    data: { type: 'ARCADE_SET_NETWORK_MODE', mode: 'online' },
    source: { id: 'shell-client', postMessage() {} },
    ports: [],
    waitUntil(task) { shellReleaseTasks.push(task); }
  });
  await Promise.all(shellReleaseTasks);

  networkFetches = 0;
  networkFetchAborted = false;
  holdNetworkFetch = true;
  delayAbortedFetchSettlement = true;
  const lateAbortNetworkStarted = new Promise(resolve => { releaseNetworkStart = resolve; });
  const lateAbortRefreshTasks = [];
  listeners.message({
    data: { type: 'REFRESH_CORE' },
    source: { id: 'unrelated-client', postMessage() {} },
    ports: [],
    waitUntil(task) { lateAbortRefreshTasks.push(task); }
  });
  await lateAbortNetworkStarted;

  const lateNearbyTasks = [];
  listeners.message({
    data: { type: 'ARCADE_SET_NETWORK_MODE', mode: 'nearby' },
    source: { id: 'shell-client', postMessage() {} },
    ports: [],
    waitUntil(task) { lateNearbyTasks.push(task); }
  });
  await Promise.all(lateNearbyTasks);
  assert.equal(networkFetchAborted, true, 'late Nearby entry aborts the active refresh');

  const earlyReleaseTasks = [];
  listeners.message({
    data: { type: 'ARCADE_SET_NETWORK_MODE', mode: 'online' },
    source: { id: 'shell-client', postMessage() {} },
    ports: [],
    waitUntil(task) { earlyReleaseTasks.push(task); }
  });
  await Promise.all(earlyReleaseTasks);
  assert.equal(networkFetches, 1, 'leaving before abort settlement does not overlap the still-active refresh');

  holdNetworkFetch = false;
  delayAbortedFetchSettlement = false;
  assert.equal(typeof settleAbortedFetch, 'function', 'test retained the delayed abort settlement');
  settleAbortedFetch();
  await Promise.all(lateAbortRefreshTasks);
  for (let attempt = 0; attempt < 5 && networkFetches < 2; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  await context.self.__arcadeSwTest.currentRefresh()?.catch(() => null);
  assert.equal(networkFetches, 2, 'deferred update resumes after an aborted refresh settles even when Nearby already left');
}

const committed = JSON.parse(await readFile(manifestPath, 'utf8'));
await verifyManifestFiles(committed);
await verifyGeneratedManifest(committed);
await verifyScopedNearbyNetworkGuard();
await verifyPwaManifest(manifestMap(committed));
await verifyStaticReferences(committed);
await verifyNoRemoteRuntimeAssets(committed);
console.log(`Offline runtime verified: ${committed.fileCount} files, ${committed.totalBytes} bytes, ${committed.version}`);
