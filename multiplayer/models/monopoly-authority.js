/*
 * Environment-neutral Nearby Monopoly authority.
 *
 * The browser sends a small intent alongside its resulting snapshot.  The
 * intent selects a validator; it never authorizes the mutation by itself.
 * This module validates the locked player, the complete economic ledger, and
 * the exact deed/building delta before NearbyRoomService accepts the snapshot.
 */

const PROPERTY = Object.freeze({
  1: { type: "street", price: 60, mortgage: 30, build: 50, group: "brown" },
  3: { type: "street", price: 60, mortgage: 30, build: 50, group: "brown" },
  5: { type: "rail", price: 200, mortgage: 100, build: 0 },
  6: { type: "street", price: 100, mortgage: 50, build: 50, group: "lightblue" },
  8: { type: "street", price: 100, mortgage: 50, build: 50, group: "lightblue" },
  9: { type: "street", price: 120, mortgage: 60, build: 50, group: "lightblue" },
  11: { type: "street", price: 140, mortgage: 70, build: 100, group: "pink" },
  12: { type: "utility", price: 150, mortgage: 75, build: 0 },
  13: { type: "street", price: 140, mortgage: 70, build: 100, group: "pink" },
  14: { type: "street", price: 160, mortgage: 80, build: 100, group: "pink" },
  15: { type: "rail", price: 200, mortgage: 100, build: 0 },
  16: { type: "street", price: 180, mortgage: 90, build: 100, group: "orange" },
  18: { type: "street", price: 180, mortgage: 90, build: 100, group: "orange" },
  19: { type: "street", price: 200, mortgage: 100, build: 100, group: "orange" },
  21: { type: "street", price: 220, mortgage: 110, build: 150, group: "red" },
  23: { type: "street", price: 220, mortgage: 110, build: 150, group: "red" },
  24: { type: "street", price: 240, mortgage: 120, build: 150, group: "red" },
  25: { type: "rail", price: 200, mortgage: 100, build: 0 },
  26: { type: "street", price: 260, mortgage: 130, build: 150, group: "yellow" },
  27: { type: "street", price: 260, mortgage: 130, build: 150, group: "yellow" },
  28: { type: "utility", price: 150, mortgage: 75, build: 0 },
  29: { type: "street", price: 280, mortgage: 140, build: 150, group: "yellow" },
  31: { type: "street", price: 300, mortgage: 150, build: 200, group: "green" },
  32: { type: "street", price: 300, mortgage: 150, build: 200, group: "green" },
  34: { type: "street", price: 320, mortgage: 160, build: 200, group: "green" },
  35: { type: "rail", price: 200, mortgage: 100, build: 0 },
  37: { type: "street", price: 350, mortgage: 175, build: 200, group: "navy" },
  39: { type: "street", price: 400, mortgage: 200, build: 200, group: "navy" }
});

const PROPERTY_IDS = Object.freeze(Object.keys(PROPERTY).map(Number));
const PROPERTY_NAME = Object.freeze({1:"Mediterranean Avenue",3:"Baltic Avenue",5:"Reading Railroad",6:"Oriental Avenue",8:"Vermont Avenue",9:"Connecticut Avenue",11:"St. Charles Place",12:"Electric Company",13:"States Avenue",14:"Virginia Avenue",15:"Pennsylvania Railroad",16:"St. James Place",18:"Tennessee Avenue",19:"New York Avenue",21:"Kentucky Avenue",23:"Indiana Avenue",24:"Illinois Avenue",25:"B. & O. Railroad",26:"Atlantic Avenue",27:"Ventnor Avenue",28:"Water Works",29:"Marvin Gardens",31:"Pacific Avenue",32:"North Carolina Avenue",34:"Pennsylvania Avenue",35:"Short Line",37:"Park Place",39:"Boardwalk"});
const STREET_RENT = Object.freeze({
  1:[2,10,30,90,160,250],3:[4,20,60,180,320,450],6:[6,30,90,270,400,550],8:[6,30,90,270,400,550],9:[8,40,100,300,450,600],
  11:[10,50,150,450,625,750],13:[10,50,150,450,625,750],14:[12,60,180,500,700,900],16:[14,70,200,550,750,950],18:[14,70,200,550,750,950],19:[16,80,220,600,800,1000],
  21:[18,90,250,700,875,1050],23:[18,90,250,700,875,1050],24:[20,100,300,750,925,1100],26:[22,110,330,800,975,1150],27:[22,110,330,800,975,1150],29:[24,120,360,850,1025,1200],
  31:[26,130,390,900,1100,1275],32:[26,130,390,900,1100,1275],34:[28,150,450,1000,1200,1400],37:[35,175,500,1100,1300,1500],39:[50,200,600,1400,1700,2000]
});
const SPECIAL = Object.freeze({ 0:"go", 2:"community", 4:"tax", 7:"chance", 10:"jail", 17:"community", 20:"parking", 22:"chance", 30:"gojail", 33:"community", 36:"chance", 38:"tax" });
const CHANCE_IDS = Object.freeze(["c_go", "c_boardwalk", "c_illinois", "c_charles", "c_rail1", "c_rail2", "c_util", "c_dividend", "c_jailcard", "c_back", "c_jail", "c_repairs", "c_speed", "c_reading", "c_chair", "c_loan"]);
const COMMUNITY_IDS = Object.freeze(["m_go", "m_error", "m_doctor", "m_stock", "m_jailcard", "m_jail", "m_holiday", "m_refund", "m_birthday", "m_life", "m_hospital", "m_school", "m_fee", "m_repairs", "m_beauty", "m_inherit"]);
const CARD_EFFECT = Object.freeze({
  c_go:{type:"move",to:0},c_boardwalk:{type:"move",to:39},c_illinois:{type:"move",to:24},c_charles:{type:"move",to:11},c_rail1:{type:"nearest",target:"rail"},c_rail2:{type:"nearest",target:"rail"},c_util:{type:"nearest",target:"utility"},
  c_dividend:{type:"cash",amount:50},c_jailcard:{type:"jailcard"},c_back:{type:"back",steps:3},c_jail:{type:"jail"},c_repairs:{type:"repairs",house:25,hotel:100},c_speed:{type:"pay",amount:15},c_reading:{type:"move",to:5},c_chair:{type:"payEach",amount:50},c_loan:{type:"cash",amount:150},
  m_go:{type:"move",to:0},m_error:{type:"cash",amount:200},m_doctor:{type:"pay",amount:50},m_stock:{type:"cash",amount:50},m_jailcard:{type:"jailcard"},m_jail:{type:"jail"},m_holiday:{type:"cash",amount:100},m_refund:{type:"cash",amount:20},m_birthday:{type:"collectEach",amount:10},m_life:{type:"cash",amount:100},m_hospital:{type:"pay",amount:100},m_school:{type:"pay",amount:50},m_fee:{type:"cash",amount:25},m_repairs:{type:"repairs",house:40,hotel:115},m_beauty:{type:"cash",amount:10},m_inherit:{type:"cash",amount:100}
});
const CARD_CAUSE = Object.freeze({ c_speed:"Speeding fine: pay $15.", m_doctor:"Doctor's fee. Pay $50.", m_hospital:"Hospital fees. Pay $100.", m_school:"School fees. Pay $50." });
const GROUPS = Object.freeze(Object.fromEntries(
  [...new Set(Object.values(PROPERTY).map((space) => space.group).filter(Boolean))]
    .map((group) => [group, PROPERTY_IDS.filter((id) => PROPERTY[id].group === group)])
));
const PHASES = new Set(["roll", "offer", "end", "debt", "auction", "cardDraw", "moving", "gameOver"]);
const ROOT_FIELDS = new Set([
  "version", "mode", "settings", "players", "deeds", "turnIndex", "phase", "round", "turnCount", "doublesCount", "extraRoll", "lastRoll", "status", "bank", "decks",
  "pendingDebt", "pendingAuction", "pendingCard", "pendingMove", "pendingTrade", "pendingTransfers", "transfersResume", "pendingMortgageChoices", "mortgageChoiceResume",
  "bankAuctionQueue", "bankruptcyStack", "auctionResume", "offerSpace", "landingSpecial", "pendingJailMove", "log", "sound", "gameOver", "fullBoard", "endReason",
  "savedAt", "updatedAt", "endedAt"
]);
const STRUCTURAL_FIELDS = Object.freeze([
  "turnIndex", "phase", "round", "turnCount", "doublesCount", "extraRoll", "lastRoll", "bank", "decks", "pendingDebt", "pendingAuction", "pendingCard", "pendingMove", "pendingTrade",
  "pendingTransfers", "transfersResume", "pendingMortgageChoices", "mortgageChoiceResume", "bankAuctionQueue", "bankruptcyStack", "auctionResume", "offerSpace", "landingSpecial", "pendingJailMove", "gameOver", "endReason"
]);
const CANONICAL_TOKENS = Object.freeze(["💩", "🚽", "🤡", "👻", "👽", "🤖"]);
const CANONICAL_COLORS = Object.freeze(["#30d8ff", "#ff5e86", "#ffd447", "#7be66f", "#b889ff", "#ff914d"]);
const INTENTS = new Set([
  "roll", "complete-move", "buy", "start-auction", "auction-bid", "auction-pass",
  "pay-debt", "declare-bankruptcy", "pay-jail", "use-jail-card", "resolve-card",
  "build", "sell", "sell-group", "mortgage", "unmortgage", "trade-propose",
  "trade-accept", "trade-decline", "mortgage-choice", "end-turn"
]);
const INTENT_FIELDS = new Set(["version", "kind", "spaceId", "returnMode", "value", "d1", "d2", "deck", "cardId", "amount", "playerId", "debtorId", "fromId", "toId", "unmortgageNow"]);
const DEBT_RESUMES = new Set(["finish", "transfers", "jailPaid", "jailForcedMove", "jailForcedMoveInstant", "bankAuctions", "afterBankruptcy", "mortgageChoices"]);
const TRANSFER_FIELDS = new Set(["debtorId", "creditorId", "amount", "cause", "potEligible"]);
const LANDING_EPHEMERAL_FIELDS = Object.freeze(["pendingDebt", "pendingAuction", "pendingCard", "pendingMove", "offerSpace", "landingSpecial"]);
const LANDING_PERSISTENT_FIELDS = Object.freeze([
  "pendingTrade", "pendingTransfers", "transfersResume", "pendingMortgageChoices", "mortgageChoiceResume",
  "bankAuctionQueue", "bankruptcyStack", "auctionResume", "pendingJailMove", "gameOver", "endReason"
]);
const CANONICAL_CORE_FIELDS = Object.freeze([
  "mode", "settings", "players", "deeds", "turnIndex", "phase", "round", "turnCount", "doublesCount", "extraRoll", "lastRoll", "bank", "decks",
  "pendingDebt", "pendingAuction", "pendingCard", "pendingMove", "pendingTrade", "pendingTransfers", "transfersResume", "pendingMortgageChoices", "mortgageChoiceResume",
  "bankAuctionQueue", "bankruptcyStack", "auctionResume", "offerSpace", "landingSpecial", "pendingJailMove", "gameOver", "endReason"
]);

export const MONOPOLY_AUTHORITY = Object.freeze({
  id: "monopoly-intent-ledger-v2",
  ruleValidated: true,
  completionVerified: true,
  scope: "locked actor, explicit intent, exact cash/deed/building deltas, card conservation, bankruptcy and terminal-result validation"
});

function error(message, status = 422) {
  const value = new Error(message);
  value.status = status;
  return value;
}

function requireValue(condition, message, status = 422) {
  if (!condition) throw error(message, status);
}

