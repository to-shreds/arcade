import { createGame, previewMove, applyAction, validateGame, validatePublicGame, chooseCpuAction } from './engine.js';
import { isWord, DICTIONARY_ID, DICTIONARY_INFO } from './dictionary.js';

const $ = id => document.getElementById(id);
const mp = window.ArcadeMultiplayer, save = window.ArcadeSave;
const ROOT = `${mp?.workerOrigin || 'https://arcade-chess.jonathanjablon.workers.dev'}/api/arcade/rooms`;
const CODE = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/;
const NAME = /^[\p{L}\p{N}][\p{L}\p{N} _.'-]{0,23}$/u;
const clone = value => JSON.parse(JSON.stringify(value));
const read = key => { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; } };
const write = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; } };
const node = (tag, text = '', className = '') => { const el = document.createElement(tag); el.textContent = text; if (className) el.className = className; return el; };
let localGame = null, playMode = 'cpu', difficulty = 'normal';
let placements = [], selected = null, rackOrder = [], handoffPending = false, localDraftBackup = null;
let session = null, room = null, busy = false, joining = false, suspended = false, generation = 0;
let socket = null, reconnectTimer = null, pollTimer = null, retries = 0, refreshing = false;
let cpuWorker = null, cpuTimer = null, cpuThinking = false, cpuEpoch = 0, modalKind = '', renderedBoardKey = '';
const preferences = { sound: read('arcade.upwords.sound.v1') !== false };
let soundContext = null;

