#!/usr/bin/env node
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {chromium,browserLaunchOptions} from './browser-runtime.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),out=path.join(root,'test-results/tanks-terrain');
await mkdir(out,{recursive:true});
const mime={'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png'};
const server=createServer(async(req,res)=>{try{
 let relative=decodeURIComponent(new URL(req.url,'http://localhost').pathname).replace(/^\/+/, '');
 if(!relative||relative.endsWith('/'))relative+='index.html';const file=path.resolve(root,relative);
 if(!file.startsWith(root)||relative.split('/').some(p=>p.startsWith('.')))throw Error('Invalid path');
 const bytes=await readFile(file);res.writeHead(200,{'content-type':mime[path.extname(file)]||'application/octet-stream'});res.end(bytes);
}catch{res.writeHead(404);res.end('Not found');}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`,errors=[],checks=[];let browser;
try{
 browser=await chromium.launch(browserLaunchOptions);
 const context=await browser.newContext({viewport:{width:412,height:915},hasTouch:true,reducedMotion:'reduce'});
 await context.route('**/*',r=>new URL(r.request().url()).origin===base?r.continue():r.abort());
 const page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
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
 await page.evaluate(()=>ArcadeSave.saveNow());const saved=await page.evaluate(()=>TanksGame.getState());await page.reload();await page.click('.arcade-save-primary');await page.waitForFunction(()=>TanksGame.getState()?.shotsTotal===1);assert.deepEqual(await page.evaluate(()=>TanksGame.getState()),saved);
 await page.click('#settings');await page.getByRole('button',{name:'Arsenal (84)',exact:true}).click();assert.equal(await page.locator('.terrain-preview').count(),84);
 await page.fill('#weaponSearch','road grader');assert.equal(await page.locator('#weaponGrid [data-weapon]').count(),1);assert.ok((await page.locator('.terrain-note').textContent()).includes('16'));
 await page.screenshot({path:path.join(out,'road-grader-profile.png')});await page.click('#modalClose');
 for(const [width,height] of [[412,915],[360,740],[915,412],[740,360],[667,375],[1280,800]]){
  await page.setViewportSize({width,height});await page.waitForTimeout(100);const r=await page.locator('#fire').boundingBox();assert.ok(r.x>=0&&r.y>=0&&r.x+r.width<=width+1&&r.y+r.height<=height+1);await page.screenshot({path:path.join(out,`${width}x${height}.png`)});
 }
 assert.deepEqual(errors,[]);await writeFile(path.join(out,'report.json'),JSON.stringify({pass:true,checks,nativeReload:true,errors},null,2)+'\n');console.log('PASS terrain browser: 14 families, same-scale previews, exact trace rendering, real adapter/native reload, arsenal search and six layouts');
}finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
