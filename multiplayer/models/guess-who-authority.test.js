import test from 'node:test';
import assert from 'node:assert/strict';
import { GenericRoomModel } from './generic-room-model.js';
import { MemoryStorage } from './room-model.js';
import { CHARACTERS, QUESTIONS, characterById, questionById, matchesQuestion } from './guess-who-data.js';
import { NearbyRoomService } from '../nearby-room-service.js';

async function fixture(start = true) {
  const model = new GenericRoomModel(new MemoryStorage());
  const a = await model.create({code:'ABC234',game:'guess-who',username:'Alice'});
  const b = await model.join({username:'Bob'});
  const act = async (who,type,fields={}) => model.act(who.token,{type,...fields,expectedVersion:(await model.load()).version});
  if(start){await act(a,'start');await act(a,'choose',{characterId:'ada'});await act(b,'choose',{characterId:'ben'});}
  const turn = async () => (await model.load()).turn.playerId === a.playerId ? a : b;
  const other = who => who.playerId===a.playerId ? b : a;
  const secret = who => who.playerId===a.playerId ? 'ada' : 'ben';
  return {model,a,b,act,turn,other,secret};
}
async function rejectedUnchanged(model, run, status) {
  const before = await model.load();
  await assert.rejects(run, error => status === undefined || error.status === status);
  assert.deepEqual(await model.load(), before, 'a rejected action cannot mutate the room');
}

test('Guess Who has 24 distinguishable original characters and nonempty useful questions', () => {
  assert.equal(CHARACTERS.length,24);
  assert.equal(new Set(CHARACTERS.map(c=>c.id)).size,24);
  assert.equal(new Set(CHARACTERS.map(c=>QUESTIONS.map(q=>Number(matchesQuestion(c,q))).join(''))).size,24);
  for(const q of QUESTIONS){const yes=CHARACTERS.filter(c=>matchesQuestion(c,q));assert.ok(yes.length>0&&yes.length<24,q.id);}
  assert.equal(characterById('__proto__'),null);assert.equal(questionById('constructor'),null);
});

test('Guess Who rejects supplied state, extra seats, duplicate names and unauthorized starts', async () => {
  const m = new GenericRoomModel(new MemoryStorage());
  await assert.rejects(()=>m.create({code:'ABC234',game:'guess-who',username:'A',state:{secrets:{}}}),{status:400});
  await assert.rejects(()=>m.create({code:'ABC234',game:'guess-who',username:'A',maxPlayers:3}),{status:400});
  const a = await m.create({code:'ABC234',game:'guess-who',username:'A'});
  await rejectedUnchanged(m,()=>m.act(a.token,{type:'start',expectedVersion:1}),409);
  await assert.rejects(()=>m.join({username:'a'}),{status:409});
  const b = await m.join({username:'B'});
  await assert.rejects(()=>m.join({username:'C'}),{status:409});
  await rejectedUnchanged(m,()=>m.act(b.token,{type:'start',expectedVersion:2}),403);
  await rejectedUnchanged(m,()=>m.act(a.token,{type:'start',state:{secrets:{}},expectedVersion:2}),400);
});

test('Guess Who selection is immutable and private in every viewer and reconnect snapshot', async () => {
  const {model,a,b,act}=await fixture(false);
  await act(a,'start');
  assert.equal((await model.load()).turn,null);
  await rejectedUnchanged(model,()=>act(a,'choose',{characterId:'__proto__'}),400);
  const own=await act(a,'choose',{characterId:'ada'});
  assert.equal(own.state.myCharacterId,'ada');assert.equal(own.state.revealed,null);
  const opponent=await model.state(b.token);
  assert.equal(opponent.state.myCharacterId,null);
  assert.equal(JSON.stringify(opponent).includes('ada'),false);
  const spectator=model.public(await model.load());
  assert.equal(spectator.state.myCharacterId,null);assert.equal('secrets' in spectator.state,false);
  await rejectedUnchanged(model,()=>act(a,'choose',{characterId:'ben'}),409);
  await rejectedUnchanged(model,()=>act(a,'rename',{username:'Cheat'}),403);
  await act(b,'choose',{characterId:'ben'});
  assert.equal((await model.load()).state.phase,'playing');
  const restored=await model.join({reconnectToken:a.token});
  assert.equal(restored.room.state.myCharacterId,'ada');assert.equal(JSON.stringify(restored.room).includes('ben'),false);
  await rejectedUnchanged(model,()=>act(b,'choose',{characterId:'cleo'}),409);
});

