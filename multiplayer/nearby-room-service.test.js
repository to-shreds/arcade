import test from "node:test";
import assert from "node:assert/strict";
import {
  NEARBY_CHESS_AUTHORITY_CONTRACT,
  NEARBY_GENERIC_AUTHORITY_CONTRACT,
  NearbyRoomService
} from "./nearby-room-service.js";

const members = Object.freeze({
  alice: { memberId: "member_alice", nickname: "Alice", avatar: "🚀", color: "#AA3355" },
  bob: { memberId: "member_bob", nickname: "Bob", avatar: "🦖", color: "#33AA55" },
  cara: { memberId: "member_cara", nickname: "Cara", avatar: "🦄", color: "#3355AA" }
});

const SORRY_CARD_COUNTS = Object.freeze({ "1": 5, "2": 4, "3": 4, "4": 4, "5": 4, "7": 4, "8": 4, "10": 4, "11": 4, "12": 4, S: 4 });
const MONOPOLY_PROPERTY_IDS = Object.freeze([1,3,5,6,8,9,11,12,13,14,15,16,18,19,21,23,24,25,26,27,28,29,31,32,34,35,37,39]);
const MONOPOLY_CHANCE_IDS = Object.freeze(["c_go", "c_boardwalk", "c_illinois", "c_charles", "c_rail1", "c_rail2", "c_util", "c_dividend", "c_jailcard", "c_back", "c_jail", "c_repairs", "c_speed", "c_reading", "c_chair", "c_loan"]);
const MONOPOLY_COMMUNITY_IDS = Object.freeze(["m_go", "m_error", "m_doctor", "m_stock", "m_jailcard", "m_jail", "m_holiday", "m_refund", "m_birthday", "m_life", "m_hospital", "m_school", "m_fee", "m_repairs", "m_beauty", "m_inherit"]);

function completeSorryDeck() {
  return Object.entries(SORRY_CARD_COUNTS).flatMap(([card, count]) => Array(count).fill(card));
}

function deterministicCrypto(seed = 0x7f4a7c15) {
  let state = seed >>> 0;
  return {
    getRandomValues(values) {
      for (let index = 0; index < values.length; index++) {
        state ^= state << 13;
        state ^= state >>> 17;
        state ^= state << 5;
        values[index] = state >>> 0;
      }
      return values;
    }
  };
}

async function addMembers(service, names = ["alice", "bob"]) {
  for (const name of names) await service.registerMember(members[name]);
}

async function http(service, memberId, url, method = "GET", body = null, token = null) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  return await service.handleHttp(memberId, {
    url,
    method,
    headers,
    body: body === null ? null : JSON.stringify(body)
  });
}

function nearbyMemoryState(names = ["Alice", "Bob", "Cara"]) {
  const stat = () => ({ matches: 0, attempts: 0, misses: 0, flips: 0, curStreak: 0, longestStreak: 0, totalDecision: 0, decisionCount: 0, mismatchPairCounts: {}, bestRepeat: 0 });
  return {
    schema: 1, players: 3, seatOrder: [0, 1, 2], names, teams: [1, 2, 3], uniqueTeams: [1, 2, 3], teamMode: false,
    teamNames: ["Team 1", "Team 2", "Team 3", "Team 4"], cols: 2, rows: 2, matchSize: 2, freeCount: 0, totalMatches: 2,
    deck: [{ id: "a1", key: "a", emoji: "🍎" }, { id: "a2", key: "a", emoji: "🍎" }, { id: "b1", key: "b", emoji: "🍌" }, { id: "b2", key: "b", emoji: "🍌" }],
    revealed: [], matchedKeys: [], owners: [0, 0, 0, 0], lock: false, awaitingTurn: false, moves: 0, tElapsed: 0,
    scores: [0, 0, 0], turn: 1, stats: names.map(stat), sound: true
  };
}

function nearbyDotsState(names = ["Alice", "Cara"]) {
  return {
    version: 2, DR: 2, DC: 2, BR: 1, BC: 1, TOTAL: 1,
    HO: [[0], [0]], VO: [[0, 0]], boxOwner: [[0]], boxAnim: [[0]],
    turn: 1, scores: [0, 0, 0], claimed: 0, history: [], lastMove: null,
    mode: "online", playerCount: 2, cpuLevel: 3, playerNames: [null, ...names],
    playerColors: [null, "#30D8FF", "#FF5E86"], showTurnSplash: false, teamPlay: false,
    teams: [null, 1, 2], teamNames: [null, "Team 1", "Team 2"]
  };
}

function nearbyTicTacToeState() {
  return { schema: 1, board: Array(9).fill(""), turn: "X", scoreX: 0, scoreO: 0, symX: "X", symO: "O", roundOver: null };
}

function nearbySorryState(room, proposedDeck, mode = "classic") {
  const colors = ["red", "blue", "yellow", "green"];
  const players = room.members.map((member, index) => ({
    id: index,
    name: member.username,
    colorIndex: index,
    color: colors[index],
    cpu: false,
    seat: member.seat,
    memberId: member.playerId
  }));
  const deck = proposedDeck.slice(), hands = players.map(() => []);
  if (mode === "strategic") {
    for (let round = 0; round < 5; round++) for (let player = 0; player < players.length; player++) hands[player].push(deck.pop());
  }
  return {
    version: 5,
    started: true,
    mode,
    skill: 2,
    showEndpoints: true,
    players,
    pawns: Array.from({ length: players.length * 3 }, (_, id) => ({ id, player: Math.floor(id / 3), slot: id % 3, zone: "start", pos: 0 })),
    turn: 0,
    deck,
    discard: [],
    hands,
    firePawnId: null,
    icePawnId: null,
    currentCard: null,
    phase: mode === "strategic" ? "chooseCard" : "draw",
    selectedCardIndex: null,
    flow: {},
    winner: null,
    moveNo: 0,
    savedAt: 1,
    pendingFirePull: false,
    online: true
  };
}

