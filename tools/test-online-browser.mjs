// Real Chromium clients talking to the production Worker implementation in Miniflare.
// Run: CHROMIUM_PATH=/path/to/chromium node tools/test-online-browser.mjs
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {gunzipSync} from 'node:zlib';
import {chromium,browserLaunchOptions} from './browser-runtime.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const out=new URL('../test-results/online-browser/',import.meta.url);
await mkdir(out,{recursive:true});
const fixture=spawn(process.execPath,['guess-who/test-server.mjs'],{cwd:root,stdio:['ignore','pipe','pipe']});
let serverLog='';fixture.stdout.on('data',b=>{serverLog+=b;});fixture.stderr.on('data',b=>{serverLog+=b;});
const delay=ms=>new Promise(r=>setTimeout(r,ms));
for(let n=0;n<80;n++){try{if((await fetch('http://127.0.0.1:8787/guess-who/')).ok)break;}catch{}if(n===79)throw Error('Test fixture failed: '+serverLog);await delay(100);}
const browser=await chromium.launch(browserLaunchOptions);
const errors=[],results=[];
const mapping=()=>{
  window.__rooms=[];window.__room=null;window.__session=null;window.__actions=[];window.__fetches=[];window.__sockets=[];window.__audioStarts=0;const originalAudioStart=window.AudioBufferSourceNode?.prototype.start;if(originalAudioStart)window.AudioBufferSourceNode.prototype.start=function(...args){window.__audioStarts++;return originalAudioStart.apply(this,args);};
  const note=data=>{if(data?.room){window.__room=data.room;window.__rooms.push(data.room);}if(data?.token)window.__session=data;};
  const originalFetch=window.fetch.bind(window);
  window.fetch=async(input,options)=>{
    const url=typeof input==='string'?input.replace('https://arcade-chess.jonathanjablon.workers.dev','http://127.0.0.1:8788'):input;
    if(String(url).includes('/actions')&&options?.body)try{window.__actions.push(JSON.parse(options.body));}catch{}
    const response=await originalFetch(url,options);if(String(url).includes('/api/')){window.__fetches.push({url:String(url),status:response.status,text:(await response.clone().text()).slice(0,140)});try{note(await response.clone().json());}catch{}}return response;
  };
  const NativeWebSocket=window.WebSocket;
  window.WebSocket=class extends NativeWebSocket{
    constructor(url,protocols){const mapped=String(url).replace('wss://arcade-chess.jonathanjablon.workers.dev','ws://127.0.0.1:8788');if(protocols===undefined)super(mapped);else super(mapped,protocols);window.__sockets.push(this);this.addEventListener('message',event=>{try{note(JSON.parse(event.data));}catch{}});}
  };
};
async function pair(game){
  const contexts=await Promise.all([{width:1280,height:900},{width:390,height:844}].map(viewport=>browser.newContext({viewport,deviceScaleFactor:1,hasTouch:viewport.width<500})));
  const pages=[];for(const context of contexts){await context.addInitScript(mapping);const page=await context.newPage();page.setDefaultTimeout(10000);page.waitForFunction=async(fn,arg,options={})=>{const deadline=Date.now()+(options.timeout||10000);while(Date.now()<deadline){if(await page.evaluate(fn,arg))return;await delay(60);}throw Error('Browser condition timed out: '+String(fn));};page.on('pageerror',error=>errors.push({game,message:String(error)}));await page.goto(`http://127.0.0.1:8787/${game}/`);pages.push(page);}
  return {a:pages[0],b:pages[1],contexts,close:()=>Promise.all(contexts.map(c=>c.close()))};
}
async function room(page){return page.evaluate(()=>window.__room);}
async function waitRoom(page,predicate){await page.waitForFunction(predicate);return room(page);}
async function sharedPayload(page){const checkpoint=(await room(page)).state;return JSON.parse(checkpoint.codec==='gzip'?gunzipSync(Buffer.from(checkpoint.data,'base64')).toString():checkpoint.data);}
async function visibleClick(page,selector){for(const candidate of await page.locator(selector).all())if(await candidate.isVisible()&&await candidate.isEnabled()){await candidate.click({force:true});return;}throw Error('No usable activity control: '+selector);}
async function drag(page,selector,x1=.4,y1=.5,x2=.6,y2=.55){const box=await page.locator(selector).first().boundingBox();assert.ok(box&&box.width>10);await page.mouse.move(box.x+box.width*x1,box.y+box.height*y1);await page.mouse.down();await page.mouse.move(box.x+box.width*x2,box.y+box.height*y2,{steps:12});await page.mouse.up();}
const sharedLaunch={
  'make-10':'#startBtn',balloons:'[onclick="BalloonGame.start()"]',blackjack:'[onclick="BJGame.init(2)"]',time:'[onclick="ClockGame.start(1)"]',insultinator:'#pickNice',hangman:'[onclick="HangmanGame.startRandom()"]',solitaire:'#startBtn',jigsaw:'#startBtn',codebreaking:'#play',math:'[onclick="MathGame.start(1)"]',spelling:'#play',maze:'[onclick="MazeGame.start(12,12)"]',minesweeper:'[data-preset="easy"], [data-level="easy"], [data-diff="easy"]','mini-golf':'[onclick="MiniGolf.startOrContinue()"]','orb-slicer':'#orb-ov-btn','two-truths':'#play',patterns:'#play',shuffleboard:'#btnApply',simon:'#si-menu [onclick="SimonGame.start()"]','regex-lab':'#startBtn',trivia:'[onclick="Game.start(\'science\')"]','contraption-maker':'#starter','bug-squish':'#startBtn','firefighter-frenzy':'#startBtn','monster-dentist':'#startBtn',bowling:'#start','mad-libs':'#randomStoryButton'
};
const sharedActions={
  time:'.clock-keypad .kp-btn, .kp-btn',hangman:'#keyboard [role="button"]',solitaire:'[data-action="draw-klondike"]',codebreaking:'#palette button',math:'.kp-btn',spelling:'#keyboard button',minesweeper:'#grid .cell','mini-golf':'#mg-shoot-btn','two-truths':'#claims button',patterns:'#puzzle button',trivia:'#tr-options button, .ans-btn','build-my-joke':'#random',insultinator:'#btnGenerate',typing:'[data-key="a"]','contraption-maker':'#drop','silly-face-lab':'[aria-label="Make a surprise face"]',bowling:'#roll'
};
async function sharedSemantic(game,a,b){
  const before=(await sharedPayload(a)).snapshot;assert.ok(before,'shared activity has a playable snapshot');
  if(sharedActions[game])await visibleClick(a,sharedActions[game]);
  else if(game==='blackjack'){await visibleClick(a,'[onclick="BJGame.addBet(10)"]');await visibleClick(a,'#btn-deal');await b.waitForFunction(()=>document.getElementById('players-area').innerText.includes('10'));}
  else if(game==='mad-libs'){await visibleClick(a,'#fillEmptyButton');await visibleClick(a,'#makeStoryButton');await b.waitForFunction(()=>document.getElementById('storyOutput').textContent.trim().length>20);}
  else if(game==='regex-lab'){await visibleClick(a,'[data-pick]');await visibleClick(a,'#checkAction');await b.waitForFunction(()=>!!document.querySelector('#nextAction'));}
  else if(game==='make-10'){
    const cards=await a.evaluate(()=>[...document.querySelectorAll('#table [data-id]')].map(el=>({id:el.dataset.id,value:Number(el.querySelector('.card-value, .num, .value')?.textContent||el.innerText.match(/\d+/)?.[0])})));
    let combination=null;for(let mask=1;mask<1<<cards.length;mask++){const selected=cards.filter((_,index)=>mask>>index&1),sum=selected.reduce((total,card)=>total+card.value,0);if(sum>0&&sum%10===0){combination=selected;break;}}assert.ok(combination,'a scoring card combination exists');for(const card of combination)await visibleClick(a,`#table [data-id="${card.id}"]`);await visibleClick(a,'#collectBtn');
  }
  else if(game==='jigsaw'){await drag(a,'.piece',.5,.5,.5,.05);}
  else if(game==='paint-lab'){await drag(a,'#paintCanvas');}
  else if(game==='trail'){await visibleClick(a,'#trail-menu-btn');await visibleClick(a,'[data-trail-mode="lcd"]');await visibleClick(a,'#trail-menu-btn');await drag(a,'#trail-canvas');}
  else if(game==='maze'){
    const state=await a.evaluate(()=>ArcadeSave.getAdapter().capture());
    const direction=['U','R','D','L'].find((_,index)=>!state.grid[state.py][state.px].w[index]);await visibleClick(a,`[onpointerdown="MazeGame.holdStart('${direction}', event)"]`);
    await a.waitForFunction(()=>Number(document.getElementById('mz-steps').textContent)>0);
  }
  else if(game==='music-maker'){
    await b.setViewportSize({width:844,height:390});await visibleClick(a,'[data-player="1"] .pad');await b.waitForFunction(()=>window.__audioStarts>0);
  }
  else if(game==='simon'){
    await a.waitForFunction(()=>SimonSharedAdapter.capture().phase==='input');const sequence=await a.evaluate(()=>SimonSharedAdapter.capture().seq);for(const color of sequence)await visibleClick(a,'#si-'+color);await a.waitForFunction(()=>SimonSharedAdapter.capture().seq.length>1);
  }
  else if(game==='bug-squish'){
    const target=await a.evaluate(()=>window.__arcadeGame.debug().bugs[0]);const box=await a.locator('#gameCanvas').boundingBox();await a.mouse.click(box.x+target.x,box.y+target.y);await a.waitForFunction(health=>window.__arcadeGame.debug().squished>0||window.__arcadeGame.debug().bugs.some(bug=>bug.health<health),target.health);
  }
  else if(game==='firefighter-frenzy'||game==='monster-dentist'){
    const state=await a.evaluate(()=>window.__arcadeGame.debug());const target=game==='firefighter-frenzy'?state.targets[0]:state.spots[0];const box=await a.locator('#gameCanvas').boundingBox();await a.mouse.move(box.x+target.x,box.y+target.y);await a.mouse.down();await delay(650);await a.mouse.up();
    await a.waitForFunction(({game,health})=>{const state=window.__arcadeGame.debug();return state.phaseDone>0||(game==='firefighter-frenzy'?state.targets:state.spots).some(target=>target.health<health);},{game,health:target.health});
  }
  else if(game==='orb-slicer'||game==='balloons'){
    const selector=game==='orb-slicer'?'#orb-canvas':'#c-bal',field=game==='orb-slicer'?'projectiles':'balloons';
    await a.waitForFunction(({field})=>ArcadeSave.getAdapter().capture()[field].some(item=>!item.isBomb&&item.y>20&&item.y<ArcadeSave.getAdapter().capture().bounds.h-20),{field});const state=await a.evaluate(()=>ArcadeSave.getAdapter().capture()),target=state[field].find(item=>!item.isBomb&&item.y>20&&item.y<state.bounds.h-20),box=await a.locator(selector).boundingBox();
    const x=box.x+target.x*box.width/state.bounds.w,y=box.y+target.y*box.height/state.bounds.h;
    if(game==='orb-slicer'){await a.mouse.move(x-60,y);await a.mouse.down();await a.mouse.move(x+60,y,{steps:4});await a.mouse.up();await a.waitForFunction(()=>ArcadeSave.getAdapter().capture().score>0);}
    else{await a.mouse.click(x,y);await a.waitForFunction(()=>{const s=ArcadeSave.getAdapter().capture();return s.cNorm+s.cUnicorn>0;});}
  }
  else if(game==='shuffleboard'){
    const canvas=await a.locator('#board').boundingBox(),target=await a.evaluate(()=>{const s=ArcadeSave.getAdapter().capture();return s.pucks.find(p=>p.isCurrent);});assert.ok(target);const boardWidth=Math.max(240,Math.min(canvas.width-16,560)),boardHeight=Math.max(320,canvas.height-16),position={x:(canvas.width-boardWidth)/2+target.x*boardWidth,y:(canvas.height-boardHeight)/2+target.y*boardHeight};
    // The live puck is drawn in the launch zone at the near end of the lane.
    await a.mouse.move(canvas.x+position.x,canvas.y+position.y);await a.mouse.down();await a.mouse.move(canvas.x+position.x,canvas.y+Math.min(canvas.height-3,position.y+70),{steps:8});await a.mouse.up();await a.waitForFunction(()=>ArcadeSave.getAdapter().capture().shotsFiredInEnd>0);
  }
  else if(game==='bounce-boxes'){await drag(a,'#c',.5,.5,.8,.5);await a.waitForFunction(()=>{const s=ArcadeSave.getAdapter().capture();return s.grow||s.runWalls>0||s.lives<5;});}
  else throw Error('Missing semantic activity action: '+game);
  await delay(200);await a.evaluate(()=>ArcadeSharedActivity.publish());await delay(150);
  const after=await sharedPayload(a);assert.notDeepEqual(after.snapshot,before,'an actual activity action changes shared game state');const sequence=(await room(a)).state.sequence;await b.waitForFunction(sequence=>ArcadeSharedActivity.getState().appliedSequence>=sequence,sequence);
  assert.equal(await b.locator('#shared-error').innerText(),'','observer applies action checkpoint');
  if(after.frames.length)assert.ok(await b.locator('img[data-shared-canvas]').count(),'observer displays sender canvas');
}
async function sameState(a,b){await b.waitForFunction(state=>JSON.stringify(window.__room?.state)===JSON.stringify(state),(await room(a)).state);assert.deepEqual((await room(a)).state,(await room(b)).state);}
async function action(page,body){return page.evaluate(async body=>{const s=window.__session,r=window.__room;const path=r.game?.moves?'/api/chess/rooms/':'/api/arcade/rooms/';const res=await fetch('http://127.0.0.1:8788'+path+r.code+'/actions',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+s.token},body:JSON.stringify(body)});return{status:res.status,data:await res.json()};},body);}
async function security(a,b){const r=await room(a);const result=await action(b,{type:'state',expectedVersion:r.version,state:r.state,nextSeat:0});assert.equal(result.status,403,'off-turn player cannot write the room');const stale=await action(a,{type:'state',expectedVersion:r.version-1,state:r.state,nextSeat:0});assert.equal(stale.status,409,'stale version cannot overwrite the room');}
async function capture(game,a,b){for(const [kind,page] of [['desktop',a],['mobile',b]]){await page.screenshot({animations:'disabled',timeout:30000,path:fileURLToPath(new URL(`${game}-${kind}.png`,out))});const dimensions=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,view:innerWidth}));if(dimensions.scroll>dimensions.view+1){const geometry=await page.evaluate(()=>[...document.querySelectorAll('*')].map(element=>{const box=element.getBoundingClientRect(),style=getComputedStyle(element);return {tag:element.tagName,id:element.id,class:element.className,x:box.x,right:box.right,width:box.width,clientWidth:element.clientWidth,scrollWidth:element.scrollWidth,display:style.display,boxSizing:style.boxSizing,cssWidth:style.width,padding:style.padding,border:style.border};}).filter(item=>item.width&&item.display!=='none'&&(item.x<-1||item.right>innerWidth+1)));await writeFile(new URL(`${game}-${kind}-overflow.json`,out),JSON.stringify(geometry,null,2));}assert.ok(dimensions.scroll<=dimensions.view+1,`${game} ${kind} horizontal page overflow: ${JSON.stringify(dimensions)}`);}}
async function resume(page,selector){const before=await room(page);await page.reload();if(selector==='#dotsOnlineResume')await page.locator('#dotsModeOnline').click({force:true});if(selector==='#ck-online-resume')await page.locator('[onclick="CheckersGame.showOnlineSetup()"]').click({force:true});await page.locator(selector).click({force:true});await page.waitForFunction(({code,version})=>window.__room?.code===code&&window.__room?.version>=version,{code:before.code,version:before.version});}
async function run(game,test){const started=Date.now();const players=await pair(game);try{await test(players);await capture(game,players.a,players.b);assert.equal(errors.filter(e=>e.game===game).length,0,JSON.stringify(errors));results.push({game,pass:true,ms:Date.now()-started});console.log('PASS',game,Date.now()-started,'ms');}catch(error){await writeFile(new URL(`${game}-failure-evidence.json`,out),JSON.stringify(await Promise.all([players.a,players.b].map(page=>page.evaluate(()=>({room:window.__room,actions:window.__actions,fetches:window.__fetches,shared:window.ArcadeSharedActivity?.getState(),text:document.body.innerText})))),null,2)).catch(()=>{});results.push({game,pass:false,error:error.stack,ms:Date.now()-started});console.error('FAIL',game,error.message);for(const [kind,page] of [['desktop',players.a],['mobile',players.b]])await page.screenshot({animations:'disabled',timeout:30000,path:fileURLToPath(new URL(`${game}-failure-${kind}.png`,out))}).catch(()=>{});}finally{await players.close();}}

