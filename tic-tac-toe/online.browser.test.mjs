import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../cloudflare/chess-worker/package.json', import.meta.url));
const { JSDOM, VirtualConsole } = require('jsdom');
const root = new URL('../', import.meta.url);
const clone = (value) => JSON.parse(JSON.stringify(value));
const wait = (window, ms = 50) => new Promise((resolve) => window.setTimeout(resolve, ms));

class TicRoomServer {
  constructor() {
    const now = new Date().toISOString();
    this.token = 'r'.repeat(43);
    this.failNextStateBeforeCommit = false;
    this.failNextStateGet = false;
    this.calls = [];
    this.sockets = new Set();
    this.room = {
      code: 'XYZ789', game: 'tic-tac-toe', version: 7, revision: 7, status: 'active', ready: true,
      hostPlayerId: 'player-0', minPlayers: 2, maxPlayers: 2,
      members: [
        { playerId: 'player-0', seat: 0, username: 'Alice', connected: true, joinedAt: now },
        { playerId: 'player-1', seat: 1, username: 'Bob', connected: true, joinedAt: now }
      ],
      turn: { seat: 0, playerId: 'player-0', number: 4 },
      // Structurally legal, but O conflicts with the server-authoritative X seat.
      state: { schema: 1, board: ['X','','','','','','','',''], turn: 'O', scoreX: 0, scoreO: 0, symX: 'X', symO: 'O', roundOver: null },
      result: null, chat: [], createdAt: now, updatedAt: now
    };
  }

  response(data, status = 200) {
    return { ok: status >= 200 && status < 300, status, async json() { return clone(data); } };
  }

  view() {
    return clone({ ...this.room, playerId: 'player-0', seat: 0, presence: { 'player-0': true, 'player-1': true } });
  }

  broadcast() {
    for (const socket of this.sockets) {
      if (!socket.closed) socket.onmessage?.({ data: JSON.stringify({ type: 'state', room: this.view() }) });
    }
  }

  socketClass() {
    const server = this;
    return class FakeWebSocket {
      static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
      constructor(url) {
        this.url = String(url); this.readyState = 0; this.closed = false;
        server.sockets.add(this);
        queueMicrotask(() => {
          if (this.closed) return;
          this.readyState = 1; this.onopen?.({}); server.broadcast();
        });
      }
      close() {
        if (this.closed) return;
        this.closed = true; this.readyState = 3; server.sockets.delete(this);
        queueMicrotask(() => this.onclose?.({}));
      }
    };
  }

  async fetch(input, options = {}) {
    const url = new URL(String(input));
    const body = options.body ? JSON.parse(options.body) : null;
    const token = String(options.headers?.Authorization || options.headers?.authorization || '').replace(/^Bearer\s+/i, '');
    this.calls.push({ path: url.pathname, method: options.method || 'GET', body, token });
    if (url.pathname === '/api/arcade/rooms/XYZ789/join' && options.method === 'POST') {
      if (body.reconnectToken !== this.token) return this.response({ ok: false, error: 'Bad reconnect token' }, 401);
      return this.response({ ok: true, code: 'XYZ789', token: this.token, playerId: 'player-0', seat: 0, room: this.view() });
    }
    if (url.pathname === '/api/arcade/rooms/XYZ789/state') {
      if (token !== this.token) return this.response({ ok: false, error: 'Bad token' }, 401);
      if (this.failNextStateGet) {
        this.failNextStateGet = false;
        return this.response({ ok: false, error: 'Temporary refresh outage' }, 503);
      }
      return this.response({ ok: true, room: this.view() });
    }
    if (url.pathname === '/api/arcade/rooms/XYZ789/actions' && options.method === 'POST') {
      if (token !== this.token) return this.response({ ok: false, error: 'Bad token' }, 401);
      if (body.expectedVersion !== this.room.version) return this.response({ ok: false, error: 'Room state changed' }, 409);
      if (body.type !== 'state') return this.response({ ok: false, error: 'Unsupported action' }, 400);
      if (this.room.turn.seat !== 0) return this.response({ ok: false, error: 'It is not your turn' }, 403);
      if (this.failNextStateBeforeCommit) {
        this.failNextStateBeforeCommit = false;
        return this.response({ ok: false, error: 'Temporary outage before commit' }, 503);
      }
      this.room.state = clone(body.state);
      this.room.turn = { seat: body.nextSeat, playerId: `player-${body.nextSeat}`, number: this.room.turn.number + 1 };
      this.room.version++; this.room.revision++;
      this.broadcast();
      return this.response({ ok: true, room: this.view() });
    }
    return this.response({ ok: false, error: 'Not found' }, 404);
  }
}

