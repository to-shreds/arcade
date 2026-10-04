// Behavioral regression checks for desktop typing and short portrait bowling.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium, browserLaunchOptions } from './browser-runtime.mjs';
import { startStaticFixture } from './static-fixture.mjs';
const fixture = await startStaticFixture();
const base = fixture.base;
let browser;
try {
  browser = await chromium.launch(browserLaunchOptions);
  const page=await browser.newPage({viewport:{width:1440,height:900}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`${base}/typing/index.html`);
  await page.locator('#editor').focus();
  await page.keyboard.type('hello');
  assert.equal(await page.locator('#editor').textContent(),'hello');
  await page.keyboard.press('ArrowLeft');await page.keyboard.press('Backspace');
  assert.equal(await page.locator('#editor').textContent(),'helo');
  await page.keyboard.press('Delete');
  assert.equal(await page.locator('#editor').textContent(),'hel');
  await page.keyboard.press('Home');await page.keyboard.type('X');await page.keyboard.press('End');await page.keyboard.press('Enter');
  assert.equal(await page.locator('#editor').textContent(),'Xhel\n');
  await page.locator('[data-key="emoji"]').click();
  await page.locator('.emoji-key').filter({hasText:'❤️'}).click();
  assert.equal(await page.locator('#editor').textContent(),'Xhel\n❤️');
  await page.keyboard.press('Backspace');
  assert.equal(await page.locator('#editor').textContent(),'Xhel\n','Backspace removes the complete emoji grapheme');
  await page.keyboard.type('saved');
  await page.evaluate(()=>ArcadeSave.saveNow());
  await page.goto(`${base}/typing/index.html?resume=1`);
  await page.waitForFunction(()=>document.getElementById('editor').textContent==='Xhel\nsaved');
  assert.deepEqual(errors,[]);
  console.log('PASS: physical and on-screen typing, cursor editing, emoji deletion, and reload autosave');
  await page.setViewportSize({width:320,height:568});
  await page.goto(`${base}/bowling/index.html`);
  await page.locator('#start').click();
  const check=await page.evaluate(()=>{
    const ids=['home','undo','newGame','roll'];
    return ids.map(id=>{const r=document.getElementById(id).getBoundingClientRect();return {id,x:r.x,y:r.y,right:r.right,bottom:r.bottom};});
  });
  for(const control of check)assert(control.x>=0&&control.y>=0&&control.right<=320&&control.bottom<=568,`${control.id} stays reachable in the narrow portrait viewport`);
  await page.locator('#roll').click();
  assert.equal(await page.evaluate(()=>document.scrollingElement.scrollTop),0,'Rolling does not scroll the header out of view');
  assert.deepEqual(errors,[]);
  console.log('PASS: all bowling header buttons and Roll fit320x568; rolling preserves page position');
  await page.goto(`${base}/time/index.html`);
  await page.locator('[onclick="ClockGame.start(1)"]').click();
  const keys=await page.locator('#clock-ui-regular .kp-btn').evaluateAll(nodes=>nodes.map(node=>{const r=node.getBoundingClientRect();return {width:r.width,height:r.height,right:r.right,bottom:r.bottom};}));
  assert.equal(keys.length,12);
  for(const key of keys)assert(key.width>=44&&key.height>=44&&key.right<=320&&key.bottom<=568,'Time keypad has reachable44px touch targets');
  assert.deepEqual(errors,[]);
  console.log('PASS: Time portrait keypad has twelve reachable44px touch targets at320x568');
  await page.goto(`${base}/blackjack/index.html`);
  await page.locator('[onclick="BJGame.init(1)"]').click();
  await page.locator('[onclick="BJGame.addBet(10)"]').click();
  await page.locator('#btn-deal').click();
  assert.notEqual(await page.evaluate(()=>BlackjackAutosave.capture().phase),'betting','The shared-play launch button does not block Deal');
  assert.deepEqual(errors,[]);
  console.log('PASS: Blackjack Deal remains clickable at320x568 with the shared-play control');
  const blackjackDesktop=await browser.newPage({viewport:{width:1280,height:900}});
  await blackjackDesktop.goto(`${base}/blackjack/index.html`);
  await blackjackDesktop.locator('[onclick="BJGame.init(2)"]').click();
  await blackjackDesktop.locator('[onclick="BJGame.addBet(10)"]').click();
  await blackjackDesktop.locator('#btn-deal').click();
  await blackjackDesktop.waitForFunction(()=>BlackjackAutosave.capture().pIdx===1);
  assert.equal(await blackjackDesktop.evaluate(()=>document.documentElement.scrollWidth),1280,'Decorative deck label stays inside the desktop viewport');
  await blackjackDesktop.close();
  console.log('PASS: Blackjack two-player betting and automatic turn advance have no desktop overflow');
  for(const viewport of [{width:1440,height:900},{width:390,height:844},{width:320,height:568},{width:844,height:390}]){
    const make10=await browser.newPage({viewport});
    await make10.goto(`${base}/make-10/index.html`);
    await make10.locator('#startBtn').click();
    await make10.waitForTimeout(75);
    const boxes=await make10.evaluate(()=>{
      const home=document.querySelector('.arcade-home-link').getBoundingClientRect(), title=document.querySelector('.title').getBoundingClientRect();
      return {homeRight:home.right,titleLeft:title.left,titleRight:title.right};
    });
    assert(boxes.titleLeft>=boxes.homeRight&&boxes.titleRight<=viewport.width,'Make10 title clears the Home link at every audited size');
    assert(await make10.evaluate(()=>{
      const launch=document.getElementById('shared-launch');if(!launch)return true;
      const a=launch.getBoundingClientRect();
      return [...document.querySelectorAll('#table .card,.footer,.title,.turnpill')].every(el=>{const b=el.getBoundingClientRect();return a.left>=b.right||a.right<=b.left||a.top>=b.bottom||a.bottom<=b.top;});
    }),'Shared-play button leaves Make10 cards, title, mode chip, and footer text uncovered');
    await make10.close();
  }
  console.log('PASS: Make10 title clears Home and shared play leaves cards/footer uncovered at all four sizes');
  const headers=[['maze','[onclick="MazeGame.start(12,12)"]','.mz-top'],['simon','#si-menu [onclick="SimonGame.start()"]','.si-top'],['checkers','[onclick="CheckersGame.start(\'pvp\')"]','.ck-top'],['mini-golf','[onclick="MiniGolf.startOrContinue()"]','.mg-top']];
  for(const viewport of [{width:1440,height:900},{width:390,height:844},{width:320,height:568},{width:844,height:390}])for(const [game,start,header] of headers){
    const gamePage=await browser.newPage({viewport});
    await gamePage.goto(`${base}/${game}/index.html`);
    await gamePage.locator(start).click();
    await gamePage.waitForTimeout(100);
    const blocked=await gamePage.locator(header+' button').evaluateAll(nodes=>nodes.filter(el=>{const r=el.getBoundingClientRect();if(!r.width||!r.height)return false;const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return !hit||!el.contains(hit);}).map(el=>el.textContent));
    assert.deepEqual(blocked,[],`${game} header controls clear the fixed Settings button at${viewport.width}x${viewport.height}`);
    await gamePage.close();
  }
  console.log('PASS: Maze, Simon, Checkers, and MiniGolf header controls clear Settings at all four sizes');
  await page.setViewportSize({width:844,height:390});
  await mkdir('test-results/local-ui',{recursive:true});
  const landscape=[
    ['chess','#modePvp','#board'],
    ['checkers','[onclick="CheckersGame.start(\'pvp\')"]','#ck-wrap'],
    ['tic-tac-toe','[onclick="TicTacToe.start(\'pvp\')"]','.ttt-board,.ttt-mini button'],
    ['make-10','#startBtn','#table .card'],
    ['time','[onclick="ClockGame.start(1)"]','#clock-ui-regular .kp-btn'],
    ['math','[onclick="MathGame.start(1)"]','#g-math .kp-btn'],
    ['maze','[onclick="MazeGame.start(12,12)"]','#mz-cwrap,.mz-pad-btn:not(.blank)'],
    ['simon','#si-menu [onclick="SimonGame.start()"]','.si-pad'],
  ];
  for(const [game,start,target] of landscape){
    const page=await browser.newPage({viewport:{width:844,height:390}});
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto(`${base}/${game}/index.html`);
    await page.locator(start).click();
    await page.waitForTimeout(200);
    const bounds=await page.locator(target).evaluateAll(nodes=>nodes.map(node=>{const r=node.getBoundingClientRect();return {id:node.id,x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height};}));
    assert(bounds.length>0,`${game} playable elements render`);
    for(const box of bounds)assert(box.width>0&&box.height>0&&box.x>=0&&box.y>=0&&box.right<=845&&box.bottom<=391,`${game} ${box.id||target} fits the landscape screen: ${JSON.stringify(box)}`);
    if(game==='chess')assert(await page.locator('#board [data-sq]').evaluateAll(nodes=>nodes.every(el=>{const r=el.getBoundingClientRect(), hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return hit&&el.contains(hit);})),'Chess toast leaves every board square clickable');
    await page.screenshot({path:`test-results/local-ui/landscape-${game}.png`});
    assert.deepEqual(errors,[]);
    console.log(`PASS: ${game} board and gameplay targets fit844x390`);
    await page.close();
  }
  await page.close();
}finally{await browser?.close();await fixture.close();}
