import { createGame, applyAction, validateGame } from '../../tanks/engine.js';

export const TANKS_AUTHORITY = Object.freeze({
  id: 'tanks-authority-v1', ruleValidated: true, completionVerified: true,
  scope: 'authority-selected terrain and ammunition, deterministic shots, movement limits, scores, and mutual rematches'
});
const TERRAIN_TYPES = new Set(['flat', 'hilly', 'random']);
const COLOR_PATTERN = /^#[0-9a-f]{6}$/i;
const ACTION_FIELDS = Object.freeze({
  configure: ['color', 'terrainType'], start: [], rematch: [],
  fire: ['weaponId', 'angle', 'power'], move: ['distance']
});
export function createTanksState() {
  return { schema: 1, phase: 'lobby', round: 0, terrainType: 'hilly',
    colors: { 0: '#39b9ff', 1: '#ff6b6b' }, starterSeat: 0, game: null, rematchVotes: [] };
}
function fail(status, message) { throw Object.assign(new Error(message), { status }); }
function requireValue(condition, status, message) { if (!condition) fail(status, message); }
function playersIn(room) { return room.members.filter(p => !p.leftAt).sort((a, b) => a.seat - b.seat); }
function onlyKeys(action, extras) {
  const allowed = new Set(['type', 'expectedVersion', ...extras]);
  requireValue(Object.keys(action).every(key => allowed.has(key)), 400, 'Unsupported Tanks action fields');
}

// Both transports preflight the same intent contract. Game resolution happens
// once, synchronously, inside GenericRoomModel, without accepting snapshots.
export function validateTanksAction(room, member, action) {
  requireValue(action && typeof action === 'object' && !Array.isArray(action), 400, 'Action must be an object');
  if (action.type === 'rename') fail(403, 'Names are locked after joining Tanks');
  requireValue(typeof action.type === 'string' && Object.hasOwn(ACTION_FIELDS, action.type), 400, 'Unsupported Tanks action');
  onlyKeys(action, ACTION_FIELDS[action.type]);
  requireValue(typeof action.expectedVersion === 'number' && Number.isInteger(action.expectedVersion) && action.expectedVersion === room.version, 409, 'Room state changed; refresh and try again');
  const players = playersIn(room);
  requireValue(players.some(p => p.playerId === member?.playerId && p.seat === member.seat), 401, 'Invalid room player');
  if (action.type === 'configure') {
    requireValue(room.status === 'lobby', 409, 'Tank settings are locked after the game starts');
    requireValue(Object.hasOwn(action, 'color') || Object.hasOwn(action, 'terrainType'), 400, 'Choose a tank color or terrain');
    if (Object.hasOwn(action, 'color')) requireValue(typeof action.color === 'string' && COLOR_PATTERN.test(action.color), 400, 'Choose a valid tank color');
    if (Object.hasOwn(action, 'terrainType')) {
      requireValue(member.playerId === room.hostPlayerId, 403, 'Only the room host can choose terrain');
      requireValue(TERRAIN_TYPES.has(action.terrainType), 400, 'Choose flat, hilly, or random terrain');
    }
    return TANKS_AUTHORITY;
  }
  requireValue(players.length === 2 && players[0].seat === 0 && players[1].seat === 1, 409, 'Tanks needs two players');
  if (action.type === 'start') {
    requireValue(member.playerId === room.hostPlayerId, 403, 'Only the room host can start the game');
    requireValue(room.status === 'lobby', 409, 'The game has already started');
    return TANKS_AUTHORITY;
  }
  if (action.type === 'rematch') {
    requireValue(room.status === 'finished' && room.result?.type === 'tanks', 409, 'Finish this round before a rematch');
    requireValue(!room.state.rematchVotes.includes(member.playerId), 409, 'Your rematch request is already recorded');
    return TANKS_AUTHORITY;
  }
  requireValue(room.status === 'active' && room.state.phase === 'playing' && room.state.game && !room.state.game.finished, 409, 'The round is not active');
  requireValue(room.turn?.playerId === member.playerId && room.state.game.turn === member.seat, 403, 'It is not your turn');
  if (action.type === 'fire') {
    requireValue(typeof action.weaponId === 'string' && action.weaponId.length >= 1 && action.weaponId.length <= 80, 400, 'Choose an available weapon');
    requireValue(typeof action.angle === 'number' && Number.isFinite(action.angle) && action.angle >= 0 && action.angle <= 180, 400, 'Angle must be between 0 and 180');
    requireValue(typeof action.power === 'number' && Number.isFinite(action.power) && action.power >= 1 && action.power <= 100, 400, 'Power must be between 1 and 100');
  } else {
    requireValue(typeof action.distance === 'number' && Number.isFinite(action.distance) && action.distance !== 0 && Math.abs(action.distance) <= 150, 400, 'Move up to five tank lengths');
  }
  return TANKS_AUTHORITY;
}

function beginRound(room, players, rematch) {
  const previous = room.state;
  const random = crypto.getRandomValues(new Uint32Array(2));
  const starterSeat = rematch ? 1 - previous.starterSeat : random[1] & 1;
  const game = createGame({ seed: random[0], terrainType: previous.terrainType,
    names: players.map(p => p.username), colors: players.map(p => previous.colors[p.seat]), starter: starterSeat });
  validateGame(game);
  room.state = { ...previous, phase: 'playing', round: previous.round + 1, starterSeat,
    colors: { ...previous.colors }, game, rematchVotes: [] };
  room.status = 'active';
  room.result = null;
  const first = players[starterSeat];
  room.turn = { playerId: first.playerId, seat: first.seat, number: 1 };
}

