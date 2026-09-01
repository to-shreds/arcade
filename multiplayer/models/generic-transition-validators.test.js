import test from "node:test";
import assert from "node:assert/strict";
import { GENERIC_GAME_AUTHORITY, validateGenericGameAction } from "./generic-transition-validators.js";

function room(game, state, seats = [0, 1], maxPlayers = seats.length) {
  const members = seats.map((seat) => ({ playerId: `p${seat}`, seat, username: `Player ${seat + 1}`, leftAt: null }));
  return { game, state, status: "active", maxPlayers, members, hostPlayerId: members[0].playerId, turn: { seat: seats[0], playerId: members[0].playerId, number: 1 } };
}

function member(seat = 0) { return { playerId: `p${seat}`, seat, username: `Player ${seat + 1}`, leftAt: null }; }
function action(state, extra = {}) { return { type: "state", expectedVersion: 1, state, ...extra }; }

function dotsState() {
  return {
    version: 2, DR: 3, DC: 3, BR: 2, BC: 2, TOTAL: 4,
    HO: Array.from({ length: 3 }, () => [0, 0]), VO: Array.from({ length: 2 }, () => [0, 0, 0]),
    boxOwner: Array.from({ length: 2 }, () => [0, 0]), boxAnim: Array.from({ length: 2 }, () => [0, 0]),
    turn: 1, scores: [0, 0, 0], claimed: 0, history: [], lastMove: null,
    mode: "online", playerCount: 2, cpuLevel: 3, playerNames: [null, "Player 1", "Player 2"],
    playerColors: [null, "#FFFFFF", "#000000"], showTurnSplash: false, teamPlay: false,
    teams: [null, 1, 2], teamNames: [null, "Team 1", "Team 2"]
  };
}

function checkersState() {
  const board = Array.from({ length: 8 }, (_, row) => Array.from({ length: 8 }, (_, col) => (row + col) % 2 !== 1 ? 0 : row < 3 ? -1 : row > 4 ? 1 : 0));
  return { schema: 2, board, turn: 1, mode: "online", chainLock: false, baseSub: "", cpuDifficulty: 3, selected: null, gameStarted: true, moveCount: 0 };
}

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

function sorryDeck() {
  return Object.entries({ "1": 5, "2": 4, "3": 4, "4": 4, "5": 4, "7": 4, "8": 4, "10": 4, "11": 4, "12": 4, S: 4 }).flatMap(([card, count]) => Array(count).fill(card));
}

function sorryState() {
  const players = [{ id: 0, name: "Player 1", seat: 0, colorIndex: 0 }, { id: 1, name: "Player 2", seat: 1, colorIndex: 1 }];
  return {
    version: 5, started: true, mode: "classic", skill: 2, showEndpoints: true, players,
    pawns: Array.from({ length: 6 }, (_, id) => ({ id, player: Math.floor(id / 3), slot: id % 3, zone: "start", pos: 0 })),
    turn: 0, deck: sorryDeck(), discard: [], hands: [[], []], firePawnId: null, icePawnId: null,
    currentCard: null, phase: "draw", selectedCardIndex: null, flow: {}, winner: null, moveNo: 0, pendingFirePull: false
  };
}

const PROPERTY_IDS = [1,3,5,6,8,9,11,12,13,14,15,16,18,19,21,23,24,25,26,27,28,29,31,32,34,35,37,39];
function monopolyState() {
  return {
    version: 1, mode: "standard", settings: { startingCash: 1500, goSalary: 200, startingDeeds: 0, firstBankruptcy: false, turnLimit: 0, freeParking: false, handoff: false, quickHotels: false, quickJail: false },
    players: [0, 1].map((id) => ({ id, name: `Player ${id + 1}`, token: ["💩", "🚽"][id], color: ["#30d8ff", "#ff5e86"][id], cash: 1500, pos: 0, inJail: false, jailTurns: 0, getOut: { chance: 0, community: 0 }, bankrupt: false })),
    deeds: Object.fromEntries(PROPERTY_IDS.map((id) => [id, { owner: null, mortgaged: false, houses: 0 }])),
    turnIndex: 0, phase: "roll", round: 1, turnCount: 0, doublesCount: 0, extraRoll: false, lastRoll: [],
    status: "Roll", bank: { houses: 32, hotels: 12, pot: 0 }, decks: {
      chance: ["c_go", "c_boardwalk", "c_illinois", "c_charles", "c_rail1", "c_rail2", "c_util", "c_dividend", "c_jailcard", "c_back", "c_jail", "c_repairs", "c_speed", "c_reading", "c_chair", "c_loan"],
      community: ["m_go", "m_error", "m_doctor", "m_stock", "m_jailcard", "m_jail", "m_holiday", "m_refund", "m_birthday", "m_life", "m_hospital", "m_school", "m_fee", "m_repairs", "m_beauty", "m_inherit"]
    }, pendingDebt: null,
    pendingAuction: null, pendingCard: null, pendingMove: null, pendingTransfers: [], pendingMortgageChoices: [],
    mortgageChoiceResume: null, bankAuctionQueue: [], bankruptcyStack: [], auctionResume: null, offerSpace: null,
    landingSpecial: null, log: [], sound: true, gameOver: false, fullBoard: false, endReason: ""
  };
}

