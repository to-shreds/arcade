'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createRoomClient}=require('./room-client.js');
const {sanitizeMemorySnapshot}=require('./online-model.js');

function storage(initial){
  const data=new Map(Object.entries(initial||{}));
  return {getItem:key=>data.has(key)?data.get(key):null,setItem:(key,value)=>data.set(key,String(value)),removeItem:key=>data.delete(key),has:key=>data.has(key)};
}
function response(status,body){return {ok:status>=200&&status<300,status,json:async()=>body};}
class FakeWebSocket{
  static instances=[];
  constructor(url){this.url=url;this.readyState=0;FakeWebSocket.instances.push(this);}
  close(){this.readyState=3;if(this.onclose)this.onclose();}
  open(){this.readyState=1;if(this.onopen)this.onopen();}
  message(value){if(this.onmessage)this.onmessage({data:JSON.stringify(value)});}
}

function room(overrides){return Object.assign({code:'ABC234',game:'memory',version:1,revision:1,status:'lobby',ready:false,hostPlayerId:'p0',playerId:'p0',seat:0,members:[{playerId:'p0',seat:0,username:'Ada',connected:true}],turn:null,state:null},overrides||{});}

async function adapterTests(){
  const calls=[];
  const store=storage();
  let currentRoom=room();
  let transportResets=0;
  const multiplayer={getStatus:()=>({effectiveTransport:'nearby'}),pinRoomTransport:value=>value,resetRoomTransport:()=>{transportResets++;}};
  const fetch=async(url,init={})=>{
    const body=init.body?JSON.parse(init.body):null;calls.push({url,init,body});
    if(url.endsWith('/api/arcade/rooms'))return response(200,{ok:true,code:'ABC234',token:'abcdefghijklmnopqrstuvwx',playerId:'p0',seat:0,room:currentRoom});
    if(url.endsWith('/actions')&&body.type==='state'){currentRoom=room({version:2,revision:2,status:'active',ready:true,turn:{seat:1},state:body.state});return response(200,{ok:true,room:currentRoom});}
    if(url.endsWith('/actions')&&body.type==='leave')return response(200,{ok:true,room:room({version:3,revision:3,members:[]})});
    throw new Error('unexpected '+url);
  };
  const seen=[];
  const client=createRoomClient({game:'memory',storage:store,fetch,WebSocket:FakeWebSocket,multiplayer,onRoom:value=>seen.push(value)});
  await client.create({username:'  Ada  ',maxPlayers:4});
  assert.equal(calls[0].body.game,'memory');
  assert.equal(calls[0].body.username,'Ada');
  assert.equal(calls[0].body.maxPlayers,4);
  assert.equal(client.session.seat,0,'host seat zero must survive');
  assert.equal(JSON.parse(store.getItem('arcade_room_memory_v1')).transport,'nearby','new room persists its selected authority');
  FakeWebSocket.instances.at(-1).open();
  await client.action({type:'state',state:{board:'snapshot'},nextSeat:1});
  assert.equal(calls.at(-1).body.expectedVersion,1,'game action uses gameplay CAS version');
  const socket=FakeWebSocket.instances.at(-1);
  const before=seen.length;
  socket.message({type:'state',room:room({version:2,revision:1,status:'active'})});
  assert.equal(seen.length,before,'older revision at same/lower game version is ignored');
  socket.message({type:'state',room:room({version:2,revision:3,status:'active'})});
  assert.equal(seen.length,before+1,'newer revision is accepted');
  await client.leave();
  assert.deepEqual(calls.at(-1).body,{type:'leave'},'leave has no stale expectedVersion');
  assert.equal(store.has('arcade_room_memory_v1'),false,'successful leave forgets reconnect token');
  assert.equal(transportResets,1,'successful leave releases the room authority pin');
  client.disconnect();

  const seeded=storage({'arcade_room_memory_v1':JSON.stringify({code:'ABC234',token:'abcdefghijklmnopqrstuvwx',playerId:'p0',seat:0,username:'Ada'})});
  const resumeCalls=[];
  const resumeClient=createRoomClient({game:'memory',storage:seeded,WebSocket:FakeWebSocket,fetch:async(url,init={})=>{
    resumeCalls.push({url,body:init.body?JSON.parse(init.body):null});
    return response(200,{ok:true,code:'ABC234',token:'abcdefghijklmnopqrstuvwx',playerId:'p0',seat:0,room:room()});
  }});
  assert.equal(resumeCalls.length,0,'saved room never auto-connects over the local setup');
  await resumeClient.resume();
  assert.equal(resumeCalls[0].body.reconnectToken,'abcdefghijklmnopqrstuvwx');
  FakeWebSocket.instances.at(-1).open();resumeClient.disconnect();

  const secureEvents=[];
  const secured=storage({'arcade_room_memory_v1':JSON.stringify({code:'ABC234',token:'abcdefghijklmnopqrstuvwx',playerId:'p0',seat:0,username:'Ada',transport:'nearby'})});
  const secureClient=createRoomClient({game:'memory',storage:secured,WebSocket:FakeWebSocket,multiplayer:{
    getStatus:()=>({effectiveTransport:'cloudflare'}),
    pinRoomTransport(value){secureEvents.push('pin:'+value);return value;},
    resetRoomTransport(){secureEvents.push('reset');}
  },fetch:async()=>{secureEvents.push('fetch');return response(200,{ok:true,code:'ABC234',token:'abcdefghijklmnopqrstuvwx',playerId:'p0',seat:0,room:room()});}});
  await secureClient.resume();
  assert.deepEqual(secureEvents.slice(0,2),['pin:nearby','fetch'],'saved authority is restored before reconnect credentials are sent');
  assert.equal(secureClient.session.transport,'nearby');
  secureClient.disconnect();

  const blockedStore=storage({'arcade_room_memory_v1':JSON.stringify({code:'ABC234',token:'internet-room-reconnect-token',playerId:'p0',seat:0,username:'Ada',transport:'cloudflare'})});
  let blockedFetches=0,blockedSockets=FakeWebSocket.instances.length;
  const blockedClient=createRoomClient({game:'memory',storage:blockedStore,WebSocket:FakeWebSocket,multiplayer:{
    getStatus:()=>({effectiveTransport:'nearby'}),
    pinRoomTransport(){const error=new Error('Disconnect Nearby Arcade to resume this Internet room.');error.status=409;throw error;}
  },fetch:async()=>{blockedFetches++;return response(500,{ok:false});}});
  await assert.rejects(blockedClient.resume(),/Disconnect Nearby Arcade to resume this Internet room\./);
  assert.equal(blockedFetches,0,'blocked saved Internet resume sends no reconnect token by fetch');
  assert.equal(FakeWebSocket.instances.length,blockedSockets,'blocked saved Internet resume opens no socket');
  assert.equal(blockedClient.saved().token,'internet-room-reconnect-token','blocked resume preserves the saved reconnect session');
  blockedClient.disconnect();

  const retained=storage();
  let failLeave=false;
  const transient=createRoomClient({game:'memory',storage:retained,WebSocket:FakeWebSocket,fetch:async(url,init={})=>{
    const body=init.body?JSON.parse(init.body):null;
    if(body&&body.type==='leave'&&failLeave)return response(503,{ok:false,error:'try later'});
    return response(200,{ok:true,code:'ABC234',token:'abcdefghijklmnopqrstuvwx',playerId:'p0',seat:0,room:room()});
  }});
  await transient.create({username:'Ada',maxPlayers:2});FakeWebSocket.instances.at(-1).open();failLeave=true;
  await assert.rejects(transient.leave(),/try later/);
  assert.ok(transient.saved(),'transient leave failure retains reconnect seat');
  transient.disconnect();

  const terminalStore=storage();let terminalResets=0;
  const terminal=createRoomClient({game:'memory',storage:terminalStore,WebSocket:FakeWebSocket,multiplayer:{getStatus:()=>({effectiveTransport:'cloudflare'}),resetRoomTransport(){terminalResets++;}},fetch:async(url,init={})=>{
    const body=init.body?JSON.parse(init.body):null;
    if(body&&body.type==='leave')return response(403,{ok:false,error:'seat already gone'});
    return response(200,{ok:true,code:'ABC234',token:'abcdefghijklmnopqrstuvwx',playerId:'p0',seat:0,room:room()});
  }});
  await terminal.create({username:'Ada',maxPlayers:2});
  await terminal.leave();
  assert.equal(terminal.saved(),null,'terminal leave response forgets an already-missing seat');
  assert.equal(terminalResets,1,'terminal leave response releases the stale authority pin');
}

