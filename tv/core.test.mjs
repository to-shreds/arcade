import test from 'node:test';
import assert from 'node:assert/strict';
import { Actions, API_ORIGIN, SESSION_KEY, DEFAULT_QUALITY, QUALITY_OPTIONS, TVClient, nextEpisode, normalizeQuality, releasedEpisodes, sourceOrder, sourceResolution, targetOf, validMediaUrl } from './core.mjs';
import { PRESET_TITLES } from './catalog.mjs';

const token = 'a'.repeat(43);
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const movie = { type: 'movie', id: 'tt0113497' };
const episode = { type: 'series', id: 'tt0131613', season: 1, episode: 1 };
const readySource = (id = 'copy-1') => ({ id, hash: id, cached: true, browserContainer: true, score: 100 });
const storage = () => { const map = new Map(); return { getItem: key => map.get(key), setItem: (key, value) => map.set(key, value), removeItem: key => map.delete(key), map }; };

test('catalog is fixed, unique, alphabetized by activity renderer, and pins requested versions', () => {
  assert(PRESET_TITLES.length > 100);
  assert.equal(new Set(PRESET_TITLES.map(item => item.id)).size, PRESET_TITLES.length);
  for (const item of PRESET_TITLES) { assert.match(item.id, /^tt\d{5,12}$/); assert(['movie', 'series'].includes(item.type)); assert(Number.isInteger(item.year)); }
  const shows = PRESET_TITLES.filter(item => item.type === 'series');
  assert.deepEqual(shows.map(item => item.id).sort(), ['tt4549142', 'tt0235918', 'tt0131613', 'tt0081933'].sort());
  assert.equal(PRESET_TITLES.find(item => item.id === movie.id).year, 1995);
});

test('episode queue orders releases, crosses season boundaries, excludes future and duplicate episodes', () => {
  const meta = { episodes: [
    { season: 2, episode: 1, name: 'Next season' }, { season: 0, episode: 1 },
    { season: 1, episode: 2 }, { season: 1, episode: 1 }, { season: 1, episode: 2 },
    { season: 2, episode: 2, released: '2999-01-01T00:00:00Z' }, { season: 2, episode: 3, released: 'invalid' }
  ] };
  assert.deepEqual(releasedEpisodes(meta).map(e => [e.season, e.episode]), [[0, 1], [1, 1], [1, 2], [2, 1]]);
  assert.deepEqual(nextEpisode(meta, { ...episode, episode: 2 }), meta.episodes[0]);
  assert.equal(nextEpisode(meta, { ...episode, season: 2, episode: 1 }), null);
  assert.equal(nextEpisode(meta, { ...episode, season: 0, episode: 1 }), null);
  assert.equal(nextEpisode(meta, movie), null);
});

test('media URLs reject foreign, credentialed, insecure, and malformed ticket addresses', () => {
  assert.equal(validMediaUrl('/media/' + token), API_ORIGIN + '/media/' + token);
  assert.equal(validMediaUrl('https://cdn.tb-cdn.cx/video.mp4?ticket=123'), 'https://cdn.tb-cdn.cx/video.mp4?ticket=123');
  for (const value of ['https://evil.test/media/' + token, '/media/' + token + '?apiKey=secret', 'http://cdn.torbox.app/a.mp4', 'https://torbox.app.evil.test/a.mp4', 'https://u:p@torbox-web-player-key.onrender.com/media/' + token, 'javascript:alert(1)']) assert.throws(() => validMediaUrl(value));
});

test('source order is cached-only by default and uncached preparation requires explicit supported choice', () => {
  const available = [readySource(), { ...readySource('mkv'), browserUnsupported: true, score: 500 }, { ...readySource('not-ready'), cached: false, score: 200 }, { ...readySource('unknown'), cached: null, browserContainer: false }, { ...readySource('audio-risk'), cached: false, audioRisk: true }];
  assert.deepEqual(sourceOrder(available).map(source => source.id), ['copy-1']);
  assert.deepEqual(sourceOrder(available, { cachedOnly: false }).map(source => source.id), ['not-ready']);
  assert.deepEqual(sourceOrder(available, { excluded: new Set(['copy-1']) }), []);
});

