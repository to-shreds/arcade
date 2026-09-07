import { CHARACTERS, QUESTIONS, characterById, matchesQuestion, questionById, describeCharacter } from '../multiplayer/models/guess-who-data.js';
import { portrait } from './portraits.js';

const $ = id => document.getElementById(id);
const mp = window.ArcadeMultiplayer;
const CODE = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/;
const NAME = /^[\p{L}\p{N}][\p{L}\p{N} _.'-]{0,23}$/u;
const ROOT = `${mp?.workerOrigin || 'https://arcade-chess.jonathanjablon.workers.dev'}/api/arcade/rooms`;
let session = null, room = null, busy = false, joining = false, epoch = 0;
let socket = null, retry = null, poll = null, retries = 0, refreshing = false, suspended = false;
let mode = 'flip', notes = emptyNotes(), historyKey = '', dialogKey = null;
const cards = new Map();

function emptyNotes(round = 0) { return { round, down: [], undo: [], seen: [], autoFlip: false }; }
function text(tag, value, className = '') { const el = document.createElement(tag); el.textContent = value; if (className) el.className = className; return el; }
function image(id) { const el = document.createElement('div'); el.innerHTML = portrait(id); return el; } // Fixed local roster only.
function storeKey(transport) { return `arcade.guessWho.${transport}.v1`; }
function transport() { return mp?.getStatus().effectiveTransport || 'cloudflare'; }
function safeRead(key) { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; } }
function safeWrite(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; } }
function savedSession() {
  const saved = safeRead(storeKey(transport()));
  return saved?.session && CODE.test(saved.session.code) && typeof saved.session.token === 'string' && saved.session.transport === transport() ? saved : null;
}
function sanitizeNotes(value) {
  if (!value || !Number.isInteger(value.round)) return emptyNotes();
  const ids = arr => Array.isArray(arr) ? [...new Set(arr.filter(id => characterById(id)))].slice(0,24) : [];
  return { round: value.round, down: ids(value.down), undo: Array.isArray(value.undo) ? value.undo.slice(-20).map(ids) : [],
    seen: Array.isArray(value.seen) ? value.seen.filter(id => typeof id === 'string').slice(-80) : [], autoFlip: value.autoFlip === true };
}
function save() {
  if (!session) return;
  // Tokens and the private notebook stay in this browser. Never persist a room snapshot or a secret face.
  if (!safeWrite(storeKey(session.transport), { session, notes })) showMessage('Browser storage is unavailable. Keep this page open to preserve your seat.');
}
function showMessage(value = '', setup = false) {
  const el = $(setup || !session ? 'setupMessage' : 'message');
  el.textContent = value; if (el.id === 'message') el.hidden = !value;
}
function player(id) { return room?.members.find(p => p.playerId === id); }
function playerName(id) { return player(id)?.username || 'The other player'; }
function ownTurn() { return room?.status === 'active' && room.state.phase === 'playing' && room.turn?.playerId === session?.playerId; }
function ownClues() { return room?.state.history.filter(h => h.kind === 'trait' && h.askerId === session?.playerId) || []; }
function canFlip() { return !!room && room.status === 'active' && ['playing','answering'].includes(room.state.phase); }

