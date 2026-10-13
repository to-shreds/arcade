import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { Miniflare } from 'miniflare';
import { applyAction } from '../../../tanks/engine.js';

const ORIGIN = 'http://localhost:8787';
function headers(token) { return { Origin: ORIGIN, 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }; }
function message(socket, predicate) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { socket.removeEventListener('message', receive); reject(new Error('Missing Tanks WebSocket update')); }, 3000);
    function receive(event) {
      const data = JSON.parse(event.data);
      if (predicate(data)) { clearTimeout(timeout); socket.removeEventListener('message', receive); resolve(data); }
    }
    socket.addEventListener('message', receive);
  });
}
async function miniflare() {
  const root = new URL('../../../', import.meta.url);
  const models = (await readdir(new URL('multiplayer/models/', root))).filter(path => path.endsWith('.js') && !path.endsWith('.test.js')).map(path => `multiplayer/models/${path}`);
  return new Miniflare({ modulesRoot: root.pathname,
    modules: ['cloudflare/chess-worker/src/index.js', ...models, 'tanks/engine.js', 'tanks/weapons.js', 'tanks/terrain-rules.js'].map(path => ({ type: 'ESModule', path: new URL(path, root).pathname })),
    compatibilityDate: '2026-08-06', compatibilityFlags: ['nodejs_compat'], bindings: { ALLOWED_ORIGINS: ORIGIN },
    durableObjects: { ARCADE_ROOMS: { className: 'ArcadeRoom', useSQLite: true } } });
}
const shotFor = game => ({ type: 'fire', weaponId: game.tanks[game.turn].inventory[0], angle: game.turn === 0 ? 45 : 135, power: 75 });

