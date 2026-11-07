import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium,browserLaunchOptions} from './browser-runtime.mjs';
import {startStaticFixture} from './static-fixture.mjs';

const output=new URL('../test-results/chess-history/',import.meta.url);
await mkdir(output,{recursive:true});
const fixture=await startStaticFixture(),browser=await chromium.launch(browserLaunchOptions),results=[];
const viewports=[{width:1280,height:900},{width:768,height:1024},{width:390,height:844},{width:320,height:568},{width:844,height:390},{width:568,height:320},{width:390,height:320}];
const glyphs={1:'♙',2:'♘',3:'♗',4:'♖',5:'♕',6:'♔','-1':'♟','-2':'♞','-3':'♝','-4':'♜','-5':'♛','-6':'♚',0:''};
async function capture(page){return page.evaluate(()=>ArcadeSave.getAdapter().capture());}
async function position(page,expected,label){
 const actual=await page.locator('#board .sq').evaluateAll(squares=>{
  const board=Array(64).fill('');for(const square of squares)board[Number(square.dataset.sq)]=square.querySelector('.piece')?.textContent||'';return board;
 });
 assert.deepEqual(actual,expected.map(piece=>glyphs[piece]),label);
}
async function visibleBoard(page,label){
 await page.waitForFunction(()=>{
  const board=document.getElementById('board'),host=document.getElementById('historyBoardHost'),b=board.getBoundingClientRect(),h=host.getBoundingClientRect();
  const expected=Math.max(80,Math.floor(Math.min(h.width,h.height)-14));
  return host.contains(board)&&b.width>100&&Math.abs(b.width-expected)<1&&Math.abs(b.height-expected)<1&&b.left>=h.left&&b.right<=h.right&&b.top>=h.top&&b.bottom<=h.bottom;
 });
 const layout=await page.evaluate(()=>{
  const board=document.getElementById('board'),host=document.getElementById('historyBoardHost'),side=document.querySelector('.historySidebar'),b=board.getBoundingClientRect(),s=side.getBoundingClientRect();
  const hit=document.elementFromPoint(b.x+b.width/2,b.y+b.height/2);
  return{rect:{x:b.x,y:b.y,width:b.width,height:b.height},withinScreen:b.left>=0&&b.right<=innerWidth&&b.top>=0&&b.bottom<=innerHeight,
   separate:b.right<=s.left||s.right<=b.left||b.bottom<=s.top||s.bottom<=b.top,uncovered:host.contains(hit),inert:board.inert,overlay:getComputedStyle(document.getElementById('overlay')).display,
   piecesFit:[...board.querySelectorAll('.piece')].every(piece=>parseFloat(getComputedStyle(piece).fontSize)<=piece.closest('.sq').getBoundingClientRect().width*.95)};
 });
 assert(layout.withinScreen,label+': whole board is onscreen');assert(layout.separate,label+': navigation does not overlap the board');
 assert(layout.uncovered,label+': the board is visible above the backdrop');assert(layout.inert,label+': browsing cannot play a move');
 assert(layout.piecesFit,label+': pieces fit inside their squares');
 assert.equal(layout.overlay,'none',label+': game-over overlay cannot hide the position');
 assert(Math.abs(layout.rect.width-layout.rect.height)<1,label+': board stays square');return layout.rect;
}
try{
 for(const viewport of viewports){
  const context=await browser.newContext({viewport,hasTouch:viewport.width<900}),page=await context.newPage(),errors=[];
  page.setDefaultTimeout(10000);page.on('pageerror',error=>errors.push(String(error)));
  const result={viewport,pass:false};
  try{
   await page.goto(fixture.base+'/chess/');await page.locator('#modePvp').click();
   await page.locator('#movesBtn').click();await visibleBoard(page,'Zero-move history');
   for(const key of ['Tab','Tab','Shift+Tab','Shift+Tab']){
    await page.keyboard.press(key);assert.equal(await page.evaluate(()=>document.activeElement.id),'movesClose','Empty history keeps focus on Done');
   }
   await page.locator('#movesClose').click();
   for(const [from,to] of [[12,28],[52,36],[6,21],[57,42],[5,33]]){
    await page.locator(`#board [data-sq="${from}"]`).click();await page.locator(`#board [data-sq="${to}"]`).click();
   }
   const saved=await capture(page);assert.equal(saved.moves.length,5,'Five native moves were played');
   await page.locator('#movesBtn').click();result.board=await visibleBoard(page,'Moves');
   await position(page,saved.states[5].board,'Opening Moves shows the latest board');
   await page.locator('#firstBtn').click();assert.equal((await capture(page)).currentPly,0);
   await position(page,saved.states[0].board,'Start button shows the actual starting position');
   await page.locator('#nextBtn').click();await position(page,saved.states[1].board,'Next shows e4');
   await page.locator('#movesList [data-ply="3"]').focus();await page.keyboard.press('Enter');
   await position(page,saved.states[3].board,'Move selection shows the chosen historical board');
   assert.equal(await page.evaluate(()=>document.activeElement.dataset.ply),'3','Keyboard move selection keeps focus after rerender');
   for(const key of [...Array(15).fill('Tab'),...Array(15).fill('Shift+Tab')]){
    await page.keyboard.press(key);assert(await page.evaluate(()=>!!document.activeElement.closest('#movesModal')),'Keyboard focus remains in Moves');
   }
   await page.locator('#plySlider').focus();await page.keyboard.press('Home');await page.keyboard.press('ArrowRight');await page.keyboard.press('ArrowRight');
   assert.equal((await capture(page)).currentPly,2);await position(page,saved.states[2].board,'Native slider keyboard input shows position two');
   const rotated=viewport.width>viewport.height?{width:390,height:844}:{width:844,height:390};
   await page.setViewportSize(rotated);await visibleBoard(page,'Rotated Moves');await position(page,saved.states[2].board,'Rotation keeps the selected position');
   await page.setViewportSize(viewport);await visibleBoard(page,'Restored viewport');
   await page.screenshot({path:new URL(`history-${viewport.width}x${viewport.height}.png`,output).pathname});
   await page.locator('#lastBtn').click();await position(page,saved.states[5].board,'Latest returns to the current position');
   await page.locator('#movesClose').click();
   assert.equal(await page.locator('.board-wrap #board').count(),1,'Done returns the same board to normal play');
   assert.equal(await page.locator('#board').evaluate(board=>board.inert),false);
   await page.locator('#movesBtn').click();await page.locator('#prevBtn').click();
   assert.equal((await capture(page)).currentPly,4);
   await page.evaluate(()=>ArcadeSave.saveNow());await page.keyboard.press('Escape');
   await page.goto(fixture.base+'/chess/?resume=1');
   await page.waitForFunction(()=>window.ArcadeSave?.getCurrentEntry?.()&&ArcadeSave.getAdapter().capture().currentPly===4);
   await position(page,saved.states[4].board,'Native reload preserves selected history and full game');
   const restored=await capture(page);assert.deepEqual(restored.moves,saved.moves);assert.deepEqual(restored.states,saved.states);
   await page.locator('#board [data-sq="8"]').click();await page.locator('#board [data-sq="32"]').click();
   assert.deepEqual((await capture(page)).moves,saved.moves,'Rejected historical move retains the future move list');
   assert.deepEqual((await capture(page)).states,saved.states,'Rejected historical move retains all saved positions');
   await page.locator('#movesBtn').click();await page.locator('#lastBtn').click();await page.locator('#movesClose').click();
   await position(page,saved.states[5].board,'Reloaded history can return to latest');
   assert.deepEqual(errors,[]);result.pass=true;console.log(`PASS Chess history ${viewport.width}x${viewport.height}`);
  }catch(error){result.error=error.stack;await page.screenshot({path:new URL(`failure-${viewport.width}x${viewport.height}.png`,output).pathname}).catch(()=>{});throw error;}
  finally{results.push(result);await writeFile(new URL('report.json',output),JSON.stringify({results},null,2));await context.close();}
 }
}finally{await browser.close();await fixture.close();}
