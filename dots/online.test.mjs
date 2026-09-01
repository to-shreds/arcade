import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

const require = createRequire(import.meta.url);
const {JSDOM, VirtualConsole} = require('../cloudflare/chess-worker/node_modules/jsdom');
const pagePath = fileURLToPath(new URL('./index.html', import.meta.url));

function response(body, status = 200){
    return {ok:status >= 200 && status < 300, status, async json(){ return body; }};
}

function installBrowserMocks(window, fetchImpl){
    window.fetch = fetchImpl;
    window.requestAnimationFrame = () => 1;
    window.cancelAnimationFrame = () => {};
    window.confirm = () => true;
    window.alert = () => {};
    Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', {configurable:true, get(){ return 400; }});
    Object.defineProperty(window.HTMLElement.prototype, 'clientHeight', {configurable:true, get(){ return 400; }});
    window.HTMLElement.prototype.getBoundingClientRect = () => ({left:0,top:0,right:400,bottom:400,width:400,height:400,x:0,y:0,toJSON(){return this;}});
    window.HTMLCanvasElement.prototype.setPointerCapture = () => {};
    window.HTMLCanvasElement.prototype.releasePointerCapture = () => {};
    window.HTMLCanvasElement.prototype.getContext = () => new Proxy({
        measureText(){ return {width:10}; },
        createLinearGradient(){ return {addColorStop(){}}; }
    }, {get(target,key){ return key in target ? target[key] : (() => {}); }, set(target,key,value){ target[key]=value; return true; }});
    window.__testSockets = [];
    window.WebSocket = class {
        static CONNECTING=0; static OPEN=1; static CLOSING=2; static CLOSED=3;
        constructor(url){ this.url=url; this.readyState=0; this.listeners=new Map(); window.__testSockets.push(this); queueMicrotask(()=>{this.readyState=1;this.emit('open',{});}); }
        addEventListener(type,fn){ const list=this.listeners.get(type)||[]; list.push(fn); this.listeners.set(type,list); }
        emit(type,event){ for(const fn of this.listeners.get(type)||[]) fn(event); }
        close(){ this.readyState=3; queueMicrotask(()=>this.emit('close',{})); }
    };
}

async function loadDots(fetchImpl, savedSession, arcadeMultiplayer=null){
    const errors=[];
    const virtualConsole=new VirtualConsole();
    virtualConsole.on('jsdomError', error=>errors.push(error));
    const html=await readFile(pagePath,'utf8');
    const dom=new JSDOM(html,{
        url:'https://to-shreds.github.io/arcade/dots/index.html', runScripts:'dangerously', pretendToBeVisual:true, virtualConsole,
        beforeParse(window){
            if(savedSession) window.localStorage.setItem('arcade_dots_online_v1',JSON.stringify(savedSession));
            installBrowserMocks(window,fetchImpl);
            if(arcadeMultiplayer) window.ArcadeMultiplayer=arcadeMultiplayer;
        }
    });
    if(dom.window.document.readyState!=='complete') await new Promise(resolve=>dom.window.addEventListener('load',resolve,{once:true}));
    await new Promise(resolve=>dom.window.setTimeout(resolve,30));
    return {dom,errors};
}

function pointer(window, element, type, x, y){
    const event=new window.Event(type,{bubbles:true,cancelable:true});
    Object.defineProperties(event,{clientX:{value:x},clientY:{value:y},pointerId:{value:1}});
    element.dispatchEvent(event);
}

test('local Dots modes remain available and no saved room auto-opens', async t=>{
    let fetchCount=0;
    const {dom,errors}=await loadDots(async()=>{fetchCount++;throw new Error('unexpected fetch');},{code:'ABC234',token:'t'.repeat(43),username:'Alex'});
    t.after(()=>dom.window.close());
    const d=dom.window.document;
    assert.equal(d.querySelector('#menuOverlay').style.display,'');
    assert.equal(fetchCount,0);
    assert.equal(d.querySelector('#dotsOnlineResume').hidden,false);
    dom.window.DotsGame.setMode('pvp');
    await dom.window.DotsGame.startGame(5,5);
    assert.equal(d.querySelector('#menuOverlay').style.display,'none');
    dom.window.DotsGame.setMode('cpu');
    assert.ok(d.querySelector('#dotsModeCpu').classList.contains('dots-sel'));
    assert.equal(errors.length,0,errors.map(e=>e.message).join('\n'));
});

