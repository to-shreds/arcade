(()=>{
'use strict';
const notes=[['C','C'],['D','D'],['E','E'],['F','F'],['G','G'],['A','A'],['B','B'],['C','C2']];
const drums=[['Kick','kick'],['Snare','snare'],['Tom','tom'],['Clap','clap'],['Hi-Hat','hihat'],['Cymbal','cymbal'],['Shaker','shaker'],['Cowbell','cowbell']];
const colors=[['#ffcf45','#ff8b39'],['#50e6ff','#2b96ff'],['#ff77c9','#d84eff'],['#7cf58c','#2fcb78'],['#ff7c7c','#ff4e72'],['#b29aff','#7657ef'],['#ffe36f','#e7a72e'],['#62f3d0','#28bfb4']];
const rawCache=new Map();
const bufferCache=new Map();
const activeSources=[];
const loopSaveCache=new WeakMap();
const sides=[...document.querySelectorAll('.player')].map(createSide);
let audioContext;
let master;
let compressor;
let workletPromise;
let backingSource;
let backingName='none';
let backingPlaying=false;
let micStream;
let micSource;
let micPromise;
let liveOwner;
let recordingSide;
let recordTimer;

function createSide(root){
  const side={
    root,
    id:Number(root.dataset.player),
    instrument:'piano',
    pitch:'middle',
    pads:root.querySelector('.pads'),
    voicePanel:root.querySelector('.voice-panel'),
    instrumentSelect:root.querySelector('.instrument'),
    pitchBox:root.querySelector('.pitch'),
    backingSelect:root.querySelector('.backing'),
    beatToggle:root.querySelector('.beat-toggle'),
    effectSelect:root.querySelector('.effect'),
    liveButton:root.querySelector('.live'),
    recordButton:root.querySelector('.record'),
    loopButton:root.querySelector('.loop'),
    deleteButton:root.querySelector('.delete-loop'),
    voiceStatus:root.querySelector('.voice-status'),
    pointers:new Map(),
    loopBuffer:null,
    loopSource:null,
    loopChain:null,
    liveChain:null,
    recorder:null,
    recorderMute:null,
    recordChunks:[]
  };
  root.querySelector('.home').addEventListener('click',goHome);
  side.instrumentSelect.addEventListener('change',()=>{
    side.instrument=side.instrumentSelect.value;
    if(side.instrument!=='voice'){
      if(liveOwner===side)stopLive(side);
      if(recordingSide===side)stopRecording(side,false);
    }
    renderSide(side);
    prefetchSelection(side);
  });
  side.pitchBox.querySelectorAll('button').forEach(button=>button.addEventListener('click',()=>{
    side.pitch=button.dataset.pitch;
    side.pitchBox.querySelectorAll('button').forEach(item=>item.classList.toggle('active',item===button));
    prefetchSelection(side);
  }));
  side.backingSelect.addEventListener('change',()=>setBacking(side.backingSelect.value));
  side.beatToggle.addEventListener('click',toggleBacking);
  side.effectSelect.addEventListener('change',()=>refreshVoiceEffect(side));
  side.liveButton.addEventListener('click',()=>toggleLive(side));
  side.recordButton.addEventListener('click',()=>toggleRecording(side));
  side.loopButton.addEventListener('click',()=>toggleLoop(side));
  side.deleteButton.addEventListener('click',()=>deleteLoop(side));
  renderSide(side);
  return side;
}

function renderSide(side){
  const voice=side.instrument==='voice';
  side.pads.hidden=voice;
  side.voicePanel.hidden=!voice;
  side.pitchBox.hidden=voice||side.instrument==='drums';
  if(voice)return;
  side.pads.replaceChildren();
  const values=side.instrument==='drums'?drums:notes;
  values.forEach((item,index)=>{
    const button=document.createElement('button');
    button.type='button';
    button.className='pad';
    button.textContent=item[0];
    button.dataset.value=item[1];
    button.dataset.small=side.instrument==='drums'?item[0]:side.pitch;
    button.style.setProperty('--pad-top',colors[index][0]);
    button.style.setProperty('--pad-bottom',colors[index][1]);
    button.addEventListener('pointerdown',event=>startPad(side,button,event));
    button.addEventListener('pointerup',event=>releasePad(side,event.pointerId));
    button.addEventListener('pointercancel',event=>releasePad(side,event.pointerId));
    button.addEventListener('lostpointercapture',event=>releasePad(side,event.pointerId));
    button.addEventListener('contextmenu',event=>event.preventDefault());
    side.pads.append(button);
  });
}

function samplePath(side,value){
  if(side.instrument==='drums')return `samples/drums/${value}.wav`;
  return `samples/${side.instrument}/${side.pitch}-${value}.wav`;
}

async function prefetch(path){
  if(rawCache.has(path))return rawCache.get(path);
  const promise=fetch(path,{cache:'force-cache'}).then(response=>{if(!response.ok)throw new Error('Missing audio');return response.arrayBuffer()});
  rawCache.set(path,promise);
  return promise;
}

function prefetchSelection(side){
  if(side.instrument==='voice')return;
  const values=side.instrument==='drums'?drums:notes;
  values.forEach(item=>prefetch(samplePath(side,item[1])).catch(()=>{}));
}

async function ensureAudio(){
  if(!audioContext){
    const AudioContext=window.AudioContext||window.webkitAudioContext;
    audioContext=new AudioContext({latencyHint:'interactive'});
    master=audioContext.createGain();
    master.gain.value=.58;
    compressor=audioContext.createDynamicsCompressor();
    compressor.threshold.value=-18;
    compressor.knee.value=14;
    compressor.ratio.value=9;
    compressor.attack.value=.003;
    compressor.release.value=.22;
    master.connect(compressor).connect(audioContext.destination);
  }
  if(audioContext.state==='suspended')await audioContext.resume();
  return audioContext;
}

async function ensureWorklet(){
  const context=await ensureAudio();
  if(!workletPromise)workletPromise=context.audioWorklet.addModule('audio/pitch-processor.js');
  await workletPromise;
}

async function getBuffer(path){
  await ensureAudio();
  if(bufferCache.has(path))return bufferCache.get(path);
  const promise=prefetch(path).then(raw=>audioContext.decodeAudioData(raw.slice(0)));
  bufferCache.set(path,promise);
  return promise;
}

async function startPad(side,pad,event){
  event.preventDefault();
  try{pad.setPointerCapture(event.pointerId)}catch(e){}
  const state={pad,source:null,gain:null};
  side.pointers.set(event.pointerId,state);
  pad.classList.add('pressed');
  const path=samplePath(side,pad.dataset.value);
  try{
    const buffer=await getBuffer(path);
    if(side.pointers.get(event.pointerId)!==state)return;
    const source=audioContext.createBufferSource();
    const gain=audioContext.createGain();
    source.buffer=buffer;
    gain.gain.setValueAtTime(side.instrument==='drums'?.72:.58,audioContext.currentTime);
    source.connect(gain).connect(master);
    state.source=source;
    state.gain=gain;
    trackSource(source,gain);
    source.start();
  }catch(error){setStatus(side,'Sound file unavailable')}
}

function trackSource(source,gain){
  activeSources.push({source,gain});
  while(activeSources.length>48){
    const old=activeSources.shift();
    try{old.source.stop()}catch(e){}
    try{old.source.disconnect();old.gain.disconnect()}catch(e){}
  }
  source.addEventListener('ended',()=>{
    const index=activeSources.findIndex(item=>item.source===source);
    if(index>=0)activeSources.splice(index,1);
    try{source.disconnect();gain.disconnect()}catch(e){}
  },{once:true});
}

function releasePad(side,pointerId){
  const state=side.pointers.get(pointerId);
  if(!state)return;
  side.pointers.delete(pointerId);
  state.pad.classList.remove('pressed');
  if(state.source&&side.instrument!=='drums'){
    const now=audioContext.currentTime;
    try{state.gain.gain.cancelScheduledValues(now);state.gain.gain.setTargetAtTime(0,now,.025);state.source.stop(now+.12)}catch(e){}
  }
}

async function setBacking(name){
  backingName=name;
  sides.forEach(side=>side.backingSelect.value=name);
  stopBacking(false);
  if(name==='none'){updateBackingUi();return}
  try{
    const buffer=await getBuffer(`background/${name}.wav`);
    if(backingName!==name)return;
    const source=audioContext.createBufferSource();
    const gain=audioContext.createGain();
    source.buffer=buffer;
    source.loop=true;
    gain.gain.value=.28;
    source.connect(gain).connect(master);
    source._arcadeGain=gain;
    source.start();
    backingSource=source;
    backingPlaying=true;
    updateBackingUi();
  }catch(error){
    backingPlaying=false;
    updateBackingUi();
    sides.forEach(side=>setStatus(side,'Backing track unavailable'));
  }
}

function stopBacking(keepChoice=true){
  if(backingSource){
    try{backingSource.stop();backingSource.disconnect();backingSource._arcadeGain.disconnect()}catch(e){}
  }
  backingSource=null;
  backingPlaying=false;
  if(!keepChoice)updateBackingUi();
}

function toggleBacking(){
  if(backingPlaying){stopBacking();updateBackingUi();return}
  let name=backingName;
  if(name==='none')name='pop';
  setBacking(name);
}

function updateBackingUi(){
  sides.forEach(side=>{
    side.backingSelect.value=backingName;
    side.beatToggle.textContent=backingPlaying?'■':'▶';
    side.beatToggle.classList.toggle('active',backingPlaying);
  });
}

async function ensureMic(side){
  await ensureAudio();
  if(micStream&&micStream.active)return;
  if(micPromise)return micPromise;
  if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia)throw new Error('Microphone unavailable');
  micPromise=navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false}).then(stream=>{
    micStream=stream;
    micSource=audioContext.createMediaStreamSource(stream);
  }).finally(()=>{micPromise=null});
  try{await micPromise}catch(error){setStatus(side,'Microphone permission needed');throw error}
}