test('login sends key in an HTTPS body and persists only a namespaced opaque session token', async () => {
  const calls = [], store = storage();
  const client = new TVClient({ storage: store, fetchFn: async (url, options) => { calls.push({ url, options }); return json({ sessionToken: token, authMode: 'api-key' }); } });
  await client.login('credential-fixture');
  assert.equal(store.getItem(SESSION_KEY), token);
  assert(!JSON.stringify([...store.map]).includes('credential-fixture'));
  assert(!calls[0].url.includes('credential-fixture'));
  assert.equal(JSON.parse(calls[0].options.body).apiKey, 'credential-fixture');
  assert.equal(calls[0].options.credentials, 'omit');
});

test('late login response after sign out is revoked and cannot restore authentication', async () => {
  let finishLogin, started;
  const startedPromise = new Promise(resolve => started = resolve), calls = [], store = storage();
  const client = new TVClient({ storage: store, fetchFn: (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/api/login')) { started(); return new Promise(resolve => finishLogin = () => resolve(json({ sessionToken: token }))); }
    return Promise.resolve(json({ ok: true }));
  } });
  const pending = client.login('credential-fixture'); await startedPromise;
  await client.signOut(); finishLogin();
  await assert.rejects(pending, error => error.name === 'AbortError');
  assert.equal(client.token, ''); assert.equal(store.getItem(SESSION_KEY), undefined);
  assert.equal(calls.filter(call => call.url.endsWith('/api/logout')).length, 1);
});

test('late metadata and playback requests ignore response after cancellation', async () => {
  let finish;
  const client = new TVClient({ storage: null, fetchFn: () => new Promise(resolve => finish = () => resolve(json({ meta: { ...movie, name: 'Jumanji' } }))) });
  const controller = new AbortController(), pending = client.metadata(movie, controller.signal);
  controller.abort(); finish();
  await assert.rejects(pending, error => error.name === 'AbortError');
});

test('Actions invalidates previous requests while preserving newest action', () => {
  const actions = new Actions(), first = actions.begin(), second = actions.begin();
  assert.equal(first.current(), false); assert.equal(first.signal.aborted, true); assert.throws(first.check, error => error.name === 'AbortError');
  assert.equal(second.current(), true); actions.cancel(); assert.equal(second.current(), false);
});

test('cached playback tries a compatible alternate and never starts uncached downloads', async () => {
  const calls = [];
  const client = new TVClient({ storage: null, fetchFn: async (url, options) => {
    const body = JSON.parse(options.body || '{}'); calls.push({ url, body });
    return json(body.source === 'bad' ? { state: 'browser_unsupported', file: { id: 'torrents:1:0', title: 'Jumanji.mkv' } } : { state: 'ready', file: { id: 'torrents:2:0', title: 'Jumanji.mp4' } });
  } });
  const result = await client.cachedFile([{ ...readySource('bad'), score: 300 }, readySource('good'), { ...readySource('uncached'), cached: false }], movie);
  assert.equal(result.source.id, 'good');
  assert.equal(calls.length, 2);
  assert(calls.every(call => call.body.onlyCached === true));
});

test('multi-file episode selects exact single episode and refuses combined or ambiguous movie files', async () => {
  const requests = [];
  const client = new TVClient({ storage: null, fetchFn: async (url, options) => {
    requests.push({ url, options });
    if (url.includes('/status?')) return json({ state: 'ready', file: { id: 'torrents:1:2', title: 'TMNT S01E01.mp4' } });
    return json({ state: 'choose_file', files: [
      { id: 'torrents:1:0', title: 'TMNT S01E01-E02.mp4' }, { id: 'torrents:1:1', title: 'TMNT S01E02.mp4' }, { id: 'torrents:1:2', title: 'TMNT S01E01.mp4' }
    ] });
  } });
  const result = await client.ready(readySource(), episode);
  assert.equal(result.file.id, 'torrents:1:2');
  assert(new URL(requests[1].url).searchParams.get('file') === 'torrents:1:2');
  await assert.rejects(client.ready(readySource(), movie), error => error.code === 'SOURCE_NOT_PLAYABLE');
});

