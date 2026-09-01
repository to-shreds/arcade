import test from "node:test";
import assert from "node:assert/strict";
import { MONOPOLY_AUTHORITY, __test, validateMonopolyStart, validateMonopolyTransition } from "./monopoly-authority.js";

const PROPERTY_IDS = [1,3,5,6,8,9,11,12,13,14,15,16,18,19,21,23,24,25,26,27,28,29,31,32,34,35,37,39];
const CHANCE_IDS = ["c_go", "c_boardwalk", "c_illinois", "c_charles", "c_rail1", "c_rail2", "c_util", "c_dividend", "c_jailcard", "c_back", "c_jail", "c_repairs", "c_speed", "c_reading", "c_chair", "c_loan"];
const COMMUNITY_IDS = ["m_go", "m_error", "m_doctor", "m_stock", "m_jailcard", "m_jail", "m_holiday", "m_refund", "m_birthday", "m_life", "m_hospital", "m_school", "m_fee", "m_repairs", "m_beauty", "m_inherit"];

function members() {
  return [
    { playerId: "p0", seat: 0, username: "Logan", leftAt: null },
    { playerId: "p1", seat: 1, username: "Scarlett", leftAt: null }
  ];
}

function threeMembers() {
  return [
    ...members(),
    { playerId: "p2", seat: 2, username: "Cara", leftAt: null }
  ];
}

function state() {
  return {
    version: 1,
    mode: "standard",
    settings: { startingCash: 1500, goSalary: 200, startingDeeds: 0, firstBankruptcy: false, turnLimit: 0, freeParking: false, handoff: false, quickHotels: false, quickJail: false },
    players: [
      { id: 0, name: "Logan", token: "💩", color: "#30d8ff", cash: 1500, pos: 0, inJail: false, jailTurns: 0, getOut: { chance: 0, community: 0 }, bankrupt: false },
      { id: 1, name: "Scarlett", token: "🚽", color: "#ff5e86", cash: 1500, pos: 0, inJail: false, jailTurns: 0, getOut: { chance: 0, community: 0 }, bankrupt: false }
    ],
    deeds: Object.fromEntries(PROPERTY_IDS.map((id) => [id, { owner: null, mortgaged: false, houses: 0 }])),
    turnIndex: 0,
    phase: "roll",
    round: 1,
    turnCount: 0,
    doublesCount: 0,
    extraRoll: false,
    lastRoll: [],
    status: "Roll",
    bank: { houses: 32, hotels: 12, pot: 0 },
    decks: { chance: [...CHANCE_IDS], community: [...COMMUNITY_IDS] },
    pendingDebt: null,
    pendingAuction: null,
    pendingCard: null,
    pendingMove: null,
    pendingTrade: null,
    pendingTransfers: [],
    pendingMortgageChoices: [],
    mortgageChoiceResume: null,
    bankAuctionQueue: [],
    bankruptcyStack: [],
    auctionResume: null,
    offerSpace: null,
    landingSpecial: null,
    log: [],
    sound: true,
    gameOver: false,
    fullBoard: false,
    endReason: ""
  };
}

function room(snapshot = state()) {
  return { game: "monopoly", state: snapshot, maxPlayers: 2, members: members(), turn: { seat: 0, playerId: "p0", number: 1 } };
}

function threePlayerState() {
  const snapshot = state();
  snapshot.players.push({ id: 2, name: "Cara", token: "🤡", color: "#ffd447", cash: 1500, pos: 0, inJail: false, jailTurns: 0, getOut: { chance: 0, community: 0 }, bankrupt: false });
  return snapshot;
}

function threeRoom(snapshot = threePlayerState()) {
  return { game: "monopoly", state: snapshot, maxPlayers: 3, members: threeMembers(), turn: { seat: 0, playerId: "p0", number: 1 } };
}

function action(snapshot, intent, extra = {}) {
  return { type: "state", expectedVersion: 1, state: snapshot, nextSeat: 0, finish: false, intent: { version: 1, ...intent }, ...extra };
}

