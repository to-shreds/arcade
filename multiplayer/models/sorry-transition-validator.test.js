import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { SORRY_AUTHORITY, __test as sorryRules, validateSorryStart, validateSorryTransition } from "./sorry-transition-validator.js";

const CARD_COUNTS = { "1": 5, "2": 4, "3": 4, "4": 4, "5": 4, "7": 4, "8": 4, "10": 4, "11": 4, "12": 4, S: 4 };

function completeDeck() {
  return Object.entries(CARD_COUNTS).flatMap(([card, count]) => Array(count).fill(card));
}

function takeCard(cards, card) {
  const index = cards.indexOf(card);
  assert.notEqual(index, -1, `fixture is missing ${card}`);
  cards.splice(index, 1);
  return card;
}

function players() {
  return [
    { id: 0, name: "Logan", colorIndex: 0, color: "red", cpu: false, seat: 0, memberId: "p0" },
    { id: 1, name: "Scarlett", colorIndex: 1, color: "blue", cpu: false, seat: 1, memberId: "p1" }
  ];
}

function baseState(mode = "classic") {
  const list = players();
  return {
    version: 5,
    started: true,
    mode,
    skill: 2,
    showEndpoints: true,
    players: list,
    pawns: Array.from({ length: list.length * 3 }, (_, id) => ({ id, player: Math.floor(id / 3), slot: id % 3, zone: "start", pos: 0 })),
    turn: 0,
    deck: completeDeck(),
    discard: [],
    hands: [[], []],
    firePawnId: null,
    icePawnId: null,
    currentCard: null,
    phase: "draw",
    selectedCardIndex: null,
    flow: {},
    winner: null,
    moveNo: 0,
    savedAt: 1,
    pendingFirePull: false,
    online: true
  };
}

function room(state, status = "active") {
  return {
    game: "sorry",
    state,
    status,
    maxPlayers: 2,
    hostPlayerId: "p0",
    members: [
      { playerId: "p0", seat: 0, username: "Logan", leftAt: null },
      { playerId: "p1", seat: 1, username: "Scarlett", leftAt: null }
    ],
    turn: status === "active" ? { seat: state.players[state.turn].seat, playerId: `p${state.players[state.turn].seat}`, number: 1 } : null
  };
}

function member(seat = 0) {
  return { playerId: `p${seat}`, seat, username: seat ? "Scarlett" : "Logan", leftAt: null };
}

function stateAction(state, options = {}) {
  return { type: "state", expectedVersion: 1, state, ...options };
}

function putCardOnTop(state, card) {
  takeCard(state.deck, card);
  state.deck.push(card);
}

function beginPlayedCard(state, card) {
  takeCard(state.deck, card);
  state.currentCard = card;
  state.phase = "action";
}

function finishRegular(before, update, nextTurn = 1) {
  const after = structuredClone(before);
  update(after);
  after.discard.push(after.currentCard);
  after.currentCard = null;
  after.selectedCardIndex = null;
  after.turn = nextTurn;
  after.phase = "draw";
  after.flow = {};
  after.pendingFirePull = false;
  return after;
}

function strategicState() {
  const state = baseState("strategic");
  state.phase = "chooseCard";
  const desired = [["3", "4", "5", "7", "8"], ["1", "2", "10", "11", "12"]];
  state.hands = desired.map((hand) => hand.map((card) => takeCard(state.deck, card)));
  return state;
}

test("Sorry start binds locked identities and rejects a nested name spoof", () => {
  const state = baseState(), lobby = room(state, "lobby");
  assert.doesNotThrow(() => validateSorryStart(lobby, { type: "start", state, firstSeat: 0 }));
  const spoofed = structuredClone(state);
  spoofed.players[0].name = "Definitely Not Logan";
  assert.throws(() => validateSorryStart(lobby, { type: "start", state: spoofed, firstSeat: 0 }), /locked room membership/);
  assert.equal(SORRY_AUTHORITY.ruleValidated, true);
  assert.equal(SORRY_AUTHORITY.completionVerified, true);
});

