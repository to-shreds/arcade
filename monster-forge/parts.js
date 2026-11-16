/* Monster Forge: hand-authored, recolorable SVG anatomy. No network assets.
 * Coordinates and IDs are stable. v1 artwork is retained in game.js for old saves. */
(function(root){
'use strict';
const ink='#202438',bone='#fff0ce',gum='#df6381',darkMouth='#291e34';
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function shade(hex,amount){const h=/^#[\da-f]{6}$/i.test(hex)?hex:'#8b70ca';return '#'+[1,3,5].map(i=>clamp(parseInt(h.slice(i,i+2),16)+amount,0,255).toString(16).padStart(2,'0')).join('');}
const path=(d,f,extra='')=>`<path d="${d}" fill="${f}" ${extra}/>`;
const line=(d,c=ink,w=3)=>path(d,'none',`stroke="${c}" stroke-width="${w}"`);
const ellipse=(x,y,rx,ry,f,extra='')=>`<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="${f}" ${extra}/>`;
const circle=(x,y,r,f,extra='')=>ellipse(x,y,r,r,f,extra);
const group=(s,w=3.2)=>`<g stroke="${ink}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round">${s}</g>`;
const noStroke='stroke="none"';
const specs=[
// id, label, category, default color, insertion scale, insertion x/y, thumbnail viewBox
['blob','Soft belly','Bodies','#81b79e',1.2,450,335,'-125 -135 250 270'],
['fuzzy','Furry torso','Bodies','#9a85cc',1.25,450,335,'-132 -140 264 280'],
['slime','Slime body','Bodies','#88bd66',1.22,450,340,'-135 -130 270 260'],
['rock','Rock torso','Bodies','#8a98aa',1.18,450,340,'-135 -135 270 270'],
['serpent','Snake coils','Bodies','#64a78f',1.18,450,345,'-140 -145 280 285'],
['shell','Beetle shell','Bodies','#588f8b',1.15,450,345,'-130 -135 260 270'],
['dragonbody','Dragon torso','Bodies','#5da99c',1.18,450,335,'-125 -145 250 290'],
['robotbody','Robot torso','Bodies','#a3aabf',1.12,450,335,'-125 -135 250 270'],
['dragonhead','Dragon head','Heads','#5da99c',.85,450,230,'-135 -120 270 240'],
['beasthead','Beast head','Heads','#9a85cc',.86,450,235,'-135 -125 270 250'],
['insecthead','Insect head','Heads','#588f8b',.85,450,235,'-125 -115 250 230'],
['skull','Skull','Heads','#e8d8bc',.77,450,235,'-110 -125 220 250'],
['robothead','Robot head','Heads','#a3aabf',.82,450,225,'-135 -125 270 250'],
['eye','Round eye','Eyes','#e8b35b',.55,416,246,'-65 -57 130 114'],
['cyclops','Cyclops eye','Eyes','#e6ac57',.64,450,245,'-88 -80 176 160'],
['stalk','Eye stalk','Eyes','#81b79e',.72,411,203,'-60 -130 120 260'],
['sleepy','Sleepy eye','Eyes','#9a85cc',.55,416,246,'-65 -48 130 96'],
['manyeyes','Five eyes','Eyes','#d991ac',.7,450,238,'-110 -100 220 200'],
['reptileeye','Reptile eye','Eyes','#eebc5d',.56,417,246,'-72 -53 144 106'],
['fangs','Vampire fangs','Mouths','#69a596',.7,450,290,'-110 -70 220 140'],
['grin','Toothy grin','Mouths','#9a85cc',.72,450,290,'-115 -70 230 140'],
['beak','Hooked beak','Mouths','#e8b454',.65,450,285,'-115 -100 230 200'],
['jaw','Shark jaws','Mouths','#649db1',.67,450,292,'-120 -100 240 200'],
['mandibles','Bug pincers','Mouths','#517f70',.65,450,289,'-122 -122 244 244'],
['horns','Curved horns','Horns','#c2a37a',.85,450,157,'-138 -135 276 270'],
['antlers','Branch antlers','Horns','#b49374',.83,450,150,'-140 -140 280 280'],
['spikes','Back spikes','Horns','#b2bc85',.7,450,162,'-140 -120 280 240'],
['antenna','Antennae','Horns','#80a382',.77,450,163,'-120 -140 240 280'],
['ramhorn','Ram horn','Horns','#cfb18b',.67,358,223,'-120 -115 240 230'],
['claw','Clawed hand','Limbs','#9a85cc',.88,580,348,'-90 -140 180 280'],
['pincer','Lobster claw','Limbs','#d17c6e',.88,585,325,'-110 -140 220 280'],
['tentacle','Sucker tentacle','Limbs','#70aea8',.95,580,363,'-115 -140 230 280'],
['foot','Dinosaur foot','Limbs','#5da99c',.85,515,450,'-110 -140 220 280'],
['paw','Furry paw','Limbs','#9a85cc',.84,515,450,'-108 -138 216 276'],
['insectleg','Jointed leg','Limbs','#578b83',.9,578,355,'-130 -140 260 280'],
['robotfoot','Robot boot','Limbs','#a3aabf',.7,515,453,'-110 -140 220 280'],
['robotarm','Robot arm','Limbs','#a3aabf',.9,578,338,'-95 -140 190 280'],
['wing','Feathered wing','Wings','#b0b7d4',1.05,603,260,'-145 -140 290 280'],
['batwing','Dragon wing','Wings','#609f94',1.16,603,260,'-145 -145 290 290'],
['fin','Fish fin','Wings','#77afb9',.95,590,328,'-140 -130 280 260'],
['insectwing','Insect wing','Wings','#8ac3c8',1.04,590,285,'-135 -145 270 290'],
['tail','Dragon tail','Tails','#5da99c',1.08,594,388,'-145 -130 290 260'],
['stinger','Scorpion tail','Tails','#c19265',1.06,587,335,'-138 -145 276 290'],
['fishtail','Fish tail','Tails','#77afb9',1.08,450,470,'-135 -138 270 276'],
['spots','Skin spots','Extras','#568878',.8,450,360,'-110 -110 220 220'],
['scales','Dragon scales','Extras','#75b19a',.85,450,358,'-130 -125 260 250'],
['flames','Flame crest','Extras','#e8883f',.65,450,148,'-110 -140 220 280'],
['bolt','Lightning bolt','Extras','#ecc75a',.7,450,340,'-100 -140 200 280'],
['gear','Robot gear','Extras','#c2a883',.47,450,345,'-125 -125 250 250'],
['cloud','Ghost mist','Extras','#b1b6d0',1.0,450,468,'-140 -110 280 220']
];
const parts=Object.fromEntries(specs.map(([id,label,category,color,scale,x,y,viewBox])=>[id,{id,label,category,color,scale,x,y,viewBox,bounds:viewBox.split(' ').map(Number)}]));
const categories=[...new Set(specs.map(s=>s[2]))];
function art(t,c){
 c=/^#[\da-f]{6}$/i.test(c)?c:parts[t]?.color||'#8b70ca';
 const hi=shade(c,35),lo=shade(c,-35),deep=shade(c,-64);
 const shine=(d)=>path(d,hi,noStroke);
 const crease=(d)=>line(d,lo,3);
 const tooth=(d)=>path(d,bone);
 const sucker=(x,y,r=8)=>ellipse(x,y,r,r*.7,'#f0bdb2')+ellipse(x,y,r*.4,r*.3,'#b96980',noStroke);
 const orb=(x,y,r,slit=false)=>circle(x,y,r,'#fff4d7')+circle(x+2,y+2,r*.63,c)+ellipse(x+4,y+2,slit?r*.18:r*.29,r*.44,ink)+circle(x-3,y-r*.3,r*.16,'#fff',noStroke);
 switch(t){
 case 'blob':return group(path('M-50-112C-102-91-113-34-104 43C-100 104-61 123 0 124C72 123 106 100 105 38C103-43 93-108 38-119C9-123-24-122-50-112Z',c)+path('M-35-50C-77-28-79 43-60 78C-44 108 41 113 66 74C91 32 66-35 28-48C6-56-14-56-35-50Z',hi)+crease('M-46 7Q0 20 46 7M-53 37Q0 50 53 37M-44 70Q0 82 43 70')+shine('M-80-50Q-79-92-44-99Q-66-83-66-52Z')+ellipse(-77,49,9,6,lo,noStroke)+ellipse(82,4,7,5,lo,noStroke));
 case 'fuzzy':return group(path('M-52-111L-29-129-19-112 6-132 20-113 44-126 55-106 81-111 83-82 110-85 104-53 125-37 109-12 124 15 108 30 119 61 97 72 99 105 69 100 47 124 22 111 0 131-23 115-52 126-66 105-97 111-95 82-120 68-108 41-124 19-110-6-123-31-105-52-112-77-82-77-81-104Z',c)+path('M-35-42L-19-53 0-43 21-53 36-37C79-8 76 60 54 90L34 86 21 108 4 98-14 110-25 94-48 99C-77 57-75-11-35-42Z',hi)+crease('M-74-64l10 17 7-11M65-52l-8 15-9-9M-91 26l15 11-1-15M80 43l-15 7 7 10M-44 66l13 12 10-6M26 67l-8 14 15-3'));
 case 'slime':return group(path('M-115 93C-119 70-86 58-82 34C-78 2-100-16-85-59C-73-108-38-125 0-119C50-115 79-82 78-41C79-7 92 20 109 44C127 67 116 97 89 99C76 102 62 93 50 99C30 120 3 113-14 106C-35 117-69 117-81 102C-101 108-113 103-115 93Z',c)+shine('M-56-58C-59-88-22-106 4-94C-31-89-31-68-33-51C-40-38-56-42-56-58Z')+path('M-89 81Q-56 98-39 80Q-14 96 13 83Q38 96 60 79Q82 86 97 74','none',`stroke="${lo}" stroke-width="6"`)+circle(-48,24,10,hi,noStroke)+circle(48,-26,7,hi,noStroke)+circle(35,48,15,lo,noStroke)+circle(32,44,5,hi,noStroke));
 case 'rock':return group(path('M-67-113L-22-129 35-120 78-95 118-48 106 6 124 50 92 101 35 120-22 119-78 100-116 59-105 6-122-42Z',c)+path('M-67-113L-45-52-91-8-122-42Z',hi)+path('M35-120L16-57 79-38 118-48 78-95Z',hi)+path('M-45-52L16-57 55 5 31 62-36 69-72 12Z',shade(c,15))+path('M-105 6L-72 12-36 69-78 100-116 59Z',lo)+path('M55 5L106 6 124 50 92 101 31 62Z',lo)+crease('M-13-38l-10 25 17 12-5 27M14 83l9 20-4 15')+line('M-67-113l19 28M45-103l20 9M-62 6l10-27',shade(c,60),3));
 case 'serpent':return group(path('M-112 71C-134 24-97-10-38-12C33-15 72 18 66 44C61 71 22 69-5 61C-23 56-43 53-47 62C-52 80 21 92 69 70C105 54 114 80 97 99C70 129-29 132-79 112C-98 104-111 88-112 71Z',c)+path('M-37 53C-67 29-66-8-32-45C-11-68 8-91-9-115C14-133 48-125 63-104C85-69 49-30 25-7C3 14 2 42 13 64Z',c)+path('M-20 51C-46 16-16-18 5-42C32-71 37-89 19-111L40-109C62-80 32-48 16-27C-7 4-9 25 7 57Z',hi)+crease('M-21 30l25 2M-16 8l23 4M-4-17l24 9M13-40l23 9M28-65l20 6M28-91l21-2M-92 66Q-76 92-35 96M-16 100Q27 108 66 94'));
 case 'shell':return group(path('M-38-121C-99-100-116-52-112 18C-106 93-53 126 0 128C63 125 113 78 113 12C115-60 82-108 34-122Z',lo)+path('M-6-112C-64-110-102-65-99 5C-98 60-63 104-6 115Z',c)+path('M6-112C66-106 103-59 99 4C95 66 59 106 6 115Z',c)+shine('M-69-61Q-46-102-22-95L-22-63Q-60-50-68-19Z')+shine('M22-95Q50-88 66-62L76-24Q48-53 22-63Z')+crease('M-83 17Q-53 13-24 24M-72 55Q-42 49-24 59M83 17Q53 13 24 24M72 55Q42 49 24 59')+ellipse(-51,69,12,7,deep,noStroke)+ellipse(51,69,12,7,deep,noStroke));
 case 'dragonbody':return group(path('M-37-124Q3-143 43-123L50-74C87-49 99-10 96 47C93 102 67 125 5 129C-65 130-108 100-105 50C-104-7-78-49-49-75Z',c)+path('M-24-116Q3-125 26-115L29-61Q63-22 61 30C62 65 43 102 4 108C-39 109-66 78-64 38C-64-14-40-43-25-66Z',hi)+crease('M-24-84Q1-74 28-84M-34-56Q0-43 39-53M-49-28Q3-11 54-24M-58 4Q0 23 60 6M-58 39Q0 60 58 40M-49 72Q0 90 45 72')+path('M-77-22l-18-25 27 11M85 22l24-19-26 3M-90 67l-21 5 25 14',lo));
 case 'robotbody':return group(path('M-84-99L-59-123H59L85-99 98 80 67 116H-67L-98 80Z',c)+path('M-84-99L-59-123H59L85-99Z',hi)+path('M-98 80H98L67 116H-67Z',lo)+`<rect x="-69" y="-77" width="138" height="134" rx="18" fill="${deep}"/>`+`<rect x="-56" y="-64" width="112" height="76" rx="10" fill="#83d4c5"/>`+line('M-43-24h20l12-22L6-9 13-24h30','#21574e',5)+circle(-32,35,9,'#e7aa65')+circle(0,35,9,'#e16d71')+circle(32,35,9,'#84c58d')+line('M-42 80H42M-35 92H35',deep,4)+[-73,73].map(x=>[-87,73].map(y=>circle(x,y,5,hi)+line(`M${x-2} ${y+2}l4-4`,deep,2)).join('')).join(''));
 case 'dragonhead':return group(path('M-91-39L-117-76-66-67Q-42-105 0-104Q46-105 75-68L121-71 99-29Q118-7 114 28Q109 77 60 91Q0 112-65 86Q-112 63-111 16Z',c)+path('M-74 8Q-45-10 0 0Q49-12 78 9L93 45Q71 74 0 77Q-70 72-92 42Z',hi)+ellipse(-42,21,8,5,deep)+ellipse(42,21,8,5,deep)+crease('M-67-74l14 10M67-74l-14 10M-88-18l-13 11M89-17l12 10')+line('M-70 51Q0 66 70 51',deep,3));
 case 'beasthead':return group(path('M-89-46L-119-92-74-87-48-114-30-99-4-120 16-102 39-117 60-95 85-100 114-84 92-44L111-21 99 7 116 26 94 44 104 64 78 76 56 101 32 91 5 112-22 96-46 104-64 82-93 81-96 57-116 40-100 18-115-3Z',c)+path('M-48 4Q-26-15 0-3Q26-17 49 4L69 37Q53 74 0 80Q-54 73-70 37Z',hi)+path('M-17 6Q0-1 17 6L11 23Q0 30-11 23Z',deep)+line('M0 26v12',deep,3)+crease('M-78-47l11 13 7-9M73-46l-10 13-6-8M-83 42l15 3M70 44l14-4'));
 case 'insecthead':return group(path('M0-98C-65-101-105-60-105-8C-103 55-60 95 0 105C61 94 103 57 105-8C105-60 66-101 0-98Z',c)+path('M-9-93L-23-56-17 27 0 66 17 27 23-56 9-93Z',hi)+ellipse(-62,-17,26,46,lo)+ellipse(62,-17,26,46,lo)+crease('M-43 64L-33 76M43 64L33 76')+line('M0-80v38',shade(c,65),4));
 case 'skull':return group(path('M-91-32C-101-88-62-114 0-114C65-114 102-83 91-29L80 18 86 42 60 61 53 101H-53L-61 61-87 41-80 17Z',c)+path('M-75-27Q-49-54-16-26L-22 17Q-57 32-75 5Z',darkMouth)+path('M75-27Q49-54 16-26L22 17Q57 32 75 5Z',darkMouth)+path('M0 19L-14 46 14 46Z',darkMouth)+line('M-45 71H45M-30 71v27M-10 71v28M10 71v28M30 71v27',lo,3)+line('M-16-105l-9 22 14 13-8 19',lo,3)+shine('M-71-59Q-53-90-32-91L-39-69Z'));
 case 'robothead':return group(` <rect x="-95" y="-85" width="190" height="173" rx="26" fill="${c}"/>`+path('M-85-78L-64-102H64L86-78Z',hi)+`<rect x="-72" y="-57" width="144" height="73" rx="13" fill="#294044"/>`+line('M-54-35h29M25-35h29','#74e1c6',5)+`<rect x="-48" y="40" width="96" height="28" rx="7" fill="${deep}"/>`+line('M-29 45v18M-10 45v18M10 45v18M29 45v18',hi,4)+path('M-95-36H-119V28H-95M95-36H119V28H95',lo)+line('M0-100v-16',lo,5)+circle(0,-116,9,'#e7aa65'));
 case 'eye':return group(ellipse(0,0,58,47,lo)+ellipse(0,0,52,41,'#fff4d7')+circle(4,2,29,c)+circle(7,3,16,ink)+circle(-2,-10,9,'#fff',noStroke)+circle(17,13,4,'#fff',noStroke)+line('M-46-31Q-5-56 39-33',hi,4));
 case 'cyclops':return group(ellipse(0,0,78,69,lo)+ellipse(0,0,65,56,'#fff4d7')+circle(3,1,39,c)+circle(5,2,22,ink)+circle(-7,-15,12,'#fff',noStroke)+circle(19,17,5,'#fff',noStroke)+line('M-59-47Q0-76 58-45',hi,5));
 case 'stalk':return group(path('M-15 122C-29 71-20 24-17-27L16-29Q3 56 19 121Z',c)+shine('M-11 111Q-26 63-14 6L-6 8Q-16 59-3 111Z')+circle(0,-67,51,lo)+orb(0,-69,44));
 case 'sleepy':return group(ellipse(0,0,58,35,'#fff4d7')+ellipse(8,6,18,23,c)+ellipse(10,8,7,15,ink)+path('M-57-3Q0-56 57-3L56 7Q0-12-56 9Z',c)+line('M-57 9Q0-13 56 7',ink,4)+line('M-54 10l-7 9M53 9l8 8',ink,3));
 case 'manyeyes':return group([[-48,-35,30],[21,-53,28],[62,5,30],[4,42,33],[-61,38,26]].map(([x,y,r])=>orb(x,y,r)).join(''));
 case 'reptileeye':return group(path('M-64 3Q-23-55 27-38Q52-32 65-2Q20 45-27 33Q-52 26-64 3Z',lo)+path('M-58 2Q-10-40 34-24L57-2Q18 34-22 26Z','#fff1c2')+ellipse(4,0,27,29,c)+ellipse(6,0,6,27,ink)+ellipse(-4,-11,5,9,'#fff',noStroke)+line('M-64 1Q-23-55 27-38Q52-32 65-2',deep,8));
 case 'fangs':return group(path('M-100-25Q0-78 100-25Q88 44 0 57Q-88 45-100-25Z',c)+path('M-87-23Q0-47 87-23Q73 34 0 39Q-74 35-87-23Z',darkMouth)+path('M-45 28Q0-3 46 29Q0 47-45 28Z',gum)+tooth('M-71-25L-60 33Q-39 16-35-30Z')+tooth('M35-30Q39 16 60 33L71-25Z')+tooth('M-16-35L-7-17 4-36M7-36L18-17 27-34')+line('M-95-23Q0-64 95-23',hi,4));
 case 'grin':return group(path('M-105-33Q0-2 105-33Q86 61 0 61Q-88 60-105-33Z',lo)+path('M-91-21Q0 7 91-21Q70 38 0 45Q-71 36-91-21Z',bone)+line('M-66-10l8 33M-39-2l4 37M-12 3v39M15 2v39M42-2l-5 36M67-11l-9 33',ink,3)+line('M-94-22Q0 7 94-22',ink,4));
 case 'beak':return group(path('M-97-23Q-59-88 5-78Q80-70 105-12Q74 0 58 50Q52 68 32 82Q29 26 5 19L-72 19Z',c)+path('M-72 25Q-20 33 14 29L31 67Q-17 81-61 59Z',lo)+shine('M-73-30Q-45-70-3-62Q51-58 75-25Q24-48-20-21Z')+ellipse(-29,-21,9,6,deep)+line('M-84 12Q-32 7 6 19',ink,4));
 case 'jaw':return group(path('M-108-37Q0-115 108-37L89 44Q56 94 0 91Q-68 90-93 43Z',c)+path('M-91-32Q0-88 91-32L72 36Q43 71 0 72Q-51 69-75 33Z',darkMouth)+path('M-53 47Q0 24 53 47Q0 78-53 47Z',gum)+[-66,-33,0,33,66].map((x,i)=>tooth(`M${x-14} ${-39-Math.sin(i*Math.PI/4)*14}L${x} ${-2-i%2*4}L${x+14} ${-39-Math.sin(i*Math.PI/4)*14}Z`)).join('')+[-51,-17,17,51].map(x=>tooth(`M${x-15} 48L${x} 19L${x+15} 48Z`)).join(''));
 case 'mandibles':return group(path('M-28-94Q-89-92-107-40Q-128 24-55 98L-42 57-69 55-60 24-85 13-66-12-82-32-59-51-57-74Z',c)+path('M28-94Q89-92 107-40Q128 24 55 98L42 57 69 55 60 24 85 13 66-12 82-32 59-51 57-74Z',c)+line('M-78-55Q-109 8-66 62M78-55Q109 8 66 62',hi,5));
 case 'horns':return group(path('M-39 107C-84 93-123 50-126-17C-128-66-110-102-91-123C-103-71-91-32-63-8Q-29 26-16 91Z',c)+path('M39 107C84 93 123 50 126-17C128-66 110-102 91-123C103-71 91-32 63-8Q29 26 16 91Z',c)+line('M-47 82l-39 0M-59 58l-39-9M-77 31l-35-17M-96 0l-26-19M47 82l39 0M59 58l39-9M77 31l35-17M96 0l26-19',lo,3)+line('M-44 84Q-107 33-111-32M44 84Q107 33 111-32',hi,4));
 case 'antlers':{const d='M-19 122L-37 61-65 6-71-51-63-118M-40 54L-100 17-124-28M-65 6L-109-52-112-99M-69-39L-24-74-8-106M19 122L37 61 65 6 71-51 63-118M40 54L100 17 124-28M65 6L109-52 112-99M69-39L24-74 8-106';return group(line(d,ink,17)+line(d,c,11)+line('M-19 116L-40 52M19 116L40 52',hi,3));}
 case 'spikes':return group(path('M-131 92L-106-13-79 68-47-75-16 64 22-109 47 58 89-63 101 62 130 11 125 91Z',c)+path('M-106-13L-94 86-79 68M-47-75L-43 87-16 64M22-109L11 86 47 58M89-63L72 88 101 62',hi)+path('M-131 92Q0 67 125 91L123 104H-125Z',lo));
 case 'antenna':return group(line('M-34 119C-44 39-91 19-85-61Q-81-99-108-118M34 119C44 39 91 19 85-61Q81-99 108-118',ink,13)+line('M-34 119C-44 39-91 19-85-61Q-81-99-108-118M34 119C44 39 91 19 85-61Q81-99 108-118',c,8)+ellipse(-108,-117,10,14,hi)+ellipse(108,-117,10,14,hi)+line('M-75 1l-16 8M75 1l16 8M-85-35l-17 1M85-35l17 1',lo,4));
 case 'ramhorn':return group(path('M49 89C-11 121-101 85-107 16C-115-51-67-101-9-104C66-106 109-55 103-5C99 38 64 65 26 54C-6 44-9 11 5-6Q22-23 40-8Q20-5 26 11Q43 26 59 7C77-21 56-58 14-61C-40-64-74-11-47 29Q-20 71 49 63Z',c)+line('M37 79l-7 22M5 75l-13 24M-28 61l-19 23M-53 41l-27 14M-66 10l-33 2M-63-23l-29-13M-47-48l-19-24M-20-64l-5-30M12-63l7-32M44-51l21-23M62-26l29-12M62 3l29 12',lo,3));
 case 'claw':return group(path('M-31-125L29-125Q21-77 34-45L58-9Q82 13 67 39L52 66 40 88 20 85 14 98-4 94-13 102-31 94-46 74-58 31-69 8Q-76-10-57-15Q-42-13-27 10Q-33-30-39-58Z',c)+path('M-28-118L-13-117Q-25-62-10-35Q0-6-4 10L-19 8Q-27-12-32-52Z',hi,noStroke)+tooth('M-47 65Q-48 103-21 118Q-30 87-31 74Z')+tooth('M-18 83Q-20 122 5 127Q-3 101-3 88Z')+tooth('M10 83Q13 118 34 115L25 84Z')+tooth('M40 69Q50 104 66 94L54 57Z')+line('M-28 16Q-8 2 15 10M-33 38Q-13 26 15 35M-27 63l3-20M0 74l-1-29M27 70l-8-25',lo,3));
 case 'pincer':return group(path('M-28 124L32 124 41 72Q90 48 94-17Q102-76 60-125L48-74 58-58 38-32 39-8 13 13-1-10-20-9-33-35-23-56-40-90Q-88-61-95-5Q-102 55-41 77Z',c)+path('M-24 76Q0 91 32 77L30 115H-23Z',lo)+shine('M-72 13Q-79-25-51-58L-43-39Q-64-16-58 15Q-56 35-41 43L-51 54Q-66 44-72 13Z')+crease('M-31 93H31M-29 109H31M48 13Q68-1 73-26'));
 case 'tentacle':return group(path('M-33-127Q6-137 30-117C23-61 67-33 72 16C80 64 57 111 16 121C-30 134-78 101-70 60Q-64 29-38 25Q-12 24-10 45Q-7 65-27 67Q-43 68-40 53C-56 66-30 90-10 79Q12 67 5 38C-3 9-31-6-43-42Q-55-82-33-127Z',c)+path('M8-117Q-5-65 26-15C68 49 33 107-11 104Q-45 104-56 82Q-20 109 10 81C32 55 20 25 0 0Q-27-34-27-71L-20-122Z',hi,noStroke)+sucker(4,-79,8)+sucker(11,-51,9)+sucker(25,-22,9)+sucker(37,7,10)+sucker(40,38,10)+sucker(29,68,9)+sucker(7,88,8)+sucker(-17,93,7));
 case 'foot':return group(path('M-38-127L39-124Q27-62 41-21Q45 12 69 37L91 65Q111 101 79 113L42 108Q22 126-5 114Q-27 128-48 113Q-89 117-95 94Q-99 74-78 57L-58 25Q-44-6-48-54Z',c)+shine('M-26-116L-7-117Q-18-39-7-11L-29 19Q-43-34-26-116Z')+tooth('M-80 91Q-99 110-86 125L-57 104Z')+tooth('M-43 103Q-59 127-38 129L-20 109Z')+tooth('M-3 105Q-14 132 11 126L18 109Z')+tooth('M43 99Q38 126 62 117L64 104Z')+crease('M-48 68Q-29 58-12 65M4 64Q22 59 39 68M-24-35l28 2M-24-18l30 4'));
 case 'paw':return group(path('M-45-125L-19-113-1-129 19-113 43-122 40-88 53-61 43-36 58-3 52 26C91 40 110 76 94 98Q75 124 42 112Q22 128 0 115Q-23 128-44 113Q-82 124-97 96C-110 71-87 36-56 26L-63 1-49-28-57-57-42-82Z',c)+path('M-26-94L-12-82 2-94 17-81 26-94 22-27 6-5-14-12-25-3-34-31Z',hi)+tooth('M-84 94L-78 121-59 102Z')+tooth('M-43 106L-31 130-20 108Z')+tooth('M2 108L13 132 25 106Z')+tooth('M49 101L69 122 75 95Z')+crease('M-53 61Q-21 37 2 57Q30 36 60 60M-43 69v14M2 66v18M47 69v11'));
 case 'insectleg':{const d='M-107-104L-35-56 55-88 12 14 108 119';return group(line(d,ink,23)+line(d,c,16)+circle(-35,-56,17,lo)+circle(55,-88,14,hi)+circle(12,14,13,lo)+path('M87 103L118 121 107 89Z',bone)+line('M-24-50L22-67M38-60L20-10M31 40l44 49',hi,3));}
 case 'robotfoot':return group(path('M-39-126H39V-30L65-2 91 56 92 103Q0 125-91 103V57L-63-4-39-30Z',c)+path('M-39-126H39V-104H-39Z',hi)+path('M-91 83Q0 103 92 83V103Q0 125-91 103Z',lo)+path('M-58 0H58L75 54Q0 72-75 54Z',hi)+line('M-26-76H26M-26-55H26M-31 17v32M0 16v37M31 17v32',deep,4)+circle(0,-21,15,lo)+circle(0,-21,6,hi));
 case 'robotarm':return group(` <rect x="-34" y="-117" width="68" height="81" rx="13" fill="${c}"/>`+path('M-33-110L-18-130H22L33-110Z',hi)+circle(0,-26,29,lo)+circle(0,-26,14,hi)+line('M-7-26H7',deep,4)+path('M-24 0L22 1 32 64-31 62Z',c)+path('M-31 53L-62 72-60 110-38 120-26 102-41 94-35 79H28L40 95 27 103 40 121 62 111 63 76 34 56Z',lo)+line('M-15-98v40M-9 13v34',hi,5)+line('M-20 42H23',deep,4));
 case 'wing':return group(path('M-125 106C-116 46-90-10-49-48C-9-88 36-117 88-126Q97-111 81-91L49-55 117-96Q136-102 132-82Q124-65 82-34L129-54Q146-50 131-30Q113-13 78 7L121-9Q139-3 125 15Q105 37 68 50L97 46Q113 55 98 72Q74 94 36 95L49 100Q55 116 29 120C-18 122-51 99-76 86L-102 113Z',c)+path('M-118 99Q-98 21-30-31Q29-73 66-97Q22-48-7-1Q-45 58-77 78Z',hi)+line('M-95 89Q-38 33 51-55M-72 75Q-43 52-26 13M-50 81L20 16M-16 99L50 48M24 107L70 79M-6 1L78-34',lo,3)+line('M-104 93Q-74 27-27-9',shade(c,60),4));
 case 'batwing':return group(path('M-128 111L-111-24Q-73-102-16-123L-20-78Q47-89 126-128L83-49 128-19Q93-3 88 46Q48 11 24 83Q-17 44-49 107Q-86 73-128 111Z',c)+path('M-105 84L-84-23-21-76 81-67 61-34 96-16Q74 0 74 23Q43 1 22 57Q-16 26-48 80Q-75 61-105 84Z',shade(c,55))+line('M-127 108L-85-24-17-81 124-126M-85-24L-49 105M-85-24L24 81M-85-24L87 44M-85-24L126-19',deep,6)+tooth('M-25-95Q-17-126-1-135L-7-102Z')+line('M-111 69L-95-12-33-67',hi,4));
 case 'fin':return group(path('M-126 62Q-60 3-81-114Q-35-91-16-48Q32-92 69-108Q40-47 47-25L127-54Q93 20 125 101Q47 75-25 108Q-48 68-126 62Z',c)+path('M-117 61Q-55 32-46-69L-26-10 45-64 25 4 91-22 67 29 95 77 34 55-20 86Q-65 52-117 61Z',hi,noStroke)+line('M-119 61L-51-23-79-110M-118 61L7 5 67-104M-118 61L54 29 122-50M-118 61L63 63 121 97M-118 61L-25 104',lo,3));
 case 'insectwing':return group(path('M-110 123C-129 59-113-59-43-117C-17-140 41-143 72-106C121-48 73 40 18 80Q-52 135-110 123Z',hi,'fill-opacity=".86"')+line('M-108 122Q-60 24 49-103M-71 66L-93-24-54-96M-71 66L-8 52 65-19M-34 13L-43-54 18-126M-34 13L27 4 84-47M2-35L47-32 79-77',lo,3)+line('M-113 121Q-44 73 18 80',lo,3));
 case 'tail':return group(path('M-127 32C-74 58-39 80 11 52C50 28 39-13 83-44Q114-63 134-44C110-44 104-17 104 6C106 64 79 105 21 114C-32 126-86 107-128 76Z',c)+path('M-117 65C-44 102 7 109 49 74Q80 50 79 7Q77-18 98-34Q86-4 91 13C95 73 64 103 13 106Q-51 118-117 83Z',hi,noStroke)+path('M-92 38L-80 8-59 55M-43 66L-26 31-9 66M14 52L30 12 43 29M57-3L55-42 77-38M91-47L103-77 117-53',lo)+crease('M-70 84l-11 17M-38 95l-6 17M-2 98l1 16M29 88l8 15M55 69l13 9'));
 case 'stinger':return group(path('M-127 101Q-90 109-62 91C-16 62-45 19-55-16C-79-79-47-124 15-127Q91-132 117-67L94-53Q78-94 38-92C-7-94-20-64-6-26C16 37 17 81-23 113Q-61 141-114 127Z',c)+path('M87-72Q112-88 125-53Q140-18 100 7Q119-28 87-34L77-49Z',bone)+crease('M-101 107l5 23M-76 100l13 30M-48 82l24 24M-35 55l33 10M-36 23l34-6M-48-10l33-12M-54-44l34 1M-45-77l28 18M-23-102l16 29M9-113l3 24M43-113l-4 23M74-98l-11 20'));
 case 'fishtail':return group(path('M-38-127L39-127Q23-50 19-27Q61-64 114-70Q88-8 118 80Q66 55 4 107Q-58 54-117 80Q-84 9-115-70Q-62-64-19-27Z',c)+path('M-12-42Q-16 19 3 83Q18 22 13-42L4-23Z',lo)+line('M-14-15Q-44-29-88-45M-8 7Q-53-1-91-12M-1 39Q-62 21-96 37M16-15Q44-29 89-45M9 7Q53-1 92-12M3 39Q62 21 96 37',hi,4));
 case 'spots':return group([[-59,-52,25,19],[31,-69,15,11],[62,10,24,35],[-15,25,19,14],[-61,70,16,13],[37,82,12,10]].map(([x,y,rx,ry],i)=>ellipse(x,y,rx,ry,i%2?hi:lo,`stroke-width="2"`)).join(''));
 case 'scales':return group(Array.from({length:15},(_,i)=>{const row=Math.floor(i/5),x=(i%5)*43-86+(row%2?6:0),y=row*56-70;return path(`M${x-21} ${y}Q${x} ${y-23} ${x+21} ${y}Q${x+15} ${y+29} ${x} ${y+40}Q${x-15} ${y+29} ${x-21} ${y}Z`,i%3===0?hi:c)+line(`M${x-10} ${y+2}Q${x} ${y-7} ${x+9} ${y+2}`,shade(c,55),2)}).join(''),2);
 case 'flames':return group(path('M-64 116C-122 78-85 20-73-16Q-68 18-47 27C-58-38 4-88-12-127Q63-83 44-18Q64-35 75-57C74-7 108 24 96 65Q79 126 19 125Z',c)+path('M-27 110C-68 80-40 41-36 7Q-22 41-6 49Q-6 10 20-23Q9 30 41 53Q67 83 39 114Z','#ffcc60')+path('M-9 109Q-28 89-5 68Q-4 85 13 84Q33 107 13 116Z',bone,noStroke));
 case 'bolt':return group(path('M0-129L-85 13H-13L-45 128 88-41H19L59-129Z',c)+path('M22-112L-51-4H9L-14 68 57-25H-5Z',hi,noStroke));
 case 'gear':{let pts=[];for(let i=0;i<48;i++){const a=i*Math.PI/24,r=i%4<2?114:92;pts.push(`${(Math.cos(a)*r).toFixed(2)},${(Math.sin(a)*r).toFixed(2)}`)}return group(`<polygon points="${pts.join(' ')}" fill="${c}"/>`+circle(0,0,70,lo)+circle(0,0,45,hi)+circle(0,0,23,deep)+[0,1,2,3].map(i=>{const a=i*Math.PI/2;return circle(Math.cos(a)*59,Math.sin(a)*59,6,hi)}).join(''));}
 case 'cloud':return group(path('M-126 38Q-136 0-99-10Q-105-57-61-68Q-32-96-1-66Q41-90 60-49Q108-54 111-10Q139 4 129 38Q104 61 60 49Q29 80-6 58Q-38 81-65 56Q-110 73-126 38Z',c,'fill-opacity=".78"')+line('M-100 18Q-84-7-61 10M-40-35Q-16-58 6-39M48 7Q70-13 86 8M-9 33Q14 15 40 32',hi,5));
 default:return '';
 }
}
// Recipes are assembled from the same editable parts as the picker.
function recipe(id,options={}){
 const palettes={dragon:['#62a899','#d6b16d','#b5cf8e'],beast:['#9d8fcb','#e5c796','#bac4d8'],kraken:['#629fa7','#e0a46c','#b4cfcd'],crawler:['#647d76','#d4aa63','#91b6ac'],golem:['#999eb5','#e7b967','#7fc8b5'],slime:['#91b874','#d4b56c','#bad793']};
 const names={dragon:'Mossback Dragon',beast:'Moon Yeti',kraken:'Deep-sea Lurker',crawler:'Cave Crawler',golem:'Scrap Golem',slime:'Slime Monarch'};
 const scenes={dragon:'swamp',beast:'cave',kraken:'sea',crawler:'cave',golem:'city',slime:'swamp'};
 if(!palettes[id])id='dragon';const [base,accent,detail]=options.colors||palettes[id];
 const items=[];
 function add(type,x,y,scale=1,color=base,rot=0,flip=1){items.push({kind:'part',type,x,y,scale,color,rot,flip,artVersion:2});}
 function pair(type,x,y,s,col=base,rot=0){add(type,x,y,s,col,rot,-1);add(type,900-x,y,s,col,-rot,1);}
 if(id==='dragon'){
 add('tail',594,398,1.0,base);pair('batwing',285,274,.94,base,0);
 pair('foot',385,454,.62,base,0);add('dragonbody',450,350,1.13,base);
 pair('claw',328,346,.6,base,-12);add('horns',450,155,.68,accent);
 add('dragonhead',450,244,.85,base);pair(options.eyes||'reptileeye',414,233,.45,accent,0);add('fangs',450,293,.61,base);
 }else if(id==='beast'){
 pair('paw',386,457,.67,base);pair('claw',319,352,.81,base,-12);
 add('fuzzy',450,349,1.18,base);pair('ramhorn',361,213,.64,accent,0);
 add('beasthead',450,250,.98,base);pair(options.eyes||'sleepy',413,244,.48,detail,0);add('grin',450,294,.64,base);
 }else if(id==='kraken'){
 pair('tentacle',285,374,1.0,base,-35);pair('tentacle',356,432,.91,base,-17);
 pair('fin',325,283,.68,detail,0);add('blob',450,299,1.2,base);
 pair('stalk',400,151,.63,base,12);add(options.eyes||'cyclops',450,272,.73,accent);add('jaw',450,349,.68,base);
 add('spots',453,384,.42,detail);
 }else if(id==='crawler'){
 pair('insectleg',290,312,.85,base,22);pair('insectleg',296,382,.89,base,0);
 pair('insectleg',322,443,.78,base,-17);add('shell',450,363,1.07,base);
 add('antenna',450,153,.7,base);add('insecthead',450,240,.79,base);
 pair(options.eyes||'eye',402,230,.5,accent,0);add('mandibles',450,294,.53,base);
 }else if(id==='golem'){
 pair('robotfoot',387,451,.58,base,0);pair('robotarm',316,348,.86,base,-7);
 add('robotbody',450,352,1.06,base);add('gear',450,359,.35,accent);
 add('robothead',450,224,.88,base);pair(options.eyes||'eye',417,204,.42,detail,0);
 }else{
 pair('tentacle',328,342,.68,base,-30);add('slime',450,352,1.5,base);
 add('spikes',450,173,.68,accent);add(options.eyes||'cyclops',450,286,.77,accent);add('grin',450,373,.77,base);
 add('spots',449,436,.45,detail);
 }
 return {id,name:names[id],scene:scenes[id],items,colors:[base,accent,detail]};
}
root.ForgeParts={version:2,parts,categories,art,recipe,starterIds:['dragon','beast','kraken','crawler','golem','slime']};
})(typeof window==='undefined'?globalThis:window);
