import { createGame, applyAction, validateGame, publicGame } from '../../upwords/engine.js';
import { DICTIONARY_ID } from '../../upwords/dictionary.js';

export const UPWORDS_AUTHORITY = Object.freeze({
  id: 'upwords-authority-v1', ruleValidated: true, completionVerified: true,
  scope: 'private racks and tile bag, fixed dictionary, legal placements and stacks, scoring, turns, and mutual rematches'
});
const ACTION_FIELDS = Object.freeze({ start: [], play: ['placements'], pass: [], exchange: ['rackIndex'], rematch: [] });
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const requireValue = (condition, status, message) => { if (!condition) fail(status, message); };
const playersIn = room => room.members.filter(player => !player.leftAt).sort((a, b) => a.seat - b.seat);

export function createUpwordsState() {
  return { schema: 1, phase: 'lobby', round: 0, starterSeat: 0, dictionaryId: DICTIONARY_ID, game: null, rematchVotes: [] };
}

// Validate intentions before either transport accepts them. A client never
// supplies a bag, rack, seed, score, word approval, or finished-game snapshot.
export function validateUpwordsAction(room, member, action) {
  requireValue(action && typeof action === 'object' && !Array.isArray(action), 400, 'Action must be an object');
  if (action.type === 'rename') fail(403, 'Names are locked after joining Upwords');
  requireValue(typeof action.type === 'string' && Object.hasOwn(ACTION_FIELDS, action.type), 400, 'Unsupported Upwords action');
  const allowed = new Set(['type', 'expectedVersion', 'dictionaryId', ...ACTION_FIELDS[action.type]]);
  requireValue(Object.keys(action).every(key => allowed.has(key)), 400, 'Unsupported Upwords action fields');
  requireValue(typeof action.expectedVersion === 'number' && Number.isInteger(action.expectedVersion) && action.expectedVersion === room.version, 409, 'Room state changed; refresh and try again');
  requireValue(action.dictionaryId === DICTIONARY_ID && room.state.dictionaryId === DICTIONARY_ID, 409, 'This room uses a different word list. Update Arcade before playing');
  const players = playersIn(room);
  requireValue(players.some(player => player.playerId === member?.playerId && player.seat === member.seat), 401, 'Invalid room player');
  requireValue(players.length === 2 && players[0].seat === 0 && players[1].seat === 1, 409, 'Upwords needs two players');
  if (action.type === 'start') {
    requireValue(member.playerId === room.hostPlayerId, 403, 'Only the room host can start the game');
    requireValue(room.status === 'lobby', 409, 'The game has already started');
    return UPWORDS_AUTHORITY;
  }
  if (action.type === 'rematch') {
    requireValue(room.status === 'finished' && room.result?.type === 'upwords', 409, 'Finish this round before a rematch');
    requireValue(!room.state.rematchVotes.includes(member.playerId), 409, 'Your rematch request is already recorded');
    return UPWORDS_AUTHORITY;
  }
  requireValue(room.status === 'active' && room.state.phase === 'playing' && room.state.game && !room.state.game.finished, 409, 'The round is not active');
  requireValue(room.turn?.playerId === member.playerId && room.state.game.turn === member.seat, 403, 'It is not your turn');
  if (action.type === 'play') {
    requireValue(Array.isArray(action.placements) && action.placements.length >= 1 && action.placements.length <= 7, 400, 'Play between one and seven tiles');
    for (const placement of action.placements) {
      requireValue(placement && typeof placement === 'object' && !Array.isArray(placement) && Object.keys(placement).length === 3 && Object.keys(placement).every(key => ['row', 'col', 'rackIndex'].includes(key)), 400, 'A tile placement needs a row, column, and rack index');
      requireValue(Number.isInteger(placement.row) && placement.row >= 0 && placement.row < 10 && Number.isInteger(placement.col) && placement.col >= 0 && placement.col < 10 && Number.isInteger(placement.rackIndex) && placement.rackIndex >= 0 && placement.rackIndex < 7, 400, 'Choose a board square and a tile from your rack');
    }
  } else if (action.type === 'exchange') {
    requireValue(Number.isInteger(action.rackIndex) && action.rackIndex >= 0 && action.rackIndex < 7, 400, 'Choose one tile from your rack to exchange');
  }
  return UPWORDS_AUTHORITY;
}

function beginRound(room, players, rematch) {
  const random = crypto.getRandomValues(new Uint32Array(2));
  const starterSeat = rematch ? 1 - room.state.starterSeat : random[1] & 1;
  const game = createGame({ seed: random[0], names: players.map(player => player.username), starter: starterSeat });
  validateGame(game);
  room.state = { ...createUpwordsState(), phase: 'playing', round: room.state.round + 1, starterSeat, game };
  room.status = 'active';
  room.result = null;
  room.turn = { playerId: players[starterSeat].playerId, seat: starterSeat, number: 1 };
}