function nearbyMonopolyState(room) {
  const tokens = ["💩", "🚽", "🤡", "👻", "👽", "🤖"], colors = ["#30d8ff", "#ff5e86", "#ffd447", "#7be66f", "#b889ff", "#ff914d"];
  return {
    version: 1,
    mode: "standard",
    settings: { startingCash: 1500, goSalary: 200, startingDeeds: 0, firstBankruptcy: false, turnLimit: 0, freeParking: false, handoff: false, quickHotels: false, quickJail: false },
    players: room.members.map((member) => ({ id: member.seat, name: member.username, token: tokens[member.seat], color: colors[member.seat], cash: 1500, pos: 0, inJail: false, jailTurns: 0, getOut: { chance: 0, community: 0 }, bankrupt: false })),
    deeds: Object.fromEntries(MONOPOLY_PROPERTY_IDS.map((id) => [id, { owner: null, mortgaged: false, houses: 0 }])),
    turnIndex: 0, phase: "roll", round: 1, turnCount: 0, doublesCount: 0, extraRoll: false, lastRoll: [], status: "Roll",
    bank: { houses: 32, hotels: 12, pot: 0 }, decks: { chance: [...MONOPOLY_CHANCE_IDS].reverse(), community: [...MONOPOLY_COMMUNITY_IDS].reverse() },
    pendingDebt: null, pendingAuction: null, pendingCard: null, pendingMove: null, pendingTrade: null, pendingTransfers: [], pendingMortgageChoices: [], mortgageChoiceResume: null,
    bankAuctionQueue: [], bankruptcyStack: [], auctionResume: null, offerSpace: null, landingSpecial: null, pendingJailMove: null,
    log: [], sound: true, gameOver: false, fullBoard: false, endReason: ""
  };
}

function resolveInitialMonopolyRoll(before, dice) {
  const after = structuredClone(before), total = dice[0] + dice[1], actor = after.players[0];
  actor.pos = total;
  after.lastRoll = [...dice];
  after.doublesCount = dice[0] === dice[1] ? 1 : 0;
  after.extraRoll = dice[0] === dice[1];
  if (MONOPOLY_PROPERTY_IDS.includes(total)) {
    after.phase = "offer";
    after.offerSpace = total;
  } else if (total === 2 || total === 7) {
    const deck = total === 2 ? "community" : "chance", id = after.decks[deck].shift();
    after.phase = "cardDraw";
    after.pendingCard = { deck, id };
  } else if (total === 4) {
    actor.cash -= 200;
    after.phase = "end";
  } else {
    after.phase = "end";
  }
  return after;
}

function matchMemoryGroup(state, key) {
  const next = structuredClone(state), actor = state.turn;
  next.matchedKeys.push(key);
  next.deck.forEach((card, index) => { if (card.key === key) next.owners[index] = actor; });
  next.scores[actor - 1]++;
  next.moves++;
  const stat = next.stats[actor - 1]; stat.matches++; stat.attempts++; stat.flips += next.matchSize; stat.curStreak++; stat.longestStreak = Math.max(stat.longestStreak, stat.curStreak); stat.decisionCount++;
  return next;
}

function missMemoryGroup(state, decisionMs = 17) {
  const next = structuredClone(state), actor = state.turn;
  next.moves++;
  next.turn = (actor % next.players) + 1;
  const stat = next.stats[actor - 1];
  stat.attempts++;
  stat.misses++;
  stat.flips += next.matchSize;
  stat.curStreak = 0;
  stat.totalDecision += Math.floor(decisionMs);
  stat.decisionCount++;
  stat.mismatchPairCounts["a|b"] = (stat.mismatchPairCounts["a|b"] || 0) + 1;
  stat.bestRepeat = Math.max(stat.bestRepeat, stat.mismatchPairCounts["a|b"]);
  return next;
}

test("locked Arcade identities override game usernames and reject spoofing or binding theft", async () => {
  const service = new NearbyRoomService();
  await addMembers(service, ["alice", "bob", "cara"]);
  await assert.rejects(
    service.registerMember({ ...members.alice, nickname: "Mallory" }),
    (error) => error.status === 409
  );
  await assert.rejects(
    service.registerMember({ memberId: "member_other", nickname: "alice", avatar: "🍕" }),
    (error) => error.status === 409
  );

  const created = await http(service, members.alice.memberId, "/api/arcade/rooms", "POST", {
    game: "dots",
    username: "Mallory",
    maxPlayers: 3,
    state: { lines: [] }
  });
  assert.equal(created.status, 200);
  assert.equal(created.body.room.members[0].username, "Alice");
  const code = created.body.code;

  const joined = await http(service, members.bob.memberId, `/api/arcade/rooms/${code}/join`, "POST", { username: "Alice" });
  assert.equal(joined.status, 200);
  assert.equal(joined.body.room.members.find((member) => member.playerId === joined.body.playerId).username, "Bob");
  const third = await http(service, members.cara.memberId, `/api/arcade/rooms/${code}/join`, "POST", { username: "Bob" });
  assert.equal(third.status, 200);
  assert.deepEqual(third.body.room.members.map((member) => member.username), ["Alice", "Bob", "Cara"]);

  const stolenReconnect = await http(service, members.bob.memberId, `/api/arcade/rooms/${code}/join`, "POST", {
    reconnectToken: created.body.token,
    username: "Alice"
  });
  assert.equal(stolenReconnect.status, 403);

  const stolenAuthorization = await http(service, members.bob.memberId, `/api/arcade/rooms/${code}/state`, "GET", null, created.body.token);
  assert.equal(stolenAuthorization.status, 403);

  const renamed = await http(service, members.alice.memberId, `/api/arcade/rooms/${code}/actions`, "POST", {
    type: "rename",
    expectedVersion: third.body.room.version,
    username: "Mallory"
  }, created.body.token);
  assert.equal(renamed.status, 403);

  const spoofedChat = await http(service, members.alice.memberId, `/api/arcade/rooms/${code}/actions`, "POST", {
    type: "chat",
    text: "I am still Alice",
    username: "Mallory"
  }, created.body.token);
  assert.equal(spoofedChat.status, 400);

  const chat = await http(service, members.alice.memberId, `/api/arcade/rooms/${code}/actions`, "POST", {
    type: "chat",
    text: "Hello"
  }, created.body.token);
  assert.equal(chat.status, 200);
  assert.equal(chat.body.room.chat[0].username, "Alice");
});

