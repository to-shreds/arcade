import test from 'node:test';
import assert from 'node:assert/strict';
import { NearbyRoomService } from '../nearby-room-service.js';
import { SHARED_ACTIVITY_IDS } from './shared-activity-validator.js';

const identity = index => ({memberId:`stress_member_${index}`,nickname:`Player ${index + 1}`,avatar:'🐞',color:'#33AA55'});
const checkpoint = (activity, sequence, text = 'A saved local game') => {
  const data = JSON.stringify({snapshot:{text},view:[],frames:[]});
  return {schema:1,activity,codec:'json',data,decodedBytes:Buffer.byteLength(data),sequence};
};
const request = (service, index, url, body, token = null) => service.handleHttp(identity(index).memberId, {
  url,method:body === undefined ? 'GET' : 'POST',
  headers:token ? {authorization:`Bearer ${token}`} : {},
  ...(body === undefined ? {} : {body:JSON.stringify(body)})
});

test('every shared activity preserves accepted state under concurrent input, malformed actions and an eight-seat control pass', async t => {
  let rejectedActions = 0;
  for (const activity of SHARED_ACTIVITY_IDS) {
    const events = [];
    const service = new NearbyRoomService({onEvent:event=>events.push(event)});
    for (let index=0;index<9;index++) await service.registerMember(identity(index));
    const created = await request(service,0,'/api/arcade/rooms',{game:'shared-activity',maxPlayers:8,state:checkpoint(activity,0)});
    assert.equal(created.status,200,activity);
    const code = created.body.code, path = `/api/arcade/rooms/${code}`, seats = [created.body];
    for (let index=1;index<8;index++) {
      const joined = await request(service,index,`${path}/join`,{activity});
      assert.equal(joined.status,200,activity); seats.push(joined.body);
    }
    const full = await request(service,8,`${path}/join`,{activity});
    assert.equal(full.status,409,activity);
    let room = (await request(service,0,`${path}/state`,undefined,seats[0].token)).body.room;
    const started = await request(service,0,`${path}/actions`,{type:'start',expectedVersion:room.version,state:checkpoint(activity,0)},seats[0].token);
    assert.equal(started.status,200,activity); room = started.body.room;
    for (let index=0;index<8;index++) await service.openSocket(identity(index).memberId,{socketId:`stress_socket_${index}`,url:`${path}/ws?token=${seats[index].token}`});

    // All these requests begin from the same accepted version. Exactly one may
    // change authority, and the losing requests must leave the room untouched.
    const race = await Promise.all(Array.from({length:20},(_,index)=>request(service,0,`${path}/actions`,{
      type:'state',expectedVersion:room.version,state:checkpoint(activity,1,`Accepted candidate ${index}`),nextSeat:1
    },seats[0].token)));
    assert.equal(race.filter(result=>result.status===200).length,1,activity);
    assert.equal(race.filter(result=>result.status===409).length,19,activity);
    rejectedActions += 19;
    room = (await request(service,1,`${path}/state`,undefined,seats[1].token)).body.room;
    assert.equal(room.turn.playerId,seats[1].playerId,activity);
    const accepted = structuredClone(room);
    const invalid = [
      null, [], {}, {type:'unknown',expectedVersion:room.version},
      {type:'state',expectedVersion:room.version,state:null},
      {type:'state',expectedVersion:room.version,state:checkpoint(activity,0)},
      {type:'state',expectedVersion:room.version,state:checkpoint(activity,2),nextSeat:9},
      {type:'state',expectedVersion:room.version,state:checkpoint(activity,2),finish:true,result:{winner:'Player 2'}},
      {type:'state',expectedVersion:room.version,state:{...checkpoint(activity,2),activity:'unlisted-game'}},
      {type:'state',expectedVersion:room.version,state:{...checkpoint(activity,2),data:'x'.repeat(53*1024)}},
      {type:'state',expectedVersion:room.version,state:checkpoint(activity,2),playerId:seats[0].playerId},
      {type:'claim-controls',expectedVersion:room.version}
    ];
    for (const action of invalid) {
      const actor = action?.type==='claim-controls' ? 0 : 1;
      const result = await request(service,actor,`${path}/actions`,action,seats[actor].token);
      assert.ok(result.status>=400 && result.status<500,`${activity}: ${JSON.stringify(action?.type)} returned ${result.status}`);
      assert.deepEqual((await request(service,1,`${path}/state`,undefined,seats[1].token)).body.room,accepted,activity);
      rejectedActions++;
    }
    for (let index=1;index<8;index++) {
      const nextSeat = (index+1)%8;
      const result = await request(service,index,`${path}/actions`,{type:'state',expectedVersion:room.version,state:checkpoint(activity,index+1),nextSeat},seats[index].token);
      assert.equal(result.status,200,activity); room = result.body.room;
      assert.equal(room.turn.playerId,seats[nextSeat].playerId,activity);
    }
    assert.equal(service.sockets.size,8,activity);
    assert.equal(events.some(event=>event.type==='socket-close'),false,activity);
    const saved = await service.exportCheckpoint();
    const restored = new NearbyRoomService();
    await restored.importCheckpoint(saved);
    for (let index=0;index<8;index++) await restored.registerMember(identity(index));
    const resumed = await request(restored,0,`${path}/state`,undefined,seats[0].token);
    assert.equal(resumed.status,200,activity);
    assert.deepEqual(resumed.body.room.state,room.state,activity);
    assert.deepEqual(resumed.body.room.turn,room.turn,activity);
    assert.equal(resumed.body.room.version,room.version,activity);
    assert.deepEqual(resumed.body.room.members.map(member=>member.username),seats.map((_,index)=>identity(index).nickname),activity);
  }
  t.diagnostic(`${SHARED_ACTIVITY_IDS.length} activities; ${rejectedActions} rejected race/invalid actions; ${SHARED_ACTIVITY_IDS.length*8} retained seats and ${SHARED_ACTIVITY_IDS.length*7} accepted control passes`);
});

