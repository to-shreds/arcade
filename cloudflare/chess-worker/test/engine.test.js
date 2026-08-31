import test from "node:test";
import assert from "node:assert/strict";
import {
  applyGameMove,
  createGame,
  fromFen,
  insufficientMaterial,
  legalMoves,
  moveToUci,
  perft,
  positionKey,
  squareToIndex,
  toFen
} from "../src/chess-engine.js";

test("start-position perft matches canonical counts", () => {
  const position = createGame().position;
  assert.equal(perft(position, 1), 20);
  assert.equal(perft(position, 2), 400);
  assert.equal(perft(position, 3), 8902);
});

test("canonical Kiwipete perft exercises castling, checks and pinned pieces", () => {
  const position = fromFen("r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1");
  assert.equal(perft(position, 1), 48);
  assert.equal(perft(position, 2), 2039);
  assert.equal(perft(position, 3), 97862);
});

test("castling requires the rook and safe transit squares", () => {
  const open = fromFen("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1");
  const moves = legalMoves(open).map(moveToUci);
  assert.ok(moves.includes("e1g1"));
  assert.ok(moves.includes("e1c1"));
  const noRook = fromFen("4k3/8/8/8/8/8/8/4K3 w KQ - 0 1");
  assert.ok(!legalMoves(noRook).map(moveToUci).includes("e1g1"));
});

test("en passant works and repetition keys include it only when legally usable", () => {
  const legal = fromFen("4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1");
  assert.ok(legalMoves(legal).map(moveToUci).includes("e5d6"));
  assert.match(positionKey(legal), / d6$/);
  const pinned = fromFen("k3r3/8/8/3pP3/8/8/8/4K3 w - d6 0 1");
  assert.ok(!legalMoves(pinned).map(moveToUci).includes("e5d6"));
  assert.match(positionKey(pinned), / -$/);
});

test("promotion requires an explicit legal promotion piece", () => {
  let game = createGame("4k3/P7/8/8/8/8/8/4K3 w - - 0 1");
  assert.throws(() => applyGameMove(game, "a7a8"), /Illegal/);
  game = applyGameMove(game, "a7a8n");
  assert.equal(game.position.board[squareToIndex("a8")], "N");
  assert.equal(game.moves[0].san, "a8=N");
});

test("checkmate, stalemate, threefold and the fifty-move rule are authoritative", () => {
  let mate = createGame();
  for (const uci of ["f2f3", "e7e5", "g2g4", "d8h4"]) mate = applyGameMove(mate, uci);
  assert.deepEqual({ reason: mate.result.reason, winner: mate.result.winner }, { reason: "checkmate", winner: "b" });

  const stale = createGame("7k/5Q2/6K1/8/8/8/8/8 b - - 0 1");
  assert.equal(stale.result.reason, "stalemate");

  let repeated = createGame();
  for (const uci of ["g1f3", "g8f6", "f3g1", "f6g8", "g1f3", "g8f6", "f3g1", "f6g8"]) repeated = applyGameMove(repeated, uci);
  assert.equal(repeated.result.reason, "threefold-repetition");

  let fifty = createGame("4k2r/8/8/8/8/8/8/R3K3 w - - 99 1");
  fifty = applyGameMove(fifty, "a1a2");
  assert.equal(fifty.result.reason, "fifty-move");
});

test("insufficient material is not confused with merely hard-to-mate material", () => {
  assert.equal(insufficientMaterial(fromFen("4k3/8/8/8/8/8/8/4K3 w - - 0 1")), true);
  assert.equal(insufficientMaterial(fromFen("4k3/8/8/8/8/8/8/2B1K3 w - - 0 1")), true);
  assert.equal(insufficientMaterial(fromFen("4k3/8/8/8/8/4b3/8/2B1K3 w - - 0 1")), true);
  assert.equal(insufficientMaterial(fromFen("4k3/8/8/8/8/8/8/1NN1K3 w - - 0 1")), false);
  assert.equal(insufficientMaterial(fromFen("4k3/8/8/8/8/5b2/8/2B1K3 w - - 0 1")), false);
});

test("FEN round trips without discarding counters", () => {
  const fen = "r3k2r/8/8/3pP3/8/8/8/R3K2R w KQkq d6 17 42";
  assert.equal(toFen(fromFen(fen)), fen);
});
