import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createGame, applyAction, chooseCpuAction, validateGame } from './engine.js';
import { DICTIONARY_ID } from './dictionary.js';
import { GenericRoomModel } from '../multiplayer/models/generic-room-model.js';
import { MemoryStorage } from '../multiplayer/models/room-model.js';

// Bundle the actual shipped client, including its real rules and dictionary.
// The only substitutes are browser/storage/transport boundaries that must be
// controllable to reproduce delayed replies and navigation races.
const require = createRequire(new URL('../cloudflare/chess-worker/package.json', import.meta.url));
const { JSDOM } = require('jsdom');
const { build } = require('esbuild');
const html = await readFile(new URL('./index.html', import.meta.url), 'utf8');
const bundle = await build({
  entryPoints: [fileURLToPath(new URL('./game.js', import.meta.url))], bundle: true, write: false,
  format: 'iife', platform: 'browser', logLevel: 'silent',
  define: { 'import.meta.url': JSON.stringify('https://to-shreds.github.io/arcade/upwords/game.js') }
});
const script = bundle.outputFiles[0].text;
const clone = value => JSON.parse(JSON.stringify(value));
const tick = () => new Promise(resolve => setTimeout(resolve, 5));
async function wait(predicate, label = 'condition', timeout = 5000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await predicate()) return; await tick(); }
  assert.fail(`Timed out waiting for ${label}`);
}
function deferred() {
  let resolve;
  const promise = new Promise(accept => { resolve = accept; });
  return { promise, resolve };
}
const response = body => ({ ok: body.ok !== false, status: body.status || 200, json: async () => clone(body) });

function backend(t) {
  const model = new GenericRoomModel(new MemoryStorage()), sockets = [], calls = [], holds = [], failures = [];
  const credentials = new Map();
  let tail = Promise.resolve();
  const enqueue = work => { const run = tail.then(work, work); tail = run.catch(() => {}); return run; };
  const broadcast = async () => {
    for (const socket of sockets) if (socket.readyState === 1) {
      try { socket.onmessage?.({ data: JSON.stringify({ type: 'state', room: await model.state(socket.token) }) }); }
      catch { /* An abandoned seat no longer receives a private projection. */ }
    }
  };
  const service = {
    model, calls, credentials, broadcast,
    holdNext(predicate) {
      const reached = deferred(), released = deferred();
      const gate = { predicate, used: false, reached: reached.promise, release: released.resolve, resolveReached: reached.resolve, released: released.promise };
      holds.push(gate); return gate;
    },
    failNext(predicate) { failures.push(predicate); },
    async fetch(url, options = {}) {
      const call = { path: new URL(String(url)).pathname, body: options.body ? JSON.parse(options.body) : null, token: options.headers?.authorization?.slice(7) };
      calls.push(call);
      const failure = failures.findIndex(predicate => predicate(call));
      if (failure >= 0) { failures.splice(failure, 1); throw new Error('Simulated connection outage'); }
      const gate = holds.find(gate => !gate.used && gate.predicate(call));
      if (gate) gate.used = true;
      const result = await enqueue(async () => {
        try {
          let value;
          if (call.path.endsWith('/rooms')) value = await model.create({ code: 'ABC234', ...call.body });
          else if (call.path.endsWith('/join')) value = await model.join(call.body);
          else if (call.path.endsWith('/state')) value = { room: await model.state(call.token) };
          else if (call.path.endsWith('/actions')) value = { room: await model.act(call.token, call.body) };
          else throw Object.assign(new Error('Unknown route'), { status: 404 });
          if (value.token) credentials.set(value.playerId, value);
          if (call.body) await broadcast();
          return clone({ ok: true, ...value });
        } catch (error) { return { ok: false, status: error.status || 500, error: error.message }; }
      });
      // Holding the HTTP reply does not block later authority operations or
      // socket broadcasts, which is the race these tests need to exercise.
      if (gate) { gate.resolveReached({ call, result }); await gate.released; }
      return response(result);
    },
    async directAction(client, type, fields = {}) {
      return enqueue(async () => {
        const member = credentials.get(client.debug().session.playerId);
        const version = (await model.load()).version;
        const result = await model.act(member.token, { type, expectedVersion: version, dictionaryId: DICTIONARY_ID, ...fields });
        await broadcast(); return result;
      });
    },
    Socket: class {
      constructor(url) {
        this.token = new URL(String(url)).searchParams.get('token'); this.readyState = 0; sockets.push(this);
        queueMicrotask(async () => { if (this.readyState !== 0) return; this.readyState = 1; this.onopen?.({}); await broadcast(); });
      }
      close() { this.readyState = 3; this.onclose?.({}); }
    }
  };
  t.after(() => { for (const gate of holds) gate.release(); for (const socket of sockets) { socket.onclose = null; socket.close(); } });
  return service;
}