test("Nearby Sorry authority replaces creator-proposed initial deck and Strategic hands", async () => {
  const proposalA = completeSorryDeck();
  const proposalB = proposalA.slice().reverse();

  async function startWithProposal(proposal, mode = "classic") {
    const service = new NearbyRoomService({ cryptoObject: deterministicCrypto() });
    await addMembers(service);
    const host = await http(service, members.alice.memberId, "/api/arcade/rooms", "POST", {
      game: "sorry",
      maxPlayers: 2,
      state: { lobby: { kind: "sorry-lobby", mode, showEndpoints: true, colors: [0, 1] } }
    });
    const guest = await http(service, members.bob.memberId, `/api/arcade/rooms/${host.body.code}/join`, "POST", {});
    const proposedState = nearbySorryState(guest.body.room, proposal, mode);
    const started = await http(service, members.alice.memberId, `/api/arcade/rooms/${host.body.code}/actions`, "POST", {
      type: "start",
      expectedVersion: guest.body.room.version,
      firstSeat: 0,
      state: proposedState
    }, host.body.token);
    assert.equal(started.status, 200);
    return { canonical: started.body.room.state, proposed: proposedState };
  }

  const first = await startWithProposal(proposalA);
  const second = await startWithProposal(proposalB);
  assert.deepEqual(first.canonical.deck, second.canonical.deck, "the same authority entropy produces the same deck regardless of the creator proposal");
  assert.notDeepEqual(first.canonical.deck, first.proposed.deck, "the creator's first permutation is not canonical");
  assert.notDeepEqual(second.canonical.deck, second.proposed.deck, "the creator's second permutation is not canonical");

  const strategic = await startWithProposal(proposalB, "strategic");
  assert.notDeepEqual(strategic.canonical.hands, strategic.proposed.hands, "the creator cannot deal preferred Strategic hands");
  assert.equal(strategic.canonical.hands.every((hand) => hand.length === 5), true);
  assert.equal(strategic.canonical.deck.length, 35);
});

test("Nearby Monopoly host owns start shuffles and every dice result", async () => {
  const service = new NearbyRoomService({ cryptoObject: deterministicCrypto(0x31415926) });
  await addMembers(service);
  const host = await http(service, members.alice.memberId, "/api/arcade/rooms", "POST", { game: "monopoly", maxPlayers: 2 });
  const guest = await http(service, members.bob.memberId, `/api/arcade/rooms/${host.body.code}/join`, "POST", {});
  assert.equal(host.status, 200);
  assert.equal(guest.status, 200);
  assert.equal(guest.body.room.nearbyRandom.version, 1);

  const proposed = nearbyMonopolyState(guest.body.room);
  const proposedChance = [...proposed.decks.chance];
  const started = await http(service, members.alice.memberId, `/api/arcade/rooms/${host.body.code}/actions`, "POST", {
    type: "start", expectedVersion: guest.body.room.version, firstSeat: 0, state: proposed
  }, host.body.token);
  assert.equal(started.status, 200, started.body.error);
  assert.notDeepEqual(started.body.room.state.decks.chance, proposedChance, "the creator cannot choose the Nearby Chance order");
  assert.deepEqual([...started.body.room.state.decks.chance].sort(), [...MONOPOLY_CHANCE_IDS].sort());
  assert.equal(started.body.room.nearbyRandom.dice, null, "future dice are not revealed before a roll request");

  const prepared = await http(service, members.alice.memberId, `/api/arcade/rooms/${host.body.code}/actions`, "POST", {
    type: "monopoly-random", expectedVersion: started.body.room.version, kind: "roll"
  }, host.body.token);
  assert.equal(prepared.status, 200, prepared.body.error);
  const canonicalDice = prepared.body.room.nearbyRandom.dice;
  assert.equal(Array.isArray(canonicalDice), true, "the host commits dice only for the current decision owner");
  const hiddenFromGuest = await http(service, members.bob.memberId, `/api/arcade/rooms/${host.body.code}/state`, "GET", null, guest.body.token);
  assert.equal(hiddenFromGuest.status, 200, hiddenFromGuest.body.error);
  assert.equal(hiddenFromGuest.body.room.nearbyRandom.dice, null, "a committed roll is not leaked to other seats");

  const abandonedCommit = await http(service, members.alice.memberId, `/api/arcade/rooms/${host.body.code}/actions`, "POST", {
    type: "state", expectedVersion: started.body.room.version, state: started.body.room.state, nextSeat: 0, finish: false,
    intent: { version: 1, kind: "mortgage", spaceId: 1 }
  }, host.body.token);
  assert.equal(abandonedCommit.status, 409);
  assert.match(abandonedCommit.body.error, /committed Nearby Monopoly roll/);

  const forgedDice = canonicalDice[0] === 6 ? [5, canonicalDice[1]] : [canonicalDice[0] + 1, canonicalDice[1]];
  const forged = await http(service, members.alice.memberId, `/api/arcade/rooms/${host.body.code}/actions`, "POST", {
    type: "state", expectedVersion: started.body.room.version, state: started.body.room.state, nextSeat: 0, finish: false,
    intent: { version: 1, kind: "roll", d1: forgedDice[0], d2: forgedDice[1] }
  }, host.body.token);
  assert.equal(forged.status, 422);
  assert.match(forged.body.error, /dice supplied by the Nearby Monopoly host/);

  const afterRoll = resolveInitialMonopolyRoll(started.body.room.state, canonicalDice);
  const accepted = await http(service, members.alice.memberId, `/api/arcade/rooms/${host.body.code}/actions`, "POST", {
    type: "state", expectedVersion: started.body.room.version, state: afterRoll, nextSeat: 0, finish: false,
    intent: { version: 1, kind: "roll", d1: canonicalDice[0], d2: canonicalDice[1] }
  }, host.body.token);
  assert.equal(accepted.status, 200, accepted.body.error);
  assert.equal(accepted.body.room.nearbyRandom.dice, null, "accepted rolls consume the host commitment");

  const checkpoint = await service.exportCheckpoint();
  const savedRandom = checkpoint.rooms.find((room) => room.game === "monopoly").monopolyRandom;
  assert.deepEqual(savedRandom, accepted.body.room.nearbyRandom, "host randomness survives Nearby checkpoints");
});

