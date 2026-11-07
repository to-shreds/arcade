import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, applyAction, validateGame } from './engine.js';

test('48 mixed movement and firing matches preserve exact resumable state at every action', () => {
  let moves = 0, rejectedMoves = 0, shots = 0, largestSave = 0;
  for (let seed = 101; seed < 149; seed++) {
    let game = createGame({ seed, starter: seed % 2, terrainType: ['flat', 'hilly', 'random'][seed % 3] });
    let rng = seed;
    const next = () => { rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0; return rng; };
    const step = action => {
      const before = JSON.stringify(game), previous = game;
      const after = applyAction(game, action);
      assert.equal(JSON.stringify(previous), before, 'Resolved actions do not change the original checkpoint');
      assert.deepEqual(applyAction(validateGame(JSON.parse(before)), action), after, 'A saved checkpoint resolves the same next action');
      assert.deepEqual(validateGame(JSON.parse(JSON.stringify(after))), after, 'Every mixed-action result can be loaded exactly');
      assert.ok(after.tanks.every((tank, seat) => tank.score >= previous.tanks[seat].score), 'Points never decrease');
      largestSave = Math.max(largestSave, JSON.stringify(after).length);
      game = after;
    };
    while (!game.finished) {
      const tank = game.tanks[game.turn];
      if (tank.movesLeft && next() % 3 !== 0) {
        const distance = (next() % 2 ? 1 : -1) * (1 + next() % 150);
        const before = JSON.stringify(game);
        try { step({ type: 'move', distance }); moves++; }
        catch (error) {
          // Only bounds/crossing rejection is valid. Any failure after applying
          // an accepted move must still fail this test.
          assert.match(error.message, /outside the battlefield|cannot pass through/);
          assert.equal(JSON.stringify(game), before, 'Rejected movement preserves the working checkpoint');
          rejectedMoves++;
        }
      }
      const actor = game.turn, inventory = game.tanks[actor].inventory;
      const angles = [0, .01, 15, 45, 89.99, 90, 90.01, 135, 179.99, 180];
      step({ type: 'fire', weaponId: inventory[next() % inventory.length], angle: angles[next() % angles.length], power: 1 + next() % 100 });
      shots++;
    }
    assert.equal(game.shotsTotal, 20);
    assert.ok(game.tanks.every(tank => tank.inventory.length === 0 && tank.shots === 10));
    assert.equal(game.mines.length, 0, 'A finished match resolves all remaining mines');
  }
  assert.equal(shots, 960);
  assert.ok(moves > 100, 'The sweep accepts varied movement between weapon resolutions');
  assert.ok(rejectedMoves > 0, 'The sweep also reaches movement boundaries');
  assert.ok(largestSave < 65536, 'Mixed-action checkpoints stay within the Nearby transfer limit');
  console.log(JSON.stringify({ mixedMatches: 48, shots, moves, rejectedMoves, largestSave }));
});
