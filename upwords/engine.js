import { WORDS, isWord, isSimpleSPlural, DICTIONARY_ID } from './dictionary.js';

export const BOARD_SIZE = 10;
export const RACK_SIZE = 7;
export const MAX_HEIGHT = 5;
export const HISTORY_LIMIT = 12;
// Hasbro's 100-tile edition. QU occupies one board square and one rack slot.
export const TILE_COUNTS = Object.freeze({
  A: 7, B: 3, C: 4, D: 5, E: 8, F: 3, G: 3, H: 3, I: 7, J: 1, K: 2,
  L: 5, M: 5, N: 5, O: 7, P: 3, QU: 1, R: 5, S: 6, T: 5, U: 5,
  V: 1, W: 2, X: 1, Y: 2, Z: 1
});
const TOKENS = new Set(Object.keys(TILE_COUNTS));
const DIRECTIONS = [{ dr: 0, dc: 1, name: 'horizontal' }, { dr: 1, dc: 0, name: 'vertical' }];
const clone = value => JSON.parse(JSON.stringify(value));
const inBounds = (row, col) => Number.isInteger(row) && Number.isInteger(col) && row >= 0 && row < BOARD_SIZE && col >= 0 && col < BOARD_SIZE;
const top = cell => cell[cell.length - 1] || '';
const occupied = (board, row, col) => inBounds(row, col) && board[row][col].length > 0;
const keyOf = (row, col) => row * BOARD_SIZE + col;
const seatOK = seat => seat === 0 || seat === 1;
const plainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function requireValue(condition, message) { if (!condition) throw new Error(message); }
function seedNumber(value) {
  if (Number.isSafeInteger(value)) return (value >>> 0) || 0x6d2b79f5;
  let result = 2166136261;
  for (const char of String(value ?? 'arcade-upwords')) result = Math.imul(result ^ char.charCodeAt(0), 16777619);
  return (result >>> 0) || 0x6d2b79f5;
}
function random(state) {
  let value = state.rng;
  value ^= value << 13; value ^= value >>> 17; value ^= value << 5;
  state.rng = value >>> 0;
  return state.rng / 4294967296;
}
function shuffled(state, values) {
  const result = values.slice();
  for (let index = result.length - 1; index > 0; index--) {
    const other = Math.floor(random(state) * (index + 1));
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}
function allTiles() { return Object.entries(TILE_COUNTS).flatMap(([tile, count]) => Array(count).fill(tile)); }

export function createGame(options = {}) {
  const starter = options.starter ?? 0, seed = seedNumber(options.seed);
  requireValue(seatOK(starter), 'Choose a valid starting player.');
  const game = {
    schema: 1, dictionaryId: DICTIONARY_ID, seed, rng: seed, starter,
    board: Array.from({ length: BOARD_SIZE }, () => Array.from({ length: BOARD_SIZE }, () => [])),
    players: [0, 1].map(seat => ({ name: String(options.names?.[seat] ?? `Player ${seat + 1}`).trim().slice(0, 24) || `Player ${seat + 1}`, rack: [], score: 0 })),
    bag: [], turn: starter, moveNumber: 0, passes: 0, finished: false,
    winner: null, endReason: null, lastMove: null, history: []
  };
  game.bag = shuffled(game, allTiles());
  for (const seat of [starter, 1 - starter]) refill(game, seat);
  return game;
}
function refill(game, seat) {
  while (game.players[seat].rack.length < RACK_SIZE && game.bag.length) game.players[seat].rack.push(game.bag.pop());
}

function lineAt(board, row, col, direction) {
  if (!occupied(board, row, col)) return null;
  const { dr, dc } = direction;
  while (occupied(board, row - dr, col - dc)) { row -= dr; col -= dc; }
  const cells = [], tokens = [], heights = [];
  while (occupied(board, row, col)) {
    cells.push({ row, col }); tokens.push(top(board[row][col])); heights.push(board[row][col].length);
    row += dr; col += dc;
  }
  if (cells.length < 2) return null;
  const flat = heights.every(height => height === 1);
  const score = flat ? cells.length * 2 + (tokens.includes('QU') ? 2 : 0) : heights.reduce((sum, height) => sum + height, 0);
  return { word: tokens.join(''), cells, score, direction: direction.name };
}
function allLines(board) {
  const lines = [];
  for (const direction of DIRECTIONS) {
    for (let row = 0; row < BOARD_SIZE; row++) for (let col = 0; col < BOARD_SIZE; col++) {
      if (occupied(board, row, col) && !occupied(board, row - direction.dr, col - direction.dc)) {
        const line = lineAt(board, row, col, direction);
        if (line) lines.push(line);
      }
    }
  }
  return lines;
}
function checkPreviewContext(game, seat) {
  requireValue(plainObject(game) && game.schema === 1 && game.dictionaryId === DICTIONARY_ID, 'This game uses a different word list. Update Arcade to continue.');
  requireValue(seatOK(seat) && seat === game.turn, 'It is the other player’s turn.');
  requireValue(!game.finished, 'This game has finished.');
  requireValue(Array.isArray(game.board) && game.board.length === BOARD_SIZE && game.board.every(row => Array.isArray(row) && row.length === BOARD_SIZE && row.every(cell => Array.isArray(cell) && cell.length <= MAX_HEIGHT && cell.every(tile => TOKENS.has(tile)))), 'The board is invalid.');
  requireValue(Array.isArray(game.players) && Array.isArray(game.players[seat]?.rack) && game.players[seat].rack.length <= RACK_SIZE && game.players[seat].rack.every(tile => TOKENS.has(tile)), 'Your rack is unavailable. Reconnect to the room.');
}

// This operates on either the full local state or a private, redacted room view.
// It never requires the bag order, seed, or another player's rack.
export function previewMove(game, placements, seat = game?.turn) {
  try {
    checkPreviewContext(game, seat);
    requireValue(Array.isArray(placements) && placements.length >= 1 && placements.length <= RACK_SIZE, 'Place between one and seven tiles.');
    const rack = game.players[seat].rack, usedRack = new Set(), usedCells = new Set(), resolved = [];
    for (const placement of placements) {
      requireValue(plainObject(placement) && Object.keys(placement).every(key => ['row', 'col', 'rackIndex'].includes(key)), 'A tile placement is invalid.');
      const { row, col, rackIndex } = placement;
      requireValue(inBounds(row, col), 'Place tiles inside the board.');
      requireValue(Number.isInteger(rackIndex) && rackIndex >= 0 && rackIndex < rack.length, 'Choose a tile from your rack.');
      requireValue(!usedRack.has(rackIndex), 'A rack tile can only be played once.');
      requireValue(!usedCells.has(keyOf(row, col)), 'Only one new tile may be placed on each square per turn.');
      const cell = game.board[row][col], tile = rack[rackIndex];
      requireValue(cell.length < MAX_HEIGHT, 'A stack cannot be more than five tiles high.');
      requireValue(top(cell) !== tile, 'You cannot put a letter on the same letter.');
      usedRack.add(rackIndex); usedCells.add(keyOf(row, col));
      resolved.push({ row, col, tile, height: cell.length + 1 });
    }
    const sameRow = resolved.every(tile => tile.row === resolved[0].row), sameCol = resolved.every(tile => tile.col === resolved[0].col);
    requireValue(sameRow || sameCol, 'Play all tiles in one row or one column.');
    const board = game.board.map(row => row.map(cell => cell.slice()));
    for (const tile of resolved) board[tile.row][tile.col].push(tile.tile);
    if (resolved.length > 1) {
      const rowMin = Math.min(...resolved.map(tile => tile.row)), rowMax = Math.max(...resolved.map(tile => tile.row));
      const colMin = Math.min(...resolved.map(tile => tile.col)), colMax = Math.max(...resolved.map(tile => tile.col));
      if (sameRow) for (let col = colMin; col <= colMax; col++) requireValue(occupied(board, rowMin, col), 'A word cannot contain an empty square.');
      else for (let row = rowMin; row <= rowMax; row++) requireValue(occupied(board, row, colMin), 'A word cannot contain an empty square.');
    }
    const hasOldTiles = game.board.some(row => row.some(cell => cell.length));
    if (!hasOldTiles) {
      requireValue(resolved.length >= 2, 'Your first word needs at least two tiles.');
      requireValue(resolved.some(({ row, col }) => (row === 4 || row === 5) && (col === 4 || col === 5)), 'The first word must cross a center star.');
    } else {
      requireValue(resolved.some(({ row, col }) => occupied(game.board, row, col) || DIRECTIONS.some(({ dr, dc }) => occupied(game.board, row + dr, col + dc) || occupied(game.board, row - dr, col - dc))), 'Connect your word to the tiles already on the board.');
      for (const line of allLines(game.board)) requireValue(!line.cells.every(({ row, col }) => usedCells.has(keyOf(row, col))), 'Leave at least one original letter visible in every word you change.');
    }
    const words = [], seen = new Set();
    for (const { row, col } of resolved) for (const direction of DIRECTIONS) {
      const line = lineAt(board, row, col, direction);
      if (!line) continue;
      const id = `${direction.name}:${keyOf(line.cells[0].row, line.cells[0].col)}`;
      if (!seen.has(id)) { seen.add(id); words.push(line); }
    }
    requireValue(words.length > 0, 'Make a word of at least two tiles.');
    const unknown = words.filter(({ word }) => !isWord(word)).map(({ word }) => word);
    requireValue(unknown.length === 0, `Not in the word list: ${unknown.join(', ')}.`);
    // A lone S cannot merely pluralize an existing word. Dictionary inflection
    // metadata distinguishes a plural (CAT/CATS) from another word (HI/HIS).
    // A perpendicular word or a longer extension remains permitted.
    if (resolved.length === 1 && resolved[0].tile === 'S' && resolved[0].height === 1 && words.length === 1) {
      const line = words[0], last = line.cells[line.cells.length - 1];
      if (last.row === resolved[0].row && last.col === resolved[0].col && isSimpleSPlural(line.word.slice(0, -1), line.word)) {
        requireValue(false, 'A lone S cannot simply make a word plural. Use it in a crossing word or play more letters.');
      }
    }
    const bonus = resolved.length === RACK_SIZE ? 20 : 0;
    return { valid: true, error: '', words, score: words.reduce((sum, word) => sum + word.score, 0) + bonus, bonus, placements: resolved };
  } catch (error) {
    return { valid: false, error: error.message || 'That move is not allowed.', words: [], score: 0, bonus: 0, placements: [] };
  }
}

function finish(game, reason) {
  game.finished = true; game.endReason = reason;
  for (const player of game.players) player.score -= 5 * player.rack.length;
  const scores = game.players.map(player => player.score);
  game.winner = scores[0] === scores[1] ? null : Number(scores[1] > scores[0]);
}
export function applyAction(game, action, seat = game?.turn) {
  checkPreviewContext(game, seat);
  requireValue(plainObject(action), 'Choose a valid action.');
  const fields = { play: ['type', 'placements'], pass: ['type'], exchange: ['type', 'rackIndex'] }[action.type];
  requireValue(fields && Object.keys(action).every(key => fields.includes(key)), 'Choose a valid action.');
  requireValue(Array.isArray(game.bag) && game.bag.every(tile => TOKENS.has(tile)), 'The saved tile bag is invalid.');
  let preview = null;
  if (action.type === 'play') { preview = previewMove(game, action.placements, seat); requireValue(preview.valid, preview.error); }
  if (action.type === 'exchange') {
    requireValue(game.bag.length > 0, 'There are no tiles left to exchange.');
    requireValue(Number.isInteger(action.rackIndex) && action.rackIndex >= 0 && action.rackIndex < game.players[seat].rack.length, 'Choose one tile to exchange.');
  }
  const after = clone(game), player = after.players[seat];
  const record = { type: action.type, seat, placements: preview?.placements || [], words: preview?.words || [], score: preview?.score || 0, bonus: preview?.bonus || 0, moveNumber: game.moveNumber + 1 };
  if (action.type === 'play') {
    for (const tile of preview.placements) after.board[tile.row][tile.col].push(tile.tile);
    const indices = new Set(action.placements.map(tile => tile.rackIndex));
    player.rack = player.rack.filter((_, index) => !indices.has(index));
    player.score += preview.score;
    refill(after, seat); after.passes = 0;
  } else if (action.type === 'exchange') {
    const returned = player.rack[action.rackIndex];
    player.rack[action.rackIndex] = after.bag.pop();
    // Draw before returning the old tile, so it cannot be immediately redrawn.
    const index = Math.floor(random(after) * (after.bag.length + 1));
    after.bag.splice(index, 0, returned); after.passes = 0;
  } else after.passes++;
  after.moveNumber++; after.turn = 1 - seat; after.lastMove = record;
  after.history = [...after.history, record].slice(-HISTORY_LIMIT);
  if (after.bag.length === 0 && player.rack.length === 0) finish(after, 'rack-empty');
  else if (after.passes === 2) finish(after, 'passes');
  return after;
}

function validInt(value, minimum, maximum) { return Number.isSafeInteger(value) && value >= minimum && value <= maximum; }
function checkRecord(record, game) {
  requireValue(plainObject(record) && ['play', 'pass', 'exchange'].includes(record.type) && seatOK(record.seat) && validInt(record.moveNumber, 1, game.moveNumber), 'Invalid saved move.');
  requireValue(Array.isArray(record.placements) && record.placements.length <= RACK_SIZE && Array.isArray(record.words) && record.words.length <= 8, 'Invalid saved move details.');
  requireValue(validInt(record.score, 0, 500) && (record.bonus === 0 || record.bonus === 20), 'Invalid saved move score.');
  for (const placement of record.placements) requireValue(plainObject(placement) && inBounds(placement.row, placement.col) && TOKENS.has(placement.tile) && validInt(placement.height, 1, MAX_HEIGHT), 'Invalid saved tile.');
  requireValue(new Set(record.placements.map(tile => keyOf(tile.row, tile.col))).size === record.placements.length, 'Invalid saved tile positions.');
  for (const word of record.words) {
    requireValue(plainObject(word) && typeof word.word === 'string' && isWord(word.word) && validInt(word.score, 1, 50) && ['horizontal', 'vertical'].includes(word.direction) && Array.isArray(word.cells) && word.cells.length >= 2 && word.cells.length <= BOARD_SIZE, 'Invalid saved word.');
    for (const cell of word.cells) requireValue(plainObject(cell) && inBounds(cell.row, cell.col), 'Invalid saved word position.');
    const { dr, dc } = DIRECTIONS.find(direction => direction.name === word.direction);
    requireValue(word.cells.every((cell, index) => cell.row === word.cells[0].row + index * dr && cell.col === word.cells[0].col + index * dc), 'Invalid saved word line.');
  }
  requireValue(record.score === record.words.reduce((sum, word) => sum + word.score, 0) + record.bonus, 'Saved move score does not match its words.');
  if (record.type === 'play') requireValue(record.placements.length > 0 && record.words.length > 0 && record.bonus === (record.placements.length === RACK_SIZE ? 20 : 0), 'Invalid saved play.');
  else requireValue(record.placements.length === 0 && record.words.length === 0 && record.score === 0 && record.bonus === 0, 'Invalid saved non-play action.');
}
function checkCommon(game, publicSeat, isPublic) {
  requireValue(plainObject(game) && game.schema === 1 && game.dictionaryId === DICTIONARY_ID, 'This save uses a different word list or game format.');
  requireValue(seatOK(game.starter) && seatOK(game.turn) && validInt(game.moveNumber, 0, 1000000) && game.turn === (game.starter + game.moveNumber) % 2, 'Invalid saved turn.');
  requireValue(validInt(game.passes, 0, 2) && typeof game.finished === 'boolean' && (game.winner === null || seatOK(game.winner)), 'Invalid saved result.');
  requireValue(game.finished ? ['rack-empty', 'passes'].includes(game.endReason) : game.endReason === null && game.winner === null && game.passes < 2, 'Invalid saved lifecycle.');
  requireValue(Array.isArray(game.board) && game.board.length === BOARD_SIZE, 'Invalid saved board.');
  const occupiedCells = [], counts = Object.fromEntries(Object.keys(TILE_COUNTS).map(tile => [tile, 0]));
  for (let row = 0; row < BOARD_SIZE; row++) {
    requireValue(Array.isArray(game.board[row]) && game.board[row].length === BOARD_SIZE, 'Invalid saved board row.');
    for (let col = 0; col < BOARD_SIZE; col++) {
      const cell = game.board[row][col];
      requireValue(Array.isArray(cell) && cell.length <= MAX_HEIGHT && cell.every((tile, index) => TOKENS.has(tile) && (index === 0 || tile !== cell[index - 1])), 'Invalid saved stack.');
      if (cell.length) occupiedCells.push(keyOf(row, col));
      for (const tile of cell) counts[tile]++;
    }
  }
  if (occupiedCells.length) {
    requireValue(occupiedCells.length >= 2 && [44, 45, 54, 55].some(key => occupiedCells.includes(key)), 'The saved board does not cross a center square.');
    const seen = new Set(), queue = [occupiedCells[0]];
    while (queue.length) {
      const key = queue.pop(); if (seen.has(key)) continue; seen.add(key);
      const row = Math.floor(key / BOARD_SIZE), col = key % BOARD_SIZE;
      for (const { dr, dc } of DIRECTIONS) for (const sign of [-1, 1]) {
        const r = row + dr * sign, c = col + dc * sign;
        if (occupied(game.board, r, c) && !seen.has(keyOf(r, c))) queue.push(keyOf(r, c));
      }
    }
    requireValue(seen.size === occupiedCells.length, 'The saved board contains disconnected tiles.');
    requireValue(allLines(game.board).every(line => isWord(line.word)), 'The saved board contains an unrecognized word.');
  }
  requireValue(Array.isArray(game.players) && game.players.length === 2, 'Invalid saved players.');
  for (const [seat, player] of game.players.entries()) {
    requireValue(plainObject(player) && typeof player.name === 'string' && player.name.length >= 1 && player.name.length <= 24 && !/[\u0000-\u001f]/.test(player.name), 'Invalid saved player name.');
    requireValue(validInt(player.score, game.finished ? -35 : 0, 10000), 'Invalid saved score.');
    if (isPublic) {
      requireValue(validInt(player.rackCount, 0, RACK_SIZE), 'Invalid remaining tile count.');
      requireValue(seat === publicSeat ? Array.isArray(player.rack) && player.rack.length === player.rackCount : !Object.hasOwn(player, 'rack'), 'Invalid private rack view.');
    }
    if (!isPublic || seat === publicSeat) {
      requireValue(Array.isArray(player.rack) && player.rack.length <= RACK_SIZE && player.rack.every(tile => TOKENS.has(tile)), 'Invalid saved rack.');
      for (const tile of player.rack) counts[tile]++;
    }
  }
  requireValue(Object.keys(TILE_COUNTS).every(tile => counts[tile] <= TILE_COUNTS[tile]), 'Saved tile counts are invalid.');
  const bagCount = isPublic ? game.bagCount : game.bag?.length;
  const rackCounts = game.players.map(player => isPublic ? player.rackCount : player.rack.length);
  requireValue(validInt(bagCount, 0, 100) && occupiedCells.reduce((sum, key) => sum + game.board[Math.floor(key / BOARD_SIZE)][key % BOARD_SIZE].length, 0) + rackCounts[0] + rackCounts[1] + bagCount === 100, 'The saved game must contain exactly 100 tiles.');
  if (bagCount > 0) requireValue(rackCounts.every(count => count === RACK_SIZE), 'Racks must be refilled while tiles remain.');
  if (game.finished) {
    requireValue(game.endReason === 'passes' ? game.passes === 2 : bagCount === 0 && rackCounts.some(count => count === 0) && game.passes === 0, 'Invalid saved ending.');
    const winner = game.players[0].score === game.players[1].score ? null : Number(game.players[1].score > game.players[0].score);
    requireValue(game.winner === winner, 'Saved winner does not match the scores.');
  } else requireValue(bagCount > 0 || rackCounts.every(count => count > 0), 'An empty rack must end the game when the bag is empty.');
  requireValue(Array.isArray(game.history) && game.history.length <= HISTORY_LIMIT && game.history.length === Math.min(HISTORY_LIMIT, game.moveNumber), 'Invalid saved move history.');
  for (const [index, record] of game.history.entries()) {
    checkRecord(record, game);
    requireValue(record.moveNumber === game.moveNumber - game.history.length + index + 1 && record.seat === (game.starter + record.moveNumber - 1) % 2, 'Saved move order is invalid.');
  }
  if (game.moveNumber === 0) {
    requireValue(game.lastMove === null && occupiedCells.length === 0 && game.players.every(player => player.score === 0) && game.passes === 0 && !game.finished, 'Invalid initial game.');
  } else {
    checkRecord(game.lastMove, game);
    requireValue(JSON.stringify(game.lastMove) === JSON.stringify(game.history.at(-1)), 'The saved last move is inconsistent.');
    let trailingPasses = 0;
    for (let index = game.history.length - 1; index >= 0 && game.history[index].type === 'pass'; index--) trailingPasses++;
    requireValue(trailingPasses === game.passes, 'Saved passes are inconsistent.');
    if (game.lastMove.type === 'play') {
      // The final move can be reconstructed without a private rack or bag:
      // remove its top tiles, then validate those visible played tiles again.
      const record = game.lastMove, previousBoard = game.board.map(row => row.map(cell => cell.slice()));
      for (const tile of record.placements) {
        const cell = previousBoard[tile.row][tile.col];
        requireValue(cell.length === tile.height && top(cell) === tile.tile, 'The last played tiles do not match the board.');
        cell.pop();
      }
      const previous = { schema: 1, dictionaryId: game.dictionaryId, board: previousBoard, turn: record.seat, finished: false, players: [{ rack: [] }, { rack: [] }] };
      previous.players[record.seat].rack = record.placements.map(tile => tile.tile);
      const replay = previewMove(previous, record.placements.map(({ row, col }, rackIndex) => ({ row, col, rackIndex })), record.seat);
      const wordSignature = word => `${word.direction}:${word.word}:${word.score}:${word.cells.map(({ row, col }) => keyOf(row, col)).join(',')}`;
      requireValue(replay.valid && replay.score === record.score && replay.bonus === record.bonus && JSON.stringify(replay.words.map(wordSignature).sort()) === JSON.stringify(record.words.map(wordSignature).sort()), 'The last saved play does not match the word rules.');
    }
    if (game.finished && game.endReason === 'rack-empty') requireValue(game.lastMove.type === 'play' && rackCounts[game.lastMove.seat] === 0, 'The final player must have used every tile.');
    for (const seat of [0, 1]) {
      const knownScore = game.history.filter(record => record.seat === seat).reduce((sum, record) => sum + record.score, 0) - (game.finished ? 5 * rackCounts[seat] : 0);
      requireValue(game.moveNumber <= HISTORY_LIMIT ? game.players[seat].score === knownScore : game.players[seat].score >= knownScore, 'The saved scores do not match the recorded moves.');
    }
  }
  return counts;
}

export function validateGame(game) {
  let size; try { size = JSON.stringify(game).length; } catch { throw new Error('Invalid saved game.'); }
  requireValue(size <= 48000, 'The saved game is too large.');
  const counts = checkCommon(game, null, false);
  requireValue(validInt(game.seed, 1, 0xffffffff) && validInt(game.rng, 1, 0xffffffff), 'Invalid saved random state.');
  requireValue(Array.isArray(game.bag) && game.bag.every(tile => TOKENS.has(tile)), 'Invalid saved tile bag.');
  for (const tile of game.bag) counts[tile]++;
  requireValue(Object.keys(TILE_COUNTS).every(tile => counts[tile] === TILE_COUNTS[tile]), 'The saved letter distribution is invalid.');
  return clone(game);
}

function safeRecord(record) {
  if (!record) return null;
  return {
    type: record.type, seat: record.seat, moveNumber: record.moveNumber, score: record.score, bonus: record.bonus,
    placements: record.type === 'play' ? record.placements.map(({ row, col, tile, height }) => ({ row, col, tile, height })) : [],
    words: record.type === 'play' ? record.words.map(({ word, score, cells, direction }) => ({ word, score, direction, cells: cells.map(({ row, col }) => ({ row, col })) })) : []
  };
}
export function publicGame(game, seat = null) {
  return {
    schema: game.schema, dictionaryId: game.dictionaryId, starter: game.starter,
    board: game.board.map(row => row.map(cell => cell.slice())),
    players: game.players.map((player, index) => ({ name: player.name, score: player.score, rackCount: player.rack.length, ...(seatOK(seat) && seat === index ? { rack: player.rack.slice() } : {}) })),
    bagCount: game.bag.length, turn: game.turn, moveNumber: game.moveNumber, passes: game.passes,
    finished: game.finished, winner: game.winner, endReason: game.endReason,
    lastMove: safeRecord(game.lastMove), history: game.history.map(safeRecord)
  };
}
export function validatePublicGame(game, seat = null) {
  requireValue(!Object.hasOwn(game || {}, 'bag') && !Object.hasOwn(game || {}, 'seed') && !Object.hasOwn(game || {}, 'rng'), 'The room sent private game data.');
  let size; try { size = JSON.stringify(game).length; } catch { throw new Error('Invalid room game.'); }
  requireValue(size <= 48000, 'The room game is too large.');
  checkCommon(game, seatOK(seat) ? seat : null, true);
  return clone(game);
}

// Sorted prefix ranges avoid allocating a large object trie on mobile devices.
// Q encodes the single QU tile. The dictionary also contains legitimate bare-Q
// words, but the physical tile set cannot spell those, so exclude only from CPU
// search rather than changing the dictionary's accepted-word policy.
let codedWords = null;
function cpuWords() { return codedWords ||= WORDS.filter(word => !word.replace(/QU/g, '').includes('Q')).map(word => word.replace(/QU/g, 'Q')).sort(); }
function rangeFor(words, low, high, depth, letter) {
  let left = low, right = high;
  while (left < right) { const mid = (left + right) >>> 1; if ((words[mid][depth] || '') < letter) left = mid + 1; else right = mid; }
  const first = left; right = high;
  while (left < right) { const mid = (left + right) >>> 1; if ((words[mid][depth] || '') <= letter) left = mid + 1; else right = mid; }
  return [first, left];
}
function crossAllowed(board, row, col, tile, direction) {
  const perpendicular = direction.dr === 0 ? DIRECTIONS[1] : DIRECTIONS[0], { dr, dc } = perpendicular;
  let r = row - dr, c = col - dc, before = '', after = '';
  while (occupied(board, r, c)) { before = top(board[r][c]) + before; r -= dr; c -= dc; }
  r = row + dr; c = col + dc;
  while (occupied(board, r, c)) { after += top(board[r][c]); r += dr; c += dc; }
  return !before && !after || isWord(before + tile + after);
}
export function chooseCpuAction(game, difficulty = 'normal') {
  checkPreviewContext(game, game?.turn);
  const rack = game.players[game.turn].rack, board = game.board, words = cpuWords();
  const level = ['easy', 'normal', 'hard'].includes(difficulty) ? difficulty : 'normal';
  const nodeLimit = level === 'easy' ? 50000 : level === 'hard' ? 450000 : 180000;
  const candidateLimit = level === 'easy' ? 75 : level === 'hard' ? 2200 : 700;
  const hasBoard = board.some(row => row.some(cell => cell.length)), starts = [];
  for (const direction of DIRECTIONS) for (let row = 0; row < BOARD_SIZE; row++) for (let col = 0; col < BOARD_SIZE; col++) {
    if (occupied(board, row - direction.dr, col - direction.dc)) continue;
    if (!hasBoard && (direction.dr === 0 ? row !== 4 && row !== 5 : col !== 4 && col !== 5)) continue;
    if (!hasBoard && (direction.dr === 0 ? col > 5 : row > 5)) continue;
    starts.push({ row, col, direction, distance: Math.abs(row - 4.5) + Math.abs(col - 4.5) });
  }
  starts.sort((a, b) => a.distance - b.distance || a.row - b.row || a.col - b.col);
  let nodes = 0, candidates = 0, best = null;
  const placed = [], used = new Set(), seen = new Set();
  const consider = () => {
    if (!placed.length || candidates >= candidateLimit) return;
    const key = placed.map(tile => `${tile.row},${tile.col},${rack[tile.rackIndex]}`).sort().join(';');
    if (seen.has(key)) return; seen.add(key);
    const preview = previewMove(game, placed, game.turn); if (!preview.valid) return;
    candidates++;
    // Easy prefers ordinary small plays. Higher levels maximize current score.
    const value = level === 'easy' ? preview.score - Math.max(0, placed.length - 3) * 6 : preview.score + placed.length * 0.025;
    if (!best || value > best.value) best = { value, placements: placed.map(tile => ({ ...tile })) };
  };
  for (const start of starts) {
    if (nodes >= nodeLimit || candidates >= candidateLimit) break;
    const walk = (row, col, depth, low, high, connected) => {
      if (nodes++ >= nodeLimit || candidates >= candidateLimit || !inBounds(row, col) || depth >= BOARD_SIZE) return;
      const cell = board[row][col], previous = top(cell), options = [];
      if (previous) options.push({ tile: previous, rackIndex: -1 });
      if (cell.length < MAX_HEIGHT) {
        const usedLetters = new Set();
        for (let index = 0; index < rack.length; index++) {
          if (!used.has(index) && rack[index] !== previous && !usedLetters.has(rack[index]) && crossAllowed(board, row, col, rack[index], start.direction)) {
            usedLetters.add(rack[index]); options.push({ tile: rack[index], rackIndex: index });
          }
        }
      }
      for (const option of options) {
        const coded = option.tile === 'QU' ? 'Q' : option.tile, [nextLow, nextHigh] = rangeFor(words, low, high, depth, coded);
        if (nextLow === nextHigh) continue;
        const put = option.rackIndex !== -1;
        if (put) { placed.push({ row, col, rackIndex: option.rackIndex }); used.add(option.rackIndex); }
        const attached = connected || !!previous || (!hasBoard && (row === 4 || row === 5) && (col === 4 || col === 5)) || DIRECTIONS.some(({ dr, dc }) => occupied(board, row + dr, col + dc) || occupied(board, row - dr, col - dc));
        const nextRow = row + start.direction.dr, nextCol = col + start.direction.dc;
        if (depth >= 1 && attached && words[nextLow].length === depth + 1 && !occupied(board, nextRow, nextCol)) consider();
        if (inBounds(nextRow, nextCol) && (placed.length < rack.length || occupied(board, nextRow, nextCol))) walk(nextRow, nextCol, depth + 1, nextLow, nextHigh, attached);
        if (put) { placed.pop(); used.delete(option.rackIndex); }
        if (nodes >= nodeLimit || candidates >= candidateLimit) break;
      }
    };
    walk(start.row, start.col, 0, 0, words.length, false);
  }
  if (best) return { type: 'play', placements: best.placements };
  const recentOwn = (game.history || []).filter(record => record.seat === game.turn).slice(-2);
  const bagCount = Array.isArray(game.bag) ? game.bag.length : game.bagCount;
  if (bagCount > 0 && !(recentOwn.length === 2 && recentOwn.every(record => record.type === 'exchange'))) {
    const awkward = ['QU', 'Z', 'J', 'X', 'V', 'K', 'W', 'Y'];
    const rackIndex = rack.findIndex(tile => awkward.includes(tile));
    return { type: 'exchange', rackIndex: rackIndex < 0 ? 0 : rackIndex };
  }
  return { type: 'pass' };
}