test("Monopoly start binds locked names and exact initial bank/deed ledger", () => {
  const table = room();
  assert.equal(validateMonopolyStart(table, { type: "start", state: table.state, firstSeat: 0 }), MONOPOLY_AUTHORITY);
  const spoofed = structuredClone(table.state);
  spoofed.players[0].name = "Jon";
  assert.throws(() => validateMonopolyStart(table, { type: "start", state: spoofed, firstSeat: 0 }), /locked membership/);
  const fabricated = structuredClone(table.state);
  fabricated.players[0].cash++;
  assert.throws(() => validateMonopolyStart(table, { type: "start", state: fabricated, firstSeat: 0 }), /initial Monopoly player ledger/);
});

test("Monopoly accepts an exact mortgage and rejects unexplained cash fabrication", () => {
  const before = state();
  before.deeds[1].owner = 0;
  before.players[0].cash = 1440;
  const table = room(before);
  const after = structuredClone(before);
  after.deeds[1].mortgaged = true;
  after.players[0].cash += 30;
  assert.doesNotThrow(() => validateMonopolyTransition(table, table.members[0], action(after, { kind: "mortgage", spaceId: 1 })));

  const rolled = structuredClone(before);
  rolled.players[0].pos = 3;
  rolled.lastRoll = [1, 2];
  rolled.phase = "offer";
  rolled.offerSpace = 3;
  assert.doesNotThrow(() => validateMonopolyTransition(table, table.members[0], action(rolled, { kind: "roll", d1: 1, d2: 2 })));
  for (const amount of [1, 10_000]) {
    const forged = structuredClone(rolled);
    forged.players[0].cash += amount;
    assert.throws(() => validateMonopolyTransition(table, table.members[0], action(forged, { kind: "roll", d1: 1, d2: 2 })), /unowned-property landing|cash changed|legal-sized bank event/);
  }
});