test('Dots create, host start, 0-based seat gating and remote state apply', async t=>{
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
        return {code:'DQT234',game:'dots',version,status,ready:members.length===2,hostPlayerId:'p1',playerId:'p1',seat:0,members,presence:{p1:true,p2:true},turn:turnSeat===null?null:{seat:turnSeat,playerId:members[turnSeat].playerId,number:version},state,result:null,maxPlayers:2};
    }
    const fetchImpl=async(url,options={})=>{
        const path=String(url);
        const body=options.body?JSON.parse(options.body):null;
        calls.push({path,method:options.method||'GET',body});
        if(path.endsWith('/api/arcade/rooms')){
            assert.deepEqual(body,{game:'dots',username:'Host',maxPlayers:2});
            return response({ok:true,code:'DQT234',token:'h'.repeat(43),playerId:'p1',seat:0,room:room()});
        }
        if(path.endsWith('/api/arcade/rooms/DQT234/actions')){
            assert.equal(options.headers.authorization,'Bearer '+'h'.repeat(43));
            if(body.type==='leave') return response({ok:true,room:room('finished',null)});
            if(body.type==='start'){
                assert.equal(body.firstSeat,0);
                state=body.state;
                state.playerNames=[null,'Host','Guest','Canonical Three','Canonical Four'];
                state.playerColors=[null,'#123456','#654321','#ABCDEF','#FEDCBA'];
                state.teams=[null,2,1,2,1];
                state.teamNames=[null,'Comets','Rockets'];
                version++;
                return response({ok:true,room:room('active',0)});
            }
            assert.equal(body.type,'state');
            if(failNextState){
                failNextState=false;
                return response({ok:false,error:'temporary upstream failure'},503);
            }
            state=body.state; version++;
            return response({ok:true,room:room(body.finish?'finished':'active',body.nextSeat)});
        }
        if(path.endsWith('/api/arcade/rooms/DQT234/state')){
            if(failNextRefresh){ failNextRefresh=false; return response({ok:false,error:'temporary state outage'},503); }
            return response({ok:true,room:room('active',0)});
        }
        throw new Error('unexpected fetch '+path);
    };
    const {dom,errors}=await loadDots(fetchImpl);
    t.after(()=>dom.window.close());
    const {document}=dom.window;
    dom.window.DotsGame.setMode('online');
    document.querySelector('#dotsOnlineName').value='Host';
    document.querySelector('#dotsOnlineCreate').click();
    await new Promise(resolve=>dom.window.setTimeout(resolve,30));
    assert.equal(document.querySelector('#dotsOnlineBadgeCode').textContent,'DQT234');
    assert.match(document.querySelector('#dotsOnlineState').textContent,/pick a grid/i);

    const quick=[...document.querySelectorAll('#menuOverlay .grid-btn')].find(button=>button.getAttribute('onclick')?.includes('startGame(5,5)'));
    assert.ok(quick);
    quick.click();
    await new Promise(resolve=>dom.window.setTimeout(resolve,30));
    assert.equal(document.querySelector('#menuOverlay').style.display,'none');
    assert.equal(document.querySelector('#turnText').textContent,'Host');

    const canvas=document.querySelector('#c');
    pointer(dom.window,canvas,'pointerdown',52,52);
    pointer(dom.window,canvas,'pointerup',52,52);
    pointer(dom.window,canvas,'pointerdown',127,52);
    await new Promise(resolve=>dom.window.setTimeout(resolve,30));
    const stateActions=()=>calls.filter(call=>call.body?.type==='state');
    assert.equal(stateActions().length,1);
    assert.equal(stateActions()[0].body.expectedVersion,2);
    assert.equal(stateActions()[0].body.nextSeat,1);
    assert.deepEqual(stateActions()[0].body.state.playerNames,[null,'Host','Guest','Canonical Three','Canonical Four'],'unused canonical name slots do not drift to this browser\'s local setup names');
    assert.deepEqual(stateActions()[0].body.state.playerColors,[null,'#123456','#654321','#ABCDEF','#FEDCBA'],'the first hydrated move preserves canonical player colors');
    assert.deepEqual(stateActions()[0].body.state.teams,[null,2,1,2,1],'the first hydrated move preserves canonical teams');
    assert.deepEqual(stateActions()[0].body.state.teamNames,[null,'Comets','Rockets'],'the first hydrated move preserves canonical team names');

    const socket=dom.window.__testSockets.at(-1);
    const remoteState=structuredClone(state);
    remoteState.turn=2;
    version++;
    socket.emit('message',{data:JSON.stringify({type:'state',room:room('active',1)})});
    await new Promise(resolve=>dom.window.setTimeout(resolve,10));
    assert.equal(document.querySelector('#turnText').textContent,'Guest');
    pointer(dom.window,canvas,'pointerdown',52,127);
    pointer(dom.window,canvas,'pointerup',52,127);
    pointer(dom.window,canvas,'pointerdown',127,127);
    await new Promise(resolve=>dom.window.setTimeout(resolve,10));
    assert.equal(stateActions().length,1,'host cannot act during seat 1 turn');

    const hostile=structuredClone(state);
    hostile.turn=99;
    hostile.playerNames=[null,'<img src=x onerror=alert(1)>','<script>alert(1)</script>'];
    hostile.playerColors=[null,'red; background:url(javascript:alert(1))','#000000'];
    state=hostile;version++;
    socket.emit('message',{data:JSON.stringify({type:'state',room:room('active',1)})});
    await new Promise(resolve=>dom.window.setTimeout(resolve,10));
    assert.equal(document.querySelectorAll('#scoreDisp img,#scoreDisp script').length,0);
    assert.match(document.querySelector('#scoreDisp').textContent,/Host.*Guest/);
    assert.equal(document.querySelector('#turnText').textContent,'Guest','room turn overrides hostile snapshot turn');

    const staleRoom=room('active',0);
    staleRoom.revision=0;
    socket.emit('message',{data:JSON.stringify({type:'state',room:staleRoom})});
    await new Promise(resolve=>dom.window.setTimeout(resolve,10));
    assert.equal(document.querySelector('#turnText').textContent,'Guest','an older revision cannot roll the room back');

    const rollbackState=structuredClone(state);
    state=rollbackState;version++;
    socket.emit('message',{data:JSON.stringify({type:'state',room:room('active',0)})});
    await new Promise(resolve=>dom.window.setTimeout(resolve,10));
    const beforeRollbackActions=stateActions().length;
    failNextState=true;
    failNextRefresh=true;
    pointer(dom.window,canvas,'pointerdown',52,127);
    pointer(dom.window,canvas,'pointerup',52,127);
    pointer(dom.window,canvas,'pointerdown',127,127);
    await new Promise(resolve=>dom.window.setTimeout(resolve,30));
    assert.equal(stateActions().length,beforeRollbackActions+1);
    assert.match(document.querySelector('#turnText').textContent,/Guest/,'the speculative board remains quarantined while both recovery requests are offline');
    socket.emit('message',{data:JSON.stringify({type:'state',room:room('active',0)})});
    await new Promise(resolve=>dom.window.setTimeout(resolve,10));
    assert.match(document.querySelector('#turnText').textContent,/Host/,'a same-version WebSocket snapshot restores the authoritative turn after recovery GET also fails');
    pointer(dom.window,canvas,'pointerdown',52,127);
    pointer(dom.window,canvas,'pointerup',52,127);
    pointer(dom.window,canvas,'pointerdown',127,127);
    await new Promise(resolve=>dom.window.setTimeout(resolve,30));
    assert.equal(stateActions().length,beforeRollbackActions+2,'the same-version WebSocket snapshot rolled back the rejected edge so it can be played again');

    const invalid=structuredClone(state);
    invalid.HO=[[]];
    state=invalid;version++;
    socket.emit('message',{data:JSON.stringify({type:'state',room:room('active',1)})});
    await new Promise(resolve=>dom.window.setTimeout(resolve,10));
    assert.match(document.querySelector('#dotsOnlineState').textContent,/invalid board/i);

    state=hostile;version++;
    const abandonedRoom=room('finished',null);
    abandonedRoom.ready=false;
    abandonedRoom.members=[members[0]];
    abandonedRoom.presence={p1:true};
    abandonedRoom.result={type:'abandoned',reason:'not-enough-players',departedPlayerId:'p2'};
    socket.emit('message',{data:JSON.stringify({type:'state',room:abandonedRoom})});
    await new Promise(resolve=>dom.window.setTimeout(resolve,10));
    assert.equal(document.querySelector('#menuOverlay').style.display,'flex','a remote departure surfaces a visible board-level end state');
    assert.match(document.querySelector('#dotsOnlineState').textContent,/player left.*room has ended/i);
    assert.match(document.querySelector('#statusText').textContent,/game ended.*player left/i);

    document.querySelector('#dotsOnlineLeave').click();
    await new Promise(resolve=>dom.window.setTimeout(resolve,20));
    assert.equal(calls.at(-1).body.type,'leave');
    assert.equal(dom.window.localStorage.getItem('arcade_dots_online_v1'),null);
    assert.equal(document.querySelector('#dotsOnlineBadge').hidden,true);
    assert.equal(errors.length,0,errors.map(e=>e.message).join('\n'));
});

