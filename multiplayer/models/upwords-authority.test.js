import test from 'node:test';
import assert from 'node:assert/strict';
import { GenericRoomModel, GAME_TYPES } from './generic-room-model.js';
import { MemoryStorage } from './room-model.js';
import { createGame, validateGame } from '../../upwords/engine.js';
import { DICTIONARY_ID } from '../../upwords/dictionary.js';
import { UPWORDS_AUTHORITY, validateUpwordsRoomCheckpoint } from './upwords-authority.js';
import { authorityForGenericGame, validateGenericGameAction } from './generic-transition-validators.js';
import { NearbyRoomService } from '../nearby-room-service.js';

async function fixture(start = true) {
  const model = new GenericRoomModel(new MemoryStorage());
  const a = await model.create({ code: 'ABC234', game: 'upwords', username: 'Alice' });
  const b = await model.join({ username: 'Bob' });
  const act = async (who, type, fields = {}) => model.act(who.token, { type, dictionaryId: DICTIONARY_ID, expectedVersion: (await model.load()).version, ...fields });
  if (start) await act(a, 'start');
  const turn = async () => (await model.load()).turn.playerId === a.playerId ? a : b;
  const other = who => who.playerId === a.playerId ? b : a;
  return { model, a, b, act, turn, other };
}
async function rejectedUnchanged(model, run, status) {
  const before = await model.load();
  await assert.rejects(run, error => error.status === status);
  assert.deepEqual(await model.load(), before, 'A rejected action must not mutate authority storage');
}
function assertPrivate(game, seat) {
  for (const key of ['seed', 'rng', 'bag']) assert.equal(Object.hasOwn(game, key), false, `${key} remains private`);
  assert.equal(Object.hasOwn(game.players[1 - seat], 'rack'), false, 'Opponent rack is absent, not merely hidden by the UI');
  assert.equal(game.players[seat].rack.length, game.players[seat].rackCount);
  assert.equal(typeof game.bagCount, 'number');
  for (const move of [game.lastMove, ...game.history].filter(Boolean)) {
    for (const key of ['rack', 'rackIndex', 'bag', 'drawn', 'exchanged', 'seed', 'rng']) assert.equal(Object.hasOwn(move, key), false);
    if (move.type === 'exchange') assert.deepEqual(move.placements, []);
  }
}
function setRack(game, seat, letters) {
  // This is authority test setup, never a client action. Swapping real tiles
  // retains all 100 tiles and lets scoring assertions use a known real word.
  for (let i = 0; i < letters.length; i++) {
    if (game.players[seat].rack[i] === letters[i]) continue;
    const bagIndex = game.bag.indexOf(letters[i]);
    assert.ok(bagIndex >= 0, `Fixture bag contains ${letters[i]}`);
    [game.players[seat].rack[i], game.bag[bagIndex]] = [game.bag[bagIndex], game.players[seat].rack[i]];
  }
  validateGame(game);
}
async function knownRacks(f) {
  const room = await f.model.load();
  const game = createGame({ seed: 12345, names: ['Alice', 'Bob'], starter: 0 });
  setRack(game, 0, ['C', 'A', 'T', 'E', 'R', 'N', 'S']);
  setRack(game, 1, ['B', 'J', 'I', 'O', 'D', 'L', 'U']);
  room.state.game = game; room.state.starterSeat = 0;
  room.turn = { playerId: f.a.playerId, seat: 0, number: 1 };
  await f.model.save(room);
  return room;
}
const CAT = [{ row: 4, col: 3, rackIndex: 0 }, { row: 4, col: 4, rackIndex: 1 }, { row: 4, col: 5, rackIndex: 2 }];

