// Shared rooms must work directly from every activity's untouched opening screen.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import {dirname} from 'node:path';
import {SHARED_ACTIVITY_IDS} from '../multiplayer/models/shared-activity-validator.js';
import {chromium,browserLaunchOptions} from './browser-runtime.mjs';

const server=spawn(process.execPath,['guess-who/test-server.mjs'],{stdio:['ignore','pipe','pipe']});
let serverErrors='';server.stderr.on('data',data=>serverErrors+=data);
await new Promise((accept,reject)=>{
  const timer=setTimeout(()=>reject(new Error(serverErrors||'Test server did not start')),30000);
  server.stdout.on('data',data=>{if(String(data).includes('test site')){clearTimeout(timer);accept();}});
  server.on('exit',code=>{clearTimeout(timer);reject(new Error('Server exited '+code+': '+serverErrors));});
});
const browser=await chromium.launch(browserLaunchOptions),results=[],errors=[];
const onlyCase=process.argv.find(value=>value.startsWith('--case='))?.slice(7);
const activities=SHARED_ACTIVITY_IDS.filter(id=>!onlyCase||id.includes(onlyCase));
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(page,predicate,timeout=12000){
  const deadline=Date.now()+timeout;
  while(Date.now()<deadline){if(await page.evaluate(predicate))return;await delay(75);}
  const diagnostic=await page.evaluate(()=>{const state=ArcadeSharedActivity.getState();return {activity:state.activity,active:state.active,connected:state.connected,controller:state.controller,appliedSequence:state.appliedSequence,status:state.statusText,error:document.getElementById('shared-error')?.textContent};});
  throw new Error('Timed out: '+predicate.toString()+'; '+JSON.stringify(diagnostic));
}
async function inspect(page){return page.evaluate(()=>({
  active:ArcadeSharedActivity.getState().active,
  connected:ArcadeSharedActivity.getState().connected,
  appliedSequence:ArcadeSharedActivity.getState().appliedSequence,
  controller:ArcadeSharedActivity.isController(),spectator:ArcadeSharedActivity.isSpectator(),
  error:document.getElementById('shared-error')?.textContent||''
}));}
async function test(activity){
  const started=Date.now(),contexts=[],localErrors=[];let result;
  try{
    const pages=[];
    for(const viewport of [{width:1440,height:900},{width:390,height:844}]){
      const context=await browser.newContext({viewport,hasTouch:viewport.width<500});contexts.push(context);
      await context.addInitScript(()=>{window.ARCADE_WORKER_BASE='http://127.0.0.1:8788';});
      const page=await context.newPage();page.setDefaultTimeout(10000);
      page.on('pageerror',error=>{const item={activity,message:error.message};errors.push(item);localErrors.push(item);});
      await page.goto('http://127.0.0.1:8787/'+activity+'/index.html');
      await until(page,()=>!!window.ArcadeSharedActivity?.getClient()&&!!window.ArcadeSave?.getAdapter());pages.push(page);
    }
    const [host,guest]=pages;
    if(activity==='mad-libs')assert.deepEqual(await host.evaluate(()=>MadLibsAutosave.capture()),{storyIndex:-1,activeCategory:'all',visibleLimit:18,values:[],screen:'picker'});
    // No game start, preset selection or semantic preparation precedes create/join.
    const created=await host.evaluate(()=>ArcadeSharedActivity.create({username:'Lobby host'}));
    const joined=await guest.evaluate(code=>ArcadeSharedActivity.join({username:'Lobby guest',code}),created.code);
    await until(host,()=>ArcadeSharedActivity.getState().connected&&!ArcadeSharedActivity.isSpectator());
    await until(guest,()=>ArcadeSharedActivity.getState().connected&&ArcadeSharedActivity.getState().appliedSequence>=0);
    const observer=await inspect(guest);
    assert.equal(observer.spectator,true);assert.equal(observer.controller,false);assert.equal(observer.error,'');
    await host.evaluate(seat=>ArcadeSharedActivity.pass(seat),joined.seat);
    await until(guest,()=>ArcadeSharedActivity.isController()&&!ArcadeSharedActivity.isSpectator());
    await until(host,()=>ArcadeSharedActivity.isSpectator()&&ArcadeSharedActivity.getState().appliedSequence>=0);
    const takeover=await inspect(guest);
    assert.equal(takeover.error,'');assert.ok(takeover.appliedSequence>=0);
    if(activity==='mad-libs'){
      assert.equal(await guest.evaluate(()=>MadLibsAutosave.capture().screen),'picker');
      assert.equal(await guest.evaluate(()=>MadLibsAutosave.capture().storyIndex),-1);
      await guest.locator('.story-card').first().click();
      await guest.locator('#word_0').fill('shared pizza');
      await until(host,()=>MadLibsAutosave.capture().screen==='words'&&MadLibsAutosave.capture().values[0]==='shared pizza');
      await guest.locator('#fillEmptyButton').click();await guest.locator('#makeStoryButton').click();
      await until(host,()=>MadLibsAutosave.capture().screen==='result'&&document.getElementById('storyOutput').textContent.includes('shared pizza'));
    }
    assert.deepEqual(localErrors,[]);
    result={activity,status:'passed',observer,takeover,elapsedMs:Date.now()-started};
    console.log('PASS untouched '+activity+' create/join/pass'+(activity==='mad-libs'?' and picker-to-story play':''));
  }catch(error){result={activity,status:'failed',elapsedMs:Date.now()-started,error:error.message};console.log('FAIL '+activity+': '+error.message);}
  finally{await Promise.all(contexts.map(context=>context.close()));results.push(result);}
}
try{
  // Two independent pairs keep the sweep quick without exhausting audio contexts.
  let next=0;
  await Promise.all([0,1].map(async()=>{while(next<activities.length){const activity=activities[next++];await test(activity);}}));
  results.sort((a,b)=>SHARED_ACTIVITY_IDS.indexOf(a.activity)-SHARED_ACTIVITY_IDS.indexOf(b.activity));
  const reportPath=process.env.ARCADE_LOBBY_REPORT||'test-results/shared-lobby/report.json';
  await mkdir(dirname(reportPath),{recursive:true});await writeFile(reportPath,JSON.stringify({viewports:[{width:1440,height:900},{width:390,height:844}],activities:results,browserErrors:errors},null,2)+'\n');
  assert.equal(results.length,activities.length);assert.deepEqual(errors,[],'Browser errors');
  assert.deepEqual(results.filter(result=>result.status!=='passed'),[],'Untouched shared lobby scenarios');
  console.log('All '+results.length+' untouched shared activity lobbies passed');
}finally{await browser.close();server.kill('SIGTERM');}
