import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, applyAction, validateGame, chooseCpuAction, WIDTH, HEIGHT, MAX_MOVE } from './engine.js';
import { WEAPONS, WEAPON_KINDS, weaponById } from './weapons.js';

function armed(weapon, options = {}) {
  const game = createGame({ seed: 12345, terrainType: 'flat', ...options });
  const inventory = game.tanks[game.turn].inventory;
  if (!inventory.includes(weapon.id)) inventory[0] = weapon.id;
  return game;
}
test('84 distinct mechanics profiles, IDs and matching procedural graphics', () => {
  assert.ok(WEAPONS.length >= 80);
  assert.equal(new Set(WEAPONS.map(w => w.id)).size, WEAPONS.length);
  const signatures = WEAPONS.map(({ id, name, description, color, icon, iconVariant, ...mechanics }) => JSON.stringify(mechanics));
  assert.equal(new Set(signatures).size, WEAPONS.length);
  for (const weapon of WEAPONS) {
    assert.ok(weapon.description.length > 10);
    assert.ok(WEAPON_KINDS.includes(weapon.icon));
    assert.ok(/^#[\da-f]{6}$/i.test(weapon.color));
    assert.equal(weaponById(weapon.id), weapon);
  }
});
test('deals ten distinct weapons and deterministic terrain and inventory', () => {
  for (const terrainType of ['flat', 'hilly', 'random']) {
    const options = { terrainType, seed: 88931, names: ['Jon', 'CPU'], colors: ['#ff3300', '#1188bb'], starter: 1 };
    const left = createGame(options), right = createGame(options);
    assert.deepEqual(left, right);
    assert.equal(left.turn, 1);
    assert.equal(left.tanks[0].name, 'Jon');
    assert.equal(left.tanks[0].color, '#ff3300');
    for (const tank of left.tanks) {
      assert.equal(tank.inventory.length, 10);
      assert.equal(new Set(tank.inventory).size, 10);
      assert.equal(tank.movesLeft, 4);
      assert.equal(tank.score, 0);
    }
    assert.deepEqual(validateGame(left), left);
  }
});
test('every weapon resolves deterministic graphics, finite terrain, and a small resumable checkpoint', () => {
  for (const weapon of WEAPONS) {
    for (const terrainType of ['flat', 'hilly', 'random']) {
      const game = armed(weapon, { terrainType });
      const action = { type: 'fire', weaponId: weapon.id, angle: 50, power: 67 };
      const after = applyAction(game, action);
      assert.deepEqual(after, applyAction(game, action), `${weapon.id}: deterministic resolution`);
      assert.equal(game.shotsTotal, 0, `${weapon.id}: no mutation`);
      assert.equal(after.shotsTotal, 1);
      assert.equal(after.tanks[0].inventory.length, 9);
      assert.ok(!after.tanks[0].inventory.includes(weapon.id));
      assert.equal(after.lastShot.weaponId, weapon.id);
      assert.ok(after.lastShot.paths.length > 0, `${weapon.id}: projectile graphics`);
      assert.ok(after.lastShot.effects.length > 0, `${weapon.id}: impact/miss graphics`);
      assert.ok(after.terrain.every(y => Number.isFinite(y) && y >= 190 && y <= HEIGHT));
      assert.ok(after.tanks.every(tank => tank.score >= 0));
      assert.ok(JSON.stringify(after).length < 65536, `${weapon.id}: Nearby checkpoint size`);
      assert.deepEqual(validateGame(after), after, `${weapon.id}: save round trip`);
    }
  }
});
test('moves remain in turn, consume exactly four successful actions, reject crossing/edges', () => {
  let game = createGame({ seed: 27, terrainType: 'flat' });
  assert.throws(() => applyAction(game, { type: 'move', distance: -MAX_MOVE }), /outside/);
  assert.equal(game.tanks[0].movesLeft, 4);
  for (let index = 0; index < 4; index++) {
    game = applyAction(game, { type: 'move', distance: index % 2 ? -50 : 50 });
    assert.equal(game.turn, 0);
    assert.equal(game.shotsTotal, 0);
    assert.equal(game.tanks[0].movesLeft, 3 - index);
    validateGame(game);
  }
  assert.throws(() => applyAction(game, { type: 'move', distance: 20 }), /No moves/);
  assert.throws(() => applyAction(createGame(), { type: 'move', distance: 151 }), /150/);
  const close = createGame({ terrainType: 'flat' });
  close.tanks[0].x = 700;
  assert.throws(() => applyAction(close, { type: 'move', distance: 150 }), /pass/);
});
test('all twenty shots finish, points are monotonic, save/resume and CPU are deterministic', () => {
  for (let seed = 1; seed <= 8; seed++) {
    let game = createGame({ seed, terrainType: ['flat', 'hilly', 'random'][seed % 3], starter: seed % 2 });
    for (let shot = 0; shot < 20; shot++) {
      const before = game.tanks.map(tank => tank.score);
      const action = chooseCpuAction(game, shot % 3 === 0 ? 'easy' : 'hard');
      assert.deepEqual(action, chooseCpuAction(game, shot % 3 === 0 ? 'easy' : 'hard'));
      game = applyAction(validateGame(JSON.parse(JSON.stringify(game))), action);
      assert.ok(game.tanks.every((tank, index) => tank.score >= before[index]));
      assert.equal(game.shotsTotal, shot + 1);
      validateGame(game);
    }
    assert.equal(game.finished, true);
    assert.ok(game.tanks.every(tank => tank.shots === 10 && tank.inventory.length === 0));
    assert.equal(game.mines.length, 0);
    assert.equal(game.winner, game.tanks[0].score === game.tanks[1].score ? null : Number(game.tanks[1].score > game.tanks[0].score));
    assert.throws(() => applyAction(game, { type: 'move', distance: 10 }), /finished/);
  }
});
test('direct hit awards shooter points, self-hit awards opponent points', () => {
  const weapon = weaponById('cannonball');
  let game = armed(weapon);
  game.tanks[1].x = 210;
  const opponent = applyAction(game, { type: 'fire', weaponId: weapon.id, angle: 0, power: 25 });
  assert.ok(opponent.tanks[0].score > 0);
  assert.equal(opponent.tanks[1].score, 0);
  const self = applyAction(armed(weapon), { type: 'fire', weaponId: weapon.id, angle: 90, power: 1 });
  assert.ok(self.tanks[1].score > 0);
  assert.equal(self.tanks[0].score, 0);
});
test('terrain builders, rolling bombs, tunnels and electric chains use their mechanical dimensions', () => {
  const action = { type: 'fire', angle: 45, power: 35 };
  const builder = applyAction(armed(weaponById('mountain-maker')), { ...action, weaponId: 'mountain-maker' });
  assert.ok(builder.terrain.filter(y => y < 399).length >= 20, 'wide mound builds across its declared width');
  const roller = applyAction(armed(weaponById('runaway-marble')), { ...action, weaponId: 'runaway-marble' });
  const xs = roller.lastShot.effects.filter(effect => effect.kind === 'explosion').map(effect => effect.x);
  assert.equal(xs.length, 9);
  assert.ok(Math.max(...xs) - Math.min(...xs) > 200, 'rolling bombs detonate along travel path');
  const lightning = applyAction(armed(weaponById('ground-current')), { ...action, weaponId: 'ground-current' });
  assert.equal(lightning.lastShot.effects.filter(effect => effect.kind === 'lightning').length, 7, 'main bolt plus six ground links');
  const tunnel = applyAction(armed(weaponById('worm-trail')), { ...action, weaponId: 'worm-trail' });
  assert.ok(tunnel.terrain.filter(y => y > 400).length >= 20, 'underground tunnel leaves a collapsed channel');
});
test('mines persist with fuse until later shots, preserve ownership and resume exactly', () => {
  const start = armed(weaponById('slow-bloom'));
  let game = applyAction(start, { type: 'fire', weaponId: 'slow-bloom', angle: 45, power: 35 });
  assert.equal(game.mines.length, 3);
  assert.ok(game.mines.every(mine => mine.fuse === 3 && mine.owner === 0));
  const restored = validateGame(JSON.parse(JSON.stringify(game)));
  const fire = { type: 'fire', weaponId: game.tanks[game.turn].inventory[0], angle: 90, power: 1 };
  assert.deepEqual(applyAction(game, fire), applyAction(restored, fire));
  game = applyAction(game, fire);
  assert.ok(game.mines.every(mine => mine.fuse === 2));
  for (let index = 0; index < 2; index++) game = applyAction(game, { type: 'fire', weaponId: game.tanks[game.turn].inventory[0], angle: 90, power: 1 });
  assert.ok(!game.mines.some(mine => mine.id.startsWith('1:')));
});
test('hard CPU aims straight beams at an available direct target', () => {
  let game = createGame({ seed: 881, terrainType: 'flat' });
  for (let index = 0; index < 8; index++) game = applyAction(game, { type: 'fire', weaponId: game.tanks[game.turn].inventory[0], angle: 90, power: 1 });
  game.terrain.fill(400);
  game.tanks.forEach(tank => { tank.y = 400; });
  game.tanks[1].x = 210;
  game.tanks[0].inventory = WEAPONS.filter(weapon => weapon.kind === 'beam').map(weapon => weapon.id);
  const action = chooseCpuAction(game, 'hard');
  assert.ok(action.angle <= 2);
  const after = applyAction(game, action);
  assert.ok(after.lastShot.scoreGain[0] >= 90);
});
test('invalid saves and actions are rejected before they alter play', () => {
  const base = createGame({ seed: 99 });
  const corruptions = [
    game => { game.terrain[0] = NaN; }, game => { game.tanks[0].score = -1; },
    game => { game.tanks[0].movesLeft = 5; }, game => { game.tanks[0].inventory[0] = 'invented'; },
    game => { game.tanks[0].inventory[1] = game.tanks[0].inventory[0]; }, game => { game.turn = 1; },
    game => { game.shotsTotal = 1; }, game => { game.finished = true; }, game => { game.tanks[0].x = WIDTH + 1; },
    game => { game.tanks[0].y -= 100; }, game => { game.seed = 0; }, game => { game.winner = 1; },
  ];
  for (const corrupt of corruptions) { const game = structuredClone(base); corrupt(game); assert.throws(() => validateGame(game)); }
  for (const action of [
    { type: 'fire', weaponId: base.tanks[0].inventory[0], angle: NaN, power: 20 },
    { type: 'fire', weaponId: base.tanks[0].inventory[0], angle: 20, power: 101 },
    { type: 'fire', weaponId: 'invented', angle: 20, power: 20 }, { type: 'move', distance: Infinity },
  ]) assert.throws(() => applyAction(base, action));
  assert.throws(() => applyAction(base, { type: 'move', distance: 10 }, 1), /other player/);
  assert.deepEqual(base, createGame({ seed: 99 }));
});
