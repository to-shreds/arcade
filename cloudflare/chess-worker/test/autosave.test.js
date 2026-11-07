import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

const root = new URL('../../../',import.meta.url);
const source = await readFile(new URL('arcade-save.js',root),'utf8');
const saveKey = id => `arcade.autosave.data.v1.${id}`;
const savedEntry = (id='fixture') => ({schema:1,id,title:'Saved game',version:1,updatedAt:100,summary:'Original progress',data:{corrupt:true}});

function environment({id='fixture',entry=savedEntry(id),html='<!doctype html><title>Saved game</title><button id="play">Play</button>',query=''}={}) {
  const dom = new JSDOM(html,{url:`https://to-shreds.github.io/arcade/${id}/${query}`,runScripts:'outside-only',pretendToBeVisual:true});
  const w=dom.window,timers=new Map(),intervals=new Map();let nextId=1,clock=0;
  w.setTimeout=(fn,delay=0)=>{const timer=nextId++;timers.set(timer,{fn,at:clock+delay});return timer;};
  w.clearTimeout=id=>timers.delete(id);
  w.setInterval=fn=>{const timer=nextId++;intervals.set(timer,fn);return timer;};
  w.clearInterval=id=>intervals.delete(id);
  if(entry)w.localStorage.setItem(saveKey(id),JSON.stringify(entry));
  w.eval(source);
  async function advance(ms){
    const end=clock+ms;
    while(true){
      const pending=[...timers].filter(([,timer])=>timer.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];
      if(!pending)break;
      timers.delete(pending[0]);clock=pending[1].at;pending[1].fn();
      await Promise.resolve();await Promise.resolve();
    }
    clock=end;await new Promise(resolve=>setImmediate(resolve));
  }
  return {dom,w,advance,intervals};
}

for(const failure of ['false','async false','throw','reject'])test(`failed autosave restore (${failure}) retains saved data and blocks background replacement`,async()=>{
  const entry=savedEntry(),env=environment({entry}),{w}=env;
  try{
    await w.ArcadeSave.register({id:'fixture',version:1,capture:()=>({defaultGame:true}),meaningful:()=>true,alwaysSave:true,
      restore:()=>{if(failure==='throw')throw Error('Invalid save');if(failure==='reject')return Promise.reject(Error('Invalid save'));if(failure==='async false')return Promise.resolve(false);return false;}});
    assert.equal(await w.ArcadeSave.load(),false);
    await env.advance(1000);
    for(const interval of env.intervals.values())interval();
    w.document.querySelector('#play').click();
    await env.advance(6000);
    assert.equal(await w.ArcadeSave.saveNow(),null,'a rejected load cannot start an autosave session');
    assert.deepEqual(JSON.parse(w.localStorage.getItem(saveKey('fixture'))),entry,'rejected saved bytes survive timers, activity events and saveNow');
    assert.deepEqual(JSON.parse(JSON.stringify(w.ArcadeSave.getCurrentEntry())),entry);
    assert.equal(w.document.querySelector('.arcade-save-layer').hidden,false,'the user can retry loading or deliberately start fresh');
    assert.equal(w.document.querySelector('.arcade-save-toast').textContent,'Could not load this saved game.');
  }finally{w.close();}
});

test('the real Regex Lab adapter cannot turn rejected saved data into a success or erase it',async()=>{
  const html=await readFile(new URL('regex-lab/index.html',root),'utf8'),entry=savedEntry('regex-lab');
  const env=environment({id:'regex-lab',entry,html:html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'')}),{w}=env;
  try{
    w.HTMLElement.prototype.scrollTo=function(){};
    w.eval(await readFile(new URL('regex-lab/engine.js',root),'utf8'));
    for(const script of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi))if(!/\bsrc\s*=/.test(script[1])&&script[2].trim())w.eval(script[2]);
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(await w.ArcadeSave.load(),false,'actual activity validation rejects the corrupt payload');
    await env.advance(6000);
    assert.equal(await w.ArcadeSave.saveNow(),null);
    assert.deepEqual(JSON.parse(w.localStorage.getItem(saveKey('regex-lab'))),entry);
    assert.equal(w.document.querySelector('.arcade-save-layer').hidden,false);
    assert.equal(w.document.querySelector('.arcade-save-toast').textContent,'Could not load this saved game.');
  }finally{w.close();}
});

for(const result of [true,undefined])test(`successful autosave restore accepts the legacy ${String(result)} return contract`,async()=>{
  const entry={...savedEntry(),data:{moves:12}},env=environment({entry,query:'?resume=1'}),{w}=env;let state={moves:0};
  try{
    const ready=await w.ArcadeSave.register({id:'fixture',version:1,capture:()=>state,meaningful:()=>true,restore:data=>{state=data;return result;}});
    assert.equal(ready,true);
    assert.equal(state.moves,12);
    assert.equal(w.document.querySelector('.arcade-save-toast').textContent,'Saved progress loaded.');
    assert.equal(w.location.search,'');
    state={moves:13};await env.advance(1000);
    assert.equal(JSON.parse(w.localStorage.getItem(saveKey('fixture'))).data.moves,13,'successful loading resumes normal autosaving');
  }finally{w.close();}
});

test('a failed restore can retry successfully without losing the saved progress',async()=>{
  const entry={...savedEntry(),data:{moves:12}},env=environment({entry}),{w}=env;let attempts=0,state={moves:0};
  try{
    await w.ArcadeSave.register({id:'fixture',version:1,capture:()=>state,meaningful:()=>true,restore:data=>{if(!attempts++)return false;state=data;return true;}});
    assert.equal(await w.ArcadeSave.load(),false);
    assert.equal(await w.ArcadeSave.load(),true);
    assert.equal(state.moves,12);
    assert.equal(w.document.querySelector('.arcade-save-layer').hidden,true);
    assert.equal((await w.ArcadeSave.saveNow()).data.moves,12);
  }finally{w.close();}
});

test('Start Fresh explicitly releases a rejected save and resumes saving the new game',async()=>{
  const env=environment(),{w}=env;let state={moves:0};
  try{
    await w.ArcadeSave.register({id:'fixture',version:1,capture:()=>state,meaningful:()=>true,restore:()=>false,startFresh:()=>{state={moves:1};}});
    assert.equal(await w.ArcadeSave.load(),false);
    w.document.querySelector('.arcade-save-fresh').click();
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(w.document.querySelector('.arcade-save-layer').hidden,true);
    assert.equal((await w.ArcadeSave.saveNow()).data.moves,1);
    assert.equal(JSON.parse(w.localStorage.getItem(saveKey('fixture'))).data.moves,1);
  }finally{w.close();}
});

test('an incompatible migration retains the old save and offers a fresh start without running restore',async()=>{
  const env=environment(),{w}=env;let restoreCalls=0;
  try{
    await w.ArcadeSave.register({id:'fixture',version:2,capture:()=>({moves:0}),meaningful:()=>true,migrate:()=>undefined,restore:()=>{restoreCalls++;return true;}});
    assert.equal(await w.ArcadeSave.load(),false);
    assert.equal(restoreCalls,0);
    await env.advance(6000);
    assert.equal(await w.ArcadeSave.saveNow(),null);
    assert.deepEqual(JSON.parse(w.localStorage.getItem(saveKey('fixture'))),savedEntry());
    assert.equal(w.document.querySelector('.arcade-save-layer').hidden,false);
    assert.equal(w.document.querySelector('.arcade-save-toast').textContent,'This saved game is not compatible.');
  }finally{w.close();}
});
