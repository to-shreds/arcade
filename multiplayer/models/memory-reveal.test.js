import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { validateGenericGameAction } from "./generic-transition-validators.js";
const { sanitizeMemorySnapshot } = createRequire(import.meta.url)("../../memory/online-model.js");

function room(game, state, seats = [0, 1], maxPlayers = seats.length) {
  const members = seats.map((seat) => ({ playerId: `p${seat}`, seat, username: `Player ${seat + 1}`, leftAt: null }));
  return { game, state, status: "active", maxPlayers, members, hostPlayerId: members[0].playerId, turn: { seat: seats[0], playerId: members[0].playerId, number: 1 } };
}

function member(seat = 0) { return { playerId: `p${seat}`, seat, username: `Player ${seat + 1}`, leftAt: null }; }
function action(state, extra = {}) { return { type: "state", expectedVersion: 1, state, ...extra }; }

function memoryState() {
  const stat = () => ({ matches: 0, attempts: 0, misses: 0, flips: 0, curStreak: 0, longestStreak: 0, totalDecision: 0, decisionCount: 0, mismatchPairCounts: {}, bestRepeat: 0 });
  return {
    schema: 1, players: 2, seatOrder: [0, 1], names: ["Player 1", "Player 2"], teams: [1, 2], uniqueTeams: [1, 2], teamMode: false,
    teamNames: ["Team 1", "Team 2", "Team 3", "Team 4"], cols: 2, rows: 2, matchSize: 2, freeCount: 0, totalMatches: 2,
    deck: [{ id: "a1", key: "a", emoji: "🍎" }, { id: "a2", key: "a", emoji: "🍎" }, { id: "b1", key: "b", emoji: "🍌" }, { id: "b2", key: "b", emoji: "🍌" }],
    revealed: [], matchedKeys: [], owners: [0, 0, 0, 0], lock: false, awaitingTurn: false, moves: 0, tElapsed: 0,
    scores: [0, 0], turn: 1, stats: [stat(), stat()], sound: true
  };
}

test("Memory validates each visible flip without spending a turn or altering scores", () => {
  const before = memoryState();
  const first = { ...structuredClone(before), revealed: [0] };
  const second = { ...structuredClone(before), revealed: [0, 1], lock: true };
  const apply = (from, to, seat = 0) => validateGenericGameAction(room("memory", from), member(0), action(to, { nextSeat: seat, finish: false }));
  assert.doesNotThrow(() => apply(before, first));
  assert.doesNotThrow(() => apply(first, second));
  assert.throws(() => apply(before, second), /exactly one/);
  assert.throws(() => apply(first, first), /exactly one/);
  assert.throws(() => apply(before, first, 1), /keeps the turn/);
  assert.throws(() => apply(first, { ...second, revealed: [0, 0] }), /revealed cards/);
  assert.throws(() => apply(first, { ...second, revealed: [1, 0] }), /exactly one/);
  assert.throws(() => apply(first, { ...first, revealed: [99] }), /revealed cards/);
  assert.throws(() => apply(second, { ...second, revealed: [0, 2] }), /exactly one/);
  const done = structuredClone(before);
  done.matchedKeys = ["a"]; done.owners = [1, 1, 0, 0]; done.scores = [1, 0]; done.moves = 1;
  Object.assign(done.stats[0], { matches: 1, attempts: 1, flips: 2, curStreak: 1, longestStreak: 1, decisionCount: 1 });
  assert.doesNotThrow(() => apply(second, done));
  assert.throws(() => apply(first, done), /Finish revealing/);
  assert.throws(() => apply(done, { ...structuredClone(done), revealed: [0] }), /revealed cards/);
  const wrongPair = { ...structuredClone(done), matchedKeys: ["b"], owners: [0, 0, 1, 1] };
  assert.throws(() => apply(second, wrongPair), /revealed Memory match/);
});

test("Memory mismatches must resolve the exact revealed cards and pass the turn", () => {
  const before = { ...memoryState(), revealed: [0, 2], lock: true };
  const after = { ...structuredClone(before), revealed: [], lock: false, turn: 2, moves: 1 };
  Object.assign(after.stats[0], { attempts: 1, misses: 1, flips: 2, decisionCount: 1, mismatchPairCounts: { "a|b": 1 }, bestRepeat: 1 });
  const apply = (snapshot, seat = 1) => validateGenericGameAction(room("memory", before), member(0), action(snapshot, { nextSeat: seat, finish: false }));
  assert.doesNotThrow(() => apply(after));
  assert.throws(() => apply(after, 0), /next occupied seat/);
  const forged = structuredClone(after); forged.stats[0].mismatchPairCounts = { "b|b": 1 };
  assert.throws(() => apply(forged), /revealed Memory mismatch/);
});

test("Memory supports three-card reveals and rejects a fourth card", () => {
  const before = memoryState(); before.cols = 3; before.matchSize = 3;
  before.deck = ["a", "a", "a", "b", "b", "b"].map((key, i) => ({ id: "card" + i, key, emoji: key === "a" ? "🍎" : "🍌" }));
  before.owners = Array(6).fill(0);
  let previous = before;
  for(let count = 1; count <= 3; count++) {
    const next = { ...structuredClone(before), revealed: Array.from({length: count}, (_, i) => i), lock: count === 3 };
    assert.doesNotThrow(() => validateGenericGameAction(room("memory", previous), member(0), action(next, { nextSeat: 0, finish: false })));
    previous = next;
  }
  assert.throws(() => validateGenericGameAction(room("memory", previous), member(0), action({ ...previous, revealed: [0, 1, 2, 3] }, { nextSeat: 0 })), /Memory/);
});

test("Memory snapshots retain valid pending reveals and reject malformed cards", () => {
  const before = memoryState();
  const legacy = structuredClone(before); delete legacy.revealed; delete legacy.lock;
  assert.deepEqual(sanitizeMemorySnapshot(legacy, 2).revealed, []);
  for (const revealed of [[0], [0, 1], [0, 2]]) {
    const pending = { ...structuredClone(before), revealed, lock: revealed.length === 2 };
    const clean = sanitizeMemorySnapshot(pending, 2);
    assert.deepEqual(clean.revealed, revealed);
    assert.equal(clean.lock, pending.lock);
  }
  for (const revealed of [[0, 0], [9], ["0"], [-1], [0, 1, 2]]) {
    assert.equal(sanitizeMemorySnapshot({ ...before, revealed, lock: revealed.length === 2 }, 2), null);
  }
  assert.equal(sanitizeMemorySnapshot({ ...before, revealed: [0], lock: true }, 2), null);
  assert.equal(sanitizeMemorySnapshot({ ...before, revealed: [0, 1], lock: false }, 2), null);
  const matched = structuredClone(before);
  matched.matchedKeys = ["a"]; matched.owners = [1, 1, 0, 0]; matched.scores = [1, 0];
  Object.assign(matched.stats[0], { matches: 1, attempts: 1, flips: 2 });
  assert.ok(sanitizeMemorySnapshot(matched, 2));
  assert.equal(sanitizeMemorySnapshot({ ...matched, revealed: [0] }, 2), null);
});
