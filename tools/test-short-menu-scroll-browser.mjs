// Menus must scroll with actual user input. Programmatic scrollIntoView can
// move an overflow:hidden panel and would conceal these regressions.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium,browserLaunchOptions} from './browser-runtime.mjs';
import {startStaticFixture} from './static-fixture.mjs';

const fixture=await startStaticFixture(),output=new URL('../test-results/short-menu-scroll/',import.meta.url);
await mkdir(output,{recursive:true});
const browser=await chromium.launch(browserLaunchOptions),results=[];
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
  for(const viewport of [{width:844,height:390},{width:320,height:568}])for(const gesture of ['wheel','touch']){
    const context=await browser.newContext({viewport,hasTouch:gesture==='touch',isMobile:gesture==='touch'});
    for(const game of ['make-10','jigsaw','memory','minesweeper']){
      const page=await context.newPage(),errors=[];page.setDefaultTimeout(6000);
      page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.dismiss());
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
      }catch(error){results.push({name,passed:false,error:error.stack});await page.screenshot({path:new URL(game+'-'+viewport.width+'-'+gesture+'-failure.png',output).pathname}).catch(()=>{});console.error('FAIL '+name+': '+error.message);}
      finally{await page.close();}
    }
    await context.close();
  }
  await writeFile(new URL('results.json',output),JSON.stringify(results,null,2)+'\n');
  assert.equal(results.filter(result=>!result.passed).length,0,'All initial menu controls and exits are reachable');
  console.log('PASS all '+results.length+' native wheel/touch menu reachability scenarios');
}finally{await browser.close();await fixture.close();}
