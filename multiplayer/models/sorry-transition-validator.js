/*
 * Exact, environment-neutral authority for one network-visible Sorry update.
 *
 * The browser sends snapshots at decision boundaries instead of sending its
 * private UI selection object.  This validator independently advances the
 * canonical rules from the prior snapshot and accepts only a snapshot that is
 * reachable at the next boundary.  It intentionally ignores presentation-only
 * fields such as savedAt and flow.animationText.
 */

const VERSION = 5;
const CARD_COUNTS = Object.freeze({ "1": 5, "2": 4, "3": 4, "4": 4, "5": 4, "7": 4, "8": 4, "10": 4, "11": 4, "12": 4, S: 4 });
const CARDS = Object.freeze(Object.keys(CARD_COUNTS));
const CARD_SET = new Set(CARDS);
const COLORS = Object.freeze([
  Object.freeze({ key: "red", start: 4, entry: 2 }),
  Object.freeze({ key: "blue", start: 19, entry: 17 }),
  Object.freeze({ key: "yellow", start: 34, entry: 32 }),
  Object.freeze({ key: "green", start: 49, entry: 47 })
]);
const SLIDES = Object.freeze([
  Object.freeze({ start: 1, end: 4, owner: "red", path: Object.freeze([1, 2, 3, 4]) }),
  Object.freeze({ start: 9, end: 13, owner: "blue", path: Object.freeze([9, 10, 11, 12, 13]) }),
  Object.freeze({ start: 16, end: 19, owner: "blue", path: Object.freeze([16, 17, 18, 19]) }),
  Object.freeze({ start: 24, end: 28, owner: "yellow", path: Object.freeze([24, 25, 26, 27, 28]) }),
  Object.freeze({ start: 31, end: 34, owner: "yellow", path: Object.freeze([31, 32, 33, 34]) }),
  Object.freeze({ start: 39, end: 43, owner: "green", path: Object.freeze([39, 40, 41, 42, 43]) }),
  Object.freeze({ start: 46, end: 49, owner: "green", path: Object.freeze([46, 47, 48, 49]) }),
  Object.freeze({ start: 54, end: 58, owner: "red", path: Object.freeze([54, 55, 56, 57, 58]) })
]);
const FIRE_SPACES = Object.freeze([0, 15, 30, 45]);
const NETWORK_PHASES = new Set(["preFire", "draw", "chooseCard", "ice", "fireToken", "action", "firePull", "gameOver"]);
const ROOT_FIELDS = new Set([
  "version", "started", "mode", "skill", "showEndpoints", "players", "pawns", "turn", "deck", "discard", "hands",
  "firePawnId", "icePawnId", "currentCard", "phase", "selectedCardIndex", "flow", "winner", "moveNo", "savedAt",
  "pendingFirePull", "online"
]);

export const SORRY_AUTHORITY = Object.freeze({
  id: "sorry-transition-v3",
  ruleValidated: true,
  completionVerified: true,
  scope: "host-originated secure initial deck, exact card order and consumption, Fire/Ice decisions, legal single, split, switch, SORRY!, Fire jump/pull, turn, and completion transitions"
});

function gameError(message, status = 422) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function requireValue(condition, message) {
  if (!condition) throw gameError(message);
}