test("Sorry draw must use the canonical top card, not a preferred card from the middle", () => {
  const before = baseState();
  putCardOnTop(before, "3");
  const legal = structuredClone(before);
  assert.equal(legal.deck.pop(), "3");
  legal.currentCard = "3";
  legal.phase = "action";
  assert.doesNotThrow(() => validateSorryTransition(room(before), member(0), stateAction(legal, { nextSeat: 0 })));

  const chosen = structuredClone(before);
  takeCard(chosen.deck, "12");
  chosen.currentCard = "12";
  chosen.phase = "action";
  assert.throws(() => validateSorryTransition(room(before), member(0), stateAction(chosen, { nextSeat: 0 })), /next legal card/);
});

test("Nearby Sorry uses a versioned deterministic reshuffle and rejects an arbitrary replacement order", () => {
  const before = baseState();
  before.deck = [];
  before.discard = completeDeck();
  const shuffled = sorryRules.authorityShuffle(before.discard, before);
  assert.equal(shuffled.join(","), "1,1,3,2,8,5,12,11,10,4,12,4,S,11,5,10,12,3,8,S,10,2,7,10,S,1,7,S,7,5,1,4,4,3,11,12,8,7,2,11,3,5,2,8,1");
  const html = readFileSync(new URL("../../sorry/index.html", import.meta.url), "utf8");
  const start = html.indexOf("function nearbyAuthorityShuffle");
  const end = html.indexOf("function blurActiveInput", start);
  assert.ok(start >= 0 && end > start, "Sorry bundles the Nearby authority reshuffle locally");
  const sandbox = {};
  vm.runInNewContext(`${html.slice(start, end)};this.result=nearbyAuthorityShuffle(${JSON.stringify(before.discard)},${JSON.stringify({ moveNo: before.moveNo, turn: before.turn })});`, sandbox);
  assert.deepEqual(Array.from(sandbox.result), shuffled, "browser and host use the same reshuffle order");
  const legal = structuredClone(before);
  legal.deck = shuffled;
  legal.discard = [];
  legal.currentCard = legal.deck.pop();
  legal.phase = "action";
  assert.equal(legal.currentCard, "1");
  assert.doesNotThrow(() => validateSorryTransition(room(before), member(0), stateAction(legal, { nextSeat: 0 })));

  const forged = structuredClone(legal);
  forged.deck.reverse();
  assert.throws(() => validateSorryTransition(room(before), member(0), stateAction(forged, { nextSeat: 0 })), /next legal card/);
});

test("Sorry accepts a positive-card Start move and blocks repeated cardless motion", () => {
  const before = baseState();
  beginPlayedCard(before, "3");
  const after = finishRegular(before, (state) => {
    state.pawns[0].zone = "track";
    state.pawns[0].pos = 6;
    state.moveNo++;
  });
  assert.doesNotThrow(() => validateSorryTransition(room(before), member(0), stateAction(after, { nextSeat: 1 })));

  const repeated = structuredClone(after);
  repeated.pawns[0].pos = 59;
  repeated.moveNo++;
  assert.throws(() => validateSorryTransition(room(after), member(1), stateAction(repeated, { nextSeat: 1 })), /next legal card/);
});

test("Sorry validates an exact split 7 across two pawns", () => {
  const before = baseState();
  beginPlayedCard(before, "7");
  before.pawns[0] = { ...before.pawns[0], zone: "track", pos: 5 };
  before.pawns[1] = { ...before.pawns[1], zone: "track", pos: 20 };
  const after = finishRegular(before, (state) => {
    state.pawns[0].pos = 8;
    state.pawns[1].pos = 28;
    state.moveNo++;
  });
  assert.doesNotThrow(() => validateSorryTransition(room(before), member(0), stateAction(after, { nextSeat: 1 })));

  const fabricated = structuredClone(after);
  fabricated.pawns[0].pos = 9;
  assert.throws(() => validateSorryTransition(room(before), member(0), stateAction(fabricated, { nextSeat: 1 })), /next legal card/);
});

