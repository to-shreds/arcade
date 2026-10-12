/**
 * Tank game's deterministic weapon catalogue.
 *
 * damage is the nominal TOTAL damage budget for one shot. The simulator divides
 * that budget between child projectiles/effects. Dimensions are world pixels;
 * spread is degrees; fuse is a turn count. Graphics use kind, iconVariant, color,
 * and projectile/effect dimensions, never external assets or random artwork.
 * Stable IDs are serialized in games and must not be changed casually.
 */
const DEFAULTS = Object.freeze({
  damage: 60, radius: 24, count: 1, spread: 0, depth: 0, bounces: 0,
  reach: 0, width: 8, height: 0, fuse: 0, chain: 0, build: 0,
  craterScale: 1, falloff: 1,
});

const families = [
  ['ballistic', [
    ['pinpoint', 'Pinpoint', 'Tiny, concentrated blast that leaves a small crater.', '#fef08a', {damage: 100, radius: 10, craterScale: .25, falloff: .35}],
    ['cannonball', 'Cannonball', 'Balanced shell with a medium blast and crater.', '#fde047', {damage: 78, radius: 25, craterScale: 1, falloff: 1}],
    ['big-bang', 'Big Bang', 'Broad blast with gentle damage falloff.', '#facc15', {damage: 65, radius: 54, craterScale: .55, falloff: .65}],
    ['crater-maker', 'Crater Maker', 'Deep excavation with a small damaging center.', '#eab308', {damage: 58, radius: 34, craterScale: 1.8, falloff: 1.8}],
    ['surface-slap', 'Surface Slap', 'Wide damage zone with very little digging.', '#f59e0b', {damage: 62, radius: 65, craterScale: .15, falloff: .5}],
    ['pressure-core', 'Pressure Core', 'A fierce central blast that falls off sharply.', '#fb923c', {damage: 96, radius: 40, craterScale: .7, falloff: 2.4}],
  ]],
  ['cluster', [
    ['triple-split', 'Triple Split', 'Splits into three closely grouped shells in the air.', '#fda4af', {damage: 84, radius: 19, count: 3, spread: 12}],
    ['six-pack', 'Six Pack', 'Six shells spread across a medium landing zone.', '#fb7185', {damage: 84, radius: 17, count: 6, spread: 32}],
    ['confetti-cannon', 'Confetti Cannon', 'Twelve small shells blanket a wide landing zone.', '#f43f5e', {damage: 78, radius: 12, count: 12, spread: 68, craterScale: .65}],
    ['tight-bouquet', 'Tight Bouquet', 'Nine small shells stay tightly grouped.', '#e11d48', {damage: 90, radius: 14, count: 9, spread: 8}],
    ['wide-bouquet', 'Wide Bouquet', 'Five large shells scatter in a very wide fan.', '#be123c', {damage: 82, radius: 25, count: 5, spread: 78}],
    ['twin-moons', 'Twin Moons', 'Two large shells split apart with a broad gap.', '#fecdd3', {damage: 88, radius: 32, count: 2, spread: 48, craterScale: 1.3}],
  ]],
  ['burst', [
    ['double-tap', 'Double Tap', 'Two impacts strike close together.', '#fdba74', {damage: 88, radius: 25, count: 2, spread: 8}],
    ['stitcher', 'Stitcher', 'Seven small impacts stitch a narrow line.', '#fb923c', {damage: 86, radius: 12, count: 7, spread: 18}],
    ['ripple-fire', 'Ripple Fire', 'Five medium impacts march across the ground.', '#f97316', {damage: 86, radius: 19, count: 5, spread: 45}],
    ['carpet-burst', 'Carpet Burst', 'Ten small impacts cover a broad strip.', '#ea580c', {damage: 80, radius: 13, count: 10, spread: 80, craterScale: .7}],
    ['triple-thunder', 'Triple Thunder', 'Three large impacts sweep a medium strip.', '#c2410c', {damage: 92, radius: 30, count: 3, spread: 38}],
    ['needle-line', 'Needle Line', 'Twelve tiny impacts form a tight damaging line.', '#ffedd5', {damage: 96, radius: 8, count: 12, spread: 12, craterScale: .3}],
  ]],
  ['bounce', [
    ['single-skip', 'Single Skip', 'Bounces once before detonating.', '#a7f3d0', {damage: 84, radius: 26, bounces: 1}],
    ['double-skip', 'Double Skip', 'Bounces twice before a compact explosion.', '#6ee7b7', {damage: 90, radius: 20, bounces: 2}],
    ['triple-skip', 'Triple Skip', 'Three bounces lead to a broad explosion.', '#34d399', {damage: 77, radius: 39, bounces: 3}],
    ['rubber-comet', 'Rubber Comet', 'Four bounces end in a deep crater.', '#10b981', {damage: 80, radius: 30, bounces: 4, craterScale: 1.5}],
    ['five-alive', 'Five Alive', 'Five bounces end in a tiny concentrated blast.', '#059669', {damage: 98, radius: 13, bounces: 5, craterScale: .4}],
    ['pinball', 'Pinball', 'Six bounces finish with a wide shallow blast.', '#d1fae5', {damage: 72, radius: 48, bounces: 6, craterScale: .3}],
  ]],
  ['roller', [
    ['short-roll', 'Short Roll', 'Rolls a short distance along the terrain, then explodes.', '#bef264', {damage: 90, radius: 23, reach: 55}],
    ['long-roll', 'Long Roll', 'Rolls far along the terrain before a compact explosion.', '#a3e635', {damage: 94, radius: 18, reach: 190}],
    ['breadcrumb-bombs', 'Breadcrumb Bombs', 'Leaves five small blasts along a medium rolling path.', '#84cc16', {damage: 84, radius: 16, count: 5, reach: 125}],
    ['steamroller', 'Steamroller', 'Leaves three large craters along a short rolling path.', '#65a30d', {damage: 88, radius: 29, count: 3, reach: 85, craterScale: 1.4}],
    ['runaway-marble', 'Runaway Marble', 'Leaves nine tiny blasts along a very long rolling path.', '#4d7c0f', {damage: 80, radius: 11, count: 9, reach: 310}],
    ['twin-wheels', 'Twin Wheels', 'Two broad blasts mark the ends of a long rolling path.', '#ecfccb', {damage: 86, radius: 37, count: 2, reach: 240, craterScale: .6}],
  ]],
  ['drill', [
    ['shallow-drill', 'Shallow Drill', 'Burrows just below impact before exploding.', '#93c5fd', {damage: 85, radius: 28, depth: 20}],
    ['deep-drill', 'Deep Drill', 'Burrows deep before a large underground blast.', '#60a5fa', {damage: 84, radius: 42, depth: 90, craterScale: 1.3}],
    ['double-auger', 'Double Auger', 'Two blasts cut down through a medium-depth shaft.', '#3b82f6', {damage: 90, radius: 23, count: 2, depth: 55}],
    ['spiral-drill', 'Spiral Drill', 'Five small blasts excavate a narrow deep shaft.', '#2563eb', {damage: 87, radius: 15, count: 5, depth: 115}],
    ['foundation-breaker', 'Foundation Breaker', 'Three broad blasts undermine the shallow surface.', '#1d4ed8', {damage: 80, radius: 34, count: 3, depth: 38}],
    ['core-sampler', 'Core Sampler', 'Eight tiny blasts bore a very deep narrow hole.', '#dbeafe', {damage: 82, radius: 10, count: 8, depth: 155, craterScale: 1.5}],
  ]],
  ['tunnel', [
    ['mole-run', 'Mole Run', 'Two underground blasts travel a short distance.', '#c4b5fd', {damage: 90, radius: 22, count: 2, depth: 22, reach: 80}],
    ['subway', 'Subway', 'Five blasts carve a long shallow tunnel.', '#a78bfa', {damage: 86, radius: 18, count: 5, depth: 24, reach: 220}],
    ['deep-subway', 'Deep Subway', 'Four large blasts carve a deep medium-length tunnel.', '#8b5cf6', {damage: 84, radius: 31, count: 4, depth: 65, reach: 155}],
    ['worm-trail', 'Worm Trail', 'Ten tiny blasts make a very long narrow tunnel.', '#7c3aed', {damage: 80, radius: 11, count: 10, depth: 32, reach: 340}],
    ['underground-twins', 'Underground Twins', 'Two broad underground blasts spread far apart.', '#6d28d9', {damage: 91, radius: 40, count: 2, depth: 42, reach: 205}],
    ['fault-line', 'Fault Line', 'Seven medium blasts cut a deep, long fault.', '#ede9fe', {damage: 84, radius: 23, count: 7, depth: 90, reach: 280, craterScale: 1.3}],
  ]],
  ['beam', [
    ['laser-pencil', 'Laser Pencil', 'A thin straight beam reaches across the battlefield.', '#67e8f9', {damage: 94, radius: 8, width: 4, reach: 1100, craterScale: .2}],
    ['light-bar', 'Light Bar', 'A broad straight beam trades range for width.', '#22d3ee', {damage: 82, radius: 17, width: 28, reach: 420, craterScale: .4}],
    ['plasma-lance', 'Plasma Lance', 'A medium-width beam reaches most of the battlefield.', '#06b6d4', {damage: 90, radius: 13, width: 12, reach: 850, craterScale: .65}],
    ['flashlight', 'Flashlight', 'A very wide short beam sweeps a nearby area.', '#0891b2', {damage: 70, radius: 25, width: 58, reach: 180, craterScale: .2}],
    ['cutting-ray', 'Cutting Ray', 'A narrow medium-range beam cuts deeply into terrain.', '#0e7490', {damage: 85, radius: 10, width: 7, reach: 630, craterScale: 1.6}],
    ['sun-column', 'Sun Column', 'A wide beam reaches halfway across the battlefield.', '#cffafe', {damage: 78, radius: 22, width: 40, reach: 570, craterScale: .75}],
  ]],
  ['flame', [
    ['pilot-light', 'Pilot Light', 'Three fire impacts form a tight short fan.', '#fecaca', {damage: 94, radius: 17, count: 3, spread: 10, reach: 95, craterScale: .25}],
    ['campfire', 'Campfire', 'Seven fire impacts form a medium short fan.', '#fca5a5', {damage: 86, radius: 20, count: 7, spread: 35, reach: 140, craterScale: .3}],
    ['fire-fan', 'Fire Fan', 'Eleven small fire impacts form a very wide fan.', '#f87171', {damage: 78, radius: 14, count: 11, spread: 90, reach: 170, craterScale: .2}],
    ['dragon-breath', 'Dragon Breath', 'Five large fire impacts reach farther in a narrow fan.', '#ef4444', {damage: 90, radius: 26, count: 5, spread: 20, reach: 275, craterScale: .35}],
    ['ember-shower', 'Ember Shower', 'Fifteen tiny fire impacts cover a wide nearby area.', '#dc2626', {damage: 80, radius: 10, count: 15, spread: 65, reach: 220, craterScale: .15}],
    ['blowtorch', 'Blowtorch', 'Two concentrated fire impacts travel a long, tight path.', '#fee2e2', {damage: 98, radius: 15, count: 2, spread: 4, reach: 330, craterScale: .7}],
  ]],
  ['mine', [
    ['time-bomb', 'Time Bomb', 'One compact timed blast at the landing point.', '#f0abfc', {damage: 96, radius: 25, count: 1, fuse: 1}],
    ['twin-timers', 'Twin Timers', 'Two timed blasts remain closely grouped.', '#e879f9', {damage: 94, radius: 23, count: 2, spread: 12, fuse: 2}],
    ['minefield', 'Minefield', 'Five timed blasts cover a medium-width strip.', '#d946ef', {damage: 86, radius: 20, count: 5, spread: 55, fuse: 1}],
    ['slow-bloom', 'Slow Bloom', 'Three large timed blasts spread across a broad area.', '#c026d3', {damage: 90, radius: 33, count: 3, spread: 72, fuse: 3}],
    ['popcorn-mines', 'Popcorn Mines', 'Nine tiny timed blasts cover a very wide strip.', '#a21caf', {damage: 80, radius: 12, count: 9, spread: 100, fuse: 2}],
    ['buried-clock', 'Buried Clock', 'One large timed blast digs a deep crater.', '#fae8ff', {damage: 88, radius: 40, count: 1, depth: 22, fuse: 4, craterScale: 1.5}],
  ]],
  ['builder', [
    ['dirt-dumpling', 'Dirt Dumpling', 'A small impact piles a tall narrow earth mound.', '#d6d3d1', {damage: 54, radius: 18, height: 55, width: 35, build: 1}],
    ['sandbar', 'Sandbar', 'An impact spreads a low, wide mound.', '#a8a29e', {damage: 58, radius: 34, height: 22, width: 130, build: 1}],
    ['hill-drop', 'Hill Drop', 'An impact builds a large rounded hill.', '#78716c', {damage: 65, radius: 43, height: 62, width: 100, build: 1}],
    ['wall-drop', 'Wall Drop', 'An impact builds a very tall narrow mound.', '#57534e', {damage: 55, radius: 20, height: 105, width: 42, build: 1}],
    ['earth-blanket', 'Earth Blanket', 'A broad impact adds a shallow layer of terrain.', '#44403c', {damage: 60, radius: 58, height: 14, width: 210, build: 1}],
    ['mountain-maker', 'Mountain Maker', 'A heavy impact builds a broad, tall mountain.', '#e7e5e4', {damage: 70, radius: 52, height: 90, width: 160, build: 1}],
  ]],
  ['carver', [
    ['posthole', 'Posthole', 'Cuts a narrow deep hole at impact.', '#94a3b8', {damage: 91, radius: 17, width: 16, depth: 105, reach: 24}],
    ['ditch-digger', 'Ditch Digger', 'Cuts a medium-width shallow trench.', '#64748b', {damage: 78, radius: 25, width: 36, depth: 28, reach: 150}],
    ['canyon-cut', 'Canyon Cut', 'Cuts a wide deep trench over a short distance.', '#475569', {damage: 83, radius: 35, width: 70, depth: 80, reach: 90}],
    ['road-grader', 'Road Grader', 'Cuts a very long, shallow channel.', '#334155', {damage: 72, radius: 28, width: 55, depth: 16, reach: 330}],
    ['razor-groove', 'Razor Groove', 'Cuts a very narrow, long, deep channel.', '#1e293b', {damage: 90, radius: 12, width: 12, depth: 60, reach: 245}],
    ['basin-maker', 'Basin Maker', 'Cuts a broad medium-depth basin.', '#cbd5e1', {damage: 76, radius: 44, width: 115, depth: 42, reach: 160}],
  ]],
  ['lightning', [
    ['single-bolt', 'Single Bolt', 'One concentrated lightning strike at impact.', '#c7d2fe', {damage: 98, radius: 19, count: 1, chain: 0, craterScale: .3}],
    ['forked-bolt', 'Forked Bolt', 'Three closely grouped lightning branches.', '#a5b4fc', {damage: 92, radius: 18, count: 3, chain: 1, spread: 18, craterScale: .3}],
    ['storm-front', 'Storm Front', 'Seven lightning strikes cover a broad area.', '#818cf8', {damage: 80, radius: 15, count: 7, chain: 0, spread: 90, craterScale: .35}],
    ['chain-reaction', 'Chain Reaction', 'Two main strikes branch into a longer lightning chain.', '#6366f1', {damage: 86, radius: 20, count: 2, chain: 4, spread: 28, craterScale: .3}],
    ['thunder-grid', 'Thunder Grid', 'Five branching strikes form a medium-width storm.', '#4f46e5', {damage: 84, radius: 23, count: 5, chain: 2, spread: 55, craterScale: .5}],
    ['ground-current', 'Ground Current', 'One main strike sends a long chain across the ground.', '#e0e7ff', {damage: 88, radius: 15, count: 1, chain: 6, spread: 12, reach: 180, craterScale: .2}],
  ]],
  ['wave', [
    ['short-ripple', 'Short Ripple', 'Two ground-following pulses travel a short distance.', '#99f6e4', {damage: 91, radius: 22, count: 2, reach: 70}],
    ['rolling-thunder', 'Rolling Thunder', 'Four broad ground pulses travel a medium distance.', '#5eead4', {damage: 87, radius: 33, count: 4, reach: 180}],
    ['long-wave', 'Long Wave', 'Nine narrow pulses follow the terrain a long way.', '#2dd4bf', {damage: 81, radius: 13, count: 9, reach: 360}],
    ['earthquake', 'Earthquake', 'Six deep-cutting pulses ripple through nearby terrain.', '#14b8a6', {damage: 85, radius: 27, count: 6, reach: 230, craterScale: 1.5}],
    ['soft-swell', 'Soft Swell', 'Three very broad pulses leave only shallow craters.', '#0d9488', {damage: 76, radius: 48, count: 3, reach: 150, craterScale: .25}],
    ['rapid-ripple', 'Rapid Ripple', 'Twelve tiny pulses race across a very long ground path.', '#ccfbf1', {damage: 80, radius: 9, count: 12, reach: 440, craterScale: .45}],
  ]],
];

export const WEAPONS = Object.freeze(families.flatMap(([kind, entries]) =>
  entries.map(([id, name, description, color, stats], iconVariant) => Object.freeze({
    ...DEFAULTS, id, name, description, color, kind, icon: kind, iconVariant,
    ...stats,
  }))
));

const byId = new Map(WEAPONS.map(weapon => [weapon.id, weapon]));

/** Returns undefined for an unknown ID so invalid saves cannot change weapons. */
export function weaponById(id) {
  return byId.get(id);
}

export const WEAPON_KINDS = Object.freeze(families.map(([kind]) => kind));