function client(t, server, { storage = {}, transport = 'cloudflare' } = {}) {
  const dom = new JSDOM(html, { url: 'https://to-shreds.github.io/arcade/upwords/', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window, workers = [], observed = [], snapshots = [];
  for (const [key, value] of Object.entries(storage)) w.localStorage.setItem(key, value);
  const bridge = { pinned: null, resetCount: 0, homeCount: 0 };
  w.ArcadeMultiplayer = {
    workerOrigin: 'https://arcade-chess.jonathanjablon.workers.dev', ready: async () => {},
    getStatus: () => ({ effectiveTransport: bridge.pinned || transport }), getIdentity: () => null,
    preferredUsername: name => name, onStatus: listener => listener(),
    pinRoomTransport: value => { bridge.pinned = value; },
    resetRoomTransport: () => { bridge.pinned = null; bridge.resetCount++; },
    observeRoom: room => observed.push(clone(room)), forgetRoomAlert() {},
    getTurnAlertSettings: () => ({ soundEnabled: true }), setTurnSoundEnabled() {}, requestTurnNotifications: async () => {},
    invite: () => true, goHome: () => { bridge.homeCount++; return true; }
  };
  const saving = {
    adapter: null, external: false,
    register(adapter) { this.adapter = adapter; },
    async saveNow() { if (this.external || !this.adapter) return null; const snapshot = this.adapter.capture(); if (snapshot) snapshots.push(clone(snapshot)); return snapshot || null; },
    touch() {}, hasSave: () => snapshots.length > 0,
    setExternalSession(active) { this.external = active; },
    goHome() { bridge.homeCount++; return true; }
  };
  w.ArcadeSave = saving; w.fetch = server.fetch; w.WebSocket = server.Socket;
  w.Worker = class {
    constructor() { this.terminated = false; workers.push(this); }
    postMessage(value) { this.input = clone(value); }
    terminate() { this.terminated = true; }
    deliver(action) { this.onmessage?.({ data: { id: this.input.id, action } }); }
  };
  w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  w.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new w.Event('close')); };
  w.eval(script);
  const $ = id => w.document.getElementById(id);
  const c = {
    w, $, bridge, saving, snapshots, observed, workers,
    debug: () => clone(w.UpwordsGame.getDebug()), state: () => clone(w.UpwordsGame.getState()), capture: () => clone(w.UpwordsGame.capture()),
    async click(id) { $(id).click(); await tick(); },
    select(id, value) { $(id).value = value; $(id).dispatchEvent(new w.Event('change', { bubbles: true })); },
    input(id, value) { $(id).value = value; $(id).dispatchEvent(new w.Event('input', { bubbles: true })); },
    async confirm(label) {
      const button = [...$('modalActions').querySelectorAll('button')].find(button => label.test(button.textContent));
      assert.ok(button, `Dialog has a ${label} action`); button.click(); await tick();
    }
  };
  t.after(async () => { w.dispatchEvent(new w.Event('pagehide')); await tick(); w.close(); });
  return c;
}

