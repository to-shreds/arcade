(()=>{
'use strict';
const notes=[['C','C'],['D','D'],['E','E'],['F','F'],['G','G'],['A','A'],['B','B'],['C','C2']];
const drums=[['Kick','kick'],['Snare','snare'],['Tom','tom'],['Clap','clap'],['Hi-Hat','hihat'],['Cymbal','cymbal'],['Shaker','shaker'],['Cowbell','cowbell']];
const colors=[['#ffcf45','#ff8b39'],['#50e6ff','#2b96ff'],['#ff77c9','#d84eff'],['#7cf58c','#2fcb78'],['#ff7c7c','#ff4e72'],['#b29aff','#7657ef'],['#ffe36f','#e7a72e'],['#62f3d0','#28bfb4']];
const rawCache=new Map();
const bufferCache=new Map();
const activeSources=[];
const loopSaveCache=new WeakMap();
const sharedLoopCache=new WeakMap();
const sharedNoteEvents=[];
const heardSharedNotes=new Set();
const sharedRemoteNotes=new Map();
const noteSession=Date.now().toString(36)+Math.random().toString(36).slice(2,8);
let noteSerial=0;
let sharedMusicEpoch=0;
let backingStartedAt=0;
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
    [...side.pads.children].forEach(pad=>{pad.dataset.small=side.instrument==='drums'?pad.textContent:side.pitch;});
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
  if(window.ArcadeSharedActivity&&ArcadeSharedActivity.isSpectator())return;
  try{pad.setPointerCapture(event.pointerId)}catch(e){}
  const path=samplePath(side,pad.dataset.value);
  const note={id:noteSession+':'+(++noteSerial),side:side.id,value:pad.dataset.value,path,at:Date.now(),drum:side.instrument==='drums'};
  sharedNoteEvents.push(note);
  if(sharedNoteEvents.length>64)sharedNoteEvents.shift();
  const state={pad,source:null,gain:null,note};
  side.pointers.set(event.pointerId,state);
  pad.classList.add('pressed');
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
  if(state.note)state.note.endedAt=Date.now();
  state.pad.classList.remove('pressed');
  if(state.source&&side.instrument!=='drums'){
    const now=audioContext.currentTime;
    try{state.gain.gain.cancelScheduledValues(now);state.gain.gain.setTargetAtTime(0,now,.025);state.source.stop(now+.12)}catch(e){}
  }
}

async function setBacking(name,startOffset=0){
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
    source.start(0,Math.max(0,startOffset)%buffer.duration);
    backingStartedAt=Date.now()-Math.max(0,startOffset)*1000;
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
  if(window.ArcadeSharedActivity&&ArcadeSharedActivity.isSpectator())throw new Error('Take control before using the microphone');
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

async function startLoop(side,startOffset=0){
  if(!side.loopBuffer||side.loopSource)return;
  await ensureAudio();
  const source=audioContext.createBufferSource();
  source.buffer=side.loopBuffer;
  source.loop=true;
  const chain=await makeVoiceChain(side.effectSelect.value,.48);
  source.connect(chain.input);
  source.start(0,Math.max(0,startOffset)%side.loopBuffer.duration);
  side.loopStartedAt=Date.now()-Math.max(0,startOffset)*1000;
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
  shutdown();
  ArcadeSave.goHome();
}

function pauseMicrophone(){
  if(recordingSide)stopRecording(recordingSide,false);
  if(liveOwner)stopLive(liveOwner);
  stopMicIfIdle();
}

function pauseAllAudio(){
  sharedMusicEpoch++;
  sharedRemoteNotes.clear();
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

function encodeSharedLoop(buffer){
  if(!buffer)return null;
  if(sharedLoopCache.has(buffer))return sharedLoopCache.get(buffer);
  // Six-second voice loops use a small transport copy; local autosaves retain
  // the original full-quality recording.
  const sampleRate=4000,length=Math.min(sampleRate*6,Math.floor(buffer.duration*sampleRate));
  const source=buffer.getChannelData(0),bytes=new Uint8Array(Math.ceil(length/2));
  for(let i=0;i<length;i++){
    const start=Math.floor(i*buffer.sampleRate/sampleRate),end=Math.min(source.length,Math.max(start+1,Math.floor((i+1)*buffer.sampleRate/sampleRate)));
    let sum=0;for(let j=start;j<end;j++)sum+=source[j];
    const sample=Math.max(-1,Math.min(1,sum/Math.max(1,end-start)));
    const packed=Math.round(Math.log1p(15*Math.abs(sample))/Math.log(16)*7)+(sample<0?8:0);
    bytes[i>>1]|=packed<<((i%2)*4);
  }
  const saved={codec:'pcm4',sampleRate,length,data:bytesToBase64(bytes)};
  sharedLoopCache.set(buffer,saved);return saved;
}

async function decodeSharedLoop(saved){
  if(!saved)return null;
  if(saved.codec!=='pcm4'||saved.sampleRate!==4000||typeof saved.data!=='string'||saved.data.length>16000)throw new Error('Invalid shared voice loop');
  const bytes=base64ToBytes(saved.data),length=Number(saved.length);
  if(!Number.isInteger(length)||length<1||length>24000||bytes.length!==Math.ceil(length/2))throw new Error('Invalid shared voice loop');
  // AudioBuffer requires at least 8kHz, so expand the 4kHz transport samples.
  const context=await ensureAudio(),buffer=context.createBuffer(1,length*2,8000),samples=buffer.getChannelData(0);
  for(let i=0;i<length;i++){
    const packed=(bytes[i>>1]>>((i%2)*4))&15;
    const sample=Math.expm1((packed&7)/7*Math.log(16))/15*(packed&8?-1:1);
    samples[i*2]=samples[i*2+1]=sample;
  }
  return buffer;
}

function captureSharedMusic(){
  const now=Date.now();
  const heldNotes=sides.flatMap(side=>[...side.pointers.values()].filter(state=>state.note).map(state=>state.note));
  const recentNotes=new Map(sharedNoteEvents.filter(note=>now-note.at<2500).map(note=>[note.id,note]));
  heldNotes.forEach(note=>recentNotes.set(note.id,note));
  return {
    capturedAt:now,backingName,backingPlaying,backingElapsedMs:backingPlaying?Math.max(0,now-backingStartedAt):0,
    sides:sides.map(side=>({id:side.id,instrument:side.instrument,pitch:side.pitch,effect:side.effectSelect.value,
      loop:encodeSharedLoop(side.loopBuffer),loopPlaying:!!side.loopSource,loopElapsedMs:side.loopSource?Math.max(0,now-side.loopStartedAt):0,
      status:side.voiceStatus.textContent,
      activeNotes:[...side.pointers.values()].filter(state=>state.note).map(state=>state.note.id)})),
    notes:[...recentNotes.values()].slice(-64).map(note=>({...note}))
  };
}

async function playSharedNote(note,side){
  const values=note.drum?drums:notes;
  if(!values.some(item=>item[1]===note.value)||typeof note.path!=='string'||!/^samples\/(piano|xylophone|guitar|bass|synth|bells|drums)\/[a-zA-Z0-9-]+\.wav$/.test(note.path))return;
  const state={pad:[...side.pads.children].find(pad=>pad.dataset.value===note.value),source:null,gain:null,drum:!!note.drum};
  sharedRemoteNotes.set(note.id,state);
  const token=sharedMusicEpoch;
  try{
    const buffer=await getBuffer(note.path);
    if(token!==sharedMusicEpoch||sharedRemoteNotes.get(note.id)!==state)return;
    const source=audioContext.createBufferSource(),gain=audioContext.createGain();
    source.buffer=buffer;gain.gain.value=note.drum?.72:.58;source.connect(gain).connect(master);
    state.source=source;state.gain=gain;trackSource(source,gain);source.start();
    if((note.endedAt||state.released)&&!note.drum)source.stop(audioContext.currentTime+Math.max(.08,Math.min(.7,((Number(note.endedAt)||note.at+120)-note.at)/1000)));
    source.addEventListener('ended',()=>{if(sharedRemoteNotes.get(note.id)===state)sharedRemoteNotes.delete(note.id)},{once:true});
  }catch(_){sharedRemoteNotes.delete(note.id);}
}

async function restoreSharedMusic(saved,options={}){
  if(!saved||!Array.isArray(saved.sides)||saved.sides.length!==sides.length)throw new Error('Invalid shared Music Maker state');
  // The microphone stream is never transferred. Only explicitly recorded loops
  // and played instrument samples belong to the shared room.
  pauseMicrophone();
  const validInstruments=new Set(['piano','xylophone','guitar','bass','synth','bells','drums','voice']);
  const validPitches=new Set(['low','middle','high']),validEffects=new Set(['normal','chipmunk','monster','robot','alien','echo','tiny','giant']);
  const elapsed=Math.max(0,Math.min(2500,Date.now()-(Number(saved.capturedAt)||Date.now())))/1000;
  const active=new Set();
  for(let i=0;i<sides.length;i++){
    const side=sides[i],data=saved.sides[i]||{};
    const instrument=validInstruments.has(data.instrument)?data.instrument:'piano',pitch=validPitches.has(data.pitch)?data.pitch:'middle';
    const effect=validEffects.has(data.effect)?data.effect:'normal';
    const redraw=side.instrument!==instrument||side.pitch!==pitch,effectChanged=side.effectSelect.value!==effect;
    side.instrument=instrument;side.pitch=pitch;side.instrumentSelect.value=instrument;side.effectSelect.value=effect;
    side.pitchBox.querySelectorAll('button').forEach(button=>button.classList.toggle('active',button.dataset.pitch===pitch));
    if(redraw){renderSide(side);prefetchSelection(side);}
    const loopKey=data.loop?data.loop.data:'';
    if(side.sharedLoopKey!==loopKey){
      stopLoop(side);side.loopBuffer=await decodeSharedLoop(data.loop);side.sharedLoopKey=loopKey;
      side.loopButton.disabled=!side.loopBuffer;side.deleteButton.disabled=!side.loopBuffer;
    }
    if(effectChanged&&side.loopSource)stopLoop(side);
    if(data.loopPlaying&&side.loopBuffer&&!side.loopSource)await startLoop(side,Math.max(0,Number(data.loopElapsedMs)||0)/1000+elapsed);
    else if(!data.loopPlaying&&side.loopSource)stopLoop(side);
    if(data.loopPlaying)setStatus(side,'Voice loop playing · compact shared audio');
    else setStatus(side,String(data.status||'Mic is local').slice(0,120));
    (Array.isArray(data.activeNotes)?data.activeNotes:[]).forEach(id=>active.add(id));
  }
  const validBacking=new Set(['none','pop','funk','chill','dance']),name=validBacking.has(saved.backingName)?saved.backingName:'none';
  if(saved.backingPlaying&&name!=='none'){
    if(!backingPlaying||backingName!==name)await setBacking(name,Math.max(0,Number(saved.backingElapsedMs)||0)/1000+elapsed);
  }else{if(backingPlaying)stopBacking();backingName=name;updateBackingUi();}
  for(const note of (Array.isArray(saved.notes)?saved.notes:[]).slice(-64)){
    if(!note||typeof note.id!=='string')continue;
    const side=sides.find(item=>item.id===note.side);if(!side)continue;
    if(!heardSharedNotes.has(note.id)&&Date.now()-Number(note.at)<2500){heardSharedNotes.add(note.id);playSharedNote(note,side);}
  }
  while(heardSharedNotes.size>512)heardSharedNotes.delete(heardSharedNotes.values().next().value);
  for(const [id,state]of sharedRemoteNotes){
    if(!active.has(id)){
      if(!state.drum&&!state.released){state.released=true;if(state.source)try{state.gain.gain.setTargetAtTime(0,audioContext.currentTime,.025);state.source.stop(audioContext.currentTime+.12)}catch(_){}}
    }
  }
  sides.forEach(side=>{
    const data=saved.sides.find(item=>item.id===side.id)||{},ids=new Set(data.activeNotes||[]);
    const values=new Set((saved.notes||[]).filter(note=>ids.has(note.id)).map(note=>note.value));
    [...side.pads.children].forEach(pad=>pad.classList.toggle('pressed',values.has(pad.dataset.value)));
  });
  if(!options.spectator){sharedNoteEvents.length=0;sharedMusicEpoch++;}
  return true;
}

function captureLocalMusic(){
  const now=Date.now(),saved=captureMusicMaker();
  saved.backingElapsedMs=backingPlaying?Math.max(0,now-backingStartedAt):0;
  saved.sides.forEach((data,i)=>{data.loopPlaying=!!sides[i].loopSource;data.loopElapsedMs=data.loopPlaying?Math.max(0,now-sides[i].loopStartedAt):0;});
  return saved;
}

async function restoreLocalMusic(saved){
  await restoreMusicMaker(saved);
  if(saved.backingPlaying&&backingName!=='none')await setBacking(backingName,Math.max(0,Number(saved.backingElapsedMs)||0)/1000);
  for(let i=0;i<sides.length;i++)if(saved.sides[i]?.loopPlaying&&sides[i].loopBuffer)await startLoop(sides[i],Math.max(0,Number(saved.sides[i].loopElapsedMs)||0)/1000);
  return true;
}

window.MusicMakerSharedAdapter={capture:captureSharedMusic,restore:restoreSharedMusic,captureLocal:captureLocalMusic,restoreLocal:restoreLocalMusic,startFresh:freshMusicMaker};

window.MusicMakerAutosave={
  id:'music-maker',title:'Music Maker',version:1,capture:captureMusicMaker,restore:restoreMusicMaker,
  meaningful:()=>backingName!=='none'||sides.some(side=>side.instrument!=='piano'||side.pitch!=='middle'||side.effectSelect.value!=='normal'||!!side.loopBuffer),
  summary:()=>{const loops=sides.filter(side=>side.loopBuffer).length;return loops?loops+(loops===1?' saved voice loop':' saved voice loops'):'Saved instruments';},
  startFresh:freshMusicMaker
};

sides.forEach(prefetchSelection);
['pop','funk','chill','dance'].forEach(name=>prefetch(`background/${name}.wav`).catch(()=>{}));
// Joining a room is a user gesture, so unlock audio while that gesture is live.
for(const event of ['pointerdown','pointerup','click','touchend'])document.addEventListener(event,()=>{ensureAudio().catch(()=>{})},{capture:true,passive:true});
window.addEventListener('arcadepause',pauseAllAudio);
window.addEventListener('pagehide',shutdown,{once:true});
document.addEventListener('visibilitychange',()=>{if(document.hidden)pauseAllAudio()});
})();