test('a stubborn file chooser is bounded instead of looping forever', async () => {
  let calls = 0;
  const client = new TVClient({ storage: null, fetchFn: async () => { calls++; return json({ state: 'choose_file', files: [{ id: 'torrents:1:0', title: 'Jumanji.mp4' }] }); } });
  await assert.rejects(client.ready(readySource(), movie), error => error.code === 'SOURCE_NOT_PLAYABLE'); assert.equal(calls, 2);
});

test('anonymous backend response cannot substitute another title', async () => {
  const client = new TVClient({ storage: null, fetchFn: async () => json({ meta: { type: 'movie', id: 'tt0000000' } }) });
  await assert.rejects(client.metadata(movie), error => error.code === 'INVALID_METADATA');
  assert.throws(() => targetOf({ id: 'invalid', type: 'movie' }));
  assert.throws(() => targetOf(episode, { season: 1, episode: 0 }));
});

test('TV quality defaults to480p and accepts only the supported explicit preferences', () => {
  assert.equal(DEFAULT_QUALITY, '480p');
  assert.deepEqual(QUALITY_OPTIONS, ['480p', '720p', '1080p', '2160p', 'auto']);
  assert.equal(normalizeQuality(' 1080P '), '1080p');
  assert.equal(normalizeQuality('AUTO'), 'auto');
  for (const value of [undefined, null, '', '4k', '540p', 'best', {}, 480]) assert.equal(normalizeQuality(value), '480p');
});

test('resolution parsing trusts nominal fields first and matches conservative release tokens', () => {
  for (const [source, expected] of [
    [{ resolution: '1080', quality: '480p', title: 'Movie.720p.mp4' }, '1080p'],
    [{ resolution: '4K', title: 'Movie.480p.mp4' }, '2160p'],
    [{ quality: '720p' }, '720p'],
    [{ filename: 'Movie.1080P.WEBRip.mp4' }, '1080p'],
    [{ title: 'A Movie - 4K' }, '2160p'],
    [{ resolution: '1920x1080', filename: 'Movie.480p.mp4' }, '480p'],
    [{ title: 'Movie 4Kids Adventures' }, null],
    [{ title: 'Movie1080pExtra' }, null],
    [{ filename: 'Movie.1920x1080.mp4' }, null],
    [{ resolution: 'high', quality: 'SD' }, null],
    [{}, null]
  ]) assert.equal(sourceResolution(source), expected);
});

test('quality ranking keeps browser safety ahead of exact resolution, unknown quality last and inputs intact', () => {
  const available = [
    { ...readySource('risk480'), resolution: '480p', audioRisk: true, score: 99999 },
    { ...readySource('safe1080'), resolution: '1080p', score: 900 },
    { ...readySource('safe720'), resolution: '720p', score: 300 },
    { ...readySource('safe360'), resolution: '360p', score: 200 },
    { ...readySource('unknown'), score: 9999 },
    { ...readySource('neutral480'), resolution: '480p', browserContainer: false, score: 1000 },
    { ...readySource('safe480'), resolution: '480p', score: 1 }
  ];
  const before = structuredClone(available);
  assert.deepEqual(sourceOrder(available).map(source => source.id), ['safe480', 'safe360', 'safe720', 'safe1080', 'unknown', 'neutral480', 'risk480']);
  assert.deepEqual(sourceOrder(available, { quality: 'auto' }).map(source => source.id), ['unknown', 'safe1080', 'safe720', 'safe360', 'safe480', 'neutral480', 'risk480']);
  assert.deepEqual(available, before, 'Ranking does not reorder or modify the backend response');
  const tied = [{ ...readySource('upper'), resolution: '1440p', score: 900 }, { ...readySource('lower'), resolution: '720p', score: 1 }];
  assert.deepEqual(sourceOrder(tied, { quality: '1080p' }).map(source => source.id), ['lower', 'upper'], 'Equal pixel-height distance favors the smaller copy');
});