test('Upwords creates exactly two authority-owned seats and publishes its fixed dictionary', async () => {
  assert.deepEqual(GAME_TYPES.upwords, { minPlayers: 2, minSeats: 2, maxSeats: 2 });
  assert.equal(authorityForGenericGame('upwords'), UPWORDS_AUTHORITY);
  const model = new GenericRoomModel(new MemoryStorage());
  await assert.rejects(() => model.create({ code: 'ABC234', game: 'upwords', username: 'Alice', state: { score: 999 } }), { status: 400 });
  await assert.rejects(() => model.create({ code: 'ABC234', game: 'upwords', username: 'Alice', maxPlayers: 3 }), { status: 400 });
  const a = await model.create({ code: 'ABC234', game: 'upwords', username: 'Alice' });
  assert.equal(a.room.state.dictionaryId, DICTIONARY_ID);
  assert.equal(a.room.state.game, null);
  validateUpwordsRoomCheckpoint(await model.load());
  await rejectedUnchanged(model, () => model.act(a.token, { type: 'start', expectedVersion: 1, dictionaryId: DICTIONARY_ID }), 409);
  const b = await model.join({ username: 'Bob' });
  await assert.rejects(() => model.join({ username: 'Cara' }), { status: 409 });
  await rejectedUnchanged(model, () => model.act(b.token, { type: 'start', expectedVersion: 2, dictionaryId: DICTIONARY_ID }), 403);
  for (const extra of [{ state: {} }, { seed: 2 }, { firstSeat: 1 }, { dictionaryId: 'other-list' }]) {
    await rejectedUnchanged(model, () => model.act(a.token, { type: 'start', expectedVersion: 2, dictionaryId: DICTIONARY_ID, ...extra }), extra.dictionaryId ? 409 : 400);
  }
  await rejectedUnchanged(model, () => model.act(a.token, { type: 'start', expectedVersion: 2 }), 409);
});

test('HTTP-style states and reconnects expose only the authenticated rack; observers get none', async () => {
  const { model, a, b, act } = await fixture();
  const raw = await model.load();
  const sa = await model.state(a.token), sb = await model.state(b.token);
  assertPrivate(sa.state.game, 0); assertPrivate(sb.state.game, 1);
  assert.deepEqual(sa.state.game.players[0].rack, raw.state.game.players[0].rack);
  assert.deepEqual(sb.state.game.players[1].rack, raw.state.game.players[1].rack);
  assert.deepEqual(sa.state.game.board, sb.state.game.board);
  assert.deepEqual(sa.state.game.players.map(player => player.name), ['Alice', 'Bob']);
  assert.equal(sa.state.game.bagCount, 86);
  for (const viewer of [null, 'unknown']) {
    const state = model.public(raw, viewer).state.game;
    assert.ok(state.players.every(player => !Object.hasOwn(player, 'rack')));
  }
  sa.state.game.players[0].rack[0] = 'INVALID'; sa.state.game.board[0][0].push('A');
  assert.deepEqual((await model.load()).state, raw.state);
  const reconnect = await model.join({ reconnectToken: b.token });
  assert.equal(reconnect.playerId, b.playerId);
  assert.deepEqual(reconnect.room.state, sb.state);
  await assert.rejects(() => model.state('wrong-token'), { status: 401 });
  await rejectedUnchanged(model, () => act(a, 'rename', { username: 'Mallory' }), 403);
});