test("Tic Tac Toe accepts one owned mark and rejects multi-mark or forged score actions", () => {
  const before = { schema: 1, board: Array(9).fill(""), turn: "X", scoreX: 0, scoreO: 0, symX: "X", symO: "O", roundOver: null };
  const game = room("tic-tac-toe", before);
  const after = structuredClone(before); after.board[0] = "X"; after.turn = "O";
  assert.doesNotThrow(() => validateGenericGameAction(game, member(0), action(after, { nextSeat: 1 })));
  const illegal = structuredClone(after); illegal.board[1] = "X";
  assert.throws(() => validateGenericGameAction(game, member(0), action(illegal, { nextSeat: 1 })), /move counts|exactly one/);
  const forged = structuredClone(after); forged.scoreX = 99;
  assert.throws(() => validateGenericGameAction(game, member(0), action(forged, { nextSeat: 1 })), /score/);
});

test("Dots accepts one owned edge and rejects multi-edge and premature-win actions", () => {
  const before = dotsState(), game = room("dots", before);
  const after = structuredClone(before); after.HO[0][0] = 1; after.lastMove = { type: "H", r: 0, c: 0 }; after.turn = 2;
  assert.doesNotThrow(() => validateGenericGameAction(game, member(0), action(after, { nextSeat: 1, finish: false })));
  const illegal = structuredClone(after); illegal.HO[0][1] = 1;
  assert.throws(() => validateGenericGameAction(game, member(0), action(illegal, { nextSeat: 1 })), /exactly one/);
  const spoofed = structuredClone(after); spoofed.playerNames[1] = "Mallory";
  assert.throws(() => validateGenericGameAction(game, member(0), action(spoofed, { nextSeat: 1 })), /locked room identities/);
  const changedTeams = structuredClone(after); changedTeams.teamPlay = true;
  assert.throws(() => validateGenericGameAction(game, member(0), action(changedTeams, { nextSeat: 1 })), /online configuration/);
  assert.throws(() => validateGenericGameAction(game, member(0), action(after, { nextSeat: 1, finish: true, result: { winnerSeat: 0 } })), /not finished/);
});

test("Checkers accepts one legal move and rejects teleport and forged-win actions", () => {
  const before = checkersState(), game = room("checkers", before);
  const after = structuredClone(before); after.board[5][0] = 0; after.board[4][1] = 1; after.turn = -1; after.moveCount = 1;
  assert.doesNotThrow(() => validateGenericGameAction(game, member(0), action(after, { nextSeat: 1, finish: false })));
  const illegal = structuredClone(before); illegal.board[5][0] = 0; illegal.board[2][7] = 1; illegal.turn = -1; illegal.moveCount = 1;
  assert.throws(() => validateGenericGameAction(game, member(0), action(illegal, { nextSeat: 1 })), /not one legal move/);
  assert.throws(() => validateGenericGameAction(game, member(0), action(after, { nextSeat: 1, finish: true, result: { winnerSeat: 0, winnerColor: "red" } })), /not finished/);
});

test("Memory accepts one resolved group and rejects extra ownership and forged completion", () => {
  const before = memoryState(), game = room("memory", before);
  const after = structuredClone(before); after.matchedKeys = ["a"]; after.owners = [1, 1, 0, 0]; after.scores = [1, 0]; after.moves = 1;
  Object.assign(after.stats[0], { matches: 1, attempts: 1, flips: 2, curStreak: 1, longestStreak: 1, decisionCount: 1 });
  assert.doesNotThrow(() => validateGenericGameAction(game, member(0), action(after, { nextSeat: 0, finish: false })));
  const illegal = structuredClone(after); illegal.matchedKeys.push("b"); illegal.owners = [1, 1, 1, 1]; illegal.scores = [2, 0]; illegal.stats[0].matches = 2;
  assert.throws(() => validateGenericGameAction(game, member(0), action(illegal, { nextSeat: 0 })), /at most one|statistics do not match/);
  const spoofed = structuredClone(after); spoofed.names[0] = "Mallory";
  assert.throws(() => validateGenericGameAction(game, member(0), action(spoofed, { nextSeat: 0 })), /locked room identities/);
  const changedTeams = structuredClone(after); changedTeams.teams = [2, 1]; changedTeams.uniqueTeams = [2, 1];
  assert.throws(() => validateGenericGameAction(game, member(0), action(changedTeams, { nextSeat: 0 })), /online configuration/);
  assert.throws(() => validateGenericGameAction(game, member(0), action(after, { nextSeat: 0, finish: true, result: { scores: [1, 0], winners: ["Player 1"] } })), /not finished/);
});