test("generic online-parity rooms enforce host, turn, stale version, three peers, and serialized compare-and-swap", async () => {
  const events = [];
  const service = new NearbyRoomService({ onEvent: (event) => events.push(event) });
  await addMembers(service, ["alice", "bob", "cara"]);
  const created = await http(service, members.alice.memberId, "/api/arcade/rooms", "POST", {
    game: "memory",
    maxPlayers: 3,
    state: { cards: [] }
  });
  const code = created.body.code;
  const bob = await http(service, members.bob.memberId, `/api/arcade/rooms/${code}/join`, "POST", {});
  const cara = await http(service, members.cara.memberId, `/api/arcade/rooms/${code}/join`, "POST", {});
  assert.equal(cara.body.room.members.length, 3);

  const guestStart = await http(service, members.bob.memberId, `/api/arcade/rooms/${code}/actions`, "POST", {
    type: "start",
    expectedVersion: cara.body.room.version,
    firstSeat: 0,
    state: nearbyMemoryState()
  }, bob.body.token);
  assert.equal(guestStart.status, 403);

  const started = await http(service, members.alice.memberId, `/api/arcade/rooms/${code}/actions`, "POST", {
    type: "start",
    expectedVersion: cara.body.room.version,
    firstSeat: 0,
    state: nearbyMemoryState()
  }, created.body.token);
  assert.equal(started.status, 200);

  const wrongTurn = await http(service, members.bob.memberId, `/api/arcade/rooms/${code}/actions`, "POST", {
    type: "state",
    expectedVersion: started.body.room.version,
    state: matchMemoryGroup(nearbyMemoryState(), "a"),
    nextSeat: 1
  }, bob.body.token);
  assert.equal(wrongTurn.status, 403);

  const version = started.body.room.version;
  const firstState = matchMemoryGroup(started.body.room.state, "a");
  const secondState = matchMemoryGroup(started.body.room.state, "b");
  const [first, second] = await Promise.all([
    http(service, members.alice.memberId, `/api/arcade/rooms/${code}/actions`, "POST", {
      type: "state", expectedVersion: version, state: firstState, nextSeat: 0
    }, created.body.token),
    http(service, members.alice.memberId, `/api/arcade/rooms/${code}/actions`, "POST", {
      type: "state", expectedVersion: version, state: secondState, nextSeat: 0
    }, created.body.token)
  ]);
  assert.deepEqual([first.status, second.status].sort(), [200, 409]);
  const canonical = await http(service, members.alice.memberId, `/api/arcade/rooms/${code}/state`, "GET", null, created.body.token);
  assert.equal(canonical.body.room.state.matchedKeys.length, 1);
  assert.equal(canonical.body.room.version, version + 1);
  assert.equal(NEARBY_GENERIC_AUTHORITY_CONTRACT.ruleValidated, true);
  assert.equal(NEARBY_GENERIC_AUTHORITY_CONTRACT.games.memory.ruleValidated, true);
  assert.equal(NEARBY_GENERIC_AUTHORITY_CONTRACT.games.sorry.ruleValidated, true);

  const remainingKey = canonical.body.room.state.matchedKeys[0] === "a" ? "b" : "a";
  const finalState = matchMemoryGroup(canonical.body.room.state, remainingKey);
  const spoofedWinnerState = structuredClone(finalState);
  spoofedWinnerState.names = ["Bob", "Alice", "Cara"];
  const spoofedWinner = await http(service, members.alice.memberId, `/api/arcade/rooms/${code}/actions`, "POST", {
    type: "state",
    expectedVersion: canonical.body.room.version,
    state: spoofedWinnerState,
    nextSeat: 0,
    finish: true,
    result: { scores: [2, 0, 0], winners: ["Bob"] }
  }, created.body.token);
  assert.equal(spoofedWinner.status, 422, "a state-level name spoof cannot redirect the canonical winner or Arcade Star");
  const finished = await http(service, members.alice.memberId, `/api/arcade/rooms/${code}/actions`, "POST", {
    type: "state",
    expectedVersion: canonical.body.room.version,
    state: finalState,
    nextSeat: 0,
    finish: true,
    result: { scores: [2, 0, 0], winners: ["Alice"] }
  }, created.body.token);
  assert.equal(finished.status, 200);
  const completion = await service.completionFor("arcade", code);
  assert.equal(completion.canonical, true);
  assert.equal(completion.verifiedRules, true);
  assert.equal(completion.authority, NEARBY_GENERIC_AUTHORITY_CONTRACT.games.memory.id);
  assert.equal(completion.winnerMemberId, members.alice.memberId);
  const terminalId = completion.completionId;
  assert.match(terminalId, /^terminal:arcade:/);
  assert.equal(events.filter((event) => event.type === "completion").length, 1);

  const loserLeft = await http(service, members.bob.memberId, `/api/arcade/rooms/${code}/actions`, "POST", { type: "leave" }, bob.body.token);
  assert.equal(loserLeft.status, 200);
  const replayed = await service.completionFor("arcade", code);
  assert.equal(replayed.completionId, terminalId, "post-finish membership changes retain the original terminal identity");
  assert.ok(replayed.version > completion.version);
  assert.equal(events.filter((event) => event.type === "completion").length, 1, "a losing player leaving cannot emit another Star-bearing completion");
});