test("Sorry validates 11 switches and rejects an arbitrary pawn exchange", () => {
  const before = baseState();
  beginPlayedCard(before, "11");
  before.pawns[0] = { ...before.pawns[0], zone: "track", pos: 5 };
  before.pawns[3] = { ...before.pawns[3], zone: "track", pos: 10 };
  const after = finishRegular(before, (state) => {
    state.pawns[0].pos = 10;
    state.pawns[3].pos = 5;
    state.moveNo++;
  });
  assert.doesNotThrow(() => validateSorryTransition(room(before), member(0), stateAction(after, { nextSeat: 1 })));

  const arbitrary = structuredClone(after);
  arbitrary.pawns[3].pos = 6;
  assert.throws(() => validateSorryTransition(room(before), member(0), stateAction(arbitrary, { nextSeat: 1 })), /next legal card/);
});

test("Sorry validates the SORRY! bump and its exact target", () => {
  const before = baseState();
  beginPlayedCard(before, "S");
  before.pawns[3] = { ...before.pawns[3], zone: "track", pos: 20 };
  const after = finishRegular(before, (state) => {
    state.pawns[0].zone = "track";
    state.pawns[0].pos = 20;
    state.pawns[3].zone = "start";
    state.pawns[3].pos = 0;
    state.moveNo++;
  });
  assert.doesNotThrow(() => validateSorryTransition(room(before), member(0), stateAction(after, { nextSeat: 1 })));

  const wrongTarget = structuredClone(after);
  wrongTarget.pawns[3].zone = "track";
  wrongTarget.pawns[3].pos = 21;
  assert.throws(() => validateSorryTransition(room(before), member(0), stateAction(wrongTarget, { nextSeat: 1 })), /next legal card/);
});

test("Sorry verifies Strategic hand choice, card replacement, and turn progression", () => {
  const before = strategicState();
  const chosen = structuredClone(before);
  chosen.currentCard = "3";
  chosen.selectedCardIndex = 0;
  chosen.phase = "action";
  assert.doesNotThrow(() => validateSorryTransition(room(before), member(0), stateAction(chosen, { nextSeat: 0 })));

  const replacement = chosen.deck.at(-1);
  const after = structuredClone(chosen);
  after.pawns[0].zone = "track";
  after.pawns[0].pos = 6;
  after.moveNo++;
  after.hands[0].splice(0, 1);
  after.discard.push("3");
  assert.equal(after.deck.pop(), replacement);
  after.hands[0].push(replacement);
  after.currentCard = null;
  after.selectedCardIndex = null;
  after.turn = 1;
  after.phase = "chooseCard";
  after.flow = {};
  assert.doesNotThrow(() => validateSorryTransition(room(chosen), member(0), stateAction(after, { nextSeat: 1 })));

  const handCheat = structuredClone(after);
  handCheat.hands[0][0] = "12";
  assert.throws(() => validateSorryTransition(room(chosen), member(0), stateAction(handCheat, { nextSeat: 1 })), /conserved|next legal card/);
});

test("Sorry accepts a no-move backward 4 pass only after drawing the real top card", () => {
  const before = baseState();
  putCardOnTop(before, "4");
  const after = structuredClone(before);
  assert.equal(after.deck.pop(), "4");
  after.discard.push("4");
  after.turn = 1;
  assert.doesNotThrow(() => validateSorryTransition(room(before), member(0), stateAction(after, { nextSeat: 1 })));
});

test("Sorry Fire jump is an exact optional same-turn bonus", () => {
  const before = baseState("fireIce");
  before.phase = "preFire";
  before.firePawnId = 0;
  before.pawns[0] = { ...before.pawns[0], zone: "track", pos: 10 };
  const used = structuredClone(before);
  used.pawns[0].pos = 15;
  used.phase = "draw";
  assert.doesNotThrow(() => validateSorryTransition(room(before), member(0), stateAction(used, { nextSeat: 0 })));

  const leap = structuredClone(used);
  leap.pawns[0].pos = 30;
  assert.throws(() => validateSorryTransition(room(before), member(0), stateAction(leap, { nextSeat: 0 })), /next legal card/);
});

