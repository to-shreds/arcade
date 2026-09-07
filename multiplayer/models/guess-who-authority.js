import { characterById, questionById, matchesQuestion } from './guess-who-data.js';

export const GUESS_WHO_AUTHORITY = Object.freeze({
  id: 'guess-who-authority-v1', ruleValidated: true, completionVerified: true,
  scope: 'private character choices, canonical clues, turns, guesses, and mutual rematches'
});
export function createGuessWhoState() {
  return { schema: 1, phase: 'lobby', round: 0, starterSeat: 0, secrets: {}, history: [], pending: null, scores: {}, rematchVotes: [] };
}
function fail(status, message) { throw Object.assign(new Error(message), { status }); }
function requireValue(condition, status, message) { if (!condition) fail(status, message); }
function members(room) { return room.members.filter(m => !m.leftAt).sort((a,b) => a.seat-b.seat); }
function onlyKeys(action, extra = []) {
  const allowed = new Set(['type','expectedVersion',...extra]);
  requireValue(Object.keys(action).every(k => allowed.has(k)), 400, 'Unsupported Guess Who action fields');
}
function nextTurn(room, member) {
  room.turn = { playerId: member.playerId, seat: member.seat, number: (room.turn?.number || 0) + 1 };
}
function beginRound(room, players, restart = false) {
  const previous = room.state;
  const starterSeat = restart ? 1 - previous.starterSeat : (crypto.getRandomValues(new Uint8Array(1))[0] & 1);
  room.state = { ...createGuessWhoState(), phase: 'selecting', round: (previous.round || 0) + 1, starterSeat,
    scores: Object.fromEntries(players.map(p => [p.playerId, previous.scores[p.playerId] || 0])) };
  room.status = 'active';
  room.turn = null;
  room.result = null;
}
function finish(room, winner, details) {
  room.status = 'finished';
  room.turn = null;
  room.state.phase = 'finished';
  room.state.pending = null;
  room.state.scores[winner.playerId] = Math.min(1000000, (room.state.scores[winner.playerId] || 0) + 1);
  room.result = { type: 'guess-who', winnerPlayerId: winner.playerId, winnerSeat: winner.seat, ...details };
}

/* Synchronous: no non-storage await may reopen a Durable Object input gate. */
export function applyGuessWhoAction(room, member, action) {
  const players = members(room), state = room.state, type = action.type;
  if (type === 'rename') fail(403, 'Names are locked after joining Guess Who');
  requireValue(players.length === 2 || type === 'start', 409, 'Guess Who needs two players');
  if (type === 'start') {
    onlyKeys(action);
    requireValue(member.playerId === room.hostPlayerId, 403, 'Only the room host can start the game');
    requireValue(room.status === 'lobby', 409, 'The game has already started');
    requireValue(players.length === 2, 409, 'Wait for the other player to join');
    beginRound(room, players);
    return;
  }
  if (type === 'rematch') {
    onlyKeys(action);
    requireValue(room.status === 'finished' && room.result?.type === 'guess-who', 409, 'Finish this round before a rematch');
    requireValue(!state.rematchVotes.includes(member.playerId), 409, 'Your rematch request is already recorded');
    state.rematchVotes.push(member.playerId);
    if (state.rematchVotes.length === 2) beginRound(room, players, true);
    return;
  }
  requireValue(room.status === 'active', 409, 'The round is not active');
  const other = players.find(p => p.playerId !== member.playerId);
  if (type === 'resign') {
    onlyKeys(action);
    finish(room, other, { reason: 'resigned', resignedPlayerId: member.playerId });
    return;
  }
  if (type === 'choose') {
    onlyKeys(action, ['characterId']);
    requireValue(state.phase === 'selecting', 409, 'Character selection has ended');
    requireValue(!state.secrets[member.playerId], 409, 'Your character is already locked');
    requireValue(!!characterById(action.characterId), 400, 'Choose a character from this board');
    state.secrets[member.playerId] = action.characterId;
    if (players.every(p => state.secrets[p.playerId])) {
      state.phase = 'playing';
      nextTurn(room, players.find(p => p.seat === state.starterSeat));
    }
    return;
  }
  requireValue(room.turn?.playerId === member.playerId, 403, 'It is not your turn');
  if (type === 'answer') {
    onlyKeys(action, ['answer']);
    requireValue(state.phase === 'answering' && state.pending?.answerBy === member.playerId, 409, 'There is no question for you to answer');
    requireValue(action.answer === true || action.answer === false || action.answer === 'unsure', 400, 'Answer Yes, No, or Not sure');
    state.history.push({ id: state.pending.id, kind: 'custom', askerId: state.pending.askerId,
      text: state.pending.text, answer: action.answer === 'unsure' ? null : action.answer });
    state.pending = null;
    state.phase = 'playing'; // Answering does not use up the responder's own question.
    return;
  }
  requireValue(state.phase === 'playing', 409, 'Answer the pending question first');
  if (type === 'ask') {
    onlyKeys(action, ['questionId', 'text']);
    requireValue(state.history.length < 80, 409, 'The question limit is reached. Make a guess.');
    const id = `q${room.version}`;
    if (Object.hasOwn(action, 'questionId')) {
      requireValue(!Object.hasOwn(action, 'text'), 400, 'Choose one question type');
      const question = questionById(action.questionId);
      requireValue(!!question, 400, 'Unknown question');
      requireValue(!state.history.some(h => h.askerId === member.playerId && h.questionId === question.id), 409, 'You already asked that question');
      state.history.push({ id, kind: 'trait', questionId: question.id, text: question.text, askerId: member.playerId,
        answer: matchesQuestion(characterById(state.secrets[other.playerId]), question) });
    } else {
      requireValue(typeof action.text === 'string', 400, 'Write a yes/no question');
      const text = action.text.trim();
      requireValue(text.length >= 3 && text.length <= 160 && !/[\u0000-\u001f\u007f]/.test(text), 400, 'Use a question of 3-160 characters without control characters');
      state.pending = { id, askerId: member.playerId, answerBy: other.playerId, text };
      state.phase = 'answering';
    }
    nextTurn(room, other);
    return;
  }
  if (type === 'guess') {
    onlyKeys(action, ['characterId']);
    const character = characterById(action.characterId);
    requireValue(!!character, 400, 'Choose a character from this board');
    const correct = character.id === state.secrets[other.playerId];
    state.history.push({ id: `q${room.version}`, kind: 'guess', askerId: member.playerId,
      text: `Is it ${character.name}?`, characterId: character.id, answer: correct });
    finish(room, correct ? member : other, { reason: correct ? 'correct-guess' : 'wrong-guess', guesserPlayerId: member.playerId, guess: character.id });
    return;
  }
  fail(400, 'Unsupported Guess Who action');
}

/* Whitelist the viewer's state for HTTP, WebSockets and Nearby broadcasts alike. */
export function publicGuessWhoState(room, viewerPlayerId) {
  const state = room.state;
  const active = members(room);
  const viewer = active.some(p => p.playerId === viewerPlayerId) ? viewerPlayerId : null;
  return {
    schema: 1, phase: room.status === 'finished' ? 'finished' : state.phase,
    round: state.round, starterSeat: state.starterSeat,
    ready: active.filter(p => !!state.secrets[p.playerId]).map(p => p.playerId),
    myCharacterId: viewer ? state.secrets[viewer] || null : null,
    history: state.history.map(h => ({...h})), pending: state.pending ? {...state.pending} : null,
    scores: {...state.scores}, rematchVotes: [...state.rematchVotes],
    revealed: room.status === 'finished' && room.result?.type === 'guess-who' ? {...state.secrets} : null
  };
}