test("Monopoly rejects arbitrary cash transfer and single-deed theft even when total value is conserved", () => {
  const before = state();
  const table = room(before);
  const transfer = structuredClone(before);
  transfer.players[0].cash += 250;
  transfer.players[1].cash -= 250;
  transfer.lastRoll = [1, 1];
  transfer.players[0].pos = 2;
  assert.throws(() => validateMonopolyTransition(table, table.members[0], action(transfer, { kind: "roll", d1: 1, d2: 1 })), /unrelated player's cash/);

  const theft = structuredClone(before);
  theft.deeds[39].owner = 0;
  theft.lastRoll = [1, 1];
  theft.players[0].pos = 2;
  assert.throws(() => validateMonopolyTransition(table, table.members[0], action(theft, { kind: "roll", d1: 1, d2: 1 })), /cannot fabricate deeds/);
});

test("Monopoly rejects phase/turn forgery and missing or mislabeled intents", () => {
  const before = state();
  const table = room(before);
  const turn = structuredClone(before);
  turn.turnIndex = 1;
  assert.throws(() => validateMonopolyTransition(table, table.members[0], action(turn, { kind: "resolve-card" }, { nextSeat: 1 })), /turn or round changed/);
  const phase = structuredClone(before);
  phase.phase = "end";
  assert.throws(() => validateMonopolyTransition(table, table.members[0], action(phase, { kind: "resolve-card" })), /card intent|pending card/);
  assert.throws(() => validateMonopolyTransition(table, table.members[0], { ...action(before, { kind: "roll", d1: 1, d2: 1 }), intent: undefined }), /supported intent/);
  const junk = structuredClone(before);
  junk.peerSuppliedJunk = { arbitrary: true };
  assert.throws(() => validateMonopolyTransition(table, table.members[0], action(junk, { kind: "roll", d1: 1, d2: 1 })), /unsupported field/);
});

test("Monopoly rejects instant bankruptcy, forged completion, and billion-dollar takeover", () => {
  const before = state();
  const table = room(before);
  const bankruptcy = structuredClone(before);
  bankruptcy.players[1].cash = 0;
  bankruptcy.players[1].bankrupt = true;
  bankruptcy.gameOver = true;
  bankruptcy.phase = "gameOver";
  bankruptcy.endReason = "Last player standing";
  assert.throws(() => validateMonopolyTransition(table, table.members[0], action(bankruptcy, { kind: "declare-bankruptcy" }, { finish: true, result: { winnerSeat: 0, reason: "Last player standing" } })), /unpayable debt|bankruptcy/);

  const takeover = structuredClone(bankruptcy);
  takeover.players[0].cash = 1_000_000_000;
  for (const deed of Object.values(takeover.deeds)) deed.owner = 0;
  assert.throws(() => validateMonopolyTransition(table, table.members[0], action(takeover, { kind: "declare-bankruptcy" }, { finish: true, result: { winnerSeat: 0, reason: "Last player standing" } })), /player ledger|unpayable debt|bankruptcy/);
});

test("Monopoly rejects nested identity spoofing after a valid start", () => {
  const before = state();
  const table = room(before);
  const spoofed = structuredClone(before);
  spoofed.players[0].name = "Jon";
  spoofed.lastRoll = [1, 1];
  spoofed.players[0].pos = 2;
  assert.throws(() => validateMonopolyTransition(table, table.members[0], action(spoofed, { kind: "roll", d1: 1, d2: 1 })), /locked membership|identity is immutable/);
});

test("Monopoly validates an exact card award and rejects a mismatched card intent", () => {
  const before = state();
  before.phase = "cardDraw";
  before.pendingCard = { deck: "chance", id: "c_dividend" };
  before.decks.chance = before.decks.chance.filter((id) => id !== "c_dividend");
  const table = room(before), after = structuredClone(before);
  after.pendingCard = null;
  after.decks.chance.push("c_dividend");
  after.players[0].cash += 50;
  after.phase = "end";
  assert.doesNotThrow(() => validateMonopolyTransition(table, table.members[0], action(after, { kind: "resolve-card", deck: "chance", cardId: "c_dividend" })));
  assert.throws(() => validateMonopolyTransition(table, table.members[0], action(after, { kind: "resolve-card", deck: "chance", cardId: "c_loan" })), /does not match/);
});

test("Monopoly validates the final auction bid and exact deed/cash settlement", () => {
  const before = state();
  before.phase = "auction";
  before.offerSpace = null;
  before.pendingAuction = { spaceId: 1, returnMode: "landing", bid: 0, highestId: null, currentBidderId: 0, passed: [1], participants: [0, 1] };
  const table = room(before), after = structuredClone(before);
  after.pendingAuction = null;
  after.phase = "end";
  after.deeds[1].owner = 0;
  after.players[0].cash -= 50;
  assert.doesNotThrow(() => validateMonopolyTransition(table, table.members[0], action(after, { kind: "auction-bid", spaceId: 1, value: 50 })));
  const stolen = structuredClone(after);
  stolen.deeds[3].owner = 0;
  assert.throws(() => validateMonopolyTransition(table, table.members[0], action(stolen, { kind: "auction-bid", spaceId: 1, value: 50 })), /auction continuation: deeds|outside the declared action/);
});

test("Monopoly bank auctions seed the next auction canonically and resume nested transfers", () => {
  const before = threePlayerState();
  before.players[2].cash = 0;
  before.players[2].bankrupt = true;
  before.phase = "auction";
  before.pendingAuction = { spaceId: 1, returnMode: "bankruptcy", bid: 0, highestId: null, currentBidderId: 0, passed: [1], participants: [0, 1] };
  before.bankAuctionQueue = [3];
  before.bankruptcyStack = [{ playerId: 2, wasCurrent: false, resume: "finish" }];
  const table = threeRoom(before), after = structuredClone(before);
  after.players[0].cash -= 50;
  after.deeds[1].owner = 0;
  after.bankAuctionQueue = [];
  after.pendingAuction = { spaceId: 3, returnMode: "bankruptcy", bid: 0, highestId: null, currentBidderId: 0, passed: [], participants: [0, 1] };
  assert.doesNotThrow(() => validateMonopolyTransition(table, table.members[0], action(after, { kind: "auction-bid", spaceId: 1, value: 50 })));

  const seeded = structuredClone(after);
  seeded.pendingAuction.bid = 1;
  seeded.pendingAuction.highestId = 0;
  seeded.pendingAuction.participants = [0];
  assert.throws(() => validateMonopolyTransition(table, table.members[0], action(seeded, { kind: "auction-bid", spaceId: 1, value: 50 })), /auction continuation: pendingAuction/);

  const nested = structuredClone(before);
  nested.bankAuctionQueue = [];
  nested.bankruptcyStack = [{ playerId: 2, wasCurrent: false, resume: "transfers" }];
  nested.pendingTransfers = [{ debtorId: 1, creditorId: 0, amount: 10, cause: "Birthday gift", potEligible: false }];
  nested.transfersResume = "finish";
  const nestedAfter = structuredClone(nested);
  nestedAfter.players[0].cash = 1460;
  nestedAfter.players[1].cash = 1490;
  nestedAfter.deeds[1].owner = 0;
  nestedAfter.pendingAuction = null;
  nestedAfter.bankruptcyStack = [];
  nestedAfter.pendingTransfers = [];
  nestedAfter.transfersResume = null;
  nestedAfter.phase = "end";
  const nestedTable = threeRoom(nested);
  assert.doesNotThrow(() => validateMonopolyTransition(nestedTable, nestedTable.members[0], action(nestedAfter, { kind: "auction-bid", spaceId: 1, value: 50 })));
});

test("Monopoly exact continuations permit delayed Quick completion after a mortgage choice", () => {
  const before = threePlayerState();
  before.mode = "quick";
  before.settings = { startingCash: 1500, goSalary: 200, startingDeeds: 2, firstBankruptcy: true, turnLimit: 0, freeParking: false, handoff: false, quickHotels: true, quickJail: true };
  before.players[1].cash = 0;
  before.players[1].bankrupt = true;
  before.deeds[1] = { owner: 0, mortgaged: true, houses: 0 };
  before.phase = "debt";
  before.pendingMortgageChoices = [{ playerId: 0, spaceId: 1 }];
  before.mortgageChoiceResume = "afterBankruptcy";
  before.bankruptcyStack = [{ playerId: 1, wasCurrent: false, resume: "finish" }];
  const table = threeRoom(before), after = structuredClone(before);
  after.players[0].cash -= 33;
  after.deeds[1].mortgaged = false;
  after.pendingMortgageChoices = [];
  after.mortgageChoiceResume = null;
  after.bankruptcyStack = [];
  after.gameOver = true;
  after.phase = "gameOver";
  after.endReason = "Quick game: first bankruptcy";
  assert.doesNotThrow(() => validateMonopolyTransition(table, table.members[0], action(after, { kind: "mortgage-choice", spaceId: 1, unmortgageNow: true }, {
    finish: true,
    result: { winnerSeat: 0, reason: "Quick game: first bankruptcy" }
  })));
});

test("Monopoly mortgage-interest debt keeps authority ahead of another recipient's queued choice", () => {
  const snapshot = threePlayerState();
  snapshot.phase = "debt";
  snapshot.pendingDebt = { debtorId: 1, creditorId: null, amount: 8, cause: "Interest on transferred Baltic Avenue", resume: "mortgageChoices", potEligible: false };
  snapshot.pendingMortgageChoices = [{ playerId: 0, spaceId: 1 }];
  assert.equal(__test.monopolyActorSeat(snapshot), 1, "the player raising mortgage interest keeps the decision seat");
  snapshot.pendingDebt.resume = "finish";
  assert.equal(__test.monopolyActorSeat(snapshot), 0, "an original debt remains paused behind the transferred-mortgage decision queue");
});

test("Monopoly debt-time trade choices preserve the original debt and reserve later interest", () => {
  const before = state();
  before.players[0].cash = 6;
  before.deeds[1] = { owner: 0, mortgaged: true, houses: 0 };
  before.deeds[3] = { owner: 0, mortgaged: true, houses: 0 };
  before.phase = "debt";
  before.pendingDebt = { debtorId: 0, creditorId: 1, amount: 100, cause: "Rent", resume: "finish", potEligible: false };
  before.pendingMortgageChoices = [{ playerId: 0, spaceId: 1 }, { playerId: 0, spaceId: 3 }];
  before.mortgageChoiceResume = "trade";
  const table = room(before), kept = structuredClone(before);
  kept.players[0].cash = 3;
  kept.pendingMortgageChoices.shift();
  assert.doesNotThrow(() => validateMonopolyTransition(table, table.members[0], action(kept, { kind: "mortgage-choice", spaceId: 1, unmortgageNow: false })));
  assert.deepEqual(kept.pendingDebt, before.pendingDebt, "the original rent debt remains authoritative");

  const overspentBefore = structuredClone(before);
  overspentBefore.players[0].cash = 35;
  const overspent = structuredClone(overspentBefore);
  overspent.players[0].cash = 2;
  overspent.deeds[1].mortgaged = false;
  overspent.pendingMortgageChoices.shift();
  const overspentTable = room(overspentBefore);
  assert.throws(() => validateMonopolyTransition(overspentTable, overspentTable.members[0], action(overspent, { kind: "mortgage-choice", spaceId: 1, unmortgageNow: true })), /erase a later transferred-mortgage obligation/);
});

test("Monopoly mortgage-interest rescue trades preserve the bankruptcy continuation and cannot add a new mortgage", () => {
  const before = threePlayerState();
  before.players[0].cash = 0;
  before.players[1].cash = 0;
  before.players[1].bankrupt = true;
  before.deeds[3] = { owner: 0, mortgaged: true, houses: 0 };
  before.phase = "debt";
  before.pendingDebt = { debtorId: 0, creditorId: null, amount: 3, cause: "Interest on transferred Baltic Avenue", resume: "mortgageChoices", potEligible: false };
  before.pendingMortgageChoices = [];
  before.mortgageChoiceResume = "afterBankruptcy";
  before.bankruptcyStack = [{ playerId: 1, wasCurrent: false, resume: "finish" }];
  const proposal = { fromId: 0, toId: 2, offerCash: 0, askCash: 6, offerChance: 0, offerCommunity: 0, askChance: 0, askCommunity: 0, offerProps: [], askProps: [] };
  const proposed = structuredClone(before);
  proposed.pendingTrade = proposal;
  const proposalRoom = threeRoom(before);
  assert.doesNotThrow(() => validateMonopolyTransition(proposalRoom, proposalRoom.members[0], action(proposed, { kind: "trade-propose", toId: 2 }, { nextSeat: 2 })));

  const accepted = structuredClone(proposed);
  accepted.players[0].cash = 6;
  accepted.players[2].cash = 1494;
  accepted.pendingTrade = null;
  const acceptanceRoom = threeRoom(proposed);
  acceptanceRoom.turn = { seat: 2, playerId: "p2", number: 2 };
  assert.doesNotThrow(() => validateMonopolyTransition(acceptanceRoom, acceptanceRoom.members[2], action(accepted, { kind: "trade-accept", fromId: 0, toId: 2 }, { nextSeat: 0 })));
  assert.equal(accepted.mortgageChoiceResume, "afterBankruptcy");

  const paid = structuredClone(accepted);
  paid.players[0].cash = 3;
  paid.pendingDebt = null;
  paid.mortgageChoiceResume = null;
  paid.bankruptcyStack = [];
  paid.phase = "end";
  const paymentRoom = threeRoom(accepted);
  assert.doesNotThrow(() => validateMonopolyTransition(paymentRoom, paymentRoom.members[0], action(paid, { kind: "pay-debt", amount: 3 })));

  const mortgagedProposalBefore = structuredClone(before);
  mortgagedProposalBefore.deeds[5] = { owner: 2, mortgaged: true, houses: 0 };
  const mortgagedProposal = structuredClone(mortgagedProposalBefore);
  mortgagedProposal.pendingTrade = { ...proposal, askCash: 0, askProps: [5] };
  const mortgagedRoom = threeRoom(mortgagedProposalBefore);
  assert.throws(() => validateMonopolyTransition(mortgagedRoom, mortgagedRoom.members[0], action(mortgagedProposal, { kind: "trade-propose", toId: 2 }, { nextSeat: 2 })), /cannot add another transferred mortgage/);

  const completedTradeDebt = structuredClone(before);
  completedTradeDebt.mortgageChoiceResume = "trade";
  const repeatedTrade = structuredClone(completedTradeDebt);
  repeatedTrade.pendingTrade = proposal;
  const repeatedRoom = threeRoom(completedTradeDebt);
  assert.throws(() => validateMonopolyTransition(repeatedRoom, repeatedRoom.members[0], action(repeatedTrade, { kind: "trade-propose", toId: 2 }, { nextSeat: 2 })), /cannot be replaced by another trade/);
});

test("Monopoly uses the current dice total for utility rent and handles doubles onto Go To Jail", () => {
  const utility = state();
  utility.players[0].pos = 6;
  utility.deeds[12].owner = 1;
  const table = room(utility), paid = structuredClone(utility);
  paid.players[0].pos = 12;
  paid.players[0].cash -= 24;
  paid.players[1].cash += 24;
  paid.lastRoll = [2, 4];
  paid.phase = "end";
  assert.doesNotThrow(() => validateMonopolyTransition(table, table.members[0], action(paid, { kind: "roll", d1: 2, d2: 4 })));
  const wrongRent = structuredClone(paid);
  wrongRent.players[0].cash -= 4;
  wrongRent.players[1].cash += 4;
  assert.throws(() => validateMonopolyTransition(table, table.members[0], action(wrongRent, { kind: "roll", d1: 2, d2: 4 })), /rent payment/);

  const jail = state();
  jail.players[0].pos = 28;
  const jailTable = room(jail), jailed = structuredClone(jail);
  jailed.players[0].pos = 10;
  jailed.players[0].inJail = true;
  jailed.lastRoll = [1, 1];
  jailed.phase = "end";
  assert.doesNotThrow(() => validateMonopolyTransition(jailTable, jailTable.members[0], action(jailed, { kind: "roll", d1: 1, d2: 1 })));
});

test("Monopoly accepts the exact animated direct-to-Jail card movement metadata", () => {
  const before = state();
  before.phase = "cardDraw";
  before.pendingCard = { deck: "chance", id: "c_jail" };
  before.decks.chance = before.decks.chance.filter((id) => id !== "c_jail");
  const table = room(before), after = structuredClone(before);
  after.pendingCard = null;
  after.decks.chance.push("c_jail");
  after.pendingMove = { playerId: 0, path: [10], cursor: 0, total: 1, collectGo: false, direction: 1, resolution: "jail", meta: { reason: "Go directly to Jail!" } };
  after.phase = "moving";
  assert.doesNotThrow(() => validateMonopolyTransition(table, table.members[0], action(after, { kind: "resolve-card", deck: "chance", cardId: "c_jail" })));
});

test("Monopoly completes an animated direct-to-Jail card by clearing a prior doubles roll", () => {
  const before = state();
  before.players[0].pos = 1;
  before.decks.chance = ["c_jail", ...before.decks.chance.filter((id) => id !== "c_jail")];
  const rolled = structuredClone(before);
  rolled.players[0].pos = 7;
  rolled.lastRoll = [3, 3];
  rolled.doublesCount = 1;
  rolled.extraRoll = true;
  rolled.decks.chance.shift();
  rolled.pendingCard = { deck: "chance", id: "c_jail" };
  rolled.phase = "cardDraw";
  const rollTable = room(before);
  assert.doesNotThrow(() => validateMonopolyTransition(rollTable, rollTable.members[0], action(rolled, { kind: "roll", d1: 3, d2: 3 })));

  const moving = structuredClone(rolled);
  moving.decks.chance.push("c_jail");
  moving.pendingCard = null;
  moving.pendingMove = { playerId: 0, path: [10], cursor: 0, total: 1, collectGo: false, direction: 1, resolution: "jail", meta: { reason: "Go directly to Jail!" } };
  moving.phase = "moving";
  const cardTable = room(rolled);
  assert.doesNotThrow(() => validateMonopolyTransition(cardTable, cardTable.members[0], action(moving, { kind: "resolve-card", deck: "chance", cardId: "c_jail" })));

  const after = structuredClone(moving);
  after.players[0].pos = 10;
  after.players[0].inJail = true;
  after.players[0].jailTurns = 0;
  after.pendingMove = null;
  after.phase = "end";
  after.doublesCount = 0;
  after.extraRoll = false;
  const moveTable = room(moving);
  assert.doesNotThrow(() => validateMonopolyTransition(moveTable, moveTable.members[0], action(after, { kind: "complete-move", playerId: 0 })));
  const retainedDouble = structuredClone(after);
  retainedDouble.extraRoll = true;
  assert.throws(() => validateMonopolyTransition(moveTable, moveTable.members[0], action(retainedDouble, { kind: "complete-move", playerId: 0 })), /clear the Monopoly doubles turn/);
});

test("Monopoly cards cannot alter opponents, jackpot, authority queues, or the other deck", () => {
  const before = state();
  before.phase = "cardDraw";
  before.pendingCard = { deck: "chance", id: "c_dividend" };
  before.decks.chance = before.decks.chance.filter((id) => id !== "c_dividend");
  const table = room(before), valid = structuredClone(before);
  valid.pendingCard = null;
  valid.decks.chance.push("c_dividend");
  valid.players[0].cash += 50;
  valid.phase = "end";
  for (const mutate of [
    (snapshot) => { snapshot.players[1].cash += 25; },
    (snapshot) => { snapshot.bank.pot = 10_000_000; },
    (snapshot) => { snapshot.pendingTrade = { fromId: 0, toId: 1 }; },
    (snapshot) => { snapshot.decks.community.reverse(); }
  ]) {
    const forged = structuredClone(valid);
    mutate(forged);
    assert.throws(() => validateMonopolyTransition(table, table.members[0], action(forged, { kind: "resolve-card", deck: "chance", cardId: "c_dividend" })), /outside the declared action|other deck|cash-card|jackpot|cards are not conserved|pending trade/);
  }
});

test("Monopoly rolls cannot forge doubles, extra rolls, trades, Jail state, or phase", () => {
  const before = state(), table = room(before), valid = structuredClone(before);
  valid.players[0].pos = 3;
  valid.lastRoll = [1, 2];
  valid.phase = "offer";
  valid.offerSpace = 3;
  for (const mutate of [
    (snapshot) => { snapshot.extraRoll = true; },
    (snapshot) => { snapshot.doublesCount = 1; },
    (snapshot) => { snapshot.pendingTrade = { fromId: 0, toId: 1 }; },
    (snapshot) => { snapshot.phase = "end"; snapshot.offerSpace = null; }
  ]) {
    const forged = structuredClone(valid);
    mutate(forged);
    assert.throws(() => validateMonopolyTransition(table, table.members[0], action(forged, { kind: "roll", d1: 1, d2: 2 })), /doubles|extra-roll|outside the declared action|unowned-property|during a landing|pending trade/);
  }

  const jailed = state();
  jailed.players[0].pos = 10;
  jailed.players[0].inJail = true;
  jailed.players[0].jailTurns = 0;
  const jailTable = room(jailed), jailAfter = structuredClone(jailed);
  jailAfter.lastRoll = [1, 2];
  jailAfter.players[0].jailTurns = 1;
  jailAfter.phase = "end";
  const cashForgery = structuredClone(jailAfter);
  cashForgery.players[0].cash += 100;
  assert.throws(() => validateMonopolyTransition(jailTable, jailTable.members[0], action(cashForgery, { kind: "roll", d1: 1, d2: 2 })), /failed Monopoly Jail roll|cash changed/);
  const phaseForgery = structuredClone(jailAfter);
  phaseForgery.phase = "offer";
  phaseForgery.offerSpace = 1;
  phaseForgery.players[0].pos = 1;
  assert.throws(() => validateMonopolyTransition(jailTable, jailTable.members[0], action(phaseForgery, { kind: "roll", d1: 1, d2: 2 })), /failed Monopoly Jail roll|cannot move/);
});

test("Monopoly paid debt cannot remain pending or inject trade/auction authority", () => {
  const before = state();
  before.phase = "debt";
  before.pendingDebt = { debtorId: 0, creditorId: 1, amount: 100, cause: "Rent", resume: "finish", potEligible: false };
  const table = room(before), valid = structuredClone(before);
  valid.players[0].cash -= 100;
  valid.players[1].cash += 100;
  valid.pendingDebt = null;
  valid.phase = "end";
  assert.doesNotThrow(() => validateMonopolyTransition(table, table.members[0], action(valid, { kind: "pay-debt", amount: 100 })));
  for (const mutate of [
    (snapshot) => { snapshot.pendingDebt = structuredClone(before.pendingDebt); snapshot.phase = "debt"; },
    (snapshot) => { snapshot.pendingTrade = { fromId: 0, toId: 1 }; },
    (snapshot) => { snapshot.pendingAuction = { spaceId: 1 }; snapshot.phase = "auction"; }
  ]) {
    const forged = structuredClone(valid);
    mutate(forged);
    assert.throws(() => validateMonopolyTransition(table, table.members[0], action(forged, { kind: "pay-debt", amount: 100 })), /debt continuation|remained pending|inject a trade|outside the declared action|Invalid Monopoly auction|pending trade/);
  }
});
