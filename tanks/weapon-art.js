/** Individually composed, offline SVG artwork. IDs are the saved catalogue IDs.
 * Each silhouette remains different without its label, tint or badge. */
const path = d => `<path d="${d}" fill="none"/>`;
const solid = d => `<path d="${d}" fill="currentColor"/>`;
const ball = (x,y,r=7) => `<circle cx="${x}" cy="${y}" r="${r}" fill="currentColor"/>`;
const box = (x,y,w,h,r=2) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="currentColor"/>`;
const star = (x,y,r=13) => `<path d="${Array.from({length:16},(_,i)=>{const a=i*Math.PI/8,s=i%2?r*.46:r;return `${i?'L':'M'}${(x+Math.sin(a)*s).toFixed(1)} ${(y-Math.cos(a)*s).toFixed(1)}`;}).join('')}Z" fill="currentColor"/>`;
const shell = (x,y,s=1) => `<g transform="translate(${x} ${y}) scale(${s})">${solid('M-5 10V-3L0-11 5-3V10Z')}${path('M-5 4H5')}</g>`;
const bolt = (x,y,s=1) => `<g transform="translate(${x} ${y}) scale(${s})">${solid('M4-20-11 4H0L-5 21 13-6H2Z')}</g>`;
const flame = (x,y,s=1) => `<g transform="translate(${x} ${y}) scale(${s})">${solid('M0-19C12-4 18 6 9 15-2 26-20 10-9-3L-8 7C2 7-5-9 0-19Z')}${path('M0 4Q-7 14 1 16')}</g>`;
const wheel = (x,y,r=10) => ball(x,y,r)+path(`M${x-r+4} ${y}H${x+r-4}M${x} ${y-r+4}V${y+r-4}`);
const clock = (x,y,r=12) => ball(x,y,r)+path(`M${x} ${y-r+4}V${y}L${x+5} ${y+3}`);
const earth = path('M8 48H56');
const art = {
  'pinpoint': path('M32 8V19M32 45V56M8 32H19M45 32H56')+`<circle cx="32" cy="32" r="13" fill="none"/>`+ball(32,32,3),
  'cannonball': ball(29,36,17)+path('M35 20Q34 9 47 15M43 9L48 14 53 10M19 30Q20 25 25 24'),
  'big-bang': star(32,32,25)+ball(32,32,9)+path('M10 8L17 15M53 8L48 14M51 54L46 49'),
  'crater-maker': path('M7 33H16Q20 57 32 57T48 33H57M32 8V31M23 23L32 32 41 23')+solid('M12 25 9 18 19 20ZM48 23 55 16 54 28Z'),
  'surface-slap': solid('M6 37 17 29 26 37 34 26 43 37 57 29 52 45H10Z')+path('M7 53H57M10 20L17 23M54 17L48 22'),
  'pressure-core': solid('M32 13 49 32 32 51 15 32Z')+ball(32,32,6)+path('M8 13L18 23M8 13V22M8 13H17M56 13L46 23M56 13V22M56 13H47M8 51L18 41M56 51L46 41'),
  'triple-split': shell(32,15,.55)+path('M32 24V29M32 29L15 39M32 29L49 39')+[15,32,49].map(x=>shell(x,46,.6)).join(''),
  'six-pack': box(12,12,40,42,5)+[0,1,2,3,4,5].map(i=>ball(23+i%2*18,22+Math.floor(i/2)*12,4)).join(''),
  'confetti-cannon': solid('M10 49 19 32 31 45 14 57Z')+path('M22 32Q22 15 44 10M29 37Q41 24 55 29')+solid('M32 14 38 21 30 24ZM47 37 55 40 49 46Z')+ball(47,20,3)+path('M18 11V18M14 15H22M40 47L43 54'),
  'tight-bouquet': path('M32 52L17 23M32 52V22M32 52L47 23')+[[18,21],[32,15],[46,21],[25,31],[39,31]].map(([x,y])=>ball(x,y,7)).join('')+solid('M26 49H38L35 57H29Z'),
  'wide-bouquet': path('M32 55L8 25M32 55L20 16M32 55V17M32 55L44 16M32 55L56 25')+[[9,23],[20,15],[32,11],[44,15],[55,23]].map(([x,y])=>ball(x,y,5)).join(''),
  'twin-moons': solid('M28 12C1 10 1 47 28 46 11 39 14 20 28 12ZM38 18C64 15 63 53 38 52 52 41 51 28 38 18Z')+star(35,9,4),
  'double-tap': shell(23,30,1)+shell(43,39,.85)+path('M17 48V55M26 48V58M39 52V58'),
  'stitcher': path('M9 18L52 45M9 28L47 52')+Array.from({length:7},(_,i)=>path(`M${10+i*7} ${11+i*4}l-4 13`)).join(''),
  'ripple-fire': [0,1,2,3,4].map(i=>star(10+i*11,42-i*5,6)).join('')+path('M7 56Q30 52 55 34'),
  'carpet-burst': solid('M10 18 48 10 56 39 18 49Z')+[0,1,2,3,4,5,6,7,8,9].map(i=>ball(19+i%5*7,24+Math.floor(i/5)*12-i%5*1.5,2.3)).join('')+path('M18 49V57M26 47V54M35 44V52M45 41V49M54 39V46'),
  'triple-thunder': [14,32,50].map(x=>bolt(x,30,.6)).join('')+path('M9 53H55'),
  'needle-line': [0,1,2,3,4,5].map(i=>solid(`M${11+i*8} 10l2 29-2 14-2-14Z`)).join(''),
  'single-skip': path('M8 43Q28 1 47 43M6 52H58')+ball(47,39,7)+path('M19 28L25 31'),
  'double-skip': path('M7 45Q17 3 28 44Q38 14 51 44M7 53H56')+ball(51,40,6),
  'triple-skip': path('M6 46Q12 2 21 45Q29 18 36 45Q44 28 53 45M6 54H57')+ball(53,42,5),
  'rubber-comet': solid('M9 13 43 28 35 46ZM15 8 52 28 47 42Z')+ball(42,40,13)+path('M37 35Q43 30 48 37'),
  'five-alive': solid('M17 48V30Q17 24 21 28V17Q22 12 26 18V11Q29 7 32 13V19Q36 10 39 16V24Q43 17 46 24L47 42Q44 55 31 56Z')+path('M24 36Q35 33 37 44'),
  'pinball': solid('M15 8H48L54 54H9Z')+ball(26,23,5)+ball(40,33,5)+path('M17 47L27 43M44 48L36 43')+ball(23,37,3),
  'short-roll': wheel(24,34,15)+path('M8 53H47M43 28H57M51 22L57 28 51 34'),
  'long-roll': wheel(45,36,10)+path('M6 25H34M8 35H29M10 45H31M7 54H58'),
  'breadcrumb-bombs': wheel(47,22,10)+[[10,52],[19,47],[29,43],[37,36],[44,32]].map(([x,y],i)=>ball(x,y,2+i*.5)).join(''),
  'steamroller': box(13,22,25,20,3)+box(25,11,12,11)+wheel(18,47,8)+box(33,35,23,20,5)+path('M9 20H38M44 38V53M50 38V53'),
  'runaway-marble': ball(43,35,14)+path('M36 24Q51 29 35 46M8 17L27 22M6 30H23M10 45L25 42M9 55H57'),
  'twin-wheels': wheel(18,36,12)+wheel(47,36,12)+path('M29 36H35M9 54H56M12 14L21 19M49 14L42 19'),
  'shallow-drill': box(21,9,22,12)+solid('M24 21H40L38 37 32 44 26 37Z')+path('M24 25L39 30M26 33L37 37M7 46H25M39 46H57'),
  'deep-drill': path('M8 19H21M43 19H56M19 19V54M45 19V54')+solid('M27 7H37V46L32 57 27 46Z')+path('M27 18L37 24M27 30L37 36M27 42L36 47'),
  'double-auger': [20,44].map(x=>`<g transform="translate(${x} 0)">${box(-7,9,14,12)}${solid('M-5 21H5V43L0 54-5 43Z')}${path('M-5 28L5 34M-5 38L5 44')}</g>`).join(''),
  'spiral-drill': solid('M27 10H37V47L32 56 27 47Z')+path('M22 17Q50 23 22 30Q50 36 22 43M15 12Q6 30 17 48M12 44L17 49 21 43'),
  'foundation-breaker': box(10,16,44,12)+path('M10 33H25L19 42 30 40 25 53M54 34H39L47 43 36 47 42 56M14 10H50'),
  'core-sampler': path('M20 9V47Q32 62 44 47V9M20 17H44M20 28H44M20 39H44')+solid('M26 8H38V45L32 52 26 45Z')+path('M27 19H37M27 31H37M27 43H37'),
  'mole-run': solid('M12 40Q8 19 28 22L39 18 52 32 42 39 39 48 19 48Z')+ball(38,27,2)+path('M15 39L8 45M22 44L17 53M45 32H56M9 16H25'),
  'subway': box(12,15,40,35,10)+box(19,22,10,12)+box(35,22,10,12)+ball(21,43,2)+ball(43,43,2)+path('M21 51L15 59M43 51L49 59M22 54H42'),
  'deep-subway': path('M7 10H57M10 17H54M13 24H51')+box(20,32,25,21,5)+box(25,36,15,7)+path('M24 53L20 58M40 53L45 58'),
  'worm-trail': path('M9 17H55')+solid('M12 45Q10 24 23 29T40 40Q49 40 48 28L56 28Q59 52 40 49T22 39Q20 37 21 47Z')+ball(53,25,2),
  'underground-twins': path('M7 17H57M8 54H56M16 20V29M48 20V29')+ball(18,39,10)+ball(47,39,10)+path('M28 39H37'),
  'fault-line': solid('M8 16H28L24 29 32 34 24 47 27 55H8ZM38 10H56V49H37L41 38 33 32 40 21Z'),
  'laser-pencil': `<g transform="rotate(40 32 32)">${solid('M26 14H38V38L32 48 26 38Z')}${path('M26 20H38M32 48V61M32 3V9')}</g>`,
  'light-bar': box(8,23,48,18,7)+path('M15 26V38M49 26V38M22 13V18M32 10V18M42 13V18M22 46V52M32 46V55M42 46V52'),
  'plasma-lance': solid('M11 53 17 44 37 24 30 22 53 9 43 33 41 26 21 48Z')+path('M11 42L22 53M14 57L7 50'),
  'flashlight': solid('M9 46 19 55 33 41 24 31ZM24 31 37 28 37 41 33 41Z')+path('M40 24L48 10M44 30L58 25M42 37L58 39'),
  'cutting-ray': solid('M11 47 21 39 31 49 22 57Z')+path('M25 39L44 15M33 41L51 17')+star(48,12,9)+path('M9 23H28L24 29M42 49L37 55H58'),
  'sun-column': ball(32,17,9)+path('M32 3V6M16 9L21 12M43 12L48 9M12 21H19M45 21H52')+solid('M25 29H39L47 57H17Z')+path('M32 33V53'),
  'pilot-light': box(22,42,20,12)+flame(32,26,.65)+path('M18 56H46'),
  'campfire': flame(32,28,1)+path('M14 46L49 57M16 57L50 46M12 45L16 44M49 58L53 56'),
  'fire-fan': [0,1,2,3,4].map(i=>`<g transform="rotate(${(i-2)*27} 32 55)">${flame(32,27,.55)}${path('M32 40V54')}</g>`).join(''),
  'dragon-breath': solid('M8 10 24 17 35 12 31 24 42 29 35 36 23 34 16 49 7 43 15 27Z')+ball(26,22,2)+flame(48,41,.65),
  'ember-shower': [0,1,2,3,4,5,6].map(i=>`<g transform="rotate(23 ${12+i%4*13} ${17+Math.floor(i/4)*25})">${flame(12+i%4*13,17+Math.floor(i/4)*25,.35)}</g>`).join('')+path('M8 57H56'),
  'blowtorch': box(11,28,18,27,4)+solid('M17 28V18H34V25H24V28Z')+`<g transform="rotate(90 45 20)">${flame(45,20,.75)}</g>`+path('M9 34H30'),
  'time-bomb': clock(30,36,18)+box(23,11,14,7)+path('M18 17L13 12M44 19L50 13'),
  'twin-timers': clock(20,30,12)+clock(43,42,12)+path('M17 13H23M40 25H46M29 19L35 13'),
  'minefield': path('M7 49L18 41 30 47 44 41 57 46')+[[16,35],[34,29],[49,36]].map(([x,y])=>ball(x,y,7)+path(`M${x} ${y-7}V${y-12}`)).join('')+path('M8 13H56'),
  'slow-bloom': [0,1,2,3,4].map(i=>`<ellipse cx="32" cy="18" rx="8" ry="12" transform="rotate(${i*72} 32 32)" fill="currentColor"/>`).join('')+clock(32,32,9),
  'popcorn-mines': [[13,20],[32,12],[49,22],[18,36],[38,33],[52,43],[29,50]].map(([x,y])=>solid(`M${x-5} ${y+4}q-6-8 1-9q5-8 8 0q7 4 0 9Z`)).join(''),
  'buried-clock': path('M7 19H57M9 26H21M44 26H55M8 54H22M46 54H57')+clock(33,40,13)+path('M29 20V14H37V20'),
  'dirt-dumpling': solid('M11 47Q11 26 32 22 53 27 54 47Z')+path('M23 28L24 40M32 25V40M42 28L40 40M7 54H57'),
  'sandbar': solid('M7 38Q20 24 36 29T57 35L54 45H9Z')+path('M7 52Q14 46 21 52T35 52T49 52T60 52M17 35H32'),
  'hill-drop': solid('M8 53Q16 15 32 15T56 53Z')+path('M10 54H55M31 18L22 40M46 34H54')+solid('M43 28V12H50V28L55 27 47 37 39 27Z'),
  'wall-drop': box(17,13,31,43)+path('M17 24H48M17 35H48M17 46H48M32 13V24M25 24V35M39 24V35M32 35V46M25 46V56M39 46V56'),
  'earth-blanket': solid('M6 33Q19 23 33 32T58 33V47Q46 52 32 44T6 47Z')+path('M7 54H57M13 36L13 45M22 34L22 43M44 39L44 47M53 37L53 44'),
  'mountain-maker': solid('M5 54 24 20 33 35 43 9 59 54Z')+path('M36 25L43 20 49 27M17 33L24 29 30 37'),
  'posthole': path('M7 18H23V54H41V18H57M32 8V40M27 34L32 41 37 34'),
  'ditch-digger': path('M7 24H18L21 45H45L49 24H57M10 55H54')+solid('M25 15H39V28L32 34 25 28Z')+path('M32 5V16'),
  'canyon-cut': solid('M7 12H22L16 24 25 33 21 54H7ZM43 12H57V54H39L44 39 37 29Z')+path('M32 17V52M28 47L32 53 36 47'),
  'road-grader': wheel(18,42,8)+wheel(48,42,8)+box(32,17,17,16)+path('M16 32H39M9 56H56')+solid('M24 35 35 40 28 52 18 48Z'),
  'razor-groove': solid('M14 8H50V22H42V17H22V22H14ZM14 42H22V47H42V42H50V56H14Z')+path('M32 23L28 31 36 36 32 43M7 32H20M44 32H57'),
  'basin-maker': path('M7 20H12Q11 51 32 51T52 20H57M8 57H56M21 17L32 31 43 17M32 7V29'),
  'single-bolt': bolt(32,32,1.15),
  'forked-bolt': path('M32 9V26M32 26L17 37M32 26L47 37')+bolt(17,43,.65)+bolt(47,43,.65)+solid('M27 9H37L33 23H26Z'),
  'storm-front': solid('M9 27Q4 14 17 14 25 1 36 12 53 6 56 23L53 29H11Z')+[17,32,47].map(x=>bolt(x,43,.55)).join(''),
  'chain-reaction': [[15,21],[34,34],[49,49]].map(([x,y])=>bolt(x,y,.45)).join('')+path('M21 17Q42 10 44 24M29 40Q12 49 21 55'),
  'thunder-grid': path('M9 16H55M9 48H55M16 9V55M48 9V55')+bolt(32,32,.9)+[ [16,16],[48,16],[16,48],[48,48] ].map(([x,y])=>ball(x,y,3)).join(''),
  'ground-current': path('M6 43L15 36 23 45 32 37 40 44 49 36 58 43M7 55H57')+bolt(31,20,.63),
  'short-ripple': path('M7 44Q15 13 25 44T45 44M13 53Q22 39 32 53M41 31L50 35 45 43'),
  'rolling-thunder': path('M8 46Q13 15 22 46T38 46T55 46')+bolt(32,22,.7)+earth,
  'long-wave': path('M5 28Q12 10 20 28T35 28T50 28T61 28M5 42Q12 24 20 42T35 42T50 42T61 42M10 56H54M48 51L54 56 48 61'),
  'earthquake': solid('M8 11H27L22 23 34 30 21 38 29 54H8ZM38 11H56V54H40L34 40 45 30 32 21Z')+path('M5 24L10 30 5 36M59 24L54 30 59 36'),
  'soft-swell': solid('M7 46Q16 13 36 28 25 22 24 38 38 55 56 40V56H7Z')+path('M11 49Q20 43 27 49T44 49T56 49'),
  'rapid-ripple': path('M5 21Q9 7 14 21T23 21T32 21T41 21T50 21T59 21M5 36Q9 22 14 36T23 36T32 36T41 36T50 36T59 36M5 51Q9 37 14 51T23 51T32 51T41 51T50 51T59 51'),
};
export const WEAPON_ART_IDS = Object.freeze(Object.keys(art));
const cache = new Map();
const esc = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function weaponSvg(weapon) {
  if (!weapon) return '';
  const shape = art[weapon.id];
  if (!shape) throw new Error(`Missing weapon artwork: ${weapon.id}`);
  const c = /^#[0-9a-f]{6}$/i.test(weapon.color || '') ? weapon.color : '#39b9ff';
  const key = `${weapon.id}:${c}:${weapon.name}`;
  if (!cache.has(key)) {
    if (cache.size > 168) cache.clear();
    cache.set(key, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" aria-hidden="true" data-weapon-art="${esc(weapon.id)}"><title>${esc(weapon.name)}</title><rect x="1" y="1" width="62" height="62" rx="12" fill="#101b33" stroke="${c}" stroke-opacity=".65"/><g color="${c}" stroke="#e1efff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${shape}</g></svg>`);
  }
  return cache.get(key);
}
