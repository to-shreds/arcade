import { WEAPONS, weaponById } from './weapons.js';

export const WIDTH = 1000;
export const HEIGHT = 560;
export const TANK_WIDTH = 30;
export const MAX_MOVE = TANK_WIDTH * 5;
export const TERRAIN_SAMPLES = 251;
const STEP = WIDTH / (TERRAIN_SAMPLES - 1);
const MIN_X = 45, MAX_X = WIDTH - MIN_X, MIN_GROUND = 190, MAX_GROUND = 540;
const GRAVITY = 110, DT = 1 / 30, MAX_TICKS = 360;
const MAX_POINTS = 1100, MAX_EFFECTS = 120, MAX_MINES = 64;
const COLORS = ['#35cbea', '#f877ad'];
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const round = value => Math.round(value * 100) / 100;
const clone = value => JSON.parse(JSON.stringify(value));
const finite = value => typeof value === 'number' && Number.isFinite(value);
const integer = value => Number.isSafeInteger(value);
function assert(ok, message) { if (!ok) throw new Error(message); }
function seedNumber(value) {
  if (integer(value)) return (value >>> 0) || 0x6d2b79f5;
  let result = 2166136261;
  for (const char of String(value ?? 'arcade-tanks')) result = Math.imul(result ^ char.charCodeAt(0), 16777619);
  return (result >>> 0) || 0x6d2b79f5;
}
function random(state) {
  let value = state.rng;
  value ^= value << 13; value ^= value >>> 17; value ^= value << 5;
  state.rng = value >>> 0;
  return state.rng / 4294967296;
}
function shuffle(state, values) {
  const output = values.slice();
  for (let index = output.length - 1; index > 0; index--) {
    const other = Math.floor(random(state) * (index + 1));
    [output[index], output[other]] = [output[other], output[index]];
  }
  return output;
}
export function groundAt(state, x) {
  const index = clamp(x, 0, WIDTH) / STEP, left = Math.floor(index), right = Math.min(TERRAIN_SAMPLES - 1, left + 1);
  return state.terrain[left] + (state.terrain[right] - state.terrain[left]) * (index - left);
}
function supportAt(state, x) {
  return round(Math.min(groundAt(state, x - TANK_WIDTH * .4), groundAt(state, x), groundAt(state, x + TANK_WIDTH * .4)));
}
function settle(state) { for (const tank of state.tanks) tank.y = supportAt(state, tank.x); }
function tankCenter(tank) { return { x: tank.x, y: tank.y - 12 }; }
function terrain(state, type) {
  const phase = random(state) * Math.PI * 2;
  const phase2 = random(state) * Math.PI * 2;
  const amplitude = 32 + random(state) * 35;
  for (let index = 0; index < TERRAIN_SAMPLES; index++) {
    const x = index * STEP;
    const base = type === 'flat' ? 400 : type === 'hilly'
      ? 402 + Math.sin(x / 155 + phase) * amplitude + Math.sin(x / 390 + phase2) * 24
      : 402 + Math.sin(x / 99 + phase) * 37 + Math.sin(x / 207 + phase2) * 52 + Math.cos(x / 44 + phase) * 12;
    state.terrain.push(round(clamp(base, 255, 495)));
  }
  // The initial platforms provide a clean muzzle and readable starting position.
  for (const center of [130, 870]) {
    const y = groundAt(state, center);
    for (let index = 0; index < TERRAIN_SAMPLES; index++) {
      const distance = Math.abs(index * STEP - center);
      if (distance < 26) state.terrain[index] = round(y);
    }
  }
}
export function createGame(options = {}) {
  const type = options.terrainType ?? 'random';
  assert(['flat', 'hilly', 'random'].includes(type), 'Choose flat, hilly, or random terrain.');
  const starter = options.starter ?? 0;
  assert(starter === 0 || starter === 1, 'Invalid starting player.');
  const seed = seedNumber(options.seed);
  const state = { schema: 1, seed, rng: seed, starter, terrainType: type, terrain: [], tanks: [], turn: starter,
    shotsTotal: 0, finished: false, winner: null, mines: [], lastShot: null, lastMove: null };
  terrain(state, type);
  for (let index = 0; index < 2; index++) {
    const name = String(options.names?.[index] ?? `Player ${index + 1}`).trim().slice(0, 30) || `Player ${index + 1}`;
    const color = /^#[\da-f]{6}$/i.test(options.colors?.[index] ?? '') ? options.colors[index].toLowerCase() : COLORS[index];
    state.tanks.push({ x: index === 0 ? 130 : 870, y: 0, name, color, score: 0, movesLeft: 4,
      inventory: shuffle(state, WEAPONS.map(weapon => weapon.id)).slice(0, 10), shots: 0 });
  }
  settle(state);
  return state;
}