function object(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function integer(value, minimum, maximum) {
  return Number.isInteger(value) && value >= minimum && value <= maximum;
}

function clone(value) {
  return typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function activeMembers(room) {
  return room.members.filter((member) => !member.leftAt).sort((left, right) => left.seat - right.seat);
}

function playerIndexForSeat(state, seat) {
  return state.players.findIndex((player) => player.seat === seat);
}

function nextPlayerIndex(state, room, fromIndex) {
  const seats = new Set(activeMembers(room).map((member) => Number(member.seat)));
  for (let offset = 1; offset <= state.players.length; offset++) {
    const index = (fromIndex + offset) % state.players.length;
    if (seats.has(Number(state.players[index].seat))) return index;
  }
  return fromIndex;
}

function colorForPlayer(state, playerIndex) {
  return COLORS[state.players[playerIndex]?.colorIndex] || COLORS[playerIndex] || COLORS[0];
}

function pawnById(state, id) {
  return state.pawns[id] || null;
}

function isIced(state, pawnId) {
  return state.icePawnId === pawnId;
}

function pawnAtTrack(state, position, excludedId = -1) {
  return state.pawns.find((pawn) => pawn.id !== excludedId && pawn.zone === "track" && pawn.pos === position) || null;
}

function pawnAtSafety(state, player, position, excludedId = -1) {
  return state.pawns.find((pawn) => pawn.id !== excludedId && pawn.player === player && pawn.zone === "safety" && pawn.pos === position) || null;
}

function slideAt(state, position, player) {
  const color = colorForPlayer(state, player).key;
  return SLIDES.find((slide) => slide.start === position && slide.owner !== color) || null;
}

function destinationFor(state, pawn, direction, amount) {
  const color = colorForPlayer(state, pawn.player);
  if (pawn.zone === "home" || pawn.zone === "start") return null;
  if (direction === "backward") {
    if (pawn.zone === "track") return { zone: "track", pos: (pawn.pos - amount + 600) % 60 };
    if (amount <= pawn.pos) return { zone: "safety", pos: pawn.pos - amount };
    const remaining = amount - (pawn.pos + 1);
    return { zone: "track", pos: (color.entry - remaining + 600) % 60 };
  }
  if (pawn.zone === "safety") {
    const target = pawn.pos + amount;
    if (target < 5) return { zone: "safety", pos: target };
    if (target === 5) return { zone: "home", pos: 0 };
    return null;
  }
  const distanceToEntry = (color.entry - pawn.pos + 60) % 60;
  if (amount <= distanceToEntry) return { zone: "track", pos: (pawn.pos + amount) % 60 };
  const remaining = amount - distanceToEntry - 1;
  if (remaining < 5) return { zone: "safety", pos: remaining };
  if (remaining === 5) return { zone: "home", pos: 0 };
  return null;
}

function validateTrackLanding(state, pawn, destination) {
  const occupant = pawnAtTrack(state, destination, pawn.id);
  if (occupant && (occupant.player === pawn.player || isIced(state, occupant.id))) return null;
  const slide = slideAt(state, destination, pawn.player);
  if (!slide) return { destination: { zone: "track", pos: destination }, bumps: occupant ? [occupant.id] : [], slide: null };
  const endOccupant = pawnAtTrack(state, slide.end, pawn.id);
  if (endOccupant && isIced(state, endOccupant.id)) return null;
  const bumps = [];
  for (const position of slide.path) {
    const hit = pawnAtTrack(state, position, pawn.id);
    if (hit && !isIced(state, hit.id) && !bumps.includes(hit.id)) bumps.push(hit.id);
  }
  return { destination: { zone: "track", pos: slide.end }, bumps, slide };
}

function planMove(state, pawnId, kind, amount) {
  const pawn = pawnById(state, pawnId);
  if (!pawn || pawn.zone === "home" || isIced(state, pawn.id)) return null;
  let destination;
  if (kind === "start") {
    if (pawn.zone !== "start" || !Number.isInteger(amount) || amount < 1) return null;
    const color = colorForPlayer(state, pawn.player);
    const entered = { ...pawn, zone: "track", pos: color.start };
    destination = amount === 1 ? { zone: "track", pos: color.start } : destinationFor(state, entered, "forward", amount - 1);
  } else {
    if (pawn.zone === "start") return null;
    destination = destinationFor(state, pawn, kind, amount);
  }
  if (!destination) return null;
  let bumps = [], slide = null;
  if (destination.zone === "track") {
    const landing = validateTrackLanding(state, pawn, destination.pos);
    if (!landing) return null;
    destination = landing.destination;
    bumps = landing.bumps;
    slide = landing.slide;
  } else if (destination.zone === "safety" && pawnAtSafety(state, pawn.player, destination.pos, pawn.id)) {
    return null;
  }
  return { type: "move", pawnId, kind, amount, destination, bumps, slide, enteredHome: destination.zone === "home" };
}

function applyMove(state, plan) {
  for (const id of plan.bumps) {
    const pawn = pawnById(state, id);
    if (pawn) { pawn.zone = "start"; pawn.pos = 0; }
  }
  const pawn = pawnById(state, plan.pawnId);
  pawn.zone = plan.destination.zone;
  pawn.pos = plan.destination.pos;
  if (plan.enteredHome && state.firePawnId === pawn.id) state.pendingFirePull = true;
}

function planSwitch(state, ownId, targetId) {
  const own = pawnById(state, ownId), target = pawnById(state, targetId);
  if (!own || !target || own.player === target.player || own.zone !== "track" || target.zone !== "track" || isIced(state, own.id) || isIced(state, target.id)) return null;
  const copy = clone(state), copiedOwn = pawnById(copy, ownId), copiedTarget = pawnById(copy, targetId);
  const oldPosition = copiedOwn.pos;
  copiedOwn.pos = copiedTarget.pos;
  copiedTarget.pos = oldPosition;
  const slide = slideAt(copy, copiedOwn.pos, copiedOwn.player);
  const bumps = [];
  let destination = { zone: "track", pos: copiedOwn.pos };
  if (slide) {
    const endOccupant = pawnAtTrack(copy, slide.end, copiedOwn.id);
    if (endOccupant && isIced(copy, endOccupant.id)) return null;
    for (const position of slide.path) {
      const hit = pawnAtTrack(copy, position, copiedOwn.id);
      if (hit && !isIced(copy, hit.id) && !bumps.includes(hit.id)) bumps.push(hit.id);
    }
    destination = { zone: "track", pos: slide.end };
  }
  return { type: "switch", ownId, targetId, destination, targetPosition: oldPosition, bumps, slide };
}

function applySwitch(state, plan) {
  const own = pawnById(state, plan.ownId), target = pawnById(state, plan.targetId);
  const oldPosition = own.pos;
  own.pos = target.pos;
  target.pos = oldPosition;
  for (const id of plan.bumps) {
    const hit = pawnById(state, id);
    if (hit) { hit.zone = "start"; hit.pos = 0; }
  }
  own.zone = plan.destination.zone;
  own.pos = plan.destination.pos;
}

function planSorry(state, ownId, targetId) {
  const own = pawnById(state, ownId), target = pawnById(state, targetId);
  if (!own || !target || own.zone !== "start" || target.zone !== "track" || own.player === target.player || isIced(state, own.id) || isIced(state, target.id)) return null;
  const copy = clone(state), copiedTarget = pawnById(copy, targetId);
  copiedTarget.zone = "start";
  copiedTarget.pos = 0;
  const landing = validateTrackLanding(copy, pawnById(copy, ownId), target.pos);
  if (!landing) return null;
  return { type: "sorry", pawnId: ownId, targetId, destination: landing.destination, bumps: [targetId, ...landing.bumps.filter((id) => id !== targetId)], slide: landing.slide };
}

function applySorry(state, plan) {
  for (const id of plan.bumps) {
    const hit = pawnById(state, id);
    if (hit) { hit.zone = "start"; hit.pos = 0; }
  }
  const own = pawnById(state, plan.pawnId);
  own.zone = plan.destination.zone;
  own.pos = plan.destination.pos;
}

function splitPlans(state, player) {
  const plans = [];
  for (let firstAmount = 1; firstAmount <= 6; firstAmount++) {
    const secondAmount = 7 - firstAmount;
    for (const firstPawn of state.pawns.filter((pawn) => pawn.player === player && pawn.zone !== "start" && pawn.zone !== "home" && !isIced(state, pawn.id))) {
      const first = planMove(state, firstPawn.id, "forward", firstAmount);
      if (!first) continue;
      const copy = clone(state);
      applyMove(copy, first);
      for (const secondPawn of copy.pawns.filter((pawn) => pawn.player === player && pawn.id !== firstPawn.id && pawn.zone !== "start" && pawn.zone !== "home" && !isIced(copy, pawn.id))) {
        const second = planMove(copy, secondPawn.id, "forward", secondAmount);
        if (second) plans.push({ type: "split", first, second });
      }
    }
  }
  return plans;
}

function legalPlans(state, card, player) {
  const plans = [], own = state.pawns.filter((pawn) => pawn.player === player);
  const startAmount = ({ "1": 1, "2": 2, "3": 3, "5": 5, "7": 7, "8": 8, "10": 10, "11": 11, "12": 12 })[card] || 0;
  if (startAmount) for (const pawn of own) {
    const plan = planMove(state, pawn.id, "start", startAmount);
    if (plan) plans.push(plan);
  }
  const addMoves = (kind, amount) => {
    for (const pawn of own) {
      const plan = planMove(state, pawn.id, kind, amount);
      if (plan) plans.push(plan);
    }
  };
  if (card === "1") addMoves("forward", 1);
  if (card === "2") addMoves("forward", 2);
  if (card === "3") addMoves("forward", 3);
  if (card === "4") addMoves("backward", 4);
  if (card === "5") addMoves("forward", 5);
  if (card === "7") { addMoves("forward", 7); plans.push(...splitPlans(state, player)); }
  if (card === "8") addMoves("forward", 8);
  if (card === "10") { addMoves("forward", 10); addMoves("backward", 1); }
  if (card === "11") {
    addMoves("forward", 11);
    const ownTrack = own.filter((pawn) => pawn.zone === "track" && !isIced(state, pawn.id));
    const targets = state.pawns.filter((pawn) => pawn.player !== player && pawn.zone === "track" && !isIced(state, pawn.id));
    for (const mine of ownTrack) for (const target of targets) {
      const plan = planSwitch(state, mine.id, target.id);
      if (plan) plans.push(plan);
    }
  }
  if (card === "12") addMoves("forward", 12);
  if (card === "S") {
    for (const mine of own.filter((pawn) => pawn.zone === "start" && !isIced(state, pawn.id))) {
      for (const target of state.pawns.filter((pawn) => pawn.player !== player && pawn.zone === "track" && !isIced(state, pawn.id))) {
        const plan = planSorry(state, mine.id, target.id);
        if (plan) plans.push(plan);
      }
    }
    addMoves("forward", 4);
  }
  return plans;
}

function fireJumpPlan(state, pawnId) {
  const pawn = pawnById(state, pawnId);
  if (!pawn || pawn.zone !== "track" || isIced(state, pawn.id)) return null;
  let target = null, distance = 0;
  for (let step = 1; step <= 60; step++) {
    const position = (pawn.pos + step) % 60;
    if (FIRE_SPACES.includes(position)) { target = position; distance = step; break; }
  }
  if (target === null) return null;
  const distanceToEntry = (colorForPlayer(state, pawn.player).entry - pawn.pos + 60) % 60;
  if (distanceToEntry < distance) return null;
  const landing = validateTrackLanding(state, pawn, target);
  return landing ? { type: "fireJump", pawnId, destination: landing.destination, bumps: landing.bumps, slide: landing.slide } : null;
}

function applyFireJump(state, plan) {
  for (const id of plan.bumps) {
    const hit = pawnById(state, id);
    if (hit) { hit.zone = "start"; hit.pos = 0; }
  }
  const pawn = pawnById(state, plan.pawnId);
  pawn.zone = plan.destination.zone;
  pawn.pos = plan.destination.pos;
}

function applyPlan(state, plan) {
  if (plan.type === "move") applyMove(state, plan);
  else if (plan.type === "switch") applySwitch(state, plan);
  else if (plan.type === "sorry") applySorry(state, plan);
  else if (plan.type === "split") { applyMove(state, plan.first); applyMove(state, plan.second); }
}

function cardCounts(cards) {
  const counts = Object.fromEntries(CARDS.map((card) => [card, 0]));
  for (const card of cards) counts[card]++;
  return counts;
}

function sortedCards(cards) {
  return cards.slice().sort((left, right) => CARDS.indexOf(left) - CARDS.indexOf(right));
}

function authorityShuffle(cards, state) {
  const shuffled = cards.slice();
  const material = `${state.moveNo}|${state.turn}|${cards.join("|")}`;
  let seed = 2166136261;
  for (let index = 0; index < material.length; index++) {
    seed ^= material.charCodeAt(index);
    seed = Math.imul(seed, 16777619) >>> 0;
  }
  if (!seed) seed = 0x9e3779b9;
  const random = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 4294967296;
  };
  for (let index = shuffled.length - 1; index > 0; index--) {
    const selected = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[selected]] = [shuffled[selected], shuffled[index]];
  }
  return shuffled;
}