test('Tanks Durable Object resolves HTTP and WebSocket intents, persists reconnect, finishes 20 shots and requires mutual rematch', async t => {
  const mf = await miniflare(); t.after(() => mf.dispose());
  const call = async (path, body, token) => {
    const response = await mf.dispatchFetch('http://worker/api/arcade/rooms' + path, { method: body === undefined ? 'GET' : 'POST', headers: headers(token), ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, ...await response.json() };
  };
  assert.equal((await call('', { game: 'tanks', username: 'Alice', state: { seed: 1 } })).status, 400);
  const a = await call('', { game: 'tanks', username: 'Alice', maxPlayers: 2 }); assert.equal(a.status, 200);
  const b = await call(`/${a.code}/join`, { username: 'Bob' }); assert.equal(b.status, 200);
  let version = b.room.version;
  const act = async (who, type, extra = {}) => {
    const result = await call(`/${a.code}/actions`, { type, expectedVersion: version, ...extra }, who.token);
    if (result.ok) version = result.room.version;
    return result;
  };
  assert.equal((await act(b, 'configure', { terrainType: 'flat' })).status, 403);
  assert.equal((await act(a, 'configure', { terrainType: 'flat', color: '#0099ff' })).status, 200);
  assert.equal((await act(b, 'configure', { color: '#ff0099' })).status, 200);
  assert.equal((await act(b, 'start')).status, 403);
  let result = await act(a, 'start'); assert.equal(result.status, 200);
  const starter = result.room.state.starterSeat;
  async function socket(who) {
    const response = await mf.dispatchFetch(`http://worker/api/arcade/rooms/${a.code}/ws?token=${who.token}`, { headers: { Origin: ORIGIN, Upgrade: 'websocket' } });
    assert.equal(response.status, 101);
    const socket = response.webSocket; socket.accept();
    await message(socket, data => data.type === 'state'); t.after(() => socket.close()); return socket;
  }
  const sa = await socket(a), sb = await socket(b);
  const owner = result.room.turn.seat === 0 ? a : b, other = owner === a ? b : a, ownerSocket = owner === a ? sa : sb;
  assert.equal((await act(other, 'fire', shotFor(result.room.state.game))).status, 403);
  assert.equal((await call(`/${a.code}/state`, undefined, 'invalid')).status, 401);
  const denied = message(ownerSocket, data => data.type === 'error');
  ownerSocket.send(JSON.stringify({ type: 'fire', expectedVersion: version, ...shotFor(result.room.state.game), state: { score: 999 } }));
  assert.equal((await denied).status, 400);
  const movedA = message(sa, data => data.type === 'state' && data.room.version === version + 1);
  const movedB = message(sb, data => data.type === 'state' && data.room.version === version + 1);
  ownerSocket.send(JSON.stringify({ type: 'move', expectedVersion: version, distance: owner.seat === 0 ? 20 : -20 }));
  const [ma, mb] = await Promise.all([movedA, movedB]);
  assert.deepEqual(ma.room.state, mb.room.state); version = ma.room.version; result = ma;
  const before = result.room.state.game, shot = shotFor(before), expected = applyAction(before, shot, owner.seat);
  const firedA = message(sa, data => data.type === 'state' && data.room.version === version + 1);
  const firedB = message(sb, data => data.type === 'state' && data.room.version === version + 1);
  ownerSocket.send(JSON.stringify({ ...shot, expectedVersion: version }));
  const [fa, fb] = await Promise.all([firedA, firedB]); version = fa.room.version; result = fa;
  assert.deepEqual(fa.room.state.game, expected); assert.deepEqual(fa.room.state, fb.room.state);
  assert.equal(fa.room.turn.playerId, other.playerId);
  const reconnect = await call(`/${a.code}/join`, { reconnectToken: b.token });
  assert.equal(reconnect.playerId, b.playerId); assert.deepEqual(reconnect.room.state, result.room.state);
  assert.equal((await act(other, 'fire', { ...shotFor(result.room.state.game), expectedVersion: version - 1 })).status, 409);
  for (let count = 1; count < 20; count++) {
    const actor = result.room.turn.seat === 0 ? a : b;
    result = await act(actor, 'fire', shotFor(result.room.state.game));
    assert.equal(result.status, 200, result.error);
  }
  assert.equal(result.room.status, 'finished'); assert.equal(result.room.turn, null);
  assert.deepEqual(result.room.state.game.tanks.map(tank => tank.inventory.length), [0, 0]);
  assert.equal(result.room.result.type, 'tanks');
  assert.deepEqual(result.room.result.scores, result.room.state.game.tanks.map(tank => tank.score));
  result = await act(a, 'rematch'); assert.equal(result.room.status, 'finished');
  assert.equal((await act(a, 'rematch')).status, 409);
  result = await act(b, 'rematch'); assert.equal(result.room.status, 'active');
  assert.equal(result.room.state.round, 2); assert.equal(result.room.state.starterSeat, 1 - starter);
  assert.deepEqual(result.room.state.game.tanks.map(tank => tank.inventory.length), [10, 10]);
});

test('Tanks Durable Object admits exactly one of two simultaneous same-version shots', async t => {
  const mf = await miniflare(); t.after(() => mf.dispose());
  const call = async (path, body, token) => {
    const response = await mf.dispatchFetch('http://worker/api/arcade/rooms' + path, { method: 'POST', headers: headers(token), body: JSON.stringify(body) });
    return { status: response.status, ...await response.json() };
  };
  const a = await call('', { game: 'tanks', username: 'Alice' });
  const b = await call(`/${a.code}/join`, { username: 'Bob' });
  const started = await call(`/${a.code}/actions`, { type: 'start', expectedVersion: b.room.version }, a.token);
  const actor = started.room.turn.seat === 0 ? a : b;
  const action = { ...shotFor(started.room.state.game), expectedVersion: started.room.version };
  const outcomes = await Promise.all([call(`/${a.code}/actions`, action, actor.token), call(`/${a.code}/actions`, action, actor.token)]);
  assert.deepEqual(outcomes.map(outcome => outcome.status).sort(), [200, 409]);
  const accepted = outcomes.find(outcome => outcome.ok);
  assert.equal(accepted.room.state.game.shotsTotal, 1);
  assert.equal(accepted.room.state.game.tanks[actor.seat].inventory.length, 9);
});
