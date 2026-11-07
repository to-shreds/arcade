import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { gunzipSync } from 'node:zlib';
import { chromium, browserLaunchOptions } from './browser-runtime.mjs';
import { startStaticFixture } from './static-fixture.mjs';

const fixture=await startStaticFixture();
const viewports=[{width:1440,height:900},{width:390,height:844},{width:320,height:568},{width:844,height:390}];
const errors=[];
let browser;
let roomServer;

async function open(viewport=viewports[0],mode='modern',base=fixture.base){
  const page=await browser.newPage({viewport});
  page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(mode=>{
    window.ARCADE_WORKER_BASE='http://127.0.0.1:8788';
    window.__typingCopy={modern:[],fallback:[],mode};
    Object.defineProperty(navigator,'clipboard',{configurable:true,value:mode==='absent'?undefined:{writeText:async value=>{
      __typingCopy.modern.push(value);
      if(__typingCopy.mode!=='modern')throw new DOMException('Clipboard access denied','NotAllowedError');
    }}});
    document.execCommand=command=>{
      if(command!=='copy')return false;
      const field=document.activeElement;
      const copied=field&&'value'in field?field.value.slice(field.selectionStart,field.selectionEnd):window.getSelection()?.toString();
      __typingCopy.fallback.push(copied);
      return __typingCopy.mode!=='blocked';
    };
  },mode);
  await page.goto(base+'/typing/');
  await page.waitForFunction(()=>!!window.TypingAutosave&&!!window.ArcadeSharedActivity);
  return page;
}
async function state(page){return page.evaluate(()=>TypingAutosave.capture());}
async function restore(page,text,cursor=text.length){
  await page.evaluate(({text,cursor})=>TypingAutosave.restore({text,cursor,caps:false,symbols:false}),{text,cursor});
}
async function selectRange(page,start,end){
  await page.locator('#editor').focus();
  await page.evaluate(({start,end})=>{
    const editor=document.getElementById('editor');
    function point(offset){
      const walker=document.createTreeWalker(editor,NodeFilter.SHOW_TEXT);
      let node,last=null;
      while(node=walker.nextNode()){
        last=node;
        if(offset<=node.data.length)return[node,offset];
        offset-=node.data.length;
      }
      return last?[last,last.data.length]:[editor,0];
    }
    const range=document.createRange();range.setStart(...point(start));range.setEnd(...point(end));
    const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  },{start,end});
}
async function inside(page,selector){
  const box=await page.locator(selector).boundingBox(),viewport=page.viewportSize();
  assert(box&&box.width>0&&box.height>0,selector+' is visible');
  assert(box.x>=-1&&box.y>=-1&&box.x+box.width<=viewport.width+1&&box.y+box.height<=viewport.height+1,selector+' stays in the viewport');
}