test('Dots host and guest preserve canonical inactive configuration slots across turns', async t=>{
    const hostToken='h'.repeat(43),guestToken='g'.repeat(43),actions=[];
    const members=[
        {playerId:'p1',seat:0,username:'Host',connected:true},
        {playerId:'p2',seat:1,username:'Guest',connected:true}
    ];
    let state=null,version=1,turnSeat=null;
    function viewer(options){return String(options?.headers?.authorization||'').endsWith(guestToken)?1:0;}
    function room(seat,status=state?'active':'lobby'){
        return {code:'CFG234',game:'dots',version,status,ready:true,hostPlayerId:'p1',playerId:members[seat].playerId,seat,members,
            presence:{p1:true,p2:true},turn:turnSeat===null?null:{seat:turnSeat,playerId:members[turnSeat].playerId,number:version},state,result:null,maxPlayers:2};
    }
    const fetchImpl=async(url,options={})=>{
        const path=String(url),body=options.body?JSON.parse(options.body):null;
        if(path.endsWith('/api/arcade/rooms')) return response({ok:true,code:'CFG234',token:hostToken,playerId:'p1',seat:0,room:room(0)});
        if(path.endsWith('/api/arcade/rooms/CFG234/join')){
            assert.equal(body.reconnectToken,guestToken);
            return response({ok:true,code:'CFG234',token:guestToken,playerId:'p2',seat:1,room:room(1)});
        }
        if(path.endsWith('/api/arcade/rooms/CFG234/actions')){
            const seat=viewer(options);
            if(body.type==='start'){
                state=body.state;
                state.playerNames=[null,'Host','Guest','Server Three','Server Four'];
                state.playerColors=[null,'#102030','#405060','#708090','#A0B0C0'];
                state.teams=[null,2,1,2,1];
                state.teamNames=[null,'Moon Team','Sun Team'];
                turnSeat=0;version++;
                return response({ok:true,room:room(seat)});
            }
            assert.equal(body.type,'state');
            actions.push({seat,body});state=body.state;turnSeat=body.nextSeat;version++;
            return response({ok:true,room:room(seat)});
        }
        if(path.endsWith('/api/arcade/rooms/CFG234/state')) return response({ok:true,room:room(viewer(options))});
        throw new Error('unexpected fetch '+path);
    };

    const host=await loadDots(fetchImpl);
    t.after(()=>host.dom.window.close());
    host.dom.window.DotsGame.setMode('online');
    host.dom.window.document.querySelector('#dotsOnlineName').value='Host';
    host.dom.window.document.querySelector('#dotsOnlineCreate').click();
    await new Promise(resolve=>host.dom.window.setTimeout(resolve,30));
    [...host.dom.window.document.querySelectorAll('#menuOverlay .grid-btn')].find(button=>button.getAttribute('onclick')?.includes('startGame(5,5)')).click();
    await new Promise(resolve=>host.dom.window.setTimeout(resolve,30));
    let canvas=host.dom.window.document.querySelector('#c');
    pointer(host.dom.window,canvas,'pointerdown',52,52);pointer(host.dom.window,canvas,'pointerup',52,52);pointer(host.dom.window,canvas,'pointerdown',127,52);
    await new Promise(resolve=>host.dom.window.setTimeout(resolve,30));
    assert.equal(actions.length,1);

    const guest=await loadDots(fetchImpl,{code:'CFG234',token:guestToken,username:'Guest',transport:'cloudflare'});
    t.after(()=>guest.dom.window.close());
    guest.dom.window.DotsGame.setMode('online');
    guest.dom.window.document.querySelector('#dotsOnlineResume').click();
    await new Promise(resolve=>guest.dom.window.setTimeout(resolve,40));
    canvas=guest.dom.window.document.querySelector('#c');
    pointer(guest.dom.window,canvas,'pointerdown',52,52);pointer(guest.dom.window,canvas,'pointerup',52,52);pointer(guest.dom.window,canvas,'pointerdown',52,127);
    await new Promise(resolve=>guest.dom.window.setTimeout(resolve,40));
    assert.equal(actions.length,2,'the guest can submit the following turn after independent hydration');
    for(const action of actions){
        assert.deepEqual(action.body.state.playerNames,[null,'Host','Guest','Server Three','Server Four']);
        assert.deepEqual(action.body.state.playerColors,[null,'#102030','#405060','#708090','#A0B0C0']);
        assert.deepEqual(action.body.state.teams,[null,2,1,2,1]);
        assert.deepEqual(action.body.state.teamNames,[null,'Moon Team','Sun Team']);
    }
    assert.equal(host.errors.length,0,host.errors.map(error=>error.message).join('\n'));
    assert.equal(guest.errors.length,0,guest.errors.map(error=>error.message).join('\n'));
});

