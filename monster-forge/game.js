(()=>{
'use strict';
const NS='http://www.w3.org/2000/svg', W=900,H=600;
const $=id=>document.getElementById(id);
const palette=['#18253b','#ffffff','#e84756','#ffce3a','#ff8b32','#72e985','#21dcff','#6b86ff','#9b7cff','#ff5ac8','#b47747','#7a98ab','#373446','#f7cbb1'];
const sceneNames={blank:'Sketchbook',swamp:'Swamp',lava:'Volcano',cave:'Cave',space:'Alien planet',city:'City',sea:'Underwater'};
const catalog={
  Bodies:[['blob','Blob'],['fuzzy','Fuzzy'],['slime','Slime'],['rock','Rock'],['serpent','Serpent'],['shell','Shell']],
  Eyes:[['eye','Eye'],['cyclops','Big eye'],['stalk','Eye stalk'],['sleepy','Sleepy eye'],['manyeyes','Many eyes']],
  Mouths:[['fangs','Fangs'],['grin','Grin'],['beak','Beak'],['jaw','Big jaws']],
  Horns:[['horns','Horns'],['antlers','Antlers'],['spikes','Spikes'],['antenna','Feelers']],
  Limbs:[['claw','Claw'],['tentacle','Tentacle'],['foot','Big foot'],['fin','Fin'],['wing','Wings'],['batwing','Bat wing'],['tail','Tail'],['stinger','Stinger']],
  Extras:[['spots','Spots'],['scales','Scales'],['flames','Flames'],['bolt','Lightning'],['gear','Robot gear'],['cloud','Spooky mist']]
};
const partLabels=Object.fromEntries(Object.values(catalog).flat());
const bigParts=new Set(['blob','fuzzy','slime','rock','serpent','shell']);
const eyes=new Set(['eye','cyclops','stalk','sleepy','manyeyes']);
const wings=new Set(['wing','batwing','fin']);
const tentacles=new Set(['tentacle','tail','antenna','stinger']);
const challenges=[
'Invent a monster that lives inside a volcano.',
'Make a monster with twelve legs and absolutely no eyes.',
'What does a monster afraid of butterflies look like?',
'Combine a shark, a spider, and a dragon.',
'Design the final boss of a video game.',
'Create a monster that disguises itself as a birthday cake.',
'A monster lives at the bottom of the deepest ocean. What is it?',
'Draw a tiny monster with the loudest roar in the universe.',
'Make a frightening monster that only eats broccoli.',
'Imagine a creature made of broken machines.',
'A monster that turns invisible except for its eyes.',
'Invent a monster made entirely of different kinds of slime.',
'What would a monster living on the Moon look like?',
'Create something with wings but no legs.',
'A creature that travels through walls and ceilings.',
'Draw a monster that grows a new head every time it sneezes.',
'Make a swamp beast that protects lost animals.',
'A monster that lives inside a grandfather clock.',
'Invent a creature with a glowing stomach.',
'A monster so huge it uses mountains as pillows.',
'Design two monsters that belong to the same species.',
'Make a strange creature that lives in a library.',
'Create an underwater monster with a pet anglerfish.',
'Invent a monster that is half plant, half dinosaur.',
'Draw a creature with no mouth but ten eyes.',
'A monster that can grow armor when scared.',
'Invent a monster whose shadow looks completely different.',
'Create something that can swim through lava.',
'Draw a monster whose arms are longer than its whole body.',
'Make the friendliest monster with the scariest teeth.',
'A monster that eats nightmares instead of people.',
'Design a creature that builds its own robot limbs.',
'A monster hiding inside a thunderstorm.',
'Create a monster with a huge tail and very tiny feet.',
'What monster lives behind the clouds of Jupiter?',
'Combine your three favorite animals into a new species.'
];
const HABITATS=['Unknown','Swamp','Volcano','Cave','Alien planet','Underwater','Haunted forest','Laboratory','My bedroom','Outer space'];
const FOODS=['Anything','Pizza','Moon rocks','Nightmares','Slime','Socks','Insects','Thunderclouds','Candy','Broccoli'];
const POWERS=['None (yet)','Fire','Ice','Slime','Lightning','Invisibility','Super speed','Flight','Shape shifting','Mind control'];
const uid=()=>('mf-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,9));
const clone=o=>JSON.parse(JSON.stringify(o));
const clamp=(v,min,max)=>Math.min(max,Math.max(min,Number.isFinite(+v)?+v:min));
const colorOk=s=>typeof s==='string'&&/^#[a-f0-9]{6}$/i.test(s);
const escapeText=s=>String(s).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const idOk=s=>typeof s==='string'&&/^mf-[a-z0-9-]{5,45}$/i.test(s);
const neutral=()=>({uid:uid(),name:'',scene:'blank',habitat:'Unknown',food:'Anything',power:'None (yet)',danger:3,challenge:'',items:[],updatedAt:Date.now()});
let monster=neutral(),activeTool='draw',partCategory='Bodies',selectedId=null,ink='#9b7cff',width=10,symmetry=false,filled=false;
let undo=[],redo=[],pointer=null,toastTimer=0,lastChallenge=-1,live=false,animationFrame=0,particles=[],effectUntil=0,danceUntil=0,audio=null;
const MAX_HISTORY=45,MAX_POINTS=1300,MAX_ITEMS=1000;
function safeModel(raw){
 if(!raw||typeof raw!=='object'||!Array.isArray(raw.items))return null;
 const clean=neutral();clean.uid=idOk(raw.uid)?raw.uid:uid();clean.name=String(raw.name||'').slice(0,55);
 clean.scene=Object.hasOwn(sceneNames,raw.scene)?raw.scene:'blank';
 clean.habitat=HABITATS.includes(raw.habitat)?raw.habitat:HABITATS[0];
 clean.food=FOODS.includes(raw.food)?raw.food:FOODS[0];clean.power=POWERS.includes(raw.power)?raw.power:POWERS[0];
 clean.danger=clamp(raw.danger,1,5);clean.challenge=String(raw.challenge||'').slice(0,180);
 clean.updatedAt=clamp(raw.updatedAt,0,9e15);
 for(const item of raw.items.slice(0,MAX_ITEMS)){
   if(item&&item.kind==='part'&&Object.hasOwn(partLabels,item.type)){
    clean.items.push({kind:'part',id:String(item.id||uid()).slice(0,55),type:item.type,x:clamp(item.x,-160,1060),y:clamp(item.y,-160,760),scale:clamp(item.scale,.18,5),rot:clamp(item.rot,-720,720),flip:item.flip===-1?-1:1,color:colorOk(item.color)?item.color:'#9b7cff'});
   }else if(item&&(item.kind==='stroke'||item.kind==='shape')&&Array.isArray(item.points)){
    const pts=item.points.slice(0,MAX_POINTS).filter(p=>p&&Number.isFinite(+p.x)&&Number.isFinite(+p.y)).map(p=>({x:clamp(p.x,-30,930),y:clamp(p.y,-30,630)}));
    if(pts.length)clean.items.push({kind:item.kind,id:String(item.id||uid()).slice(0,55),points:pts,color:colorOk(item.color)?item.color:'#18253b',size:clamp(item.size,2,90)});
   }
 }
 return clean;
}
function remember(){undo.push(JSON.stringify(monster));if(undo.length>MAX_HISTORY)undo.shift();redo=[];updateHistory()}
function change(){monster.updatedAt=Date.now();updateHistory();updateCounts();if(window.ArcadeSave)ArcadeSave.touch();else{try{localStorage.setItem('monsterforge.draft.v1',JSON.stringify(monster))}catch(_){}}}
function updateHistory(){$('undoBtn').disabled=!undo.length;$('redoBtn').disabled=!redo.length}
function historyStep(from,to){if(!from.length)return;to.push(JSON.stringify(monster));if(to.length>MAX_HISTORY)to.shift();const m=safeModel(JSON.parse(from.pop()));if(m)monster=m;selectedId=null;render();change()}
function updateCounts(){const parts=monster.items.filter(i=>i.kind==='part').length;const strokes=monster.items.length-parts;$('artCount').textContent=monster.items.length?`${parts} parts · ${strokes} drawings`:'Empty canvas. Make something weird!';$('miniStatus').textContent=monster.name||'Your monster workshop';$('sceneLabel').textContent=sceneNames[monster.scene];$('challengeText').textContent=monster.challenge||'Try a drawing challenge, or just create anything.'}
function toast(message){$('toast').textContent=message;$('toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('show'),2300)}
function rgb(hex){return [1,3,5].map(i=>parseInt(hex.slice(i,i+2),16))}
function tint(hex,n){const values=rgb(hex).map(v=>clamp(Math.round(v+n*255),0,255));return '#'+values.map(v=>v.toString(16).padStart(2,'0')).join('')}
function strokeBox(body,col,width=3){return `<g stroke="#1b223a" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round">${body}</g>`}
function partShape(t,c){
 const light=tint(c,.23),dark=tint(c,-.16),white='#fffdf5',black='#1b223a';
 const p=(d,fill=c,more='')=>`<path d="${d}" fill="${fill}" ${more}/>`;
 const e=(x,y,rx,ry)=>`<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="${white}"/><ellipse cx="${x+rx*.17}" cy="${y+ry*.07}" rx="${rx*.47}" ry="${ry*.52}" fill="${black}"/><circle cx="${x+rx*.31}" cy="${y-ry*.15}" r="${rx*.2}" fill="white" stroke="none"/>`;
 switch(t){
 case 'blob':return strokeBox(p('M-109 28Q-110-87-35-108Q41-135 91-64Q124-10 112 61Q85 120-5 110Q-114 110-109 28Z')+p('M-92 42Q-42 73 28 81Q75 81 94 47Q51 121-25 94Z',light));
 case 'fuzzy':return strokeBox(p('M-103-45L-125-76-86-69-91-104-53-85-34-121-12-90 22-121 39-87 81-106 78-67 120-72 99-31 124 10 93 34 121 77 73 69 61 109 20 94-8 121-33 91-84 99-82 63-126 44-101 14Z')+p('M-77 3Q-3-48 69 1Q60 83-15 77Z',light));
 case 'slime':return strokeBox(p('M-99 29Q-106-75-24-95Q71-113 100-14Q111 23 92 60V109Q90 126 68 117Q57 113 63 73Q33 85 28 107Q15 140-6 115V82Q-37 97-44 117Q-65 137-81 104L-83 66Q-116 56-99 29Z')+`<ellipse cx="-38" cy="-45" rx="19" ry="11" fill="${light}" stroke="none"/>`);
 case 'rock':return strokeBox(p('M-100-28L-43-112 40-102 109-32 91 77 20 117-80 80Z')+p('M-100-28L-43-112-16-27-80 80Z',dark)+p('M-16-27L40-102 109-32 91 77Z',light)+p('M-16-27L31 43 20 117-80 80Z',c));
 case 'serpent':return strokeBox(p('M-92 112Q-137 14-48-12Q51-45 2-93Q-39-131 30-124Q121-99 102-31Q78 8 12 20Q-85 45-23 100Z')+p('M-25-96Q-3-112 32-97Q59-66 30-52Z',light));
 case 'shell':return strokeBox(`<ellipse cy="8" rx="112" ry="91" fill="${c}"/><ellipse cy="8" rx="84" ry="64" fill="${light}"/>`+p('M-80 10L-23-63 21-15 81-22M-29 72L21-15 75 64M-23-63L20-74 81-22','none','stroke="#1b223a" stroke-width="7"'));
 case 'eye':return strokeBox(`<ellipse rx="49" ry="39" fill="white"/>`+`<circle cx="6" cy="3" r="23" fill="${c}"/><circle cx="10" cy="4" r="12" fill="${black}"/><circle cx="14" cy="-5" r="6" fill="white" stroke="none"/>`);
 case 'cyclops':return strokeBox(`<ellipse rx="78" ry="68" fill="${c}"/><ellipse rx="55" ry="51" fill="white"/><circle cx="7" cy="7" r="29" fill="${dark}"/><circle cx="9" cy="8" r="18" fill="${black}"/><circle cx="18" cy="-5" r="10" fill="white" stroke="none"/>`);
 case 'stalk':return strokeBox(p('M-13 80Q-25 10-18-60L21-64Q17 26 14 80Z',dark)+`<ellipse cy="-68" rx="47" ry="39" fill="white"/><circle cx="8" cy="-65" r="20" fill="${c}"/><circle cx="12" cy="-63" r="11" fill="${black}"/><circle cx="17" cy="-70" r="5" fill="white" stroke="none"/>`);
 case 'sleepy':return strokeBox(`<ellipse rx="54" ry="31" fill="white"/>`+p('M-52 5Q2 34 53-2','none','stroke="#1b223a" stroke-width="9"')+p('M-27 5L-35 23M0 13L0 35M29 6L38 25','none','stroke="#1b223a" stroke-width="6"'));
 case 'manyeyes':return strokeBox(e(-39,-24,24,24)+e(6,-44,24,24)+e(48,-8,24,24)+e(-27,29,24,24)+e(28,37,24,24));
 case 'fangs':return strokeBox(p('M-98-22Q-1-76 97-22Q91 82 0 95Q-93 80-98-22Z',dark)+p('M-87-19Q4 10 86-19L61 29 35-6 5 47-26-6-58 30Z',white)+p('M-85 63L-56 27-28 60 0 29 36 68 67 30 85 62Q12 110-85 63Z',white));
 case 'grin':return strokeBox(p('M-92-21Q5 23 94-21Q65 87-2 78Q-63 78-92-21Z','#29213a')+p('M-82-13Q2 18 84-13L63 20-55 20Z',white)+p('M-53 54Q2 32 52 54Q2 83-53 54Z','#eb637e'));
 case 'beak':return strokeBox(p('M-96-32L92-6 8 34-54 72Z')+p('M-81-32L-8 18 90-6Z',light));
 case 'jaw':return strokeBox(p('M-111-51Q-3-87 113-45L71 61Q15 107-76 61Z',dark)+p('M-95-40L-61 0-40-47-11 10 20-40 45 5 80-37','white')+p('M-76 59L-48 20-28 61 1 22 28 66 55 19 70 56',white));
 case 'horns':return strokeBox(p('M-75 74Q-107-11-67-117Q-64-57-14 13L-12 75Z')+p('M18 73Q76-42 79-118Q126-8 73 76Z')+p('M-77 72Q-64 25-38 18M66 67Q51 25 37 12',light));
 case 'antlers':return strokeBox(p('M-17 91Q-41 0-77-90M-45 22L-114-23M-61-27L-7-68M19 91Q36-2 84-96M46 18L115-38M62-30L7-70','none',`stroke="${c}" stroke-width="15"`));
 case 'spikes':return strokeBox(p('M-120 77L-94-98-52 24-22-123 16 19 73-106 82 21 122-64 101 96Z'));
 case 'antenna':return strokeBox(p('M-34 96Q-71-9-89-78M40 97Q90-7 94-71','none',`stroke="${dark}" stroke-width="17"`)+`<circle cx="-89" cy="-85" r="25" fill="${light}"/><circle cx="94" cy="-78" r="23" fill="${light}"/>`);
 case 'claw':return strokeBox(p('M-57 113Q-120 37-71-4L-99-69Q-67-90-37-36L-32-120Q1-135 12-43L55-110Q95-105 67-27Q110 12 63 73L23 116Z')+p('M-66 12Q-10 35 59 3','none','stroke="#1b223a" stroke-width="6"'));
 case 'tentacle':return strokeBox(p('M-40 125Q-92 13-30-44Q22-88 75-26Q96 11 48 35Q13 40 29 5Q35-13 54-10Q6-78-13-20Q-45 27 26 120Z')+`<circle cx="-11" cy="42" r="9" fill="${light}"/><circle cx="-7" cy="75" r="9" fill="${light}"/>`);
 case 'foot':return strokeBox(p('M-39-117L30-116 47 29Q116 21 123 87Q84 116-95 105Q-118 87-92 47L-42 31Z')+p('M28 72L28 106M67 71L69 103','none','stroke="#1b223a" stroke-width="6"'));
 case 'fin':return strokeBox(p('M-100 91Q-79-72 2-112Q37-26 107-90Q77 14 111 79Q4 124-100 91Z')+p('M-79 86L2-55 88 80','none','stroke="#1b223a" stroke-width="5"'));
 case 'wing':return strokeBox(p('M-127 62Q-50-100 16-114Q23-53 69-87Q92-28 129-17L63 108 0 65-52 117Z')+p('M-83 86L16-78M-16 61L69-42M16-78L63 108','none',`stroke="${dark}" stroke-width="7"`));
 case 'batwing':return strokeBox(p('M-132-9Q-34-129 10-100Q46-121 89-52L126-42Q89-27 91 65Q49 19 22 101Q-5 40-51 96Q-56 31-121 56Z')+p('M-120-7L22-49 88-44M22-49L22 101','none',`stroke="${dark}" stroke-width="6"`));
 case 'tail':return strokeBox(p('M-127 50Q-54-113 45-47Q105 11 37 70Q19 97 93 101Q-3 161-48 72Q-76 30-31-15Q-90-31-102 88Z'));
 case 'stinger':return strokeBox(p('M-126 74Q-41-88 53-14Q123 40 16 70Q71 41 97-4L130-71Q103 112 0 116Q-64 111-82 51Z')+p('M101-7L133-74 120 23Z',dark));
 case 'spots':return strokeBox(`<circle cx="-65" cy="-44" r="28" fill="${c}"/><circle cx="36" cy="-65" r="15" fill="${light}"/><circle cx="59" cy="30" r="34" fill="${c}"/><circle cx="-45" cy="61" r="17" fill="${dark}"/>`);
 case 'scales':return strokeBox(Array.from({length:10},(_,i)=>{let x=(i%5)*45-90,y=Math.floor(i/5)*75-45;return p(`M${x-20} ${y-13}Q${x} ${y-40} ${x+20} ${y-13}Q${x+22} ${y+25} ${x} ${y+31}Q${x-24} ${y+18} ${x-20} ${y-13}Z`,i%2?c:light)}).join(''));
 case 'flames':return strokeBox(p('M-68 108Q-115 18-39-82Q-48-13 2-118Q68-47 61 0Q112-10 81 82Q32 139-68 108Z',c)+p('M-35 94Q-67 32 0-33Q3 0 35 11Q69 77 35 99Z',light));
 case 'bolt':return strokeBox(p('M-9-120L-100 8H-21L-55 127 111-38H12L57-120Z',c));
 case 'gear':return strokeBox(p('M-28-112H28L32-80 65-69 91-87 119-45 94-21 100 20 119 45 91 88 64 70 32 80 28 112H-28L-32 80-64 70-91 88-119 45-96 20-96-20-119-45-91-87-64-69-32-80Z',c)+`<circle r="45" fill="${dark}"/><circle r="25" fill="${light}"/>`);
 case 'cloud':return strokeBox(`<circle cx="-67" cy="9" r="47" fill="${c}"/><circle cx="-21" cy="-31" r="58" fill="${light}"/><circle cx="50" cy="-11" r="55" fill="${c}"/><ellipse cx="0" cy="40" rx="112" ry="48" fill="${c}"/>`);
 default:return `<circle r="40" fill="${c}"/>`;
 }
}
function background(scene){
 const svg={
 blank:'<rect width="900" height="600" fill="#efe8d8"/><path d="M0 100H900M0 200H900M0 300H900M0 400H900M0 500H900M100 0V600M200 0V600M300 0V600M400 0V600M500 0V600M600 0V600M700 0V600M800 0V600" fill="none" stroke="#afa9a1" stroke-opacity=".13" stroke-width="1.5"/>',
 swamp:'<rect width="900" height="600" fill="#122d30"/><circle cx="730" cy="100" r="78" fill="#c3e0a8" opacity=".38"/><path d="M0 390Q190 320 400 391T900 360V600H0Z" fill="#306450"/><path d="M0 470Q260 418 500 477T900 465V600H0Z" fill="#184e47"/><path d="M0 548Q200 501 410 556T900 523" stroke="#86e6ba" stroke-width="7" opacity=".35" fill="none"/><path d="M95 430v-195M830 415V180M88 245L41 202M99 264l41-58M827 204l47-54" stroke="#18302a" stroke-width="27" stroke-linecap="round"/>',
 lava:'<rect width="900" height="600" fill="#331a2b"/><circle cx="711" cy="135" r="96" fill="#ffaf54" opacity=".27"/><path d="M0 380L151 174 300 388 465 207 630 400 780 190 900 357V600H0Z" fill="#6b2a36"/><path d="M0 475Q180 414 356 472T900 466V600H0Z" fill="#281b33"/><path d="M90 557Q232 473 370 536T690 517T900 552" fill="none" stroke="#ff6535" stroke-width="31"/><path d="M150 557Q295 485 415 539" fill="none" stroke="#ffd166" stroke-width="8"/>',
 cave:'<rect width="900" height="600" fill="#1c2235"/><path d="M0 0H900V130L826 87 748 175 691 74 576 150 475 45 336 154 245 51 161 161 71 71 0 152Z" fill="#39465f"/><path d="M0 600H900V490L761 533 659 442 541 547 428 465 320 561 213 478 109 539 0 480Z" fill="#313954"/><circle cx="716" cy="290" r="92" fill="#8d84de" opacity=".12"/><path d="M70 500L135 370 196 522M775 545l35-137 53 128" fill="#8665b2" opacity=".4"/>',
 space:'<rect width="900" height="600" fill="#11182e"/><circle cx="690" cy="150" r="104" fill="#6151be"/><ellipse cx="690" cy="150" rx="156" ry="29" fill="none" stroke="#c9a7ef" stroke-width="17" transform="rotate(-22 690 150)"/><path d="M0 490Q160 370 365 472T900 438V600H0Z" fill="#3a356a"/><path d="M0 570Q280 485 510 560T900 506V600H0Z" fill="#55458e"/>'+Array.from({length:26},(_,i)=>`<circle cx="${(i*179+61)%900}" cy="${(i*91+37)%415}" r="${1+(i%3)}" fill="white" opacity=".75"/>`).join(''),
 city:'<rect width="900" height="600" fill="#2d3d69"/><circle cx="721" cy="115" r="67" fill="#fbd4b0" opacity=".65"/><path d="M0 470V225h90v58h69V161h132v125h71V113h135v165h62V207h142v93h96V180h103v420H0Z" fill="#162641"/><path d="M0 525H900V600H0Z" fill="#273048"/>'+Array.from({length:35},(_,i)=>`<rect x="${(i*137+18)%900}" y="${(i*67+180)%320}" width="13" height="19" rx="2" fill="#fbc477" opacity=".${i%3+4}"/>`).join(''),
 sea:'<rect width="900" height="600" fill="#10496a"/><circle cx="721" cy="97" r="111" fill="#9bfbef" opacity=".12"/><path d="M0 82Q180 110 360 76T900 100" stroke="#8de9f7" stroke-width="7" fill="none" opacity=".24"/><path d="M0 531Q125 468 244 520T490 518T900 506V600H0Z" fill="#16485a"/><path d="M120 560q-28-100 8-192M160 555q10-98 58-122M760 555q-14-119 27-197" fill="none" stroke="#43c796" stroke-width="18" stroke-linecap="round"/><circle cx="677" cy="207" r="15" fill="none" stroke="#b3fff6" stroke-width="4" opacity=".5"/><circle cx="697" cy="168" r="8" fill="none" stroke="#b3fff6" stroke-width="3" opacity=".5"/>'
 };return svg[scene]||svg.blank;
}
function pointsPath(pts,close){if(!pts.length)return '';if(pts.length===1){const a=pts[0];return `M${a.x.toFixed(1)} ${a.y.toFixed(1)}l.05 .05`;}return 'M'+pts.map(p=>`${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join('L')+(close?'Z':'')}
function drawItem(item,interactive=false){
 if(item.kind==='part'){
 const flipped=item.scale*item.flip;
 return `<g class="part-element" data-id="${escapeText(item.id)}" transform="translate(${item.x} ${item.y}) rotate(${item.rot}) scale(${flipped} ${item.scale})"><g class="anim" data-type="${item.type}">${partShape(item.type,item.color)}</g>${interactive&&selectedId===item.id?'<circle class="selection" r="130"/>':''}</g>`;
 }
 const path=pointsPath(item.points,item.kind==='shape');let b=`<path data-id="${escapeText(item.id)}" d="${path}" fill="${item.kind==='shape'?item.color:'none'}" stroke="${item.color}" stroke-width="${item.size}" stroke-linecap="round" stroke-linejoin="round"/>`;
 if(interactive&&selectedId===item.id){const p=item.points[Math.floor(item.points.length/2)];b+=`<circle class="selection" cx="${p.x}" cy="${p.y}" r="20"/>`;}return b;
}
function boardMarkup(itemList=monster.items,scene=monster.scene,interactive=false){return background(scene)+`<g id="creature">${itemList.map(i=>drawItem(i,interactive)).join('')}</g>`+(interactive&&symmetry&&activeTool==='draw'?'<path class="guide" d="M450 0V600"/>':'')}
function render(){$('art').innerHTML=boardMarkup(monster.items,monster.scene,true);$('partEdit').hidden=!monster.items.some(i=>i.kind==='part'&&i.id===selectedId);renderSwatches();renderScenes();updateCounts();updateHistory()}
function updatePanel(){document.querySelectorAll('[data-tool]').forEach(b=>b.classList.toggle('selected',b.dataset.tool===activeTool));$('drawPanel').hidden=!['draw','fill'].includes(activeTool);$('buildPanel').hidden=!['build','move','erase'].includes(activeTool);$('scenePanel').hidden=activeTool!=='scene';$('panelTitle').textContent=activeTool==='draw'?'Drawing tools':activeTool==='scene'?'Monster worlds':activeTool==='fill'?'Recolor parts':'Creature parts';$('panelTip').textContent=activeTool==='move'?'Drag any part':activeTool==='erase'?'Tap to erase':activeTool==='fill'?'Tap a part to color':activeTool==='build'?'Choose a part':'Make it yours';$('modeHint').textContent={draw:'Draw with your finger or mouse',build:'Tap a part, then drag it',move:'Drag parts anywhere',erase:'Tap or swipe over things to erase',fill:'Tap a part to recolor it',scene:'Pick a different world'}[activeTool];render()}
function setTool(t){if(!['draw','build','move','erase','fill','scene'].includes(t))return;activeTool=t;updatePanel()}
function renderSwatches(){const html=palette.map(c=>`<button type="button" class="swatch ${ink.toLowerCase()===c.toLowerCase()?'active':''}" style="background:${c}" data-color="${c}" aria-label="Choose color ${c}"></button>`).join('');$('colors').innerHTML=html;$('partColors').innerHTML=html}
function renderScenes(){$('scenes').innerHTML=Object.entries(sceneNames).map(([id,label])=>`<button type="button" data-scene="${id}" class="${monster.scene===id?'active':''}">${label}</button>`).join('')}
function renderParts(){const tabs=$('partTabs');tabs.innerHTML=Object.keys(catalog).map(k=>`<button type="button" data-category="${k}" class="${k===partCategory?'selected':''}">${k}</button>`).join('');$('parts').innerHTML=catalog[partCategory].map(([type,label])=>`<button type="button" data-part="${type}" title="Add ${label}"><svg viewBox="-140 -140 280 280" aria-hidden="true">${partShape(type,ink)}</svg><span>${label}</span></button>`).join('')}
function selectColor(c){if(!colorOk(c))return;ink=c;$('customColor').value=c;renderSwatches();$('partCustomColor').value=c;if(activeTool==='build')renderParts();const item=monster.items.find(i=>i.id===selectedId);if(item&&item.kind==='part'&&activeTool==='fill'){remember();item.color=c;change();render()}}
function addPart(type,x=450,y=300,scale=null){if(!partLabels[type])return;if(monster.items.length>=MAX_ITEMS)return toast('This monster is full of parts!');remember();let item={kind:'part',id:uid(),type,x,y,scale:scale??(bigParts.has(type)?1.1:.58),rot:0,flip:1,color:ink};monster.items.push(item);selectedId=item.id;setTool('move');change();render();toast('Drag the part to move it')}
function selected(){return monster.items.find(i=>i.id===selectedId&&i.kind==='part')}
function mutatePart(fn){const part=selected();if(!part)return toast('Tap a part first');remember();fn(part);render();change()}
function mirrorPart(){const part=selected();if(!part)return toast('Tap a part first');if(monster.items.length>=MAX_ITEMS)return;remember();const n=clone(part);n.id=uid();n.x=W-part.x;n.rot=-part.rot;n.flip=-part.flip;monster.items.push(n);selectedId=n.id;render();change()}
function removeSelected(){if(!selectedId)return toast('Tap a part first');remember();monster.items=monster.items.filter(i=>i.id!==selectedId);selectedId=null;render();change()}
function offsetPart(delta){let i=monster.items.findIndex(p=>p.id===selectedId);if(i<0)return;const dest=clamp(i+delta,0,monster.items.length-1);if(dest===i)return;remember();const [p]=monster.items.splice(i,1);monster.items.splice(dest,0,p);render();change()}
function hit(item,x,y){
 if(item.kind==='part'){
 const dx=x-item.x,dy=y-item.y,angle=-item.rot*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle),px=(dx*c-dy*s)/(item.scale*item.flip),py=(dx*s+dy*c)/item.scale;
 const r=bigParts.has(item.type)?120:eyes.has(item.type)?76:110;
 return Math.abs(px)<r&&Math.abs(py)<r;
 }
 if(item.kind==='shape'){const pts=item.points;if(!pts.length)return false;const xs=pts.map(p=>p.x),ys=pts.map(p=>p.y);if(x>=Math.min(...xs)&&x<=Math.max(...xs)&&y>=Math.min(...ys)&&y<=Math.max(...ys))return true;}
 let pts=item.points;for(let i=1;i<pts.length;i++){
 const a=pts[i-1],b=pts[i],ax=b.x-a.x,ay=b.y-a.y,t=clamp(((x-a.x)*ax+(y-a.y)*ay)/(ax*ax+ay*ay||1),0,1);
 if(Math.hypot(x-a.x-t*ax,y-a.y-t*ay)<Math.max(13,item.size*.75))return true;
 }return pts.length===1&&Math.hypot(x-pts[0].x,y-pts[0].y)<Math.max(13,item.size);
}
function hitTop(x,y){for(let i=monster.items.length-1;i>=0;i--){if(hit(monster.items[i],x,y))return monster.items[i]}return null}
function locationOf(e){const rect=$('art').getBoundingClientRect();const ar=W/H,rr=rect.width/rect.height;let left=0,top=0,cw=rect.width,ch=rect.height;if(rr>ar){cw=rect.height*ar;left=(rect.width-cw)/2}else{ch=rect.width/ar;top=(rect.height-ch)/2}const dx=e.clientX-rect.left-left,dy=e.clientY-rect.top-top;return {x:clamp(dx*W/cw,0,W),y:clamp(dy*H/ch,0,H),inside:dx>=0&&dx<=cw&&dy>=0&&dy<=ch}}
function startPointer(e){if(e.button!==0&&e.pointerType==='mouse')return;if($('modal').hidden===false||$('lab').hidden===false)return;const {x,y,inside}=locationOf(e);if(!inside)return;let h=hitTop(x,y);let action='none';if(activeTool==='draw'){
 if(monster.items.length>=MAX_ITEMS){toast('Try finishing this monster before adding more');return}
 remember();const obj={kind:filled?'shape':'stroke',id:uid(),points:[{x,y}],size:width,color:ink};monster.items.push(obj);pointer={pointerId:e.pointerId,action:'draw',obj,mirror:symmetry,ox:x,oy:y};action='draw';
 }else if(activeTool==='erase'){if(h){remember();monster.items=monster.items.filter(i=>i.id!==h.id);selectedId=null;pointer={pointerId:e.pointerId,action:'erase',removed:new Set([h.id])};action='erase';render();change()}}
 else if(activeTool==='fill'){if(h&&h.kind==='part'){remember();h.color=ink;selectedId=h.id;render();change();action='fill'}else toast('Color works on creature parts. Use filled shapes for drawing.')}
 else if(activeTool==='move'||activeTool==='build'){selectedId=h?.id||null;if(h&&h.kind==='part'){remember();pointer={pointerId:e.pointerId,action:'move',id:h.id,dx:h.x-x,dy:h.y-y};action='move'}render()}
 if(action==='draw'||action==='move'||action==='erase'){try{$('art').setPointerCapture(e.pointerId)}catch(_){}e.preventDefault()}
}
function movePointer(e){if(!pointer||pointer.pointerId!==e.pointerId)return;const {x,y}=locationOf(e);if(pointer.action==='draw'){
 const pts=pointer.obj.points;if(pts.length>=MAX_POINTS)return;const last=pts[pts.length-1];if(Math.hypot(x-last.x,y-last.y)<2.5)return;pts.push({x,y});$('art').innerHTML=boardMarkup(monster.items,monster.scene,true);
 }else if(pointer.action==='move'){const p=monster.items.find(i=>i.id===pointer.id);if(p){p.x=clamp(x+pointer.dx,-160,1060);p.y=clamp(y+pointer.dy,-160,760);$('art').innerHTML=boardMarkup(monster.items,monster.scene,true)}}
 else if(pointer.action==='erase'){const h=hitTop(x,y);if(h&&!pointer.removed.has(h.id)){pointer.removed.add(h.id);monster.items=monster.items.filter(i=>i.id!==h.id);render()}}e.preventDefault()}
function endPointer(e){if(!pointer||pointer.pointerId!==e.pointerId)return;const p=pointer;pointer=null;
 if(p.action==='draw'){
 if(p.obj.points.length===1)p.obj.points.push({...p.obj.points[0]});
 if(p.mirror&&monster.items.length<MAX_ITEMS){monster.items.push({...clone(p.obj),id:uid(),points:p.obj.points.map(v=>({x:W-v.x,y:v.y}))})}
 }render();change();try{$('art').releasePointerCapture(e.pointerId)}catch(_){}}
function randomItem(type,x,y,scale,col,rot=0,flip=1){return {kind:'part',id:uid(),type,x,y,scale,rot,color:col,flip}}
function randomDNA(){if(monster.items.length&&!(window.confirm('Replace the current monster with a surprise creature?')))return;remember();const colors=['#72e985','#9b7cff','#ff8b32','#21dcff','#ff5ac8','#6b86ff','#e84756'];const c=colors[Math.floor(Math.random()*colors.length)],pick=a=>a[Math.floor(Math.random()*a.length)];monster=neutral();monster.name=pick(['Glorp','Grizzle','Bloop','The Wobbler','Crunchfang','Muckzilla','Snork']);monster.scene=pick(Object.keys(sceneNames));monster.items.push(randomItem(pick(['blob','fuzzy','slime','rock','serpent','shell']),450,320,1.35,c));const n=1+Math.floor(Math.random()*4);for(let i=0;i<n;i++)monster.items.push(randomItem(pick(['eye','stalk','sleepy']),450+(i-(n-1)/2)*90,260+Math.random()*50,.56,pick(colors)));monster.items.push(randomItem(pick(['fangs','grin','jaw','beak']),450,390,.64,pick(colors)));const limb=pick(['claw','tentacle','wing','batwing','foot']);monster.items.unshift(randomItem(limb,300,380,.85,pick(colors),-35,-1),randomItem(limb,600,380,.85,pick(colors),35));monster.items.push(randomItem(pick(['horns','spikes','antenna','antlers']),450,170,.72,pick(colors)));selectedId=null;setTool('move');render();change();toast('A strange new monster appeared!')}
function nextChallenge(){let n=Math.floor(Math.random()*challenges.length);if(n===lastChallenge)n=(n+1)%challenges.length;lastChallenge=n;remember();monster.challenge=challenges[n];render();change();toast('New challenge ready!')}
function newMonster(confirmFirst=true){if(confirmFirst&&monster.items.length&&!window.confirm('Start a blank monster? Your current drawing will stay only if you saved it to the collection.'))return;monster=neutral();undo=[];redo=[];selectedId=null;setTool('draw');closeOverlays();render();change();toast('New monster canvas ready')}
function evolve(){if(!monster.items.length)return toast('Make a monster first!');saveCurrent({silent:true}).then(ok=>{if(!ok)return;remember();const old=monster;monster=clone(old);monster.uid=uid();monster.name=(old.name||'Mystery Creature').slice(0,46)+' II';monster.updatedAt=Date.now();const parts=monster.items.filter(i=>i.kind==='part');const mutations=['horns','spikes','wing','tentacle','stalk','claw','tail','flames'];const c=palette[Math.floor(Math.random()*(palette.length-1))+1];for(let i=0;i<Math.min(3,parts.length);i++){const p=parts[Math.floor(Math.random()*parts.length)];p.scale=clamp(p.scale*(1.18+Math.random()*.3),.18,5);p.color=Math.random()<.65?c:p.color;p.rot+=Math.round((Math.random()-.5)*35)}monster.items.push(randomItem(mutations[Math.floor(Math.random()*mutations.length)],570,185,.7,c,25));undo=[];redo=[];selectedId=null;setTool('move');render();change();toast('Evolution complete. Your original was saved!')})}
function closeOverlays(){['menu','modal','collection','lab'].forEach(id=>$(id).hidden=true);stopLab()}
function openModal(title,body,buttons){$('modalTitle').textContent=title;$('modalBody').innerHTML=body;const actions=$('modalActions');actions.innerHTML='';buttons.forEach(o=>{const b=document.createElement('button');b.textContent=o.text;b.className=o.class||'';b.addEventListener('click',o.action);actions.append(b)});$('modal').hidden=false}
function closeModal(){$('modal').hidden=true}
function detailsForm(){const field=(key,label,arr)=>`<label>${label}<select id="field-${key}">${arr.map(x=>`<option ${monster[key]===x?'selected':''}>${escapeText(x)}</option>`).join('')}</select></label>`;return `<div class="form-grid"><label class="full">Monster name<input id="field-name" maxlength="55" autocomplete="off" value="${escapeText(monster.name)}" placeholder="Give your creature a name"></label>${field('habitat','Habitat',HABITATS)}${field('food','Favorite food',FOODS)}${field('power','Special power',POWERS)}<label>Danger rating<select id="field-danger">${[1,2,3,4,5].map(i=>`<option value="${i}" ${i===monster.danger?'selected':''}>${i} / 5 ${i===1?'(harmless)':i===5?'(terrifying)':''}</option>`).join('')}</select></label></div>`}
function saveDialog(){openModal('Save your monster',detailsForm(),[{text:'Cancel',action:closeModal},{text:'Save monster',class:'accent',action:async()=>{
monster.name=$('field-name').value.trim().slice(0,55)||'Unnamed Monster';monster.habitat=$('field-habitat').value;monster.food=$('field-food').value;monster.power=$('field-power').value;monster.danger=clamp($('field-danger').value,1,5);closeModal();render();const ok=await saveCurrent();if(ok)toast('Monster saved to your collection!')
}}]);setTimeout(()=>$('field-name')?.focus(),50)}
function selectMenu(open){$('menu').hidden=!open}
function openCollection(){selectMenu(false);$('collection').hidden=false;renderCollection()}
function openHelp(){selectMenu(false);openModal('How to make a monster',`<p><b>Draw:</b> Sketch with your finger, mouse, or stylus. Turn on symmetry or filled shapes to try new styles.</p><p><b>Parts:</b> Tap to add bodies, eyes, claws, wings, tails, and other bits. Drag a part, then resize or rotate it.</p><p><b>Move, Erase, Color:</b> Move parts, remove strokes or parts, or paint assembled pieces. Undo and redo work here too.</p><p><b>World:</b> Choose a habitat, get a challenge, or use Monster DNA for a surprise.</p><p><b>Test Chamber:</b> Wake up your creature and see what happens. Save to your collection and evolve it into a new species!</p><p>Everything is stored on this device. Use the PNG button in the collection to save an image.</p>`,[{text:'Got it',class:'accent',action:closeModal}])}
const DB='arcade-monster-forge-v1';
function openDB(){return new Promise((resolve,reject)=>{if(!('indexedDB' in window))return reject(Error('No database'));const r=indexedDB.open(DB,1);r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains('monsters'))r.result.createObjectStore('monsters',{keyPath:'uid'})};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error||Error('Database unavailable'));})}
function transaction(mode,method,value){return openDB().then(db=>new Promise((resolve,reject)=>{let tx,req,result;try{tx=db.transaction('monsters',mode);req=tx.objectStore('monsters')[method](...(value===undefined?[]:[value]));}catch(error){db.close();reject(error);return}req.onsuccess=()=>{result=req.result};req.onerror=()=>{};tx.oncomplete=()=>{db.close();resolve(result)};tx.onerror=()=>{db.close();reject(tx.error||Error('Save failed'))};tx.onabort=()=>{db.close();reject(tx.error||Error('Save aborted'))}}))}
function fallbackList(){try{return JSON.parse(localStorage.getItem('monsterforge.collection.v1')||'[]')}catch(_){return []}}
function listStored(){return transaction('readonly','getAll').catch(()=>[]).then(a=>{const items=new Map();for(const item of [...a,...fallbackList()])if(item&&item.uid)items.set(item.uid,item);return [...items.values()].map(safeModel).filter(Boolean).sort((a,b)=>b.updatedAt-a.updatedAt)})}
function storePut(m){return transaction('readwrite','put',m).catch(()=>{const arr=fallbackList().filter(x=>x.uid!==m.uid);arr.unshift(m);if(arr.length>50)arr.length=50;localStorage.setItem('monsterforge.collection.v1',JSON.stringify(arr))})}
function storeDelete(id){return transaction('readwrite','delete',id).catch(()=>{const arr=fallbackList().filter(x=>x.uid!==id);localStorage.setItem('monsterforge.collection.v1',JSON.stringify(arr))})}
async function saveCurrent({silent=false}={}){if(!monster.items.length){if(!silent)toast('Draw something first!');return false;}try{if(!monster.name)monster.name='Unnamed Monster';monster.updatedAt=Date.now();await storePut(clone(monster));if(window.ArcadeSave)await ArcadeSave.saveNow();else change();updateCounts();if(!silent)toast('Saved!');return true}catch(error){toast('Could not save. Check device storage.');return false}}
async function renderCollection(){const g=$('gallery');g.innerHTML='<div class="empty-gallery">Opening the monster vault...</div>';let stored;try{stored=await listStored()}catch(_){g.textContent='The monster vault could not open.';return}g.replaceChildren();$('collectionInfo').textContent=`${stored.length} saved monster${stored.length===1?'':'s'} on this device. Tap Open to keep editing.`;if(!stored.length){g.innerHTML='<div class="empty-gallery">No saved monsters yet. Draw one, then press Save monster!</div>';return}for(const m of stored){const tile=document.createElement('div');tile.className='monster-tile';const prev=document.createElement('div');prev.className='thumb';prev.innerHTML=`<svg xmlns="${NS}" viewBox="0 0 900 600">${boardMarkup(m.items,m.scene)}</svg>`;tile.append(prev);const label=document.createElement('strong');label.textContent=m.name||'Unnamed Monster';tile.append(label);const actions=document.createElement('div');actions.className='tile-actions';const open=document.createElement('button');open.textContent='Open';open.onclick=()=>{monster=clone(m);undo=[];redo=[];selectedId=null;$('collection').hidden=true;setTool('move');render();change();toast('Monster loaded!')};const png=document.createElement('button');png.textContent='PNG';png.title='Download picture';png.onclick=()=>exportPNG(m);const del=document.createElement('button');del.textContent='✕';del.title='Delete monster';del.className='remove danger';del.onclick=()=>{openModal('Delete this monster?',`<p>Delete <b>${escapeText(m.name||'this monster')}</b> from your collection? This cannot be undone.</p>`,[{text:'Cancel',action:closeModal},{text:'Delete',class:'danger',action:async()=>{closeModal();await storeDelete(m.uid);renderCollection();toast('Monster deleted')}}])};actions.append(open,png,del);tile.append(actions);g.append(tile)}}
function exportPNG(m=monster){const svg=`<svg xmlns="${NS}" width="1200" height="800" viewBox="0 0 900 600">${boardMarkup(m.items,m.scene)}</svg>`;const blob=new Blob([svg],{type:'image/svg+xml'}),url=URL.createObjectURL(blob),img=new Image();img.onload=()=>{try{const can=document.createElement('canvas');can.width=1200;can.height=800;const ctx=can.getContext('2d');ctx.drawImage(img,0,0,1200,800);const a=document.createElement('a');a.download=(m.name||'monster').replace(/[^\w-]+/g,'-').slice(0,45)+'.png';a.href=can.toDataURL('image/png');document.body.append(a);a.click();a.remove();toast('Picture exported!')}catch(_){toast('Could not export picture in this browser')}finally{URL.revokeObjectURL(url)}};img.onerror=()=>{URL.revokeObjectURL(url);toast('Could not make picture')};img.src=url}
function startLab(){if(!monster.items.length)return toast('Make a creature first!');$('lab').hidden=false;live=true;const svg=$('liveArt');svg.innerHTML=background(monster.scene)+`<g id="liveRoot"><g id="liveCreature">${monster.items.map(i=>drawItem(i)).join('')}</g></g><g id="fxLayer"></g>`;particles=[];effectUntil=0;danceUntil=0;animationFrame=requestAnimationFrame(animate)}
function stopLab(){live=false;if(animationFrame)cancelAnimationFrame(animationFrame);animationFrame=0;particles=[]}
function animate(t){if(!live)return;const root=$('liveRoot'),characters=$('liveCreature'),fx=$('fxLayer');if(!root)return;const a=t*.001,delta=t<effectUntil?(Math.sin(t*.13)*10):0,dance=t<danceUntil;const bounce=(dance?12:5)*Math.sin(a*(dance?12:3.3));root.setAttribute('transform',`translate(${delta.toFixed(1)} ${bounce.toFixed(1)})`);characters.querySelectorAll('.anim').forEach((g,i)=>{const typ=g.dataset.type||'',wave=Math.sin(a*4.7+i*1.6);let transform='';if(wings.has(typ))transform=`rotate(${wave*19}) scale(1 ${.85+wave*.16})`;else if(tentacles.has(typ))transform=`rotate(${wave*10})`;else if(eyes.has(typ))transform=`scale(1 ${Math.sin(a*.72+i)>.993?.1:1})`;else if(bigParts.has(typ))transform=`scale(${1+wave*.012} ${1-wave*.012})`;g.setAttribute('transform',transform)});if(particles.length){particles=particles.filter(p=>{const age=(t-p.t)/1000;if(age>p.life){p.el.remove();return false}const x=p.x+p.dx*age,y=p.y+p.dy*age+p.gravity*age*age; p.el.setAttribute('transform',`translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${Math.max(.05,1-age/p.life).toFixed(2)})`);p.el.setAttribute('opacity',Math.max(0,1-age/p.life).toFixed(2));return true})}animationFrame=requestAnimationFrame(animate)}
function note(f,duration=180,volume=.08,type='sawtooth'){try{const AC=window.AudioContext||window.webkitAudioContext;if(!AC)return;if(!audio)audio=new AC();if(audio.state==='suspended')audio.resume();let o=audio.createOscillator(),g=audio.createGain();o.type=type;o.frequency.setValueAtTime(f,audio.currentTime);o.frequency.exponentialRampToValueAtTime(Math.max(35,f*.5),audio.currentTime+duration/1000);g.gain.setValueAtTime(volume,audio.currentTime);g.gain.exponentialRampToValueAtTime(.0001,audio.currentTime+duration/1000);o.connect(g);g.connect(audio.destination);o.start();o.stop(audio.currentTime+duration/1000)}catch(_){}}
function particle(x,y,dx,dy,col,t,life=1.4,r=12,gravity=0){const el=document.createElementNS(NS,'circle');el.setAttribute('r',r);el.setAttribute('fill',col);$('fxLayer').appendChild(el);particles.push({el,x,y,dx,dy,t,life,gravity});if(particles.length>95){particles.shift().el.remove()}}
function effect(kind){if(!live)return;const t=performance.now();if(kind==='roar'){effectUntil=t+750;note(115,500,.15,'sawtooth');note(65,640,.11,'square');for(let i=0;i<18;i++){const a=i*6.28/18;particle(455,295,Math.cos(a)*175,Math.sin(a)*160,i%2?'#ffce3a':'#fff',t,1.2,10)}}else if(kind==='fire'){note(250,480,.08,'sawtooth');for(let i=0;i<34;i++)particle(535,304,180+Math.random()*250,(Math.random()-.5)*160,i%3===0?'#ffdf54':i%3===1?'#ff5e32':'#ff9b27',t,1.15,Math.random()*15+7,-23)}else if(kind==='slime'){note(400,210,.08,'triangle');for(let i=0;i<29;i++)particle(520,300,150+Math.random()*170,(Math.random()-.5)*250,i%2?'#68ee72':'#b2ff67',t,1.4,Math.random()*13+6,180)}else if(kind==='shake'){effectUntil=t+850;note(90,350,.18,'square');for(let i=0;i<25;i++)particle(450,518,(Math.random()-.5)*420,-Math.random()*250,'#afbad7',t,1.25,Math.random()*11+5,140)}else if(kind==='dance'){danceUntil=t+4800;for(let i=0;i<7;i++)setTimeout(()=>{if(live)note(220+Math.floor(i%4)*75,170,.055,'sine')},i*260);toast('Monster dance party!')}}
function goHome(){stopLab();if(window.ArcadeSave)return ArcadeSave.goHome();try{if(window.parent!==window&&window.parent.ArcadeShell?.goHome){window.parent.postMessage({scope:'arcade-shell-navigation',version:1,type:'home'},window.location.origin);return}}catch(_){}window.location.href='../index.html'}
function wire(){document.querySelectorAll('[data-tool]').forEach(b=>b.addEventListener('click',()=>setTool(b.dataset.tool)));$('menuBtn').onclick=()=>selectMenu(true);$('resumeBtn').onclick=()=>selectMenu(false);$('menuHome').onclick=goHome;$('homeBtn').onclick=goHome;$('menuHelp').onclick=openHelp;$('menuCollection').onclick=openCollection;$('menuDNA').onclick=()=>{selectMenu(false);randomDNA()};$('saveBtn').onclick=saveDialog;$('newBtn').onclick=()=>newMonster();$('undoBtn').onclick=()=>historyStep(undo,redo);$('redoBtn').onclick=()=>historyStep(redo,undo);$('brushSize').oninput=e=>{width=clamp(e.target.value,2,45);$('brushOut').textContent=width};$('customColor').oninput=e=>selectColor(e.target.value);$('colors').onclick=e=>{const c=e.target.closest('[data-color]');if(c)selectColor(c.dataset.color)};$('partColors').onclick=e=>{const c=e.target.closest('[data-color]');if(c)selectColor(c.dataset.color)};$('partCustomColor').oninput=e=>selectColor(e.target.value);$('symmetryBtn').onclick=()=>{symmetry=!symmetry;$('symmetryBtn').textContent='⇆ Symmetry: '+(symmetry?'on':'off');$('symmetryBtn').classList.toggle('active',symmetry);$('symmetryBtn').setAttribute('aria-pressed',String(symmetry));render()};$('shapeBtn').onclick=()=>{filled=!filled;$('shapeBtn').textContent='⬟ Fill shapes: '+(filled?'on':'off');$('shapeBtn').classList.toggle('active',filled);$('shapeBtn').setAttribute('aria-pressed',String(filled));toast(filled?'Draw a closed outline to fill its inside':'Freehand brush ready')};$('partTabs').onclick=e=>{const b=e.target.closest('[data-category]');if(b){partCategory=b.dataset.category;renderParts()}};$('parts').onclick=e=>{const b=e.target.closest('[data-part]');if(b)addPart(b.dataset.part)};$('smallerBtn').onclick=()=>mutatePart(p=>p.scale=clamp(p.scale*.85,.18,5));$('biggerBtn').onclick=()=>mutatePart(p=>p.scale=clamp(p.scale*1.18,.18,5));$('leftBtn').onclick=()=>mutatePart(p=>p.rot-=15);$('rightBtn').onclick=()=>mutatePart(p=>p.rot+=15);$('mirrorBtn').onclick=mirrorPart;$('deleteBtn').onclick=removeSelected;$('frontBtn').onclick=()=>offsetPart(1);$('backBtn').onclick=()=>offsetPart(-1);$('scenes').onclick=e=>{const b=e.target.closest('[data-scene]');if(b&&monster.scene!==b.dataset.scene){remember();monster.scene=b.dataset.scene;render();change()}};$('challengeBtn').onclick=nextChallenge;$('randomBtn').onclick=randomDNA;$('evolveBtn').onclick=evolve;$('collectionBtn').onclick=openCollection;$('closeCollection').onclick=()=>$('collection').hidden=true;$('labBtn').onclick=startLab;$('closeLab').onclick=()=>{$('lab').hidden=true;stopLab()};document.querySelectorAll('[data-effect]').forEach(b=>b.onclick=()=>effect(b.dataset.effect));$('art').addEventListener('pointerdown',startPointer);$('art').addEventListener('pointermove',movePointer);$('art').addEventListener('pointerup',endPointer);$('art').addEventListener('pointercancel',endPointer);document.addEventListener('keydown',e=>{if(!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName)){if(e.key==='Escape'){closeOverlays();return}if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();if(e.shiftKey)historyStep(redo,undo);else historyStep(undo,redo)}if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='y'){e.preventDefault();historyStep(redo,undo)}}});document.addEventListener('visibilitychange',()=>{if(document.hidden)stopLab()});}
window.MonsterForgeAutosave={id:'monster-forge',title:'Monster Forge',version:1,meaningful:()=>monster.items.length>0,capture:()=>({monster:clone(monster)}),summary:()=>`${monster.name||'Untitled monster'} · ${monster.items.length} pieces`,restore:raw=>{const m=safeModel(raw?.monster);if(!m)return false;monster=m;undo=[];redo=[];selectedId=null;render();return true},startFresh:()=>{monster=neutral();undo=[];redo=[];selectedId=null;render()}};
wire();renderSwatches();renderParts();renderScenes();updatePanel();updateCounts();
try{if(!window.ArcadeSave){const m=safeModel(JSON.parse(localStorage.getItem('monsterforge.draft.v1')||'null'));if(m){monster=m;render()}}}catch(_){}
})();
