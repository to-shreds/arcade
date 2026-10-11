import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {chromium,browserLaunchOptions} from './browser-runtime.mjs';
const html=await readFile(new URL('../mad-libs/index.html',import.meta.url),'utf8');
const data=JSON.parse(html.match(/var DATA=(.*?);\nvar stories=/s)[1]);
const server=spawn('python3',['-m','http.server','8798','--bind','127.0.0.1'],{stdio:'ignore'});
let browser;const errors=[];const results=[];
const url='http://127.0.0.1:8798/mad-libs/';
async function replaceSave(page,saved,version){
  await page.evaluate(async ({saved,version})=>{
    ArcadeSave.setExternalSession(true);
    const current=ArcadeSave.getCurrentEntry();
    if(!current)throw new Error('Missing current entry for migration fixture');
    const entry={...current,version,data:saved};
    localStorage.setItem('arcade.autosave.data.v1.mad-libs',JSON.stringify(entry));
    await new Promise((resolve,reject)=>{
      const request=indexedDB.open('arcade-autosaves',1);
      request.onsuccess=()=>{const db=request.result,tx=db.transaction('saves','readwrite');tx.objectStore('saves').put(entry);tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(tx.error);};request.onerror=()=>reject(request.error);
    });
  },{saved,version});
  await page.goto(url+'?resume=1');
}
try{
  for(let i=0;i<100;i++){try{if((await fetch('http://127.0.0.1:8798')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
  browser=await chromium.launch(browserLaunchOptions);
  for(const viewport of [{width:1440,height:900},{width:390,height:844},{width:320,height:568}]){
    const context=await browser.newContext({viewport});const page=await context.newPage();
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto(url);
    await page.waitForFunction(()=>!!window.MadLibsAutosave);
    assert.equal(await page.evaluate(()=>MadLibsAutosave.version),3);
    for(let i=0;i<data.stories.length;i++){
      const values=data.stories[i].prompts.map((_,n)=>'Answer_'+i+'_'+n);
      await page.evaluate(({i,values})=>MadLibsAutosave.restore({storyFormat:3,storyIndex:i,values,customTitle:'Our lunch rescue',screen:'result'}),{i,values});
      const text=await page.locator('#storyOutput').innerText();
      for(const value of values)assert.ok(text.toLowerCase().includes(value.toLowerCase()),data.stories[i].title+' includes '+value);
      assert.equal(await page.locator('#storyOutput .filled-word').count(),(data.stories[i].template.match(/\{\d+\}/g)||[]).length);
      assert.ok((await page.locator('#resultTitle').innerText()).includes('Our lunch rescue'));
      assert.deepEqual((await page.evaluate(()=>MadLibsAutosave.capture())).values,values,'rendering preserves all raw answers');
      await page.locator('#editWordsButton').click();
      assert.equal(await page.locator('#promptList input').count(),12);
      assert.equal(await page.locator('#word_4').inputValue(),values[4]);
      assert.equal(await page.locator('label[for=word_4]').innerText(),data.stories[i].prompts[4][1]);
      await page.locator('#word_4').fill('TOASTER');
      const changed=await page.evaluate(()=>({values:MadLibsAutosave.capture().values,active:document.activeElement.id}));
      assert.equal(await page.locator('#word_4').inputValue(),'TOASTER',data.stories[i].title+' accepts a changed word; '+JSON.stringify(changed));
      await page.locator('#makeStoryButton').click();
      assert.ok((await page.locator('#storyOutput').innerText()).toLowerCase().includes('toaster'));
      assert.equal((await page.evaluate(()=>MadLibsAutosave.capture())).values[4],'TOASTER');
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'story fits '+viewport.width+': '+data.stories[i].title);
      const examples=data.stories[i].prompts.map(prompt=>prompt[2]?.example||data.meta[prompt[0]].example);
      await page.evaluate(({i,values})=>MadLibsAutosave.restore({storyFormat:3,storyIndex:i,values,screen:'result'}),{i,values:examples});
      const exampleText=await page.locator('#storyOutput').innerText();
      assert.ok(!/\{\d+\}/.test(exampleText),'normal example story has no unresolved blanks');
      for(const value of examples)assert.ok(exampleText.toLowerCase().includes(value.toLowerCase()),data.stories[i].title+' includes ordinary example '+value);
      assert.deepEqual((await page.evaluate(()=>MadLibsAutosave.capture())).values,examples,'normal word examples stay intact');
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'normal example story fits '+viewport.width+': '+data.stories[i].title);
      if(viewport.width===390&&i===0){await mkdir('test-results/mad-libs',{recursive:true});await page.screenshot({path:'test-results/mad-libs/mobile-story.png',fullPage:true});}
    }
    const caseValues=data.stories[0].prompts.map(prompt=>prompt[0]==='name'?'Logan':prompt[0]==='place'?'Easton':prompt[0]==='number'?'27':'Very Big');
    await page.evaluate(values=>MadLibsAutosave.restore({storyFormat:3,storyIndex:0,values,screen:'result'}),caseValues);
    const caseText=await page.locator('#storyOutput').innerText();
    assert.ok(caseText.includes('very big'),'ordinary words are lowercased within sentences');
    assert.ok(!caseText.includes('Very Big'),'ordinary answers lose title case');
    if(data.stories[0].prompts.some(p=>p[0]==='name'))assert.ok(caseText.includes('Logan'));
    if(data.stories[0].prompts.some(p=>p[0]==='place'))assert.ok(caseText.includes('Easton'));
    assert.deepEqual((await page.evaluate(()=>MadLibsAutosave.capture())).values,caseValues);
    await page.locator('#editWordsButton').click();
    await page.locator('#word_4').focus();
    await page.waitForTimeout(110);
    assert.equal(await page.evaluate(()=>document.activeElement.id),'word_4','restoring a result never steals the chosen input focus');
    assert.equal(await page.locator('#word_0').inputValue(),caseValues[0]);
    assert.equal(await page.locator('#word_0').getAttribute('autocapitalize'),data.stories[0].prompts[0][0]==='name'?'words':'none');
    await page.evaluate(()=>MadLibsAutosave.restore({storyFormat:3,storyIndex:67,values:Array.from({length:12},(_,n)=>'Answer_67_'+n),screen:'result'}));
    await page.locator('#editWordsButton').click();
    await page.locator('#word_0').fill('<img src=x onerror="throw 1">');
    await page.locator('#word_4').fill('');
    await page.locator('.prompt-card').nth(4).locator('.idea-button').click();
    const ideaTexts=await page.locator('.prompt-card').nth(4).locator('.idea-chip').allTextContents();
    assert.ok(ideaTexts.length>0,'ordinary word Ideas supplied');
    const prompt=data.stories[67].prompts[4];const pool=prompt[2]?.ideas||data.suggestions[prompt[0]];
    for(const idea of ideaTexts)assert.ok(pool.includes(idea),'Ideas use the requested word category');
    await page.locator('#fillEmptyButton').click();
    assert.equal(await page.locator('#word_0').inputValue(),'<img src=x onerror="throw 1">');
    assert.ok(await page.locator('#word_4').inputValue(),'Fill Empty supplies the unanswered word');
    await page.locator('#makeStoryButton').click();assert.equal(await page.locator('#storyOutput img').count(),0);
    await page.locator('#editWordsButton').click();
    await page.locator('#customStoryTitle').fill('T'.repeat(100));await page.locator('#word_0').fill('W'.repeat(120));
    await page.locator('#makeStoryButton').click();
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'long answers fit '+viewport.width);
    const saved=await page.evaluate(()=>MadLibsAutosave.capture());
    assert.equal(saved.storyFormat,3);assert.equal(saved.values.length,12);
    await page.evaluate(()=>ArcadeSave.saveNow());
    await page.goto(url+'?resume=1');
    await page.waitForFunction(()=>window.MadLibsAutosave?.capture().screen==='result');
    assert.deepEqual(await page.evaluate(()=>MadLibsAutosave.capture()),saved,'actual v3 autosave reload');

    const legacyCompleted={storyIndex:0,values:Array.from({length:18},(_,n)=>'Saved_'+n),customTitle:'Our original saved story',screen:'result'};
    await replaceSave(page,legacyCompleted,2);
    await page.waitForFunction(()=>window.MadLibsAutosave?.capture().storyFormat===2&&MadLibsAutosave.capture().screen==='result');
    const completed=await page.evaluate(()=>MadLibsAutosave.capture());
    assert.deepEqual(completed.values,legacyCompleted.values,'all 18 original completed answers survive');
    assert.equal(completed.customTitle,legacyCompleted.customTitle);
    const legacyText=await page.locator('#storyOutput').innerText();
    const expectedLegacyText=await page.evaluate(({values})=>{
      const div=document.createElement('div');div.innerHTML=ArcadeMadLibsCase.render(ArcadeMadLibsLegacyV2[0].template,values,ArcadeMadLibsLegacyV2[0].prompts,text=>text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'));
      return div.innerText;
    },legacyCompleted);
    assert.equal(legacyText,expectedLegacyText,'completed v2 story keeps its archived template');
    assert.equal(await page.locator('#promptList input').count(),18);
    await page.evaluate(()=>ArcadeSave.saveNow());await page.goto(url+'?resume=1');
    await page.waitForFunction(()=>window.MadLibsAutosave?.capture().storyFormat===2&&MadLibsAutosave.capture().screen==='result');
    assert.deepEqual(await page.evaluate(()=>MadLibsAutosave.capture()),completed,'v2 completed story survives v3 resave/reload');
    assert.equal(await page.locator('#storyOutput').innerText(),legacyText);
    await page.locator('#editWordsButton').click();
    assert.equal(await page.locator('#promptList input').count(),12,'Change Words uses the new ordinary prompts');
    const editedLegacy=await page.evaluate(()=>MadLibsAutosave.capture());
    assert.equal(editedLegacy.storyFormat,3);
    for(let n=0;n<12;n++)assert.equal(await page.locator('#word_'+n).inputValue(),legacyCompleted.values[n]);
    assert.equal(await page.locator('#word_12').count(),0,'no old plot-answer fields remain');
    assert.deepEqual(editedLegacy.legacyAnswers,{storyFormat:2,values:legacyCompleted.values},'Change Words preserves the old answers in its compatibility backup');
    assert.equal(editedLegacy.customTitle,legacyCompleted.customTitle);
    await page.evaluate(()=>ArcadeSave.saveNow());await page.goto(url+'?resume=1');
    await page.waitForFunction(()=>window.MadLibsAutosave?.capture().storyFormat===3&&MadLibsAutosave.capture().screen==='words');
    assert.deepEqual(await page.evaluate(()=>MadLibsAutosave.capture()),editedLegacy,'legacy editing migration survives reload');

    for(const version of [1,2]){
      const legacy={storyIndex:0,values:Array.from({length:version===1?12:18},(_,n)=>'Old_'+n),customTitle:version===2?'Our old title':'',screen:'words'};
      await replaceSave(page,legacy,version);
      await page.waitForFunction(()=>window.MadLibsAutosave?.capture().storyFormat===3&&MadLibsAutosave.capture().screen==='words'&&document.getElementById('word_0')?.value==='Old_0');
      const migrated=await page.evaluate(()=>MadLibsAutosave.capture());
      assert.equal(migrated.values.length,12);
      for(let n=0;n<12;n++)assert.equal(await page.locator('#word_'+n).inputValue(),'Old_'+n,'original word '+n+' retains its meaning');
      assert.equal(await page.locator('#word_12').count(),0,'migration exposes exactly 12 ordinary prompts');
      assert.equal(await page.locator('#customStoryTitle').inputValue(),legacy.customTitle);
      assert.deepEqual(migrated.legacyAnswers,{storyFormat:version,values:legacy.values},'all original raw answers retained for compatibility');
      await page.evaluate(()=>ArcadeSave.saveNow());await page.goto(url+'?resume=1');
      await page.waitForFunction(()=>window.MadLibsAutosave?.capture().storyFormat===3&&MadLibsAutosave.capture().screen==='words'&&document.getElementById('word_0')?.value==='Old_0');
      assert.deepEqual(await page.evaluate(()=>MadLibsAutosave.capture()),migrated,'migrated words and archived answers survive a real reload');
    }
    await page.evaluate(()=>MadLibsAutosave.startFresh());assert.equal(await page.locator('#customStoryTitle').inputValue(),'');
    await page.locator('.story-card').first().click();
    assert.equal(await page.evaluate(()=>document.activeElement.id),'word_0','deliberate story selection focuses the first word immediately');
    assert.equal(await page.locator('#promptList input').count(),12);
    await page.evaluate(()=>MadLibsAutosave.startFresh());
    results.push({viewport,stories:68,status:'passed',checks:['all 12 answers','ordinary word prompts','raw answer preservation','restore preserves selected input focus','story selection focuses first word','contextual capitalization','change words','Ideas by word category','fill empty','safe rendering','long text fit','actual v3 save reload','archived v2 completed story reload','legacy editing reload','v1 and v2 word migration','retained legacy raw answers']});
    await context.close();console.log('PASS Mad Libs '+viewport.width+'x'+viewport.height+' all 68 stories');
  }
  assert.deepEqual(errors,[]);
  await mkdir('test-results/mad-libs',{recursive:true});await writeFile('test-results/mad-libs/report.json',JSON.stringify({results,errors},null,2));
}finally{await browser?.close();server.kill();}