const [page, client, save] = await Promise.all([
  readFile(new URL('tic-tac-toe/index.html', root), 'utf8'),
  readFile(new URL('tic-tac-toe/room-client.js', root), 'utf8'),
  readFile(new URL('arcade-save.js', root), 'utf8')
]);
const html = page
  .replace('<script src="room-client.js"></script>', `<script>${client}</script>`)
  .replace('<script src="../arcade-save.js"></script>', `<script>${save}</script>`);
const errors = [], virtualConsole = new VirtualConsole(), server = new TicRoomServer();
virtualConsole.on('jsdomError', (error) => errors.push(error));
let fetches = 0;
const dom = new JSDOM(html, {
  url: 'https://to-shreds.github.io/arcade/tic-tac-toe/', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole,
  beforeParse(window) {
    window.localStorage.setItem('arcade_tictactoe_online_room_v1', JSON.stringify({
      code: 'XYZ789', token: server.token, playerId: 'player-0', seat: 0, username: 'Alice'
    }));
    window.fetch = async (...args) => { fetches++; return server.fetch(...args); };
    window.WebSocket = server.socketClass();
    window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
    window.HTMLElement.prototype.scrollIntoView = () => {};
    window.HTMLCanvasElement.prototype.getContext = () => ({ clearRect() {}, fillRect() {}, beginPath() {}, arc() {}, fill() {} });
  }
});

try {
  if (dom.window.document.readyState !== 'complete') await new Promise((resolve) => dom.window.addEventListener('load', resolve, { once: true }));
  await wait(dom.window);
  const { document, Event } = dom.window;
  assert.ok(dom.window.TicTacToe, 'Tic Tac Toe initializes in a browser realm');
  assert.equal(fetches, 0, 'saved room requires an explicit Resume click');
  assert.equal(document.querySelector('#ttt-online-resume').hidden, false);
  assert.ok(document.querySelector('[onclick="TicTacToe.start(\'cpu\')"]'));
  assert.ok(document.querySelector('[onclick="TicTacToe.start(\'pvp\')"]'));
  document.querySelector('[onclick="TicTacToe.start(\'pvp\')"]').click();
  assert.equal(document.querySelector('#ttt-menu').style.display, 'none', 'local pass-and-play remains available');
  assert.equal(document.querySelectorAll('#ttt-board .ttt-cell').length, 9);
  dom.window.TicTacToe.openMenu();

  document.querySelector('#ttt-online-resume').click();
  await wait(dom.window, 150);
  const repair = server.calls.find((call) => call.body?.type === 'state');
  assert.ok(repair, 'the authoritative current client repairs a board/server turn mismatch');
  assert.equal(repair.body.expectedVersion, 7);
  assert.equal(repair.body.nextSeat, 0, 'repair restarts with the occupied X seat');
  assert.deepEqual(repair.body.state.board, Array(9).fill(''), 'hostile mismatched board is not silently applied');
  assert.equal(server.room.version, 8);
  assert.deepEqual(server.room.state.board, Array(9).fill(''));

  const authoritativeVersion = server.room.version;
  const authoritativeState = clone(server.room.state);
  const stateActionsBefore = server.calls.filter((call) => call.body?.type === 'state').length;
  server.failNextStateBeforeCommit = true;
  document.querySelectorAll('#ttt-board .ttt-cell')[0].dispatchEvent(new Event('pointerdown', { bubbles: true, cancelable: true }));
  await wait(dom.window, 150);

  assert.equal(server.room.version, authoritativeVersion, 'pre-commit 503 leaves the Tic room version unchanged');
  assert.deepEqual(server.room.state, authoritativeState, 'pre-commit 503 leaves the Tic server snapshot unchanged');
  assert.equal(server.calls.filter((call) => call.body?.type === 'state').length, stateActionsBefore + 1, 'the failed Tic move is submitted exactly once');
  assert.ok(server.calls.some((call) => call.path === '/api/arcade/rooms/XYZ789/state'), 'Tic refreshes authoritative state after a failed move');
  assert.equal(document.querySelectorAll('#ttt-board .ttt-x, #ttt-board .ttt-o').length, 0, 'same-version refresh removes the speculative mark');
  assert.equal(document.querySelector('#ttt-board').classList.contains('ttt-online-wait'), false, 'the current player can retry after rollback');
  assert.equal(errors.length, 0, errors.map((error) => error.message).join('\n'));
  console.log('Tic Tac Toe turn-binding and same-version rollback browser regressions passed.');
} finally {
  dom.window.close();
}

