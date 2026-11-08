// Repeated real UI input, rotation, save/reload and denied-storage checks for
// every enabled catalog entry. No account credentials or production rooms.
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {chromium,browserLaunchOptions} from './browser-runtime.mjs';
import {startStaticFixture} from './static-fixture.mjs';
const catalog=JSON.parse(await readFile(new URL('../catalog.json',import.meta.url)));
const filter=process.env.ARCADE_STRESS_GAME;
const games=catalog.items.filter(x=>x.enabled&&!x.warning&&(!filter||x.folder===filter));
const fixture=await startStaticFixture(),output=new URL(process.env.ARCADE_STRESS_OUT||'../test-results/project-stress/',import.meta.url);
await mkdir(output,{recursive:true});
const browser=await chromium.launch(browserLaunchOptions),results=[];
const starts={
 'make-10':'#startBtn',balloons:'[onclick="BalloonGame.start()"]',blackjack:'[onclick="BJGame.init(1)"]',
 checkers:'[onclick="CheckersGame.start(\'pvp\')"]',chess:'#modePvp',time:'[onclick="ClockGame.start(1)"]',
 dots:'[onclick="DotsGame.startGame(5,5)"]',hangman:'[onclick="HangmanGame.startRandom()"]',solitaire:'#startBtn',
 jigsaw:'#startBtn',codebreaking:'#play',math:'[onclick="MathGame.start(1)"]',spelling:'#play',maze:'[onclick="MazeGame.start(12,12)"]',
 memory:'#startBtn',minesweeper:'[data-diff="easy"]','mini-golf':'[onclick="MiniGolf.startOrContinue()"]','orb-slicer':'#orb-ov-btn',
 'two-truths':'#play',patterns:'#play',shuffleboard:'#btnApply',simon:'#si-menu [onclick="SimonGame.start()"]',
 'regex-lab':'#startBtn','tic-tac-toe':'[onclick="TicTacToe.start(\'pvp\')"]',trivia:'[onclick="Game.start(\'science\')"]',
 'contraption-maker':'#starter',sorry:'#startBtn','bug-squish':'#startBtn','firefighter-frenzy':'#startBtn',
 'monster-dentist':'#startBtn',bowling:'#start',monopoly:'#startBtn',insultinator:'#pickNice',
 tanks:'#localStart',upwords:'#localStart','robot-workshop':'#startCampaign','train-trouble':'#campaignBtn'
};
const actions={
 'make-10':'#hintBtn',blackjack:'[onclick="BJGame.addBet(10)"]',time:'.kp-btn',hangman:'#keyboard [role="button"]',
 solitaire:'[data-action="draw-klondike"]',codebreaking:'#palette button',math:'.kp-btn',spelling:'#keyboard button',
 memory:'.card[data-index],.memory-card',minesweeper:'#grid .cell','two-truths':'#claims button',patterns:'#puzzle button',
 'regex-lab':'[data-pick],[data-one]','tic-tac-toe':'.ttt-cell',trivia:'.ans-btn',
 insultinator:'#btnGenerate',typing:'[data-key="a"]','contraption-maker':'#drop',
 'mad-libs':'#randomStoryButton','silly-face-lab':'[aria-label="Make a surprise face"]',bowling:'#roll',
 monopoly:'[data-act="roll"]',tv:'#movies-tab,#shows-tab',tanks:'#fire',upwords:'#shuffle','train-trouble':'#hintBtn'
};
async function clickFirst(page,selector,index=0){
 if(!selector)return false;
 const candidates=await page.locator(selector).all(),available=[];
 for(const c of candidates)if(await c.isVisible()&&await c.isEnabled())available.push(c);
 if(!available.length)return false;
 await available[index%available.length].click({timeout:5000});return true;
}
async function act(page,game,record){
 if(['tanks','upwords'].includes(game))await page.locator('#mode').selectOption('hotseat');
 if(starts[game])assert(await clickFirst(page,starts[game]),'Start control is usable');
 if(game==='train-trouble')assert(await clickFirst(page,'#job-0'),'First dispatch job is usable');
 if(game==='upwords')await clickFirst(page,'#showRack');
 if(game==='guess-who'){
  await page.locator('#nickname').fill('Detective');await page.locator('#joinCode').fill('A');
  await page.locator('#join').click();
  assert.match(await page.locator('#setupMessage').textContent(),/code/i,'Invalid short room code is explained locally');
  record.actions+=3;
 }
 if(game==='chess'){
  for(const sq of [12,28,52,36,6,21])await page.locator(`#board [data-sq="${sq}"]`).click();
  record.actions+=6;
 }
 if(game==='dots'){
  const b=await page.locator('#c').boundingBox();
  for(const [row,col] of [[0,0],[0,1],[1,0],[1,1]])await page.mouse.click(b.x+b.width*(.7+col)/5.4,b.y+b.height*(.7+row)/5.4);
  record.actions+=4;
 }
 if(game==='checkers'){
  const b=await page.locator('#ck-canvas').boundingBox();
  for(const [row,col] of [[5,0],[4,1],[2,1],[3,0]])await page.mouse.click(b.x+b.width*(col+.5)/8,b.y+b.height*(row+.5)/8);
  record.actions+=4;
 }
 for(let i=0;i<4;i++){
  if(game==='minesweeper'){
   if(await page.evaluate(()=>window.MinesweeperAutosave.capture().gameOver))await page.locator('#startOverlay.show').waitFor({state:'visible'});
   if(await page.locator('#startOverlay').evaluate(el=>el.classList.contains('show')))await clickFirst(page,starts[game]);
  }
  if(actions[game]&&await clickFirst(page,actions[game],i))record.actions++;
  else if(['maze','balloons','bug-squish','orb-slicer','bounce-boxes','paint-lab','trail','shuffleboard','firefighter-frenzy','monster-dentist','jigsaw'].includes(game)){
   const canvas=page.locator('canvas:visible').first(),box=await canvas.boundingBox();
   if(box&&box.width>20&&box.height>20){
    await page.mouse.move(box.x+box.width*.35,box.y+box.height*.7);await page.mouse.down();
    await page.mouse.move(box.x+box.width*.65,box.y+box.height*.35,{steps:5});await page.mouse.up();record.actions++;
   }
  }
 }
 if(game==='regex-lab'){
  await clickFirst(page,'#checkAction');await clickFirst(page,'#nextAction');record.actions+=2;
 }
 if(game==='adventure'){
  await page.waitForFunction(()=>globalThis.__LOGAN_CYOA_DEBUG__?.engine.isReady());
  for(let i=0;i<4;i++){
   while(await page.locator('#nextPageButton').isVisible()&&await page.locator('#nextPageButton').isEnabled())await page.locator('#nextPageButton').click();
   await page.locator('#choices .choice').first().click();record.actions++;
  }
 }
 if(game==='build-my-joke'){
  for(let i=0;i<4;i++){
   await clickFirst(page,'#random');
   if(!await page.locator('#result').isVisible())await clickFirst(page,'#reveal');
   await clickFirst(page,'#favorite');await clickFirst(page,'#close');record.actions+=3;
  }
 }
 if(game==='mad-libs'){
  await clickFirst(page,'#fillEmptyButton');await clickFirst(page,'#makeStoryButton');record.actions+=2;
 }
 if(game==='blackjack'){await clickFirst(page,'#btn-deal');await page.waitForTimeout(750);record.actions++;}
 if(game==='robot-workshop'){
  assert(await clickFirst(page,'.port[data-node="A"][data-kind="out"]'),'Robot input output is reachable');
  assert(await clickFirst(page,'.port[data-node="O0"][data-port="0"][data-kind="in"]'),'Robot machine input is reachable');
  assert(await clickFirst(page,'#runBtn'),'Circuit tests are reachable');record.actions+=3;
 }
 if(game==='train-trouble'){
  assert(await clickFirst(page,'#send-t1'),'Engine Send is reachable');
  assert(await clickFirst(page,'#brake-t1'),'Engine Brake is reachable');record.actions+=2;
 }
}
async function verifySave(page,game,record){
 const info=await page.evaluate(async()=>{
  const a=window.ArcadeSave?.getAdapter?.();if(!a)return{adapter:false};
  const snapshot=await a.capture(),meaningful=typeof a.meaningful==='function'?a.meaningful():a.meaningful!==false;
  const entry=await ArcadeSave.saveNow();
  return{adapter:true,meaningful,hasSnapshot:snapshot!==undefined,id:a.id,entry,summary:entry?.summary};
 });
 record.save={adapter:info.adapter,meaningful:info.meaningful,saved:!!info.entry,summary:info.summary};
 if(!info.adapter)return;
 if(['solitaire','regex-lab','train-trouble','robot-workshop'].includes(game))assert(info.meaningful,'Played progress is meaningful for autosave');
 if(info.meaningful&&info.hasSnapshot){
  assert(info.entry,'A meaningful played activity creates an autosave');
  assert(info.summary,'Autosave describes the played activity');
  await page.goto(`${fixture.base}/${game}/?resume=1`);
  await page.waitForFunction(id=>window.ArcadeSave?.getCurrentEntry?.()?.id===id,info.id);
  await page.waitForFunction(()=>!document.querySelector('.arcade-save-layer:not([hidden])'));
  assert.equal(await page.evaluate(()=>document.querySelector('.arcade-save-toast')?.textContent),'Saved progress loaded.');
  assert(await page.evaluate(()=>ArcadeSave.getAdapter().capture()!==undefined),'Resumed activity still has a snapshot');
  record.save.reloaded=true;
 }
}
async function geometry(page){
 return page.evaluate(()=>({width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,
  brokenImages:[...document.images].filter(x=>x.getAttribute('src')&&x.checkVisibility()&&(!x.complete||!x.naturalWidth)).map(x=>x.src),
  canvases:[...document.querySelectorAll('canvas')].filter(x=>x.checkVisibility()).map(x=>({width:x.width,height:x.height,cssWidth:x.clientWidth,cssHeight:x.clientHeight}))}));
}
try{
 for(const mode of process.env.ARCADE_STRESS_MODE?[process.env.ARCADE_STRESS_MODE]:['repeat-rotate-save','storage-denied']){
  for(const item of games){
   const context=await browser.newContext({viewport:{width:768,height:1024},hasTouch:true});
   if(mode==='storage-denied')await context.addInitScript(()=>{
    for(const method of ['getItem','setItem','removeItem'])Storage.prototype[method]=function(){throw new DOMException('Storage is unavailable','SecurityError')};
   });
   const page=await context.newPage();page.setDefaultTimeout(6000);
   const record={game:item.folder,mode,actions:0,errors:[],missing:[],pass:false};
   page.on('pageerror',e=>{record.errors.push(e.message);(record.errorStacks||=[]).push(e.stack);});
   page.on('response',r=>{if(r.status()>=400&&new URL(r.url()).origin===new URL(fixture.base).origin)record.missing.push(r.status()+' '+r.url());});
   page.on('dialog',d=>d.dismiss());
   try{
    await page.goto(fixture.base+'/'+item.launchPath);await page.waitForTimeout(200);
    await act(page,item.folder,record);
    if(mode==='repeat-rotate-save'){
     for(const viewport of [{width:320,height:568},{width:844,height:390},{width:768,height:1024}]){
      await page.setViewportSize(viewport);await page.waitForTimeout(100);
      const layout=await geometry(page);assert.deepEqual(layout.brokenImages,[],'Visible images load');
      for(const c of layout.canvases)assert(c.width>0&&c.height>0,'Visible canvases retain valid pixel dimensions');
      record.layouts=(record.layouts||[]).concat(layout);
     }
     await verifySave(page,item.folder,record);
    }
    assert.deepEqual(record.errors,[],'No uncaught JavaScript errors');assert.deepEqual(record.missing,[],'No missing local runtime assets');
    record.pass=true;
   }catch(error){record.failure=error.stack;await page.screenshot({path:new URL(`${item.folder}-${mode}-failure.png`,output).pathname}).catch(()=>{});}
   finally{await context.close();}
   results.push(record);console.log(`${record.pass?'PASS':'FAIL'} ${mode} ${item.folder}${record.failure?': '+record.failure.split('\n')[0]:''}`);
   await writeFile(new URL('report.json',output),JSON.stringify({results},null,2));
  }
 }
}finally{await browser.close();await fixture.close();}
assert.equal(results.filter(x=>!x.pass).length,0,'Every enabled activity passes stress checks; see report.json');