test('Dots resume is explicit and sends the reconnect token', async t=>{
    let fetchCount=0;
    const fetchImpl=async(url,options={})=>{
        fetchCount++;
        const body=JSON.parse(options.body);
        if(body.type==='leave') return response({ok:false,error:'temporary outage'},503);
        assert.equal(body.reconnectToken,'r'.repeat(43));
        return response({ok:true,code:'ABC234',token:'r'.repeat(43),playerId:'p1',seat:0,room:{code:'ABC234',game:'dots',version:4,status:'lobby',ready:false,hostPlayerId:'p1',playerId:'p1',seat:0,members:[{playerId:'p1',seat:0,username:'Alex'}],turn:null,state:null,maxPlayers:2}});
    };
    const {dom}=await loadDots(fetchImpl,{code:'ABC234',token:'r'.repeat(43),username:'Alex'});
    t.after(()=>dom.window.close());
    assert.equal(fetchCount,0);
    dom.window.DotsGame.setMode('online');
    dom.window.document.querySelector('#dotsOnlineResume').click();
    await new Promise(resolve=>dom.window.setTimeout(resolve,30));
    assert.equal(fetchCount,1);
    assert.equal(dom.window.document.querySelector('#dotsOnlineBadgeCode').textContent,'ABC234');
    dom.window.document.querySelector('#dotsOnlineLeave').click();
    await new Promise(resolve=>dom.window.setTimeout(resolve,20));
    assert.equal(fetchCount,2);
    assert.notEqual(dom.window.localStorage.getItem('arcade_dots_online_v1'),null,'recoverable leave failure preserves reconnect token');
    assert.equal(dom.window.document.querySelector('#dotsOnlineBadge').hidden,false);
});