async function request(path, body, credentials = session, signal = null) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  try {
    const response = await fetch(ROOT + path, { method: body === undefined ? 'GET' : 'POST',
      headers: { ...(body === undefined ? {} : {'content-type':'application/json'}), ...(credentials ? {authorization:`Bearer ${credentials.token}`} : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: controller.signal, cache: 'no-store' });
    let data; try { data = await response.json(); } catch { throw new Error('The room service returned an unreadable response. Please reconnect.'); }
    if (!response.ok || data.ok === false) throw Object.assign(new Error(data.error || 'The room request failed.'), {status:response.status});
    return data;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('The connection timed out. Your room is still saved; reconnect to check its latest state.');
    if (error instanceof TypeError) throw new Error('Cannot reach the room. Check your connection, then try again.');
    throw error;
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}

function updateTransport() {
  const nearby = transport() === 'nearby';
  $('setupTransport').textContent = nearby ? 'Multiplayer · Nearby Arcade' : 'Multiplayer · Internet';
  const identity = mp?.getIdentity();
  $('nickname').readOnly = !!identity;
  if (identity) $('nickname').value = identity.nickname;
  const saved = savedSession();
  $('resume').hidden = !saved;
  $('resume').textContent = saved ? `Resume room ${saved.session.code}` : 'Resume saved room';
  if (!identity && !$('nickname').value && saved?.session.username) $('nickname').value = saved.session.username;
  $('invite').hidden = !session || !nearby;
  renderConnection();
}
function renderConnection() {
  if (!session) return;
  const nearby = session.transport === 'nearby';
  const connected = socket?.readyState === 1;
  $('connection').textContent = `${nearby ? 'Nearby' : 'Internet'} · ${connected ? 'Live' : 'Reconnecting'}`;
  $('connection').title = connected ? 'Live room updates are connected' : 'Retrying live updates; your seat and notes are preserved';
}
function cleanName() {
  const name = mp?.preferredUsername($('nickname').value) || $('nickname').value;
  const value = name.trim().replace(/\s+/g, ' ');
  if (!NAME.test(value)) throw new Error('Use a name of 1-24 letters or numbers, with spaces, apostrophes, periods, underscores or hyphens.');
  return value;
}
async function enter(kind) {
  if (joining || session) return;
  joining = true; showMessage('', true); updateButtons();
  try {
    if (!mp) throw new Error('The shared Arcade multiplayer script did not load. Reopen this game from Arcade.');
    await mp.ready();
    const chosenTransport = transport();
    const saved = kind === 'resume' ? savedSession() : null;
    if (kind === 'resume' && !saved) throw new Error('There is no saved room for this connection.');
    const name = saved?.session.username || cleanName();
    const code = saved?.session.code || $('joinCode').value.trim().toUpperCase();
    if (kind !== 'create' && !CODE.test(code)) throw new Error('Enter the six-character room code.');
    const result = kind === 'create'
      ? await request('', {game:'guess-who', username:name, maxPlayers:2}, null)
      : await request(`/${code}/join`, saved ? { reconnectToken:saved.session.token } : {username:name}, null);
    if (result.room?.game !== 'guess-who') {
      if (!saved && result.token) await request(`/${result.code}/actions`, {type:'leave'}, {token:result.token}).catch(() => {});
      throw new Error('That room belongs to another game. Use a Guess Who room code.');
    }
    epoch++; session = {code:result.code, token:result.token, playerId:result.playerId, username:playerIn(result.room, result.playerId)?.username || name, transport:chosenTransport};
    notes = saved ? sanitizeNotes(saved.notes) : emptyNotes();
    room = null; historyKey = ''; suspended = false;
    $('setup').hidden = true; $('roomBar').hidden = false; $('setupMessage').textContent = '';
    accept(result.room); connectSocket(); startPolling();
  } catch (error) {
    showMessage(error.message, true);
    if (!session) mp?.resetRoomTransport();
  } finally { joining = false; updateTransport(); updateButtons(); }
}
function playerIn(snapshot, id) { return snapshot.members?.find(p => p.playerId === id); }
function accept(snapshot) {
  if (!session || !snapshot || snapshot.game !== 'guess-who' || snapshot.code !== session.code || snapshot.playerId !== session.playerId || !snapshot.state) return false;
  if (room && (snapshot.version < room.version || (snapshot.version === room.version && snapshot.revision < room.revision))) return false;
  const previousRound = room?.state.round, previousPhase = room?.state.phase;
  room = snapshot;
  if (notes.round !== room.state.round) { notes = {...emptyNotes(room.state.round), autoFlip:notes.autoFlip}; mode = 'flip'; }
  if (previousRound !== undefined && previousRound !== room.state.round) closeModal();
  if (dialogKey?.startsWith('guess:') && !ownTurn()) closeModal();
  if (dialogKey?.startsWith('choose:') && (room.state.phase !== 'selecting' || room.state.myCharacterId)) closeModal();
  if (mode === 'guess' && !ownTurn()) mode = 'flip';
  const unseen = ownClues().filter(h => !notes.seen.includes(h.id));
  if (unseen.length) {
    if (notes.autoFlip) applyClues(false);
    notes.seen = ownClues().map(h => h.id);
  }
  mp?.observeRoom(room, 'guess-who');
  render();
  if (previousPhase !== room.state.phase) { $('sidebar').scrollTop = 0; if (room.status === 'finished') closeModal(); }
  save(); return true;
}
async function refresh(force = false) {
  if (!session || (refreshing && !force) || suspended) return;
  const credentials = session, generation = epoch;
  refreshing = true;
  try {
    const result = await request(`/${credentials.code}/state`, undefined, credentials);
    if (generation === epoch) accept(result.room);
  } catch (error) {
    if (generation === epoch && [401,404,410].includes(error.status)) showMessage('This saved room is no longer available. Use Leave to return to setup.');
  } finally { refreshing = false; }
}
function startPolling() { clearInterval(poll); poll = setInterval(() => { if (!document.hidden) refresh(); }, 4000); }
function connectSocket() {
  if (!session || suspended || socket?.readyState === 0 || socket?.readyState === 1) return;
  clearTimeout(retry);
  const generation = epoch;
  try {
    const url = ROOT.replace(/^https:/, 'wss:') + `/${session.code}/ws?token=${encodeURIComponent(session.token)}`;
    const ws = new WebSocket(url); socket = ws;
    ws.onopen = () => { if (generation !== epoch || socket !== ws) return ws.close(); retries = 0; renderConnection(); refresh(); };
    ws.onmessage = event => {
      if (generation !== epoch || socket !== ws) return;
      try { const message = JSON.parse(event.data); if (message.type === 'state') accept(message.room); else if (message.type === 'error') { showMessage(message.error || 'The room rejected that action.'); refresh(); } } catch { /* A malformed frame cannot become game state. */ }
    };
    ws.onerror = () => { if (socket === ws) { renderConnection(); try { ws.close(); } catch {} } };
    ws.onclose = () => { if (generation !== epoch || socket !== ws) return; socket = null; renderConnection(); scheduleReconnect(); };
  } catch { socket = null; scheduleReconnect(); }
  renderConnection();
}
function scheduleReconnect() {
  if (!session || suspended) return;
  clearTimeout(retry); retry = setTimeout(connectSocket, Math.min(12000, 600 * 2 ** Math.min(retries++, 5)));
}
function stopNetwork() {
  clearTimeout(retry); clearInterval(poll); retry = poll = null;
  const old = socket; socket = null; if (old) { old.onclose = old.onmessage = old.onopen = old.onerror = null; try { old.close(); } catch {} }
}
async function action(type, fields = {}) {
  if (busy || !session || !room) return false;
  busy = true; showMessage(''); updateButtons();
  const generation = epoch, originalRound = room.state.round;
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const sentVersion = room.version;
      try {
        const result = await request(`/${session.code}/actions`, {type, ...fields, expectedVersion:sentVersion});
        if (generation !== epoch) return false;
        accept(result.room); return true;
      } catch (error) {
        if (generation !== epoch) return false;
        await refresh(true);
        // These two intents commute with the other player's identical step. Never
        // replay questions, guesses, or a choice from a different round.
        if (error.status === 409 && (type === 'choose' || type === 'rematch')) {
          const state = room.state, sameRound = state.round === originalRound;
          if (type === 'choose' && sameRound && state.myCharacterId === fields.characterId) return true;
          if (type === 'rematch' && ((sameRound && state.rematchVotes.includes(session.playerId)) || state.round === originalRound + 1)) return true;
          const stillApplicable = sameRound && (type === 'choose'
            ? state.phase === 'selecting' && !state.myCharacterId
            : room.status === 'finished' && room.result?.type === 'guess-who' && !state.rematchVotes.includes(session.playerId));
          if (!attempt && room.version > sentVersion && stillApplicable) continue;
        }
        showMessage(error.status === 409 ? `${error.message}. The board has been refreshed; try again.` : error.message);
        return false;
      }
    }
    return false;
  } finally { if (generation === epoch) { busy = false; updateButtons(); } }
}

