import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium, browserLaunchOptions } from './browser-runtime.mjs';
import { startStaticFixture } from './static-fixture.mjs';

const fixture=await startStaticFixture();
const WEB='https://to-shreds.github.io', BASE=WEB+'/arcade/', API='https://torbox-web-player-key.onrender.com';
const TOKEN_A='a'.repeat(43),TOKEN_B='b'.repeat(43),KEY='tv-browser-fixture-key';
const familySource=await readFile(new URL('./test-family-activities.mjs',import.meta.url),'utf8');
const videoMatch=/const VIDEO_FIXTURE = Buffer\.from\('([^']+)', 'base64'\)/.exec(familySource);
assert(videoMatch,'The existing synthetic WebM fixture must be available');
const VIDEO=Buffer.from(videoMatch[1],'base64');
const results=[],failures=[];
const only=process.argv.find(value=>value.startsWith('--case='))?.slice(7).toLowerCase();
let browser;
const source=(id,resolution='480p',cached=true,score=1)=>({id,hash:id,resolution,cached,browserContainer:true,score});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(predicate,label,timeout=10000){const end=Date.now()+timeout;while(Date.now()<end){if(await predicate())return;await sleep(25);}throw new Error('Timed out: '+label);}
function count(state,path){return state.calls.filter(call=>call.path===path).length;}
function calls(state,path){return state.calls.filter(call=>call.path===path);}