const retryServer = new TicRoomServer();
retryServer.failNextStateBeforeCommit = true;
retryServer.failNextStateGet = true;
const retryErrors = [], retryConsole = new VirtualConsole();
retryConsole.on('jsdomError', (error) => retryErrors.push(error));
const retryDom = new JSDOM(html, {
  url: 'https://to-shreds.github.io/arcade/tic-tac-toe/', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: retryConsole,
  beforeParse(window) {
    window.localStorage.setItem('arcade_tictactoe_online_room_v1', JSON.stringify({
      code: 'XYZ789', token: retryServer.token, playerId: 'player-0', seat: 0, username: 'Alice'
    }));
    window.fetch = retryServer.fetch.bind(retryServer);
    window.WebSocket = retryServer.socketClass();
    window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
    window.HTMLElement.prototype.scrollIntoView = () => {};
    window.HTMLCanvasElement.prototype.getContext = () => ({ clearRect() {}, fillRect() {}, beginPath() {}, arc() {}, fill() {} });
  }
});
try {
  if (retryDom.window.document.readyState !== 'complete') await new Promise((resolve) => retryDom.window.addEventListener('load', resolve, { once: true }));
  await wait(retryDom.window);
  retryDom.window.document.querySelector('#ttt-online-resume').click();
  await wait(retryDom.window, 200);
  retryServer.broadcast();
  await wait(retryDom.window, 850);
  const repairAttempts = retryServer.calls.filter((call) => call.body?.type === 'state');
  assert.equal(repairAttempts.length, 2, 'a failed repair and failed refresh retry after an equal-version reconnect snapshot');
  assert.equal(repairAttempts[0].body.expectedVersion, 7);
  assert.equal(repairAttempts[1].body.expectedVersion, 7, 'retry remains based on the unchanged authoritative version');
  assert.equal(retryServer.room.version, 8, 'bounded retry repairs the room once transport recovers');
  assert.deepEqual(retryServer.room.state.board, Array(9).fill(''));
  assert.equal(retryDom.window.document.querySelector('#ttt-board').classList.contains('ttt-online-wait'), false);
  assert.equal(retryErrors.length, 0, retryErrors.map((error) => error.message).join('\n'));
  console.log('Tic Tac Toe failed-repair retry regression passed.');
} finally {
  retryDom.window.close();
}

const roundServer = new TicRoomServer();
roundServer.room.state = {
  schema: 1, board: ['X','X','X','O','O','','','',''], turn: 'X', scoreX: 1, scoreO: 0,
  symX: 'X', symO: 'O', roundOver: { winner: 'X', line: [0,1,2] }
};
roundServer.failNextStateBeforeCommit = true;
const roundErrors = [], roundConsole = new VirtualConsole();
roundConsole.on('jsdomError', (error) => roundErrors.push(error));
const roundDom = new JSDOM(html, {
  url: 'https://to-shreds.github.io/arcade/tic-tac-toe/', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: roundConsole,
  beforeParse(window) {
    window.localStorage.setItem('arcade_tictactoe_online_room_v1', JSON.stringify({
      code: 'XYZ789', token: roundServer.token, playerId: 'player-0', seat: 0, username: 'Alice'
    }));
    window.fetch = roundServer.fetch.bind(roundServer);
    window.WebSocket = roundServer.socketClass();
    window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
    window.HTMLElement.prototype.scrollIntoView = () => {};
    window.HTMLCanvasElement.prototype.getContext = () => ({ clearRect() {}, fillRect() {}, beginPath() {}, arc() {}, fill() {} });
  }
});
try {
  if (roundDom.window.document.readyState !== 'complete') await new Promise((resolve) => roundDom.window.addEventListener('load', resolve, { once: true }));
  await wait(roundDom.window);
  roundDom.window.document.querySelector('#ttt-online-resume').click();
  await wait(roundDom.window, 2300);
  const resetAttempts = roundServer.calls.filter((call) => call.body?.type === 'state');
  assert.equal(resetAttempts.length, 2, 'a failed automatic round reset is retried once transport recovers');
  assert.equal(roundServer.room.version, 8, 'only the successful reset commits a new version');
  assert.deepEqual(roundServer.room.state.board, Array(9).fill(''), 'the synchronized next round eventually starts');
  assert.equal(roundServer.room.state.roundOver, null);
  assert.equal(roundErrors.length, 0, roundErrors.map((error) => error.message).join('\n'));
  console.log('Tic Tac Toe automatic round-reset retry regression passed.');
} finally {
  roundDom.window.close();
}
