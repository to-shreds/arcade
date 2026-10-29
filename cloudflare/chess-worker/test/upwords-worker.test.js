import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { Miniflare } from 'miniflare';
import { DICTIONARY_ID } from '../../../upwords/dictionary.js';

const ORIGIN = 'http://localhost:8787';
const headers = token => ({ Origin: ORIGIN, 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) });
function message(socket, predicate) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { socket.removeEventListener('message', receive); reject(new Error('Missing Upwords WebSocket update')); }, 3000);
    function receive(event) {
      const data = JSON.parse(event.data);
      if (predicate(data)) { clearTimeout(timeout); socket.removeEventListener('message', receive); resolve(data); }
    }
    socket.addEventListener('message', receive);
  });
}
async function fixture(t) {
  const root = new URL('../../../', import.meta.url);
  const models = (await readdir(new URL('multiplayer/models/', root))).filter(path => path.endsWith('.js') && !path.endsWith('.test.js')).map(path => `multiplayer/models/${path}`);
  const mf = new Miniflare({ modulesRoot: root.pathname,
    modules: ['cloudflare/chess-worker/src/index.js', ...models, 'upwords/engine.js', 'upwords/dictionary.js', 'tanks/engine.js', 'tanks/weapons.js', 'tanks/terrain-rules.js'].map(path => ({ type: 'ESModule', path: new URL(path, root).pathname })),
    compatibilityDate: '2026-08-06', compatibilityFlags: ['nodejs_compat'], bindings: { ALLOWED_ORIGINS: ORIGIN },
    durableObjects: { ARCADE_ROOMS: { className: 'ArcadeRoom', useSQLite: true } } });
  t.after(() => mf.dispose());
  const call = async (path, body, token) => {
    const response = await mf.dispatchFetch('http://worker/api/arcade/rooms' + path, { method: body === undefined ? 'GET' : 'POST', headers: headers(token), ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, ...await response.json() };
  };
  return { mf, call };
}
function privateRack(game, seat) {
  assert.equal(game.players[seat].rack.length, game.players[seat].rackCount);
  assert.equal(Object.hasOwn(game.players[1 - seat], 'rack'), false);
  for (const key of ['bag', 'seed', 'rng']) assert.equal(Object.hasOwn(game, key), false);
  if (game.lastMove?.type === 'exchange') {
    assert.deepEqual(game.lastMove.placements, []);
    for (const key of ['rackIndex', 'tile', 'drawn', 'exchanged']) assert.equal(Object.hasOwn(game.lastMove, key), false);
  }
}

test('Upwords Durable Object keeps racks private across HTTP, sockets, exchanges, reconnect and mutual rematch', async t => {
  const { mf, call } = await fixture(t);
  assert.equal((await call('', { game: 'upwords', username: 'Alice', state: { bag: ['A'] } })).status, 400);
  const a = await call('', { game: 'upwords', username: 'Alice', maxPlayers: 2 }); assert.equal(a.status, 200);
  const b = await call(`/${a.code}/join`, { username: 'Bob' }); assert.equal(b.status, 200);
  let version = b.room.version;
  const act = async (who, type, extra = {}) => {
    const result = await call(`/${a.code}/actions`, { type, dictionaryId: DICTIONARY_ID, expectedVersion: version, ...extra }, who.token);
    if (result.ok) version = result.room.version;
    return result;
  };
  assert.equal((await act(b, 'start')).status, 403);
  assert.equal((await act(a, 'start', { dictionaryId: 'stale-dictionary' })).status, 409);
  assert.equal((await act(a, 'start', { seed: 1 })).status, 400);
  let result = await act(a, 'start'); assert.equal(result.status, 200, result.error);
  const starter = result.room.state.starterSeat;
  privateRack(result.room.state.game, 0);
  const guestState = await call(`/${a.code}/state`, undefined, b.token);
  privateRack(guestState.room.state.game, 1);
  assert.deepEqual(result.room.state.game.board, guestState.room.state.game.board);
  assert.equal((await call(`/${a.code}/state`, undefined, 'invalid')).status, 401);
  async function socket(who) {
    const response = await mf.dispatchFetch(`http://worker/api/arcade/rooms/${a.code}/ws?token=${who.token}`, { headers: { Origin: ORIGIN, Upgrade: 'websocket' } });
    assert.equal(response.status, 101);
    const socket = response.webSocket;
    const ready = message(socket, data => data.type === 'state'); socket.accept();
    const initial = await ready; privateRack(initial.room.state.game, who.seat);
    t.after(() => socket.close()); return socket;
  }
  const sa = await socket(a), sb = await socket(b);
  const owner = result.room.turn.seat === 0 ? a : b, other = owner === a ? b : a, ownerSocket = owner === a ? sa : sb;
  assert.equal((await act(other, 'exchange', { rackIndex: 0 })).status, 403);
  const denied = message(ownerSocket, data => data.type === 'error');
  ownerSocket.send(JSON.stringify({ type: 'exchange', dictionaryId: DICTIONARY_ID, expectedVersion: version, rackIndex: 0, state: { score: 999 } }));
  assert.equal((await denied).status, 400);
  const exchangedA = message(sa, data => data.type === 'state' && data.room.version === version + 1);
  const exchangedB = message(sb, data => data.type === 'state' && data.room.version === version + 1);
  ownerSocket.send(JSON.stringify({ type: 'exchange', dictionaryId: DICTIONARY_ID, expectedVersion: version, rackIndex: 0 }));
  const [ea, eb] = await Promise.all([exchangedA, exchangedB]); version = ea.room.version;
  privateRack(ea.room.state.game, 0); privateRack(eb.room.state.game, 1);
  assert.equal(ea.room.state.game.bagCount, 86);
  assert.equal(ea.room.state.game.moveNumber, 1);
  assert.equal(ea.room.turn.playerId, other.playerId);
  assert.deepEqual(ea.room.state.game.board, eb.room.state.game.board);
  assert.deepEqual(ea.room.state.game.lastMove, eb.room.state.game.lastMove);
  const reconnect = await call(`/${a.code}/join`, { reconnectToken: b.token });
  assert.equal(reconnect.playerId, b.playerId);
  assert.deepEqual(reconnect.room.state, eb.room.state);
  assert.equal((await act(other, 'exchange', { rackIndex: 0, expectedVersion: version - 1 })).status, 409);
  result = await act(other, 'pass'); assert.equal(result.status, 200);
  result = await act(owner, 'pass'); assert.equal(result.status, 200);
  assert.equal(result.room.status, 'finished'); assert.equal(result.room.turn, null);
  assert.equal(result.room.result.type, 'upwords');
  assert.deepEqual(result.room.result.scores, [-35, -35]);
  privateRack(result.room.state.game, owner.seat);
  result = await act(a, 'rematch'); assert.equal(result.room.status, 'finished');
  assert.equal((await act(a, 'rematch')).status, 409);
  result = await act(b, 'rematch'); assert.equal(result.room.status, 'active');
  assert.equal(result.room.state.round, 2); assert.equal(result.room.state.starterSeat, 1 - starter);
  privateRack(result.room.state.game, 1);
});

test('Upwords Durable Object accepts only one concurrent same-version action', async t => {
  const { call } = await fixture(t);
  const a = await call('', { game: 'upwords', username: 'Alice' });
  const b = await call(`/${a.code}/join`, { username: 'Bob' });
  const started = await call(`/${a.code}/actions`, { type: 'start', dictionaryId: DICTIONARY_ID, expectedVersion: b.room.version }, a.token);
  const actor = started.room.turn.seat === 0 ? a : b;
  const action = { type: 'exchange', rackIndex: 0, dictionaryId: DICTIONARY_ID, expectedVersion: started.room.version };
  const results = await Promise.all([call(`/${a.code}/actions`, action, actor.token), call(`/${a.code}/actions`, action, actor.token)]);
  assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
  const accepted = results.find(result => result.ok);
  assert.equal(accepted.room.state.game.moveNumber, 1);
  assert.equal(accepted.room.state.game.bagCount, 86);
  privateRack(accepted.room.state.game, actor.seat);
});
