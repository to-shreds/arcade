import test from 'node:test';
import assert from 'node:assert/strict';
import { WEAPONS, ORIGINAL_WEAPON_COUNT,weaponById } from './weapons.js';
import { FUN_WEAPONS,FUN_THEMES } from './fun-weapons.js';
import { WEAPON_ART_IDS,weaponSvg } from './weapon-art.js';
import { createGame,applyAction,validateGame } from './engine.js';
import { weaponTerrainProfile,terrainAtTick } from './terrain-rules.js';

function armed(weapon){
 const state=createGame({seed:8443,terrainType:'flat'});
 state.tanks[0].inventory=[weapon.id,...state.tanks[0].inventory.filter(id=>id!==weapon.id)].slice(0,10);
 return state;
}
test('the expanded arsenal has 48 distinct playful additions and 26 playful classics',()=>{
 assert.equal(ORIGINAL_WEAPON_COUNT,84);
 assert.equal(FUN_WEAPONS.length,48);
 assert.equal(FUN_THEMES.length,8);
 assert.equal(WEAPONS.length,132);
 assert.equal(WEAPONS.filter(w=>w.playful&&!w.funNew).length,26);
 assert.equal(WEAPONS.filter(w=>w.funNew).length,48);
 assert.equal(new Set(WEAPONS.map(w=>w.id)).size,132);
 assert.equal(new Set(WEAPON_ART_IDS).size,132);
 assert.deepEqual(new Set(WEAPON_ART_IDS),new Set(WEAPONS.map(w=>w.id)));
 for(const w of FUN_WEAPONS){
  assert.equal(w.playful,true);assert.ok(w.terrainProfile);
  assert.equal(weaponById(w.id)?.id,w.id);
  assert.ok(weaponSvg(w).includes(w.symbol));
  const profile=weaponTerrainProfile(w);
  assert.ok(profile.width>=3 && profile.depth>=0 && Number.isFinite(profile.depth),w.id);
 }
});
test('all new matches use all 132 weapons with no selectable weapon pool',()=>{
 for(const seed of [1,4,500,8888]){
  const defaults=createGame({seed});
  for(const obsoleteMix of ['all','classic','silly']){
    assert.deepEqual(defaults,createGame({seed,weaponMix:obsoleteMix}),
      'Old mix preferences cannot change the universal arsenal');
  }
  for(const tank of defaults.tanks){
    assert.equal(tank.inventory.length,10);
    assert.equal(new Set(tank.inventory).size,10);
    assert.ok(tank.inventory.every(id=>WEAPONS.some(w=>w.id===id)));
  }
  validateGame(defaults);
 }
 // Both original and new weapons must be available in the actual random pool.
 let newSeen=0,classicSeen=0;
 for(let seed=1;seed<=64;seed++){
  for(const tank of createGame({seed}).tanks)for(const id of tank.inventory){
    if(weaponById(id).funNew)newSeen++;else classicSeen++;
  }
 }
 assert.ok(newSeen>0&&classicSeen>0);
});
test('every additional weapon fires deterministically and replays the exact terrain',()=>{
 for(const weapon of FUN_WEAPONS){
  for(const [angle,power] of [[45,44],[110,22]]){
   const before=armed(weapon),intent={type:'fire',weaponId:weapon.id,angle,power};
   const after=applyAction(before,intent);
   assert.deepEqual(after,applyAction(before,intent),weapon.id);
   assert.deepEqual(validateGame(after),after,weapon.id);
   assert.equal(after.shotsTotal,1);
   assert.ok(after.lastShot.effects.length>0,weapon.id);
   assert.deepEqual(terrainAtTick(before.terrain,after.lastShot.effects,360),after.terrain,weapon.id);
   assert.ok(JSON.stringify(after).length<65536,weapon.id);
  }
 }
});