function currentGame() { return session ? room?.state?.game || null : localGame; }
function ownSeat() { return session ? room?.members.find(member => member.playerId === session.playerId)?.seat ?? -1 : localGame?.turn ?? 0; }
function rackSeat() { return session ? ownSeat() : playMode === 'cpu' ? 0 : localGame?.turn ?? 0; }
function visibleRack() { return currentGame()?.players[rackSeat()]?.rack || []; }
function bagCount(game = currentGame()) { return game?.bag?.length ?? game?.bagCount ?? 0; }
function roomKey(transport) { return `arcade.upwords.room.${transport}.v1`; }
function transport() { return mp?.getStatus()?.effectiveTransport || 'cloudflare'; }
function savedRoom() {
  const data = read(roomKey(transport()));
  return data && CODE.test(data.code) && typeof data.token === 'string' && data.token.length >= 16 && typeof data.playerId === 'string' && data.transport === transport() ? data : null;
}
function persistRoom() { if (session && !write(roomKey(session.transport), session)) message('Browser storage is unavailable. Keep this page open to preserve your room seat.'); }
function message(text = '', setup = false) {
  const target = $(setup ? 'setupMessage' : room?.status === 'lobby' ? 'lobbyMessage' : 'message');
  target.textContent = text; if (target.id === 'message') target.hidden = !text;
}
function ownTurn() {
  const game = currentGame();
  return !!game && !game.finished && !suspended && (session ? room?.status === 'active' && room.turn?.playerId === session.playerId : playMode === 'hotseat' || game.turn === 0);
}
function canAct() { return ownTurn() && !busy && !joining && !handoffPending && $('setup').hidden; }
function randomSeed() { const values = new Uint32Array(1); try { crypto.getRandomValues(values); } catch { values[0] = Date.now() >>> 0; } return values[0] || 1; }
function validName(value, fallback) { return String(value || fallback).trim().replace(/\s+/g, ' ').slice(0, 24) || fallback; }
function clearDraft() { placements = []; selected = null; rackOrder = []; }
function ensureOrder() {
  const length = visibleRack().length;
  if (rackOrder.length !== length || new Set(rackOrder).size !== length || rackOrder.some(index => !Number.isInteger(index) || index < 0 || index >= length)) rackOrder = Array.from({ length }, (_, index) => index);
}
function cleanDraft(data, game) {
  const seenCells = new Set(), seenTiles = new Set(), rack = game.players[game.turn].rack;
  if (!Array.isArray(data) || data.length > 7 || game.finished) return [];
  return data.filter(item => {
    if (!item || ![item.row, item.col, item.rackIndex].every(Number.isInteger) || item.row < 0 || item.row > 9 || item.col < 0 || item.col > 9 || item.rackIndex < 0 || item.rackIndex >= rack.length) return false;
    const cell = `${item.row}:${item.col}`;
    if (seenCells.has(cell) || seenTiles.has(item.rackIndex)) return false;
    seenCells.add(cell); seenTiles.add(item.rackIndex); return true;
  }).map(({ row, col, rackIndex }) => ({ row, col, rackIndex }));
}
function capture() {
  if (!localGame) return undefined;
  const draft = session ? localDraftBackup || {} : { placements, rackOrder, selected, handoffPending };
  return { schema: 1, mode: playMode, difficulty, game: clone(localGame), placements: clone(draft.placements || []), rackOrder: [...(draft.rackOrder || [])], selected: draft.selected ?? null, handoffPending: !!draft.handoffPending };
}
function restore(data) {
  if (!data || data.schema !== 1 || !['cpu', 'hotseat'].includes(data.mode)) throw new Error('Invalid saved game.');
  if (session) throw new Error('Leave the multiplayer room before loading a local game.');
  const restored = validateGame(data.game);
  cancelCpu(); localGame = restored; playMode = data.mode; difficulty = ['easy', 'normal', 'hard'].includes(data.difficulty) ? data.difficulty : 'normal';
  placements = cleanDraft(data.placements, localGame); rackOrder = Array.isArray(data.rackOrder) ? data.rackOrder.slice(0, 7) : []; selected = Number.isInteger(data.selected) ? data.selected : null;
  handoffPending = playMode === 'hotseat' && !localGame.finished;
  $('setup').hidden = true; render(); scheduleCpu(); return true;
}
function showSetup() {
  cancelCpu(); closeModal(); $('setup').hidden = false; $('handoff').hidden = true; $('result').hidden = true; message(''); updateSetup();
}
async function startLocal() {
  if (session || joining || busy) return;
  cancelCpu(); playMode = $('mode').value === 'hotseat' ? 'hotseat' : 'cpu'; difficulty = $('difficulty').value;
  localGame = createGame({ seed: randomSeed(), names: [validName($('nameInput0').value, 'Player 1'), validName($('nameInput1').value, playMode === 'cpu' ? 'Computer' : 'Player 2')], starter: 0 });
  clearDraft(); handoffPending = false; $('setup').hidden = true; save?.setExternalSession(false); message(''); render(); await save?.saveNow();
}
function showCurrentLocal() {
  if (!localGame || session || joining || busy) return;
  $('setup').hidden = true; save?.setExternalSession(false); handoffPending = playMode === 'hotseat' && !localGame.finished; render(); scheduleCpu();
}
function cancelCpu() { clearTimeout(cpuTimer); cpuTimer = null; cpuWorker?.terminate(); cpuWorker = null; cpuThinking = false; cpuEpoch++; }
function scheduleCpu() {
  if (cpuThinking || cpuTimer || session || playMode !== 'cpu' || !localGame || localGame.finished || localGame.turn !== 1 || busy || suspended || document.hidden || !$('setup').hidden) return;
  const epoch = ++cpuEpoch;
  cpuTimer = setTimeout(() => {
    cpuTimer = null;
    if (epoch !== cpuEpoch || session || suspended || document.hidden || !$('setup').hidden || !localGame || localGame.turn !== 1 || localGame.finished) return;
    cpuThinking = true; render();
    const acceptCpu = action => { if (epoch !== cpuEpoch || session || suspended) return; cpuWorker?.terminate(); cpuWorker = null; cpuThinking = false; localAction(action, true); };
    const failure = error => { if (epoch !== cpuEpoch) return; cpuWorker?.terminate(); cpuWorker = null; cpuThinking = false; message(`The computer could not finish its move: ${error?.message || error}. Use Retry computer below.`); render(); };
    try {
      if (typeof Worker !== 'function') { acceptCpu(chooseCpuAction(localGame, difficulty)); return; }
      cpuWorker = new Worker(new URL('./cpu-worker.js', import.meta.url), { type: 'module' });
      cpuWorker.onmessage = event => { if (event.data?.id !== epoch) return; if (event.data.error) failure(event.data.error); else acceptCpu(event.data.action); };
      cpuWorker.onerror = event => { event.preventDefault(); failure(event.message || 'The word search could not load.'); };
      cpuWorker.postMessage({ id: epoch, game: clone(localGame), difficulty });
    } catch (error) { failure(error); }
  }, 450);
}
function sound() {
  if (!preferences.sound) return;
  try {
    const Audio = window.AudioContext || window.webkitAudioContext; if (!Audio) return;
    soundContext ||= new Audio(); soundContext.resume().catch(() => {});
    const now = soundContext.currentTime;
    [523.25, 659.25].forEach((frequency, index) => { const osc = soundContext.createOscillator(), gain = soundContext.createGain(), start = now + index * .07; osc.type = 'sine'; osc.frequency.value = frequency; gain.gain.setValueAtTime(.035, start); gain.gain.exponentialRampToValueAtTime(.0001, start + .16); osc.connect(gain); gain.connect(soundContext.destination); osc.start(start); osc.stop(start + .18); });
  } catch {}
}
async function localAction(intent, cpu = false) {
  if (busy || session || !localGame || localGame.finished || (!cpu && !canAct()) || (cpu && (playMode !== 'cpu' || localGame.turn !== 1))) return false;
  busy = true; message('');
  try {
    localGame = applyAction(localGame, intent, localGame.turn); clearDraft();
    handoffPending = playMode === 'hotseat' && !localGame.finished;
    // Persist the resolved turn before revealing the next rack or running the computer.
    await save?.saveNow(); if (intent.type === 'play') sound(); return true;
  } catch (error) { message(error.message); return false; }
  finally { busy = false; render(); scheduleCpu(); }
}