test("Sorry enforces bounded pawn transitions and rejects an unearned winner", () => {
  const before = sorryState(), game = room("sorry", before, [0, 1], 2);
  const illegalMove = structuredClone(before); illegalMove.pawns[3].zone = "home";
  assert.throws(() => validateGenericGameAction(game, member(0), action(illegalMove, { nextSeat: 0 })), /Sorry pawns|bump or switch|next legal card/);
  const forged = structuredClone(before); forged.winner = 0; forged.phase = "gameOver";
  assert.throws(() => validateGenericGameAction(game, member(0), action(forged, { nextSeat: 0, finish: true, result: { winnerSeat: 0, winnerName: "Player 1", reason: "home" } })), /every pawn Home|invalid phase/i);
  const directHomeExploit = structuredClone(before);
  directHomeExploit.pawns.slice(0, 3).forEach((pawn) => { pawn.zone = "home"; pawn.pos = 0; });
  directHomeExploit.winner = 0; directHomeExploit.phase = "gameOver"; directHomeExploit.moveNo = 1;
  assert.throws(
    () => validateGenericGameAction(game, member(0), action(directHomeExploit, { nextSeat: 0, finish: true, result: { winnerSeat: 0, winnerName: "Player 1", reason: "home" } })),
    /directly from Start|every pawn Home|Too many Sorry pawns|advance that many|next legal card|invalid phase/i
  );
  const cardlessLeap = structuredClone(before);
  cardlessLeap.pawns[0].zone = "track"; cardlessLeap.pawns[0].pos = 59; cardlessLeap.moveNo = 1;
  assert.throws(
    () => validateGenericGameAction(game, member(0), action(cardlessLeap, { nextSeat: 0 })),
    /not the result of one legal played card|consume its played card|completed Sorry card|next legal card|invalid phase/i
  );
  assert.equal(GENERIC_GAME_AUTHORITY.sorry.ruleValidated, true);
  assert.equal(GENERIC_GAME_AUTHORITY.sorry.completionVerified, true);
});

test("Monopoly enforces ledger/counter invariants and rejects a forged winner", () => {
  const before = monopolyState(), game = room("monopoly", before, [0, 1], 2);
  const impossible = structuredClone(before); impossible.turnCount = 2;
  assert.throws(() => validateGenericGameAction(game, member(0), action(impossible, { nextSeat: 0, intent: { version: 1, kind: "roll", d1: 1, d2: 1 } })), /turn counters/);
  const forged = structuredClone(before); forged.gameOver = true; forged.phase = "gameOver"; forged.endReason = "Game over";
  forged.players[1].cash = 2000;
  assert.throws(() => validateGenericGameAction(game, member(0), action(forged, { nextSeat: 0, finish: true, result: { winnerSeat: 0, reason: "Game over" }, intent: { version: 1, kind: "roll", d1: 1, d2: 1 } })), /winner|end condition|unrelated player's cash/);
  const takeover = structuredClone(before);
  takeover.players[0].cash = 1e9; takeover.players[1].cash = 0; takeover.players[1].bankrupt = true;
  Object.values(takeover.deeds).forEach((deed) => { deed.owner = 0; });
  takeover.gameOver = true; takeover.phase = "gameOver"; takeover.endReason = "Last player standing";
  assert.throws(
    () => validateGenericGameAction(game, member(0), action(takeover, { nextSeat: 0, finish: true, result: { winnerSeat: 0, reason: "Last player standing" }, intent: { version: 1, kind: "declare-bankruptcy" } })),
    /bankruptcy|unpayable debt|player ledger/
  );
  const instantBankruptcy = structuredClone(before);
  instantBankruptcy.players[1].bankrupt = true; instantBankruptcy.players[1].cash = 0;
  instantBankruptcy.gameOver = true; instantBankruptcy.phase = "gameOver"; instantBankruptcy.endReason = "Last player standing";
  assert.throws(
    () => validateGenericGameAction(game, member(0), action(instantBankruptcy, { nextSeat: 0, finish: true, result: { winnerSeat: 0, reason: "Last player standing" }, intent: { version: 1, kind: "declare-bankruptcy" } })),
    /bankruptcy|unpayable debt/
  );
  assert.equal(GENERIC_GAME_AUTHORITY.monopoly.ruleValidated, true);
});