test('Dots restores saved authority before resolving Nearby identity and handles failed room ownership safely',async t=>{
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
    const saved={code:'ABC234',token:'r'.repeat(43),username:'Saved Name',transport:'cloudflare'};
    const{dom,errors}=await loadDots(fetchImpl,saved,bridge);
    t.after(()=>dom.window.close());
    const d=dom.window.document;
    dom.window.DotsGame.setMode('online');
    events.length=0;
    d.querySelector('#dotsOnlineResume').click();
    await new Promise(resolve=>dom.window.setTimeout(resolve,30));
    assert.deepEqual(events.slice(0,3),['pin:cloudflare','name:Saved Name','fetch'],'the saved room pins its original authority before identity is selected or any request is sent');
    assert.doesNotMatch(events.join(','),/reset/,'a transient failure retains the saved authority and reconnect token');
    assert.notEqual(dom.window.localStorage.getItem('arcade_dots_online_v1'),null);

    failureStatus=410;
    events.length=0;
    d.querySelector('#dotsOnlineResume').click();
    await new Promise(resolve=>dom.window.setTimeout(resolve,30));
    assert.ok(events.includes('reset'),'a terminal Gone response releases the room authority pin');
    assert.equal(dom.window.localStorage.getItem('arcade_dots_online_v1'),null);

    events.length=0;
    d.querySelector('#dotsOnlineName').value='Fresh Host';
    d.querySelector('#dotsOnlineCreate').click();
    await new Promise(resolve=>dom.window.setTimeout(resolve,30));
    assert.ok(events.includes('reset'),'a failed fresh create does not leave a transport pinned without a room');

    events.length=0;
    d.querySelector('#dotsOnlineCode').value='ABC234';
    d.querySelector('#dotsOnlineJoin').click();
    await new Promise(resolve=>dom.window.setTimeout(resolve,30));
    assert.ok(events.includes('reset'),'a failed fresh join does not leave a transport pinned without a room');
    assert.equal(errors.length,0,errors.map(error=>error.message).join('\n'));
});