function localSnapshot(mode = 'hotseat') {
  const game = createGame({ seed: 12345, names: ['Alice', 'Bob'], starter: 0 });
  const tiles = ['C', 'A', 'T', 'E', 'R', 'N', 'S'];
  for (let index = 0; index < tiles.length; index++) {
    if (game.players[0].rack[index] === tiles[index]) continue;
    const bagIndex = game.bag.indexOf(tiles[index]); assert.ok(bagIndex >= 0);
    [game.players[0].rack[index], game.bag[bagIndex]] = [game.bag[bagIndex], game.players[0].rack[index]];
  }
  validateGame(game);
  return { schema: 1, mode, difficulty: 'normal', game,
    placements: [{ row: 4, col: 3, rackIndex: 0 }, { row: 4, col: 4, rackIndex: 1 }, { row: 4, col: 5, rackIndex: 2 }],
    selected: null, rackOrder: [0, 1, 2, 3, 4, 5, 6], handoffPending: false };
}
async function setupFromLocal(c) {
  await c.click('showRack'); await c.click('newGame'); await c.confirm(/Game setup/);
  assert.equal(c.$('setup').hidden, false);
  c.select('mode', 'network'); c.input('nickname', 'Alice');
}
async function pair(t) {
  const server = backend(t), a = client(t, server), b = client(t, server);
  for (const [c, name] of [[a, 'Alice'], [b, 'Bob']]) { c.select('mode', 'network'); c.input('nickname', name); }
  await a.click('create'); await wait(() => a.debug().session, 'host enters room');
  b.input('joinCode', 'ABC234'); await b.click('join'); await wait(() => b.debug().session && !a.$('startRoom').disabled, 'second player joins');
  await a.click('startRoom'); await wait(() => a.state() && b.state() && !a.debug().busy, 'round starts');
  const first = a.debug().room.turn.playerId === a.debug().session.playerId ? a : b;
  return { server, a, b, first, other: first === a ? b : a };
}

test('hotseat restore conceals unsubmitted board letters, word preview and rack until the player opens the curtain', async t => {
  const server = backend(t), c = client(t, server), saved = localSnapshot();
  c.saving.adapter.restore(clone(saved));
  assert.equal(c.$('handoff').hidden, false);
  assert.equal(c.$('board').querySelectorAll('.placed,.tile-letter').length, 0, 'Draft letters are absent from the concealed DOM');
  assert.equal([...c.$('board').querySelectorAll('button')].some(button => button.getAttribute('aria-label').includes('unplayed')), false);
  assert.equal(c.$('previewWords').textContent.includes('CAT'), false, 'The draft word is not exposed to assistive technology');
  assert.equal(/[A-Z]/.test(c.$('rack').textContent), false);
  assert.equal(c.$('play').disabled, true);
  assert.deepEqual(c.capture().placements, saved.placements, 'Concealing the draft preserves it');
  await c.click('showRack');
  assert.equal(c.$('board').querySelectorAll('.placed').length, 3);
  assert.ok(c.$('previewWords').textContent.includes('CAT'));
  assert.equal(c.$('play').disabled, false);
});

test('a delayed successful HTTP acknowledgement cannot undo a newer socket turn or report a false failure', async t => {
  const { server, first, other } = await pair(t);
  const gate = server.holdNext(call => call.body?.type === 'exchange');
  await first.click('exchange');
  first.$('modalBody').querySelector('[data-exchange-index="0"]').click();
  await first.click('confirmExchange'); await gate.reached;
  await wait(() => first.state().moveNumber === 1, 'socket delivers own accepted turn');
  assert.equal(first.debug().busy, true, 'Socket observation does not release a pending HTTP action');
  await server.directAction(other, 'exchange', { rackIndex: 0 });
  await wait(() => first.state().moveNumber === 2, 'opponent replies before original HTTP acknowledgement');
  const version = first.debug().room.version;
  gate.release(); await wait(() => !first.debug().busy, 'older HTTP acknowledgement settles');
  assert.equal(first.state().moveNumber, 2);
  assert.equal(first.debug().room.version, version);
  assert.equal(first.$('message').textContent, '', 'A successful acknowledged action does not become an error');
  assert.equal(first.$('exchange').disabled, false, 'Controls return for the correct next turn');
});

test('a newer same-version chat revision does not turn a successful pending action into a failure', async t => {
  const { server, first, other } = await pair(t);
  const gate = server.holdNext(call => call.body?.type === 'exchange');
  await first.click('exchange');
  first.$('modalBody').querySelector('[data-exchange-index="0"]').click();
  await first.click('confirmExchange'); await gate.reached;
  await wait(() => first.state().moveNumber === 1, 'accepted action reaches the originating socket');
  const version = first.debug().room.version;
  await server.directAction(other, 'chat', { text: 'Your move arrived.' });
  const revision = first.debug().room.revision;
  assert.equal(first.debug().room.version, version, 'Chat changes only the room revision');
  gate.release(); await wait(() => !first.debug().busy, 'older same-version HTTP acknowledgement settles');
  assert.equal(first.debug().room.revision, revision);
  assert.equal(first.debug().room.chat.at(-1).text, 'Your move arrived.');
  assert.equal(first.$('message').textContent, '');
});

