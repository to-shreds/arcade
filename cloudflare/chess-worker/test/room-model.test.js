import test from "node:test";
import assert from "node:assert/strict";
import { MemoryStorage, RoomModel } from "../src/room-model.js";
import { createGame, squareToIndex } from "../src/chess-engine.js";

async function roomWithTwoPlayers() {
  const model = new RoomModel(new MemoryStorage());
  const white = await model.create("ABC234");
  const black = await model.join();
  return { model, white, black };
}

test("two seats have distinct reconnect tokens and a third player is rejected", async () => {
  const { model, white, black } = await roomWithTwoPlayers();
  assert.equal(white.side, "w");
  assert.equal(black.side, "b");
  assert.notEqual(white.token, black.token);
  await assert.rejects(model.join(), (error) => error.status === 409);
  const reconnected = await model.join(white.token);
  assert.equal(reconnected.side, "w");
  await assert.rejects(model.join("x".repeat(43)), (error) => error.status === 401);
});

test("server rejects wrong turns, stale versions, illegal moves and piece theft", async () => {
  const { model, white, black } = await roomWithTwoPlayers();
  let room = await model.load();
  await assert.rejects(model.act(black.token, { type: "move", uci: "e7e5", expectedVersion: room.version }), (error) => error.status === 403);
  await assert.rejects(model.act(white.token, { type: "move", uci: "e7e5", expectedVersion: room.version }), (error) => error.status === 422);
  const moved = await model.act(white.token, { type: "move", uci: "e2e4", expectedVersion: room.version });
  await assert.rejects(model.act(black.token, { type: "move", uci: "e7e5", expectedVersion: room.version }), (error) => error.status === 409);
  await assert.rejects(model.act(black.token, { type: "move", uci: "d2d4", expectedVersion: moved.version }), (error) => error.status === 422);
  assert.equal(moved.game.turn, "b");
});

test("trusted side actions use the same authoritative path as reconnect-token actions", async () => {
  const { model, black } = await roomWithTwoPlayers();
  let room = await model.load();
  const whiteMove = await model.actAsSide("w", { type: "move", uci: "e2e4", expectedVersion: room.version }, { w: true, b: true });
  assert.equal(whiteMove.game.moves[0].uci, "e2e4");
  assert.deepEqual(whiteMove.presence, { w: true, b: true });
  room = await model.load();
  const blackMove = await model.act(black.token, { type: "move", uci: "e7e5", expectedVersion: room.version }, { w: true, b: true });
  assert.equal(blackMove.game.moves[1].uci, "e7e5");
  assert.equal(blackMove.game.turn, "w");
  await assert.rejects(model.actAsSide("x", { type: "resign", expectedVersion: blackMove.version }), (error) => error.status === 401);
});

test("undo and draw require opponent approval", async () => {
  const { model, white, black } = await roomWithTwoPlayers();
  let room = await model.load();
  await model.act(white.token, { type: "move", uci: "e2e4", expectedVersion: room.version });
  room = await model.load();
  await model.act(white.token, { type: "request-undo", expectedVersion: room.version });
  room = await model.load();
  await assert.rejects(model.act(white.token, { type: "accept-request", expectedVersion: room.version }), (error) => error.status === 403);
  await model.act(black.token, { type: "accept-request", expectedVersion: room.version });
  room = await model.load();
  assert.equal(room.game.moves.length, 0);
  await model.act(black.token, { type: "request-draw", expectedVersion: room.version });
  room = await model.load();
  await model.act(white.token, { type: "accept-request", expectedVersion: room.version });
  room = await model.load();
  assert.equal(room.game.result.reason, "agreement");
});

test("resignation and active state survive a model reconstruction", async () => {
  const storage = new MemoryStorage();
  let model = new RoomModel(storage);
  const white = await model.create("RST789");
  const black = await model.join();
  let room = await model.load();
  await model.act(white.token, { type: "move", uci: "d2d4", expectedVersion: room.version });
  model = new RoomModel(storage);
  const recovered = await model.state(black.token, { w: false, b: true });
  assert.equal(recovered.game.moves[0].uci, "d2d4");
  room = await model.load();
  await model.act(black.token, { type: "resign", expectedVersion: room.version });
  room = await model.load();
  assert.deepEqual({ reason: room.game.result.reason, winner: room.game.result.winner }, { reason: "resignation", winner: "w" });
});

test("leaving Chess is terminal, revokes the seat, and closes an empty lobby without inventing a winner", async () => {
  const model = new RoomModel(new MemoryStorage());
  const host = await model.create("BYE234");
  const left = await model.act(host.token, { type: "leave", expectedVersion: host.room.version });
  assert.equal(left.ready, false);
  assert.equal(left.game.result.over, false, "an empty waiting room is not recorded as a played-game result");
  await assert.rejects(model.state(host.token), (error) => error.status === 401);
  await assert.rejects(model.join(), (error) => error.status === 410);
});

test("leaving an active Chess room is an authoritative resignation and preserves the opponent's result", async () => {
  const { model, white, black } = await roomWithTwoPlayers();
  const room = await model.load();
  const left = await model.act(white.token, { type: "leave", expectedVersion: room.version });
  assert.deepEqual(
    { reason: left.game.result.reason, winner: left.game.result.winner },
    { reason: "resignation", winner: "b" }
  );
  await assert.rejects(model.state(white.token), (error) => error.status === 401);
  const opponent = await model.state(black.token);
  assert.equal(opponent.game.result.winner, "b");
  await assert.rejects(model.join(), (error) => error.status === 410);
});

test("the room protocol applies castling, en passant and promotion through server validation", async () => {
  const { model, white } = await roomWithTwoPlayers();
  let room = await model.load();
  room.game = createGame("4k3/8/8/8/8/8/8/4K2R w K - 0 1");
  room.version++;
  await model.save(room);
  await model.act(white.token, { type: "move", uci: "e1g1", expectedVersion: room.version });
  room = await model.load();
  assert.equal(room.game.position.board[squareToIndex("g1")], "K");
  assert.equal(room.game.position.board[squareToIndex("f1")], "R");

  room.game = createGame("4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1");
  room.version++;
  await model.save(room);
  await model.act(white.token, { type: "move", uci: "e5d6", expectedVersion: room.version });
  room = await model.load();
  assert.equal(room.game.position.board[squareToIndex("d6")], "P");
  assert.equal(room.game.position.board[squareToIndex("d5")], null);

  room.game = createGame("4k3/P7/8/8/8/8/8/4K3 w - - 0 1");
  room.version++;
  await model.save(room);
  await model.act(white.token, { type: "move", uci: "a7a8q", expectedVersion: room.version });
  room = await model.load();
  assert.equal(room.game.position.board[squareToIndex("a8")], "Q");
});