async function makeVoiceChain(effect,level){
  await ensureWorklet();
  const input=audioContext.createGain();
  const output=audioContext.createGain();
  output.gain.value=level;
  output.connect(master);
  const nodes=[input,output];
  const oscillators=[];
  function pipe(...parts){for(let i=0;i<parts.length-1;i++)parts[i].connect(parts[i+1]);parts.slice(1).forEach(node=>nodes.push(node))}
  function pitch(ratio){const node=new AudioWorkletNode(audioContext,'arcade-pitch');node.parameters.get('ratio').value=ratio;return node}
  function filter(type,frequency,q=1){const node=audioContext.createBiquadFilter();node.type=type;node.frequency.value=frequency;node.Q.value=q;return node}
  function ring(frequency){
    const gain=audioContext.createGain();gain.gain.value=.5;
    const oscillator=audioContext.createOscillator();oscillator.type='sine';oscillator.frequency.value=frequency;
    const depth=audioContext.createGain();depth.gain.value=.5;
    oscillator.connect(depth).connect(gain.gain);oscillator.start();
    oscillators.push(oscillator);nodes.push(depth);return gain;
  }
  if(effect==='chipmunk')pipe(input,pitch(1.42),filter('highpass',180),output);
  else if(effect==='monster')pipe(input,pitch(.72),filter('lowpass',1700),output);
  else if(effect==='robot')pipe(input,filter('bandpass',1400,.7),ring(43),output);
  else if(effect==='alien'){
    const band=filter('bandpass',1850,2.2);const mod=ring(13);const delay=audioContext.createDelay(.5);delay.delayTime.value=.115;
    pipe(input,band,mod,output);mod.connect(delay).connect(output);nodes.push(delay);
  }
  else if(effect==='echo'){
    const delay=audioContext.createDelay(.8);delay.delayTime.value=.24;
    const feedback=audioContext.createGain();feedback.gain.value=.34;
    input.connect(output);input.connect(delay);delay.connect(feedback).connect(delay);delay.connect(output);nodes.push(delay,feedback);
  }
  else if(effect==='tiny')pipe(input,pitch(1.72),filter('highpass',300),output);
  else if(effect==='giant')pipe(input,pitch(.58),filter('lowpass',1250),output);
  else pipe(input,filter('highpass',75),output);
  return{
    input,
    stop(){oscillators.forEach(oscillator=>{try{oscillator.stop()}catch(e){}});nodes.forEach(node=>{try{node.disconnect()}catch(e){}})}
  };
}

