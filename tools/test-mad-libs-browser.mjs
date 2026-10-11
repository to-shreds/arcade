import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {chromium,browserLaunchOptions} from './browser-runtime.mjs';
const html=await readFile(new URL('../mad-libs/index.html',import.meta.url),'utf8');
const data=JSON.parse(html.match(/var DATA=(.*?);\nvar stories=/s)[1]);
const server=spawn('python3',['-m','http.server','8798','--bind','127.0.0.1'],{stdio:'ignore'});
let browser;const errors=[];const results=[];
try{
  for(let i=0;i<100;i++){try{if((await fetch('http://127.0.0.1:8798')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
  browser=await chromium.launch(browserLaunchOptions);
  for(const viewport of [{width:1440,height:900},{width:390,height:844},{width:320,height:568}]){
    const context=await browser.newContext({viewport});const page=await context.newPage();
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto('http://127.0.0.1:8798/mad-libs/');
    await page.waitForFunction(()=>!!window.MadLibsAutosave);
    for(let i=0;i<data.stories.length;i++){
      const values=data.stories[i].prompts.map((_,n)=>'Answer_'+i+'_'+n);
      await page.evaluate(({i,values})=>MadLibsAutosave.restore({storyIndex:i,values,customTitle:'Our lunch rescue',screen:'result'}),{i,values});
      const text=await page.locator('#storyOutput').innerText();
      for(const value of values)assert.ok(text.toLowerCase().includes(value.toLowerCase()),data.stories[i].title+' includes '+value);
      assert.equal(await page.locator('#storyOutput .filled-word').count(),(data.stories[i].template.match(/\{\d+\}/g)||[]).length);
      assert.ok((await page.locator('#resultTitle').innerText()).includes('Our lunch rescue'));
      await page.locator('#editWordsButton').click();
      assert.equal(await page.locator('#word_14').inputValue(),values[14]);
      assert.equal(await page.locator('label[for=word_14]').innerText(),'What they want to do');
      await page.locator('#word_14').fill('rescue our lunch');await page.locator('#makeStoryButton').click();
      assert.ok((await page.locator('#storyOutput').innerText()).includes('rescue our lunch'));
    }
    const caseValues=['Pizza','Huge','Easton','Jump','Toaster','Robots','We Found It','Red','Quickly','Cat','27','Milk','Logan','Your Uncle','Save Dinner','Asked For Help','An Extra Snack','I Want My Lunch'];
    await page.evaluate(values=>MadLibsAutosave.restore({storyIndex:0,values,screen:'result'}),caseValues);
    const caseText=await page.locator('#storyOutput').innerText();
    assert.ok(caseText.startsWith('Logan and your uncle took pizza to the huge Easton.'));
    assert.ok(caseText.includes('A red cat stole 27 robots and hid behind a toaster.'));
    assert.ok(caseText.includes('Your uncle asked for help'));
    assert.ok(caseText.includes('"I want my lunch," said Logan.'));
    assert.deepEqual((await page.evaluate(()=>MadLibsAutosave.capture())).values,caseValues);
    const robotIndex=data.stories.findIndex(story=>story.title==='The Robot Babysitter');
    await page.evaluate(i=>MadLibsAutosave.restore({storyIndex:i,values:Array(18).fill('We Found It'),screen:'result'}),robotIndex);
    assert.ok((await page.locator('#storyOutput').innerText()).includes('replied, "We found it."'));
    await page.evaluate(values=>MadLibsAutosave.restore({storyIndex:0,values,screen:'result'}),caseValues);
    await page.locator('#editWordsButton').click();
    assert.equal(await page.locator('#word_0').inputValue(),'Pizza');
    assert.equal(await page.locator('#word_0').getAttribute('autocapitalize'),'none');
    await page.evaluate(()=>MadLibsAutosave.restore({storyIndex:67,values:Array.from({length:18},(_,n)=>'Answer_67_'+n),screen:'result'}));
    await page.locator('#editWordsButton').click();
    await page.locator('#word_0').fill('<img src=x onerror="throw 1">');
    await page.locator('#word_14').fill('');
    await page.locator('.prompt-card').nth(14).locator('.idea-button').click();
    assert.ok((await page.locator('.prompt-card').nth(14).locator('.idea-chip').allTextContents()).includes(data.stories[67].prompts[14][2].ideas[0]));
    await page.locator('#fillEmptyButton').click();
    assert.equal(await page.locator('#word_0').inputValue(),'<img src=x onerror="throw 1">');
    await page.locator('#makeStoryButton').click();assert.equal(await page.locator('#storyOutput img').count(),0);
    await page.locator('#editWordsButton').click();
    await page.locator('#customStoryTitle').fill('T'.repeat(100));await page.locator('#word_0').fill('W'.repeat(120));
    await page.locator('#makeStoryButton').click();
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'long answers fit '+viewport.width);
    const saved=await page.evaluate(()=>MadLibsAutosave.capture());
    await page.evaluate(()=>ArcadeSave.saveNow());
    await page.goto('http://127.0.0.1:8798/mad-libs/?resume=1');
    await page.waitForFunction(()=>window.MadLibsAutosave?.capture().screen==='result');
    assert.deepEqual(await page.evaluate(()=>MadLibsAutosave.capture()),saved,'actual autosave reload');
    const legacy={storyIndex:0,values:Array.from({length:12},(_,n)=>'Old_'+n),screen:'words'};
    await page.evaluate(async saved=>{
      const entry={...ArcadeSave.getCurrentEntry(),version:1,data:saved};
      ArcadeSave.setExternalSession(true);
      localStorage.setItem('arcade.autosave.data.v1.mad-libs',JSON.stringify(entry));
      await new Promise((resolve,reject)=>{
        const request=indexedDB.open('arcade-autosaves',1);
        request.onsuccess=()=>{const db=request.result,tx=db.transaction('saves','readwrite');tx.objectStore('saves').put(entry);tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(tx.error);};request.onerror=()=>reject(request.error);
      });
    },legacy);
    await page.goto('http://127.0.0.1:8798/mad-libs/?resume=1');
    await page.waitForFunction(()=>window.MadLibsAutosave?.capture().screen==='words'&&document.getElementById('word_0')?.value==='Old_0');
    for(let n=0;n<12;n++)assert.equal(await page.locator('#word_'+n).inputValue(),'Old_'+n);
    assert.equal(await page.locator('#word_12').inputValue(),'');
    assert.equal(await page.locator('#customStoryTitle').inputValue(),'');
    await page.evaluate(()=>MadLibsAutosave.startFresh());assert.equal(await page.locator('#customStoryTitle').inputValue(),'');
    results.push({viewport,stories:68,status:'passed',checks:['all answers','change words','contextual ideas','fill empty','safe rendering','long text fit','actual save reload','legacy answers']});
    await context.close();console.log('PASS Mad Libs '+viewport.width+'x'+viewport.height+' all 68 stories');
  }
  assert.deepEqual(errors,[]);
  await mkdir('test-results/mad-libs',{recursive:true});await writeFile('test-results/mad-libs/report.json',JSON.stringify({results,errors},null,2));
}finally{await browser?.close();server.kill();}
