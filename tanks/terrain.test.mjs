import test from 'node:test';
import assert from 'node:assert/strict';
import {createGame,applyAction,validateGame,chooseCpuAction} from './engine.js';
import {WEAPONS,weaponById} from './weapons.js';
import {terrainAtTick,cutChannel,weaponTerrainProfile,terrainSummary,excavateTerrain} from './terrain-rules.js';
import {terrainPreviewSvg} from './graphics.js';
function armed(id,type='flat',seed=321,starter=0){const s=createGame({seed,terrainType:type,starter});const inv=s.tanks[s.turn].inventory;if(!inv.includes(id))inv[0]=id;return s;}
function shoot(id,type='flat',angle=45,power=35,seed=321,starter=0){const s=armed(id,type,seed,starter);return [s,applyAction(s,{type:'fire',weaponId:id,angle,power})];}
function depth(s,n){return Math.max(...n.terrain.map((v,i)=>v-s.terrain[i]));}
function replay(s,n){const trace=n.lastMove||n.lastShot;assert.deepEqual(terrainAtTick(s.terrain,trace.effects,360),n.terrain,'exact final terrain: '+n.lastShot?.weaponId);assert.deepEqual(terrainAtTick(s.terrain,trace.effects,-1),s.terrain);validateGame(JSON.parse(JSON.stringify(n)));}
test('1,764 weapon/terrain/aim cases have exact chronological terrain playback and bounded saves',()=>{
 let largest=0;
 for(const w of WEAPONS)for(const type of ['flat','hilly','random'])for(const [angle,power] of [[0,1],[45,35],[45,70],[90,1],[90,100],[135,85],[180,100]]){
   const [s,n]=shoot(w.id,type,angle,power);replay(s,n);assert.deepEqual(n,applyAction(s,{type:'fire',weaponId:w.id,angle,power}));
   largest=Math.max(largest,Buffer.byteLength(JSON.stringify(n)));assert.ok(Buffer.byteLength(JSON.stringify(n))<44000,w.id);
   const first=n.lastShot.effects.filter(e=>e.terrain).reduce((a,e)=>Math.min(a,e.tick),360);
   assert.deepEqual(terrainAtTick(s.terrain,n.lastShot.effects,first),s.terrain);
 }
 console.log('Largest sweep save bytes:',largest);
});
test('surface, precision, thermal and electrical weapons have qualitatively different excavation',()=>{
 for(const [id,limit] of [['pinpoint',5.1],['surface-slap',8.1],['soft-swell',6.1],['blowtorch',5.1],['dragon-breath',3.1],['thunder-grid',4.1]]){const [s,n]=shoot(id);assert.ok(depth(s,n)<=limit,id);}
 const [s,n]=shoot('crater-maker');assert.ok(depth(s,n)>110);const [b,c]=shoot('cannonball');assert.ok(depth(b,c)>45);
 assert.ok(terrainSummary(weaponById('road-grader')).includes('16'));
});
test('a long grader cuts its actual declared depth without step-count dilution or stacking',()=>{
 for(const id of ['road-grader','razor-groove','ditch-digger','posthole']){
  const [s,n]=shoot(id);const p=weaponTerrainProfile(weaponById(id));assert.ok(Math.abs(depth(s,n)-p.depth)<.02,id);
  if(id==='road-grader')assert.ok(n.terrain.filter(v=>v===416).length>=80,'330-unit continuous floor');
 }
 const a=Array(251).fill(400),r=a.slice();cutChannel(a,r,350,650,20,28);const once=a.slice();cutChannel(a,r,350,650,20,28);assert.deepEqual(a,once);
});
test('drills charge at depth, and tunnels continuously excavate without uncut gaps',()=>{
 for(const id of ['shallow-drill','deep-drill','spiral-drill','core-sampler']){
  const [s,n]=shoot(id);const w=weaponById(id);const blasts=n.lastShot.effects.filter(e=>e.kind==='drill');assert.equal(blasts.length,w.count);assert.ok(blasts[0].tick>n.lastShot.paths[0].points.at(-1)[2]);assert.ok(depth(s,n)>=Math.min(140,w.depth));replay(s,n);
 }
 for(const id of ['subway','worm-trail','fault-line']){
  const [s,n]=shoot(id);const w=weaponById(id),x=n.lastShot.paths.filter(p=>p.kind==='tunnel').at(-1)?.points[0][0];
  assert.ok(Number.isFinite(x));for(let i=Math.ceil((x+5)/4);i<=Math.floor((x+w.reach-5)/4)&&i<251;i++)assert.ok(n.terrain[i]>=400+w.depth-.02,id+' gap at '+i);
 }
});
test('cluster and burst impacts are simulated chronologically on shared evolving terrain',()=>{
 for(const id of ['tight-bouquet','confetti-cannon','stitcher','needle-line']){
  const [s,n]=shoot(id,'flat',45,35);const hits=n.lastShot.effects.filter(e=>e.kind==='explosion');assert.ok(hits.length>1);assert.ok(hits.every((h,i)=>!i||h.tick>=hits[i-1].tick));
  const first=hits[0],later=hits.find(h=>h.tick>first.tick+2);if(later){assert.notDeepEqual(terrainAtTick(s.terrain,n.lastShot.effects,first.tick+1),n.terrain,'later damage must not appear at first blast');}replay(s,n);
 }
});
test('mine planting does not excavate; detonation uses its own weapon and animates on moves',()=>{
 let [s,n]=shoot('time-bomb');assert.deepEqual(s.terrain,n.terrain);assert.ok(n.lastShot.effects.every(e=>!e.terrain));assert.equal(n.mines[0].weaponId,'time-bomb');
 let a=structuredClone(n);a.tanks[1].x=600;a.tanks[1].y=400;const moved=applyAction(a,{type:'move',distance:n.mines[0].x-600});replay(a,moved);assert.ok(moved.lastMove.effects.some(e=>e.kind==='explosion'));assert.equal(moved.mines.length,0);
 const next=applyAction(n,{type:'fire',weaponId:n.tanks[1].inventory[0],angle:90,power:1});replay(n,next);assert.ok(next.lastShot.launchTick>0,'prefix mine finishes before launch');
 const old=structuredClone(n);for(const m of old.mines)delete m.weaponId;delete old.lastShot.terrainVersion;validateGame(old);const resumed=applyAction(old,{type:'fire',weaponId:old.tanks[1].inventory[0],angle:90,power:1});replay(old,resumed);
});
test('wall has a flat top; mountain has a sloped top; build events restore exact terrain',()=>{
 const [,wall]=shoot('wall-drop'),[,mountain]=shoot('mountain-maker');assert.ok(wall.terrain.filter(v=>v===295).length>=6);assert.ok(mountain.terrain.filter(v=>v===310).length<=1);
 for(const w of WEAPONS.filter(w=>w.kind==='builder')){const [s,n]=shoot(w.id);assert.ok(n.terrain.some(v=>v<400));assert.ok(n.terrain.every(v=>v<=400));replay(s,n);}
});
test('cutting ray bores into a ridge where other beams stop',()=>{
 function ridge(id){const s=armed(id);for(let i=80;i<140;i++)s.terrain[i]=300;return [s,applyAction(s,{type:'fire',weaponId:id,angle:0,power:100})];}
 const [s,cut]=ridge('cutting-ray'),[a,laser]=ridge('laser-pencil');replay(s,cut);replay(a,laser);assert.ok(cut.terrain.filter((v,i)=>v>s.terrain[i]).length>laser.terrain.filter((v,i)=>v>a.terrain[i]).length+15);
});
test('no airburst excavation and terrain patch corruption fails closed',()=>{
 const t=Array(251).fill(400);excavateTerrain(t,500,100,65,1,weaponTerrainProfile(weaponById('surface-slap')));assert.ok(t.every(v=>v===400));
 const [,n]=shoot('cannonball');for(const bad of [[251,400],[-1,400],[0,NaN],[0,999],['0',400],[0]]){const c=structuredClone(n);c.lastShot.effects[0].terrain=bad;assert.throws(()=>validateGame(c),/terrain animation/);}
});
test('all 84 weapons have matching terrain summaries and self-contained preview graphics',()=>{for(const w of WEAPONS){assert.ok(terrainSummary(w).length>20);const svg=terrainPreviewSvg(w);assert.ok(svg.startsWith('<svg'));assert.ok(!svg.includes('NaN'));assert.ok(svg.includes('stroke-dasharray'));}});
test('complete CPU games retain exact saves, damage scoring, limits and playback on both seats',()=>{
 let largest=0;
 for(let seed=1;seed<=15;seed++){
  let s=createGame({seed,terrainType:['flat','hilly','random'][seed%3],starter:seed%2});
  for(let turn=0;turn<20;turn++){
   const n=applyAction(s,chooseCpuAction(s,turn%3?'normal':'hard'));replay(s,n);assert.ok(n.tanks.every((t,i)=>t.score>=s.tanks[i].score));largest=Math.max(largest,Buffer.byteLength(JSON.stringify(n)));s=validateGame(n);
  }
  assert.ok(s.finished);assert.equal(s.mines.length,0);assert.ok(s.tanks.every(t=>t.shots===10&&t.inventory.length===0));
 }
 console.log('Largest complete-match save bytes:',largest);
});

test('genuine 2.7.2 eight-shot save restores unchanged and continues with exact patches',async()=>{
 const {readFile}=await import('node:fs/promises');const old=JSON.parse(await readFile(new URL('../tools/fixtures/tanks-2.7.2-save.json',import.meta.url),'utf8'));
 assert.equal(old.shotsTotal,8);assert.equal(old.lastShot.terrainVersion,undefined);assert.deepEqual(validateGame(old),old);
 const next=applyAction(old,{type:'fire',weaponId:old.tanks[old.turn].inventory[0],angle:45,power:35});replay(old,next);
});