async function toggleLive(side){
  if(liveOwner===side){stopLive(side);return}
  if(recordingSide){setStatus(side,'Finish recording first');return}
  if(liveOwner)stopLive(liveOwner);
  try{
    await ensureMic(side);
    side.liveChain=await makeVoiceChain(side.effectSelect.value,.42);
    micSource.connect(side.liveChain.input);
    liveOwner=side;
    side.liveButton.classList.add('active');
    side.liveButton.textContent='Stop Live';
    setStatus(side,'Live voice on');
  }catch(error){}
}

function stopLive(side){
  if(!side)return;
  if(side.liveChain){
    try{micSource.disconnect(side.liveChain.input)}catch(e){}
    side.liveChain.stop();
    side.liveChain=null;
  }
  if(liveOwner===side)liveOwner=null;
  side.liveButton.classList.remove('active');
  side.liveButton.textContent='Live Voice';
  setStatus(side,'Mic is local');
  stopMicIfIdle();
}

async function refreshVoiceEffect(side){
  if(liveOwner===side){
    if(side.liveChain){try{micSource.disconnect(side.liveChain.input)}catch(e){}side.liveChain.stop()}
    side.liveChain=await makeVoiceChain(side.effectSelect.value,.42);
    micSource.connect(side.liveChain.input);
  }
  if(side.loopSource){stopLoop(side);startLoop(side)}
}