test("Memory mismatch history survives hydration and a second player's honest turn", async () => {
  const service = new NearbyRoomService();
  await addMembers(service);
  const host = await http(service, members.alice.memberId, "/api/arcade/rooms", "POST", { game: "memory", maxPlayers: 2 });
  const code = host.body.code;
  const guest = await http(service, members.bob.memberId, `/api/arcade/rooms/${code}/join`, "POST", {});
  const initial = nearbyMemoryState(["Alice", "Bob"]);
  initial.players = 2;
  initial.seatOrder = [0, 1];
  initial.teams = [1, 2];
  initial.uniqueTeams = [1, 2];
  initial.scores = [0, 0];
  initial.stats = initial.stats.slice(0, 2);
  let response = await http(service, members.alice.memberId, `/api/arcade/rooms/${code}/actions`, "POST", {
    type: "start", expectedVersion: guest.body.room.version, firstSeat: 0, state: initial
  }, host.body.token);
  assert.equal(response.status, 200);

  const aliceMiss = missMemoryGroup(response.body.room.state, 19.875);
  response = await http(service, members.alice.memberId, `/api/arcade/rooms/${code}/actions`, "POST", {
    type: "state", expectedVersion: response.body.room.version, state: aliceMiss, nextSeat: 1
  }, host.body.token);
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.room.state.stats[0].mismatchPairCounts, { "a|b": 1 });
  assert.equal(response.body.room.state.stats[0].totalDecision, 19);

  const bobMiss = missMemoryGroup(response.body.room.state, 23.5);
  response = await http(service, members.bob.memberId, `/api/arcade/rooms/${code}/actions`, "POST", {
    type: "state", expectedVersion: response.body.room.version, state: bobMiss, nextSeat: 0
  }, guest.body.token);
  assert.equal(response.status, 200, "the second player can act after hydrating the first player's mismatch statistics");
  assert.deepEqual(response.body.room.state.stats[0].mismatchPairCounts, { "a|b": 1 });
  assert.deepEqual(response.body.room.state.stats[1].mismatchPairCounts, { "a|b": 1 });
});

test("reused lobby seats resolve a Dots winner to the active replacement member", async () => {
  const service = new NearbyRoomService();
  await addMembers(service, ["alice", "bob", "cara"]);
  const host = await http(service, members.alice.memberId, "/api/arcade/rooms", "POST", { game: "dots", maxPlayers: 2 });
  const code = host.body.code;
  const departed = await http(service, members.bob.memberId, `/api/arcade/rooms/${code}/join`, "POST", {});
  assert.equal((await http(service, members.bob.memberId, `/api/arcade/rooms/${code}/actions`, "POST", { type: "leave" }, departed.body.token)).status, 200);
  const replacement = await http(service, members.cara.memberId, `/api/arcade/rooms/${code}/join`, "POST", {});
  assert.equal(replacement.body.seat, 1);

  let response = await http(service, members.alice.memberId, `/api/arcade/rooms/${code}/actions`, "POST", {
    type: "start", expectedVersion: replacement.body.room.version, firstSeat: 0, state: nearbyDotsState()
  }, host.body.token);
  assert.equal(response.status, 200);
  let state = response.body.room.state;

  state = structuredClone(state); state.HO[0][0] = 1; state.lastMove = { type: "H", r: 0, c: 0 }; state.turn = 2;
  response = await http(service, members.alice.memberId, `/api/arcade/rooms/${code}/actions`, "POST", { type: "state", expectedVersion: response.body.room.version, state, nextSeat: 1, finish: false }, host.body.token);
  assert.equal(response.status, 200);
  state = structuredClone(response.body.room.state); state.HO[1][0] = 2; state.lastMove = { type: "H", r: 1, c: 0 }; state.turn = 1;
  response = await http(service, members.cara.memberId, `/api/arcade/rooms/${code}/actions`, "POST", { type: "state", expectedVersion: response.body.room.version, state, nextSeat: 0, finish: false }, replacement.body.token);
  assert.equal(response.status, 200);
  state = structuredClone(response.body.room.state); state.VO[0][0] = 1; state.lastMove = { type: "V", r: 0, c: 0 }; state.turn = 2;
  response = await http(service, members.alice.memberId, `/api/arcade/rooms/${code}/actions`, "POST", { type: "state", expectedVersion: response.body.room.version, state, nextSeat: 1, finish: false }, host.body.token);
  assert.equal(response.status, 200);
  state = structuredClone(response.body.room.state); state.VO[0][1] = 2; state.boxOwner[0][0] = 2; state.scores = [0, 0, 1]; state.claimed = 1; state.lastMove = { type: "V", r: 0, c: 1 };
  response = await http(service, members.cara.memberId, `/api/arcade/rooms/${code}/actions`, "POST", {
    type: "state", expectedVersion: response.body.room.version, state, nextSeat: 1, finish: true,
    result: { winnerSeat: 1, tie: false, scores: [{ seat: 0, score: 0 }, { seat: 1, score: 1 }] }
  }, replacement.body.token);
  assert.equal(response.status, 200);
  const completion = await service.completionFor("arcade", code);
  assert.equal(completion.winnerPlayerId, replacement.body.playerId);
  assert.equal(completion.winnerMemberId, members.cara.memberId);
});

