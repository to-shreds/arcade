// Real Worker recovery checks. Fault injection stays inside the test browser.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir,writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { chromium,browserLaunchOptions } from './browser-runtime.mjs';
const server=spawn(process.execPath,['guess-who/test-server.mjs'],{stdio:['ignore','pipe','pipe']});
let serverErrors='';server.stderr.on('data',data=>serverErrors+=data);
await new Promise((accept,reject)=>{const timer=setTimeout(()=>reject(new Error(serverErrors||'Test server did not start')),30000);server.stdout.on('data',data=>{if(String(data).includes('test site')){clearTimeout(timer);accept();}});server.on('exit',code=>{clearTimeout(timer);reject(new Error('Server exited '+code+': '+serverErrors));});});
const browser=await chromium.launch(browserLaunchOptions),failures=[],errors=[],results=[];
const onlyCase=process.argv.find(value=>value.startsWith('--case='))?.slice(7).toLowerCase();
let contexts=[];
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(page,predicate,timeout=14000){const deadline=Date.now()+timeout;while(Date.now()<deadline){if(await page.evaluate(predicate))return;await delay(75);}throw new Error('Timed out: '+predicate.toString());}
async function page(game,existingContext){
  const context=existingContext||await browser.newContext({viewport:{width:1200,height:820}});
  if(!existingContext){
    contexts.push(context);
    await context.addInitScript(()=>{
      window.ARCADE_WORKER_BASE='http://127.0.0.1:8788';
      const NativeWebSocket=window.WebSocket;
      window.__testSockets=[];window.__testHeldAcks=[];window.__testHoldAcks=false;
      window.WebSocket=class extends NativeWebSocket{
        constructor(...args){super(...args);if(String(args[0]).includes('/api/arcade/rooms/'))window.__testSockets.push(this);
          this.addEventListener('message',event=>{let data;try{data=JSON.parse(event.data);}catch{return;}if(window.__testHoldAcks&&data.type==='ack'){event.stopImmediatePropagation();window.__testHeldAcks.push({socket:this,data:event.data});}});
        }
      };
    });
  }
  const result=await context.newPage();result.on('pageerror',error=>errors.push(game+': '+error.message));await result.goto('http://127.0.0.1:8787/'+game+'/index.html');return result;
}
async function connect(host,guest){const created=await host.evaluate(()=>ArcadeSharedActivity.create({username:'Host'}));const joined=await guest.evaluate(code=>ArcadeSharedActivity.join({username:'Guest',code}),created.code);await until(host,()=>ArcadeSharedActivity.getState().connected&&!ArcadeSharedActivity.isSpectator());await until(guest,()=>ArcadeSharedActivity.getState().connected&&ArcadeSharedActivity.getState().appliedSequence>=0);return joined;}
async function state(page){return page.evaluate(()=>{const shared=ArcadeSharedActivity.getState();return{active:shared.active,connected:shared.connected,controller:shared.controller,spectator:ArcadeSharedActivity.isSpectator(),code:shared.room?.code,version:shared.room?.version,turn:shared.room?.turn,status:shared.statusText,connection:ArcadeSharedActivity.getClient().getConnectionState(),snapshot:ArcadeSave.getAdapter().capture()};});}
async function run(name,fn){if(onlyCase&&!name.toLowerCase().includes(onlyCase))return;const started=Date.now();try{await fn();results.push({name,status:'passed',elapsedMs:Date.now()-started});console.log('PASS '+name);}catch(error){failures.push(name+': '+error.message);results.push({name,status:'failed',elapsedMs:Date.now()-started,error:error.message});console.log('FAIL '+name+': '+error.message);}finally{await Promise.all(contexts.map(context=>context.close()));contexts=[];}}
try{
  await run('Typing reconnect, observer freeze, local text and cursor restoration',async()=>{
    const host=await page('typing'),guest=await page('typing');
    await host.evaluate(()=>TypingAutosave.restore({text:'SHARED',cursor:6,caps:false,symbols:false}));
    await guest.evaluate(()=>TypingAutosave.restore({text:'LOCAL 🦄',cursor:8,caps:false,symbols:true}));
    await guest.locator('#editor').focus();await guest.keyboard.press('Home');
    const local=await guest.evaluate(()=>TypingAutosave.capture());assert.equal(local.cursor,0);
    await connect(host,guest);await until(guest,()=>TypingAutosave.capture().text==='SHARED');
    await guest.context().setOffline(true);
    await guest.evaluate(()=>__testSockets.findLast(socket=>socket.readyState===1)?.close(4000,'Test loss'));
    await until(guest,()=>!ArcadeSharedActivity.getState().connected);
    const frozen=await guest.evaluate(()=>TypingAutosave.capture());
    await host.locator('[data-key="a"]').click();await delay(1100);
    assert.deepEqual(await guest.evaluate(()=>TypingAutosave.capture()),frozen,'Offline observer must stay frozen');
    await guest.context().setOffline(false);
    await until(guest,()=>ArcadeSharedActivity.getState().connected);
    await until(guest,()=>TypingAutosave.capture().text==='SHAREDa');
    await guest.evaluate(()=>ArcadeSharedActivity.leave());
    assert.deepEqual(await guest.evaluate(()=>TypingAutosave.capture()),local,'Leaving restores local text, cursor, caps and symbols exactly');
  });

  await run('Bowling owner loss, observer claim, returning owner and single animation',async()=>{
    const host=await page('bowling'),guest=await page('bowling');await host.locator('#start').click();
    await connect(host,guest);await host.locator('#roll').click();
    await until(host,()=>BowlingAutosave.capture().rolling);
    await until(guest,async()=>{
      const checkpoint=ArcadeSharedActivity.getState().room.state;
      let raw=checkpoint.data;
      if(checkpoint.codec==='gzip'){
        const bytes=Uint8Array.from(atob(raw),ch=>ch.charCodeAt(0));
        raw=await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
      }
      return JSON.parse(raw).snapshot.rolling===true;
    });
    const hostContext=host.context();await host.close();
    await until(guest,()=>{const room=ArcadeSharedActivity.getState().room;return room&&!room.presence?.[room.turn.playerId];});
    await guest.evaluate(()=>ArcadeSharedActivity.getClient().action({type:'claim-controls'}));
    await until(guest,()=>ArcadeSharedActivity.isController()&&!ArcadeSharedActivity.isSpectator());
    try{await until(guest,()=>BowlingAutosave.capture().players[0].frames[0].rolls.length===1&&!BowlingAutosave.capture().rolling);}
    catch(error){console.log('Claim roll diagnostic',JSON.stringify(await state(guest)));throw error;}
    await delay(900);assert.equal((await guest.evaluate(()=>BowlingAutosave.capture())).players[0].frames[0].rolls.length,1,'Restored ball must finish only once');
    const returned=await page('bowling',hostContext);
    await returned.evaluate(()=>ArcadeSharedActivity.openPanel());await returned.locator('#shared-resume').click();
    await until(returned,()=>ArcadeSharedActivity.getState().connected&&ArcadeSharedActivity.getState().active);
    assert.equal(await returned.evaluate(()=>ArcadeSharedActivity.isController()),false,'Returning former owner cannot retain controls');
    const before=await guest.evaluate(()=>BowlingAutosave.capture().players[0].frames[0].rolls.length);
    await returned.locator('#roll').dispatchEvent('click');await delay(500);
    assert.equal(await guest.evaluate(()=>BowlingAutosave.capture().players[0].frames[0].rolls.length),before,'Former owner inputs cannot change the game');
    assert.equal(await guest.evaluate(()=>ArcadeSharedActivity.isController()),true);
  });

  await run('Bowling same-owner reconnect freezes and resumes one roll',async()=>{
    const host=await page('bowling'),guest=await page('bowling');await host.locator('#start').click();await connect(host,guest);
    await host.locator('#roll').click();await delay(150);
    await host.context().setOffline(true);await host.evaluate(()=>__testSockets.findLast(socket=>socket.readyState===1)?.close(4000,'Test owner loss'));
    await until(host,()=>!ArcadeSharedActivity.getState().connected);
    const frozen=await host.evaluate(()=>BowlingAutosave.capture());await delay(1100);
    const still=await host.evaluate(()=>BowlingAutosave.capture());
    assert.deepEqual(still.ball,frozen.ball,'Disconnected owner physics must freeze');
    assert.equal(still.players[0].frames[0].rolls.length,frozen.players[0].frames[0].rolls.length);
    await host.context().setOffline(false);await until(host,()=>ArcadeSharedActivity.getState().connected&&!ArcadeSharedActivity.isSpectator());
    await until(host,()=>BowlingAutosave.capture().players[0].frames[0].rolls.length===1&&!BowlingAutosave.capture().rolling);
    await delay(800);assert.equal(await host.evaluate(()=>BowlingAutosave.capture().players[0].frames[0].rolls.length),1);
  });

  await run('Bowling browser offline event freezes without forcing socket close',async()=>{
    const host=await page('bowling'),guest=await page('bowling');await host.locator('#start').click();await connect(host,guest);
    await host.locator('#roll').click();await until(host,()=>BowlingAutosave.capture().rolling);
    await host.context().setOffline(true);
    // Emulate actual network loss only. An OPEN WebSocket must not keep physics running.
    assert.equal(await host.evaluate(()=>navigator.onLine),false,'Browser reports genuine offline state');
    await until(host,()=>!ArcadeSharedActivity.getState().connected&&ArcadeSharedActivity.isSpectator(),1000);
    const frozen=await host.evaluate(()=>BowlingAutosave.capture());await delay(600);
    assert.deepEqual((await host.evaluate(()=>BowlingAutosave.capture())).ball,frozen.ball,'Offline event freezes the ball immediately');
    await host.context().setOffline(false);
    await until(host,()=>ArcadeSharedActivity.getState().connected&&!ArcadeSharedActivity.isSpectator());
    await until(host,()=>BowlingAutosave.capture().players[0].frames[0].rolls.length===1&&!BowlingAutosave.capture().rolling);
    await delay(500);assert.equal(await host.evaluate(()=>BowlingAutosave.capture().players[0].frames[0].rolls.length),1);
  });

  await run('Bowling shared score changes preserve original local progress on leave',async()=>{
    const host=await page('bowling'),guest=await page('bowling');await host.locator('#start').click();
    const local=await host.evaluate(()=>BowlingAutosave.capture());await connect(host,guest);
    await host.locator('#roll').click();
    await until(host,()=>BowlingAutosave.capture().players[0].frames[0].rolls.length===1&&!BowlingAutosave.capture().rolling);
    await host.evaluate(()=>ArcadeSharedActivity.leave());
    const restored=await host.evaluate(()=>BowlingAutosave.capture());
    assert.deepEqual(restored.players,local.players,'Shared scoring must not mutate the original nested local frames');
    assert.equal(restored.currentFrame,local.currentFrame);assert.equal(restored.rollNumber,local.rollNumber);
    assert.equal(restored.rolling,false);assert.equal(await host.evaluate(()=>ArcadeSharedActivity.getState().active),false);
  });

  await run('Pending state acknowledgement drains before passing controls',async()=>{
    const host=await page('bowling'),guest=await page('bowling');await host.locator('#start').click();const joined=await connect(host,guest);
    await host.evaluate(()=>{window.__testHoldAcks=true;document.getElementById('power').value='81';document.getElementById('power').dispatchEvent(new Event('input',{bubbles:true}));});
    await until(host,()=>window.__testHeldAcks.length>0);
    await host.evaluate(seat=>{window.__testPass=ArcadeSharedActivity.pass(seat);},joined.seat);
    await delay(300);assert.equal(await guest.evaluate(()=>ArcadeSharedActivity.isController()),false,'Unconfirmed state cannot pass controls early');
    await host.evaluate(()=>{window.__testHoldAcks=false;for(const item of __testHeldAcks.splice(0))item.socket.dispatchEvent(new MessageEvent('message',{data:item.data}));});
    await host.evaluate(()=>window.__testPass);
    await until(guest,()=>ArcadeSharedActivity.isController()&&!ArcadeSharedActivity.isSpectator());
    assert.equal(await host.evaluate(()=>ArcadeSharedActivity.isController()),false);
    assert.equal(await guest.evaluate(()=>BowlingAutosave.capture().power),.81,'Final state checkpoint accompanies control transfer');
  });

  await run('Wrong-activity join preserves prior saved credentials and room',async()=>{
    const typing=await page('typing'),bowling=await page('bowling');
    const original=await typing.evaluate(()=>ArcadeSharedActivity.create({username:'Original'}));
    const other=await bowling.evaluate(()=>ArcadeSharedActivity.create({username:'Other'}));
    const saved=await typing.evaluate(()=>ArcadeSharedActivity.getClient().saved());
    const before=await bowling.evaluate(()=>ArcadeSharedActivity.getState().room.members.length);
    const error=await typing.evaluate(async code=>{try{await ArcadeSharedActivity.join({username:'Mistake',code});return null;}catch(error){return error.message;}},other.code);
    assert.ok(error&&/another activity/i.test(error),'Wrong-activity join rejects before accepting a session');
    assert.deepEqual(await typing.evaluate(()=>ArcadeSharedActivity.getClient().saved()),saved,'Prior saved credentials remain intact');
    assert.equal(await typing.evaluate(()=>ArcadeSharedActivity.getClient().room.code),original.code);
    assert.equal(await typing.evaluate(()=>ArcadeSharedActivity.getState().connected),true,'A rejected join cannot freeze the original connected room');
    assert.equal(await typing.evaluate(()=>ArcadeSharedActivity.isSpectator()),false,'Original controller remains able to play after a rejected join');
    await bowling.evaluate(()=>ArcadeSharedActivity.getClient().refresh());
    assert.equal(await bowling.evaluate(()=>ArcadeSharedActivity.getState().room.members.length),before,'Invalid joins do not consume room seats');
  });
  const reportPath=process.env.ARCADE_RECOVERY_REPORT||'test-results/shared-recovery/report.json';
  await mkdir(dirname(reportPath),{recursive:true});
  await writeFile(reportPath,JSON.stringify({viewport:{width:1200,height:820},cases:results,browserErrors:errors},null,2)+'\n');
  assert.deepEqual(errors,[],'Browser errors');
  assert.deepEqual(failures,[],'Shared recovery scenarios');
  console.log('All shared recovery scenarios passed');
}finally{await browser.close();server.kill('SIGTERM');}
