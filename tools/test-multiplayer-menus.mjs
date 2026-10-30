import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { chromium, browserLaunchOptions } from './browser-runtime.mjs';
import { startStaticFixture } from './static-fixture.mjs';
import { openMultiplayerMenu } from './shared-menu-browser.mjs';
const fixture=await startStaticFixture();
const browser=await chromium.launch(browserLaunchOptions);
const output=new URL('../test-results/multiplayer-menus/',import.meta.url);
await mkdir(output,{recursive:true});
const catalog=JSON.parse(await readFile(new URL('../catalog.json',import.meta.url)));
const shared=[];
for(const item of catalog.items.filter(item=>item.enabled&&!item.warning)){
  if((await readFile(new URL('../'+item.launchPath,import.meta.url),'utf8')).includes('shared-activity.js'))shared.push(item);
}
assert.equal(shared.length,34);
const start={
  'make-10':'#startBtn',balloons:'[onclick="BalloonGame.start()"]',blackjack:'[onclick="BJGame.init(2)"]',time:'[onclick="ClockGame.start(1)"]',insultinator:'#pickNice',hangman:'[onclick="HangmanGame.startRandom()"]',solitaire:'#startBtn',jigsaw:'#startBtn',codebreaking:'#play',math:'[onclick="MathGame.start(1)"]',spelling:'#play',maze:'[onclick="MazeGame.start(12,12)"]',minesweeper:'[data-preset="easy"], [data-level="easy"], [data-diff="easy"]','mini-golf':'[onclick="MiniGolf.startOrContinue()"]','orb-slicer':'#orb-ov-btn','two-truths':'#play',patterns:'#play',shuffleboard:'#btnApply',simon:'#si-menu [onclick="SimonGame.start()"]','regex-lab':'#startBtn',trivia:'[onclick="Game.start(\'science\')"]','contraption-maker':'#starter','bug-squish':'#startBtn','firefighter-frenzy':'#startBtn','monster-dentist':'#startBtn',bowling:'#start','mad-libs':'#randomStoryButton','bounce-boxes':'#resumeBtn'
};
const results=[],errors=[];
async function check(name,fn){try{await fn();results.push({name,pass:true});console.log('PASS '+name);}catch(error){results.push({name,pass:false,error:error.stack});console.error('FAIL '+name+': '+error.message);}}
async function visit(context,game,suffix=''){
  const page=await context.newPage();page.setDefaultTimeout(6000);
  page.on('pageerror',error=>errors.push({game,message:error.message}));
  await page.goto(`${fixture.base}/${game}/${suffix}`);
  await page.locator('#shared-launch').waitFor({state:'attached'});
  return page;
}
try{
 for(const viewport of [{width:1440,height:900},{width:390,height:844},{width:320,height:568},{width:844,height:390}]){
  const mobile=viewport.width<500,context=await browser.newContext({viewport,hasTouch:mobile});
  const gesture=mobile?'tap':'click';
  // Old per-game globe positions must never recreate an overlay.
  await context.addInitScript(()=>{localStorage.setItem('arcade.shared.launchPosition.paint-lab.v1',JSON.stringify({schema:1,x:.5,y:.5}));});
  for(const item of shared)await check(`${item.folder} ${viewport.width}x${viewport.height}`,async()=>{
    const page=await visit(context,item.folder);
    try{
      // Menu-less activities expose a menu immediately; initial setup screens
      // also offer multiplayer without requiring a local game first.
      await openMultiplayerMenu(page,gesture);
      await page.locator('#shared-close')[gesture]();
      if(start[item.folder]){
        const controls=page.locator(start[item.folder]);
        for(const control of await controls.all())if(await control.isVisible()&&await control.isEnabled()){await control[gesture]();break;}
      }
      assert.equal(await page.locator('#shared-panel').isVisible(),false);
      assert.equal(await page.locator('#shared-menu').isVisible(),false);
      assert.equal(await page.locator('#shared-launch').isVisible(),false,'Multiplayer stays inside the closed menu during play');
      assert.equal(await page.locator('#shared-launch').evaluate(el=>getComputedStyle(el).position),'static','No floating multiplayer button');
      const toggle=page.locator('[data-shared-menu-toggle]:visible').first();
      assert.equal(await toggle.count(),1,'A menu is reachable from the activity');
      const before=page.url();
      await toggle[gesture]();
      assert.equal(page.url(),before,'Menu does not navigate home');
      const entry=page.locator('[data-shared-open]:visible').first();
      await entry.scrollIntoViewIfNeeded();
      const b=await entry.boundingBox();
      assert.ok(b&&b.width>=100&&b.height>=40&&b.x>=-1&&b.y>=-1&&b.x+b.width<=viewport.width+1&&b.y+b.height<=viewport.height+1,'Menu item is reachable within the viewport');
      if(['paint-lab','solitaire','simon','typing','music-maker'].includes(item.folder))await page.screenshot({path:new URL(`${item.folder}-${viewport.width}x${viewport.height}-menu.png`,output).pathname});
      await entry[gesture]();
      await page.locator('#shared-panel').waitFor({state:'visible'});
      assert.equal(await page.locator('#shared-name').inputValue(),'');
      assert.equal(await page.locator('#shared-create').isEnabled(),true);
      assert.equal(await page.locator('#shared-join').isEnabled(),true);
      if(['paint-lab','solitaire','simon','typing'].includes(item.folder))await page.screenshot({path:new URL(`${item.folder}-${viewport.width}x${viewport.height}.png`,output).pathname});
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('#shared-panel').isVisible(),false,'Escape dismisses multiplayer');
      assert.equal(page.url(),before);
    }catch(error){await page.screenshot({path:new URL(`${item.folder}-${viewport.width}x${viewport.height}-failure.png`,output).pathname}).catch(()=>{});throw error;}
    finally{await page.close();}
  });
  await context.close();
 }
 await check('Keyboard, focus, exact local save/reload, menu Resume and Home',async()=>{
  const context=await browser.newContext({viewport:{width:390,height:844}}),page=await visit(context,'typing');
  try{
    await page.locator('#editor').focus();await page.keyboard.type('Keep this text');
    const before=await page.evaluate(()=>TypingAutosave.capture());
    await page.locator('[data-shared-menu-toggle]').focus();await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(()=>document.activeElement.id),'shared-menu-resume');
    await page.keyboard.press('Shift+Tab');assert.equal(await page.evaluate(()=>document.activeElement.id),'shared-menu-home');
    await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.id),'shared-menu-resume');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('[data-shared-menu-toggle]').evaluate(el=>el===document.activeElement),true);
    await page.locator('[data-shared-menu-toggle]').click();await page.locator('#shared-menu-resume').click();
    assert.deepEqual(await page.evaluate(()=>TypingAutosave.capture()),before,'Opening/closing menu preserves the local activity');
    await openMultiplayerMenu(page);await page.locator('#shared-name').fill('Room name');await page.keyboard.type('x');
    assert.equal((await page.evaluate(()=>TypingAutosave.capture())).text,before.text,'Room form typing does not operate the game');
    await page.keyboard.press('Escape');await page.evaluate(()=>ArcadeSave.saveNow());
    await page.goto(fixture.base+'/typing/?resume=1');await page.waitForFunction(()=>document.getElementById('editor').textContent==='Keep this text');
    assert.equal(await page.locator('#shared-launch').isVisible(),false,'Reload leaves multiplayer in the menu');
    await page.locator('[data-shared-menu-toggle]').click();await page.locator('#shared-menu-home').click();await page.waitForURL(fixture.base+'/index.html');
  }finally{await context.close();}
 });
 await check('Invitation opens multiplayer without an exposed globe',async()=>{
  const context=await browser.newContext(),page=await visit(context,'paint-lab','?room=ABC234');
  try{assert.equal(await page.locator('#shared-panel').isVisible(),true);assert.equal(await page.locator('#shared-code').inputValue(),'ABC234');assert.equal(await page.locator('#shared-launch').isVisible(),false);}finally{await context.close();}
 });
 await check('Blocked browser storage still permits menu and multiplayer',async()=>{
  const context=await browser.newContext();await context.addInitScript(()=>{Storage.prototype.getItem=function(){throw Error('storage blocked')};Storage.prototype.setItem=function(){throw Error('storage blocked')};});
  const page=await visit(context,'paint-lab');try{await openMultiplayerMenu(page);await page.locator('#shared-close').click();assert.equal(await page.locator('#shared-menu').isVisible(),false);}finally{await context.close();}
 });
 assert.deepEqual(errors,[],'No JavaScript errors');
}finally{
 await writeFile(new URL('report.json',output),JSON.stringify({results,errors},null,2));await browser.close();await fixture.close();
}
if(results.some(r=>!r.pass)||errors.length)process.exitCode=1;
