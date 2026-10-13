/** Weapon-specific height-map rules. Dimensions are world units, not damage.
 * `width` is a half-width. Shafts and burrows collapse to open surface channels;
 * this engine intentionally does not represent enclosed underground cavities.
 */
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const round = v => Math.round(v * 100) / 100;
// Six deliberate profiles per family, in stable catalogue order: half-width,
// maximum surface depth, shape. A large damage radius need not remove much soil.
const PROFILES = {
  ballistic: [[9,5],[45,47.5],[85,36],[46,115],[96,8,'flat'],[35,65]],
  cluster: [[25,24],[23,21],[15,12],[18,20],[34,30],[43,42]],
  burst: [[31,30],[15,13],[25,23],[17,15],[39,38],[8,5]],
  bounce: [[35,33],[27,25],[54,39],[39,75],[14,9],[73,14,'flat']],
  roller: [[31,30],[24,24],[20,16],[37,52],[13,9],[53,23]],
  drill: [[20,20],[30,34],[17,20],[11,15],[33,25],[7,10]],
  tunnel: [[17,10],[13,8],[24,18],[8,6],[29,21],[15,12]],
  beam: [[5,2,'flat'],[18,4,'flat'],[10,7],[32,1,'flat'],[8,18,'flat'],[24,5,'flat']],
  flame: [[18,1,'flat'],[26,2,'flat'],[20,1,'flat'],[32,3,'flat'],[14,1,'flat'],[16,5,'flat']],
  mine: [[32,32],[29,29],[25,25],[43,40],[15,13],[47,65]],
  carver: [[16,105,'flat'],[36,28,'flat'],[70,80,'flat'],[55,16,'flat'],[12,60,'flat'],[115,42,'bowl']],
  lightning: [[10,3],[9,2],[8,2],[10,3],[13,4],[7,1,'flat']],
  wave: [[28,15],[43,24],[18,12],[35,60],[70,6,'flat'],[12,6]],
};
export function blastProfile(radius, scale = 1) {
  const s = clamp(scale, .05, 4);
  return { width: clamp(radius * 1.8 * Math.sqrt(s), 3, 200), depth: clamp(radius * 1.9 * Math.pow(s, .8), 2, 185), shape: 'bowl' };
}
export function weaponTerrainProfile(weapon) {
  const row = PROFILES[weapon?.kind]?.[weapon.iconVariant];
  return row ? {width:row[0], depth:row[1], shape:row[2] || 'bowl'} : blastProfile(weapon?.radius || 24, weapon?.craterScale ?? 1);
}
function envelope(distance, width, shape = 'bowl') {
  const d = Math.abs(distance) / Math.max(1, width);
  if (d >= 1) return 0;
  if (shape === 'flat') return Math.min(1, (1-d)*5);
  if (shape === 'v') return 1-d;
  return Math.sqrt(1-d*d);
}
export function excavateTerrain(terrain, x, y, radius, scale = 1, profile = null) {
  const step = 1000 / (terrain.length - 1), p = profile || blastProfile(radius, scale);
  for (let i = Math.max(0, Math.floor((x-p.width)/step)); i <= Math.min(terrain.length-1, Math.ceil((x+p.width)/step)); i++) {
    const f = envelope(i*step-x,p.width,p.shape);
    // Surface/thermal damage reaches only the actual damage radius vertically.
    // Never turn a high airburst into a deep hole in unrelated ground.
    if (f && (p.connected || y-radius <= terrain[i]+2)) terrain[i] = round(clamp(Math.max(terrain[i],y+p.depth*f),190,540));
  }
}
/** Cut to a depth relative to an untouched reference, not repeatedly from each
 * previous cut. Segment continuity and depth do not depend on animation steps. */
export function cutChannel(terrain, reference, from, to, width, depth, shape = 'flat') {
  const step = 1000/(terrain.length-1), left=Math.min(from,to), right=Math.max(from,to);
  for(let i=0;i<terrain.length;i++) {
    const x=i*step, distance=x<left?left-x:x>right?x-right:0;
    const f=envelope(distance,width,shape);
    if(f) terrain[i]=round(clamp(Math.max(terrain[i],reference[i]+depth*f),190,540));
  }
}
export function buildTerrain(terrain, reference, x, width, height, shape='bowl') {
  const step=1000/(terrain.length-1);
  for(let i=0;i<terrain.length;i++) {
    const f=envelope(i*step-x,width,shape);
    if(f) terrain[i]=round(clamp(Math.min(terrain[i],reference[i]-height*f),190,540));
  }
}
/** One bounded contiguous patch per actual terrain event. The renderer consumes
 * resolved heights, never guesses a weapon's footprint from its damage radius. */
export function terrainPatch(before, after) {
  let first=0,last=after.length-1;
  while(first<=last && before[first]===after[first])first++;
  while(last>=first && before[last]===after[last])last--;
  return first>last ? null : [first,...after.slice(first,last+1)];
}
export function terrainAtTick(before, effects, tick) {
  const result=before.slice(), previous=before.slice();
  for(const e of effects) {
    if(!e.terrain)continue;
    const start=e.terrain[0],duration=e.terrainDuration||6;
    const progress=clamp((tick-e.tick)/duration,0,1);
    const f=progress*progress*(3-2*progress);
    for(let n=1;n<e.terrain.length;n++) {
      const i=start+n-1,value=e.terrain[n];
      result[i]+=(value-previous[i])*f;previous[i]=value;
    }
  }
  return result.map(round);
}
export function terrainSummary(w) {
  const p=weaponTerrainProfile(w), span=Math.round(p.width*2);
  if(w.kind==='builder')return `${w.id==='wall-drop'?'Flat-topped wall':w.id==='mountain-maker'?'Triangular mountain':'Earth mound'}: ${w.width} wide, up to ${w.height} high.`;
  if(w.kind==='drill')return `Narrow shaft ${w.depth} deep; ${w.count} underground blast${w.count===1?'':'s'}.`;
  if(w.kind==='tunnel')return `Continuous collapsed channel: ${w.reach} long, ${w.depth} deep, with ${w.count} blasts.`;
  if(w.kind==='carver')return `${w.id==='posthole'?'Vertical hole':`Continuous trench ${w.reach} long`}: up to ${p.depth} deep.`;
  if(w.kind==='flame')return `Surface fire: ${p.depth}-unit scorch, not an explosive crater.`;
  if(w.kind==='lightning')return `Electrical damage with tiny ${p.depth}-unit ground pits.`;
  if(w.kind==='beam')return w.id==='cutting-ray'?'Cuts a narrow slot through up to 160 units of soil at full power.':'Stops at terrain; leaves a small surface scar.';
  if(w.kind==='mine')return `No crater when planted. ${w.fuse}-turn fuse or proximity trigger; then a ${span}-wide crater.`;
  return `${span}-wide, up to ${p.depth}-deep ${p.shape==='flat'?'shallow cut':'crater'} per impact${w.kind==='wave'?'; pulses follow the ground':''}.`;
}