async function toggleRecording(side){
  if(recordingSide===side){stopRecording(side,true);return}
  if(recordingSide){setStatus(side,'Other player is recording');return}
  if(liveOwner)stopLive(liveOwner);
  try{
    await ensureMic(side);
    await ensureWorklet();
    stopLoop(side);
    side.recordChunks=[];
    side.recorder=new AudioWorkletNode(audioContext,'arcade-recorder');
    side.recorderMute=audioContext.createGain();
    side.recorderMute.gain.value=0;
    side.recorder.port.onmessage=event=>side.recordChunks.push(event.data);
    micSource.connect(side.recorder);
    side.recorder.connect(side.recorderMute).connect(master);
    side.recorder.port.postMessage('start');
    recordingSide=side;
    side.recordButton.classList.add('active');
    side.recordButton.textContent='Stop Recording';
    setStatus(side,'Recording… tap to stop');
    recordTimer=setTimeout(()=>stopRecording(side,true),6000);
  }catch(error){}
}

function stopRecording(side,keep){
  if(recordingSide!==side)return;
  clearTimeout(recordTimer);
  try{side.recorder.port.postMessage('stop');micSource.disconnect(side.recorder);side.recorder.disconnect();side.recorderMute.disconnect()}catch(e){}
  side.recorder=null;
  side.recorderMute=null;
  recordingSide=null;
  side.recordButton.classList.remove('active');
  side.recordButton.textContent='Record Loop';
  if(keep&&side.recordChunks.length){
    const total=side.recordChunks.reduce((sum,chunk)=>sum+chunk.length,0);
    if(total>0){
      const buffer=audioContext.createBuffer(1,total,audioContext.sampleRate);
      const data=buffer.getChannelData(0);
      let offset=0;
      side.recordChunks.forEach(chunk=>{data.set(chunk,offset);offset+=chunk.length});
      const fade=Math.min(256,Math.floor(total/4));
      for(let i=0;i<fade;i++){data[i]*=i/fade;data[total-1-i]*=i/fade}
      side.loopBuffer=buffer;
      side.loopButton.disabled=false;
      side.deleteButton.disabled=false;
      side.loopButton.textContent='Stop Loop';
      setStatus(side,`${(total/audioContext.sampleRate).toFixed(1)}s loop ready`);
      startLoop(side);
    }
  }else setStatus(side,'Recording stopped');
  side.recordChunks=[];
  stopMicIfIdle();
}

