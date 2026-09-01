import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

const require=createRequire(import.meta.url);
const {JSDOM,VirtualConsole}=require('../cloudflare/chess-worker/node_modules/jsdom');
const pagePath=fileURLToPath(new URL('./index.html',import.meta.url));

function response(body,status=200){return{ok:status>=200&&status<300,status,async json(){return body;}};}

function installBrowserMocks(window,fetchImpl){
    window.fetch=fetchImpl;
    window.requestAnimationFrame=()=>1;
    window.cancelAnimationFrame=()=>{};
    window.confirm=()=>true;
    window.alert=()=>{};
    Object.defineProperty(window.HTMLElement.prototype,'clientWidth',{configurable:true,get(){return 400;}});
    Object.defineProperty(window.HTMLElement.prototype,'clientHeight',{configurable:true,get(){return 400;}});
    window.HTMLElement.prototype.getBoundingClientRect=()=>({left:0,top:0,right:400,bottom:400,width:400,height:400,x:0,y:0,toJSON(){return this;}});
    window.HTMLCanvasElement.prototype.setPointerCapture=()=>{};
    window.HTMLCanvasElement.prototype.releasePointerCapture=()=>{};
    window.HTMLCanvasElement.prototype.getContext=()=>new Proxy({
        measureText(){return{width:10};},createLinearGradient(){return{addColorStop(){}};}
    },{get(target,key){return key in target?target[key]:(()=>{});},set(target,key,value){target[key]=value;return true;}});
    window.__testSockets=[];
    window.WebSocket=class{
        static CONNECTING=0;static OPEN=1;static CLOSING=2;static CLOSED=3;
        constructor(url){this.url=url;this.readyState=0;this.listeners=new Map();window.__testSockets.push(this);queueMicrotask(()=>{this.readyState=1;this.emit('open',{});});}
        addEventListener(type,fn){const list=this.listeners.get(type)||[];list.push(fn);this.listeners.set(type,list);}
        emit(type,event){for(const fn of this.listeners.get(type)||[])fn(event);}
        close(){this.readyState=3;queueMicrotask(()=>this.emit('close',{}));}
    };
}

async function loadCheckers(fetchImpl,savedSession,arcadeMultiplayer=null){
    const errors=[];
    const virtualConsole=new VirtualConsole();
    virtualConsole.on('jsdomError',error=>errors.push(error));
    const html=await readFile(pagePath,'utf8');
    const dom=new JSDOM(html,{
        url:'https://to-shreds.github.io/arcade/checkers/index.html',runScripts:'dangerously',pretendToBeVisual:true,virtualConsole,
        beforeParse(window){
            if(savedSession)window.localStorage.setItem('arcade_checkers_online_v1',JSON.stringify(savedSession));
            installBrowserMocks(window,fetchImpl);
            if(arcadeMultiplayer)window.ArcadeMultiplayer=arcadeMultiplayer;
        }
    });
    if(dom.window.document.readyState!=='complete')await new Promise(resolve=>dom.window.addEventListener('load',resolve,{once:true}));
    await new Promise(resolve=>dom.window.setTimeout(resolve,30));
    return{dom,errors};
}

function pointer(window,element,type,x,y){
    const event=new window.Event(type,{bubbles:true,cancelable:true});
    Object.defineProperties(event,{clientX:{value:x},clientY:{value:y},pointerId:{value:1}});
    element.dispatchEvent(event);
}

test('local Checkers PVP and CPU remain available and saved online rooms stay explicit',async t=>{
    let fetchCount=0;
    const{dom,errors}=await loadCheckers(async()=>{fetchCount++;throw new Error('unexpected fetch');},{code:'CHK234',token:'t'.repeat(43),username:'Alex'});
    t.after(()=>dom.window.close());
    const d=dom.window.document;
    assert.equal(fetchCount,0);
    assert.notEqual(d.querySelector('#ck-menu').style.display,'none');
    dom.window.CheckersGame.start('pvp');
    assert.equal(d.querySelector('#ck-menu').style.display,'none');
    assert.match(d.querySelector('#ck-sub').textContent,/2 players/i);
    dom.window.CheckersGame.openMenu();
    dom.window.CheckersGame.start('cpu');
    assert.equal(d.querySelector('#ck-menu').style.display,'none');
    assert.match(d.querySelector('#ck-sub').textContent,/CPU/i);
    assert.equal(errors.length,0,errors.map(e=>e.message).join('\n'));
});

