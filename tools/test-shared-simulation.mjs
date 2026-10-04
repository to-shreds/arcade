// Instrument one existing physics loop without changing its scheduling or identity.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chromium,browserLaunchOptions } from './browser-runtime.mjs';
const server=spawn(process.execPath,['guess-who/test-server.mjs'],{stdio:['ignore','pipe','pipe']});
let stderr='';server.stderr.on('data',data=>stderr+=data);
await new Promise((resolve,reject)=>{
  const timeout=setTimeout(()=>reject(new Error('Test server did not start: '+stderr)),30000);
  server.stdout.on('data',data=>{if(String(data).includes('test site')){clearTimeout(timeout);resolve();}});
  server.on('exit',code=>{clearTimeout(timeout);reject(new Error('Test server exited '+code+': '+stderr));});
});
// Routing the instrumented main document removes Chromium's server IP metadata;
// allow this test's real loopback Worker requests in that synthetic document.
const browser=await chromium.launch({...browserLaunchOptions,args:[...browserLaunchOptions.args,'--disable-features=LocalNetworkAccessChecks']});
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(page,predicate){
  const deadline=Date.now()+12000;
  while(Date.now()<deadline){if(await page.evaluate(predicate))return;await delay(60);}
  throw new Error('Timed out: '+predicate);
}
async function page(){
  const context=await browser.newContext({viewport:{width:1200,height:820}});
  await context.addInitScript(()=>{
    localStorage.setItem('arcade.online.endpoint','http://127.0.0.1:8788');window.ARCADE_WORKER_BASE='http://127.0.0.1:8788';
    // Advance real game callbacks one frame at a time. This verifies scheduler
    // cardinality without depending on this test machine's rendering speed.
    const frames=new Map();let id=0,time=performance.now();
    window.requestAnimationFrame=callback=>{frames.set(++id,callback);return id;};
    window.cancelAnimationFrame=handle=>frames.delete(handle);
    window.__stepSharedFrame=()=>{time+=1000/60;const callbacks=[...frames.values()];frames.clear();callbacks.forEach(callback=>callback(time));};
  });
  const page=await context.newPage();
  page.on('requestfailed',request=>console.log('Request failed '+request.url()+': '+request.failure()?.errorText));
  page.on('console',message=>{if(message.type()==='error')console.log('Browser error '+message.text());});
  await page.route('**/contraption-maker/index.html',async route=>{
    const response=await route.fetch(),source=await response.text();
    assert.ok(source.includes('function loop(ts){raf=0;'));
    await route.fulfill({response,body:source.replace('function loop(ts){raf=0;','function loop(ts){window.__sharedLoopTicks=(window.__sharedLoopTicks||0)+1;raf=0;')});
  });
  await page.goto('http://127.0.0.1:8787/contraption-maker/index.html');
  return page;
}
async function ticks(page,count=20){
  return await page.evaluate(count=>{window.__sharedLoopTicks=0;for(let i=0;i<count;i++)window.__stepSharedFrame();return window.__sharedLoopTicks;},count);
}
try{
  const host=await page(),guest=await page();
  await host.locator('#starter').click();await host.locator('#drop').click();
  const baseline=await ticks(host);
  assert.equal(baseline,20,'The local physics loop advances exactly once per frame');
  const original=await host.evaluate(()=>ContraptionAutosave.capture());
  const created=await host.evaluate(()=>ArcadeSharedActivity.create({username:'Host'}));
  const joined=await guest.evaluate(code=>ArcadeSharedActivity.join({username:'Guest',code}),created.code);
  await until(host,()=>ArcadeSharedActivity.getState().connected&&!ArcadeSharedActivity.isSpectator());
  await until(guest,()=>ArcadeSharedActivity.getState().connected&&ArcadeSharedActivity.getState().appliedSequence>=0);
  let owner=host,observer=guest;
  for(let turn=0;turn<6;turn++){
    const seat=owner===host?joined.seat:created.seat;
    await owner.evaluate(seat=>ArcadeSharedActivity.pass(seat),seat);
    [owner,observer]=[observer,owner];
    await until(owner,()=>ArcadeSharedActivity.isController()&&!ArcadeSharedActivity.isSpectator());
    const running=await ticks(owner),frozen=await ticks(observer);
    assert.equal(running,baseline,`Transfer ${turn+1} must retain exactly one physics loop`);
    assert.equal(frozen,0,'Observers must not independently step the physics loop');
  }
  await owner.evaluate(()=>ArcadeSharedActivity.leave());
  if(owner===host){
    const local=await host.evaluate(()=>ContraptionAutosave.capture());
    assert.deepEqual(local.balls,original.balls,'Online moves must not mutate the original local ball state');
    assert.equal(local.score,original.score);
    const restored=await ticks(host);
    assert.equal(restored,baseline,'Leaving resumes exactly one original local physics loop');
  }
  console.log('PASS Contraption physics stays single, observers freeze, and local simulation resumes across six control transfers');
}finally{await browser.close();server.kill('SIGTERM');}