async function leave() {
  if (busy || !session) return;
  busy = true; updateButtons();
  try {
    try { await request(`/${session.code}/actions`, {type:'leave'}); }
    catch (error) { if (![401,404,410].includes(error.status)) throw error; }
    try { localStorage.removeItem(storeKey(session.transport)); } catch {}
    epoch++; stopNetwork(); session = room = null; notes = emptyNotes(); mode = 'flip'; historyKey = '';
    closeModal(); mp?.resetRoomTransport();
    $('setup').hidden = false; $('roomBar').hidden = true; showMessage('');
    render(); updateTransport();
  } catch (error) { showMessage(error.message); }
  finally { busy = false; updateButtons(); }
}

function setDown(values) {
  const down = CHARACTERS.filter(c => values.includes(c.id)).map(c => c.id);
  if (down.join(',') === notes.down.join(',')) return;
  notes.undo.push([...notes.down]); notes.undo = notes.undo.slice(-20); notes.down = down;
  save(); renderBoard(); updateButtons();
}
function flip(id) { if (!canFlip()) return; setDown(notes.down.includes(id) ? notes.down.filter(c => c !== id) : [...notes.down,id]); }
function applyClues(announce = true) {
  const clues = ownClues();
  const ruledOut = CHARACTERS.filter(c => clues.some(h => matchesQuestion(c, questionById(h.questionId)) !== h.answer)).map(c => c.id);
  setDown([...new Set([...notes.down, ...ruledOut])]);
  if (announce) showMessage('Applied your built-in clues. Your own question answers are the only clues used.');
}
function makeBoard() {
  for (const c of CHARACTERS) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'person'; button.dataset.character = c.id;
    button.innerHTML = portrait(c.id); button.append(text('span',c.name,'person-name'));
    button.addEventListener('click', () => cardClick(c.id)); cards.set(c.id,button); $('board').append(button);
  }
  const placeholder = text('option','Choose a question…'); placeholder.value = ''; $('question').append(placeholder);
  for (const group of [...new Set(QUESTIONS.map(q => q.group))]) {
    const optgroup = document.createElement('optgroup'); optgroup.label = group;
    for (const q of QUESTIONS.filter(q => q.group === group)) { const option = text('option',q.text); option.value = q.id; optgroup.append(option); }
    $('question').append(optgroup);
  }
  $('preview').innerHTML = ['ada','hugo','nova'].map(portrait).join('');
}
function cardClick(id) {
  if (!room) return;
  if (room.state.phase === 'selecting' && !room.state.myCharacterId) return characterModal(id,'choose');
  if (mode === 'guess' && ownTurn()) return characterModal(id,'guess');
  if (mode === 'inspect' || room.state.phase === 'selecting') return characterModal(id,'inspect');
  flip(id);
}
function renderBoard() {
  const selecting = room?.state.phase === 'selecting';
  for (const c of CHARACTERS) {
    const down = notes.down.includes(c.id) && !selecting;
    const button = cards.get(c.id);
    button.classList.toggle('down',down);
    button.setAttribute('aria-pressed',String(down));
    button.setAttribute('aria-label', `${c.name}${down ? ', ruled out' : ''}. ${selecting && !room.state.myCharacterId ? 'Choose secret character' : mode === 'guess' ? 'Guess this character' : mode === 'inspect' ? 'Inspect character' : 'Flip card'}`);
    button.disabled = !room || (busy && selecting);
  }
  $('remaining').textContent = selecting ? 'Choose your secret face' : `${24-notes.down.length} ${24-notes.down.length === 1 ? 'possibility' : 'possibilities'}`;
  for (const button of document.querySelectorAll('[data-mode]')) { button.classList.toggle('selected', mode === button.dataset.mode); button.setAttribute('aria-pressed', String(mode === button.dataset.mode)); }
  $('boardHelp').textContent = mode === 'guess' ? 'Tap a face to make your final guess. A wrong guess loses the round.' : mode === 'inspect' ? 'Tap any face for a larger portrait and its traits.' : 'Flip cards to rule people out. Inspect shows a larger portrait and its traits.';
}
function renderPlayers() {
  const entries = (room?.members || []).map(p => {
    const chip = document.createElement('div'); chip.className = `player${room.turn?.playerId === p.playerId ? ' current' : ''}`;
    chip.style.setProperty('--seat-color', p.seat === 0 ? 'var(--arcade-cyan)' : 'var(--arcade-pink)');
    chip.append(text('span',p.connected ? '●' : '○','presence'),text('span',`${p.username}${p.playerId === session.playerId ? ' (you)' : ''}`,'name'));
    chip.append(text('span',room.state.phase === 'selecting' ? (room.state.ready.includes(p.playerId) ? '✓ Ready' : 'Picking') : `${room.state.scores[p.playerId] || 0} wins`, 'score'));
    return chip;
  });
  $('players').replaceChildren(...entries);
}
function renderHistory() {
  const history = room?.state.history || [];
  const key = JSON.stringify(history);
  if (key === historyKey) return; historyKey = key;
  $('clueCount').textContent = history.length ? `(${history.length})` : '';
  if (!history.length) { $('clueList').replaceChildren(text('p','Your clues will appear here.','empty-history')); return; }
  $('clueList').replaceChildren(...history.slice().reverse().map(h => {
    const item = document.createElement('div'); item.className = 'clue';
    item.append(text('div', h.askerId === session.playerId ? 'You asked' : `${playerName(h.askerId)} asked`, 'who'));
    item.append(text('span',h.text),text('span',h.answer === null ? 'Not sure' : h.answer ? 'Yes' : 'No',`answer${h.answer === false ? ' no' : h.answer === null ? ' unsure' : ''}`));
    return item;
  }));
}
function render() {
  const state = room?.state;
  $('start').hidden = !(room?.status === 'lobby' && room.hostPlayerId === session?.playerId);
  $('mySecret').hidden = !state?.myCharacterId;
  $('answerPanel').hidden = !(state?.phase === 'answering' && state.pending?.answerBy === session?.playerId);
  $('questions').hidden = !!room && (!['playing','answering'].includes(state.phase) || !$('answerPanel').hidden);
  $('result').hidden = room?.status !== 'finished';
  $('clues').hidden = !!room && ['lobby','selecting'].includes(state.phase);
  $('autoFlip').checked = notes.autoFlip;
  let headline = 'Meet the suspects', subline = 'Two players. Twenty-four faces. Who will crack the mystery?';
  if (room) {
    $('roomCode').textContent = room.code; renderPlayers();
    if (room.status === 'lobby') { headline = room.ready ? 'Both detectives are here' : 'Waiting for the other detective'; subline = room.ready ? 'The room host can start the round.' : `Share room ${room.code}. Your name is now locked.`; }
    else if (state.phase === 'selecting') { headline = state.myCharacterId ? 'Your secret is locked in' : 'Pick your secret character'; subline = state.myCharacterId ? 'Waiting for the other player. Your choice stays hidden.' : 'Tap a face, then confirm. You cannot change it during the round.'; }
    else if (state.phase === 'answering') { headline = state.pending.answerBy === session.playerId ? 'Answer their question' : 'Waiting for an answer'; subline = state.pending.answerBy === session.playerId ? 'Your own question comes next.' : `${playerName(state.pending.answerBy)} is checking their secret.`; $('pendingText').textContent = state.pending.text; }
    else if (state.phase === 'playing') { headline = ownTurn() ? 'Your turn, detective!' : `${playerName(room.turn?.playerId)}’s turn`; subline = ownTurn() ? 'Ask one question or make your final guess.' : 'You can still flip cards and inspect the board.'; }
    else { headline = room.result?.type === 'guess-who' ? (room.result.winnerPlayerId === session.playerId ? 'Mystery solved. You win!' : `${playerName(room.result.winnerPlayerId)} wins!`) : 'The other player left'; subline = room.result?.type === 'guess-who' ? `Round ${state.round} complete. Both players can request a rematch.` : 'This round ended without a winner. Leave to create a new room.'; renderResult(); }
  }
  $('headline').textContent = headline; $('subline').textContent = subline;
  $('banner').classList.toggle('your-turn',ownTurn());
  const clues = ownClues(), latest = clues.at(-1);
  $('lastClue').hidden = !latest;
  if (latest) $('lastClue').textContent = `${latest.text} ${latest.answer ? 'Yes!' : 'No.'}`;
  const asked = new Set(clues.map(h => h.questionId));
  for (const option of $('question').options) { option.disabled = !!option.value && asked.has(option.value); }
  if ($('question').selectedOptions[0]?.disabled) $('question').value = '';
  renderHistory(); renderBoard(); renderConnection(); updateButtons();
}
function renderResult() {
  const valid = room.result?.type === 'guess-who';
  $('resultTitle').textContent = valid ? (room.result.winnerPlayerId === session.playerId ? 'You win! 🎉' : `${playerName(room.result.winnerPlayerId)} wins`) : 'Round ended';
  $('resultText').textContent = !valid ? 'A player left, so this round was not scored.' : room.result.reason === 'wrong-guess' ? `${playerName(room.result.guesserPlayerId)} made a wrong final guess.` : room.result.reason === 'resigned' ? `${playerName(room.result.resignedPlayerId)} resigned the round.` : 'The secret character was guessed correctly.';
  $('reveals').replaceChildren(...(valid ? room.members.map(p => {
    const id = room.state.revealed?.[p.playerId], c = characterById(id); const el = document.createElement('div'); el.className = 'reveal';
    if (c) el.append(image(id)); el.append(text('strong', c?.name || 'Not chosen'),text('span',p.playerId === session.playerId ? 'Your secret' : `${p.username}’s secret`)); return el;
  }) : []));
  $('rematch').hidden = !valid;
  const voted = room.state.rematchVotes.includes(session.playerId);
  $('rematch').textContent = voted ? 'Rematch requested' : 'Play again';
  $('rematchNote').textContent = !valid ? '' : voted ? 'Waiting for the other player to agree.' : room.state.rematchVotes.length ? 'Your opponent wants another round. Agree to play again.' : 'Both players must agree. The starting player alternates.';
}
function updateButtons() {
  for (const id of ['create','join','resume']) $(id).disabled = joining;
  $('nickname').disabled = joining; $('joinCode').disabled = joining;
  $('start').disabled = busy || !room?.ready;
  $('ask').disabled = busy || !ownTurn() || !$('question').value;
  $('question').disabled = busy || !ownTurn();
  $('askCustom').disabled = busy || !ownTurn() || $('customText').value.trim().length < 3;
  $('customText').disabled = busy || !ownTurn();
  $('undo').disabled = !canFlip() || !notes.undo.length;
  $('applyClues').disabled = !canFlip() || !ownClues().length;
  $('autoFlip').disabled = !canFlip();
  $('leave').disabled = busy;
  $('rematch').disabled = busy || !room || room.state.rematchVotes.includes(session?.playerId);
  for (const el of document.querySelectorAll('[data-answer]')) el.disabled = busy || room?.state.pending?.answerBy !== session?.playerId;
  for (const el of document.querySelectorAll('[data-mode]')) el.disabled = !room || (el.dataset.mode === 'guess' ? busy || !ownTurn() : false);
  for (const el of $('modalActions').querySelectorAll('button')) el.disabled = busy;
  for (const el of cards.values()) el.disabled = !room || (busy && room.state.phase === 'selecting');
}