test('quality preferences never bypass excluded copies, known browser failures or cached-only selection', () => {
  const available = [
    { ...readySource('excluded'), hash: 'excluded-hash', resolution: '480p' },
    { ...readySource('uncached'), cached: false, resolution: '480p' },
    { ...readySource('unsupported'), browserUnsupported: true, resolution: '480p' },
    { ...readySource('unplayable'), cachedBrowserPlayable: false, resolution: '480p' },
    { ...readySource('ready'), resolution: '1080p' }
  ];
  for (const quality of QUALITY_OPTIONS) assert.deepEqual(sourceOrder(available, { quality, excluded: new Set(['excluded-hash']) }).map(source => source.id), ['ready']);
  assert.deepEqual(sourceOrder(available, { cachedOnly: false }).map(source => source.id), ['uncached']);
});

test('metadata cache is cloned, expires after ten minutes and does not cache failed identity checks', async () => {
  let now = 1000, calls = 0;
  const client = new TVClient({ storage: null, now: () => now, fetchFn: async () => { calls++; return json({ meta: { ...movie, name: 'Jumanji', episodes: [{ season: 1, episode: 1 }] } }); } });
  const first = await client.metadata(movie); first.name = 'Changed'; first.episodes[0].season = 99;
  const second = await client.metadata(movie); assert.equal(second.name, 'Jumanji'); assert.equal(second.episodes[0].season, 1); second.episodes.length = 0;
  assert.equal((await client.metadata(movie)).episodes.length, 1); assert.equal(calls, 1);
  now += 599999; await client.metadata(movie); assert.equal(calls, 1);
  now++; await client.metadata(movie); assert.equal(calls, 2, 'The exact expiry boundary causes a new request');
  let identityCalls = 0;
  const invalid = new TVClient({ storage: null, fetchFn: async () => { identityCalls++; return json({ meta: { type: 'movie', id: 'tt0000000' } }); } });
  for (let index = 0; index < 2; index++) await assert.rejects(invalid.metadata(movie), error => error.code === 'INVALID_METADATA');
  assert.equal(identityCalls, 2);
});

test('metadata cache bounds twenty entries and retains a recently used title', async () => {
  const calls = [];
  const client = new TVClient({ storage: null, fetchFn: async url => {
    const id = new URL(url).searchParams.get('id'); calls.push(id); return json({ meta: { type: 'movie', id, name: id } });
  } });
  const titles = Array.from({ length: 21 }, (_, index) => ({ type: 'movie', id: 'tt' + String(index + 1000000) }));
  for (const title of titles.slice(0, 20)) await client.metadata(title);
  await client.metadata(titles[0]); await client.metadata(titles[20]);
  assert.equal(client.metadataCache.size, 20);
  await client.metadata(titles[0]); assert.equal(calls.length, 21, 'A recently read entry survives the cache bound');
  await client.metadata(titles[1]); assert.equal(calls.length, 22, 'The least recently used entry was evicted');
});

