import { createGame, applyAction, validateGame, chooseCpuAction, WIDTH, HEIGHT, TANK_WIDTH } from './engine.js';
import { WEAPONS, weaponById } from './weapons.js';
import { drawBattle, tankSvg, weaponSvg, terrainSummary, terrainPreviewSvg } from './graphics.js';
import { initBattleView } from './battle-view.js';

const $ = id => document.getElementById(id);
const mp = window.ArcadeMultiplayer, save = window.ArcadeSave;
const ROOT = `${mp?.workerOrigin || 'https://arcade-chess.jonathanjablon.workers.dev'}/api/arcade/rooms`;
const CODE = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/;
const NAME = /^[\p{L}\p{N}][\p{L}\p{N} _.'-]{0,23}$/u;
const clone = value => JSON.parse(JSON.stringify(value));
const read = key => { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; } };
const write = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; } };
let localGame = null, playMode = 'cpu', difficulty = 'normal', aims = [{angle:45,power:55,weaponId:null},{angle:135,power:55,weaponId:null}];
let session = null, room = null, busy = false, joining = false, generation = 0;
let socket = null, reconnectTimer = null, pollTimer = null, cpuTimer = null, retries = 0, refreshing = false, suspended = false;
let animation = null, frame = 0, renderedTurn = '', scoreFrom = [0,0], scoreStarted = 0, soundContext = null, canvasDirty = true, lastDraw = 0, localAimsBackup = null;
let preferences = { sound:true, speed:'normal' }, modalKind = '', lobbyDraftKey = '', camera = {height:HEIGHT,top:0}, chosenOwnColor = false;
const prefs = read('arcade.tanks.preferences.v1');
if (prefs && typeof prefs === 'object') preferences = {sound:prefs.sound !== false,speed:['normal','fast'].includes(prefs.speed)?prefs.speed:'normal'};

function currentGame() { return session ? room?.state?.game || null : localGame; }
function roomKey(transport) { return `arcade.tanks.room.${transport}.v1`; }
function transport() { return mp?.getStatus()?.effectiveTransport || 'cloudflare'; }
function savedRoom() {
  const s = read(roomKey(transport()));
  return s && CODE.test(s.code) && typeof s.token === 'string' && s.token.length >= 16 && typeof s.playerId === 'string' && s.transport === transport() ? s : null;
}
function persistRoom() { if(session && !write(roomKey(session.transport), session)) message('Browser storage is unavailable. Keep this page open to preserve your room seat.'); }
function message(value='', setup=false) { const el=$(setup?'setupMessage':'message');el.textContent=value;if(!setup)el.hidden=!value; }
function node(tag, value, className='') { const el=document.createElement(tag);el.textContent=value;if(className)el.className=className;return el; }
function ownTurn() { const game=currentGame();return !!game && !game.finished && !suspended && (session ? room?.status==='active' && room.state.phase==='playing' && room.turn?.playerId===session.playerId : playMode==='hotseat'||game.turn===0); }
function canAct() { return $('setup').hidden && ownTurn() && !busy && !animation; }
function seed() { const n=new Uint32Array(1);try{crypto.getRandomValues(n);}catch{n[0]=Date.now()>>>0;}return n[0]||1; }
function validName(value, fallback) { return String(value||fallback).trim().replace(/\s+/g,' ').slice(0,24)||fallback; }
function ensureAim(game) {
  for(let i=0;i<2;i++) { const a=aims[i];if(!game.tanks[i].inventory.includes(a.weaponId))a.weaponId=game.tanks[i].inventory[0]||null; }
}
function capture() { return localGame ? {schema:1,mode:playMode,difficulty,game:clone(localGame),aims:clone(aims)} : undefined; }
function restore(data) {
  if(!data||data.schema!==1||!['cpu','hotseat'].includes(data.mode))throw new Error('Invalid saved battle.');
  const restored=validateGame(data.game);
  stopAnimation();clearTimeout(cpuTimer);localGame=restored;playMode=data.mode;difficulty=['easy','normal','hard'].includes(data.difficulty)?data.difficulty:'normal';
  aims=[0,1].map(i=>{const a=data.aims?.[i];return {angle:Number.isFinite(a?.angle)?Math.max(0,Math.min(180,a.angle)):(i?135:45),power:Number.isFinite(a?.power)?Math.max(1,Math.min(100,a.power)):55,weaponId:restored.tanks[i].inventory.includes(a?.weaponId)?a.weaponId:restored.tanks[i].inventory[0]||null};});
  $('setup').hidden=true;renderedTurn='';scoreFrom=restored.tanks.map(t=>t.score);scoreStarted=0;render();scheduleCpu();return true;
}
function showSetup() { clearTimeout(cpuTimer);stopAnimation();closeModal();$('setup').hidden=false;$('result').hidden=true;message('');updateSetup(); }
async function startLocal() {
  if(session||busy||joining)return;
  playMode=$('mode').value==='hotseat'?'hotseat':'cpu';difficulty=$('difficulty').value;
  localGame=createGame({seed:seed(),terrainType:$('terrain').value,names:[validName($('nameInput0').value,'Player 1'),validName($('nameInput1').value,playMode==='cpu'?'Computer':'Player 2')],colors:[$('color0').value,$('color1').value],starter:0});
  aims=[{angle:45,power:55,weaponId:localGame.tanks[0].inventory[0]},{angle:135,power:55,weaponId:localGame.tanks[1].inventory[0]}];
  stopAnimation();scoreFrom=[0,0];scoreStarted=0;renderedTurn='';$('setup').hidden=true;save?.setExternalSession(false);render();await save?.saveNow();scheduleCpu();
}