test('Checkers create, host start, 0-based turn gating and remote state apply',async t=>{
    const calls=[];
    let state=null;
    let version=1;
    let failNextState=false;
    let failNextRefresh=false;
    const members=[
        {playerId:'p1',seat:0,username:'Host',connected:true},
        {playerId:'p2',seat:1,username:'Guest',connected:true}
    ];
    function room(status='lobby',turnSeat=null){
        return{code:'CHK234',game:'checkers',version,status,ready:true,hostPlayerId:'p1',playerId:'p1',seat:0,members,presence:{p1:true,p2:true},turn:turnSeat===null?null:{seat:turnSeat,playerId:members[turnSeat].playerId,number:version},state,result:null,maxPlayers:2};
    }
    const fetchImpl=async(url,options={})=>{
        const path=String(url),body=options.body?JSON.parse(options.body):null;
        calls.push({path,method:options.method||'GET',body});
        if(path.endsWith('/api/arcade/rooms')){
            assert.deepEqual(body,{game:'checkers',username:'Host',maxPlayers:2});
            return response({ok:true,code:'CHK234',token:'h'.repeat(43),playerId:'p1',seat:0,room:room()});
        }
        if(path.endsWith('/api/arcade/rooms/CHK234/actions')){
            assert.equal(options.headers.authorization,'Bearer '+'h'.repeat(43));
            if(body.type==='leave')return response({ok:true,room:room('finished',null)});
            if(body.type==='start'){
                assert.equal(body.firstSeat,0);
                state=body.state;version++;
                return response({ok:true,room:room('active',0)});
            }
            assert.equal(body.type,'state');
            if(failNextState){
                failNextState=false;
                return response({ok:false,error:'temporary upstream failure'},503);
            }
            state=body.state;version++;
            return response({ok:true,room:room(body.finish?'finished':'active',body.nextSeat)});
        }
        if(path.endsWith('/api/arcade/rooms/CHK234/state')){
            if(failNextRefresh){failNextRefresh=false;return response({ok:false,error:'temporary state outage'},503);}
            return response({ok:true,room:room('active',0)});
        }
        throw new Error('unexpected fetch '+path);
    };
    const{dom,errors}=await loadCheckers(fetchImpl);
    t.after(()=>dom.window.close());
    const d=dom.window.document;
    dom.window.CheckersGame.showOnlineSetup();
    d.querySelector('#ck-online-name').value='Host';
    d.querySelector('#ck-online-create').click();
    await new Promise(resolve=>dom.window.setTimeout(resolve,30));
    assert.equal(d.querySelector('#ck-online-badge-code').textContent,'CHK234');
    assert.equal(d.querySelector('#ck-online-start').hidden,false);
    d.querySelector('#ck-online-start').click();
    await new Promise(resolve=>dom.window.setTimeout(resolve,30));
    assert.equal(d.querySelector('#ck-menu').style.display,'none');
    assert.match(d.querySelector('#ck-turn').textContent,/RED.*Host/);

    const canvas=d.querySelector('#ck-canvas');
    pointer(dom.window,canvas,'pointerdown',25,275);
    pointer(dom.window,canvas,'pointerup',75,225);
    await new Promise(resolve=>dom.window.setTimeout(resolve,30));
    const stateActions=()=>calls.filter(call=>call.body?.type==='state');
    assert.equal(stateActions().length,1);
    assert.equal(stateActions()[0].body.expectedVersion,2);
    assert.equal(stateActions()[0].body.nextSeat,1);
    assert.match(d.querySelector('#ck-turn').textContent,/BLACK.*Guest/);

    pointer(dom.window,canvas,'pointerdown',75,125);
    pointer(dom.window,canvas,'pointerup',25,175);
    await new Promise(resolve=>dom.window.setTimeout(resolve,10));
    assert.equal(stateActions().length,1,'host cannot move the guest pieces');

    const remote=structuredClone(state);
    remote.board[2][1]=0;
    remote.board[3][0]=-1;
    remote.turn=1;
    remote.moveCount++;
    remote.selected=null;
    remote.chainLock=false;
    state=remote;version++;
    dom.window.__testSockets.at(-1).emit('message',{data:JSON.stringify({type:'state',room:room('active',0)})});
    await new Promise(resolve=>dom.window.setTimeout(resolve,10));
    assert.match(d.querySelector('#ck-turn').textContent,/RED.*Host/);

    const hostile=structuredClone(state);
    hostile.turn=-1;
    hostile.mode='cpu';
    hostile.baseSub='<img src=x onerror=alert(1)>';
    state=hostile;version++;
    dom.window.__testSockets.at(-1).emit('message',{data:JSON.stringify({type:'state',room:room('active',0)})});
    await new Promise(resolve=>dom.window.setTimeout(resolve,10));
    assert.equal(d.querySelectorAll('#ck-sub img').length,0);
    assert.match(d.querySelector('#ck-turn').textContent,/RED.*Host/,'room turn overrides hostile snapshot turn');

    const staleRoom=room('active',1);
    staleRoom.revision=0;
    dom.window.__testSockets.at(-1).emit('message',{data:JSON.stringify({type:'state',room:staleRoom})});
    await new Promise(resolve=>dom.window.setTimeout(resolve,10));
    assert.match(d.querySelector('#ck-turn').textContent,/RED.*Host/,'an older revision cannot roll the room back');

    const rollbackState=structuredClone(state);
    state=rollbackState;version++;
    dom.window.__testSockets.at(-1).emit('message',{data:JSON.stringify({type:'state',room:room('active',0)})});
    await new Promise(resolve=>dom.window.setTimeout(resolve,10));
    const beforeRollbackActions=stateActions().length;
    failNextState=true;
    failNextRefresh=true;
    pointer(dom.window,canvas,'pointerdown',125,275);
    pointer(dom.window,canvas,'pointerup',175,225);
    await new Promise(resolve=>dom.window.setTimeout(resolve,30));
    assert.equal(stateActions().length,beforeRollbackActions+1);
    assert.match(d.querySelector('#ck-turn').textContent,/BLACK.*Guest/,'the speculative board remains quarantined while both recovery requests are offline');
    dom.window.__testSockets.at(-1).emit('message',{data:JSON.stringify({type:'state',room:room('active',0)})});
    await new Promise(resolve=>dom.window.setTimeout(resolve,10));
    assert.match(d.querySelector('#ck-turn').textContent,/RED.*Host/,'a same-version WebSocket snapshot restores the authoritative turn after recovery GET also fails');
    pointer(dom.window,canvas,'pointerdown',125,275);
    pointer(dom.window,canvas,'pointerup',175,225);
    await new Promise(resolve=>dom.window.setTimeout(resolve,30));
    assert.equal(stateActions().length,beforeRollbackActions+2,'the same-version WebSocket snapshot rolled back the rejected move so it can be played again');

    const chain=structuredClone(state);
    chain.board=Array.from({length:8},()=>Array(8).fill(0));
    chain.board[4][1]=1;
    chain.board[3][2]=-1;
    chain.board[1][4]=-1;
    chain.turn=1;
    chain.selected=null;
    chain.chainLock=false;
    state=chain;version++;
    dom.window.__testSockets.at(-1).emit('message',{data:JSON.stringify({type:'state',room:room('active',0)})});
    await new Promise(resolve=>dom.window.setTimeout(resolve,10));
    const beforeChainActions=stateActions().length;
    pointer(dom.window,canvas,'pointerdown',75,225);
    pointer(dom.window,canvas,'pointerup',175,125);
    await new Promise(resolve=>dom.window.setTimeout(resolve,30));
    assert.equal(stateActions().length,beforeChainActions+1,'the first capture snapshot is acknowledged before the optional continuation');
    assert.equal(stateActions().at(-1).body.nextSeat,0,'a partial multi-jump retains the current seat');
    assert.equal(d.querySelector('#ck-endturn').disabled,false,'End Turn is re-enabled after the server acknowledges a partial chain');
    d.querySelector('#ck-endturn').click();
    await new Promise(resolve=>dom.window.setTimeout(resolve,30));
    assert.equal(stateActions().length,beforeChainActions+2,'ending an optional chain submits one new snapshot');
    assert.equal(stateActions().at(-1).body.nextSeat,1);

    const invalid=structuredClone(state);
    invalid.board[0][1]=9;
    state=invalid;version++;
    dom.window.__testSockets.at(-1).emit('message',{data:JSON.stringify({type:'state',room:room('active',0)})});
    await new Promise(resolve=>dom.window.setTimeout(resolve,10));
    assert.match(d.querySelector('#ck-online-state').textContent,/invalid board/i);

    state=hostile;version++;
    const abandonedRoom=room('finished',null);
    abandonedRoom.ready=false;
    abandonedRoom.members=[members[0]];
    abandonedRoom.presence={p1:true};
    abandonedRoom.result={type:'abandoned',reason:'not-enough-players',departedPlayerId:'p2'};
    dom.window.__testSockets.at(-1).emit('message',{data:JSON.stringify({type:'state',room:abandonedRoom})});
    await new Promise(resolve=>dom.window.setTimeout(resolve,10));
    assert.equal(d.querySelector('#ck-menu').style.display,'flex','a remote departure surfaces a visible board-level end state');
    assert.match(d.querySelector('#ck-online-state').textContent,/opponent left.*match has ended/i);
    assert.match(d.querySelector('#ck-sub').textContent,/match ended.*player left/i);

    d.querySelector('#ck-online-leave').click();
    await new Promise(resolve=>dom.window.setTimeout(resolve,20));
    assert.equal(calls.at(-1).body.type,'leave');
    assert.equal(dom.window.localStorage.getItem('arcade_checkers_online_v1'),null);
    assert.equal(d.querySelector('#ck-online-badge').hidden,true);
    assert.equal(errors.length,0,errors.map(e=>e.message).join('\n'));
});

