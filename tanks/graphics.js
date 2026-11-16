import { WIDTH, HEIGHT, createGame } from './engine.js';
import { weaponById } from './weapons.js';
import { blastProfile, terrainAtTick, weaponTerrainProfile, terrainSummary, cutChannel, buildTerrain, excavateTerrain } from './terrain-rules.js';
export { terrainSummary } from './terrain-rules.js';
export { weaponSvg } from './weapon-art.js';

const esc = value => String(value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const color = value => /^#[0-9a-f]{6}$/i.test(value || '') ? value : '#39b9ff';
export function tankSvg(tankColor = '#39b9ff', facing = 1) {
  const c = color(tankColor), flip = facing < 0 ? 'translate(110 0) scale(-1 1)' : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 110 64" aria-hidden="true"><g transform="${flip}"><path d="M16 41h76a9 9 0 0 1 0 18H16a9 9 0 0 1 0-18" fill="#081020" stroke="#8699aa" stroke-width="2"/><g fill="#6c8298" stroke="#15243a" stroke-width="2"><circle cx="20" cy="50" r="5"/><circle cx="37" cy="50" r="5"/><circle cx="54" cy="50" r="5"/><circle cx="71" cy="50" r="5"/><circle cx="88" cy="50" r="5"/></g><path d="m13 41 13-9h54l15 9Z" fill="${c}" stroke="#c8f4ff" stroke-width="1.5"/><path d="M36 32V20q19-15 35 0v12Z" fill="${c}" stroke="#c8f4ff" stroke-width="1.5"/><path d="m62 23 34-13" stroke="#111b30" stroke-width="10" stroke-linecap="round"/><path d="m62 23 34-13" stroke="${c}" stroke-width="6" stroke-linecap="round"/><path d="M40 17h16" stroke="#ffffffa0" stroke-width="3"/><circle cx="23" cy="38" r="3" fill="#ffce3a"/></g></svg>`;
}


const hash = n => { let x = Math.imul((n|0)^0x9e3779b9, 0x85ebca6b); x = Math.imul(x^(x>>>13),0xc2b2ae35); return ((x^(x>>>16))>>>0)/4294967296; };
const backgrounds = new WeakMap();
let originalKey = '', originalTerrain = null;
function originalSurface(game) {
  const key = `${game.seed}:${game.terrainType}`;
  if (key !== originalKey) {
    originalKey = key;
    originalTerrain = createGame({seed:game.seed,terrainType:game.terrainType}).terrain;
  }
  return originalTerrain;
}
function backdrop(canvas,seed) {
  const existing=backgrounds.get(canvas);if(existing?.seed===seed)return existing.image;
  const image=document.createElement('canvas');image.width=WIDTH;image.height=HEIGHT;const ctx=image.getContext('2d');
  const sky=ctx.createLinearGradient(0,0,0,HEIGHT);sky.addColorStop(0,'#07172f');sky.addColorStop(.6,'#213f60');sky.addColorStop(1,'#637768');ctx.fillStyle=sky;ctx.fillRect(0,0,WIDTH,HEIGHT);
  for(let i=0;i<60;i++){ctx.globalAlpha=.25+hash(i+9)*.5;ctx.fillStyle='#dbecff';circle(ctx,hash(i*37+seed)*WIDTH,hash(i*91+8)*200,.5+hash(i*3));}ctx.globalAlpha=1;
  ctx.fillStyle='#cbe9f5';ctx.shadowColor='#bce2ff';ctx.shadowBlur=30;circle(ctx,836,68,21);ctx.shadowBlur=0;ctx.fillStyle='#b4d6ec20';circle(ctx,836,68,40);
  for(let layer=0;layer<2;layer++){ctx.fillStyle=layer?'#35526377':'#223e5977';ctx.beginPath();ctx.moveTo(0,HEIGHT);for(let x=0;x<=WIDTH;x+=50){ctx.lineTo(x,270+layer*60-70*Math.sin(x/160+layer*2)-hash(x+layer*351)*35);}ctx.lineTo(WIDTH,HEIGHT);ctx.closePath();ctx.fill();}
  backgrounds.set(canvas,{seed,image});return image;
}
function ground(terrain,x){const step=WIDTH/(terrain.length-1),i=Math.max(0,Math.min(terrain.length-2,Math.floor(x/step))),f=Math.max(0,Math.min(1,x/step-i));return terrain[i]*(1-f)+terrain[i+1]*f;}
function terrainPath(ctx, terrain){ctx.beginPath();ctx.moveTo(0,HEIGHT);terrain.forEach((y,i)=>ctx.lineTo(i*WIDTH/(terrain.length-1),y));ctx.lineTo(WIDTH,HEIGHT);ctx.closePath();}
function circle(ctx,x,y,r){ctx.beginPath();ctx.arc(x,y,Math.max(.1,r),0,Math.PI*2);ctx.fill();}
function line(ctx,a,b){ctx.beginPath();ctx.moveTo(...a);ctx.lineTo(...b);ctx.stroke();}

function drawTank(ctx,tank,angle,active,time){
  ctx.save();ctx.translate(tank.x,tank.y-3);ctx.rotate(tank.tilt||0);
  if(active){ctx.fillStyle='#ffffff10';ctx.beginPath();ctx.ellipse(0,2,29,6,0,0,Math.PI*2);ctx.fill();ctx.strokeStyle=tank.color+'80';ctx.lineWidth=1.5;ctx.beginPath();ctx.ellipse(0,3,26,6,0,0,Math.PI*2);ctx.stroke();}
  ctx.fillStyle='#050b15';ctx.strokeStyle='#97a9b8';ctx.lineWidth=1.5;ctx.beginPath();ctx.roundRect(-18,-7,36,10,5);ctx.fill();ctx.stroke();
  ctx.fillStyle='#516880';for(let i=-12;i<=12;i+=8){circle(ctx,i,-2,2.7);ctx.fillStyle='#516880';}
  ctx.fillStyle=tank.color;ctx.strokeStyle='#c9f3ff';ctx.lineWidth=.8;ctx.beginPath();ctx.moveTo(-17,-7);ctx.lineTo(-10,-12);ctx.lineTo(11,-12);ctx.lineTo(18,-7);ctx.closePath();ctx.fill();ctx.stroke();
  ctx.beginPath();ctx.ellipse(0,-14,8,6,0,Math.PI,0);ctx.lineTo(8,-12);ctx.lineTo(-8,-12);ctx.closePath();ctx.fill();ctx.stroke();
  const radians=angle*Math.PI/180, end=[Math.cos(radians)*25,-14-Math.sin(radians)*25];ctx.lineCap='round';ctx.strokeStyle='#071426';ctx.lineWidth=6;line(ctx,[0,-15],end);ctx.strokeStyle=tank.color;ctx.lineWidth=3.8;line(ctx,[0,-15],end);ctx.strokeStyle='#ffffff8f';ctx.lineWidth=.8;line(ctx,[1,-16],[end[0]+1,end[1]-1]);
  ctx.fillStyle='#ffce3a';circle(ctx,-12,-9,1.3);
  if(active){ctx.fillStyle=tank.color;const b=Math.sin(time/400)*2;ctx.beginPath();ctx.moveTo(-5,-52+b);ctx.lineTo(5,-52+b);ctx.lineTo(0,-45+b);ctx.closePath();ctx.fill();}
  ctx.restore();
}


/** Decorative effects are reconstructed from weapon metadata and shot time.
 * They never touch terrain, scores, randomness, or shared multiplayer state. */
const COMIC_WORDS = Object.freeze({
 'cannonball':'BONK!', 'big-bang':'BADA-BOOM!', 'surface-slap':'HIGH FIVE!',
 'pancake-plop':'PLOP!', 'backpack-bonk':'BONK!', 'stapler-double-tap':'KA-CHUNK!',
 'rubber-duck-bounce':'SQUEAK!', 'jack-in-the-box':'POP!', 'bowling-ball-blitz':'STRIKE!',
 'soccer-ball-skip':'GOAL!', 'hockey-puck-slider':'SLIDE!', 'mud-pie-mortar':'SPLAT!',
 'toaster-trouble':'DING!', 'pillow-puff':'POOF!', 'snot-rocket':'SPLAT!',
 'burpquake':'BUUUURP!', 'stink-bomb':'PEW!', 'rotten-egg-rain':'YUCK!',
 'soda-geyser':'FIZZ!', 'robot-finger':'BEEP!', 'dragon-breath':'PHEW!',
 'wigglequake':'WIGGLE!', 'mountain-maker':'TA-DA!'
});
function drawPlayfulProjectile(ctx,weapon,index,tick,heading) {
  if(!weapon?.playful)return;
  ctx.save();ctx.shadowBlur=0;
  // The drawn mechanical projectile remains underneath as a font-independent fallback.
  if(Math.abs(heading)>Math.PI/2)ctx.rotate(Math.PI);
  ctx.fillStyle='#0a1428';ctx.strokeStyle='#f8fafccc';ctx.lineWidth=1.5;
  ctx.beginPath();ctx.ellipse(0,0,10,9,0,0,Math.PI*2);ctx.fill();ctx.stroke();
  ctx.font='19px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
  ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle='#fff';
  ctx.fillText(weapon.symbol||'★',0,0);
  ctx.restore();
}
function drawPlayfulAftermath(ctx,e,tick,index,weapon) {
  if(!weapon?.playful)return;
  const age=tick-e.tick,duration=e.duration||24;
  if(age<0||age>duration)return;
  const f=age/duration,theme=weapon.theme||'toy',r=Math.max(6,Math.min(70,e.radius||18));
  ctx.save();ctx.shadowBlur=0;ctx.globalAlpha=Math.max(0,1-f);
  const colors=theme==='gross'?['#d9f99d','#65a30d','#bef264']:
    theme==='food'?['#fda4af','#fcd34d','#fb923c']:
    theme==='school'?['#fef08a','#93c5fd','#f8fafc']:
    theme==='sports'?['#fff','#67e8f9','#fb7185']:
    theme==='backyard'?['#86efac','#bbf7d0','#7dd3fc']:
    theme==='house'?['#fda4af','#fff','#c4b5fd']:
    theme==='science'?['#a5f3fc','#e0f2fe','#818cf8']:
    ['#f9a8d4','#fde047','#c4b5fd'];
  const partCount=weapon.count>=8?4:7;
  for(let n=0;n<partCount;n++){
    const a=(hash(index*37+n*17+weapon.id.length)*1.8+.6)*Math.PI;
    const dist=r*(.2+f*1.25)*(0.6+hash(n*19+index));
    const x=e.x+Math.cos(a)*dist,y=e.y+Math.sin(a)*dist+f*f*24;
    ctx.fillStyle=colors[n%colors.length];
    if(theme==='food'||theme==='gross'||theme==='house'){
      ctx.beginPath();ctx.ellipse(x,y,Math.max(.4,3.7*(1-f)),Math.max(.4,2.5*(1-f)),a,0,Math.PI*2);ctx.fill();
    }else if(theme==='science'){
      ctx.strokeStyle=colors[n%colors.length];ctx.lineWidth=Math.max(.5,1.4*(1-f));
      ctx.beginPath();ctx.arc(x,y,Math.max(1,4*(1-f)),0,Math.PI*2);ctx.stroke();
    }else{
      ctx.save();ctx.translate(x,y);ctx.rotate(a+f*4);
      ctx.fillRect(-2,-2,Math.max(.4,5*(1-f)),Math.max(.4,3*(1-f)));ctx.restore();
    }
  }
  const word=COMIC_WORDS[weapon.id];
  // Avoid twenty repeated captions during large cluster volleys.
  if(word && index<4 && f<.75 && (weapon.count||1)<=7){
    ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.font='900 14px system-ui,sans-serif';ctx.lineWidth=3;
    const lift=20+f*18;
    ctx.strokeStyle='#0b1225';ctx.fillStyle=theme==='gross'?'#d9f99d':'#fff';
    ctx.strokeText(word,e.x,e.y-lift);ctx.fillText(word,e.x,e.y-lift);
  }
  ctx.restore();
}
/** Different mechanical signatures for every original family and variant.
 * Physical excavation stays in engine.js; only visible impact marks vary here. */
function drawWeaponSignature(ctx,e,tick,index,weapon) {
  if(!weapon||e.kind==='miss')return;
  const age=tick-e.tick,duration=e.duration||24;
  if(age<0||age>duration)return;
  const f=age/duration,v=(weapon.iconVariant||0)%6,kind=weapon.kind;
  const r=Math.max(5,Math.min(66,e.radius||18)),phase=(index+v)*1.12;
  ctx.save();ctx.shadowBlur=0;ctx.globalAlpha=(1-f)*.75;
  ctx.strokeStyle=weapon.color||'#fff';ctx.fillStyle=weapon.color||'#fff';
  ctx.lineWidth=Math.max(.7,2.5*(1-f));
  const n=3+v;
  if(['ballistic','cluster','burst'].includes(kind)){
    // Pinpricks, radial shockwaves, scattered fragments, and broad airbursts
    // have visibly different radial signatures.
    for(let i=0;i<n;i++){
      const a=i*Math.PI*2/n+phase,near=r*(.25+f*(.55+(v%3)*.15));
      if(v===0){line(ctx,[e.x+Math.cos(a)*near*.7,e.y+Math.sin(a)*near*.7],[e.x+Math.cos(a)*near,e.y+Math.sin(a)*near]);}
      else if(v===1||v===4){ctx.beginPath();ctx.ellipse(e.x+Math.cos(a)*near,e.y+Math.sin(a)*near,2+(v%2),1.4, a,0,Math.PI*2);ctx.stroke();}
      else {ctx.fillRect(e.x+Math.cos(a)*near-1.3,e.y+Math.sin(a)*near-1.3,2.6,2.6);}
    }
  }else if(kind==='bounce'||kind==='roller'){
    for(let i=0;i<n;i++){const a=(i/n)*Math.PI*2+phase+tick*.06;
      const x=e.x+Math.cos(a)*r*(.24+f*.6),y=e.y+Math.sin(a)*r*.25;
      ctx.beginPath();ctx.arc(x,y,Math.max(.5,3*(1-f)),0,Math.PI*2);ctx.stroke();
    }
    ctx.beginPath();ctx.ellipse(e.x,e.y,r*(.3+f*.6),Math.max(2,r*.13),0,0,Math.PI*2);ctx.stroke();
  }else if(kind==='drill'||kind==='tunnel'){
    for(let i=0;i<n;i++){
      const d=(i+1)*Math.max(4,r*.6)/(n+1),x=e.x+Math.sin(tick*.14+i*2+v)*Math.min(8,r*.25);
      line(ctx,[x-4,e.y-d],[x+4,e.y-d-3]);
    }
  }else if(kind==='beam'){
    if(Number.isFinite(e.x2)&&Number.isFinite(e.y2)){
      const dx=e.x2-e.x,dy=e.y2-e.y,len=Math.max(1,Math.hypot(dx,dy)),nx=-dy/len,ny=dx/len;
      const spacing=1.5+v*.8;
      for(const sign of [-1,1])line(ctx,[e.x+nx*spacing*sign,e.y+ny*spacing*sign],[e.x2+nx*spacing*sign,e.y2+ny*spacing*sign]);
    }else{ctx.beginPath();ctx.arc(e.x,e.y,r*(.2+f*.5),0,Math.PI*2);ctx.stroke();}
  }else if(kind==='flame'){
    for(let i=0;i<n;i++){
      const x=e.x+(i-(n-1)/2)*r*1.25/n,y=e.y-8-f*r*(.5+(i%3)*.2);
      ctx.beginPath();ctx.moveTo(x-2,e.y);ctx.quadraticCurveTo(x-5,y+8,x,y);
      ctx.quadraticCurveTo(x+5,y+7,x+3,e.y);ctx.stroke();
    }
  }else if(kind==='mine'){
    const R=r*(.2+f*.65);
    for(let i=0;i<n;i++){const a=i*2*Math.PI/n+phase;
      line(ctx,[e.x+Math.cos(a)*R,e.y+Math.sin(a)*R],[e.x+Math.cos(a)*(R+4),e.y+Math.sin(a)*(R+4)]);
    }
  }else if(kind==='builder'){
    for(let i=0;i<n;i++){
      const x=e.x+(i-(n-1)/2)*r*1.2/n,y=e.y-f*r*.4;
      ctx.fillRect(x,y,Math.max(2,4+(v%3)*2),Math.max(1.5,3*(1-f)));
    }
  }else if(kind==='carver'){
    for(let i=0;i<n;i++){
      const x=e.x+(i-(n-1)/2)*r*1.4/n;
      line(ctx,[x,e.y-r*.06],[x-4*(1-f),e.y+r*.2]);
    }
  }else if(kind==='lightning'){
    for(let i=0;i<n;i++){
      const a=i*2*Math.PI/n+phase,l=r*(.3+f*.5);
      const x=e.x+Math.cos(a)*l,y=e.y+Math.sin(a)*l;
      line(ctx,[e.x+Math.cos(a)*r*.1,e.y+Math.sin(a)*r*.1],[x-3,y-5]);
      line(ctx,[x-3,y-5],[x,y]);
    }
  }else if(kind==='wave'){
    for(let i=0;i<Math.min(n,5);i++){
      ctx.beginPath();ctx.ellipse(e.x,e.y,r*(.22+f*(.55+i*.08)),Math.max(2,r*.09+i),0,Math.PI,Math.PI*2);ctx.stroke();
    }
  }
  ctx.restore();
}
function drawClassicProjectileMark(ctx,weapon,tick){
 if(!weapon||weapon.playful)return;
 const v=weapon.iconVariant||0;
 ctx.save();ctx.shadowBlur=0;ctx.strokeStyle='#fff9';ctx.lineWidth=1.2;
 if(v===0){line(ctx,[-2,-3],[2,3]);}
 else if(v===1){ctx.beginPath();ctx.arc(0,0,4,0,Math.PI*2);ctx.stroke();}
 else if(v===2){for(const y of [-3,0,3])line(ctx,[-4,y],[2,y]);}
 else if(v===3){ctx.beginPath();ctx.moveTo(4,-4);ctx.lineTo(-2,0);ctx.lineTo(4,4);ctx.stroke();}
 else if(v===4){line(ctx,[-3,-4],[2,4]);line(ctx,[-3,4],[2,-4]);}
 else {for(const x of [-3,2]){ctx.beginPath();ctx.arc(x,0,1.5,0,Math.PI*2);ctx.stroke();}}
 ctx.restore();
}

function drawProjectile(ctx,path,tick,index,viewportTop,displayScale,weapon){
  const p=path.points;if(!p?.length||tick<p[0][2]||tick>p[p.length-1][2]+3)return;
  let at=p[0],previous=p[0];ctx.save();ctx.lineWidth=2;ctx.strokeStyle=path.color||'#ffce3a';ctx.globalAlpha=.5;ctx.beginPath();
  const start=Math.max(0,p.findIndex(q=>q[2]>=tick-15)-1);previous=p[start];at=previous;let heading=0;ctx.moveTo(previous[0],previous[1]);
  for(let i=start+1;i<p.length;i++){heading=Math.atan2(p[i][1]-previous[1],p[i][0]-previous[0]);if(p[i][2]>tick){const f=(tick-previous[2])/Math.max(1,p[i][2]-previous[2]);at=[previous[0]+(p[i][0]-previous[0])*f,previous[1]+(p[i][1]-previous[1])*f,tick];ctx.lineTo(at[0],at[1]);break;}ctx.lineTo(p[i][0],p[i][1]);previous=at=p[i];}ctx.stroke();ctx.globalAlpha=1;
  if(at[1]<viewportTop+10){ctx.fillStyle=path.color||'#ffce3a';ctx.beginPath();ctx.moveTo(at[0],viewportTop+10);ctx.lineTo(at[0]-5,viewportTop+20);ctx.lineTo(at[0]+5,viewportTop+20);ctx.closePath();ctx.fill();ctx.font=`700 ${Math.min(28,11/displayScale)}px system-ui`;ctx.textAlign='center';ctx.fillText('IN FLIGHT',at[0],viewportTop+20+14/displayScale);ctx.restore();return;}
  ctx.translate(at[0],at[1]);ctx.rotate(heading);ctx.fillStyle=path.color||'#ffce3a';ctx.shadowColor=ctx.fillStyle;ctx.shadowBlur=13;
  if(path.kind==='beam'||path.kind==='lightning'){ctx.lineWidth=4;ctx.strokeStyle='#fff';line(ctx,[-18,0],[6,0]);}
  else if(path.kind==='flame'){ctx.beginPath();ctx.moveTo(6,0);ctx.quadraticCurveTo(-2,-7,-15,0);ctx.quadraticCurveTo(-2,7,6,0);ctx.fill();ctx.fillStyle='#fff4b0';circle(ctx,0,0,3);}
  else if(path.kind==='drill'||path.kind==='tunnel'){ctx.beginPath();ctx.moveTo(7,0);ctx.lineTo(-5,-4);ctx.lineTo(-5,4);ctx.closePath();ctx.fill();ctx.strokeStyle='#fff8';ctx.lineWidth=1;line(ctx,[-4,-3],[0,3]);}
  else if(path.kind==='roller'||path.kind==='bounce'||path.kind==='wave'){circle(ctx,0,0,5);ctx.fillStyle='#fff';circle(ctx,-1,-1,1.7);}
  else {ctx.beginPath();ctx.moveTo(6,0);ctx.lineTo(-3,-3);ctx.lineTo(-6,0);ctx.lineTo(-3,3);ctx.closePath();ctx.fill();ctx.fillStyle='#ffcf72';circle(ctx,-7,0,2+hash(index+tick|0)*2);}
  drawPlayfulProjectile(ctx,weapon,index,tick,heading);
  drawClassicProjectileMark(ctx,weapon,tick);
  ctx.restore();
}

function drawEffect(ctx,e,tick,index,weapon){
  const age=tick-e.tick,duration=e.duration||({flame:40,earth:25,mine:40,beam:14,lightning:17,wave:40,drill:28,tunnel:28,miss:18}[e.kind]||28);if(age<0||age>duration)return;
  const f=age/duration,r=Math.max(3,e.radius||16),c=e.color||'#ffce3a';ctx.save();ctx.globalAlpha=1-f;ctx.fillStyle=c;ctx.strokeStyle=c;ctx.shadowColor=c;ctx.shadowBlur=18;
  if(e.kind==='beam'||e.kind==='lightning'){
    const end=[e.x2??e.x,e.y2??e.y];ctx.lineWidth=(1-f)*8+1;ctx.beginPath();ctx.moveTo(e.x,e.y);for(let n=1;n<=8;n++){const t=n/8;ctx.lineTo(e.x+(end[0]-e.x)*t+(e.kind==='lightning'&&n<8?(hash(index*311+n+Math.floor(tick/2))*2-1)*15:0),e.y+(end[1]-e.y)*t);}ctx.stroke();ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.stroke();
  }else if(e.kind==='flame' && ['sprinkler-spray','garden-hose-jet'].includes(weapon?.id)){
    ctx.shadowBlur=0;
    for(let n=0;n<9;n++){
      const a=Math.PI+(n/8)*Math.PI,dist=r*(.2+f*.9);
      ctx.fillStyle=n%2?'#93c5fd':'#e0f2fe';
      ctx.beginPath();ctx.ellipse(e.x+Math.cos(a)*dist,e.y+Math.sin(a)*dist+f*18,2.5*(1-f)+.3,4*(1-f)+.3,a,0,Math.PI*2);ctx.fill();
    }
  }else if(e.kind==='flame'){
    ctx.shadowBlur=8;
    for(let n=0;n<7;n++){
      const x=e.x+(n/6-.5)*r*2,h=(10+hash(n+index)*20)*(1-f);
      ctx.fillStyle=n%2?'#ffb137':c;ctx.beginPath();ctx.moveTo(x-4,e.y+8);
      ctx.quadraticCurveTo(x+7,e.y-h/2,x+Math.sin(tick+n)*3,e.y-h);
      ctx.quadraticCurveTo(x-6,e.y-h/2,x+4,e.y+8);ctx.fill();
    }
    ctx.shadowBlur=0;ctx.fillStyle='#53606a';ctx.globalAlpha=(1-f)*.25;
    for(let n=0;n<4;n++)circle(ctx,e.x+(hash(n+index)-.5)*r,e.y-f*40,4+f*9);
  }else if(e.kind==='spark'){
    ctx.shadowBlur=9;ctx.lineWidth=1.5;ctx.strokeStyle=c;
    for(let n=0;n<8;n++){const a=n*Math.PI/4;line(ctx,[e.x+Math.cos(a)*r*.15,e.y+Math.sin(a)*r*.15],[e.x+Math.cos(a)*r*(.2+f*.55),e.y+Math.sin(a)*r*(.2+f*.55)]);}
    ctx.fillStyle='#fff';circle(ctx,e.x,e.y,3*(1-f));
  }else if(e.kind==='wave'){
    ctx.lineWidth=4*(1-f)+1;ctx.beginPath();ctx.arc(e.x,e.y,r*(.2+f),Math.PI,Math.PI*2);ctx.stroke();ctx.beginPath();ctx.arc(e.x,e.y,r*(.1+f*.75),Math.PI,Math.PI*2);ctx.stroke();
  }else if(['earth','drill','tunnel','bore','cut'].includes(e.kind)){
    ctx.shadowBlur=0;for(let n=0;n<14;n++){const a=hash(index*71+n)*Math.PI*2,dist=r*f*(.4+hash(n*991+index));ctx.save();ctx.translate(e.x+Math.cos(a)*dist,e.y+Math.sin(a)*dist+f*f*27);ctx.rotate(a+f*4);ctx.fillStyle=n%3?'#af956d':c;ctx.fillRect(-2,-2,5*(1-f),5*(1-f));ctx.restore();}
    ctx.strokeStyle=c;ctx.lineWidth=2;ctx.beginPath();ctx.arc(e.x,e.y,r*(.2+f),Math.PI,Math.PI*2);ctx.stroke();
  }else if(e.kind==='mine'||e.kind==='mine-arm'){
    ctx.strokeStyle=c;ctx.lineWidth=2;ctx.beginPath();ctx.arc(e.x,e.y,8+f*25,0,Math.PI*2);ctx.stroke();circle(ctx,e.x,e.y-5,5);
  }else if(e.kind==='miss'){
    ctx.shadowBlur=0;ctx.fillStyle='#abc3de';for(let n=0;n<5;n++)circle(ctx,e.x+(hash(n+index)*2-1)*20*f,e.y-f*24+hash(n*17)*8,4*(1-f));
  }else{
    const grow=1-Math.pow(1-f,4);
    // A broad pressure ring, hot flash and ballistic soil fragments sell impact.
    ctx.shadowBlur=0;ctx.globalAlpha=Math.max(0,1-f*2)*.7;ctx.fillStyle='#fffbe8';
    ctx.beginPath();ctx.ellipse(e.x,e.y,r*(.3+f*2.8),r*(.1+f*.8),0,0,Math.PI*2);ctx.fill();
    ctx.globalAlpha=1-f;
    for(let n=0;n<18;n++){
      const a=Math.PI+(hash(index*113+n)*Math.PI),speed=r*(.8+hash(n*57+index)*1.1);
      const x=e.x+Math.cos(a)*speed*f*2,y=e.y+Math.sin(a)*speed*f*2+f*f*70;
      ctx.fillStyle=n%3?'#b99366':'#ebbf79';ctx.save();ctx.translate(x,y);ctx.rotate(a+f*7);
      ctx.fillRect(-2,-2,3+hash(n+index)*3,2+hash(n*9)*3);ctx.restore();
    }
    ctx.fillStyle=c;circle(ctx,e.x,e.y,r*grow*(1-f*.6));ctx.fillStyle='#fff1bc';circle(ctx,e.x,e.y,r*grow*(1-f)*.55);ctx.strokeStyle=c;ctx.lineWidth=2;ctx.beginPath();ctx.arc(e.x,e.y,r*(.15+f*1.3),0,Math.PI*2);ctx.stroke();
    for(let n=0;n<15;n++){const a=hash(index*87+n)*Math.PI*2,dist=r*(.2+f)*(1+hash(n*99));ctx.fillStyle=n%2?c:'#ffd67a';circle(ctx,e.x+Math.cos(a)*dist,e.y+Math.sin(a)*dist+f*f*25,Math.max(.3,3*(1-f)));}
    ctx.shadowBlur=0;ctx.fillStyle='#647286';ctx.globalAlpha=(1-f)*.4;for(let n=0;n<5;n++)circle(ctx,e.x+(hash(n+index)*2-1)*r*f,e.y-12-f*38+hash(n*8)*12,6+f*r*.4);
  }ctx.restore();
  drawWeaponSignature(ctx,e,tick,index,weapon);
  drawPlayfulAftermath(ctx,e,tick,index,weapon);
}

/** Recreate authoritative knockback without simulating physics a second time.
 * Optional pushes support keeps snapshots from before this release playable.
 * Interpolation finishes before the next blow, preventing cross-impact jumps.
 */
export function tankImpactAtTick(initialX, seat, effects, tick) {
  const events = [];
  for (const effect of effects || []) for (const push of effect.pushes || []) {
    if (push[0] === seat) events.push({tick:effect.tick, push});
  }
  let x = initialX, hop = 0, tilt = 0;
  for (let index = 0; index < events.length; index++) {
    const event = events[index];
    if (tick < event.tick) break;
    const next = events[index + 1];
    const span = Math.max(1, Math.min(10, next ? next.tick - event.tick : 10));
    const t = Math.max(0, Math.min(1, (tick-event.tick)/span));
    const ease = t*t*(3-2*t);
    const [,from,to,height] = event.push;
    x = from + (to-from)*ease;
    hop = 4*height*t*(1-t);
    tilt = Math.sign(to-from)*.18*Math.sin(Math.PI*t);
  }
  return {x,hop,tilt};
}
function tankOnGround(tank, terrain, position) {
  const {x,hop,tilt} = position;
  return {...tank,x,y:Math.min(ground(terrain,x-12),ground(terrain,x),ground(terrain,x+12))-hop,hop,tilt};
}

export function drawBattle(canvas, game, {aims=[],animation=null,time=0,viewportTop=0,displayScale=1}={}) {
  const ctx=canvas.getContext('2d');if(!ctx||!game)return;ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,WIDTH,canvas.height);ctx.translate(0,-viewportTop);
  ctx.drawImage(backdrop(canvas,game.seed),0,0);
  if(animation?.shot){
    const recent=animation.shot.effects.filter(e=>e.kind!=='miss'&&e.kind!=='mine'&&animation.tick>=e.tick&&animation.tick-e.tick<9);
    const strength=Math.min(4,recent.reduce((n,e)=>Math.max(n,(1-(animation.tick-e.tick)/9)*(e.radius||10)/12),0));
    ctx.translate(Math.sin(animation.tick*2.7)*strength,Math.cos(animation.tick*2.1)*strength*.65);
  }
  let terrain=game.terrain,tanks=game.tanks;const shot=animation?.shot,tick=animation?.tick||0;
  if(animation?.before&&shot?.terrainVersion===1){
    terrain=terrainAtTick(animation.before.terrain,shot.effects,tick);
    tanks=game.tanks.map((tank,i)=>tankOnGround(tank,terrain,
      tankImpactAtTick(animation.before.tanks[i].x,i,shot.effects,tick)));
  }
  if(animation?.before&&shot&&shot.terrainVersion!==1){const events=shot.effects||[];terrain=game.terrain.map((y,i)=>{const old=animation.before.terrain[i],x=i*WIDTH/(game.terrain.length-1);if(old===y)return y;let reveal=shot.duration-12;for(const e of events){if(Math.abs(x-e.x)<Math.max(30,blastProfile(e.radius||40,weaponById(shot.weaponId)?.craterScale||1).width))reveal=Math.min(reveal,e.tick);}const f=Math.max(0,Math.min(1,(tick-reveal)/10));return old+(y-old)*f;});tanks=game.tanks.map((tank,i)=>({...tank,y:Math.min(ground(terrain,tank.x-12),ground(terrain,tank.x),ground(terrain,tank.x+12))}));}
  if(animation?.move){
    const move=animation.move;
    // An armed mine fires at tick 18; finish the voluntary movement before
    // its separate blast can physically throw the moving tank.
    const firstMineTick=move.effects?.find(e=>e.kind==='explosion')?.tick;
    const travelTicks=firstMineTick===undefined?24:Math.max(1,Math.min(24,firstMineTick));
    const f=Math.min(1,tick/travelTicks),requested=move.intendedTo??move.to;
    const travelling=move.from+(requested-move.from)*(1-Math.pow(1-f,3));
    if(move.terrainVersion===1)terrain=terrainAtTick(animation.before.terrain,move.effects,tick);
    tanks=game.tanks.map((tank,i)=>{
      const initial=i===move.actor?travelling:animation.before.tanks[i].x;
      return tankOnGround(tank,terrain,tankImpactAtTick(initial,i,move.effects,tick));
    });
  }
  const earth=ctx.createLinearGradient(0,250,0,HEIGHT);earth.addColorStop(0,'#557f58');earth.addColorStop(.18,'#354d39');earth.addColorStop(.5,'#263a34');earth.addColorStop(1,'#132c2b');terrainPath(ctx,terrain);ctx.fillStyle=earth;ctx.fill();ctx.save();ctx.clip();ctx.strokeStyle='#64806325';ctx.lineWidth=2;for(let band=0;band<7;band++){ctx.beginPath();for(let x=0;x<=WIDTH;x+=10){const y=340+band*36+9*Math.sin(x/82+band);x?ctx.lineTo(x,y):ctx.moveTo(x,y);}ctx.stroke();}for(let i=0;i<130;i++){ctx.fillStyle=i%3?'#8fac6920':'#040e182b';circle(ctx,hash(i*21)*WIDTH,300+hash(i*32+game.seed)*260,1+hash(i*91)*2);}ctx.restore();
  const initial=originalSurface(game),step=WIDTH/(terrain.length-1);
  // Cut faces show warm strata rather than magically growing new grass.
  ctx.save();terrainPath(ctx,terrain);ctx.clip();
  for(let i=1;i<terrain.length;i++){
    if(terrain[i]-initial[i]<5 && terrain[i-1]-initial[i-1]<5)continue;
    const x=(i-1)*step,y=terrain[i-1],next=terrain[i];
    ctx.fillStyle='#996540';ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+step,next);ctx.lineTo(x+step,next+14);ctx.lineTo(x,y+14);ctx.fill();
    ctx.strokeStyle='#d1a370';ctx.lineWidth=1.2;line(ctx,[x,y+12],[x+step,next+12]);
    ctx.strokeStyle='#6b503a';ctx.lineWidth=2;line(ctx,[x,y+27],[x+step,next+27]);
  }ctx.restore();
  for(let i=1;i<terrain.length;i++){
    const cut=terrain[i]-initial[i]>5||terrain[i-1]-initial[i-1]>5;
    const scorch=!cut&&(terrain[i]-initial[i]>.2||terrain[i-1]-initial[i-1]>.2);
    ctx.strokeStyle=cut?'#e0ac72':scorch?'#372c31':'#92bc75';ctx.lineWidth=cut?2.4:3;
    line(ctx,[(i-1)*step,terrain[i-1]],[i*step,terrain[i]]);
  }

  for(const mine of game.mines||[]){ctx.fillStyle=mine.color||'#ff9f43';ctx.shadowColor=ctx.fillStyle;ctx.shadowBlur=6;ctx.beginPath();ctx.ellipse(mine.x,ground(terrain,mine.x)-2,5,3,0,Math.PI,0);ctx.fill();ctx.shadowBlur=0;ctx.fillStyle='#fff4b0';circle(ctx,mine.x,ground(terrain,mine.x)-5,1);
    const mw=weaponById(mine.weaponId);if(mw?.playful){ctx.font='12px "Segoe UI Emoji","Noto Color Emoji",sans-serif';ctx.textAlign='center';ctx.fillText(mw.symbol,mine.x,ground(terrain,mine.x)-9);}}
  const shooting=!!animation;for(let i=0;i<tanks.length;i++){const tank=tanks[i],a=shot?.actor===i?shot.angle:(aims[i]?.angle??(i?135:45));const recoil=shot?.actor===i&&tick>=(shot.launchTick||0)&&tick<(shot.launchTick||0)+9?Math.sin((tick-(shot.launchTick||0))/9*Math.PI)*3:0;drawTank(ctx,{...tank,x:tank.x-Math.cos(a*Math.PI/180)*recoil},a,!shooting&&!game.finished&&game.turn===i,time);ctx.font=`700 ${Math.min(32,12/displayScale)}px system-ui`;ctx.textAlign='center';ctx.fillStyle='#eff6ff';ctx.shadowColor='#081529';ctx.shadowBlur=4;ctx.fillText(tank.name,tank.x,tank.y+16/displayScale);ctx.shadowBlur=0;}
  if(shot){const w=weaponById(shot.weaponId);for(let i=0;i<shot.paths.length;i++)drawProjectile(ctx,shot.paths[i],tick,i,viewportTop,displayScale,w);for(let i=0;i<shot.effects.length;i++)drawEffect(ctx,shot.effects[i],tick,i,weaponById(shot.effects[i].weaponId)||w);}
  if(animation?.move){const move=animation.move;for(let i=0;i<(move.effects||[]).length;i++)drawEffect(ctx,move.effects[i],tick,i,weaponById(move.effects[i].weaponId));}
  if(!shooting&&!game.finished){
    const tank=tanks[game.turn],aim=aims[game.turn]||{},a=(aim.angle??45)*Math.PI/180;
    const speed=60+(aim.power??55)*4.4,beam=weaponById(aim.weaponId)?.kind==='beam';
    const ox=tank.x+Math.cos(a)*23,oy=tank.y-15-Math.sin(a)*23;
    for(let n=1;n<=12;n++){
      const t=n*.035,x=ox+Math.cos(a)*speed*t,y=oy-Math.sin(a)*speed*t+(beam?0:55*t*t);
      if(x<0||x>WIDTH||y>=ground(terrain,x))break;
      ctx.globalAlpha=.6-n*.035;ctx.fillStyle='#e2f4ff';circle(ctx,x,y,1.8);
    }ctx.globalAlpha=1;
  }
}

