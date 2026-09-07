import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { GenericRoomModel } from '../../../multiplayer/models/generic-room-model.js';
import { MemoryStorage } from '../../../multiplayer/models/room-model.js';
const root=new URL('../../../',import.meta.url);
const html=await readFile(new URL('guess-who/index.html',root),'utf8');
const files=await Promise.all(['multiplayer/models/guess-who-data.js','guess-who/portraits.js','guess-who/game.js'].map(p=>readFile(new URL(p,root),'utf8')));
const script=files.map(s=>s.replace(/^import .*?;\n/gm,'').replace(/^export /gm,'')).join('\n');
const tick=()=>new Promise(r=>setTimeout(r,5));
async function wait(predicate,label='condition'){for(let i=0;i<160;i++){if(predicate())return;await tick();}assert.fail(`Timed out: ${label}`);}
function backend(){
 const model=new GenericRoomModel(new MemoryStorage()),sockets=[],calls=[];let fail=false,tail=Promise.resolve();
 const enqueue=fn=>{const run=tail.then(fn,fn);tail=run.catch(()=>{});return run;};
 const broadcast=async()=>{for(const s of sockets)if(s.readyState===1)try{s.onmessage?.({data:JSON.stringify({type:'state',room:await model.state(s.token)})});}catch{}};
 return {model,sockets,calls,broadcast,set fail(value){fail=value;},fetch:(url,opts={})=>enqueue(async()=>{
  calls.push({url:String(url),...opts});if(fail)throw new Error('Simulated network outage');
  const path=new URL(url).pathname,body=opts.body?JSON.parse(opts.body):null,token=opts.headers?.authorization?.slice(7);
  try{
   let result;
   if(path.endsWith('/rooms')) result=await model.create({code:'ABC234',...body});
   else if(path.endsWith('/join')) result=await model.join(body);
   else if(path.endsWith('/state')) result={room:await model.state(token)};
   else if(path.endsWith('/actions')) result={room:await model.act(token,body)};
   else throw Object.assign(new Error('Not found'),{status:404});
   if(body)await broadcast();return {ok:true,status:200,json:async()=>({ok:true,...result})};
  }catch(error){return {ok:false,status:error.status||500,json:async()=>({ok:false,error:error.message})};}
 }),Socket:class{static CONNECTING=0;static OPEN=1;static CLOSED=3;constructor(url){this.token=new URL(url).searchParams.get('token');this.readyState=0;sockets.push(this);queueMicrotask(async()=>{this.readyState=1;this.onopen?.({});await broadcast();});}close(){this.readyState=3;this.onclose?.({});}}};
}
function client(t,server,{nearby=false,storage=null,url='https://to-shreds.github.io/arcade/guess-who/'}={}){
 const dom=new JSDOM(html,{url,runScripts:'outside-only',pretendToBeVisual:true});const w=dom.window,seen=[];
 if(storage)for(const [k,v]of Object.entries(storage))w.localStorage.setItem(k,v);
 const identity=nearby?{nickname:'Locked Nickname'}:null;
 w.ArcadeMultiplayer={workerOrigin:'https://arcade-chess.jonathanjablon.workers.dev',ready:async()=>{},getStatus:()=>({effectiveTransport:nearby?'nearby':'cloudflare'}),getIdentity:()=>identity,preferredUsername:n=>identity?.nickname||n,onStatus:fn=>fn(),resetRoomTransport(){},observeRoom:r=>seen.push(r),getTurnAlertSettings:()=>({soundEnabled:true}),setTurnSoundEnabled(){},requestTurnNotifications:async()=>{},invite(){return true;},goHome(){}};
 w.fetch=server.fetch;w.WebSocket=server.Socket;
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'));};
 w.eval(script);
 t.after(async()=>{w.dispatchEvent(new w.Event('pagehide'));await new Promise(r=>setTimeout(r,25));w.close();});
 const $=id=>w.document.getElementById(id);
 return {dom,w,$,seen,click:async id=>{$(id).click();await tick();},input:(id,value)=>{$(id).value=value;$(id).dispatchEvent(new w.Event('input',{bubbles:true}));},confirm:async()=>{w.document.querySelector('#modalActions button:last-child').click();await wait(()=>$('modal').open===false,'modal closes');}};
}
async function pair(t){
 const server=backend(),a=client(t,server),b=client(t,server);
 a.input('nickname','Alice');await a.click('create');await wait(()=>a.$('setup').hidden,'create');
 b.input('nickname','Bob');b.input('joinCode','ABC234');await b.click('join');await wait(()=>b.$('setup').hidden,'join');
 await wait(()=>!a.$('start').disabled,'start ready');await a.click('start');await wait(()=>b.$('headline').textContent==='Pick your secret character','selection');
 for(const [c,id]of [[a,'ada'],[b,'ben']]){await wait(()=>!c.$('leave').disabled,'ready to choose');c.w.document.querySelector(`[data-character="${id}"]`).click();await c.confirm();await wait(()=>!c.$('leave').disabled,'action settled');}
 await wait(()=>a.$('headline').textContent.includes('turn')&&b.$('headline').textContent.includes('turn'),'playing');
 return {server,a,b};
}

test('Guess Who frontend locks Nearby identity, prefills invitations, and never resumes an Internet room over Nearby',async t=>{
 const server=backend(),stored=JSON.stringify({session:{code:'ABC234',token:'saved-token',transport:'cloudflare',username:'Alice'},notes:{round:1}});
 const c=client(t,server,{nearby:true,url:'https://to-shreds.github.io/arcade/guess-who/?room=ABC234',storage:{'arcade.guessWho.cloudflare.v1':stored}});
 await tick();assert.equal(c.$('nickname').readOnly,true);assert.equal(c.$('nickname').value,'Locked Nickname');
 assert.equal(c.$('joinCode').value,'ABC234');assert.equal(c.$('resume').hidden,true);assert.equal(server.calls.length,0);
 await c.click('create');await wait(()=>c.$('setup').hidden);
 assert.equal(JSON.parse(server.calls[0].body).username,'Locked Nickname');
 assert.equal(c.$('invite').hidden,false);
});