test("verified Tic Tac Toe rounds each emit once without ending their reusable room", async () => {
  const events = [];
  const service = new NearbyRoomService({ onEvent: (event) => events.push(event) });
  await addMembers(service);
  const host = await http(service, members.alice.memberId, "/api/arcade/rooms", "POST", { game: "tic-tac-toe", maxPlayers: 2 });
  const guest = await http(service, members.bob.memberId, `/api/arcade/rooms/${host.body.code}/join`, "POST", {});
  let response = await http(service, members.alice.memberId, `/api/arcade/rooms/${host.body.code}/actions`, "POST", {
    type: "start", expectedVersion: guest.body.room.version, firstSeat: 0, state: nearbyTicTacToeState()
  }, host.body.token);
  const moves = [[members.alice, host.body.token, 0, "X", 1], [members.bob, guest.body.token, 3, "O", 0], [members.alice, host.body.token, 1, "X", 1], [members.bob, guest.body.token, 4, "O", 0], [members.alice, host.body.token, 2, "X", 0]];
  for (let index = 0; index < moves.length; index++) {
    const [identity, token, square, mark, nextSeat] = moves[index];
    const state = structuredClone(response.body.room.state);
    state.board[square] = mark;
    if (index === moves.length - 1) {
      state.turn = "X"; state.scoreX = 1; state.roundOver = { winner: "X", line: [0, 1, 2] };
    } else state.turn = mark === "X" ? "O" : "X";
    response = await http(service, identity.memberId, `/api/arcade/rooms/${host.body.code}/actions`, "POST", { type: "state", expectedVersion: response.body.room.version, state, nextSeat }, token);
    assert.equal(response.status, 200);
  }
  assert.equal(response.body.room.status, "active");
  const completion = await service.completionFor("arcade", host.body.code);
  assert.equal(completion.winnerMemberId, members.alice.memberId);
  assert.equal(completion.result.type, "round");
  assert.equal(events.filter((event) => event.type === "completion").length, 1);

  const reset = structuredClone(response.body.room.state);
  reset.board = Array(9).fill(""); reset.turn = "X"; reset.roundOver = null;
  response = await http(service, members.alice.memberId, `/api/arcade/rooms/${host.body.code}/actions`, "POST", { type: "state", expectedVersion: response.body.room.version, state: reset, nextSeat: 0 }, host.body.token);
  assert.equal(response.status, 200);
  assert.equal(await service.completionFor("arcade", host.body.code), null);

  const secondMoves = [[members.alice, host.body.token, 6, "X", 1], [members.bob, guest.body.token, 0, "O", 0], [members.alice, host.body.token, 7, "X", 1], [members.bob, guest.body.token, 1, "O", 0], [members.alice, host.body.token, 8, "X", 0]];
  for (let index = 0; index < secondMoves.length; index++) {
    const [identity, token, square, mark, nextSeat] = secondMoves[index];
    const state = structuredClone(response.body.room.state);
    state.board[square] = mark;
    if (index === secondMoves.length - 1) {
      state.turn = "X"; state.scoreX = 2; state.roundOver = { winner: "X", line: [6, 7, 8] };
    } else state.turn = mark === "X" ? "O" : "X";
    response = await http(service, identity.memberId, `/api/arcade/rooms/${host.body.code}/actions`, "POST", { type: "state", expectedVersion: response.body.room.version, state, nextSeat }, token);
    assert.equal(response.status, 200);
  }
  const secondCompletion = await service.completionFor("arcade", host.body.code);
  assert.equal(secondCompletion.winnerMemberId, members.alice.memberId);
  assert.notEqual(secondCompletion.completionId, completion.completionId, "a later verified round has its own canonical completion identity");
  assert.equal(events.filter((event) => event.type === "completion").length, 2, "each completed round emits exactly once");
});

test("Nearby Chess uses exact shared authority and emits a canonical completion", async () => {
  const events = [];
  const service = new NearbyRoomService({ onEvent: (event) => events.push(event) });
  await addMembers(service);
  const white = await http(service, members.alice.memberId, "/api/chess/rooms", "POST", {});
  const code = white.body.room.code;
  const black = await http(service, members.bob.memberId, `/api/chess/rooms/${code}/join`, "POST", {});
  assert.equal(black.status, 200);

  const stolenTokenSocket = service.openSocket(members.bob.memberId, {
    socketId: "socket_stolen",
    url: `/api/chess/rooms/${code}/ws?token=${encodeURIComponent(white.body.token)}`
  });
  await assert.rejects(stolenTokenSocket, (error) => error.status === 403);

  const wrongTurn = await http(service, members.bob.memberId, `/api/chess/rooms/${code}/actions`, "POST", {
    type: "move", uci: "e7e5", expectedVersion: black.body.room.version
  }, black.body.token);
  assert.equal(wrongTurn.status, 403);

  const illegal = await http(service, members.alice.memberId, `/api/chess/rooms/${code}/actions`, "POST", {
    type: "move", uci: "e7e5", expectedVersion: black.body.room.version
  }, white.body.token);
  assert.equal(illegal.status, 422);

  const moved = await http(service, members.alice.memberId, `/api/chess/rooms/${code}/actions`, "POST", {
    type: "move", uci: "e2e4", expectedVersion: black.body.room.version
  }, white.body.token);
  assert.equal(moved.status, 200);
  assert.equal(moved.body.room.game.moves[0].uci, "e2e4");

  const resigned = await http(service, members.bob.memberId, `/api/chess/rooms/${code}/actions`, "POST", {
    type: "resign", expectedVersion: moved.body.room.version
  }, black.body.token);
  assert.equal(resigned.status, 200);
  const completion = await service.completionFor("chess", code);
  assert.equal(completion.authority, NEARBY_CHESS_AUTHORITY_CONTRACT.id);
  assert.equal(completion.verifiedRules, true);
  assert.equal(completion.winnerMemberId, members.alice.memberId);
  assert.equal(events.filter((event) => event.type === "completion").length, 1);
});

