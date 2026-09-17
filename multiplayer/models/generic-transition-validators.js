import * as resolved from "./resolved-transition-validators.js";

// Keep the existing completed-turn rules unchanged. Memory additionally shares
// each face-up card before its completed attempt reaches those rules.
const MEMORY_AUTHORITY = Object.freeze({
  ...resolved.GENERIC_GAME_AUTHORITY.memory,
  scope: "individual card reveals and one resolved reveal group"
});
export const GENERIC_GAME_AUTHORITY = Object.freeze({
  ...resolved.GENERIC_GAME_AUTHORITY,
  memory: MEMORY_AUTHORITY
});
export function authorityForGenericGame(game) {
  return GENERIC_GAME_AUTHORITY[game] || null;
}
function requireValue(condition, message) {
  if (!condition) {
    const error = new Error(message);
    error.status = 422;
    throw error;
  }
}
function same(left, right) { return JSON.stringify(left) === JSON.stringify(right); }
function hiddenSnapshot(state) { return { ...state, revealed: [], lock: false }; }
function memoryInfo(state) {
  const info = resolved.__test.memoryInfo(hiddenSnapshot(state));
  requireValue(Array.isArray(state.revealed) && state.revealed.length <= info.matchSize && state.lock === (state.revealed.length === info.matchSize), "Invalid Memory online snapshot boundary");
  requireValue(new Set(state.revealed).size === state.revealed.length && state.revealed.every((index) => Number.isInteger(index) && index >= 0 && index < state.deck.length && !info.matched.has(state.deck[index].key)), "Invalid Memory revealed cards");
  return info;
}
function validateMemoryReveal(room, member, action) {
  const before = room.state, after = action.state;
  const info = memoryInfo(before);
  memoryInfo(after);
  const actor = before.seatOrder.indexOf(member.seat) + 1;
  const members = room.members.filter((item) => !item.leftAt).sort((a, b) => a.seat - b.seat);
  requireValue(actor > 0 && before.turn === actor && room.turn?.seat === member.seat, "Memory actor does not own this turn");
  requireValue(same(before.names, members.map((item) => item.username)) && same(after.names, before.names), "Memory names must come from locked room identities");
  if (after.revealed.length) {
    requireValue(before.revealed.length < info.matchSize && after.revealed.length === before.revealed.length + 1 && same(after.revealed.slice(0, -1), before.revealed), "A Memory reveal must add exactly one card");
    requireValue(after.turn === actor && Number(action.nextSeat) === member.seat, "A Memory reveal keeps the turn");
    // Only the visible cards, derived lock, elapsed clock and audio setting may
    // differ. A reveal cannot modify the deck, identities, scores or statistics.
    const a = hiddenSnapshot(before), b = hiddenSnapshot(after);
    b.tElapsed = a.tElapsed;
    b.sound = a.sound;
    requireValue(Object.keys(a).length === Object.keys(b).length && Object.keys(a).every((key) => Object.hasOwn(b, key) && same(a[key], b[key])), "A Memory reveal cannot change scores or completed attempts");
    requireValue(action.finish !== true && !Object.hasOwn(action, "result"), "Memory result supplied before completion");
    return MEMORY_AUTHORITY;
  }
  if (before.revealed.length) {
    requireValue(before.revealed.length === info.matchSize, "Finish revealing the Memory group before resolving it");
    const keys = before.revealed.map((index) => before.deck[index].key);
    if (keys.every((key) => key === keys[0])) {
      requireValue(after.matchedKeys.includes(keys[0]), "Resolve the revealed Memory match");
    } else {
      requireValue(same(after.matchedKeys, before.matchedKeys), "The revealed Memory cards do not match");
      const key = keys.slice().sort().join("|");
      requireValue(after.stats[actor - 1].mismatchPairCounts[key] === (before.stats[actor - 1].mismatchPairCounts[key] || 0) + 1, "Record the revealed Memory mismatch");
    }
  }
  resolved.validateGenericGameAction(
    { ...room, state: hiddenSnapshot(before) }, member,
    { ...action, state: hiddenSnapshot(after) }
  );
  return MEMORY_AUTHORITY;
}
export function validateGenericGameAction(room, member, action) {
  if (room?.game === "memory" && member && action?.type === "state") {
    return validateMemoryReveal(room, member, action);
  }
  const authority = resolved.validateGenericGameAction(room, member, action);
  return room.game === "memory" ? MEMORY_AUTHORITY : authority;
}
export const __test = Object.freeze({ ...resolved.__test, memoryInfo });