function setScoreAnimation(before,after) { scoreFrom=before?.tanks.map(t=>t.score)||after.tanks.map(t=>t.score);scoreStarted=performance.now(); }
function sound(kind='fire') {
  if(!preferences.sound)return;
  try { const Audio=window.AudioContext||window.webkitAudioContext;if(!Audio)return;soundContext ||= new Audio();soundContext.resume().catch(()=>{});const now=soundContext.currentTime;
    const osc=soundContext.createOscillator(), gain=soundContext.createGain();osc.type=kind==='fire'?'sawtooth':'triangle';osc.frequency.setValueAtTime(kind==='fire'?130:220,now);osc.frequency.exponentialRampToValueAtTime(kind==='fire'?35:70,now+.18);gain.gain.setValueAtTime(.04,now);gain.gain.exponentialRampToValueAtTime(.0001,now+.22);osc.connect(gain);gain.connect(soundContext.destination);osc.start(now);osc.stop(now+.25);
  }catch{}
}
function stopAnimation() { animation=null; }
function animate(before,after,kind='fire') {
  const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
  if(reduced||document.hidden||suspended){stopAnimation();setScoreAnimation(before,after);render();scheduleCpu();return;}
  const shot=kind==='fire'?after.lastShot:null, move=kind==='move'?after.lastMove:null;
  if(!shot&&!move){render();scheduleCpu();return;}
  const duration=shot?Math.min(preferences.speed==='fast'?1400:4200,Math.max(900,shot.duration*1000/30/(preferences.speed==='fast'?2:1))):650;
  animation={before,shot,move,started:performance.now(),duration,tick:0,impactPlayed:false};scoreFrom=before.tanks.map(t=>t.score);scoreStarted=0;sound(kind);render();
}
async function localAction(intent, cpu=false) {
  if(busy||animation||!localGame||localGame.finished||session||(!cpu&&!canAct())||(cpu&&(playMode!=='cpu'||localGame.turn!==1)))return;
  busy=true;message('');updateButtons();
  try { const before=localGame;localGame=applyAction(localGame,intent,localGame.turn);ensureAim(localGame);renderedTurn='';
    // Save the complete resolved turn before showing its animation. A reload cannot fire it again.
    await save?.saveNow();animate(before,localGame,intent.type);
  }catch(error){message(error.message);}finally{busy=false;render();scheduleCpu();}
}
function scheduleCpu() {
  clearTimeout(cpuTimer);cpuTimer=null;
  if(session||playMode!=='cpu'||!localGame||localGame.finished||localGame.turn!==1||busy||animation||suspended||document.hidden||!$('setup').hidden)return;
  cpuTimer=setTimeout(()=>{cpuTimer=null;if(session||animation||busy||suspended||document.hidden||!$('setup').hidden)return;try{const intent=chooseCpuAction(localGame,difficulty);aims[1]={angle:intent.angle,power:intent.power,weaponId:intent.weaponId};localAction(intent,true);}catch(error){message(error.message);}},650);
}

