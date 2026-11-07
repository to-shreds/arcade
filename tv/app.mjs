import { PRESET_TITLES } from './catalog.mjs';
import { Actions, DEFAULT_QUALITY, QUALITY_OPTIONS, TVClient, nextEpisode, normalizeQuality, releasedEpisodes, sourceOrder, sourceResolution, targetOf } from './core.mjs';
import { forgetApiKey, loadRememberedApiKey, rememberApiKey } from './vault.mjs';

const $ = id => document.getElementById(id);
const client = new TVClient();
const detailsActions = new Actions(), connectActions = new Actions(), playActions = new Actions();
const prefetchActions = new Actions(), QUALITY_KEY = 'arcade-tv.quality.v1';
const ALLOWED_ORIGIN = 'https://to-shreds.github.io';
const nearby = new URL(location.href).searchParams.get('_arcadeTransport') === 'nearby';
const hosted = location.origin === ALLOWED_ORIGIN;
const allowed = hosted && !nearby;
let connected = false, connectionPending = false, title = null, meta = null, kind = 'series';
let active = null, pendingPlay = null, preparation = null, destroyed = false, startupTimer = null, stalledTimer = null;
let nextTransition = false;
let quality = DEFAULT_QUALITY, prefetchTimer = null, sourcePrefetch = null;
const rejectedCopies = new Map();
try { quality = normalizeQuality(localStorage.getItem(QUALITY_KEY)); } catch {}

function targetKey(target) { return [target.type, target.id, target.season ?? '', target.episode ?? ''].join(':'); }
function exclusionsFor(target) {
  const key = targetKey(target);
  if (!rejectedCopies.has(key)) {
    if (rejectedCopies.size >= 12) rejectedCopies.delete(rejectedCopies.keys().next().value);
    rejectedCopies.set(key, new Set());
  }
  return rejectedCopies.get(key);
}
function rejectCopy(action, source, errorCode) {
  if (!source) return;
  const key = source.hash || source.id;
  action.excluded.add(key);
  if (['TORRENT_IDENTITY_MISMATCH', 'BROWSER_UNSUPPORTED', 'BROWSER_CONTAINER_UNSUPPORTED', 'BROWSER_AUDIO_UNSUPPORTED', 'BROWSER_VIDEO_UNSUPPORTED', 'UNSUPPORTED_MEDIA'].includes(errorCode)) {
    const copies = exclusionsFor(action.target);
    if (!copies.has(key) && copies.size >= 64) copies.delete(copies.values().next().value);
    copies.add(key);
  }
}
function cancelPrefetch() { clearTimeout(prefetchTimer); prefetchTimer = null; prefetchActions.cancel(); sourcePrefetch = null; }
function schedulePrefetch() {
  cancelPrefetch();
  if (!allowed || !connected || !title || !meta || destroyed || !$('player').hidden) return;
  let target;
  try { target = targetOf(title, selectedEpisode()); } catch { return; }
  const action = prefetchActions.begin();
  prefetchTimer = setTimeout(() => {
    prefetchTimer = null;
    if (!action.current()) return;
    const entry = { key: targetKey(target), notify: null, lastStatus: null, promise: null };
    sourcePrefetch = entry;
    entry.promise = client.sources(target, action.signal, { onStatus: value => {
      entry.lastStatus = value; if (action.current()) entry.notify?.(value);
    } });
    entry.promise.catch(() => {}).finally(() => { if (sourcePrefetch === entry) sourcePrefetch = null; });
  }, 300);
}
async function sourcesFor(target, action, onStatus, refresh = false) {
  clearTimeout(prefetchTimer); prefetchTimer = null;
  const entry = sourcePrefetch;
  if (!refresh && entry?.key === targetKey(target)) {
    entry.notify = onStatus;
    if (entry.lastStatus) onStatus(entry.lastStatus);
    try { const result = await entry.promise; action.check(); return result; }
    catch (error) { action.check(); if (error.name !== 'AbortError') throw error; }
    finally { entry.notify = null; }
  } else cancelPrefetch();
  return client.sources(target, action.signal, { onStatus, refresh });
}
function qualityText(value) { return value === 'auto' ? 'Auto' : value; }
function updateQuality() {
  $('quality-settings').textContent = 'Quality: ' + qualityText(quality);
  $('player-quality').textContent = qualityText(quality);
  const preference = active?.quality || quality;
  const actualHeight = active && $('video').videoHeight;
  const actual = actualHeight ? `${actualHeight}p` : active ? sourceResolution(active.source) || sourceResolution(active.result?.file) : null;
  const preferred = preference === 'auto' ? 'Automatic quality' : preference + ' preferred';
  const detail = actual ? `${preferred} · ${actualHeight ? 'Playing' : 'Copy'} ${actual}${preference !== 'auto' && actual !== preference ? ' (available copy)' : ''}` : preferred;
  $('playing-quality').textContent = detail;
  $('quality-current').textContent = active ? detail : '';
  $('quality-current').hidden = !active;
}
function showQuality() {
  $('quality').value = quality;
  updateQuality();
  (!$('player').hidden ? $('player') : document.body).append($('quality-dialog'));
  $('quality-dialog').showModal();
}
function progressFor(action, prefix = '') {
  return value => {
    if (!action.current() || $('player').hidden) return;
    const count = value.attempt && value.total ? ` ${value.attempt} of ${value.total}` : '';
    let message = 'Checking ready copies…', step = 2;
    if (value.stage === 'lookup') { message = 'Finding copies of this title…'; step = 1; }
    else if (value.stage === 'cache-check') message = value.cached ? 'Using recently checked copies…' : 'Checking which copies are ready…';
    else if (value.stage === 'candidate') message = `Checking ready copy${count}…`;
    else if (value.stage === 'candidate-failed') {
      if (action.target) rejectCopy(action, value.source, value.errorCode);
      message = 'That copy was unavailable or could not be verified. Checking another…';
    }
    else if (value.stage === 'file-selection') message = `Checking the matching video${count}…`;
    else if (value.stage === 'preparing') {
      const progress = Number(value.progress);
      message = `Preparing this title${count}${value.progress != null && Number.isFinite(progress) ? `… ${Math.round(Math.max(0, Math.min(1, progress)) * 100)}%` : '…'}`;
    }
    playerMessage(prefix + message, { busy: true, step });
  };
}

