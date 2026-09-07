import test from 'node:test';
import assert from 'node:assert/strict';
import { Miniflare } from 'miniflare';
const ORIGIN='http://localhost:8787';
function headers(token){return {Origin:ORIGIN,'content-type':'application/json',...(token?{authorization:`Bearer ${token}`}:{})};}
function message(ws,predicate){return new Promise((resolve,reject)=>{const timeout=setTimeout(()=>{ws.removeEventListener('message',receive);reject(new Error('Missing Guess Who WebSocket update'));},3000);function receive(e){const data=JSON.parse(e.data);if(predicate(data)){clearTimeout(timeout);ws.removeEventListener('message',receive);resolve(data);}}ws.addEventListener('message',receive);});}
function miniflare(){const root=new URL('../../../',import.meta.url);return new Miniflare({modulesRoot:root.pathname,modules:['cloudflare/chess-worker/src/index.js','multiplayer/models/room-model.js','multiplayer/models/generic-room-model.js','multiplayer/models/guess-who-authority.js','multiplayer/models/guess-who-data.js','multiplayer/models/chess-engine.js'].map(path=>({type:'ESModule',path:new URL(path,root).pathname})),compatibilityDate:'2026-08-06',compatibilityFlags:['nodejs_compat'],bindings:{ALLOWED_ORIGINS:ORIGIN},durableObjects:{ARCADE_ROOMS:{className:'ArcadeRoom',useSQLite:true}}});}

test('Guess Who Durable Object: private HTTP/WS views, action authority, reconnect and mutual rematch',async t=>{
 const mf=miniflare();t.after(()=>mf.dispose());
 const call=async(path,body,token)=>{const r=await mf.dispatchFetch('http://worker/api/arcade/rooms'+path,{method:body===undefined?'GET':'POST',headers:headers(token),...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:r.status,...await r.json()};};
 const a=await call('',{game:'guess-who',username:'Alice'});assert.equal(a.status,200);
 const b=await call(`/${a.code}/join`,{username:'Bob'});assert.equal(b.status,200);
 let version=b.room.version;
 const act=async(who,type,extra={})=>{const r=await call(`/${a.code}/actions`,{type,expectedVersion:version,...extra},who.token);if(r.ok)version=r.room.version;return r;};
 assert.equal((await act(a,'start')).ok,true);
 async function socket(who){const r=await mf.dispatchFetch(`http://worker/api/arcade/rooms/${a.code}/ws?token=${who.token}`,{headers:{Origin:ORIGIN,Upgrade:'websocket'}});assert.equal(r.status,101);const ws=r.webSocket;ws.accept();await message(ws,d=>d.type==='state');t.after(()=>ws.close());return ws;}
 const sa=await socket(a),sb=await socket(b);
 const hidden=message(sb,d=>d.type==='state'&&d.room.state.ready.length===1);
 await act(a,'choose',{characterId:'ada'});
 const privateView=(await hidden).room;
 assert.equal(privateView.state.myCharacterId,null);assert.equal(privateView.state.revealed,null);
 assert.equal(JSON.stringify(privateView).includes('ada'),false);assert.equal('secrets' in privateView.state,false);
 const hostView=message(sa,d=>d.type==='state'&&d.room.state.phase==='playing');
 const chosen=await act(b,'choose',{characterId:'ben'});assert.equal(chosen.ok,true);
 assert.equal(JSON.stringify((await hostView).room).includes('ben'),false);
 const owner=chosen.room.turn.playerId===a.playerId?a:b,ownerSocket=owner===a?sa:sb;
 const denied=message(ownerSocket,d=>d.type==='error');
 ownerSocket.send(JSON.stringify({type:'state',state:{secrets:{},phase:'finished'},expectedVersion:version}));
 assert.equal((await denied).status,400);
 const before=(await call(`/${a.code}/state`,undefined,a.token)).room;
 assert.equal(before.version,version);assert.equal(before.status,'active');
 const finishedA=message(sa,d=>d.type==='state'&&d.room.status==='finished');
 const finishedB=message(sb,d=>d.type==='state'&&d.room.status==='finished');
 ownerSocket.send(JSON.stringify({type:'guess',characterId:owner===a?'ben':'ada',expectedVersion:version}));
 const [va,vb]=await Promise.all([finishedA,finishedB]);version=va.room.version;
 assert.equal(va.room.result.winnerPlayerId,owner.playerId);assert.equal(vb.room.state.revealed[a.playerId],'ada');
 const reconnect=await call(`/${a.code}/join`,{reconnectToken:b.token});
 assert.equal(reconnect.playerId,b.playerId);assert.equal(reconnect.room.state.myCharacterId,'ben');
 assert.equal((await call(`/${a.code}/state`,undefined,'invalid')).status,401);
 await act(a,'rematch');assert.equal((await call(`/${a.code}/state`,undefined,b.token)).room.status,'finished');
 const restarted=await act(b,'rematch');assert.equal(restarted.room.state.phase,'selecting');assert.equal(restarted.room.state.round,2);
 assert.equal(restarted.room.state.myCharacterId,null);assert.equal(restarted.room.state.revealed,null);assert.equal(restarted.room.state.scores[owner.playerId],1);
});

test('Guess Who Durable Object serializes simultaneous stale selections',async t=>{
 const mf=miniflare();t.after(()=>mf.dispose());
 const call=async(path,body,token)=>{const r=await mf.dispatchFetch('http://worker/api/arcade/rooms'+path,{method:'POST',headers:headers(token),body:JSON.stringify(body)});return {status:r.status,...await r.json()};};
 const a=await call('',{game:'guess-who',username:'A'}),b=await call(`/${a.code}/join`,{username:'B'});
 const started=await call(`/${a.code}/actions`,{type:'start',expectedVersion:b.room.version},a.token);
 const answers=await Promise.all([call(`/${a.code}/actions`,{type:'choose',characterId:'ada',expectedVersion:started.room.version},a.token),call(`/${a.code}/actions`,{type:'choose',characterId:'ben',expectedVersion:started.room.version},b.token)]);
 assert.deepEqual(answers.map(r=>r.status).sort(),[200,409]);
});
