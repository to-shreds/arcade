import test from 'node:test';
import assert from 'node:assert/strict';
import {TROLLEY_SCENARIOS as scenes,getScenario,getCurrentScenario,getTrolleyRoute,createTrolleySession,chooseTrolley,nextTrolley,validateTrolleySession} from './trolley.mjs';

test('36 distinct readable scenarios disclose their facts and offer real choices without a moral score',()=>{
 assert.equal(scenes.length,36);assert.equal(new Set(scenes.map(s=>s.id)).size,36);assert.equal(new Set(scenes.map(s=>s.family)).size,9);
 for(const s of scenes){
  assert(s.title.length>3&&s.story.length>30);assert(s.facts.length>=3);assert(s.routes.every(r=>r.description.length>4));
  assert(s.options.length>=2);assert.equal(new Set(s.options.map(o=>o.id)).size,s.options.length);
  for(const o of s.options){assert(o.label&&o.outcome&&o.summary);assert(!Object.hasOwn(o,'score'));if(o.risk){assert(o.risk.chance>0&&o.risk.chance<1);assert(s.facts.join(' ').includes(String(o.risk.chance*100)+'%'));assert(o.risk.success&&o.risk.failure);}}
  assert(!/off-screen|why did you|correct answer|wrong answer|good person/i.test(JSON.stringify(s)));
 }
 assert(scenes.some(s=>/die\b|dies\b/.test(s.options.map(o=>o.outcome).join(' '))));
 assert(scenes.some(s=>s.family==='mischief'));
});

test('seeded order intersperses related factor variants and every shown decision can be restored exactly',()=>{
 let decisions=0;
 for(let seed=0;seed<48;seed++){
  let session=createTrolleySession(seed);
  assert.deepEqual(createTrolleySession(seed),session);assert.equal(new Set(session.order).size,36);assert.equal(getTrolleyRoute(session),'waiting');
  for(let i=1;i<session.order.length;i++)assert.notEqual(getScenario(session.order[i-1]).family,getScenario(session.order[i]).family);
  for(let i=0;i<36;i++){
   const scenario=getCurrentScenario(session),before=structuredClone(session);
   for(const opt of scenario.options){
    const chosen=chooseTrolley(session,opt.id);assert.deepEqual(session,before,'decisions cannot mutate the prior save');assert.equal(chosen.history.length,i+1);assert.equal(chosen.phase,'outcome');
    const result=chosen.history.at(-1);assert.equal(getTrolleyRoute(chosen),opt.id==='draw'?(result.riskRoll<result.chance?'main':'side'):opt.id==='brake'?(result.riskRoll<result.chance?'stopped':'main'):opt.id==='side'?'side':'main');assert.equal(chosen.history.at(-1).optionId,opt.id);assert.deepEqual(chooseTrolley(session,opt.id),chosen,'the saved decision cannot reroll a risk');
    assert.deepEqual(validateTrolleySession(JSON.parse(JSON.stringify(chosen))),chosen);
    const reordered=structuredClone(chosen);reordered.history[i]=Object.fromEntries(Object.entries(reordered.history[i]).reverse());assert.deepEqual(validateTrolleySession(reordered).history[i],reordered.history[i]);
    const corrupted=structuredClone(chosen);corrupted.history[i].outcome='Everybody wins, secretly';assert.throws(()=>validateTrolleySession(corrupted));
    assert.throws(()=>chooseTrolley(chosen,opt.id),'a finished decision cannot be changed accidentally');decisions++;
   }
   session=nextTrolley(chooseTrolley(session,scenario.options[seed%scenario.options.length].id));
  }
  assert.equal(session.phase,'complete');assert.equal(getTrolleyRoute(session),'waiting');assert.equal(session.index,35);assert.equal(session.history.length,36);assert.throws(()=>nextTrolley(session));assert.deepEqual(validateTrolleySession(session),session);
 }
 console.log(decisions+' complete decision/restore branches verified.');
});

test('risk draws preserve both possible disclosed outcomes and never use a new random value after reload',()=>{
 const observed=new Map();
 for(let seed=0;seed<80;seed++){
  let session=createTrolleySession(seed);
  for(let i=0;i<36;i++){
   const s=getCurrentScenario(session);
   for(const o of s.options.filter(o=>o.risk)){
    const result=chooseTrolley(session,o.id).history.at(-1),key=s.id+':'+o.id;
    assert.equal(result.outcome,result.riskRoll<o.risk.chance?o.risk.success:o.risk.failure);
    assert(result.riskRoll>=0&&result.riskRoll<1);
    const set=observed.get(key)||new Set();set.add(result.outcome);observed.set(key,set);
   }
   session=nextTrolley(chooseTrolley(session,s.options[0].id));
  }
 }
 for(const results of observed.values())assert.equal(results.size,2,'each chance has observable success and failure across seeds');
});

test('invalid and stale progress is rejected without altering the original state',()=>{
 const original=createTrolleySession(12);
 for(const bad of [null,{}, {...original,index:-1},{...original,seed:-1},{...original,seed:2**32},{...original,order:[...original.order].reverse()},{...original,phase:'complete'},{...original,history:[{}]},{...original,timed:'yes'}])assert.throws(()=>validateTrolleySession(bad));
 assert.throws(()=>chooseTrolley(original,'hidden-route'));assert.throws(()=>nextTrolley(original));assert.deepEqual(original,createTrolleySession(12));
 const timed=structuredClone(original);timed.timed=true;assert.equal(chooseTrolley(timed,getCurrentScenario(timed).options[0].id).timed,true);
});
