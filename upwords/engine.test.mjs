import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, previewMove, applyAction, validateGame, publicGame, validatePublicGame, chooseCpuAction, TILE_COUNTS, BOARD_SIZE, RACK_SIZE, MAX_HEIGHT } from './engine.js';
import { isWord, DICTIONARY_ID } from './dictionary.js';

// Test fixtures redistribute the undeployed physical tiles without inventing
// letters. This keeps hand-calculated scoring positions valid saved games.
function withRack(game, tokens, seat = game.turn) {
  const copy = structuredClone(game);
  const pool = Object.entries(TILE_COUNTS).flatMap(([token, count]) => Array(count).fill(token));
  const take = token => { const index = pool.indexOf(token); assert.notEqual(index, -1, `fixture has an available ${token}`); pool.splice(index, 1); return token; };
  for (const row of copy.board) for (const cell of row) for (const tile of cell) take(tile);
  copy.players[seat].rack = tokens.map(take);
  while (copy.players[seat].rack.length < RACK_SIZE) copy.players[seat].rack.push(pool.pop());
  copy.players[1 - seat].rack = pool.splice(-RACK_SIZE);
  copy.bag = pool;
  return copy;
}
function placements(tokens, row, col, direction = 'horizontal') {
  return tokens.map((_, rackIndex) => ({ row: row + (direction === 'vertical' ? rackIndex : 0), col: col + (direction === 'horizontal' ? rackIndex : 0), rackIndex }));
}
function playAt(game, tokens, row, col, direction) {
  const prepared = withRack(game, tokens);
  return applyAction(prepared, { type: 'play', placements: placements(tokens, row, col, direction) });
}
function cat() { return playAt(createGame({ seed: 919 }), ['C', 'A', 'T'], 4, 3); }
function moodAndDear() {
  let game = playAt(createGame({ seed: 418 }), ['M', 'O', 'O', 'D'], 4, 3);
  game = playAt(game, ['E', 'A', 'R'], 5, 6, 'vertical');
  return game;
}

test('100 official tiles, deterministic private deals, and independent state objects', () => {
  assert.equal(Object.values(TILE_COUNTS).reduce((sum, count) => sum + count, 0), 100);
  assert.equal(TILE_COUNTS.QU, 1);
  assert.equal(TILE_COUNTS.Q, undefined);
  assert.equal(BOARD_SIZE, 10); assert.equal(RACK_SIZE, 7); assert.equal(MAX_HEIGHT, 5);
  const options = { seed: 123, names: ['Jon', 'Computer'], starter: 1 };
  const game = createGame(options);
  assert.deepEqual(game, createGame(options));
  assert.notDeepEqual(game.players, createGame({ ...options, seed: 456 }).players);
  assert.equal(game.turn, 1); assert.equal(game.moveNumber, 0); assert.equal(game.bag.length, 86);
  assert.ok(game.players.every(player => player.rack.length === 7 && player.score === 0));
  assert.equal(game.dictionaryId, DICTIONARY_ID);
  assert.deepEqual(validateGame(game), game);
  const restored = validateGame(game); restored.board[0][0].push('A');
  assert.deepEqual(game.board[0][0], []);
  assert.notEqual(game.board[0][0], game.board[0][1]);
});

test('opening words cross one center square, score twice each tile, and refill exactly', () => {
  const game = withRack(createGame({ seed: 1 }), ['C', 'A', 'T']);
  const before = structuredClone(game), action = { type: 'play', placements: placements(['C', 'A', 'T'], 4, 3) };
  const preview = previewMove(game, action.placements);
  assert.equal(preview.valid, true); assert.equal(preview.score, 6); assert.equal(preview.bonus, 0);
  assert.deepEqual(preview.words.map(word => [word.word, word.score]), [['CAT', 6]]);
  const after = applyAction(game, action);
  assert.deepEqual(game, before, 'neither preview nor apply mutates its input');
  assert.equal(after.players[0].score, 6); assert.equal(after.players[0].rack.length, 7);
  assert.equal(after.bag.length, 83); assert.equal(after.turn, 1); assert.equal(after.moveNumber, 1);
  assert.equal(after.history.length, 1); assert.equal(after.lastMove.type, 'play');
  assert.deepEqual(validateGame(after), after);
  for (const [row, col] of [[4, 4], [4, 5], [5, 4], [5, 5]]) {
    assert.equal(previewMove(game, placements(['C', 'A', 'T'], row, col)).valid, true);
  }
});

