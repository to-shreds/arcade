import { WIDTH, HEIGHT } from './engine.js';

const esc = value => String(value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const color = value => /^#[0-9a-f]{6}$/i.test(value || '') ? value : '#39b9ff';
export function tankSvg(tankColor = '#39b9ff', facing = 1) {
  const c = color(tankColor), flip = facing < 0 ? 'translate(110 0) scale(-1 1)' : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 110 64" aria-hidden="true"><g transform="${flip}"><path d="M16 41h76a9 9 0 0 1 0 18H16a9 9 0 0 1 0-18" fill="#081020" stroke="#8699aa" stroke-width="2"/><g fill="#6c8298" stroke="#15243a" stroke-width="2"><circle cx="20" cy="50" r="5"/><circle cx="37" cy="50" r="5"/><circle cx="54" cy="50" r="5"/><circle cx="71" cy="50" r="5"/><circle cx="88" cy="50" r="5"/></g><path d="m13 41 13-9h54l15 9Z" fill="${c}" stroke="#c8f4ff" stroke-width="1.5"/><path d="M36 32V20q19-15 35 0v12Z" fill="${c}" stroke="#c8f4ff" stroke-width="1.5"/><path d="m62 23 34-13" stroke="#111b30" stroke-width="10" stroke-linecap="round"/><path d="m62 23 34-13" stroke="${c}" stroke-width="6" stroke-linecap="round"/><path d="M40 17h16" stroke="#ffffffa0" stroke-width="3"/><circle cx="23" cy="38" r="3" fill="#ffce3a"/></g></svg>`;
}

// Every weapon uses its family drawing plus its own color, rays and variant geometry.
// The drawings are code-native SVG and stay crisp on mobile and offline.
export function weaponSvg(weapon) {
  if (!weapon) return '';
  const c = color(weapon.color), v = Number(weapon.iconVariant || 0) % 6, k = weapon.kind || weapon.icon;
  const spark = `<path d="m32 8 4 12 12-4-7 11 11 7-13 1-1 13-7-11-11 7 4-12-12-4 12-4Z" fill="${c}" opacity=".26"/>`;
  let shape;
  switch (k) {
    case 'cluster': shape = [0,1,2,3,4].map(i => `<circle cx="${19 + (i % 3) * 13}" cy="${23 + Math.floor(i / 3) * 17 + (i%2)*4}" r="${4 + v % 3}" fill="${c}" stroke="#fff9"/>`).join('') + '<path d="m18 13 13 5 17-6" stroke="#fff9" fill="none"/>'; break;
    case 'burst': shape = `<path d="M10 41 32 15 54 41" fill="none" stroke="${c}" stroke-width="3"/><path d="m16 46 16-26 16 26" fill="none" stroke="#fff9" stroke-width="2"/>`+[16,32,48].map((x,i)=>`<path d="m${x} ${39+i%2*4} 3-9 4 9-4 8Z" fill="${c}"/>`).join(''); break;
    case 'bounce': shape = `<path d="M9 43q9-39 20 0 10-23 24 0" stroke="${c}" fill="none" stroke-width="3" stroke-dasharray="3 3"/><circle cx="${30+v}" cy="${22+v}" r="8" fill="${c}" stroke="#fff" stroke-width="2"/><path d="M12 50h42" stroke="#879ab9" stroke-width="3"/>`; break;
    case 'roller': shape = `<path d="m10 47 16-8 14 8 15-12" stroke="#7d91ae" fill="none" stroke-width="4"/><circle cx="32" cy="28" r="${12+v%3}" fill="${c}" stroke="#fff9" stroke-width="2"/><path d="M23 28h18M32 19v18" stroke="#111a2c" stroke-width="3"/><path d="m42 13 9 4-4 8" fill="none" stroke="${c}" stroke-width="3"/>`; break;
    case 'drill': shape = `<path d="m22 12 20 0v25L32 54 22 37Z" fill="${c}" stroke="#fff9" stroke-width="2"/><path d="m23 19 18 7m-18 2 18 7m-17 1 12 6" stroke="#0a1830" stroke-width="3"/><path d="M10 41h9m25 0h10" stroke="#91a1bb" stroke-width="3"/>`; break;
    case 'tunnel': shape = `<path d="M9 24h46M9 50h46" stroke="#8b9db9" stroke-width="3"/><path d="M10 39h36l-8-7m8 7-8 7" fill="none" stroke="${c}" stroke-width="5" stroke-linecap="round"/><path d="m${18+v*2} 15 7-7 7 7" stroke="${c}" stroke-width="2" fill="none"/>`; break;
    case 'beam': shape = `<path d="m11 49 40-35" stroke="${c}" stroke-width="9" stroke-linecap="round"/><path d="m11 49 40-35" stroke="#fff" stroke-width="3"/><path d="m44 9 13 8m-7-14 5 21M6 39l13 15" stroke="${c}" stroke-width="2"/>`; break;
    case 'flame': shape = `<path d="M33 8q5 16 13 19 10 13-2 24-20 12-27-6-5-13 9-22-2 13 5 12 7-9 2-27Z" fill="${c}" stroke="#fff7" stroke-width="1.5"/><path d="M32 30q-13 16 0 23 14-5 0-23Z" fill="#fff4b0"/>`; break;
    case 'mine': shape = `<ellipse cx="32" cy="43" rx="21" ry="9" fill="${c}" stroke="#fff9" stroke-width="2"/><path d="M18 40q0-18 14-18t14 18" fill="${c}" stroke="#fff9" stroke-width="2"/><path d="M32 22V12m-12 16-8-7m32 7 8-7" stroke="${c}" stroke-width="4"/><circle cx="32" cy="30" r="4" fill="#fff4b0"/>`; break;
    case 'builder': shape = `<path d="M10 51h44v-8H44v-9H34V23H24v20H10Z" fill="${c}" stroke="#fff9" stroke-width="2"/><path d="M32 10v17m-7-10 7-7 7 7" stroke="#fff" stroke-width="3" fill="none"/>`; break;
    case 'carver': shape = `<path d="M9 29h12q2 25 12 25t11-25h11" stroke="${c}" stroke-width="4" fill="none"/><path d="M32 8v28m-8-8 8 8 8-8" stroke="#fff" stroke-width="3" fill="none"/><path d="m13 36 6 8m29-8-6 8" stroke="${c}" stroke-width="2"/>`; break;
    case 'lightning': shape = `<path d="m36 7-20 28h17l-8 24 23-33H32Z" fill="${c}" stroke="#fff9" stroke-width="1.5"/><path d="M9 12v8m-4-4h8m38 31v8m-4-4h8" stroke="${c}" stroke-width="2"/>`; break;
    case 'wave': shape = `<path d="M9 39q8-23 16 0t16 0 15 0M9 49q8-23 16 0t16 0 15 0" stroke="${c}" stroke-width="3" fill="none"/><path d="M20 13q12-8 24 0m-20 7q8-6 16 0" stroke="#fff9" stroke-width="2" fill="none"/>`; break;
    default: shape = `<g transform="rotate(${30+v*5} 32 32)"><path d="M24 44V22l8-13 8 13v22Z" fill="${c}" stroke="#fff9" stroke-width="2"/><path d="m24 36-7 10 7-2m16-8 7 10-7-2" fill="${c}" stroke="#fff9"/><path d="M28 48v7m8-7v7m-4-9v12" stroke="#ffce3a" stroke-width="2"/><circle cx="32" cy="24" r="3" fill="#fff"/></g>`;
  }
  const ticks = Array.from({length:v+1},(_,i)=>`<circle cx="${22+i*4}" cy="59" r="1.2" fill="${c}"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" aria-hidden="true"><rect x="1" y="1" width="62" height="62" rx="14" fill="#101b33" stroke="${c}" stroke-opacity=".3"/>${spark}${shape}${ticks}<title>${esc(weapon.name)}</title></svg>`;
}

const hash = n => { let x = Math.imul((n|0)^0x9e3779b9, 0x85ebca6b); x = Math.imul(x^(x>>>13),0xc2b2ae35); return ((x^(x>>>16))>>>0)/4294967296; };
const backgrounds = new WeakMap();
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
  ctx.save();ctx.translate(tank.x,tank.y-3);
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

function drawProjectile(ctx,path,tick,index,viewportTop,displayScale){
  const p=path.points;if(!p?.length||tick<p[0][2]||tick>p[p.length-1][2]+3)return;
  let at=p[0],previous=p[0];ctx.save();ctx.lineWidth=2;ctx.strokeStyle=path.color||'#ffce3a';ctx.globalAlpha=.5;ctx.beginPath();
  const start=Math.max(0,p.findIndex(q=>q[2]>=tick-15));ctx.moveTo(p[start][0],p[start][1]);
  for(let i=start;i<p.length;i++){if(p[i][2]>tick){const f=(tick-previous[2])/Math.max(1,p[i][2]-previous[2]);at=[previous[0]+(p[i][0]-previous[0])*f,previous[1]+(p[i][1]-previous[1])*f,tick];ctx.lineTo(at[0],at[1]);break;}ctx.lineTo(p[i][0],p[i][1]);previous=at=p[i];}ctx.stroke();ctx.globalAlpha=1;
  if(at[1]<viewportTop+10){ctx.fillStyle=path.color||'#ffce3a';ctx.beginPath();ctx.moveTo(at[0],viewportTop+10);ctx.lineTo(at[0]-5,viewportTop+20);ctx.lineTo(at[0]+5,viewportTop+20);ctx.closePath();ctx.fill();ctx.font=`700 ${Math.min(28,11/displayScale)}px system-ui`;ctx.textAlign='center';ctx.fillText('IN FLIGHT',at[0],viewportTop+20+14/displayScale);ctx.restore();return;}
  ctx.translate(at[0],at[1]);const rotate=Math.atan2(at[1]-previous[1],at[0]-previous[0]);ctx.rotate(rotate);ctx.fillStyle=path.color||'#ffce3a';ctx.shadowColor=ctx.fillStyle;ctx.shadowBlur=13;
  if(path.kind==='beam'||path.kind==='lightning'){ctx.lineWidth=4;ctx.strokeStyle='#fff';line(ctx,[-18,0],[6,0]);}
  else if(path.kind==='flame'){ctx.beginPath();ctx.moveTo(6,0);ctx.quadraticCurveTo(-2,-7,-15,0);ctx.quadraticCurveTo(-2,7,6,0);ctx.fill();ctx.fillStyle='#fff4b0';circle(ctx,0,0,3);}
  else if(path.kind==='drill'||path.kind==='tunnel'){ctx.beginPath();ctx.moveTo(7,0);ctx.lineTo(-5,-4);ctx.lineTo(-5,4);ctx.closePath();ctx.fill();ctx.strokeStyle='#fff8';ctx.lineWidth=1;line(ctx,[-4,-3],[0,3]);}
  else if(path.kind==='roller'||path.kind==='bounce'||path.kind==='wave'){circle(ctx,0,0,5);ctx.fillStyle='#fff';circle(ctx,-1,-1,1.7);}
  else {ctx.beginPath();ctx.moveTo(6,0);ctx.lineTo(-3,-3);ctx.lineTo(-6,0);ctx.lineTo(-3,3);ctx.closePath();ctx.fill();ctx.fillStyle='#ffcf72';circle(ctx,-7,0,2+hash(index+tick|0)*2);}
  ctx.restore();
}

function drawEffect(ctx,e,tick,index){
  const age=tick-e.tick,duration=e.duration||({flame:40,earth:25,mine:40,beam:14,lightning:17,wave:40,drill:28,tunnel:28,miss:18}[e.kind]||28);if(age<0||age>duration)return;
  const f=age/duration,r=Math.max(3,e.radius||16),c=e.color||'#ffce3a';ctx.save();ctx.globalAlpha=1-f;ctx.fillStyle=c;ctx.strokeStyle=c;ctx.shadowColor=c;ctx.shadowBlur=18;
  if(e.kind==='beam'||e.kind==='lightning'){
    const end=[e.x2??e.x,e.y2??e.y];ctx.lineWidth=(1-f)*8+1;ctx.beginPath();ctx.moveTo(e.x,e.y);for(let n=1;n<=8;n++){const t=n/8;ctx.lineTo(e.x+(end[0]-e.x)*t+(e.kind==='lightning'&&n<8?(hash(index*311+n+Math.floor(tick/2))*2-1)*15:0),e.y+(end[1]-e.y)*t);}ctx.stroke();ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.stroke();
  }else if(e.kind==='wave'){
    ctx.lineWidth=4*(1-f)+1;ctx.beginPath();ctx.arc(e.x,e.y,r*(.2+f),Math.PI,Math.PI*2);ctx.stroke();ctx.beginPath();ctx.arc(e.x,e.y,r*(.1+f*.75),Math.PI,Math.PI*2);ctx.stroke();
  }else if(e.kind==='earth'||e.kind==='drill'||e.kind==='tunnel'){
    ctx.shadowBlur=0;for(let n=0;n<14;n++){const a=hash(index*71+n)*Math.PI*2,dist=r*f*(.4+hash(n*991+index));ctx.save();ctx.translate(e.x+Math.cos(a)*dist,e.y+Math.sin(a)*dist+f*f*27);ctx.rotate(a+f*4);ctx.fillStyle=n%3?'#af956d':c;ctx.fillRect(-2,-2,5*(1-f),5*(1-f));ctx.restore();}
    ctx.strokeStyle=c;ctx.lineWidth=2;ctx.beginPath();ctx.arc(e.x,e.y,r*(.2+f),Math.PI,Math.PI*2);ctx.stroke();
  }else if(e.kind==='mine'){
    ctx.strokeStyle=c;ctx.lineWidth=2;ctx.beginPath();ctx.arc(e.x,e.y,8+f*25,0,Math.PI*2);ctx.stroke();circle(ctx,e.x,e.y-5,5);
  }else if(e.kind==='miss'){
    ctx.shadowBlur=0;ctx.fillStyle='#abc3de';for(let n=0;n<5;n++)circle(ctx,e.x+(hash(n+index)*2-1)*20*f,e.y-f*24+hash(n*17)*8,4*(1-f));
  }else{
    const grow=1-Math.pow(1-f,4);ctx.fillStyle=c;circle(ctx,e.x,e.y,r*grow*(1-f*.6));ctx.fillStyle='#fff1bc';circle(ctx,e.x,e.y,r*grow*(1-f)*.55);ctx.strokeStyle=c;ctx.lineWidth=2;ctx.beginPath();ctx.arc(e.x,e.y,r*(.15+f*1.3),0,Math.PI*2);ctx.stroke();
    for(let n=0;n<15;n++){const a=hash(index*87+n)*Math.PI*2,dist=r*(.2+f)*(1+hash(n*99));ctx.fillStyle=n%2?c:'#ffd67a';circle(ctx,e.x+Math.cos(a)*dist,e.y+Math.sin(a)*dist+f*f*25,Math.max(.3,3*(1-f)));}
    ctx.shadowBlur=0;ctx.fillStyle='#647286';ctx.globalAlpha=(1-f)*.4;for(let n=0;n<5;n++)circle(ctx,e.x+(hash(n+index)*2-1)*r*f,e.y-12-f*38+hash(n*8)*12,6+f*r*.4);
  }ctx.restore();
}

export function drawBattle(canvas, game, {aims=[],animation=null,time=0,viewportTop=0,displayScale=1}={}) {
  const ctx=canvas.getContext('2d');if(!ctx||!game)return;ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,WIDTH,canvas.height);ctx.translate(0,-viewportTop);
  ctx.drawImage(backdrop(canvas,game.seed),0,0);
  let terrain=game.terrain,tanks=game.tanks;const shot=animation?.shot,tick=animation?.tick||0;
  if(animation?.before&&shot){const events=shot.effects||[];terrain=game.terrain.map((y,i)=>{const old=animation.before.terrain[i],x=i*WIDTH/(game.terrain.length-1);if(old===y)return y;let reveal=shot.duration-12;for(const e of events){if(Math.abs(x-e.x)<Math.max(30,e.radius||40)*1.6)reveal=Math.min(reveal,e.tick);}const f=Math.max(0,Math.min(1,(tick-reveal)/10));return old+(y-old)*f;});tanks=game.tanks.map((tank,i)=>({...tank,y:ground(terrain,tank.x)}));}
  if(animation?.move){const move=animation.move,f=Math.min(1,tick/24),x=move.from+(move.to-move.from)*(1-Math.pow(1-f,3));tanks=game.tanks.map((tank,i)=>i===move.actor?{...tank,x,y:ground(terrain,x)}:tank);}
  const earth=ctx.createLinearGradient(0,250,0,HEIGHT);earth.addColorStop(0,'#557f58');earth.addColorStop(.18,'#354d39');earth.addColorStop(.5,'#263a34');earth.addColorStop(1,'#132c2b');terrainPath(ctx,terrain);ctx.fillStyle=earth;ctx.fill();ctx.save();ctx.clip();ctx.strokeStyle='#64806325';ctx.lineWidth=2;for(let band=0;band<7;band++){ctx.beginPath();for(let x=0;x<=WIDTH;x+=10){const y=340+band*36+9*Math.sin(x/82+band);x?ctx.lineTo(x,y):ctx.moveTo(x,y);}ctx.stroke();}for(let i=0;i<130;i++){ctx.fillStyle=i%3?'#8fac6920':'#040e182b';circle(ctx,hash(i*21)*WIDTH,300+hash(i*32+game.seed)*260,1+hash(i*91)*2);}ctx.restore();
  ctx.beginPath();terrain.forEach((y,i)=>i?ctx.lineTo(i*WIDTH/(terrain.length-1),y):ctx.moveTo(0,y));ctx.lineWidth=3;ctx.strokeStyle='#8cb675';ctx.stroke();ctx.strokeStyle='#bfd29055';ctx.lineWidth=.7;ctx.stroke();
  for(const mine of game.mines||[]){ctx.fillStyle=mine.color||'#ff9f43';ctx.shadowColor=ctx.fillStyle;ctx.shadowBlur=6;ctx.beginPath();ctx.ellipse(mine.x,mine.y-2,5,3,0,Math.PI,0);ctx.fill();ctx.shadowBlur=0;ctx.fillStyle='#fff4b0';circle(ctx,mine.x,mine.y-5,1);}
  const shooting=!!animation;for(let i=0;i<tanks.length;i++){const tank=tanks[i],a=shot?.actor===i?shot.angle:(aims[i]?.angle??(i?135:45));drawTank(ctx,tank,a,!shooting&&!game.finished&&game.turn===i,time);ctx.font=`700 ${Math.min(32,12/displayScale)}px system-ui`;ctx.textAlign='center';ctx.fillStyle='#eff6ff';ctx.shadowColor='#081529';ctx.shadowBlur=4;ctx.fillText(tank.name,tank.x,tank.y+16/displayScale);ctx.shadowBlur=0;}
  if(shot){for(let i=0;i<shot.paths.length;i++)drawProjectile(ctx,shot.paths[i],tick,i,viewportTop,displayScale);for(let i=0;i<shot.effects.length;i++)drawEffect(ctx,shot.effects[i],tick,i);}
  if(animation?.move){const move=animation.move;for(let i=0;i<(move.effects||[]).length;i++)drawEffect(ctx,move.effects[i],tick,i);}
  if(!shooting&&!game.finished){const tank=tanks[game.turn],a=(aims[game.turn]?.angle??45)*Math.PI/180;ctx.strokeStyle='#dcefff44';ctx.lineWidth=1.4;ctx.setLineDash([3,5]);line(ctx,[tank.x+Math.cos(a)*30,tank.y-18-Math.sin(a)*30],[tank.x+Math.cos(a)*75,tank.y-18-Math.sin(a)*75]);ctx.setLineDash([]);}
}
