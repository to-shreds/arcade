import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { webcrypto } from 'node:crypto';
import { GenericRoomModel } from './generic-room-model.js';
import { MemoryStorage } from './room-model.js';
import { validateSharedCheckpoint, validateSharedActivityAction, SHARED_ACTIVITY_AUTHORITY } from './shared-activity-validator.js';
import { NearbyRoomService } from '../nearby-room-service.js';
import { NearbyArcadeSession } from '../nearby-session.mjs';
import { MemoryNearbyStorage } from '../nearby-storage.mjs';
const state=(activity='typing',sequence=0)=>({schema:1,activity,codec:'json',data:'{"snapshot":null}',decodedBytes:17,sequence});
async function setup(){
  const model=new GenericRoomModel(new MemoryStorage());
  const host=await model.create({code:'ABC234',game:'shared-activity',username:'Alice',state:state()});
  const active=await model.act(host.token,{type:'start',state:state(),expectedVersion:host.room.version});
  const guest=await model.join({username:'Bob'});
  return{model,host,guest,active};
}
test('shared activities permit late joining and retained-token reconnect, and publish only from the controller',async()=>{
  const{model,host,guest}=await setup();
  assert.equal(guest.room.status,'active');
  assert.equal((await model.join({reconnectToken:guest.token})).playerId,guest.playerId);
  await assert.rejects(model.act(guest.token,{type:'state',state:state('typing',1),expectedVersion:guest.room.version}),e=>e.status===422);
  const update=await model.act(host.token,{type:'state',state:state('typing',1),nextSeat:guest.seat,expectedVersion:guest.room.version});
  assert.equal(update.turn.playerId,guest.playerId);
  const observed=await model.state(guest.token);assert.deepEqual(observed.state,update.state);
  await assert.rejects(model.act(host.token,{type:'state',state:state('typing',2),expectedVersion:update.version}),e=>e.status===422);
  const back=await model.act(guest.token,{type:'state',state:state('typing',2),nextSeat:host.seat,expectedVersion:update.version});
  assert.equal(back.turn.playerId,host.playerId);
});
test('wrong-activity joining is rejected before allocating a seat or changing saved room state',async()=>{
  const{model,host}=await setup();
  const before=await model.load();
  await assert.rejects(model.join({username:'Wrong room',activity:'bowling'}),e=>e.status===409);
  await assert.rejects(model.join({reconnectToken:host.token,activity:'bowling'}),e=>e.status===409);
  assert.deepEqual(await model.load(),before);
});
test('control takeover requires the current controller to be disconnected',async()=>{
  const{model,host,guest}=await setup();
  await assert.rejects(model.act(guest.token,{type:'claim-controls',expectedVersion:guest.room.version},new Set([host.playerId,guest.playerId])),e=>e.status===409);
  const takeover=await model.act(guest.token,{type:'claim-controls',expectedVersion:guest.room.version},new Set([guest.playerId]));
  assert.equal(takeover.turn.playerId,guest.playerId);
  assert.equal(takeover.state.sequence,0);
});
test('shared checkpoints cannot change activities, undo sequence, fabricate competitive results or exceed transport bounds',async()=>{
  const{model,host,guest}=await setup();
  await assert.rejects(model.act(host.token,{type:'state',state:state('maze',1),expectedVersion:guest.room.version}),e=>e.status===422);
  await assert.rejects(model.act(host.token,{type:'state',state:state('typing',1),finish:true,result:{winner:'Alice'},expectedVersion:guest.room.version}),e=>e.status===422);
  const update=await model.act(host.token,{type:'state',state:state('typing',2),expectedVersion:guest.room.version});
  await assert.rejects(model.act(host.token,{type:'state',state:state('typing',1),expectedVersion:update.version}),e=>e.status===422);
  assert.throws(()=>validateSharedCheckpoint({...state(),decodedBytes:9*1024*1024}),/decoded size/);
  assert.throws(()=>validateSharedCheckpoint({...state(),data:'a'.repeat(53*1024)}),/transport limit/);
  assert.throws(()=>validateSharedCheckpoint({...state(),codec:'gzip',data:'<script>'}),/compressed checkpoint/);
  assert.equal(validateSharedActivityAction(await model.load(),{playerId:host.playerId},{type:'leave'}),SHARED_ACTIVITY_AUTHORITY);
  assert.equal(SHARED_ACTIVITY_AUTHORITY.completionVerified,false);
});
test('controller departure transfers controls without abandoning an active shared activity',async()=>{
  const{model,host,guest}=await setup();
  const left=await model.act(host.token,{type:'leave'});
  assert.equal(left.status,'active');assert.equal(left.turn.playerId,guest.playerId);
  const end=await model.act(guest.token,{type:'leave'});
  assert.equal(end.status,'finished');
  await assert.rejects(model.join({username:'Cara'}),e=>e.status===410);
});

