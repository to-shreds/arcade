'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createRoomClient}=require('./room-client.js');

function storage(initial){const data=new Map(Object.entries(initial||{}));return {getItem:key=>data.has(key)?data.get(key):null,setItem:(key,value)=>data.set(key,String(value)),removeItem:key=>data.delete(key),has:key=>data.has(key)};}
function response(status,body){return {ok:status>=200&&status<300,status,json:async()=>body};}
class FakeWebSocket{static instances=[];constructor(url){this.url=url;this.readyState=0;FakeWebSocket.instances.push(this);}close(){this.readyState=3;if(this.onclose)this.onclose();}open(){this.readyState=1;if(this.onopen)this.onopen();}}
function room(overrides){return Object.assign({code:'XYZ789',game:'tic-tac-toe',version:1,revision:1,status:'lobby',ready:true,hostPlayerId:'p0',playerId:'p0',seat:0,members:[{playerId:'p0',seat:0,username:'Ada',connected:true},{playerId:'p1',seat:1,username:'Ben',connected:true}],turn:null,state:null},overrides||{});}

async function adapterTests(){
  const calls=[];const store=storage();let current=room();
  const client=createRoomClient({game:'tic-tac-toe',storage:store,WebSocket:FakeWebSocket,fetch:async(url,init={})=>{
    const body=init.body?JSON.parse(init.body):null;calls.push({url,body});
    if(url.endsWith('/api/arcade/rooms'))return response(200,{ok:true,code:'XYZ789',token:'abcdefghijklmnopqrstuvwx',playerId:'p0',seat:0,room:current});
    if(url.endsWith('/actions')&&body.type==='start'){current=room({version:2,revision:2,status:'active',turn:{seat:0},state:body.state});return response(200,{ok:true,room:current});}
    if(url.endsWith('/actions')&&body.type==='state'){current=room({version:3,revision:3,status:'active',turn:{seat:body.nextSeat},state:body.state});return response(200,{ok:true,room:current});}
    if(url.endsWith('/actions')&&body.type==='leave')return response(200,{ok:true,room:room({members:[]})});
    throw new Error('unexpected '+url);
  }});
  await client.create({username:'Ada',maxPlayers:2});FakeWebSocket.instances.at(-1).open();
  assert.equal(client.session.seat,0);
  const initial={schema:1,board:Array(9).fill(''),turn:'X',scoreX:0,scoreO:0,symX:'X',symO:'O',roundOver:null};
  await client.action({type:'start',state:initial,firstSeat:0});
  assert.equal(calls.at(-1).body.expectedVersion,1);
  await client.action({type:'state',state:Object.assign({},initial,{board:['X','','','','','','','',''],turn:'O'}),nextSeat:1});
  assert.equal(calls.at(-1).body.nextSeat,1,'turn passes from server seat zero to one');
  await client.leave();assert.deepEqual(calls.at(-1).body,{type:'leave'});assert.equal(store.has('arcade_room_tic-tac-toe_v1'),false);
  client.disconnect();

  const seeded=storage({'arcade_room_tic-tac-toe_v1':JSON.stringify({code:'XYZ789',token:'abcdefghijklmnopqrstuvwx',playerId:'p1',seat:1,username:'Ben'})});
  let requests=0;
  const resume=createRoomClient({game:'tic-tac-toe',storage:seeded,WebSocket:FakeWebSocket,fetch:async(_url,init={})=>{requests++;assert.equal(JSON.parse(init.body).reconnectToken,'abcdefghijklmnopqrstuvwx');return response(200,{ok:true,code:'XYZ789',token:'abcdefghijklmnopqrstuvwx',playerId:'p1',seat:1,room:room({playerId:'p1',seat:1})});}});
  assert.equal(requests,0,'resume is explicit, never automatic');
  await resume.resume();FakeWebSocket.instances.at(-1).open();assert.equal(resume.session.seat,1);resume.disconnect();
}

function validatorTests(){
  const html=fs.readFileSync(path.join(__dirname,'index.html'),'utf8');
  const start=html.indexOf('function validOnlineState(saved)');
  const end=html.indexOf('function initialOnlineState()',start);
  assert.ok(start>0&&end>start,'validator is present');
  const source=html.slice(start,end);
  const wins=[[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
  const symbols=['💩','🦄','X','O','⭐','❤️','🌈','👻','🤖','👽','😺','🐶','🍕','💀'];
  const validate=new Function('wins','SYMBOLS',source+'; return validOnlineState;')(wins,symbols);
  const valid={schema:1,board:Array(9).fill(''),turn:'X',scoreX:0,scoreO:0,symX:'X',symO:'O',roundOver:null};
  assert.equal(validate(valid),true);
  assert.equal(validate(Object.assign({},valid,{board:['O','','','','','','','',''],turn:'X'})),false,'O cannot move first');
  assert.equal(validate(Object.assign({},valid,{board:['<img>','','','','','','','','']})),false,'hostile mark is rejected');
  assert.equal(validate(Object.assign({},valid,{scoreX:'<img src=x onerror=alert(1)>'})),false,'hostile score is rejected');
  assert.equal(validate(Object.assign({},valid,{board:['X','X','X','O','O','','','',''],turn:'X',roundOver:{winner:'X',line:[0,1,8]}})),false,'fake winning line is rejected');
  assert.match(html,/TicTacToe\.start\('cpu'\)/,'CPU mode remains');
  assert.match(html,/TicTacToe\.start\('pvp'\)/,'local PVP remains');
  assert.match(html,/const mark=markForSeat\(onlineRoom,session\.seat\)/,'actual occupied seat order gates which mark a client may play');
  assert.match(html,/firstSeat:seatForMark\(onlineRoom,'X'\)/,'host starts from the first occupied seat');
}

(async()=>{await adapterTests();validatorTests();console.log('Tic Tac Toe online tests passed.');})().catch(error=>{console.error(error);process.exitCode=1;});