test('placements are computed by the authority and reject stale, invalid, out-of-turn and forged moves', async () => {
  const f = await fixture(); await knownRacks(f);
  const { model, a, b, act } = f;
  const version = (await model.load()).version;
  await rejectedUnchanged(model, () => act(b, 'play', { placements: CAT }), 403);
  for (const extra of [{ state: {} }, { score: 1000 }, { finish: true }, { nextSeat: 0 }, { approved: true }, { words: ['CAT'] }, { seed: 1 }]) {
    await rejectedUnchanged(model, () => act(a, 'play', { placements: CAT, ...extra }), 400);
  }
  for (const placements of [[], [...CAT, CAT[0]], [{ ...CAT[0], row: -1 }], [{ ...CAT[0], col: 10 }], [{ ...CAT[0], rackIndex: '0' }], [{ ...CAT[0], tile: 'C' }], [null], [{ row: 0, col: 0, rackIndex: 0 }]]) {
    await rejectedUnchanged(model, () => act(a, 'play', { placements }), 400);
  }
  await rejectedUnchanged(model, () => act(a, 'play', { placements: CAT, dictionaryId: 'stale-dictionary' }), 409);
  await rejectedUnchanged(model, () => act(a, 'play', { placements: CAT, expectedVersion: version - 1 }), 409);
  await rejectedUnchanged(model, () => act(a, 'play', { placements: CAT, expectedVersion: String(version) }), 409);
  await rejectedUnchanged(model, () => act(a, 'state', { state: {} }), 400);
  await rejectedUnchanged(model, () => act(a, 'restart'), 400);
  const played = await act(a, 'play', { placements: CAT });
  assert.equal(played.state.game.players[0].score, 6, 'Three unstacked tiles score six');
  assert.equal(played.state.game.lastMove.words[0].word, 'CAT');
  assert.equal(played.turn.playerId, b.playerId);
  assert.equal(played.turn.number, 2);
  assert.equal(played.state.game.bagCount, 83);
  assertPrivate(played.state.game, 0);
  // J on A would turn CAT into CJT, so the unchanged shared dictionary rejects it.
  await rejectedUnchanged(model, () => act(b, 'play', { placements: [{ row: 4, col: 4, rackIndex: 1 }] }), 400);
  const stacked = await act(b, 'play', { placements: [{ row: 4, col: 3, rackIndex: 0 }] });
  assert.equal(stacked.state.game.lastMove.words[0].word, 'BAT');
  assert.equal(stacked.state.game.players[1].score, 4, 'Stack height two plus two single tiles scores four');
  assert.deepEqual(stacked.state.game.board[4][3], ['C', 'B']);
  assertPrivate(stacked.state.game, 1);
  validateUpwordsRoomCheckpoint(await model.load());
});

test('exchange keeps tile identities private and pass ending applies penalties once with mutual rematches', async () => {
  const f = await fixture(), { model, a, b, act } = f;
  const before = await model.load(), owner = await f.turn();
  for (const rackIndex of [-1, 7, 0.5, '0', null]) await rejectedUnchanged(model, () => act(owner, 'exchange', { rackIndex }), 400);
  const changed = await act(owner, 'exchange', { rackIndex: 0 });
  assertPrivate(changed.state.game, owner.seat);
  assert.equal(changed.state.game.bagCount, 86);
  assert.equal(changed.state.game.moveNumber, 1);
  assert.equal(changed.state.game.lastMove.type, 'exchange');
  assert.equal(changed.turn.playerId, f.other(owner).playerId);
  await act(await f.turn(), 'pass');
  const finished = await act(await f.turn(), 'pass');
  assert.equal(finished.status, 'finished');
  assert.equal(finished.turn, null);
  assert.equal(finished.state.game.endReason, 'passes');
  assert.deepEqual(finished.result.scores, [-35, -35]);
  assert.equal(finished.result.winnerSeat, null);
  assert.equal(finished.result.winnerPlayerId, null);
  validateUpwordsRoomCheckpoint(await model.load());
  await rejectedUnchanged(model, () => act(a, 'pass'), 409);
  await act(a, 'rematch');
  assert.equal((await model.load()).status, 'finished');
  await rejectedUnchanged(model, () => act(a, 'rematch'), 409);
  const rematch = await act(b, 'rematch');
  assert.equal(rematch.state.round, 2);
  assert.equal(rematch.state.starterSeat, 1 - before.state.starterSeat);
  assert.equal(rematch.status, 'active');
  assert.deepEqual(rematch.state.game.players.map(player => player.score), [0, 0]);
  assertPrivate(rematch.state.game, 1);
});

