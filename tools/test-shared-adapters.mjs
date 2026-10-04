// Exact phase, privacy, replay, and sound checks for the shared activity adapters.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chromium,browserLaunchOptions } from './browser-runtime.mjs';
const server=spawn(process.execPath,['guess-who/test-server.mjs'],{stdio:['ignore','pipe','pipe']});
let serverErrors='';server.stderr.on('data',data=>serverErrors+=data);
await new Promise((accept,reject)=>{
  const timer=setTimeout(()=>reject(new Error('Test server did not start: '+serverErrors)),30000);
  server.stdout.on('data',data=>{if(String(data).includes('test site')){clearTimeout(timer);accept();}});
  server.on('exit',code=>{clearTimeout(timer);reject(new Error('Test server exited '+code+': '+serverErrors));});
});
const browser=await chromium.launch(browserLaunchOptions);
const errors=[];
async function until(page,predicate,timeout=12000){
  const deadline=Date.now()+timeout;
  while(Date.now()<deadline){
    if(await page.evaluate(predicate))return;
    await new Promise(resolve=>setTimeout(resolve,75));
  }
  throw new Error('Timed out waiting for '+predicate.toString());
}
async function page(game,spectator=false){
  const mobile=process.env.ARCADE_SHARED_MOBILE==='1';
  const viewport=mobile?(game==='music-maker'?{width:844,height:390}:{width:390,height:844}):{width:1440,height:900};
  const context=await browser.newContext({viewport,hasTouch:mobile,deviceScaleFactor:mobile?2:1});
  await context.addInitScript(()=>{
    localStorage.setItem('arcade.online.endpoint','http://127.0.0.1:8788');
    window.ARCADE_WORKER_BASE='http://127.0.0.1:8788';
    window.__audioStarts=0;window.__audioStops=0;window.__audioEnds=0;
    const AC=window.AudioContext||window.webkitAudioContext;
    window.__audioTrace=[];
    if(AC){for(const method of ['resume','suspend']){const original=AC.prototype[method];AC.prototype[method]=function(...args){window.__audioContext=this;if(__audioTrace.length<24)__audioTrace.push({method,state:this.state,event:window.event?.type,active:navigator.userActivation.isActive,seen:navigator.userActivation.hasBeenActive});return original.apply(this,args)};}const original=AC.prototype.createBufferSource;AC.prototype.createBufferSource=function(){const source=original.call(this),start=source.start.bind(source),stop=source.stop.bind(source);source.addEventListener('ended',()=>window.__audioEnds++,{once:true});source.start=(...args)=>{window.__audioStarts++;return start(...args)};source.stop=(...args)=>{window.__audioStops++;return stop(...args)};return source;};}
  });
  const result=await context.newPage();result.on('pageerror',error=>errors.push(game+': '+error.message));
  await result.goto('http://127.0.0.1:8787/'+game+'/index.html');
  if(spectator)await result.evaluate(()=>{window.ArcadeSharedActivity={isSpectator:()=>true};});
  return result;
}
try{
  const simon=await page('simon'),simonWatch=await page('simon',true);
  await simon.evaluate(()=>SimonSharedAdapter.restore({seq:[0,1],idx:1,started:true,strict:false,playing:false,phase:'input',pausedPhase:'input',best:2,menuOpen:false,hint:'Your turn!',lit:[]},{spectator:false}));
  const simonInput=await simon.evaluate(()=>SimonSharedAdapter.capture());
  await simonWatch.evaluate(saved=>SimonSharedAdapter.restore(saved,{spectator:true}),simonInput);
  assert.equal(await simonWatch.locator('#si-hint').innerText(),'Your turn!');
  assert.equal((await simonWatch.evaluate(()=>SimonSharedAdapter.capture())).idx,1);
  await simon.evaluate(()=>SimonGame.press(1));
  const simonDelay=await simon.evaluate(()=>SimonSharedAdapter.capture());
  assert.equal(simonDelay.phase,'round-delay');
  await simonWatch.evaluate(saved=>SimonSharedAdapter.restore(saved,{spectator:true}),simonDelay);
  await simonWatch.waitForTimeout(950);
  assert.equal((await simonWatch.evaluate(()=>SimonSharedAdapter.capture())).phase,'round-delay','Spectator must not independently choose the next pattern');
  await simonWatch.evaluate(saved=>SimonSharedAdapter.restore(saved,{spectator:false}),simonInput);
  assert.equal((await simonWatch.evaluate(()=>SimonSharedAdapter.capture())).idx,1,'Control transfer preserves accepted input');
  await simonWatch.evaluate(saved=>SimonSharedAdapter.restore({...saved,phase:'paused',pausedPhase:'input',menuOpen:true},{spectator:false}),simonInput);
  assert.equal((await simonWatch.evaluate(()=>SimonSharedAdapter.capture())).phase,'paused','Leaving a room restores a paused local game without replaying it');

  const hangman=await page('hangman'),hangmanWatch=await page('hangman',true);
  await hangman.evaluate(()=>HangmanGame.setupCustom());
  await hangman.locator('#custom-word').fill('PRIVATE');await hangman.locator('#custom-clue').fill('Private draft');
  const draft=await hangman.evaluate(()=>HangmanSharedAdapter.capture());
  assert.equal(JSON.stringify(draft).includes('PRIVATE'),false,'Unaccepted PvP drafts must stay private');
  await hangman.locator('#custom-word').fill('OX');await hangman.evaluate(()=>HangmanGame.startCustom());
  await hangman.locator('#key-O').dispatchEvent('pointerdown');
  const accepted=await hangman.evaluate(()=>HangmanSharedAdapter.capture());
  await hangmanWatch.evaluate(saved=>HangmanSharedAdapter.restore(saved,{spectator:true}),accepted);
  assert.deepEqual((await hangmanWatch.evaluate(()=>HangmanSharedAdapter.capture())).guesses,['O']);
  await hangman.locator('#key-X').dispatchEvent('pointerdown');
  const finished=await hangman.evaluate(()=>HangmanSharedAdapter.capture());
  assert.equal(finished.resultOpen,true);assert.equal(finished.streak,1);
  await hangman.locator('#key-A').dispatchEvent('pointerdown');
  assert.equal((await hangman.evaluate(()=>HangmanSharedAdapter.capture())).streak,1,'Finished rounds cannot increase a win streak twice');
  for(let i=0;i<3;i++)await hangmanWatch.evaluate(saved=>HangmanSharedAdapter.restore(saved,{spectator:true}),finished);
  assert.equal(await hangmanWatch.locator('#msg-title').innerText(),'YOU WIN!');
  assert.equal((await hangmanWatch.evaluate(()=>HangmanSharedAdapter.capture())).streak,1,'Repeated snapshots must not replay game completion');
  await hangmanWatch.evaluate(saved=>HangmanSharedAdapter.restore(saved,{spectator:false}),accepted);
  assert.equal((await hangmanWatch.evaluate(()=>HangmanSharedAdapter.capture())).undo.length,1,'Control transfer preserves undo history');

  const music=await page('music-maker'),musicWatch=await page('music-maker',true);
  await music.locator('[data-player="1"] .instrument').selectOption('guitar');
  await music.locator('[data-player="1"] [data-pitch="high"]').click();
  const pad=music.locator('[data-player="1"] .pad').first(),box=await pad.boundingBox();
  await music.mouse.move(box.x+box.width/2,box.y+box.height/2);await music.mouse.down();
  const liveNote=await music.evaluate(()=>MusicMakerSharedAdapter.capture());
  await musicWatch.evaluate(saved=>MusicMakerSharedAdapter.restore(saved,{spectator:true}),liveNote);
  await until(musicWatch,()=>window.__audioStarts>0);
  assert.equal(await musicWatch.locator('[data-player="1"] .instrument').inputValue(),'guitar');
  assert.equal(await musicWatch.locator('[data-player="1"] .pad.pressed').count(),1,'Held notes remain visible to remote players');
  const audioStarts=await musicWatch.evaluate(()=>window.__audioStarts);
  await musicWatch.evaluate(saved=>MusicMakerSharedAdapter.restore(saved,{spectator:true}),liveNote);
  assert.equal(await musicWatch.evaluate(()=>window.__audioStarts),audioStarts,'Repeated snapshots cannot retrigger notes');
  await new Promise(resolve=>setTimeout(resolve,2700));
  const heldNote=await music.evaluate(()=>MusicMakerSharedAdapter.capture());
  assert.equal(heldNote.notes.some(note=>note.id===heldNote.sides.find(side=>side.id===1).activeNotes[0]),true,'Held notes retain metadata beyond the recent-tap journal');
  await musicWatch.evaluate(saved=>MusicMakerSharedAdapter.restore(saved,{spectator:true}),heldNote);
  assert.equal(await musicWatch.locator('[data-player="1"] .pad.pressed').count(),1,'Long-held pads remain visible to observers');
  assert.equal(await musicWatch.evaluate(()=>window.__audioStarts),audioStarts,'Long-held snapshots do not replay completed samples');
  await music.mouse.up();const release=await music.evaluate(()=>MusicMakerSharedAdapter.capture());
  await musicWatch.evaluate(saved=>MusicMakerSharedAdapter.restore(saved,{spectator:true}),release);
  assert.equal(await musicWatch.locator('[data-player="1"] .pad.pressed').count(),0);
  // A short sample may already have ended while the user is still holding it.
  await until(musicWatch,()=>window.__audioStops>0||window.__audioEnds>=window.__audioStarts,1000);
  await music.locator('[data-player="1"] .backing').selectOption('pop');
  await until(music,()=>MusicMakerSharedAdapter.capture().backingPlaying);
  const backing=await music.evaluate(()=>MusicMakerSharedAdapter.capture());
  await musicWatch.evaluate(saved=>MusicMakerSharedAdapter.restore(saved,{spectator:true}),backing);
  const playingStarts=await musicWatch.evaluate(()=>window.__audioStarts);
  await musicWatch.evaluate(saved=>MusicMakerSharedAdapter.restore(saved,{spectator:true}),backing);
  assert.equal(await musicWatch.evaluate(()=>window.__audioStarts),playingStarts,'Backing music stays continuous across snapshots');
  assert.equal(await musicWatch.locator('[data-player="1"] .beat-toggle').innerText(),'■');
  await Promise.all([simon,simonWatch,hangman,hangmanWatch,music,musicWatch].map(item=>item.context().close()));

  async function connect(host,guest){
    const gesture=process.env.ARCADE_SHARED_MOBILE==='1'?'tap':'click';
    await host.locator('#shared-launch')[gesture]();await host.locator('#shared-close')[gesture]();
    await guest.locator('#shared-launch')[gesture]();await guest.locator('#shared-close')[gesture]();
    const created=await host.evaluate(()=>ArcadeSharedActivity.create({username:'Host'}));
    const joined=await guest.evaluate(code=>ArcadeSharedActivity.join({username:'Guest',code}),created.code);
    await until(guest,()=>ArcadeSharedActivity.getState().active&&ArcadeSharedActivity.getState().appliedSequence>=0);
    return joined.seat;
  }
  const liveSimon=await page('simon'),liveSimonGuest=await page('simon');
  await liveSimon.evaluate(()=>SimonSharedAdapter.restore({seq:[0,1],idx:0,started:true,strict:false,playing:false,phase:'input',pausedPhase:'input',best:2,menuOpen:false,hint:'Your turn!',lit:[]},{spectator:false}));
  const simonSeat=await connect(liveSimon,liveSimonGuest);
  await liveSimon.locator('#si-0').dispatchEvent('pointerdown');
  try{await until(liveSimonGuest,()=>SimonSharedAdapter.capture().idx===1);}
  catch(error){console.log('Simon room diagnostic',await liveSimon.evaluate(()=>({room:ArcadeSharedActivity.getState(),game:SimonSharedAdapter.capture()})),await liveSimonGuest.evaluate(()=>({room:ArcadeSharedActivity.getState(),game:SimonSharedAdapter.capture()})));throw error;}
  await liveSimon.evaluate(seat=>ArcadeSharedActivity.pass(seat),simonSeat);
  await until(liveSimonGuest,()=>ArcadeSharedActivity.isController());
  assert.equal((await liveSimonGuest.evaluate(()=>SimonSharedAdapter.capture())).idx,1);
  await liveSimonGuest.locator('#si-1').dispatchEvent('pointerdown');
  await until(liveSimon,()=>SimonSharedAdapter.capture().seq.length===3);
  await Promise.all([liveSimon,liveSimonGuest].map(item=>item.context().close()));

  const liveHangman=await page('hangman'),liveHangmanGuest=await page('hangman');
  await liveHangman.evaluate(()=>HangmanGame.setupCustom());
  await liveHangman.locator('#custom-word').fill('OX');await liveHangman.locator('#custom-clue').fill('Farm animal');
  await liveHangman.evaluate(()=>HangmanGame.startCustom());
  const hangmanSeat=await connect(liveHangman,liveHangmanGuest);
  await liveHangman.locator('#key-O').dispatchEvent('pointerdown');
  await until(liveHangmanGuest,()=>HangmanSharedAdapter.capture().guesses.includes('O'));
  await liveHangman.evaluate(seat=>ArcadeSharedActivity.pass(seat),hangmanSeat);
  await until(liveHangmanGuest,()=>ArcadeSharedActivity.isController());
  await liveHangmanGuest.locator('#key-X').dispatchEvent('pointerdown');
  await until(liveHangman,()=>HangmanSharedAdapter.capture().resultOpen);
  assert.equal(await liveHangman.locator('#msg-title').innerText(),'YOU WIN!');
  await Promise.all([liveHangman,liveHangmanGuest].map(item=>item.context().close()));

  const liveMusic=await page('music-maker'),liveMusicGuest=await page('music-maker');
  await connect(liveMusic,liveMusicGuest);
  const livePad=await liveMusic.locator('[data-player="1"] .pad').first().boundingBox();
  await liveMusic.mouse.move(livePad.x+livePad.width/2,livePad.y+livePad.height/2);await liveMusic.mouse.down();
  await until(liveMusicGuest,()=>document.querySelectorAll('[data-player="1"] .pad.pressed').length===1);
  await liveMusic.mouse.up();
  await until(liveMusicGuest,()=>document.querySelectorAll('[data-player="1"] .pad.pressed').length===0);
  try{await until(liveMusicGuest,()=>window.__audioStarts>0);}
  catch(error){console.log('Music sound diagnostic',await liveMusicGuest.evaluate(()=>({starts:__audioStarts,context:window.__audioContext?.state,trace:__audioTrace,visibility:document.visibilityState,room:ArcadeSharedActivity.getState(),music:MusicMakerSharedAdapter.capture()})));throw error;}
  await liveMusic.locator('[data-player="1"] .backing').selectOption('funk');
  await until(liveMusicGuest,()=>MusicMakerSharedAdapter.capture().backingPlaying&&MusicMakerSharedAdapter.capture().backingName==='funk');
  await liveMusic.locator('[data-player="1"] .beat-toggle').click();
  await until(liveMusicGuest,()=>!MusicMakerSharedAdapter.capture().backingPlaying);
  await liveMusic.evaluate(async()=>{
    // Two maximum-length recordings with difficult-to-compress varied audio.
    const samples=new Float32Array(48000);let seed=1;
    for(let i=0;i<samples.length;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;samples[i]=seed/2147483648-1;}
    const bytes=new Uint8Array(samples.buffer);let binary='';
    for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
    const loop={sampleRate:8000,length:samples.length,data:btoa(binary)};
    await MusicMakerAutosave.restore({sides:[{instrument:'voice',pitch:'middle',effect:'normal',loop},{instrument:'voice',pitch:'middle',effect:'robot',loop}],backingName:'none',backingPlaying:false});
  });
  await liveMusic.locator('[data-player="1"] .loop').click();
  await liveMusic.locator('[data-player="2"] .loop').click();
  await until(liveMusic,()=>MusicMakerSharedAdapter.capture().sides.every(side=>side.loopPlaying));
  const loops=await liveMusic.evaluate(()=>MusicMakerSharedAdapter.capture());
  assert.ok(JSON.stringify(loops).length<45000,'Both full six-second voice recordings fit below the transport budget');
  assert.ok(loops.sides.every(side=>side.loop.length===24000&&side.loop.data.length===16000),'Recorded clips retain their full duration');
  await until(liveMusicGuest,()=>MusicMakerSharedAdapter.capture().sides.every(side=>side.loopPlaying&&side.loop?.length===24000));
  assert.ok((await liveMusicGuest.locator('[data-player="1"] .voice-status').innerText()).includes('compact shared audio'));
  const localKeeper=await page('music-maker');
  await localKeeper.evaluate(async()=>{
    const samples=new Float32Array(16000);for(let i=0;i<samples.length;i++)samples[i]=Math.sin(i*.271)*.71;
    const bytes=new Uint8Array(samples.buffer);let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
    const loop={sampleRate:8000,length:samples.length,data:btoa(binary)};
    await MusicMakerAutosave.restore({sides:[{instrument:'voice',pitch:'middle',effect:'normal',loop},{instrument:'piano',pitch:'middle',effect:'normal',loop:null}],backingName:'none',backingPlaying:false});
  });
  await localKeeper.locator('[data-player="2"] .loop').click();
  await until(localKeeper,()=>MusicMakerSharedAdapter.captureLocal().sides[0].loopPlaying);
  const localOriginal=await localKeeper.evaluate(()=>MusicMakerAutosave.capture().sides[0].loop.data);
  await localKeeper.evaluate(()=>ArcadeSharedActivity.create({username:'Local keeper'}));
  await until(localKeeper,()=>ArcadeSharedActivity.getState().active&&ArcadeSharedActivity.getState().connected);
  await localKeeper.evaluate(()=>ArcadeSharedActivity.leave());
  assert.equal(await localKeeper.evaluate(()=>MusicMakerAutosave.capture().sides[0].loop.data),localOriginal,'Leaving a shared room preserves the original full-quality local recording');
  assert.equal(await localKeeper.evaluate(()=>MusicMakerSharedAdapter.captureLocal().sides[0].loopPlaying),true,'Leaving a shared room restores local loop playback');
  assert.deepEqual(errors,[]);
  console.log('PASS '+(process.env.ARCADE_SHARED_MOBILE==='1'?'mobile':'desktop')+': Simon phase/input transfer, Hangman privacy/completion/undo, Music notes/release/backing continuity/max-length recordings, and real two-browser Worker room play/control transfer for all three');
}finally{await browser.close();server.kill('SIGTERM');}