test('Checkers join and resume send usernames and reconnect tokens',async t=>{
    const calls=[];
    const joinedRoom={code:'CHK234',game:'checkers',version:3,status:'lobby',ready:true,hostPlayerId:'p1',playerId:'p2',seat:1,members:[{playerId:'p1',seat:0,username:'Host'},{playerId:'p2',seat:1,username:'Guest'}],turn:null,state:null,maxPlayers:2};
    const joinFetch=async(url,options={})=>{
        calls.push({url:String(url),body:JSON.parse(options.body)});
        return response({ok:true,code:'CHK234',token:'g'.repeat(43),playerId:'p2',seat:1,room:joinedRoom});
    };
    const first=await loadCheckers(joinFetch);
    t.after(()=>first.dom.window.close());
    first.dom.window.CheckersGame.showOnlineSetup();
    first.dom.window.document.querySelector('#ck-online-name').value='Guest';
    first.dom.window.document.querySelector('#ck-online-code').value='chk-234';
    first.dom.window.document.querySelector('#ck-online-code').dispatchEvent(new first.dom.window.Event('input',{bubbles:true}));
    first.dom.window.document.querySelector('#ck-online-join').click();
    await new Promise(resolve=>first.dom.window.setTimeout(resolve,30));
    assert.equal(calls[0].body.username,'Guest');
    assert.match(calls[0].url,/CHK234\/join$/);

    let resumeFetches=0;
    const resume=await loadCheckers(async(url,options={})=>{
        resumeFetches++;
        const body=JSON.parse(options.body);
        if(body.type==='leave')return response({ok:false,error:'temporary outage'},503);
        assert.equal(body.reconnectToken,'r'.repeat(43));
        return response({ok:true,code:'CHK234',token:'r'.repeat(43),playerId:'p2',seat:1,room:joinedRoom});
    },{code:'CHK234',token:'r'.repeat(43),username:'Guest'});
    t.after(()=>resume.dom.window.close());
    assert.equal(resumeFetches,0);
    resume.dom.window.CheckersGame.showOnlineSetup();
    resume.dom.window.document.querySelector('#ck-online-resume').click();
    await new Promise(resolve=>resume.dom.window.setTimeout(resolve,30));
    assert.equal(resumeFetches,1);
    resume.dom.window.document.querySelector('#ck-online-leave').click();
    await new Promise(resolve=>resume.dom.window.setTimeout(resolve,20));
    assert.equal(resumeFetches,2);
    assert.notEqual(resume.dom.window.localStorage.getItem('arcade_checkers_online_v1'),null,'recoverable leave failure preserves reconnect token');
    assert.equal(resume.dom.window.document.querySelector('#ck-online-badge').hidden,false);
});