test('invalid placement shapes, forged tiles, wrong turns, and disconnection are rejected without mutation', () => {
  const game = withRack(createGame({ seed: 1 }), ['C', 'A', 'T', 'QU']);
  const invalid = [
    [], placements(Array(8).fill('A'), 4, 0), placements(['C', 'A', 'T'], 0, 0),
    [{ row: 4, col: 4, rackIndex: 0 }], [{ row: 4, col: 4, rackIndex: 3 }],
    [{ row: 4, col: 4, rackIndex: 0 }, { row: 5, col: 5, rackIndex: 1 }],
    [{ row: 4, col: 4, rackIndex: 0 }, { row: 4, col: 6, rackIndex: 1 }],
    [{ row: 4, col: 4, rackIndex: 0 }, { row: 4, col: 4, rackIndex: 1 }],
    [{ row: 4, col: 4, rackIndex: 0 }, { row: 4, col: 5, rackIndex: 0 }],
    [{ row: 4, col: 4, rackIndex: 20 }, { row: 4, col: 5, rackIndex: 1 }],
    [{ row: '4', col: 4, rackIndex: 0 }, { row: 4, col: 5, rackIndex: 1 }],
    [{ row: 4, col: 4, rackIndex: 0, tile: 'X' }, { row: 4, col: 5, rackIndex: 1 }],
    [{ row: 4, col: 4, rackIndex: -1 }, { row: 4, col: 5, rackIndex: 1 }],
    [{ row: 4, col: 10, rackIndex: 0 }, { row: 4, col: 9, rackIndex: 1 }]
  ];
  for (const attempt of invalid) {
    assert.equal(previewMove(game, attempt).valid, false, JSON.stringify(attempt));
    assert.throws(() => applyAction(game, { type: 'play', placements: attempt }));
  }
  assert.throws(() => applyAction(game, { type: 'pass' }, 1), /other player/);
  assert.throws(() => applyAction(game, { type: 'pass', score: 999 }));
  assert.throws(() => applyAction(game, { type: 'replace', state: game }));
  const established = withRack(cat(), ['D', 'O', 'G']);
  assert.match(previewMove(established, placements(['D', 'O', 'G'], 0, 0)).error, /Connect/);
  assert.deepEqual(game.board.flat().every(cell => cell.length === 0), true);
});

test('QU occupies one square, gets its flat-word bonus, and loses the bonus in stacked words', () => {
  let game = playAt(createGame(), ['QU', 'I', 'T'], 4, 4);
  assert.equal(game.lastMove.words[0].word, 'QUIT');
  assert.equal(game.lastMove.words[0].cells.length, 3);
  assert.equal(game.lastMove.score, 8, 'three flat tiles give six points, plus two for QU');
  game = playAt(game, ['D'], 4, 6);
  assert.equal(game.lastMove.words[0].word, 'QUID');
  assert.equal(game.lastMove.score, 4, 'one + one + two stacked tiles, without a QU bonus');
  validateGame(game);
});

test('one move scores each horizontal and vertical word exactly once, including common tiles', () => {
  let game = moodAndDear();
  assert.equal(game.history[0].score, 8); assert.equal(game.history[1].score, 8);
  game = withRack(game, ['N', 'T']);
  const action = { type: 'play', placements: [{ row: 5, col: 5, rackIndex: 0 }, { row: 5, col: 7, rackIndex: 1 }] };
  const preview = previewMove(game, action.placements);
  assert.equal(preview.valid, true);
  assert.deepEqual(preview.words.map(word => [word.word, word.score]).sort(), [['NET', 6], ['ON', 4]]);
  assert.equal(preview.score, 10);
  const after = applyAction(game, action); validateGame(after);
  const badCross = withRack(moodAndDear(), ['J', 'T']);
  assert.equal(isWord('JET'), true); assert.equal(isWord('OJ'), false);
  const rejected = previewMove(badCross, action.placements);
  assert.equal(rejected.valid, false); assert.match(rejected.error, /OJ/);
});