function closeModal() { if ($('modal').open) $('modal').close(); dialogKey = null; }
function modal(title, body, actions = [], key = null) {
  closeModal(); dialogKey = key; $('modalTitle').textContent = title; $('modalBody').replaceChildren(...body);
  $('modalActions').replaceChildren(...actions.map(({label,style='',run}) => { const button = text('button',label,`arcade-btn ${style}`); button.type = 'button'; button.onclick = run; return button; }));
  $('modal').showModal(); updateButtons();
}
function characterModal(id, kind) {
  const c = characterById(id); if (!c) return;
  const body = [image(id),text('p',describeCharacter(c),'traits')];
  if (kind === 'choose') {
    body.push(text('p','Keep this face secret. Your choice cannot change until the next round.'));
    modal(`Choose ${c.name}?`,body,[{label:`Lock in ${c.name}`,style:'gold',run:async()=>{ if (await action('choose',{characterId:id})) closeModal(); }}],`choose:${id}`);
  } else if (kind === 'guess') {
    body.push(text('p','This is your final guess. If it is wrong, you lose this round.'));
    modal(`Is it ${c.name}?`,body,[{label:'Keep looking',run:closeModal},{label:`Guess ${c.name}`,style:'danger',run:async()=>{ if(await action('guess',{characterId:id})) closeModal(); }}],`guess:${id}`);
  } else modal(kind === 'secret' ? `Your secret: ${c.name}` : c.name,body,canFlip() && kind !== 'secret' ? [{label:notes.down.includes(id)?'Put card back':'Rule out this face',run:()=>{flip(id);closeModal();}}] : [],kind === 'secret' ? 'secret' : null);
}
function settings() {
  const sound = mp?.getTurnAlertSettings();
  const body = [text('p','Choose a secret face. On your turn, ask one yes/no question or make a final guess. A wrong final guess loses the round. Flip cards on your own board whenever you like.'),
    text('p','Built-in questions get an automatic, accurate answer. Custom questions go to your opponent. Answering a custom question does not use up their next question. “Not sure” passes the turn without a clue.'),
    text('p','Undo only changes your private flipped cards, not a question or guess. Your secret is available under My secret; it stays hidden from the other device until the round ends.'),
    text('p',`Turn sound is ${sound?.soundEnabled ? 'on' : 'off'}. Desktop notifications require browser permission and an open Arcade page.`)];
  const actions = [{label:sound?.soundEnabled ? 'Mute turn sound' : 'Enable turn sound', run:()=>{mp?.setTurnSoundEnabled(!sound?.soundEnabled);settings();}},
    {label:'Enable notifications',run:async()=>{await mp?.requestTurnNotifications();closeModal();showMessage('Notification preference updated. Browser and operating-system settings still apply.');}}];
  if (canFlip()) actions.push({label:'Restore all cards',run:()=>{setDown([]);closeModal();}});
  if (room?.status === 'active') actions.push({label:'Resign round',style:'danger',run:()=>modal('Resign this round?',[text('p','The other player will win. Both of you can then request a rematch.')],[{label:'Cancel',run:closeModal},{label:'Resign',style:'danger',run:async()=>{if(await action('resign'))closeModal();}}])});
  modal('Game settings',body,actions);
}