function newTrace(state, actor, weapon, angle, power) {
  return { sequence: state.shotsTotal + 1, actor, weaponId: weapon.id, angle, power,
    scoreGain: [0, 0], paths: [], effects: [], duration: 30 };
}
function addEffect(trace, kind, color, x, y, radius, tick, extra = {}) {
  trace.duration = Math.max(trace.duration, Math.min(MAX_TICKS, Math.ceil(tick) + 24));
  if (trace.effects.length < MAX_EFFECTS) trace.effects.push({ kind, color, x: round(x), y: round(y),
    radius: round(clamp(radius, 1, WIDTH)), tick: Math.round(clamp(tick, 0, MAX_TICKS)), ...extra });
}
function addPath(trace, kind, color, points) {
  if (!points.length) return;
  const used = trace.paths.reduce((sum, path) => sum + path.points.length, 0);
  const remaining = MAX_POINTS - used;
  if (remaining < 2) return;
  const budget = Math.min(100, remaining), every = Math.max(1, Math.ceil(points.length / budget));
  const compact = points.filter((_, index) => index % every === 0).map(point => [round(point[0]), round(point[1]), Math.round(clamp(point[2], 0, MAX_TICKS))]);
  const last = points[points.length - 1];
  if (compact.length < budget && (compact[compact.length - 1][0] !== round(last[0]) || compact[compact.length - 1][1] !== round(last[1]))) {
    compact.push([round(last[0]), round(last[1]), Math.round(clamp(last[2], 0, MAX_TICKS))]);
  }
  trace.paths.push({ kind, color, points: compact });
  trace.duration = Math.max(trace.duration, Math.min(MAX_TICKS, Math.round(last[2]) + 24));
}
function crater(state, x, y, radius, scale = 1) {
  const size = clamp(radius * Math.sqrt(Math.max(.05, scale)), 2, 190);
  for (let index = Math.max(0, Math.floor((x - size) / STEP)); index <= Math.min(TERRAIN_SAMPLES - 1, Math.ceil((x + size) / STEP)); index++) {
    const dx = index * STEP - x;
    if (Math.abs(dx) >= size) continue;
    const root = Math.sqrt(size * size - dx * dx);
    // A below-ground blast reaches the surface only if its upper hemisphere does.
    if (y - root <= state.terrain[index] + 2) state.terrain[index] = round(clamp(Math.max(state.terrain[index], y + root), MIN_GROUND, MAX_GROUND));
  }
}
function blast(state, trace, actor, weapon, x, y, damage, radius, tick, kind = 'explosion', options = {}) {
  const color = options.color ?? weapon.color;
  const damageRadius = Math.max(5, radius);
  for (let target = 0; target < 2; target++) {
    const center = tankCenter(state.tanks[target]);
    const distance = Math.max(0, Math.hypot(center.x - x, center.y - y) - TANK_WIDTH * .42);
    const ratio = clamp(1 - distance / damageRadius, 0, 1);
    const gain = Math.round(Math.max(0, damage) * Math.pow(ratio, weapon.falloff ?? 1));
    const scorer = target === actor ? 1 - actor : actor;
    state.tanks[scorer].score += gain;
    trace.scoreGain[scorer] += gain;
  }
  if (options.carve !== false) crater(state, x, y, radius, weapon.craterScale ?? 1);
  addEffect(trace, kind, color, x, y, radius, tick, { duration: 24 });
  settle(state);
}
function muzzle(state, actor, angle) {
  const tank = state.tanks[actor], radians = angle * Math.PI / 180;
  return { x: tank.x + Math.cos(radians) * 23, y: tank.y - 15 - Math.sin(radians) * 23 };
}
function projectile(state, actor, weapon, angle, power, trace, options = {}) {
  const radians = angle * Math.PI / 180;
  const origin = options.origin ?? muzzle(state, actor, angle);
  const speed = 60 + power * 4.4;
  let x = origin.x, y = origin.y, vx = options.vx ?? Math.cos(radians) * speed, vy = options.vy ?? -Math.sin(radians) * speed;
  let bounces = options.bounces ?? 0;
  const start = options.startTick ?? 0, points = [[x, y, start]], limit = MAX_TICKS - start - 25;
  for (let step = 1; step <= limit; step++) {
    const previousX = x, previousY = y;
    vy += GRAVITY * DT;
    x += vx * DT; y += vy * DT;
    const tick = start + step;
    if (step % 2 === 0) points.push([x, y, tick]);
    if (options.splitAtApex && vy >= 0 && step >= 5) {
      points.push([x, y, tick]); addPath(trace, weapon.kind, weapon.color, points);
      return { x, y, vx, vy, tick, split: true, missed: false };
    }
    // Swept collision prevents fast, narrow weapons skipping a tank or ridge.
    const pieces = Math.max(1, Math.ceil(Math.hypot(x - previousX, y - previousY) / 5));
    let collision = null;
    for (let piece = 1; piece <= pieces; piece++) {
      const part = piece / pieces, px = previousX + (x - previousX) * part, py = previousY + (y - previousY) * part;
      for (let target = 0; target < 2; target++) {
        if (target === actor && step < 5 && !options.origin) continue;
        const center = tankCenter(state.tanks[target]);
        if (Math.abs(px - center.x) <= 16 && Math.abs(py - center.y) <= 12) collision = { x: px, y: py, target };
      }
      if (!collision && px >= 0 && px <= WIDTH && py >= groundAt(state, px)) collision = { x: px, y: groundAt(state, px), target: null };
      if (collision) break;
    }
    if (collision) {
      x = collision.x; y = collision.y;
      if (bounces > 0 && collision.target === null && Math.abs(vx) > 10) {
        bounces--;
        const slope = (groundAt(state, x + 5) - groundAt(state, x - 5)) / 10;
        const nx = slope / Math.sqrt(1 + slope * slope), ny = -1 / Math.sqrt(1 + slope * slope);
        const dot = vx * nx + vy * ny;
        vx = (vx - 2 * dot * nx) * .76;
        vy = Math.min(-35, (vy - 2 * dot * ny) * .68);
        y -= 5;
        addEffect(trace, 'bounce', weapon.color, x, y, 10, tick);
        points.push([x, y, tick]);
        continue;
      }
      points.push([x, y, tick]); addPath(trace, weapon.kind, weapon.color, points);
      return { x, y, vx, vy, tick, target: collision.target, missed: false };
    }
    if (x < -35 || x > WIDTH + 35 || y > HEIGHT + 35 || y < -1800) {
      points.push([clamp(x, -35, WIDTH + 35), clamp(y, -1800, HEIGHT + 35), tick]); addPath(trace, weapon.kind, weapon.color, points);
      return { x: clamp(x, 0, WIDTH), y: clamp(y, -1800, HEIGHT), vx, vy, tick, missed: true };
    }
  }
  addPath(trace, weapon.kind, weapon.color, points);
  return { x: clamp(x, 0, WIDTH), y: clamp(y, -1800, HEIGHT), vx, vy, tick: MAX_TICKS - 25, missed: true };
}
function markedImpact(state, trace, actor, weapon, angle, power, options) {
  const impact = projectile(state, actor, weapon, angle, power, trace, options);
  if (impact.missed) addEffect(trace, 'miss', weapon.color, impact.x, impact.y, 8, impact.tick);
  return impact;
}
function triggerMines(state, trace, actor, all = false, age = true) {
  const keep = [];
  for (const mine of state.mines) {
    if (age) mine.fuse--;
    mine.y = groundAt(state, mine.x) - 3 + (mine.depth ?? 0);
    const near = state.tanks.some(tank => Math.abs(tank.x - mine.x) <= Math.max(22, mine.radius * .65));
    if (all || mine.fuse <= 0 || near) {
      const weapon = { color: mine.color, falloff: mine.falloff ?? .8, craterScale: mine.craterScale ?? .7 };
      blast(state, trace, mine.owner, weapon, mine.x, mine.y, mine.damage, mine.radius, Math.min(MAX_TICKS - 25, trace.duration), 'mine');
    } else keep.push(mine);
  }
  state.mines = keep;
}
function resolveBeam(state, trace, actor, weapon, angle, power) {
  const origin = muzzle(state, actor, angle), radians = angle * Math.PI / 180;
  const length = (weapon.reach ?? WIDTH) * (.5 + power / 200);
  const dx = Math.cos(radians), dy = -Math.sin(radians), width = weapon.width ?? 12;
  let end = { ...origin };
  const hit = new Set();
  for (let distance = 0; distance <= length; distance += 5) {
    const x = origin.x + dx * distance, y = origin.y + dy * distance;
    if (x < 0 || x > WIDTH || y < -HEIGHT || y > HEIGHT) break;
    end = { x, y };
    for (let target = 0; target < 2; target++) {
      if (target === actor && distance < 30) continue;
      const center = tankCenter(state.tanks[target]);
      if (!hit.has(target) && Math.hypot(center.x - x, center.y - y) < width / 2 + 17) {
        hit.add(target);
        const scorer = target === actor ? 1 - actor : actor;
        const gain = Math.round(weapon.damage);
        state.tanks[scorer].score += gain; trace.scoreGain[scorer] += gain;
      }
    }
    if (y >= groundAt(state, x)) {
      crater(state, x, y, width / 2 + 3, weapon.craterScale ?? 1);
      if (!weapon.pierce) break;
    }
  }
  addPath(trace, 'beam', weapon.color, [[origin.x, origin.y, 0], [end.x, end.y, 12]]);
  addEffect(trace, 'beam', weapon.color, origin.x, origin.y, width / 2, 1, { x2: round(end.x), y2: round(end.y), duration: 18 });
  addEffect(trace, 'spark', weapon.color, end.x, end.y, width + 8, 12);
  settle(state);
}
function resolveWeapon(state, trace, actor, weapon, angle, power) {
  const count = clamp(Math.round(weapon.count ?? 1), 1, 16), damage = weapon.damage ?? 60, radius = weapon.radius ?? 35;
  const spread = weapon.spread ?? 20, reach = weapon.reach ?? 180, depth = weapon.depth ?? 45;
  if (weapon.kind === 'beam') { resolveBeam(state, trace, actor, weapon, angle, power); return; }
  if (weapon.kind === 'burst') {
    for (let index = 0; index < count; index++) {
      const offset = count === 1 ? 0 : (index / (count - 1) - .5) * spread;
      const impact = markedImpact(state, trace, actor, weapon, clamp(angle + offset, 0, 180), power, { startTick: index * 3 });
      if (!impact.missed) blast(state, trace, actor, weapon, impact.x, impact.y, damage / count, radius, impact.tick);
    }
    return;
  }
  const impact = markedImpact(state, trace, actor, weapon, angle, power, { splitAtApex: weapon.kind === 'cluster', bounces: weapon.kind === 'bounce' ? weapon.bounces : 0 });
  if (impact.missed) return;
  const direction = Math.sign(impact.vx) || (actor === 0 ? 1 : -1);
  if (weapon.kind === 'cluster' && impact.split) {
    for (let index = 0; index < count; index++) {
      const offset = count === 1 ? 0 : (index / (count - 1) - .5) * spread * Math.PI / 180;
      const baseAngle = Math.atan2(impact.vy, impact.vx), speed = Math.hypot(impact.vx, impact.vy) * .72;
      const child = markedImpact(state, trace, actor, weapon, angle, power, { origin: impact,
        vx: Math.cos(baseAngle + offset) * speed, vy: Math.sin(baseAngle + offset) * speed + 24, startTick: impact.tick });
      if (!child.missed) blast(state, trace, actor, weapon, child.x, child.y, damage / count, radius, child.tick);
    }
    return;
  }
  if (weapon.kind === 'roller') {
    let x = impact.x, y = groundAt(state, x) - 4;
    const points = [[x, y, impact.tick]];
    const steps = Math.max(1, Math.ceil(reach / 8));
    for (let index = 1; index <= steps; index++) {
      const next = clamp(x + direction * 8, 5, WIDTH - 5), ground = groundAt(state, next);
      if (Math.abs(ground - y) > (weapon.climb ?? 50)) break;
      x = next; y = ground - 4;
      points.push([x, y, impact.tick + index]);
      if (state.tanks.some(tank => Math.abs(tank.x - x) < 19)) break;
    }
    addPath(trace, 'roller', weapon.color, points);
    for (let index = 0; index < count; index++) {
      const point = points[count === 1 ? points.length - 1 : Math.round(index * (points.length - 1) / (count - 1))];
      blast(state, trace, actor, weapon, point[0], groundAt(state, point[0]) - 3, damage / count, radius, point[2]);
    }
    return;
  }
  if (weapon.kind === 'drill') {
    const drillCount = Math.max(2, count);
    for (let index = 0; index < drillCount; index++) {
      const y = clamp(impact.y + depth * index / (drillCount - 1), MIN_GROUND, MAX_GROUND);
      blast(state, trace, actor, weapon, impact.x, y, damage / drillCount, radius, impact.tick + index * 7, 'drill');
    }
    addPath(trace, 'drill', weapon.color, [[impact.x, impact.y, impact.tick], [impact.x, clamp(impact.y + depth, MIN_GROUND, MAX_GROUND), impact.tick + drillCount * 7]]);
    return;
  }
  if (weapon.kind === 'tunnel') {
    const points = [];
    for (let index = 0; index < count; index++) {
      const x = clamp(impact.x + direction * reach * index / Math.max(1, count - 1), 3, WIDTH - 3);
      const oldGround = groundAt(state, x);
      // Height-map terrain represents a subterranean tunnel by its collapsed surface channel.
      for (let sample = Math.max(0, Math.floor((x - radius / 2) / STEP)); sample <= Math.min(TERRAIN_SAMPLES - 1, Math.ceil((x + radius / 2) / STEP)); sample++) {
        const distance = Math.abs(sample * STEP - x);
        if (distance < radius / 2) state.terrain[sample] = round(clamp(state.terrain[sample] + depth * (1 - distance / (radius / 2)), MIN_GROUND, MAX_GROUND));
      }
      const y = clamp(oldGround + depth * (index === 0 ? 0 : 1), MIN_GROUND, MAX_GROUND);
      points.push([x, y, impact.tick + index * 8]);
      blast(state, trace, actor, weapon, x, y, damage / count, radius, impact.tick + index * 8, 'tunnel');
    }
    addPath(trace, 'tunnel', weapon.color, points); return;
  }
  if (weapon.kind === 'flame') {
    for (let index = 0; index < count; index++) {
      const part = count === 1 ? .5 : index / (count - 1);
      const offset = direction * reach * part * .45 + (part - .5) * spread * 1.4;
      const x = clamp(impact.x + offset, 0, WIDTH), y = groundAt(state, x) - 8;
      blast(state, trace, actor, weapon, x, y, damage / count, radius, impact.tick + index * 4, 'flame');
    }
    return;
  }
  if (weapon.kind === 'mine') {
    for (let index = 0; index < count; index++) {
      const x = round(clamp(impact.x + (count === 1 ? 0 : index / (count - 1) - .5) * spread * 2, 10, WIDTH - 10));
      if (state.mines.length >= MAX_MINES) {
        blast(state, trace, actor, weapon, x, groundAt(state, x), damage / count, radius, impact.tick + index * 4, 'mine');
      } else {
        state.mines.push({ id: `${trace.sequence}:${index}`, owner: actor, x, y: round(clamp(groundAt(state, x) - 3 + depth, MIN_GROUND - 5, MAX_GROUND + 30)), damage: round(damage / count), radius,
          depth, craterScale: weapon.craterScale, falloff: weapon.falloff, fuse: Math.max(1, Math.round(weapon.fuse ?? 2)), color: weapon.color });
        addEffect(trace, 'mine', weapon.color, x, groundAt(state, x) - 3, 9, impact.tick + index * 3, { duration: 15 });
      }
    }
    return;
  }
  if (weapon.kind === 'builder') {
    blast(state, trace, actor, weapon, impact.x, impact.y, damage, radius, impact.tick, 'earth', { carve: false });
    const size = Math.max(6, weapon.width / 2 || radius), height = weapon.height ?? 50;
    for (let index = 0; index < TERRAIN_SAMPLES; index++) {
      const distance = Math.abs(index * STEP - impact.x);
      if (distance < size) state.terrain[index] = round(clamp(state.terrain[index] - height * Math.sqrt(1 - (distance / size) ** 2), MIN_GROUND, MAX_GROUND));
    }
    addEffect(trace, 'earth', weapon.color, impact.x, impact.y, size, impact.tick + 10, { height, duration: 28 });
    settle(state); return;
  }
  if (weapon.kind === 'carver') {
    const width = weapon.width ?? radius, length = Math.min(reach, 400), steps = Math.max(2, Math.ceil(length / 18));
    for (let index = 0; index < steps; index++) {
      const x = clamp(impact.x + direction * length * index / (steps - 1), 0, WIDTH), y = groundAt(state, x);
      blast(state, trace, actor, weapon, x, y, damage / steps, width, impact.tick + index * 2, 'drill', { carve: false });
      for (let sample = 0; sample < TERRAIN_SAMPLES; sample++) {
        const distance = Math.abs(sample * STEP - x);
        if (distance < width) state.terrain[sample] = round(clamp(state.terrain[sample] + depth * (1 - distance / width) / Math.max(1, steps / 2), MIN_GROUND, MAX_GROUND));
      }
      settle(state);
    }
    return;
  }
  if (weapon.kind === 'lightning') {
    for (let index = 0; index < count; index++) {
      const x = clamp(impact.x + (count === 1 ? 0 : index / (count - 1) - .5) * spread * 3, 0, WIDTH);
      const y = groundAt(state, x) - 6;
      addEffect(trace, 'lightning', weapon.color, x, 0, 8, impact.tick + index * 6, { x2: round(x), y2: round(y), duration: 18 });
      const chains = Math.round(weapon.chain ?? 0), share = damage / count;
      blast(state, trace, actor, weapon, x, y, chains ? share * .5 : share, radius, impact.tick + index * 6, 'spark');
      let prior = { x, y };
      for (let branch = 1; branch <= chains; branch++) {
        const chainReach = weapon.reach || chains * 28;
        const tx = state.tanks[1 - actor].x;
        const branchDirection = Math.sign(tx - x) || direction;
        const bx = clamp(x + branchDirection * Math.min(Math.abs(tx - x), chainReach * branch / chains), 0, WIDTH), by = groundAt(state, bx) - 6;
        const tick = impact.tick + index * 6 + branch * 3;
        addEffect(trace, 'lightning', weapon.color, prior.x, prior.y, 5, tick, { x2: round(bx), y2: round(by), duration: 12 });
        blast(state, trace, actor, weapon, bx, by, share * .5 / chains, radius, tick, 'spark');
        prior = { x: bx, y: by };
      }
    }
    return;
  }
  if (weapon.kind === 'wave') {
    const points = [];
    for (let index = 0; index < count; index++) {
      const x = clamp(impact.x + direction * reach * index / Math.max(1, count - 1), 0, WIDTH), y = groundAt(state, x) - 3;
      points.push([x, y, impact.tick + index * 7]);
      blast(state, trace, actor, weapon, x, y, damage / count, radius, impact.tick + index * 7, 'wave');
    }
    addPath(trace, 'wave', weapon.color, points); return;
  }
  blast(state, trace, actor, weapon, impact.x, impact.y, damage, radius, impact.tick);
}

