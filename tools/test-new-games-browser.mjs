#!/usr/bin/env node
// Independent native-input and actual Worker checks for the new activities.
// The fixture uses ephemeral ports so it can coexist with the older suites.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdir,readdir,writeFile,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {chromium,browserLaunchOptions} from './browser-runtime.mjs';
import {startStaticFixture} from './static-fixture.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const output=resolve(root,'test-results/new-games');
const args=process.argv.slice(2);
if(args.includes('--serve')){
  const {Miniflare}=await import('../cloudflare/chess-worker/node_modules/miniflare/dist/src/index.js');
  const site=await startStaticFixture();
  const models=(await readdir(resolve(root,'multiplayer/models'))).filter(name=>name.endsWith('.js')&&!name.endsWith('.test.js')).map(name=>'multiplayer/models/'+name);
  const mf=new Miniflare({
    modulesRoot:root,
    modules:['cloudflare/chess-worker/src/index.js',...models,'upwords/engine.js','upwords/dictionary.js','tanks/engine.js','tanks/weapons.js','tanks/terrain-rules.js'].map(path=>({type:'ESModule',path:resolve(root,path)})),
    compatibilityDate:'2026-08-06',compatibilityFlags:['nodejs_compat'],port:0,host:'127.0.0.1',
    bindings:{ALLOWED_ORIGINS:site.base},
    durableObjects:{CHESS_ROOMS:{className:'ChessRoom',useSQLite:true},ARCADE_ROOMS:{className:'ArcadeRoom',useSQLite:true}}
  });
  console.log('NEW_GAMES_FIXTURE '+JSON.stringify({base:site.base,api:String(await mf.ready).replace(/\/$/,'')}));
  let closing=false;
  const close=async()=>{if(closing)return;closing=true;await Promise.allSettled([site.close(),mf.dispose()]);process.exit(0);};
  process.on('SIGTERM',close);process.on('SIGINT',close);
  await new Promise(()=>{});
}

let fixture,browser,base,api,fixtureLog='';
const results=[],errors=[],failures=[];
const localOnly=args.includes('--local-only'),roomsOnly=args.includes('--rooms-only');
const filter=args.find(value=>value.startsWith('--case='))?.slice(7).toLowerCase();
const contexts=new Set();
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const capture=page=>page.evaluate(()=>ArcadeSave.getAdapter().capture());
async function until(page,predicate,label,timeout=15000){const deadline=Date.now()+timeout;while(Date.now()<deadline){if(await page.evaluate(predicate))return;await delay(75);}throw Error(label+'; snapshot '+JSON.stringify(await capture(page))+'; room '+JSON.stringify(await page.evaluate(()=>({status:ArcadeSharedActivity.getState().statusText,connected:ArcadeSharedActivity.getState().connected,controller:ArcadeSharedActivity.isController(),spectator:ArcadeSharedActivity.isSpectator()}))));}

async function fixtureStart(){
  fixture=spawn(process.execPath,[fileURLToPath(import.meta.url),'--serve'],{cwd:root,stdio:['ignore','pipe','pipe']});
  return new Promise((accept,reject)=>{
    const timer=setTimeout(()=>reject(Error('New-game fixture did not start: '+fixtureLog)),35000);
    const collect=data=>{fixtureLog+=data;const match=fixtureLog.match(/NEW_GAMES_FIXTURE (\{[^\n]+\})/);if(match){clearTimeout(timer);accept(JSON.parse(match[1]));}};
    fixture.stdout.on('data',collect);fixture.stderr.on('data',data=>fixtureLog+=data);
    fixture.on('exit',code=>{clearTimeout(timer);reject(Error('New-game fixture exited '+code+': '+fixtureLog));});
  });
}
async function pageFor(game,viewport={width:1280,height:800}){
  const context=await browser.newContext({viewport,hasTouch:true});contexts.add(context);
  await context.addInitScript(({api})=>{window.ARCADE_WORKER_BASE=api;},{api});
  const page=await context.newPage();page.setDefaultTimeout(15000);
  page.on('pageerror',error=>errors.push({game,viewport,message:error.message}));
  await page.goto(base+'/'+game+'/');
  await page.waitForFunction(()=>!!window.ArcadeSave?.getAdapter?.());
  return {page,context};
}
async function equalState(page,expected,label){
  const deadline=Date.now()+16000;while(Date.now()<deadline){if(isDeepStrictEqual(await capture(page),expected))return;await delay(75);}
  assert.deepEqual(await capture(page),expected,label);
}
async function inViewport(page,selectors){
  const geometry=await page.evaluate(selectors=>({width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,controls:selectors.map(selector=>{
    const el=document.querySelector(selector);if(!el)return {selector,missing:true};const r=el.getBoundingClientRect();return {selector,left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};
  })}),selectors);
  assert(geometry.scrollWidth<=geometry.width+1,'No horizontal page overflow: '+JSON.stringify(geometry));
  for(const control of geometry.controls){assert(!control.missing,'Missing '+control.selector);assert(control.width>0&&control.height>0,'Hidden '+control.selector);assert(control.left>=-1&&control.right<=geometry.width+1&&control.top>=-1&&control.bottom<=geometry.height+1,'Control outside viewport: '+JSON.stringify(control));}
  return geometry;
}
async function run(name,callback){
  if(filter&&!name.toLowerCase().includes(filter))return;
  const began=Date.now();
  try{const evidence=await callback();results.push({name,passed:true,elapsedMs:Date.now()-began,evidence});console.log('PASS '+name);}
  catch(error){if(error.code==='TEST_ENVIRONMENT_BLOCKED'&&process.env.ARCADE_REQUIRE_H264!=='1'){results.push({name,passed:null,blocked:true,elapsedMs:Date.now()-began,reason:error.message});console.log('BLOCKED '+name+': '+error.message);}else{failures.push(name+': '+error.message);results.push({name,passed:false,elapsedMs:Date.now()-began,error:error.stack});console.error('FAIL '+name+': '+error.message);}}
  finally{await Promise.all([...contexts].map(context=>context.close()));contexts.clear();await writeFile(resolve(output,'report'+(localOnly?'-local':roomsOnly?'-rooms':'')+'.json'),JSON.stringify({results,errors,failures},null,2)+'\n');}
}
async function connect(host,guest){
  const created=await host.evaluate(()=>ArcadeSharedActivity.create({username:'Dispatcher'}));
  const joined=await guest.evaluate(code=>ArcadeSharedActivity.join({username:'Engineer',code}),created.code);
  // Spectators freeze page RAF and timers. Poll from Node so a not-yet-applied
  // checkpoint cannot also freeze the browser test's readiness check.
  await until(host,()=>ArcadeSharedActivity.getState().connected&&!ArcadeSharedActivity.isSpectator(),'Host connects with controller authority');
  await until(guest,()=>ArcadeSharedActivity.getState().connected&&ArcadeSharedActivity.getState().appliedSequence>=0,'Guest connects and applies its first checkpoint');
  return joined;
}