async function setup({viewport={width:390,height:844},sources=[source('low'),source('high','1080p',true,900)],respond}={}){
  const context=await browser.newContext({viewport,serviceWorkers:'block'});
  const state={calls:[],errors:[],unexpected:[],sources,registrations:0,playbacks:0,files:new Map(),gates:new Map(),context};
  state.gate=name=>{if(!state.gates.has(name)){let release;const promise=new Promise(resolve=>release=resolve);state.gates.set(name,{promise,release});}return state.gates.get(name).promise;};
  state.release=name=>state.gates.get(name)?.release();
  await context.addInitScript(token=>{if(!sessionStorage.getItem('arcade-tv.session.v1'))sessionStorage.setItem('arcade-tv.session.v1',token);},TOKEN_A);
  await context.addInitScript(()=>{
    window.__tvStartupEvents=[];
    for(const type of ['loadedmetadata','seeking','seeked','playing','pause','emptied'])document.addEventListener(type,event=>{
      if(event.target?.id==='video')__tvStartupEvents.push({type,time:event.target.currentTime,duration:event.target.duration,src:event.target.getAttribute('src')});
    },true);
  });
  await context.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url());
    try{
      if(url.origin===WEB&&url.pathname.startsWith('/arcade/')){
        const relative=url.pathname.slice('/arcade/'.length)||'index.html';
        const response=await fetch(fixture.base+'/'+relative);
        await route.fulfill({status:response.status,contentType:response.headers.get('content-type')||'application/octet-stream',body:Buffer.from(await response.arrayBuffer())});return;
      }
      if(url.origin===WEB&&url.pathname==='/favicon.ico'){await route.fulfill({status:204});return;}
      if(url.origin!==API){state.unexpected.push(request.url());await route.abort();return;}
      const headers={'Access-Control-Allow-Origin':WEB,'Access-Control-Allow-Headers':'authorization,content-type','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Cache-Control':'no-store'};
      if(request.method()==='OPTIONS'){await route.fulfill({status:204,headers});return;}
      const call={path:url.pathname,query:Object.fromEntries(url.searchParams),data:request.postData()?request.postDataJSON():null,auth:request.headers().authorization||'',method:request.method()};
      state.calls.push(call);
      let body,status=200;
      if(call.path.startsWith('/media/')){
        const custom=await respond?.(call,state);
        if(custom?.gate)await state.gate(custom.gate);
        const range=/^bytes=(\d+)-(\d*)$/.exec(request.headers().range||'');
        const start=range?Number(range[1]):0,end=range&&range[2]?Math.min(VIDEO.length-1,Number(range[2])):VIDEO.length-1,body=VIDEO.subarray(start,end+1);
        await route.fulfill({status:range?206:200,headers:{...headers,'Content-Type':'video/webm','Accept-Ranges':'bytes','Content-Length':String(body.length),...(range?{'Content-Range':`bytes ${start}-${end}/${VIDEO.length}`}:{})},body});return;
      }
      if(call.path==='/api/session')body={authenticated:true,authMode:'api-key'};
      else if(call.path==='/api/login')body={sessionToken:call.data.apiKey===KEY+'-b'?TOKEN_B:TOKEN_A,authMode:'api-key'};
      else if(call.path==='/api/logout')body={ok:true};
      else if(call.path==='/api/discover/meta')body={meta:{id:call.query.id,type:call.query.type,name:'Fixture title',episodes:[{season:1,episode:1,name:'First episode',released:'2016-01-01'},{season:1,episode:2,name:'Second episode',released:'2016-01-02'}]}};
      else if(call.path==='/api/discover/lookup')body={complete:true,sources:state.sources};
      else if(call.path==='/api/discover/sources'){state.registrations++;body={sources:state.sources,cacheAvailability:'known'};}
      else if(call.path==='/api/discover/prepare'){
        const id='torrents:'+call.data.source+':0';state.files.set(id,call.data.source);body={state:'ready',file:{id,title:'Fixture.S01E01.webm',resolution:state.sources.find(source=>source.id===call.data.source)?.resolution}};
      }else if(call.path==='/api/discover/status'){
        const id=call.query.file||'torrents:'+call.query.source+':0';state.files.set(id,call.query.source);body={state:'ready',file:{id,title:'Fixture.S01E01.webm'}};
      }else if(call.path==='/api/playback')body={mediaUrl:'/media/'+('m'+String(++state.playbacks).padStart(42,'0'))};
      else{state.unexpected.push(request.url());status=404;body={error:'NOT_FOUND',message:'Unexpected fixture route'};}
      const custom=await respond?.(call,state);
      if(custom){if(custom.gate)await state.gate(custom.gate);if(custom.status)status=custom.status;if(custom.body!==undefined)body=custom.body;}
      await route.fulfill({status,headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify(body)});
    }catch(error){if(!context._closed&&!/Target.*closed|intercepted|Invalid Interception|Fetch domain is not enabled/i.test(error.message))state.errors.push('Fixture: '+error.message);}
  });
  const page=await context.newPage();state.page=page;
  page.on('pageerror',error=>state.errors.push(error.message));
  await page.goto(BASE+'tv/');
  await page.waitForFunction(()=>document.getElementById('connect').textContent==='Connected');
  state.close=async()=>{for(const gate of state.gates.values())gate.release();await context.close();};
  return state;
}
async function choose(state){
  await state.page.locator('#titles button').filter({hasText:'Elena of Avalor'}).click();
  await state.page.locator('#episode option').first().waitFor({state:'attached'});
  await state.page.locator('#autoplay').uncheck();
}
async function decoded(page){await page.waitForFunction(()=>document.getElementById('video').readyState>=2&&!document.getElementById('video').error);await page.locator('#video').evaluate(video=>video.pause());}
async function inside(page,selector){const box=await page.locator(selector).boundingBox(),v=page.viewportSize();assert(box&&box.width>0&&box.height>0,selector+' is visible');assert(box.x>=-1&&box.y>=-1&&box.x+box.width<=v.width+1&&box.y+box.height<=v.height+1,selector+' fits the viewport');}
function clean(state){assert.deepEqual(state.errors,[]);assert.deepEqual(state.unexpected,[]);assert(calls(state,'/api/discover/prepare').filter(call=>call.data.onlyCached===false).length<=1,'An action must never silently add another uncached copy');}
async function run(name,fn){if(only&&!name.toLowerCase().includes(only))return;const start=Date.now();try{await fn();results.push({name,passed:true,elapsedMs:Date.now()-start});console.log('PASS '+name);}catch(error){failures.push({name,error:error.stack});results.push({name,passed:false,error:error.message});console.error('FAIL '+name+': '+error.message);}}