test('Guess Who enforces turns, versions, canonical answers and rejects arbitrary snapshots', async () => {
  const f=await fixture(), {model,act,turn,other,secret}=f;
  const actor=await turn(), target=other(actor);
  await rejectedUnchanged(model,()=>act(target,'ask',{questionId:'glasses'}),403);
  await rejectedUnchanged(model,()=>act(actor,'state',{state:{phase:'finished'},finish:true}),400);
  await rejectedUnchanged(model,()=>act(actor,'ask',{questionId:'glasses',text:'override'}),400);
  const stale=(await model.load()).version;
  const clue=await act(actor,'ask',{questionId:'glasses'});
  assert.equal(clue.state.history[0].answer,matchesQuestion(characterById(secret(target)),questionById('glasses')));
  assert.equal(clue.turn.playerId,target.playerId);
  await rejectedUnchanged(model,()=>model.act(target.token,{type:'ask',questionId:'hat',expectedVersion:stale}),409);
  await act(target,'ask',{questionId:'hat'});
  await rejectedUnchanged(model,()=>act(actor,'ask',{questionId:'glasses'}),409);
});

test('all canonical Guess Who questions agree with every character record', async () => {
  for(const targetCharacter of CHARACTERS) {
    const f=await fixture(false),{model,a,b,act}=f;
    await act(a,'start');await act(a,'choose',{characterId:targetCharacter.id});await act(b,'choose',{characterId:targetCharacter.id});
    for(const q of QUESTIONS) {
      const actor=await f.turn();
      const snap=await act(actor,'ask',{questionId:q.id});
      assert.equal(snap.state.history.at(-1).answer,matchesQuestion(targetCharacter,q),`${targetCharacter.id}/${q.id}`);
    }
    assert.equal((await model.load()).status,'active');
  }
});

test('custom questions require the opponent to answer before asking; unsure is supported', async () => {
  const {model,act,turn,other}=await fixture();const a=await turn(),b=other(a);
  await rejectedUnchanged(model,()=>act(a,'ask',{text:'a\n<script>'}),400);
  await rejectedUnchanged(model,()=>act(a,'ask',{text:'a'.repeat(161)}),400);
  const question=await act(a,'ask',{text:'Do they look cheerful?'});
  assert.equal(question.state.phase,'answering');assert.equal(question.turn.playerId,b.playerId);
  await rejectedUnchanged(model,()=>act(b,'ask',{questionId:'hat'}),409);
  await rejectedUnchanged(model,()=>act(a,'answer',{answer:true}),403);
  await rejectedUnchanged(model,()=>act(b,'answer',{answer:'yes'}),400);
  const answered=await act(b,'answer',{answer:'unsure'});
  assert.equal(answered.state.pending,null);assert.equal(answered.state.history[0].answer,null);
  assert.equal(answered.turn.playerId,b.playerId);assert.equal(answered.turn.number,question.turn.number);
  assert.equal(answered.state.phase,'playing');await act(b,'ask',{questionId:'hat'});
});

test('correct and wrong guesses end the round; all secrets are revealed only then', async () => {
  for(const correct of [true,false]) {
    const {model,act,turn,other,secret}=await fixture();const a=await turn(),b=other(a);
    const result=await act(a,'guess',{characterId:correct?secret(b):'cleo'});
    assert.equal(result.status,'finished');assert.equal(result.turn,null);
    assert.equal(result.result.winnerPlayerId,correct?a.playerId:b.playerId);
    assert.equal(result.result.reason,correct?'correct-guess':'wrong-guess');
    assert.equal(Object.keys(result.state.revealed).length,2);
    assert.equal(result.state.scores[result.result.winnerPlayerId],1);
    await rejectedUnchanged(model,()=>act(a,'guess',{characterId:secret(b)}),409);
  }
});