// Activity-specific cases are kept below the common fixture helpers so the
// assertions exercise public controls and normal save adapters consistently.
try{
  await mkdir(output,{recursive:true});
  ({base,api}=await fixtureStart());
  browser=await chromium.launch(browserLaunchOptions);
  if(!roomsOnly)await run('Trolley: every disclosed choice, deterministic risk and exact history validation',async()=>{
    const {TROLLEY_SCENARIOS,createTrolleySession,getCurrentScenario,chooseTrolley,nextTrolley,validateTrolleySession}=await import('../train-trouble/trolley.mjs');
    assert(TROLLEY_SCENARIOS.length>=30,'At least thirty distinct situations');
    assert.equal(new Set(TROLLEY_SCENARIOS.map(scene=>scene.id)).size,TROLLEY_SCENARIOS.length);
    let decisions=0,riskChoices=0;
    for(let seed=0;seed<24;seed++){
      let session=createTrolleySession(seed);assert.throws(()=>nextTrolley(session));
      assert.equal(new Set(session.order).size,TROLLEY_SCENARIOS.length);
      assert.equal(session.order.length,TROLLEY_SCENARIOS.length);
      let previousFamily;
      for(let index=0;index<TROLLEY_SCENARIOS.length;index++){
        const scene=getCurrentScenario(session);assert(scene.story&&scene.facts.length>=2&&scene.options.length>=2);
        assert.notEqual(scene.family,previousFamily,'Related factor variants are interspersed');previousFamily=scene.family;
        const before=structuredClone(session);
        for(const option of scene.options){
          assert(!/why|explain your|good person|correct answer/i.test(option.label),'Choices are actions, without a follow-up questionnaire');
          const chosen=chooseTrolley(session,option.id);decisions++;
          assert.deepEqual(session,before,'Choosing does not mutate an older saved checkpoint');
          assert.equal(chosen.phase,'outcome');assert.equal(chosen.history.length,index+1);
          assert.deepEqual(chosen,chooseTrolley(session,option.id),'A risk is drawn once deterministically, including after reload');
          assert.deepEqual(validateTrolleySession(JSON.parse(JSON.stringify(chosen))),chosen,'Exact decision history round-trips');
          assert.throws(()=>chooseTrolley(chosen,option.id),'A completed decision cannot be submitted twice');
          const result=chosen.history.at(-1);assert.equal(result.optionId,option.id);assert.equal(result.scenarioId,scene.id);
          if(option.risk){riskChoices++;assert(option.risk.chance>0&&option.risk.chance<1);assert([option.risk.success,option.risk.failure].includes(result.outcome));assert.equal(result.outcome,result.riskRoll<option.risk.chance?option.risk.success:option.risk.failure);}
          else assert.equal(result.outcome,option.outcome);
          const damaged=structuredClone(chosen);damaged.history.at(-1).outcome='A different result';assert.throws(()=>validateTrolleySession(damaged),'Consequences cannot change during a saved-room restore');
          assert(!Object.keys(chosen).some(key=>/score|morality|correct/i.test(key)),'No moral score is stored');
        }
        session=nextTrolley(chooseTrolley(session,scene.options[(seed+index)%scene.options.length].id));
      }
      assert.equal(session.phase,'complete');assert.equal(session.history.length,TROLLEY_SCENARIOS.length);assert.throws(()=>nextTrolley(session));
    }
    return {scenarios:TROLLEY_SCENARIOS.length,seeds:24,decisions,riskChoices};
  });
  if(!roomsOnly)await run('Robot models: exhaustive truth tables, alternate answers, fan-out and generated jobs',async()=>{
    const E=await import('../robot-workshop/engine.mjs');
    assert.equal(E.CAMPAIGN.length,30);
    let combinations=0,generated=0;
    for(const [type,expected] of Object.entries({AND:[false,false,false,true],OR:[false,true,true,true],XOR:[false,true,true,false],NOT:[true,false]})){
      const circuit={nodes:[{id:'A',type:'INPUT',key:'A'},{id:'B',type:'INPUT',key:'B'},{id:'g1',type},{id:'O0',type:'OUTPUT'}],wires:[{from:'A',to:'g1',port:0},...(type==='NOT'?[]:[{from:'B',to:'g1',port:1}]),{from:'g1',to:'O0',port:0}]};
      for(let row=0;row<expected.length;row++)assert.equal(E.evaluate(circuit,{A:!!(row&1),B:!!(row&2)}).values.O0,expected[row],type+' has its standard truth table');
    }
    for(const mission of E.CAMPAIGN){
      const answer=E.referenceCircuit(mission),test=E.testCircuit(answer,mission);
      assert.equal(test.pass,true,mission.id+' has a complete working solution');
      assert.equal(test.total,2**mission.inputs.length,'Every switch combination is tested');combinations+=test.total;
      assert.equal(E.testCircuit(E.createCircuit(mission),mission).pass,false,'Empty boards never win');
      const reordered={...answer,nodes:answer.nodes.slice().reverse()};assert.equal(E.testCircuit(reordered,mission).pass,true,'Node order does not change an electrically identical circuit');
      const broken=structuredClone(answer);broken.wires=broken.wires.filter(w=>w.to!==mission.outputs[0].key);assert.equal(E.testCircuit(broken,mission).pass,false,'A dangling required output never wins');
    }
    // De Morgan: the warning is NOT(A AND B), but OR(NOT A, NOT B) is equally valid.
    const warning=E.CAMPAIGN[8],alternate=E.createCircuit(warning);
    alternate.nodes.push({id:'g1',type:'NOT',x:.3,y:.3},{id:'g2',type:'NOT',x:.3,y:.7},{id:'g3',type:'OR',x:.65,y:.5});
    alternate.wires.push({from:'A',to:'g1',port:0},{from:'B',to:'g2',port:0},{from:'g1',to:'g3',port:0},{from:'g2',to:'g3',port:1},{from:'g3',to:'O0',port:0});
    assert.equal(E.testCircuit(alternate,warning).pass,true,'An alternate three-gate answer wins without matching the reference layout');
    const containment=E.CAMPAIGN[26],branch=E.referenceCircuit(containment);
    assert(branch.wires.some(w=>branch.wires.filter(other=>other.from===w.from).length>1),'A reference mission branches one signal into multiple destinations');
    assert.equal(E.testCircuit(branch,containment).pass,true);
    for(let difficulty=1;difficulty<=3;difficulty++)for(let seed=0;seed<160;seed++){
      const mission=E.generateMission(seed,difficulty),again=E.generateMission(seed,difficulty);assert.deepEqual(mission,again,'Seeded jobs regenerate exactly');
      assert.equal(E.testCircuit(E.referenceCircuit(mission),mission).pass,true);assert.equal(mission.table.length,2**mission.inputs.length);generated++;
      for(let bit=0;bit<mission.inputs.length;bit++)assert(mission.table.some((row,index)=>row.outputs.some((value,output)=>value!==mission.table[index^(1<<bit)].outputs[output])),'Every displayed input affects an output');
      for(let output=0;output<mission.outputs.length;output++)assert(mission.table.some(row=>row.outputs[output]!==mission.table[0].outputs[output]),'Generated output is not constant');
    }
    const loop=structuredClone(alternate);loop.wires=loop.wires.filter(w=>w.to!=='g1');loop.wires.push({from:'g3',to:'g1',port:0});assert.equal(E.testCircuit(loop,warning).pass,false,'A signal cycle cannot win');
    return {missions:30,campaignTruthCombinations:combinations,generatedJobs:generated,alternateSolutions:true,branching:true};
  });
  if(!roomsOnly)await run('Train models: independent schedules, collisions and exact mid-route snapshots',async()=>{
    const E=await import('../train-trouble/engine.mjs');
    let campaign=0,endless=0,movingSnapshots=0;const taskKinds=new Set();
    function path(map,from,to,blocked){
      const queue=[[from]],visited=new Set([from]);while(queue.length){const route=queue.shift(),at=route.at(-1);if(at===to)return route;for(const next of map.nodes[at].links)if(!visited.has(next)&&!blocked.has(next)){visited.add(next);queue.push([...route,next]);}}return null;
    }
    function independentlyDispatch(level){
      const s=E.createState(level);let budget=40000;
      for(const engine of level.trains){const train=s.trains.find(t=>t.id===engine.id);for(const task of engine.tasks){
        taskKinds.add(task.type);const blocked=new Set(s.trains.filter(t=>t.id!==train.id&&!t.done).map(t=>t.node));const route=path(level.map,train.node,task.node,blocked);assert(route,'A safe sequential route exists');
        for(let i=0;i<route.length-1;i++)assert.equal(E.setSwitch(level,s,route[i],route[i+1]),true);
        assert.equal(E.sendTrain(level,s,train.id),true);
        while(!train.held&&!train.done&&budget-->0){E.step(level,s,.073);if(train.edge&&movingSnapshots<300){assert.deepEqual(E.validateState(level,JSON.parse(JSON.stringify(s))),s,'A moving train resumes exactly');movingSnapshots++;}assert.notEqual(s.status,'crashed');}
        assert(budget>0,'Dispatch makes bounded progress');assert.equal(train.node,task.node,'Each announced task is actually visited');
        while(train.repair>0&&budget-->0)E.step(level,s,.073);
      }}assert.equal(s.status,'won');assert.equal(s.deliveries,level.trains.length);assert.deepEqual(E.validateState(level,s),s);return s;
    }
    for(let index=0;index<E.CAMPAIGN.length;index++){independentlyDispatch(E.createLevel(index,1,false));campaign++;}
    for(let seed=0;seed<120;seed++){independentlyDispatch(E.createLevel(seed%60,seed,true));endless++;}
    const level=E.createLevel(3,4),s=E.createState(level);s.trains[0].node='j0';s.trains[1].node='j1';E.setSwitch(level,s,'j0','j1');E.setSwitch(level,s,'j1','j0');E.sendTrain(level,s,'t1');E.sendTrain(level,s,'t2');
    for(let n=0;n<100&&s.status!=='crashed';n++)E.step(level,s,.1);
    assert.equal(s.status,'crashed');assert.equal(s.crash.kind,'head-on');const crashed=structuredClone(s);E.step(level,s,1);assert.deepEqual(s,crashed,'Crashes stop the simulation');
    assert.equal(E.brakeTrain(s,'t1'),false,'Terminal runs reject Brake as well as Send/switch input');assert.deepEqual(s,crashed);
    assert.deepEqual([...taskKinds].sort(),['couple','deliver','pickup','repair']);
    return {campaignJobs:campaign,endlessJobs:endless,movingSnapshots,taskKinds:[...taskKinds],headOnCollision:true};
  });
  if(!roomsOnly)for(const viewport of [{width:1280,height:800},{width:768,height:1024},{width:1024,height:768},{width:390,height:844},{width:320,height:568},{width:844,height:390}])await run('Robot native tap/keyboard wiring, save and reachable controls '+viewport.width+'x'+viewport.height,async()=>{
    const {page}=await pageFor('robot-workshop',viewport);
    await page.locator('#startCampaign').click();
    await page.locator('#port-A-out-0').tap();await page.locator('#port-O0-in-0').tap();
    assert.equal((await capture(page)).circuit.wires.length,1,'Tap-to-wire works with real touch input');
    await page.locator('#runBtn').focus();await page.keyboard.press('Enter');
    await page.waitForFunction(()=>RobotWorkshop.getState().won);
    assert.deepEqual((await capture(page)).completed,[0]);
    for(const selector of ['#menuBtn','#runBtn','#undoBtn','#clearBtn','#nextBtn']){await page.locator(selector).scrollIntoViewIfNeeded();await inViewport(page,[selector]);}
    await page.locator('#menuBtn').click();const won=await capture(page);await page.locator('#saveBtn').click();
    await page.waitForFunction(()=>ArcadeSave.getCurrentEntry()?.data?.won===true);
    assert.equal(await page.evaluate(()=>ArcadeSave.getAdapter().meaningful()),true);
    assert.match(await page.evaluate(()=>ArcadeSave.getCurrentEntry().summary),/Mission 1.*1 \/ 30/,'No-argument summary describes real progress');
    await page.goto(base+'/robot-workshop/?resume=1');await page.waitForFunction(()=>RobotWorkshop?.getState().won);assert.deepEqual(await capture(page),won,'Exact circuit, switches, menu and campaign progress resume');assert.equal(await page.locator('#menu').isVisible(),true,'The saved menu remains open');await page.locator('#resumeBtn').click();
    await page.locator('#nextBtn').click();assert.equal((await capture(page)).level,1);
    await page.locator('[data-gate="NOT"]').tap();const added=await capture(page);assert.equal(added.circuit.nodes.length,3);
    await page.locator('#undoBtn').click();assert.equal((await capture(page)).circuit.nodes.length,2,'Undo removes the actual last circuit edit');
    await page.locator('#hintBtn').click();const one=await page.locator('#missionStatus').textContent();await page.locator('#hintBtn').click();const two=await page.locator('#missionStatus').textContent();await page.locator('#hintBtn').click();const three=await page.locator('#missionStatus').textContent();assert.equal(new Set([one,two,three]).size,3,'Hints reveal increasing help');assert.equal((await capture(page)).hint,3);
    await page.screenshot({path:resolve(output,'robot-'+viewport.width+'x'+viewport.height+'.png'),fullPage:true});
    return {viewport,realTouch:true,keyboardActivation:true,exactReload:true,undo:true,progressiveHints:true};
  });
  if(!roomsOnly)await run('Robot native drag wiring, gate movement, fan-out and alternative solution acceptance',async()=>{
    const {page}=await pageFor('robot-workshop');await page.locator('#missionPicker').click();await page.locator('#levelList button').nth(8).click();
    for(const type of ['NOT','NOT','OR'])await page.locator('[data-gate="'+type+'"]').click();
    async function wire(from,to,port=0){await page.locator('#port-'+from+'-out-0').click();await page.locator('#port-'+to+'-in-'+port).click();}
    await wire('A','g1');await wire('B','g2');await wire('g1','g3');await wire('g2','g3',1);
    const source=await page.locator('#port-g3-out-0').boundingBox(),target=await page.locator('#port-O0-in-0').boundingBox();
    await page.mouse.move(source.x+source.width/2,source.y+source.height/2);await page.mouse.down();await page.mouse.move(target.x+target.width/2,target.y+target.height/2,{steps:15});await page.mouse.up();
    assert.equal((await capture(page)).circuit.wires.length,5,'Real pointer drag creates the final wire');
    await page.locator('#runBtn').click();assert.equal((await capture(page)).won,true,'The alternative De Morgan circuit is accepted through the real Run control');
    const before=await capture(page),head=page.locator('button.node-head[data-node="g3"]');await head.focus();await page.keyboard.press('ArrowLeft');const moved=await capture(page);assert(moved.circuit.nodes.find(n=>n.id==='g3').x<before.circuit.nodes.find(n=>n.id==='g3').x);await page.locator('#undoBtn').click();assert.deepEqual((await capture(page)).circuit,before.circuit,'Keyboard gate movement has a working undo');
    return {alternateAnswer:true,dragWire:true,keyboardMovement:true,undo:true};
  });
  if(!roomsOnly)for(const viewport of [{width:1280,height:800},{width:768,height:1024},{width:1024,height:768},{width:390,height:844},{width:320,height:568},{width:844,height:390}])await run('Train native dispatch, pause, reload and trolley choices '+viewport.width+'x'+viewport.height,async()=>{
    const {page}=await pageFor('train-trouble',viewport);await page.locator('#campaignBtn').tap();await page.locator('#job-0').tap();
    for(const selector of ['#railCanvas','#pauseBtn','#send-t1','#brake-t1','#hintBtn','#signalBtn','#menuBtn']){await page.locator(selector).scrollIntoViewIfNeeded();await inViewport(page,[selector]);}
    await page.locator('#hintBtn').tap();await page.locator('#send-t1').tap();await page.waitForFunction(()=>TrainTrouble.capture().rail.time>.15);
    await page.locator('#railCanvas').focus();await page.keyboard.press('Space');assert.equal((await capture(page)).paused,true,'Space pauses the railway from the focused board');
    const frozen=await capture(page);await delay(250);assert.deepEqual(await capture(page),frozen,'Paused engines, clock and effects remain frozen');
    await page.locator('#speedBtn').focus();await page.keyboard.press('Enter');assert.equal((await capture(page)).slow,true);await page.locator('#previewBtn').tap();assert.equal((await capture(page)).preview,false);
    await page.locator('#menuBtn').tap();const saved=await capture(page);await page.locator('#saveBtn').click();await page.waitForFunction(()=>ArcadeSave.getCurrentEntry()?.data?.menuOpen===true);
    assert.match(await page.evaluate(()=>ArcadeSave.getCurrentEntry().summary),/First whistle.*0\/1 deliveries/);
    await page.goto(base+'/train-trouble/?resume=1');await page.waitForFunction(()=>TrainTrouble?.capture().view==='play');assert.deepEqual(await capture(page),saved,'A paused moving engine, route, slow speed and menu reload exactly');assert.equal(await page.locator('#menuOverlay').isVisible(),true);await page.locator('#resumeBtn').click();
    await page.evaluate(()=>{for(let n=0;n<24&&TrainTrouble.capture().rail.status!=='won';n++)TrainTrouble.step(5);});
    assert.equal((await capture(page)).rail.status,'won');assert.equal(await page.locator('#resultOverlay').isVisible(),true);const stars=(await capture(page)).progress.stars[0];assert(stars>0);await page.locator('#nextJobBtn').tap();assert.equal((await capture(page)).levelIndex,1);assert.equal((await capture(page)).progress.stars[0],stars,'Moving on does not award stars twice');
    await page.locator('#menuBtn').click();await page.locator('#modeBtn').click();await page.locator('#trolleyBtn').tap();
    const trolley=await capture(page),{getScenario}=await import('../train-trouble/trolley.mjs'),scene=getScenario(trolley.trolley.order[trolley.trolley.index]);
    assert.equal(await page.locator('#scenarioStory').textContent(),scene.story);assert.deepEqual(await page.locator('#scenarioFacts li').allTextContents(),scene.facts,'All decision-changing facts appear before a choice');assert.equal(await page.locator('#trolleyOutcome').isVisible(),false);
    const choice=page.locator('[data-choice]').first();await choice.scrollIntoViewIfNeeded();await inViewport(page,['#trolley-choice-0']);await choice.tap();assert.equal((await capture(page)).trolley.phase,'outcome');assert.equal(await page.locator('#trolleyChoices button').count(),0,'No follow-up answer questionnaire appears');assert.equal(await page.locator('#nextScenarioBtn').isVisible(),true);
    const outcome=await capture(page);await page.evaluate(()=>ArcadeSave.saveNow());await page.goto(base+'/train-trouble/?resume=1');await page.waitForFunction(()=>TrainTrouble?.capture().trolley.phase==='outcome');assert.deepEqual(await capture(page),outcome,'The direct decision and its consequence survive reload');await page.locator('#nextScenarioBtn').tap();assert.equal((await capture(page)).trolley.phase,'choice');assert.equal((await capture(page)).trolley.index,1);await page.waitForFunction(()=>document.getElementById('trolleyScreen').scrollTop===0);await inViewport(page,['#scenarioTitle']);
    await page.screenshot({path:resolve(output,'train-'+viewport.width+'x'+viewport.height+'.png'),fullPage:true});
    return {viewport,realTouch:true,keyboardPause:true,exactMidRouteReload:true,winAndProgress:true,directTrolleyChoice:true};
  });
  if(!roomsOnly)for(const fallback of [false,true])await run('Train '+(fallback?'WebM fallback':'MP4')+': every real crash clip decodes over Range and archive-style HTTP',async()=>{
    const E=await import('../train-trouble/engine.mjs');let decoded=0;const mediaEvidence=[];
    for(const archiveStyle of [false,true]){
      const {page}=await pageFor('train-trouble',{width:844,height:390});
      if(!fallback&&!await page.locator('#crashVideo').evaluate(v=>v.canPlayType('video/mp4; codecs="avc1.42E01E, mp4a.40.2"'))){const error=Error('This Chromium build has no H264/AAC decoder. Run this case with branded Chrome and ARCADE_REQUIRE_H264=1 for mandatory MP4 verification.');error.code='TEST_ENVIRONMENT_BLOCKED';throw error;}
      if(fallback)await page.evaluate(()=>{const native=HTMLMediaElement.prototype.canPlayType;HTMLMediaElement.prototype.canPlayType=function(type){return /mp4/i.test(type)?'':native.call(this,type);};});
      if(archiveStyle)await page.route('**/train-trouble/media/*.{mp4,webm}',async route=>{
        const name=new URL(route.request().url()).pathname.split('/').at(-1),body=await readFile(resolve(root,'train-trouble/media',name));
        await route.fulfill({status:200,body,headers:{'content-type':'application/octet-stream','content-length':String(body.length)}});
      });
      for(const kind of ['head-on','rear-end','cargo']){
        const level=E.createLevel(3,1),rail=E.createState(level);
        if(kind==='head-on'){rail.trains[0].node='j0';rail.trains[1].node='j1';E.setSwitch(level,rail,'j0','j1');E.setSwitch(level,rail,'j1','j0');E.sendTrain(level,rail,'t1');E.sendTrain(level,rail,'t2');}
        else {rail.trains[0].node='j0';rail.trains[1].node='j0';rail.trains[0].coupled=kind==='cargo';rail.status='running';}
        for(let step=0;step<120&&rail.status!=='crashed';step++)E.step(level,rail,.1);
        assert.equal(rail.crash.kind,kind);await page.evaluate(rail=>{TrainTrouble.startJob(3);const saved=TrainTrouble.capture();if(!TrainTrouble.restore({...saved,rail,clipPosition:0,crashDismissed:false}))throw Error('Cannot restore the real simulated crash');},rail);
        try{await page.waitForFunction(()=>{const v=document.getElementById('crashVideo');return v.readyState>=2&&v.videoWidth>0&&v.currentTime>.1;},{},{timeout:18000});}
        catch(error){throw Error(kind+(archiveStyle?' archive':' range')+' did not play: '+JSON.stringify(await page.locator('#crashVideo').evaluate(v=>({ready:v.readyState,network:v.networkState,width:v.videoWidth,time:v.currentTime,paused:v.paused,error:v.error?.message,source:v.currentSrc,mp4:v.canPlayType('video/mp4; codecs="avc1.42E01E, mp4a.40.2"'),caption:document.getElementById('crashCaption').textContent})))+'; '+error.message);}
        const video=await page.locator('#crashVideo').evaluate(v=>({duration:v.duration,width:v.videoWidth,height:v.videoHeight,time:v.currentTime,paused:v.paused,error:v.error?.message||null,poster:v.poster,currentSrc:v.currentSrc}));
        assert(video.duration>=3&&video.duration<=6,'The cutscene is a real short video');assert(video.width>=640&&video.height>=360);assert.equal(video.error,null);assert.equal(video.paused,false);assert.match(video.currentSrc,fallback?/\.webm$|^blob:/:/\.mp4$|^blob:/);
        const poster=await page.request.get(video.poster);assert.equal(poster.status(),200,'The actual fallback poster exists');
        for(const selector of ['#skipCrashBtn','#replayCrashBtn']){await page.locator(selector).scrollIntoViewIfNeeded();await inViewport(page,[selector]);}
        await page.locator('#crashVideo').evaluate(v=>{v.currentTime=2.7;});await page.waitForFunction(()=>{const v=document.getElementById('crashVideo');return !v.seeking&&v.readyState>=2&&v.currentTime>=2.7;});
        await page.screenshot({path:resolve(output,'crash-'+kind+(fallback?'-webm':'-mp4')+(archiveStyle?'-archive':'-range')+'.png')});await page.waitForFunction(()=>document.getElementById('crashVideo').ended,{},{timeout:9000});
        await page.locator('#replayCrashBtn').click();await page.waitForFunction(()=>{const v=document.getElementById('crashVideo');return !v.ended&&v.currentTime>.1&&v.currentTime<2;});
        decoded++;mediaEvidence.push({kind,format:fallback?'webm':'mp4',archiveStyle,...video});await page.locator('#skipCrashBtn').click();assert.equal((await capture(page)).rail.status,'ready');assert.equal(await page.locator('#crashOverlay').isVisible(),false,'The crash can always be dismissed into a fresh job');
      }
    }
    return {decodedClips:decoded,media:mediaEvidence};
  });
  if(!roomsOnly)await run('Train PWA: complete snapshot installs and real crash video plays and seeks offline',async()=>{
    const context=await browser.newContext({viewport:{width:1024,height:768},hasTouch:true});contexts.add(context);const page=await context.newPage();page.on('pageerror',error=>errors.push({game:'train-pwa',message:error.message}));
    await page.goto(base+'/');await page.waitForFunction(()=>!!window.ArcadeShell);await page.evaluate(()=>navigator.serviceWorker.register('/sw.js',{scope:'/'}));await page.waitForFunction(()=>!!navigator.serviceWorker.controller,null,{timeout:30000});
    await page.locator('#offlineBadge').click();await page.waitForFunction(()=>document.getElementById('offlineBadgeText')?.textContent==='Offline Ready',null,{timeout:120000});
    await context.setOffline(true);await page.goto(base+'/train-trouble/index.html');await page.waitForFunction(()=>!!window.TrainTrouble);assert.equal(await page.evaluate(()=>navigator.onLine),false,'The browser network is actually offline');
    await page.locator('#campaignBtn').click();await page.locator('#job-3').click();const E=await import('../train-trouble/engine.mjs'),level=E.createLevel(3,1),rail=E.createState(level);rail.trains[0].node='j0';rail.trains[1].node='j1';E.setSwitch(level,rail,'j0','j1');E.setSwitch(level,rail,'j1','j0');E.sendTrain(level,rail,'t1');E.sendTrain(level,rail,'t2');for(let n=0;n<120&&rail.status!=='crashed';n++)E.step(level,rail,.1);assert.equal(rail.crash.kind,'head-on');
    await page.evaluate(rail=>{const saved=TrainTrouble.capture();if(!TrainTrouble.restore({...saved,rail,clipPosition:0,crashDismissed:false}))throw Error('Cached Train could not restore a real collision');},rail);
    await page.waitForFunction(()=>{const v=document.getElementById('crashVideo');return v.readyState>=2&&v.videoWidth>0&&v.currentTime>.1;},null,{timeout:18000});
    const media=await page.locator('#crashVideo').evaluate(v=>({source:v.currentSrc,width:v.videoWidth,height:v.videoHeight,duration:v.duration}));assert(media.width>=640&&media.height>=360);assert(media.duration>=3&&media.duration<=6);
    await page.locator('#crashVideo').evaluate(v=>{v.currentTime=2.7;});await page.waitForFunction(()=>{const v=document.getElementById('crashVideo');return !v.seeking&&v.readyState>=2&&v.currentTime>=2.7;});await page.screenshot({path:resolve(output,'pwa-offline-crash.png')});await page.waitForFunction(()=>document.getElementById('crashVideo').ended,null,{timeout:9000});await page.locator('#replayCrashBtn').click();await page.waitForFunction(()=>{const v=document.getElementById('crashVideo');return !v.ended&&v.currentTime>.1&&v.currentTime<2;});
    const ranges=await page.evaluate(async()=>{const results=[];for(const extension of ['mp4','webm']){const response=await fetch('media/crash-head-on.'+extension,{headers:{Range:'bytes=0-99'}});results.push({extension,status:response.status,bytes:(await response.arrayBuffer()).byteLength,type:response.headers.get('content-type')});}return results;});
    for(const result of ranges){assert.equal(result.status,206,'Cached '+result.extension+' supports a byte-range media request');assert.equal(result.bytes,100);assert.match(result.type,/^video\//);}
    await page.locator('#skipCrashBtn').click();assert.equal((await capture(page)).rail.status,'ready');return {offline:true,fullSnapshot:true,seekAndReplay:true,media,ranges};
  });
  if(!localOnly)await run('Robot real Worker: observer blocking, local menu, exact handoff and private restore',async()=>{
    const {page:host}=await pageFor('robot-workshop'),{page:guest}=await pageFor('robot-workshop',{width:390,height:844});
    await host.locator('#startCampaign').click();await host.locator('#port-A-out-0').click();await host.locator('#port-O0-in-0').click();await host.locator('#runBtn').click();await host.waitForFunction(()=>RobotWorkshop.getState().won);
    await guest.locator('#startWorkshop').click();await guest.locator('[data-gate="XOR"]').click();const privateState=await capture(guest);
    const joined=await connect(host,guest),shared=await capture(host);await equalState(guest,shared,'Observer applies the exact solved machine');
    await guest.locator('#nextBtn').dispatchEvent('click');await guest.locator('#clearBtn').dispatchEvent('click');await guest.keyboard.press('Control+z');await delay(400);assert.deepEqual(await capture(host),shared,'Observer cannot advance or erase the host machine');assert.deepEqual(await capture(guest),shared,'Observer input cannot mutate its canonical state');
    await guest.locator('#menuBtn').click();assert.equal(await guest.locator('#shared-menu').isVisible(),true,'Observer can open its own navigation');assert.deepEqual(await capture(guest),shared,'Observer menu remains local');await guest.locator('#shared-menu-resume').click();
    await host.evaluate(seat=>ArcadeSharedActivity.pass(seat),joined.seat);await until(guest,()=>ArcadeSharedActivity.isController()&&!ArcadeSharedActivity.isSpectator(),'Robot guest receives controller authority');assert.equal(await host.evaluate(()=>ArcadeSharedActivity.isController()),false);assert.deepEqual(await capture(guest),shared,'Passing controls preserves solved state exactly');
    await guest.locator('#nextBtn').click();const advanced=await capture(guest);assert.equal(advanced.level,1);await equalState(host,advanced,'The old controller follows the new controller');
    await guest.evaluate(()=>ArcadeSharedActivity.leave());assert.deepEqual(await capture(guest),privateState,'Leaving restores the exact private workshop, including its selected gate');await host.evaluate(()=>ArcadeSharedActivity.leave());
    return {worker:true,observerBlocked:true,localMenu:true,exactHandoff:true,privateRestore:true};
  });
  if(!localOnly)await run('Train real Worker: exact dispatcher/trolley handoff, observer blocking and private restore',async()=>{
    const {page:host}=await pageFor('train-trouble'),{page:guest}=await pageFor('train-trouble',{width:390,height:844});
    await host.locator('#campaignBtn').click();await host.locator('#job-3').click();await host.locator('#hintBtn').click();await host.locator('#send-t1').click();await until(host,()=>TrainTrouble.capture().rail.time>.2,'Native host train starts moving');await host.locator('#pauseBtn').click();
    await guest.locator('#campaignBtn').click();await guest.locator('#job-1').click();await guest.locator('#speedBtn').click();const privateState=await capture(guest);
    const joined=await connect(host,guest),shared=await capture(host);await equalState(guest,shared,'The observer restores every paused engine, arrow and timer exactly');
    await guest.locator('#send-t1').dispatchEvent('click');await guest.locator('#hintBtn').dispatchEvent('click');await guest.locator('#railCanvas').focus();await guest.keyboard.press('Space');await delay(300);assert.deepEqual(await capture(host),shared);assert.deepEqual(await capture(guest),shared,'Observer keyboard and pointer actions cannot dispatch or reroute trains');
    await guest.locator('#menuBtn').click();assert.equal(await guest.locator('#shared-menu').isVisible(),true);assert.deepEqual(await capture(guest),shared,'The observer menu remains local');await guest.locator('#shared-menu-resume').click();
    await host.locator('#speedBtn').click();const latest=await capture(host);await equalState(guest,latest,'Dynamic dispatcher controls refresh for an existing observer');
    await host.evaluate(seat=>ArcadeSharedActivity.pass(seat),joined.seat);await until(guest,()=>ArcadeSharedActivity.isController()&&!ArcadeSharedActivity.isSpectator(),'Train guest receives controller authority');assert.deepEqual(await capture(guest),latest,'Paused mid-route state transfers exactly');assert.equal(await host.evaluate(()=>ArcadeSharedActivity.isController()),false);
    await guest.locator('#menuBtn').click();await guest.locator('#modeBtn').click();await guest.locator('#trolleyBtn').click();const dilemma=await capture(guest);await equalState(host,dilemma,'Changing to trolley mode restores the whole dynamic scenario');assert.equal(await host.locator('#scenarioFacts li').count(),await guest.locator('#scenarioFacts li').count());
    await host.locator('#trolley-choice-0').dispatchEvent('click');await delay(300);assert.equal((await capture(guest)).trolley.phase,'choice','Former controller cannot make the new decision');await guest.locator('#trolley-choice-0').click();const decided=await capture(guest);await equalState(host,decided,'A direct trolley outcome is shared exactly');assert.equal(await host.locator('#trolleyChoices button').count(),0);assert.equal(await host.locator('#outcomeText').textContent(),await guest.locator('#outcomeText').textContent());
    await guest.evaluate(()=>ArcadeSharedActivity.leave());assert.deepEqual(await capture(guest),privateState,'Leaving restores the exact separate private dispatcher job');await host.evaluate(()=>ArcadeSharedActivity.leave());
    return {worker:true,pausedMidRoute:true,exactHandoff:true,observerBlocked:true,dynamicTrolley:true,privateRestore:true};
  });
  assert.equal(results.length>0,true,'No new-game QA cases were selected');
  assert.deepEqual(errors,[],'No uncaught page errors');
  assert.deepEqual(failures,[],'All new-game browser cases passed');
  console.log('New-game browser scenarios: '+results.filter(result=>result.passed===true).length+' passed, '+results.filter(result=>result.blocked).length+' environment-blocked.');
}finally{
  await Promise.allSettled([...contexts].map(context=>context.close()));
  await browser?.close();
  fixture?.kill('SIGTERM');
}