test('stacked words count all physical tiles and simultaneous changes use the final board', () => {
  let game = moodAndDear();
  game = playAt(game, ['W'], 4, 3);
  assert.deepEqual(game.lastMove.words.map(word => [word.word, word.score]), [['WOOD', 5]]);
  game = withRack(game, ['L', 'P']);
  game = applyAction(game, { type: 'play', placements: [{ row: 4, col: 6, rackIndex: 0 }, { row: 7, col: 6, rackIndex: 1 }] });
  assert.deepEqual(game.lastMove.words.map(word => [word.word, word.score]).sort(), [['LEAP', 6], ['WOOL', 6]]);
  assert.equal(game.lastMove.score, 12);
  assert.deepEqual(game.board[4][3], ['M', 'W']); assert.deepEqual(game.board[4][6], ['D', 'L']);
  validateGame(game);
});

test('stack height, same-letter stacking, and covering an entire old word are prohibited', () => {
  let game = cat();
  assert.match(previewMove(withRack(game, ['C']), [{ row: 4, col: 3, rackIndex: 0 }]).error, /same letter/);
  const replacement = withRack(game, ['D', 'O', 'G']);
  assert.equal(isWord('DOG'), true);
  assert.match(previewMove(replacement, placements(['D', 'O', 'G'], 4, 3)).error, /original letter/);
  const extended = withRack(game, ['D', 'O', 'G', 'S']);
  assert.match(previewMove(extended, placements(['D', 'O', 'G', 'S'], 4, 3)).error, /original letter/);
  for (const letter of ['B', 'C', 'B', 'C']) game = playAt(game, [letter], 4, 3);
  assert.equal(game.board[4][3].length, 5);
  assert.match(previewMove(withRack(game, ['B']), [{ row: 4, col: 3, rackIndex: 0 }]).error, /five tiles/);
  validateGame(game);
});

test('a bare S plural extension is rejected but an S that forms a crossing word is allowed', () => {
  let game = cat();
  assert.match(previewMove(withRack(game, ['S']), [{ row: 4, col: 6, rackIndex: 0 }]).error, /lone S/);
  game = playAt(game, ['A'], 3, 5); // AT vertically.
  game = playAt(game, ['A'], 3, 6); // AA horizontally.
  const attempt = previewMove(withRack(game, ['S']), [{ row: 4, col: 6, rackIndex: 0 }]);
  assert.equal(attempt.valid, true);
  assert.deepEqual(attempt.words.map(word => [word.word, word.score]).sort(), [['AS', 4], ['CATS', 8]]);
  assert.equal(attempt.score, 12);
  const hi = playAt(createGame(), ['H', 'I'], 4, 4);
  const his = previewMove(withRack(hi, ['S']), [{ row: 4, col: 6, rackIndex: 0 }]);
  assert.equal(his.valid, true, 'HIS is a different word, not a plural of HI');
  assert.equal(his.words[0].word, 'HIS'); assert.equal(his.score, 6);
});

test('playing all seven tiles adds exactly twenty points once', () => {
  const letters = [...'READING'];
  const game = playAt(createGame(), letters, 4, 1);
  assert.equal(game.lastMove.words[0].word, 'READING');
  assert.equal(game.lastMove.words[0].score, 14); assert.equal(game.lastMove.bonus, 20);
  assert.equal(game.lastMove.score, 34); assert.equal(game.players[0].score, 34);
  assert.equal(game.players[0].rack.length, 7); assert.equal(game.bag.length, 79);
  validateGame(game);
});