function secureRandomIndex(maxExclusive, cryptoObject) {
  requireValue(Number.isInteger(maxExclusive) && maxExclusive >= 1 && maxExclusive <= 256, "Invalid Sorry shuffle range");
  if (!cryptoObject || typeof cryptoObject.getRandomValues !== "function") throw gameError("Secure random values are unavailable for Nearby Sorry", 503);
  const values = new Uint32Array(1);
  const range = 0x100000000;
  const limit = range - (range % maxExclusive);
  // Rejection sampling avoids modulo bias. A conforming Web Crypto source will
  // make this loop finish immediately in all but an exceptionally rare draw.
  for (let attempt = 0; attempt < 128; attempt++) {
    cryptoObject.getRandomValues(values);
    if (values[0] < limit) return values[0] % maxExclusive;
  }
  throw gameError("Secure random values could not initialize Nearby Sorry", 503);
}

function secureInitialDeck(cryptoObject) {
  const deck = Object.entries(CARD_COUNTS).flatMap(([card, count]) => Array(count).fill(card));
  for (let index = deck.length - 1; index > 0; index--) {
    const selected = secureRandomIndex(index + 1, cryptoObject);
    [deck[index], deck[selected]] = [deck[selected], deck[index]];
  }
  return deck;
}

/*
 * NearbyRoomService calls this before validating/committing a start snapshot.
 * Only the authority-generated random fields are replaced: every other field
 * remains client-proposed and must still pass the exact start validator.
 */