function status(id, message, error = false) {
  $(id).textContent = message; $(id).classList.toggle('error', error);
}
function note() {
  if (nearby) $('connection-note').textContent = 'TV needs internet. Disconnect Nearby in the Arcade first.';
  else if (!hosted) {
    const link = document.createElement('a'); link.href = 'https://to-shreds.github.io/arcade/?game=tv'; link.target = '_blank'; link.rel = 'noopener'; link.className = 'online-link'; link.textContent = 'Open TV in the online Arcade';
    $('connection-note').replaceChildren(document.createTextNode('TV needs the online Arcade. '), link);
  } else $('connection-note').textContent = connected ? 'TorBox connected on this device.' : connectionPending ? 'Connecting to TorBox…' : 'Connect your TorBox account to watch.';
  $('connect').textContent = !allowed ? 'Settings' : connected ? 'Connected' : 'Connect';
  $('api-key').disabled = !allowed; $('remember').disabled = !allowed; $('login').disabled = !allowed || connectionPending;
  updatePlay();
}
function updatePlay() {
  const ready = !!title && (!connected || (!!meta && (title.type === 'movie' || !!selectedEpisode())));
  $('play').disabled = !allowed || !ready || connectionPending;
  $('play').textContent = connected ? '▶ Play' : 'Connect to watch';
}
function renderTitles() {
  const items = PRESET_TITLES.filter(item => item.type === kind).sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }) || a.year - b.year);
  const fragment = document.createDocumentFragment();
  for (const item of items) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'title-choice'; button.dataset.title = item.id;
    button.setAttribute('aria-pressed', String(title?.id === item.id));
    const text = document.createElement('span'), name = document.createElement('b'), year = document.createElement('small');
    name.textContent = item.name; year.textContent = String(item.year); text.append(name, year); button.append(text);
    button.addEventListener('click', () => chooseTitle(item)); fragment.append(button);
  }
  $('titles').replaceChildren(fragment);
  $('shows-tab').classList.toggle('gold', kind === 'series'); $('movies-tab').classList.toggle('gold', kind === 'movie');
  $('shows-tab').setAttribute('aria-selected', String(kind === 'series')); $('movies-tab').setAttribute('aria-selected', String(kind === 'movie'));
  $('titles').setAttribute('aria-labelledby', kind === 'series' ? 'shows-tab' : 'movies-tab');
}
function clearEpisodeFields() {
  $('season').replaceChildren(); $('episode').replaceChildren(); $('episode-fields').hidden = true;
}
function selectedEpisode() {
  if (title?.type !== 'series' || !meta) return null;
  return releasedEpisodes(meta).find(item => item.season === Number($('season').value) && item.episode === Number($('episode').value)) || null;
}
function episodesForSeason(preferred) {
  const episodes = releasedEpisodes(meta).filter(item => item.season === Number($('season').value));
  $('episode').replaceChildren(...episodes.map(item => new Option(`${item.episode}. ${item.name || 'Episode ' + item.episode}`, String(item.episode))));
  if (episodes.some(item => item.episode === preferred)) $('episode').value = String(preferred);
  updatePlay();
  schedulePrefetch();
}
function renderEpisodes(preferred) {
  clearEpisodeFields();
  if (title?.type !== 'series') return;
  const episodes = releasedEpisodes(meta), seasons = [...new Set(episodes.map(item => item.season))];
  $('episode-fields').hidden = false;
  $('season').replaceChildren(...seasons.map(season => new Option(season === 0 ? 'Specials' : 'Season ' + season, String(season))));
  const normal = seasons.find(season => season > 0);
  if (seasons.includes(preferred?.season)) $('season').value = String(preferred.season);
  else if (normal) $('season').value = String(normal);
  episodesForSeason(preferred?.episode);
}
async function chooseTitle(item, preferred) {
  cancelPrefetch();
  const action = detailsActions.begin();
  title = item; meta = null; preparation = null;
  $('tv-layout').classList.add('selected'); $('selected-title').textContent = item.name; $('selected-year').textContent = String(item.year);
  clearEpisodeFields(); renderTitles(); updatePlay();
  if (!allowed) { status('detail-status', nearby ? 'Disconnect Nearby to watch TV.' : 'Open TV in the online Arcade to watch.'); return; }
  if (!connected) { status('detail-status', 'Connect your TorBox account to watch this title.'); $('play').disabled = false; return; }
  status('detail-status', item.type === 'series' ? 'Loading seasons and episodes…' : 'Loading this movie…');
  try {
    const result = await client.metadata(item, action.signal); action.check();
    meta = result; renderEpisodes(preferred); updatePlay();
    if (item.type === 'movie') schedulePrefetch();
    status('detail-status', item.type === 'series' && !selectedEpisode() ? 'No released episodes are available in the catalog right now.' : '');
  } catch (error) {
    if (!action.current()) return;
    status('detail-status', error.message, true); handleExpired(error);
  }
}
function setConnected(value) { connected = value; if (!value) { cancelPrefetch(); rejectedCopies.clear(); } note(); }
function handleExpired(error) {
  if (!['LOGIN_REQUIRED', 'BAD_API_KEY'].includes(error?.code)) return;
  client.setToken(''); setConnected(false); status('connection-status', 'Your TV connection expired. Connect again.', true);
}
function showConnection() {
  $('api-key').value = ''; $('connection-dialog').showModal();
  if (!connected && allowed) $('api-key').focus();
  if (!allowed) status('connection-status', nearby ? 'Disconnect Nearby to watch TV. You can forget this browser’s saved key here.' : 'Open the online Arcade to watch TV.');
}
async function connectKey(key, remember, action) {
  connectionPending = true; note(); $('login').disabled = true;
  status('connection-status', 'Connecting… The service may take a moment to wake up.');
  try {
    await client.login(key, { signal: action.signal }); action.check();
    rejectedCopies.clear();
    let storageMessage = '';
    try {
      if (remember) await rememberApiKey(key); else await forgetApiKey();
    } catch { storageMessage = 'Connected for this visit. This browser could not save the key securely.'; }
    action.check(); setConnected(true); status('connection-status', storageMessage || 'Connected.');
    $('connection-dialog').close();
    if (title) await chooseTitle(title);
  } catch (error) {
    if (!action.current()) return;
    setConnected(false); status('connection-status', error.message, true);
    if (!$('connection-dialog').open) $('connection-dialog').showModal();
  } finally {
    key = '';
    if (action.current()) { connectionPending = false; $('login').disabled = false; note(); }
  }
}
async function restoreConnection() {
  if (!allowed) return;
  const action = connectActions.begin(); connectionPending = true; note();
  try {
    if (client.token) {
      const session = await client.request('/api/session', { signal: action.signal }); action.check();
      if (session.authenticated && session.authMode === 'api-key') { setConnected(true); return; }
      client.setToken('');
    }
    let key = await loadRememberedApiKey(); action.check();
    if (key) { await client.login(key, { signal: action.signal }); key = ''; action.check(); setConnected(true); }
  } catch (error) {
    if (!action.current()) return;
    setConnected(false); status('connection-status', 'The remembered connection could not be restored. Connect to retry.', true);
  } finally { if (action.current()) { connectionPending = false; note(); if (connected && title && !meta) chooseTitle(title); } }
}
async function disconnect() {
  const action = connectActions.begin(); detailsActions.cancel();
  closePlayer(); connectionPending = false; setConnected(false); $('api-key').value = ''; $('login').disabled = false;
  meta = null; clearEpisodeFields(); updatePlay();
  if (title) { status('detail-status', 'Connect your TorBox account to watch this title.'); $('play').disabled = !allowed; }
  try {
    await Promise.all([client.signOut({ revoke: allowed }), forgetApiKey()]);
    if (action.current()) status('connection-status', 'Disconnected. The remembered key was removed.');
  } catch {
    if (action.current()) status('connection-status', 'Disconnected. This browser could not clear remembered data. Clear this site’s data to remove it.', true);
  }
}
function playerMessage(message, { retry = false, tap = false, prepare = false, next = false, busy = false, step = 0 } = {}) {
  $('player-message').hidden = false; $('player-status').textContent = message;
  $('player-retry').hidden = !retry; $('tap-play').hidden = !tap; $('prepare').hidden = !prepare; $('next').hidden = !next;
  $('player-spinner').hidden = !busy; $('player-steps').hidden = !busy;
  $('player-message').setAttribute('aria-busy', String(busy));
  for (const element of $('player-steps').children) {
    element.classList.toggle('active', Number(element.dataset.step) === step);
    element.classList.toggle('done', Number(element.dataset.step) < step);
    if (Number(element.dataset.step) === step) element.setAttribute('aria-current', 'step'); else element.removeAttribute('aria-current');
  }
}
function resetPlaybackTimers() { clearTimeout(startupTimer); clearTimeout(stalledTimer); startupTimer = null; stalledTimer = null; }
function stopMedia() {
  resetPlaybackTimers(); active = null; nextTransition = false;
  $('video').pause(); $('video').removeAttribute('src'); $('video').load();
  $('buffering-status').hidden = true;
  updateQuality();
}
function showPlayer(target) {
  $('player').hidden = false; document.querySelector('main').inert = true;
  const episode = meta?.episodes?.find(item => item.season === target.season && item.episode === target.episode);
  $('playing-title').textContent = title.name + (target.type === 'series' ? ` · S${target.season} E${target.episode}${episode?.name ? ' · ' + episode.name : ''}` : '');
  playerMessage('Finding a ready copy…', { busy: true, step: 1 });
}
function enterFullscreen() {
  // Called synchronously by the user's Play/Fullscreen gesture, before any
  // network await. The full-window player remains usable if the OS refuses.
  if (document.fullscreenElement === $('player')) return;
  try { $('player').requestFullscreen?.().catch(() => {}); } catch {}
}
function closePlayer() {
  playActions.cancel(); cancelPrefetch(); pendingPlay = null; preparation = null;
  if ($('quality-dialog').open) $('quality-dialog').close();
  stopMedia(); $('player').hidden = true;
  document.querySelector('main').inert = false; $('play').focus();
  if (document.fullscreenElement === $('player')) document.exitFullscreen?.().catch(() => {});
}
async function attachPlayback({ source, result }, target, sources, action, tried, resumePosition = 0) {
  playerMessage('Getting the playback link…', { busy: true, step: 3 });
  const stream = await client.playback(result.file, action.signal); action.check();
  resetPlaybackTimers();
  active = { source, result, target, sources, tried: tried || new Set([source.hash || source.id]), meta: action.playMeta, title: action.playTitle, quality: action.quality, action, resumePosition };
  preparation = null; pendingPlay = { target, sources };
  $('video').src = stream.mediaUrl; $('video').load(); updateQuality();
  playerMessage('Loading video…', { busy: true, step: 4 });
  startupTimer = setTimeout(() => { if (active?.action === action && !$('video').currentTime) recoverMedia('This copy did not start.'); }, 20000);
  try { await $('video').play(); }
  catch (error) {
    if (!action.current()) return;
    if (error?.name === 'NotAllowedError') { resetPlaybackTimers(); playerMessage('The browser needs a tap to start playback.', { tap: true }); }
    else if (error?.name !== 'AbortError') await recoverMedia('This browser could not play that copy.');
  }
}
async function playTarget(target, { userGesture = false, preparedSource = null, sources = null, resumePosition = 0, excluded = [], refresh = false } = {}) {
  if (!connected) { showConnection(); return; }
  const action = playActions.begin(); stopMedia(); preparation = null; pendingPlay = { target, sources };
  action.quality = quality; action.playTitle = title; action.playMeta = meta; action.target = target;
  action.excluded = new Set([...exclusionsFor(target), ...excluded]); pendingPlay.excluded = action.excluded;
  showPlayer(target); if (userGesture) enterFullscreen();
  try {
    const onStatus = progressFor(action);
    let registered = sources ? { sources } : await sourcesFor(target, action, onStatus, refresh); action.check();
    pendingPlay.sources = registered.sources || [];
    let ready;
    if (preparedSource) {
      playerMessage('Preparing this title in TorBox…', { busy: true, step: 2 });
      try { ready = { source: preparedSource, result: await client.ready(preparedSource, target, { signal: action.signal, allowUncached: true, onStatus }) }; }
      catch (error) {
        action.check();
        if (['LOGIN_REQUIRED', 'BAD_API_KEY', 'SLOW_DOWN', 'TORBOX_RATE_LIMITED', 'TORBOX_ACCESS_DENIED'].includes(error.code)) throw error;
        rejectCopy(action, preparedSource, error.code);
        playerMessage('This copy could not be verified or opened. Checking another ready copy…', { busy: true, step: 2 });
        const alternateStatus = progressFor(action, /^TORRENT_IDENTITY_/.test(error.code || '') ? 'That copy could not be verified. ' : 'That copy could not be opened. ');
        action.excluded = new Set([...exclusionsFor(target), preparedSource.hash || preparedSource.id]);
        pendingPlay.excluded = action.excluded;
        registered = await client.sources(target, action.signal, { refresh: true, onStatus: alternateStatus }); action.check();
        pendingPlay.sources = registered.sources || [];
        ready = await client.cachedFile(registered.sources, target, { signal: action.signal, excluded: action.excluded, quality: action.quality, onStatus: alternateStatus });
      }
    } else ready = await client.cachedFile(registered.sources, target, { signal: action.signal, excluded: action.excluded, quality: action.quality, onStatus });
    action.check(); await attachPlayback(ready, target, registered.sources, action, undefined, resumePosition);
  } catch (error) {
    if (!action.current()) return;
    handleExpired(error);
    if (error.failedSources instanceof Set) for (const source of error.failedSources) action.excluded.add(source);
    preparation = error.code === 'NO_READY_COPY' ? sourceOrder(pendingPlay?.sources, { cachedOnly: false, quality: action.quality, excluded: action.excluded })[0] || null : null;
    const message = preparation ? 'No ready copy is available. Prepare & play will add a copy to your TorBox account. It may take a few minutes.' : error.code === 'NO_READY_COPY' && action.excluded.size ? 'The available copies could not be verified or played. Try again later or choose another title.' : error.message;
    playerMessage(message, { retry: true, prepare: !!preparation });
  }
}
async function recoverMedia(reason) {
  if (!active || active.recovering || destroyed) return;
  const previous = active; previous.recovering = true; resetPlaybackTimers(); $('video').pause();
  const position = Math.max(0, $('video').currentTime || 0), tried = new Set(previous.tried);
  if (tried.size >= 3) { playerMessage(reason + ' Try again or choose another title.', { retry: true }); return; }
  const action = playActions.begin(); active = null; playerMessage(reason + ' Trying another ready copy…');
  action.quality = previous.quality; action.playTitle = previous.title; action.playMeta = previous.meta; action.target = previous.target;
  action.excluded = new Set([...tried, ...exclusionsFor(previous.target), ...previous.action.excluded]);
  try {
    const next = await client.cachedFile(previous.sources, previous.target, { signal: action.signal, excluded: action.excluded, quality: action.quality, onStatus: progressFor(action, reason + ' ') }); action.check();
    tried.add(next.source.hash || next.source.id);
    await attachPlayback(next, previous.target, previous.sources, action, tried, position);
  } catch (error) {
    if (action.current()) { handleExpired(error); playerMessage('No other ready copy could be played. Try again later.', { retry: true }); }
  }
}
async function continueEpisode(userGesture) {
  const previous = active;
  if (!previous || previous.nextStarted || nextTransition) return;
  const next = nextEpisode(previous.meta, previous.target);
  if (!next) { playerMessage('That was the last available episode. Choose another show.', { retry: false }); return; }
  nextTransition = true; previous.nextStarted = true;
  title = previous.title; meta = previous.meta; renderEpisodes(next);
  await playTarget(targetOf(title, next), { userGesture });
}

