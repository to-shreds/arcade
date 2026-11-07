// Exercise the actual activity UI and ArcadeSave callback contract. JSDOM
// supplies a DOM; the shipped engine, activity and save code run unchanged.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{JSDOM}=require('../cloudflare/chess-worker/node_modules/jsdom');
const root=new URL('../',import.meta.url),save=await readFile(new URL('arcade-save.js',root),'utf8');
for(const game of ['solitaire','regex-lab']){
 const source=await readFile(new URL(game+'/index.html',root),'utf8');
 const dom=new JSDOM(source.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,''),{
  url:'https://to-shreds.github.io/arcade/'+game+'/',runScripts:'outside-only',pretendToBeVisual:true
 });
 const w=dom.window;
 try{
  w.HTMLElement.prototype.scrollTo=function(){};
  w.eval(await readFile(new URL(game+'/engine.js',root),'utf8'));
  w.eval(save);
  for(const match of source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi))if(!/\bsrc\s*=/.test(match[1])&&match[2].trim())w.eval(match[2]);
  await new Promise(resolve=>setTimeout(resolve,20));
  w.document.querySelector('#startBtn').click();
  if(game==='solitaire'){
   w.document.querySelector('[data-action="draw-klondike"]').click();
   assert.equal(w.ArcadeSave.getAdapter().capture().moves,1);
  }else{
   w.document.querySelector('[data-pick]').click();
   w.document.querySelector('#checkAction').click();
   w.document.querySelector('#nextAction').click();
   assert.equal(w.ArcadeSave.getAdapter().capture().session.round,2);
  }
  assert.equal(w.ArcadeSave.getAdapter().meaningful(),true,game+' played progress qualifies for autosave');
  const entry=await w.ArcadeSave.saveNow();
  assert(entry,game+' creates an Arcade save');
  assert.match(entry.summary,game==='solitaire'?/Klondike.*1 move/:/Match Hunt.*round 2\/10/,game+' summary describes progress');
  assert.equal(w.ArcadeSave.getRegistry()[game].summary,entry.summary,game+' appears in the Arcade saved-games registry');
  const expected=JSON.stringify(entry.data);
  assert.equal(await w.ArcadeSave.load(),true,game+' saved progress restores');
  const actual=w.ArcadeSave.getAdapter().capture();
  if(game==='solitaire'){
   const strip=s=>({...s,elapsed:0,startedAt:0,history:s.history.map(h=>({...h,elapsed:0,startedAt:0}))});
   assert.deepEqual(JSON.parse(JSON.stringify(strip(actual))),JSON.parse(JSON.stringify(strip(entry.data))),game+' restores cards, move history and score');
  }else assert.equal(JSON.stringify(actual),expected,game+' restores exact question, score, round and profile');
  console.log('PASS '+game+': played UI, no-argument callbacks, save registry and exact state restore');
 }finally{w.close();}
}
