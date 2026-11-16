#!/usr/bin/env node
// Real browser touch controls, authoritative knockback, replay and save tests.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {chromium,browserLaunchOptions} from './browser-runtime.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const out=path.join(root,'test-results/tanks-impact');
await mkdir(out,{recursive:true});
const mime={'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml'};
const server=createServer(async(req,res)=>{
 try{
  let p=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  while(p.startsWith('/'))p=p.slice(1);
  if(!p||p.endsWith('/'))p+='index.html';
  const file=path.resolve(root,p);
  if(!file.startsWith(root)||p.split('/').some(n=>n.startsWith('.')))throw Error('unsafe path');
  const bytes=await readFile(file);
  res.writeHead(200,{'content-type':mime[path.extname(file)]||'application/octet-stream'});res.end(bytes);
 }catch{res.writeHead(404);res.end('Not found');}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base='http://127.0.0.1:'+server.address().port,errors=[],checks=[];
let browser;
try{
 browser=await chromium.launch(browserLaunchOptions);
 const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,reducedMotion:'no-preference'});
 await context.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
 const page=await context.newPage();
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'/tanks/');
 await page.waitForFunction(()=>!!window.TanksGame?.getState);
 assert.equal(await page.locator('#arsenal').count(),0);
 await page.selectOption('#mode','hotseat');
 await page.click('#localStart');
 await page.waitForFunction(()=>!!TanksGame.getState());
 const before=await page.evaluate(async()=>{
  const {createGame}=await import('./engine.js');
  const state=createGame({seed:345,terrainType:'flat'});
  state.tanks[1].x=210;state.tanks[1].y=400;
  if(!state.tanks[0].inventory.includes('cannonball'))state.tanks[0].inventory[0]='cannonball';
  ArcadeSave.getAdapter().restore({schema:1,mode:'hotseat',difficulty:'normal',game:state,
    aims:[{angle:0,power:25,weaponId:'cannonball'},{angle:135,power:55}]});
  return state;
 });
 await page.click('#anglePlus');
 assert.equal(await page.inputValue('#angle'),'1');
 assert.equal(await page.inputValue('#angleNumber'),'1');
 await page.click('#angleMinus');
 assert.equal(await page.inputValue('#angle'),'0');
 assert.equal(await page.locator('#angleMinus').isDisabled(),true);
 await page.click('#powerPlus');
 assert.equal(await page.inputValue('#power'),'26');
 assert.equal(await page.inputValue('#powerNumber'),'26');
 await page.click('#powerMinus');
 assert.equal(await page.inputValue('#powerNumber'),'25');
 await page.click('#moveMinus');
 assert.equal(await page.inputValue('#moveDistance'),'4');
 await page.click('#movePlus');
 assert.equal(await page.inputValue('#moveDistance'),'5');
 assert.equal(await page.locator('#movePlus').isDisabled(),true);
 checks.push('One-unit arrows, live values and end stops');
 await page.click('#fire');
 await page.waitForFunction(()=>TanksGame.getState()?.shotsTotal===1&&TanksGame.getDebug().animating,null,{timeout:10000});
 const after=await page.evaluate(()=>TanksGame.getState());
 assert.ok(after.lastShot.scoreGain[0]>50);
 assert.ok(after.tanks[1].x>before.tanks[1].x);
 assert.equal(after.tanks[1].movesLeft,4);
 assert.equal(await page.locator('#anglePlus').isDisabled(),true,'Steppers locked during a shot');
 const replay=await page.evaluate(async(b)=>{
  const {tankImpactAtTick,drawBattle}=await import('./graphics.js');
  const a=TanksGame.getState(),event=a.lastShot.effects.find(e=>e.pushes?.some(p=>p[0]===1));
  if(!event)throw Error('missing recorded tank hit');
  const before=tankImpactAtTick(b.tanks[1].x,1,a.lastShot.effects,event.tick-1);
  const middle=tankImpactAtTick(b.tanks[1].x,1,a.lastShot.effects,event.tick+5);
  const final=tankImpactAtTick(b.tanks[1].x,1,a.lastShot.effects,360);
  const c=document.createElement('canvas');c.width=1000;c.height=560;
  for(const tick of [0,event.tick-1,event.tick+5,360])
   drawBattle(c,a,{animation:{before:b,shot:a.lastShot,tick},viewportTop:0});
  return {before,middle,final};
 },before);
 assert.equal(replay.before.x,before.tanks[1].x);
 assert.ok(replay.middle.hop>0);
 assert.equal(replay.final.x,after.tanks[1].x);
 checks.push('Real fired cannonball displaces target and Canvas replay includes a hop');
 await page.waitForFunction(()=>!TanksGame.getDebug().animating,null,{timeout:10000});
 await page.evaluate(()=>ArcadeSave.saveNow());
 await page.reload();await page.click('.arcade-save-primary');
 await page.waitForFunction(()=>TanksGame.getState()?.shotsTotal===1);
 assert.deepEqual(await page.evaluate(()=>TanksGame.getState()),after);
 checks.push('Knocked position survives actual browser reload');
 await page.evaluate(async()=>{
   const {createGame}=await import('./engine.js');
   const {weaponById}=await import('./weapons.js');
   const game=createGame({seed:897,terrainType:'flat'}),w=weaponById('time-bomb');
   game.mines=[{id:'mine:1',weaponId:w.id,owner:1,x:220,y:397,
     damage:96,radius:25,depth:0,craterScale:1,falloff:1,fuse:1,color:w.color}];
   ArcadeSave.getAdapter().restore({schema:1,mode:'hotseat',difficulty:'normal',game,
     aims:[{angle:45,power:50},{angle:135,power:55}]});
 });
 await page.locator('#moveDistance').evaluate(el=>{el.value='3';el.dispatchEvent(new Event('input',{bubbles:true}));});
 assert.equal(await page.inputValue('#moveDistance'),'3');
 await page.click('#moveRight');
 await page.waitForFunction(()=>TanksGame.getState()?.lastMove?.intendedTo===220);
 const move=await page.evaluate(()=>TanksGame.getState());
 assert.ok(move.tanks[0].x<220&&move.tanks[0].x>=45);
 assert.ok(move.lastMove.effects.some(e=>e.pushes?.some(p=>p[0]===0)));
 assert.equal(move.tanks[0].movesLeft,3);
 checks.push('Walking into an armed mine throws the tank without spending a shot');
 await page.waitForFunction(()=>!TanksGame.getDebug().animating,null,{timeout:10000});
 for(const [width,height] of [[320,568],[390,844],[844,390],[1280,800]]){
  await page.setViewportSize({width,height});await page.waitForTimeout(200);
  const bounds=await page.evaluate(()=>{
    const ids=['angleMinus','anglePlus','powerMinus','powerPlus','moveMinus','movePlus'];
    const r=ids.map(id=>{const x=document.getElementById(id).getBoundingClientRect();
      return {id,left:x.left,right:x.right,top:x.top,bottom:x.bottom,width:x.width,height:x.height};});
    return {overflow:document.documentElement.scrollWidth>innerWidth+2,buttons:r};
  });
  assert.equal(bounds.overflow,false,'Horizontal overflow at '+width+'x'+height);
  for(const b of bounds.buttons)assert.ok(b.width>=25&&b.height>=29&&b.left>=-1&&b.right<=width+1&&b.top>=-1&&b.bottom<=height+1,JSON.stringify({width,height,b}));
  await page.screenshot({path:path.join(out,'impact-'+width+'x'+height+'.png')});
 }
 checks.push('All six precision arrows visible and usable in four phone/desktop layouts');
 // Edge clamping is an actual move, not a rejected request or a spent turn.
 await page.evaluate(async()=>{
   const {createGame}=await import('./engine.js');
   const game=createGame({seed:887,terrainType:'flat'});
   ArcadeSave.getAdapter().restore({schema:1,mode:'hotseat',difficulty:'normal',game,
     aims:[{angle:45,power:55,weaponId:game.tanks[0].inventory[0]}]});
 });
 await page.locator('#moveDistance').evaluate(el=>{el.value='5';el.dispatchEvent(new Event('input',{bubbles:true}));});
 await page.locator('#moveLeft').click();
 await page.waitForFunction(()=>TanksGame.getState()?.lastMove?.to===45);
 assert.equal(await page.evaluate(()=>TanksGame.getState().tanks[0].movesLeft),3);
 await page.waitForFunction(()=>!TanksGame.getDebug().animating);
 await page.locator('#moveLeft').click();
 await page.waitForFunction(()=>document.getElementById('message').textContent.includes('already at the edge'));
 assert.equal(await page.evaluate(()=>TanksGame.getState().tanks[0].movesLeft),3);
 checks.push('Out-of-bounds movement stops at the boundary; no extra charge when already there');
 // Draw each scoring hit independently and continue after its projectile disappears.
 await page.evaluate(async()=>{
   const {createGame}=await import('./engine.js');
   const state=createGame({seed:345,terrainType:'flat'});
   state.tanks[1].x=210;state.tanks[1].y=400;
   if(!state.tanks[0].inventory.includes('cannonball'))state.tanks[0].inventory[0]='cannonball';
   ArcadeSave.getAdapter().restore({schema:1,mode:'hotseat',difficulty:'normal',game:state,
     aims:[{angle:0,power:25,weaponId:'cannonball'}]});
 });
 await page.locator('#fire').click();
 await page.waitForFunction(()=>TanksGame.getDebug().damageNumbers.length>0,null,{timeout:10000});
 const dmg=await page.evaluate(()=>{
   const st=TanksGame.getState(),nums=TanksGame.getDebug().damageNumbers;
   return {amounts:nums.map(n=>n.amount),events:st.lastShot.effects.flatMap(e=>e.damageHits||[]),ages:nums.map(n=>n.ageMs)};
 });
 assert.ok(dmg.events.some(([target,amount])=>target===1&&amount>=40));
 assert.ok(dmg.amounts.some(amount=>dmg.events.some(hit=>hit[1]===amount)));
 checks.push('Damage number appears for the precise engine-scored impact');
 for(const [width,height] of [[320,568],[390,844],[844,390],[1280,800]]){
   await page.setViewportSize({width,height});await page.waitForTimeout(180);
   const fit=await page.evaluate(()=>{
     const state=TanksGame.getState(),debug=TanksGame.getDebug();
     const get=id=>{const b=document.querySelector(id).getBoundingClientRect();return {left:b.left,right:b.right,top:b.top,bottom:b.bottom,width:b.width,height:b.height};};
     return {arena:get('#arena'),canvas:get('#battlefield'),controls:get('#controls'),scores:get('.scores'),camera:debug.camera,minY:Math.min(...state.terrain),maxY:Math.max(...state.terrain),overflow:document.documentElement.scrollWidth>innerWidth+1};
   });
   assert.equal(fit.overflow,false,JSON.stringify({width,height,fit}));
   assert.ok(fit.arena.width>=width-1&&fit.arena.height>=height-1,'Full-screen stage: '+width+'x'+height);
   assert.ok(fit.canvas.left>=-1&&fit.canvas.right<=width+1,'Both terrain ends are visible');
   assert.ok(fit.canvas.top>=fit.scores.bottom-4,'Canvas below upper HUD');
   assert.ok(fit.canvas.bottom<=fit.controls.top+4,'Canvas above lower HUD');
   assert.ok(fit.camera.top<=fit.minY&&fit.camera.top+fit.camera.height>=fit.maxY,
     'Every ground sample fits within camera bounds');
   await page.screenshot({path:path.join(out,'full-stage-'+width+'x'+height+'.png')});
 }
 checks.push('Entire ground profile visible; HUD floats above the stage on four layouts');
 assert.deepEqual(errors,[]);
 await writeFile(path.join(out,'report.json'),JSON.stringify({pass:true,checks,errors},null,2)+'\n');
 console.log('PASS Tank impact browser:',checks.join('; '));
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
