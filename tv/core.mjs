// Small client for the existing browser-key TorBox control service.
// Credentials and media URLs never enter Arcade saves or multiplayer state.
export const API_ORIGIN = 'https://torbox-web-player-key.onrender.com';
export const SESSION_KEY = 'arcade-tv.session.v1';
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const MEDIA_HOSTS = ['torbox.app', 'tb-cdn.cx', 'tb-cdn.io', 'tb-cdn.pw', 'tb-cdn.sh', 'tb-cdn.st', 'tb-cdn.to', 'tb-cdn.earth'];

export function targetOf(title, episode) {
  if (!title || !['series', 'movie'].includes(title.type) || !/^tt\d{5,12}$/.test(title.id || '')) throw new Error('Choose a title.');
  const target = { type: title.type, id: title.id };
  if (title.type === 'series') {
    if (!Number.isSafeInteger(episode?.season) || episode.season < 0 || !Number.isSafeInteger(episode?.episode) || episode.episode < 1) throw new Error('Choose a season and episode.');
    target.season = episode.season; target.episode = episode.episode;
  }
  return target;
}

export function releasedEpisodes(meta, now = Date.now()) {
  const seen = new Set();
  return (Array.isArray(meta?.episodes) ? meta.episodes : []).filter(e => {
    if (!Number.isSafeInteger(e?.season) || e.season < 0 || !Number.isSafeInteger(e.episode) || e.episode < 1) return false;
    const key = `${e.season}:${e.episode}`;
    if (seen.has(key) || (e.released && (!Number.isFinite(Date.parse(e.released)) || Date.parse(e.released) > now))) return false;
    seen.add(key); return true;
  }).sort((a, b) => a.season - b.season || a.episode - b.episode);
}

export function nextEpisode(meta, current, now = Date.now()) {
  if (current?.type !== 'series') return null;
  // Specials remain selectable, but never interrupt the regular season order.
  const episodes = releasedEpisodes(meta, now).filter(e => current.season === 0 ? e.season === 0 : e.season > 0);
  const index = episodes.findIndex(e => e.season === current.season && e.episode === current.episode);
  return index >= 0 ? episodes[index + 1] || null : null;
}

export function validMediaUrl(input, origin = API_ORIGIN) {
  try {
    const url = new URL(input, origin);
    if (url.origin === origin && !url.username && !url.password && !url.search && !url.hash && /^\/media\/[A-Za-z0-9_-]{43}$/.test(url.pathname)) return url.href;
    if (url.protocol === 'https:' && !url.username && !url.password && (!url.port || url.port === '443') && MEDIA_HOSTS.some(host => url.hostname === host || url.hostname.endsWith('.' + host))) return url.href;
  } catch {}
  throw new Error('The player returned an untrusted video address.');
}

export function containerOf(file = {}) {
  const name = String(file.filename || file.title || '').trim();
  const extension = /\.([a-z0-9]{2,6})$/i.exec(name)?.[1]?.toLowerCase();
  const mime = String(file.mime || '').toLowerCase().split(';')[0];
  return extension || ({ 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/x-m4v': 'm4v', 'video/x-matroska': 'mkv', 'video/x-msvideo': 'avi' })[mime] || String(file.container || '').toLowerCase();
}
const supported = file => ['mp4', 'm4v', 'webm'].includes(containerOf(file));
const unsupported = file => ['avi', 'mkv', 'wmv', 'ts', 'm2ts', 'mts', 'mpg', 'mpeg', 'mov', 'ogv', 'ogg', 'iso', 'dmg'].includes(containerOf(file));
function coded(message, code) { return Object.assign(new Error(message), { code }); }

export function sourceOrder(sources, { cachedOnly = true, excluded = new Set() } = {}) {
  return (Array.isArray(sources) ? sources : []).filter(source => source?.id && !excluded.has(source.hash || source.id) &&
    source.browserUnsupported !== true && source.cachedBrowserPlayable !== false &&
    (cachedOnly ? source.cached === true : source.cached !== true && source.browserContainer === true && source.audioRisk !== true && source.videoRisk !== true))
    .sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0));
}