test('shared room join/leave churn bounds departed identities and rejects old credentials without changing the active game', async t => {
  const service = new NearbyRoomService();
  await service.registerMember(identity(0)); await service.registerMember(identity(1));
  const host = (await request(service,0,'/api/arcade/rooms',{game:'shared-activity',maxPlayers:2,state:checkpoint('typing',0)})).body;
  const path = `/api/arcade/rooms/${host.code}`;
  const start = await request(service,0,`${path}/actions`,{type:'start',expectedVersion:host.room.version,state:checkpoint('typing',0)},host.token);
  assert.equal(start.status,200);
  for (let index=0;index<80;index++) {
    const guest = await request(service,1,`${path}/join`,{activity:'typing'});
    assert.equal(guest.status,200);
    assert.equal(guest.body.seat,1);
    assert.equal((await request(service,1,`${path}/actions`,{type:'leave'},guest.body.token)).status,200);
    const stale = await request(service,1,`${path}/join`,{activity:'typing',reconnectToken:guest.body.token});
    assert.equal(stale.status,403);
    const canonical = await request(service,0,`${path}/state`,undefined,host.token);
    assert.equal(canonical.body.room.status,'active');
    assert.equal(canonical.body.room.turn.playerId,host.playerId);
    assert.deepEqual(canonical.body.room.state,checkpoint('typing',0));
    const saved = await service.exportCheckpoint();
    assert.ok(saved.rooms[0].state.members.length<=33,'at most one active and 32 departed members');
  }
  t.diagnostic('80 rejoin/leave cycles; rejected stale reconnects; controller and checkpoint retained');
});

test('corrupt saved shared checkpoints cannot replace a working Nearby session', async () => {
  const service = new NearbyRoomService();
  await service.registerMember(identity(0));
  const host = (await request(service,0,'/api/arcade/rooms',{game:'shared-activity',maxPlayers:2,state:checkpoint('typing',0)})).body;
  const canonical = await service.exportCheckpoint();
  const corruptions = [
    state=>{ state.activity='unlisted-game'; },
    state=>{ state.schema=2; },
    state=>{ state.codec='script'; },
    state=>{ state.sequence=-1; },
    state=>{ state.decodedBytes=9*1024*1024; },
    state=>{ state.data='x'.repeat(53*1024); },
    state=>{ state.codec='gzip'; state.data='<script>'; },
    state=>{ state.extra='unsupported'; }
  ];
  for (const corrupt of corruptions) {
    const saved = structuredClone(canonical);
    corrupt(saved.rooms[0].state.state);
    await assert.rejects(service.importCheckpoint(saved),error=>error.status===400 || error.status===413);
    assert.deepEqual(await service.exportCheckpoint(),canonical,'failed import retains the complete prior session');
    assert.equal((await request(service,0,`/api/arcade/rooms/${host.code}/state`,undefined,host.token)).status,200);
  }
});