async function startLoop(side){
  if(!side.loopBuffer||side.loopSource)return;
  await ensureAudio();
  const source=audioContext.createBufferSource();
  source.buffer=side.loopBuffer;
  source.loop=true;
  const chain=await makeVoiceChain(side.effectSelect.value,.48);
  source.connect(chain.input);
  source.start();
  side.loopSource=source;
  side.loopChain=chain;
  side.loopButton.classList.add('active');
  side.loopButton.textContent='Stop Loop';
  setStatus(side,'Voice loop playing');
}

function stopLoop(side){
  if(side.loopSource){try{side.loopSource.stop();side.loopSource.disconnect()}catch(e){}}
  if(side.loopChain)side.loopChain.stop();
  side.loopSource=null;
  side.loopChain=null;
  side.loopButton.classList.remove('active');
  side.loopButton.textContent='Play Loop';
}

function toggleLoop(side){
  if(side.loopSource)stopLoop(side);else startLoop(side);
}

function deleteLoop(side){
  stopLoop(side);
  side.loopBuffer=null;
  side.loopButton.disabled=true;
  side.deleteButton.disabled=true;
  setStatus(side,'Loop deleted');
}

function stopMicIfIdle(){
  if(liveOwner||recordingSide)return;
  if(micSource){try{micSource.disconnect()}catch(e){}micSource=null}
  if(micStream){micStream.getTracks().forEach(track=>track.stop());micStream=null}
}

function setStatus(side,text){side.voiceStatus.textContent=text}

function goHome(){
  const leave=()=>{shutdown();if(window.ArcadeNative&&ArcadeNative.goHome)ArcadeNative.goHome();else location.href='../index.html';};
  if(window.ArcadeSave)window.ArcadeSave.saveNow().finally(leave);else leave();
}

function pauseMicrophone(){
  if(recordingSide)stopRecording(recordingSide,false);
  if(liveOwner)stopLive(liveOwner);
  stopMicIfIdle();
}

function pauseAllAudio(){
  pauseMicrophone();
  sides.forEach(side=>{
    side.pointers.forEach(state=>state.pad.classList.remove('pressed'));
    side.pointers.clear();
    stopLoop(side);
  });
  stopBacking();
  updateBackingUi();
  activeSources.splice(0).forEach(item=>{try{item.source.stop();item.source.disconnect();item.gain.disconnect()}catch(e){}});
  if(audioContext&&audioContext.state==='running')audioContext.suspend().catch(()=>{});
}

function shutdown(){
  pauseAllAudio();
  if(audioContext&&audioContext.state!=='closed')audioContext.close();
}

function bytesToBase64(bytes){
  let binary='';const chunk=0x8000;
  for(let i=0;i<bytes.length;i+=chunk)binary+=String.fromCharCode.apply(null,bytes.subarray(i,Math.min(bytes.length,i+chunk)));
  return btoa(binary);
}

function base64ToBytes(text){
  const binary=atob(text);const bytes=new Uint8Array(binary.length);
  for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
  return bytes;
}

function encodeLoop(buffer){
  if(!buffer)return null;
  if(loopSaveCache.has(buffer))return loopSaveCache.get(buffer);
  const samples=new Float32Array(buffer.length);samples.set(buffer.getChannelData(0));
  const saved={sampleRate:buffer.sampleRate,length:samples.length,data:bytesToBase64(new Uint8Array(samples.buffer))};
  loopSaveCache.set(buffer,saved);return saved;
}

