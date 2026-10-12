import test from 'node:test';
import assert from 'node:assert/strict';
import { GenericRoomModel, GAME_TYPES } from './generic-room-model.js';
import { MemoryStorage } from './room-model.js';
import { createGame, applyAction, validateGame } from '../../tanks/engine.js';
import { TANKS_AUTHORITY, validateTanksRoomCheckpoint } from './tanks-authority.js';
import { authorityForGenericGame, validateGenericGameAction } from './generic-transition-validators.js';
import { NearbyRoomService } from '../nearby-room-service.js';

async function fixture(start = true) {
  const model = new GenericRoomModel(new MemoryStorage());
  const a = await model.create({ code: 'ABC234', game: 'tanks', username: 'Alice' });
  const b = await model.join({ username: 'Bob' });
  const act = async (who, type, fields = {}) => model.act(who.token, { type, expectedVersion: (await model.load()).version, ...fields });
  if (start) await act(a, 'start');
  const turn = async () => (await model.load()).turn.playerId === a.playerId ? a : b;
  const other = who => who.playerId === a.playerId ? b : a;
  return { model, a, b, act, turn, other };
}
async function rejectedUnchanged(model, run, status) {
  const before = await model.load();
  await assert.rejects(run, error => error.status === status);
  assert.deepEqual(await model.load(), before, 'Rejected actions do not mutate the persisted authority');
}
const fireIntent = game => ({ weaponId: game.tanks[game.turn].inventory[0], angle: game.turn === 0 ? 45 : 135, power: 75 });

test('Tanks requires exactly two authenticated seats and authority-created state', async () => {
  assert.deepEqual(GAME_TYPES.tanks, { minPlayers: 2, minSeats: 2, maxSeats: 2 });
  assert.equal(authorityForGenericGame('tanks'), TANKS_AUTHORITY);
  const model = new GenericRoomModel(new MemoryStorage());
  await assert.rejects(() => model.create({ code: 'ABC234', game: 'tanks', username: 'Alice', state: { seed: 1, scores: [999, 0] } }), { status: 400 });
  await assert.rejects(() => model.create({ code: 'ABC234', game: 'tanks', username: 'Alice', maxPlayers: 3 }), { status: 400 });
  const a = await model.create({ code: 'ABC234', game: 'tanks', username: 'Alice' });
  assert.equal(a.room.state.phase, 'lobby');
  assert.equal(a.room.state.game, null);
  await rejectedUnchanged(model, () => model.act(a.token, { type: 'start', expectedVersion: 1 }), 409);
  const b = await model.join({ username: 'Bob' });
  await assert.rejects(() => model.join({ username: 'Cara' }), { status: 409 });
  await assert.rejects(() => model.state('invalid'), { status: 401 });
  await rejectedUnchanged(model, () => model.act(b.token, { type: 'start', expectedVersion: 2 }), 403);
  await rejectedUnchanged(model, () => model.act(a.token, { type: 'start', expectedVersion: 2, seed: 1 }), 400);
  await rejectedUnchanged(model, () => model.act(a.token, { type: 'start', expectedVersion: 2, state: {} }), 400);
});

test('lobby colors belong to each player, terrain belongs to the host, and names lock', async () => {
  const { model, a, b, act } = await fixture(false);
  await act(a, 'configure', { color: '#ABC123', terrainType: 'flat' });
  await act(b, 'configure', { color: '#00ff55' });
  await rejectedUnchanged(model, () => act(b, 'configure', { terrainType: 'random' }), 403);
  await rejectedUnchanged(model, () => act(a, 'configure', { color: 'red' }), 400);
  await rejectedUnchanged(model, () => act(a, 'configure', { terrainType: 'windy' }), 400);
  await rejectedUnchanged(model, () => act(a, 'configure', { color: '#ff0000', seat: 1 }), 400);
  await rejectedUnchanged(model, () => act(a, 'configure'), 400);
  await rejectedUnchanged(model, () => act(a, 'rename', { username: 'Someone else' }), 403);
  const started = await act(a, 'start');
  assert.equal(started.state.game.terrainType, 'flat');
  assert.deepEqual(started.state.game.tanks.map(t => t.name), ['Alice', 'Bob']);
  assert.deepEqual(started.state.game.tanks.map(t => t.color), ['#abc123', '#00ff55']);
  for (const tank of started.state.game.tanks) {
    assert.equal(tank.inventory.length, 10);
    assert.equal(new Set(tank.inventory).size, 10);
    assert.equal(tank.score, 0);
  }
  assert.equal(started.state.game.turn, started.turn.seat);
  validateGame(started.state.game);
  await rejectedUnchanged(model, () => act(a, 'configure', { color: '#000000' }), 409);
  await rejectedUnchanged(model, () => act(a, 'restart', { state: {} }), 400);
  const reconnect = await model.join({ reconnectToken: b.token });
  assert.equal(reconnect.playerId, b.playerId);
  assert.deepEqual(reconnect.room.state, (await model.state(b.token)).state);
});