test("socket presence and broadcasts are viewer-specific for a host and two guests", async () => {
  const events = [];
  const service = new NearbyRoomService({ onEvent: (event) => events.push(event) });
  await addMembers(service, ["alice", "bob", "cara"]);
  const host = await http(service, members.alice.memberId, "/api/arcade/rooms", "POST", { game: "chat", maxPlayers: 3 });
  const code = host.body.code;
  const bob = await http(service, members.bob.memberId, `/api/arcade/rooms/${code}/join`, "POST", {});
  const cara = await http(service, members.cara.memberId, `/api/arcade/rooms/${code}/join`, "POST", {});

  const hostSocket = await service.openSocket(members.alice.memberId, {
    socketId: "socket_alice",
    url: `/api/arcade/rooms/${code}/ws?token=${encodeURIComponent(host.body.token)}`
  });
  assert.equal(JSON.parse(hostSocket.initialData).room.presence[host.body.playerId], true);
  await service.openSocket(members.bob.memberId, {
    socketId: "socket_bob",
    url: `/api/arcade/rooms/${code}/ws?token=${encodeURIComponent(bob.body.token)}`
  });
  const caraSocket = await service.openSocket(members.cara.memberId, {
    socketId: "socket_cara",
    url: `/api/arcade/rooms/${code}/ws?token=${encodeURIComponent(cara.body.token)}`
  });
  const caraInitial = JSON.parse(caraSocket.initialData);
  assert.deepEqual(Object.values(caraInitial.room.presence), [true, true, true]);
  const hostUpdates = events.filter((event) => event.type === "socket-message" && event.socketId === "socket_alice");
  assert.ok(hostUpdates.some((event) => Object.values(JSON.parse(event.data).room.presence).every(Boolean)));

  events.length = 0;
  const sent = await service.sendSocket(members.alice.memberId, {
    socketId: "socket_alice",
    data: JSON.stringify({ type: "chat", text: "Nearby hello" })
  });
  assert.equal(sent.ok, true);
  const guestChat = events.find((event) => event.type === "socket-message" && event.socketId === "socket_bob" && JSON.parse(event.data).room?.chat?.length === 1);
  assert.equal(JSON.parse(guestChat.data).room.chat[0].username, "Alice");

  events.length = 0;
  const closed = await service.closeMemberSockets(members.bob.memberId, "Device left the Nearby Arcade");
  assert.deepEqual(closed, { ok: true, closed: 1 });
  assert.ok(events.some((event) => event.type === "socket-close" && event.socketId === "socket_bob"));
  await assert.rejects(
    service.sendSocket(members.bob.memberId, { socketId: "socket_bob", data: JSON.stringify({ type: "chat", text: "stale" }) }),
    (error) => error.status === 403
  );
  const hostAfterClose = events.filter((event) => event.type === "socket-message" && event.socketId === "socket_alice").at(-1);
  assert.equal(JSON.parse(hostAfterClose.data).room.presence[bob.body.playerId], false);
});

test("removing a Nearby member abandons active generic play and resolves active Chess authority", async () => {
  const generic = new NearbyRoomService();
  await addMembers(generic, ["alice", "bob", "cara"]);
  const host = await http(generic, members.alice.memberId, "/api/arcade/rooms", "POST", { game: "memory", maxPlayers: 3 });
  const code = host.body.code;
  const bob = await http(generic, members.bob.memberId, `/api/arcade/rooms/${code}/join`, "POST", {});
  const cara = await http(generic, members.cara.memberId, `/api/arcade/rooms/${code}/join`, "POST", {});
  const started = await http(generic, members.alice.memberId, `/api/arcade/rooms/${code}/actions`, "POST", {
    type: "start", expectedVersion: cara.body.room.version, firstSeat: 0, state: nearbyMemoryState()
  }, host.body.token);
  assert.equal(started.status, 200);
  const removed = await generic.removeMemberFromRooms(members.alice.memberId, "Host removed player");
  assert.equal(removed.rooms[0].outcome, "ended");
  const remaining = await http(generic, members.bob.memberId, `/api/arcade/rooms/${code}/state`, "GET", null, bob.body.token);
  assert.equal(remaining.body.room.status, "finished");
  assert.equal(remaining.body.room.turn, null);
  assert.deepEqual(remaining.body.room.result, { type: "abandoned", reason: "player-removed", departedPlayerId: host.body.playerId });
  assert.deepEqual(remaining.body.room.members.map((item) => item.username), ["Bob", "Cara"]);
  const genericCompletion = await generic.completionFor("arcade", code);
  assert.equal(genericCompletion.winnerMemberId, null);
  assert.equal(genericCompletion.tie, false);

  const chess = new NearbyRoomService();
  await addMembers(chess);
  const white = await http(chess, members.alice.memberId, "/api/chess/rooms", "POST", {});
  const chessCode = white.body.room.code;
  const black = await http(chess, members.bob.memberId, `/api/chess/rooms/${chessCode}/join`, "POST", {});
  const chessRemoved = await chess.removeMemberFromRooms(members.alice.memberId, "Removed by host");
  assert.equal(chessRemoved.rooms[0].outcome, "resigned");
  const completion = await chess.completionFor("chess", chessCode);
  assert.equal(completion.result.reason, "resignation");
  assert.equal(completion.winnerMemberId, members.bob.memberId);
  const blackState = await http(chess, members.bob.memberId, `/api/chess/rooms/${chessCode}/state`, "GET", null, black.body.token);
  assert.equal(blackState.body.room.game.result.winner, "b");
});

test("voluntary leave abandons active generic play without leaving a stale binding", async () => {
  const service = new NearbyRoomService();
  await addMembers(service);
  const host = await http(service, members.alice.memberId, "/api/arcade/rooms", "POST", { game: "memory", maxPlayers: 2 });
  const code = host.body.code;
  const bob = await http(service, members.bob.memberId, `/api/arcade/rooms/${code}/join`, "POST", {});
  const initial = nearbyMemoryState(["Alice", "Bob"]);
  initial.players = 2; initial.seatOrder = [0, 1]; initial.teams = [1, 2]; initial.uniqueTeams = [1, 2]; initial.scores = [0, 0]; initial.stats = initial.stats.slice(0, 2);
  const started = await http(service, members.alice.memberId, `/api/arcade/rooms/${code}/actions`, "POST", {
    type: "start", expectedVersion: bob.body.room.version, firstSeat: 0, state: initial
  }, host.body.token);
  assert.equal(started.status, 200);

  const left = await http(service, members.alice.memberId, `/api/arcade/rooms/${code}/actions`, "POST", { type: "leave" }, host.body.token);
  assert.deepEqual(left, { status: 200, body: { ok: true, room: null } });
  assert.equal(service.rooms.get(`arcade:${code}`).bindings.has(members.alice.memberId), false);
  const remaining = await http(service, members.bob.memberId, `/api/arcade/rooms/${code}/state`, "GET", null, bob.body.token);
  assert.equal(remaining.body.room.status, "finished");
  assert.deepEqual(remaining.body.room.result, { type: "abandoned", reason: "player-left", departedPlayerId: host.body.playerId });
});

