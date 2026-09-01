import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../cloudflare/chess-worker/package.json', import.meta.url));
const { JSDOM, VirtualConsole } = require('jsdom');
const root = new URL('../', import.meta.url);
const clone = (value) => JSON.parse(JSON.stringify(value));
const wait = (window, ms = 50) => new Promise((resolve) => window.setTimeout(resolve, ms));

class MemoryRoomServer {
  constructor() {
    this.room = null;
    this.tokens = new Map();
    this.sockets = new Set();
    this.calls = [];
    this.failNextStateBeforeCommit = false;
    this.raceNewerStateOnNextGet = false;
    this.racedMatchIndexes = [];
  }

  response(data, status = 200) {
    return { ok: status >= 200 && status < 300, status, async json() { return clone(data); } };
  }

  member(token) {
    const playerId = this.tokens.get(token);
    return this.room?.members.find((member) => member.playerId === playerId) || null;
  }

  view(token) {
    const viewer = this.member(token);
    return clone({
      code: this.room.code, game: 'memory', version: this.room.version, revision: this.room.revision,
      status: this.room.status, ready: this.room.members.length >= 2, hostPlayerId: this.room.hostPlayerId,
      minPlayers: 2, maxPlayers: this.room.maxPlayers, playerId: viewer?.playerId || null, seat: viewer?.seat ?? null,
      members: this.room.members.map(({ token: _token, ...member }) => ({ ...member, connected: true })),
      presence: Object.fromEntries(this.room.members.map((member) => [member.playerId, true])),
      turn: this.room.turn, state: this.room.state, result: this.room.result, chat: [],
      createdAt: this.room.createdAt, updatedAt: this.room.updatedAt
    });
  }

  broadcast() {
    for (const socket of this.sockets) {
      if (!socket.closed) socket.onmessage?.({ data: JSON.stringify({ type: 'state', room: this.view(socket.token) }) });
    }
  }

  socketClass() {
    const server = this;
    return class FakeWebSocket {
      static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
      constructor(url) {
        this.url = String(url); this.readyState = 0; this.closed = false;
        this.token = new URL(this.url).searchParams.get('token');
        server.sockets.add(this);
        queueMicrotask(() => {
          if (this.closed) return;
          this.readyState = 1;
          this.onopen?.({});
          server.broadcast();
        });
      }
      close() {
        if (this.closed) return;
        this.closed = true; this.readyState = 3; server.sockets.delete(this);
        queueMicrotask(() => this.onclose?.({}));
      }
    };
  }

  addMember(username, seat) {
    const token = String.fromCharCode(98 + seat).repeat(43);
    const playerId = `player-${seat}`;
    this.room.members.push({ playerId, seat, username, token, joinedAt: new Date().toISOString() });
    this.tokens.set(token, playerId);
    this.room.version++; this.room.revision++;
    this.broadcast();
    return token;
  }

  setDepartedOwnedMatch() {
    const state = clone(this.room.state);
    const key = state.deck[0].key;
    const indexes = state.deck.map((card, index) => card.key === key ? index : -1).filter((index) => index >= 0);
    assert.equal(indexes.length, state.matchSize);
    state.matchedKeys = [key];
    state.owners = state.deck.map(() => 0);
    indexes.forEach((index) => { state.owners[index] = 2; });
    state.scores = [0, 1, 0];
    state.stats[1].matches = 1;
    state.stats[1].attempts = 1;
    state.stats[1].flips = state.matchSize;
    state.turn = 2;
    this.room.state = state;
    this.room.turn = { seat: 1, playerId: 'player-1', number: 2 };
    this.room.version++; this.room.revision++;
    this.broadcast();
    return { key, indexes };
  }

  removeCurrentMiddleMember() {
    this.room.members = this.room.members.filter((member) => member.seat !== 1);
    this.room.turn = { seat: 2, playerId: 'player-2', number: 3 };
    this.room.version++; this.room.revision++;
    this.broadcast();
  }

  passSeatTwoToHost() {
    this.room.turn = { seat: 0, playerId: 'player-0', number: 4 };
    this.room.version++; this.room.revision++;
    this.broadcast();
  }

