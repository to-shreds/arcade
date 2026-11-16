import test from 'node:test';
import assert from 'node:assert/strict';
import {createGame,applyAction,validateGame,WIDTH,MAX_MOVE,groundAt} from './engine.js';
import {WEAPONS} from './weapons.js';

function armed(id,x=210){
 const state=createGame({seed:335,terrainType:'flat'});
 state.tanks[1].x=x;state.tanks[1].y=groundAt(state,x);
 state.tanks[0].inventory=[id,...state.tanks[0].inventory.filter(w=>w!==id)].slice(0,10);
 return state;
}

test('requested movement beyond either world edge stops at the edge and consumes exactly one move',()=>{
 const left=createGame({seed:1,terrainType:'flat'});
 const movedLeft=applyAction(left,{type:'move',distance:-MAX_MOVE});
 assert.equal(movedLeft.tanks[0].x,45);
 assert.equal(movedLeft.lastMove.to,45);
 assert.equal(movedLeft.lastMove.from,130);
 assert.equal(movedLeft.tanks[0].movesLeft,3);
 assert.equal(movedLeft.turn,0);
 assert.equal(movedLeft.shotsTotal,0);
 assert.equal(left.tanks[0].x,130,'Input state remains untouched');
 assert.deepEqual(validateGame(movedLeft),movedLeft);

 const right=createGame({seed:42,terrainType:'flat'});
 right.turn=1;right.starter=1;right.tanks[0].name='Player 1';
 const movedRight=applyAction(right,{type:'move',distance:MAX_MOVE},1);
 assert.equal(movedRight.tanks[1].x,955);
 assert.equal(movedRight.lastMove.to,955);
 assert.equal(movedRight.tanks[1].movesLeft,3);
 assert.deepEqual(validateGame(movedRight),movedRight);
});

test('moving toward the opposing tank stops at the safe gap and never crosses it',()=>{
 const game=createGame({seed:7,terrainType:'flat'});
 game.tanks[1].x=215;game.tanks[1].y=groundAt(game,215);
 const next=applyAction(game,{type:'move',distance:150});
 assert.equal(next.tanks[0].x,179);
 assert.equal(next.tanks[0].movesLeft,3);
 assert.equal(next.tanks[1].x-next.tanks[0].x,36);
 assert.deepEqual(validateGame(next),next);
});
test('attempting to move outward while already at a boundary spends no move',()=>{
 const s=createGame({seed:1,terrainType:'flat'});
 s.tanks[0].x=45;s.tanks[0].y=groundAt(s,45);
 const baseline=structuredClone(s);
 assert.throws(()=>applyAction(s,{type:'move',distance:-150}),/already at the edge/);
 assert.deepEqual(s,baseline);
});
test('individual scored hits are present at each explosion, beam and cluster impact',()=>{
 const types=['cannonball','six-pack','double-tap','laser-pencil','time-bomb','spaghetti-storm'];
 for(const id of types){
  const before=armed(id),next=applyAction(before,{type:'fire',weaponId:id,angle:0,power:25});
  assert.deepEqual(validateGame(next),next,id);
  for(const effect of next.lastShot.effects){
   if(effect.damageHits!==undefined){
    assert.ok(effect.damageHits.length>=1&&effect.damageHits.length<=2,id);
    for(const [seat,points] of effect.damageHits){
     assert.ok(seat===0||seat===1,id);
     assert.ok(Number.isInteger(points)&&points>0,id);
    }
   }
  }
  const totals=[0,0];
  for(const e of next.lastShot.effects)for(const [target,amount] of e.damageHits||[]){
    totals[target===0?1:0]+=amount;
  }
  assert.deepEqual(totals,next.lastShot.scoreGain,id);
 }
});
test('132 weapon traces remain deterministic, validated, and score-event totals match points',()=>{
 let hitEvents=0;
 for(const weapon of WEAPONS){
  const before=armed(weapon.id),intent={type:'fire',weaponId:weapon.id,angle:0,power:25};
  const next=applyAction(before,intent);
  assert.deepEqual(next,applyAction(before,intent),weapon.id);
  assert.deepEqual(validateGame(next),next,weapon.id);
  const totals=[0,0];
  for(const e of next.lastShot.effects)for(const [target,damage] of e.damageHits||[]){
   hitEvents++;totals[target===0?1:0]+=damage;
  }
  assert.deepEqual(totals,next.lastShot.scoreGain,weapon.id);
 }
 assert.ok(hitEvents>=30,'Many different hits should have event records');
});
test('old traces without per-hit data still validate; forged damage records fail closed',()=>{
 const after=applyAction(armed('cannonball'),{type:'fire',weaponId:'cannonball',angle:0,power:25});
 const old=structuredClone(after);
 for(const e of old.lastShot.effects)delete e.damageHits;
 assert.deepEqual(validateGame(old),old);
 for(const illegal of [[[1,-2]],[[1,0]],[[1,NaN]],[[2,5]],[[0,8],[0,9]],'injected']){
  const bad=structuredClone(after);
  bad.lastShot.effects[0].damageHits=illegal;
  assert.throws(()=>validateGame(bad),/Invalid individual damage hit/);
 }
});
