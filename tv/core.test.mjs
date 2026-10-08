import test from 'node:test';
import assert from 'node:assert/strict';
import { Actions, API_ORIGIN, SESSION_KEY, TVClient, nextEpisode, releasedEpisodes, sourceOrder, targetOf, validMediaUrl } from './core.mjs';
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