test('source lookup cache clones results, reports cache hits, expires after a minute and refreshes explicitly', async () => {
  let now = 0; const calls = [], stages = [];
  const client = new TVClient({ storage: null, now: () => now, fetchFn: async (url, options) => {
    calls.push({ url, options });
    return json(url.includes('/lookup?') ? { complete: true, sources: [{ id: 'lookup' }] } : { sources: [readySource()], cacheAvailability: 'known', nested: { value: 'original' } });
  } });
  const first = await client.sources(movie, undefined, { onStatus: value => stages.push(value) }); first.sources[0].id = 'changed'; first.nested.value = 'changed';
  assert.deepEqual(stages.map(value => value.stage), ['lookup', 'cache-check']); stages.length = 0;
  const cached = await client.sources(movie, undefined, { onStatus: value => stages.push(value) });
  assert.equal(cached.sources[0].id, 'copy-1'); assert.equal(cached.nested.value, 'original'); cached.nested.value = 'again';
  assert.deepEqual(stages, [{ stage: 'cache-check', cached: true }]); assert.equal(calls.length, 2);
  now = 59999; await client.sources(movie); assert.equal(calls.length, 2);
  now = 60000; await client.sources(movie); assert.equal(calls.length, 4);
  await client.sources(movie, undefined, { refresh: true }); assert.equal(calls.length, 6);
  assert(calls.every(call => call.options.cache === 'no-store'), 'Memory caching does not enable intermediary credentialed response caches');
});

test('empty, incomplete and unknown-cache source responses are retried instead of cached', async () => {
  for (const scenario of ['empty', 'incomplete', 'unknown']) {
    let calls = 0;
    const client = new TVClient({ storage: null, fetchFn: async url => {
      calls++;
      if (url.includes('/lookup?')) return json({ complete: scenario !== 'incomplete', sources: [{ id: 'lookup' }] });
      return json({ sources: scenario === 'empty' ? [] : [readySource()], cacheAvailability: scenario === 'unknown' ? 'unknown' : 'known' });
    } });
    await client.sources(movie); await client.sources(movie);
    assert.equal(calls, 4, scenario + ' results never become sticky empty or misleading cache hits'); assert.equal(client.sourceCache.size, 0);
  }
});

test('source cache scopes exact episode targets and bounds eight recently used entries', async () => {
  const calls = [];
  const client = new TVClient({ storage: null, fetchFn: async url => {
    calls.push(url); return json(url.includes('/lookup?') ? { complete: true, sources: [{ id: 'lookup' }] } : { sources: [readySource()], cacheAvailability: 'known' });
  } });
  const episodes = Array.from({ length: 9 }, (_, index) => ({ ...episode, episode: index + 1 }));
  for (const selected of episodes.slice(0, 8)) await client.sources(selected);
  await client.sources(episodes[0]); await client.sources(episodes[8]);
  assert.equal(client.sourceCache.size, 8); assert.equal(calls.length, 18);
  await client.sources(episodes[0]); assert.equal(calls.length, 18);
  await client.sources(episodes[1]); assert.equal(calls.length, 20);
  await client.sources({ ...episode, season: 2 }); assert.equal(calls.length, 22, 'Different seasons cannot share an episode cache entry');
});

test('catalog caches keep the same token but clear on changed token, sign out and sign-in start', async () => {
  let calls = 0, finishLogin;
  const client = new TVClient({ storage: null, fetchFn: async url => {
    calls++;
    if (url.endsWith('/login')) return new Promise(resolve => { finishLogin = () => resolve(json({ sessionToken: 'b'.repeat(43) })); });
    if (url.includes('/meta?')) return json({ meta: { ...movie, name: 'Jumanji' } });
    if (url.includes('/lookup?')) return json({ complete: true, sources: [{ id: 'lookup' }] });
    return json({ sources: [readySource()], cacheAvailability: 'known' });
  } });
  client.setToken(token); await client.metadata(movie); await client.sources(movie); assert.equal(calls, 3);
  client.setToken(token); await client.metadata(movie); await client.sources(movie); assert.equal(calls, 3);
  client.setToken('c'.repeat(43)); await client.metadata(movie); await client.sources(movie); assert.equal(calls, 6);
  await client.signOut({ revoke: false }); assert.equal(client.metadataCache.size, 0); assert.equal(client.sourceCache.size, 0);
  client.setToken(token); await client.metadata(movie); await client.sources(movie);
  const pending = client.login('fixture-key');
  assert.equal(client.metadataCache.size, 0); assert.equal(client.sourceCache.size, 0, 'Caches clear immediately while a new login is still pending');
  finishLogin(); await pending;
});