test('Checkers restores saved authority before resolving Nearby identity and handles failed room ownership safely',async t=>{
    const events=[];
    let failureStatus=503;
    const bridge={
        getStatus(){return{effectiveTransport:'nearby',nearby:true,connected:2,identity:{nickname:'Nearby Name',avatar:'🚀'}};},
        onStatus(){return()=>{};},
        pinRoomTransport(transport){events.push('pin:'+transport);return transport;},
        resetRoomTransport(){events.push('reset');},
        preferredUsername(name){events.push('name:'+name);return name;},
        invite(){},goHome(){}
    };
    const fetchImpl=async()=>{events.push('fetch');return response({ok:false,error:'room unavailable'},failureStatus);};
    const saved={code:'CHK234',token:'r'.repeat(43),username:'Saved Name',transport:'cloudflare'};
    const{dom,errors}=await loadCheckers(fetchImpl,saved,bridge);
    t.after(()=>dom.window.close());
    const d=dom.window.document;
    dom.window.CheckersGame.showOnlineSetup();
    events.length=0;
    d.querySelector('#ck-online-resume').click();
    await new Promise(resolve=>dom.window.setTimeout(resolve,30));
    assert.deepEqual(events.slice(0,3),['pin:cloudflare','name:Saved Name','fetch'],'the saved room pins its original authority before identity is selected or any request is sent');
    assert.doesNotMatch(events.join(','),/reset/,'a transient failure retains the saved authority and reconnect token');
    assert.notEqual(dom.window.localStorage.getItem('arcade_checkers_online_v1'),null);

    failureStatus=410;
    events.length=0;
    d.querySelector('#ck-online-resume').click();
    await new Promise(resolve=>dom.window.setTimeout(resolve,30));
    assert.ok(events.includes('reset'),'a terminal Gone response releases the room authority pin');
    assert.equal(dom.window.localStorage.getItem('arcade_checkers_online_v1'),null);

    events.length=0;
    d.querySelector('#ck-online-name').value='Fresh Host';
    d.querySelector('#ck-online-create').click();
    await new Promise(resolve=>dom.window.setTimeout(resolve,30));
    assert.ok(events.includes('reset'),'a failed fresh create does not leave a transport pinned without a room');

    events.length=0;
    d.querySelector('#ck-online-code').value='CHK234';
    d.querySelector('#ck-online-join').click();
    await new Promise(resolve=>dom.window.setTimeout(resolve,30));
    assert.ok(events.includes('reset'),'a failed fresh join does not leave a transport pinned without a room');
    assert.equal(errors.length,0,errors.map(error=>error.message).join('\n'));
});