test('Guess Who browser clients play a full round with private notes, safe custom text and a mutual rematch',async t=>{
 const {server,a,b}=await pair(t);const first=a.$('headline').textContent==='Your turn, detective!'?a:b,other=first===a?b:a;
 first.$('question').value='glasses';first.$('question').dispatchEvent(new first.w.Event('change'));await first.click('ask');
 await wait(()=>other.$('headline').textContent==='Your turn, detective!','next turn');
 await wait(()=>first.w.document.querySelectorAll('#clueList .clue').length===1,'own clue delivered');
 first.w.document.querySelector('[data-character="cleo"]').click();assert.equal(first.w.document.querySelectorAll('.person.down').length,1);
 assert.equal(other.w.document.querySelectorAll('.person.down').length,0);
 await first.click('undo');assert.equal(first.w.document.querySelectorAll('.person.down').length,0);
 await first.click('applyClues');assert.ok(first.w.document.querySelectorAll('.person.down').length>0);
 other.input('customText','Do they like <img src=x onerror="window.BAD=1">?');other.$('customForm').dispatchEvent(new other.w.Event('submit',{cancelable:true}));
 await wait(()=>!first.$('answerPanel').hidden,'answer prompt');assert.equal(first.$('pendingText').querySelector('img'),null);
 first.w.document.querySelector('[data-answer="unsure"]').click();await wait(()=>first.$('headline').textContent==='Your turn, detective!','answerer gets own turn');
 await wait(()=>!first.$('leave').disabled,'answer settled');
 first.w.document.querySelector('[data-mode="guess"]').click();first.w.document.querySelector(`[data-character="${first===a?'ben':'ada'}"]`).click();await first.confirm();
 await wait(()=>!a.$('result').hidden&&!b.$('result').hidden,'result');assert.equal(first.$('resultTitle').textContent,'You win! 🎉');
 assert.equal(a.$('reveals').children.length,2);assert.equal(first.w.BAD,undefined);
 await wait(()=>!a.$('rematch').disabled,'rematch enabled');await a.click('rematch');await wait(()=>a.$('rematch').disabled,'first vote');assert.equal(b.$('result').hidden,false);
 await b.click('rematch');await wait(()=>a.$('headline').textContent==='Pick your secret character','next round');
 assert.equal(a.w.document.querySelectorAll('.person.down').length,0);assert.equal((await server.model.load()).state.round,2);
});

test('Guess Who saves the seat and notebook, not secrets; failed leave preserves the saved room',async t=>{
 const {server,a,b}=await pair(t);
 b.w.document.querySelector('[data-character="wren"]').click();
 const saved=b.w.localStorage.getItem('arcade.guessWho.cloudflare.v1');
 assert.ok(saved);const value=JSON.parse(saved);assert.deepEqual(value.notes.down,['wren']);
 assert.equal(Object.hasOwn(value,'room'),false);assert.equal(saved.includes('myCharacterId'),false);assert.equal(saved.includes('secrets'),false);assert.equal(saved.includes('"ben"'),false);
 b.w.dispatchEvent(new b.w.Event('pagehide'));
 const restored=client(t,server,{storage:{'arcade.guessWho.cloudflare.v1':saved}});
 assert.equal(restored.$('resume').hidden,false);await restored.click('resume');await wait(()=>restored.$('setup').hidden,'resumed');
 assert.equal(restored.w.document.querySelectorAll('.person.down').length,1);
 await restored.click('mySecret');assert.equal(restored.$('modalTitle').textContent,'Your secret: Ben');await restored.click('modalClose');
 server.fail=true;await restored.click('leave');restored.w.document.querySelector('#modalActions button:last-child').click();
 await wait(()=>!restored.$('leave').disabled,'failed leave settled');assert.ok(restored.w.localStorage.getItem('arcade.guessWho.cloudflare.v1'));assert.equal(restored.$('setup').hidden,true);
 server.fail=false;restored.w.document.querySelector('#modalActions button:last-child').click();await wait(()=>!restored.$('setup').hidden,'leave');
 assert.equal(restored.w.localStorage.getItem('arcade.guessWho.cloudflare.v1'),null);assert.equal((await server.model.load()).result.type,'abandoned');
});

test('Guess Who ignores stale room snapshots and re-enables controls after a failed action',async t=>{
 const {server,a,b}=await pair(t);const active=a.$('headline').textContent==='Your turn, detective!'?a:b;
 const old=active.seen.at(-1);server.fail=true;active.$('question').value='hat';active.$('question').dispatchEvent(new active.w.Event('change'));await active.click('ask');
 await wait(()=>!active.$('ask').disabled,'retry control');assert.match(active.$('message').textContent,/outage/);
 server.fail=false;await active.click('ask');await wait(()=>active.$('headline').textContent!=='Your turn, detective!','asked');
 const newest=active.seen.at(-1),ws=server.sockets.find(s=>s.token===JSON.parse(active.w.localStorage.getItem('arcade.guessWho.cloudflare.v1')).session.token&&s.readyState===1);
 ws.onmessage({data:JSON.stringify({type:'state',room:old})});assert.equal(active.seen.at(-1).version,newest.version);assert.equal(active.$('ask').disabled,true);
});
