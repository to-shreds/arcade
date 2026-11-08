// Deterministic railway simulation. Coordinates and speed use map units/seconds.
export const SCHEMA = 1;
export const COLORS = ['#ffcf47','#42d8ff','#ff83bd','#8bea8a','#c6a0ff','#ff9f53'];
const STATIONS = ['A','B','C','D','E','F','G','H'];
const clone = value => JSON.parse(JSON.stringify(value));
export function rng(seed) { let a=seed>>>0; return ()=>{a+=0x6d2b79f5;let t=a;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return ((t^t>>>14)>>>0)/4294967296;}; }
const int=(r,n)=>Math.floor(r()*n);
const shuffle=(a,r)=>a.slice().sort(()=>0).map(v=>[r(),v]).sort((a,b)=>a[0]-b[0]).map(v=>v[1]);
const edgeKey=(a,b)=>[a,b].sort().join(':');
export function makeMap(variant=0) {
  const nodes={};
  for(let y=0;y<3;y++)for(let x=0;x<3;x++)nodes[`j${y*3+x}`]={id:`j${y*3+x}`,x:25+x*25,y:25+y*25,label:String(y*3+x+1),kind:'junction'};
  const spots=[[5,25,'j0'],[50,5,'j1'],[95,25,'j2'],[95,50,'j5'],[95,75,'j8'],[50,95,'j7'],[5,75,'j6'],[5,50,'j3']];
  const edges=[];
  spots.forEach(([x,y,to],i)=>{let id=STATIONS[i];nodes[id]={id,x,y,label:id,kind:'station'};edges.push([id,to]);});
  const ring=[['j0','j1'],['j1','j2'],['j2','j5'],['j5','j8'],['j8','j7'],['j7','j6'],['j6','j3'],['j3','j0']];
  edges.push(...ring);
  // The outside loop always connects the yard; the center changes the puzzle.
  const spokes=[['j1','j4'],['j3','j4'],['j4','j5'],['j4','j7']];
  const patterns=[[0,1,2,3],[0,1],[1,3],[0,2,3],[0,1,3],[1,2,3],[0,2],[2,3]];
  edges.push(...patterns[variant%patterns.length].map(i=>spokes[i]));
  for(const n of Object.values(nodes))n.links=[];
  for(const [a,b] of edges){nodes[a].links.push(b);nodes[b].links.push(a);}
  return {variant:variant%8,nodes,edges};
}
const jobNames=['First whistle','Parcel post','The other way round','Two little engines','The long loop','Wagon wanted','Repair run','Morning mail','Three-track tango','The sleepy siding','Rescue the caboose','Center detour','Fresh fruit run','Workshop service','Station shuffle','Express delivery','Last wagon home','The workshop stop','Round the houses','Midday mix-up','Rescue relay','Festival freight','Points and parcels','Night mail','The grand loop','Three engines, one yard','Logan runs the railway','Master dispatcher'];
export function createLevel(index=0, seed=1, endless=false) {
  index=Math.max(0,Math.trunc(index));seed=seed>>>0;
  const r=rng(seed+Math.imul(index+1,2654435761));
  const variant=endless?int(r,8):[0,0,1,0,2,0,3,1,4,2,5,6,3,7,1,4,2,5,6,3,7,1,4,5,2,6,7,0][index%28];
  const count=endless?2+int(r,2):index<3?1:index<8?2:3;
  const stations=shuffle(STATIONS,r),starts=stations.slice(0,count), destinations=stations.slice(count);
  const kinds=['mail','fruit','toys','books','rescue','repair'];
  const trains=starts.map((start,i)=>{
    const kind=!endless&&i===0&&[5,10,16,20].includes(index)?'rescue':!endless&&i===0&&[6,13,17].includes(index)?'repair':!endless&&i===0&&[12,15].includes(index)?'fruit':!endless&&i===0&&index===23?'mail':index<5?'mail':kinds[(index+i+(endless?int(r,6):0))%kinds.length];
    const destination=destinations[i%destinations.length];
    const stop=destinations[(i+1)%destinations.length];
    const tasks=[];
    if(kind==='rescue'||(index>=5&&index%5===0&&i===0&&kind!=='repair'))tasks.push({node:stop,type:'couple',label:'Collect stranded wagon'});
    if(kind==='repair')tasks.push({node:stop,type:'repair',label:'Repair at workshop'});
    if(index>=12&&!tasks.length&&i===0)tasks.push({node:stop,type:'pickup',label:'Collect extra cargo'});
    tasks.push({node:destination,type:'deliver',label:`Deliver ${kind==='rescue'?'rescued wagon':kind==='repair'?'repaired engine':kind}`});
    return {id:`t${i+1}`,name:['Pip','Rocket','Marmalade'][i],start,color:COLORS[i],cargo:kind,tasks,speed:index<3?6:kind==='fruit'?9:kind==='rescue'?5:7+(i%2),brake:kind==='rescue'?1.2:.65};
  });
  const level={id:endless?`endless-${seed}-${index}`:`job-${index+1}`,index,seed,endless,title:endless?`Fresh tracks ${index+1}`:jobNames[index%28],map:makeMap(variant),trains,tip:index===0?'Pip needs station '+trains[0].tasks.at(-1).node+'. Tap a junction to point the arrow, then Send Pip.':index===3?'Send both engines when their routes are clear. Brake asks an engine to stop at its next junction.':trains.some(t=>t.tasks[0].type==='couple')?'A stranded wagon is waiting. Collect it, then bring it home.':trains.some(t=>t.tasks[0].type==='repair')?'Visit the wrench station first. Repairs take three seconds.':'Plan the routes, watch the signals, and keep the engines apart.'};
  const certificate=solveLevel(level);
  if(!certificate)throw new Error('Generated railway has no verified route.');
  level.par=Math.ceil(certificate.time*1.15+8);
  return level;
}
export const CAMPAIGN=Array.from({length:28},(_,i)=>({index:i,title:jobNames[i]}));
export function createState(level) {
  const switches={},signals={};
  for(const n of Object.values(level.map.nodes)){switches[n.id]=n.links[0];signals[n.id]=false;}
  return {schema:SCHEMA,levelId:level.id,time:0,status:'ready',switches,signals,trains:level.trains.map(t=>({id:t.id,node:t.start,previous:null,edge:null,held:true,braking:false,task:0,coupled:false,repair:0,done:false})),deliveries:0,hints:0,crash:null,events:[],moves:0};
}
export function shortestPath(map,start,end,blocked=[]) {
  if(!map.nodes[start]||!map.nodes[end])return null;
  const queue=[[start]],seen=new Set([start]),deny=new Set(blocked.filter(x=>x!==start));
  while(queue.length){const path=queue.shift(),at=path.at(-1);if(at===end)return path;for(const next of map.nodes[at].links)if(!seen.has(next)&&!deny.has(next)){seen.add(next);queue.push([...path,next]);}}
  return null;
}
export function position(level,t) {
  if(!t.edge)return {x:level.map.nodes[t.node].x,y:level.map.nodes[t.node].y};
  const a=level.map.nodes[t.edge.from],b=level.map.nodes[t.edge.to];
  return {x:a.x+(b.x-a.x)*t.edge.p,y:a.y+(b.y-a.y)*t.edge.p};
}
function event(s,message){s.events.push({time:Math.round(s.time*10)/10,message});s.events=s.events.slice(-8);}
export function setSwitch(level,s,node,to){if(!level.map.nodes[node]?.links.includes(to)||s.status==='crashed'||s.status==='won')return false;s.switches[node]=to;s.moves++;return true;}
export function toggleSignal(level,s,node){if(level.map.nodes[node]?.kind!=='junction'||['crashed','won'].includes(s.status))return false;s.signals[node]=!s.signals[node];s.moves++;return true;}
export function sendTrain(level,s,id){const t=s.trains.find(t=>t.id===id);if(!t||t.done||t.repair>0||['crashed','won'].includes(s.status))return false;if(t.held&&!t.edge)t.previous=null;t.held=false;t.braking=false;s.status='running';s.moves++;event(s,`${level.trains.find(x=>x.id===id).name} is on the move.`);return true;}
export function brakeTrain(s,id){const t=s.trains.find(t=>t.id===id);if(!t||t.done||['crashed','won'].includes(s.status))return false;t.braking=true;if(!t.edge)t.held=true;s.moves++;return true;}
export function routeToTask(level,s,id,{countHint=true}={}) {
  const t=s.trains.find(t=>t.id===id),spec=level.trains.find(t=>t.id===id);if(!t||t.done||t.edge||['won','crashed'].includes(s.status))return null;
  const path=shortestPath(level.map,t.node,spec.tasks[t.task].node,s.trains.filter(o=>o.id!==id&&!o.done&&!o.edge).map(o=>o.node));if(!path)return null;
  for(let i=0;i<path.length-1;i++){s.switches[path[i]]=path[i+1];s.signals[path[i]]=false;}
  if(countHint)s.hints++;
  return path;
}
export function previewRoute(level,s,id) {
  const t=s.trains.find(t=>t.id===id);if(!t||t.done)return [];
  const path=t.edge?[t.edge.from,t.edge.to]:[t.node];let previous=t.edge?.from||t.previous;
  for(let i=0;i<24;i++){const at=path.at(-1),node=level.map.nodes[at];if(path.length>1&&(node.kind==='station'||s.signals[at]))break;const next=s.switches[at];if(!node.links.includes(next)||(node.links.length>1&&next===previous)||path.includes(next))break;path.push(next);previous=at;}
  return path;
}
function arrive(level,s,t) {
  const spec=level.trains.find(x=>x.id===t.id),task=spec.tasks[t.task];
  if(task&&t.node===task.node){
    t.task++;t.held=true;t.braking=false;
    if(task.type==='couple'){t.coupled=true;event(s,`${spec.name} coupled the stranded wagon.`);}
    else if(task.type==='repair'){t.repair=3;event(s,`${spec.name} is in the workshop.`);}
    else if(task.type==='pickup')event(s,`${spec.name} collected the extra cargo.`);
    else {t.done=true;s.deliveries++;event(s,`${spec.name}: delivery complete!`);}
  }
  if(!t.done&&(t.braking||s.signals[t.node]||level.map.nodes[t.node].kind==='station')){t.held=true;t.braking=false;}
  if(s.trains.every(t=>t.done)){s.status='won';event(s,'Every engine home. Nice dispatching!');}
}
export function step(level,s,dt) {
  if(!Number.isFinite(dt)||dt<=0||dt>5)throw new Error('Invalid railway timestep.');
  if(s.status!=='running')return s;
  const slices=Math.ceil(dt/.025),d=dt/slices;
  for(let k=0;k<slices&&s.status==='running';k++){
    s.time+=d;
    for(const t of s.trains){
      if(t.done)continue;
      if(t.repair>0){t.repair=Math.max(0,t.repair-d);if(!t.repair)event(s,`${level.trains.find(x=>x.id===t.id).name} is repaired and ready.`);continue;}
      if(t.held)continue;
      const spec=level.trains.find(x=>x.id===t.id);
      if(!t.edge){
        if(s.signals[t.node]){t.held=true;continue;}
        const links=level.map.nodes[t.node].links,to=links.length===1?links[0]:s.switches[t.node];
        if(!links.includes(to)||(links.length>1&&to===t.previous)){t.held=true;event(s,`${spec.name} stopped: turn the points ahead.`);continue;}
        t.edge={from:t.node,to,p:0};
      }
      const a=level.map.nodes[t.edge.from],b=level.map.nodes[t.edge.to],length=Math.hypot(a.x-b.x,a.y-b.y);
      const brakeScale=t.braking?Math.max(.3,1-t.edge.p*(.8/spec.brake)):1;
      t.edge.p+=spec.speed*(t.coupled?.78:1)*brakeScale*d/length;
      if(t.edge.p>=1){t.previous=t.edge.from;t.node=t.edge.to;t.edge=null;arrive(level,s,t);}
    }
    for(let i=0;i<s.trains.length;i++)for(let j=i+1;j<s.trains.length;j++){
      const a=s.trains[i],b=s.trains[j];if(a.done||b.done)continue;
      const p=position(level,a),q=position(level,b);
      if(Math.hypot(p.x-q.x,p.y-q.y)<3.6){
        const head=a.edge&&b.edge&&a.edge.from===b.edge.to&&a.edge.to===b.edge.from;
        s.status='crashed';s.crash={kind:head?'head-on':a.coupled||b.coupled?'cargo':'rear-end',trains:[a.id,b.id],x:(p.x+q.x)/2,y:(p.y+q.y)/2,time:s.time};event(s,'WHUMP! Everyone is safe. The trains need a little work.');
      }
    }
  }
  return s;
}
// A constructive scheduler runs every route in the real simulator. Sequential
// departures are the safety certificate; players can beat par with parallel runs.
export function solveLevel(level) {
  const state=createState(level),actions=[];let budget=18000;
  for(const spec of level.trains){
    const t=state.trains.find(t=>t.id===spec.id);
    while(!t.done&&budget>0){
      if(t.repair){step(level,state,.25);budget--;continue;}
      const path=routeToTask(level,state,t.id,{countHint:false});if(!path)return null;
      actions.push({id:t.id,path:path.slice()});sendTrain(level,state,t.id);
      while(!t.held&&!t.done&&state.status==='running'&&budget--){step(level,state,.25);}
      if(state.status==='crashed')return null;
    }
    if(!t.done)return null;
  }
  return state.status==='won'?{actions,time:state.time,state}:null;
}
export function validateState(level,raw) {
  if(!raw||raw.schema!==SCHEMA||raw.levelId!==level.id||!['ready','running','won','crashed'].includes(raw.status)||!Number.isFinite(raw.time)||raw.time<0||raw.time>86400||!Array.isArray(raw.trains)||raw.trains.length!==level.trains.length)throw new Error('This railway save is damaged.');
  const s=clone(raw);
  for(const n of Object.values(level.map.nodes))if(!n.links.includes(s.switches?.[n.id])||typeof s.signals?.[n.id]!=='boolean')throw new Error('Invalid railway points.');
  const ids=new Set();
  for(const t of s.trains){
    const spec=level.trains.find(x=>x.id===t.id);if(!spec||ids.has(t.id)||!level.map.nodes[t.node]||!(t.previous===null||level.map.nodes[t.previous])||!Number.isInteger(t.task)||t.task<0||t.task>spec.tasks.length||!Number.isFinite(t.repair)||t.repair<0||t.repair>3||['held','braking','coupled','done'].some(k=>typeof t[k]!=='boolean'))throw new Error('Invalid railway engine.');ids.add(t.id);
    if(t.edge&&(!level.map.nodes[t.edge.from]?.links.includes(t.edge.to)||t.edge.from!==t.node||!Number.isFinite(t.edge.p)||t.edge.p<0||t.edge.p>=1))throw new Error('Invalid railway position.');
    if(t.done!==(t.task===spec.tasks.length))throw new Error('Invalid railway delivery.');
  }
  for(const key of ['hints','moves','deliveries'])if(!Number.isInteger(s[key])||s[key]<0||s[key]>1000000)throw new Error('Invalid railway progress.');
  if(s.deliveries!==s.trains.filter(t=>t.done).length||(s.status==='won')!==s.trains.every(t=>t.done))throw new Error('Invalid railway outcome.');
  if(s.status==='crashed'&&(!s.crash||!['head-on','rear-end','cargo'].includes(s.crash.kind)||!Number.isFinite(s.crash.time)||!Number.isFinite(s.crash.x)||!Number.isFinite(s.crash.y)||!Array.isArray(s.crash.trains)||s.crash.trains.some(id=>!ids.has(id))))throw new Error('Invalid railway accident.');
  if(!Array.isArray(s.events)||s.events.length>8||s.events.some(e=>!Number.isFinite(e.time)||typeof e.message!=='string'||e.message.length>200))throw new Error('Invalid railway log.');
  return s;
}
export function score(level,state){return state.status==='won'?1+(state.hints===0?1:0)+(state.time<=level.par?1:0):0;}