test('shots enforce numeric bounds, version, seat, inventory, and reject all forged snapshots', async () => {
  const f = await fixture(), { model, act, other } = f;
  const owner = await f.turn(), opponent = other(owner), before = await model.load();
  const intent = fireIntent(before.state.game);
  await rejectedUnchanged(model, () => act(opponent, 'fire', intent), 403);
  for (const extra of [{ state: {} }, { scores: [9999, 0] }, { terrain: [] }, { seed: 1 }, { result: {} }, { finish: true }, { nextSeat: owner.seat }]) {
    await rejectedUnchanged(model, () => act(owner, 'fire', { ...intent, ...extra }), 400);
  }
  for (const invalid of [{ angle: -1 }, { angle: 181 }, { angle: NaN }, { angle: '45' }, { power: 0 }, { power: 101 }, { power: Infinity }, { weaponId: 'invented' }]) {
    await rejectedUnchanged(model, () => act(owner, 'fire', { ...intent, ...invalid }), 400);
  }
  await rejectedUnchanged(model, () => act(owner, 'state', { state: {} }), 400);
  await rejectedUnchanged(model, () => act(owner, { toString: {} }), 400);
  await rejectedUnchanged(model, () => act(owner, 'fire', { ...intent, expectedVersion: before.version - 1 }), 409);
  await rejectedUnchanged(model, () => act(owner, 'fire', { ...intent, expectedVersion: String(before.version) }), 409);
  const expected = applyAction(before.state.game, { type: 'fire', ...intent }, owner.seat);
  const shot = await act(owner, 'fire', intent);
  assert.deepEqual(shot.state.game, expected);
  assert.equal(shot.turn.playerId, opponent.playerId);
  assert.equal(shot.state.game.tanks[owner.seat].inventory.length, 9);
  assert.ok(shot.state.game.tanks.every((tank, seat) => tank.score >= before.state.game.tanks[seat].score));
  await act(opponent, 'fire', fireIntent(shot.state.game));
  await rejectedUnchanged(model, () => act(owner, 'fire', intent), 400);
});

test('four moves retain the turn and ammunition; a rejected fifth or excessive move changes nothing', async () => {
  const f = await fixture(), owner = await f.turn(), { model, act } = f;
  const before = await model.load();
  for (const distance of [151, -151, 0, NaN, '20']) await rejectedUnchanged(model, () => act(owner, 'move', { distance }), 400);
  let moved;
  for (const distance of [20, -20, 20, -20]) moved = await act(owner, 'move', { distance });
  assert.deepEqual(moved.state.game.tanks[owner.seat].inventory, before.state.game.tanks[owner.seat].inventory);
  assert.equal(moved.turn.playerId, owner.playerId);
  assert.equal(moved.turn.number, before.turn.number);
  assert.equal(moved.state.game.tanks[owner.seat].x, before.state.game.tanks[owner.seat].x);
  await rejectedUnchanged(model, () => act(owner, 'move', { distance: 20 }), 400);
});