function object(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function integer(value, min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER) {
  return Number.isInteger(value) && value >= min && value <= max;
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

function player(state, id) {
  return state.players.find((candidate) => candidate.id === id) || null;
}

function currentPlayer(state) {
  return state.players[state.turnIndex] || null;
}

function threshold(state) {
  return state.settings.quickHotels ? 3 : 4;
}

function equivalent(state, houses) {
  return houses === 5 ? threshold(state) + 1 : houses;
}

function groupHasBuildings(state, group) {
  return GROUPS[group].some((id) => state.deeds[id].houses > 0);
}

function ownsGroup(state, owner, group) {
  return GROUPS[group].every((id) => state.deeds[id].owner === owner);
}

function rentFor(state, id, ownerId, special = null) {
  const space = PROPERTY[id], deed = state.deeds[id];
  if (space.type === "street") {
    if (deed.houses) return STREET_RENT[id][deed.houses === 5 ? 5 : deed.houses];
    return STREET_RENT[id][0] * (ownsGroup(state, ownerId, space.group) ? 2 : 1);
  }
  if (space.type === "rail") {
    const count = PROPERTY_IDS.filter((propertyId) => PROPERTY[propertyId].type === "rail" && state.deeds[propertyId].owner === ownerId).length;
    return 25 * (2 ** (count - 1)) * (special?.double ? 2 : 1);
  }
  const count = PROPERTY_IDS.filter((propertyId) => PROPERTY[propertyId].type === "utility" && state.deeds[propertyId].owner === ownerId).length;
  const total = special?.rollTotal || state.lastRoll.reduce((sum, die) => sum + die, 0) || 7;
  return total * (special?.ten ? 10 : count === 2 ? 10 : 4);
}

function monopolyActorSeat(state) {
  if (Number.isInteger(state.pendingTrade?.toId)) return state.pendingTrade.toId;
  if (state.phase === "debt" && state.pendingDebt?.resume === "mortgageChoices" && Number.isInteger(state.pendingDebt.debtorId)) return state.pendingDebt.debtorId;
  const queued = state.pendingMortgageChoices?.[0]?.playerId;
  if (Number.isInteger(queued)) return queued;
  if (state.phase === "auction" && Number.isInteger(state.pendingAuction?.currentBidderId)) return state.pendingAuction.currentBidderId;
  if (state.phase === "debt" && Number.isInteger(state.pendingDebt?.debtorId)) return state.pendingDebt.debtorId;
  return currentPlayer(state)?.id ?? null;
}

function assertSettings(settings) {
  requireValue(object(settings), "Invalid Monopoly settings");
  requireValue(Object.keys(settings).every((key) => ["startingCash", "goSalary", "startingDeeds", "firstBankruptcy", "turnLimit", "freeParking", "handoff", "quickHotels", "quickJail"].includes(key)), "Unsupported Monopoly setting");
  requireValue(integer(settings.startingCash, 500, 3000), "Invalid Monopoly starting cash");
  requireValue(integer(settings.goSalary, 100, 500), "Invalid Monopoly GO salary");
  requireValue(integer(settings.startingDeeds, 0, 4), "Invalid Monopoly starting-deed count");
  requireValue(integer(settings.turnLimit, 0, 150), "Invalid Monopoly turn limit");
  for (const key of ["firstBankruptcy", "freeParking", "handoff", "quickHotels", "quickJail"]) {
    requireValue(typeof settings[key] === "boolean", `Invalid Monopoly ${key} setting`);
  }
}

function assertState(state, room) {
  requireValue(object(state) && state.version === 1, "Invalid Monopoly state");
  requireValue(Object.keys(state).every((key) => ROOT_FIELDS.has(key)), "Monopoly state contains an unsupported field");
  requireValue(["standard", "quick", "custom"].includes(state.mode), "Invalid Monopoly mode");
  assertSettings(state.settings);
  requireValue(Array.isArray(state.players) && integer(state.players.length, 2, 6), "Invalid Monopoly players");
  const members = activeMembers(room);
  const ids = new Set();
  for (const value of state.players) {
    requireValue(object(value) && integer(value.id, 0, room.maxPlayers - 1) && !ids.has(value.id), "Invalid Monopoly player id");
    requireValue(Object.keys(value).every((key) => ["id", "name", "token", "color", "cash", "pos", "inJail", "jailTurns", "getOut", "bankrupt"].includes(key)), "Unsupported Monopoly player field");
    ids.add(value.id);
    requireValue(typeof value.name === "string" && value.name.length >= 1 && value.name.length <= 24, "Invalid Monopoly player name");
    requireValue(typeof value.token === "string" && typeof value.color === "string", "Invalid Monopoly player presentation");
    requireValue(integer(value.cash, 0, 10_000_000) && integer(value.pos, 0, 39), "Invalid Monopoly player ledger");
    requireValue(typeof value.inJail === "boolean" && integer(value.jailTurns, 0, 3), "Invalid Monopoly jail state");
    requireValue(object(value.getOut) && integer(value.getOut.chance, 0, 1) && integer(value.getOut.community, 0, 1), "Invalid Monopoly jail-card ledger");
    requireValue(Object.keys(value.getOut).every((key) => key === "chance" || key === "community"), "Unsupported Monopoly jail-card field");
    requireValue(typeof value.bankrupt === "boolean" && (!value.bankrupt || value.cash === 0), "Invalid Monopoly bankruptcy ledger");
  }
  requireValue(same(state.players.map((value) => value.id), members.map((value) => value.seat)), "Monopoly players must match locked room seats");
  for (const member of members) {
    const locked = player(state, member.seat);
    requireValue(locked?.name === member.username, "Monopoly names must come from locked membership");
    requireValue(locked.token === CANONICAL_TOKENS[member.seat] && locked.color.toLowerCase() === CANONICAL_COLORS[member.seat], "Monopoly token and color must match the locked seat");
  }
  requireValue(object(state.deeds), "Invalid Monopoly deeds");
  requireValue(same(Object.keys(state.deeds).map(Number).sort((a, b) => a - b), [...PROPERTY_IDS].sort((a, b) => a - b)), "Invalid Monopoly deed table");
  let houses = 0;
  let hotels = 0;
  for (const id of PROPERTY_IDS) {
    const deed = state.deeds[id];
    requireValue(object(deed) && (deed.owner === null || ids.has(deed.owner)), "Invalid Monopoly deed owner");
    requireValue(Object.keys(deed).every((key) => ["owner", "mortgaged", "houses"].includes(key)), "Unsupported Monopoly deed field");
    requireValue(typeof deed.mortgaged === "boolean" && integer(deed.houses, 0, 5), "Invalid Monopoly deed state");
    requireValue(PROPERTY[id].type === "street" || deed.houses === 0, "Only streets may have buildings");
    requireValue(!(deed.mortgaged && deed.houses), "Mortgaged Monopoly deeds cannot have buildings");
    requireValue(deed.owner === null || !player(state, deed.owner).bankrupt, "Bankrupt players cannot retain Monopoly deeds");
    if (deed.houses === 5) hotels++;
    else houses += deed.houses;
  }
  requireValue(object(state.bank) && integer(state.bank.houses, 0, 32) && integer(state.bank.hotels, 0, 12) && integer(state.bank.pot, 0, 10_000_000), "Invalid Monopoly bank");
  requireValue(Object.keys(state.bank).every((key) => ["houses", "hotels", "pot"].includes(key)), "Unsupported Monopoly bank field");
  requireValue(state.bank.houses + houses === 32 && state.bank.hotels + hotels === 12, "Monopoly building inventory is not conserved");
  requireValue(integer(state.turnIndex, 0, state.players.length - 1) && integer(state.round, 1, 1_000_000) && integer(state.turnCount, 0, 1_000_000), "Invalid Monopoly turn ledger");
  requireValue(typeof state.status === "string" && state.status.length <= 240 && (state.endReason === undefined || typeof state.endReason === "string" && state.endReason.length <= 120), "Invalid Monopoly presentation text");
  requireValue(Array.isArray(state.log) && state.log.length <= 120 && state.log.every((entry) => typeof entry === "string" && entry.length <= 240), "Invalid Monopoly log");
  requireValue(typeof state.sound === "boolean" && typeof state.fullBoard === "boolean", "Invalid Monopoly local preferences");
  requireValue(integer(state.doublesCount, 0, 2) && typeof state.extraRoll === "boolean", "Invalid Monopoly dice state");
  requireValue(Array.isArray(state.lastRoll) && state.lastRoll.length <= 2 && state.lastRoll.every((die) => integer(die, 1, 6)), "Invalid Monopoly dice");
  requireValue(object(state.decks) && Array.isArray(state.decks.chance) && Array.isArray(state.decks.community), "Invalid Monopoly card decks");
  for (const [deck, ids, jailId] of [["chance", CHANCE_IDS, "c_jailcard"], ["community", COMMUNITY_IDS, "m_jailcard"]]) {
    const pending = state.pendingCard?.deck === deck ? [state.pendingCard.id] : [];
    const held = state.players.flatMap((value) => Array(value.getOut[deck] || 0).fill(jailId));
    const cards = [...state.decks[deck], ...pending, ...held];
    requireValue(cards.length === ids.length && ids.every((id) => cards.filter((card) => card === id).length === 1), `Monopoly ${deck} cards are not conserved`);
  }
  requireValue(PHASES.has(state.phase), "Invalid Monopoly phase");
  requireValue(typeof state.gameOver === "boolean" && (state.gameOver === (state.phase === "gameOver")), "Invalid Monopoly game-over state");
  if (state.phase === "offer") requireValue(PROPERTY[state.offerSpace] && state.deeds[state.offerSpace].owner === null && currentPlayer(state).pos === state.offerSpace, "Invalid Monopoly purchase offer");
  else requireValue(state.offerSpace === null || state.offerSpace === undefined, "Monopoly offer exists outside the offer phase");
  if (state.phase === "debt") requireValue((object(state.pendingDebt) && player(state, state.pendingDebt.debtorId) && integer(state.pendingDebt.amount, 1, 10_000_000)) || (Array.isArray(state.pendingMortgageChoices) && state.pendingMortgageChoices.length > 0), "Invalid Monopoly debt");
  if (state.pendingDebt !== null && state.pendingDebt !== undefined) {
    const debt = state.pendingDebt;
    requireValue(object(debt) && Object.keys(debt).length === 6 && ["debtorId", "creditorId", "amount", "cause", "resume", "potEligible"].every((key) => Object.hasOwn(debt, key)), "Invalid Monopoly pending-debt shape");
    requireValue(player(state, debt.debtorId) && (debt.creditorId === null || player(state, debt.creditorId)) && integer(debt.amount, 1, 10_000_000) && typeof debt.cause === "string" && debt.cause.length <= 120 && DEBT_RESUMES.has(debt.resume) && typeof debt.potEligible === "boolean", "Invalid Monopoly pending debt");
  }
  if (state.phase === "auction") {
    const auction = state.pendingAuction;
    requireValue(object(auction) && PROPERTY[auction.spaceId] && state.deeds[auction.spaceId].owner === null && ["landing", "bankruptcy"].includes(auction.returnMode), "Invalid Monopoly auction");
    requireValue(Object.keys(auction).every((key) => ["spaceId", "returnMode", "bid", "highestId", "currentBidderId", "passed", "participants"].includes(key)), "Unsupported Monopoly auction field");
    requireValue(integer(auction.bid, 0, 10_000_000) && (auction.highestId === null || ids.has(auction.highestId)) && ids.has(auction.currentBidderId), "Invalid Monopoly auction bidding");
    requireValue(Array.isArray(auction.participants) && auction.participants.length >= 1 && new Set(auction.participants).size === auction.participants.length && auction.participants.every((id) => ids.has(id)), "Invalid Monopoly auction participants");
    requireValue(Array.isArray(auction.passed) && new Set(auction.passed).size === auction.passed.length && auction.passed.every((id) => auction.participants.includes(id)), "Invalid Monopoly auction passes");
  }
  else requireValue(state.pendingAuction === null || state.pendingAuction === undefined, "Monopoly auction exists outside the auction phase");
  if (state.phase === "cardDraw") requireValue(object(state.pendingCard) && Object.keys(state.pendingCard).length === 2 && ["chance", "community"].includes(state.pendingCard.deck) && typeof state.pendingCard.id === "string", "Invalid Monopoly card draw");
  else requireValue(state.pendingCard === null || state.pendingCard === undefined, "Monopoly card exists outside the card phase");
  if (state.phase === "moving") requireValue(object(state.pendingMove) && Object.keys(state.pendingMove).every((key) => ["playerId", "path", "cursor", "total", "collectGo", "direction", "resolution", "meta"].includes(key)) && player(state, state.pendingMove.playerId) && Array.isArray(state.pendingMove.path) && state.pendingMove.path.length >= 1 && state.pendingMove.path.length <= 40 && state.pendingMove.path.every((position) => integer(position, 0, 39)) && integer(state.pendingMove.cursor, 0, state.pendingMove.path.length) && state.pendingMove.total === state.pendingMove.path.length && typeof state.pendingMove.collectGo === "boolean" && [-1, 1].includes(state.pendingMove.direction) && ["roll", "jailRoll", "jailForced", "card", "jail"].includes(state.pendingMove.resolution) && object(state.pendingMove.meta), "Invalid Monopoly movement");
  else requireValue(state.pendingMove === null || state.pendingMove === undefined, "Monopoly movement exists outside the moving phase");
  const transfers = state.pendingTransfers ?? [];
  requireValue(Array.isArray(transfers) && transfers.length <= 5 && transfers.every((item) => object(item) && Object.keys(item).length === TRANSFER_FIELDS.size && Object.keys(item).every((key) => TRANSFER_FIELDS.has(key)) && player(state, item.debtorId) && (item.creditorId === null || player(state, item.creditorId)) && item.debtorId !== item.creditorId && integer(item.amount, 1, 10_000_000) && typeof item.cause === "string" && item.cause.length <= 120 && typeof item.potEligible === "boolean"), "Invalid Monopoly transfer queue");
  requireValue(state.transfersResume === undefined || state.transfersResume === null || state.transfersResume === "finish", "Invalid Monopoly transfer continuation");
  if (state.pendingTrade !== null && state.pendingTrade !== undefined) {
    const trade = state.pendingTrade;
    const fields = ["fromId", "toId", "offerCash", "askCash", "offerChance", "offerCommunity", "askChance", "askCommunity", "offerProps", "askProps"];
    requireValue(object(trade) && Object.keys(trade).length === fields.length && fields.every((key) => Object.hasOwn(trade, key)) && player(state, trade.fromId) && player(state, trade.toId) && trade.fromId !== trade.toId, "Invalid Monopoly pending trade");
    for (const key of ["offerCash", "askCash", "offerChance", "offerCommunity", "askChance", "askCommunity"]) requireValue(integer(trade[key], 0, 10_000_000), "Invalid Monopoly pending trade amount");
    for (const list of [trade.offerProps, trade.askProps]) requireValue(Array.isArray(list) && list.length <= PROPERTY_IDS.length && new Set(list).size === list.length && list.every((id) => PROPERTY[id]), "Invalid Monopoly pending trade deeds");
  }
  const mortgageChoices = state.pendingMortgageChoices ?? [];
  requireValue(Array.isArray(mortgageChoices) && mortgageChoices.length <= PROPERTY_IDS.length && new Set(mortgageChoices.map((choice) => `${choice?.playerId}:${choice?.spaceId}`)).size === mortgageChoices.length && mortgageChoices.every((choice) => object(choice) && Object.keys(choice).length === 2 && player(state, choice.playerId) && PROPERTY[choice.spaceId]), "Invalid Monopoly mortgage-choice queue");
  requireValue(state.mortgageChoiceResume === undefined || state.mortgageChoiceResume === null || ["trade", "afterBankruptcy"].includes(state.mortgageChoiceResume), "Invalid Monopoly mortgage-choice continuation");
  const auctions = state.bankAuctionQueue ?? [];
  requireValue(Array.isArray(auctions) && auctions.length <= PROPERTY_IDS.length && new Set(auctions).size === auctions.length && auctions.every((id) => PROPERTY[id]), "Invalid Monopoly bank-auction queue");
  const bankruptcyStack = state.bankruptcyStack ?? [];
  requireValue(Array.isArray(bankruptcyStack) && bankruptcyStack.length <= state.players.length && bankruptcyStack.every((context) => object(context) && Object.keys(context).length === 3 && player(state, context.playerId) && typeof context.wasCurrent === "boolean" && DEBT_RESUMES.has(context.resume)), "Invalid Monopoly bankruptcy continuation stack");
  requireValue(state.auctionResume === undefined || state.auctionResume === null, "Unsupported Monopoly auction continuation");
  requireValue(state.pendingJailMove === undefined || state.pendingJailMove === null || integer(state.pendingJailMove, 2, 12), "Invalid Monopoly Jail movement");
  requireValue(state.landingSpecial === undefined || state.landingSpecial === null || (object(state.landingSpecial) && Object.keys(state.landingSpecial).every((key) => ["double", "ten", "rollTotal"].includes(key)) && (state.landingSpecial.double === undefined || typeof state.landingSpecial.double === "boolean") && (state.landingSpecial.ten === undefined || typeof state.landingSpecial.ten === "boolean") && (state.landingSpecial.rollTotal === undefined || integer(state.landingSpecial.rollTotal, 2, 12))), "Invalid Monopoly landing modifier");
  return state;
}

function immutableGame(before, after) {
  requireValue(before.mode === after.mode && same(before.settings, after.settings), "Monopoly rules cannot change during a game");
  requireValue(before.players.length === after.players.length, "Monopoly seats cannot change in a game action");
  for (const prior of before.players) {
    const next = player(after, prior.id);
    requireValue(next && next.name === prior.name && next.token === prior.token && next.color === prior.color, "Monopoly player identity is immutable");
  }
}

function ledgerDiff(before, after) {
  const cash = [];
  const position = [];
  const jail = [];
  const cards = [];
  const bankrupt = [];
  for (const prior of before.players) {
    const next = player(after, prior.id);
    if (next.cash !== prior.cash) cash.push({ id: prior.id, from: prior.cash, to: next.cash, delta: next.cash - prior.cash });
    if (next.pos !== prior.pos) position.push({ id: prior.id, from: prior.pos, to: next.pos });
    if (next.inJail !== prior.inJail || next.jailTurns !== prior.jailTurns) jail.push({ id: prior.id });
    if (!same(next.getOut, prior.getOut)) cards.push({ id: prior.id });
    if (next.bankrupt !== prior.bankrupt) bankrupt.push({ id: prior.id, from: prior.bankrupt, to: next.bankrupt });
  }
  const owner = [];
  const mortgage = [];
  const buildings = [];
  for (const id of PROPERTY_IDS) {
    const prior = before.deeds[id], next = after.deeds[id];
    if (prior.owner !== next.owner) owner.push({ id, from: prior.owner, to: next.owner });
    if (prior.mortgaged !== next.mortgaged) mortgage.push({ id, from: prior.mortgaged, to: next.mortgaged });
    if (prior.houses !== next.houses) buildings.push({ id, from: prior.houses, to: next.houses });
  }
  return { cash, position, jail, cards, bankrupt, owner, mortgage, buildings };
}

function onlyIds(changes, ids) {
  return changes.every((change) => ids.includes(change.id));
}

function assertNoUnrelatedLedger(diff, allowed = {}) {
  for (const key of ["cash", "position", "jail", "cards", "bankrupt", "owner", "mortgage", "buildings"]) {
    const ids = allowed[key] || [];
    requireValue(onlyIds(diff[key], ids), `Monopoly ${key} changed outside the declared action`);
  }
}

function assertStableStructure(before, after, allowed = []) {
  for (const field of STRUCTURAL_FIELDS) {
    if (!allowed.includes(field)) requireValue(same(before[field] ?? null, after[field] ?? null), `Monopoly ${field} changed outside the declared action`);
  }
}

function assertPendingDebt(actual, expected) {
  requireValue(object(actual) && Object.keys(actual).length === 6 && ["debtorId", "creditorId", "amount", "cause", "resume", "potEligible"].every((key) => Object.hasOwn(actual, key)), "Invalid Monopoly pending-debt shape");
  requireValue(same(actual, expected), "Monopoly pending debt does not match its legal cause");
}

function assertLandingControls(before, after, expected = {}) {
  for (const field of LANDING_EPHEMERAL_FIELDS) {
    const value = Object.hasOwn(expected, field) ? expected[field] : null;
    requireValue(same(after[field] ?? null, value ?? null), `Invalid Monopoly landing ${field}`);
  }
  for (const field of LANDING_PERSISTENT_FIELDS) {
    requireValue(same(after[field] ?? null, before[field] ?? null), `Monopoly ${field} changed during a landing`);
  }
}

function assertCanonicalCore(expected, actual, message = "Invalid Monopoly canonical continuation") {
  for (const field of CANONICAL_CORE_FIELDS) requireValue(same(expected[field] ?? null, actual[field] ?? null), `${message}: ${field}`);
}

function canonicalFinishLanding(state) {
  state.phase = "end";
  state.offerSpace = null;
  state.pendingCard = null;
  state.landingSpecial = null;
}

function canonicalFinishGame(state, reason) {
  state.gameOver = true;
  state.phase = "gameOver";
  state.endReason = reason;
}

function canonicalEndTurn(state) {
  state.turnCount++;
  if (state.settings.turnLimit && state.turnCount >= state.settings.turnLimit) {
    canonicalFinishGame(state, `Turn limit reached (${state.settings.turnLimit})`);
    return;
  }
  const old = state.turnIndex;
  let next = old;
  do next = (next + 1) % state.players.length;
  while (state.players[next].bankrupt && next !== old);
  if (next <= old) state.round++;
  state.turnIndex = next;
  state.doublesCount = 0;
  state.extraRoll = false;
  state.lastRoll = [];
  state.phase = "roll";
  state.offerSpace = null;
  state.landingSpecial = null;
}

function canonicalBeginAuction(state, spaceId, returnMode = "landing") {
  state.pendingAuction = expectedAuction(state, spaceId, returnMode);
  state.phase = "auction";
  state.offerSpace = null;
}

function canonicalFinishAuction(state) {
  const auction = state.pendingAuction;
  requireValue(object(auction) && PROPERTY[auction.spaceId], "Invalid Monopoly auction settlement");
  const winner = auction.highestId === null ? null : player(state, auction.highestId);
  if (winner) {
    winner.cash -= auction.bid;
    state.deeds[auction.spaceId].owner = winner.id;
  }
  state.pendingAuction = null;
  if (auction.returnMode === "bankruptcy") canonicalStartNextBankAuction(state);
  else canonicalFinishLanding(state);
}

function canonicalAdvanceAuction(state) {
  const auction = state.pendingAuction;
  requireValue(object(auction), "Invalid Monopoly auction continuation");
  const eligible = auction.participants.filter((id) => !auction.passed.includes(id) && !player(state, id)?.bankrupt);
  if (auction.highestId !== null) {
    const challengers = eligible.filter((id) => id !== auction.highestId);
    if (!challengers.length) return canonicalFinishAuction(state);
    auction.currentBidderId = nextAuctionBidder(auction.currentBidderId, challengers, auction.participants);
  } else {
    if (!eligible.length) return canonicalFinishAuction(state);
    auction.currentBidderId = nextAuctionBidder(auction.currentBidderId, eligible, auction.participants);
  }
}

function canonicalStartNextBankAuction(state) {
  if (state.bankAuctionQueue?.length) canonicalBeginAuction(state, state.bankAuctionQueue.shift(), "bankruptcy");
  else canonicalAfterBankruptcy(state);
}

function canonicalProcessMortgageChoices(state) {
  state.pendingMortgageChoices = state.pendingMortgageChoices || [];
  while (state.pendingMortgageChoices.length) {
    const choice = state.pendingMortgageChoices[0], owner = player(state, choice.playerId), deed = state.deeds[choice.spaceId];
    if (owner && !owner.bankrupt && deed?.owner === owner.id && deed.mortgaged) return;
    state.pendingMortgageChoices.shift();
  }
  const resume = state.mortgageChoiceResume;
  state.mortgageChoiceResume = null;
  if (resume === "afterBankruptcy") canonicalAfterBankruptcy(state);
}

function canonicalExecutePayment(state, debt) {
  const from = player(state, debt.debtorId), to = debt.creditorId === null ? null : player(state, debt.creditorId);
  if (!from || from.bankrupt) return;
  from.cash -= debt.amount;
  if (to && !to.bankrupt) to.cash += debt.amount;
  else if (debt.potEligible && state.settings.freeParking) state.bank.pot += debt.amount;
}

function canonicalProcessTransfers(state) {
  while (state.pendingTransfers?.length) {
    const debt = state.pendingTransfers.shift(), from = player(state, debt.debtorId), to = debt.creditorId === null ? null : player(state, debt.creditorId);
    if (!from || from.bankrupt || (debt.creditorId !== null && (!to || to.bankrupt))) continue;
    if (from.cash >= debt.amount) canonicalExecutePayment(state, debt);
    else {
      state.pendingDebt = { ...debt, resume: "transfers" };
      state.phase = "debt";
      return;
    }
  }
  const resume = state.transfersResume || "finish";
  state.transfersResume = null;
  canonicalResumeAfter(state, resume);
}

function canonicalAfterBankruptcy(state) {
  const context = (state.bankruptcyStack || []).pop();
  if (!context) return;
  const alive = state.players.filter((value) => !value.bankrupt);
  if (alive.length <= 1) return canonicalFinishGame(state, "Last player standing");
  if (state.settings.firstBankruptcy) return canonicalFinishGame(state, "Quick game: first bankruptcy");
  if (context.resume === "afterBankruptcy") return canonicalAfterBankruptcy(state);
  if (context.resume === "mortgageChoices") return canonicalProcessMortgageChoices(state);
  if (context.wasCurrent || currentPlayer(state)?.bankrupt) return canonicalEndTurn(state);
  if (context.resume === "transfers") return canonicalProcessTransfers(state);
  canonicalFinishLanding(state);
}

function canonicalStartMovement(state, value, path, resolution, meta = {}, collectGo = true, direction = 1) {
  state.pendingMove = { playerId: value.id, path: [...path], cursor: 0, total: path.length, collectGo: Boolean(collectGo), direction: direction < 0 ? -1 : 1, resolution, meta: clone(meta) };
  state.phase = "moving";
}

function canonicalCharge(state, debtorId, amount, creditorId, cause, resume = "finish", potEligible = false) {
  const debt = { debtorId, creditorId: creditorId === undefined ? null : creditorId, amount, cause, resume, potEligible };
  const debtor = player(state, debtorId);
  if (debtor.cash >= amount) {
    canonicalExecutePayment(state, debt);
    canonicalResumeAfter(state, resume);
  } else {
    state.pendingDebt = debt;
    state.phase = "debt";
  }
}

function canonicalResolveLanding(state, special = null) {
  const value = currentPlayer(state), destination = value.pos, property = PROPERTY[destination], landingType = SPECIAL[destination];
  state.landingSpecial = special;
  state.offerSpace = null;
  if (property) {
    const deed = state.deeds[destination];
    if (deed.owner === null) {
      state.offerSpace = destination;
      state.phase = "offer";
    } else if (deed.owner === value.id || deed.mortgaged) canonicalFinishLanding(state);
    else canonicalCharge(state, value.id, rentFor(state, destination, deed.owner, special), deed.owner, `${PROPERTY_NAME[destination]} rent`, "finish", false);
    return;
  }
  if (landingType === "chance" || landingType === "community") {
    const id = state.decks[landingType].shift();
    state.pendingCard = { deck: landingType, id };
    state.phase = "cardDraw";
  } else if (landingType === "tax") canonicalCharge(state, value.id, destination === 4 ? 200 : 100, null, destination === 4 ? "Income Tax" : "Luxury Tax", "finish", true);
  else if (landingType === "gojail") {
    value.pos = 10;
    value.inJail = true;
    value.jailTurns = 0;
    state.doublesCount = 0;
    state.extraRoll = false;
    state.phase = "end";
  } else if (landingType === "parking" && state.settings.freeParking && state.bank.pot > 0) {
    value.cash += state.bank.pot;
    state.bank.pot = 0;
    canonicalFinishLanding(state);
  } else canonicalFinishLanding(state);
}

function canonicalResumeAfter(state, resume) {
  if (resume === "finish") canonicalFinishLanding(state);
  else if (resume === "transfers") canonicalProcessTransfers(state);
  else if (resume === "jailPaid") {
    const value = currentPlayer(state);
    value.inJail = false;
    value.jailTurns = 0;
    state.phase = "roll";
  } else if (resume === "jailForcedMove" || resume === "jailForcedMoveInstant") {
    const value = currentPlayer(state), total = state.pendingJailMove || 0;
    value.inJail = false;
    value.jailTurns = 0;
    state.pendingJailMove = null;
    if (resume === "jailForcedMoveInstant") {
      const old = value.pos, next = old + total;
      if (next >= 40) value.cash += state.settings.goSalary;
      value.pos = next % 40;
      canonicalResolveLanding(state);
    } else canonicalStartMovement(state, value, pathBy(value.pos, total), "jailForced", {}, true, 1);
  } else if (resume === "bankAuctions") canonicalStartNextBankAuction(state);
  else if (resume === "afterBankruptcy") canonicalAfterBankruptcy(state);
  else if (resume === "mortgageChoices") canonicalProcessMortgageChoices(state);
  else throw error("Unsupported Monopoly canonical continuation");
}

function requireProperty(intent) {
  const id = Number(intent.spaceId);
  requireValue(Number.isInteger(id) && PROPERTY[id], "Monopoly action needs a valid property");
  return { id, space: PROPERTY[id] };
}

function requireActorProperty(before, member, intent) {
  const entry = requireProperty(intent);
  requireValue(before.deeds[entry.id].owner === member.seat, "That Monopoly deed is not owned by the actor");
  return entry;
}

function validateBuild(before, after, member, intent, diff) {
  const { id, space } = requireActorProperty(before, member, intent);
  requireValue(space.type === "street" && ownsGroup(before, member.seat, space.group), "A Monopoly building needs the complete color group");
  requireValue(!before.deeds[id].mortgaged, "A mortgaged Monopoly deed cannot be built on");
  const values = GROUPS[space.group].map((propertyId) => equivalent(before, before.deeds[propertyId].houses));
  const current = equivalent(before, before.deeds[id].houses);
  requireValue(current === Math.min(...values) && before.deeds[id].houses !== 5 && before.players.find((value) => value.id === member.seat).cash >= space.build, "That Monopoly building is not legal now");
  requireValue(GROUPS[space.group].every((propertyId) => !before.deeds[propertyId].mortgaged), "A mortgaged group cannot be built on");
  const nextHouses = current === threshold(before) ? 5 : current + 1;
  requireValue(after.deeds[id].houses === nextHouses, "Monopoly build count is invalid");
  const actor = player(before, member.seat), nextActor = player(after, member.seat);
  requireValue(nextActor.cash === actor.cash - space.build, "Monopoly build price is invalid");
  requireValue(after.bank.pot === before.bank.pot, "A Monopoly build cannot change the jackpot");
  assertStableStructure(before, after, ["bank"]);
  assertNoUnrelatedLedger(diff, { cash: [member.seat], buildings: [id] });
}

function validateSell(before, after, member, intent, diff) {
  const { id, space } = requireActorProperty(before, member, intent);
  requireValue(space.type === "street", "Only Monopoly buildings may be sold");
  const values = GROUPS[space.group].map((propertyId) => equivalent(before, before.deeds[propertyId].houses));
  const current = equivalent(before, before.deeds[id].houses);
  requireValue(current > 0 && current === Math.max(...values), "Monopoly buildings must be sold evenly");
  const nextHouses = before.deeds[id].houses === 5 ? threshold(before) : before.deeds[id].houses - 1;
  requireValue(after.deeds[id].houses === nextHouses && player(after, member.seat).cash === player(before, member.seat).cash + Math.floor(space.build / 2), "Invalid Monopoly building sale");
  requireValue(after.bank.pot === before.bank.pot, "A Monopoly building sale cannot change the jackpot");
  assertStableStructure(before, after, ["bank"]);
  assertNoUnrelatedLedger(diff, { cash: [member.seat], buildings: [id] });
}

function validateSellGroup(before, after, member, intent, diff) {
  const { space } = requireActorProperty(before, member, intent);
  requireValue(space.type === "street" && ownsGroup(before, member.seat, space.group), "Invalid Monopoly group sale");
  const ids = GROUPS[space.group].filter((id) => before.deeds[id].houses > 0);
  requireValue(ids.length > 0 && ids.every((id) => after.deeds[id].houses === 0), "Monopoly group sale must clear every building");
  const proceeds = ids.reduce((sum, id) => sum + Math.floor(PROPERTY[id].build * equivalent(before, before.deeds[id].houses) / 2), 0);
  requireValue(player(after, member.seat).cash === player(before, member.seat).cash + proceeds, "Invalid Monopoly group-sale proceeds");
  requireValue(after.bank.pot === before.bank.pot, "A Monopoly group sale cannot change the jackpot");
  assertStableStructure(before, after, ["bank"]);
  assertNoUnrelatedLedger(diff, { cash: [member.seat], buildings: ids });
}

function validateMortgage(before, after, member, intent, diff, undo) {
  const { id, space } = requireActorProperty(before, member, intent);
  const prior = before.deeds[id], next = after.deeds[id];
  if (!undo) {
    requireValue(!prior.mortgaged && next.mortgaged && (!space.group || !groupHasBuildings(before, space.group)), "That Monopoly deed cannot be mortgaged");
    requireValue(player(after, member.seat).cash === player(before, member.seat).cash + space.mortgage, "Invalid Monopoly mortgage proceeds");
  } else {
    const cost = Math.ceil(space.mortgage * 1.1);
    requireValue(prior.mortgaged && !next.mortgaged && player(before, member.seat).cash >= cost, "That Monopoly deed cannot be unmortgaged");
    requireValue(player(after, member.seat).cash === player(before, member.seat).cash - cost, "Invalid Monopoly unmortgage cost");
  }
  assertStableStructure(before, after);
  assertNoUnrelatedLedger(diff, { cash: [member.seat], mortgage: [id] });
}

function validateBuy(before, after, member, intent, diff) {
  const { id, space } = requireProperty(intent);
  requireValue(before.phase === "offer" && before.offerSpace === id && currentPlayer(before).id === member.seat && before.deeds[id].owner === null, "This Monopoly deed is not currently offered");
  requireValue(player(before, member.seat).cash >= space.price && player(after, member.seat).cash === player(before, member.seat).cash - space.price, "Invalid Monopoly purchase price");
  requireValue(after.deeds[id].owner === member.seat && after.phase === "end" && after.offerSpace === null && (after.pendingCard ?? null) === null && (after.landingSpecial ?? null) === null, "Invalid Monopoly purchase result");
  assertStableStructure(before, after, ["phase", "offerSpace", "landingSpecial"]);
  assertNoUnrelatedLedger(diff, { cash: [member.seat], owner: [id] });
}

function validateTradeProposal(before, after, member, intent, diff) {
  requireValue(!before.pendingTrade && object(after.pendingTrade), "Invalid Monopoly trade proposal");
  const trade = after.pendingTrade;
  requireValue(trade.fromId === member.seat && trade.toId !== member.seat && player(before, trade.toId) && !player(before, trade.toId).bankrupt, "Invalid Monopoly trading partner");
  for (const key of ["offerCash", "askCash", "offerChance", "offerCommunity", "askChance", "askCommunity"]) requireValue(integer(trade[key], 0, 10_000_000), "Invalid Monopoly trade amount");
  requireValue(Object.keys(trade).every((key) => ["fromId", "toId", "offerCash", "askCash", "offerChance", "offerCommunity", "askChance", "askCommunity", "offerProps", "askProps"].includes(key)), "Unsupported Monopoly trade field");
  requireValue(trade.offerCash <= player(before, trade.fromId).cash && trade.askCash <= player(before, trade.toId).cash, "Monopoly trade exceeds available cash");
  const fromCards = player(before, trade.fromId).getOut, toCards = player(before, trade.toId).getOut;
  requireValue(trade.offerChance <= fromCards.chance && trade.offerCommunity <= fromCards.community && trade.askChance <= toCards.chance && trade.askCommunity <= toCards.community, "Monopoly trade exceeds available Jail cards");
  for (const [list, owner] of [[trade.offerProps, trade.fromId], [trade.askProps, trade.toId]]) {
    requireValue(Array.isArray(list) && new Set(list).size === list.length, "Invalid Monopoly trade deeds");
    for (const id of list) requireValue(PROPERTY[id] && before.deeds[id].owner === owner && (!PROPERTY[id].group || !groupHasBuildings(before, PROPERTY[id].group)), "A Monopoly trade includes an unavailable deed");
  }
  if (before.pendingDebt?.resume === "mortgageChoices") {
    requireValue(before.mortgageChoiceResume === "afterBankruptcy", "A completed trade-mortgage debt cannot be replaced by another trade");
    requireValue([...trade.offerProps, ...trade.askProps].every((id) => !before.deeds[id].mortgaged), "A mortgage-interest rescue trade cannot add another transferred mortgage");
  }
  const offered = trade.offerCash + trade.askCash + trade.offerChance + trade.offerCommunity + trade.askChance + trade.askCommunity + trade.offerProps.length + trade.askProps.length;
  requireValue(offered > 0, "A Monopoly trade cannot be empty");
  const interestFrom = trade.askProps.reduce((sum, id) => sum + (before.deeds[id].mortgaged ? Math.ceil(PROPERTY[id].mortgage * 0.1) : 0), 0);
  const interestTo = trade.offerProps.reduce((sum, id) => sum + (before.deeds[id].mortgaged ? Math.ceil(PROPERTY[id].mortgage * 0.1) : 0), 0);
  requireValue(player(before, trade.fromId).cash - trade.offerCash + trade.askCash >= interestFrom && player(before, trade.toId).cash - trade.askCash + trade.offerCash >= interestTo, "Monopoly trade cannot skip mortgage interest");
  assertStableStructure(before, after, ["pendingTrade"]);
  assertNoUnrelatedLedger(diff);
}

function validateTradeDecision(before, after, member, intent, diff, accept) {
  const trade = before.pendingTrade;
  requireValue(object(trade) && trade.toId === member.seat && after.pendingTrade === null, "Only the offered Monopoly player may decide a trade");
  if (!accept) {
    assertStableStructure(before, after, ["pendingTrade"]);
    assertNoUnrelatedLedger(diff);
    return;
  }
  if (before.pendingDebt?.resume === "mortgageChoices") {
    requireValue(before.mortgageChoiceResume === "afterBankruptcy", "A completed trade-mortgage debt cannot be replaced by another trade");
    requireValue([...trade.offerProps, ...trade.askProps].every((id) => !before.deeds[id].mortgaged), "A mortgage-interest rescue trade cannot add another transferred mortgage");
  }
  const cashIds = [...new Set([trade.fromId, trade.toId])];
  requireValue(player(after, trade.fromId).cash === player(before, trade.fromId).cash - trade.offerCash + trade.askCash, "Invalid Monopoly trade cash for proposer");
  requireValue(player(after, trade.toId).cash === player(before, trade.toId).cash - trade.askCash + trade.offerCash, "Invalid Monopoly trade cash for recipient");
  for (const id of trade.offerProps) requireValue(after.deeds[id].owner === trade.toId, "Monopoly offered deed was not transferred exactly");
  for (const id of trade.askProps) requireValue(after.deeds[id].owner === trade.fromId, "Monopoly requested deed was not transferred exactly");
  const beforeFrom = player(before, trade.fromId).getOut, beforeTo = player(before, trade.toId).getOut;
  const afterFrom = player(after, trade.fromId).getOut, afterTo = player(after, trade.toId).getOut;
  requireValue(afterFrom.chance === beforeFrom.chance - trade.offerChance + trade.askChance && afterFrom.community === beforeFrom.community - trade.offerCommunity + trade.askCommunity, "Invalid Monopoly trade Jail cards");
  requireValue(afterTo.chance === beforeTo.chance + trade.offerChance - trade.askChance && afterTo.community === beforeTo.community + trade.offerCommunity - trade.askCommunity, "Invalid Monopoly trade Jail cards");
  const choices = [
    ...trade.offerProps.filter((id) => before.deeds[id].mortgaged).map((spaceId) => ({ playerId: trade.toId, spaceId })),
    ...trade.askProps.filter((id) => before.deeds[id].mortgaged).map((spaceId) => ({ playerId: trade.fromId, spaceId }))
  ];
  requireValue(same(after.pendingMortgageChoices || [], choices), "Invalid Monopoly trade mortgage choices");
  requireValue((choices.length ? after.mortgageChoiceResume === "trade" : (after.mortgageChoiceResume ?? null) === (before.mortgageChoiceResume ?? null)), "Invalid Monopoly trade mortgage continuation");
  const cardIds = same(beforeFrom, afterFrom) && same(beforeTo, afterTo) ? [] : cashIds;
  assertStableStructure(before, after, ["pendingTrade", "pendingMortgageChoices", "mortgageChoiceResume"]);
  assertNoUnrelatedLedger(diff, { cash: diff.cash.length ? cashIds : [], owner: [...trade.offerProps, ...trade.askProps], cards: cardIds });
}

function validateEndTurn(before, after, member, diff) {
  requireValue(["end"].includes(before.phase) && !before.extraRoll && currentPlayer(before).id === member.seat, "Monopoly turn cannot end now");
  const turnLimitEnd = before.settings.turnLimit > 0 && before.turnCount + 1 >= before.settings.turnLimit;
  if (turnLimitEnd) {
    requireValue(after.turnIndex === before.turnIndex && after.turnCount === before.turnCount + 1 && after.round === before.round && after.gameOver && after.phase === "gameOver", "Invalid Monopoly turn-limit completion");
    requireValue(after.doublesCount === before.doublesCount && after.extraRoll === before.extraRoll && same(after.lastRoll, before.lastRoll), "Turn-limit completion changed the last roll");
    requireValue((after.offerSpace ?? null) === null && (after.landingSpecial ?? null) === null, "A completed Monopoly turn retained landing authority");
    assertStableStructure(before, after, ["phase", "turnCount", "offerSpace", "landingSpecial", "gameOver", "endReason"]);
    assertNoUnrelatedLedger(diff);
    return;
  }
  let nextIndex = before.turnIndex;
  do nextIndex = (nextIndex + 1) % before.players.length;
  while (before.players[nextIndex].bankrupt && nextIndex !== before.turnIndex);
  requireValue(after.turnIndex === nextIndex && after.turnCount === before.turnCount + 1 && after.round === before.round + (nextIndex <= before.turnIndex ? 1 : 0), "Invalid Monopoly turn advance");
  requireValue(after.phase === (after.gameOver ? "gameOver" : "roll") && after.doublesCount === 0 && !after.extraRoll && after.lastRoll.length === 0, "Invalid Monopoly next-turn state");
  requireValue((after.offerSpace ?? null) === null && (after.landingSpecial ?? null) === null, "A Monopoly turn retained stale landing authority");
  assertStableStructure(before, after, ["turnIndex", "phase", "round", "turnCount", "doublesCount", "extraRoll", "lastRoll", "offerSpace", "landingSpecial", "gameOver", "endReason"]);
  assertNoUnrelatedLedger(diff);
}

function nextAuctionBidder(afterId, candidates, order) {
  const index = order.indexOf(afterId);
  for (let offset = 1; offset <= order.length; offset++) {
    const id = order[(index + offset) % order.length];
    if (candidates.includes(id)) return id;
  }
  return candidates[0];
}

function validateStartAuction(before, after, member, intent, diff) {
  const id = Number(intent.spaceId);
  requireValue(before.phase === "offer" && before.offerSpace === id && PROPERTY[id] && before.deeds[id].owner === null && currentPlayer(before).id === member.seat, "That Monopoly auction cannot start now");
  const participants = before.players.filter((value) => !value.bankrupt).map((value) => value.id);
  const expected = { spaceId: id, returnMode: "landing", bid: 0, highestId: null, currentBidderId: member.seat, passed: [], participants };
  requireValue(after.phase === "auction" && after.offerSpace === null && same(after.pendingAuction, expected), "Invalid initial Monopoly auction state");
  assertStableStructure(before, after, ["phase", "pendingAuction", "offerSpace"]);
  assertNoUnrelatedLedger(diff);
}

function validateAuctionDecision(before, after, member, intent, diff, bidAction) {
  const auction = before.pendingAuction;
  requireValue(before.phase === "auction" && object(auction) && auction.currentBidderId === member.seat && auction.spaceId === Number(intent.spaceId), "No owned Monopoly auction decision is pending");
  const canonical = clone(before), nextAuction = canonical.pendingAuction;
  if (bidAction) {
    const value = Number(intent.value);
    requireValue(integer(value, auction.bid + 1, player(before, member.seat).cash), "Invalid Monopoly auction bid");
    nextAuction.bid = value;
    nextAuction.highestId = member.seat;
  } else if (!nextAuction.passed.includes(member.seat)) nextAuction.passed.push(member.seat);
  canonicalAdvanceAuction(canonical);
  assertCanonicalCore(canonical, after, "Invalid Monopoly auction continuation");
}

function liquidationCapacity(state, owner) {
  const value = player(state, owner);
  let capacity = value.cash;
  for (const id of PROPERTY_IDS) {
    const deed = state.deeds[id], space = PROPERTY[id];
    if (deed.owner !== owner) continue;
    if (!deed.mortgaged) capacity += space.mortgage;
    if (space.type === "street") capacity += Math.floor(space.build * equivalent(state, deed.houses) / 2);
  }
  return capacity;
}

function expectedAuction(state, spaceId, returnMode) {
  const participants = state.players.filter((value) => !value.bankrupt).map((value) => value.id);
  const current = currentPlayer(state)?.id;
  return {
    spaceId,
    returnMode,
    bid: 0,
    highestId: null,
    currentBidderId: participants.includes(current) ? current : participants[0],
    passed: [],
    participants
  };
}

function assertTurnAdvance(before, after) {
  let nextIndex = before.turnIndex;
  do nextIndex = (nextIndex + 1) % after.players.length;
  while (after.players[nextIndex].bankrupt && nextIndex !== before.turnIndex);
  requireValue(after.turnIndex === nextIndex && after.turnCount === before.turnCount + 1 && after.round === before.round + (nextIndex <= before.turnIndex ? 1 : 0), "Invalid Monopoly bankruptcy turn advance");
  requireValue(after.phase === "roll" && after.doublesCount === 0 && !after.extraRoll && after.lastRoll.length === 0 && !after.gameOver, "Invalid Monopoly post-bankruptcy turn state");
  requireValue((after.offerSpace ?? null) === null && (after.landingSpecial ?? null) === null, "Bankruptcy retained stale landing authority");
}

function validateBankruptcy(before, after, member, diff) {
  const debt = before.pendingDebt;
  requireValue(before.phase === "debt" && debt?.debtorId === member.seat && Number(debt.amount) > liquidationCapacity(before, member.seat), "A Monopoly bankruptcy requires an unpayable debt");
  const canonical = clone(before), canonicalDebtor = player(canonical, member.seat);
  const canonicalOwned = PROPERTY_IDS.filter((id) => canonical.deeds[id].owner === member.seat);
  const canonicalCreditor = debt.creditorId === null ? null : player(canonical, debt.creditorId);
  const wasCurrent = currentPlayer(canonical)?.id === member.seat;
  for (const id of canonicalOwned) {
    const space = PROPERTY[id], deed = canonical.deeds[id];
    if (space.type !== "street" || !deed.houses) continue;
    canonicalDebtor.cash += Math.floor(space.build * equivalent(canonical, deed.houses) / 2);
    if (deed.houses === 5) canonical.bank.hotels++;
    else canonical.bank.houses += deed.houses;
    deed.houses = 0;
  }
  canonical.pendingDebt = null;
  if (canonicalCreditor && !canonicalCreditor.bankrupt) {
    canonicalCreditor.cash += canonicalDebtor.cash;
    canonicalDebtor.cash = 0;
    for (const id of canonicalOwned) canonical.deeds[id].owner = canonicalCreditor.id;
    canonicalCreditor.getOut.chance += canonicalDebtor.getOut.chance;
    canonicalCreditor.getOut.community += canonicalDebtor.getOut.community;
  } else {
    canonicalDebtor.cash = 0;
    if (canonicalDebtor.getOut.chance) canonical.decks.chance.push("c_jailcard");
    if (canonicalDebtor.getOut.community) canonical.decks.community.push("m_jailcard");
    for (const id of canonicalOwned) canonical.deeds[id] = { owner: null, mortgaged: false, houses: 0 };
    canonical.bankAuctionQueue = [...canonicalOwned];
  }
  canonicalDebtor.getOut = { chance: 0, community: 0 };
  canonicalDebtor.bankrupt = true;
  canonicalDebtor.inJail = false;
  canonical.bankruptcyStack = canonical.bankruptcyStack || [];
  canonical.bankruptcyStack.push({ playerId: canonicalDebtor.id, wasCurrent, resume: debt.resume });
  if (canonicalCreditor && !canonicalCreditor.bankrupt) {
    const mortgageChoices = canonicalOwned.filter((id) => canonical.deeds[id].mortgaged).map((spaceId) => ({ playerId: canonicalCreditor.id, spaceId }));
    if (mortgageChoices.length) {
      canonical.pendingMortgageChoices = mortgageChoices;
      canonical.mortgageChoiceResume = "afterBankruptcy";
      canonicalProcessMortgageChoices(canonical);
    } else canonicalAfterBankruptcy(canonical);
  } else if (canonical.settings.firstBankruptcy || canonical.players.filter((value) => !value.bankrupt).length <= 1) canonicalAfterBankruptcy(canonical);
  else if (canonical.bankAuctionQueue.length) canonicalStartNextBankAuction(canonical);
  else canonicalAfterBankruptcy(canonical);
  assertCanonicalCore(canonical, after, "Invalid Monopoly bankruptcy continuation");
  return;
  const debtorBefore = player(before, member.seat), debtorAfter = player(after, member.seat);
  requireValue(!debtorBefore.bankrupt && debtorAfter.bankrupt && debtorAfter.cash === 0 && !debtorAfter.inJail, "Invalid Monopoly bankrupt player state");
  const owned = PROPERTY_IDS.filter((id) => before.deeds[id].owner === member.seat);
  const creditor = debt.creditorId === null ? null : player(before, debt.creditorId);
  const context = { playerId: member.seat, wasCurrent: currentPlayer(before)?.id === member.seat, resume: debt.resume };
  const priorStack = before.bankruptcyStack || [];
  const buildingProceeds = owned.reduce((sum, id) => sum + Math.floor(PROPERTY[id].build * equivalent(before, before.deeds[id].houses) / 2), 0);
  if (creditor && !creditor.bankrupt) {
    const proceeds = debtorBefore.cash + buildingProceeds;
    requireValue(player(after, creditor.id).cash === creditor.cash + proceeds, "Invalid Monopoly creditor bankruptcy proceeds");
    for (const id of owned) requireValue(after.deeds[id].owner === creditor.id && after.deeds[id].houses === 0, "Invalid Monopoly bankruptcy deed transfer");
    requireValue(player(after, creditor.id).getOut.chance === creditor.getOut.chance + debtorBefore.getOut.chance && player(after, creditor.id).getOut.community === creditor.getOut.community + debtorBefore.getOut.community, "Invalid Monopoly bankruptcy Jail-card transfer");
    requireValue(same(after.decks, before.decks), "Creditor bankruptcy cannot change Monopoly card decks");
    const mortgageChoices = owned.filter((id) => before.deeds[id].mortgaged).map((spaceId) => ({ playerId: creditor.id, spaceId }));
    requireValue(same(after.pendingMortgageChoices || [], mortgageChoices), "Invalid Monopoly creditor mortgage choices");
    if (mortgageChoices.length) requireValue(after.mortgageChoiceResume === "afterBankruptcy", "Invalid Monopoly bankruptcy mortgage continuation");
  } else {
    for (const id of owned) requireValue(after.deeds[id].owner === null && !after.deeds[id].mortgaged && after.deeds[id].houses === 0, "Invalid Monopoly bank bankruptcy return");
    const expectedChance = debtorBefore.getOut.chance ? [...before.decks.chance, "c_jailcard"] : before.decks.chance;
    const expectedCommunity = debtorBefore.getOut.community ? [...before.decks.community, "m_jailcard"] : before.decks.community;
    requireValue(same(after.decks.chance, expectedChance) && same(after.decks.community, expectedCommunity), "Invalid Monopoly bank bankruptcy Jail-card return");
    if (!after.gameOver && owned.length) {
      requireValue(after.phase === "auction" && after.pendingAuction?.spaceId === owned[0] && after.pendingAuction.returnMode === "bankruptcy", "Invalid Monopoly first bank auction");
      requireValue(same(after.bankAuctionQueue || [], owned.slice(1)), "Invalid Monopoly bank-auction queue");
    } else requireValue(same(after.bankAuctionQueue || [], owned), "Invalid terminal Monopoly bank-auction queue");
  }
  requireValue(debtorAfter.getOut.chance === 0 && debtorAfter.getOut.community === 0, "Bankrupt Monopoly player retained a Jail card");
  requireValue(same(after.pendingTrade ?? null, before.pendingTrade ?? null), "Bankruptcy cannot inject a Monopoly trade");
  requireValue(after.bank.pot === before.bank.pot, "Bankruptcy cannot change the Monopoly jackpot");
  assertNoUnrelatedLedger(diff, {
    cash: creditor ? [member.seat, creditor.id] : [member.seat],
    jail: debtorBefore.inJail ? [member.seat] : [],
    cards: (debtorBefore.getOut.chance || debtorBefore.getOut.community) ? [member.seat, ...(creditor ? [creditor.id] : [])] : [],
    bankrupt: [member.seat],
    owner: owned,
    mortgage: creditor ? [] : owned.filter((id) => before.deeds[id].mortgaged),
    buildings: owned.filter((id) => before.deeds[id].houses > 0)
  });
  requireValue(after.pendingDebt === null, "Bankrupt Monopoly debt remained pending");
  const alive = after.players.filter((value) => !value.bankrupt);
  const mortgageChoices = creditor && !creditor.bankrupt
    ? owned.filter((id) => before.deeds[id].mortgaged).map((spaceId) => ({ playerId: creditor.id, spaceId }))
    : [];
  if (mortgageChoices.length) {
    requireValue(after.phase === "debt" && same(after.bankruptcyStack || [], [...priorStack, context]) && same(after.pendingMortgageChoices || [], mortgageChoices) && after.mortgageChoiceResume === "afterBankruptcy", "Invalid Monopoly creditor-bankruptcy continuation");
    requireValue(same(after.bankAuctionQueue || [], before.bankAuctionQueue || []) && same(after.pendingAuction ?? null, before.pendingAuction ?? null), "Creditor bankruptcy injected a bank auction");
    assertStableStructure(before, after, ["phase", "bank", "pendingDebt", "pendingMortgageChoices", "mortgageChoiceResume", "bankruptcyStack"]);
  } else if (alive.length <= 1 || before.settings.firstBankruptcy) {
    const reason = alive.length <= 1 ? "Last player standing" : "Quick game: first bankruptcy";
    requireValue(after.gameOver && after.phase === "gameOver" && after.endReason === reason && same(after.bankruptcyStack || [], priorStack), "Invalid terminal Monopoly bankruptcy continuation");
    const expectedQueue = creditor ? (before.bankAuctionQueue || []) : owned;
    requireValue(same(after.bankAuctionQueue || [], expectedQueue) && (after.pendingAuction ?? null) === null, "Terminal Monopoly bankruptcy forged an auction");
    assertStableStructure(before, after, ["phase", "bank", "decks", "pendingDebt", "bankAuctionQueue", "bankruptcyStack", "gameOver", "endReason"]);
  } else if (!creditor && owned.length) {
    requireValue(after.phase === "auction" && same(after.pendingAuction, expectedAuction(after, owned[0], "bankruptcy")) && same(after.bankAuctionQueue || [], owned.slice(1)) && same(after.bankruptcyStack || [], [...priorStack, context]), "Invalid Monopoly bank-auction continuation");
    requireValue((after.offerSpace ?? null) === null, "Bankruptcy auction retained an offer");
    assertStableStructure(before, after, ["phase", "bank", "decks", "pendingDebt", "pendingAuction", "bankAuctionQueue", "bankruptcyStack", "offerSpace"]);
  } else if (context.wasCurrent || currentPlayer(after)?.bankrupt) {
    requireValue(same(after.bankruptcyStack || [], priorStack), "Completed Monopoly bankruptcy retained its continuation context");
    assertTurnAdvance(before, after);
    assertStableStructure(before, after, ["turnIndex", "phase", "round", "turnCount", "doublesCount", "extraRoll", "lastRoll", "bank", "decks", "pendingDebt", "bankruptcyStack", "offerSpace", "landingSpecial"]);
  } else if (context.resume === "transfers" || context.resume === "mortgageChoices" || context.resume === "afterBankruptcy") {
    throw error("This nested Monopoly bankruptcy continuation is not safe to resolve from a peer snapshot");
  } else {
    requireValue(after.phase === "end" && same(after.bankruptcyStack || [], priorStack) && (after.offerSpace ?? null) === null && (after.landingSpecial ?? null) === null, "Invalid Monopoly post-bankruptcy landing continuation");
    assertStableStructure(before, after, ["phase", "bank", "decks", "pendingDebt", "bankruptcyStack", "offerSpace", "landingSpecial"]);
  }
}

function validatePayDebt(before, after, member, intent, diff) {
  const debt = before.pendingDebt;
  requireValue(before.phase === "debt" && debt?.debtorId === member.seat && player(before, member.seat).cash >= debt.amount, "This Monopoly debt cannot be paid now");
  requireValue(Number(intent.amount) === debt.amount, "Monopoly debt intent does not match the pending amount");
  const canonical = clone(before);
  canonicalExecutePayment(canonical, canonical.pendingDebt);
  canonical.pendingDebt = null;
  canonicalResumeAfter(canonical, debt.resume);
  assertCanonicalCore(canonical, after, "Invalid Monopoly debt continuation");
  return;
  const creditorId = debt.creditorId;
  const expectedCash = Object.fromEntries(before.players.map((value) => [value.id, value.cash]));
  expectedCash[member.seat] -= debt.amount;
  if (creditorId !== null && !player(before, creditorId)?.bankrupt) expectedCash[creditorId] += debt.amount;
  let expectedPot = before.bank.pot + (creditorId === null && debt.potEligible && before.settings.freeParking ? debt.amount : 0);
  const verifyCash = () => {
    for (const value of after.players) requireValue(value.cash === expectedCash[value.id], "Invalid Monopoly debt continuation cash");
  };

  if (debt.resume === "transfers") {
    requireValue(before.transfersResume === "finish", "Invalid Monopoly transfer continuation source");
    let expectedDebt = null, remaining = [...(before.pendingTransfers || [])];
    while (remaining.length) {
      const item = remaining.shift(), creditor = item.creditorId === null ? null : player(before, item.creditorId);
      const debtor = player(before, item.debtorId);
      if (!debtor || debtor.bankrupt || (item.creditorId !== null && (!creditor || creditor.bankrupt))) continue;
      if (expectedCash[item.debtorId] < item.amount) { expectedDebt = item; break; }
      expectedCash[item.debtorId] -= item.amount;
      if (creditor && !creditor.bankrupt) expectedCash[item.creditorId] += item.amount;
      else if (item.potEligible && before.settings.freeParking) expectedPot += item.amount;
    }
    verifyCash();
    requireValue(after.bank.pot === expectedPot && same(after.decks, before.decks), "Invalid Monopoly transfer payment bank state");
    requireValue(same(after.pendingTransfers || [], remaining), "Invalid Monopoly remaining transfers after debt payment");
    if (expectedDebt) {
      requireValue(after.phase === "debt" && after.transfersResume === "finish", "Invalid Monopoly continuing transfer phase");
      assertPendingDebt(after.pendingDebt, { ...expectedDebt, resume: "transfers" });
      assertStableStructure(before, after, ["bank", "pendingDebt", "pendingTransfers"]);
    } else {
      requireValue(after.phase === "end" && after.pendingDebt === null && (after.transfersResume ?? null) === null && (after.offerSpace ?? null) === null && (after.landingSpecial ?? null) === null, "Invalid Monopoly completed transfer continuation");
      assertStableStructure(before, after, ["phase", "bank", "pendingDebt", "pendingTransfers", "transfersResume", "offerSpace", "landingSpecial"]);
    }
  } else if (debt.resume === "finish") {
    verifyCash();
    requireValue(after.bank.pot === expectedPot && same(after.decks, before.decks), "Invalid Monopoly debt payment bank state");
    requireValue(after.phase === "end" && after.pendingDebt === null && (after.offerSpace ?? null) === null && (after.pendingCard ?? null) === null && (after.landingSpecial ?? null) === null, "Paid Monopoly debt remained pending or did not finish its landing");
    assertStableStructure(before, after, ["phase", "bank", "pendingDebt", "offerSpace", "landingSpecial"]);
  } else if (debt.resume === "jailPaid") {
    verifyCash();
    const next = player(after, member.seat);
    requireValue(after.bank.pot === expectedPot && same(after.decks, before.decks), "Invalid Monopoly Jail-debt payment bank state");
    requireValue(after.phase === "roll" && after.pendingDebt === null && !next.inJail && next.jailTurns === 0, "Invalid Monopoly paid-Jail continuation");
    assertStableStructure(before, after, ["phase", "bank", "pendingDebt"]);
  } else if (debt.resume === "jailForcedMove") {
    verifyCash();
    const prior = player(before, member.seat), next = player(after, member.seat), total = before.pendingJailMove;
    const expectedMove = { playerId: member.seat, path: pathBy(prior.pos, total), cursor: 0, total, collectGo: true, direction: 1, resolution: "jailForced", meta: {} };
    requireValue(integer(total, 2, 12) && after.phase === "moving" && after.pendingDebt === null && after.pendingJailMove === null && same(after.pendingMove, expectedMove), "Invalid Monopoly forced-Jail debt movement");
    requireValue(!next.inJail && next.jailTurns === 0 && next.pos === prior.pos && after.bank.pot === expectedPot && same(after.decks, before.decks), "Invalid Monopoly forced-Jail debt release");
    assertStableStructure(before, after, ["phase", "bank", "pendingDebt", "pendingMove", "pendingJailMove"]);
  } else if (debt.resume === "jailForcedMoveInstant") {
    const prior = player(before, member.seat), total = before.pendingJailMove;
    requireValue(integer(total, 2, 12), "Invalid Monopoly instant Jail movement total");
    const virtual = clone(before), virtualActor = player(virtual, member.seat);
    for (const value of virtual.players) value.cash = expectedCash[value.id];
    virtualActor.inJail = false;
    virtualActor.jailTurns = 0;
    virtual.bank.pot = expectedPot;
    virtual.pendingDebt = null;
    virtual.pendingJailMove = null;
    const destination = (prior.pos + total) % 40;
    const passedGo = prior.pos + total >= 40;
    requireValue(player(after, member.seat).pos === (destination === 30 ? 10 : destination), "Invalid Monopoly instant Jail movement destination");
    validateLanding(virtual, after, member.seat, destination, expectedCash[member.seat] + (passedGo ? before.settings.goSalary : 0));
  } else if (debt.resume === "mortgageChoices") {
    verifyCash();
    requireValue(after.bank.pot === expectedPot && same(after.decks, before.decks), "Invalid Monopoly mortgage-interest payment bank state");
    const choices = [...(before.pendingMortgageChoices || [])];
    while (choices.length) {
      const choice = choices[0], owner = player(after, choice.playerId);
      if (owner && !owner.bankrupt && after.deeds[choice.spaceId]?.owner === owner.id && after.deeds[choice.spaceId].mortgaged) break;
      choices.shift();
    }
    if (choices.length) {
      requireValue(after.phase === "debt" && after.pendingDebt === null && same(after.pendingMortgageChoices || [], choices) && after.mortgageChoiceResume === before.mortgageChoiceResume, "Invalid Monopoly next mortgage choice");
      assertStableStructure(before, after, ["bank", "pendingDebt", "pendingMortgageChoices"]);
    } else {
      throw error("This completed Monopoly mortgage-choice bankruptcy continuation requires an exact host checkpoint");
    }
  } else {
    throw error("Unsupported peer-supplied Monopoly debt continuation");
  }
  requireValue(same(after.pendingTrade ?? null, before.pendingTrade ?? null), "A Monopoly debt payment cannot inject a trade");
  assertNoUnrelatedLedger(diff, {
    cash: diff.cash.map((change) => change.id),
    position: debt.resume === "jailForcedMoveInstant" ? [member.seat] : [],
    jail: ["jailPaid", "jailForcedMove", "jailForcedMoveInstant"].includes(debt.resume) ? [member.seat] : []
  });
}

function validateMortgageChoice(before, after, member, intent, diff) {
  const choices = before.pendingMortgageChoices;
  const choice = choices?.[0], id = Number(intent.spaceId);
  requireValue(choice?.playerId === member.seat && choice.spaceId === id && before.deeds[id]?.owner === member.seat && before.deeds[id].mortgaged, "No owned Monopoly mortgage choice is pending");
  const canonical = clone(before), canonicalChoice = canonical.pendingMortgageChoices.shift();
  const canonicalSpace = PROPERTY[id], canonicalPlayer = player(canonical, member.seat);
  if (intent.unmortgageNow === true) {
    const payoff = Math.ceil(canonicalSpace.mortgage * 1.1);
    requireValue(canonicalPlayer.cash >= payoff, "This Monopoly deed cannot be unmortgaged now");
    if (before.mortgageChoiceResume === "trade") {
      const reservedInterest = canonical.pendingMortgageChoices
        .filter((pending) => pending.playerId === member.seat && canonical.deeds[pending.spaceId]?.owner === member.seat && canonical.deeds[pending.spaceId].mortgaged)
        .reduce((sum, pending) => sum + Math.ceil(PROPERTY[pending.spaceId].mortgage * 0.1), 0);
      requireValue(canonicalPlayer.cash - payoff >= reservedInterest, "Unmortgaging now would erase a later transferred-mortgage obligation");
    }
    canonicalPlayer.cash -= payoff;
    canonical.deeds[id].mortgaged = false;
    canonicalProcessMortgageChoices(canonical);
  } else {
    const interest = Math.ceil(canonicalSpace.mortgage * 0.1);
    canonicalCharge(canonical, canonicalChoice.playerId, interest, null, `Interest on transferred ${PROPERTY_NAME[id]}`, "mortgageChoices", false);
  }
  assertCanonicalCore(canonical, after, "Invalid Monopoly mortgage-choice continuation");
  return;
  const expectedRemaining = choices.slice(1);
  requireValue(same(after.pendingMortgageChoices || [], expectedRemaining), "Invalid Monopoly mortgage-choice queue");
  const space = PROPERTY[id], prior = player(before, member.seat), next = player(after, member.seat);
  let createdDebt = null;
  if (intent.unmortgageNow === true) {
    const payoff = Math.ceil(space.mortgage * 1.1);
    requireValue(prior.cash >= payoff && next.cash === prior.cash - payoff && !after.deeds[id].mortgaged, "Invalid Monopoly transferred-deed payoff");
    assertNoUnrelatedLedger(diff, { cash: [member.seat], mortgage: [id] });
  } else {
    const interest = Math.ceil(space.mortgage * 0.1);
    requireValue(after.deeds[id].mortgaged, "Keeping a Monopoly mortgage cannot clear it");
    if (prior.cash >= interest) requireValue(next.cash === prior.cash - interest, "Invalid Monopoly transferred-deed interest");
    else {
      createdDebt = { debtorId: member.seat, creditorId: null, amount: interest, cause: `Interest on transferred ${PROPERTY_NAME[id]}`, resume: "mortgageChoices", potEligible: false };
      requireValue(next.cash === prior.cash && after.phase === "debt", "Invalid Monopoly transferred-mortgage debt");
      assertPendingDebt(after.pendingDebt, createdDebt);
    }
    assertNoUnrelatedLedger(diff, { cash: diff.cash.map((change) => change.id) });
  }
  if (createdDebt) {
    requireValue(after.mortgageChoiceResume === before.mortgageChoiceResume, "Invalid Monopoly mortgage-choice debt continuation");
    assertStableStructure(before, after, ["phase", "pendingDebt", "pendingMortgageChoices"]);
  } else if (expectedRemaining.length) {
    requireValue(after.phase === before.phase && (after.pendingDebt ?? null) === (before.pendingDebt ?? null) && after.mortgageChoiceResume === before.mortgageChoiceResume, "Invalid Monopoly next transferred-mortgage choice");
    assertStableStructure(before, after, ["pendingMortgageChoices"]);
  } else if (before.mortgageChoiceResume === "trade") {
    requireValue(after.phase === before.phase && (after.pendingDebt ?? null) === (before.pendingDebt ?? null) && after.mortgageChoiceResume === null, "Invalid Monopoly completed trade-mortgage continuation");
    assertStableStructure(before, after, ["pendingMortgageChoices", "mortgageChoiceResume"]);
  } else {
    throw error("This completed Monopoly bankruptcy-mortgage continuation requires an exact host checkpoint");
  }
}

function pathBy(from, steps) {
  const direction = steps < 0 ? -1 : 1;
  return Array.from({ length: Math.abs(steps) }, (_, index) => ((from + direction * (index + 1)) % 40 + 40) % 40);
}

function pathTo(from, to) {
  const steps = to > from ? to - from : 40 - from + to;
  return pathBy(from, steps || 40);
}

function assertCardReturned(before, after, deck, cardId, jailCard) {
  const expected = jailCard ? before.decks[deck] : [...before.decks[deck], cardId];
  requireValue(same(after.decks[deck], expected), "Monopoly card returned to the wrong deck position");
  const other = deck === "chance" ? "community" : "chance";
  requireValue(same(after.decks[other], before.decks[other]), "A Monopoly card changed the other deck");
}

function validateCardResolution(before, after, member, intent, diff) {
  const pending = before.pendingCard;
  requireValue(before.phase === "cardDraw" && object(pending) && intent.deck === pending.deck && intent.cardId === pending.id, "Monopoly card intent does not match the pending card");
  const effect = CARD_EFFECT[pending.id];
  requireValue(effect, "Unknown Monopoly card effect");
  const actor = member.seat, prior = player(before, actor), next = player(after, actor);
  assertCardReturned(before, after, pending.deck, pending.id, effect.type === "jailcard");
  requireValue(after.pendingCard === null, "Resolved Monopoly card remained pending");

  if (effect.type === "cash") {
    requireValue(next.cash === prior.cash + effect.amount && after.phase === "end", "Invalid Monopoly cash-card award");
    requireValue(after.bank.pot === before.bank.pot, "A Monopoly cash card cannot change the jackpot");
    assertStableStructure(before, after, ["phase", "decks", "pendingCard"]);
    assertNoUnrelatedLedger(diff, { cash: [actor] });
    return;
  }
  if (effect.type === "pay" || effect.type === "repairs") {
    let amount = effect.amount || 0;
    if (effect.type === "repairs") {
      for (const id of PROPERTY_IDS) if (before.deeds[id].owner === actor && PROPERTY[id].type === "street") {
        const count = before.deeds[id].houses;
        amount += count === 5 ? effect.hotel : count * effect.house;
      }
    }
    if (prior.cash >= amount) {
      requireValue(next.cash === prior.cash - amount && after.phase === "end", "Invalid Monopoly payment-card result");
      const expectedPot = before.bank.pot + (before.settings.freeParking ? amount : 0);
      requireValue(after.bank.pot === expectedPot && after.bank.houses === before.bank.houses && after.bank.hotels === before.bank.hotels, "Invalid Monopoly payment-card pot");
    } else {
      requireValue(next.cash === prior.cash && after.phase === "debt", "Invalid Monopoly payment-card debt");
      assertPendingDebt(after.pendingDebt, { debtorId: actor, creditorId: null, amount, cause: effect.type === "repairs" ? "Property repairs" : CARD_CAUSE[pending.id], resume: "finish", potEligible: true });
      requireValue(same(after.bank, before.bank), "An unpaid Monopoly card cannot change the jackpot");
    }
    assertStableStructure(before, after, ["phase", "bank", "decks", "pendingDebt", "pendingCard"]);
    assertNoUnrelatedLedger(diff, { cash: [actor] });
    return;
  }
  if (effect.type === "jailcard") {
    requireValue(next.getOut[pending.deck] === prior.getOut[pending.deck] + 1 && after.phase === "end", "Invalid Monopoly Get Out of Jail card award");
    requireValue(after.bank.pot === before.bank.pot, "A Monopoly Jail card cannot change the jackpot");
    assertStableStructure(before, after, ["phase", "decks", "pendingCard"]);
    assertNoUnrelatedLedger(diff, { cards: [actor] });
    return;
  }
  if (["move", "back", "nearest", "jail"].includes(effect.type)) {
    const movement = after.pendingMove;
    requireValue(after.phase === "moving" && movement?.playerId === actor && movement.resolution === (effect.type === "jail" ? "jail" : "card") && movement.cursor === 0, "Invalid Monopoly card movement");
    let expectedPath, expectedMeta = {};
    if (effect.type === "move") expectedPath = pathTo(prior.pos, effect.to);
    else if (effect.type === "back") expectedPath = pathBy(prior.pos, -effect.steps);
    else if (effect.type === "jail") {
      expectedPath = [10];
      expectedMeta = { reason: "Go directly to Jail!" };
    }
    else {
      const targetType = effect.target;
      const targets = PROPERTY_IDS.filter((id) => PROPERTY[id].type === targetType);
      const target = targets.find((id) => id > prior.pos) ?? targets[0];
      expectedPath = pathTo(prior.pos, target);
      if (pending.id === "c_util") {
        requireValue(after.lastRoll.length === 2 && after.lastRoll.every((die) => integer(die, 1, 6)), "Invalid Monopoly utility-card dice");
        expectedMeta = { special: { double: false, ten: true, rollTotal: after.lastRoll[0] + after.lastRoll[1] } };
      } else if (pending.id === "c_rail1" || pending.id === "c_rail2") expectedMeta = { special: { double: true, ten: false } };
    }
    const expectedMovement = {
      playerId: actor,
      path: expectedPath,
      cursor: 0,
      total: expectedPath.length,
      collectGo: !["back", "jail"].includes(effect.type),
      direction: effect.type === "back" ? -1 : 1,
      resolution: effect.type === "jail" ? "jail" : "card",
      meta: expectedMeta
    };
    requireValue(same(movement, expectedMovement), "Invalid Monopoly card movement path");
    if (pending.id !== "c_util") requireValue(same(after.lastRoll, before.lastRoll), "This Monopoly card cannot change the dice");
    requireValue(after.bank.pot === before.bank.pot, "A Monopoly movement card cannot change the jackpot");
    assertStableStructure(before, after, ["phase", ...(pending.id === "c_util" ? ["lastRoll"] : []), "decks", "pendingCard", "pendingMove"]);
    assertNoUnrelatedLedger(diff);
    return;
  }
  if (effect.type === "payEach" || effect.type === "collectEach") {
    const expectedCash = Object.fromEntries(before.players.map((value) => [value.id, value.cash]));
    const others = before.players.filter((value) => !value.bankrupt && value.id !== actor);
    const cause = effect.type === "payEach" ? "Chairperson payment" : "Birthday gift";
    const items = others.map((other) => ({ debtorId: effect.type === "payEach" ? actor : other.id, creditorId: effect.type === "payEach" ? other.id : actor, amount: effect.amount, cause, potEligible: false }));
    let pendingDebt = null, remaining = [];
    for (let index = 0; index < items.length; index++) {
      const { debtorId, creditorId } = items[index];
      if (expectedCash[debtorId] >= effect.amount) {
        expectedCash[debtorId] -= effect.amount;
        expectedCash[creditorId] += effect.amount;
      } else {
        pendingDebt = { ...items[index], resume: "transfers" };
        remaining = items.slice(index + 1);
        break;
      }
    }
    for (const value of after.players) requireValue(value.cash === expectedCash[value.id], "Invalid Monopoly multi-player card transfer");
    if (pendingDebt) {
      requireValue(after.phase === "debt", "Invalid Monopoly multi-player card continuation");
      assertPendingDebt(after.pendingDebt, pendingDebt);
      requireValue(after.transfersResume === "finish", "Invalid Monopoly card-transfer continuation target");
    } else {
      requireValue(after.phase === "end" && (after.pendingDebt ?? null) === null && (after.transfersResume ?? null) === null, "Invalid Monopoly multi-player card completion");
    }
    requireValue(same(after.pendingTransfers || [], remaining), "Invalid Monopoly remaining card transfers");
    requireValue(after.bank.pot === before.bank.pot, "A Monopoly player-transfer card cannot change the jackpot");
    assertStableStructure(before, after, ["phase", "decks", "pendingDebt", "pendingCard", "pendingTransfers", "transfersResume"]);
    assertNoUnrelatedLedger(diff, { cash: diff.cash.map((change) => change.id) });
    return;
  }
  throw error("Unsupported Monopoly card effect");
}

function validateLanding(before, after, actor, destination, baseCash, rentSpecial = null, persistedSpecial = rentSpecial) {
  const next = player(after, actor);
  const property = PROPERTY[destination];
  const landingType = SPECIAL[destination];
  if (property) {
    const deed = before.deeds[destination];
    if (deed.owner === null) {
      requireValue(after.phase === "offer" && after.offerSpace === destination && next.cash === baseCash, "Invalid Monopoly unowned-property landing");
      assertLandingControls(before, after, { offerSpace: destination, landingSpecial: persistedSpecial });
    } else if (deed.owner === actor || deed.mortgaged) {
      requireValue(after.phase === "end" && next.cash === baseCash, "Invalid Monopoly owned-property landing");
      assertLandingControls(before, after);
    } else {
      const owner = player(before, deed.owner), rent = rentFor(before, destination, owner.id, rentSpecial);
      if (baseCash >= rent) {
        requireValue(after.phase === "end" && next.cash === baseCash - rent && player(after, owner.id).cash === owner.cash + rent, "Invalid Monopoly rent payment");
        assertLandingControls(before, after);
      } else {
        requireValue(after.phase === "debt" && next.cash === baseCash, "Invalid Monopoly rent debt");
        const pendingDebt = { debtorId: actor, creditorId: owner.id, amount: rent, cause: `${PROPERTY_NAME[destination]} rent`, resume: "finish", potEligible: false };
        assertPendingDebt(after.pendingDebt, pendingDebt);
        assertLandingControls(before, after, { pendingDebt, landingSpecial: persistedSpecial });
      }
    }
    requireValue(same(after.bank, before.bank) && same(after.decks, before.decks), "A Monopoly property landing cannot change the bank or card decks");
    return;
  }
  if (landingType === "chance" || landingType === "community") {
    const cardId = before.decks[landingType][0];
    const pendingCard = { deck: landingType, id: cardId };
    requireValue(after.phase === "cardDraw" && same(after.pendingCard, pendingCard) && next.cash === baseCash, "Invalid Monopoly card-space landing");
    requireValue(same(after.decks[landingType], before.decks[landingType].slice(1)), "Monopoly drew the wrong deck card");
    const other = landingType === "chance" ? "community" : "chance";
    requireValue(same(after.decks[other], before.decks[other]), "Monopoly draw changed the other deck");
    requireValue(same(after.bank, before.bank), "A Monopoly card draw cannot change the bank");
    assertLandingControls(before, after, { pendingCard, landingSpecial: persistedSpecial });
  } else if (landingType === "tax") {
    const amount = destination === 4 ? 200 : 100;
    if (baseCash >= amount) {
      requireValue(after.phase === "end" && next.cash === baseCash - amount, "Invalid Monopoly tax payment");
      const expectedPot = before.bank.pot + (before.settings.freeParking ? amount : 0);
      requireValue(after.bank.pot === expectedPot, "Invalid Monopoly tax pot");
      assertLandingControls(before, after);
    } else {
      requireValue(after.phase === "debt" && next.cash === baseCash, "Invalid Monopoly tax debt");
      const pendingDebt = { debtorId: actor, creditorId: null, amount, cause: destination === 4 ? "Income Tax" : "Luxury Tax", resume: "finish", potEligible: true };
      assertPendingDebt(after.pendingDebt, pendingDebt);
      requireValue(same(after.bank, before.bank), "An unpaid Monopoly tax cannot change the jackpot");
      assertLandingControls(before, after, { pendingDebt, landingSpecial: persistedSpecial });
    }
    requireValue(same(after.decks, before.decks), "A Monopoly tax cannot change card decks");
  } else if (landingType === "parking" && before.settings.freeParking) {
    requireValue(after.phase === "end" && next.cash === baseCash + before.bank.pot && after.bank.pot === 0, "Invalid Monopoly Free Parking award");
    requireValue(after.bank.houses === before.bank.houses && after.bank.hotels === before.bank.hotels && same(after.decks, before.decks), "Free Parking cannot change buildings or decks");
    assertLandingControls(before, after);
  } else if (landingType === "gojail") {
    requireValue(after.phase === "end" && next.pos === 10 && next.inJail && next.cash === baseCash && same(after.bank, before.bank) && same(after.decks, before.decks), "Invalid Monopoly Go To Jail landing");
    assertLandingControls(before, after);
  } else {
    requireValue(after.phase === "end" && next.cash === baseCash && same(after.bank, before.bank) && same(after.decks, before.decks), "Invalid Monopoly ordinary landing");
    assertLandingControls(before, after);
  }
}

function validateRollLanding(before, after, actor, d1, d2) {
  const prior = player(before, actor);
  if (d1 === d2 && before.doublesCount >= 2) return;
  const destination = (prior.pos + d1 + d2) % 40;
  const passedGo = prior.pos + d1 + d2 >= 40;
  validateLanding(before, after, actor, destination, prior.cash + (passedGo ? before.settings.goSalary : 0), { rollTotal: d1 + d2 }, null);
}

function validateCompletedMovement(before, after, actor) {
  const movement = before.pendingMove;
  requireValue(before.phase === "moving" && movement?.playerId === actor && movement.path.length > 0, "No Monopoly movement is ready to complete");
  const prior = player(before, actor), destination = movement.path[movement.path.length - 1];
  requireValue(player(after, actor).pos === destination && after.pendingMove === null, "Monopoly movement did not follow its canonical path");
  let cash = prior.cash, previous = prior.pos;
  if (movement.collectGo && movement.direction > 0) for (const position of movement.path.slice(movement.cursor)) {
    if (position < previous) cash += before.settings.goSalary;
    previous = position;
  }
  if (movement.resolution === "jail") {
    requireValue(destination === 10 && player(after, actor).inJail && player(after, actor).jailTurns === 0 && after.phase === "end" && player(after, actor).cash === cash, "Invalid Monopoly direct-Jail movement");
    requireValue(after.doublesCount === 0 && !after.extraRoll, "Direct Jail movement must clear the Monopoly doubles turn");
    requireValue(same(after.bank, before.bank) && same(after.decks, before.decks), "Direct Jail movement cannot change the Monopoly bank or decks");
    assertLandingControls(before, after);
    return;
  }
  validateLanding(before, after, actor, destination, cash, movement.meta?.special || null);
}

function validateResolution(before, after, member, intent, diff) {
  // Random rolls/cards are client-proposed, but their range and all resulting
  // economic mutations remain bounded to the actor and a real creditor.
  const actor = member.seat;
  const cashIds = diff.cash.map((change) => change.id);
  const allowedCash = new Set([actor]);
  const debtCreditor = before.pendingDebt?.creditorId;
  if (Number.isInteger(debtCreditor)) allowedCash.add(debtCreditor);
  if (intent.kind === "roll") {
    const prior = player(before, actor), destination = prior && integer(intent.d1, 1, 6) && integer(intent.d2, 1, 6) ? (prior.pos + intent.d1 + intent.d2) % 40 : null;
    const owner = before.deeds?.[destination]?.owner;
    if (Number.isInteger(owner)) allowedCash.add(owner);
  }
  if (intent.kind === "complete-move") {
    const destination = before.pendingMove?.path?.at(-1), owner = before.deeds?.[destination]?.owner;
    if (Number.isInteger(owner)) allowedCash.add(owner);
  }
  for (const change of diff.cash) requireValue(allowedCash.has(change.id), "A Monopoly resolution changed an unrelated player's cash");
  requireValue(diff.owner.length === 0 && diff.buildings.length === 0 && diff.mortgage.length === 0 && diff.bankrupt.length === 0, "A Monopoly roll/card cannot fabricate deeds, buildings, mortgages, or bankruptcy");
  requireValue(diff.position.every((change) => change.id === actor), "A Monopoly resolution moved another player");
  requireValue(diff.jail.every((change) => change.id === actor) && diff.cards.every((change) => change.id === actor), "A Monopoly resolution changed another player's personal state");
  if (intent.kind === "roll") {
    requireValue(before.phase === "roll" || (before.phase === "end" && before.extraRoll), "Monopoly cannot roll in this phase");
    requireValue(integer(intent.d1, 1, 6) && integer(intent.d2, 1, 6), "Invalid Monopoly dice intent");
    requireValue(after.lastRoll[0] === intent.d1 && after.lastRoll[1] === intent.d2, "Monopoly dice do not match the declared roll");
    const priorActor = player(before, actor);
    if (!priorActor.inJail) {
      const tripleDoubles = intent.d1 === intent.d2 && before.doublesCount >= 2;
      const rolledPosition = (priorActor.pos + intent.d1 + intent.d2) % 40;
      const sentToJail = tripleDoubles || rolledPosition === 30;
      const expectedPosition = sentToJail ? 10 : rolledPosition;
      requireValue(player(after, actor).pos === expectedPosition, "Monopoly roll did not move to its dice destination");
      requireValue(!sentToJail || player(after, actor).inJail, "Monopoly Jail landing did not jail its player");
      requireValue(after.doublesCount === (sentToJail || intent.d1 !== intent.d2 ? 0 : before.doublesCount + 1), "Invalid Monopoly doubles counter");
      requireValue(after.extraRoll === (!sentToJail && intent.d1 === intent.d2), "Invalid Monopoly extra-roll award");
      if (tripleDoubles) {
        requireValue(after.phase === "end" && player(after, actor).cash === priorActor.cash && same(after.bank, before.bank) && same(after.decks, before.decks), "Invalid three-doubles Jail resolution");
        assertLandingControls(before, after);
        assertStableStructure(before, after, ["phase", "doublesCount", "extraRoll", "lastRoll"]);
      }
    } else if (intent.d1 === intent.d2) {
      const destination = (priorActor.pos + intent.d1 + intent.d2) % 40;
      requireValue(player(after, actor).pos === destination && !player(after, actor).inJail, "Monopoly Jail doubles did not move correctly");
      requireValue(after.doublesCount === 0 && !after.extraRoll, "Jail doubles cannot grant another Monopoly roll");
      validateLanding(before, after, actor, destination, priorActor.cash, { rollTotal: intent.d1 + intent.d2 }, null);
    } else {
      requireValue(player(after, actor).pos === priorActor.pos, "A failed Monopoly Jail roll cannot move the player");
      requireValue(player(after, actor).jailTurns === Math.min(3, priorActor.jailTurns + 1), "Invalid Monopoly Jail roll counter");
      requireValue(after.doublesCount === 0 && !after.extraRoll, "A failed Monopoly Jail roll cannot grant an extra roll");
      const forced = before.settings.quickJail || priorActor.jailTurns + 1 >= 3;
      if (!forced) {
        requireValue(after.phase === "end" && player(after, actor).cash === priorActor.cash && player(after, actor).inJail, "Invalid failed Monopoly Jail roll");
        assertStableStructure(before, after, ["phase", "doublesCount", "extraRoll", "lastRoll"]);
      }
      else if (priorActor.cash >= 50) {
        const total = intent.d1 + intent.d2, destination = (priorActor.pos + total) % 40;
        const expectedPot = before.bank.pot + (before.settings.freeParking ? 50 : 0);
        requireValue(!player(after, actor).inJail && player(after, actor).jailTurns === 0, "Invalid forced Monopoly Jail release");
        requireValue(after.bank.pot === expectedPot && after.bank.houses === before.bank.houses && after.bank.hotels === before.bank.hotels, "Invalid forced Monopoly Jail-fine pot");
        if (after.phase === "moving") {
          const expectedMove = { playerId: actor, path: pathBy(priorActor.pos, total), cursor: 0, total, collectGo: true, direction: 1, resolution: "jailForced", meta: {} };
          requireValue(player(after, actor).cash === priorActor.cash - 50 && same(after.pendingMove, expectedMove) && after.pendingJailMove === null, "Invalid forced Monopoly Jail movement");
          requireValue(same(after.decks, before.decks), "A forced Monopoly Jail move cannot change card decks");
          assertStableStructure(before, after, ["phase", "doublesCount", "extraRoll", "lastRoll", "bank", "pendingMove", "pendingJailMove"]);
        } else {
          const landingBefore = clone(before);
          landingBefore.bank.pot = expectedPot;
          landingBefore.pendingJailMove = null;
          requireValue(player(after, actor).pos === destination, "Forced Monopoly Jail movement ended on the wrong space");
          validateLanding(landingBefore, after, actor, destination, priorActor.cash - 50, { rollTotal: total }, null);
        }
      } else {
        requireValue(after.phase === "debt" && player(after, actor).inJail && player(after, actor).cash === priorActor.cash, "Invalid forced Monopoly Jail debt");
        const actual = after.pendingDebt;
        const base = { debtorId: actor, creditorId: null, amount: 50, cause: "Jail fine", potEligible: true };
        requireValue(same(actual, { ...base, resume: "jailForcedMove" }) || same(actual, { ...base, resume: "jailForcedMoveInstant" }), "Monopoly pending debt does not match its legal cause");
        requireValue(after.pendingJailMove === intent.d1 + intent.d2 && same(after.bank, before.bank) && same(after.decks, before.decks), "Invalid forced Monopoly Jail debt continuation");
        assertStableStructure(before, after, ["phase", "doublesCount", "extraRoll", "lastRoll", "pendingDebt", "pendingJailMove"]);
      }
    }
    if (!priorActor.inJail) validateRollLanding(before, after, actor, intent.d1, intent.d2);
    if (!priorActor.inJail && !(intent.d1 === intent.d2 && before.doublesCount >= 2)) {
      assertStableStructure(before, after, ["phase", "doublesCount", "extraRoll", "lastRoll", "bank", "decks", "pendingDebt", "pendingCard", "pendingMove", "offerSpace", "landingSpecial"]);
    }
  } else if (intent.kind === "complete-move") {
    validateCompletedMovement(before, after, actor);
    assertStableStructure(before, after, ["phase", ...(before.pendingMove?.resolution === "jail" ? ["doublesCount", "extraRoll"] : []), "bank", "decks", "pendingDebt", "pendingCard", "pendingMove", "offerSpace", "landingSpecial", "pendingJailMove"]);
  } else if (intent.kind === "resolve-card") {
    requireValue(before.phase === "cardDraw" && object(before.pendingCard), "No Monopoly card is ready to resolve");
  } else if (intent.kind === "pay-jail") {
    const prior = player(before, actor), next = player(after, actor);
    requireValue(before.phase === "roll" && prior.inJail, "This Monopoly player cannot pay to leave Jail");
    if (prior.cash >= 50) {
      requireValue(next.cash === prior.cash - 50 && !next.inJail && next.jailTurns === 0 && after.phase === "roll", "Invalid Monopoly Jail payment");
      requireValue(after.bank.pot === before.bank.pot + (before.settings.freeParking ? 50 : 0), "Invalid Monopoly Jail-fine pot");
      requireValue((after.pendingDebt ?? null) === null, "Paid Monopoly Jail fine created a debt");
      assertStableStructure(before, after, ["bank"]);
    } else {
      requireValue(next.cash === prior.cash && next.inJail && after.phase === "debt", "Invalid Monopoly Jail debt");
      assertPendingDebt(after.pendingDebt, { debtorId: actor, creditorId: null, amount: 50, cause: "Jail fine", resume: "jailPaid", potEligible: true });
      requireValue(same(after.bank, before.bank), "Unpaid Monopoly Jail fine changed the bank");
      assertStableStructure(before, after, ["phase", "pendingDebt"]);
    }
  } else if (intent.kind === "use-jail-card") {
    const prior = player(before, actor), next = player(after, actor), deck = intent.deck;
    requireValue(before.phase === "roll" && prior.inJail && ["chance", "community"].includes(deck) && prior.getOut[deck] > 0, "This Monopoly player has no declared Jail card to use");
    requireValue(!next.inJail && next.jailTurns === 0 && after.phase === "roll" && next.getOut[deck] === prior.getOut[deck] - 1, "A Monopoly Jail card must release its player");
    const jailCard = deck === "chance" ? "c_jailcard" : "m_jailcard";
    requireValue(same(after.decks[deck], [...before.decks[deck], jailCard]), "Used Monopoly Jail card returned to the wrong deck");
    const other = deck === "chance" ? "community" : "chance";
    requireValue(same(after.decks[other], before.decks[other]), "Used Monopoly Jail card changed the other deck");
    assertStableStructure(before, after, ["phase", "decks"]);
  }
  const totalBefore = before.players.reduce((sum, value) => sum + value.cash, 0) + before.bank.pot;
  const totalAfter = after.players.reduce((sum, value) => sum + value.cash, 0) + after.bank.pot;
  const gain = totalAfter - totalBefore;
  const maxBankAward = before.settings.goSalary + 200;
  requireValue(gain >= -1000 && gain <= maxBankAward, "Monopoly cash changed without a legal-sized bank event");
  assertNoUnrelatedLedger(diff, { cash: cashIds, position: diff.position.map((change) => change.id), jail: diff.jail.map((change) => change.id), cards: diff.cards.map((change) => change.id) });
}

function validateCompletion(after, action) {
  requireValue((action.finish === true) === after.gameOver, after.gameOver ? "Completed Monopoly must finish its room" : "Monopoly has not completed");
  if (!after.gameOver) {
    requireValue(!Object.hasOwn(action, "result"), "Monopoly result supplied before completion");
    return;
  }
  const alive = after.players.filter((value) => !value.bankrupt).length;
  const legalEnd = alive <= 1 || (after.settings.firstBankruptcy && after.players.some((value) => value.bankrupt)) || (after.settings.turnLimit > 0 && after.turnCount >= after.settings.turnLimit);
  requireValue(legalEnd, "Monopoly cannot finish before a configured end condition");
  const ranked = after.players.slice().sort((left, right) => monopolyWorth(after, right) - monopolyWorth(after, left));
  requireValue(object(action.result) && action.result.winnerSeat === ranked[0]?.id && action.result.reason === (after.endReason || "Game over"), "Invalid Monopoly winner");
}

export function monopolyWorth(state, value) {
  if (!value || value.bankrupt) return 0;
  let worth = value.cash;
  for (const id of PROPERTY_IDS) {
    const deed = state.deeds[id], space = PROPERTY[id];
    if (deed.owner !== value.id) continue;
    worth += deed.mortgaged ? space.mortgage : space.price;
    if (space.type === "street" && deed.houses) worth += space.build * equivalent(state, deed.houses);
  }
  return Math.round(worth);
}

export function canonicalizeMonopolyStartRandomness(snapshot, randomIndex) {
  requireValue(object(snapshot) && object(snapshot.settings) && Array.isArray(snapshot.players) && object(snapshot.deeds), "Invalid Monopoly start snapshot");
  requireValue(typeof randomIndex === "function", "Invalid Monopoly start randomizer", 500);
  const shuffled = (source) => {
    const values = [...source];
    for (let index = values.length - 1; index > 0; index--) {
      const selected = randomIndex(index + 1);
      requireValue(integer(selected, 0, index), "Invalid Monopoly host randomness", 500);
      [values[index], values[selected]] = [values[selected], values[index]];
    }
    return values;
  };
  snapshot.decks = { chance: shuffled(CHANCE_IDS), community: shuffled(COMMUNITY_IDS) };
  for (const value of snapshot.players || []) value.cash = snapshot.settings.startingCash;
  for (const id of PROPERTY_IDS) snapshot.deeds[id] = { owner: null, mortgaged: false, houses: 0 };
  const dealt = [];
  if (snapshot.settings.startingDeeds > 0) {
    const pool = shuffled(PROPERTY_IDS);
    for (let round = 0; round < snapshot.settings.startingDeeds; round++) {
      for (const value of snapshot.players) {
        const index = pool.findIndex((id) => PROPERTY[id].price <= value.cash);
        if (index < 0) break;
        const [id] = pool.splice(index, 1);
        snapshot.deeds[id].owner = value.id;
        value.cash -= PROPERTY[id].price;
        dealt.push({ playerId: value.id, spaceId: id });
      }
    }
  }
  return { snapshot, dealt };
}

export function validateMonopolyStart(room, action) {
  const state = assertState(action.state, room);
  const members = activeMembers(room);
  requireValue(state.turnIndex === 0 && state.phase === "roll" && state.turnCount === 0 && state.round === 1 && !state.gameOver, "Invalid initial Monopoly table");
  requireValue(Number(action.firstSeat ?? members[0].seat) === members[0].seat, "Monopoly must start with the first occupied seat");
  requireValue(state.settings.handoff === false, "Online Monopoly cannot enable same-device handoff");
  if (state.mode === "standard") requireValue(state.settings.startingCash === 1500 && state.settings.goSalary === 200 && state.settings.startingDeeds === 0 && !state.settings.firstBankruptcy && state.settings.turnLimit === 0 && !state.settings.freeParking && !state.settings.quickHotels && !state.settings.quickJail, "Invalid Standard Monopoly settings");
  if (state.mode === "quick") requireValue(state.settings.startingCash === 1500 && state.settings.goSalary === 200 && state.settings.startingDeeds === 2 && state.settings.firstBankruptcy && state.settings.turnLimit === 0 && !state.settings.freeParking && state.settings.quickHotels && state.settings.quickJail, "Invalid Quick Monopoly settings");
  const expectedDeeds = state.settings.startingDeeds * state.players.length;
  const owned = PROPERTY_IDS.filter((id) => state.deeds[id].owner !== null);
  requireValue(owned.length === expectedDeeds, "Invalid initial Monopoly deed deal");
  for (const value of state.players) {
    const their = owned.filter((id) => state.deeds[id].owner === value.id);
    requireValue(their.length === state.settings.startingDeeds, "Initial Monopoly deeds must be distributed evenly");
    const expectedCash = state.settings.startingCash - their.reduce((sum, id) => sum + PROPERTY[id].price, 0);
    requireValue(value.cash === expectedCash && value.pos === 0 && !value.inJail && !value.bankrupt && value.getOut.chance === 0 && value.getOut.community === 0, "Invalid initial Monopoly player ledger");
  }
  return MONOPOLY_AUTHORITY;
}

export function validateMonopolyTransition(room, member, action) {
  const before = assertState(room.state, room);
  const after = assertState(action.state, room);
  immutableGame(before, after);
  requireValue(room.turn?.seat === member.seat && monopolyActorSeat(before) === member.seat, "Monopoly actor does not own this decision");
  requireValue(object(action.intent) && action.intent.version === 1 && INTENTS.has(action.intent.kind), "Monopoly action needs a supported intent");
  requireValue(Object.keys(action.intent).every((key) => INTENT_FIELDS.has(key)), "Monopoly intent contains an unsupported field");
  requireValue(after.turnCount >= before.turnCount && after.turnCount <= before.turnCount + 1 && after.round >= before.round && after.round <= before.round + 1, "Monopoly turn counters changed impossibly");
  const diff = ledgerDiff(before, after);
  const kind = action.intent.kind;

  if (before.pendingMortgageChoices?.length) {
    const raisingMortgageInterest = before.phase === "debt" && before.pendingDebt?.resume === "mortgageChoices";
    const allowed = raisingMortgageInterest
      ? new Set(["sell", "sell-group", "mortgage", "pay-debt", "declare-bankruptcy"])
      : new Set(["mortgage-choice"]);
    requireValue(allowed.has(kind), raisingMortgageInterest ? "Resolve or raise cash for the transferred-mortgage debt first" : "Resolve the transferred-mortgage choice first");
  }

  if (!["end-turn", "declare-bankruptcy", "pay-debt", "mortgage-choice", "auction-bid", "auction-pass"].includes(kind)) {
    requireValue(after.turnIndex === before.turnIndex && after.turnCount === before.turnCount && after.round === before.round, "Monopoly turn or round changed outside an end-turn action");
  }

  if (kind === "build") validateBuild(before, after, member, action.intent, diff);
  else if (kind === "sell") validateSell(before, after, member, action.intent, diff);
  else if (kind === "sell-group") validateSellGroup(before, after, member, action.intent, diff);
  else if (kind === "mortgage") validateMortgage(before, after, member, action.intent, diff, false);
  else if (kind === "unmortgage") validateMortgage(before, after, member, action.intent, diff, true);
  else if (kind === "buy") validateBuy(before, after, member, action.intent, diff);
  else if (kind === "trade-propose") validateTradeProposal(before, after, member, action.intent, diff);
  else if (kind === "trade-accept") validateTradeDecision(before, after, member, action.intent, diff, true);
  else if (kind === "trade-decline") validateTradeDecision(before, after, member, action.intent, diff, false);
  else if (kind === "start-auction") validateStartAuction(before, after, member, action.intent, diff);
  else if (kind === "auction-bid") validateAuctionDecision(before, after, member, action.intent, diff, true);
  else if (kind === "auction-pass") validateAuctionDecision(before, after, member, action.intent, diff, false);
  else if (kind === "end-turn") validateEndTurn(before, after, member, diff);
  else if (kind === "declare-bankruptcy") validateBankruptcy(before, after, member, diff);
  else if (kind === "pay-debt") validatePayDebt(before, after, member, action.intent, diff);
  else if (kind === "mortgage-choice") validateMortgageChoice(before, after, member, action.intent, diff);
  else if (kind === "resolve-card") validateCardResolution(before, after, member, action.intent, diff);
  else if (["roll", "complete-move", "pay-jail", "use-jail-card"].includes(kind)) validateResolution(before, after, member, action.intent, diff);
  else throw error("Unsupported Monopoly action intent", 400);

  validateCompletion(after, action);
  const nextActor = after.gameOver ? null : monopolyActorSeat(after);
  if (!after.gameOver) requireValue(Number(action.nextSeat) === nextActor && activeMembers(room).some((value) => value.seat === nextActor), "Invalid Monopoly next decision owner");
  return MONOPOLY_AUTHORITY;
}

export const __test = Object.freeze({ PROPERTY, PROPERTY_IDS, GROUPS, ledgerDiff, monopolyActorSeat, liquidationCapacity });
