import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium, browserLaunchOptions } from './browser-runtime.mjs';
import { startStaticFixture } from './static-fixture.mjs';

const fixture=await startStaticFixture();
const errors=[];
let browser;
const viewports=[{width:320,height:568},{width:390,height:844},{width:844,height:390},{width:1440,height:900}];

async function open(mode='browser',viewport=viewports[0]){
  const page=await browser.newPage({viewport});
  page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(mode=>{
    window.__kidSpeech={calls:[],stops:0};
    Object.defineProperty(window,'speechSynthesis',{configurable:true,value:mode==='browser'?{
      cancel(){__kidSpeech.stops++;},resume(){},getVoices(){return[{lang:'en-US',name:'Fixture voice'}];},
      speak(utterance){__kidSpeech.calls.push(utterance.text);}
    }:undefined});
    window.SpeechSynthesisUtterance=mode==='browser'?class{constructor(text){this.text=text;}}:undefined;
    if(mode==='native')window.ArcadeNative={hasSpeech:()=>true,speak:text=>__kidSpeech.calls.push(text),stopSpeech:()=>__kidSpeech.stops++};
  },mode);
  await page.goto(fixture.base+'/trivia/');
  await page.waitForFunction(()=>window.TriviaAutosave&&window.ArcadeSharedActivity);
  return page;
}
async function contained(page,selector){
  const bounds=await page.locator(selector).boundingBox();
  const viewport=page.viewportSize();
  assert(bounds&&bounds.width>0&&bounds.height>0,selector+' is visible');
  assert(bounds.x>=-1&&bounds.y>=-1&&bounds.x+bounds.width<=viewport.width+1&&bounds.y+bounds.height<=viewport.height+1,selector+' fits inside the screen');
}

