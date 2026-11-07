import assert from 'node:assert/strict';
import { mkdir,writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { chromium,browserLaunchOptions } from './browser-runtime.mjs';
import { startStaticFixture } from './static-fixture.mjs';
const localOnly=process.argv.includes('--local-only');
const roomsOnly=process.argv.includes('--rooms-only');
const fixture=await startStaticFixture();
const browser=await chromium.launch(browserLaunchOptions);
const results=[];
const errors=[];
let roomServer;
await mkdir('test-results/bug-heist',{recursive:true});
async function context(viewport,manual=true){
  const c=await browser.newContext({viewport,hasTouch:true});
  if(manual)await c.addInitScript(()=>{
    let id=0,clock=performance.now();const frames=new Map();
    window.requestAnimationFrame=fn=>{frames.set(++id,fn);return id;};window.cancelAnimationFrame=id=>frames.delete(id);
    window.__heistStep=count=>{clock=Math.max(clock,performance.now());for(let i=0;i<count;i++){clock+=1000/60;const pending=[...frames.values()];frames.clear();for(const fn of pending)fn(clock);}};
  });
  const p=await c.newPage();p.on('pageerror',e=>errors.push(e.message));return{c,p};
}
const step=(p,n=10)=>p.evaluate(n=>__heistStep(n),n);
const state=p=>p.evaluate(()=>__arcadeGame.captureState());
async function start(p,two=false){await p.locator('#heistMode').click();if(two)await p.locator('#twoBugs').click();await p.locator('#startBtn').click();await step(p,1);}
try{
  if(!roomsOnly){
  for(const viewport of [{width:1280,height:800},{width:390,height:844},{width:320,height:568},{width:844,height:390}]){
    const {c,p}=await context(viewport);await p.goto(fixture.base+'/bug-squish/');await start(p);
    assert.equal(await p.locator('#heistControls').isVisible(),true);assert.equal(await p.locator('#heistDash').isVisible(),true);assert.equal(await p.locator('#heistAgain').isVisible(),false);
    const bounds=await p.locator('#heistDash').boundingBox();assert(bounds.x>=0&&bounds.y>=0&&bounds.x+bounds.width<=viewport.width&&bounds.y+bounds.height<=viewport.height);
    const first=await state(p);await p.locator('#gameCanvas').focus();await p.keyboard.down('ArrowRight');await step(p,15);await p.keyboard.up('ArrowRight');const moved=await state(p);assert(moved.bugs[0].x>first.bugs[0].x+10);
    await p.keyboard.press('Space');await step(p,1);assert((await state(p)).bugs[0].cooldown>3,'Space triggers a dash');
    const classicBefore=await p.evaluate(()=>SquishGame.captureState());const b=await p.locator('#gameCanvas').boundingBox();
    await p.mouse.move(b.x+b.width*.6,b.y+b.height*.6);await p.mouse.down();await p.mouse.move(b.x+b.width*.7,b.y+b.height*.5,{steps:5});await step(p,30);await p.mouse.up();
    assert.deepEqual(await p.evaluate(()=>SquishGame.captureState()),classicBefore,'Heist input cannot squish hidden classic bugs');assert.match(await p.locator('#countPill').textContent(),/HOME/);
    await p.locator('#menuBtn').click();const paused=await state(p);await step(p,60);assert.deepEqual(await state(p),paused,'Pause freezes all heist state');await p.locator('#resumeBtn').click();
    await p.evaluate(()=>{const s=__arcadeGame.captureState();s.phase='gameover';s.hearts=0;__arcadeGame.restoreState(s);});await step(p,1);assert.equal(await p.locator('#heistAgain').isVisible(),true);assert.equal(await p.locator('#heistDash').isVisible(),false);await p.locator('#heistAgain').click();await step(p,1);assert.equal((await state(p)).hearts,4);assert.equal(await p.locator('#heistAgain').isVisible(),false);
    await p.screenshot({path:`test-results/bug-heist/play-${viewport.width}x${viewport.height}.png`});results.push({name:'layout/keyboard/dash/pointer-isolation/pause/retry',viewport,passed:true});await c.close();
  }
  {
    const {c,p}=await context({width:1000,height:700});await p.goto(fixture.base+'/bug-squish/');await start(p);
    // Arrange the last trip, then earn the win through actual pointer steering.
    await p.evaluate(()=>{const s=__arcadeGame.captureState(),home=__arcadeGame.debug().home;s.delivered=s.target-1;s.spawnClock=3;s.swats=[];s.bugs[0]={...s.bugs[0],x:home.x+100,y:home.y,bag:0,safe:2};s.crumbs=[{x:home.x+100,y:home.y,gold:true,turn:0}];__arcadeGame.restoreState(s);});await step(p,1);assert.equal((await state(p)).bugs[0].bag,1);assert((await state(p)).bugs[0].shield>0);
    const home=await p.evaluate(()=>__arcadeGame.debug().home),box=await p.locator('#gameCanvas').boundingBox();await p.mouse.move(box.x+home.x,box.y+home.y);await p.mouse.down();await step(p,45);await p.mouse.up();assert.equal((await state(p)).phase,'won');assert.equal(await p.locator('#heistDash').isVisible(),false);await step(p,150);assert.equal((await state(p)).round,2);
    await p.locator('#menuBtn').click();const saved=await state(p);await p.evaluate(()=>ArcadeSave.saveNow());await p.goto(fixture.base+'/bug-squish/?resume=1');await p.waitForFunction(()=>__arcadeGame.debug().mode==='heist',{},{polling:50});assert.equal(await p.locator('#heistControls').isVisible(),true,'Restoring into a fresh page shows heist controls');assert.equal(await p.locator('#menuOverlay').isVisible(),true,'A paused heist restores paused');const reloaded=await state(p);assert.equal(reloaded.round,saved.round);assert.equal(reloaded.hearts,saved.hearts);assert.equal(reloaded.delivered,saved.delivered);assert.deepEqual(reloaded.bugs.map(b=>[b.x,b.y,b.bag]),saved.bugs.map(b=>[b.x,b.y,b.bag]));
    // The v2 schema had no mode. Its exact classic progress remains loadable.
    await p.evaluate(()=>{const old=SquishGame.captureState();delete old.mode;CoopSaveAdapter.restore(old);});assert.equal((await state(p)).mode,'squish');assert.equal(await p.locator('#heistControls').isVisible(),false);const bug=await p.evaluate(()=>__arcadeGame.debug().bugs[0]);await p.mouse.click(box.x+bug.x,box.y+bug.y);assert((await state(p)).bugs.some(b=>b.health<b.maxHealth),'Classic input still works after legacy restore');results.push({name:'last-trip/win/next-picnic/exact-save/legacy-classic',passed:true});await c.close();
  }
  {
    const {c,p}=await context({width:844,height:600});await p.goto(fixture.base+'/bug-squish/');await start(p,true);const before=await state(p),box=await p.locator('#gameCanvas').boundingBox();const session=await c.newCDPSession(p);const r=Math.max(14,Math.min(27,Math.min(before.bounds.w,before.bounds.h)*.047));
    const touches=before.bugs.map((b,id)=>({id,x:box.x+b.x,y:box.y+b.y+r*1.5}));await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:touches});await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:touches.map((t,id)=>({...t,x:t.x+(id?70:-70),y:t.y+80}))});await step(p,35);await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});const after=await state(p);assert(after.bugs[0].x<before.bugs[0].x-10);assert(after.bugs[1].x>before.bugs[1].x+10);assert.equal(await p.evaluate(()=>__arcadeGame.debug().activePointers),0);
    // Typing into a room-name input cannot drive the bugs or swallow letters.
    await p.evaluate(()=>{const input=document.createElement('input');input.id='heistTypingFixture';document.body.append(input);input.focus();});const idle=await state(p);await p.keyboard.type('wasd WASD ');await step(p,20);assert.equal(await p.locator('#heistTypingFixture').inputValue(),'wasd WASD ');assert.deepEqual((await state(p)).bugs.map(b=>[b.x,b.y]),idle.bugs.map(b=>[b.x,b.y]));results.push({name:'real-two-touch/independent-steering/editable-keyboard',passed:true});await c.close();
  }
  }
  if(!localOnly){
    roomServer=spawn(process.execPath,['guess-who/test-server.mjs'],{stdio:['ignore','pipe','pipe']});let stderr='';roomServer.stderr.on('data',d=>stderr+=d);await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Room fixture startup: '+stderr)),30000);roomServer.stdout.on('data',d=>{if(String(d).includes('test site')){clearTimeout(timer);resolve();}});roomServer.on('exit',code=>{clearTimeout(timer);reject(Error('Room fixture exit '+code+': '+stderr));});});
    const make=async()=>{const {c,p}=await context({width:1000,height:700},false);await c.addInitScript(()=>{localStorage.setItem('arcade.online.endpoint','http://127.0.0.1:8788');window.ARCADE_WORKER_BASE='http://127.0.0.1:8788';});await p.goto('http://127.0.0.1:8787/bug-squish/');await p.locator('#heistMode').click();await p.locator('#startBtn').click();return{c,p};};
    const host=await make(),guest=await make();const local=await guest.p.evaluate(()=>{__arcadeDebug.openMenu();return __arcadeGame.captureState();});
    const created=await host.p.evaluate(()=>ArcadeSharedActivity.create({username:'Heist Host'}));const joined=await guest.p.evaluate(code=>ArcadeSharedActivity.join({username:'Heist Guest',code}),created.code);
    await host.p.waitForFunction(()=>ArcadeSharedActivity.isController()&&!ArcadeSharedActivity.isSpectator());await guest.p.waitForFunction(()=>ArcadeSharedActivity.isSpectator()&&ArcadeSharedActivity.getState().appliedSequence>=0);assert.equal(await guest.p.locator('#heistControls').isVisible(),true);
    const still=await guest.p.evaluate(()=>__arcadeGame.captureState());await guest.p.keyboard.press('ArrowRight');await guest.p.locator('#heistDash').click({force:true});await guest.p.waitForTimeout(200);assert.deepEqual(await guest.p.evaluate(()=>__arcadeGame.captureState()),still,'Observer cannot steer or dash its frozen simulation');
    await host.p.evaluate(()=>{const s=__arcadeGame.captureState();s.round=3;s.delivered=4;s.hearts=2;s.bugs[0].bag=2;s.bugs[0].shield=4;__arcadeGame.restoreState(s);__arcadeDebug.openMenu();});const accepted=await host.p.evaluate(()=>__arcadeGame.captureState());await host.p.evaluate(seat=>ArcadeSharedActivity.pass(seat),joined.seat);await guest.p.waitForFunction(()=>ArcadeSharedActivity.isController()&&!ArcadeSharedActivity.isSpectator());assert.deepEqual(await guest.p.evaluate(()=>__arcadeGame.captureState()),accepted,'Taking controls preserves the complete paused accepted round, cargo, hearts, shield and timers');assert.equal(await guest.p.locator('#menuOverlay').isVisible(),true);await guest.p.evaluate(()=>__arcadeDebug.resume());await guest.p.locator('#gameCanvas').focus();const x=await guest.p.evaluate(()=>__arcadeGame.debug().bugs[0].x);await guest.p.keyboard.down('ArrowRight');await guest.p.waitForFunction(x=>__arcadeGame.debug().bugs[0].x>x+8,x);await guest.p.keyboard.up('ArrowRight');assert.equal(await guest.p.locator('#heistControls').isVisible(),true);
    await guest.p.evaluate(()=>ArcadeSharedActivity.leave());await guest.p.evaluate(()=>__arcadeDebug.openMenu());const restored=await guest.p.evaluate(()=>__arcadeGame.captureState());assert.equal(restored.mode,local.mode);assert.deepEqual(restored.bugs.map(b=>[b.x,b.y,b.bag]),local.bugs.map(b=>[b.x,b.y,b.bag]),'Leaving restores private local bug positions and bags');await host.p.evaluate(()=>ArcadeSharedActivity.leave());await host.c.close();await guest.c.close();results.push({name:'real-room/observer-block/control-transfer/private-restore',passed:true});
  }
  assert.deepEqual(errors,[]);console.log('PASS Picnic Heist '+results.length+' browser scenarios; no page errors.');
  await writeFile('test-results/bug-heist/'+(localOnly?'summary-local.json':roomsOnly?'summary-rooms.json':'summary.json'),JSON.stringify({results,errors},null,2));
}finally{roomServer?.kill('SIGTERM');await browser.close();await fixture.close();}