// No non-storage await may reopen the Durable Object input gate during a shot.
export function applyTanksAction(room, member, action) {
  validateTanksAction(room, member, action);
  const players = playersIn(room), state = room.state;
  if (action.type === 'configure') {
    if (Object.hasOwn(action, 'color')) state.colors[member.seat] = action.color.toLowerCase();
    if (Object.hasOwn(action, 'terrainType')) state.terrainType = action.terrainType;
    return;
  }
  if (action.type === 'start') { beginRound(room, players, false); return; }
  if (action.type === 'rematch') {
    state.rematchVotes.push(member.playerId);
    if (state.rematchVotes.length === 2) beginRound(room, players, true);
    return;
  }
  let game;
  try {
    const intent = action.type === 'fire'
      ? { type: 'fire', weaponId: action.weaponId, angle: action.angle, power: action.power }
      : { type: 'move', distance: action.distance };
    game = applyAction(state.game, intent, member.seat);
    validateGame(game);
  } catch (error) { fail(400, error.message || 'Illegal Tanks action'); }
  state.game = game;
  if (game.finished) {
    const scores = game.tanks.map(tank => tank.score);
    const winnerSeat = scores[0] === scores[1] ? null : scores[0] > scores[1] ? 0 : 1;
    room.status = 'finished';
    state.phase = 'finished';
    room.turn = null;
    room.result = { type: 'tanks', reason: 'ten-shots', scores,
      winnerSeat, winnerPlayerId: winnerSeat === null ? null : players[winnerSeat].playerId };
  } else if (action.type === 'fire') {
    const next = players[game.turn];
    room.turn = { playerId: next.playerId, seat: next.seat, number: room.turn.number + 1 };
  }
}

export function publicTanksState(room) {
  const state = room.state;
  return { schema: 1, phase: room.status === 'finished' ? 'finished' : state.phase,
    round: state.round, terrainType: state.terrainType, colors: { ...state.colors },
    starterSeat: state.starterSeat, game: state.game ? structuredClone(state.game) : null,
    rematchVotes: [...state.rematchVotes] };
}

// Nearby saves contain authority checkpoints, never a client gameplay action.
// Validate this game's checkpoint before binding any restored room to peers.
export function validateTanksRoomCheckpoint(room) {
  const state = room.state;
  requireValue(state && state.schema === 1 && ['lobby', 'playing', 'finished'].includes(state.phase), 400, 'Invalid Tanks checkpoint');
  requireValue(Number.isInteger(state.round) && state.round >= 0 && Number.isInteger(state.starterSeat) && [0, 1].includes(state.starterSeat), 400, 'Invalid Tanks round');
  requireValue(TERRAIN_TYPES.has(state.terrainType) && state.colors && [0, 1].every(seat => typeof state.colors[seat] === 'string' && COLOR_PATTERN.test(state.colors[seat])), 400, 'Invalid Tanks settings');
  requireValue(Array.isArray(state.rematchVotes) && state.rematchVotes.length <= 2 && new Set(state.rematchVotes).size === state.rematchVotes.length && state.rematchVotes.every(id => room.members.some(p => p.playerId === id)), 400, 'Invalid Tanks rematch votes');
  if (room.status === 'lobby') {
    requireValue(state.phase === 'lobby' && state.round === 0 && state.game === null && room.turn === null && room.result === null && state.rematchVotes.length === 0, 400, 'Invalid Tanks lobby');
    return;
  }
  // A lobby abandoned by its only member also has no game to restore.
  if (room.status === 'finished' && room.result?.type === 'abandoned' && state.game === null) return;
  let game;
  try { game = validateGame(state.game); }
  catch { fail(400, 'Invalid saved Tanks game'); }
  requireValue(state.round >= 1 && game.starter === state.starterSeat && game.terrainType === state.terrainType, 400, 'Tanks checkpoint settings do not match its game');
  requireValue([0, 1].every(seat => game.tanks[seat].color === state.colors[seat] && room.members.some(p => p.seat === seat && p.username === game.tanks[seat].name)), 400, 'Tanks checkpoint player identities do not match');
  if (room.status === 'active') {
    const current = playersIn(room).find(p => p.seat === game.turn);
    requireValue(state.phase === 'playing' && !game.finished && current && room.turn?.seat === game.turn && room.turn?.playerId === current.playerId && room.result === null && state.rematchVotes.length === 0, 400, 'Invalid saved Tanks turn');
  } else {
    requireValue(room.status === 'finished' && room.turn === null, 400, 'Invalid saved Tanks lifecycle');
    if (room.result?.type === 'tanks') {
      const scores = game.tanks.map(tank => tank.score);
      const winnerSeat = scores[0] === scores[1] ? null : scores[0] > scores[1] ? 0 : 1;
      requireValue(state.phase === 'finished' && game.finished && room.result.reason === 'ten-shots' && JSON.stringify(room.result.scores) === JSON.stringify(scores) && room.result.winnerSeat === winnerSeat && (winnerSeat === null ? room.result.winnerPlayerId === null : room.members.some(p => p.seat === winnerSeat && p.playerId === room.result.winnerPlayerId)), 400, 'Invalid saved Tanks result');
    } else requireValue(room.result?.type === 'abandoned', 400, 'Invalid saved Tanks result');
  }
}
