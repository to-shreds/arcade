import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const out=path.join(root,'test-results','monster-forge');await fs.mkdir(out,{recursive:true});
const types={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png'};
const server=http.createServer(async(req,res)=>{try{let pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);if(pathname.endsWith('/'))pathname+='index.html';const filename=path.resolve(root,'.'+pathname);if(!filename.startsWith(root+path.sep))throw Error('outside root');const data=await fs.readFile(filename);res.writeHead(200,{'Content-Type':types[path.extname(filename)]||'application/octet-stream','Cache-Control':'no-store'});res.end(data)}catch(_){res.writeHead(404);res.end('Not found')}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true});const results=[];
const snap=page=>page.evaluate(()=>MonsterForgeAutosave.capture().monster);
async function waitReady(page){await page.waitForFunction(()=>window.MonsterForgeAutosave&&window.ArcadeSave?.getAdapter());await page.waitForTimeout(100);}
async function clear(page){await page.evaluate(()=>{MonsterForgeAutosave.startFresh();});}
async function recipe(page,id){await clear(page);await page.click('#starterBtn');await page.click(`[data-starter="${id}"]`);await page.waitForFunction(()=>document.getElementById('modal').hidden&&MonsterForgeAutosave.capture().monster.items.length>0);}
async function point(page,x,y){return page.evaluate(({x,y})=>{const p=document.getElementById('art').createSVGPoint();p.x=x;p.y=y;const s=p.matrixTransform(document.getElementById('art').getScreenCTM());return {x:s.x,y:s.y};},{x,y})}
async function draw(page,touch=false){
 await page.click('[data-tool="draw"]');const a=await point(page,160,140),z=await point(page,260,220);
 if(touch){const client=await page.context().newCDPSession(page);await client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:a.x,y:a.y}]});await client.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:z.x,y:z.y}]});assert(await page.locator('#art path[data-id]').count()>0,'touch stroke renders before release');await client.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await client.detach();}
 else{await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(z.x,z.y,{steps:7});assert(await page.locator('#art path[data-id]').count()>0,'live stroke renders before mouseup');await page.mouse.up();}
}
try{
 for(const [w,h] of [[1280,800],[832,384],[390,844],[320,568]]){
  const context=await browser.newContext({viewport:{width:w,height:h},hasTouch:true,acceptDownloads:true});const page=await context.newPage();page.setDefaultTimeout(10000);
  const errors=[];page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error'&&/attribute d|Expected number|NaN/.test(m.text()))errors.push(m.text())});
  await page.goto(base+'/monster-forge/');await waitReady(page);
  assert.equal(await page.evaluate(()=>Object.keys(ForgeParts.parts).length),50);
  // Every specimen, not only the default dragon.
  for(const id of ['dragon','beast','kraken','crawler','golem','slime']){
   await recipe(page,id);const m=await snap(page);assert.equal(m.items.length,await page.evaluate(id=>ForgeParts.recipe(id).items.length,id));assert(m.items.every(p=>p.artVersion===2));
   assert.equal(await page.evaluate(()=>[...document.querySelectorAll('#art path')].filter(p=>!Number.isFinite(p.getTotalLength())).length),0);
   await page.screenshot({path:path.join(out,`${id}-${w}x${h}.png`)});
  }
  await clear(page);await draw(page);await page.click('#symmetryBtn');await draw(page,true);
  let m=await snap(page);assert.equal(m.items.length,3,'one mouse line and a mirrored pair');assert.equal(m.items[1].points.length,m.items[2].points.length);
  for(let i=0;i<m.items[1].points.length;i++)assert(Math.abs(m.items[1].points[i].x+m.items[2].points[i].x-900)<.01);
  await page.click('#undoBtn');assert.equal((await snap(page)).items.length,1);await page.click('#redoBtn');assert.equal((await snap(page)).items.length,3);
  await clear(page);await page.click('[data-tool="build"]');await page.click('[data-category="Limbs"]');await page.click('[data-part="claw"]');
  await page.click('#biggerBtn');await page.click('#rightBtn');await page.click('#flipBtn');
  m=await snap(page);assert.equal(m.items[0].flip,-1);assert.equal(m.items[0].rot,15);
  await page.click('#copyBtn');await page.click('#mirrorBtn');m=await snap(page);assert.equal(m.items.length,3);assert(Math.abs(m.items[1].x+m.items[2].x-900)<.01);
  await page.locator('#editColors [data-color="#e84756"]').click();assert.equal((await snap(page)).items[2].color,'#e84756');
  await page.click('#backBtn');await page.click('#frontBtn');await page.screenshot({path:path.join(out,`edit-${w}x${h}.png`)});
  // True mouse drag with rotation, flipping, and SVG letterboxing.
  await page.evaluate(()=>MonsterForgeAutosave.restore({monster:{items:[{kind:'part',id:'drag-target',type:'blob',x:450,y:300,scale:1,rot:15,flip:-1,color:'#81b79e',artVersion:2}]}}));
  const a=await point(page,450,300),z=await point(page,510,340);await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(z.x,z.y,{steps:5});await page.mouse.up();
  m=await snap(page);assert(Math.abs(m.items[0].x-510)<1);assert(Math.abs(m.items[0].y-340)<1);
  // Every actual picker button inserts its intended anatomy and can be undone.
  await clear(page);const defs=await page.evaluate(()=>Object.values(ForgeParts.parts).map(p=>({id:p.id,cat:p.category})));
  for(const def of defs){await page.click('[data-tool="build"]');await page.locator(`[data-category="${def.cat}"]`).click();await page.locator(`[data-part="${def.id}"]`).click();const state=await snap(page);assert.equal(state.items.at(-1).type,def.id);assert(await page.locator('#art .anim > *').count()>0);await page.click('#undoBtn');assert.equal((await snap(page)).items.length,0);}
  // Old save records render original v1 paths and retain transforms and color.
  const legacy={monster:{uid:'mf-legacy-fixture',name:'Old friend',items:[{kind:'part',id:'old1',type:'claw',x:432,y:312,scale:.8,rot:25,flip:-1,color:'#72e985'}]}};
  await page.evaluate(raw=>MonsterForgeAutosave.restore(raw),legacy);m=await snap(page);assert.equal(m.items[0].artVersion,1);assert.equal(m.items[0].x,432);assert.equal(m.items[0].rot,25);
  assert((await page.locator('#art .anim path').first().getAttribute('d')).startsWith('M-57 113Q-120 37'),'old drawing is not silently replaced');
  // Actual IndexedDB and Arcade autosave round trip, including browser reload.
  await recipe(page,'dragon');await page.click('#saveBtn');await page.fill('#field-name','Saved dragon');await page.locator('#modalActions button').last().click();await page.waitForTimeout(200);await page.evaluate(()=>ArcadeSave.saveNow());
  const saved=await snap(page);await page.goto(base+'/monster-forge/?resume=1');await waitReady(page);await page.waitForFunction(()=>MonsterForgeAutosave.capture().monster.name==='Saved dragon');assert.deepEqual((await snap(page)).items,saved.items);
  await page.click('#starterBtn');await page.click('[data-starter="beast"]');await page.getByRole('button',{name:'Save and start',exact:true}).click();await page.waitForFunction(()=>document.getElementById('modal').hidden);await page.click('#collectionBtn');await page.waitForSelector('.monster-tile');assert((await page.locator('.monster-tile strong').allTextContents()).includes('Saved dragon'));
  await page.locator('.monster-tile').filter({has:page.locator('strong',{hasText:'Saved dragon'})}).getByRole('button',{name:'Open',exact:true}).click();await page.waitForFunction(()=>MonsterForgeAutosave.capture().monster.name==='Saved dragon'&&document.getElementById('collection').hidden);assert.equal((await snap(page)).name,'Saved dragon');
  await page.click('#labBtn');for(const fx of ['roar','fire','slime','shake','dance'])await page.locator(`[data-effect="${fx}"]`).click();await page.waitForTimeout(100);assert(await page.locator('#fxLayer circle').count()>0);assert(await page.locator('#fxLayer circle').count()<=95);await page.click('#closeLab');
  await page.click('#menuBtn');const downloadPromise=page.waitForEvent('download');await page.click('#exportBtn');const download=await downloadPromise;const dest=path.join(out,`dragon-${w}.png`);await download.saveAs(dest);const png=await fs.readFile(dest);assert.equal(png.readUInt32BE(16),1800);assert.equal(png.readUInt32BE(20),1200);
  await page.click('[data-tool="build"]');await page.screenshot({path:path.join(out,`parts-${w}x${h}.png`)});
  const dimensions=await page.evaluate(()=>({sw:document.documentElement.scrollWidth,sh:document.documentElement.scrollHeight,w:innerWidth,h:innerHeight}));assert(dimensions.sw<=dimensions.w);assert(dimensions.sh<=dimensions.h);assert.deepEqual(errors,[]);
  results.push({viewport:[w,h],passed:true,parts:50,starters:6,errors});console.log(`PASS Monster Forge 50 parts, 6 starters, real storage, PNG and touch: ${w}x${h}`);await context.close();
 }
 // More than fifty fallback saves must never discard earlier creations.
 const c=await browser.newContext();await c.addInitScript(()=>Object.defineProperty(window,'indexedDB',{value:undefined,configurable:true}));const p=await c.newPage();await p.goto(base+'/monster-forge/');await waitReady(p);
 await p.evaluate(()=>{const rows=Array.from({length:51},(_,i)=>({uid:'mf-fallback-'+i,name:'Kept '+i,items:[{kind:'part',id:'saved-'+i,type:'eye',x:450,y:300,scale:1,rot:0,flip:1,color:'#eeaa66',artVersion:2}],updatedAt:i}));localStorage.setItem('monsterforge.collection.v1',JSON.stringify(rows));});
 await recipe(p,'slime');await p.click('#saveBtn');await p.fill('#field-name','Number 52');await p.locator('#modalActions button').last().click();await p.waitForTimeout(200);assert.equal(await p.evaluate(()=>JSON.parse(localStorage.getItem('monsterforge.collection.v1')).length),52);
 await p.click('#starterBtn');await p.click('[data-starter="dragon"]');await p.evaluate(()=>{const previous=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k==='monsterforge.collection.v1')throw new DOMException('Full','QuotaExceededError');return previous.call(this,k,v)}});const before=await snap(p);await p.getByRole('button',{name:'Save and start',exact:true}).click();await p.waitForTimeout(150);assert.deepEqual((await snap(p)).items,before.items,'failed preservation must not replace current drawing');await c.close();
 // The real persistent Arcade shell opens and closes the activity without replacing itself.
 const home=await browser.newPage();await home.goto(base+'/');await home.waitForFunction(()=>window.ArcadeShell?.openGame);await home.evaluate(()=>ArcadeShell.openGame('monster-forge'));const frame=home.frameLocator('iframe').first();await frame.locator('#homeBtn').click();await home.waitForFunction(()=>![...document.querySelectorAll('iframe')].some(f=>f.src.includes('monster-forge')));assert.equal(new URL(home.url()).pathname,'/');await home.close();
 results.push({fallback52:true,failedSavePreservesDraft:true,shellHome:true});
 await fs.writeFile(path.join(out,'report.json'),JSON.stringify({passed:true,results},null,2));
 console.log('PASS old-art compatibility, preserved fallback collection, failed-save safety and Arcade Home');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