try{
  browser=await chromium.launch(browserLaunchOptions);
  await mkdir('test-results/trivia-kids',{recursive:true});
  for(const viewport of viewports){
    const page=await open('browser',viewport);
    await contained(page,"[onclick=\"Game.start('kids')\"]");
    const home=page.locator('#cat-menu [data-shared-home]');
    assert.equal(await home.count(),1,'The opening menu retains Back to Arcade');
    // The start menu may scroll inside its panel; every action must be reachable.
    await home.scrollIntoViewIfNeeded();await contained(page,'#cat-menu [data-shared-home]');
    await page.locator("[onclick=\"Game.start('kids')\"]").click();
    assert.equal(await page.locator('#ans-grid .kid-picture').count(),4);
    for(const selector of ['.question-box','#ans-grid','#kid-listen','#kid-next'])await contained(page,selector);
    const before=await page.evaluate(()=>TriviaAutosave.capture());
    assert.equal(before.currentMode,'kids');
    assert.match((await page.evaluate(()=>__kidSpeech.calls)).at(-1),/Tap a picture/);
    await page.locator('#kid-listen').click();
    assert.equal((await page.evaluate(()=>__kidSpeech.calls)).at(-1),before.currentQuestion.q+' Tap a picture.');
    await page.getByRole('button',{name:String(before.currentQuestion.correct),exact:true}).click();
    const answered=await page.evaluate(()=>TriviaAutosave.capture());
    assert.equal(answered.score.c,1);assert.equal(answered.isTransitioning,true);
    assert.equal(await page.locator('#kid-next').isDisabled(),false);
    await page.waitForTimeout(2200);
    assert.equal((await page.evaluate(()=>TriviaAutosave.capture())).currentQuestion.q,before.currentQuestion.q,'Kid questions wait for the child instead of advancing during narration');
    await page.locator('#ans-grid button').first().click();
    assert.deepEqual((await page.evaluate(()=>TriviaAutosave.capture())).score,answered.score,'A repeated answer cannot score twice');
    await page.evaluate(()=>Game.save());
    await page.reload();await page.waitForFunction(()=>window.TriviaAutosave);
    await page.getByRole('button',{name:'Load Saved',exact:true}).click();
    await page.evaluate(()=>Game.load());
    assert.deepEqual((await page.evaluate(()=>TriviaAutosave.capture())).score,answered.score,'Manual Save/Load preserves score');
    assert.equal((await page.evaluate(()=>TriviaAutosave.capture())).isTransitioning,true,'Manual Save/Load preserves the answered phase');
    assert.equal(await page.locator('#ans-grid .correct').count(),1);
    assert.equal(await page.locator('#kid-next').isDisabled(),false);
    await page.screenshot({path:`test-results/trivia-kids/${viewport.width}x${viewport.height}.png`});
    await page.locator('#kid-next').click();
    assert.equal((await page.evaluate(()=>TriviaAutosave.capture())).isTransitioning,false);
    assert.equal(await page.locator('#kid-next').isDisabled(),true);
    await page.close();
  }
  const page=await open();
  const bank=await page.evaluate(()=>KID_DATA);
  assert.equal(bank.length,36);
  for(let index=0;index<bank.length;index++){
    const row=bank[index];
    assert.equal(new Set(row.slice(1)).size,4,'Every kid question has four distinct picture answers');
    assert(await page.evaluate(labels=>labels.every(label=>!!KID_PICTURES[label]),row.slice(1)),'Every answer has a picture');
    const saved={currentMode:'kids',currentPool:[],score:{c:0,s:0,w:0},currentQuestion:{q:row[0],options:row.slice(1),correct:row[1]},label:'YOUNG KID MODE',isTransitioning:false};
    await page.evaluate(saved=>TriviaAutosave.restore(saved),saved);
    assert.equal(await page.locator('#ans-grid .kid-picture').count(),4);
    const selected=index%2===0?row[1]:row[2];
    await page.getByRole('button',{name:selected,exact:true}).click();
    assert.equal(await page.locator('#ans-grid .correct').getAttribute('data-answer'),row[1],'The correct pictured answer is highlighted');
    const result=await page.evaluate(()=>TriviaAutosave.capture());
    assert.equal(result.score.c,index%2===0?1:0);assert.equal(result.score.w,index%2===0?0:1);
    assert.match((await page.evaluate(()=>__kidSpeech.calls)).at(-1),/The answer is/);
    assert.deepEqual(new Set(result.displayOptions.map(item=>item.text)),new Set(row.slice(1)),'Shared checkpoints store answer identities, not rendered emoji or hidden text');
    const calls=await page.evaluate(()=>__kidSpeech.calls.length);
    await page.evaluate(saved=>{window.ArcadeSharedActivity={isSpectator:()=>true};TriviaSharedAdapter.restore(saved);TriviaSharedAdapter.restore(saved);},result);
    assert.equal(await page.evaluate(()=>__kidSpeech.calls.length),calls,'Repeated observer snapshots never replay narration');
    assert.equal((await page.evaluate(()=>TriviaSharedAdapter.capture())).isTransitioning,true);
    await page.evaluate(()=>{window.ArcadeSharedActivity={isSpectator:()=>false};});
  }
  const priorCalls=await page.evaluate(()=>__kidSpeech.calls.length);
  for(const category of ['math','spelling','vocab','general','all','science']){
    await page.evaluate(category=>Game.start(category),category);
    assert.equal(await page.locator('#kid-controls').isVisible(),false,'Regular Trivia keeps its normal controls');
    assert.equal(await page.locator('#ans-grid .kid-picture').count(),0);
    assert.equal(await page.locator('#ans-grid button').count(),4,category+' still offers four text answers');
  }
  assert.equal(await page.evaluate(()=>__kidSpeech.calls.length),priorCalls,'Existing categories do not start unwanted narration');
  const regular=await page.evaluate(()=>TriviaAutosave.capture());
  await page.getByRole('button',{name:String(regular.currentQuestion.correct),exact:true}).click();
  await page.waitForTimeout(1300);
  assert.equal((await page.evaluate(()=>TriviaAutosave.capture())).isTransitioning,false,'Regular Trivia still advances automatically');
  await page.close();
  const native=await open('native');
  await native.locator("[onclick=\"Game.start('kids')\"]").click();
  assert.equal((await native.evaluate(()=>__kidSpeech.calls)).length,1,'Existing Android bridge speaks the whole short question once');
  const stops=await native.evaluate(()=>__kidSpeech.stops);
  await native.locator('.back-btn').click();
  assert((await native.evaluate(()=>__kidSpeech.stops))>stops,'Opening the game menu cancels narration');
  await native.locator('#shared-menu-resume').click();
  await native.locator('#kid-listen').click();
  const keyStops=await native.evaluate(()=>__kidSpeech.stops);
  await native.locator('.back-btn').focus();await native.keyboard.press('Enter');
  assert((await native.evaluate(()=>__kidSpeech.stops))>keyStops,'Keyboard menu activation cancels narration before the menu consumes the key');
  await native.locator('#shared-menu-resume').click();
  await native.locator('#kid-listen').click();
  const muteStops=await native.evaluate(()=>__kidSpeech.stops);
  await native.evaluate(()=>Settings.toggle('sound'));
  assert((await native.evaluate(()=>__kidSpeech.stops))>muteStops,'Muting game sound cancels narration');
  const mutedCalls=await native.evaluate(()=>__kidSpeech.calls.length);
  await native.locator('#kid-listen').click();
  assert.equal(await native.evaluate(()=>__kidSpeech.calls.length),mutedCalls,'Replay respects the sound setting');
  assert.match(await native.locator('#kid-audio-status').textContent(),/Turn Sound on/);
  await native.close();
  const silent=await open('unavailable');
  await silent.locator("[onclick=\"Game.start('kids')\"]").click();
  assert.match(await silent.locator('#kid-audio-status').textContent(),/device voice/,'Unavailable speech gives useful feedback');
  await silent.locator('#kid-listen').click();
  assert.equal(await silent.locator('#ans-grid button').count(),4,'A missing voice does not break the game');
  await silent.close();
  assert.deepEqual(errors,[],'No Trivia page errors');
  console.log('Young Kid Trivia passed: four responsive layouts, all 36 pictured questions, scoring, manual pacing, replay, browser/native speech, saves, shared restoration and normal Trivia regression.');
}finally{await browser?.close();await fixture.close();}
