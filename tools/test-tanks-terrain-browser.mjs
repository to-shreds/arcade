#!/usr/bin/env node
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile,rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {chromium,browserLaunchOptions} from './browser-runtime.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),out=path.join(root,'test-results/tanks-terrain');
await mkdir(out,{recursive:true});
await Promise.all(['failure.json','failure.png','report.json'].map(name=>rm(path.join(out,name),{force:true})));
const mime={'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png'};
const server=createServer(async(req,res)=>{try{
 let relative=decodeURIComponent(new URL(req.url,'http://localhost').pathname).replace(/^\/+/, '');
 if(!relative||relative.endsWith('/'))relative+='index.html';const file=path.resolve(root,relative);
 if(!file.startsWith(root)||relative.split('/').some(p=>p.startsWith('.')))throw Error('Invalid path');
 const bytes=await readFile(file);res.writeHead(200,{'content-type':mime[path.extname(file)]||'application/octet-stream'});res.end(bytes);
}catch{res.writeHead(404);res.end('Not found');}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`,errors=[],checks=[];let browser,page;
async function reloadSaved(expected,label){
 const saved=await page.evaluate(async()=>{
  const result=await ArcadeSave.saveNow();
  return {persisted:!!result,entry:ArcadeSave.getCurrentEntry(),capture:TanksGame.capture()};
 });
 assert.equal(saved.persisted,true,`${label}: explicit save finished before reload`);
 assert.deepEqual(saved.entry.data,saved.capture,`${label}: stored data equals the complete local battle and aims`);
 assert.deepEqual(saved.capture.game,expected,`${label}: saving preserves exact resolved battle`);
 await page.reload();
 // Keep an actual visible native click and strict equality. Do not replace this
 // with the adapter API: the resume prompt itself is part of the regression.
 await page.click('.arcade-save-primary');
 await page.waitForFunction(()=>TanksGame.getState()?.shotsTotal===1);
 assert.deepEqual(await page.evaluate(()=>TanksGame.getState()),expected,`${label}: native reload restores the exact battle`);
 assert.deepEqual(await page.evaluate(()=>TanksGame.capture()),saved.capture,`${label}: native reload also restores exact aim and local mode`);
}
try{
 browser=await chromium.launch(browserLaunchOptions);
 const context=await browser.newContext({viewport:{width:412,height:915},hasTouch:true,reducedMotion:'reduce'});
 await context.route('**/*',r=>new URL(r.request().url()).origin===base?r.continue():r.abort());
 page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`${base}/tanks/`);await page.waitForFunction(()=>window.TanksGame&&window.ArcadeSave?.getAdapter());
 await page.selectOption('#mode','hotseat');await page.click('#localStart');await page.waitForFunction(()=>!!TanksGame.getState());
 // Deliberate controlled saves, restored by the actual production adapter.
 const ids=['crater-maker','tight-bouquet','stitcher','single-skip','breadcrumb-bombs','deep-drill','subway','cutting-ray','dragon-breath','time-bomb','wall-drop','road-grader','chain-reaction','earthquake'];
 for(const id of ids){
  await page.evaluate(async id=>{const {createGame}=await import('./engine.js');const game=createGame({seed:321,terrainType:'flat'});if(!game.tanks[0].inventory.includes(id))game.tanks[0].inventory[0]=id;ArcadeSave.getAdapter().restore({schema:1,mode:'hotseat',difficulty:'normal',game,aims:[{angle:45,power:35,weaponId:id}]});window.terrainBefore=game;},id);
  await page.click('#weapon');const card=page.locator(`#weaponGrid [data-weapon="${id}"]`);assert.ok(await card.locator('.terrain-note').textContent());
  const preview=card.locator('.terrain-preview');assert.equal(await preview.getAttribute('viewBox'),'0 0 256 116');assert.ok((await preview.boundingBox()).width>=100);await card.click();
  await page.click('#fire');await page.waitForFunction(()=>TanksGame.getState()?.shotsTotal===1&&!TanksGame.getDebug().animating);
  const verified=await page.evaluate(async()=>{const {applyAction}=await import('./engine.js');const {terrainAtTick}=await import('./terrain-rules.js');const {drawBattle}=await import('./graphics.js');const s=TanksGame.getState(),shot=s.lastShot,b=window.terrainBefore;
   const expected=applyAction(b,{type:'fire',weaponId:shot.weaponId,angle:45,power:35});
   const c=document.createElement('canvas');c.width=1000;c.height=560;for(const tick of [0,30,60,120,180,240,360])drawBattle(c,s,{animation:{before:b,shot,tick}});
   return {same:JSON.stringify(expected)===JSON.stringify(s),exact:JSON.stringify(terrainAtTick(b.terrain,shot.effects,360))===JSON.stringify(s.terrain),id:shot.weaponId};});
  assert.equal(verified.same,true,id);assert.equal(verified.exact,true,id);checks.push(id);
 }
 const saved=await page.evaluate(()=>TanksGame.getState());await reloadSaved(saved,'earthquake');
 await page.click('#settings');await page.getByRole('button',{name:'Arsenal (84)',exact:true}).click();assert.equal(await page.locator('.terrain-preview').count(),84);
 await page.fill('#weaponSearch','road grader');assert.equal(await page.locator('#weaponGrid [data-weapon]').count(),1);assert.ok((await page.locator('.terrain-note').textContent()).includes('16'));
 await page.screenshot({path:path.join(out,'road-grader-profile.png')});await page.click('#modalClose');
 for(const [width,height] of [[412,915],[360,740],[915,412],[740,360],[667,375],[1280,800]]){
  await page.setViewportSize({width,height});await page.waitForTimeout(100);const r=await page.locator('#fire').boundingBox();assert.ok(r.x>=0&&r.y>=0&&r.x+r.width<=width+1&&r.y+r.height<=height+1);await reloadSaved(saved,`${width}x${height}`);await page.screenshot({path:path.join(out,`${width}x${height}.png`)});
 }
 assert.deepEqual(errors,[]);await writeFile(path.join(out,'report.json'),JSON.stringify({pass:true,checks,nativeReload:true,nativeReloads:7,errors},null,2)+'\n');console.log('PASS terrain browser: 14 families, same-scale previews, exact trace rendering, seven exact native reloads, arsenal search and six layouts');
}catch(error){
 const failure={error:error.stack,checks,errors};
 if(page&&!page.isClosed()){
  failure.browser=await page.evaluate(async()=>{
   const prompt=document.querySelector('.arcade-save-primary'),layer=document.querySelector('.arcade-save-layer'),r=prompt?.getBoundingClientRect();
   const style=prompt?getComputedStyle(prompt):null,rectangles=[],frames=[],started=performance.now();let polling=true;
   const rect=()=>{const b=prompt?.getBoundingClientRect();if(b)rectangles.push({ms:performance.now()-started,x:b.x,y:b.y,width:b.width,height:b.height});};
   function raf(now){if(!polling)return;frames.push(now-started);requestAnimationFrame(raf);}
   requestAnimationFrame(raf);
   for(let i=0;i<10;i++){rect();await new Promise(resolve=>setTimeout(resolve,100));}
   polling=false;
   return {url:location.href,readyState:document.readyState,visibility:document.visibilityState,entry:window.ArcadeSave?.getCurrentEntry(),capture:window.TanksGame?.capture(),debug:window.TanksGame?.getDebug(),sampling:{durationMs:performance.now()-started,rectangles,frames},prompt:prompt?{hidden:layer?.hidden,disabled:prompt.disabled,display:style.display,visibility:style.visibility,animation:style.animation,transition:style.transition,active:prompt.matches(':active'),focused:document.activeElement===prompt,rect:r?{x:r.x,y:r.y,width:r.width,height:r.height}:null}:null};
  }).catch(diagnosticError=>({error:diagnosticError.message}));
  await page.screenshot({path:path.join(out,'failure.png'),fullPage:true,timeout:5000}).catch(()=>{});
 }
 await writeFile(path.join(out,'failure.json'),JSON.stringify(failure,null,2)+'\n');
 throw error;
}finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
