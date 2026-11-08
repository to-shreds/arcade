import assert from 'node:assert/strict';
import {chromium,browserLaunchOptions} from './browser-runtime.mjs';
import {startStaticFixture} from './static-fixture.mjs';
import {createTrolleySession,getCurrentScenario,chooseTrolley,nextTrolley} from '../train-trouble/trolley.mjs';
const fixture=await startStaticFixture(),browser=await chromium.launch(browserLaunchOptions),errors=[];
let decisions=0;
try{
 const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true});page.on('pageerror',e=>errors.push(e.message));
 await page.goto(fixture.base+'/train-trouble/');await page.waitForFunction(()=>!!window.TrainTrouble);
 const initial=await page.evaluate(()=>TrainTrouble.capture());
 let session=createTrolleySession(1);
 for(let index=0;index<36;index++){
  const scene=getCurrentScenario(session);
  for(let i=0;i<scene.options.length;i++){
   const state={...structuredClone(initial),mode:'trolley',view:'trolley',trolley:session};
   assert(await page.evaluate(s=>TrainTrouble.restore(s),state));
   assert.equal(await page.locator('[data-choice]').count(),scene.options.length);
   assert.equal(await page.locator('#trolleyChoices [data-choice="main"],#trolleyChoices [data-choice="side"]').count(),0);
   const option=scene.options[i],button=page.locator('#trolley-choice-'+i);
   assert.equal(await button.evaluate(b=>b.parentElement.id),['main','side'].includes(option.id)?'trolleyTracks':'trolleyChoices');
   if(decisions%2){await button.focus();await page.keyboard.press('Enter');}else await button.tap();
   assert.deepEqual(await page.evaluate(()=>TrainTrouble.capture().trolley),chooseTrolley(session,option.id));
   assert.equal(await page.locator('[data-choice]').count(),0);
   decisions++;
  }
  if(index<35)session=nextTrolley(chooseTrolley(session,scene.options[0].id));
 }
 const state={...structuredClone(initial),mode:'trolley',view:'trolley',trolley:createTrolleySession(1)};
 await page.evaluate(s=>TrainTrouble.restore(s,{spectator:true,online:true,controller:false}),state);
 await page.locator('#trolley-choice-0').dispatchEvent('click');assert.deepEqual(await page.evaluate(()=>TrainTrouble.capture().trolley),state.trolley);
 await page.evaluate(s=>TrainTrouble.restore(s,{controller:true}),state);
 for(const viewport of [{width:320,height:568},{width:390,height:844},{width:844,height:390},{width:1280,height:800}]){
  await page.setViewportSize(viewport);const button=page.locator('#trolley-choice-1');await button.scrollIntoViewIfNeeded();const box=await button.boundingBox();assert(box.width>=44&&box.x>=0&&box.x+box.width<=viewport.width+1);
 }
 assert.deepEqual(errors,[]);console.log(`PASS all36 scenarios, ${decisions} tap/keyboard choices, extra actions, observer gate and4 layouts.`);
}finally{await browser.close();await fixture.close();}