function stateTests(){
  const stats=()=>({matches:0,attempts:0,misses:0,flips:0,curStreak:0,longestStreak:0,totalDecision:0,decisionCount:0,mismatchPairCounts:{},bestRepeat:0});
  const valid={schema:1,players:2,seatOrder:[0,1],cols:2,rows:2,matchSize:2,totalMatches:2,
    deck:[{id:'a0',key:'🐶',emoji:'🐶'},{id:'b0',key:'🐱',emoji:'🐱'},{id:'a1',key:'🐶',emoji:'🐶'},{id:'b1',key:'🐱',emoji:'🐱'}],
    matchedKeys:[],owners:[0,0,0,0],scores:[0,0],moves:0,tElapsed:0,stats:[stats(),stats()]};
  assert.ok(sanitizeMemorySnapshot(valid,2));
  assert.equal(sanitizeMemorySnapshot(Object.assign({},valid,{scores:['<img src=x onerror=alert(1)>',0]}),2),null,'HTML score payload is rejected');
  assert.equal(sanitizeMemorySnapshot(Object.assign({},valid,{owners:[999,0,0,0]}),2),null,'huge owner is rejected');
  assert.equal(sanitizeMemorySnapshot(Object.assign({},valid,{matchedKeys:['__proto__']}),2),null,'unknown/prototype key is rejected');
  assert.equal(sanitizeMemorySnapshot(Object.assign({},valid,{seatOrder:[0,0]}),2),null,'duplicate server seats are rejected');
  assert.equal(sanitizeMemorySnapshot(Object.assign({},valid,{deck:valid.deck.concat({id:'x',key:'x',emoji:'x'})}),2),null,'oversized deck is rejected');
  const won=JSON.parse(JSON.stringify(valid));
  won.matchedKeys=['🐶'];won.owners=[1,0,1,0];won.scores=[1,0];won.stats[0].matches=1;won.stats[0].attempts=1;won.stats[0].flips=2;
  assert.ok(sanitizeMemorySnapshot(won,2),'coherent scored state is accepted');
  const missed=JSON.parse(JSON.stringify(valid));
  missed.moves=1;missed.turn=2;
  Object.assign(missed.stats[0],{attempts:1,misses:1,flips:2,totalDecision:19.875,decisionCount:1,mismatchPairCounts:{'🐶|🐱':1},bestRepeat:1});
  const cleanedMiss=sanitizeMemorySnapshot(missed,2);
  assert.ok(cleanedMiss,'a real performance.now() duration is normalized instead of rejecting the turn');
  assert.equal(cleanedMiss.stats[0].totalDecision,19,'fractional timing is serialized as an integer');
  assert.deepEqual(Object.assign({},cleanedMiss.stats[0].mismatchPairCounts),{'🐶|🐱':1},'mismatch history survives authoritative hydration');
  const polluted=JSON.parse(JSON.stringify(missed));
  polluted.stats[0].mismatchPairCounts={constructor:1};
  assert.equal(sanitizeMemorySnapshot(polluted,2),null,'prototype-sensitive mismatch keys are rejected');
  const neutral=JSON.parse(JSON.stringify(valid));
  neutral.matchedKeys=['🐶'];neutral.owners=[0,0,0,0];
  assert.ok(sanitizeMemorySnapshot(neutral,2),'a departed player’s matched cards may remain neutral');
}

