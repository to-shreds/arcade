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
  assert.equal(moved.game.turn, "b");
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
