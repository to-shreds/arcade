import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {chromium,browserLaunchOptions} from './browser-runtime.mjs';
import {startStaticFixture} from './static-fixture.mjs';
const fixture=await startStaticFixture(),browser=await chromium.launch(browserLaunchOptions);
const catalog=JSON.parse(await readFile(new URL('../catalog.json',import.meta.url),'utf8'));
const shared=[];
for(const item of catalog.items.filter(item=>item.enabled&&!item.warning)){
  if((await readFile(new URL('../'+item.launchPath,import.meta.url),'utf8')).includes('shared-activity.js'))shared.push(item);
}
const output=new URL(process.env.ARCADE_MENU_NATIVE_ONLY==='1'?'../test-results/menu-home-native/':'../test-results/menu-home/',import.meta.url);await mkdir(output,{recursive:true});
const results=[],errors=[];
try{
  for(const viewport of [{width:1440,height:900},{width:390,height:844},{width:320,height:568},{width:844,height:390}]){
    const context=await browser.newContext({viewport,hasTouch:viewport.width<500}),gesture=viewport.width<500?'tap':'click';
    for(const item of process.env.ARCADE_MENU_NATIVE_ONLY==='1'?[]:shared){
      const page=await context.newPage();page.setDefaultTimeout(6000);
      page.on('pageerror',error=>errors.push(item.folder+': '+error.message));
      const name=`${item.folder} Home ${viewport.width}x${viewport.height}`;
      try{
        await page.goto(fixture.base+'/'+item.folder+'/');
        await page.locator('#shared-launch').waitFor({state:'attached'});
        let home=page.locator('[data-shared-menu-content]:visible button,[data-shared-menu-content]:visible a').filter({hasText:/back to arcade|arcade home/i}).first();
        if(!await home.count()){
          await page.locator('[data-shared-menu-toggle]:visible').first()[gesture]();
          home=page.locator('#shared-menu-home:visible,[data-shared-menu-content]:visible button,[data-shared-menu-content]:visible a').filter({hasText:/back to arcade|arcade home/i}).first();
        }
        await home.scrollIntoViewIfNeeded();
        await home[gesture]();
        await page.waitForURL(fixture.base+'/index.html');
        results.push({name,pass:true});console.log('PASS '+name);
      }catch(error){
        await page.screenshot({path:new URL(item.folder+'-'+viewport.width+'-failure.png',output).pathname}).catch(()=>{});
        results.push({name,pass:false,error:error.stack});console.error('FAIL '+name+': '+error.message);
      }finally{await page.close();}
    }
    for(const [game,selector] of [['chess','#setupHome'],['chat-room','#startHomeBtn'],['checkers','[onclick="goToMenu()"]'],['tic-tac-toe','[onclick="goToMenu()"]']]){
      const nativePage=await context.newPage();nativePage.setDefaultTimeout(6000);const name=`${game} setup Home ${viewport.width}x${viewport.height}`;
      nativePage.on('pageerror',error=>errors.push(game+': '+error.message));
      try{
        await nativePage.goto(fixture.base+'/'+game+'/');
        const home=nativePage.locator(selector).filter({hasText:'Back to Arcade'}).first();
        await home.scrollIntoViewIfNeeded();await home[gesture]();await nativePage.waitForURL(fixture.base+'/index.html');
        results.push({name,pass:true});console.log('PASS '+name);
      }catch(error){results.push({name,pass:false,error:error.stack});console.error('FAIL '+name+': '+error.message);await nativePage.screenshot({path:new URL(game+'-'+viewport.width+'-failure.png',output).pathname}).catch(()=>{});}
      finally{await nativePage.close();}
    }
    const page=await context.newPage();page.setDefaultTimeout(6000);const name=`Dots pause/Home ${viewport.width}x${viewport.height}`;
    page.on('pageerror',error=>errors.push('dots: '+error.message));
    try{
      await page.goto(fixture.base+'/dots/');
      await page.locator('[onclick="DotsGame.startGame(5,5)"]')[gesture]();
      const before=await page.evaluate(()=>{DotsGame.saveGame();return localStorage.getItem('arcade_dots_save_v1');});
      await page.locator('#dotsMenuButton')[gesture]();
      await page.locator('#dotsPauseMenu').waitFor({state:'visible'});
      await page.screenshot({path:new URL('dots-'+viewport.width+'-menu.png',output).pathname});
      await page.locator('#dotsPauseResume')[gesture]();
      assert.equal(await page.locator('#dotsPauseMenu').isVisible(),false);
      assert.equal(await page.evaluate(()=>{DotsGame.saveGame();return localStorage.getItem('arcade_dots_save_v1');}),before);
      await page.locator('#dotsMenuButton')[gesture]();await page.locator('#dotsPauseHome')[gesture]();
      await page.waitForURL(fixture.base+'/index.html');
      await page.goto(fixture.base+'/dots/');await page.locator('.dots-menu-home')[gesture]();await page.waitForURL(fixture.base+'/index.html');
      results.push({name,pass:true});console.log('PASS '+name);
    }catch(error){results.push({name,pass:false,error:error.stack});console.error('FAIL '+name+': '+error.message);await page.screenshot({path:new URL('dots-'+viewport.width+'-failure.png',output).pathname}).catch(()=>{});}
    finally{await page.close();}
    await context.close();
  }
}finally{
  await writeFile(new URL('report.json',output),JSON.stringify({results,errors},null,2));await browser.close();await fixture.close();
}
assert.deepEqual(errors,[],'No page errors during menu/Home navigation');
assert.equal(results.filter(result=>!result.pass).length,0,'Every menu/Home path passes');
console.log(`Passed ${results.length} actual menu/Home scenarios.`);
