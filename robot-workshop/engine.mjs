export const GATES=Object.freeze({AND:{label:'Both',ports:2},OR:{label:'Either',ports:2},NOT:{label:'Opposite',ports:1},XOR:{label:'Exactly one',ports:2}});
const clone=value=>JSON.parse(JSON.stringify(value));
const expr=(gate,...args)=>[gate,...args];
const A='A',B='B',C='C',D='D';
const and=(a,b)=>expr('AND',a,b),or=(a,b)=>expr('OR',a,b),not=a=>expr('NOT',a),xor=(a,b)=>expr('XOR',a,b);
const specs=[
 ['First delivery','Wire the switch to the door. Then press Run tests.',['Power'],['Door'],[A],[],1,'delivery'],
 ['Night shift','The lamp comes on when daylight is off.',['Daylight'],['Lamp'],[not(A)],['NOT'],1,'lamp'],
 ['Two keys','The vault opens only when both keys are on.',['Blue key','Gold key'],['Vault'],[and(A,B)],['AND'],1,'vault'],
 ['Any helper','The lift runs when either helper is ready, including both.',['Ada ready','Bo ready'],['Lift'],[or(A,B)],['OR'],1,'lift'],
 ['One pilot','The rover runs with exactly one pilot. Two pilots fight over the wheel.',['Ada drives','Bo drives'],['Rover'],[xor(A,B)],['XOR'],1,'rover'],
 ['Cooling crew','The fan runs when the room is hot and its cover is shut.',['Too hot','Cover shut'],['Fan'],[and(A,B)],['AND','OR'],1,'fan'],
 ['Spare power','Either battery can power the conveyor.',['Battery A','Battery B'],['Belt'],[or(A,B)],['AND','OR'],1,'delivery'],
 ['Quiet robot','The robot sleeps when the music is off.',['Music'],['Sleep'],[not(A)],['AND','NOT'],1,'sleep'],
 ['Wrong way light','Light the warning unless both brakes work.',['Brake A','Brake B'],['Warning'],[not(and(A,B))],['AND','OR','NOT'],2,'lamp'],
 ['Empty room','The cleaner runs only when neither visitor is here.',['Visitor A','Visitor B'],['Cleaner'],[not(or(A,B))],['AND','OR','NOT'],2,'rover'],
 ['Double check','Two matching scanners open the vault. Both off also counts as matching.',['Scanner A','Scanner B'],['Vault'],[not(xor(A,B))],['XOR','NOT'],2,'vault'],
 ['Pizza route','A hungry robot gets pizza only if the hatch is not blocked.',['Hungry','Blocked'],['Pizza'],[and(A,not(B))],['AND','OR','NOT'],2,'delivery'],
 ['Backup landing','The lift runs if its key is on, or if the alarm is off.',['Key','Alarm'],['Lift'],[or(A,not(B))],['AND','OR','NOT'],2,'lift'],
 ['Three helpers','The big door needs all three helpers ready.',['Ada ready','Bo ready','Cy ready'],['Door'],[and(and(A,B),C)],['AND','OR','NOT'],2,'vault'],
 ['Rescue call','Any one of three bells should call the rescue rover.',['Bell A','Bell B','Bell C'],['Rover'],[or(or(A,B),C)],['AND','OR','XOR'],2,'rover'],
 ['Cargo check','The belt runs when both crates are loaded and the door is clear.',['Crate A','Crate B','Door clear'],['Belt'],[and(and(A,B),C)],['AND','OR','NOT'],2,'delivery'],
 ['Safe override','The door opens with both keys, or with the rescue switch.',['Key A','Key B','Rescue'],['Door'],[or(and(A,B),C)],['AND','OR','NOT'],2,'vault'],
 ['Rain patrol','Send the rover when it has power and either rain sensor is wet.',['Power','Sensor A','Sensor B'],['Rover'],[and(A,or(B,C))],['AND','OR','NOT'],2,'rover'],
 ['No stowaways','The lift runs if either caller rings and the monster is absent.',['Call A','Call B','Monster'],['Lift'],[and(or(A,B),not(C))],['AND','OR','NOT'],3,'lift'],
 ['Single seat','One pilot may launch the rover, but only with the hatch shut.',['Pilot A','Pilot B','Hatch shut'],['Rover'],[and(xor(A,B),C)],['AND','OR','NOT','XOR'],2,'rover'],
 ['Day and night','One switch runs the day lamp. Its opposite runs the night lamp.',['Daytime'],['Day lamp','Night lamp'],[A,not(A)],['NOT','AND','OR'],1,'lamp'],
 ['Traffic robot','The green light follows Go. The red light does the opposite.',['Go'],['Green','Red'],[A,not(A)],['NOT','AND','XOR'],1,'delivery'],
 ['Two departments','The vault needs both keys. The bell rings if either key is on.',['Key A','Key B'],['Vault','Bell'],[and(A,B),or(A,B)],['AND','OR','NOT'],2,'vault'],
 ['Robot twins','One rover wants matching signals. Its twin wants different signals.',['Signal A','Signal B'],['Match','Different'],[not(xor(A,B)),xor(A,B)],['AND','OR','NOT','XOR'],2,'rover'],
 ['Hot and cold','Fan: hot and powered. Heater: not hot and powered.',['Too hot','Power'],['Fan','Heater'],[and(A,B),and(not(A),B)],['AND','OR','NOT'],3,'fan'],
 ['Night delivery','The belt needs power and a request. The lamp needs power and darkness.',['Power','Request','Daylight'],['Belt','Lamp'],[and(A,B),and(A,not(C))],['AND','OR','NOT'],3,'delivery'],
 ['Containment','Open when both locks work. Sound the alarm when either lock fails.',['Lock A','Lock B'],['Door','Alarm'],[and(A,B),not(and(A,B))],['AND','OR','NOT','XOR'],2,'vault'],
 ['Choose a route','Route A: power and left. Route B: power and not left.',['Power','Left'],['Route A','Route B'],[and(A,B),and(A,not(B))],['AND','OR','NOT','XOR'],3,'delivery'],
 ['Rescue station','Rescue if either bell rings and power is on. Alarm if power is off.',['Bell A','Bell B','Power'],['Rover','Alarm'],[and(or(A,B),C),not(C)],['AND','OR','NOT','XOR'],3,'rover'],
 ['Workshop chief','Belt needs two loaded crates and power. Warning is on when either crate is missing.',['Crate A','Crate B','Power'],['Belt','Warning'],[and(and(A,B),C),not(and(A,B))],['AND','OR','NOT','XOR'],3,'delivery']
];
export function expressionValue(e,values){if(typeof e==='string')return !!values[e];const v=e.slice(1).map(a=>expressionValue(a,values));return e[0]==='NOT'?!v[0]:e[0]==='AND'?v[0]&&v[1]:e[0]==='OR'?v[0]||v[1]:v[0]!==v[1];}
export function combinations(inputs){return Array.from({length:2**inputs.length},(_,mask)=>Object.fromEntries(inputs.map((input,i)=>[input.key,!!(mask&(1<<i))])));}
function mission(spec,id){const [title,brief,inputNames,outputNames,expressions,gates,par,scene]=spec;const inputs=inputNames.map((label,i)=>({key:'ABCD'[i],label})),outputs=outputNames.map((label,i)=>({key:'O'+i,label}));return {id,title,brief,inputs,outputs,expressions,gates,par,scene,table:combinations(inputs).map(values=>({inputs:values,outputs:expressions.map(e=>expressionValue(e,values))}))};}
export const CAMPAIGN=Object.freeze(specs.map((s,i)=>mission(s,'mission-'+(i+1))));
export function createCircuit(m){return {nodes:[...m.inputs.map((n,i)=>({id:n.key,type:'INPUT',key:n.key,label:n.label,x:.09,y:(i+1)/(m.inputs.length+1)})),...m.outputs.map((n,i)=>({id:n.key,type:'OUTPUT',key:n.key,label:n.label,x:.91,y:(i+1)/(m.outputs.length+1)}))],wires:[]};}
export function validateCircuit(c,m){
 if(!c||!Array.isArray(c.nodes)||!Array.isArray(c.wires)||c.nodes.length>24||c.wires.length>48)throw Error('Circuit is too large.');
 const ids=new Set(),nodes=new Map();
 for(const n of c.nodes){if(!n||typeof n.id!=='string'||!/^([ABCD]|O[0-3]|g\d{1,5})$/.test(n.id)||ids.has(n.id)||!['INPUT','OUTPUT',...Object.keys(GATES)].includes(n.type)||!Number.isFinite(n.x)||!Number.isFinite(n.y)||n.x<.05||n.x>.95||n.y<.05||n.y>.95||(n.type in GATES&&!/^g[1-9]\d{0,4}$/.test(n.id))||(n.type==='INPUT'&&!/^[ABCD]$/.test(n.id))||(n.type==='OUTPUT'&&!/^O[0-3]$/.test(n.id))||(n.auto!==undefined&&typeof n.auto!=='boolean'))throw Error('Invalid circuit block.');ids.add(n.id);nodes.set(n.id,n);if(n.type in GATES&&m&&!m.gates.includes(n.type))throw Error('That gate is not in this mission.');}
 if(m){for(const n of [...m.inputs.map(i=>({...i,type:'INPUT'})),...m.outputs.map(i=>({...i,type:'OUTPUT'}))]){const actual=nodes.get(n.key);if(!actual||actual.type!==n.type||actual.key!==n.key||actual.label!==n.label)throw Error('Missing mission block.');}if(c.nodes.some(n=>(n.type==='INPUT'&&!m.inputs.some(a=>a.key===n.id))||(n.type==='OUTPUT'&&!m.outputs.some(a=>a.key===n.id))))throw Error('Unexpected mission block.');}
 const sockets=new Set();for(const w of c.wires){const from=nodes.get(w.from),to=nodes.get(w.to);if(!from||!to||from.type==='OUTPUT'||to.type==='INPUT'||!Number.isInteger(w.port)||w.port<0||w.port>=(to.type==='OUTPUT'?1:GATES[to.type].ports)||sockets.has(w.to+':'+w.port))throw Error('Invalid wire.');sockets.add(w.to+':'+w.port);}
 return true;
}
export function evaluate(c,inputs){
 const nodes=new Map(c.nodes.map(n=>[n.id,n])),memo=new Map(),visiting=new Set(),errors=[];
 const read=id=>{if(memo.has(id))return memo.get(id);const n=nodes.get(id);if(!n)return null;if(visiting.has(id)){errors.push('A wire loops back into itself.');return null;}if(n.type==='INPUT'){const v=!!inputs[n.key];memo.set(id,v);return v;}visiting.add(id);const values=Array.from({length:n.type==='OUTPUT'?1:GATES[n.type].ports},(_,port)=>{const w=c.wires.find(w=>w.to===id&&w.port===port);return w?read(w.from):null;});visiting.delete(id);let v=null;if(values.every(v=>v!==null))v=n.type==='OUTPUT'?values[0]:n.type==='NOT'?!values[0]:n.type==='AND'?values[0]&&values[1]:n.type==='OR'?values[0]||values[1]:values[0]!==values[1];memo.set(id,v);return v;};
 for(const n of c.nodes)read(n.id);return {values:Object.fromEntries(memo),outputs:c.nodes.filter(n=>n.type==='OUTPUT').map(n=>read(n.id)),errors:[...new Set(errors)]};
}
export function testCircuit(c,m){validateCircuit(c,m);const cases=m.table.map(row=>{const result=evaluate(c,row.inputs),actual=m.outputs.map(n=>result.values[n.key]??null);return {...row,actual,pass:!result.errors.length&&row.outputs.every((v,i)=>v===actual[i]),errors:result.errors};});return {pass:cases.every(c=>c.pass),cases,passed:cases.filter(c=>c.pass).length,total:cases.length,firstFailure:cases.find(c=>!c.pass)||null,gates:c.nodes.filter(n=>n.type in GATES).length};}
export function referenceCircuit(m){const c=createCircuit(m),memo=new Map();let next=0;function add(e,depth=0){if(typeof e==='string')return e;const key=JSON.stringify(e);if(memo.has(key))return memo.get(key);const sources=e.slice(1).map(a=>add(a,depth+1)),id='g'+(++next);c.nodes.push({id,type:e[0],x:.35+(next%2)*.23,y:.14+(Math.floor((next-1)/2)%4)*.2});sources.forEach((from,port)=>c.wires.push({from,to:id,port}));memo.set(key,id);return id;}m.expressions.forEach((e,i)=>c.wires.push({from:add(e),to:m.outputs[i].key,port:0}));return c;}
export function connect(c,from,to,port){const next=clone(c);next.wires=next.wires.filter(w=>w.to!==to||w.port!==port);next.wires.push({from,to,port});validateCircuit(next);return next;}
function rng(seed){let s=seed>>>0;return ()=>{s+=0x6D2B79F5;let t=s;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296;};}
function dependencyCount(table,inputs){return inputs.filter((input,index)=>table.some((row,mask)=>row.outputs.some((v,i)=>v!==table[mask^(1<<index)].outputs[i]))).length;}
export function generateMission(seed=1,difficulty=1){
 const tier=Math.max(1,Math.min(3,Math.floor(difficulty))),random=rng(Number(seed)||1),choose=list=>list[Math.floor(random()*list.length)],count=tier===1?2:tier===2?3:4,keys='ABCD'.slice(0,count).split('');
 for(let attempt=0;attempt<160;attempt++){
  const shuffled=keys.slice();for(let i=shuffled.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[shuffled[i],shuffled[j]]=[shuffled[j],shuffled[i]];}
  const gates=tier===1?['AND','OR','NOT']:Object.keys(GATES);let e=choose(['AND','OR','XOR']);if(tier===1&&e==='XOR')e='OR';const leaf=k=>random()<.35?not(k):k;let tree=expr(e,leaf(shuffled[0]),leaf(shuffled[1]));
  for(let i=2;i<count;i++)tree=expr(choose(['AND','OR','XOR']),tree,shuffled[i]);
  if(random()<.5)tree=not(tree);if(tier>1&&random()<.6)tree=expr(choose(['AND','OR','XOR']),tree,not(choose(keys)));
  const expressions=[tree];if(tier===3)expressions.push(random()<.5?not(tree):expr('XOR',tree,choose(keys)));
  const names=['Blue sensor','Gold sensor','Pink sensor','Green sensor'].slice(0,count),outputs=expressions.length===2?['Cargo belt','Warning lamp']:['Cargo belt'];
  const m=mission(['Order #'+String(seed>>>0).padStart(4,'0'),'Build the machine to match every row of the job card.',names,outputs,expressions,gates,0,choose(['delivery','rover','vault','fan'])],'endless-'+(seed>>>0)+'-'+tier);
  if(dependencyCount(m.table,m.inputs)!==count||m.outputs.some((o,i)=>m.table.every(row=>row.outputs[i]===m.table[0].outputs[i])))continue;
  m.par=referenceCircuit(m).nodes.filter(n=>n.type in GATES).length;m.seed=seed>>>0;m.difficulty=tier;if(testCircuit(referenceCircuit(m),m).pass)return m;
 }
 throw Error('Could not build a working job.');
}
export function workshopMission(){return {id:'workshop',title:'Free workshop',brief:'Build anything. Toggle the switches and see what your machines do.',inputs:[{key:'A',label:'Blue switch'},{key:'B',label:'Gold switch'},{key:'C',label:'Pink switch'}],outputs:[{key:'O0',label:'Cargo belt'},{key:'O1',label:'Lamp'}],gates:Object.keys(GATES),table:[],scene:'delivery',par:0};}
export function missionForState(s){if(s.mode==='workshop')return workshopMission();if(s.mode==='endless')return generateMission(s.seed,s.difficulty);return CAMPAIGN[s.level];}
export function freshState(){const m=CAMPAIGN[0];return {schema:1,mode:'campaign',level:0,seed:1,difficulty:1,completed:[],endlessWins:0,circuit:createCircuit(m),switches:{A:false},hint:0,won:false,awarded:false,selected:null,nextGate:1,started:false,menuOpen:true,jobCardOpen:false,undo:[]};}
export function validateSave(s){
 if(!s||s.schema!==1||!['campaign','endless','workshop'].includes(s.mode)||!Number.isInteger(s.level)||s.level<0||s.level>=CAMPAIGN.length||!Number.isInteger(s.seed)||s.seed<0||s.seed>4294967295||![1,2,3].includes(s.difficulty)||!Array.isArray(s.completed)||s.completed.length>30||new Set(s.completed).size!==s.completed.length||s.completed.some(n=>!Number.isInteger(n)||n<0||n>=30)||!Number.isInteger(s.endlessWins)||s.endlessWins<0||s.endlessWins>1000000||!Number.isInteger(s.nextGate)||s.nextGate<1||s.nextGate>99999||!Number.isInteger(s.hint)||s.hint<0||s.hint>3||typeof s.won!=='boolean'||typeof s.awarded!=='boolean'||!s.switches||Array.isArray(s.switches)||typeof s.switches!=='object'||Object.keys(s.switches).some(k=>!/^([ABCD])$/.test(k)||typeof s.switches[k]!=='boolean'))throw Error('This workshop save is not compatible.');
 const m=missionForState(s);validateCircuit(s.circuit,m);if(typeof s.started!=='boolean'||typeof s.menuOpen!=='boolean'||typeof s.jobCardOpen!=='boolean'||!Array.isArray(s.undo)||s.undo.length>12||(s.selected!==null&&!s.circuit.nodes.some(n=>n.id===s.selected&&n.type in GATES))||s.circuit.nodes.some(n=>n.type in GATES&&Number(n.id.slice(1))>=s.nextGate))throw Error('Invalid workshop controls.');for(const c of s.undo){validateCircuit(c,m);if(c.nodes.some(n=>n.type in GATES&&Number(n.id.slice(1))>=s.nextGate))throw Error('Invalid undo gate counter.');}if(s.won&&s.mode!=='workshop'&&!testCircuit(s.circuit,m).pass)throw Error('The saved machine does not pass its job.');return true;
}
