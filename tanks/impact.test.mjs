import test from 'node:test';
import assert from 'node:assert/strict';
import {createGame,applyAction,validateGame,groundAt,MAX_MOVE} from './engine.js';
import {WEAPONS,weaponById} from './weapons.js';
import {tankImpactAtTick} from './graphics.js';

function armed(id,{seed=341,x=210}={}){
 const game=createGame({seed,terrainType:'flat'});
 game.tanks[1].x=x;
 game.tanks[1].y=400;
 game.tanks[0].inventory=[id,...game.tanks[0].inventory.filter(w=>w!==id)].slice(0,10);
 validateGame(game);
 return game;
}
test('heavy direct hits really displace tanks, make a visible hop, and do not spend movement',()=>{
 const before=armed('cannonball'),after=applyAction(before,{type:'fire',weaponId:'cannonball',angle:0,power:25});
 assert.ok(after.lastShot.scoreGain[0]>50,'direct hit registers full scoring');
 assert.ok(after.tanks[1].x>before.tanks[1].x+10,'target is physically knocked right');
 assert.equal(after.tanks[1].movesLeft,4);
 const effect=after.lastShot.effects.find(e=>e.pushes?.some(p=>p[0]===1));
 assert.ok(effect,'knockback is replayable from the authoritative trace');
 const move=effect.pushes.find(p=>p[0]===1);
 assert.equal(move[1],before.tanks[1].x);
 assert.equal(move[2],after.tanks[1].x);
 assert.ok(move[3]>=12);
 const start=tankImpactAtTick(before.tanks[1].x,1,after.lastShot.effects,effect.tick-1);
 assert.equal(start.x,before.tanks[1].x);
 assert.equal(start.hop,0);
 const middle=tankImpactAtTick(before.tanks[1].x,1,after.lastShot.effects,effect.tick+5);
 assert.ok(middle.x>start.x&&middle.x<after.tanks[1].x);
 assert.ok(middle.hop>0&&Math.abs(middle.tilt)>0,'tank visibly hops and tilts');
 const end=tankImpactAtTick(before.tanks[1].x,1,after.lastShot.effects,360);
 assert.equal(end.x,after.tanks[1].x);
 assert.equal(end.hop,0);
 assert.deepEqual(validateGame(after),after);
});
test('misses do not knock tanks, and impacts stop at world edges',()=>{
 const base=armed('cannonball',{x:870});
 const miss=applyAction(base,{type:'fire',weaponId:'cannonball',angle:0,power:100});
 assert.equal(miss.tanks[1].x,base.tanks[1].x);
 assert.equal(miss.lastShot.effects.flatMap(e=>e.pushes||[]).length,0);
 const edge=armed('cannonball',{x:955});
 edge.tanks[0].x=850;edge.tanks[0].y=400;
 const result=applyAction(edge,{type:'fire',weaponId:'cannonball',angle:0,power:25});
 assert.ok(result.tanks[1].x<=955);
 assert.ok(result.tanks[1].x-result.tanks[0].x>=36);
 validateGame(result);
});
test('mine triggered by a voluntary move throws tank without corrupting the move checkpoint',()=>{
 const state=createGame({seed:171,terrainType:'flat'});
 const weapon=weaponById('time-bomb');
 state.mines=[{id:'practice:0',weaponId:weapon.id,owner:1,
   x:210,y:397,damage:96,radius:25,depth:0,craterScale:1,
   falloff:1,fuse:1,color:weapon.color}];
 validateGame(state);
 const after=applyAction(state,{type:'move',distance:80});
 assert.equal(after.shotsTotal,0);
 assert.equal(after.turn,0);
 assert.equal(after.tanks[0].movesLeft,3);
 assert.equal(after.lastMove.intendedTo,210);
 assert.equal(after.lastMove.to,after.tanks[0].x);
 assert.ok(after.tanks[0].x<210,'mine blast throws the advancing tank backward');
 assert.ok(after.lastMove.effects.some(e=>e.pushes?.some(p=>p[0]===0)));
 assert.deepEqual(validateGame(JSON.parse(JSON.stringify(after))),after);
 const original=state.tanks[0].x;
 const fired=after.lastMove.effects.find(e=>e.pushes?.some(p=>p[0]===0));
 assert.equal(tankImpactAtTick(210,0,after.lastMove.effects,fired.tick-1).x,210);
 assert.equal(tankImpactAtTick(210,0,after.lastMove.effects,360).x,after.tanks[0].x);
 assert.equal(original,130,'starting tank position was not mutated');
});
test('all weapons preserve bounded positions, ordered tanks, deterministic saves and valid traces',()=>{
 let displacements=0;
 for(const weapon of WEAPONS){
   const state=armed(weapon.id);
   const intent={type:'fire',weaponId:weapon.id,angle:0,power:25};
   const a=applyAction(state,intent),b=applyAction(state,intent);
   assert.deepEqual(a,b,weapon.id);
   assert.deepEqual(validateGame(a),a,weapon.id);
   assert.ok(a.tanks[0].x>=45 && a.tanks[1].x<=955,weapon.id);
   assert.ok(a.tanks[1].x-a.tanks[0].x>=36,weapon.id);
   assert.ok(JSON.stringify(a).length<=65536,weapon.id);
   for(const e of a.lastShot.effects)for(const push of e.pushes||[]){
     displacements++;
     assert.ok(Math.abs(push[2]-push[1])<=75,weapon.id);
     assert.ok(push[3]<=42,weapon.id);
   }
 }
 assert.ok(displacements>=10,'multiple actual weapons should move tanks');
});
test('old motionless saves remain valid and bad knockback fields fail closed',()=>{
 const old=applyAction(armed('cannonball'),{type:'fire',weaponId:'cannonball',angle:0,power:25});
 const plain=structuredClone(old);
 for(const e of plain.lastShot.effects)delete e.pushes;
 assert.deepEqual(validateGame(plain),plain);
 for(const bad of [
   [[1,200,500,20]], [[1,200,220,-1]], [[1,200,220,200]],
   [[3,200,220,12]], [[1,NaN,220,12]], [[1,200,220,12],[1,200,230,12]]
 ]){
   const broken=structuredClone(old);
   broken.lastShot.effects[0].pushes=bad;
   assert.throws(()=>validateGame(broken),/Invalid tank impact/);
 }
});
