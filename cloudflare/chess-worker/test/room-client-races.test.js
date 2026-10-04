import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const clients = [
  ["memory", require("../../../memory/room-client.js").createRoomClient],
  ["tic-tac-toe", require("../../../tic-tac-toe/room-client.js").createRoomClient]
];
const reply = body => ({ok:true,status:200,async json(){return body;}});
function snapshot(game,code,version=1){return {game,code,version,revision:version,playerId:"p0",seat:0,status:"lobby",members:[{playerId:"p0",seat:0,username:"Alex"}]};}
function joined(game,code,version=1){return {ok:true,code,token:code.repeat(8),playerId:"p0",seat:0,room:snapshot(game,code,version)};}
class Socket {
  constructor(){this.readyState=0;queueMicrotask(()=>{if(this.readyState!==0)return;this.readyState=1;this.onopen?.();});}
  close(){this.readyState=3;this.onclose?.();}
}
for(const [game,createRoomClient] of clients){
  test(`${game} validates its room identity and resets the old room version before a new join`,async()=>{
    let creates=0;
    const client=createRoomClient({game,WebSocket:Socket,fetch:async()=>reply(joined(game,creates++?"XYZ789":"ABC234",creates===1?50:1))});
    try{
      await client.create({username:"Alex"});
      await client.create({username:"Alex"});
      assert.equal(client.room.code,"XYZ789");
      assert.equal(client.room.version,1,"old version 50 does not reject a new room at version 1");
    }finally{client.disconnect();}
    const wrong=createRoomClient({game,WebSocket:Socket,fetch:async()=>reply(joined("monopoly","ABC234"))});
    try{await assert.rejects(wrong.create({username:"Alex"}),/another Arcade game/);assert.equal(wrong.session,null);}finally{wrong.disconnect();}
  });
  test(`${game} a mistaken other-game join releases only its newly allocated seat`,async()=>{
    const calls=[];
    const client=createRoomClient({game,WebSocket:Socket,fetch:async(url,init={})=>{
      calls.push({url:String(url),body:init.body?JSON.parse(init.body):null,headers:init.headers});
      return reply(joined("monopoly","ABC234"));
    }});
    try{
      await assert.rejects(client.join({username:"Alex",code:"ABC234"}),/another Arcade game/);
      assert.equal(client.session,null);
      assert.equal(calls.length,2);
      assert.deepEqual(calls[1].body,{type:"leave"});
      assert.equal(calls[1].headers.Authorization,"Bearer "+"ABC234".repeat(8));
    }finally{client.disconnect();}
  });
  test(`${game} delayed refresh, action and leave cannot overwrite or forget a replacement session`,async()=>{
    let creates=0;
    const pending=new Map();
    const client=createRoomClient({game,WebSocket:Socket,fetch:async(url,init={})=>{
      if(String(url).endsWith("/api/arcade/rooms"))return reply(joined(game,creates++?"XYZ789":"ABC234"));
      const type=init.body?JSON.parse(init.body).type:"refresh";
      return new Promise(resolve=>pending.set(type,resolve));
    }});
    try{
      await client.create({username:"Alex"});
      const refreshed=client.refresh(), acted=client.action({type:"state",state:{}}), left=client.leave();
      await client.create({username:"Alex"});
      for(const resolve of pending.values())resolve(reply({ok:true,room:snapshot(game,"ABC234",99)}));
      await Promise.all([refreshed,acted,left]);
      assert.equal(client.session.code,"XYZ789");
      assert.equal(client.room.code,"XYZ789");
      assert.equal(client.room.version,1);
    }finally{client.disconnect();}
  });
}
