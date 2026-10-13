#!/usr/bin/env node
// Actual shipped modules and native browser storage. Unsupported display APIs
// are simulated only in the dedicated rejection/race cases.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium, browserLaunchOptions } from './browser-runtime.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const out=path.join(root,'test-results/tanks-polish');
await mkdir(out,{recursive:true});
const mime={'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png'};
const server=createServer(async(req,res)=>{
 try{
  let relative=decodeURIComponent(new URL(req.url,'http://localhost').pathname).replace(/^\/+/, '');
  if(!relative||relative.endsWith('/'))relative+='index.html';
  const file=path.resolve(root,relative);
  if(!file.startsWith(root)||relative.split('/').some(p=>p.startsWith('.')))throw Error('Invalid path');
  const data=await readFile(file);res.writeHead(200,{'content-type':mime[path.extname(file)]||'application/octet-stream'});res.end(data);
 }catch{res.writeHead(404);res.end('Not found');}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`,errors=[],checks=[];
let browser;
try{
 browser=await chromium.launch(browserLaunchOptions);
 const context=await browser.newContext({viewport:{width:412,height:915},hasTouch:true,reducedMotion:'reduce'});
 await context.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`${base}/tanks/`);await page.waitForFunction(()=>window.TanksGame&&window.ArcadeSave?.getAdapter());
 await page.selectOption('#mode','hotseat');await page.click('#localStart');
 await page.waitForFunction(()=>!!TanksGame.getState());
 await page.evaluate(async()=>{
  const {createGame}=await import('./engine.js'),g=createGame({seed:12345,terrainType:'flat',names:['Jon','Player 2']});
  g.tanks[0].inventory=['crater-maker',...g.tanks[0].inventory.filter(w=>w!=='crater-maker')].slice(0,10);
  g.tanks[1].x=480;
  ArcadeSave.getAdapter().restore({schema:1,mode:'hotseat',game:g,aims:[{angle:45,power:40,weaponId:'crater-maker'}]});
  await ArcadeSave.saveNow();
 });
 await page.click('#fire');await page.waitForFunction(()=>TanksGame.getState().shotsTotal===1&&!TanksGame.getDebug().animating);
 const after=await page.evaluate(()=>TanksGame.getState());assert.ok(Math.max(...after.terrain)>490);
 await page.evaluate(()=>ArcadeSave.saveNow());await page.reload();await page.click('.arcade-save-primary');
 await page.waitForFunction(()=>TanksGame.getState()?.shotsTotal===1);
 assert.deepEqual(await page.evaluate(()=>TanksGame.getState()),after);checks.push('native saved-game reload');
 await page.click('#settings');await page.getByRole('button',{name:'Arsenal (84)',exact:true}).click();
 assert.equal(await page.locator('#weaponGrid [data-weapon]').count(),84);
 const svg=await page.locator('#weaponGrid svg').evaluateAll(elements=>elements.map(e=>e.querySelector('g').outerHTML.replace(/color="[^"]*"/,'')));
 assert.equal(new Set(svg).size,84);
 await page.fill('#weaponSearch','canyon');assert.equal(await page.locator('#weaponGrid [data-weapon]').count(),1);
 assert.equal(await page.locator('#weaponGrid [data-weapon]').getAttribute('data-weapon'),'canyon-cut');
 await page.click('#modalClose');checks.push('84 distinct artworks and arsenal search');
 for(const [width,height] of [[412,915],[360,740],[915,412],[740,360],[667,375],[1280,800]]){
  await page.setViewportSize({width,height});await page.waitForTimeout(180);
  const layout=await page.evaluate(()=>{
   const rect=s=>{const r=document.querySelector(s).getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};
   return{overflow:document.documentElement.scrollWidth>innerWidth+2,title:rect('.arcade-title'),actions:rect('.arcade-actions'),boxes:['#home','#landscape','#arena','#weapon','#angle','#power','#moveDistance','#moveLeft','#moveRight','#fire'].map(rect)};
  });
  assert.equal(layout.overflow,false);assert.ok(layout.title.right<=layout.actions.x+1);
  for(const r of layout.boxes)assert.ok(r.width>0&&r.height>0&&r.x>=-1&&r.right<=width+1&&r.y>=-1&&r.bottom<=height+1,JSON.stringify({width,height,r}));
  await page.screenshot({path:path.join(out,`${width}x${height}.png`)});
 }
 checks.push('six layouts with no header overlap or hidden movement slider');
 await page.setViewportSize({width:412,height:915});
 await page.evaluate(()=>{
  document.documentElement.requestFullscreen=()=>Promise.reject(new Error('Denied fixture'));
  Object.defineProperty(screen.orientation,'lock',{configurable:true,value:()=>Promise.reject(new Error('Unsupported fixture'))});
 });
 await page.click('#landscape');await page.waitForFunction(()=>document.body.classList.contains('tanks-wide')&&!document.getElementById('viewNotice').hidden);
 assert.deepEqual(await page.evaluate(()=>TanksGame.getState()),after);
 assert.equal(await page.locator('#landscape').getAttribute('aria-pressed'),'true');
 await page.reload();await page.click('.arcade-save-primary');await page.waitForFunction(()=>TanksGame.getState()?.shotsTotal===1);
 assert.ok(await page.locator('body').evaluate(e=>e.classList.contains('tanks-wide')));
 assert.deepEqual(await page.evaluate(()=>TanksGame.getState()),after);
 await page.click('#landscape');assert.equal(await page.locator('#landscape').getAttribute('aria-pressed'),'false');
 checks.push('denied fullscreen and rotation keep play usable; display preference restores separately');
 await page.evaluate(()=>{
  document.documentElement.requestFullscreen=()=>new Promise(resolve=>window.releaseFullscreen=resolve);
  window.lockCalls=0;Object.defineProperty(screen.orientation,'lock',{configurable:true,value:()=>{lockCalls++;return Promise.resolve();}});
 });
 await page.click('#landscape');await page.click('#landscape');await page.evaluate(()=>releaseFullscreen());await page.waitForTimeout(80);
 assert.equal(await page.locator('#landscape').getAttribute('aria-pressed'),'false');assert.equal(await page.evaluate(()=>lockCalls),0);
 checks.push('cancelled fullscreen request cannot re-enable wide view');
 for(let shot=1;shot<20;shot++){
  await page.click('#fire');await page.waitForFunction(n=>TanksGame.getState().shotsTotal===n+1&&!TanksGame.getDebug().animating,shot);
 }
 assert.equal(await page.evaluate(()=>TanksGame.getState().finished),true);checks.push('complete twenty-shot UI match');
 assert.deepEqual(errors,[]);
 await writeFile(path.join(out,'report.json'),JSON.stringify({pass:true,checks,errors},null,2)+'\n');
 console.log('PASS Tank Tactics polish:',checks.join('; '));
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