test('room updates close stale exchange and pass dialogs before their rack indices or turn assumptions can be reused', async t => {
  const { server, first, other } = await pair(t);
  await first.click('exchange'); assert.equal(first.$('modal').open, true);
  first.$('modalBody').querySelector('[data-exchange-index="0"]').click();
  await server.directAction(first, 'exchange', { rackIndex: 0 });
  assert.equal(first.$('modal').open, false, 'A same-player action from another tab invalidates the old exchange dialog');
  await server.directAction(other, 'exchange', { rackIndex: 0 });
  await first.click('pass'); assert.equal(first.$('modal').open, true);
  await server.directAction(first, 'pass');
  assert.equal(first.$('modal').open, false, 'An accepted turn invalidates an old pass confirmation');
  await server.directAction(other, 'pass');
  assert.equal(first.debug().room.status, 'finished');
  assert.equal(first.$('modal').open, false);
});

test('Continue cannot resume a local game while a join is pending, and leaving the room restores the exact draft', async t => {
  const server = backend(t), c = client(t, server), saved = localSnapshot();
  c.saving.adapter.restore(clone(saved)); await setupFromLocal(c);
  const gate = server.holdNext(call => call.path.endsWith('/rooms'));
  await c.click('create'); await gate.reached;
  c.select('mode', 'hotseat');
  assert.equal(c.$('continueLocal').hidden, false, 'Changing the setup selector exposes Continue');
  assert.equal(c.$('continueLocal').disabled, true, 'Pending entry disables Continue');
  await c.click('continueLocal');
  assert.equal(c.$('setup').hidden, false, 'The guarded handler cannot reopen local play during the join');
  assert.deepEqual(c.capture().game, saved.game);
  assert.deepEqual(c.capture().placements, saved.placements);
  gate.release(); await wait(() => c.debug().session, 'created room accepted');
  await c.click('lobbyLeave'); await c.confirm(/^Leave room$/);
  await wait(() => !c.debug().session && !c.debug().busy, 'leave restores local game');
  assert.deepEqual(c.capture().game, saved.game);
  assert.deepEqual(c.capture().placements, saved.placements);
  assert.equal(c.$('handoff').hidden, false);
  assert.equal(c.$('board').querySelectorAll('.placed').length, 0, 'Restored local draft remains behind the privacy curtain');
});

test('Home cancels a pending fresh entry, releases the late seat, and preserves local progress', async t => {
  const server = backend(t), c = client(t, server), saved = localSnapshot();
  c.saving.adapter.restore(clone(saved)); await setupFromLocal(c);
  const gate = server.holdNext(call => call.path.endsWith('/rooms'));
  await c.click('create'); await gate.reached;
  await c.click('setupHome'); assert.equal(c.bridge.homeCount, 1);
  gate.release();
  await wait(async () => server.calls.some(call => call.body?.type === 'leave') && (await server.model.load()).members.every(member => member.leftAt), 'late fresh seat is released');
  await wait(() => !c.$('create').disabled, 'cancelled entry settles');
  assert.equal(c.debug().session, null, 'A late response cannot attach a room after Home');
  assert.deepEqual(c.capture().game, saved.game);
  assert.deepEqual(c.capture().placements, saved.placements);
  assert.equal(c.bridge.pinned, null, 'A cancelled fresh entry releases its transport after seat cleanup');
});

test('cancelling a saved-room resume preserves the seat, reconnect token and original authority', async t => {
  const server = backend(t);
  const saved = await server.model.create({ code: 'ABC234', game: 'upwords', username: 'Alice' });
  const session = { code: saved.code, token: saved.token, playerId: saved.playerId, username: 'Alice', transport: 'nearby' };
  const key = 'arcade.upwords.room.nearby.v1';
  const c = client(t, server, { transport: 'nearby', storage: { [key]: JSON.stringify(session) } });
  c.select('mode', 'network');
  const gate = server.holdNext(call => call.path.endsWith('/join'));
  await c.click('resumeRoom'); await gate.reached;
  await c.click('setupHome'); gate.release();
  await wait(() => !c.$('resumeRoom').disabled, 'cancelled saved resume settles');
  assert.equal(c.debug().session, null);
  assert.equal(server.calls.some(call => call.body?.type === 'leave'), false, 'Cancelling resume must never revoke an existing seat');
  assert.equal((await server.model.load()).members.filter(member => !member.leftAt).length, 1);
  assert.deepEqual(JSON.parse(c.w.localStorage.getItem(key)), session);
  assert.equal(c.bridge.pinned, 'nearby');
});