function matchingFile(files, target) {
  const possible = (Array.isArray(files) ? files : []).filter(file => file?.id && supported(file));
  if (target.type === 'movie') return possible.length === 1 ? possible[0] : null;
  return possible.find(file => {
    const name = String(file.title || '');
    const match = /(?:^|[^a-z0-9])s(\d{1,3})[ ._-]*e(\d{1,4})(?!\d)/i.exec(name) || /(?:^|[^a-z0-9])(\d{1,3})x(\d{1,4})(?!\d)/i.exec(name);
    return match && +match[1] === target.season && +match[2] === target.episode && !/^(?:[ ._-]*e\d|\s*-\s*(?:e)?\d)/i.test(name.slice(match.index + match[0].length));
  }) || null;
}

export class Actions {
  constructor() { this.generation = 0; this.controller = null; }
  cancel() { this.generation++; this.controller?.abort(); this.controller = null; }
  begin() {
    this.cancel(); this.controller = new AbortController();
    const generation = this.generation, signal = this.controller.signal;
    return { signal, current: () => this.generation === generation && !signal.aborted, check: () => { if (this.generation !== generation || signal.aborted) throw new DOMException('Replaced by a newer action.', 'AbortError'); } };
  }
}

export class TVClient {
  constructor({ fetchFn = (...args) => globalThis.fetch(...args), storage, origin = API_ORIGIN } = {}) {
    if (storage === undefined) { try { storage = globalThis.sessionStorage; } catch { storage = null; } }
    this.fetchFn = fetchFn; this.storage = storage; this.origin = origin; this.token = ''; this.revision = 0;
    try { const saved = storage?.getItem(SESSION_KEY); if (TOKEN.test(saved || '')) this.token = saved; } catch {}
  }
  setToken(token) {
    this.token = TOKEN.test(token || '') ? token : '';
    try { if (this.token) this.storage?.setItem(SESSION_KEY, this.token); else this.storage?.removeItem(SESSION_KEY); } catch {}
  }
  async request(path, { method = 'GET', data, signal, timeoutMs = 45000, token = this.token } = {}) {
    if (!path.startsWith('/api/')) throw new Error('Unsupported TV request.');
    const timeout = AbortSignal.timeout(timeoutMs);
    const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let response;
    try {
      response = await this.fetchFn(new URL(path, this.origin).href, {
        method, mode: 'cors', credentials: 'omit', cache: 'no-store', redirect: 'error', signal: requestSignal,
        headers: { Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(data !== undefined ? { 'Content-Type': 'application/json' } : {}) },
        ...(data !== undefined ? { body: JSON.stringify(data) } : {})
      });
    } catch (error) {
      if (signal?.aborted) throw new DOMException('Replaced by a newer action.', 'AbortError');
      throw coded('The TV connection took too long or could not be reached. Try again. The service may be waking up.', 'CONNECTION_UNAVAILABLE');
    }
    let payload;
    try { payload = await response.json(); } catch { throw coded('The TV service returned an unreadable response. Try again.', 'INVALID_RESPONSE'); }
    if (!response.ok) throw coded(typeof payload?.message === 'string' ? payload.message : 'The TV request failed. Try again.', payload?.error || 'REQUEST_FAILED');
    if (signal?.aborted) throw new DOMException('Replaced by a newer action.', 'AbortError');
    return payload;
  }
  async login(apiKey, { signal } = {}) {
    const revision = ++this.revision;
    // An aborted sign-in still needs its returned session revoked. The key is
    // used in this HTTPS body only, never in a URL or browser state snapshot.
    const result = await this.request('/api/login', { method: 'POST', data: { apiKey }, token: '' });
    if (!TOKEN.test(result?.sessionToken || '') || (result.authMode && result.authMode !== 'api-key')) throw coded('The TV service did not return a valid TorBox connection.', 'INVALID_SESSION');
    if (revision !== this.revision || signal?.aborted) {
      this.request('/api/logout', { method: 'POST', data: {}, token: result.sessionToken, timeoutMs: 10000 }).catch(() => {});
      throw new DOMException('Replaced by a newer sign-in.', 'AbortError');
    }
    const oldToken = this.token;
    this.setToken(result.sessionToken);
    if (oldToken && oldToken !== this.token) this.request('/api/logout', { method: 'POST', data: {}, token: oldToken, timeoutMs: 10000 }).catch(() => {});
    return result;
  }
  async signOut({ revoke = true } = {}) {
    this.revision++; const token = this.token; this.setToken('');
    if (token && revoke) await this.request('/api/logout', { method: 'POST', data: {}, token, timeoutMs: 10000 }).catch(() => {});
  }
  async metadata(title, signal) {
    const result = await this.request('/api/discover/meta?' + new URLSearchParams({ type: title.type, id: title.id }), { signal });
    if (result?.meta?.id !== title.id || result.meta.type !== title.type) throw coded('The catalog returned a different title. Playback was stopped.', 'INVALID_METADATA');
    return result.meta;
  }
  async sources(target, signal) {
    const result = await this.request('/api/discover/lookup?' + new URLSearchParams(target), { signal });
    const sources = (Array.isArray(result?.sources) ? result.sources : []).slice(0, 40);
    return this.request('/api/discover/sources', { method: 'POST', data: { target, sources }, signal });
  }
  async ready(source, target, { signal, allowUncached = false, onStatus = () => {} } = {}) {
    let result = await this.request('/api/discover/prepare', { method: 'POST', data: { source: source.id, onlyCached: !allowUncached }, signal, timeoutMs: allowUncached ? 45000 : 5000 });
    const deadline = Date.now() + (allowUncached ? 300000 : 9000);
    let fileSelections = 0;
    while (true) {
      if (signal?.aborted) throw new DOMException('Replaced by a newer action.', 'AbortError');
      if (result?.state === 'ready' && result.file?.id && !unsupported(result.file) && result.compatibility?.browserUnsupported !== true) return result;
      if (result?.state === 'choose_file') {
        if (fileSelections++ > 0) throw coded('This version could not select one matching video. Trying another version.', 'SOURCE_NOT_PLAYABLE');
        const file = matchingFile(result.files, target);
        if (!file) throw coded('This version does not identify one playable matching video. Trying another version.', 'SOURCE_NOT_PLAYABLE');
        result = await this.request('/api/discover/status?' + new URLSearchParams({ source: source.id, file: file.id }), { signal });
        continue;
      }
      if (result?.state !== 'preparing' || Date.now() >= deadline) throw coded(allowUncached ? 'This title is still preparing or unavailable. Try Play again in a little while.' : 'This ready copy could not be opened. Trying another version.', 'SOURCE_NOT_PLAYABLE');
      onStatus(result);
      await delay(2000, signal);
      result = await this.request('/api/discover/status?' + new URLSearchParams({ source: source.id }), { signal, timeoutMs: 15000 });
    }
  }
  async cachedFile(sources, target, { signal, excluded = new Set(), onStatus } = {}) {
    const budget = AbortSignal.timeout(22000);
    for (const source of sourceOrder(sources, { excluded }).slice(0, 8)) {
      const candidate = AbortSignal.timeout(6000), candidateSignal = AbortSignal.any([...(signal ? [signal] : []), budget, candidate]);
      try { return { source, result: await this.ready(source, target, { signal: candidateSignal, onStatus }) }; }
      catch (error) {
        if (signal?.aborted || ['LOGIN_REQUIRED', 'BAD_API_KEY', 'SLOW_DOWN'].includes(error.code)) throw error;
        if (budget.aborted) break;
      }
    }
    throw coded('No ready browser-compatible copy could be opened. Try again later or prepare a copy below.', 'NO_READY_COPY');
  }
  async playback(file, signal) {
    const result = await this.request('/api/playback', { method: 'POST', data: { viewer: 'viewer-1', videoId: file.id, startOver: true }, signal });
    return { ...result, mediaUrl: validMediaUrl(result.mediaUrl, this.origin) };
  }
}

export function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Replaced by a newer action.', 'AbortError'));
    const timer = setTimeout(() => { signal?.removeEventListener('abort', stop); resolve(); }, ms);
    function stop() { clearTimeout(timer); reject(new DOMException('Replaced by a newer action.', 'AbortError')); }
    signal?.addEventListener('abort', stop, { once: true });
  });
}