try{
const selected=new Set((process.env.ONLINE_GAMES||'tic-tac-toe,memory,dots,checkers,chess,sorry,monopoly,guess-who,shared').split(','));
if(selected.has('tic-tac-toe'))await run('tic-tac-toe',async({a,b})=>{
  await a.locator('#ttt-online-name').fill('Alice');await a.locator('[onclick="TicTacToe.createOnline()"]').click({force:true});await waitRoom(a,()=>!!window.__session?.token);const code=(await room(a)).code;
  await b.locator('#ttt-online-name').fill('Bob');await b.locator('[onclick="TicTacToe.showOnlineJoin()"]').click({force:true});await b.locator('#ttt-online-code').fill(code);await b.locator('[onclick="TicTacToe.joinOnline()"]').click({force:true});await waitRoom(a,()=>window.__room?.ready);
  await a.locator('#ttt-online-start').click({force:true});await waitRoom(b,()=>window.__room?.status==='active');await security(a,b);
  for(const [page,index] of [[a,0],[b,3],[a,1],[b,4],[a,2]]){
    const current=await room(page),previous=current.version;
    if(index===1){
      const state=structuredClone(current.state);state.board[index]='X';state.turn='O';
      const body={type:'state',expectedVersion:previous,state,nextSeat:1};
      const raced=await Promise.all([action(page,body),action(page,body)]);
      assert.deepEqual(raced.map(result=>result.status).sort(),[200,409],'one concurrent move wins and one stale duplicate is rejected');
    }else await page.locator('#ttt-board .ttt-cell').nth(index).click({force:true});
    await page.waitForFunction(version=>window.__room.version>version,previous);await sameState(page,page===a?b:a);
  }
  assert.equal((await room(a)).state.roundOver.winner,'X');await resume(b,'#ttt-online-resume');await sameState(a,b);
});
if(selected.has('memory'))await run('memory',async({a,b})=>{
  await a.locator('#memoryOnlineName').fill('Alice');await a.locator('#memoryOnlineCreate').click({force:true});await waitRoom(a,()=>!!window.__session?.token);const code=(await room(a)).code;
  await b.locator('#memoryOnlineName').fill('Bob');await b.locator('#memoryOnlineJoin').click({force:true});await b.locator('#memoryOnlineCode').fill(code);await b.locator('#memoryOnlineConnect').click({force:true});await waitRoom(a,()=>window.__room?.ready);await a.locator('#memoryOnlineStart').click({force:true});await waitRoom(b,()=>window.__room?.status==='active');await security(a,b);
  const deck=(await room(a)).state.deck;const second=deck.findIndex(card=>card.key!==deck[0].key);
  await a.locator('#board .card').nth(0).click({force:true});await b.waitForFunction(()=>window.__room.state.revealed.length===1);assert.equal(await b.locator('#board .card.revealed, #board .card.flipped').count(),1,'opponent sees first reveal');
  await a.locator('#board .card').nth(second).click({force:true});await b.waitForFunction(()=>window.__rooms.some(room=>room.state?.revealed?.length===2));await a.waitForFunction(()=>window.__room.turn.seat===1&&window.__room.state.revealed.length===0);await sameState(a,b);
  const state=(await room(b)).state;const key=state.deck.find(card=>!state.matchedKeys.includes(card.key)).key;const indexes=state.deck.map((card,index)=>card.key===key?index:-1).filter(index=>index>=0);
  for(const index of indexes){await b.locator('#board .card').nth(index).click({force:true});await delay(80);}await b.waitForFunction(()=>window.__room.state.scores[1]===1);await sameState(b,a);await resume(b,'#memoryOnlineResume');await sameState(a,b);
});
if(selected.has('dots'))await run('dots',async({a,b})=>{
  for(const page of [a,b])await page.locator('#dotsModeOnline').click({force:true});await a.locator('#dotsOnlineName').fill('Alice');await a.locator('#dotsOnlineCreate').click({force:true});await waitRoom(a,()=>!!window.__session?.token);const code=(await room(a)).code;
  await b.locator('#dotsOnlineName').fill('Bob');await b.locator('#dotsOnlineCode').fill(code);await b.locator('#dotsOnlineJoin').click({force:true});await waitRoom(a,()=>window.__room?.ready);await a.evaluate(()=>DotsGame.startGame(2,2));await waitRoom(b,()=>window.__room?.status==='active');await security(a,b);
  async function edge(page,r,c,r2,c2){const box=await page.locator('#c').boundingBox();const step=box.width/2.4;for(const [rr,cc] of [[r,c],[r2,c2]])await page.mouse.click(box.x+step*(.7+cc),box.y+step*(.7+rr));}
  for(const [page,coords] of [[a,[0,0,0,1]],[b,[1,0,1,1]],[a,[0,0,1,0]],[b,[0,1,1,1]]]){const previous=(await room(page)).version;await edge(page,...coords);await page.waitForFunction(version=>window.__room.version>version,previous);await sameState(page,page===a?b:a);}
  assert.equal((await room(b)).state.claimed,1);assert.equal((await room(b)).state.boxOwner[0][0],2);await resume(b,'#dotsOnlineResume');await sameState(a,b);
});
if(selected.has('checkers'))await run('checkers',async({a,b})=>{
  for(const page of [a,b])await page.locator('[onclick="CheckersGame.showOnlineSetup()"]').click({force:true});await a.locator('#ck-online-name').fill('Alice');await a.locator('#ck-online-create').click({force:true});await waitRoom(a,()=>!!window.__session?.token);const code=(await room(a)).code;
  await b.locator('#ck-online-name').fill('Bob');await b.locator('#ck-online-code').fill(code);await b.locator('#ck-online-join').click({force:true});await waitRoom(a,()=>window.__room?.ready);await a.locator('#ck-online-start').click({force:true});await waitRoom(b,()=>window.__room?.status==='active');await security(a,b);
  for(let n=0;n<12;n++){const current=await room(a),page=current.turn.seat===0?a:b,state=current.state,moves=[];for(let r=0;r<8;r++)for(let c=0;c<8;c++){const value=state.board[r][c];if(Math.sign(value)!==state.turn)continue;for(const dr of Math.abs(value)===2?[-1,1]:[value>0?-1:1])for(const dc of [-1,1]){const r2=r+dr,c2=c+dc;if(r2>=0&&r2<8&&c2>=0&&c2<8&&!state.board[r2][c2])moves.push([r,c,r2,c2]);}}assert.ok(moves.length);const [r,c,r2,c2]=moves[0];const box=await page.locator('#ck-canvas').boundingBox();if(n<2){for(const [rr,cc] of [[r,c],[r2,c2]]){const x=box.x+box.width*(cc+.5)/8,y=box.y+box.height*(rr+.5)/8;if(page===b)await page.touchscreen.tap(x,y);else await page.mouse.click(x,y);}}else{await page.mouse.move(box.x+box.width*(c+.5)/8,box.y+box.height*(r+.5)/8);await page.mouse.down();await page.mouse.move(box.x+box.width*(c2+.5)/8,box.y+box.height*(r2+.5)/8,{steps:5});await page.mouse.up();}await page.waitForFunction(version=>window.__room.version>version,current.version);await sameState(page,page===a?b:a);}
  await resume(b,'#ck-online-resume');await sameState(a,b);
});
if(selected.has('chess'))await run('chess',async({a,b})=>{
  await a.locator('#onlineCreateBtn').click({force:true});await waitRoom(a,()=>!!window.__session?.token);const code=(await room(a)).code;await b.locator('#onlineJoinOpenBtn').click({force:true});await b.locator('#onlineJoinCode').fill(code);await b.locator('#onlineJoinBtn').click({force:true});await waitRoom(a,()=>window.__room?.ready);await waitRoom(b,()=>!!window.__session?.token&&window.__room?.ready);
  const denied=await action(b,{type:'move',uci:'e7e5',expectedVersion:(await room(a)).version});assert.equal(denied.status,403);
  for(const [page,from,to] of [[a,'e2','e4'],[b,'e7','e5'],[a,'g1','f3'],[b,'b8','c6'],[a,'f1','c4'],[b,'g8','f6']]){const previous=(await room(page)).version;await page.locator(`[aria-label="Square ${from}"]`).click({force:true});await page.locator(`[aria-label="Square ${to}"]`).click({force:true});await page.waitForFunction(version=>window.__room.version>version,previous);await (page===a?b:a).waitForFunction(moves=>window.__room.game.moves.length===moves,(await room(page)).game.moves.length);assert.deepEqual((await room(a)).game,(await room(b)).game);}
  await resume(b,'#onlineResumeBtn');assert.deepEqual((await room(a)).game,(await room(b)).game);await a.locator('#drawBtn').click({force:true});await b.waitForFunction(()=>window.__room.pending?.type==='draw'&&[...document.querySelectorAll('#onlineRequestBox button')].some(button=>button.textContent==='Accept'&&!button.disabled));await b.locator('#onlineRequestBox button').filter({hasText:'Accept'}).evaluate(el=>el.click());await a.waitForFunction(()=>window.__room.game.result.over);assert.equal((await room(a)).game.result.reason,'agreement');
});
if(selected.has('sorry'))await run('sorry',async({a,b})=>{
  for(const page of [a,b])await page.locator('#playModeChoices [data-value="online"]').click({force:true});await a.locator('#onlineModeChoices [data-value="classic"]').click({force:true});await a.locator('#onlineName').fill('Alice');await a.locator('#createOnlineBtn').click({force:true});await waitRoom(a,()=>!!window.__session?.token);const code=(await room(a)).code;
  await b.locator('#onlineName').fill('Bob');await b.locator('#showJoinBtn').click({force:true});await b.locator('#onlineJoinCode').fill(code);await b.locator('#joinOnlineBtn').click({force:true});await waitRoom(a,()=>window.__room?.ready);await a.locator('#startOnlineBtn').click({force:true});await waitRoom(b,()=>window.__room?.status==='active');await security(a,b);
  for(const page of [a,b])if(await page.locator('#closeRoomBtn').isVisible())await page.locator('#closeRoomBtn').click({force:true});
  let draws=0,movements=0;const deadline=Date.now()+50000;
  while(Date.now()<deadline&&(draws<14||movements<4)){
    const current=await room(a),page=current.turn.seat===0?a:b,other=page===a?b:a;
    await page.waitForFunction(()=>SorryGame.online.canAct());const previous=current.version,phase=current.state.phase;
    if(phase==='draw'){await page.locator('#boardCard').click({force:true});draws++;await page.waitForFunction(version=>window.__room.version>version,previous);await sameState(page,other);if((await room(page)).state.currentCard)assert.equal(await other.locator('#boardCardValue').innerText(),(await room(page)).state.currentCard==='S'?'SORRY!':(await room(page)).state.currentCard);}
    else if(phase==='action'){
      const marker=page.locator('.endpoint-marker:not(.split-step)').first();
      if(await marker.count()){await marker.click({force:true});movements++;}
      else if(await page.locator('.pawn.selectable').count())await page.locator('.pawn.selectable').first().click({force:true});
      else if(await page.locator('#choices .action-btn').count())await page.locator('#choices .action-btn').first().click({force:true});
      else throw Error('Sorry action has no usable controls');
      await page.waitForFunction(version=>window.__room.version>version,previous);await sameState(page,other);
    }else if(phase==='noMove'||phase==='resolving'){await page.waitForFunction(version=>window.__room.version>version,previous);await sameState(page,other);}
    else throw Error('Unexpected classic Sorry phase '+phase);
  }
  assert.ok(draws>=14&&movements>=4,`Sorry covered ${draws} draws and ${movements} movements`);await b.reload();await b.locator('#playModeChoices [data-value="online"]').click({force:true});await b.locator('#resumeOnlineBtn').click({force:true});await waitRoom(b,()=>window.__room?.status==='active');await sameState(a,b);if(await b.locator('#closeRoomBtn').isVisible())await b.locator('#closeRoomBtn').click({force:true});
});
if(selected.has('monopoly'))await run('monopoly',async({a,b})=>{
  for(const page of [a,b])await page.locator('[data-play-mode="online"]').click({force:true});await a.locator('#onlineName').fill('Alice');await a.locator('#createOnlineBtn').click({force:true});await waitRoom(a,()=>!!window.__session?.token);const code=(await room(a)).code;
  await b.locator('#onlineName').fill('Bob');await b.locator('#onlineCode').fill(code);await b.locator('#joinOnlineBtn').click({force:true});await waitRoom(a,()=>window.__room?.ready);await a.locator('#startOnlineBtn').click({force:true});await waitRoom(b,()=>window.__room?.status==='active');await security(a,b);
  let rolls=0,purchases=0,motionStarts=0;const deadline=Date.now()+70000;
  while(Date.now()<deadline&&(rolls<8||purchases<2||motionStarts<4)){
    const current=await room(a),page=current.turn.seat===0?a:b,other=page===a?b:a,previous=current.version;
    await page.waitForFunction(()=>{const online=MonopolyGame.getOnline();return online.connected&&![...document.querySelectorAll('[data-act]')].every(button=>button.disabled);});
    if(current.state.phase==='moving'){await page.waitForFunction(version=>window.__room.version>version,previous);await sameState(page,other);continue;}
    await delay(280);const choices={roll:'roll',offer:'buy',end:current.state.extraRoll?'rollAgain':'end',debt:'payDebt'};
    if(current.state.phase==='cardDraw'){await page.waitForFunction(()=>!document.querySelector('#resolveCardBtn')?.disabled);await page.locator('#resolveCardBtn').evaluate(button=>button.click());}
    else if(choices[current.state.phase]){const choice=choices[current.state.phase],selector=`[data-act="${choice}"]`;await page.waitForFunction(selector=>{const button=document.querySelector(selector);return !!button&&!button.disabled;},selector);await page.locator(selector).first().evaluate(button=>button.click());if(choice==='roll'||choice==='rollAgain')rolls++;if(choice==='buy')purchases++;}
    else throw Error('Unhandled Monopoly phase '+current.state.phase);
    await page.waitForFunction(version=>window.__room.version>version,previous);await sameState(page,other);
    if((await room(page)).state.phase==='moving'){
      motionStarts++;assert.equal((await room(other)).state.pendingMove.cursor,0,'observer receives the canonical movement path before it animates');
      if((await room(page)).state.lastRoll.length)assert.equal(await other.locator('#dice .die').count(),2,'observer sees both dice while token moves');
      await other.waitForFunction(()=>Number(document.querySelector('.moveProgress')?.getAttribute('aria-valuenow'))>0||window.__room.state.phase!=='moving');
    }
  }
  assert.ok(rolls>=8&&purchases>=2&&motionStarts>=4,`Monopoly covered ${rolls} rolls, ${purchases} purchases and ${motionStarts} visible move starts`);await b.reload();await b.locator('[data-play-mode="online"]').click({force:true});await b.locator('#resumeOnlineBtn').click({force:true});await waitRoom(b,()=>window.__room?.status==='active');await sameState(a,b);if(await b.locator('#lobbyClose').isVisible())await b.locator('#lobbyClose').click({force:true});
});
if(selected.has('guess-who'))await run('guess-who',async({a,b})=>{
  await a.locator('#nickname').fill('Alice');await a.locator('#create').click({force:true});await waitRoom(a,()=>!!window.__session?.token);const code=(await room(a)).code;await b.locator('#nickname').fill('Bob');await b.locator('#joinCode').fill(code);await b.locator('#join').click({force:true});await waitRoom(a,()=>window.__room?.ready);await a.locator('#start').click({force:true});
  for(const [page,character] of [[a,'ada'],[b,'ben']]){await page.waitForFunction(()=>document.getElementById('headline').textContent==='Pick your secret character');await page.locator(`[data-character="${character}"]`).click({force:true});await page.locator('#modalActions button').evaluate(el=>el.click());}
  await a.waitForFunction(()=>document.getElementById('headline').textContent.includes('turn'));const actor=await a.locator('#headline').innerText()==='Your turn, detective!'?a:b,other=actor===a?b:a;
  await actor.locator('#question').selectOption('glasses');await actor.locator('#ask').click({force:true});await other.waitForFunction(()=>document.getElementById('headline').textContent==='Your turn, detective!');await actor.waitForFunction(()=>document.querySelectorAll('#clueList .clue').length===1);
  await actor.locator('[data-character="cleo"]').click({force:true});assert.ok((await actor.locator('[data-character="cleo"]').getAttribute('class')).includes('down'));await actor.locator('#undo').click({force:true});assert.ok(!(await actor.locator('[data-character="cleo"]').getAttribute('class')).includes('down'));
  await other.locator('details.custom').evaluate(el=>el.open=true);await other.locator('#customText').fill('Do they like <img src=x onerror="window.BAD=1">?');await other.locator('#askCustom').click({force:true});await actor.locator('#answerPanel').waitFor({state:'visible'});assert.equal(await actor.locator('#pendingText img').count(),0);await actor.locator('[data-answer="unsure"]').click({force:true});await actor.waitForFunction(()=>document.getElementById('headline').textContent==='Your turn, detective!');
  await actor.locator('[data-mode="guess"]').click({force:true});await actor.locator(`[data-character="${actor===a?'ben':'ada'}"]`).click({force:true});await actor.locator('#modalActions button').last().evaluate(el=>el.click());await a.locator('#result').waitFor({state:'visible'});await b.locator('#result').waitFor({state:'visible'});assert.equal(await actor.locator('#resultTitle').innerText(),'You win! 🎉');assert.equal(await a.locator('#reveals .reveal').count(),2);
  await a.locator('#rematch').click({force:true});await b.locator('#rematch').click({force:true});await a.waitForFunction(()=>document.getElementById('headline').textContent==='Pick your secret character');
  for(const [page,character] of [[a,'cleo'],[b,'dex']]){await page.locator(`[data-character="${character}"]`).click({force:true});await page.locator('#modalActions button').evaluate(el=>el.click());}
  await b.waitForFunction(()=>document.getElementById('headline').textContent.includes('turn'));await b.locator('[data-character="wren"]').click({force:true});await resume(b,'#resume');assert.equal(await b.locator('.person.down').count(),1);
});
if(selected.has('shared')){
const sharedGames=(process.env.SHARED_GAMES||'jigsaw,silly-face-lab,bug-squish,trivia,firefighter-frenzy,maze,paint-lab,spelling,math,orb-slicer,mini-golf,bowling,shuffleboard,music-maker,solitaire,hangman,typing,contraption-maker,minesweeper,regex-lab,time,trail,patterns,insultinator,balloons,build-my-joke,monster-dentist,simon,two-truths,mad-libs,blackjack,codebreaking,make-10,bounce-boxes').split(',');
for(const game of sharedGames)await run(game,async({a,b})=>{
  const start=sharedLaunch[game];if(start)await visibleClick(a,start);
  await a.locator('#shared-launch').click({force:true});await a.locator('#shared-name').fill('Alice');await a.locator('#shared-create').click({force:true});await a.waitForFunction(()=>window.ArcadeSharedActivity?.getState().room?.status==='active');const code=(await room(a)).code;await a.locator('#shared-close').click({force:true});
  await b.locator('#shared-launch').click({force:true});await b.locator('#shared-name').fill('Bob');await b.locator('#shared-code').fill(code);await b.locator('#shared-join').click({force:true});await b.waitForFunction(()=>window.ArcadeSharedActivity?.getState().appliedSequence>=0);await b.locator('#shared-close').click({force:true});
  const guest=await b.evaluate(()=>ArcadeSharedActivity.getState());assert.equal(guest.room.state.activity,game);assert.equal(guest.controller,false);assert.equal(await b.locator('#shared-error').innerText(),'','guest applies host checkpoint');
  await sharedSemantic(game,a,b);
  const snapshot=(await sharedPayload(a)).snapshot,automatic=['make-10','blackjack','bowling','shuffleboard'].includes(game)&&snapshot.players?.length===2;
  const owner=await a.evaluate(()=>ArcadeSharedActivity.isController())?a:b,other=owner===a?b:a;
  if(!automatic){
    await owner.locator('#shared-launch').click({force:true});await owner.locator('#shared-pass').click({force:true});await owner.waitForFunction(()=>!ArcadeSharedActivity.isController());await other.waitForFunction(()=>ArcadeSharedActivity.isController());await owner.locator('#shared-close').click({force:true});await delay(350);
    assert.equal(await other.locator('#shared-error').innerText(),'','new controller restores transferable snapshot');assert.equal(await owner.locator('#shared-error').innerText(),'','former controller applies snapshot');
    await other.locator('#shared-launch').click({force:true});await other.locator('#shared-pass').click({force:true});await owner.waitForFunction(()=>ArcadeSharedActivity.isController());await other.waitForFunction(()=>!ArcadeSharedActivity.isController());await other.locator('#shared-close').click({force:true});
  }else{const expected=snapshot.currentPlayer??snapshot.pIdx;if(Number.isInteger(expected))await a.waitForFunction(expected=>ArcadeSharedActivity.getState().room.turn.seat===expected,expected);}
  const spectator=await a.evaluate(()=>ArcadeSharedActivity.isSpectator())?a:b;const socketCount=await spectator.evaluate(()=>window.__sockets.length);await spectator.evaluate(()=>window.__sockets.filter(socket=>socket.readyState===1).forEach(socket=>socket.close(1000,'test reconnect')));await spectator.waitForFunction(count=>window.__sockets.length>count&&ArcadeSharedActivity.getState().connected,socketCount);assert.equal(await spectator.locator('#shared-error').innerText(),'');
  await b.reload();await b.locator('#shared-launch').click({force:true});await b.locator('#shared-resume').click({force:true});await b.waitForFunction(()=>window.ArcadeSharedActivity.getState().active&&window.ArcadeSharedActivity.getState().appliedSequence>=0);assert.equal(await b.locator('#shared-error').innerText(),'');await b.locator('#shared-close').click({force:true});
});
}
}finally{
  await writeFile(new URL(process.env.ONLINE_REPORT_NAME||'report.json',out),JSON.stringify({results,errors},null,2));await writeFile(new URL('server.log',out),serverLog);await browser.close();fixture.kill('SIGTERM');
}
if(results.some(r=>!r.pass)||errors.length)process.exitCode=1;