test('transient saved-room resume failures retain the saved transport while fresh failures release it', async t => {
  const server = backend(t);
  const saved = await server.model.create({ code: 'ABC234', game: 'upwords', username: 'Alice' });
  const session = { code: saved.code, token: saved.token, playerId: saved.playerId, username: 'Alice', transport: 'nearby' };
  const key = 'arcade.upwords.room.nearby.v1';
  const c = client(t, server, { transport: 'nearby', storage: { [key]: JSON.stringify(session) } });
  c.select('mode', 'network'); server.failNext(call => call.path.endsWith('/join'));
  await c.click('resumeRoom'); await wait(() => !c.$('resumeRoom').disabled && c.$('setupMessage').textContent, 'saved resume failure displayed');
  assert.equal(c.bridge.pinned, 'nearby'); assert.equal(c.bridge.resetCount, 0);
  assert.deepEqual(JSON.parse(c.w.localStorage.getItem(key)), session);
  server.failNext(call => call.path.endsWith('/rooms'));
  await c.click('create'); await wait(() => !c.$('create').disabled, 'fresh create failure settles');
  assert.equal(c.bridge.pinned, null); assert.equal(c.bridge.resetCount, 1);
});

test('CPU pause cancels the old worker and ignores its late reply before exactly one resumed response', async t => {
  const server = backend(t), c = client(t, server), saved = localSnapshot('cpu');
  saved.game = applyAction(saved.game, { type: 'exchange', rackIndex: 0 }); saved.placements = [];
  c.saving.adapter.restore(clone(saved));
  await wait(() => c.workers.length === 1 && c.workers[0].input, 'computer worker starts');
  const firstWorker = c.workers[0], firstAction = chooseCpuAction(firstWorker.input.game, 'easy');
  c.w.dispatchEvent(new c.w.Event('arcadepause'));
  assert.equal(firstWorker.terminated, true);
  firstWorker.deliver(firstAction); await tick();
  assert.equal(c.state().moveNumber, 1, 'A cancelled worker cannot commit a late move');
  c.w.dispatchEvent(new c.w.Event('arcaderesume'));
  await wait(() => c.workers.length === 2 && c.workers[1].input, 'computer search resumes');
  const secondWorker = c.workers[1]; secondWorker.deliver(chooseCpuAction(secondWorker.input.game, 'easy'));
  await wait(() => c.state().moveNumber === 2 && !c.debug().busy, 'one resumed computer turn commits');
  assert.equal(c.state().turn, 0);
  assert.equal(secondWorker.terminated, true);
  firstWorker.deliver(firstAction); await tick();
  assert.equal(c.state().moveNumber, 2, 'Repeated old worker delivery cannot spend a second turn');
});

// Exercise the shipped pointer handlers and game callbacks together. Geometry
// is supplied here; the browser suite additionally uses real mouse/touch input.
function pointer(c, target, type, x = 50, y = 50, pointerId = 1) {
  const event = new c.w.MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y });
  Object.defineProperties(event, { pointerId: { value: pointerId }, pointerType: { value: 'touch' }, isPrimary: { value: true } });
  target.dispatchEvent(event);
}
function beginDrag(c, source, target) {
  c.w.document.elementFromPoint = () => target;
  pointer(c, source, 'pointerdown', 10, 10);
  pointer(c, c.w.document, 'pointermove');
}
function endDrag(c) { pointer(c, c.w.document, 'pointerup'); }
const rackTile = (c, index) => c.$('rack').querySelector(`[data-rack-index="${index}"]`);
const boardCell = (c, row, col) => c.$('board').querySelector(`[data-row="${row}"][data-col="${col}"]`);

