(function(root){
  'use strict';
  if(root.ArcadeSharedActivity) return;
  const nativeRAF = root.requestAnimationFrame.bind(root), nativeCancelRAF = root.cancelAnimationFrame.bind(root);
  const later = root.setTimeout.bind(root), cancelLater = root.clearTimeout.bind(root);
  const every = root.setInterval.bind(root), cancelEvery = root.clearInterval.bind(root);
  const pathParts = root.location.pathname.split('/').filter(Boolean);
  const activity = /\.html?$/i.test(pathParts.at(-1)||'') ? pathParts.at(-2) : pathParts.at(-1);
  const specialNames = {simon:'SimonSharedAdapter', 'music-maker':'MusicMakerSharedAdapter', hangman:'HangmanSharedAdapter','make-10':'Make10SharedAdapter',trivia:'TriviaSharedAdapter',jigsaw:'JigsawSharedAdapter',shuffleboard:'ShuffleboardAutosave',balloons:'BalloonsSharedAdapter','orb-slicer':'OrbSlicerSharedAdapter'};
  let room = null, connected = false, active = false, applying = false, working = false, switching = false, awaitingAuthority = false;
  let localBackup = null, lastSent = '', appliedSequence = -1, sequence = 0, applyEpoch = 0, statusText = '';
  let client = null, panel = null, launch = null, notice = null, errorNode = null, seats = null;
  let adapterOverride = null, restoreChain = Promise.resolve(), captureTimer = 0, tickInterval = 0, captureErrors = 0;
  let nextPublishAt = 0;
  let launchPositionTimer = 0;
  const frozenFrames = new Map(), pendingFrames = new Map(), frozenTimers = new Map(), paintedFrames = new Map();
  const originalStorageSet = Storage.prototype.setItem, originalStorageRemove = Storage.prototype.removeItem;
  const MAX_RAW = 8 * 1024 * 1024, MAX_WIRE = 50 * 1024;
  const sessionKey = 'arcade_shared_room_' + activity + '_v1';
  function isController(){ return !!(active && room?.status === 'active' && room.turn?.playerId === client?.session?.playerId); }
  function isSpectator(){ return active && (!isController() || !connected || switching || awaitingAuthority); }
  function isGameCallback(){ return isSpectator(); }

  // Only the owner runs the simulation. A spectator sees the owner's actual
  // canvas images, never a second random/physics simulation. Preserve one
  // pending frame per loop so transferring controls does not lose the loop.
  root.requestAnimationFrame = function(callback){
    let id;
    id = nativeRAF(function(ts){
      pendingFrames.delete(id);
      if(isSpectator()) frozenFrames.set(id, callback);
      else callback(ts);
    });
    pendingFrames.set(id,callback);
    return id;
  };
  root.cancelAnimationFrame = function(id){ frozenFrames.delete(id); pendingFrames.delete(id); nativeCancelRAF(id); };
  root.setTimeout = function(callback, delay, ...args){
    if(typeof callback !== 'function') return root.eval === undefined ? 0 : later(callback, delay, ...args);
    let id;
    id = later(function(){
      if(isGameCallback()) frozenTimers.set(id, {callback,args});
      else callback(...args);
    }, delay);
    return id;
  };
  root.clearTimeout = function(id){ frozenTimers.delete(id); cancelLater(id); };
  root.setInterval = function(callback, delay, ...args){
    if(typeof callback !== 'function') return every(callback, delay, ...args);
    return every(function(){ if(!isGameCallback()) callback(...args); }, delay);
  };
  Storage.prototype.setItem = function(key,value){
    if(active && this === root.localStorage && key !== sessionKey && !String(key).startsWith('arcade.turnAlerts.')) return;
    return originalStorageSet.call(this,key,value);
  };
  Storage.prototype.removeItem = function(key){
    if(active && this === root.localStorage && key !== sessionKey && !String(key).startsWith('arcade.turnAlerts.')) return;
    return originalStorageRemove.call(this,key);
  };
  function adapter(){
    const custom = adapterOverride || root[specialNames[activity]];
    return custom || root.ArcadeSave?.getAdapter?.();
  }
  function clone(value){ return value == null ? value : JSON.parse(JSON.stringify(value)); }
  function showError(error){
    statusText = String(error?.message || error || 'Shared play could not continue.');
    if(errorNode) errorNode.textContent = statusText;
  }
  function callbackAuthority(enabled){
    adapter()?.setController?.(enabled);
    if(!enabled) return;
    const timers=[...frozenTimers.values()];frozenTimers.clear();
    timers.forEach(({callback,args})=>later(callback,0,...args));
    const callbacks = [...new Set(frozenFrames.values())]; frozenFrames.clear();
    callbacks.forEach(callback => {if(![...pendingFrames.values()].includes(callback))root.requestAnimationFrame(callback);});
  }
  function captureView(){
    const entries = [];
    for(const el of document.querySelectorAll('[id]')){
      if(el.closest('[data-shared-ui]') || /pass|secret|custom.?word|answer.?input|name.?input/i.test(el.id)) continue;
      const item = {id:el.id};
      if(!el.children.length && !/^(?:INPUT|TEXTAREA|SELECT|CANVAS|SCRIPT|STYLE|SVG|IMG|AUDIO|VIDEO)$/.test(el.tagName)) item.text = el.textContent.slice(0,2000);
      if(/overlay|menu|start|result|dialog|screen|explain|round|holeOv|favOverlay/i.test(el.id)){
        item.hidden = el.hidden; item.display = el.style.display;
        item.classes = ['hidden','show','open','visible','active'].filter(name=>el.classList.contains(name));
      }
      if(Object.keys(item).length > 1) entries.push(item);
    }
    return entries.slice(0,240);
  }
  function applyView(view){
    for(const item of Array.isArray(view)?view:[]){
      const el = document.getElementById(item.id);
      if(!el || el.closest('[data-shared-ui]')) continue;
      if(typeof item.text === 'string' && !el.children.length) el.textContent = item.text;
      if(typeof item.hidden === 'boolean') el.hidden = item.hidden;
      if(typeof item.display === 'string' && /^(?:|none|flex|block|grid|inline|inline-block)$/.test(item.display)) el.style.display = item.display;
      if(Array.isArray(item.classes)) for(const name of ['hidden','show','open','visible','active'])el.classList.toggle(name,item.classes.includes(name));
    }
  }
  function captureFrames(maxSize=600){
    const frames = [];
    const canvases = [...document.querySelectorAll('canvas')];
    for(let i=0;i<canvases.length && frames.length<4;i++){
      const canvas = canvases[i], bounds = canvas.getBoundingClientRect();
      if(/confetti/i.test(canvas.id))continue;
      if(bounds.width < 32 || bounds.height < 32 || getComputedStyle(canvas).display === 'none' || canvas.closest('[data-shared-ui]')) continue;
      if(!canvas.width || !canvas.height) continue;
      const copy = document.createElement('canvas'), scale = Math.min(1,maxSize/Math.max(canvas.width,canvas.height));
      copy.width = Math.max(1,Math.round(canvas.width*scale)); copy.height = Math.max(1,Math.round(canvas.height*scale));
      const context = copy.getContext('2d');
      context.fillStyle = '#101827'; context.fillRect(0,0,copy.width,copy.height); context.drawImage(canvas,0,0,copy.width,copy.height);
      try{ frames.push({index:i,image:copy.toDataURL('image/jpeg',.58)}); }catch(_error){}
    }
    return frames;
  }
  function displayFrames(frames){
    const canvases = [...document.querySelectorAll('canvas')];
    const showing = new Set();
    for(const frame of Array.isArray(frames)?frames:[]){
      const canvas = canvases[frame.index];
      if(!canvas || !/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(frame.image || '')) continue;
      showing.add(frame.index);
      let image = paintedFrames.get(frame.index);
      if(!image){
        image = document.createElement('img'); image.alt = 'Live shared game'; image.dataset.sharedCanvas = 'true';
        Object.assign(image.style,{position:'fixed',pointerEvents:'none',objectFit:'contain',background:'#101827',zIndex:'8000'});
        document.body.appendChild(image); paintedFrames.set(frame.index,image);
      }
      image.src = frame.image;
      image.hidden = false;
      if(canvas.dataset.sharedOriginalVisibility === undefined) canvas.dataset.sharedOriginalVisibility = canvas.style.visibility;
      canvas.style.visibility = 'hidden';
    }
    for(const [index,image] of paintedFrames){ image.hidden = !showing.has(index); }
    repositionFrames();
  }
  function repositionFrames(){
    const canvases = [...document.querySelectorAll('canvas')];
    for(const [index,image] of paintedFrames){
      if(image.hidden){image.style.display='none';continue;}
      const canvas = canvases[index];
      if(!canvas)continue;
      const b = canvas.getBoundingClientRect();
      Object.assign(image.style,{left:b.left+'px',top:b.top+'px',width:b.width+'px',height:b.height+'px',display:b.width&&b.height?'block':'none'});
    }
  }
  function clearFrames(){
    for(const image of paintedFrames.values()) image.remove(); paintedFrames.clear();
    for(const canvas of document.querySelectorAll('canvas[data-shared-original-visibility]')){
      canvas.style.visibility = canvas.dataset.sharedOriginalVisibility; delete canvas.dataset.sharedOriginalVisibility;
    }
  }
  function bytesToBase64(bytes){
    let value = '';
    for(let i=0;i<bytes.length;i+=8192) value += String.fromCharCode(...bytes.subarray(i,i+8192));
    return btoa(value);
  }
  async function encode(payload){
    const raw = JSON.stringify(payload), data = new TextEncoder().encode(raw);
    if(data.length > MAX_RAW) throw new Error('This activity is too large to share. Start a smaller activity or clear some saved media.');
    let codec='json', encoded=raw;
    if(root.CompressionStream){
      const compressed = new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
      const zipped = bytesToBase64(compressed);
      if(zipped.length < raw.length){ codec='gzip'; encoded=zipped; }
    }
    if(encoded.length > MAX_WIRE) throw new Error('This activity is too detailed to share safely. Clear some drawing or voice loops, then try again.');
    return {schema:1,activity,codec,data:encoded,decodedBytes:data.length,sequence:++sequence};
  }
  async function decode(checkpoint){
    if(!checkpoint || checkpoint.activity !== activity || !['gzip','json'].includes(checkpoint.codec) || typeof checkpoint.data !== 'string' || checkpoint.data.length>MAX_WIRE || checkpoint.decodedBytes>MAX_RAW) throw new Error('This room belongs to another activity or has an invalid checkpoint.');
    if(checkpoint.codec==='json') return JSON.parse(checkpoint.data);
    if(!root.DecompressionStream) throw new Error('This browser cannot open compressed shared activities. Update the browser.');
    const binary=atob(checkpoint.data), bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));
    const reader=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
    const chunks=[];let length=0;
    while(true){const next=await reader.read();if(next.done)break;length+=next.value.length;if(length>MAX_RAW){await reader.cancel();throw new Error('Shared checkpoint exceeds the decoded limit.');}chunks.push(next.value);}
    if(length!==checkpoint.decodedBytes)throw new Error('Shared checkpoint length is invalid.');
    const joined=new Uint8Array(length);let offset=0;for(const chunk of chunks){joined.set(chunk,offset);offset+=chunk.length;}
    return JSON.parse(new TextDecoder().decode(joined));
  }
  async function currentPayload(){
    let snapshot;
    try{snapshot=await adapter()?.capture();captureErrors=0;}catch(error){
      captureErrors++;snapshot=null;
      if(active&&captureErrors>=3)throw new Error('This activity could not capture its shared state. Leave the room and start the activity again.');
    }
    if(snapshot && (snapshot.gameStarted===false || (Object.hasOwn(snapshot,'currentQuestion')&&!snapshot.currentQuestion) || (Array.isArray(snapshot.players)&&!snapshot.players.length)))snapshot=null;
    return {snapshot:snapshot===undefined?null:snapshot,view:captureView(),frames:adapter()?.shareCanvas===false?[]:captureFrames()};
  }
  async function checkpoint(){
    const payload=await currentPayload();
    let result;
    try{result=await encode(payload);}catch(error){
      // A smaller exact canvas view leaves more space for the playable state.
      if(adapter()?.shareCanvas===false)throw error;
      payload.frames=captureFrames(320);result=await encode(payload);
    }
    const nextSeat=seatForSnapshot(payload.snapshot);
    if(nextSeat!==null)Object.defineProperty(result,'suggestedSeat',{value:nextSeat});
    return result;
  }
  function seatForSnapshot(snapshot){
    if(!snapshot || !Array.isArray(snapshot.players) || snapshot.players.length<2 || snapshot.players.length!==room?.members?.length)return null;
    let index;
    if(['make-10','shuffleboard','bowling'].includes(activity))index=snapshot.currentPlayer;
    else if(activity==='blackjack'&&['betting','action'].includes(snapshot.phase))index=snapshot.pIdx;
    else return null;
    if(!Number.isInteger(index)||index<0||index>=snapshot.players.length)return null;
    if(activity==='shuffleboard'&&snapshot.autoPhase!=='ready')return null;
    if(activity==='bowling'&&snapshot.rolling)return null;
    const members=room.members.slice().sort((a,b)=>a.seat-b.seat);
    const target=members[index];
    return room.presence?.[target.playerId]===true?target.seat:null;
  }
  function paintUi(){
    if(!launch)return;
    launch.textContent='🌐';launch.title=active?'Together · '+(room?.code||'…'):'Play together';
    launch.setAttribute('aria-label',launch.title);
    if(notice){
      const owner=room?.members?.find(member=>member.playerId===room.turn?.playerId);
      notice.textContent=active?(connected?(isController()?'You have controls. Everyone sees your moves.':(owner?.username||'Another player')+' has controls.'): 'Shared play paused while reconnecting.'): 'One player controls the activity. Everyone sees the same moves. Pass controls to take turns.';
    }
    if(seats){
      const value=seats.value;seats.replaceChildren();
      for(const member of room?.members||[]){
        if(member.playerId===client?.session?.playerId)continue;
        const option=document.createElement('option');option.value=member.seat;option.textContent=member.username+(member.connected?'':' · offline');seats.appendChild(option);
      }
      if([...seats.options].some(option=>option.value===value))seats.value=value;
    }
    document.getElementById('shared-start-area')?.toggleAttribute('hidden',active);
    document.getElementById('shared-room-area')?.toggleAttribute('hidden',!active);
    const passButton=document.getElementById('shared-pass');if(passButton)passButton.disabled=!isController()||!connected||!seats?.options.length||switching||awaitingAuthority;
    const claimButton=document.getElementById('shared-claim');if(claimButton)claimButton.hidden=!active||isController()||!!room?.presence?.[room.turn?.playerId];
    const code=document.getElementById('shared-code-display');if(code)code.textContent=room?.code||'';
    const memberList=document.getElementById('shared-members');if(memberList)memberList.textContent=(room?.members||[]).map((m,i)=>(['make-10','blackjack','shuffleboard','bowling'].includes(activity)?'Player '+(i+1)+': ':'')+m.username+(m.playerId===room.turn?.playerId?' · controls':'')+(m.connected?'':' · offline')).join(' / ');
    positionLaunch();
  }
  function positionLaunch(){
    if(!launch)return;
    const width=40,height=40,gap=6,W=innerWidth,H=innerHeight;
    const interactive=[...document.querySelectorAll('button,a[href],input,select,textarea,[role="button"],.card,.piece,[data-id],[data-card],[onclick],.footer,.status,[role="status"],[id*="status" i],.topbar,.turnpill,.turnPill,.mz-hint,.si-hint')];
    const readable=[...document.querySelectorAll('span,p,h1,h2,h3,h4,label,small,strong,b,div')].filter(el=>!el.children.length&&el.textContent.trim());
    const controls=[...new Set([...interactive,...readable])].filter(el=>!el.closest('[data-shared-ui]')&&getComputedStyle(el).display!=='none'&&getComputedStyle(el).visibility!=='hidden').map(el=>el.getBoundingClientRect()).filter(b=>b.width&&b.height);
    const candidates=[[W-width-gap,H-height-gap],[gap,H-height-gap],[W-width-gap,gap],[gap,gap],[W-width-gap,H/2-height/2],[gap,H/2-height/2],[W-width-gap,H*.28],[gap,H*.28],[W-width-gap,H*.72],[gap,H*.72]];
    for(let y=gap;y<=H-height-gap;y+=height+gap)for(let x=gap;x<=W-width-gap;x+=width+gap)candidates.push([x,y]);
    const free=candidates.find(([x,y])=>!controls.some(b=>x<b.right+3&&x+width>b.left-3&&y<b.bottom+3&&y+height>b.top-3));
    const [x,y]=free||candidates[4];Object.assign(launch.style,{left:x+'px',top:y+'px',right:'auto',bottom:'auto'});
  }
  function scheduleLaunchPosition(){
    if(launchPositionTimer)return;
    launchPositionTimer=later(()=>{launchPositionTimer=0;positionLaunch();},20);
  }
  function publishDelay(transport,wireBytes){
    return transport==='nearby'?Math.max(220,Math.ceil((wireBytes+4096)/(128*1024)*1000)):120;
  }
  async function applyCheckpoint(next, previousOwner){
    const epoch=++applyEpoch;
    const payload=await decode(next.state);
    if(epoch!==applyEpoch || !active)return;
    const owner=isController(), takeover=owner&&previousOwner!==client.session.playerId;
    if(!owner || takeover){
      applying=true;
      try{
        if(takeover)frozenTimers.clear();
        const custom=adapterOverride||root[specialNames[activity]], hasCanvas=payload.frames?.length>0;
        // Canvas spectators consume exact host frames. Restore once to set up
        // layout, then retain the checkpoint for a later control transfer.
        if(payload.snapshot!==null && (!hasCanvas || custom || appliedSequence<0 || takeover)){
          const result=await adapter()?.restore(clone(payload.snapshot),{spectator:!owner,online:true,controller:owner});
          if(result===false)throw new Error('This activity could not restore the shared state.');
        }
        applyView(payload.view);
        if(!owner)displayFrames(payload.frames);else clearFrames();
      }finally{applying=false;}
    }
    appliedSequence=next.state.sequence;
    if(takeover){awaitingAuthority=false;callbackAuthority(connected&&!switching);}
    paintUi();
  }
  function acceptRoom(next){
    if(next.game!=='shared-activity'||next.state?.activity!==activity){showError('This room belongs to another activity.');client?.forget();return;}
    const previousOwner=room?.turn?.playerId, previousVersion=room?.version;
    room=next;sequence=Math.max(sequence,next.state?.sequence||0);active=true;
    if(next.status==='active' && next.turn?.playerId===client?.session?.playerId && previousOwner!==next.turn.playerId)awaitingAuthority=true;
    root.ArcadeMultiplayer?.observeRoom?.(next,activity);
    root.ArcadeSave?.setExternalSession?.(true);
    if(next.status==='finished'){showError('This shared room has closed. Leave the room to resume local play.');paintUi();return;}
    if(previousVersion!==next.version || appliedSequence<0){
      restoreChain=restoreChain.then(()=>applyCheckpoint(next,previousOwner)).catch(showError);
    }
    callbackAuthority(isController()&&connected&&!switching&&!awaitingAuthority);paintUi();
  }
  async function backupLocal(){
    if(localBackup)return;
    localBackup=clone(await currentPayload());
    if(typeof adapter()?.captureLocal==='function')localBackup.snapshot=clone(await adapter().captureLocal());
  }
  async function create(params){
    await backupLocal();
    if(!adapter())throw new Error('This activity is still loading. Try again in a moment.');
    await root.ArcadeMultiplayer?.ready?.();
    const state=await checkpoint();
    const created=await client.create({...params,username:root.ArcadeMultiplayer?.preferredUsername?.(params.username)||params.username,maxPlayers:params.maxPlayers||8,state});
    await client.action({type:'start',state,firstSeat:created.seat});
    root.ArcadeMultiplayer?.invite?.(activity,created.code,document.title);
    return client.room;
  }
  async function join(params){
    await backupLocal();await root.ArcadeMultiplayer?.ready?.();
    return await client.join({...params,username:root.ArcadeMultiplayer?.preferredUsername?.(params.username)||params.username});
  }
  async function pass(seat){
    if(!isController()||!connected||switching||awaitingAuthority)throw new Error('Only the connected controller can pass controls.');
    switching=true;paintUi();
    while(working)await new Promise(resolve=>later(resolve,15));
    await restoreChain;
    const state=await checkpoint();
    try{return await client.action({type:'state',state,nextSeat:Number(seat)});}finally{switching=false;callbackAuthority(isController()&&connected);paintUi();}
  }
  async function leave(){
    const oldCode=room?.code;switching=true;await client.leave();active=false;connected=false;room=null;appliedSequence=-1;applyEpoch++;awaitingAuthority=false;
    if(oldCode)root.ArcadeMultiplayer?.forgetRoomAlert?.(activity,oldCode);
    root.ArcadeSave?.setExternalSession?.(false);clearFrames();frozenTimers.clear();applying=true;
    try{
      if(localBackup?.snapshot!==null){const restore=adapter()?.restoreLocal||adapter()?.restore;const result=await restore?.(clone(localBackup.snapshot),{spectator:false,online:false,controller:true});if(result===false)adapter()?.startFresh?.();}
      else adapter()?.startFresh?.();
      applyView(localBackup?.view);
    }catch(_error){adapter()?.startFresh?.();applyView(localBackup?.view);}
    finally{applying=false;localBackup=null;switching=false;callbackAuthority(true);paintUi();}
  }
  async function publish(){
    if(!active||!isController()||!connected||working||switching||awaitingAuthority||room.status!=='active')return;
    if(performance.now()<nextPublishAt)return;
    working=true;
    try{
      const state=await checkpoint();
      const signature=state.data;
      if(signature!==lastSent || (state.suggestedSeat!==undefined&&state.suggestedSeat!==client.session.seat)){
        const nearby=client.session.transport==='nearby';
        // One update generates a canonical room event and a small RPC result.
        // Keep both message count and bytes below Nearby's 10-second guards;
        // input-triggered publishing observes this same deadline.
        const wireBytes=new TextEncoder().encode(JSON.stringify(state)).length;
        nextPublishAt=performance.now()+publishDelay(nearby?'nearby':'cloudflare',wireBytes);
        await client.action({type:'state',state,nextSeat:state.suggestedSeat??client.session.seat});lastSent=signature;
      }
    }catch(error){
      if(error.status===409){lastSent='';}
      else{connected=false;showError(error);paintUi();}
    }finally{working=false;}
  }
  function buildUi(){
    const css=document.createElement('style');css.textContent=`
      [data-shared-ui]{font:14px/1.45 system-ui,sans-serif;color:#edf5ff;box-sizing:border-box}
      #shared-launch{position:fixed;right:8px;bottom:max(8px,env(safe-area-inset-bottom));z-index:2147483000;background:#193c67;border:1px solid #7ab8ed;border-radius:999px;padding:0;width:40px;height:40px;min-height:40px;box-shadow:0 4px 16px #0007;font-size:20px;font-weight:750;touch-action:manipulation}
      #shared-panel{position:fixed;inset:0;z-index:2147483100;display:flex;align-items:center;justify-content:center;background:#02091dcc;padding:16px;touch-action:pan-y}
      #shared-panel[hidden],[data-shared-ui] [hidden],[data-shared-canvas][hidden]{display:none!important}
      #shared-card{width:min(100%,460px);max-height:calc(100dvh - 32px);overflow:auto;background:#10213b;border:1px solid #54799f;border-radius:18px;padding:20px;box-shadow:0 12px 50px #0009}
      #shared-card h2{margin:0 0 9px;font-size:21px}#shared-card p{margin:8px 0}#shared-card label{display:block;margin:12px 0 5px}
      #shared-card input,#shared-card select{width:100%;min-height:44px;background:#07172c;color:#edf5ff;border:1px solid #6588a8;border-radius:9px;padding:10px;font:inherit}
      #shared-card button{min-height:44px;background:#244f7b;color:#fff;border:1px solid #709dc0;border-radius:10px;padding:10px 14px;font:inherit;cursor:pointer}
      #shared-card button:disabled{opacity:.45}#shared-card .shared-row{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}#shared-card .shared-row>*{flex:1}#shared-close{float:right}#shared-error{color:#ffc4ad}#shared-code-display{font:700 26px ui-monospace,monospace;letter-spacing:.13em}
    `;document.head.appendChild(css);
    launch=document.createElement('button');launch.id='shared-launch';launch.dataset.sharedUi='true';launch.type='button';launch.textContent='Play together';launch.onclick=()=>{panel.hidden=false;paintUi();};document.body.appendChild(launch);
    panel=document.createElement('div');panel.id='shared-panel';panel.dataset.sharedUi='true';panel.hidden=true;panel.setAttribute('role','dialog');panel.setAttribute('aria-label','Play together online');
    panel.innerHTML=`<div id="shared-card"><button id="shared-close" type="button" aria-label="Close shared play">✕</button><h2>Play together</h2><p id="shared-notice"></p><p id="shared-error" role="status"></p><div id="shared-start-area"><label for="shared-name">Your name</label><input id="shared-name" maxlength="24" autocomplete="nickname" placeholder="Your name"><div class="shared-row"><button id="shared-create" type="button">Create room</button><button id="shared-resume" type="button">Rejoin saved room</button></div><label for="shared-code">Room code</label><input id="shared-code" maxlength="6" autocapitalize="characters" autocomplete="off" placeholder="ABC234"><div class="shared-row"><button id="shared-join" type="button">Join room</button></div></div><div id="shared-room-area" hidden><p>Room code: <strong id="shared-code-display"></strong></p><p id="shared-members"></p><label for="shared-seats">Pass controls to</label><select id="shared-seats"></select><div class="shared-row"><button id="shared-pass" type="button">Pass controls</button><button id="shared-claim" type="button" hidden>Take available controls</button></div><div class="shared-row"><button id="shared-leave" type="button">Leave room</button></div></div></div>`;
    document.body.appendChild(panel);notice=document.getElementById('shared-notice');errorNode=document.getElementById('shared-error');seats=document.getElementById('shared-seats');
    const name=document.getElementById('shared-name');name.value=root.ArcadeMultiplayer?.preferredUsername?.('')||'';
    const lockedIdentity=root.ArcadeMultiplayer?.getIdentity?.();if(lockedIdentity){name.readOnly=true;name.setAttribute('aria-label','Your locked Nearby name');}
    const run=fn=>async()=>{errorNode.textContent='';try{await fn();paintUi();}catch(error){showError(error);}};
    document.getElementById('shared-close').onclick=()=>{panel.hidden=true;};
    document.getElementById('shared-create').onclick=run(()=>create({username:name.value}));
    document.getElementById('shared-join').onclick=run(()=>join({username:name.value,code:document.getElementById('shared-code').value}));
    document.getElementById('shared-resume').onclick=run(async()=>{await backupLocal();return await client.resume();});
    document.getElementById('shared-pass').onclick=run(()=>pass(seats.value));
    document.getElementById('shared-claim').onclick=run(()=>client.action({type:'claim-controls'}));
    document.getElementById('shared-leave').onclick=run(leave);
    if(!client.saved())document.getElementById('shared-resume').hidden=true;
    const invitedCode=new URLSearchParams(location.search).get('room');
    if(invitedCode){document.getElementById('shared-code').value=client.cleanCode(invitedCode);panel.hidden=false;}
    paintUi();
  }
  function boot(){
    if(!root.ArcadeSharedRoomClient)return;
    client=root.ArcadeSharedRoomClient.createRoomClient({game:'shared-activity',activity,sessionKey,
      base:root.ARCADE_WORKER_BASE||undefined,onRoom:acceptRoom,
      onStatus:status=>{
        const was=connected;
        if(status.kind==='connected'){connected=true;if(errorNode)errorNode.textContent='';}
        else if(['connecting','reconnecting','offline'].includes(status.kind))connected=false;
        statusText=status.text;
        if(active&&!connected&&status.kind!=='offline')showError(status.text);
        if(connected&&!was){callbackAuthority(isController()&&!awaitingAuthority&&!switching);lastSent='';}
        paintUi();
      }
    });
    buildUi();tickInterval=every(publish,120);
    for(const type of ['pointerdown','pointermove','pointerup','click','dblclick','input','change','keydown','keyup','wheel','touchstart','touchmove','touchend','contextmenu','dragstart','drop']){
      document.addEventListener(type,event=>{
        if(event.target?.closest?.('[data-shared-ui]'))return;
        if(type==='click'||type==='input'||type==='change')scheduleLaunchPosition();
        if(isSpectator()){
          const home=event.target?.closest?.('a.arcade-home-link,a[href="../index.html"],button[id*="home" i],button[aria-label="Home" i],#homeBtn,#btnHome');
          if(home){
            event.preventDefault();event.stopImmediatePropagation();
            if(type==='click')root.ArcadeSave?.goHome?.();
            return;
          }
          event.preventDefault();event.stopImmediatePropagation();
        }
        else if(active){if(captureTimer)cancelLater(captureTimer);captureTimer=later(publish,35);}
      },{capture:true,passive:false});
    }
    root.addEventListener('resize',()=>{repositionFrames();positionLaunch();if(isSpectator())client.refresh().catch(showError);});
    root.addEventListener('scroll',repositionFrames,{capture:true,passive:true});
    every(positionLaunch,1500);
    new MutationObserver(changes=>{if(changes.some(change=>!change.target?.closest?.('[data-shared-ui]')))scheduleLaunchPosition();}).observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['hidden','class','style']});
    root.addEventListener('pagehide',()=>{client.disconnect();cancelEvery(tickInterval);});
  }
  root.ArcadeSharedActivity={create,join,pass,leave,publish,isSpectator,isController,
    openPanel:()=>{if(panel){panel.hidden=false;paintUi();}},
    registerAdapter:value=>{adapterOverride=value;},
    getState:()=>({activity,active,connected,controller:isController(),room:clone(room),appliedSequence,statusText}),
    getClient:()=>client,
    getPublishDelay:publishDelay
  };
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})(window);