async function request(path, body, credentials = session) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(ROOT + path, { method: body === undefined ? 'GET' : 'POST', headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(credentials ? { authorization: `Bearer ${credentials.token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: controller.signal, cache: 'no-store' });
    let data; try { data = await response.json(); } catch { throw new Error('The room returned an unreadable response. Reconnect to check your turn.'); }
    if (!response.ok || data.ok === false) throw Object.assign(new Error(data.error || 'The room request failed.'), { status: response.status });
    return data;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('Connection timed out. Your seat is saved. Reconnect to check whether your turn was accepted.');
    if (error instanceof TypeError) throw new Error('Cannot reach the room. Check your connection, then try again.');
    throw error;
  } finally { clearTimeout(timer); }
}
function networkName() {
  const name = validName(mp?.preferredUsername($('nickname').value) || $('nickname').value, 'Player 1');
  if (!NAME.test(name)) throw new Error('Use 1-24 letters or numbers, with spaces, apostrophes, periods, underscores or hyphens.');
  return name;
}
async function enter(kind) {
  if (session || joining || busy) return;
  const entryEpoch = generation;
  joining = true; message('', true); updateButtons();
  try {
    if (!mp) throw new Error('The Arcade connection is missing. Open this game from Arcade.');
    await mp.ready();
    if (entryEpoch !== generation || suspended) return;
    const chosenTransport = transport(), saved = kind === 'resume' ? savedRoom() : null;
    if (kind === 'resume' && !saved) throw new Error('There is no saved room for this connection.');
    const name = saved?.username || networkName(), code = saved?.code || $('joinCode').value.trim().toUpperCase();
    if (kind !== 'create' && !CODE.test(code)) throw new Error('Enter the six-character room code.');
    mp.pinRoomTransport(chosenTransport);
    const result = kind === 'create' ? await request('', { game: 'upwords', username: name, maxPlayers: 2 }, null) : await request(`/${code}/join`, saved ? { reconnectToken: saved.token } : { username: name }, null);
    const cancelEntry = async () => {
      if (entryEpoch === generation && !suspended) return false;
      // A fresh seat created while Home/pause was in flight must not take over
      // the local screen. Its original transport stays pinned through cleanup.
      if (!saved && result.token) {
        try { await request(`/${result.code}/actions`, { type: 'leave' }, { token: result.token }); mp?.resetRoomTransport(); } catch {}
      }
      return true;
    };
    if (await cancelEntry()) return;
    if (result.room?.game !== 'upwords') {
      if (!saved && result.token) await request(`/${result.code}/actions`, { type: 'leave' }, { token: result.token }).catch(() => {});
      throw new Error('That code belongs to another game. Use an Upwords room code.');
    }
    if (result.room.state?.dictionaryId !== DICTIONARY_ID) {
      if (!saved && result.token) await request(`/${result.code}/actions`, { type: 'leave' }, { token: result.token }).catch(() => {});
      throw new Error('This room uses a different word-list version. Update Arcade, then reconnect.');
    }
    await save?.saveNow();
    if (await cancelEntry()) return;
    localDraftBackup = { placements: clone(placements), selected, rackOrder: [...rackOrder], handoffPending };
    generation++; cancelCpu(); clearDraft(); handoffPending = false;
    session = { code: result.code, token: result.token, playerId: result.playerId, username: result.room.members.find(member => member.playerId === result.playerId)?.username || name, transport: chosenTransport };
    room = null; suspended = false; save?.setExternalSession(true); $('setup').hidden = true; $('handoff').hidden = true;
    accept(result.room); persistRoom(); connectSocket(); startPolling();
  } catch (error) { if (entryEpoch === generation && !suspended) message(error.message, !session); if (!session && kind !== 'resume') mp?.resetRoomTransport(); }
  finally { joining = false; updateTransport(); render(); }
}
function accept(snapshot) {
  if (!session || !snapshot || snapshot.game !== 'upwords' || snapshot.code !== session.code || snapshot.playerId !== session.playerId || !snapshot.state) return false;
  if (room && (snapshot.version < room.version || (snapshot.version === room.version && snapshot.revision < room.revision))) return false;
  if (snapshot.state.dictionaryId !== DICTIONARY_ID) { message('This room uses a different word list. Update Arcade before playing.'); return false; }
  const seat = snapshot.members.find(member => member.playerId === session.playerId)?.seat;
  if (snapshot.state.game) {
    try { snapshot = { ...snapshot, state: { ...snapshot.state, game: validatePublicGame(snapshot.state.game, seat) } }; }
    catch { message('The room sent an invalid game. Your saved room seat has been retained.'); return false; }
  }
  const previous = room, before = room?.state.game;
  room = snapshot;
  const after = currentGame();
  if (before && (before.moveNumber !== after?.moveNumber || previous.state.round !== room.state.round)) {
    clearDraft(); if (modalKind === 'exchange' || modalKind === 'pass') closeModal();
    if (after?.lastMove?.type === 'play' && !document.hidden) sound();
  }
  if (room.status === 'finished' && (modalKind === 'exchange' || modalKind === 'pass')) closeModal();
  if (!after || after.finished || after.turn !== seat) clearDraft();
  mp?.observeRoom(room, 'upwords'); persistRoom(); render(); return true;
}
async function refresh(force = false) {
  if (!session || suspended || (refreshing && !force)) return;
  const credentials = session, epoch = generation; refreshing = true;
  try { const result = await request(`/${credentials.code}/state`, undefined, credentials); if (epoch === generation) accept(result.room); }
  catch (error) { if (epoch === generation && [401, 404, 410].includes(error.status)) message('This saved room is no longer available. Use Leave to return to your local game.'); }
  finally { if (epoch === generation) refreshing = false; }
}
function startPolling() { clearInterval(pollTimer); pollTimer = setInterval(() => { if (!document.hidden) refresh(); }, 4000); }
function connectSocket() {
  if (!session || suspended || socket?.readyState === 0 || socket?.readyState === 1) return;
  clearTimeout(reconnectTimer); const epoch = generation;
  try {
    const ws = new WebSocket(ROOT.replace(/^http/, 'ws') + `/${session.code}/ws?token=${encodeURIComponent(session.token)}`); socket = ws;
    ws.onopen = () => { if (epoch !== generation || socket !== ws) return ws.close(); retries = 0; renderConnection(); refresh(); };
    ws.onmessage = event => { if (epoch !== generation || socket !== ws) return; try { const data = JSON.parse(event.data); if (data.type === 'state') accept(data.room); else if (data.type === 'error') { message(data.error || 'The room rejected that action.'); refresh(); } } catch {} };
    ws.onerror = () => { if (socket === ws) try { ws.close(); } catch {} };
    ws.onclose = () => { if (epoch !== generation || socket !== ws) return; socket = null; renderConnection(); reconnectTimer = setTimeout(connectSocket, Math.min(12000, 600 * 2 ** Math.min(retries++, 5))); };
  } catch { socket = null; reconnectTimer = setTimeout(connectSocket, 3000); }
  renderConnection();
}
function stopNetwork() {
  clearTimeout(reconnectTimer); clearInterval(pollTimer); reconnectTimer = pollTimer = null;
  const old = socket; socket = null;
  if (old) { old.onclose = old.onopen = old.onmessage = old.onerror = null; try { old.close(); } catch {} }
}
async function action(type, fields = {}) {
  if (busy || !session || !room) return false;
  busy = true; message(''); updateButtons(); const epoch = generation;
  try {
    const result = await request(`/${session.code}/actions`, { type, ...fields, dictionaryId: DICTIONARY_ID, expectedVersion: room.version });
    if (epoch !== generation) return false;
    const reply = result.room;
    // A socket can deliver the opponent's next turn before this HTTP reply.
    // An older, correctly addressed acknowledgment confirms our action without
    // replacing the newer board or reporting an action failure.
    const olderAcknowledgment = reply?.game === 'upwords' && reply.code === session.code && reply.playerId === session.playerId && reply.state?.dictionaryId === DICTIONARY_ID && Number.isInteger(reply.version) && Number.isInteger(reply.revision) && (reply.version < room.version || reply.version === room.version && reply.revision < room.revision);
    if (!olderAcknowledgment && !accept(reply)) throw new Error('The room response could not be verified. Reconnect to check your move.');
    return true;
  } catch (error) {
    if (epoch !== generation) return false;
    await refresh(true); message(error.status === 409 ? `${error.message}. The board is refreshed; check your tiles before trying again.` : error.message); return false;
  } finally { if (epoch === generation) { busy = false; render(); } }
}
async function leaveRoom() {
  if (!session || busy) return;
  busy = true; updateButtons();
  try {
    try { await request(`/${session.code}/actions`, { type: 'leave' }); } catch (error) { if (![401, 404, 410].includes(error.status)) throw error; }
    try { localStorage.removeItem(roomKey(session.transport)); } catch {}
    generation++; stopNetwork(); mp?.forgetRoomAlert?.('upwords', session.code); session = room = null; refreshing = false;
    clearDraft(); if (localDraftBackup) { placements = localDraftBackup.placements; rackOrder = localDraftBackup.rackOrder; selected = localDraftBackup.selected; handoffPending = localDraftBackup.handoffPending; } localDraftBackup = null;
    save?.setExternalSession(false); mp?.resetRoomTransport(); $('lobby').hidden = true; closeModal();
    if (localGame) { $('setup').hidden = true; handoffPending = playMode === 'hotseat' && !localGame.finished; } else showSetup();
  } catch (error) { message(error.message); }
  finally { busy = false; render(); scheduleCpu(); }
}
function confirmLeave() { modal('Leave this room?', [node('p', 'Leaving ends this match and removes your saved seat. Use Arcade home if you want to return to this room later.')], [{ label: 'Stay', run: closeModal }, { label: 'Leave room', style: 'danger', run: leaveRoom }], 'leave'); }
async function copyCode() {
  if (!session) return;
  try { await navigator.clipboard.writeText(session.code); message('Room code copied. Share it with the other player.'); }
  catch { modal('Share this room', [node('p', `Room code: ${session.code}`)]); }
}
function renderConnection() {
  $('roomBar').hidden = !session;
  if (!session) return;
  $('connection').textContent = `${session.transport === 'nearby' ? 'Nearby' : 'Internet'} · ${socket?.readyState === 1 ? 'Live' : 'Reconnecting'}`;
  $('roomCode').textContent = session.code; $('lobbyCode').textContent = session.code;
  $('invite').hidden = $('lobbyInvite').hidden = session.transport !== 'nearby';
}
function updateTransport() {
  $('setupTransport').textContent = `Multiplayer · ${transport() === 'nearby' ? 'Nearby Arcade' : 'Internet'}`;
  const identity = mp?.getIdentity?.(); $('nickname').readOnly = !!identity; if (identity) $('nickname').value = identity.nickname;
  const saved = savedRoom(); $('resumeRoom').hidden = !saved; $('resumeRoom').textContent = saved ? `Resume room ${saved.code}` : 'Resume saved room';
  if (!identity && !$('nickname').value && saved?.username) $('nickname').value = saved.username;
  renderConnection();
}
function updateSetup() {
  const network = $('mode').value === 'network', cpu = $('mode').value === 'cpu';
  $('networkControls').hidden = !network; $('localStart').hidden = network; $('localNames').hidden = network; $('difficultyField').hidden = !cpu;
  $('continueLocal').hidden = !localGame || network; $('secondNameLabel').textContent = cpu ? 'Computer' : 'Second player';
  if (cpu && $('nameInput1').value === 'Player 2') $('nameInput1').value = 'Computer';
  if (!cpu && $('nameInput1').value === 'Computer') $('nameInput1').value = 'Player 2';
  updateTransport(); updateButtons();
}
function placeAt(row, col) {
  if (!canAct()) return;
  const pending = placements.findIndex(item => item.row === row && item.col === col);
  if (pending >= 0) { selected = placements[pending].rackIndex; placements.splice(pending, 1); }
  else {
    const rack = visibleRack(), stack = currentGame().board[row][col];
    if (!Number.isInteger(selected) || !rack[selected] || placements.some(item => item.rackIndex === selected)) { message('Choose a tile from your rack first.'); return; }
    if (stack.length >= 5) { message('This stack is already five tiles high.'); return; }
    if (stack.at(-1) === rack[selected]) { message('Choose a different letter. You cannot cover a letter with the same letter.'); return; }
    placements.push({ row, col, rackIndex: selected }); selected = null;
  }
  message(''); save?.touch(); render();
}
function selectTile(index) {
  if (!canAct()) return;
  const pending = placements.findIndex(item => item.rackIndex === index);
  if (pending >= 0) placements.splice(pending, 1);
  selected = selected === index && pending < 0 ? null : index; message(''); save?.touch(); render();
}
function renderBoard(game) {
  const board = game?.board || Array.from({ length: 10 }, () => Array.from({ length: 10 }, () => []));
  const visiblePlacements = handoffPending ? [] : placements;
  const rack = visibleRack(), active = canAct();
  const key = JSON.stringify([board, visiblePlacements, rack, active, game?.lastMove]);
  if (key === renderedBoardKey) return;
  renderedBoardKey = key;
  const focused = document.activeElement?.dataset.row !== undefined ? { row: document.activeElement.dataset.row, col: document.activeElement.dataset.col } : null;
  const cells = [];
  for (let row = 0; row < 10; row++) for (let col = 0; col < 10; col++) {
    const stack = board[row][col], pending = visiblePlacements.find(item => item.row === row && item.col === col), tile = pending ? rack[pending.rackIndex] : stack.at(-1), height = stack.length + (pending ? 1 : 0);
    const cell = node('button', '', 'cell'); cell.type = 'button'; cell.setAttribute('role', 'gridcell'); cell.dataset.row = row; cell.dataset.col = col; cell.dataset.height = height;
    cell.classList.toggle('center', [4, 5].includes(row) && [4, 5].includes(col)); cell.classList.toggle('occupied', !!tile); cell.classList.toggle('placed', !!pending);
    cell.classList.toggle('last-play', !pending && !!game?.lastMove?.placements?.some(item => item.row === row && item.col === col));
    cell.disabled = !active; cell.setAttribute('aria-label', `${String.fromCharCode(65 + col)}${row + 1}, ${tile ? `${tile === 'QU' ? 'Qu' : tile}, height ${height}${pending ? ', unplayed tile' : ''}` : 'empty'}${[4, 5].includes(row) && [4, 5].includes(col) ? ', center square' : ''}`);
    if (tile) { cell.append(node('span', tile === 'QU' ? 'Qu' : tile, `tile-letter${tile === 'QU' ? ' qu' : ''}`)); cell.append(node('span', String(height), 'height')); }
    cell.onclick = () => placeAt(row, col);
    cell.onkeydown = event => {
      const moves = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] };
      if (moves[event.key]) { event.preventDefault(); const [dr, dc] = moves[event.key]; $ ('board').querySelector(`[data-row="${Math.max(0, Math.min(9, row + dr))}"][data-col="${Math.max(0, Math.min(9, col + dc))}"]`)?.focus(); }
      else if (event.key === 'Backspace' || event.key === 'Delete') { event.preventDefault(); const existing = placements.find(item => item.row === row && item.col === col); if (existing) placeAt(row, col); }
      else if (/^[a-z]$/i.test(event.key) && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault(); const letter = event.key.toUpperCase() === 'Q' ? 'QU' : event.key.toUpperCase();
        const index = visibleRack().findIndex((value, i) => value === letter && !placements.some(item => item.rackIndex === i));
        if (index >= 0) { selected = index; placeAt(row, col); }
      }
    };
    cells.push(cell);
  }
  $('board').replaceChildren(...cells);
  if (focused) $('board').querySelector(`[data-row="${focused.row}"][data-col="${focused.col}"]`)?.focus({ preventScroll: true });
}
function renderRack(game) {
  ensureOrder(); const rack = visibleRack(), hidden = handoffPending, active = canAct();
  const focused = document.activeElement?.dataset.rackIndex;
  $('rack').replaceChildren(...rackOrder.map(index => {
    const tile = rack[index], button = node('button', hidden ? '•' : tile === 'QU' ? 'Qu' : tile, `rack-tile${!hidden && tile === 'QU' ? ' qu' : ''}`);
    button.type = 'button'; button.dataset.rackIndex = index; button.disabled = !active;
    button.classList.toggle('selected', selected === index && !hidden); button.classList.toggle('used', placements.some(item => item.rackIndex === index) && !hidden);
    button.setAttribute('aria-label', hidden ? `Hidden rack tile ${index + 1}` : `Rack tile ${index + 1}: ${tile}${placements.some(item => item.rackIndex === index) ? ', placed on board' : ''}`);
    button.setAttribute('aria-pressed', String(selected === index && !hidden)); button.onclick = () => selectTile(index); return button;
  }));
  if (focused !== undefined) $('rack').querySelector(`[data-rack-index="${focused}"]`)?.focus({ preventScroll: true });
  $('rackTitle').textContent = hidden ? 'Tiles hidden' : game ? `${game.players[rackSeat()]?.name || 'Your'} tiles` : 'Your tiles';
  $('rackHint').textContent = hidden ? 'Pass the device, then show your tiles.' : !ownTurn() && game && !game.finished ? 'Your tiles stay here while the other player thinks.' : selected !== null && rack[selected] ? `${rack[selected] === 'QU' ? 'Qu' : rack[selected]} selected. Tap an empty square or stack it on a different letter.` : 'Tap a letter, then tap a square. Tap it again to take it back.';
}
function renderPreview(game) {
  const visiblePlacements = handoffPending ? [] : placements;
  const preview = game && visiblePlacements.length ? previewMove(game, visiblePlacements, game.turn) : null;
  $('movePreview').classList.toggle('invalid', !!preview && !preview.valid);
  $('previewScore').replaceChildren(document.createTextNode(String(preview?.valid ? preview.score : 0) + ' '), node('small', 'pts'));
  const words = preview?.words || [];
  if (words.length) $('previewWords').replaceChildren(...words.map(word => { const line = node('div', '', `word-score${isWord(word.word) ? '' : ' invalid'}`); line.append(node('strong', word.word), node('span', isWord(word.word) ? `${word.score} pts` : 'Not listed')); return line; }));
  else $('previewWords').textContent = visiblePlacements.length ? `${visiblePlacements.length} tile${visiblePlacements.length === 1 ? '' : 's'} placed.` : 'Place your tiles to see every word and its score.';
  $('previewNote').textContent = preview ? preview.valid ? `${preview.bonus ? `Includes a ${preview.bonus}-point seven-tile bonus. ` : ''}All words accepted. Ready to play.` : preview.error : 'Flat words: 2 points per tile. Stacked words: count every tile in the stacks.';
  $('play').disabled = !canAct() || !preview?.valid;
  $('play').textContent = busy ? 'Saving turn…' : preview?.valid ? `Play for ${preview.score} points` : 'Play word';
}
function render() {
  const game = currentGame(); renderConnection();
  $('lobby').hidden = !session || room?.status !== 'lobby';
  if (session && room?.status === 'lobby') {
    const members = room.members.filter(member => !member.leftAt).sort((a, b) => a.seat - b.seat);
    $('lobbyMembers').replaceChildren(...[0, 1].map(seat => { const member = members.find(item => item.seat === seat), el = node('div', member?.username || 'Waiting for player…', 'lobby-member'); if (member) el.append(node('small', member.playerId === session.playerId ? 'You' : 'Ready')); return el; }));
    $('lobbyDictionary').textContent = `${DICTIONARY_INFO.name} · ${DICTIONARY_INFO.wordCount.toLocaleString()} words · same list for both players`;
    $('lobbyNote').textContent = members.length < 2 ? 'Waiting for the second player.' : room.hostPlayerId === session.playerId ? 'Both players are here. You can start.' : 'Waiting for the host to start.';
  }
  if (game) {
    game.players.forEach((player, index) => { $('name' + index).textContent = player.name; $('points' + index).textContent = player.score; $('tiles' + index).textContent = `${player.rack?.length ?? player.rackCount} tiles`; $('score' + index).classList.toggle('active', !game.finished && game.turn === index); });
    $('bagCount').textContent = bagCount(game); $('turnNumber').textContent = `Turn ${game.moveNumber + 1}`;
    $('turnText').textContent = game.finished ? game.winner === null ? 'A tie! Well played.' : `${game.players[game.winner].name} wins!` : busy ? 'Saving your turn…' : !session && playMode === 'cpu' && game.turn === 1 ? `${game.players[1].name} is thinking…` : session && !ownTurn() ? `${game.players[game.turn].name}'s turn` : `${game.players[game.turn].name}, build your word.`;
    $('boardHint').textContent = game.board.every(row => row.every(stack => stack.length === 0)) ? 'Start across any of the four marked center squares.' : 'Small numbers show stack height. Gold tiles are your unplayed move.';
  }
  renderBoard(game); renderRack(game); renderPreview(game);
  $('handoff').hidden = !handoffPending || !$('setup').hidden || !!session || game?.finished;
  if (handoffPending && game) $('handoffTitle').textContent = `Pass to ${game.players[game.turn].name}`;
  const finished = game?.finished || session && room?.status === 'finished';
  $('result').hidden = !finished || !$('setup').hidden;
  if (finished) {
    const abandoned = session && room?.result?.type === 'abandoned';
    $('resultTitle').textContent = abandoned ? 'This room has ended' : game?.winner === null ? 'A tie!' : `${game?.players[game.winner]?.name || 'Player'} wins!`;
    $('resultText').textContent = abandoned ? 'A player left the room. Leave to return to local play or create a new room.' : `${game?.endReason === 'passes' ? 'Both players passed.' : 'The last tile has been played.'} Final scores include a 5-point deduction for each tile left in a rack.`;
    $('playAgain').hidden = !!abandoned;
    const voted = !!session && room?.state.rematchVotes?.includes(session.playerId);
    $('playAgain').disabled = busy || voted;
    $('rematchNote').textContent = voted ? 'Waiting for the other player to agree to a rematch.' : session && room?.state.rematchVotes?.length ? 'The other player wants a rematch.' : '';
  }
  const history = game?.history || [];
  $('history').replaceChildren(...(history.length ? [...history].reverse().map(item => node('li', `${game.players[item.seat]?.name || 'Player'}: ${item.type === 'play' ? `${item.words.map(word => word.word).join(' + ')} · ${item.score} points` : item.type === 'exchange' ? 'swapped one tile' : 'passed'}`)) : [node('li', 'Your first word starts the story.')]));
  updateButtons();
}
function updateButtons() {
  const active = canAct();
  for (const id of ['undo', 'clear']) $(id).disabled = !active || !placements.length;
  $('shuffle').disabled = !active || visibleRack().length < 2;
  $('exchange').disabled = !active || bagCount() === 0;
  const retryCpu = !session && playMode === 'cpu' && localGame?.turn === 1 && !localGame.finished && !cpuThinking && !cpuTimer && !busy;
  $('pass').textContent = retryCpu ? 'Retry CPU' : 'Pass'; $('pass').disabled = retryCpu ? suspended || !$('setup').hidden : !active;
  $('create').disabled = $('join').disabled = $('resumeRoom').disabled = joining || busy;
  $('localStart').disabled = joining || busy;
  $('continueLocal').disabled = joining || busy;
  $('startRoom').disabled = busy || !room || room.hostPlayerId !== session?.playerId || room.members.filter(member => !member.leftAt).length !== 2;
  $('leave').disabled = $('lobbyLeave').disabled = busy;
}
async function play() {
  if (!canAct()) return;
  const preview = previewMove(currentGame(), placements, currentGame().turn);
  if (!preview.valid) { message(preview.error); return; }
  const move = clone(placements);
  if (session) await action('play', { placements: move }); else await localAction({ type: 'play', placements: move });
}
function takeBack() { if (!canAct() || !placements.length) return; selected = placements.pop().rackIndex; save?.touch(); message(''); render(); }
function clearPlaced() { if (!canAct()) return; clearDraft(); save?.touch(); message(''); render(); }
function shuffle() {
  if (!canAct()) return; ensureOrder();
  for (let index = rackOrder.length - 1; index > 0; index--) { const other = Math.floor(Math.random() * (index + 1)); [rackOrder[index], rackOrder[other]] = [rackOrder[other], rackOrder[index]]; }
  save?.touch(); renderRack(currentGame());
}
function exchange() {
  if (!canAct() || !bagCount()) return;
  let chosen = selected;
  const tiles = node('div', '', 'exchange-tiles');
  const buttons = visibleRack().map((tile, index) => {
    const button = node('button', tile === 'QU' ? 'Qu' : tile, 'rack-tile'); button.type = 'button'; button.dataset.exchangeIndex = index; button.classList.toggle('selected', index === chosen); button.setAttribute('aria-label', `Swap tile ${index + 1}: ${tile}`);
    button.onclick = () => { chosen = index; buttons.forEach((entry, i) => entry.classList.toggle('selected', i === chosen)); $('confirmExchange').disabled = false; }; return button;
  });
  tiles.append(...buttons);
  modal('Swap one tile', [node('p', 'Choose one tile to exchange. Swapping uses your turn. Any unplayed tiles return to your rack.'), tiles], [{ label: 'Cancel', run: closeModal }, { label: 'Swap and end turn', style: 'gold', id: 'confirmExchange', run: async () => { if (chosen === null) return; closeModal(); if (session) await action('exchange', { rackIndex: chosen }); else await localAction({ type: 'exchange', rackIndex: chosen }); } }], 'exchange');
  $('confirmExchange').disabled = chosen === null;
}
function pass() {
  if (!session && playMode === 'cpu' && localGame?.turn === 1) { message(''); scheduleCpu(); return; }
  if (!canAct()) return;
  modal('Pass your turn?', [node('p', `${currentGame().passes ? 'The other player also passed. Passing now ends the game, with 5 points deducted for each unused tile.' : 'Keep your tiles and let the other player take a turn. If both players pass consecutively, the game ends.'}${placements.length ? ' Your unplayed tiles will return to your rack.' : ''}`)], [{ label: 'Keep playing', run: closeModal }, { label: 'Pass', style: 'gold', id: 'confirmPass', run: async () => { closeModal(); if (session) await action('pass'); else await localAction({ type: 'pass' }); } }], 'pass');
}
function modal(title, contents, actions = [], kind = '') {
  modalKind = kind; $('modalTitle').textContent = title; $('modalBody').replaceChildren(...contents); $('modalActions').replaceChildren(...actions.map(item => { const button = node('button', item.label, `arcade-btn ${item.style || ''}`); button.type = 'button'; if (item.id) button.id = item.id; button.onclick = item.run; return button; }));
  if (!$('modal').open) $('modal').showModal();
}
function closeModal() { if ($('modal').open) $('modal').close(); modalKind = ''; }
function rules() {
  const list = node('ul');
  for (const text of [
    'Build words across or down on the 10 × 10 board. Start with at least two tiles across any of the four center squares. Later moves must connect to the board.',
    'Tap a rack tile, then a square. You may stack on a different letter, up to five tiles high. Place at most one tile on a square per turn and keep all new tiles in a single row or column.',
    'Every word you create or change must be in Arcade English, including crossing words. You must leave at least one letter of every existing word uncovered.',
    'A flat word scores 2 points per tile. If any letter is stacked, count every tile in every stack in that word. Each word scores separately. A Qu tile adds 2 extra points in a flat word; playing all seven tiles adds 20 points.',
    'You cannot simply add S to pluralize an existing word, unless the S also makes a crossing word. You can otherwise extend or change words with valid plays.',
    'Swap 1 exchanges one tile and uses your turn. Pass keeps your tiles. The game ends when both players pass consecutively, or a player empties their rack with an empty bag. Each unused rack tile costs 5 points.',
    'Your local game and unplayed move save automatically. Two players sharing one device pass it behind a privacy screen. Internet and Nearby rooms keep the other player’s rack private. Home keeps your room seat; Leave ends your room.'
  ]) list.append(node('li', text));
  const dictionary = node('p', `${DICTIONARY_INFO.name} has ${DICTIONARY_INFO.wordCount.toLocaleString()} words from the English Speller Database, using American English. It includes listed plurals and other inflections. Entries marked as abbreviations, names or fragments, and entries with spaces or punctuation, are filtered out. This is Arcade’s fixed word list, not an official tournament lexicon.`);
  const alerts = mp?.getTurnAlertSettings?.();
  modal('How to play', [list, node('h3', 'The word list'), dictionary, node('p', 'Check a word below your rack at any time. No Internet lookup is needed. Both players use the same fixed list; a mismatched version asks you to update Arcade.'), node('p', 'Keyboard: choose a board square, use arrow keys to move, and type a rack letter to place it. Q selects Qu. Backspace returns an unplayed tile.')], [
    { label: 'Got it', style: 'gold', run: closeModal },
    { label: preferences.sound ? 'Mute tile sounds' : 'Enable tile sounds', run: () => { preferences.sound = !preferences.sound; write('arcade.upwords.sound.v1', preferences.sound); rules(); } },
    { label: alerts?.soundEnabled ? 'Mute turn ding' : 'Enable turn ding', run: () => { mp?.setTurnSoundEnabled(!alerts?.soundEnabled); rules(); } },
    { label: 'Desktop notifications', run: async () => { await mp?.requestTurnNotifications(); closeModal(); } }
  ], 'rules');
}
function confirmNew() {
  if (session) { message('Finish this game for a rematch, or Leave to start a different game.'); return; }
  if (!localGame || localGame.finished) { showSetup(); return; }
  modal('Start a new game?', [node('p', 'Your current local game is kept until you start a new one. Starting replaces that saved game.')], [{ label: 'Keep playing', run: closeModal }, { label: 'Game setup', style: 'gold', run: showSetup }], 'new');
}
async function home() {
  if (joining) generation++;
  persistRoom(); cancelCpu(); suspended = true; stopNetwork(); closeModal(); await save?.saveNow();
  if (window.ArcadeSave && typeof window.ArcadeSave.goHome === 'function') return window.ArcadeSave.goHome();
  if (window.ArcadeMultiplayer && typeof window.ArcadeMultiplayer.goHome === 'function') return window.ArcadeMultiplayer.goHome();
  window.location.href = '../index.html';
}
function pause() { if (joining) generation++; persistRoom(); save?.saveNow(); suspended = true; stopNetwork(); cancelCpu(); closeModal(); }
function resume() { suspended = false; if (session) { connectSocket(); startPolling(); refresh(); } render(); scheduleCpu(); }

$('localStart').onclick = startLocal; $('continueLocal').onclick = showCurrentLocal; $('mode').onchange = updateSetup;
$('play').onclick = play; $('undo').onclick = takeBack; $('clear').onclick = clearPlaced; $('shuffle').onclick = shuffle; $('exchange').onclick = exchange; $('pass').onclick = pass;
$('showRack').onclick = () => { handoffPending = false; save?.touch(); render(); };
$('create').onclick = () => enter('create'); $('join').onclick = () => enter('join'); $('resumeRoom').onclick = () => enter('resume');
$('joinCode').oninput = () => { $('joinCode').value = $('joinCode').value.toUpperCase().replace(/[^A-Z0-9]/g, ''); };
$('joinCode').onkeydown = event => { if (event.key === 'Enter') enter('join'); };
$('startRoom').onclick = () => action('start'); $('roomCode').onclick = $('lobbyCode').onclick = copyCode;
$('invite').onclick = $('lobbyInvite').onclick = () => { if (session) { mp?.invite('upwords', session.code, 'Upwords'); message('Invitation sent to Nearby Arcade.'); } };
$('leave').onclick = $('lobbyLeave').onclick = confirmLeave;
$('newGame').onclick = confirmNew; $('help').onclick = $('setupHelp').onclick = rules; $('modalClose').onclick = closeModal;
$('modal').addEventListener('close', () => { modalKind = ''; });
$('playAgain').onclick = () => { if (session) action('rematch'); else showSetup(); };
for (const id of ['home', 'setupHome', 'lobbyHome', 'handoffHome']) $(id).onclick = home;
$('zoom').onclick = () => { const enlarged = $('boardViewport').classList.toggle('zoomed'); $('zoom').setAttribute('aria-pressed', String(enlarged)); $('zoom').textContent = enlarged ? '− Fit board' : '＋ Zoom'; if (enlarged) { $('boardViewport').scrollLeft = ($('boardViewport').scrollWidth - $('boardViewport').clientWidth) / 2; } };
$('wordForm').onsubmit = event => {
  event.preventDefault(); const word = $('wordCheck').value.trim();
  if (!word) { $('wordResult').textContent = 'Enter a word to check.'; return; }
  const accepted = isWord(word); $('wordResult').textContent = `${word.toUpperCase()} ${accepted ? 'is in Arcade English.' : 'is not in Arcade English.'}`; $('wordResult').style.color = accepted ? 'var(--arcade-green)' : '#ffc5a1';
};
$('dictionaryNote').textContent = `${DICTIONARY_INFO.wordCount.toLocaleString()} listed words · American English · ${DICTIONARY_ID}. Listed forms only; no guessed endings.`;
window.addEventListener('pagehide', pause); window.addEventListener('pageshow', resume); window.addEventListener('arcadepause', pause); window.addEventListener('arcaderesume', resume);
document.addEventListener('visibilitychange', () => { if (document.hidden) { save?.saveNow(); cancelCpu(); } else if (!suspended) { if (session) refresh(); render(); scheduleCpu(); } });

Object.defineProperty(window, 'UpwordsGame', { value: Object.freeze({
  getState: () => currentGame() ? clone(currentGame()) : null,
  capture,
  getDebug: () => ({ mode: session ? 'network' : playMode, busy, cpuThinking, placements: clone(placements), selected, handoffPending, session: session ? { code: session.code, playerId: session.playerId, transport: session.transport } : null, room: room ? clone(room) : null })
}), writable: false });
const query = new URLSearchParams(location.search), code = (query.get('room') || query.get('join') || query.get('code') || '').toUpperCase().slice(0, 6);
$('joinCode').value = code; if (code || query.get('online') === '1') { $('mode').value = 'network'; save?.setExternalSession(true); }
updateSetup(); render();
mp?.onStatus(updateTransport); if (mp) mp.ready().then(updateTransport).catch(() => message('The Arcade connection is not ready. Local play is available.', true));
if (save) save.register({ id: 'upwords', title: 'Upwords', version: 1, capture, restore, meaningful: () => !!localGame || save.hasSave(), summary: () => localGame ? `${localGame.players[0].name} ${localGame.players[0].score} · ${localGame.players[1].name} ${localGame.players[1].score}. Turn ${localGame.moveNumber + 1}.` : '', startFresh: showSetup });
