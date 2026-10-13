import assert from 'node:assert/strict';
import {chromium,browserLaunchOptions} from './browser-runtime.mjs';
import {startStaticFixture} from './static-fixture.mjs';
const fixture=await startStaticFixture();
const browser=await chromium.launch({...browserLaunchOptions,args:[...browserLaunchOptions.args,'--disable-gpu']});
const errors=[];
async function setup(context,game='paint-lab'){
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(fixture.base+'/'+game+'/');await page.locator('#shared-launch').waitFor();return page;
}
async function bounds(page){return page.locator('#shared-launch').boundingBox();}
async function drag(page,x,y){const b=await bounds(page);await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down();await page.mouse.move(x,y,{steps:12});await page.mouse.up();}
async function contained(page){const b=await bounds(page),v=page.viewportSize();assert.ok(b.x>=0&&b.y>=0&&b.x+b.width<=v.width&&b.y+b.height<=v.height,JSON.stringify({b,v}));}

// setViewportSize resolves before the page's resize handlers necessarily run.
// Verify the saved normalized position, not merely old coordinates still in bounds.
async function resizeAndSettle(page,viewport){
 await page.setViewportSize(viewport);
 await page.waitForFunction(({width,height})=>{
  if(innerWidth!==width||innerHeight!==height)return false;
  const el=document.getElementById('shared-launch'),v=visualViewport;
  const saved=JSON.parse(localStorage.getItem('arcade.shared.launchPosition.paint-lab.v1'));
  if(!el||!saved)return false;
  const r=el.getBoundingClientRect(),left=(v?.offsetLeft||0)+8,top=(v?.offsetTop||0)+8;
  const right=Math.max(left,(v?.offsetLeft||0)+(v?.width||innerWidth)-el.offsetWidth-8);
  const bottom=Math.max(top,(v?.offsetTop||0)+(v?.height||innerHeight)-el.offsetHeight-8);
  return Math.abs(r.x-(left+saved.x*(right-left)))<.1&&Math.abs(r.y-(top+saved.y*(bottom-top)))<.1;
 },viewport,{timeout:5000});
 await contained(page);
}
try{
 const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true});const page=await setup(context);
 await page.locator('#shared-launch').tap();await page.locator('#shared-panel').waitFor({state:'visible'});await page.locator('#shared-close').click();
 await drag(page,140,140);let b=await bounds(page);assert.ok(Math.abs(b.x-120)<2&&Math.abs(b.y-120)<2);assert.equal(await page.locator('#shared-panel').isVisible(),false,'Dragging must not open multiplayer');
 await page.waitForTimeout(1750);assert.deepEqual(await bounds(page),b,'Auto placement cannot undo the drag');
 await page.evaluate(()=>document.body.append(document.createElement('button')));await page.waitForTimeout(100);assert.deepEqual(await bounds(page),b,'Activity changes cannot undo placement');
 await page.reload();await page.locator('#shared-launch').waitFor();assert.deepEqual(await bounds(page),b,'Reload restores position');
 await resizeAndSettle(page,{width:844,height:390});await resizeAndSettle(page,{width:320,height:568});
 await drag(page,-200,-100);await contained(page);b=await bounds(page);assert.equal(b.x,8);assert.equal(b.y,8);
 await page.locator('#shared-launch').focus();await page.keyboard.press('ArrowRight');assert.equal((await bounds(page)).x,20);
 await page.keyboard.press('Enter');await page.locator('#shared-panel').waitFor({state:'visible'});await page.locator('#shared-close').click();
 const before=await bounds(page);
 // Actual touchscreen input exercises the browser's touch gesture and capture.
 const touch=await context.newCDPSession(page),tb=await bounds(page);
 await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:tb.x+20,y:tb.y+20,id:1}]});
 for(let i=1;i<=12;i++)await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:tb.x+20+(220-tb.x-20)*i/12,y:tb.y+20+(250-tb.y-20)*i/12,id:1}]});
 await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await touch.detach();
 assert.equal(await page.locator('#shared-panel').isVisible(),false);assert.notDeepEqual(await bounds(page),before);
 const saved=await page.evaluate(()=>localStorage.getItem('arcade.shared.launchPosition.paint-lab.v1'));
 await page.locator('#shared-launch').evaluate(el=>{const r=el.getBoundingClientRect();el.dispatchEvent(new PointerEvent('pointerdown',{pointerId:14,pointerType:'touch',isPrimary:true,clientX:r.x+20,clientY:r.y+20,bubbles:true}));el.dispatchEvent(new PointerEvent('pointermove',{pointerId:14,pointerType:'touch',isPrimary:true,clientX:70,clientY:80,bubbles:true,cancelable:true}));el.dispatchEvent(new PointerEvent('pointercancel',{pointerId:14,pointerType:'touch',isPrimary:true,bubbles:true}));});
 assert.equal(await page.evaluate(()=>localStorage.getItem('arcade.shared.launchPosition.paint-lab.v1')),saved,'Cancellation does not overwrite position');
 const other=await setup(context,'mad-libs');await drag(other,90,100);await contained(other);assert.equal(await other.evaluate(()=>localStorage.getItem('arcade.shared.launchPosition.paint-lab.v1')),saved,'Each activity retains its own position');
 await context.close();
 const blocked=await browser.newContext({viewport:{width:390,height:844}});await blocked.addInitScript(()=>{Storage.prototype.getItem=function(){throw Error('storage blocked')};Storage.prototype.setItem=function(){throw Error('storage blocked')};});const fallback=await setup(blocked);await drag(fallback,130,130);await contained(fallback);await fallback.waitForTimeout(1600);assert.equal(Math.round((await bounds(fallback)).x),110,'Blocked storage still retains the drag this session');await blocked.close();
 assert.deepEqual(errors,[]);console.log('PASS globe: click/tap, mouse/touch drag, no drag activation, timer/mutation persistence, reload, rotation/resize, bounds, keyboard, cancellation, activity isolation and blocked storage.');
}finally{await browser.close();await fixture.close();}
