import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {gunzipSync} from 'node:zlib';
import {chromium,browserLaunchOptions} from './browser-runtime.mjs';
import {startStaticFixture} from './static-fixture.mjs';
const fixture=await startStaticFixture(),browser=await chromium.launch(browserLaunchOptions);
const output=new URL('../test-results/face-size/',import.meta.url);await mkdir(output,{recursive:true});
const results=[],errors=[];
let server=null;
async function check(name,fn){try{await fn();results.push({name,pass:true});console.log('PASS '+name);}catch(error){results.push({name,pass:false,error:error.stack});console.error('FAIL '+name+': '+error.message);}}
async function visit(context,base=fixture.base){const page=await context.newPage();page.setDefaultTimeout(7000);page.on('pageerror',error=>errors.push(error.message));await page.goto(base+'/silly-face-lab/');await page.locator('#shared-launch').waitFor({state:'attached'});return page;}
async function snapshot(page){return page.evaluate(()=>SillyFaceAutosave.capture());}
async function sharedSnapshot(page){const checkpoint=await page.evaluate(()=>ArcadeSharedActivity.getState().room.state);return JSON.parse(checkpoint.codec==='gzip'?gunzipSync(Buffer.from(checkpoint.data,'base64')).toString():checkpoint.data).snapshot;}
async function sharedSize(page,value){const deadline=Date.now()+10000;do{const saved=await sharedSnapshot(page);if(saved.state.faceSize===value)return saved;await page.waitForTimeout(75);}while(Date.now()<deadline);throw new Error('Canonical shared size did not reach '+value);}
try{
  for(const viewport of [{width:1440,height:900},{width:390,height:844},{width:320,height:568},{width:844,height:390}]){
    await check(`Face size button, undo, stickers and old saves ${viewport.width}x${viewport.height}`,async()=>{
      const context=await browser.newContext({viewport,hasTouch:true}),page=await visit(context),gesture=viewport.width<500?'tap':'click';
      try{
        assert.equal(await page.locator('input[type="range"]').count(),0,'Slider is replaced');
        assert.equal(await page.locator('#sizeButton').isDisabled(),true,'Template has no size control');
        await page.locator('[data-stage="face"]')[gesture]();
        await page.evaluate(()=>{const saved=SillyFaceAutosave.capture();saved.state.faceSize=1.37;SillyFaceAutosave.restore(saved);});
        assert.equal((await snapshot(page)).state.faceSize,1.37,'Arbitrary old save is not quantized');
        assert.equal(await page.locator('#sizeValue').innerText(),'137%');
        const before=await snapshot(page);
        await page.locator('#sizeButton')[gesture]();
        let after=await snapshot(page);assert.equal(after.state.faceSize,1.5);assert.equal(after.history.length,before.history.length+1,'One undo step per tap');
        await page.getByRole('button',{name:'Undo',exact:true})[gesture]();assert.equal((await snapshot(page)).state.faceSize,1.37);
        await page.locator('[data-category="eyes"]')[gesture]();
        await page.locator('#sizeButton')[gesture]();after=await snapshot(page);assert.equal(after.state.eyeSize,1.25);assert.equal(after.state.faceSize,1.37,'Only selected part changes');
        await page.locator('#sizeButton').focus();await page.keyboard.press('Enter');assert.equal((await snapshot(page)).state.eyeSize,1.5);
        await page.keyboard.press('Space');assert.equal((await snapshot(page)).state.eyeSize,1.75);
        for(const size of [2,2.25,2.5,.5,.75,1]){await page.locator('#sizeButton')[gesture]();assert.equal((await snapshot(page)).state.eyeSize,size,'Full range cycles and wraps');}
        await page.locator('[data-stage="extras"]')[gesture]();await page.locator('[data-category="stickers"]')[gesture]();
        assert.equal(await page.locator('#sizeButton').isDisabled(),true,'No sticker selected');
        await page.locator('#sec-stickers .sticker-card').first()[gesture]();before.state=(await snapshot(page)).state;
        await page.locator('#sizeButton')[gesture]();after=await snapshot(page);assert.equal(after.state.stickers[0].size,73,'Sticker size changes');
        assert.equal(after.state.faceSize,1.37);await page.getByRole('button',{name:'Undo',exact:true})[gesture]();assert.equal((await snapshot(page)).state.stickers[0].size,58);
        const button=await page.locator('#sizeButton').boundingBox();assert.ok(button&&button.height>=40&&button.x>=0&&button.y>=0&&button.x+button.width<=viewport.width+1&&button.y+button.height<=viewport.height+1,'Button fits viewport');
        await page.waitForTimeout(1900);await page.screenshot({path:new URL(`size-${viewport.width}x${viewport.height}.png`,output).pathname});
        await page.evaluate(()=>ArcadeSave.saveNow());await page.goto(fixture.base+'/silly-face-lab/?resume=1');await page.waitForFunction(()=>SillyFaceAutosave.capture().state.faceSize===1.37);
        assert.equal((await snapshot(page)).state.stickers[0].size,58,'Native reload retains precise sizes');
      }catch(error){await page.screenshot({path:new URL(`size-${viewport.width}-failure.png`,output).pathname}).catch(()=>{});throw error;}
      finally{await context.close();}
    });
  }
  await check('Pinch resizing and one-step undo remain available',async()=>{
    const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true}),page=await visit(context);
    try{
      await page.locator('[data-stage="face"]').tap();const before=await snapshot(page),rect=await page.locator('#mainCanvas').boundingBox();
      const x=Math.round(rect.x+rect.width/2),y=Math.round(rect.y+rect.height/2),session=await context.newCDPSession(page);
      await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:x-24,y,id:1},{x:x+24,y,id:2}]});
      await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x-36,y,id:1},{x:x+36,y,id:2}]});
      await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
      const after=await snapshot(page);assert.ok(after.state.faceSize>before.state.faceSize);assert.equal(after.history.length,before.history.length+1);
      assert.equal(await page.locator('#sizeValue').innerText(),Math.round(after.state.faceSize*100)+'%');
      await page.getByRole('button',{name:'Undo',exact:true}).tap();assert.equal((await snapshot(page)).state.faceSize,before.state.faceSize);
    }finally{await context.close();}
  });
  await check('Real shared controller size, observer block, handoff and local restoration',async()=>{
    server=spawn(process.execPath,['guess-who/test-server.mjs'],{stdio:['ignore','pipe','pipe']});let serverErrors='';server.stderr.on('data',data=>serverErrors+=data);
    await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Server did not start: '+serverErrors)),30000);server.stdout.on('data',data=>{if(String(data).includes('test site')){clearTimeout(timer);resolve();}});server.once('exit',code=>{clearTimeout(timer);reject(new Error('Server exited '+code+': '+serverErrors));});});
    const contexts=await Promise.all([browser.newContext({viewport:{width:390,height:844},hasTouch:true}),browser.newContext({viewport:{width:390,height:844},hasTouch:true})]);
    try{
      for(const context of contexts)await context.addInitScript(()=>{window.ARCADE_WORKER_BASE='http://127.0.0.1:8788';});
      const [host,guest]=await Promise.all(contexts.map(context=>visit(context,'http://127.0.0.1:8787')));
      await host.locator('[data-stage="face"]').tap();await guest.locator('[data-stage="face"]').tap();
      await guest.evaluate(()=>{const saved=SillyFaceAutosave.capture();saved.state.faceSize=1.73;SillyFaceAutosave.restore(saved);});
      const room=await host.evaluate(()=>ArcadeSharedActivity.create({username:'Host'}));await guest.evaluate(code=>ArcadeSharedActivity.join({username:'Guest',code}),room.code);
      await guest.waitForFunction(()=>ArcadeSharedActivity.getState().appliedSequence>=0&&!ArcadeSharedActivity.isController());
      await host.waitForFunction(()=>!ArcadeSharedActivity.isSpectator());
      const initialFrame=await guest.locator('img[data-shared-canvas]').first().getAttribute('src');
      await host.locator('#sizeButton').tap();assert.equal((await snapshot(host)).state.faceSize,1.25,'Ready controller changes size');
      const shared=await sharedSize(guest,1.25);await guest.waitForFunction(()=>document.getElementById('sizeValue').textContent==='125%');
      assert.notEqual(await guest.locator('img[data-shared-canvas]').first().getAttribute('src'),initialFrame,'Observer displays resized host canvas');
      const observerLocal=await snapshot(guest);await guest.locator('#sizeButton').tap();await guest.waitForTimeout(400);
      assert.deepEqual(await snapshot(guest),observerLocal,'Observer tap does not change its native scene');assert.deepEqual(await sharedSnapshot(host),shared,'Observer cannot alter canonical scene');assert.equal((await snapshot(host)).state.faceSize,1.25);
      await host.evaluate(()=>ArcadeSharedActivity.pass(1));await guest.waitForFunction(()=>!ArcadeSharedActivity.isSpectator()&&SillyFaceAutosave.capture().state.faceSize===1.25);
      await guest.locator('#sizeButton').tap();await sharedSize(host,1.5);await host.waitForFunction(()=>document.getElementById('sizeValue').textContent==='150%');
      await guest.evaluate(()=>ArcadeSharedActivity.leave());assert.equal((await snapshot(guest)).state.faceSize,1.73,'Guest local size restored exactly');
      await host.evaluate(()=>ArcadeSharedActivity.leave());
    }finally{await Promise.all(contexts.map(context=>context.close()));}
  });
}finally{
  await writeFile(new URL('report.json',output),JSON.stringify({results,errors},null,2));await browser.close();await fixture.close();if(server)server.kill('SIGTERM');
}
assert.deepEqual(errors,[],'No page errors');assert.equal(results.filter(result=>!result.pass).length,0,'Every size-control scenario passes');
console.log(`Passed ${results.length} Face Lab size-button browser scenarios.`);
