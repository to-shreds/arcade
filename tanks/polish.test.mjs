import test from 'node:test';
import assert from 'node:assert/strict';
import {createGame,applyAction,validateGame,chooseCpuAction,groundAt} from './engine.js';
import {WEAPONS,weaponById} from './weapons.js';
import {WEAPON_ART_IDS,weaponSvg} from './weapon-art.js';
import {excavateTerrain,blastProfile} from './terrain-rules.js';
import {createTanksState,applyTanksAction} from '../multiplayer/models/tanks-authority.js';
const armed=(id,terrainType='flat')=>{const g=createGame({seed:12345,terrainType});if(!g.tanks[0].inventory.includes(id))g.tanks[0].inventory[0]=id;return g;};
test('all 84 drawings have different geometry without color, name, or badge',()=>{
 assert.equal(WEAPONS.length,84);assert.deepEqual(new Set(WEAPON_ART_IDS),new Set(WEAPONS.map(w=>w.id)));
 const shapes=WEAPONS.map(w=>weaponSvg(w).split('<g color=')[1].replace(/^"[^"]+"/,''));
 assert.equal(new Set(shapes).size,84);assert.throws(()=>weaponSvg({id:'unknown'}),/Missing/);
 assert.ok(!weaponSvg({...WEAPONS[0],name:'<script>x</script>',color:'red" onload="bad'}).includes('<script>'));
});
test('ordinary impacts cut broad deep craters; digging stays separate from damage',()=>{
 const t=Array(251).fill(400);excavateTerrain(t,500,400,25,1);
 assert.equal(t[125],447.5);assert.ok(t.filter(y=>y>400).length>=21);
 assert.equal(weaponById('cannonball').damage,78);
 const tiny=Array(251).fill(400);excavateTerrain(tiny,500,400,10,.25);
 assert.ok(Math.max(...tiny)-400<7);assert.ok(tiny.filter(y=>y>400).length<7);
 const deep=Array(251).fill(400);excavateTerrain(deep,500,400,34,1.8);
 assert.ok(Math.max(...deep)-400>100);assert.ok(deep.filter(y=>y>400).length>=39);
});
test('air misses do not excavate ground and all edges stay within bedrock',()=>{
 const t=Array(251).fill(400);excavateTerrain(t,500,10,54,.55);assert.ok(t.every(y=>y===400));
 for(const x of [-35,0,500,1000,1035])for(let n=0;n<10;n++)excavateTerrain(t,x,500,200,4);
 assert.ok(t.every(y=>Number.isFinite(y)&&y>=400&&y<=540));
});
test('direct-hit damage, self-hit scoring and tank settling remain valid',()=>{
 const g=armed('cannonball');g.tanks[1].x=210;
 const a=applyAction(g,{type:'fire',weaponId:'cannonball',angle:0,power:25});
 assert.ok(a.tanks[0].score>0);assert.equal(a.tanks[1].score,0);validateGame(a);
 const s=applyAction(armed('cannonball'),{type:'fire',weaponId:'cannonball',angle:90,power:1});
 assert.ok(s.tanks[1].score>0);assert.equal(s.tanks[0].score,0);assert.ok(s.tanks[0].y>400);
 assert.deepEqual(validateGame(JSON.parse(JSON.stringify(s))),s);
});
test('1,764 weapon/terrain/aim combinations stay deterministic and resumable',()=>{
 let max=0;
 for(const w of WEAPONS)for(const terrainType of ['flat','hilly','random']){
  const g=armed(w.id,terrainType);
  for(const [angle,power] of [[0,1],[0,100],[90,1],[90,100],[180,1],[180,100],[50,67]]){
   const intent={type:'fire',weaponId:w.id,angle,power},a=applyAction(g,intent);
   assert.deepEqual(a,applyAction(g,intent));validateGame(a);assert.equal(g.shotsTotal,0);
   assert.equal(a.tanks[0].inventory.length,9);assert.ok(!a.tanks[0].inventory.includes(w.id));
   max=Math.max(max,JSON.stringify(a).length);assert.ok(max<49152);
  }
 }
 console.log('Largest tested snapshot bytes:',max);
});
test('twenty-shot matches complete with monotonic scores and exact saves',()=>{
 for(let seed=1;seed<=12;seed++){
  let g=createGame({seed,terrainType:['flat','hilly','random'][seed%3],starter:seed%2});
  for(let n=0;n<20;n++){
   const previous=g.tanks.map(t=>t.score),a=chooseCpuAction(g,n%2?'hard':'easy');
   const restored=validateGame(JSON.parse(JSON.stringify(g)));
   assert.deepEqual(applyAction(restored,a),applyAction(g,a));g=applyAction(restored,a);
   assert.ok(g.tanks.every((t,i)=>t.score>=previous[i]));validateGame(g);
  }
  assert.equal(g.finished,true);assert.equal(g.mines.length,0);assert.ok(g.tanks.every(t=>t.shots===10&&t.inventory.length===0));
 }
});
test('four moves, turn limits, stale weapons and corrupted saves are rejected',()=>{
 let g=createGame({seed:27,terrainType:'flat'});
 for(let i=0;i<4;i++){g=applyAction(g,{type:'move',distance:i%2?-50:50});assert.equal(g.turn,0);validateGame(g);}
 assert.throws(()=>applyAction(g,{type:'move',distance:10}),/No moves/);
 assert.throws(()=>applyAction(g,{type:'move',distance:151}),/150/);
 assert.throws(()=>applyAction(g,{type:'fire',weaponId:'fake',angle:30,power:40}));
 const bad=structuredClone(g);bad.terrain[0]=NaN;assert.throws(()=>validateGame(bad));
});
test('builders still raise terrain; mines preserve their timer and owner',()=>{
 const g=armed('mountain-maker');const built=applyAction(g,{type:'fire',weaponId:'mountain-maker',angle:45,power:35});
 assert.ok(built.terrain.filter(y=>y<399).length>=20);validateGame(built);
 let mines=applyAction(armed('slow-bloom'),{type:'fire',weaponId:'slow-bloom',angle:45,power:35});
 assert.equal(mines.mines.length,3);assert.ok(mines.mines.every(m=>m.owner===0&&m.fuse===3));
 mines=applyAction(mines,{type:'fire',weaponId:mines.tanks[1].inventory[0],angle:90,power:1});validateGame(mines);
 assert.ok(mines.mines.every(m=>m.fuse===2));
});
test('Internet/Nearby shared authority uses identical excavation and blocks forgery',()=>{
 const members=[{playerId:'p0',seat:0,username:'Jon'},{playerId:'p1',seat:1,username:'Player 2'}];
 const room={members,hostPlayerId:'p0',version:1,status:'lobby',state:createTanksState(),turn:null,result:null};
 applyTanksAction(room,members[0],{type:'start',expectedVersion:1});
 for(let n=0;n<20;n++){
  const g=room.state.game,member=members[g.turn],intent=chooseCpuAction(g,'normal');
  assert.throws(()=>applyTanksAction(room,members[1-g.turn],{...intent,expectedVersion:room.version}),/turn/);
  assert.throws(()=>applyTanksAction(room,member,{...intent,expectedVersion:room.version,score:999}),/fields/);
  assert.throws(()=>applyTanksAction(room,member,{...intent,expectedVersion:room.version-1}),/changed/);
  const expected=applyAction(g,intent);applyTanksAction(room,member,{...intent,expectedVersion:room.version});
  assert.deepEqual(room.state.game,expected);room.version++;validateGame(room.state.game);
 }
 assert.equal(room.status,'finished');
 applyTanksAction(room,members[0],{type:'rematch',expectedVersion:room.version});room.version++;
 applyTanksAction(room,members[1],{type:'rematch',expectedVersion:room.version});
 assert.equal(room.state.game.shotsTotal,0);assert.equal(room.status,'active');
});
