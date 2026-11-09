#!/usr/bin/env node
// Retro Vault regression: actual Chromium, all 26 modes, responsive geometry,
// persistence and browser Gamepad API event semantics.
import assert from 'node:assert/strict';
import {chromium,browserLaunchOptions} from './browser-runtime.mjs';
import {startStaticFixture} from './static-fixture.mjs';

const fixture=await startStaticFixture();
const browser=await chromium.launch(browserLaunchOptions);
const errors=[];
try {
  for(const viewport of [{width:1440,height:900},{width:390,height:844},{width:320,height:568},{width:844,height:390}]) {
    const context=await browser.newContext({viewport,hasTouch:viewport.width<500});
    const page=await context.newPage();
    page.on('pageerror',e=>errors.push({viewport,message:e.message}));
    await page.goto(fixture.base+'/retro-vault/');
    await page.waitForFunction(()=>document.querySelectorAll('button.tile').length===26);
    const result=await page.evaluate(()=>{
      let out=[];for(const g of games){
        openGame(g.id,true);
        if(current.id!==g.id||!s)throw new Error('Incorrect game: '+g.id);
        for(const c of ['left','right','up','down','a','b']){command(c);if(s.over)break;}
        for(let i=0;i<40&&!s.over;i++)stepGame(.016);
        draw();const b=document.querySelector('#board').getBoundingClientRect();
        out.push({id:g.id,canvasWidth:b.width,canvasHeight:b.height});showVault();
      }return out;
    });
    assert.equal(result.length,26);
    assert(result.every(v=>v.canvasWidth>125&&v.canvasHeight>100), 'All games fit viewport '+JSON.stringify(viewport));
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'No horizontal scrolling');
    await context.close();
    console.log('PASS Retro Vault 26 games '+viewport.width+'x'+viewport.height);
  }
  const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true});
  const page=await context.newPage();page.on('pageerror',e=>errors.push({viewport:'input',message:e.message}));
  await page.goto(fixture.base+'/retro-vault/');
  await page.locator('button.tile[data-game="snake"]').click();
  await page.keyboard.press('ArrowDown');assert.equal(await page.evaluate(()=>s.d.next),'down');
  await page.locator('#gameMenu').click();assert(await page.locator('#menu').isVisible());
  await page.locator('#resume').click();assert(await page.locator('#menu').isHidden());
  await page.locator('#toVault').click();
  for(const id of await page.evaluate(()=>games.map(g=>g.id))){
    const state=await page.evaluate(id=>{
      openGame(id,true);s.score=42;s.level=3;saveGame();showVault();openGame(id);
      const value={score:s.score,level:s.level,extra:document.querySelector('#extra').childElementCount};
      showVault();return value;
    },id);
    assert.equal(state.score,42,`${id} restore score`);assert.equal(state.level,3,`${id} restore level`);
    if(id==='sudoku')assert.equal(state.extra,9,'Sudoku number controls survive restore');
    if(id==='flood')assert.equal(state.extra,6,'Flood color controls survive restore');
  }
  await page.evaluate(()=>{openGame('merge',true);s.d.grid=[0,2,...Array(14).fill(0)];s.d.moves=0;});
  const b=await page.locator('#board').boundingBox();
  await page.evaluate(({x,y})=>{
    const node=document.querySelector('#board');
    node.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:10,pointerType:'touch',clientX:x+100,clientY:y+60}));
    node.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:10,pointerType:'touch',clientX:x+20,clientY:y+60}));
  },{x:b.x,y:b.y});
  assert.equal(await page.evaluate(()=>s.d.moves),1,'Touch swipe moves the 2048 board');
  const gamepad=await page.evaluate(()=>{
    cancelAnimationFrame(raf);showVault();const p={id:'Mock Bluetooth controller',axes:[0,0],buttons:Array.from({length:16},()=>({pressed:false,value:0}))};
    Object.defineProperty(navigator,'getGamepads',{configurable:true,value:()=>[p]});lastPad=[];lastAxis='';
    p.axes=[0,1];readPad(1000);const selected=document.activeElement?.dataset.game;
    p.axes=[0,0];p.buttons[0].pressed=true;p.buttons[0].value=1;readPad(1050);
    const launched=current?.id===selected;
    p.buttons[0].pressed=false;p.buttons[0].value=0;readPad(1100);
    p.buttons[9].pressed=true;p.buttons[9].value=1;readPad(1150);const pausedState=paused&& !document.querySelector('#menu').hidden;
    p.buttons[9].pressed=false;p.buttons[9].value=0;readPad(1200);
    p.buttons[9].pressed=true;p.buttons[9].value=1;readPad(1250);const resumed=!paused&&document.querySelector('#menu').hidden;
    s.d.padFire=true;s.d.padDir='right';Object.defineProperty(navigator,'getGamepads',{configurable:true,value:()=>[]});readPad(1300);
    return {selected,launched,pausedState,resumed,disconnected:!s.d.padFire&&!s.d.padDir};
  });
  assert(gamepad.selected&&gamepad.launched&&gamepad.pausedState&&gamepad.resumed&&gamepad.disconnected,JSON.stringify(gamepad));
  await page.locator('#toVault').click();await page.locator('[data-category="Puzzle"]').click();assert.equal(await page.locator('button.tile').count(),12);
  await page.locator('#search').fill('sudoku');assert.equal(await page.locator('button.tile').count(),1);
  await page.locator('[data-category="Action"]').click();assert.equal(await page.locator('button.tile').count(),0);
  assert.deepEqual(errors,[],'No browser JavaScript errors');
  console.log('PASS Retro Vault 26 saved games, keyboard, touch swipe, gamepad, resume, filters');
  await context.close();
} finally {await browser.close();await fixture.close();}