test('late metadata results after session changes or cache reset cannot repopulate catalog caches', async () => {
  for (const change of ['token', 'signout', 'reset', 'abort', 'login']) {
    let finish; const controller = new AbortController();
    const client = new TVClient({ storage: null, fetchFn: url => url.includes('/meta?') ? new Promise(resolve => { finish = () => resolve(json({ meta: { ...movie, name: 'Late result' } })); }) : Promise.resolve(json({ sessionToken: 'b'.repeat(43) })) });
    client.setToken(token);
    const pending = client.metadata(movie, controller.signal);
    if (change === 'token') client.setToken('c'.repeat(43));
    if (change === 'signout') await client.signOut({ revoke: false });
    if (change === 'reset') client.clearCatalogCache();
    if (change === 'abort') controller.abort();
    if (change === 'login') await client.login('fixture-key');
    finish(); await assert.rejects(pending, error => error.name === 'AbortError'); assert.equal(client.metadataCache.size, 0, change);
  }
});

test('late source lookup and cache-check results cannot survive session changes or aborts', async () => {
  for (const stage of ['lookup', 'sources']) for (const change of ['token', 'signout', 'reset', 'abort', 'login']) {
    let finish, signalStarted; const started = new Promise(resolve => { signalStarted = resolve; }), controller = new AbortController();
    const client = new TVClient({ storage: null, fetchFn: url => {
      if ((stage === 'lookup' && url.includes('/lookup?')) || (stage === 'sources' && url.endsWith('/sources'))) {
        signalStarted(); return new Promise(resolve => { finish = () => resolve(json(stage === 'lookup' ? { complete: true, sources: [{ id: 'lookup' }] } : { sources: [readySource()], cacheAvailability: 'known' })); });
      }
      if (url.includes('/lookup?')) return Promise.resolve(json({ complete: true, sources: [{ id: 'lookup' }] }));
      return Promise.resolve(json({ sessionToken: 'b'.repeat(43) }));
    } });
    client.setToken(token); const pending = client.sources(episode, controller.signal); await started;
    if (change === 'token') client.setToken('c'.repeat(43));
    if (change === 'signout') await client.signOut({ revoke: false });
    if (change === 'reset') client.clearCatalogCache();
    if (change === 'abort') controller.abort();
    if (change === 'login') await client.login('fixture-key');
    finish(); await assert.rejects(pending, error => error.name === 'AbortError'); assert.equal(client.sourceCache.size, 0, stage + '/' + change);
  }
});

test('already-aborted metadata and source requests cannot return a cached response', async () => {
  let calls = 0;
  const client = new TVClient({ storage: null, fetchFn: async url => { calls++; return json(url.includes('/meta?') ? { meta: { ...movie } } : url.includes('/lookup?') ? { complete: true, sources: [] } : { sources: [readySource()], cacheAvailability: 'known' }); } });
  await client.metadata(movie); await client.sources(movie);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(client.metadata(movie, controller.signal), error => error.name === 'AbortError');
  await assert.rejects(client.sources(movie, controller.signal), error => error.name === 'AbortError'); assert.equal(calls, 3);
});