test('rematches require both votes, clear choices and clues, preserve scores and alternate the starter', async () => {
  const {model,a,b,act}=await fixture(); const before=await model.load();
  await act(a,'resign');const finished=await model.load();
  await act(a,'rematch');assert.equal((await model.load()).status,'finished');
  await rejectedUnchanged(model,()=>act(a,'rematch'),409);
  const newRound=await act(b,'rematch');
  assert.equal(newRound.status,'active');assert.equal(newRound.state.phase,'selecting');
  assert.equal(newRound.state.round,2);assert.equal(newRound.state.starterSeat,1-before.state.starterSeat);
  assert.deepEqual(newRound.state.scores,finished.state.scores);
  assert.deepEqual(newRound.state.history,[]);assert.equal(newRound.state.myCharacterId,null);assert.equal(newRound.state.revealed,null);
  await act(a,'choose',{characterId:'cleo'});await act(b,'choose',{characterId:'dex'});
  assert.equal((await model.load()).turn.seat,1-before.state.starterSeat);
});

test('leaving an active Guess Who game abandons it without a score or secret reveal', async () => {
  const {model,a,b}=await fixture();await model.act(a.token,{type:'leave'});
  const snapshot=await model.state(b.token);
  assert.equal(snapshot.status,'finished');assert.equal(snapshot.result.type,'abandoned');assert.equal(snapshot.state.revealed,null);
  assert.ok(Object.values(snapshot.state.scores).every(score=>score===0));
  await assert.rejects(()=>model.state(a.token),{status:401});
});

test('Nearby Guess Who uses the same private canonical room authority and locked identities', async () => {
  const service=new NearbyRoomService(), events=[];service.subscribe(e=>events.push(e));
  for(const [memberId,nickname] of [['alice','Alice'],['bob','Bob']]) await service.registerMember({memberId,nickname,avatar:'⭐'});
  const http=async(who,path,body,token)=>{
    const response=await service.handleHttp(who,{url:'/api/arcade/rooms'+path,method:body===undefined?'GET':'POST',headers:token?{authorization:`Bearer ${token}`}:{},body:body===undefined?null:JSON.stringify(body)});
    return {status:response.status,...(typeof response.body === "string" ? JSON.parse(response.body) : response.body)};
  };
  const a=await http('alice','',{game:'guess-who',username:'Spoofed'});
  assert.equal(a.ok,true);assert.equal(a.room.members[0].username,'Alice');
  const b=await http('bob',`/${a.code}/join`,{username:'Different'});
  assert.equal(b.room.members[1].username,'Bob');
  let version=b.room.version;
  const act=async(who,type,fields={},token=who==='alice'?a.token:b.token)=>{const r=await http(who,`/${a.code}/actions`,{type,expectedVersion:version,...fields},token);if(r.ok)version=r.room.version;return r;};
  assert.equal((await act('alice','start')).ok,true);
  await service.openSocket('alice',{socketId:'socket_a',url:`/api/arcade/rooms/${a.code}/ws?token=${a.token}`});
  await service.openSocket('bob',{socketId:'socket_b',url:`/api/arcade/rooms/${a.code}/ws?token=${b.token}`});
  assert.equal((await act('alice','choose',{characterId:'ada'})).ok,true);
  const toBob=events.filter(e=>e.type==='socket-message'&&e.targetMemberId==='bob').at(-1);
  assert.equal(JSON.stringify(toBob).includes('ada'),false);
  assert.equal((await act('bob','choose',{characterId:'ben'})).ok,true);
  const state=await http('alice',`/${a.code}/state`,undefined,a.token);
  const actor=state.room.turn.playerId===a.playerId?'alice':'bob';
  assert.equal((await act(actor,'state',{state:{phase:'finished'}})).ok,false);
  assert.equal((await act(actor,'rename',{username:'New name'})).ok,false);
  const guessed=await act(actor,'guess',{characterId:actor==='alice'?'ben':'ada'});
  assert.equal(guessed.ok,true);assert.equal(guessed.room.result.winnerPlayerId,actor==='alice'?a.playerId:b.playerId);
  const guestState=await http('bob',`/${a.code}/state`,undefined,b.token);
  assert.equal(guestState.room.state.revealed[a.playerId],'ada');
});