export function canonicalizeSorryStart(actionValue, cryptoObject = globalThis.crypto) {
  requireValue(object(actionValue) && (actionValue.type === "start" || actionValue.type === "restart"), "Invalid Sorry start action");
  requireValue(object(actionValue.state) && ["fireIce", "classic", "strategic"].includes(actionValue.state.mode), "Invalid Sorry start state");
  requireValue(Array.isArray(actionValue.state.players) && integer(actionValue.state.players.length, 2, 4), "Invalid Sorry player count");
  const action = clone(actionValue), deck = secureInitialDeck(cryptoObject);
  action.state.hands = Array.from({ length: action.state.players.length }, () => []);
  if (action.state.mode === "strategic") {
    for (let round = 0; round < 5; round++) {
      for (let player = 0; player < action.state.players.length; player++) action.state.hands[player].push(deck.pop());
    }
  }
  action.state.deck = deck;
  return action;
}

function cleanFlow(flow) {
  const clean = {};
  if (Object.hasOwn(flow, "previousIcePawnId")) clean.previousIcePawnId = flow.previousIcePawnId;
  if (Object.hasOwn(flow, "previousFirePawnId")) clean.previousFirePawnId = flow.previousFirePawnId;
  return clean;
}

function validateState(state, room) {
  requireValue(object(state) && state.version === VERSION && state.started === true, "Invalid Sorry state");
  for (const key of Object.keys(state)) requireValue(ROOT_FIELDS.has(key), `Unsupported Sorry state field: ${key}`);
  requireValue(["fireIce", "classic", "strategic"].includes(state.mode), "Invalid Sorry mode");
  requireValue(integer(state.skill, 1, 3) && typeof state.showEndpoints === "boolean", "Invalid Sorry settings");
  requireValue(Array.isArray(state.players) && integer(state.players.length, 2, 4), "Invalid Sorry players");
  const seats = new Set(), colors = new Set();
  state.players.forEach((player, index) => {
    requireValue(object(player) && player.id === index && integer(player.seat, 0, Number(room.maxPlayers || 4) - 1) && !seats.has(player.seat), "Invalid Sorry player seats");
    requireValue(integer(player.colorIndex, 0, 3) && !colors.has(player.colorIndex), "Invalid Sorry player colors");
    requireValue(typeof player.name === "string" && player.name.length >= 1 && player.name.length <= 24, "Invalid Sorry player name");
    requireValue(player.color === undefined || player.color === COLORS[player.colorIndex].key, "Invalid Sorry player color label");
    requireValue(player.cpu === undefined || player.cpu === false, "Nearby Sorry players cannot be CPU seats");
    requireValue(player.memberId === undefined || player.memberId === null || typeof player.memberId === "string", "Invalid Sorry player binding");
    seats.add(player.seat); colors.add(player.colorIndex);
  });
  requireValue(Array.isArray(state.pawns) && state.pawns.length === state.players.length * 3, "Invalid Sorry pawns");
  const occupiedTrack = new Set(), occupiedSafety = new Set();
  state.pawns.forEach((pawn, index) => {
    const player = Math.floor(index / 3), slot = index % 3;
    requireValue(object(pawn) && pawn.id === index && pawn.player === player && pawn.slot === slot && ["start", "track", "safety", "home"].includes(pawn.zone), "Invalid Sorry pawn identity");
    requireValue((pawn.zone === "start" || pawn.zone === "home") ? pawn.pos === 0 : pawn.zone === "track" ? integer(pawn.pos, 0, 59) : integer(pawn.pos, 0, 4), "Invalid Sorry pawn position");
    if (pawn.zone === "track") { requireValue(!occupiedTrack.has(pawn.pos), "Two Sorry pawns share a track space"); occupiedTrack.add(pawn.pos); }
    if (pawn.zone === "safety") { const key = `${player}:${pawn.pos}`; requireValue(!occupiedSafety.has(key), "Two Sorry pawns share a Safety space"); occupiedSafety.add(key); }
  });
  const validateCards = (cards, label) => {
    requireValue(Array.isArray(cards) && cards.every((card) => CARD_SET.has(card)), `Invalid Sorry ${label}`);
  };
  validateCards(state.deck, "deck"); validateCards(state.discard, "discard");
  requireValue(Array.isArray(state.hands) && state.hands.length === state.players.length, "Invalid Sorry hands");
  state.hands.forEach((hand) => validateCards(hand, "hand"));
  requireValue(state.currentCard === null || CARD_SET.has(state.currentCard), "Invalid current Sorry card");
  if (state.mode === "strategic") {
    requireValue(state.hands.every((hand) => hand.length === 5), "Strategic Sorry hands must contain five cards");
  } else {
    requireValue(state.hands.every((hand) => hand.length === 0), "Only Strategic Sorry may contain hands");
  }
  const conserved = [...state.deck, ...state.discard, ...state.hands.flat()];
  if (state.currentCard !== null && state.mode !== "strategic") conserved.push(state.currentCard);
  requireValue(same(cardCounts(conserved), CARD_COUNTS), "Sorry card deck is not conserved");
  requireValue(integer(state.turn, 0, state.players.length - 1) && NETWORK_PHASES.has(state.phase), "Invalid Sorry turn or network phase");
  requireValue(state.selectedCardIndex === null || integer(state.selectedCardIndex, 0, 4), "Invalid selected Sorry card");
  if (state.currentCard === null) requireValue(state.selectedCardIndex === null && ["preFire", "draw", "chooseCard"].includes(state.phase), "A cardless Sorry state has an invalid phase");
  else requireValue(["ice", "fireToken", "action", "firePull", "gameOver"].includes(state.phase), "A played Sorry card has an invalid phase");
  if (state.mode === "strategic" && state.currentCard !== null) requireValue(state.selectedCardIndex !== null && state.hands[state.turn][state.selectedCardIndex] === state.currentCard, "Strategic Sorry must play the selected hand card");
  if (state.mode !== "strategic") requireValue(state.selectedCardIndex === null, "Only Strategic Sorry selects a hand card");
  requireValue(object(state.flow), "Invalid Sorry flow");
  for (const key of Object.keys(state.flow)) requireValue(["previousIcePawnId", "previousFirePawnId", "animationText"].includes(key), `Unsupported Sorry flow field: ${key}`);
  if (Object.hasOwn(state.flow, "animationText")) requireValue(typeof state.flow.animationText === "string" && state.flow.animationText.length <= 100, "Invalid Sorry animation text");
  for (const key of ["previousIcePawnId", "previousFirePawnId"]) if (Object.hasOwn(state.flow, key)) requireValue(state.flow[key] === null || integer(state.flow[key], 0, state.pawns.length - 1), `Invalid ${key}`);
  const token = (value, label) => requireValue(value === null || integer(value, 0, state.pawns.length - 1), `Invalid Sorry ${label}`);
  token(state.firePawnId, "Fire token"); token(state.icePawnId, "Ice token");
  if (state.icePawnId !== null) requireValue(pawnById(state, state.icePawnId).zone === "track", "Ice must remain on a track pawn");
  requireValue(state.firePawnId === null || state.firePawnId !== state.icePawnId, "Fire and Ice cannot occupy the same pawn");
  if (state.mode === "classic") requireValue(state.firePawnId === null && state.icePawnId === null && state.phase !== "ice" && state.phase !== "fireToken", "Classic Sorry cannot use Fire or Ice");
  requireValue(typeof (state.pendingFirePull ?? false) === "boolean" && integer(state.moveNo, 0, 100000), "Invalid Sorry move counter");
  requireValue(state.winner === null || integer(state.winner, 0, state.players.length - 1), "Invalid Sorry winner");
  if (state.winner !== null) requireValue(state.phase === "gameOver" && state.pawns.filter((pawn) => pawn.player === state.winner && pawn.zone === "home").length === 3, "Sorry winner does not have every pawn Home");
  else requireValue(state.phase !== "gameOver", "Sorry game-over state requires a winner");
  if (state.phase === "draw") requireValue(state.mode !== "strategic", "Strategic Sorry must choose from its hand");
  if (state.phase === "chooseCard") requireValue(state.mode === "strategic", "Only Strategic Sorry chooses a hand card");
  if (state.phase === "ice") requireValue(state.mode !== "classic" && state.currentCard === "1" && state.icePawnId === null && Object.hasOwn(state.flow, "previousIcePawnId"), "Invalid Sorry Ice decision");
  if (state.phase === "fireToken") requireValue(state.mode !== "classic" && state.currentCard === "2" && state.firePawnId === null && Object.hasOwn(state.flow, "previousFirePawnId"), "Invalid Sorry Fire decision");
  if (state.phase === "firePull") requireValue(state.pendingFirePull === true && state.firePawnId !== null && pawnById(state, state.firePawnId).zone === "home", "Invalid Sorry Fire pull");
  if (state.phase !== "firePull" && state.phase !== "gameOver") requireValue((state.pendingFirePull ?? false) === false, "Sorry Fire pull is pending in the wrong phase");
  return state;
}

