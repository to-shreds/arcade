import * as E from './engine.mjs';
import {TROLLEY_SCENARIOS,createTrolleySession,getCurrentScenario,getTrolleyRoute,chooseTrolley,nextTrolley,validateTrolleySession} from './trolley.mjs';
const $=id=>document.getElementById(id),clone=x=>JSON.parse(JSON.stringify(x));
const esc=x=>String(x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clock=s=>`${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`;
const cargoIcons={mail:'✉',fruit:'🍎',toys:'🧸',books:'📚',rescue:'🚃',repair:'🔧'};
const paints=[{id:0,name:'Railway yellow',need:0,color:'#ffcf47'},{id:1,name:'Ocean blue',need:3,color:'#42d8ff'},{id:2,name:'Berry pink',need:9,color:'#ff83bd'},{id:3,name:'Garden green',need:18,color:'#8bea8a'},{id:4,name:'Moon purple',need:36,color:'#c6a0ff'},{id:5,name:'Marmalade',need:60,color:'#ff9f53'}];
let view='start',mode='dispatcher',level=E.createLevel(0,1),rail=E.createState(level),levelIndex=0,endless=false,endlessSeed=1,endlessIndex=0;
let selected='t1',selectedNode='j0',paused=true,slow=false,preview=true,menuOpen=false,helpOpen=false,helpReturn=false,progress={stars:Array(28).fill(0),endless:0,paint:0},trolley=createTrolleySession(1);
let spectator=false,crashDismissed=false,clipPosition=0,clipKind='',clipBlob='',clipEpoch=0,lastFrame=0,lastUI=0,lastRailStatus='ready',rewarded=false;
const ctx=$('railCanvas').getContext('2d');
function touch(){window.ArcadeSave?.touch(250);}
function mutate(fn){if(spectator)return;fn();render();touch();}
function show(el,on){$(el).hidden=!on;}
function totalStars(){return progress.stars.reduce((a,b)=>a+b,0);}
function text(id,value){if($(id).textContent!==String(value))$(id).textContent=value;}
const htmlCache=new Map();
function html(id,value){if(htmlCache.get(id)!==value){$(id).innerHTML=value;htmlCache.set(id,value);}}
function startJob(index=0,fresh=false){
  if(spectator)return;
  mode='dispatcher';view='play';levelIndex=Math.max(0,Math.min(27,Math.trunc(index)));endless=fresh;
  if(fresh){endlessSeed=(Date.now()^(Math.random()*4294967296))>>>0;endlessIndex=progress.endless;}
  setupLevel();render();touch();
}
function setupLevel(){
  level=E.createLevel(endless?endlessIndex:levelIndex,endless?endlessSeed:1,endless);rail=E.createState(level);selected='t1';selectedNode=level.map.nodes[level.trains[0].start].links[0];paused=true;menuOpen=false;helpOpen=false;crashDismissed=false;clipPosition=0;rewarded=false;lastRailStatus='ready';stopVideo();
}
function startTrolley(){if(spectator)return;mode='trolley';view='trolley';menuOpen=false;helpOpen=false;paused=true;stopVideo();if(trolley.phase==='complete')trolley=createTrolleySession((Date.now()^0xbadc0de)>>>0);render();$('trolleyScreen').scrollTop=0;$('scenarioTitle').focus({preventScroll:true});touch();}
function modes(){if(spectator)return;window.ArcadeSpeech?.cancel();view='start';menuOpen=false;helpOpen=false;paused=true;stopVideo();render();touch();}
function reward(){if(spectator||rewarded||rail.status!=='won')return;rewarded=true;const stars=E.score(level,rail);if(endless)progress.endless=Math.max(progress.endless,endlessIndex+1);else progress.stars[levelIndex]=Math.max(progress.stars[levelIndex],stars);touch();}
function stationTask(t,spec){if(t.done)return '✓ All cargo delivered';const task=spec.tasks[t.task];return `${task.type==='couple'?'🚃':task.type==='repair'?'🔧':task.type==='pickup'?'📦':cargoIcons[spec.cargo]} ${task.label} → ${task.node}`;}
function trainColor(spec){return spec.id==='t1'?paints[progress.paint].color:spec.color;}
function render(){
  show('startScreen',view==='start');show('playScreen',view==='play');show('trolleyScreen',view==='trolley');show('menuOverlay',menuOpen);show('helpOverlay',helpOpen);
  text('progressLabel',`${totalStars()} stars · ${progress.stars.filter(Boolean).length}/28 jobs`);
  html('jobsGrid',E.CAMPAIGN.map(j=>`<button id="job-${j.index}" class="arcade-btn job-choice ${j.index===levelIndex?'current':''}" data-job="${j.index}"><strong>${j.index+1}. ${esc(j.title)}</strong><span>${progress.stars[j.index]?'★'.repeat(progress.stars[j.index]):'○ ○ ○'}</span></button>`).join(''));
  if(view==='play')renderRail();
  if(view==='trolley')renderTrolley();
  const won=view==='play'&&rail.status==='won';show('resultOverlay',won&&!menuOpen&&!helpOpen);
  if(won){reward();text('resultStars','★'.repeat(E.score(level,rail))+'☆'.repeat(3-E.score(level,rail)));text('resultTitle',endless?'Another railway, safely run.':levelIndex===27?'Chief dispatcher Logan!':'All deliveries made!');text('resultText',`${clock(rail.time)} on the clock. ${rail.hints?'Route hints used.':'You planned every route.'} ${rail.time<=level.par?'Timetable beaten!':`Timetable star: ${clock(level.par)}. Try running clear routes together.`} ${totalStars()>=3?'More engine paint is waiting below.':''}`);text('nextJobBtn',!endless&&levelIndex===27?'Try Fresh tracks →':'Next job →');}
  const crashed=view==='play'&&rail.status==='crashed'&&!crashDismissed;
  show('crashOverlay',crashed&&!menuOpen&&!helpOpen);
  if(crashed)syncVideo();else if(!menuOpen)pauseVideo();
  if(view==='play'){resizeBoard();draw();}
}
function renderRail(){
  text('jobTitle',`${endless?'∞':levelIndex+1} · ${level.title}`);text('jobSubtitle',endless?`Yard ${endlessIndex+1} · seed ${endlessSeed}`:'Dispatcher jobs');text('deliveryCount',`${rail.deliveries}/${rail.trains.length} home`);text('clockText',clock(rail.time));text('parText',`Timetable ${clock(level.par)}`);text('jobTip',level.tip);
  text('pauseBtn',paused?'▶ Run':'Ⅱ Pause');text('speedBtn',slow?'½ Slow on':'½ Slow');$('speedBtn').classList.toggle('active',slow);$('speedBtn').setAttribute('aria-pressed',String(slow));text('previewBtn',preview?'Route on':'Route off');$('previewBtn').setAttribute('aria-pressed',String(preview));
  show('boardBadge',paused&&rail.status!=='won'&&rail.status!=='crashed');
  html('trainCards',rail.trains.map(t=>{const spec=level.trains.find(x=>x.id===t.id);const status=t.done?'Home':t.repair>0?`Repairing ${Math.ceil(t.repair)}s`:t.edge?t.braking?'Braking at next points':'Moving':t.held?'Held':'Ready';return `<section class="train-card ${t.id===selected?'selected':''}" style="--train-color:${trainColor(spec)}"><div class="train-heading"><button id="select-${t.id}" class="train-select" data-select="${t.id}">🚂 ${spec.name}</button><span class="train-status">${status}${spec.speed>=9?' · express':spec.speed<=5?' · heavy':''}${t.coupled?' + wagon':''}</span></div><div class="task-label">${esc(stationTask(t,spec))}</div><div class="train-actions"><button id="send-${t.id}" class="arcade-btn" data-send="${t.id}" ${t.done||t.repair>0||['won','crashed'].includes(rail.status)?'disabled':''}>${t.done?'✓ Delivered':t.repair>0?'🔧 Working':`▶ Send ${spec.name}`}</button><button id="brake-${t.id}" class="arcade-btn" data-brake="${t.id}" ${t.done||['won','crashed'].includes(rail.status)?'disabled':''}>■ Brake</button></div></section>`;}).join(''));
  const n=level.map.nodes[selectedNode];text('pointsTitle',`Junction ${n.label}`);text('signalBtn',rail.signals[n.id]?'🔴 Hold':'🟢 Open');$('signalBtn').classList.toggle('active',rail.signals[n.id]);
  html('routeButtons',n.links.map(to=>`<button id="route-${n.id}-${to}" class="arcade-btn ${rail.switches[n.id]===to?'chosen':''}" data-route="${to}" aria-pressed="${rail.switches[n.id]===to}">→ ${level.map.nodes[to].kind==='station'?'Station ':''}${level.map.nodes[to].label}</button>`).join(''));
  html('junctionButtons',Object.values(level.map.nodes).filter(n=>n.kind==='junction').map(n=>`<button id="junction-${n.id}" data-node="${n.id}" class="${selectedNode===n.id?'chosen':''}" aria-label="Junction ${n.label}" aria-pressed="${selectedNode===n.id}">${n.label}${rail.signals[n.id]?' ●':''}</button>`).join(''));
  text('eventText',rail.events.at(-1)?.message||'All engines are held. The clock starts when you press Run or Send.');
  html('paintSelect',paints.map(p=>`<option value="${p.id}" ${progress.paint===p.id?'selected':''} ${totalStars()<p.need?'disabled':''}>${p.name}${p.need>totalStars()?` (${p.need} stars)`:''}</option>`).join(''));
  $('hintBtn').disabled=!!rail.trains.find(t=>t.id===selected)?.edge||['won','crashed'].includes(rail.status);
}
function renderTrolley(){
  const scenario=getCurrentScenario(trolley);text('scenarioCount',`${Math.min(trolley.index+1,TROLLEY_SCENARIOS.length)} / ${TROLLEY_SCENARIOS.length}`);text('scenarioTitle',trolley.phase==='complete'?'The last switch, for now.':scenario.title);text('scenarioStory',trolley.phase==='complete'?'You have seen every decision in this set. Start again to see them in a different order.':scenario.story);
  html('scenarioFacts',trolley.phase==='complete'?'':scenario.facts.map(f=>`<li>${esc(f)}</li>`).join(''));
  html('trolleyTracks',trolley.phase==='complete'?'':scenario.routes.map(r=>`<div class="track-card"><strong>${esc(r.label)}</strong><p>${esc(r.description)}</p></div>`).join(''));
  html('trolleyChoices',trolley.phase==='choice'?scenario.options.map((o,i)=>`<button id="trolley-choice-${i}" class="arcade-btn" data-choice="${esc(o.id)}">${esc(o.label)}</button>`).join(''):'');
  show('trolleyOutcome',trolley.phase!=='choice');text('outcomeText',trolley.phase==='complete'?'There is no score to beat. A new fact can change what a choice means.':trolley.history.at(-1)?.outcome||'');text('nextScenarioBtn',trolley.phase==='complete'?'Start another set':'Next decision →');drawTrolley();
}
function drawTrolley(){
  const c=$('trolleyCanvas').getContext('2d'),route=getTrolleyRoute(trolley),side=route==='side';
  c.clearRect(0,0,800,170);c.fillStyle='#101a2b';c.fillRect(0,0,800,170);
  for(const y of [35,135]){c.strokeStyle='#7a88a0';c.lineWidth=5;c.beginPath();c.moveTo(20,85);c.lineTo(340,85);c.lineTo(755,y);c.stroke();c.strokeStyle='#354c67';c.lineWidth=15;c.setLineDash([3,11]);c.beginPath();c.moveTo(20,85);c.lineTo(340,85);c.lineTo(755,y);c.stroke();c.setLineDash([]);}
  c.font='bold 15px system-ui';c.textAlign='right';c.fillStyle='#d5bfdd';c.fillText('MAIN',780,22);c.fillText('SIDE',780,161);
  const x=['waiting','stopped'].includes(route)?165:625,y=['waiting','stopped'].includes(route)?85:side?119:51;c.fillStyle='#ffcf47';c.beginPath();c.roundRect(x-30,y-20,60,34,7);c.fill();c.fillStyle='#17334f';c.fillRect(x-21,y-14,16,15);c.fillRect(x+3,y-14,16,15);c.fillStyle='#9baecb';for(const dx of [-18,18]){c.beginPath();c.arc(x+dx,y+17,7,0,7);c.fill();}c.strokeStyle='#ffcf47';c.lineWidth=3;c.beginPath();c.moveTo(x-12,y-22);c.lineTo(x,y-31);c.lineTo(x+12,y-22);c.stroke();
}
function roundRect(x,y,w,h,r,fill,stroke){ctx.beginPath();ctx.roundRect(x,y,w,h,r);if(fill){ctx.fillStyle=fill;ctx.fill();}if(stroke){ctx.strokeStyle=stroke;ctx.stroke();}}
function draw(){
  const W=800,U=W/100;ctx.clearRect(0,0,W,W);ctx.fillStyle='#143b42';ctx.fillRect(0,0,W,W);
  // A quiet model-railway landscape keeps routes readable at small sizes.
  const grad=ctx.createLinearGradient(0,0,W,W);grad.addColorStop(0,'#214b4d');grad.addColorStop(1,'#122d40');ctx.fillStyle=grad;ctx.fillRect(0,0,W,W);
  ctx.fillStyle='#325e52';for(let i=0;i<32;i++){const x=(i*137+43)%790,y=(i*193+57)%790;ctx.beginPath();ctx.arc(x,y,5+i%5,0,Math.PI*2);ctx.fill();}
  ctx.font='bold 15px system-ui';ctx.fillStyle='#8eb9b580';ctx.textAlign='center';ctx.fillText(['LITTLE WILLOW YARD','RIVERSIDE LOOP','THE OLD LOOP','CENTRAL WORKS','NORTH LOOP','THE LONG WAY','EAST WORKS','SOUTH YARD'][level.map.variant],400,375);
  for(const [a,b] of level.map.edges){const A=level.map.nodes[a],B=level.map.nodes[b],dx=(B.x-A.x)*U,dy=(B.y-A.y)*U,len=Math.hypot(dx,dy),nx=-dy/len,ny=dx/len;ctx.strokeStyle='#101e2d';ctx.lineWidth=21;ctx.beginPath();ctx.moveTo(A.x*U,A.y*U);ctx.lineTo(B.x*U,B.y*U);ctx.stroke();ctx.strokeStyle='#725f50';ctx.lineWidth=5;for(let q=8;q<len;q+=12){const x=A.x*U+dx*q/len,y=A.y*U+dy*q/len;ctx.beginPath();ctx.moveTo(x+nx*12,y+ny*12);ctx.lineTo(x-nx*12,y-ny*12);ctx.stroke();}ctx.strokeStyle='#8da0a7';ctx.lineWidth=2;for(const off of [-6,6]){ctx.beginPath();ctx.moveTo(A.x*U+nx*off,A.y*U+ny*off);ctx.lineTo(B.x*U+nx*off,B.y*U+ny*off);ctx.stroke();}}
  if(preview){const path=E.previewRoute(level,rail,selected);if(path.length>1){ctx.strokeStyle=trainColor(level.trains.find(t=>t.id===selected));ctx.lineWidth=4;ctx.setLineDash([9,8]);ctx.beginPath();path.forEach((id,i)=>{const n=level.map.nodes[id];i?ctx.lineTo(n.x*U,n.y*U):ctx.moveTo(n.x*U,n.y*U);});ctx.stroke();ctx.setLineDash([]);}}
  const selectedTrain=rail.trains.find(t=>t.id===selected),selectedSpec=level.trains.find(t=>t.id===selected);const goal=selectedSpec.tasks[selectedTrain.task]?.node;
  for(const n of Object.values(level.map.nodes)){
    const x=n.x*U,y=n.y*U;
    if(n.kind==='station'){
      const task=level.trains.flatMap(spec=>{const t=rail.trains.find(t=>t.id===spec.id);return !t.done?[{...spec.tasks[t.task],color:trainColor(spec),cargo:spec.cargo}]:[];}).find(t=>t.node===n.id);
      if(goal===n.id){ctx.strokeStyle='#ffcf47';ctx.lineWidth=3;ctx.setLineDash([6,4]);ctx.beginPath();ctx.arc(x,y,29,0,Math.PI*2);ctx.stroke();ctx.setLineDash([]);}
      roundRect(x-19,y-19,38,38,8,'#182238',task?.color||'#91a6b0');ctx.font='900 25px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle=task?.color||'#dfebee';ctx.fillText(n.label,x,y);
      if(task){ctx.font='22px system-ui';ctx.fillText(task.type==='couple'?'🚃':task.type==='repair'?'🔧':cargoIcons[task.cargo],x,y+(y>400?-34:34));}
    }else{
      const to=level.map.nodes[rail.switches[n.id]],angle=Math.atan2(to.y-n.y,to.x-n.x);
      ctx.beginPath();ctx.arc(x,y,n.id===selectedNode?21:17,0,Math.PI*2);ctx.fillStyle=n.id===selectedNode?'#ffcf47':'#2c3e4e';ctx.fill();ctx.strokeStyle=n.id===selectedNode?'#fff1ac':'#9aadb3';ctx.lineWidth=2;ctx.stroke();
      ctx.save();ctx.translate(x,y);ctx.rotate(angle);ctx.fillStyle=n.id===selectedNode?'#172639':'#ffdc73';ctx.beginPath();ctx.moveTo(29,0);ctx.lineTo(17,-6);ctx.lineTo(17,6);ctx.closePath();ctx.fill();ctx.restore();
      ctx.font='900 17px system-ui';ctx.fillStyle=n.id===selectedNode?'#182335':'#eaf3f5';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(n.label,x,y);
      if(rail.signals[n.id]){ctx.beginPath();ctx.arc(x+22,y-21,7,0,Math.PI*2);ctx.fillStyle='#ff626c';ctx.fill();ctx.strokeStyle='#421722';ctx.lineWidth=3;ctx.stroke();}
    }
  }
  for(const t of rail.trains){
    const spec=level.trains.find(x=>x.id===t.id),pos=E.position(level,t);let angle=0;
    if(t.edge){const a=level.map.nodes[t.edge.from],b=level.map.nodes[t.edge.to];angle=Math.atan2(b.y-a.y,b.x-a.x);}else{const next=level.map.nodes[rail.switches[t.node]];angle=Math.atan2(next.y-pos.y,next.x-pos.x);}
    ctx.save();ctx.translate(pos.x*U,pos.y*U);if(t.done){ctx.translate(0,pos.y>50?-30:30);ctx.globalAlpha=.6;}ctx.rotate(angle);
    if(t.coupled){roundRect(-58,-12,27,24,4,'#c7a36c','#2b2432');ctx.fillStyle='#1b2536';ctx.fillRect(-51,-15,6,4);ctx.fillRect(-51,11,6,4);ctx.fillRect(-37,-15,6,4);ctx.fillRect(-37,11,6,4);}
    if(t.id===selected&&!t.done){ctx.strokeStyle='#ffffff';ctx.lineWidth=2;ctx.beginPath();ctx.ellipse(0,0,27,23,0,0,Math.PI*2);ctx.stroke();}
    roundRect(-19,-14,38,28,6,trainColor(spec),'#132035');ctx.fillStyle='#112436';ctx.fillRect(-14,-10,12,20);ctx.fillStyle='#b5effa';ctx.fillRect(-12,-7,8,14);ctx.fillStyle='#26344a';ctx.fillRect(10,-8,6,16);ctx.fillStyle='#1d293c';ctx.fillRect(-12,-18,8,4);ctx.fillRect(8,-18,8,4);ctx.fillRect(-12,14,8,4);ctx.fillRect(8,14,8,4);ctx.restore();
    if(!t.done){ctx.font='900 13px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle='#ffffff';ctx.strokeStyle='#12273c';ctx.lineWidth=4;ctx.strokeText(spec.name,pos.x*U,pos.y*U-31);ctx.fillText(spec.name,pos.x*U,pos.y*U-31);}
  }
}
function pauseVideo(){const v=$('crashVideo');if(!v.paused)clipPosition=v.currentTime;v.pause();}
function stopVideo(){pauseVideo();clipKind='';clipPosition=0;clipEpoch++;if(clipBlob){URL.revokeObjectURL(clipBlob);clipBlob='';}}
async function playVideo(){const v=$('crashVideo');if(Number.isFinite(v.duration)&&clipPosition>=v.duration-.05)return;if(menuOpen||helpOpen||document.hidden||view!=='play'||rail.status!=='crashed'||crashDismissed)return;try{await v.play();}catch{text('crashCaption','Everyone is safe. Tap Replay the wreck to watch the cartoon crash.');}}
function syncVideo(){
  const kind=rail.crash?.kind||'head-on',v=$('crashVideo'),source=$('crashSource');
  if(clipKind!==kind){
    clipKind=kind;const token=++clipEpoch;let format=v.canPlayType('video/mp4')?'mp4':'webm',loadingFallback=false;const attempted=new Set();
    v.poster=`media/crash-${kind}.jpg`;
    const install=()=>{v.removeAttribute('src');source.type=format==='mp4'?'video/mp4':'video/webm';source.src=`media/crash-${kind}.${format}`;v.load();};
    const failed=async()=>{
      if(token!==clipEpoch||loadingFallback)return;
      if(!attempted.has(format)){
        attempted.add(format);loadingFallback=true;
        try{const response=await fetch(`media/crash-${kind}.${format}`);if(!response.ok)throw new Error('Clip unavailable');const bytes=await response.arrayBuffer();if(token!==clipEpoch)return;if(clipBlob)URL.revokeObjectURL(clipBlob);clipBlob=URL.createObjectURL(new Blob([bytes],{type:format==='mp4'?'video/mp4':'video/webm'}));v.src=clipBlob;v.load();}
        catch{if(token===clipEpoch&&format==='mp4'){format='webm';install();}else text('crashCaption','Everyone is safe. The cartoon clip could not play here; you can retry the job.');}
        finally{loadingFallback=false;}
      }else if(format==='mp4'){format='webm';install();}
      else text('crashCaption','Everyone is safe. The cartoon clip could not play here; you can retry the job.');
    };
    v.onloadedmetadata=()=>{if(token!==clipEpoch)return;if(clipPosition>0&&Number.isFinite(v.duration))v.currentTime=Math.min(clipPosition,v.duration);playVideo();};
    v.onerror=failed;source.onerror=failed;install();
  }
  if(menuOpen||helpOpen||document.hidden)pauseVideo();else playVideo();
}
function choose(id){mutate(()=>{window.ArcadeSpeech?.cancel();trolley=chooseTrolley(trolley,id);});$('trolleyOutcome').scrollIntoView({block:'nearest',behavior:'smooth'});}
function doSend(id){mutate(()=>{if(E.sendTrain(level,rail,id)){paused=false;selected=id;}});}
function routeHint(){mutate(()=>{const path=E.routeToTask(level,rail,selected);if(path){selectedNode=path.find(n=>level.map.nodes[n].kind==='junction')||selectedNode;rail.events.push({time:rail.time,message:'Route set to the next station. Check other engines before sending!'});rail.events=rail.events.slice(-8);}else{rail.events.push({time:rail.time,message:'Wait for the engine to stop. A parked engine may be blocking that route.'});rail.events=rail.events.slice(-8);}});}
function openHelp(){helpReturn=menuOpen;helpOpen=true;menuOpen=false;pauseVideo();render();}
function openMenu(){window.ArcadeSpeech?.cancel();menuOpen=true;pauseVideo();render();$('resumeBtn').focus();touch();}
function nextJob(){if(endless){endlessIndex++;setupLevel();}else if(levelIndex<27){levelIndex++;setupLevel();}else{startJob(0,true);return;}render();touch();}
$('campaignBtn').onclick=()=>mutate(()=>{show('jobsPanel',true);$('jobsPanel').scrollIntoView({block:'nearest',behavior:'smooth'});});
$('jobsGrid').onclick=e=>{const b=e.target.closest('[data-job]');if(b)startJob(Number(b.dataset.job));};
$('endlessBtn').onclick=()=>startJob(0,true);$('trolleyBtn').onclick=startTrolley;
for(const id of ['homeBtn','startHomeBtn','menuHomeBtn'])$(id).onclick=()=>window.ArcadeSave.goHome();
$('menuBtn').onclick=()=>{if(menuOpen){menuOpen=false;render();touch();}else openMenu();};$('resumeBtn').onclick=()=>{menuOpen=false;render();touch();};
$('saveBtn').onclick=async()=>{const ok=await window.ArcadeSave.saveNow();text('saveMessage',ok?'Saved.':'Saving is unavailable in this browser or shared session.');};
$('loadBtn').onclick=async()=>{const ok=await window.ArcadeSave.load();text('saveMessage',ok?'Saved railway restored.':'No usable saved railway is available.');};
$('modeBtn').onclick=modes;$('trolleyHomeBtn').onclick=modes;$('resultModesBtn').onclick=modes;
$('howBtn').onclick=openHelp;$('menuHowBtn').onclick=openHelp;$('closeHelpBtn').onclick=()=>{helpOpen=false;menuOpen=helpReturn;render();touch();};
$('pauseBtn').onclick=()=>mutate(()=>{paused=!paused;if(!paused&&rail.status==='ready')rail.status='running';});
$('speedBtn').onclick=()=>mutate(()=>{slow=!slow;});$('previewBtn').onclick=()=>mutate(()=>{preview=!preview;});
$('trainCards').onclick=e=>{const b=e.target.closest('button');if(!b)return;if(b.dataset.send)doSend(b.dataset.send);if(b.dataset.brake)mutate(()=>E.brakeTrain(rail,b.dataset.brake));if(b.dataset.select)mutate(()=>{selected=b.dataset.select;const t=rail.trains.find(t=>t.id===selected);selectedNode=level.map.nodes[t.node].kind==='junction'?t.node:level.map.nodes[t.node].links[0];});};
$('junctionButtons').onclick=e=>{const b=e.target.closest('[data-node]');if(b)mutate(()=>{selectedNode=b.dataset.node;});};
$('routeButtons').onclick=e=>{const b=e.target.closest('[data-route]');if(b)mutate(()=>E.setSwitch(level,rail,selectedNode,b.dataset.route));};
$('signalBtn').onclick=()=>mutate(()=>E.toggleSignal(level,rail,selectedNode));$('hintBtn').onclick=routeHint;
for(const id of ['retryBtn','againBtn'])$(id).onclick=()=>mutate(setupLevel);
$('paintSelect').onchange=e=>mutate(()=>{const p=Number(e.target.value);if(paints[p]&&totalStars()>=paints[p].need)progress.paint=p;});
$('nextJobBtn').onclick=()=>mutate(nextJob);
$('trolleyChoices').onclick=e=>{const b=e.target.closest('[data-choice]');if(b)choose(b.dataset.choice);};
$('nextScenarioBtn').onclick=()=>{mutate(()=>{window.ArcadeSpeech?.cancel();trolley=trolley.phase==='complete'?createTrolleySession((Date.now()^0xbadc0de)>>>0):nextTrolley(trolley);});$('trolleyScreen').scrollTop=0;$('scenarioTitle').focus({preventScroll:true});};
$('skipCrashBtn').onclick=()=>mutate(()=>{crashDismissed=true;stopVideo();setupLevel();});
$('replayCrashBtn').onclick=()=>{if(spectator)return;clipPosition=0;$('crashVideo').currentTime=0;playVideo();touch();};
$('trolleyReadBtn').onclick=()=>{const scene=getCurrentScenario(trolley);if(!window.ArcadeSpeech?.available()){text('trolleyReadBtn','Voice is unavailable here');return;}const words=trolley.phase==='choice'?[scene.title,scene.story,...scene.facts,...scene.options.map(o=>o.label)].join('. '):trolley.history.at(-1)?.outcome||'Every decision completed.';window.ArcadeSpeech.cancel();window.ArcadeSpeech.speak(words,{rate:.88});};
$('crashVideo').onended=()=>{clipPosition=$('crashVideo').duration;touch();};
$('railCanvas').addEventListener('click',e=>{const r=e.currentTarget.getBoundingClientRect(),x=(e.clientX-r.left)*100/r.width,y=(e.clientY-r.top)*100/r.height;let nearest=null,d=7;for(const n of Object.values(level.map.nodes)){if(n.kind!=='junction')continue;const distance=Math.hypot(x-n.x,y-n.y);if(distance<d){nearest=n.id;d=distance;}}if(nearest)mutate(()=>{selectedNode=nearest;});});
document.addEventListener('keydown',e=>{if(e.key==='Escape'){if(helpOpen){helpOpen=false;menuOpen=helpReturn;render();}else if(menuOpen){menuOpen=false;render();}else openMenu();e.preventDefault();}if(view==='play'&&!menuOpen&&!helpOpen&&!spectator&&!['INPUT','SELECT','TEXTAREA','BUTTON'].includes(e.target.tagName)&&e.code==='Space'){paused=!paused;if(!paused&&rail.status==='ready')rail.status='running';render();touch();e.preventDefault();}});
document.addEventListener('visibilitychange',()=>{lastFrame=0;if(document.hidden)pauseVideo();else if(rail.status==='crashed')syncVideo();});
window.addEventListener('arcadepause',()=>{if(spectator)return;paused=true;pauseVideo();render();touch();});
function capture(){return {schema:1,view,mode,levelIndex,endless,endlessSeed,endlessIndex,selected,selectedNode,paused,slow,preview,menuOpen,helpOpen,helpReturn,progress:clone(progress),rail:clone(rail),trolley:clone(trolley),crashDismissed,clipPosition:rail.status==='crashed'&&clipKind?($('crashVideo').currentTime||clipPosition):clipPosition,rewarded};}
function validate(raw){
  if(!raw||raw.schema!==1||!['start','play','trolley'].includes(raw.view)||!['dispatcher','trolley'].includes(raw.mode)||!Number.isInteger(raw.levelIndex)||raw.levelIndex<0||raw.levelIndex>27||!Number.isInteger(raw.endlessSeed)||raw.endlessSeed<0||raw.endlessSeed>4294967295||!Number.isInteger(raw.endlessIndex)||raw.endlessIndex<0||raw.endlessIndex>1000000)throw new Error('Invalid railway save.');
  for(const key of ['endless','paused','slow','preview','menuOpen','helpOpen','helpReturn','crashDismissed','rewarded'])if(typeof raw[key]!=='boolean')throw new Error('Invalid railway controls.');
  if(!raw.progress||!Array.isArray(raw.progress.stars)||raw.progress.stars.length!==28||raw.progress.stars.some(x=>!Number.isInteger(x)||x<0||x>3)||!Number.isInteger(raw.progress.endless)||raw.progress.endless<0||raw.progress.endless>1000000||!Number.isInteger(raw.progress.paint)||!paints[raw.progress.paint]||paints[raw.progress.paint].need>raw.progress.stars.reduce((a,b)=>a+b,0)||!Number.isFinite(raw.clipPosition)||raw.clipPosition<0||raw.clipPosition>30)throw new Error('Invalid railway progress.');
  const l=E.createLevel(raw.endless?raw.endlessIndex:raw.levelIndex,raw.endless?raw.endlessSeed:1,raw.endless),r=E.validateState(l,raw.rail),t=validateTrolleySession(raw.trolley);
  if(!r.trains.some(t=>t.id===raw.selected)||l.map.nodes[raw.selectedNode]?.kind!=='junction')throw new Error('Invalid selected railway track.');
  return {data:clone(raw),level:l,rail:r,trolley:t};
}
function restore(raw,context={}){
  let checked;try{checked=validate(raw);}catch{return false;}
  const d=checked.data;pauseVideo();view=d.view;mode=d.mode;levelIndex=d.levelIndex;endless=d.endless;endlessSeed=d.endlessSeed;endlessIndex=d.endlessIndex;selected=d.selected;selectedNode=d.selectedNode;paused=d.paused;slow=d.slow;preview=d.preview;menuOpen=d.menuOpen;helpOpen=d.helpOpen;helpReturn=d.helpReturn;progress=d.progress;rail=checked.rail;level=checked.level;trolley=checked.trolley;crashDismissed=d.crashDismissed;clipPosition=d.clipPosition;rewarded=d.rewarded;spectator=context.spectator===true||context.controller===false;lastFrame=0;lastRailStatus=rail.status;render();
  const v=$('crashVideo');if(rail.status==='crashed'&&Number.isFinite(v.duration)&&Math.abs(v.currentTime-clipPosition)>.8){try{v.currentTime=Math.min(clipPosition,v.duration);}catch{}}
  return true;
}
window.TrainTrouble={capture,restore,validate,debug:()=>({level:clone(level),rail:clone(rail),view,paused,spectator}),startJob,step:seconds=>{if(!spectator){E.step(level,rail,seconds);reward();render();touch();}},route:routeHint,send:doSend,setPaused:value=>mutate(()=>{paused=!!value;}),select:id=>mutate(()=>{if(rail.trains.some(t=>t.id===id))selected=id;}),switch:(node,to)=>mutate(()=>E.setSwitch(level,rail,node,to)),signal:node=>mutate(()=>E.toggleSignal(level,rail,node)),chooseTrolley:choose};
const adapter={capture,restore,shareCanvas:false,meaningful:()=>view!=='start'||totalStars()>0||trolley.history.length>0,summary:()=>view==='trolley'?`Trolley Trouble · ${trolley.history.length} decisions`:`${level.title} · ${rail.deliveries}/${rail.trains.length} deliveries`,setController:enabled=>{spectator=!enabled;lastFrame=0;if(!enabled)pauseVideo();else if(rail.status==='crashed')syncVideo();}};
window.ArcadeSharedActivity?.registerAdapter(adapter);
window.ArcadeSave.register({id:'train-trouble',title:'Train Trouble',version:1,capture,restore,meaningful:()=>view!=='start'||totalStars()>0||trolley.history.length>0,summary:()=>view==='trolley'?`Trolley Trouble · ${trolley.history.length} decisions`:`${level.title} · ${rail.deliveries}/${rail.trains.length} deliveries`,startFresh:()=>{progress={stars:Array(28).fill(0),endless:0,paint:0};trolley=createTrolleySession((Date.now()^0x12345)>>>0);view='start';levelIndex=0;endless=false;setupLevel();render();}});
function resizeBoard(){const wrap=$('railCanvas').parentElement,side=Math.max(1,Math.min(wrap.clientWidth,wrap.clientHeight));wrap.style.setProperty('--board-size',side+'px');}
new ResizeObserver(resizeBoard).observe($('railCanvas').parentElement);
function frame(ts){const elapsed=lastFrame?Math.min(.1,(ts-lastFrame)/1000):0;lastFrame=ts;if(view==='play'&&!paused&&!menuOpen&&!helpOpen&&!document.hidden&&!spectator&&rail.status==='running'&&elapsed>0){E.step(level,rail,elapsed*(slow?.5:1));if(rail.status!==lastRailStatus){lastRailStatus=rail.status;reward();render();touch();}if(ts-lastUI>180){lastUI=ts;renderRail();}draw();}requestAnimationFrame(frame);}
render();requestAnimationFrame(frame);
