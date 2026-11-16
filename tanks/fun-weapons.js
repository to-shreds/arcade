/**
 * Playful additional Tank Tactics weapons. The original 84 IDs remain stable.
 * Each entry uses an existing deterministic simulation family. The extra
 * metadata belongs to visuals and browsing, never to authoritative scoring.
 */
const themes = [
['food', '#ff9b5b', [
 ['meatball-meteor','Meatball Meteor','ballistic','A giant meatball hits hard and leaves a saucy crater.','🍝',{damage:81,radius:37,craterScale:.8}],
 ['spaghetti-storm','Spaghetti Storm','cluster','Six bundles of flying noodles split apart midair.','🍝',{damage:84,radius:19,count:6,spread:53}],
 ['pancake-plop','Pancake Plop','ballistic','A giant pancake lands with an enormous flat splat.','🥞',{damage:65,radius:60,craterScale:.15,falloff:.6}],
 ['pickle-ricochet','Pickle Ricochet','bounce','A wobbly pickle rebounds three times before the pop.','🥒',{damage:83,radius:24,bounces:3}],
 ['cereal-shower','Cereal Shower','burst','Crunchy cereal bombards the ground in eight impacts.','🥣',{damage:82,radius:12,count:8,spread:63}],
 ['ice-cream-mountain','Ice Cream Mountain','builder','Drop a giant scoop and pile up a sweet-looking hill.','🍦',{damage:62,radius:38,height:72,width:115,build:1}]
]],
['school','#fbbf24',[
 ['pencil-drill','Pencil Drill','drill','A spinning pencil bores a narrow hole into the ground.','✏️',{damage:92,radius:18,depth:112,count:1}],
 ['eraser-sweep','Eraser Sweep','carver','An enormous eraser scrapes a wide shallow trench.','🧽',{damage:71,radius:32,width:52,depth:17,reach:155}],
 ['paper-plane-squadron','Paper Plane Squadron','cluster','Four paper airplanes separate and dive at the ground.','✈️',{damage:83,radius:18,count:4,spread:74}],
 ['ruler-zap','Ruler Zap','beam','A ruler-straight flash reaches far across the battlefield.','📏',{damage:91,radius:9,width:7,reach:820,craterScale:.2}],
 ['stapler-double-tap','Stapler Double-Tap','burst','Two heavy metallic staples slam down in quick succession.','📎',{damage:91,radius:23,count:2,spread:12}],
 ['backpack-bonk','Backpack Bonk','ballistic','A flying schoolbag delivers a heavy, concentrated bonk.','🎒',{damage:96,radius:26,craterScale:.9}]
]],
['toy','#c084fc',[
 ['rubber-duck-bounce','Rubber Duck Bounce','bounce','A squeaky duck bounces four times before bursting.','🦆',{damage:80,radius:27,bounces:4}],
 ['brick-avalanche','Brick Avalanche','builder','Stack a chunky pile of colorful toy bricks.','🧱',{damage:58,radius:29,height:79,width:93,build:1}],
 ['wind-up-racer','Wind-up Racer','roller','A little wind-up car races across the hillside.','🚗',{damage:89,radius:20,reach:165,count:1}],
 ['jack-in-the-box','Jack-in-the-Box','mine','The little box waits, then pops open with a bang.','🎁',{damage:94,radius:29,fuse:2,count:1}],
 ['domino-disaster','Domino Disaster','burst','Six quick impacts fall one after another like dominoes.','🎲',{damage:85,radius:16,count:6,spread:52}],
 ['yo-yo-laser','Yo-Yo Laser','roller','A spinning yo-yo rolls forward and pops twice.','🪀',{damage:87,radius:24,reach:188,count:2}]
]],
['sports','#67e8f9',[
 ['bowling-ball-blitz','Bowling Ball Blitz','roller','A giant bowling ball rolls downhill before a heavy crash.','🎳',{damage:95,radius:31,reach:245}],
 ['soccer-ball-skip','Soccer Ball Skip','bounce','A soccer ball ricochets twice and finishes with a kick.','⚽',{damage:82,radius:34,bounces:2}],
 ['tennis-ball-barrage','Tennis Ball Barrage','cluster','Seven bouncing-looking tennis balls scatter in a fan.','🎾',{damage:86,radius:14,count:7,spread:60}],
 ['dodgeball-deluge','Dodgeball Deluge','burst','Six dodgeballs hammer a strip of ground in succession.','🏐',{damage:86,radius:20,count:6,spread:66}],
 ['hockey-puck-slider','Hockey Puck Slider','roller','A low puck skids over the ground a long way.','🏒',{damage:91,radius:17,reach:315}],
 ['home-run-howitzer','Home Run Howitzer','ballistic','A giant baseball lands like the ultimate home run.','⚾',{damage:99,radius:24,craterScale:.85}]
]],
['backyard','#86efac',[
 ['mud-pie-mortar','Mud Pie Mortar','ballistic','A splattery mud pie flies through the air.','🥧',{damage:76,radius:42,craterScale:.65}],
 ['sprinkler-spray','Sprinkler Spray','flame','A wild sprinkler scatters tiny jets across the grass.','💦',{damage:79,radius:13,count:11,spread:86,reach:165,craterScale:.1}],
 ['garden-hose-jet','Garden Hose Jet','beam','A narrow jet of water shoots into the distance.','🚿',{damage:78,radius:12,width:14,reach:520,craterScale:.3}],
 ['lawn-gnome-drop','Lawn Gnome Drop','ballistic','A tiny garden gnome makes a surprisingly big entrance.','🧙',{damage:87,radius:28,craterScale:.85}],
 ['leaf-blower-blast','Leaf-Blower Blast','wave','A whoosh of flying leaves sweeps along the ground.','🍃',{damage:77,radius:28,count:8,reach:255,craterScale:.15}],
 ['rake-ripper','Rake Ripper','carver','The rake scrapes a narrow, long trench.','🧹',{damage:85,radius:17,width:22,depth:32,reach:220}]
]],
['house','#fda4af',[
 ['sock-avalanche','Sock Avalanche','cluster','A whole load of lost socks falls out of the sky.','🧦',{damage:79,radius:19,count:9,spread:80}],
 ['vacuum-trench','Vacuum Trench','carver','An enormous vacuum cleans out a long channel.','🧹',{damage:80,radius:22,width:48,depth:30,reach:270}],
 ['toaster-trouble','Toaster Trouble','burst','Three slices of toast spring out and land with a bang.','🍞',{damage:89,radius:27,count:3,spread:40}],
 ['pillow-puff','Pillow Puff','ballistic','A soft-looking pillow makes a very broad impact.','🛏️',{damage:66,radius:59,craterScale:.1,falloff:.55}],
 ['bubble-bath-bombs','Bubble Bath Bombs','cluster','Twelve floating-looking bubbles pop across a wide area.','🫧',{damage:76,radius:12,count:12,spread:82,craterScale:.15}],
 ['runaway-suitcase','Runaway Suitcase','roller','A wheeled suitcase escapes downhill and explodes.','🧳',{damage:88,radius:24,reach:285}]
]],
['gross','#a3e635',[
 ['snot-rocket','Snot Rocket','ballistic','A gooey green rocket leaves a disgusting splash.','🤧',{damage:84,radius:35,craterScale:.65}],
 ['burpquake','Burpquake','wave','Giant green belch waves rumble along the ground.','💨',{damage:88,radius:30,count:4,reach:230,craterScale:.35}],
 ['stink-bomb','Stink Bomb','mine','This smelly surprise waits for someone to get close.','🤢',{damage:87,radius:41,fuse:3,count:1}],
 ['rotten-egg-rain','Rotten Egg Rain','cluster','Eight rotten eggs splat across the battlefield.','🥚',{damage:83,radius:17,count:8,spread:90}],
 ['toothpaste-tsunami','Toothpaste Tsunami','beam','An enormous minty stripe blasts straight ahead.','🪥',{damage:77,radius:23,width:36,reach:425,craterScale:.2}],
 ['slime-slap','Slime Slap','builder','A sticky blob builds a slippery-looking mound.','🟢',{damage:64,radius:44,height:47,width:145,build:1}]
]],
['science','#93c5fd',[
 ['soda-geyser','Soda Geyser','burst','A shaken soda launches eight fizzy bursts.','🥤',{damage:83,radius:17,count:8,spread:44}],
 ['magnet-mayhem','Magnet Mayhem','beam','A magnetic-looking beam zaps along a straight path.','🧲',{damage:88,radius:18,width:20,reach:570,craterScale:.35}],
 ['bubble-ray','Bubble Ray','beam','A broad glowing ray leaves a trail of bubbly sparks.','🫧',{damage:74,radius:25,width:46,reach:340,craterScale:.12}],
 ['marshmallow-meltdown','Marshmallow Meltdown','flame','A rain of toasty marshmallow blobs spreads in a fan.','🍡',{damage:82,radius:18,count:6,spread:45,reach:210,craterScale:.2}],
 ['robot-finger','Robot Finger','beam','A precise robot finger fires a long electric beam.','🤖',{damage:96,radius:10,width:5,reach:900,craterScale:.25}],
 ['tornado-in-a-jar','Tornado-in-a-Jar','wave','A swirling science experiment launches a train of pulses.','🌪️',{damage:83,radius:19,count:9,reach:300,craterScale:.55}]
]]
];
const profile=(kind,stats)=> {
 const r=stats.radius||24;
 if(kind==='builder')return {width:(stats.width||70)/2,depth:0,shape:'bowl'};
 if(kind==='carver')return {width:stats.width,depth:stats.depth,shape:'flat'};
 if(kind==='flame')return {width:r*1.1,depth:1,shape:'flat'};
 if(kind==='beam')return {width:(stats.width||12)/2+3,depth:kind==='beam'?4:2,shape:'flat'};
 if(kind==='wave')return {width:r*1.4,depth:Math.max(4,Math.round(r*(stats.craterScale??1)*.6)),shape:'bowl'};
 if(kind==='drill')return {width:r*.72,depth:Math.max(8,Math.round(r*.8)),shape:'flat'};
 if(kind==='mine')return {width:r*1.25,depth:r*1.15,shape:'bowl'};
 return {width:Math.round(r*1.3),depth:Math.max(2,Math.round(r*(stats.craterScale??1))),shape:(stats.craterScale??1)<.2?'flat':'bowl'};
};
export const FUN_WEAPONS=Object.freeze(themes.flatMap(([theme,color,rows])=>
 rows.map(([id,name,kind,description,symbol,stats],index)=>Object.freeze({
  id,name,kind,icon:kind,description,color,theme,playful:true,symbol,
  iconVariant:6+index,terrainProfile:profile(kind,stats),...stats
 }))
));
export const FUN_THEMES=Object.freeze(themes.map(([theme])=>theme));