function semanticState(state) {
  return {
    version: state.version,
    started: state.started,
    mode: state.mode,
    skill: state.skill,
    showEndpoints: state.showEndpoints,
    players: state.players,
    pawns: state.pawns,
    turn: state.turn,
    deck: state.deck,
    discard: state.discard,
    hands: state.hands,
    firePawnId: state.firePawnId,
    icePawnId: state.icePawnId,
    currentCard: state.currentCard,
    phase: state.phase,
    selectedCardIndex: state.selectedCardIndex,
    flow: cleanFlow(state.flow),
    winner: state.winner,
    moveNo: state.moveNo,
    pendingFirePull: state.pendingFirePull ?? false,
    online: state.online === undefined ? true : state.online
  };
}

function alignAbandonedTurn(stateValue, room) {
  const state = clone(stateValue);
  const authoritativeSeat = Number(room.turn?.seat);
  const authoritativeTurn = playerIndexForSeat(state, authoritativeSeat);
  if (authoritativeTurn < 0 || state.players[state.turn]?.seat === authoritativeSeat) return state;
  const staleSeat = state.players[state.turn]?.seat;
  const departed = room.members.find((member) => member.seat === staleSeat);
  if (!departed?.leftAt) return state;
  // Generic-room leave/removal advances the room seat immediately. The Sorry
  // client performs this same deterministic cleanup when it hydrates that room:
  // an unfinished regular card is discarded, Strategic retains the still-held
  // card, and the surviving player begins a fresh decision.
  if (state.currentCard !== null && state.mode !== "strategic") state.discard.push(state.currentCard);
  state.currentCard = null;
  state.selectedCardIndex = null;
  state.turn = authoritativeTurn;
  state.flow = {};
  state.pendingFirePull = false;
  state.phase = state.mode === "strategic" ? "chooseCard" : "draw";
  return state;
}

