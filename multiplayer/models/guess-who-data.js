/* Original Arcade characters. The renderer and room authority share these facts. */
const rows = [
  ['ada','Ada','black','long',1,'none','none',1,0,'blue',1],
  ['ben','Ben','brown','short',0,'cap','none',0,1,'red',0],
  ['cleo','Cleo','red','curly',1,'none','none',1,1,'green',2],
  ['dex','Dex','none','bald',0,'none','beard',0,0,'gold',3],
  ['emi','Emi','blonde','short',1,'beanie','none',0,0,'red',1],
  ['finn','Finn','red','short',0,'none','mustache',0,1,'blue',0],
  ['gia','Gia','brown','long',0,'none','none',1,0,'gold',3],
  ['hugo','Hugo','black','curly',1,'cap','beard',0,0,'green',2],
  ['iris','Iris','silver','long',1,'none','none',0,1,'green',0],
  ['jax','Jax','blonde','short',0,'none','beard',1,0,'gold',2],
  ['kai','Kai','black','short',0,'beanie','none',0,1,'blue',1],
  ['luna','Luna','brown','curly',1,'none','none',1,0,'red',3],
  ['milo','Milo','silver','short',0,'cap','mustache',0,0,'blue',2],
  ['nova','Nova','red','long',0,'none','none',1,1,'green',0],
  ['otis','Otis','none','bald',1,'none','mustache',0,0,'red',1],
  ['pia','Pia','blonde','curly',1,'beanie','none',0,1,'gold',3],
  ['quinn','Quinn','black','long',0,'none','none',0,1,'red',2],
  ['remy','Remy','brown','short',1,'none','beard',0,1,'green',0],
  ['skye','Skye','silver','curly',0,'cap','none',1,0,'gold',1],
  ['theo','Theo','red','short',1,'none','none',0,0,'blue',3],
  ['uma','Uma','brown','long',1,'beanie','none',1,1,'blue',2],
  ['vera','Vera','blonde','long',0,'none','none',0,0,'green',1],
  ['wren','Wren','black','curly',0,'none','mustache',1,0,'gold',3],
  ['zeke','Zeke','silver','short',1,'none','beard',0,1,'red',0]
];
export const CHARACTERS = Object.freeze(rows.map(([id,name,hair,style,glasses,hat,facial,earrings,freckles,shirt,skin]) => Object.freeze({id,name,hair,style,glasses:!!glasses,hat,facial,earrings:!!earrings,freckles:!!freckles,shirt,skin})));
const characters = new Map(CHARACTERS.map(c => [c.id,c]));
export function characterById(id) { return characters.get(id) || null; }
const definitions = [
  ['glasses','Accessories','Do they wear glasses?','glasses',true],
  ['hat','Accessories','Do they wear a hat?','hat','any'],
  ['cap','Accessories','Do they wear a cap?','hat','cap'],
  ['beanie','Accessories','Do they wear a beanie?','hat','beanie'],
  ['earrings','Accessories','Do they wear earrings?','earrings',true],
  ['freckles','Face','Do they have freckles?','freckles',true],
  ['beard','Face','Do they have a beard?','facial','beard'],
  ['mustache','Face','Do they have a mustache?','facial','mustache'],
  ['long','Hair','Do they have long hair?','style','long'],
  ['short','Hair','Do they have short, straight hair?','style','short'],
  ['curly','Hair','Do they have curly hair?','style','curly'],
  ['bald','Hair','Are they bald?','style','bald'],
  ['black','Hair','Do they have black hair?','hair','black'],
  ['brown','Hair','Do they have brown hair?','hair','brown'],
  ['blonde','Hair','Do they have blond hair?','hair','blonde'],
  ['red','Hair','Do they have red hair?','hair','red'],
  ['silver','Hair','Do they have silver hair?','hair','silver'],
  ['shirt-blue','Clothes','Are they wearing a blue shirt?','shirt','blue'],
  ['shirt-red','Clothes','Are they wearing a red shirt?','shirt','red'],
  ['shirt-green','Clothes','Are they wearing a green shirt?','shirt','green'],
  ['shirt-gold','Clothes','Are they wearing a yellow shirt?','shirt','gold']
];
export const QUESTIONS = Object.freeze(definitions.map(([id,group,text,field,value]) => Object.freeze({id,group,text,field,value})));
const questions = new Map(QUESTIONS.map(q => [q.id,q]));
export function questionById(id) { return questions.get(id) || null; }
export function matchesQuestion(character, question) {
  if (!character || !question) throw new TypeError('Unknown character or question');
  return question.value === 'any' ? character[question.field] !== 'none' : character[question.field] === question.value;
}
export function describeCharacter(c) {
  if (!c) return '';
  const hair = c.style === 'bald' ? 'bald' : `${c.style === 'short' ? 'short, straight' : c.style} ${c.hair === 'blonde' ? 'blond' : c.hair} hair`;
  return [hair, c.glasses ? 'glasses' : 'no glasses', c.hat === 'none' ? 'no hat' : c.hat,
    c.facial !== 'none' ? c.facial : '', c.earrings ? 'earrings' : '', c.freckles ? 'freckles' : '',
    `${c.shirt === 'gold' ? 'yellow' : c.shirt} shirt`].filter(Boolean).join(' · ');
}