test('abandonment awards no win and the prevalidator rejects unauthorized state replacement', async () => {
  const f = await fixture(), raw = await f.model.load(), owner = raw.members.find(player => player.playerId === raw.turn.playerId);
  assert.equal(validateGenericGameAction(raw, owner, { type: 'pass', expectedVersion: raw.version, dictionaryId: DICTIONARY_ID }), UPWORDS_AUTHORITY);
  assert.throws(() => validateGenericGameAction(raw, owner, { type: 'state', expectedVersion: raw.version, dictionaryId: DICTIONARY_ID, state: {} }), { status: 400 });
  await f.model.act(f.a.token, { type: 'leave' });
  const remaining = await f.model.state(f.b.token);
  assert.equal(remaining.status, 'finished'); assert.equal(remaining.state.phase, 'finished');
  assert.equal(remaining.result.type, 'abandoned');
  assert.equal(remaining.result.winnerPlayerId, undefined);
  await assert.rejects(() => f.model.state(f.a.token), { status: 401 });
  await rejectedUnchanged(f.model, () => f.act(f.b, 'rematch'), 409);
  validateUpwordsRoomCheckpoint(await f.model.load());
});

test('checkpoint validation rejects wrong lists, corrupt tiles, mismatched identities, turns and results', async () => {
  const f = await fixture(), original = await f.model.load();
  for (const corrupt of [
    room => { room.state.dictionaryId = 'old'; },
    room => { room.state.game.bag.push('A'); },
    room => { room.state.game.players[0].name = 'Imposter'; },
    room => { room.turn.playerId = f.other(original.turn.playerId === f.a.playerId ? f.a : f.b).playerId; },
    room => { room.turn.number = 10; },
    room => { room.state.rematchVotes.push(f.a.playerId); }
  ]) {
    const room = structuredClone(original); corrupt(room);
    assert.throws(() => validateUpwordsRoomCheckpoint(room), { status: 400 });
  }
  await f.act(await f.turn(), 'pass'); await f.act(await f.turn(), 'pass');
  const finished = await f.model.load(); finished.result.scores[0] = 1000;
  assert.throws(() => validateUpwordsRoomCheckpoint(finished), { status: 400 });
});