test('dragging places, moves, returns and reorders physical tiles without submitting a turn', async t => {
  const c = client(t, backend(t)), saved = localSnapshot(); saved.placements = [];
  c.saving.adapter.restore(clone(saved)); await c.click('showRack');
  const game = c.state();
  beginDrag(c, rackTile(c, 0), boardCell(c, 4, 4));
  assert.equal(c.w.document.querySelectorAll('.tile-drag-ghost').length, 1);
  assert.equal(c.debug().placements.length, 0, 'Moving the pointer does not consume a tile');
  endDrag(c);
  assert.deepEqual(c.debug().placements, [{ row: 4, col: 4, rackIndex: 0 }]);
  boardCell(c, 4, 4).dispatchEvent(new c.w.MouseEvent('click', { bubbles: true, detail: 1 }));
  assert.equal(c.debug().placements.length, 1, 'The compatibility click cannot take the tile back');
  await tick();
  beginDrag(c, boardCell(c, 4, 4), boardCell(c, 4, 5)); endDrag(c); await tick();
  const draft = c.debug().placements;
  assert.deepEqual(draft, [{ row: 4, col: 5, rackIndex: 0 }]);
  beginDrag(c, rackTile(c, 1), boardCell(c, 4, 5)); endDrag(c); await tick();
  assert.deepEqual(c.debug().placements, draft, 'Dropping on another draft tile preserves both tiles');
  beginDrag(c, rackTile(c, 2), null); endDrag(c); await tick();
  assert.deepEqual(c.debug().placements, draft, 'Dropping outside the board preserves the draft');
  beginDrag(c, boardCell(c, 4, 5), rackTile(c, 0)); endDrag(c); await tick();
  assert.deepEqual(c.debug().placements, [], 'Returning to the rack removes only the draft placement');
  const beforeOrder = c.capture().rackOrder;
  beginDrag(c, rackTile(c, 0), rackTile(c, 3)); endDrag(c); await tick();
  assert.notDeepEqual(c.capture().rackOrder, beforeOrder);
  assert.deepEqual([...c.capture().rackOrder].sort(), [...beforeOrder].sort());
  assert.deepEqual(c.state(), game, 'Board, physical rack, bag, scores and turn remain untouched');
  assert.equal(c.w.document.querySelectorAll('.tile-drag-ghost,.drag-over,.drop-blocked').length, 0);
});

test('canceled gestures and privacy handoffs cannot drop a tile or leave a ghost behind', async t => {
  const c = client(t, backend(t)), saved = localSnapshot(); saved.placements = [];
  c.saving.adapter.restore(clone(saved)); await c.click('showRack');
  beginDrag(c, rackTile(c, 0), boardCell(c, 4, 4));
  pointer(c, c.w.document, 'pointercancel'); endDrag(c); await tick();
  assert.deepEqual(c.debug().placements, []);
  assert.equal(c.w.document.querySelectorAll('.tile-drag-ghost').length, 0);
  beginDrag(c, rackTile(c, 1), boardCell(c, 4, 4));
  c.saving.adapter.restore(clone(saved));
  assert.equal(c.$('handoff').hidden, false);
  endDrag(c); await tick();
  assert.deepEqual(c.debug().placements, []);
  assert.equal(c.w.document.querySelectorAll('.tile-drag-ghost').length, 0);
  beginDrag(c, rackTile(c, 1), boardCell(c, 4, 4)); endDrag(c); await tick();
  assert.deepEqual(c.debug().placements, [], 'A hidden rack cannot start a gesture');
  await c.click('showRack');
  beginDrag(c, rackTile(c, 2), boardCell(c, 4, 4)); endDrag(c); await tick();
  assert.deepEqual(c.debug().placements, [{ row: 4, col: 4, rackIndex: 2 }], 'The next legitimate gesture still works');
});

test('a new authoritative turn cancels a held drag without submitting or exposing a draft', async t => {
  const { server, first } = await pair(t);
  const beforeCalls = server.calls.filter(call => call.body?.type === 'play').length;
  beginDrag(first, rackTile(first, 0), boardCell(first, 4, 4));
  await server.directAction(first, 'pass');
  await wait(() => first.state().moveNumber === 1, 'the authoritative turn changes');
  endDrag(first); await tick();
  assert.equal(first.w.document.querySelectorAll('.tile-drag-ghost').length, 0);
  assert.deepEqual(first.debug().placements, []);
  assert.equal(server.calls.filter(call => call.body?.type === 'play').length, beforeCalls);
  assert.equal(rackTile(first, 0).disabled, true);
});