test('candidate progress forwards exact file selection, attempts and quality order while remaining cached-only', async () => {
  const calls = [], statuses = [];
  const client = new TVClient({ storage: null, fetchFn: async (url, options) => {
    const body = JSON.parse(options.body || '{}'); calls.push({ url, body });
    if (url.includes('/status?')) return json({ state: 'browser_unsupported' });
    if (body.source === 'preferred') return json({ state: 'choose_file', files: [{ id: 'torrents:1:0', title: 'TMNT.S01E01.mp4' }] });
    return json({ state: 'ready', file: { id: 'torrents:2:0', title: 'TMNT.S01E01.mp4' } });
  } });
  const result = await client.cachedFile([{ ...readySource('fallback'), resolution: '480p', score: 900 }, { ...readySource('preferred'), resolution: '1080p', score: 1 }, { ...readySource('not-ready'), cached: false, resolution: '1080p' }], episode, { quality: '1080p', onStatus: status => statuses.push(status) });
  assert.equal(result.source.id, 'fallback');
  assert.deepEqual(statuses.map(status => status.stage), ['candidate', 'file-selection', 'candidate-failed', 'candidate']);
  assert(statuses.slice(0, 3).every(status => status.source.id === 'preferred' && status.attempt === 1 && status.total === 2));
  assert.equal(statuses.at(-1).attempt, 2); assert.equal(statuses.at(-1).total, 2);
  assert(calls.filter(call => call.url.endsWith('/prepare')).every(call => call.body.onlyCached === true));
  assert.equal(new URL(calls[1].url).searchParams.get('file'), 'torrents:1:0');
});

test('preparing status forwards backend progress and cancellation stops before another poll', async () => {
  let calls = 0; const statuses = [], controller = new AbortController();
  const client = new TVClient({ storage: null, fetchFn: async () => { calls++; return json({ state: 'preparing', progress: 37 }); } });
  await assert.rejects(client.cachedFile([readySource()], movie, { signal: controller.signal, onStatus: status => { statuses.push(status); if (status.stage === 'preparing') controller.abort(); } }), error => error.name === 'AbortError');
  assert.deepEqual(statuses.map(status => status.stage), ['candidate', 'preparing']); assert.equal(statuses[1].progress, 37); assert.equal(statuses[1].attempt, 1); assert.equal(statuses[1].total, 1); assert.equal(calls, 1);
});

test('all-failed cached selection returns failed identities without mutating initial exclusions', async () => {
  const excluded = new Set(['old-copy']), statuses = [], calls = [];
  const client = new TVClient({ storage: null, fetchFn: async (url, options) => { const body = JSON.parse(options.body); calls.push(body); return json({ error: 'TORRENT_IDENTITY_MISMATCH', message: 'Wrong title' }, 409); } });
  const available = [{ ...readySource('high'), resolution: '1080p', score: 900 }, { ...readySource('low'), hash: 'low-hash', resolution: '480p', score: 1 }, { ...readySource('uncached'), cached: false }];
  await assert.rejects(client.cachedFile(available, movie, { excluded, onStatus: status => statuses.push(status) }), error => {
    assert.equal(error.code, 'NO_READY_COPY'); assert.deepEqual(error.failedSources, new Set(['old-copy', 'low-hash', 'high'])); return true;
  });
  assert.deepEqual(excluded, new Set(['old-copy']));
  assert.deepEqual(calls.map(call => call.source), ['low', 'high'], 'Omitted quality uses the480p preference');
  assert(calls.every(call => call.onlyCached === true));
  assert(statuses.filter(status => status.stage === 'candidate-failed').every(status => status.errorCode === 'TORRENT_IDENTITY_MISMATCH'));
});

test('playback and ready requests always obtain fresh responses instead of caching media tickets', async () => {
  const calls = []; let ticket = 0;
  const client = new TVClient({ storage: null, fetchFn: async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/playback')) return json({ mediaUrl: 'https://cdn.tb-cdn.cx/video.mp4?ticket=' + ++ticket });
    return json({ state: 'ready', file: { id: 'torrents:1:0', title: 'Jumanji.mp4' } });
  } });
  await client.ready(readySource(), movie); await client.ready(readySource(), movie);
  const first = await client.playback({ id: 'torrents:1:0' }), second = await client.playback({ id: 'torrents:1:0' });
  assert.notEqual(first.mediaUrl, second.mediaUrl); assert.equal(calls.length, 4);
  assert.equal(client.metadataCache.size, 0); assert.equal(client.sourceCache.size, 0);
  assert(calls.every(call => call.options.cache === 'no-store'));
});