test('both players get ten shots, scores only rise, and rematches require mutual consent', async () => {
  const f = await fixture(), { model, act, a, b } = f;
  const start = await model.load();
  let room = start;
  for (let shot = 0; shot < 20; shot++) {
    const previous = room.state.game;
    room = await act(await f.turn(), 'fire', fireIntent(previous));
    assert.ok(room.state.game.tanks.every((t, seat) => t.score >= previous.tanks[seat].score));
    assert.equal(room.status, shot === 19 ? 'finished' : 'active');
  }
  assert.equal(room.turn, null);
  assert.deepEqual(room.state.game.tanks.map(t => t.inventory.length), [0, 0]);
  assert.equal(room.result.type, 'tanks');
  assert.deepEqual(room.result.scores, room.state.game.tanks.map(t => t.score));
  validateTanksRoomCheckpoint(await model.load());
  await rejectedUnchanged(model, () => act(a, 'fire', { weaponId: 'cannonball', angle: 45, power: 75 }), 409);
  await act(a, 'rematch');
  assert.equal((await model.load()).status, 'finished');
  await rejectedUnchanged(model, () => act(a, 'rematch'), 409);
  const restarted = await act(b, 'rematch');
  assert.equal(restarted.status, 'active');
  assert.equal(restarted.state.round, 2);
  assert.equal(restarted.state.starterSeat, 1 - start.state.starterSeat);
  assert.deepEqual(restarted.state.rematchVotes, []);
  assert.deepEqual(restarted.state.game.tanks.map(t => t.score), [0, 0]);
  assert.deepEqual(restarted.state.game.tanks.map(t => t.inventory.length), [10, 10]);
  assert.equal(restarted.state.terrainType, start.state.terrainType);
  validateTanksRoomCheckpoint(await model.load());
});

test('abandonment creates no win and public snapshots cannot mutate the authority', async () => {
  const f = await fixture(), snapshot = await f.model.state(f.a.token);
  snapshot.state.game.terrain[0] = 1;
  snapshot.state.colors[0] = '#ffffff';
  assert.notDeepEqual(snapshot.state, (await f.model.state(f.a.token)).state);
  await f.model.act(f.a.token, { type: 'leave' });
  const left = await f.model.state(f.b.token);
  assert.equal(left.status, 'finished');
  assert.equal(left.state.phase, 'finished');
  assert.equal(left.result.type, 'abandoned');
  assert.deepEqual(left.state.game.tanks.map(t => t.score), [0, 0]);
  await assert.rejects(() => f.model.state(f.a.token), { status: 401 });
  await rejectedUnchanged(f.model, () => f.act(f.b, 'rematch'), 409);
  validateTanksRoomCheckpoint(await f.model.load());
});

test('the custom transition prevalidator rejects generic state actions and recognizes legal Tanks intents', async () => {
  const f = await fixture(), room = await f.model.load(), owner = room.members.find(p => p.playerId === room.turn.playerId);
  assert.equal(validateGenericGameAction(room, owner, { type: 'fire', expectedVersion: room.version, ...fireIntent(room.state.game) }), TANKS_AUTHORITY);
  assert.throws(() => validateGenericGameAction(room, owner, { type: 'state', expectedVersion: room.version, state: {} }), { status: 400 });
});

test('Tanks chat reserves animation space using UTF-8 bytes on both transports', async () => {
  const f = await fixture(), originalNow = Date.now;
  let clock = originalNow();
  try {
    Date.now = () => clock += 1000;
    for (let message = 0; message < 100; message++) await f.model.act(f.a.token, { type: 'chat', text: '星'.repeat(500) });
    const room = await f.model.state(f.b.token);
    assert.ok(new TextEncoder().encode(JSON.stringify(room.chat)).byteLength <= 16 * 1024);
    assert.ok(room.chat.length >= 8 && room.chat.length < 100);
    assert.equal(room.chat.at(-1).text, '星'.repeat(500));
    assert.equal(room.version, (await f.model.load()).version);
  } finally { Date.now = originalNow; }
});