test("oversized canonical generic snapshots are rejected transactionally without dropping peers", async () => {
  const events = [];
  const service = new NearbyRoomService({ onEvent: (event) => events.push(event) });
  await addMembers(service);
  const host = await http(service, members.alice.memberId, "/api/arcade/rooms", "POST", { game: "memory", maxPlayers: 2 });
  const code = host.body.code;
  const guest = await http(service, members.bob.memberId, `/api/arcade/rooms/${code}/join`, "POST", {});
  const initial = nearbyMemoryState(["Alice", "Bob"]);
  initial.players = 2; initial.seatOrder = [0, 1]; initial.names = ["Alice", "Bob"]; initial.teams = [1, 2]; initial.uniqueTeams = [1, 2];
  initial.scores = [0, 0]; initial.stats = initial.stats.slice(0, 2);
  const started = await http(service, members.alice.memberId, `/api/arcade/rooms/${code}/actions`, "POST", {
    type: "start", expectedVersion: guest.body.room.version, firstSeat: 0, state: initial
  }, host.body.token);
  assert.equal(started.status, 200);
  await service.openSocket(members.alice.memberId, { socketId: "wire_host", url: `/api/arcade/rooms/${code}/ws?token=${encodeURIComponent(host.body.token)}` });
  await service.openSocket(members.bob.memberId, { socketId: "wire_guest", url: `/api/arcade/rooms/${code}/ws?token=${encodeURIComponent(guest.body.token)}` });
  const chatted = await http(service, members.alice.memberId, `/api/arcade/rooms/${code}/actions`, "POST", { type: "chat", text: "Still connected" }, host.body.token);
  assert.equal(chatted.status, 200);
  const canonicalVersion = chatted.body.room.version;
  const oversizedState = matchMemoryGroup(chatted.body.room.state, "a");
  oversizedState.stats[0].mismatchPairCounts = Object.fromEntries(Array.from({ length: 1200 }, (_, index) => [`${String(index).padStart(4, "0")}_${"x".repeat(44)}`, 1]));
  events.length = 0;
  const rejected = await http(service, members.alice.memberId, `/api/arcade/rooms/${code}/actions`, "POST", {
    type: "state", expectedVersion: canonicalVersion, state: oversizedState, nextSeat: 0
  }, host.body.token);
  assert.equal(rejected.status, 413);
  const canonical = await http(service, members.alice.memberId, `/api/arcade/rooms/${code}/state`, "GET", null, host.body.token);
  assert.equal(canonical.body.room.version, canonicalVersion);
  assert.deepEqual(canonical.body.room.state.matchedKeys, []);
  assert.equal(canonical.body.room.chat.length, 1);
  assert.equal(service.sockets.size, 2);
  assert.equal(events.some((event) => event.type === "socket-close"), false);
});

test("checkpoints restore locked bindings and canonical state without live socket claims", async () => {
  const first = new NearbyRoomService();
  await addMembers(first);
  const white = await http(first, members.alice.memberId, "/api/chess/rooms", "POST", {});
  const code = white.body.room.code;
  const black = await http(first, members.bob.memberId, `/api/chess/rooms/${code}/join`, "POST", {});
  const moved = await http(first, members.alice.memberId, `/api/chess/rooms/${code}/actions`, "POST", {
    type: "move", uci: "d2d4", expectedVersion: black.body.room.version
  }, white.body.token);
  assert.equal(moved.status, 200);

  const checkpoint = await first.exportCheckpoint();
  const restored = new NearbyRoomService();
  const imported = await restored.importCheckpoint(checkpoint);
  assert.equal(imported.rooms, 1);
  assert.ok(imported.members.every((member) => member.connected === false));
  await restored.registerMember(members.alice);
  await restored.registerMember(members.bob);
  const state = await http(restored, members.bob.memberId, `/api/chess/rooms/${code}/state`, "GET", null, black.body.token);
  assert.equal(state.status, 200);
  assert.equal(state.body.room.game.moves[0].uci, "d2d4");

  const corrupted = structuredClone(checkpoint);
  corrupted.rooms[0].bindings[0].token = black.body.token;
  const rejected = new NearbyRoomService();
  await assert.rejects(rejected.importCheckpoint(corrupted), (error) => error.status === 400);
});

test("router rejects arbitrary paths, methods, malformed bodies, and oversized requests", async () => {
  const service = new NearbyRoomService();
  await service.registerMember(members.alice);
  const bindingClaim = await http(service, members.alice.memberId, "/api/arcade/rooms", "POST", {
    game: "chat", reconnectToken: "x".repeat(43)
  });
  assert.equal(bindingClaim.status, 400);
  const missing = await http(service, members.alice.memberId, "/api/arcade/rooms/ABC234/actions/anything", "POST", {});
  assert.equal(missing.status, 404);
  const absolute = await http(service, members.alice.memberId, "https://evil.example/api/arcade/rooms", "POST", {});
  assert.equal(absolute.status, 400);
  const wrongMethod = await http(service, members.alice.memberId, "/api/chess/rooms", "GET", null);
  assert.equal(wrongMethod.status, 405);
  const malformed = await service.handleHttp(members.alice.memberId, {
    url: "/api/arcade/rooms", method: "POST", body: "not-json"
  });
  assert.equal(malformed.status, 400);
  const oversized = await http(service, members.alice.memberId, "/api/arcade/rooms", "POST", {
    game: "chat", padding: "x".repeat(385 * 1024)
  });
  assert.equal(oversized.status, 413);
  await assert.rejects(
    service.openSocket(members.alice.memberId, { socketId: "socket_bad", url: "/api/arcade/rooms" }),
    (error) => error.status === 400
  );
});
