/** Height-map excavation shared by browser, Internet and Nearby authorities.
 * Damage radius is deliberately independent from excavation size. Tiny precision
 * and surface weapons still dig less than dedicated excavation weapons. */
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export function blastProfile(radius, scale = 1) {
  const s = clamp(scale, .05, 4);
  return {
    width: clamp(radius * 1.8 * Math.sqrt(s), 3, 200),
    depth: clamp(radius * 1.9 * Math.pow(s, .8), 2, 185),
  };
}
export function excavateTerrain(terrain, x, y, radius, scale = 1) {
  const step = 1000 / (terrain.length - 1), p = blastProfile(radius, scale);
  for (let i = Math.max(0, Math.floor((x-p.width)/step)); i <= Math.min(terrain.length-1, Math.ceil((x+p.width)/step)); i++) {
    const dx = (i*step-x)/p.width;
    if (Math.abs(dx) >= 1) continue;
    const arc = Math.sqrt(1-dx*dx);
    // Do not dig an unrelated surface when an airborne blast cannot reach it.
    // As in the original engine, underground cavities become collapsed channels.
    if (y-p.width*arc <= terrain[i]+2) {
      terrain[i] = Math.round(clamp(Math.max(terrain[i], y+p.depth*arc), 190, 540)*100)/100;
    }
  }
}
