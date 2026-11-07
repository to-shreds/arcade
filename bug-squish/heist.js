/* Picnic Heist shares Bug Squish's canvas, pause loop, saves and room authority. */
'use strict';
window.createPicnicHeist=function(E,isActive){
  const {canvas,ctx}=E;
  const keys=new Set(),pointers=new Map();
  const colors=['#00c4db','#ff70cb'];
  let players=1,round=1,delivered=0,target=10,hearts=4,phase='playing',phaseClock=0,time=0,spawnClock=2.5;
  let bugs=[],crumbs=[],swats=[],leaves=[],effects=[],home={x:0,y:0,r:35},preview=false,layoutW=0,layoutH=0,lastHud='';
  const radius=()=>E.clamp(Math.min(E.W,E.H)*.047,14,27);
  const speed=()=>E.clamp(Math.min(E.W,E.H)*.48,110,240);
  const running=()=>isActive()&&E.isStarted()&&!E.isPaused()&&phase==='playing';
  const dashButton=document.getElementById('heistDash');
  const againButton=document.getElementById('heistAgain');
  const status=document.getElementById('heistStatus');
  function position(x,y){const r=radius();return{x:E.clamp(x,r,E.W-r),y:E.clamp(y,r,E.H-r)};}
  function hidden(b){return leaves.some(l=>E.distance(b.x,b.y,l.x,l.y)<l.r*.72);}
  function scatter(x,y,color,count=9){for(let i=0;i<count;i++)effects.push({x,y,vx:E.rand(-75,75),vy:E.rand(-75,75),life:.6,color});effects=effects.slice(-100);}
  function clearInput(){keys.clear();pointers.clear();}
  function layouts(){
    const r=radius();
    home={x:E.W*.14,y:E.H*.18,r:r*1.9};
    leaves=[[.33,.42],[.68,.29],[.57,.77]].map(([x,y])=>({x:E.W*x,y:E.H*y,r:r*1.8}));
  }
  function addCrumb(){
    const r=radius();let p;
    for(let attempt=0;attempt<30;attempt++){
      p=position(E.rand(r*1.7,E.W-r*1.7),E.rand(r*1.7,Math.max(r*2,E.H-Math.max(78,r*2))));
      if(E.distance(p.x,p.y,home.x,home.y)>r*5&&!leaves.some(l=>E.distance(p.x,p.y,l.x,l.y)<l.r+r))break;
    }
    crumbs.push({...p,gold:Math.random()<.16,turn:E.rand(0,6.28)});
  }
  function freshBugs(){
    return Array.from({length:players},(_,id)=>({id,x:home.x+(id?radius():-radius()),y:home.y+radius(),angle:Math.PI/2,bag:0,dash:0,cooldown:0,shield:0,safe:2,anim:0}));
  }
  function beginRound(){
    target=Math.min(24,8+round*2);delivered=0;phase='playing';phaseClock=0;swats=[];crumbs=[];spawnClock=2.5;effects=[];
    layouts();bugs=freshBugs();for(let i=0;i<8;i++)addCrumb();clearInput();lastHud='';syncUI();
  }
  function setPlayers(count){players=count===2?2:1;}
  function reset(opts={}){
    preview=!!opts.preview;round=1;hearts=players===2?5:4;time=0;beginRound();
  }
  function syncUI(){
    if(!isActive())return;
    dashButton.hidden=phase!=='playing';againButton.hidden=phase!=='gameover';
    const ready=bugs.some(b=>b.cooldown<=0);
    dashButton.disabled=!ready||phase!=='playing';
    const cooldown=Math.ceil(Math.min(...bugs.map(b=>b.cooldown)));
    const dashText=ready?'⚡ DASH':'⚡ '+cooldown+'s';
    if(dashButton.textContent!==dashText)dashButton.textContent=dashText;
    const text=phase==='gameover'?'PICNIC CLOSED':phase==='won'?'SNACKS STASHED!':'PICNIC '+round;
    const bags=bugs.map(b=>b.bag+'/3').join(' + ');
    const hud=text+delivered+target+hearts+bags;
    if(lastHud!==hud){lastHud=hud;E.setHud(text,delivered+'/'+target+' HOME · ♥ '+hearts,delivered/target);status.textContent=phase==='gameover'?'Caught! Your team brought home '+delivered+' of '+target+'. Try a new heist.':phase==='won'?'You filled the burrow! Next picnic coming up.':'BAG '+bags+' · Bring crumbs to the leafy burrow';}
  }
  function dash(id=null){
    if(!running())return;
    let started=false;
    for(const b of bugs)if((id===null||b.id===id)&&b.cooldown<=0){b.dash=.26;b.cooldown=3.5;b.safe=Math.max(b.safe,.3);scatter(b.x,b.y,colors[b.id],6);started=true;}
    if(started)E.AudioFX.play('clean');syncUI();
  }
  function down(e){
    if(!running())return;
    e.preventDefault();const p=E.pointerPosition(e),used=new Set([...pointers.values()].map(v=>v.id));
    const b=bugs.filter(b=>!used.has(b.id)).sort((a,b)=>E.distance(a.x,a.y,p.x,p.y)-E.distance(b.x,b.y,p.x,p.y))[0];
    if(!b)return;
    // Keep the bug above a finger so the player can see hazards and crumbs.
    const offset=e.pointerType==='touch'?radius()*1.5:0;
    pointers.set(e.pointerId,{id:b.id,x:p.x,y:p.y-offset});
    try{canvas.setPointerCapture(e.pointerId);}catch(_e){}
  }
  function move(e){
    const p=pointers.get(e.pointerId);if(!p||!running())return;e.preventDefault();
    const next=E.pointerPosition(e);p.x=next.x;p.y=next.y-(e.pointerType==='touch'?radius()*1.5:0);
  }
  function release(e){pointers.delete(e.pointerId);try{canvas.releasePointerCapture(e.pointerId);}catch(_e){}}
  const movement=new Set(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','w','a','s','d','W','A','S','D']);
  function attach(){
    canvas.addEventListener('pointerdown',down);canvas.addEventListener('pointermove',move);
    for(const event of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(event,release);
    document.addEventListener('keydown',e=>{
      if(!running()||e.altKey||e.ctrlKey||e.metaKey||e.target?.closest?.('input,textarea,select,[contenteditable="true"],[role="textbox"]'))return;
      if(e.code==='Space'&&e.target?.closest?.('button'))return;
      if(movement.has(e.key)){e.preventDefault();keys.add(e.key.toLowerCase());}
      else if(e.code==='Space'||e.key==='Shift'){e.preventDefault();if(!e.repeat)dash(e.key==='Shift'&&players===2?1:e.code==='Space'?0:null);}
    });
    document.addEventListener('keyup',e=>keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur',clearInput);
    dashButton.addEventListener('click',()=>dash());
    againButton.addEventListener('click',()=>{if(!isActive()||!E.isStarted()||E.isPaused())return;hearts=players===2?5:4;beginRound();E.showBanner('Back for another bite!','gold');});
  }
  function spawnSwat(){
    const visible=bugs.filter(b=>!hidden(b));
    if(!visible.length)return;
    const b=E.choose(visible),r=radius();
    swats.push({x:b.x,y:b.y,r:r*(2.05+Math.min(round,9)*.06),wait:Math.max(.63,1.02-round*.025),life:.34,hit:false});
    swats=swats.slice(-8);
  }
  function hit(b){
    if(b.shield>0){b.shield=0;b.safe=1;scatter(b.x,b.y,'#ffd700',18);E.showBanner('Bubble saved you!','gold');E.AudioFX.play('team');return;}
    hearts=Math.max(0,hearts-1);b.bag=0;scatter(b.x,b.y,colors[b.id],18);E.AudioFX.play('squish');E.vibrate(35);
    b.x=home.x;b.y=home.y;b.safe=2;b.dash=0;
    if(!hearts){phase='gameover';clearInput();E.showBanner('Caught! Another heist?','pink');}
    else E.showBanner('Spotted! Back to the burrow.','pink');
  }
  function win(){phase='won';phaseClock=2.3;hearts=Math.min(players===2?5:4,hearts+1);clearInput();E.showBanner('SNACKS STASHED!','gold');E.AudioFX.play('success');for(const b of bugs)scatter(b.x,b.y,'#ffd700',25);}
  function update(dt){
    dt=E.clamp(Number(dt)||0,0,.05);time+=dt;
    for(const p of effects){p.x+=p.vx*dt;p.y+=p.vy*dt;p.life-=dt;}effects=effects.filter(p=>p.life>0);
    if(phase==='won'){phaseClock-=dt;if(phaseClock<=0){round++;beginRound();E.showBanner('Picnic '+round+': stay sneaky!','gold');}syncUI();return;}
    if(phase!=='playing'){syncUI();return;}
    const r=radius();
    for(const b of bugs){
      b.anim+=dt*10;b.safe=Math.max(0,b.safe-dt);b.shield=Math.max(0,b.shield-dt);b.dash=Math.max(0,b.dash-dt);b.cooldown=Math.max(0,b.cooldown-dt);
      let dx=0,dy=0;
      const usingWASD=players===2&&b.id===0;
      const useArrows=players===1||b.id===1;
      if(useArrows){dx+=(keys.has('arrowright')?1:0)-(keys.has('arrowleft')?1:0);dy+=(keys.has('arrowdown')?1:0)-(keys.has('arrowup')?1:0);}
      if(usingWASD||players===1){dx+=(keys.has('d')?1:0)-(keys.has('a')?1:0);dy+=(keys.has('s')?1:0)-(keys.has('w')?1:0);}
      let n=Math.hypot(dx,dy),step=speed()*(b.dash>0?2.8:1)*dt;
      if(!n){const p=[...pointers.values()].find(p=>p.id===b.id);if(p){dx=p.x-b.x;dy=p.y-b.y;n=Math.hypot(dx,dy);step=Math.min(step,n);}}
      if(n>.2){b.x+=dx/n*step;b.y+=dy/n*step;b.angle=Math.atan2(dy,dx)+Math.PI/2;const p=position(b.x,b.y);b.x=p.x;b.y=p.y;}
      if(E.distance(b.x,b.y,home.x,home.y)<home.r+r*.25&&b.bag){
        const carried=b.bag;delivered=Math.min(target,delivered+carried);b.bag=0;scatter(home.x,home.y,'#ffd700',12);E.AudioFX.play('team');
        if(delivered>=target){win();break;}
      }
      for(let i=crumbs.length-1;i>=0;i--){
        const c=crumbs[i];if(b.bag>=3||E.distance(b.x,b.y,c.x,c.y)>r*1.15)continue;
        b.bag++;if(c.gold){b.shield=10;E.showBanner('Golden crumb! Bubble shield.','gold');}crumbs.splice(i,1);scatter(c.x,c.y,c.gold?'#ffd700':'#d68b3d',5);E.AudioFX.play('tap');
      }
    }
    if(phase==='playing'){
      spawnClock-=dt;if(spawnClock<=0){spawnSwat();spawnClock=Math.max(.72,2.3-round*.14);}
      for(const s of swats){
        if(s.wait>0){s.wait-=dt;continue;}
        if(!s.hit){s.hit=true;E.AudioFX.play('splash');for(const b of bugs)if(b.safe<=0&&!hidden(b)&&E.distance(b.x,b.y,s.x,s.y)<s.r+r*.6)hit(b);}
        s.life-=dt;
      }
      swats=swats.filter(s=>s.wait>0||s.life>0);
      if(crumbs.length<8)addCrumb();
    }
    syncUI();
  }
  function drawLeaf(l){
    ctx.save();ctx.translate(l.x,l.y);ctx.rotate(-.45);ctx.fillStyle='#317b41';ctx.strokeStyle='#154f2b';ctx.lineWidth=3;
    ctx.beginPath();ctx.ellipse(0,0,l.r,l.r*.68,0,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.strokeStyle='#9acb5e';ctx.lineWidth=2;
    ctx.beginPath();ctx.moveTo(-l.r*.8,0);ctx.lineTo(l.r*.8,0);for(let i=-1;i<=1;i++){ctx.moveTo(i*l.r*.3,0);ctx.lineTo((i-.4)*l.r*.3,-l.r*.38);ctx.moveTo(i*l.r*.3,0);ctx.lineTo((i-.4)*l.r*.3,l.r*.38);}ctx.stroke();ctx.restore();
  }
  function drawBug(b){
    const r=radius(),isHidden=hidden(b);
    ctx.save();ctx.translate(b.x,b.y);ctx.rotate(b.angle);
    if(isHidden)ctx.globalAlpha=.48;
    if(b.shield>0||b.safe>0){ctx.strokeStyle=b.shield>0?'#ffd700':'#fff';ctx.fillStyle=b.shield>0?'rgba(255,230,100,.13)':'rgba(255,255,255,.12)';ctx.lineWidth=2.5;ctx.beginPath();ctx.arc(0,0,r*1.35,0,Math.PI*2);ctx.fill();ctx.stroke();}
    ctx.strokeStyle='#211b27';ctx.lineWidth=Math.max(2,r*.13);ctx.lineCap='round';
    for(const side of [-1,1])for(let j=-1;j<=1;j++){ctx.beginPath();ctx.moveTo(side*r*.5,j*r*.43);ctx.lineTo(side*r*1.06,j*r*.46+Math.sin(b.anim+j)*r*.16);ctx.stroke();}
    ctx.fillStyle=colors[b.id];ctx.strokeStyle='#183242';ctx.lineWidth=3;ctx.beginPath();ctx.ellipse(0,0,r*.72,r,0,0,Math.PI*2);ctx.fill();ctx.stroke();
    ctx.beginPath();ctx.moveTo(0,-r*.8);ctx.lineTo(0,r*.8);ctx.stroke();
    ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(-r*.25,-r*.48,r*.22,0,Math.PI*2);ctx.arc(r*.25,-r*.48,r*.22,0,Math.PI*2);ctx.fill();ctx.fillStyle='#191526';ctx.beginPath();ctx.arc(-r*.24,-r*.53,r*.105,0,Math.PI*2);ctx.arc(r*.24,-r*.53,r*.105,0,Math.PI*2);ctx.fill();
    ctx.restore();
    ctx.save();ctx.fillStyle='#2e2340';ctx.font=`900 ${Math.max(11,r*.62)}px system-ui`;ctx.textAlign='center';ctx.fillText((players===2?String(b.id+1)+' · ':'')+'●'.repeat(b.bag)+'○'.repeat(3-b.bag),b.x,b.y+r*1.8);ctx.restore();
  }
  function draw(){
    ctx.fillStyle='#ffeecb';ctx.fillRect(0,0,E.W,E.H);const cell=48;
    ctx.fillStyle='rgba(223,82,90,.19)';for(let y=0,iy=0;y<E.H;y+=cell,iy++)for(let x=0,ix=0;x<E.W;x+=cell,ix++)if((iy+ix)%2===0)ctx.fillRect(x,y,cell,cell);
    const r=radius();
    ctx.fillStyle='#573a27';ctx.strokeStyle='#e5c293';ctx.lineWidth=4;ctx.beginPath();ctx.ellipse(home.x,home.y,home.r,home.r*.7,0,0,Math.PI*2);ctx.fill();ctx.stroke();
    drawLeaf({x:home.x,y:home.y-home.r*.65,r:home.r*.85});
    ctx.fillStyle='#fff4d7';ctx.font=`900 ${Math.max(11,r*.61)}px system-ui`;ctx.textAlign='center';ctx.fillText('HOME',home.x,home.y+4);
    for(const l of leaves)drawLeaf(l);
    for(const c of crumbs){ctx.save();ctx.translate(c.x,c.y);ctx.rotate(c.turn);ctx.fillStyle=c.gold?'#ffd600':'#d58b3a';ctx.strokeStyle=c.gold?'#9d6c00':'#94511e';ctx.lineWidth=2;E.roundedRectPath(ctx,-r*.3,-r*.25,r*.6,r*.5,r*.1);ctx.fill();ctx.stroke();if(c.gold){ctx.fillStyle='#fff';ctx.fillRect(-2,-2,4,4);}ctx.restore();}
    for(const s of swats){
      ctx.save();ctx.translate(s.x,s.y);ctx.lineWidth=3;ctx.strokeStyle='#c02542';
      if(s.wait>0){ctx.fillStyle='rgba(255,48,70,'+(.1+.13*(1+Math.sin(time*16))/2)+')';ctx.beginPath();ctx.arc(0,0,s.r,0,Math.PI*2);ctx.fill();ctx.setLineDash([6,5]);ctx.stroke();ctx.setLineDash([]);ctx.beginPath();ctx.moveTo(-9,0);ctx.lineTo(9,0);ctx.moveTo(0,-9);ctx.lineTo(0,9);ctx.stroke();}
      else{ctx.globalAlpha=E.clamp(s.life/.34,0,1);ctx.rotate(-.35);ctx.strokeStyle='#24456d';ctx.lineWidth=8;ctx.beginPath();ctx.moveTo(0,s.r*.55);ctx.lineTo(0,s.r*2.1);ctx.stroke();ctx.fillStyle='#63b4da';ctx.lineWidth=4;E.roundedRectPath(ctx,-s.r*.74,-s.r*.9,s.r*1.48,s.r*1.6,11);ctx.fill();ctx.stroke();ctx.strokeStyle='rgba(20,58,89,.45)';ctx.lineWidth=2;for(let j=-2;j<=2;j++){ctx.beginPath();ctx.moveTo(j*s.r*.23,-s.r*.76);ctx.lineTo(j*s.r*.23,s.r*.55);ctx.stroke();ctx.beginPath();ctx.moveTo(-s.r*.62,j*s.r*.23);ctx.lineTo(s.r*.62,j*s.r*.23);ctx.stroke();}}
      ctx.restore();
    }
    for(const b of bugs)drawBug(b);
    for(const p of effects){ctx.globalAlpha=Math.max(0,p.life/.6);ctx.fillStyle=p.color;ctx.beginPath();ctx.arc(p.x,p.y,3,0,Math.PI*2);ctx.fill();}ctx.globalAlpha=1;
    if(phase==='gameover'||phase==='won'){
      ctx.fillStyle='rgba(15,19,30,.6)';ctx.fillRect(0,0,E.W,E.H);ctx.fillStyle=phase==='won'?'#ffd700':'#fff';ctx.textAlign='center';ctx.font=`900 ${E.clamp(E.W*.055,21,48)}px system-ui`;ctx.fillText(phase==='won'?'SNACKS STASHED!':'CAUGHT!',E.W*.5,E.H*.43);
      ctx.fillStyle='#fff';ctx.font=`800 ${E.clamp(E.W*.027,14,23)}px system-ui`;ctx.fillText(phase==='won'?'Next picnic…':'Picnic '+round+' · '+delivered+'/'+target+' crumbs home',E.W*.5,E.H*.43+38);
    }
  }
  function resize(w,h){
    if(layoutW>0&&layoutH>0){const sx=w/layoutW,sy=h/layoutH;for(const group of [bugs,crumbs,swats,effects])for(const p of group){p.x*=sx;p.y*=sy;}for(const s of swats)s.r*=Math.min(sx,sy);}
    layoutW=w;layoutH=h;layouts();
    for(const group of [bugs,crumbs])for(const p of group)Object.assign(p,position(p.x,p.y));
    clearInput();
  }
  function captureState(){return{mode:'heist',paused:E.isPaused(),bounds:{w:E.W,h:E.H},players,round,delivered,target,hearts,phase,phaseClock,time,spawnClock,bugs:bugs.map(b=>({...b})),crumbs:crumbs.map(c=>({...c})),swats:swats.map(s=>({...s})),effects:effects.map(p=>({...p}))};}
  function restoreState(s){
    if(!s||s.mode!=='heist'||!Array.isArray(s.bugs)||!s.bugs.length)throw new Error('Invalid Picnic Heist save');
    const num=(n,fallback=0)=>Number.isFinite(Number(n))?Number(n):fallback;
    const sx=E.W/Math.max(1,num(s.bounds?.w,E.W)),sy=E.H/Math.max(1,num(s.bounds?.h,E.H));
    players=s.players===2?2:1;round=E.clamp(Math.floor(num(s.round,1)),1,999);target=E.clamp(Math.floor(num(s.target,10)),1,24);delivered=E.clamp(Math.floor(num(s.delivered)),0,target);hearts=E.clamp(Math.floor(num(s.hearts,4)),0,players===2?5:4);
    phase=['playing','won','gameover'].includes(s.phase)?s.phase:'playing';if(!hearts)phase='gameover';phaseClock=E.clamp(num(s.phaseClock),0,2.3);time=E.clamp(num(s.time),0,1e8);spawnClock=E.clamp(num(s.spawnClock,2),0,3);
    layouts();bugs=s.bugs.slice(0,players).map((b,id)=>({...position(num(b.x)*sx,num(b.y)*sy),id,angle:num(b.angle),bag:E.clamp(Math.floor(num(b.bag)),0,3),dash:E.clamp(num(b.dash),0,.26),cooldown:E.clamp(num(b.cooldown),0,3.5),shield:E.clamp(num(b.shield),0,10),safe:E.clamp(num(b.safe),0,2),anim:num(b.anim)}));
    while(bugs.length<players)bugs.push(freshBugs()[bugs.length]);
    crumbs=(Array.isArray(s.crumbs)?s.crumbs:[]).slice(0,8).map(c=>({...position(num(c.x)*sx,num(c.y)*sy),gold:!!c.gold,turn:num(c.turn)}));
    swats=(Array.isArray(s.swats)?s.swats:[]).slice(0,8).map(v=>({...position(num(v.x)*sx,num(v.y)*sy),r:E.clamp(num(v.r,radius()*2)*Math.min(sx,sy),8,150),wait:E.clamp(num(v.wait),-1,2),life:E.clamp(num(v.life),0,.34),hit:!!v.hit}));
    effects=(Array.isArray(s.effects)?s.effects:[]).slice(-100).map(p=>({x:num(p.x)*sx,y:num(p.y)*sy,vx:E.clamp(num(p.vx)*sx,-500,500),vy:E.clamp(num(p.vy)*sy,-500,500),life:E.clamp(num(p.life),0,.6),color:/^#[0-9a-f]{3,8}$/i.test(String(p.color))?p.color:'#ffd700'}));preview=false;layoutW=E.W;layoutH=E.H;clearInput();lastHud='';syncUI();return true;
  }
  function debug(){return{game:'bug-squish',mode:'heist',players,round,delivered,target,hearts,phase,time,bugs:bugs.map(b=>({...b,hidden:hidden(b)})),crumbs:crumbs.map(c=>({...c})),swats:swats.map(s=>({...s})),home:{...home},leaves:leaves.map(l=>({...l})),activePointers:pointers.size};}
  return{attach,reset,resize,update,draw,captureState,restoreState,debug,pause:clearInput,setPlayers,syncUI,
    meaningful:()=>round>1||delivered>0||hearts<(players===2?5:4)||bugs.some(b=>b.bag>0),
    saveSummary:()=>`Picnic Heist ${round} · ${delivered}/${target} crumbs home`,
    forceComplete:()=>{delivered=target;win();syncUI();}};
};
