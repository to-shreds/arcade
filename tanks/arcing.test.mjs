import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createGame,applyAction,validateGame,chooseCpuAction,launchSpeed} from './engine.js';
import {WEAPONS} from './weapons.js';
import {terrainAtTick} from './terrain-rules.js';

function armed(id,seed=9412){
  const state=createGame({seed,terrainType:'flat'});
  if(!state.tanks[0].inventory.includes(id))state.tanks[0].inventory[0]=id;
  return state;
}
test('all 12 formerly instant energy rays are visible true ballistic arcs',()=>{
  const energy=WEAPONS.filter(w=>w.kind==='beam');
  assert.equal(energy.length,12);
  assert.equal(WEAPONS.length,132);
  for(const w of energy){
    const before=armed(w.id),intent={type:'fire',weaponId:w.id,angle:45,power:30};
    const after=applyAction(before,intent);
    assert.deepEqual(after,applyAction(before,intent),w.id);
    assert.deepEqual(validateGame(after),after,w.id);
    assert.equal(after.lastShot.paths.length,1,w.id);
    const flight=after.lastShot.paths[0];
    assert.equal(flight.kind,'beam',w.id);
    assert.ok(flight.points.length>=8,w.id+' has no visible arc samples');
    const a=flight.points[0],b=flight.points.at(-1),mid=flight.points[Math.floor(flight.points.length/2)];
    const f=(mid[0]-a[0])/(b[0]-a[0]);
    const curvature=mid[1]-(a[1]+(b[1]-a[1])*f);
    assert.ok(curvature < -20,w.id+' should visibly bend above its chord, got '+curvature);
    assert.equal(after.lastShot.effects.some(e=>e.kind==='beam'),false,w.id+' fired an instant ray');
    assert.ok(after.lastShot.effects.some(e=>e.kind==='spark'),w.id+' has no actual post-impact burst');
    assert.ok(after.lastShot.effects.every(e=>e.tick>=flight.points.at(-1)[2]),
      w.id+' effects happened before the lobbed shell landed');
    assert.deepEqual(terrainAtTick(before.terrain,after.lastShot.effects,360),after.terrain,w.id);
    assert.ok(Buffer.byteLength(JSON.stringify(after))<65536,w.id);
  }
});
test('energy range is still meaningful and shared with the gravity model',()=>{
  const short=WEAPONS.find(w=>w.id==='flashlight'),long=WEAPONS.find(w=>w.id==='laser-pencil');
  const control=WEAPONS.find(w=>w.kind==='ballistic');
  assert.ok(launchSpeed(long,60)>launchSpeed(short,60)*2);
  assert.equal(launchSpeed(control,60),60+60*4.4);
  for(const power of [1,35,60,100]){
    assert.ok(launchSpeed(long,power)>launchSpeed(short,power));
  }
});
test('cutting charge keeps its distinctive trench AFTER a visible arc',()=>{
  const before=armed('cutting-ray'),after=applyAction(before,{type:'fire',weaponId:'cutting-ray',angle:45,power:30});
  const flight=after.lastShot.paths[0],end=flight.points.at(-1)[2];
  const cut=after.lastShot.effects.find(e=>e.kind==='cut');
  assert.ok(cut&&cut.tick>end);
  assert.ok(cut.terrain?.length>15);
  assert.deepEqual(terrainAtTick(before.terrain,after.lastShot.effects,360),after.terrain);
});
test('hard CPU aims lobbed energy rounds rather than line-of-sight shots',()=>{
  const state=createGame({seed:881,terrainType:'flat'});
  state.tanks[1].x=210;state.tanks[1].y=400;
  state.tanks[0].inventory=WEAPONS.filter(w=>w.kind==='beam'&&!w.funNew).map(w=>w.id);
  const action=chooseCpuAction(state,'hard');
  assert.deepEqual(action,chooseCpuAction(state,'hard'));
  const after=applyAction(state,action);
  assert.ok(after.lastShot.scoreGain[0]>=75);
  assert.ok(after.lastShot.paths[0].points.length>=3);
  assert.equal(after.lastShot.effects.some(e=>e.kind==='beam'),false);
});
test('damage floats last four times as long without changing reduced-motion treatment',async()=>{
  const css=await readFile(new URL('./battle-view.css',import.meta.url),'utf8');
  const app=await readFile(new URL('./game.js',import.meta.url),'utf8');
  assert.match(css,/animation:tank-damage-rise 8400ms/);
  assert.match(app,/setTimeout\(discard,item\.reduced\?1100:8500\)/);
  assert.match(app,/now-item\.born<\(item\.reduced\?1100:8400\)/);
  assert.doesNotMatch(app,/floatingDamage=\[\];\$\('damageFloats'\)\.replaceChildren\(\);animation=/,
    'A new turn must not erase the still-rising damage numbers');
});