function variant(state, currentSeat, options = {}) {
  return {
    state,
    nextSeat: options.nextSeat ?? currentSeat,
    finish: options.finish === true,
    result: options.result,
    flexibleDeck: options.flexibleDeck ? sortedCards(options.flexibleDeck) : null
  };
}

function copyVariant(source, state = clone(source.state), options = {}) {
  return variant(state, options.nextSeat ?? source.nextSeat, {
    finish: options.finish ?? source.finish,
    result: options.result ?? source.result,
    flexibleDeck: options.flexibleDeck ?? source.flexibleDeck
  });
}

function drawVariants(source) {
  const state = source.state;
  if (state.deck.length) {
    const copy = clone(state), card = copy.deck.pop();
    copy.currentCard = card;
    return [copyVariant(source, copy)];
  }
  if (!state.discard.length) return [];
  const copy = clone(state);
  copy.deck = authorityShuffle(copy.discard, copy);
  copy.discard = [];
  copy.currentCard = copy.deck.pop();
  return [copyVariant(source, copy)];
}

function iceTargets(state) {
  const previous = state.flow.previousIcePawnId;
  return state.pawns.filter((pawn) => pawn.id !== previous && pawn.id !== state.firePawnId && pawn.player !== state.turn && pawn.zone === "track");
}

function fireTargets(state) {
  const previous = state.flow.previousFirePawnId;
  return state.pawns.filter((pawn) => pawn.id !== previous && pawn.player === state.turn && pawn.zone !== "home" && !isIced(state, pawn.id));
}

function firePullTargets(state) {
  const fire = state.firePawnId === null ? null : pawnById(state, state.firePawnId);
  if (!fire || fire.zone !== "home") return [];
  return state.pawns.filter((pawn) => pawn.player === fire.player && pawn.id !== fire.id && pawn.zone !== "home" && !isIced(state, pawn.id));
}