/** Catalogue cross-section generated by the same rules as the battlefield. */
export function terrainPreviewSvg(w) {
  const reference=Array(251).fill(300),terrain=reference.slice(),p=weaponTerrainProfile(w);
  if(w.kind==='builder')buildTerrain(terrain,reference,500,w.width/2,w.height,w.id==='mountain-maker'?'v':['wall-drop','earth-blanket','sandbar'].includes(w.id)?'flat':'bowl');
  else if(w.kind==='carver')cutChannel(terrain,reference,450,w.id==='posthole'?450:450+w.reach,p.width,p.depth,p.shape);
  else if(w.kind==='drill'){cutChannel(terrain,reference,500,500,Math.min(9,p.width/2),w.depth);excavateTerrain(terrain,500,300+w.depth,w.radius,w.craterScale,{...p,connected:true});}
  else if(w.kind==='tunnel'){cutChannel(terrain,reference,360,360+w.reach,Math.max(4,p.width*.45),w.depth);for(let i=0;i<w.count;i++)excavateTerrain(terrain,360+w.reach*i/Math.max(1,w.count-1),300+w.depth,w.radius,w.craterScale,{...p,connected:true});}
  else if(['cluster','burst','wave'].includes(w.kind))for(let i=0;i<Math.min(w.count,6);i++)excavateTerrain(terrain,380+i*48,300,w.radius,w.craterScale,p);
  else excavateTerrain(terrain,500,300+(w.kind==='mine'?w.depth:0),w.radius,w.craterScale,{...p,connected:w.kind==='mine'});
  // Identical axes for every weapon. Do not make a pinprick look like a canyon
  // by independently zooming each preview to its own excavation bounds.
  const lo=55,hi=215,sy=y=>48+(y-300)*.4;
  const path=terrain.slice(lo,hi+1).map((y,i)=>`${i?'L':'M'}${(i/(hi-lo)*256).toFixed(1)} ${sy(y).toFixed(1)}`).join('');
  const groundColor=['flame','lightning','beam'].includes(w.kind)?'#b899be':'#dea16c';
  return `<svg class="terrain-preview" viewBox="0 0 256 116" role="img" aria-label="${esc(terrainSummary(w))}"><path d="${path} L256 116 L0 116Z" fill="#66503b55"/><path d="M0 ${sy(300).toFixed(1)}H256" stroke="#8baba0" stroke-dasharray="4 4"/><path d="${path}" fill="none" stroke="${groundColor}" stroke-width="2"/></svg>`;
}
