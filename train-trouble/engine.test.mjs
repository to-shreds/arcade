import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from './engine.mjs';

test('all 28 campaign jobs have witnessed simulator wins and attainable timetables',()=>{
  const kinds=new Set(),layouts=new Set();
  for(let i=0;i<28;i++){
    const level=E.createLevel(i,1),proof=E.solveLevel(level);
    assert.equal(proof.state.status,'won');assert.ok(proof.time<=level.par);assert.equal(proof.state.deliveries,level.trains.length);
    assert.deepEqual(E.validateState(level,proof.state),proof.state);layouts.add(level.map.variant);
    for(const t of level.trains)for(const task of t.tasks)kinds.add(task.type);
  }
  assert.equal(layouts.size,8);assert.deepEqual([...kinds].sort(),['couple','deliver','pickup','repair']);
  assert.equal(E.createLevel(5).trains[0].tasks[0].type,'couple');assert.equal(E.createLevel(6).trains[0].tasks[0].type,'repair');
});
test('1000 endless seeds execute real routes with no duplicate consecutive stops',()=>{
  const signatures=new Set();
  for(let i=0;i<1000;i++){
    const level=E.createLevel(i%129,(i*2654435761)>>>0,true),proof=E.solveLevel(level);
    assert.ok(proof);assert.equal(proof.state.status,'won');assert.ok(proof.time<=level.par);
    for(const t of level.trains)for(let j=1;j<t.tasks.length;j++)assert.notEqual(t.tasks[j].node,t.tasks[j-1].node);
    signatures.add(JSON.stringify([level.map.variant,level.trains.map(t=>[t.start,t.speed,t.tasks])]));
    assert.deepEqual(E.createLevel(i%129,(i*2654435761)>>>0,true),level);
  }
  assert.ok(signatures.size>950);
});
test('mid-edge and workshop saves continue to the exact same outcome',()=>{
  for(const index of [0,5,6,16,27]){
    const level=E.createLevel(index),s=E.createState(level),t=s.trains[0];
    E.routeToTask(level,s,t.id);E.sendTrain(level,s,t.id);E.step(level,s,1.35);
    const restored=E.validateState(level,JSON.parse(JSON.stringify(s)));
    for(let i=0;i<90;i++){E.step(level,s,.1);E.step(level,restored,.1);}
    assert.deepEqual(restored,s);
  }
  const l=E.createLevel(6),s=E.createState(l);E.routeToTask(l,s,'t1');E.sendTrain(l,s,'t1');
  while(s.trains[0].repair===0)E.step(l,s,.1);
  const r=E.validateState(l,s);E.step(l,s,1.25);E.step(l,r,1.25);assert.deepEqual(s,r);assert.ok(r.trains[0].repair>0);
});
test('red signals hold an arriving engine until open and explicitly sent',()=>{
  const l=E.createLevel(0),s=E.createState(l),t=s.trains[0],junction=l.map.nodes[t.node].links[0];
  E.routeToTask(l,s,t.id);E.toggleSignal(l,s,junction);E.sendTrain(l,s,t.id);
  for(let i=0;i<100&&!t.held;i++)E.step(l,s,.1);
  assert.equal(t.node,junction);assert.equal(t.edge,null);assert.equal(t.held,true);
  E.toggleSignal(l,s,junction);E.sendTrain(l,s,t.id);E.step(l,s,.1);assert.ok(t.edge);
});
test('braking slows the train and stops it at the next points',()=>{
  const l=E.createLevel(0),s=E.createState(l),t=s.trains[0],next=l.map.nodes[t.node].links[0];
  E.routeToTask(l,s,t.id);E.sendTrain(l,s,t.id);E.step(l,s,.5);const rolling=E.validateState(l,s);E.brakeTrain(s,t.id);
  E.step(l,s,1);E.step(l,rolling,1);assert.ok(t.edge.p<rolling.trains[0].edge.p);
  for(let i=0;i<150&&!t.held;i++)E.step(l,s,.1);
  assert.equal(t.node,next);assert.equal(t.held,true);assert.equal(t.edge,null);
});
function headOn(){
  const l=E.createLevel(3),s=E.createState(l);s.trains[0].node='j0';s.trains[1].node='j1';s.switches.j0='j1';s.switches.j1='j0';E.sendTrain(l,s,'t1');E.sendTrain(l,s,'t2');return {l,s};
}
test('opposing trains collide without tunneling and terminal actions preserve state',()=>{
  const {l,s}=headOn();for(let i=0;i<10&&s.status!=='crashed';i++)E.step(l,s,.25);assert.equal(s.status,'crashed');assert.equal(s.crash.kind,'head-on');
  const before=structuredClone(s);assert.equal(E.brakeTrain(s,'t1'),false);assert.equal(E.sendTrain(l,s,'t1'),false);assert.equal(E.setSwitch(l,s,'j0','j1'),false);E.step(l,s,1);assert.deepEqual(s,before);assert.deepEqual(E.validateState(l,s),s);
  const proof=E.solveLevel(l).state,done=structuredClone(proof);assert.equal(E.brakeTrain(proof,'t1'),false);E.step(l,proof,1);assert.deepEqual(proof,done);
});
test('wrong points stop safely and an intentional reverse can recover',()=>{
  const l=E.createLevel(0),s=E.createState(l),t=s.trains[0],junction=l.map.nodes[t.node].links[0],start=t.node;
  E.sendTrain(l,s,t.id);for(let i=0;i<100&&!t.held;i++)E.step(l,s,.1);assert.equal(t.node,junction);assert.equal(t.held,true);
  E.setSwitch(l,s,junction,start);assert.equal(E.sendTrain(l,s,t.id),true);E.step(l,s,.1);assert.equal(t.edge.to,start);
});
test('malformed checkpoints reject without mutating input',()=>{
  const l=E.createLevel(0),base=E.createState(l);
  const mutations=[s=>s.time=NaN,s=>s.switches.j0='missing',s=>s.trains[0].node='missing',s=>s.trains[0].edge={from:'D',to:'A',p:.5},s=>s.trains[0].task=100,s=>s.trains[0].held='yes',s=>s.status='won',s=>s.deliveries=9,s=>s.events=Array(9).fill({time:0,message:'bad'}),s=>s.trains.push(s.trains[0])];
  for(const mutate of mutations){const raw=structuredClone(base);mutate(raw);const copy=structuredClone(raw);assert.throws(()=>E.validateState(l,raw));assert.deepEqual(raw,copy);}
  for(const dt of [-1,0,Infinity,6])assert.throws(()=>E.step(l,base,dt));
});