test('Checkers treats terminal refresh as ownership loss instead of reconnecting forever',async t=>{
    let resets=0;
    const lobby={code:'CHK234',game:'checkers',version:1,status:'lobby',ready:false,hostPlayerId:'p1',playerId:'p1',seat:0,members:[{playerId:'p1',seat:0,username:'Host'}],turn:null,state:null,result:null,maxPlayers:2};
    const fetchImpl=async(url)=>String(url).endsWith('/state')
        ? response({ok:false,error:'room closed'},410)
        : response({ok:true,code:'CHK234',token:'h'.repeat(43),playerId:'p1',seat:0,room:lobby});
    const bridge={getStatus:()=>({effectiveTransport:'nearby'}),onStatus:()=>()=>{},resetRoomTransport(){resets++;},invite(){},goHome(){}};
    const{dom,errors}=await loadCheckers(fetchImpl,null,bridge);
    t.after(()=>dom.window.close());
    const d=dom.window.document;
    dom.window.CheckersGame.showOnlineSetup();
    d.querySelector('#ck-online-name').value='Host';
    d.querySelector('#ck-online-create').click();
    await new Promise(resolve=>dom.window.setTimeout(resolve,30));
    assert.notEqual(dom.window.localStorage.getItem('arcade_checkers_online_v1'),null);
    dom.window.__testSockets.at(-1).emit('message',{data:JSON.stringify({type:'error',error:'Room closed'})});
    await new Promise(resolve=>dom.window.setTimeout(resolve,30));
    assert.equal(dom.window.localStorage.getItem('arcade_checkers_online_v1'),null);
    assert.equal(d.querySelector('#ck-online-badge').hidden,true);
    assert.equal(resets,1);
    assert.equal(errors.length,0,errors.map(error=>error.message).join('\n'));
});