  async fetch(input, options = {}) {
    const url = new URL(String(input));
    const body = options.body ? JSON.parse(options.body) : {};
    const token = String(options.headers?.Authorization || options.headers?.authorization || '').replace(/^Bearer\s+/i, '');
    this.calls.push({ path: url.pathname, body, token });
    if (url.pathname === '/api/arcade/rooms' && options.method === 'POST') {
      const hostToken = 'a'.repeat(43), now = new Date().toISOString();
      this.room = {
        code: 'MEM234', version: 1, revision: 1, status: 'lobby', hostPlayerId: 'player-0', maxPlayers: body.maxPlayers,
        members: [{ playerId: 'player-0', seat: 0, username: body.username, token: hostToken, joinedAt: now }],
        turn: null, state: null, result: null, createdAt: now, updatedAt: now
      };
      this.tokens.set(hostToken, 'player-0');
      return this.response({ ok: true, code: this.room.code, token: hostToken, playerId: 'player-0', seat: 0, room: this.view(hostToken) });
    }
    if (url.pathname === '/api/arcade/rooms/MEM234/state') {
      if (this.raceNewerStateOnNextGet) {
        this.raceNewerStateOnNextGet = false;
        const state = clone(this.room.state);
        const key = state.deck.find((card) => !state.matchedKeys.includes(card.key)).key;
        this.racedMatchIndexes = state.deck.map((card, index) => card.key === key ? index : -1).filter((index) => index >= 0);
        state.matchedKeys.push(key);
        this.racedMatchIndexes.forEach((index) => { state.owners[index] = 1; });
        state.scores[0]++;
        state.stats[0].matches = state.scores[0];
        state.stats[0].attempts = Math.max(state.stats[0].attempts, state.stats[0].matches);
        state.stats[0].flips = Math.max(state.stats[0].flips, state.stats[0].attempts);
        this.room.state = state;
        this.room.turn = { seat: 2, playerId: 'player-2', number: this.room.turn.number + 1 };
        this.room.version++; this.room.revision++;
        this.broadcast();
        return this.response({ ok: false, error: 'Refresh transport failed after a newer socket update' }, 503);
      }
      return this.response({ ok: true, room: this.view(token) });
    }
    if (url.pathname === '/api/arcade/rooms/MEM234/actions' && options.method === 'POST') {
      const member = this.member(token);
      if (!member) return this.response({ ok: false, error: 'Invalid room token' }, 401);
      if (body.expectedVersion !== this.room.version) return this.response({ ok: false, error: 'Room state changed' }, 409);
      if (body.type === 'start') {
        this.room.status = 'active'; this.room.state = clone(body.state);
        this.room.turn = { seat: body.firstSeat, playerId: this.room.members.find((item) => item.seat === body.firstSeat).playerId, number: 1 };
      } else if (body.type === 'state') {
        if (this.room.turn.seat !== member.seat) return this.response({ ok: false, error: 'It is not your turn' }, 403);
        if (!this.room.members.some((item) => item.seat === body.nextSeat)) return this.response({ ok: false, error: 'Next seat is unavailable' }, 400);
        if (this.failNextStateBeforeCommit) {
          this.failNextStateBeforeCommit = false;
          return this.response({ ok: false, error: 'Temporary outage before commit' }, 503);
        }
        this.room.state = clone(body.state);
        this.room.turn = { seat: body.nextSeat, playerId: this.room.members.find((item) => item.seat === body.nextSeat).playerId, number: this.room.turn.number + 1 };
      } else return this.response({ ok: false, error: 'Unsupported action' }, 400);
      this.room.version++; this.room.revision++;
      this.broadcast();
      return this.response({ ok: true, room: this.view(token) });
    }
    return this.response({ ok: false, error: 'Not found' }, 404);
  }
}

async function loadMemory(server) {
  const errors = [], virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (error) => errors.push(error));
  const [page, model, client, save] = await Promise.all([
    readFile(new URL('memory/index.html', root), 'utf8'),
    readFile(new URL('memory/online-model.js', root), 'utf8'),
    readFile(new URL('memory/room-client.js', root), 'utf8'),
    readFile(new URL('arcade-save.js', root), 'utf8')
  ]);
  const html = page
    .replace('<script src="online-model.js"></script>', `<script>${model}</script>`)
    .replace('<script src="room-client.js"></script>', `<script>${client}</script>`)
    .replace('<script src="../arcade-save.js"></script>', `<script>${save}</script>`);
  const dom = new JSDOM(html, {
    url: 'https://to-shreds.github.io/arcade/memory/', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole,
    beforeParse(window) {
      window.fetch = server.fetch.bind(server);
      window.WebSocket = server.socketClass();
      window.HTMLElement.prototype.scrollIntoView = () => {};
    }
  });
  if (dom.window.document.readyState !== 'complete') await new Promise((resolve) => dom.window.addEventListener('load', resolve, { once: true }));
  await wait(dom.window);
  return { dom, errors };
}