function sourceTests(){
  const html=fs.readFileSync(path.join(__dirname,'index.html'),'utf8');
  assert.match(html,/PLAY ON THIS DEVICE/,'local setup remains available');
  assert.match(html,/Multiplayer rooms support 2–4 players/,'multiplayer seat limit is explicit');
  assert.match(html,/Math\.min\(4, parseInt\(playersSel\.value/,'5-8 local selection is clamped to backend online limit');
  assert.match(html,/Math\.min\(4, members\.length\)/,'host snapshot uses actual joined members, capped safely');
  assert.match(html,/seatForLocalTurn\(onlineRoom, state\.turn\)/,'local turn maps through actual occupied server seats');
  assert.match(html,/Number\(session\.seat\) !== Number\(onlineRoom\.turn\.seat\)/,'server seat gates card input');
  assert.match(html,/roomClient\.leave\(\)/,'explicit leave reaches backend');
  assert.match(html,/Math\.floor\(Number\(item\.totalDecision\)/,'outgoing online timings are integer-normalized');
  assert.doesNotMatch(html,/row\.innerHTML\s*=/,'remote-derived final rows never use innerHTML');
}

(async()=>{await adapterTests();stateTests();sourceTests();console.log('Memory online tests passed.');})().catch(error=>{console.error(error);process.exitCode=1;});