function startTurn(state) {
  state.currentCard = null;
  state.selectedCardIndex = null;
  state.flow = {};
  state.pendingFirePull = false;
  const fire = state.firePawnId === null ? null : pawnById(state, state.firePawnId);
  const jump = fire && fire.player === state.turn ? fireJumpPlan(state, fire.id) : null;
  state.phase = jump ? "preFire" : state.mode === "strategic" ? "chooseCard" : "draw";
}

function finishCardVariants(source, room) {
  const state = source.state;
  const winner = state.players.find((player) => state.pawns.filter((pawn) => pawn.player === player.id && pawn.zone === "home").length === 3);
  if (winner) {
    const copy = clone(state);
    copy.winner = winner.id;
    copy.phase = "gameOver";
    return [copyVariant(source, copy, {
      nextSeat: copy.players[copy.turn].seat,
      finish: true,
      result: { winnerSeat: winner.seat, winnerName: winner.name, reason: "home" }
    })];
  }
  requireValue(state.currentCard !== null, "Sorry cannot finish a card that was not drawn");
  const prepared = clone(state), actor = prepared.turn;
  if (prepared.mode === "strategic") {
    const index = prepared.selectedCardIndex;
    prepared.hands[actor].splice(index, 1);
    prepared.discard.push(prepared.currentCard);
    prepared.currentCard = null;
    prepared.selectedCardIndex = null;
    const base = copyVariant(source, prepared);
    const replacementVariants = drawVariants(base);
    for (const candidate of replacementVariants) candidate.state.hands[actor].push(candidate.state.currentCard);
    for (const candidate of replacementVariants) candidate.state.currentCard = null;
    for (const candidate of replacementVariants) {
      candidate.state.turn = nextPlayerIndex(candidate.state, room, actor);
      startTurn(candidate.state);
      candidate.nextSeat = candidate.state.players[candidate.state.turn].seat;
    }
    return replacementVariants;
  }
  prepared.discard.push(prepared.currentCard);
  prepared.currentCard = null;
  prepared.selectedCardIndex = null;
  prepared.turn = nextPlayerIndex(prepared, room, actor);
  startTurn(prepared);
  return [copyVariant(source, prepared, { nextSeat: prepared.players[prepared.turn].seat })];
}

function resolvePlan(source, plan, room) {
  const state = clone(source.state);
  state.pendingFirePull = false;
  applyPlan(state, plan);
  state.moveNo++;
  state.flow = {};
  const resolved = copyVariant(source, state);
  if (state.pendingFirePull && firePullTargets(state).length) {
    state.phase = "firePull";
    return [resolved];
  }
  return finishCardVariants(resolved, room);
}

function beginActionVariants(source, room, allowCombinedResolution) {
  const state = source.state, plans = legalPlans(state, state.currentCard, state.turn);
  if (!plans.length) return finishCardVariants(source, room);
  if (allowCombinedResolution && plans.length === 1 && !["7", "11", "S"].includes(state.currentCard)) return resolvePlan(source, plans[0], room);
  const copy = clone(state);
  copy.phase = "action";
  return [copyVariant(source, copy)];
}

function prepareCardVariants(source, room) {
  const state = clone(source.state);
  state.flow = {};
  if (state.mode !== "classic" && state.currentCard === "1") {
    state.flow.previousIcePawnId = state.icePawnId;
    state.icePawnId = null;
    const prepared = copyVariant(source, state);
    if (iceTargets(state).length) { state.phase = "ice"; return [prepared]; }
    return beginActionVariants(prepared, room, true);
  }
  if (state.mode !== "classic" && state.currentCard === "2") {
    state.flow.previousFirePawnId = state.firePawnId;
    state.firePawnId = null;
    const prepared = copyVariant(source, state);
    if (fireTargets(state).length) { state.phase = "fireToken"; return [prepared]; }
    return beginActionVariants(prepared, room, true);
  }
  return beginActionVariants(copyVariant(source, state), room, true);
}