async function request(path, body, credentials=session) {
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
  try {
    const response=await fetch(ROOT+path,{method:body===undefined?'GET':'POST',headers:{...(body===undefined?{}:{'content-type':'application/json'}),...(credentials?{authorization:`Bearer ${credentials.token}`}:{})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:controller.signal,cache:'no-store'});
    let data;try{data=await response.json();}catch{throw new Error('The room returned an unreadable response. Reconnect to check your battle.');}
    if(!response.ok||data.ok===false)throw Object.assign(new Error(data.error||'The room request failed.'),{status:response.status});return data;
  }catch(error){if(error.name==='AbortError')throw new Error('Connection timed out. Your seat is saved; reconnect to check the latest turn.');if(error instanceof TypeError)throw new Error('Cannot reach the room. Check your connection, then try again.');throw error;}
  finally{clearTimeout(timer);}
}
function networkName() { const value=validName(mp?.preferredUsername($('nickname').value)||$('nickname').value,'Player 1');if(!NAME.test(value))throw new Error('Use a name of 1-24 letters or numbers, with spaces, apostrophes, periods, underscores or hyphens.');return value; }
async function enter(kind) {
  if(session||joining||busy)return;joining=true;message('',true);updateButtons();
  try {
    if(!mp)throw new Error('The Arcade connection is missing. Open this game from Arcade.');await mp.ready();
    const selected=transport(),saved=kind==='resume'?savedRoom():null;
    if(kind==='resume'&&!saved)throw new Error('There is no saved room for this connection.');
    const name=saved?.username||networkName(),code=saved?.code||$('joinCode').value.trim().toUpperCase();
    if(kind!=='create'&&!CODE.test(code))throw new Error('Enter the six-character room code.');
    mp.pinRoomTransport(selected);const result=kind==='create'?await request('',{game:'tanks',username:name,maxPlayers:2},null):await request(`/${code}/join`,saved?{reconnectToken:saved.token}:{username:name},null);
    if(result.room?.game!=='tanks'){if(!saved&&result.token)await request(`/${result.code}/actions`,{type:'leave'},{token:result.token}).catch(()=>{});throw new Error('That room belongs to another game. Use a Tank Tactics room code.');}
    generation++;localAimsBackup=clone(aims);session={code:result.code,token:result.token,playerId:result.playerId,username:result.room.members.find(m=>m.playerId===result.playerId)?.username||name,transport:selected};room=null;suspended=false;stopAnimation();clearTimeout(cpuTimer);save?.setExternalSession(true);$('setup').hidden=true;$('roomBar').hidden=false;accept(result.room);persistRoom();connectSocket();startPolling();
    if(!saved&&room.status==='lobby') { const ownSeat=room.members.find(m=>m.playerId===session.playerId)?.seat??0;const fields={color:chosenOwnColor?$('color0').value:room.state.colors[ownSeat],...(room.hostPlayerId===session.playerId?{terrainType:$('terrain').value}:{})};$('lobbyColor').value=fields.color;if(fields.terrainType)$('lobbyTerrain').value=fields.terrainType;await action('configure',fields); }
  }catch(error){message(error.message,!session);if(!session)mp?.resetRoomTransport();}
  finally{joining=false;updateTransport();updateButtons();}
}
function accept(snapshot) {
  if(!session||!snapshot||snapshot.game!=='tanks'||snapshot.code!==session.code||snapshot.playerId!==session.playerId||!snapshot.state)return false;
  if(room&&(snapshot.version<room.version||(snapshot.version===room.version&&snapshot.revision<room.revision)))return false;
  if(snapshot.state.game){try{snapshot={...snapshot,state:{...snapshot.state,game:validateGame(snapshot.state.game)}};}catch{message('The room sent an invalid battle. Refreshing cannot replace your saved seat.');return false;}}
  const before=room?.state?.game,previousRound=room?.state?.round,previousVersion=room?.version;room=snapshot;
  const after=currentGame();
  if(after){
    if(previousRound!==undefined&&previousRound!==room.state.round){stopAnimation();aims=[{angle:45,power:55,weaponId:null},{angle:135,power:55,weaponId:null}];closeModal();}
    ensureAim(after);
    if(before&&previousRound===room.state.round&&after.shotsTotal>before.shotsTotal)animate(before,after,'fire');
    else if(before&&after.lastMove&&snapshot.version>previousVersion&&(after.lastMove.from!==before.lastMove?.from||after.lastMove.to!==before.lastMove?.to||after.tanks[after.turn].movesLeft!==before.tanks[before.turn].movesLeft))animate(before,after,'move');
    else if(!before){scoreFrom=after.tanks.map(t=>t.score);scoreStarted=0;}
  }
  mp?.observeRoom(room,'tanks');persistRoom();render();return true;
}
async function refresh(force=false) {
  if(!session||suspended||(refreshing&&!force))return;const credentials=session,epoch=generation;refreshing=true;
  try{const result=await request(`/${credentials.code}/state`,undefined,credentials);if(epoch===generation)accept(result.room);}
  catch(error){if(epoch===generation&&[401,404,410].includes(error.status))message('This saved room is no longer available. Use Leave to return to setup.');}
  finally{refreshing=false;}
}
function startPolling() { clearInterval(pollTimer);pollTimer=setInterval(()=>{if(!document.hidden)refresh();},4000); }
function connectSocket() {
  if(!session||suspended||socket?.readyState===0||socket?.readyState===1)return;clearTimeout(reconnectTimer);const epoch=generation;
  try {
    const ws=new WebSocket(ROOT.replace(/^https:/,'wss:')+`/${session.code}/ws?token=${encodeURIComponent(session.token)}`);socket=ws;
    ws.onopen=()=>{if(epoch!==generation||socket!==ws)return ws.close();retries=0;renderConnection();refresh();};
    ws.onmessage=event=>{if(epoch!==generation||socket!==ws)return;try{const result=JSON.parse(event.data);if(result.type==='state')accept(result.room);else if(result.type==='error'){message(result.error||'The room rejected that action.');refresh();}}catch{}};
    ws.onerror=()=>{if(socket===ws){try{ws.close();}catch{}}};
    ws.onclose=()=>{if(epoch!==generation||socket!==ws)return;socket=null;renderConnection();reconnectTimer=setTimeout(connectSocket,Math.min(12000,600*2**Math.min(retries++,5)));};
  }catch{socket=null;reconnectTimer=setTimeout(connectSocket,3000);}renderConnection();
}
function stopNetwork() { clearTimeout(reconnectTimer);clearInterval(pollTimer);reconnectTimer=pollTimer=null;const old=socket;socket=null;if(old){old.onclose=old.onmessage=old.onopen=old.onerror=null;try{old.close();}catch{}} }
async function action(type,fields={}) {
  if(busy||!session||!room)return false;busy=true;message('');updateButtons();const epoch=generation;
  try{const result=await request(`/${session.code}/actions`,{type,...fields,expectedVersion:room.version});if(epoch!==generation)return false;accept(result.room);return true;}
  catch(error){if(epoch!==generation)return false;await refresh(true);message(error.status===409?`${error.message}. The battlefield is refreshed; try again.`:error.message);return false;}
  finally{if(epoch===generation){busy=false;render();}}
}
async function leaveRoom() {
  if(!session||busy)return;busy=true;updateButtons();
  try {
    try{await request(`/${session.code}/actions`,{type:'leave'});}catch(error){if(![401,404,410].includes(error.status))throw error;}
    try{localStorage.removeItem(roomKey(session.transport));}catch{}generation++;stopNetwork();stopAnimation();mp?.forgetRoomAlert?.('tanks',session.code);session=room=null;if(localAimsBackup)aims=localAimsBackup;localAimsBackup=null;busy=false;save?.setExternalSession(false);mp?.resetRoomTransport();$('roomBar').hidden=true;showSetup();render();
  }catch(error){message(error.message);}finally{busy=false;updateButtons();}
}
function renderConnection() { if(!session)return;const live=socket?.readyState===1;$('connection').textContent=`${session.transport==='nearby'?'Nearby':'Internet'} · ${live?'Live':'Reconnecting'}`;$('connection').title=live?'Live battle updates':'Retrying live updates. Your seat is saved.';$('roomCode').textContent=session.code; }
function updateTransport() {
  $('setupTransport').textContent=`Multiplayer · ${transport()==='nearby'?'Nearby Arcade':'Internet'}`;
  const identity=mp?.getIdentity?.();$('nickname').readOnly=!!identity;if(identity)$('nickname').value=identity.nickname;
  const saved=savedRoom();$('resumeRoom').hidden=!saved;$('resumeRoom').textContent=saved?`Resume room ${saved.code}`:'Resume saved room';
  if(!identity&&!$('nickname').value&&saved?.username)$('nickname').value=saved.username;
  $('invite').hidden=!session||session.transport!=='nearby';renderConnection();
}

function updateSetup() {
  const network=$('mode').value==='network',cpu=$('mode').value==='cpu';$('networkControls').hidden=!network;$('localStart').hidden=network;$('secondPlayer').hidden=network;$('difficultyField').hidden=!cpu;$('secondNameLabel').textContent=cpu?'Computer':'Second player';
  if(cpu&&$('nameInput1').value==='Player 2')$('nameInput1').value='Computer';if(!cpu&&$('nameInput1').value==='Computer')$('nameInput1').value='Player 2';
  $('setupArt').innerHTML=tankSvg($('color0').value)+`<span>VS</span>`+tankSvg($('color1').value,-1);updateTransport();
}
function render() {
  canvasDirty=true;
  const game=currentGame();$('roomBar').hidden=!session;renderConnection();
  if(game){
    ensureAim(game);
    for(let i=0;i<2;i++) { const tank=game.tanks[i];$('name'+i).textContent=tank.name;$('tankIcon'+i).innerHTML=tankSvg(tank.color,i?-1:1);$('score'+i).style.setProperty('--tank-color',tank.color);$('score'+i).classList.toggle('current',!game.finished&&game.turn===i);$('meta'+i).textContent=`${tank.inventory.length} shots · ${tank.movesLeft} moves`; }
    $('shotCount').textContent=`${game.shotsTotal} / 20`;$('terrainLabel').textContent=game.terrainType.toUpperCase();
    const turnKey=`${game.seed}:${game.turn}:${game.shotsTotal}`;
    if(renderedTurn!==turnKey){renderedTurn=turnKey;const a=aims[game.turn];$('angle').value=$('angleNumber').value=a.angle;$('power').value=$('powerNumber').value=a.power;}
    const tank=game.tanks[game.turn],w=weaponById(aims[game.turn].weaponId);$('weaponName').textContent=w?.name||'Ammunition spent';$('weaponIcon').innerHTML=w?weaponSvg(w):'';$('weapon').style.setProperty('--weapon-color',w?.color||'#21dcff');$('weaponCount').textContent=`${tank.inventory.length} weapon${tank.inventory.length===1?'':'s'} remaining`;$('movesLeft').textContent=`${tank.movesLeft} move${tank.movesLeft===1?'':'s'} remaining`;
    $('weaponDetail').textContent=w ? `${w.description} ${terrainSummary(w)}` : 'All of this tank’s weapons have been fired.';
    $('loadoutWeapons').replaceChildren(...tank.inventory.map(id=>{const weapon=weaponById(id),b=node('button','','loadout-weapon'),art=node('div','');b.type='button';b.dataset.loadoutWeapon=id;b.style.setProperty('--weapon-color',weapon.color);b.classList.toggle('selected',id===aims[game.turn].weaponId);b.setAttribute('aria-label',`Select ${weapon.name}`);art.innerHTML=weaponSvg(weapon);b.append(art,node('span',weapon.name));b.onclick=()=>{if(!canAct())return;aims[game.turn].weaponId=id;save?.touch();render();};return b;}));
    if(animation){$('headline').textContent=animation.shot?`${game.tanks[animation.shot.actor].name} fires ${weaponById(animation.shot.weaponId)?.name||'a shot'}`:`${game.tanks[animation.move.actor].name} is moving`;$('subline').textContent='Watch the battlefield.';}
    else if(game.finished){$('headline').textContent=game.winner===null?'A perfect tie!':`${game.tanks[game.winner].name} wins!`;$('subline').textContent='All twenty shots fired.';}
    else if(session&&room?.status==='finished'){$('headline').textContent='This room has ended';$('subline').textContent='Leave to start a new battle.';}
    else{$('headline').textContent=session?(ownTurn()?'Your turn':`${tank.name}'s turn`):playMode==='cpu'&&game.turn===1?'Computer is lining up a shot':`${tank.name}'s turn`;$('subline').textContent='Choose a weapon, aim, then fire.';}
    $('statusDot').style.background=tank.color;$('statusDot').style.boxShadow=`0 0 12px ${tank.color}`;
  }else{
    $('headline').textContent=session?'Waiting in the lobby':'Ready to roll?';$('shotCount').textContent='0 / 20';$('terrainLabel').textContent=(room?.state?.terrainType||$('terrain').value).toUpperCase();
    if(session&&room){for(let i=0;i<2;i++){const member=room.members.find(m=>m.seat===i),c=room.state.colors?.[i]||(i?'#ff6b6b':'#39b9ff');$('name'+i).textContent=member?.username||'Waiting for player';$('tankIcon'+i).innerHTML=tankSvg(c,i?-1:1);$('points'+i).textContent='0';$('gain'+i).textContent='';$('meta'+i).textContent='10 shots · 4 moves';$('score'+i).style.setProperty('--tank-color',c);$('score'+i).classList.remove('current');}}
  }
  renderLobby();renderResult();updateButtons();drawScores(performance.now());resizeCanvas();
}
function renderLobby() {
  const active=!!session&&room?.status==='lobby';$('lobby').hidden=!active;if(!active)return;
  const host=room.hostPlayerId===session.playerId,members=room.members.slice().sort((a,b)=>a.seat-b.seat),me=members.find(m=>m.playerId===session.playerId);
  $('lobbyText').textContent=members.length===2?'Both tanks are here. Pick your colors and get ready.':`Waiting for a second player. Room code: ${session.code}`;
  $('lobbyMembers').replaceChildren(...[0,1].map(seat=>{const member=members.find(m=>m.seat===seat),el=node('div','','lobby-member');const art=node('div','');art.innerHTML=tankSvg(room.state.colors?.[seat]||(seat?'#ff6b6b':'#39b9ff'),seat?-1:1);el.append(art,node('span',member?.username||'Waiting for player'));return el;}));
  const key=`${room.code}:${room.state.round}`;
  if(lobbyDraftKey!==key){lobbyDraftKey=key;$('lobbyColor').value=room.state.colors?.[me?.seat??0]||'#39b9ff';$('lobbyTerrain').value=room.state.terrainType||'hilly';}
  else if(!host)$('lobbyTerrain').value=room.state.terrainType||'hilly';
  $('lobbyTerrain').disabled=!host||busy;$('startRoom').hidden=!host;$('startRoom').disabled=busy||!room.ready;$('lobbyNote').textContent=host?'The host starts the battle when both players are ready.':'The host chooses the terrain and starts the battle.';
}
function renderResult() {
  const game=currentGame(),show=!!game?.finished&&!animation;$('result').hidden=!show;if(!show)return;
  $('resultTitle').textContent=game.winner===null?'It is a tie!':`${game.tanks[game.winner].name} wins!`;$('resultText').textContent='Twenty shots, two tanks. The highest damage score wins.';
  $('resultTanks').replaceChildren(...game.tanks.map((tank,i)=>{const el=node('div',''),art=node('div','');art.innerHTML=tankSvg(tank.color,i?-1:1);el.append(art,node('strong',String(tank.score)),node('span',tank.name));return el;}));
  const voted=session&&room.state.rematchVotes?.includes(session.playerId);$('playAgain').disabled=busy||voted;$('playAgain').textContent=session?(voted?'Rematch requested':'Request rematch'):'Play again';$('rematchNote').textContent=session?(voted?'Waiting for the other player to request a rematch.':'Both players must request a rematch.'):'New terrain. New weapons. Same rivalry.';
}
function updateButtons() {
  const game=currentGame(),allowed=canAct();for(const id of ['weapon','angle','angleNumber','power','powerNumber','fire'])$(id).disabled=!allowed;
  const movable=allowed&&game.tanks[game.turn].movesLeft>0;for(const id of ['moveDistance','moveLeft','moveRight'])$(id).disabled=!movable;
  $('create').disabled=$('join').disabled=$('resumeRoom').disabled=joining||busy||!!session;$('nickname').disabled=$('joinCode').disabled=joining;$('localStart').disabled=busy||joining||!!session;$('leave').disabled=busy;$('configureRoom').disabled=busy;$('lobbyColor').disabled=busy;$('newGame').disabled=busy||joining;
  if(modalKind==='weapons')for(const button of $('modalBody').querySelectorAll('[data-weapon]'))button.disabled=!allowed;
  for(const button of $('loadoutWeapons').querySelectorAll('button'))button.disabled=!allowed;
}
function drawScores(now) {
  const game=currentGame();if(!game)return;let fraction=1;if(animation&&!scoreStarted)fraction=0;else if(scoreStarted)fraction=Math.min(1,(now-scoreStarted)/850);
  for(let i=0;i<2;i++){const final=game.tanks[i].score,from=scoreFrom[i]||0,value=String(Math.floor(from+(final-from)*(1-Math.pow(1-fraction,3)))),gain=final>from&&fraction>0&&fraction<1?`+${final-from}`:'';if($('points'+i).textContent!==value)$('points'+i).textContent=value;if($('gain'+i).textContent!==gain)$('gain'+i).textContent=gain;}
  if(fraction===1){scoreFrom=game.tanks.map(t=>t.score);scoreStarted=0;}
}
function resizeCanvas() {
  const box=$('arena').getBoundingClientRect(),availableWidth=Math.max(1,box.width-2),availableHeight=Math.max(1,box.height-2),game=animation?.before||currentGame(),span=game?Math.max(...game.tanks.map(t=>t.y))-Math.min(...game.tanks.map(t=>t.y)):0;
  const viewHeight=Math.round(Math.max(220,Math.min(HEIGHT,Math.max(span+100,WIDTH*availableHeight/availableWidth)))),ratio=WIDTH/viewHeight;
  const width=Math.min(availableWidth,availableHeight*ratio),w=`${Math.max(1,width)}px`,h=`${Math.max(1,width/ratio)}px`;
  camera.height=viewHeight;const mid=game?(Math.min(...game.tanks.map(t=>t.y))+Math.max(...game.tanks.map(t=>t.y)))/2:400;camera.top=Math.round(Math.max(0,Math.min(HEIGHT-viewHeight,mid-viewHeight*.55)));
  if($('battlefield').height!==viewHeight)$('battlefield').height=viewHeight;if($('battlefield').style.width!==w)$('battlefield').style.width=w;if($('battlefield').style.height!==h)$('battlefield').style.height=h;
  canvasDirty=true;
}
function tick(now) {
  frame=requestAnimationFrame(tick);const game=currentGame();if(!game||suspended||document.hidden)return;
  if(animation){const fraction=Math.min(1,(now-animation.started)/animation.duration);animation.tick=animation.shot?fraction*animation.shot.duration:fraction*30;
    const effectTick=animation.shot?.effects.find(e=>e.kind==='explosion'||e.kind==='flame')?.tick;
    if(!animation.impactPlayed&&(effectTick===undefined?fraction>.65:animation.tick>=effectTick)){animation.impactPlayed=true;sound('impact');scoreStarted=now;}
    if(fraction===1){if(!scoreStarted)scoreStarted=now;animation=null;render();scheduleCpu();}
  }
  if(canvasDirty||(animation&&now-lastDraw>=30)){drawBattle($('battlefield'),game,{aims,animation,time:now,viewportTop:camera.top,displayScale:Math.max(.2,$('battlefield').clientWidth/WIDTH)});lastDraw=now;canvasDirty=false;}drawScores(now);
}

function closeModal() { if($('modal').open)$('modal').close();modalKind=''; }
function modal(title,body,actions=[],kind='') {
  closeModal();modalKind=kind;$('modalTitle').textContent=title;$('modalBody').replaceChildren(...body);$('modalActions').replaceChildren(...actions.map(({label,style='',run})=>{const b=node('button',label,`arcade-btn ${style}`);b.type='button';b.onclick=run;return b;}));$('modal').showModal();updateButtons();
}
function weaponPicker(catalog=false) {
  const game=currentGame();if(!catalog&&!canAct())return;
  const available=catalog?WEAPONS:game.tanks[game.turn].inventory.map(weaponById),grid=node('div','','weapon-grid');grid.id='weaponGrid';
  const renderGrid=filter=>{grid.replaceChildren(...available.filter(w=>!filter||`${w.name} ${w.description} ${w.kind}`.toLowerCase().includes(filter)).map(w=>{
    const b=node(catalog?'div':'button','','weapon-card');b.dataset.weapon=w.id;b.style.setProperty('--weapon-color',w.color);b.classList.toggle('selected',!catalog&&w.id===aims[game.turn].weaponId);const art=node('div','');art.innerHTML=weaponSvg(w);const details=node('div','','details');details.append(node('strong',w.name),node('small',w.description));
    const stats=node('div','','weapon-stats');
    const digging=({builder:'Builds earth',drill:'Vertical shaft',tunnel:'Collapsed tunnel',carver:'Measured trench',flame:'Scorches surface',lightning:'Small electrical pits',beam:'Cuts or scars soil',wave:'Ground pulses',mine:'Delayed crater'}[w.kind]||'Impact crater');
    for(const text of [`Damage ${w.damage}`,digging,w.count>1?`${w.count} impacts`:w.bounces?`${w.bounces} bounces`:'Single shot'])stats.append(node('span',text));
    const terrainNote=node('small',terrainSummary(w),'terrain-note');const preview=node('div','','terrain-swatch');preview.innerHTML=terrainPreviewSvg(w);details.append(stats,terrainNote,preview);b.append(art,details);
    if(!catalog){b.type='button';b.onclick=()=>{if(!canAct())return;aims[game.turn].weaponId=w.id;save?.touch(0);closeModal();render();};}return b;
  }));};renderGrid('');const search=document.createElement('input');search.id='weaponSearch';search.placeholder='Find a weapon';search.type='search';search.setAttribute('aria-label','Search weapons');search.oninput=()=>renderGrid(search.value.trim().toLowerCase());
  modal(catalog?`The arsenal · ${WEAPONS.length} weapons`:'Choose your weapon',[node('p',catalog?'Every weapon has its own behavior. Each battle deals ten different single-use weapons to each tank.':'One shot each. Terrain sketches use the same scale: dashed is the original ground, solid is the effect. Spread depends on aim; bedrock limits depth.','weapon-description'),search,grid],[],catalog?'arsenal':'weapons');
}
function rules() {
  const list=document.createElement('ol');list.className='help-list';for(const value of ['Each tank gets ten random, different weapons. Every weapon can be fired once.','Take turns firing. Angle 0° points right, 90° points straight up, and 180° points left. Power controls launch speed.','Damage adds points. Hitting yourself gives points to your opponent. Tanks stay in play until all twenty shots are fired. Highest score wins.','Before firing, you may move left or right. Each tank gets four moves for the whole game, each up to five tank lengths. Moving keeps your turn.','Terrain previews show the solid resulting ground against the dashed original surface. Dimensions are world units; bedrock limits depth. Tunnels collapse into open trenches, not enclosed caves.', 'Explosions reshape the terrain. Some weapons roll, bounce, dig, build, fire beams or leave mines. Mines can explode on later turns or when a tank moves close.','Your local battle saves automatically. Multiplayer rooms save your seat so you can reconnect. Returning home keeps your progress.'])list.append(node('li',value));
  modal('How to play',[list],[{label:`Browse ${WEAPONS.length} weapons`,style:'primary',run:()=>weaponPicker(true)},{label:'Got it',run:closeModal}],'rules');
}
function settings() {
  const switches=node('div','','settings-toggles');const soundLabel=node('label',''),input=document.createElement('input');input.type='checkbox';input.checked=preferences.sound;input.onchange=()=>{preferences.sound=input.checked;write('arcade.tanks.preferences.v1',preferences);};soundLabel.append(input,node('span','Battle sounds'));
  const speedLabel=node('label','Animation speed'),speed=document.createElement('select');speed.innerHTML='<option value="normal">Normal</option><option value="fast">Fast</option>';speed.value=preferences.speed;speed.onchange=()=>{preferences.speed=speed.value;write('arcade.tanks.preferences.v1',preferences);};speedLabel.append(speed);switches.append(soundLabel,speedLabel);
  const alert=mp?.getTurnAlertSettings();modal('Settings',[switches,node('p','Local progress saves automatically after every action. Your shot is saved before its animation, so a reload resumes at the next turn.'),node('p',`Multiplayer turn sound is ${alert?.soundEnabled?'on':'off'}. Desktop turn notifications use your browser notification setting.`)],[{label:'How to play',run:rules},{label:`Arsenal (${WEAPONS.length})`,run:()=>weaponPicker(true)},{label:alert?.soundEnabled?'Mute turn sound':'Enable turn sound',run:()=>{mp?.setTurnSoundEnabled(!alert?.soundEnabled);settings();}},{label:'Enable notifications',run:async()=>{await mp?.requestTurnNotifications();closeModal();}}],'settings');
}
function confirmNew() {
  if(session){message('Use the room rematch button after this battle, or Leave to start a different game.');return;}
  if(!localGame||localGame.finished){showSetup();return;}
  modal('Start a new battle?',[node('p','The next battle will replace this saved local battle when you press Start battle.')],[{label:'Keep playing',run:closeModal},{label:'Game setup',style:'gold',run:showSetup}],'new');
}
function aimInput(kind,source) {
  const game=currentGame();if(!canAct())return;const min=kind==='angle'?0:1,max=kind==='angle'?180:100;const n=Number($(source).value);if(!Number.isFinite(n))return;const value=Math.max(min,Math.min(max,Math.round(n)));aims[game.turn][kind]=value;$(kind).value=$(kind+'Number').value=value;canvasDirty=true;save?.touch();
}
async function fire() {if(!canAct())return;const game=currentGame(),a=aims[game.turn],intent={type:'fire',weaponId:a.weaponId,angle:a.angle,power:a.power};if(session)await action('fire',{weaponId:intent.weaponId,angle:intent.angle,power:intent.power});else await localAction(intent);}
async function move(sign) {if(!canAct())return;const distance=Number($('moveDistance').value)*TANK_WIDTH*sign;if(session)await action('move',{distance});else await localAction({type:'move',distance});}
async function home() {
  persistRoom();clearTimeout(cpuTimer);suspended=true;stopNetwork();closeModal();await save?.saveNow();
  if(window.ArcadeSave&&typeof window.ArcadeSave.goHome==='function')return window.ArcadeSave.goHome();
  if(window.ArcadeMultiplayer&&typeof window.ArcadeMultiplayer.goHome==='function')return window.ArcadeMultiplayer.goHome();
  window.location.href='../index.html';
}

$('localStart').onclick=startLocal;$('mode').onchange=updateSetup;$('terrain').onchange=updateSetup;for(const id of ['color0','color1'])$(id).oninput=()=>{if(id==='color0')chosenOwnColor=true;updateSetup();};
$('create').onclick=()=>enter('create');$('join').onclick=()=>enter('join');$('resumeRoom').onclick=()=>enter('resume');$('joinCode').oninput=()=>{$('joinCode').value=$('joinCode').value.toUpperCase().replace(/[^A-Z0-9]/g,'');};$('joinCode').onkeydown=e=>{if(e.key==='Enter')enter('join');};
$('configureRoom').onclick=()=>action('configure',{color:$('lobbyColor').value,...(room?.hostPlayerId===session?.playerId?{terrainType:$('lobbyTerrain').value}:{})});$('startRoom').onclick=async()=>{if(await action('configure',{color:$('lobbyColor').value,terrainType:$('lobbyTerrain').value}))await action('start');};
$('weapon').onclick=()=>weaponPicker();$('fire').onclick=fire;$('moveLeft').onclick=()=>move(-1);$('moveRight').onclick=()=>move(1);$('moveDistance').oninput=()=>{$('moveAmount').textContent=`${$('moveDistance').value} tank length${$('moveDistance').value==='1'?'':'s'}`;};
for(const kind of ['angle','power']){for(const id of [kind,kind+'Number'])$(id).oninput=()=>aimInput(kind,id);}
$('newGame').onclick=confirmNew;$('settings').onclick=settings;$('setupHelp').onclick=rules;$('modalClose').onclick=closeModal;$('modal').addEventListener('close',()=>{modalKind='';});
$('playAgain').onclick=()=>{if(session)action('rematch');else showSetup();};$('leave').onclick=()=>modal('Leave this room?',[node('p','Leaving ends the current battle for both players and removes your saved seat. Returning to Arcade with Home keeps your room available instead.')],[{label:'Stay',run:closeModal},{label:'Leave room',style:'danger',run:async()=>{await leaveRoom();closeModal();}}],'leave');
$('roomCode').onclick=async()=>{try{await navigator.clipboard.writeText(session.code);message('Room code copied. Share it with the other player.');}catch{modal('Share this room',[node('p',`Room code: ${session.code}`)]);}};$('invite').onclick=()=>{if(session){mp?.invite('tanks',session.code,'Tank Tactics');message('Invitation sent to Nearby Arcade.');}};
$('home').onclick=$('setupHome').onclick=home;
window.addEventListener('resize',resizeCanvas);new ResizeObserver(resizeCanvas).observe($('arena'));
window.addEventListener('pagehide',()=>{persistRoom();save?.saveNow();suspended=true;stopNetwork();clearTimeout(cpuTimer);});
window.addEventListener('pageshow',()=>{suspended=false;if(session){connectSocket();startPolling();refresh();}scheduleCpu();});
window.addEventListener('arcadepause',()=>{persistRoom();save?.saveNow();suspended=true;stopNetwork();clearTimeout(cpuTimer);closeModal();});
window.addEventListener('arcaderesume',()=>{suspended=false;if(session){connectSocket();startPolling();refresh();}scheduleCpu();});
document.addEventListener('visibilitychange',()=>{if(document.hidden){save?.saveNow();clearTimeout(cpuTimer);stopAnimation();}else if(!suspended){if(session){connectSocket();refresh();}render();scheduleCpu();}});
window.addEventListener('keydown',event=>{if(!$('setup').hidden||$('modal').open||event.target.closest('input,select,textarea,button'))return;if(event.key===' '&&canAct()){event.preventDefault();fire();}else if(event.key==='ArrowLeft'&&canAct()){event.preventDefault();aims[currentGame().turn].angle=Math.min(180,aims[currentGame().turn].angle+1);renderedTurn='';render();save?.touch();}else if(event.key==='ArrowRight'&&canAct()){event.preventDefault();aims[currentGame().turn].angle=Math.max(0,aims[currentGame().turn].angle-1);renderedTurn='';render();save?.touch();}});

Object.defineProperty(window,'TanksGame',{value:Object.freeze({getState:()=>currentGame()?clone(currentGame()):null,getDebug:()=>({mode:session?'network':playMode,animating:!!animation,busy,session:session?{code:session.code,playerId:session.playerId,transport:session.transport}:null,room:room?clone(room):null}),getWeapons:()=>clone(WEAPONS),capture:()=>capture()}),writable:false});
const query=new URLSearchParams(location.search),joinCode=(query.get('room')||query.get('join')||query.get('code')||'').toUpperCase().slice(0,6);$('joinCode').value=joinCode;if(joinCode||query.get('online')==='1')$('mode').value='network';
if(joinCode||query.get('online')==='1')save?.setExternalSession(true);
initBattleView(resizeCanvas);updateSetup();render();frame=requestAnimationFrame(tick);
mp?.onStatus(updateTransport);if(mp)mp.ready().then(updateTransport).catch(()=>message('The Arcade connection is not ready. Local play is available.',true));
if(save)save.register({id:'tanks',title:'Tank Tactics',version:1,capture,restore,meaningful:()=>!!localGame||save.hasSave(),summary:()=>localGame?`${localGame.tanks[0].name} ${localGame.tanks[0].score} · ${localGame.tanks[1].name} ${localGame.tanks[1].score}. ${localGame.shotsTotal}/20 shots fired.`:'',startFresh:showSetup});