test('sustained small and maximum shared checkpoints stay within actual Nearby message and byte guards',async()=>{
  // Exercise the browser's actual pacing function and serialize service output
  // through the real Nearby envelope encoder, including the controller RPC ack.
  const window={location:{pathname:'/typing/'},setTimeout,clearTimeout,setInterval,clearInterval,
    requestAnimationFrame:()=>1,cancelAnimationFrame:()=>{}};
  runInNewContext(readFileSync(new URL('../shared-activity.js',import.meta.url),'utf8'),{
    window,Storage:class{setItem(){}removeItem(){}},document:{readyState:'loading',addEventListener(){}}
  });
  const pacing=window.ArcadeSharedActivity.getPublishDelay;
  assert.equal(pacing('cloudflare',50*1024),120);
  for(const dataBytes of [1024,50*1024-100]){
    let clock=0;
    const transport=new NearbyArcadeSession({storage:new MemoryNearbyStorage({cryptoObject:webcrypto}),cryptoObject:webcrypto,now:()=>clock,
      setIntervalFn:()=>1,clearIntervalFn:()=>{},setTimeoutFn:setTimeout,clearTimeoutFn:clearTimeout});
    const packets=[];
    const peer={channel:{readyState:'open',bufferedAmount:0,send:packet=>packets.push({at:clock,bytes:Buffer.byteLength(packet)})}};
    const inbound={};
    const service=new NearbyRoomService({cryptoObject:webcrypto,onEvent:event=>{
      if(event.type==='socket-message'&&event.targetMemberId==='member_guest')transport._sendRecord(peer,'room-ws-message',{socketId:event.socketId,data:event.data});
    }});
    for(const [memberId,nickname] of [['member_host','Host'],['member_guest','Guest']])await service.registerMember({memberId,nickname,avatar:'🙂',color:'#AA3355'});
    const checkpoint=sequence=>({schema:1,activity:'typing',codec:'json',data:JSON.stringify({snapshot:{text:'x'.repeat(dataBytes),sequence}}),decodedBytes:dataBytes+50,sequence});
    const http=(memberId,url,body,token)=>service.handleHttp(memberId,{url,method:'POST',headers:token?{authorization:'Bearer '+token}:{},body:JSON.stringify(body)});
    const created=await http('member_host','/api/arcade/rooms',{game:'shared-activity',maxPlayers:2,state:checkpoint(0)});
    assert.equal(created.status,200);
    const code=created.body.code;
    const joined=await http('member_guest',`/api/arcade/rooms/${code}/join`,{activity:'typing'});
    const started=await http('member_host',`/api/arcade/rooms/${code}/actions`,{type:'start',expectedVersion:joined.body.room.version,state:checkpoint(0),firstSeat:joined.body.seat},created.body.token);
    assert.equal(started.status,200);
    await service.openSocket('member_host',{socketId:'socket_host',url:`/api/arcade/rooms/${code}/ws?token=${created.body.token}`});
    await service.openSocket('member_guest',{socketId:'socket_guest',url:`/api/arcade/rooms/${code}/ws?token=${joined.body.token}`});
    packets.length=0;
    let version=started.body.room.version,sequence=0;
    while(clock<20_000){
      const current=checkpoint(++sequence);
      const result=await service.sendSocket('member_guest',{socketId:'socket_guest',data:JSON.stringify({type:'state',state:current,nextSeat:joined.body.seat,expectedVersion:version})});
      assert.equal(result.rejected,undefined);
      version=result.version;
      transport._sendRecord(peer,'room-rpc-result',{requestId:'request_'+'a'.repeat(30),ok:true,result});
      for(const packet of packets.filter(packet=>packet.at===clock))assert.equal(transport._acceptInboundTraffic(inbound,'guest',packet.bytes),true);
      clock+=pacing('nearby',Buffer.byteLength(JSON.stringify(current)));
    }
    for(const start of [0,10_000]){
      const windowPackets=packets.filter(packet=>packet.at>=start&&packet.at<start+10_000);
      assert.ok(windowPackets.length+10<=160,`${dataBytes}-byte snapshots leave room for heartbeat messages`);
      assert.ok(windowPackets.reduce((sum,packet)=>sum+packet.bytes,0)+16*1024<=2*1024*1024,`${dataBytes}-byte snapshots leave room for presence and heartbeat bytes`);
      assert.ok(windowPackets.every(packet=>packet.bytes<=64*1024),'every encoded message fits the data channel');
    }
  }
});