function enumerateTransitions(before, room, currentSeat) {
  const source = variant(clone(before), currentSeat);
  if (before.phase === "draw") return drawVariants(source).flatMap((candidate) => prepareCardVariants(candidate, room));
  if (before.phase === "chooseCard") {
    return before.hands[before.turn].flatMap((card, index) => {
      const state = clone(before);
      state.currentCard = card;
      state.selectedCardIndex = index;
      return prepareCardVariants(copyVariant(source, state), room);
    });
  }
  if (before.phase === "ice") {
    return iceTargets(before).flatMap((target) => {
      const state = clone(before);
      state.icePawnId = target.id;
      return beginActionVariants(copyVariant(source, state), room, true);
    });
  }
  if (before.phase === "fireToken") {
    return fireTargets(before).flatMap((target) => {
      const state = clone(before);
      state.firePawnId = target.id;
      return beginActionVariants(copyVariant(source, state), room, true);
    });
  }
  if (before.phase === "action") {
    const plans = legalPlans(before, before.currentCard, before.turn);
    const transitions = plans.flatMap((plan) => resolvePlan(source, plan, room));
    if (before.currentCard === "11" && !plans.some((plan) => plan.type === "move" && (plan.kind === "forward" || plan.kind === "start"))) transitions.push(...finishCardVariants(source, room));
    return transitions;
  }
  if (before.phase === "firePull") {
    const transitions = [];
    for (const target of [null, ...firePullTargets(before)]) {
      const state = clone(before);
      if (target) { state.pawns[target.id].zone = "home"; state.pawns[target.id].pos = 0; }
      state.pendingFirePull = false;
      transitions.push(...finishCardVariants(copyVariant(source, state), room));
    }
    return transitions;
  }
  if (before.phase === "preFire") {
    const fire = before.firePawnId === null ? null : pawnById(before, before.firePawnId), plan = fire ? fireJumpPlan(before, fire.id) : null;
    requireValue(plan && fire.player === before.turn, "Sorry Fire jump is no longer available");
    const skipped = clone(before);
    skipped.phase = skipped.mode === "strategic" ? "chooseCard" : "draw";
    const used = clone(skipped);
    applyFireJump(used, plan);
    return [copyVariant(source, skipped), copyVariant(source, used)];
  }
  return [];
}

function candidateMatches(candidate, after, action, currentSeat) {
  const expected = semanticState(candidate.state), actual = semanticState(after);
  if (candidate.flexibleDeck) {
    expected.deck = sortedCards(candidate.flexibleDeck);
    actual.deck = sortedCards(actual.deck);
  }
  if (!same(expected, actual)) return false;
  if (Number(action.nextSeat ?? currentSeat) !== Number(candidate.nextSeat)) return false;
  if ((action.finish === true) !== candidate.finish) return false;
  if (candidate.finish) return same(action.result, candidate.result);
  return !Object.hasOwn(action, "result");
}

export function validateSorryStart(room, action) {
  const state = validateState(action.state, room), members = activeMembers(room);
  requireValue(members.length >= 2 && members.length <= 4 && state.players.length === members.length, "Sorry player count must match the room");
  const firstSeat = Number(action.firstSeat ?? members[0].seat);
  requireValue(firstSeat === members[0].seat, "Sorry must start with the first occupied seat");
  requireValue(state.turn === playerIndexForSeat(state, firstSeat), "Sorry initial turn does not match its first seat");
  state.players.forEach((player, index) => {
    const member = members[index];
    requireValue(player.seat === member.seat && player.name === member.username, "Sorry player identity must match locked room membership");
    requireValue(player.memberId === member.playerId && player.cpu === false && player.color === COLORS[player.colorIndex].key, "Sorry player binding must match room membership");
  });
  const lobby = room.status === "lobby" && room.state?.lobby?.kind === "sorry-lobby" ? room.state.lobby : null;
  if (lobby) {
    requireValue(state.mode === lobby.mode && state.showEndpoints === (lobby.showEndpoints !== false), "Sorry start settings must match the room lobby");
    if (Array.isArray(lobby.colors)) requireValue(same(state.players.map((player) => player.colorIndex), lobby.colors.slice(0, state.players.length)), "Sorry colors must match the room lobby");
  }
  requireValue(state.pawns.every((pawn) => pawn.zone === "start" && pawn.pos === 0), "Sorry must start with every pawn in Start");
  requireValue(state.discard.length === 0 && state.currentCard === null && state.selectedCardIndex === null && state.moveNo === 0 && state.winner === null, "Sorry must start before any card is played");
  requireValue(state.firePawnId === null && state.icePawnId === null && (state.pendingFirePull ?? false) === false && same(cleanFlow(state.flow), {}), "Sorry tokens must start off the board");
  requireValue(state.phase === (state.mode === "strategic" ? "chooseCard" : "draw"), "Invalid initial Sorry phase");
  requireValue(action.finish !== true && !Object.hasOwn(action, "result"), "A new Sorry game cannot already be complete");
}

export function validateSorryTransition(room, member, action) {
  const storedBefore = validateState(room.state, room), before = validateState(alignAbandonedTurn(storedBefore, room), room), after = validateState(action.state, room);
  requireValue(before.winner === null && before.phase !== "gameOver", "A completed Sorry game cannot accept another action");
  const actor = playerIndexForSeat(before, member.seat);
  requireValue(actor >= 0 && before.turn === actor && room.turn?.seat === member.seat && room.turn?.playerId === member.playerId, "Sorry actor does not own this turn");
  requireValue(same(semanticState(before).players, semanticState(after).players), "Sorry player identity cannot change during a game");
  requireValue(before.mode === after.mode && before.skill === after.skill && before.showEndpoints === after.showEndpoints, "Sorry settings cannot change during a game");
  const candidates = enumerateTransitions(before, room, member.seat);
  requireValue(candidates.some((candidate) => candidateMatches(candidate, after, action, member.seat)), "Sorry snapshot is not the next legal card or token resolution");
}

export const __test = Object.freeze({
  validateState,
  semanticState,
  legalPlans,
  enumerateTransitions,
  planMove,
  fireJumpPlan,
  alignAbandonedTurn,
  authorityShuffle
});