test('Dots treats terminal refresh as ownership loss instead of reconnecting forever',async t=>{
    let resets=0;
    const lobby={code:'DQT234',game:'dots',version:1,status:'lobby',ready:false,hostPlayerId:'p1',playerId:'p1',seat:0,members:[{playerId:'p1',seat:0,username:'Host'}],turn:null,state:null,result:null,maxPlayers:2};
    const fetchImpl=async(url)=>String(url).endsWith('/state')
        ? response({ok:false,error:'room closed'},410)
        : response({ok:true,code:'DQT234',token:'h'.repeat(43),playerId:'p1',seat:0,room:lobby});
    const bridge={getStatus:()=>({effectiveTransport:'nearby'}),onStatus:()=>()=>{},resetRoomTransport(){resets++;},invite(){},goHome(){}};
    const{dom,errors}=await loadDots(fetchImpl,null,bridge);
    t.after(()=>dom.window.close());
    const d=dom.window.document;
    dom.window.DotsGame.setMode('online');
    d.querySelector('#dotsOnlineName').value='Host';
    d.querySelector('#dotsOnlineCreate').click();
    await new Promise(resolve=>dom.window.setTimeout(resolve,30));
    assert.notEqual(dom.window.localStorage.getItem('arcade_dots_online_v1'),null);
    dom.window.__testSockets.at(-1).emit('message',{data:JSON.stringify({type:'error',error:'Room closed'})});
    await new Promise(resolve=>dom.window.setTimeout(resolve,30));
    assert.equal(dom.window.localStorage.getItem('arcade_dots_online_v1'),null);
    assert.equal(d.querySelector('#dotsOnlineBadge').hidden,true);
    assert.equal(resets,1);
    assert.equal(errors.length,0,errors.map(error=>error.message).join('\n'));
});

