import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

function fixture(handler,settings={}){
  const events=new Map(),statuses=[];
  const scope={module:{exports:{}},setTimeout:()=>1,clearTimeout(){},setInterval:()=>1,navigator:{onLine:true},addEventListener:(type,callback)=>events.set(type,callback)};scope.globalThis=scope;
  runInNewContext(readFileSync(new URL('../shared-room-client.js',import.meta.url),'utf8'),scope);
  const sockets=[],values=new Map();
  class Socket{constructor(){this.readyState=0;sockets.push(this);}close(){this.readyState=3;}send(){}}
  const response=(body,status=200)=>({ok:status<400,status,json:async()=>body});
  const room=(code,version=1)=>({game:'shared-activity',code,status:'active',version,revision:version,state:{activity:'typing'},
    members:[{playerId:code,seat:0,username:'Host'}],turn:{playerId:code,seat:0}});
  const joined=(code,version=1)=>({ok:true,code,token:code.repeat(6),playerId:code,seat:0,room:room(code,version)});
  const client=scope.module.exports.createRoomClient({game:'shared-activity',activity:'typing',
    storage:{getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)},WebSocket:Socket,
    fetch:async(url,options)=>await handler({url,options,response,room,joined}),onStatus:status=>statuses.push(status),...settings});
  return{client,sockets,events,statuses,scope};
}

test('a delayed room refresh cannot reactivate a session after leaving',async()=>{
  const scope={module:{exports:{}},setTimeout:()=>1,clearTimeout(){},setInterval:()=>1};
  scope.globalThis=scope;
  runInNewContext(readFileSync(new URL('../shared-room-client.js',import.meta.url),'utf8'),scope);
  const room={game:'shared-activity',code:'ABC234',status:'active',version:1,revision:1,
    state:{activity:'typing'},members:[{playerId:'host',seat:0,username:'Host'}],turn:{playerId:'host',seat:0}};
  const response=body=>({ok:true,status:200,json:async()=>body});
  let finishRefresh,updates=0;
  class Socket{constructor(){this.readyState=0;}close(){this.readyState=3;}}
  const storage={getItem:()=>null,setItem(){},removeItem(){}};
  const client=scope.module.exports.createRoomClient({game:'shared-activity',activity:'typing',storage,WebSocket:Socket,
    onRoom:()=>updates++,fetch:async(url,options)=>{
      if(url.endsWith('/state'))return await new Promise(resolve=>{finishRefresh=()=>resolve(response({ok:true,room:{...room,version:2}}));});
      if(url.endsWith('/actions')){assert.equal(JSON.parse(options.body).type,'leave');return response({ok:true,room:null});}
      return response({ok:true,code:'ABC234',token:'token'.repeat(8),playerId:'host',seat:0,room});
    }});
  await client.create({username:'Host'});
  const pending=client.refresh();
  await client.leave();
  finishRefresh();await pending;
  assert.equal(updates,1,'Only the original joined room is delivered');
  assert.equal(client.session,null);
  assert.equal(client.room,null);
});

test('a late leave response cannot forget a replacement room or its saved credential',async()=>{
  for(const status of [200,403]){
    let finishLeave;
    const{client}=fixture(({url,response,joined})=>{
      if(url.endsWith('/actions'))return new Promise(resolve=>{finishLeave=()=>resolve(response(status===200?{ok:true,room:null}:{ok:false,error:'Old token expired'},status));});
      return response(joined(url.endsWith('/join')?'ABC235':'ABC234',url.endsWith('/join')?1:100));
    });
    await client.create({username:'Host'});
    const leaving=client.leave();
    await client.join({username:'Host',code:'ABC235'});
    finishLeave();await leaving;
    assert.equal(client.session.code,'ABC235');assert.equal(client.saved().code,'ABC235');
    assert.equal(client.room.code,'ABC235','A lower-version replacement room replaces the old high-version room');
    client.disconnect();
  }
});

test('late actions and old socket callbacks cannot overwrite or interrupt the replacement room',async()=>{
  let finishAction;
  const{client,sockets}=fixture(({url,response,room,joined})=>{
    if(url.endsWith('/actions'))return new Promise(resolve=>{finishAction=()=>resolve(response({ok:true,room:room('ABC234',999)}));});
    return response(joined(url.endsWith('/join')?'ABC235':'ABC234'));
  });
  await client.create({username:'Host'});
  const oldMessage=sockets[0].onmessage,oldClose=sockets[0].onclose;
  const previousAction=client.action({type:'state',state:{}});
  await client.join({username:'Host',code:'ABC235'});
  finishAction();await previousAction;
  assert.equal(client.room.code,'ABC235');
  const latest=sockets.at(-1);latest.readyState=1;latest.onopen();
  const currentAction=client.action({type:'state',state:{}});
  oldMessage({data:JSON.stringify({type:'state',room:{code:'ABC234',version:1000}})});oldClose();
  latest.onmessage({data:JSON.stringify({type:'ack',version:2})});
  await currentAction;
  assert.equal(client.room.code,'ABC235');assert.equal(client.session.code,'ABC235');
  client.disconnect();
});

test('a cancelled pending join cannot reopen the room later',async()=>{
  let finishCreate;
  const{client}=fixture(({response,joined})=>new Promise(resolve=>{finishCreate=()=>resolve(response(joined('ABC234')));}));
  const pending=client.create({username:'Host'});
  client.forget();finishCreate();
  await assert.rejects(pending,/cancelled or replaced/);
  assert.equal(client.session,null);assert.equal(client.room,null);assert.equal(client.saved(),null);
});

test('native offline and online events immediately pause and reconnect the retained Internet room',async()=>{
  const{client,sockets,events,statuses,scope}=fixture(({response,joined})=>response(joined('ABC234')));
  await client.create({username:'Host'});sockets[0].readyState=1;sockets[0].onopen();
  scope.navigator.onLine=false;events.get('offline')();
  assert.equal(sockets[0].readyState,3);assert.equal(statuses.at(-1).kind,'offline');
  assert.equal(client.saved().code,'ABC234');
  scope.navigator.onLine=true;events.get('online')();
  assert.equal(sockets.length,2);sockets[1].readyState=1;sockets[1].onopen();
  assert.equal(statuses.at(-1).kind,'connected');assert.equal(client.session.code,'ABC234');
  client.disconnect();
});

test('native Internet offline events leave a pinned Nearby room and its socket active',async()=>{
  const{client,sockets,events,statuses,scope}=fixture(({response,joined})=>response(joined('ABC234')),
    {multiplayer:{getStatus:()=>({effectiveTransport:'nearby'})}});
  await client.create({username:'Host'});sockets[0].readyState=1;sockets[0].onopen();
  assert.equal(client.session.transport,'nearby');
  scope.navigator.onLine=false;events.get('offline')();
  assert.equal(sockets[0].readyState,1);assert.equal(statuses.at(-1).kind,'connected');
  scope.navigator.onLine=true;events.get('online')();
  assert.equal(sockets.length,1);assert.equal(client.session.code,'ABC234');
  client.disconnect();
});