// Synchronous resolution preserves the Durable Object input gate throughout a
// move. Both Internet and Nearby call this same immutable rules engine.
export function applyUpwordsAction(room, member, action) {
  validateUpwordsAction(room, member, action);
  const players = playersIn(room), state = room.state;
  if (action.type === 'start') { beginRound(room, players, false); return; }
  if (action.type === 'rematch') {
    state.rematchVotes.push(member.playerId);
    if (state.rematchVotes.length === 2) beginRound(room, players, true);
    return;
  }
  const intent = action.type === 'play' ? { type: 'play', placements: action.placements }
    : action.type === 'exchange' ? { type: 'exchange', rackIndex: action.rackIndex } : { type: 'pass' };
  let game;
  try { game = applyAction(state.game, intent, member.seat); validateGame(game); }
  catch (error) { fail(400, error.message || 'Illegal Upwords move'); }
  state.game = game;
  if (game.finished) {
    state.phase = 'finished';
    room.status = 'finished';
    room.turn = null;
    room.result = { type: 'upwords', reason: game.endReason, scores: game.players.map(player => player.score),
      winnerSeat: game.winner, winnerPlayerId: game.winner === null ? null : players[game.winner].playerId };
  } else {
    room.turn = { playerId: players[game.turn].playerId, seat: game.turn, number: room.turn.number + 1 };
  }
}

// The full bag and both racks exist only in authority storage/checkpoints.
// Every HTTP response and socket broadcast uses this per-viewer projection.
export function publicUpwordsState(room, viewerPlayerId = null) {
  const state = room.state;
  const viewer = playersIn(room).find(player => player.playerId === viewerPlayerId);
  return { schema: 1, phase: room.status === 'finished' ? 'finished' : state.phase,
    round: state.round, starterSeat: state.starterSeat, dictionaryId: state.dictionaryId,
    game: state.game ? publicGame(state.game, viewer?.seat ?? null) : null,
    rematchVotes: [...state.rematchVotes] };
}

export function validateUpwordsRoomCheckpoint(room) {
  const state = room.state;
  requireValue(state && state.schema === 1 && ['lobby', 'playing', 'finished'].includes(state.phase), 400, 'Invalid Upwords checkpoint');
  requireValue(state.dictionaryId === DICTIONARY_ID, 400, 'This saved Upwords room uses an incompatible word list');
  requireValue(Number.isInteger(state.round) && state.round >= 0 && state.round <= 1000000 && [0, 1].includes(state.starterSeat), 400, 'Invalid Upwords round');
  requireValue(Array.isArray(room.members) && Array.isArray(state.rematchVotes) && state.rematchVotes.length <= 2 && new Set(state.rematchVotes).size === state.rematchVotes.length && state.rematchVotes.every(id => room.members.some(player => player.playerId === id)), 400, 'Invalid Upwords rematch votes');
  if (room.status === 'lobby') {
    requireValue(state.phase === 'lobby' && state.round === 0 && state.game === null && room.turn === null && room.result === null && state.rematchVotes.length === 0, 400, 'Invalid Upwords lobby');
    return;
  }
  if (room.status === 'finished' && room.result?.type === 'abandoned' && state.game === null) {
    requireValue(state.round === 0 && room.turn === null, 400, 'Invalid abandoned Upwords lobby');
    return;
  }
  let game;
  try { game = validateGame(state.game); } catch { fail(400, 'Invalid saved Upwords game'); }
  requireValue(state.round >= 1 && game.starter === state.starterSeat && game.dictionaryId === state.dictionaryId, 400, 'Upwords checkpoint settings do not match its game');
  requireValue([0, 1].every(seat => room.members.some(player => player.seat === seat && player.username === game.players[seat].name)), 400, 'Upwords checkpoint player identities do not match');
  if (room.status === 'active') {
    const players = playersIn(room), current = players.find(player => player.seat === game.turn);
    requireValue(players.length === 2 && players[0].seat === 0 && players[1].seat === 1 && state.phase === 'playing' && !game.finished && current && room.turn?.seat === game.turn && room.turn?.playerId === current.playerId && room.turn?.number === game.moveNumber + 1 && room.result === null && state.rematchVotes.length === 0, 400, 'Invalid saved Upwords turn');
  } else {
    requireValue(room.status === 'finished' && room.turn === null, 400, 'Invalid saved Upwords lifecycle');
    if (room.result?.type === 'upwords') {
      const scores = game.players.map(player => player.score);
      requireValue(state.phase === 'finished' && game.finished && room.result.reason === game.endReason && JSON.stringify(room.result.scores) === JSON.stringify(scores) && room.result.winnerSeat === game.winner && (game.winner === null ? room.result.winnerPlayerId === null : room.members.some(player => player.seat === game.winner && player.playerId === room.result.winnerPlayerId)), 400, 'Invalid saved Upwords result');
    } else requireValue(room.result?.type === 'abandoned', 400, 'Invalid saved Upwords result');
  }
}
