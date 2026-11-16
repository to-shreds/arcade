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
test('all is the default, classic excludes new weapons, extra silly deals seven new per tank',()=>{
 for(const seed of [1,4,500,8888]){
  const defaults=createGame({seed});
  assert.deepEqual(defaults,createGame({seed,weaponMix:'all'}));
  for(const tank of defaults.tanks){assert.equal(tank.inventory.length,10);assert.equal(new Set(tank.inventory).size,10);}
  const classic=createGame({seed,weaponMix:'classic'});
  for(const tank of classic.tanks)assert.equal(tank.inventory.filter(id=>weaponById(id).funNew).length,0);
  const silly=createGame({seed,weaponMix:'silly'});
  for(const tank of silly.tanks){
    assert.equal(tank.inventory.filter(id=>weaponById(id).funNew).length,7);
    assert.equal(new Set(tank.inventory).size,10);
  }
  validateGame(defaults);validateGame(classic);validateGame(silly);
 }
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