$('create').onclick = () => enter('create'); $('join').onclick = () => enter('join'); $('resume').onclick = () => enter('resume');
$('joinCode').oninput = () => { $('joinCode').value = $('joinCode').value.toUpperCase().replace(/[^A-Z0-9]/g,''); };
$('joinCode').onkeydown = event => { if(event.key === 'Enter') enter('join'); };
$('nickname').onkeydown = event => { if(event.key === 'Enter') enter($('joinCode').value ? 'join' : 'create'); };
$('start').onclick = () => action('start');
$('question').onchange = updateButtons; $('customText').oninput = updateButtons;
$('ask').onclick = async () => { const id = $('question').value; if (id && await action('ask',{questionId:id})) { $('question').value=''; updateButtons(); } };
$('customForm').onsubmit = async event => { event.preventDefault(); const value=$('customText').value.trim(); if(value.length>=3 && await action('ask',{text:value})) { $('customText').value=''; updateButtons(); } };
for(const el of document.querySelectorAll('[data-answer]')) el.onclick = () => action('answer',{answer:el.dataset.answer === 'unsure' ? 'unsure' : el.dataset.answer === 'yes'});
for(const el of document.querySelectorAll('[data-mode]')) el.onclick = () => { if (el.dataset.mode === 'guess' && !ownTurn()) return; mode=el.dataset.mode; renderBoard(); };
$('undo').onclick = () => { if(notes.undo.length && canFlip()) {notes.down=notes.undo.pop();save();renderBoard();updateButtons();} };
$('autoFlip').onchange = () => { notes.autoFlip=$('autoFlip').checked; if(notes.autoFlip)applyClues(false);save(); };
$('applyClues').onclick = () => applyClues();
$('zoom').onclick = () => { const large=$('boardScroll').classList.toggle('large');$('zoom').setAttribute('aria-pressed',String(large)); };
$('mySecret').onclick = () => characterModal(room?.state.myCharacterId,'secret');
$('settings').onclick = settings; $('modalClose').onclick = closeModal;
$('modal').addEventListener('close',()=>{dialogKey=null;});
$('rematch').onclick = () => action('rematch');
$('leave').onclick = () => modal('Leave this room?',[text('p',room?.status === 'active' ? 'Leaving ends this round for both players without a score. Your saved seat and card notes will be removed.' : 'Your saved seat and card notes will be removed.')],[{label:'Stay',run:closeModal},{label:'Leave room',style:'danger',run:leave}]);
$('roomCode').onclick = async () => {
  try { await navigator.clipboard.writeText(session.code);showMessage('Room code copied. Share it with the other player.'); }
  catch { modal('Share this room',[text('p',`Room code: ${session.code}`)]); }
};
$('invite').onclick = () => { if(session) { mp?.invite('guess-who',session.code,'Guess Who');showMessage('Invitation sent to Nearby Arcade.'); } };
function home() { save(); suspended=true; stopNetwork(); if(window.ArcadeMultiplayer)window.ArcadeMultiplayer.goHome();else location.href='../index.html'; }
$('home').onclick = home; $('setupHome').onclick = home;
window.addEventListener('pagehide',()=>{save();suspended=true;stopNetwork();});
window.addEventListener('pageshow',()=>{if(session){suspended=false;connectSocket();startPolling();refresh();}});
window.addEventListener('arcadepause',()=>{save();suspended=true;stopNetwork();closeModal();});
window.addEventListener('arcaderesume',()=>{if(session){suspended=false;connectSocket();startPolling();refresh();}});
document.addEventListener('visibilitychange',()=>{if(document.hidden){if(dialogKey==='secret')closeModal();}else if(session&&!suspended){connectSocket();refresh();}});
makeBoard(); render();
const query = new URLSearchParams(location.search);
$('joinCode').value = (query.get('room') || query.get('join') || query.get('code') || '').toUpperCase().slice(0,6);
mp?.onStatus(updateTransport);
if(mp) mp.ready().then(updateTransport).catch(()=>showMessage('The Arcade connection is not ready. Reopen this game from Arcade.',true));
else showMessage('The shared Arcade multiplayer script is missing. Open this game from the full Arcade.',true);