try{
  browser=await chromium.launch(browserLaunchOptions);await mkdir('test-results/tv-startup',{recursive:true});
  await run('480p default, quality persistence, fresh playback links and seek-preserving fullscreen changes',async()=>{
    const state=await setup({viewport:{width:1440,height:900}}),page=state.page;
    try{
      await choose(state);assert.equal(await page.locator('#quality-settings').textContent(),'Quality: 480p');
      await until(()=>count(state,'/api/discover/sources')===1,'completed source prewarm');await sleep(60);
      assert.equal(count(state,'/api/discover/prepare'),0);assert.equal(count(state,'/api/playback'),0,'Prewarming never opens a credentialed media link');
      await page.locator('#play').click();await decoded(page);
      assert.equal(await page.evaluate(()=>document.fullscreenElement?.id),'player','The quality change is tested in actual native fullscreen');
      assert.equal(calls(state,'/api/discover/prepare')[0].data.source,'low');assert.equal(count(state,'/api/discover/lookup'),1);assert.equal(count(state,'/api/discover/sources'),1,'Play reuses completed source checks');
      const element=await page.locator('#video').elementHandle(),first=await page.locator('#video').getAttribute('src');
      await page.locator('#video').evaluate(video=>{video.currentTime=.25;});
      await page.waitForFunction(()=>{const video=document.getElementById('video');return !video.seeking&&video.currentTime>=.23;},undefined,{timeout:5000}).catch(async error=>{throw new Error('Initial fixture seek failed: '+JSON.stringify(await page.evaluate(()=>({events:__tvStartupEvents,time:document.getElementById('video').currentTime,duration:document.getElementById('video').duration,seekable:[...Array(document.getElementById('video').seekable.length)].map((_,index)=>[document.getElementById('video').seekable.start(index),document.getElementById('video').seekable.end(index)])})))+' '+error.message);});
      await page.locator('#player-quality').click();
      assert.equal(await page.locator('#quality-dialog').evaluate(dialog=>dialog.parentElement.id),'player','The quality dialog belongs inside the fullscreen element');
      await inside(page,'#quality-dialog');await inside(page,'#quality-apply');
      await page.locator('#quality').selectOption('1080p');await page.locator('#quality-apply').click();await decoded(page);
      assert.equal(await element.evaluate(video=>video===document.getElementById('video')),true,'Quality change retains the video element');
      await page.waitForFunction(()=>!document.getElementById('video').seeking);
      const resumed=await page.locator('#video').evaluate(video=>video.currentTime);assert(resumed>=.23&&resumed<1.1,'Quality change resumes near the existing position: '+resumed+' '+JSON.stringify(await page.evaluate(()=>__tvStartupEvents)));
      assert.equal(calls(state,'/api/discover/prepare').at(-1).data.source,'high');assert.notEqual(await page.locator('#video').getAttribute('src'),first);
      assert.match(await page.locator('#playing-quality').textContent(),/1080p preferred/);assert.equal(count(state,'/api/discover/lookup'),1);
      await page.locator('#player-back').click();await page.locator('#play').click();await decoded(page);
      assert.equal(count(state,'/api/playback'),3,'Every play and quality change obtains a fresh ticket');assert.equal(count(state,'/api/discover/lookup'),1);
      await page.locator('#player-back').click();await page.reload();await page.waitForFunction(()=>document.getElementById('connect').textContent==='Connected');
      assert.equal(await page.locator('#quality-settings').textContent(),'Quality: 1080p');clean(state);
    }finally{await state.close();}
  });
  await run('startup progress shows every stage and adopts a pending source prewarm',async()=>{
    const paths={'/api/discover/lookup':'lookup','/api/discover/sources':'sources','/api/discover/prepare':'prepare','/api/playback':'playback'};
    const state=await setup({respond:call=>({gate:call.path.startsWith('/media/')?'media':paths[call.path]})}),page=state.page;
    try{
      await choose(state);await until(()=>count(state,'/api/discover/lookup')===1,'pending prewarm');
      await page.locator('#play').click();await page.locator('#player-status').filter({hasText:'Finding copies'}).waitFor();
      assert.equal(await page.locator('#player-message').getAttribute('aria-busy'),'true');await inside(page,'#player-spinner');
      state.release('lookup');await page.locator('#player-status').filter({hasText:'Checking which copies'}).waitFor();
      state.release('sources');await page.locator('#player-status').filter({hasText:'Checking ready copy 1 of 2'}).waitFor();
      state.release('prepare');await page.locator('#player-status').filter({hasText:'Getting the playback link'}).waitFor();
      assert.equal(await page.locator('#player-steps [aria-current="step"]').getAttribute('data-step'),'3');
      state.release('playback');await page.locator('#player-status').filter({hasText:'Loading video'}).waitFor();
      assert.equal(await page.locator('#player-steps [aria-current="step"]').getAttribute('data-step'),'4');
      await page.screenshot({path:'test-results/tv-startup/progress-390x844.png'});
      state.release('media');await decoded(page);assert.equal(count(state,'/api/discover/lookup'),1);assert.equal(count(state,'/api/discover/sources'),1);clean(state);
    }finally{await state.close();}
  });
  for(const errorCode of ['TORRENT_IDENTITY_MISMATCH','TORRENT_IDENTITY_UNVERIFIED'])await run('explicit Prepare '+errorCode+' recovers to a newly-ready cached alternate',async()=>{
    const state=await setup({sources:[source('wrong','480p',false,900),source('new-ready','720p',false,1)],respond:(call,state)=>{
      if(call.path==='/api/discover/sources'&&state.registrations>=2)return{body:{sources:[source('wrong','480p',false,900),source('new-ready','720p',true,1)],cacheAvailability:'known'}};
      if(call.path==='/api/discover/prepare'&&call.data.source==='wrong')return{status:409,body:{error:errorCode,message:'This file could not be verified as the requested title.'}};
    }}),page=state.page;
    try{
      await choose(state);await page.locator('#play').click();await page.locator('#prepare').waitFor({state:'visible'});
      await page.locator('#prepare').click();await decoded(page);
      assert.deepEqual(calls(state,'/api/discover/prepare').map(call=>[call.data.source,call.data.onlyCached]),[['wrong',false],['new-ready',true]]);
      assert.equal(count(state,'/api/discover/lookup'),2,'Recovery refreshes cache readiness for the exact target');
      clean(state);
    }finally{await state.close();}
  });
  await run('a rejected explicit Prepare is not offered again when no ready alternate exists',async()=>{
    const state=await setup({sources:[source('wrong','480p',false)],respond:call=>call.path==='/api/discover/prepare'?{status:409,body:{error:'TORRENT_IDENTITY_MISMATCH',message:'Wrong title'}}:undefined}),page=state.page;
    try{
      await choose(state);await page.locator('#play').click();await page.locator('#prepare').waitFor({state:'visible'});await page.locator('#prepare').click();
      await page.locator('#player-status').filter({hasText:'could not be verified or played'}).waitFor();assert.equal(await page.locator('#prepare').isVisible(),false);
      await page.locator('#player-retry').click();await page.locator('#player-status').filter({hasText:'could not be verified or played'}).waitFor();
      assert.equal(await page.locator('#prepare').isVisible(),false);assert.equal(count(state,'/api/discover/prepare'),1,'Retry does not re-add the known wrong torrent');
      await page.screenshot({path:'test-results/tv-startup/rejected-copy-390x844.png'});clean(state);
    }finally{await state.close();}
  });
  await run('explicit Retry refreshes a transient failure instead of retaining it forever',async()=>{
    const state=await setup({sources:[source('temporary')],respond:(call,state)=>call.path==='/api/discover/prepare'&&count(state,'/api/discover/prepare')===1?{status:503,body:{error:'CONNECTION_UNAVAILABLE',message:'Temporary service outage'}}:undefined}),page=state.page;
    try{
      await choose(state);await page.locator('#play').click();await page.locator('#player-retry').waitFor({state:'visible'});await page.locator('#player-retry').click();await decoded(page);
      assert.equal(count(state,'/api/discover/prepare'),2);assert.equal(count(state,'/api/discover/lookup'),2);assert(calls(state,'/api/discover/prepare').every(call=>call.data.onlyCached));clean(state);
    }finally{await state.close();}
  });
  await run('Back cancels a late playback ticket without attaching stale media',async()=>{
    const state=await setup({respond:call=>call.path==='/api/playback'?{gate:'ticket'}:undefined}),page=state.page;
    try{
      await choose(state);await page.locator('#play').click();await until(()=>count(state,'/api/playback')===1,'pending playback ticket');
      await page.locator('#player-back').click();state.release('ticket');await sleep(150);
      assert.equal(await page.locator('#player').isVisible(),false);assert.equal(await page.locator('#video').getAttribute('src'),null);assert.equal(state.calls.filter(call=>call.path.startsWith('/media/')).length,0);clean(state);
    }finally{await state.close();}
  });
  await run('Disconnect and account swap invalidate a pending old-account prewarm',async()=>{
    for(const swap of [false,true]){
      const state=await setup({respond:call=>call.path==='/api/discover/lookup'&&call.auth==='Bearer '+TOKEN_A?{gate:'old-lookup'}:undefined}),page=state.page;
      try{
        await choose(state);await until(()=>count(state,'/api/discover/lookup')===1,'old-account prewarm');
        await page.locator('#connect').click();
        if(swap){await page.locator('#api-key').fill(KEY+'-b');await page.locator('#login').click();await page.locator('#connection-dialog').waitFor({state:'hidden'});}
        else{await page.locator('#disconnect').click();await page.locator('#connection-status').filter({hasText:'remembered key was removed'}).waitFor();}
        state.release('old-lookup');
        if(swap){await until(()=>calls(state,'/api/discover/sources').some(call=>call.auth==='Bearer '+TOKEN_B),'new-account source check');assert(calls(state,'/api/discover/sources').every(call=>call.auth==='Bearer '+TOKEN_B));}
        else{await sleep(150);assert.equal(count(state,'/api/discover/sources'),0);}
        assert.equal(count(state,'/api/discover/prepare'),0);assert.equal(count(state,'/api/playback'),0);clean(state);
      }finally{await state.close();}
    }
  });
  for(const viewport of [{width:320,height:568},{width:390,height:844},{width:844,height:390},{width:1440,height:900}])await run('responsive quality controls '+viewport.width+'x'+viewport.height,async()=>{
    const state=await setup({viewport}),page=state.page;
    try{
      await choose(state);await page.locator('#quality-settings').scrollIntoViewIfNeeded();await page.locator('#quality-settings').click();
      for(const selector of ['#quality-dialog','#quality','#quality-apply','#quality-close'])await inside(page,selector);
      await page.locator('#quality-close').click();await page.locator('#play').click();await decoded(page);await page.locator('#player-quality').click();
      for(const selector of ['#player-back','#player-quality','#fullscreen','#quality-dialog','#quality','#quality-apply'])await inside(page,selector);
      assert.equal(await page.locator('#quality-dialog').evaluate(dialog=>dialog.parentElement.id),'player');
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&document.documentElement.scrollHeight<=innerHeight),true,'TV uses bounded internal panels without page overflow');
      await page.screenshot({path:`test-results/tv-startup/quality-${viewport.width}x${viewport.height}.png`});
      clean(state);
    }finally{await state.close();}
  });
  await writeFile('test-results/tv-startup/summary.json',JSON.stringify({results,failures},null,2));
  assert.deepEqual(failures,[],'TV startup browser checks must all pass');
  console.log('TV startup browser checks passed '+results.length+' scenarios with local synthetic media and intercepted service responses.');
}finally{await browser?.close();await fixture.close();}
