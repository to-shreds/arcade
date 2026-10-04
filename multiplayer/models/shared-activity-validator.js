// Shared activities intentionally have one controller. The authority protects
// membership, control ownership, activity identity and transport bounds. Game
// checkpoints are controller-authored, so these rooms never award Arcade Stars.
export const SHARED_ACTIVITY_AUTHORITY = Object.freeze({
  id: "shared-activity-controller-v1", ruleValidated: false,
  completionVerified: false, scope: "one shared controller and bounded checkpoints"
});
export const SHARED_ACTIVITY_IDS = Object.freeze([
  "make-10", "balloons", "blackjack", "time", "hangman", "solitaire",
  "insultinator", "build-my-joke", "jigsaw", "codebreaking", "math", "spelling",
  "maze", "minesweeper", "mini-golf", "orb-slicer", "two-truths", "paint-lab",
  "patterns", "bounce-boxes", "shuffleboard", "simon", "regex-lab", "trail",
  "trivia", "typing", "contraption-maker", "mad-libs", "silly-face-lab",
  "music-maker", "bowling", "firefighter-frenzy", "bug-squish", "monster-dentist"
]);
function requireValue(condition, message) {
  if (!condition) throw Object.assign(new Error(message), { status: 422 });
}
export function validateSharedCheckpoint(value, previous = null) {
  requireValue(value && typeof value === "object" && !Array.isArray(value), "Shared activity requires a checkpoint");
  requireValue(Object.keys(value).every(key => ["schema", "activity", "codec", "data", "decodedBytes", "sequence"].includes(key)), "Unsupported shared checkpoint fields");
  requireValue(value.schema === 1 && SHARED_ACTIVITY_IDS.includes(value.activity), "Unsupported shared activity");
  requireValue(!previous || value.activity === previous.activity, "Shared activity cannot change inside a room");
  requireValue(["json", "gzip"].includes(value.codec) && typeof value.data === "string" && value.data.length <= 52 * 1024, "Shared checkpoint exceeds the transport limit");
  requireValue(Number.isSafeInteger(value.decodedBytes) && value.decodedBytes >= 0 && value.decodedBytes <= 8 * 1024 * 1024, "Invalid shared checkpoint decoded size");
  requireValue(Number.isSafeInteger(value.sequence) && value.sequence >= 0, "Invalid shared checkpoint sequence");
  if (value.codec === "gzip") requireValue(/^[A-Za-z0-9+/]*={0,2}$/.test(value.data), "Invalid compressed checkpoint");
  return value;
}
export function validateSharedActivityAction(room, member, action) {
  requireValue(room && member && action, "Invalid shared activity action");
  if (["start", "state", "restart"].includes(action.type)) {
    validateSharedCheckpoint(action.state, room.state);
    requireValue(action.finish !== true && !Object.hasOwn(action, "result"), "Shared activities use explicit control passing, not competitive results");
    if (action.type === "state") {
      requireValue(room.turn?.playerId === member.playerId, "Only the current controller can publish a checkpoint");
      requireValue(action.state.sequence >= (room.state?.sequence || 0), "Shared checkpoint sequence cannot move backward");
    }
  }
  return SHARED_ACTIVITY_AUTHORITY;
}