$('shows-tab').addEventListener('click', () => { kind = 'series'; renderTitles(); });
$('movies-tab').addEventListener('click', () => { kind = 'movie'; renderTitles(); });
$('list-back').addEventListener('click', () => { cancelPrefetch(); $('tv-layout').classList.remove('selected'); });
$('season').addEventListener('change', () => episodesForSeason());
$('episode').addEventListener('change', () => { updatePlay(); schedulePrefetch(); });
$('quality-settings').addEventListener('click', showQuality);
$('player-quality').addEventListener('click', showQuality);
$('quality-close').addEventListener('click', () => $('quality-dialog').close());
$('quality-apply').addEventListener('click', () => {
  const nextQuality = normalizeQuality($('quality').value), changed = nextQuality !== quality;
  quality = nextQuality;
  try { localStorage.setItem(QUALITY_KEY, quality); } catch {}
  $('quality-dialog').close(); updateQuality();
  if (changed && !$('player').hidden && pendingPlay) {
    const target = pendingPlay.target, resumePosition = Math.max(0, $('video').currentTime || 0);
    playTarget(target, { userGesture: true, resumePosition });
  }
});
$('connect').addEventListener('click', showConnection);
$('connection-close').addEventListener('click', () => { $('api-key').value = ''; $('connection-dialog').close(); });
$('connection-dialog').addEventListener('close', () => { $('api-key').value = ''; });
$('connection-form').addEventListener('submit', event => {
  event.preventDefault(); if (!allowed) return;
  const key = $('api-key').value.trim(), remember = $('remember').checked; $('api-key').value = '';
  if (!key) { status('connection-status', 'Enter your TorBox API key.', true); return; }
  const action = connectActions.begin(); connectKey(key, remember, action);
});
$('disconnect').addEventListener('click', disconnect);
$('play').addEventListener('click', () => {
  if (!connected) { showConnection(); return; }
  if (!meta) { if (title) chooseTitle(title); return; }
  try { playTarget(targetOf(title, selectedEpisode()), { userGesture: true }); } catch (error) { status('detail-status', error.message, true); }
});
$('player-back').addEventListener('click', closePlayer);
$('fullscreen').addEventListener('click', enterFullscreen);
$('player-retry').addEventListener('click', () => {
  if (!connected) { closePlayer(); showConnection(); return; }
  if (pendingPlay) playTarget(pendingPlay.target, { userGesture: true, refresh: true });
});
$('prepare').addEventListener('click', () => {
  if (pendingPlay && preparation) playTarget(pendingPlay.target, { userGesture: true, sources: pendingPlay.sources, preparedSource: preparation, excluded: pendingPlay.excluded });
});
$('next').addEventListener('click', () => continueEpisode(true));
$('tap-play').addEventListener('click', async () => {
  enterFullscreen();
  try { await $('video').play(); }
  catch (error) { if (error?.name === 'NotAllowedError') playerMessage('Tap the video play control to start.', { tap: true }); else recoverMedia('This copy could not play.'); }
});
$('video').addEventListener('loadedmetadata', () => {
  updateQuality();
  if (active?.resumePosition && Number.isFinite($('video').duration)) {
    $('video').currentTime = Math.min(active.resumePosition, Math.max(0, $('video').duration - 1)); delete active.resumePosition;
  }
});
$('video').addEventListener('playing', () => { if (active) { resetPlaybackTimers(); $('player-message').hidden = true; $('buffering-status').hidden = true; updateQuality(); } });
$('video').addEventListener('timeupdate', () => { if ($('video').currentTime > 0) clearTimeout(startupTimer); });
$('video').addEventListener('error', () => { if (active) recoverMedia('This video could not play.'); });
$('video').addEventListener('waiting', () => {
  if (!active || $('video').paused) return;
  $('buffering-status').hidden = false;
  if (stalledTimer) return;
  const current = active;
  stalledTimer = setTimeout(() => { if (active === current && !$('video').paused) recoverMedia('This copy stopped loading.'); }, 20000);
});
$('video').addEventListener('pause', () => { clearTimeout(stalledTimer); stalledTimer = null; $('buffering-status').hidden = true; });
$('video').addEventListener('ended', () => {
  if (!active || active.recovering || !$('video').ended) return;
  resetPlaybackTimers();
  if (active.target.type === 'series' && nextEpisode(active.meta, active.target)) {
    if ($('autoplay').checked) continueEpisode(false);
    else playerMessage('Episode finished.', { next: true });
  } else playerMessage(active.target.type === 'series' ? 'That was the last available episode. Choose another show.' : 'Movie finished. Choose another movie.');
});
document.addEventListener('keydown', event => { if (event.key === 'Escape' && !$('player').hidden && !document.fullscreenElement && !$('quality-dialog').open && !$('connection-dialog').open) closePlayer(); });
function teardown() {
  destroyed = true; cancelPrefetch(); connectActions.cancel(); detailsActions.cancel(); playActions.cancel(); client.revision++;
  $('api-key').value = ''; stopMedia();
}
window.addEventListener('pagehide', teardown);
window.addEventListener('pageshow', event => { if (event.persisted) { destroyed = false; closePlayer(); restoreConnection(); } });
$('quality').replaceChildren(...QUALITY_OPTIONS.map(value => new Option(value === 'auto' ? 'Auto · best available' : value, value)));
updateQuality(); renderTitles(); note(); restoreConnection();