test('Nearby uses private per-viewer broadcasts, fixed dictionaries, bounded chat and resumable authority checkpoints', async () => {
  const service = new NearbyRoomService(), events = [];
  service.subscribe(event => events.push(event));
  for (const [memberId, nickname] of [['alice', 'Alice'], ['bob', 'Bob'], ['mallory', 'Mallory']]) await service.registerMember({ memberId, nickname, avatar: '⭐' });
  const http = async (who, path, body, token) => {
    const response = await service.handleHttp(who, { url: '/api/arcade/rooms' + path, method: body === undefined ? 'GET' : 'POST', headers: token ? { authorization: `Bearer ${token}` } : {}, body: body === undefined ? null : JSON.stringify(body) });
    return { status: response.status, ...(typeof response.body === 'string' ? JSON.parse(response.body) : response.body) };
  };
  const a = await http('alice', '', { game: 'upwords', username: 'Fake name', maxPlayers: 2 });
  const b = await http('bob', `/${a.code}/join`, { username: 'Another fake' });
  assert.equal(a.ok, true); assert.equal(b.ok, true);
  assert.deepEqual(b.room.members.map(player => player.username), ['Alice', 'Bob']);
  let version = b.room.version;
  const act = async (who, type, fields = {}) => {
    const result = await http(who, `/${a.code}/actions`, { type, dictionaryId: DICTIONARY_ID, expectedVersion: version, ...fields }, who === 'alice' ? a.token : b.token);
    if (result.ok) version = result.room.version;
    return result;
  };
  assert.equal((await act('alice', 'start', { dictionaryId: 'wrong' })).status, 409);
  let result = await act('alice', 'start'); assert.equal(result.ok, true);
  assertPrivate(result.room.state.game, 0);
  const guest = await http('bob', `/${a.code}/state`, undefined, b.token);
  assertPrivate(guest.room.state.game, 1);
  assert.equal((await http('mallory', `/${a.code}/state`, undefined, a.token)).status, 403);
  await service.openSocket('alice', { socketId: 'upwords_a', url: `/api/arcade/rooms/${a.code}/ws?token=${a.token}` });
  await service.openSocket('bob', { socketId: 'upwords_b', url: `/api/arcade/rooms/${a.code}/ws?token=${b.token}` });
  const owner = result.room.turn.seat === 0 ? 'alice' : 'bob';
  result = await act(owner, 'exchange', { rackIndex: 0 }); assert.equal(result.ok, true, result.error);
  for (const event of events.filter(event => event.type === 'socket-message')) {
    const payload = JSON.parse(event.data);
    if (payload.type === 'state' && payload.room?.state.game) assertPrivate(payload.room.state.game, event.targetMemberId === 'alice' ? 0 : 1);
  }
  const checkpoint = await service.exportCheckpoint(), restored = new NearbyRoomService();
  await restored.importCheckpoint(checkpoint);
  const restoreResponse = await restored.handleHttp('bob', { url: `/api/arcade/rooms/${a.code}/state`, method: 'GET', headers: { authorization: `Bearer ${b.token}` }, body: null });
  const restoreBody = typeof restoreResponse.body === 'string' ? JSON.parse(restoreResponse.body) : restoreResponse.body;
  assert.deepEqual(restoreBody.room.state, (await http('bob', `/${a.code}/state`, undefined, b.token)).room.state);
  const corrupt = structuredClone(checkpoint); corrupt.rooms[0].state.state.game.bag.push('A');
  await assert.rejects(() => restored.importCheckpoint(corrupt), { status: 400 });
  assert.equal((await restored.exportCheckpoint()).rooms[0].state.version, checkpoint.rooms[0].state.version);
  const originalNow = Date.now; let clock = originalNow();
  try {
    Date.now = () => clock += 1000;
    for (let i = 0; i < 30; i++) {
      const chat = await http('alice', `/${a.code}/actions`, { type: 'chat', text: '星'.repeat(500) }, a.token);
      assert.equal(chat.ok, true, chat.error);
      assert.ok(new TextEncoder().encode(JSON.stringify(chat.room.chat)).byteLength <= 16 * 1024);
    }
  } finally { Date.now = originalNow; }
  result = await act(result.room.turn.seat === 0 ? 'alice' : 'bob', 'pass');
  result = await act(result.room.turn.seat === 0 ? 'alice' : 'bob', 'pass');
  assert.equal(result.room.status, 'finished');
  assert.ok(new TextEncoder().encode(JSON.stringify({ type: 'state', room: result.room })).byteLength < 64 * 1024);
  assert.ok(events.some(event => event.type === 'completion' && event.completion?.gameId === 'upwords' && event.completion?.verifiedRules === true));
  assert.equal((await act('alice', 'rematch')).room.status, 'finished');
  assert.equal((await act('bob', 'rematch')).room.status, 'active');
});

test('old dictionary rooms resume with the expanded list and reject stale clients', async () => {
  const f = await fixture();
  const room = await f.model.load();
  const oldId = 'esdb80-us-1e5b7d3-4c74138a7145-s9fe0dbe2';
  room.state.dictionaryId = oldId;
  room.state.game.dictionaryId = oldId;
  validateUpwordsRoomCheckpoint(room);
  await f.model.save(room);
  const owner = await f.turn();
  await rejectedUnchanged(f.model, () => f.act(owner, 'pass', { dictionaryId: oldId }), 409);
  const result = await f.act(owner, 'pass');
  assert.equal(result.state.dictionaryId, DICTIONARY_ID);
  assert.equal(result.state.game.dictionaryId, DICTIONARY_ID);
  const stored = await f.model.load();
  assert.equal(stored.state.game.dictionaryId, DICTIONARY_ID);
  assert.equal(stored.state.dictionaryId, DICTIONARY_ID);
  validateUpwordsRoomCheckpoint(stored);
});