test('exchange draws before returning the tile, changes one rack slot, and consumes the turn', () => {
  const game = withRack(createGame({ seed: 81 }), ['Z']);
  const old = structuredClone(game), nextDraw = game.bag.at(-1);
  assert.notEqual(nextDraw, 'Z', 'only Z is on the rack');
  const after = applyAction(game, { type: 'exchange', rackIndex: 0 });
  assert.equal(after.players[0].rack[0], nextDraw);
  assert.deepEqual(after.players[0].rack.slice(1), old.players[0].rack.slice(1));
  assert.equal(after.bag.length, old.bag.length); assert.ok(after.bag.includes('Z'));
  assert.equal(after.turn, 1); assert.equal(after.players[0].score, 0); assert.equal(after.moveNumber, 1);
  assert.deepEqual(after.lastMove.placements, []); assert.deepEqual(after.lastMove.words, []);
  assert.equal(after.lastMove.rackIndex, undefined); assert.equal(after.lastMove.tile, undefined);
  assert.deepEqual(game, old); validateGame(after);
  assert.throws(() => applyAction(game, { type: 'exchange', rackIndex: 7 }));
  assert.throws(() => applyAction(game, { type: 'exchange', rackIndices: [0, 1] }));
});

test('two consecutive passes end the game and deduct five per remaining tile once', () => {
  const opening = cat();
  const first = applyAction(opening, { type: 'pass' });
  assert.equal(first.finished, false); assert.equal(first.passes, 1);
  const second = applyAction(first, { type: 'pass' });
  assert.equal(second.finished, true); assert.equal(second.endReason, 'passes'); assert.equal(second.passes, 2);
  assert.deepEqual(second.players.map(player => player.score), [-29, -35]); assert.equal(second.winner, 0);
  assert.throws(() => applyAction(second, { type: 'pass' }), /finished/);
  validateGame(second);
  const reset = applyAction(withRack(first, ['Z']), { type: 'exchange', rackIndex: 0 });
  assert.equal(reset.passes, 0); assert.equal(reset.finished, false); validateGame(reset);
  const tie = applyAction(applyAction(createGame(), { type: 'pass' }), { type: 'pass' });
  assert.equal(tie.winner, null); assert.deepEqual(tie.players.map(player => player.score), [-35, -35]);
});

test('room views keep bag order, RNG, and other racks private while preserving legal previews', () => {
  let game = withRack(cat(), ['B']);
  for (const seat of [0, 1, null, 99]) {
    const view = publicGame(game, seat);
    assert.equal(view.seed, undefined); assert.equal(view.rng, undefined); assert.equal(view.bag, undefined);
    assert.equal(view.bagCount, game.bag.length);
    for (const index of [0, 1]) {
      assert.equal(view.players[index].rackCount, game.players[index].rack.length);
      assert.equal(Object.hasOwn(view.players[index], 'rack'), index === seat);
    }
    assert.deepEqual(validatePublicGame(view, seat), view);
  }
  const view = publicGame(game, 1), move = [{ row: 4, col: 3, rackIndex: 0 }];
  assert.deepEqual(previewMove(view, move, 1), previewMove(game, move, 1));
  assert.equal(previewMove(view, move, 0).valid, false);
  assert.deepEqual(chooseCpuAction(view), chooseCpuAction(game), 'CPU uses only information available to its player');
  game = applyAction(game, { type: 'exchange', rackIndex: 0 });
  const safe = publicGame(game, 0);
  assert.equal(safe.lastMove.tile, undefined); assert.equal(safe.lastMove.rackIndex, undefined);
  assert.deepEqual(safe.lastMove.words, []); validatePublicGame(safe, 0);
  const injected = structuredClone(safe); injected.seed = 123;
  assert.throws(() => validatePublicGame(injected, 0));
  const revealed = structuredClone(safe); revealed.players[1].rack = game.players[1].rack;
  assert.throws(() => validatePublicGame(revealed, 0));
});