const server = new MemoryRoomServer();
const { dom, errors } = await loadMemory(server);
try {
  const { document, Event } = dom.window;
  document.querySelector('#playersSel').value = '3';
  document.querySelector('#playersSel').dispatchEvent(new Event('change', { bubbles: true }));
  document.querySelector('#memoryOnlineName').value = 'Alice';
  document.querySelector('#memoryOnlineCreate').click();
  await wait(dom.window, 80);
  assert.ok(server.room, `room creation failed: ${document.querySelector('#memoryOnlineStatus').textContent}; ${errors.map((error) => error.message).join('; ')}`);
  server.addMember('Bob', 1);
  server.addMember('Cara', 2);
  await wait(dom.window, 80);
  assert.equal(document.querySelectorAll('#memoryOnlineMembers .memory-member').length, 3);
  document.querySelector('#memoryOnlineStart').click();
  await wait(dom.window, 100);
  assert.equal(server.room.status, 'active');
  assert.deepEqual(server.room.state.seatOrder, [0, 1, 2]);

  const departedMatch = server.setDepartedOwnedMatch();
  await wait(dom.window, 80);
  assert.equal(document.querySelectorAll('#board .card.matched.owner-2').length, departedMatch.indexes.length);

  server.removeCurrentMiddleMember();
  await wait(dom.window, 100);
  assert.deepEqual(server.room.members.map((member) => member.seat), [0, 2]);
  assert.equal(document.querySelectorAll('#scoreBar .chip').length, 2, 'departed player is removed from the live score bar');
  assert.equal(document.querySelectorAll('#board .card.matched.owner-1, #board .card.matched.owner-2').length, 0, 'departed matches remain neutral, not reassigned');

  server.passSeatTwoToHost();
  await wait(dom.window, 80);
  const candidates = [...document.querySelectorAll('#board .card:not(.matched)')];
  const first = candidates[0];
  const firstFace = first.querySelector('.face').textContent;
  const second = candidates.find((card) => card.querySelector('.face').textContent !== firstFace);
  assert.ok(first && second, 'two unmatched, non-pair cards are available');
  first.click(); second.click();
  await wait(dom.window, 1750);

  const stateAction = [...server.calls].reverse().find((call) => call.body.type === 'state');
  assert.ok(stateAction, 'completed Memory attempt submits synchronized state');
  assert.equal(stateAction.body.nextSeat, 2, 'next turn targets the remaining occupied non-contiguous seat');
  assert.deepEqual(stateAction.body.state.seatOrder, [0, 2]);
  assert.equal(stateAction.body.state.players, 2);
  assert.deepEqual(stateAction.body.state.scores, [0, 0]);
  assert.ok(departedMatch.indexes.every((index) => stateAction.body.state.owners[index] === 0));
  assert.equal(server.room.turn.seat, 2);

  server.passSeatTwoToHost();
  await wait(dom.window, 80);
  const authoritativeVersion = server.room.version;
  const authoritativeState = clone(server.room.state);
  const actionCount = server.calls.filter((call) => call.body.type === 'state').length;
  server.failNextStateBeforeCommit = true;
  const retryCandidates = [...document.querySelectorAll('#board .card:not(.matched)')];
  const retryFirst = retryCandidates[0];
  const retryFace = retryFirst.querySelector('.face').textContent;
  const retrySecond = retryCandidates.find((card) => card.querySelector('.face').textContent !== retryFace);
  assert.ok(retryFirst && retrySecond, 'a second non-matching attempt is available');
  retryFirst.click(); retrySecond.click();
  await wait(dom.window, 1750);

  assert.equal(server.room.version, authoritativeVersion, 'pre-commit 503 does not advance the authoritative room');
  assert.deepEqual(server.room.state, authoritativeState, 'pre-commit 503 leaves the server snapshot unchanged');
  assert.equal(server.calls.filter((call) => call.body.type === 'state').length, actionCount + 1, 'the failed move was submitted exactly once');
  assert.ok(server.calls.some((call) => call.path === '/api/arcade/rooms/MEM234/state'), 'the client refreshes after the failed move');
  assert.equal(document.querySelectorAll('#board .card.revealed').length, 0, 'same-version refresh rolls back speculative card reveals');
  assert.equal(document.querySelector('#board').classList.contains('online-wait'), false, 'the authoritative current player can retry after rollback');

  const raceVersion = server.room.version;
  const raceCandidates = [...document.querySelectorAll('#board .card:not(.matched)')];
  const raceFirst = raceCandidates[0];
  const raceFace = raceFirst.querySelector('.face').textContent;
  const raceSecond = raceCandidates.find((card) => card.querySelector('.face').textContent !== raceFace);
  server.failNextStateBeforeCommit = true;
  server.raceNewerStateOnNextGet = true;
  raceFirst.click(); raceSecond.click();
  await wait(dom.window, 1750);
  assert.equal(server.room.version, raceVersion + 1, 'a newer authoritative socket snapshot wins a recovery-GET race');
  assert.ok(server.racedMatchIndexes.length > 0);
  assert.ok(server.racedMatchIndexes.every((index) => document.querySelectorAll('#board .card')[index].classList.contains('matched')), 'failed recovery GET cannot roll an already-applied newer room back');
  assert.equal(document.querySelector('#board').classList.contains('online-wait'), true, 'newer authoritative turn gating is preserved');
  assert.equal(errors.length, 0, errors.map((error) => error.message).join('\n'));
  console.log('Memory departure and same-version rollback browser regressions passed.');
} finally {
  dom.window.close();
}