export function applyAction(snapshot, action, actor = snapshot?.turn) {
  const state = validateGame(snapshot);
  assert(!state.finished, 'This game has finished.');
  assert(actor === state.turn, 'It is the other player’s turn.');
  assert(action && typeof action === 'object', 'Missing tank action.');
  const tank = state.tanks[actor];
  if (action.type === 'move') {
    assert(finite(action.distance) && Math.abs(action.distance) >= 1 && Math.abs(action.distance) <= MAX_MOVE, 'Move between 1 and 150 units.');
    assert(tank.movesLeft > 0, 'No moves remain.');
    const from = tank.x, to = round(from + action.distance), other = state.tanks[1 - actor];
    assert(to >= MIN_X && to <= MAX_X, 'That move goes outside the battlefield.');
    assert(Math.abs(to - other.x) >= TANK_WIDTH * 1.2 && Math.sign(to - other.x) === Math.sign(from - other.x), 'Tanks cannot pass through each other.');
    tank.x = to; tank.movesLeft--; settle(state);
    const trace = { scoreGain: [0, 0], paths: [], effects: [], duration: 0 };
    triggerMines(state, trace, actor, false, false);
    state.lastMove = { actor, from, to, effects: trace.effects, scoreGain: trace.scoreGain };
    return state;
  }
  assert(action.type === 'fire', 'Unknown tank action.');
  assert(finite(action.angle) && action.angle >= 0 && action.angle <= 180, 'Angle must be between 0 and 180 degrees.');
  assert(finite(action.power) && action.power >= 1 && action.power <= 100, 'Power must be between 1 and 100.');
  assert(typeof action.weaponId === 'string' && tank.inventory.includes(action.weaponId), 'That weapon is not in your ammunition.');
  const weapon = weaponById(action.weaponId), angle = round(action.angle), power = round(action.power);
  const trace = newTrace(state, actor, weapon, angle, power);
  // Existing mines count down once per shot. Newly deployed mines wait for a later shot or movement.
  triggerMines(state, trace, actor, false, true);
  resolveWeapon(state, trace, actor, weapon, angle, power);
  triggerMines(state, trace, actor, false, false);
  tank.inventory.splice(tank.inventory.indexOf(action.weaponId), 1); tank.shots++; state.shotsTotal++;
  state.lastMove = null;
  state.finished = state.shotsTotal === 20;
  if (state.finished) triggerMines(state, trace, actor, true, false);
  state.lastShot = trace;
  state.turn = 1 - actor;
  if (state.finished) state.winner = state.tanks[0].score === state.tanks[1].score ? null : (state.tanks[0].score > state.tanks[1].score ? 0 : 1);
  return state;
}