test('corrupt saves fail validation before they can replace a working game', () => {
  const game = cat();
  const corruptions = [
    state => { state.schema = 2; }, state => { state.dictionaryId = 'another-list'; },
    state => { state.board.pop(); }, state => { state.board[0].pop(); },
    state => { state.board[4][3][0] = 'Q'; }, state => { state.board[4][3].push('C'); },
    state => { state.board[0][0].push('A'); state.bag.splice(state.bag.indexOf('A'), 1); },
    state => { state.board[4][3][0] = 'Z'; },
    state => { state.bag.push('A'); }, state => { state.bag[0] = 'INVALID'; },
    state => { state.players[0].rack.push('A'); }, state => { state.players[0].rack[0] = 'Q'; },
    state => { state.players[0].score = NaN; }, state => { state.players[0].score = -1; },
    state => { state.players[0].score += 1; },
    state => { state.players[0].name = ''; }, state => { state.turn = 0; },
    state => { state.moveNumber = -1; }, state => { state.passes = 2; },
    state => { state.finished = true; }, state => { state.winner = 1; },
    state => { state.seed = 0; }, state => { state.rng = 0; },
    state => { state.history = []; }, state => { state.lastMove.score += 1; },
    state => { state.history[0].words[0].cells[0].row = 80; }
  ];
  for (const corrupt of corruptions) {
    const copy = structuredClone(game); corrupt(copy);
    assert.throws(() => validateGame(copy), corrupt.toString());
  }
  assert.deepEqual(validateGame(game), game);
});

test('CPU finds stacked plays, handles every difficulty, and returns only legal deterministic actions', () => {
  const game = withRack(cat(), ['B', 'Z', 'X', 'J', 'K', 'V', 'W']);
  for (const difficulty of ['easy', 'normal', 'hard']) {
    const action = chooseCpuAction(game, difficulty);
    assert.deepEqual(action, chooseCpuAction(game, difficulty));
    assert.equal(action.type, 'play');
    assert.equal(previewMove(game, action.placements).valid, true);
    validateGame(applyAction(game, action));
  }
});

test('CPU spells QU as one tile while the dictionary keeps legitimate bare-Q words', () => {
  assert.equal(isWord('QI'), true); assert.equal(isWord('QAT'), true);
  const game = withRack(createGame({ seed: 71 }), ['QU', 'I', 'E', 'T', 'Z', 'J', 'X']);
  const action = chooseCpuAction(game, 'normal');
  assert.equal(action.type, 'play');
  const preview = previewMove(game, action.placements);
  assert.equal(preview.valid, true);
  assert.ok(preview.placements.some(placement => placement.tile === 'QU'));
  assert.ok(preview.words.every(({ word }) => !word.replace(/QU/g, '').includes('Q')));
  assert.ok(preview.words.some(({ word }) => word === 'QUIET' || word === 'QUITE'));
  validateGame(applyAction(game, action));
});

test('complete CPU games conserve all tiles, resume exactly, bound history, and finish both ways', context => {
  const endings = new Set(), matches = []; let largest = 0;
  for (const seed of [1, 2, 3, 4, 19, 88]) {
    let game = createGame({ seed, starter: seed % 2 });
    while (!game.finished && game.moveNumber < 150) {
      const before = game, action = chooseCpuAction(game, 'normal');
      const saved = validateGame(JSON.parse(JSON.stringify(game)));
      game = applyAction(saved, action);
      assert.deepEqual(game, applyAction(before, action), 'resumed turns reproduce every tile and score');
      validateGame(game); validatePublicGame(publicGame(game, game.turn), game.turn);
      largest = Math.max(largest, JSON.stringify(game).length);
      assert.equal(game.history.length, Math.min(12, game.moveNumber));
      assert.equal(game.moveNumber, before.moveNumber + 1);
      if (game.finished) {
        const expected = before.players.map((player, seat) => player.score + (seat === before.turn ? game.lastMove.score : 0) - 5 * game.players[seat].rack.length);
        assert.deepEqual(game.players.map(player => player.score), expected, 'final deductions occur once after scoring the final move');
      }
    }
    assert.equal(game.finished, true, `seed ${seed} must finish`);
    endings.add(game.endReason);
    matches.push({ seed, moves: game.moveNumber, end: game.endReason });
    if (game.endReason === 'rack-empty') {
      assert.equal(game.bag.length, 0); assert.ok(game.players.some(player => player.rack.length === 0));
      assert.throws(() => applyAction(game, { type: 'exchange', rackIndex: 0 }), /finished/);
    }
  }
  assert.deepEqual([...endings].sort(), ['passes', 'rack-empty']);
  assert.ok(largest < 48000, `bounded history keeps a full game below checkpoint cap (${largest})`);
  context.diagnostic(JSON.stringify({ matches, largestSaveBytes: largest }));
});