test("Sorry verifies Fire pull and a legal completion result", () => {
  const before = baseState("fireIce");
  beginPlayedCard(before, "1");
  before.firePawnId = 0;
  before.pawns[0] = { ...before.pawns[0], zone: "safety", pos: 4 };
  before.pawns[1] = { ...before.pawns[1], zone: "track", pos: 8 };
  const pull = structuredClone(before);
  pull.pawns[0].zone = "home";
  pull.pawns[0].pos = 0;
  pull.moveNo++;
  pull.phase = "firePull";
  pull.pendingFirePull = true;
  assert.doesNotThrow(() => validateSorryTransition(room(before), member(0), stateAction(pull, { nextSeat: 0 })));

  const completedBefore = baseState();
  beginPlayedCard(completedBefore, "1");
  completedBefore.pawns[0].zone = "home";
  completedBefore.pawns[1].zone = "home";
  completedBefore.pawns[2] = { ...completedBefore.pawns[2], zone: "safety", pos: 4 };
  const completed = structuredClone(completedBefore);
  completed.pawns[2].zone = "home";
  completed.pawns[2].pos = 0;
  completed.moveNo++;
  completed.winner = 0;
  completed.phase = "gameOver";
  const result = { winnerSeat: 0, winnerName: "Logan", reason: "home" };
  assert.doesNotThrow(() => validateSorryTransition(room(completedBefore), member(0), stateAction(completed, { finish: true, result })));

  const fireWinBefore = baseState("fireIce");
  beginPlayedCard(fireWinBefore, "1");
  fireWinBefore.pawns[0].zone = "home";
  fireWinBefore.pawns[1].zone = "home";
  fireWinBefore.pawns[2] = { ...fireWinBefore.pawns[2], zone: "safety", pos: 4 };
  fireWinBefore.firePawnId = 2;
  const fireWin = structuredClone(fireWinBefore);
  fireWin.pawns[2].zone = "home";
  fireWin.pawns[2].pos = 0;
  fireWin.moveNo++;
  fireWin.pendingFirePull = true;
  fireWin.winner = 0;
  fireWin.phase = "gameOver";
  assert.doesNotThrow(() => validateSorryTransition(room(fireWinBefore), member(0), stateAction(fireWin, { finish: true, result })));

  const forged = baseState();
  forged.pawns.slice(0, 3).forEach((pawn) => { pawn.zone = "home"; pawn.pos = 0; });
  forged.winner = 0;
  forged.phase = "gameOver";
  assert.throws(() => validateSorryTransition(room(baseState()), member(0), stateAction(forged, { finish: true, result })), /invalid phase|next legal card/i);
});

test("Sorry transition identity is immutable after start", () => {
  const before = baseState();
  putCardOnTop(before, "3");
  const after = structuredClone(before);
  after.deck.pop();
  after.currentCard = "3";
  after.phase = "action";
  after.players[0].name = "Spoofed Winner";
  assert.throws(() => validateSorryTransition(room(before), member(0), stateAction(after, { nextSeat: 0 })), /identity cannot change/);
});

test("Sorry recovers an authoritative turn after the active middle player leaves", () => {
  const before = baseState();
  before.players.push({ id: 2, name: "Jordan", colorIndex: 2, color: "yellow", cpu: false, seat: 2, memberId: "p2" });
  before.hands.push([]);
  before.pawns = Array.from({ length: 9 }, (_, id) => ({ id, player: Math.floor(id / 3), slot: id % 3, zone: "start", pos: 0 }));
  beginPlayedCard(before, "3");
  putCardOnTop(before, "3");
  before.turn = 1;

  const game = {
    game: "sorry",
    state: before,
    status: "active",
    maxPlayers: 3,
    hostPlayerId: "p0",
    members: [
      { playerId: "p0", seat: 0, username: "Logan", leftAt: null },
      { playerId: "p1", seat: 1, username: "Scarlett", leftAt: "2026-09-01T00:00:00.000Z" },
      { playerId: "p2", seat: 2, username: "Jordan", leftAt: null }
    ],
    turn: { seat: 2, playerId: "p2", number: 8 }
  };
  const after = structuredClone(before);
  after.discard.push(after.currentCard);
  after.currentCard = null;
  after.turn = 2;
  after.phase = "draw";
  assert.equal(after.deck.pop(), "3");
  after.currentCard = "3";
  after.phase = "action";
  assert.doesNotThrow(() => validateSorryTransition(game, { playerId: "p2", seat: 2, username: "Jordan", leftAt: null }, stateAction(after, { nextSeat: 2 })));
});