async function decodeLoop(saved){
  if(!saved||typeof saved.data!=='string')return null;
  const sampleRate=Math.max(8000,Math.min(192000,Number(saved.sampleRate)||44100));
  const length=Math.max(0,Math.min(sampleRate*10,parseInt(saved.length,10)||0));
  const bytes=base64ToBytes(saved.data);
  if(!length||bytes.byteLength!==length*4)throw new Error('Invalid saved voice loop');
  const floats=new Float32Array(bytes.buffer,bytes.byteOffset,length);
  const context=await ensureAudio();const buffer=context.createBuffer(1,length,sampleRate);
  buffer.getChannelData(0).set(floats);return buffer;
}

function captureMusicMaker(){
  return{
    sides:sides.map(side=>({instrument:side.instrument,pitch:side.pitch,effect:side.effectSelect.value,loop:encodeLoop(side.loopBuffer)})),
    backingName,backingPlaying
  };
}

async function restoreMusicMaker(saved){
  if(!saved||!Array.isArray(saved.sides)||saved.sides.length!==sides.length)throw new Error('Invalid Music Maker save');
  pauseAllAudio();
  const validInstruments=new Set(['piano','xylophone','guitar','bass','synth','bells','drums','voice']);
  const validPitches=new Set(['low','middle','high']);
  const validEffects=new Set(['normal','chipmunk','monster','robot','alien','echo','tiny','giant']);
  for(let i=0;i<sides.length;i++){
    const side=sides[i],data=saved.sides[i]||{};
    side.instrument=validInstruments.has(data.instrument)?data.instrument:'piano';
    side.pitch=validPitches.has(data.pitch)?data.pitch:'middle';
    side.instrumentSelect.value=side.instrument;
    side.pitchBox.querySelectorAll('button').forEach(button=>button.classList.toggle('active',button.dataset.pitch===side.pitch));
    side.effectSelect.value=validEffects.has(data.effect)?data.effect:'normal';
    side.loopBuffer=await decodeLoop(data.loop);
    side.loopButton.disabled=!side.loopBuffer;side.deleteButton.disabled=!side.loopBuffer;
    if(side.loopBuffer)setStatus(side,`${(side.loopBuffer.length/side.loopBuffer.sampleRate).toFixed(1)}s saved loop`);else setStatus(side,'Mic is local');
    renderSide(side);prefetchSelection(side);
  }
  const validBacking=new Set(['none','pop','funk','chill','dance']);
  backingName=validBacking.has(saved.backingName)?saved.backingName:'none';backingPlaying=false;backingSource=null;updateBackingUi();
}

function freshMusicMaker(){
  pauseAllAudio();backingName='none';backingPlaying=false;
  sides.forEach(side=>{
    side.instrument='piano';side.pitch='middle';side.instrumentSelect.value='piano';side.effectSelect.value='normal';side.loopBuffer=null;
    side.loopButton.disabled=true;side.deleteButton.disabled=true;side.pitchBox.querySelectorAll('button').forEach(button=>button.classList.toggle('active',button.dataset.pitch==='middle'));
    setStatus(side,'Mic is local');renderSide(side);prefetchSelection(side);
  });
  updateBackingUi();
}

window.MusicMakerAutosave={
  id:'music-maker',title:'Music Maker',version:1,capture:captureMusicMaker,restore:restoreMusicMaker,
  meaningful:()=>backingName!=='none'||sides.some(side=>side.instrument!=='piano'||side.pitch!=='middle'||side.effectSelect.value!=='normal'||!!side.loopBuffer),
  summary:()=>{const loops=sides.filter(side=>side.loopBuffer).length;return loops?loops+(loops===1?' saved voice loop':' saved voice loops'):'Saved instruments';},
  startFresh:freshMusicMaker
};

sides.forEach(prefetchSelection);
['pop','funk','chill','dance'].forEach(name=>prefetch(`background/${name}.wav`).catch(()=>{}));
window.addEventListener('arcadepause',pauseAllAudio);
window.addEventListener('pagehide',shutdown,{once:true});
document.addEventListener('visibilitychange',()=>{if(document.hidden)pauseAllAudio()});
})();