try{
  browser=await chromium.launch(browserLaunchOptions);
  await mkdir('test-results/typing-tools',{recursive:true});
  for(const viewport of viewports){
    const page=await open(viewport);
    const text='Logan ❤️\nScarlett 🦄';
    await restore(page,text,2);
    const original=await state(page);
    for(const family of ['system','rounded','serif','mono']){
      await page.locator('#font-family').selectOption(family);
      assert.equal(await page.locator('#font-family').inputValue(),family);
      assert.deepEqual(await state(page),original,'Changing the local font never changes text, cursor, caps or symbols');
    }
    for(const size of ['24','32','40','56','72','auto']){
      await page.locator('#font-size').selectOption(size);
      if(size!=='auto')assert.equal(await page.locator('#editor').evaluate(editor=>getComputedStyle(editor).fontSize),size+'px');
      assert.deepEqual(await state(page),original,'Changing font size preserves the exact document state');
    }
    for(const selector of ['#font-family','#font-size','#select-all','#copy-text','#editor','.keyboard'])await inside(page,selector);
    await page.locator('#select-all').click();
    assert.equal(await page.evaluate(()=>window.getSelection().toString()),text,'Select All selects only the typing text, including line breaks and emoji');
    await page.locator('#copy-text').click();
    assert.equal((await page.evaluate(()=>__typingCopy.modern)).at(-1),text);
    assert.match(await page.locator('#typing-tool-status').textContent(),/copied/i);
    assert.deepEqual(await state(page),original,'Select and Copy preserve the saved cursor');
    const start=text.indexOf('Scarlett');
    await selectRange(page,start,start+'Scarlett'.length);
    await page.locator('#font-family').selectOption('serif');
    await page.locator('#font-size').selectOption('40');
    await page.locator('#copy-text').click();
    assert.equal((await page.evaluate(()=>__typingCopy.modern)).at(-1),'Scarlett','Formatting and toolbar focus preserve a partial selection for Copy');
    assert.deepEqual(await state(page),original);
    await page.evaluate(saved=>{TypingAutosave.restore(saved);TypingAutosave.restore(saved);},original);
    await page.locator('#copy-text').click();
    assert.equal((await page.evaluate(()=>__typingCopy.modern)).at(-1),'Scarlett','Repeated identical restores preserve the local partial selection');
    await page.screenshot({path:`test-results/typing-tools/${viewport.width}x${viewport.height}.png`});
    await page.evaluate(()=>ArcadeSave.saveNow());
    await page.goto(fixture.base+'/typing/?resume=1');
    await page.waitForFunction(expected=>TypingAutosave.capture().text===expected,text);
    assert.deepEqual(await state(page),original,'Reload restores the exact text and cursor');
    assert.equal(await page.locator('#font-family').inputValue(),'serif','Font preference survives a local reload');
    assert.equal(await page.locator('#font-size').inputValue(),'40','Size preference survives a local reload');
    await page.close();
  }

  const editing=await open();
  await restore(editing,'One ❤️ two 🦄',3);
  await editing.locator('#editor').focus();
  await editing.keyboard.press('Control+a');
  assert.equal(await editing.evaluate(()=>window.getSelection().toString()),'One ❤️ two 🦄','Ctrl+A in the editor excludes all tool labels');
  await editing.keyboard.press('Control+c');
  assert.equal((await editing.evaluate(()=>__typingCopy.modern)).at(-1),'One ❤️ two 🦄','Ctrl+C copies the editor selection');
  await editing.locator('[data-key="a"]').click();
  assert.equal((await state(editing)).text,'a','The on-screen keyboard replaces selected text');
  await restore(editing,'abcdef',4);
  await editing.locator('#editor').focus();
  for(const expected of ['d','cd','bcd']){
    await editing.keyboard.press('Shift+ArrowLeft');
    assert.equal(await editing.evaluate(()=>window.getSelection().toString()),expected,'Repeated Shift+Left extends the selection');
  }
  for(const expected of ['cd','d','']){
    await editing.keyboard.press('Shift+ArrowRight');
    assert.equal(await editing.evaluate(()=>window.getSelection().toString()),expected,'Shift+Right reverses and then collapses the selection');
  }
  await editing.keyboard.press('Shift+Home');
  assert.equal(await editing.evaluate(()=>window.getSelection().toString()),'abcd','Shift+Home selects back to the document start');
  await editing.keyboard.press('Shift+End');
  assert.equal(await editing.evaluate(()=>window.getSelection().toString()),'ef','Shift+End can extend past the selection anchor');
  await editing.keyboard.press('ArrowRight');
  assert.equal(await editing.evaluate(()=>window.getSelection().toString()),'','An unmodified arrow collapses the selection');
  assert.equal((await state(editing)).cursor,6);
  await restore(editing,'abcdef',3);
  await editing.locator('#editor').focus();
  await editing.keyboard.press('Shift+ArrowLeft');await editing.keyboard.press('Shift+ArrowLeft');
  assert.equal(await editing.evaluate(()=>window.getSelection().toString()),'bc','Shift+arrow keys extend an editor selection from the saved cursor');
  await editing.keyboard.type('Z');
  assert.equal((await state(editing)).text,'aZdef','Physical typing replaces a keyboard-selected range');
  await restore(editing,'abcdef',6);
  await editing.locator('#font-family').selectOption('mono');await editing.locator('#font-size').selectOption('40');
  const drag=await editing.locator('#editor').evaluate(editor=>{
    const range=document.createRange();range.setStart(editor.firstChild,1);range.setEnd(editor.firstChild,4);
    const box=range.getBoundingClientRect();return{x:box.x,y:box.y,width:box.width,height:box.height};
  });
  await editing.mouse.move(drag.x+0.2,drag.y+drag.height/2);await editing.mouse.down();
  await editing.mouse.move(drag.x+drag.width-0.2,drag.y+drag.height/2,{steps:10});await editing.mouse.up();
  assert.equal(await editing.evaluate(()=>window.getSelection().toString()),'bcd','An actual mouse drag selects a partial editor range');
  await editing.locator('#copy-text').click();
  assert.equal((await editing.evaluate(()=>__typingCopy.modern)).at(-1),'bcd','Copy uses a mouse-selected range');
  await restore(editing,'A❤️B',4);
  await editing.locator('#editor').focus();await editing.keyboard.press('ArrowLeft');await editing.keyboard.press('Backspace');
  assert.equal((await state(editing)).text,'AB','The original physical keyboard still removes the complete emoji grapheme');
  await restore(editing,'compose safely',7);
  const composingBefore=await state(editing);
  await editing.locator('#editor').dispatchEvent('keydown',{key:'x',code:'KeyX',isComposing:true,bubbles:true});
  assert.deepEqual(await state(editing),composingBefore,'Composition key events are not turned into duplicate literal characters');
  await selectRange(editing,0,'compose'.length);
  await editing.evaluate(()=>{
    const editor=document.getElementById('editor');window.getSelection().collapse(editor.firstChild,0);
    document.dispatchEvent(new Event('selectionchange'));
  });
  await editing.locator('#copy-text').click();
  assert.equal((await editing.evaluate(()=>__typingCopy.modern)).at(-1),'compose safely','Copy copies all text after a native editor selection is deliberately collapsed');
  const beforeToolbarKeys=await editing.evaluate(()=>__typingCopy.modern.length);
  await editing.locator('#font-family').focus();
  await editing.keyboard.press('Control+a');await editing.keyboard.press('Control+c');
  assert.equal(await editing.evaluate(()=>__typingCopy.modern.length),beforeToolbarKeys,'Editor shortcuts do not hijack native font controls');
  const beforeObserver=await state(editing);
  await editing.evaluate(()=>{window.ArcadeSharedActivity={isSpectator:()=>true};});
  await editing.locator('#font-family').selectOption('mono');
  await editing.locator('#font-size').selectOption('56');
  await editing.locator('#select-all').click();await editing.locator('#copy-text').click();
  assert.deepEqual(await state(editing),beforeObserver,'An observer can format, select and copy without changing game state');
  const localControls=await editing.locator('#font-family').evaluate(element=>element.closest('[data-shared-ui]')?.contains(document.getElementById('copy-text')));
  assert.equal(localControls,true,'Font and clipboard tools are marked as local UI for the actual shared input guard');
  await editing.close();

  for(const mode of ['fallback','absent','blocked']){
    const page=await open(viewports[2],mode);
    const text='Copy a piece ❤️\nMore text 🦄';
    await restore(page,text,4);
    const before=await state(page);
    const start=text.indexOf('piece');
    await selectRange(page,start,start+'piece ❤️'.length);
    await page.locator('#copy-text').click();
    assert.equal((await page.evaluate(()=>__typingCopy.fallback)).at(-1),'piece ❤️','Clipboard fallback receives only the selection');
    assert.deepEqual(await state(page),before,'Clipboard fallback never changes the text or saved cursor');
    assert.equal(await page.locator('textarea').count(),0,'The temporary fallback field is removed');
    if(mode==='blocked')assert.match(await page.locator('#typing-tool-status').textContent(),/could not|unable|not available|blocked|didn.t|failed/i,'Failure is visible and never reported as copied');
    else assert.match(await page.locator('#typing-tool-status').textContent(),/copied/i);
    await page.close();
  }
  if(process.env.ARCADE_TYPING_SKIP_ROOM!=='1'){
  roomServer=spawn(process.execPath,['guess-who/test-server.mjs'],{stdio:['ignore','pipe','pipe']});
  let serverErrors='';roomServer.stderr.on('data',data=>serverErrors+=data);
  await new Promise((accept,reject)=>{
    const timer=setTimeout(()=>reject(new Error('Shared test server did not start: '+serverErrors)),30000);
    roomServer.stdout.on('data',data=>{if(String(data).includes('test site')){clearTimeout(timer);accept();}});
    roomServer.on('exit',code=>{clearTimeout(timer);reject(new Error('Shared test server exited '+code+': '+serverErrors));});
  });
  const host=await open(viewports[0],'modern','http://127.0.0.1:8787');
  const guest=await open(viewports[2],'modern','http://127.0.0.1:8787');
  await restore(host,'Shared typing ❤️',4);
  await restore(guest,'Private local text 🦄',3);
  const local=await state(guest);
  const room=await host.evaluate(()=>ArcadeSharedActivity.create({username:'Typing host'}));
  await guest.evaluate(code=>ArcadeSharedActivity.join({username:'Typing observer',code}),room.code);
  await guest.waitForFunction(()=>ArcadeSharedActivity.isSpectator()&&TypingAutosave.capture().text==='Shared typing ❤️');
  const hostState=await state(host),guestState=await state(guest);
  await guest.locator('#font-family').selectOption('serif');
  await guest.locator('#font-size').selectOption('24');
  await guest.locator('#select-all').click();await guest.locator('#copy-text').click();
  assert.equal((await guest.evaluate(()=>__typingCopy.modern)).at(-1),hostState.text,'An actual observer can copy shared text');
  await guest.evaluate(()=>{__typingCopy.mode='fallback';});
  await guest.locator('#copy-text').click();
  assert.equal((await guest.evaluate(()=>__typingCopy.fallback)).at(-1),hostState.text,'The clipboard fallback also works for an actual observer');
  await guest.locator('#editor').focus();await guest.keyboard.type('blocked');
  await guest.locator('[data-key="a"]').click();
  assert.deepEqual(await state(guest),guestState,'The actual shared input guard blocks observer text edits while allowing local tools');
  assert.deepEqual(await state(host),hostState,'Observer tools cannot change the host document or cursor');
  const wire=await host.evaluate(()=>ArcadeSharedActivity.getState().room.state);
  const payload=JSON.parse(wire.codec==='gzip'?gunzipSync(Buffer.from(wire.data,'base64')).toString():wire.data);
  assert.equal(payload.view.some(item=>['font-family','font-size','select-all','copy-text','typing-tool-status'].includes(item.id)),false,'Local text tools stay out of shared checkpoints');
  await guest.evaluate(()=>ArcadeSharedActivity.leave());
  assert.deepEqual(await state(guest),local,'Leaving shared play restores the exact private text and cursor');
  assert.equal(await guest.locator('#font-family').inputValue(),'serif','Leaving a room keeps the observer font choice local');
  await guest.evaluate(()=>ArcadeSave.saveNow());
  await guest.goto('http://127.0.0.1:8787/typing/?resume=1');
  await guest.waitForFunction(expected=>TypingAutosave.capture().text===expected,local.text);
  assert.deepEqual(await state(guest),local,'The restored private document survives a reload after leaving');
  assert.equal(await guest.locator('#font-family').inputValue(),'serif','A font selected in shared play is persisted after leaving');
  assert.equal(await guest.locator('#font-size').inputValue(),'24','A size selected in shared play is persisted after leaving');
  await guest.close();await host.close();
  }
  assert.deepEqual(errors,[],'Typing tools produce no JavaScript errors');
  console.log('Typing tools passed: four screen sizes, font/size preferences, partial and full selection, Ctrl+A/C, modern/fallback/denied clipboard, save/reload cursor, emoji editing and composition exclusions. '+(process.env.ARCADE_TYPING_SKIP_ROOM==='1'?'Actual peer check skipped for this run.':'Actual shared observer tools passed.'));
}finally{await browser?.close();await fixture.close();roomServer?.kill('SIGTERM');}