test('Dots supports four occupied online seats with explicit server-to-local seat mapping',async t=>{
    let state=null;
    let version=1;
    let members=[0,1,2,3].map(seat=>({playerId:'p'+seat,seat,username:['Host','Blue','Green','Gold'][seat],connected:true}));
    const actions=[];
    const room=(status='lobby',turnSeat=null,result=null)=>({code:'FQUR24',game:'dots',version,status,ready:members.length>=2,hostPlayerId:'p0',playerId:'p0',seat:0,members,turn:turnSeat===null?null:{seat:turnSeat,playerId:'p'+turnSeat,number:version},state,result,maxPlayers:4});
    const fetchImpl=async(url,options={})=>{
        const body=options.body?JSON.parse(options.body):null;
        if(String(url).endsWith('/api/arcade/rooms')){
            assert.equal(body.maxPlayers,4);
            return response({ok:true,code:'FQUR24',token:'f'.repeat(43),playerId:'p0',seat:0,room:room()});
        }
        if(body?.type==='start'){
            state=body.state;version++;
            return response({ok:true,room:room('active',0)});
        }
        if(body?.type==='state'){
            actions.push(body);
            state=body.state;version++;
            return response({ok:true,room:body.finish?room('finished',null,body.result):room('active',body.nextSeat)});
        }
        throw new Error('unexpected fetch '+url);
    };
    const{dom}=await loadDots(fetchImpl);
    t.after(()=>dom.window.close());
    dom.window.DotsGame.setMode('online');
    dom.window.DotsGame.setPlayerCount(4);
    dom.window.document.querySelector('#dotsOnlineName').value='Host';
    dom.window.document.querySelector('#dotsOnlineCreate').click();
    await new Promise(resolve=>dom.window.setTimeout(resolve,20));
    [...dom.window.document.querySelectorAll('#menuOverlay .grid-btn')].find(button=>button.getAttribute('onclick')?.includes('startGame(5,5)')).click();
    await new Promise(resolve=>dom.window.setTimeout(resolve,20));
    state.turn=99;
    version++;
    dom.window.__testSockets.at(-1).emit('message',{data:JSON.stringify({type:'state',room:room('active',3)})});
    await new Promise(resolve=>dom.window.setTimeout(resolve,10));
    assert.equal(dom.window.document.querySelector('#turnText').textContent,'Gold');

    members=members.filter(member=>member.seat!==1);
    state.turn=1;
    version++;
    dom.window.__testSockets.at(-1).emit('message',{data:JSON.stringify({type:'state',room:room('active',0)})});
    await new Promise(resolve=>dom.window.setTimeout(resolve,10));
    assert.doesNotMatch(dom.window.document.querySelector('#scoreDisp').textContent,/Blue/);
    const canvas=dom.window.document.querySelector('#c');
    pointer(dom.window,canvas,'pointerdown',52,52);
    pointer(dom.window,canvas,'pointerup',52,52);
    pointer(dom.window,canvas,'pointerdown',127,52);
    await new Promise(resolve=>dom.window.setTimeout(resolve,30));
    assert.equal(actions.at(-1).nextSeat,2,'rotation skips departed server seat 1');
    assert.equal(dom.window.document.querySelector('#turnText').textContent,'Green');

    const nearFinish=structuredClone(state);
    nearFinish.HO=Array.from({length:5},()=>Array(4).fill(2));
    nearFinish.VO=Array.from({length:4},()=>Array(5).fill(2));
    nearFinish.boxOwner=Array.from({length:4},()=>Array(4).fill(2));
    nearFinish.boxAnim=Array.from({length:4},()=>Array(4).fill(0));
    nearFinish.HO[0][0]=0;
    nearFinish.boxOwner[0][0]=0;
    nearFinish.claimed=15;
    nearFinish.scores=[0,0,15,0,0];
    nearFinish.turn=1;
    state=nearFinish;version++;
    dom.window.__testSockets.at(-1).emit('message',{data:JSON.stringify({type:'state',room:room('active',0)})});
    await new Promise(resolve=>dom.window.setTimeout(resolve,10));
    pointer(dom.window,canvas,'pointerdown',52,52);
    pointer(dom.window,canvas,'pointerup',52,52);
    pointer(dom.window,canvas,'pointerdown',127,52);
    await new Promise(resolve=>dom.window.setTimeout(resolve,30));
    assert.equal(actions.at(-1).finish,true);
    assert.equal(actions.at(-1).result.winnerSeat,0,'departed high score is excluded from the winner');
    assert.deepEqual(actions.at(-1).result.scores.map(entry=>entry.seat),[0,2,3]);
});
