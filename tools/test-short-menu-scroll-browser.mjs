// Menus must scroll with actual user input. Programmatic scrollIntoView can
// move an overflow:hidden panel and would conceal these regressions.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium,browserLaunchOptions} from './browser-runtime.mjs';
import {startStaticFixture} from './static-fixture.mjs';

const fixture=await startStaticFixture(),output=new URL('../test-results/short-menu-scroll/',import.meta.url);
await mkdir(output,{recursive:true});
const browser=await chromium.launch(browserLaunchOptions),results=[];
async function verifyMinesweeperStartup(hasTouch){
  const context=await browser.newContext({viewport:{width:844,height:390},hasTouch,isMobile:hasTouch});
  const page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push({message:error.message,stack:error.stack}));
  let release;
  const gate=new Promise(resolve=>{release=resolve;});
  try{
    // The activity registers resize before the following external save script.
    // Hold that response so a real viewport resize runs before window.load.
    await page.route('**/arcade-save.js',async route=>{await gate;await route.continue();});
    const navigation=page.goto(fixture.base+'/minesweeper/index.html');
    await page.waitForFunction(()=>!!window.MinesweeperAutosave);
    assert.equal(await page.evaluate(()=>MinesweeperAutosave.capture()),undefined,'The board has not been initialized before load');
    await page.evaluate(()=>{window.__startupResizeCount=0;window.addEventListener('resize',()=>window.__startupResizeCount++);});
    await page.setViewportSize({width:800,height:360});
    await page.waitForFunction(()=>window.__startupResizeCount>0);
    assert.equal(await page.evaluate(()=>document.readyState),'loading','The native resize precedes window.load');
    assert.deepEqual(errors,[],'An early viewport resize does not render an absent board');
    release();await navigation;
    await page.waitForFunction(()=>document.querySelectorAll('#grid .cell').length===81);
    const before=await page.evaluate(()=>MinesweeperAutosave.capture());
    assert.equal(before.rows,9);assert.equal(before.cols,9);assert.equal(before.mines,10);
    // Native input changes one cell. Resizing must retain that exact board.
    await page.locator('[data-diff="easy"]').click();
    const cell=await page.locator('#grid .cell').first().boundingBox();
    await page.mouse.move(cell.x+cell.width/2,cell.y+cell.height/2);await page.mouse.down();
    await page.waitForFunction(()=>MinesweeperAutosave.capture().grid[0][0].flagged);await page.mouse.up();
    const played=await page.evaluate(()=>MinesweeperAutosave.capture());
    assert.equal(played.grid[0][0].flagged,true,'A native long press flags the cell');
    await page.setViewportSize({width:320,height:568});
    await page.waitForFunction(()=>window.__startupResizeCount>1);
    assert.deepEqual(await page.evaluate(()=>MinesweeperAutosave.capture()),played,'Resize preserves every cell, flag, timer and game control value');
    assert.deepEqual(errors,[]);
    const name='minesweeper preload resize '+(hasTouch?'touch':'desktop');
    results.push({name,passed:true,preloadResize:true,retainedBoard:true});console.log('PASS '+name);
  }finally{release?.();await context.close();}
}
async function reachable(target){
  return target.evaluate(el=>{
    const r=el.getBoundingClientRect(),panel=el.closest('#startOverlay .panel'),p=panel.getBoundingClientRect();
    const x=r.x+r.width/2,y=r.y+r.height/2,hit=document.elementFromPoint(x,y);
    return r.width>0&&r.height>0&&r.top>=Math.max(0,p.top)&&r.bottom<=Math.min(innerHeight,p.bottom)&&x>=0&&x<innerWidth&&!!hit&&(hit===el||el.contains(hit));
  });
}
async function nativeScroll(page,panel,direction,gesture){
  const box=await panel.boundingBox(),viewport=page.viewportSize();
  const x=Math.min(viewport.width-20,box.x+box.width-20);
  const bottom=Math.min(viewport.height-20,box.y+box.height-24),top=Math.max(20,box.y+24);
  if(gesture==='wheel'){
    await page.mouse.move(x,(top+bottom)/2);await page.mouse.wheel(0,direction*650);
  }else{
    const session=await page.context().newCDPSession(page);
    const start=direction>0?bottom:top,end=direction>0?top:bottom;
    await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y:start}]});
    for(let i=1;i<=12;i++)await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:start+(end-start)*i/12}]});
    await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await session.detach();
  }
  await page.waitForTimeout(150);
}
async function reveal(page,panel,target,gesture){
  for(let i=0;i<7&&!await reachable(target);i++){
    const direction=await target.evaluate(el=>el.getBoundingClientRect().top<el.closest('.panel').getBoundingClientRect().top?-1:1);
    await nativeScroll(page,panel,direction,gesture);
  }
  assert(await reachable(target),'Native '+gesture+' reveals the whole control and its actual hit target');
}
async function activate(page,panel,target,gesture){
  assert(await reachable(target),'Control is reachable before Playwright can auto-scroll it');
  const before=await panel.evaluate(el=>el.scrollTop);
  await target[gesture==='touch'?'tap':'click']();
  if(await panel.count()&&await panel.isVisible())assert(Math.abs(await panel.evaluate(el=>el.scrollTop)-before)<2,'Ordinary activation does not rescue the layout by programmatic scrolling');
}
try{
  await verifyMinesweeperStartup(false);
  await verifyMinesweeperStartup(true);
  for(const viewport of [{width:844,height:390},{width:320,height:568}])for(const gesture of ['wheel','touch']){
    const context=await browser.newContext({viewport,hasTouch:gesture==='touch',isMobile:gesture==='touch'});
    for(const game of ['make-10','jigsaw','memory','minesweeper']){
      const page=await context.newPage(),errors=[];page.setDefaultTimeout(6000);
      page.on('pageerror',error=>errors.push({message:error.message,stack:error.stack}));page.on('dialog',dialog=>dialog.dismiss());
      const name=game+' '+viewport.width+'x'+viewport.height+' '+gesture;
      try{
        await page.goto(fixture.base+'/'+game+'/index.html');
        const panel=page.locator('#startOverlay .panel');await panel.waitFor({state:'visible'});
        if(game!=='memory')await panel.locator('[data-shared-open]').waitFor({state:'attached'});
        const initial=await panel.evaluate(el=>({top:el.scrollTop,client:el.clientHeight,scroll:el.scrollHeight,overflow:getComputedStyle(el).overflowY}));
        assert.equal(initial.overflow,'auto','The initial menu allows native vertical scrolling');
        const target=game==='memory'?panel.locator('#loadStartBtn'):panel.locator('[data-shared-open]').last();
        const bottomControl=game==='memory'?target:panel.locator('button').last();
        await reveal(page,panel,bottomControl,gesture);
        const after=await panel.evaluate(el=>el.scrollTop);
        if(viewport.width===844)assert(after>0,'Short-landscape clipped controls require a real scroll');
        await page.screenshot({path:new URL(game+'-'+viewport.width+'-'+gesture+'.png',output).pathname});
        await reveal(page,panel,target,gesture);
        if(game==='memory'){
          await page.evaluate(()=>{window.__loadClicked=false;document.getElementById('loadStartBtn').addEventListener('click',()=>{window.__loadClicked=true;},{once:true});});
          await activate(page,panel,target,gesture);assert(await page.evaluate(()=>window.__loadClicked),'Native Load button receives the click');
        }else{
          await activate(page,panel,target,gesture);await page.locator('#shared-panel').waitFor({state:'visible'});
          await page.locator('#shared-close')[gesture==='touch'?'tap':'click']();await page.locator('#shared-panel').waitFor({state:'hidden'});
        }
        const home=panel.getByRole('button',{name:/^(?:Back to Arcade|Arcade Home)$/i}).first();
        await reveal(page,panel,home,gesture);
        assert(await reachable(home),'The setup exit is reachable with native scrolling');
        await Promise.all([page.waitForURL(fixture.base+'/index.html'),home[gesture==='touch'?'tap':'click']()]);
        await page.locator('header h1').filter({hasText:/^Arcade$/}).waitFor({state:'visible'});
        assert.deepEqual(errors,[]);results.push({name,passed:true,initial,scrollTopAfterNativeInput:after});console.log('PASS '+name);
      }catch(error){results.push({name,passed:false,error:error.stack,pageErrors:errors});await page.screenshot({path:new URL(game+'-'+viewport.width+'-'+gesture+'-failure.png',output).pathname}).catch(()=>{});console.error('FAIL '+name+': '+error.message);if(errors.length)console.error(JSON.stringify(errors,null,2));}
      finally{await page.close();}
    }
    await context.close();
  }
  await writeFile(new URL('results.json',output),JSON.stringify(results,null,2)+'\n');
  assert.equal(results.filter(result=>!result.passed).length,0,'All initial menu controls and exits are reachable');
  console.log('PASS all 16 native wheel/touch menu reachability scenarios and both Minesweeper startup/resize regressions');
}finally{await browser.close();await fixture.close();}