test('Nearby RPC and WebSockets share Tanks authority, bindings, checkpoint saves and verified completion', async () => {
  const service = new NearbyRoomService(), events = [];
  service.subscribe(event => events.push(event));
  for (const [memberId, nickname] of [['alice', 'Alice'], ['bob', 'Bob'], ['mallory', 'Mallory']]) await service.registerMember({ memberId, nickname, avatar: '⭐' });
  const http = async (who, path, body, token) => {
    const response = await service.handleHttp(who, { url: '/api/arcade/rooms' + path, method: body === undefined ? 'GET' : 'POST', headers: token ? { authorization: `Bearer ${token}` } : {}, body: body === undefined ? null : JSON.stringify(body) });
    return { status: response.status, ...(typeof response.body === 'string' ? JSON.parse(response.body) : response.body) };
  };
  const a = await http('alice', '', { game: 'tanks', username: 'Spoofed', maxPlayers: 2 });
  const b = await http('bob', `/${a.code}/join`, { username: 'Spoofed too' });
  assert.equal(a.ok, true); assert.equal(b.ok, true);
  assert.deepEqual(b.room.members.map(p => p.username), ['Alice', 'Bob']);
  let version = b.room.version;
  const act = async (who, type, fields = {}) => {
    const result = await http(who, `/${a.code}/actions`, { type, expectedVersion: version, ...fields }, who === 'alice' ? a.token : b.token);
    if (result.ok) version = result.room.version;
    return result;
  };
  await act('alice', 'configure', { color: '#0099ff', terrainType: 'flat' });
  await act('bob', 'configure', { color: '#ff0099' });
  // Control the authority's entropy source, not a client seed field, so the
  // long-chat case always exercises the largest cluster animation.
  let seed = 1;
  while (!createGame({ seed }).tanks[0].inventory.includes('confetti-cannon')) seed++;
  const originalRandom = crypto.getRandomValues;
  crypto.getRandomValues = function (values) {
    if (values instanceof Uint32Array && values.length === 2) { values[0] = seed; values[1] = 0; return values; }
    return originalRandom.call(this, values);
  };
  let result;
  try { result = await act('alice', 'start'); }
  finally { crypto.getRandomValues = originalRandom; }
  assert.equal(result.ok, true);
  const originalNow = Date.now; let clock = originalNow();
  try {
    Date.now = () => clock += 1000;
    for (let index = 0; index < 30; index++) {
      const chat = await http('alice', `/${a.code}/actions`, { type: 'chat', text: '星'.repeat(500) }, a.token);
      assert.equal(chat.ok, true, chat.error);
      assert.ok(new TextEncoder().encode(JSON.stringify(chat.room.chat)).byteLength <= 16 * 1024);
    }
  } finally { Date.now = originalNow; }
  await service.openSocket('alice', { socketId: 'tanks_a', url: `/api/arcade/rooms/${a.code}/ws?token=${a.token}` });
  await service.openSocket('bob', { socketId: 'tanks_b', url: `/api/arcade/rooms/${a.code}/ws?token=${b.token}` });
  const owner = result.room.turn.seat === 0 ? 'alice' : 'bob', other = owner === 'alice' ? 'bob' : 'alice';
  assert.equal((await act(other, 'fire', fireIntent(result.room.state.game))).status, 403);
  assert.equal((await act(owner, 'state', { state: { scores: [999, 0] } })).status, 400);
  assert.equal((await http('mallory', `/${a.code}/state`, undefined, a.token)).status, 403);
  result = await act(owner, 'move', { distance: owner === 'alice' ? 20 : -20 });
  assert.equal(result.ok, true);
  assert.ok(events.filter(e => e.type === 'socket-message').some(e => e.targetMemberId === other && JSON.parse(e.data).room?.version === version));
  const checkpoint = await service.exportCheckpoint();
  const restored = new NearbyRoomService();
  await restored.importCheckpoint(checkpoint);
  const restoreResponse = await restored.handleHttp('bob', { url: `/api/arcade/rooms/${a.code}/state`, method: 'GET', headers: { authorization: `Bearer ${b.token}` }, body: null });
  const restoreBody = typeof restoreResponse.body === 'string' ? JSON.parse(restoreResponse.body) : restoreResponse.body;
  assert.deepEqual(restoreBody.room.state, result.room.state);
  const corrupt = structuredClone(checkpoint);
  corrupt.rooms[0].state.state.game.terrain[0] = -100;
  await assert.rejects(() => restored.importCheckpoint(corrupt), { status: 400 });
  // The rejected restore cannot replace the already restored room.
  assert.equal((await restored.exportCheckpoint()).rooms[0].state.version, checkpoint.rooms[0].state.version);
  for (let shot = 0; shot < 20; shot++) {
    const intent = shot === 0 ? { weaponId: 'confetti-cannon', angle: 90, power: 100 } : fireIntent(result.room.state.game);
    result = await act(result.room.turn.seat === 0 ? 'alice' : 'bob', 'fire', intent);
    assert.equal(result.ok, true, result.error);
    assert.ok(new TextEncoder().encode(JSON.stringify({ type: 'state', room: result.room })).byteLength < 64 * 1024);
    if (shot === 0) assert.ok(JSON.stringify(result.room.state.game).length > 15000);
  }
  assert.equal(result.room.status, 'finished');
  assert.ok(events.some(e => e.type === 'completion' && e.completion?.gameId === 'tanks' && e.completion?.verifiedRules === true));
  const rematchA = await act('alice', 'rematch'); assert.equal(rematchA.room.status, 'finished');
  const rematchB = await act('bob', 'rematch'); assert.equal(rematchB.room.status, 'active');
});