test('authentication and rate-limit errors stop cached fallback immediately', async () => {
  for (const code of ['LOGIN_REQUIRED', 'BAD_API_KEY', 'SLOW_DOWN', 'TORBOX_RATE_LIMITED', 'TORBOX_ACCESS_DENIED']) {
    let calls = 0; const statuses = [];
    const client = new TVClient({ storage: null, fetchFn: async () => { calls++; return json({ error: code, message: code }, 429); } });
    await assert.rejects(client.cachedFile([readySource('first'), readySource('second'), readySource('third')], movie, { onStatus: status => statuses.push(status) }), error => error.code === code);
    assert.equal(calls, 1, code + ' cannot trigger more preparation requests');
    assert.deepEqual(statuses.map(status => status.stage), ['candidate'], 'Fatal service errors are not reported as failed video copies');
  }
});

test('all-failed preparation is capped at eight candidates and reports only attempted failures', async () => {
  const attempted = [], statuses = [];
  const client = new TVClient({ storage: null, fetchFn: async (_url, options) => { attempted.push(JSON.parse(options.body).source); return json({ state: 'browser_unsupported' }); } });
  const available = Array.from({ length: 12 }, (_, index) => ({ ...readySource('copy-' + index), score: 12 - index }));
  await assert.rejects(client.cachedFile(available, movie, { onStatus: status => statuses.push(status) }), error => {
    assert.equal(error.code, 'NO_READY_COPY'); assert.deepEqual(error.failedSources, new Set(available.slice(0, 8).map(source => source.id))); return true;
  });
  assert.deepEqual(attempted, available.slice(0, 8).map(source => source.id));
  assert(statuses.every(status => status.total === 8));
  assert.equal(statuses.filter(status => status.stage === 'candidate').length, 8);
});

test('late ready and playback responses are rejected after a token swap, sign out or cancellation', async () => {
  for (const operation of ['ready', 'playback']) for (const change of ['token', 'signout', 'reset', 'abort', 'login']) {
    let finish; const controller = new AbortController();
    const client = new TVClient({ storage: null, fetchFn: url => {
      if (url.endsWith('/prepare') || url.endsWith('/playback')) return new Promise(resolve => {
        finish = () => resolve(json(operation === 'ready' ? { state: 'ready', file: { id: 'torrents:1:0', title: 'Jumanji.mp4' } } : { mediaUrl: 'https://cdn.tb-cdn.cx/video.mp4?ticket=old-session' }));
      });
      return Promise.resolve(json({ sessionToken: 'b'.repeat(43) }));
    } });
    client.setToken(token);
    const pending = operation === 'ready' ? client.ready(readySource(), movie, { signal: controller.signal }) : client.playback({ id: 'torrents:1:0' }, controller.signal);
    if (change === 'token') client.setToken('c'.repeat(43));
    if (change === 'signout') await client.signOut({ revoke: false });
    if (change === 'reset') client.clearCatalogCache();
    if (change === 'abort') controller.abort();
    if (change === 'login') await client.login('fixture-key');
    finish(); await assert.rejects(pending, error => error.name === 'AbortError', operation + '/' + change);
  }
});

test('a session swap during cached preparation cannot retry another candidate using the new login', async () => {
  let finish; const attempted = [], statuses = [];
  const client = new TVClient({ storage: null, fetchFn: (_url, options) => {
    attempted.push(JSON.parse(options.body).source);
    return new Promise(resolve => { finish = () => resolve(json({ state: 'browser_unsupported' })); });
  } });
  client.setToken(token);
  const pending = client.cachedFile([readySource('old-first'), readySource('new-second')], movie, { onStatus: status => statuses.push(status) });
  client.setToken('c'.repeat(43)); finish();
  await assert.rejects(pending, error => error.name === 'AbortError');
  assert.deepEqual(attempted, ['old-first']); assert.deepEqual(statuses.map(status => status.stage), ['candidate']);
});
