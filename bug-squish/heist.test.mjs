import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
const source=readFileSync(new URL('heist.js',import.meta.url),'utf8');
function fixture(){
  const listeners=new Map(),elements=new Map();
  const listen=(type,fn)=>{if(!listeners.has(type))listeners.set(type,[]);listeners.get(type).push(fn);};
  const document={getElementById:id=>{if(!elements.has(id))elements.set(id,{hidden:false,disabled:false,textContent:'',addEventListener:listen});return elements.get(id);},addEventListener:listen};
  const events={};const canvas={addEventListener:(type,fn)=>events[type]=fn,setPointerCapture(){},releasePointerCapture(){}};
  const E={W:1000,H:650,canvas,ctx:{},isStarted:()=>true,isPaused:()=>false,clamp:(v,a,b)=>Math.max(a,Math.min(b,v)),distance:(...p)=>Math.hypot(p[0]-p[2],p[1]-p[3]),rand:(a,b)=>(a+b)/2,choose:a=>a[0],pointerPosition:e=>({x:e.x,y:e.y}),setHud(){},showBanner(){},AudioFX:{play(){}},vibrate(){}};
  const scope={window:{addEventListener:listen},document,console,Math};vm.runInNewContext(source,scope);const game=scope.window.createPicnicHeist(E,()=>true);game.attach();game.reset();
  const copy=value=>JSON.parse(JSON.stringify(value));
  return{game,E,events,state:()=>copy(game.captureState()),restore:s=>game.restoreState(copy(s)),key:(key,type='keydown')=>{for(const fn of listeners.get(type)||[])fn({key,code:key===' '?'Space':key,preventDefault(){}});}};
}
function tick(game,seconds){for(let t=0;t<seconds;t+=.02)game.update(.02);}
test('steer, carry at most three crumbs, deposit, and complete the picnic',()=>{
  const f=fixture(),s=f.state();s.spawnClock=3;s.bugs[0].x=250;s.bugs[0].y=250;s.crumbs=Array.from({length:5},()=>({x:270,y:250,gold:false,turn:0}));f.restore(s);
  f.key('ArrowRight');tick(f.game,.1);f.key('ArrowRight','keyup');assert.equal(f.state().bugs[0].bag,3);assert.equal(f.state().delivered,0);
  const carried=f.state();carried.bugs[0].x=f.game.debug().home.x;carried.bugs[0].y=f.game.debug().home.y;f.restore(carried);f.game.update(.02);assert.equal(f.state().delivered,3);assert.equal(f.state().bugs[0].bag,0);
  const last=f.state();last.delivered=last.target-1;last.bugs[0].bag=1;f.restore(last);f.game.update(.02);assert.equal(f.state().phase,'won');tick(f.game,2.4);assert.equal(f.state().round,2);assert.equal(f.state().delivered,0);
});
test('telegraphed swat waits, drops carried snacks, and ends at zero hearts',()=>{
  const f=fixture(),s=f.state();s.bugs[0]={...s.bugs[0],x:900,y:500,safe:0,bag:2};s.hearts=1;s.swats=[{x:900,y:500,r:65,wait:.15,life:.34,hit:false}];f.restore(s);f.game.update(.05);assert.equal(f.state().hearts,1);tick(f.game,.2);assert.equal(f.state().hearts,0);assert.equal(f.state().bugs[0].bag,0);assert.equal(f.state().phase,'gameover');
});
test('leaf hiding and gold bubble shields prevent a swat from costing a heart',()=>{
  const f=fixture();for(const hiding of [false,true]){
    const s=f.state(),p=hiding?f.game.debug().leaves[0]:{x:900,y:500};s.bugs[0]={...s.bugs[0],...p,safe:0,shield:hiding?0:7};s.swats=[{...p,r:65,wait:0,life:.34,hit:false}];f.restore(s);f.game.update(.02);assert.equal(f.state().hearts,4);if(!hiding)assert.equal(f.state().bugs[0].shield,0);
  }
});
test('dash has a cooldown, preserves bounded positions, and pause releases held input',()=>{
  const f=fixture();f.key('ArrowRight');f.key(' ');f.game.update(.02);assert(f.state().bugs[0].dash>0);assert(f.state().bugs[0].cooldown>3);const b=f.state().bugs[0];f.game.pause();tick(f.game,.5);assert.equal(f.state().bugs[0].x,b.x);assert.equal(f.state().bugs[0].y,b.y);
  f.key('ArrowLeft');tick(f.game,30);f.key('ArrowLeft','keyup');assert(f.state().bugs[0].x>=14);
});
test('two bugs can move independently and saved state scales without restarting the round',()=>{
  const f=fixture();f.game.setPlayers(2);f.game.reset();const initial=f.state();f.key('d');f.key('ArrowDown');tick(f.game,.2);f.key('d','keyup');f.key('ArrowDown','keyup');const before=f.state();assert(before.bugs[0].x>initial.bugs[0].x);assert.equal(before.bugs[0].y,initial.bugs[0].y);assert(before.bugs[1].y>initial.bugs[1].y);assert.equal(before.bugs[1].x,initial.bugs[1].x);
  f.E.W=500;f.E.H=325;f.restore(before);const after=f.state();assert.equal(after.players,2);assert.equal(after.bugs[0].x,before.bugs[0].x/2);assert.equal(after.bugs[1].y,before.bugs[1].y/2);assert.equal(after.round,before.round);
});
test('long sessions retain bounded entities and valid serializable snapshots',()=>{
  const f=fixture();for(let i=0;i<24000;i++)f.game.update(.02);const s=f.state();assert(s.crumbs.length<=8);assert(s.swats.length<=8);assert(s.effects.length<=100);assert(JSON.stringify(s).length<16000);assert(s.bugs.every(b=>Number.isFinite(b.x)&&Number.isFinite(b.y)));assert.throws(()=>f.game.restoreState({mode:'heist',bugs:[]}));
});