function validEffect(effect) {
  assert(effect && typeof effect === 'object' && typeof effect.kind === 'string' && effect.kind.length <= 20, 'Invalid effect.');
  assert(/^#[\da-f]{6}$/i.test(effect.color), 'Invalid effect color.');
  for (const key of ['x', 'y', 'radius', 'tick']) assert(finite(effect[key]), 'Invalid effect coordinate.');
  assert(effect.x >= -100 && effect.x <= WIDTH + 100 && effect.y >= -1800 && effect.y <= HEIGHT + 100 && effect.radius >= 1 && effect.radius <= WIDTH && integer(effect.tick) && effect.tick >= 0 && effect.tick <= MAX_TICKS, 'Effect out of bounds.');
  for (const key of ['x2', 'y2', 'height', 'duration']) if (effect[key] !== undefined) assert(finite(effect[key]) && Math.abs(effect[key]) <= 2000, 'Invalid effect detail.');
}
export function validateGame(snapshot) {
  assert(snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot), 'Invalid saved game.');
  assert(snapshot.schema === 1 && integer(snapshot.seed) && snapshot.seed > 0 && snapshot.seed <= 0xffffffff && integer(snapshot.rng) && snapshot.rng > 0 && snapshot.rng <= 0xffffffff, 'Unsupported saved game.');
  assert(snapshot.starter === 0 || snapshot.starter === 1, 'Invalid starting seat.');
  assert(['flat', 'hilly', 'random'].includes(snapshot.terrainType), 'Invalid terrain type.');
  assert(Array.isArray(snapshot.terrain) && snapshot.terrain.length === TERRAIN_SAMPLES && snapshot.terrain.every(y => finite(y) && y >= MIN_GROUND && y <= MAX_GROUND), 'Invalid terrain.');
  assert(Array.isArray(snapshot.tanks) && snapshot.tanks.length === 2, 'A game needs two tanks.');
  for (const tank of snapshot.tanks) {
    assert(tank && finite(tank.x) && tank.x >= MIN_X && tank.x <= MAX_X && finite(tank.y) && tank.y >= MIN_GROUND && tank.y <= MAX_GROUND, 'Invalid tank position.');
    assert(typeof tank.name === 'string' && tank.name.trim().length > 0 && tank.name.length <= 30 && /^#[\da-f]{6}$/i.test(tank.color), 'Invalid tank identity.');
    assert(integer(tank.score) && tank.score >= 0 && tank.score <= 1000000 && integer(tank.movesLeft) && tank.movesLeft >= 0 && tank.movesLeft <= 4 && integer(tank.shots) && tank.shots >= 0 && tank.shots <= 10, 'Invalid tank totals.');
    assert(Array.isArray(tank.inventory) && tank.inventory.length === 10 - tank.shots && new Set(tank.inventory).size === tank.inventory.length && tank.inventory.every(id => typeof id === 'string' && weaponById(id)), 'Invalid tank ammunition.');
  }
  assert(snapshot.tanks[0].x < snapshot.tanks[1].x && snapshot.tanks[1].x - snapshot.tanks[0].x >= TANK_WIDTH * 1.2, 'Overlapping tanks.');
  assert(integer(snapshot.shotsTotal) && snapshot.shotsTotal >= 0 && snapshot.shotsTotal <= 20 && snapshot.shotsTotal === snapshot.tanks[0].shots + snapshot.tanks[1].shots, 'Invalid shot count.');
  const expectedFirst = Math.floor(snapshot.shotsTotal / 2) + (snapshot.shotsTotal % 2 && snapshot.starter === 0 ? 1 : 0);
  assert(snapshot.tanks[0].shots === expectedFirst && snapshot.turn === (snapshot.starter + snapshot.shotsTotal) % 2, 'Invalid turn sequence.');
  assert(snapshot.finished === (snapshot.shotsTotal === 20), 'Invalid completion status.');
  const winner = snapshot.finished && snapshot.tanks[0].score !== snapshot.tanks[1].score ? (snapshot.tanks[0].score > snapshot.tanks[1].score ? 0 : 1) : null;
  assert(snapshot.winner === winner, 'Invalid winner.');
  assert(Array.isArray(snapshot.mines) && snapshot.mines.length <= MAX_MINES && (!snapshot.finished || snapshot.mines.length === 0), 'Invalid mines.');
  const mineIds = new Set();
  for (const mine of snapshot.mines) {
    assert(mine && typeof mine.id === 'string' && mine.id.length <= 20 && !mineIds.has(mine.id), 'Invalid mine identifier.'); mineIds.add(mine.id);
    assert((mine.owner === 0 || mine.owner === 1) && finite(mine.x) && mine.x >= 0 && mine.x <= WIDTH && finite(mine.y) && mine.y >= MIN_GROUND - 5 && mine.y <= MAX_GROUND + 30 && finite(mine.damage) && mine.damage > 0 && mine.damage <= 200 && finite(mine.radius) && mine.radius >= 1 && mine.radius <= 200 && integer(mine.fuse) && mine.fuse >= 1 && mine.fuse <= 10 && /^#[\da-f]{6}$/i.test(mine.color), 'Invalid mine.');
    for (const key of ['depth', 'craterScale', 'falloff']) assert(finite(mine[key]) && mine[key] >= 0 && mine[key] <= 200, 'Invalid mine profile.');
  }
  if (snapshot.lastShot !== null) {
    const shot = snapshot.lastShot;
    assert(shot && shot.sequence === snapshot.shotsTotal && (shot.actor === 0 || shot.actor === 1) && shot.actor === 1 - snapshot.turn && weaponById(shot.weaponId), 'Invalid shot record.');
    assert(finite(shot.angle) && shot.angle >= 0 && shot.angle <= 180 && finite(shot.power) && shot.power >= 1 && shot.power <= 100 && finite(shot.duration) && shot.duration >= 0 && shot.duration <= MAX_TICKS, 'Invalid shot settings.');
    assert(Array.isArray(shot.scoreGain) && shot.scoreGain.length === 2 && shot.scoreGain.every((gain, index) => integer(gain) && gain >= 0 && gain <= snapshot.tanks[index].score), 'Invalid score record.');
    assert(Array.isArray(shot.paths) && shot.paths.length <= 20 && Array.isArray(shot.effects) && shot.effects.length <= MAX_EFFECTS, 'Invalid shot graphics.');
    let pointCount = 0;
    for (const path of shot.paths) {
      assert(path && typeof path.kind === 'string' && path.kind.length <= 20 && /^#[\da-f]{6}$/i.test(path.color) && Array.isArray(path.points), 'Invalid shot path.');
      pointCount += path.points.length;
      let previousTick = -1;
      for (const point of path.points) {
        assert(Array.isArray(point) && point.length === 3 && point.every(finite) && point[0] >= -100 && point[0] <= WIDTH + 100 && point[1] >= -1900 && point[1] <= HEIGHT + 100 && integer(point[2]) && point[2] >= previousTick && point[2] >= 0 && point[2] <= MAX_TICKS, 'Invalid path point.');
        previousTick = point[2];
      }
    }
    assert(pointCount <= MAX_POINTS, 'Shot graphics too large.');
    for (const effect of shot.effects) validEffect(effect);
  } else assert(snapshot.shotsTotal === 0, 'Missing shot record.');
  if (snapshot.lastMove !== null) {
    const move = snapshot.lastMove;
    assert(move && (move.actor === 0 || move.actor === 1) && move.actor === snapshot.turn && finite(move.from) && move.from >= MIN_X && move.from <= MAX_X && finite(move.to) && move.to === snapshot.tanks[move.actor].x && Math.abs(move.to - move.from) >= 1 && Math.abs(move.to - move.from) <= MAX_MOVE && Array.isArray(move.effects) && move.effects.length <= MAX_EFFECTS && Array.isArray(move.scoreGain) && move.scoreGain.length === 2 && move.scoreGain.every((gain, index) => integer(gain) && gain >= 0 && gain <= snapshot.tanks[index].score), 'Invalid movement record.');
    for (const effect of move.effects) validEffect(effect);
  }
  assert(JSON.stringify(snapshot).length <= 65536, 'Saved game is too large.');
  const state = clone({ schema: snapshot.schema, seed: snapshot.seed, rng: snapshot.rng, starter: snapshot.starter,
    terrainType: snapshot.terrainType, terrain: snapshot.terrain, tanks: snapshot.tanks, turn: snapshot.turn,
    shotsTotal: snapshot.shotsTotal, finished: snapshot.finished, winner: snapshot.winner, mines: snapshot.mines,
    lastShot: snapshot.lastShot, lastMove: snapshot.lastMove });
  for (const tank of state.tanks) assert(Math.abs(tank.y - supportAt(state, tank.x)) <= .06, 'Tank is detached from terrain.');
  return state;
}

function predictLanding(state, actor, angle, power, weapon) {
  if (weapon?.kind === 'cluster' || weapon?.kind === 'bounce') {
    const trace = newTrace(state, actor, weapon, angle, power);
    const impact = projectile(state, actor, weapon, angle, power, trace,
      { splitAtApex: weapon.kind === 'cluster', bounces: weapon.kind === 'bounce' ? weapon.bounces : 0 });
    if (impact.split) return projectile(state, actor, weapon, angle, power, trace,
      { origin: impact, vx: impact.vx * .72, vy: impact.vy * .72 + 24, startTick: impact.tick });
    return impact;
  }
  const radians = angle * Math.PI / 180, origin = muzzle(state, actor, angle), speed = 60 + power * 4.4;
  let x = origin.x, y = origin.y, vx = Math.cos(radians) * speed, vy = -Math.sin(radians) * speed;
  for (let step = 0; step < 310; step++) {
    vy += GRAVITY * DT; x += vx * DT; y += vy * DT;
    if (x < 0 || x > WIDTH) return { x, y, missed: true };
    const target = tankCenter(state.tanks[1 - actor]);
    if (Math.abs(x - target.x) < 17 && Math.abs(y - target.y) < 13) return { x, y, missed: false };
    if (y >= groundAt(state, x)) return { x, y, missed: false };
  }
  return { x, y, missed: true };
}
export function chooseCpuAction(snapshot, difficulty = 'normal') {
  const state = validateGame(snapshot);
  assert(!state.finished, 'This game has finished.');
  const actor = state.turn, target = tankCenter(state.tanks[1 - actor]);
  const skill = typeof difficulty === 'number' ? difficulty : ({ easy: 0, normal: 1, hard: 2 }[difficulty] ?? 1);
  const increment = skill >= 2 ? 3 : skill === 0 ? 10 : 6;
  const inventory = state.tanks[actor].inventory.map(weaponById);
  const shortlist = [];
  for (const weapon of inventory) {
    const candidates = [];
    if (weapon.kind === 'beam') {
      const own = tankCenter(state.tanks[actor]);
      const raw = Math.atan2(own.y - target.y, target.x - own.x) * 180 / Math.PI;
      const direct = target.x >= own.x ? clamp(raw, 0, 90) : clamp(raw < 0 ? raw + 360 : raw, 90, 180);
      for (const offset of [-2, 0, 2]) candidates.push({ weapon, angle: clamp(direct + offset, 0, 180), power: 100, cost: Math.abs(offset) + Math.max(0, Math.abs(target.x - own.x) - weapon.reach) });
    } else {
      const direction = target.x > state.tanks[actor].x ? 1 : -1;
      const groundAdvance = ['roller', 'wave', 'tunnel', 'carver'].includes(weapon.kind) ? weapon.reach * .5 : weapon.kind === 'flame' ? weapon.reach * .2 : 0;
      const aimedX = clamp(target.x - direction * groundAdvance, 10, WIDTH - 10);
      for (let aimed = 2; aimed <= 86; aimed += increment) {
        const angle = direction > 0 ? aimed : 180 - aimed;
        for (let power = 10; power <= 100; power += increment) {
          const impact = predictLanding(state, actor, angle, power, weapon);
          const cost = Math.hypot(impact.x - aimedX, impact.y - target.y) + (impact.missed ? 250 : 0);
          candidates.push({ weapon, angle, power, cost });
        }
      }
    }
    candidates.sort((left, right) => left.cost - right.cost || left.angle - right.angle || left.power - right.power);
    shortlist.push(...candidates.slice(0, skill >= 2 ? 8 : skill === 0 ? 1 : 4));
  }
  let best = null;
  for (const candidate of shortlist) {
    const simulation = clone(state), trace = newTrace(simulation, actor, candidate.weapon, candidate.angle, candidate.power);
    resolveWeapon(simulation, trace, actor, candidate.weapon, candidate.angle, candidate.power);
    triggerMines(simulation, trace, actor, false, false);
    // Rank using the actual family simulator; trajectory closeness breaks zero-damage ties.
    const gain = trace.scoreGain[actor] - trace.scoreGain[1 - actor] * 1.35;
    const rating = gain * 1000 - candidate.cost;
    if (!best || rating > best.rating) best = { ...candidate, rating };
  }
  // A deterministic aiming error makes the easiest opponent forgiving and saves reproducible.
  if (skill === 0) {
    const offset = ((state.seed ^ (state.shotsTotal * 2654435761)) >>> 0) % 9 - 4;
    best.power = clamp(best.power + offset, 1, 100);
  }
  return { type: 'fire', weaponId: best.weapon.id, angle: round(best.angle), power: best.power };
}
