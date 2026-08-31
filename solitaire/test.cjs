"use strict";
const assert = require("node:assert/strict");
const E = require("./engine.js");

for(const [variant,options] of [["klondike",{drawCount:1}],["klondike",{drawCount:3}],["spider",{suits:1}],["spider",{suits:2}],["spider",{suits:4}],["freecell",{}],["pyramid",{}]]){
  const a=E.createGame(variant,"repeatable-42",options),b=E.createGame(variant,"repeatable-42",options);
  assert.equal(JSON.stringify({...a,startedAt:0}),JSON.stringify({...b,startedAt:0}),`${variant} deals must be deterministic`);
  assert(E.validateState(a),`${variant} state should validate`);
}

const k=E.createGame("klondike","draw-test",{drawCount:3});
assert.equal(k.tableau.reduce((n,p)=>n+p.length,0),28);
assert.equal(k.stock.length,24);
assert(E.drawKlondike(k));
assert.equal(k.stock.length,21); assert.equal(k.waste.length,3); assert.equal(k.moves,1);
assert(E.undo(k)); assert.equal(k.stock.length,24); assert.equal(k.moves,0);

const manual=E.createGame("klondike","legal-test",{drawCount:1});
manual.tableau=[
  [{id:"x",suit:"H",rank:8,faceUp:true}],
  [{id:"y",suit:"S",rank:7,faceUp:true}],
  [],[],[],[],[]
];
manual.stock=[];manual.waste=[];manual.foundations={S:[],H:[],D:[],C:[]};manual.history=[];
assert(E.moveKlondike(manual,{kind:"tableau",pile:1,index:0},{kind:"tableau",pile:0}));
assert.equal(manual.tableau[0].length,2);
assert.equal(manual.score,0,"rearranging exposed tableau cards must not farm score");

const f=E.createGame("freecell","free-test",{});
assert.equal(f.tableau.reduce((n,p)=>n+p.length,0),52);
assert.equal(E.maxFreeCellRun(f,0),5);
assert(E.freeCellSequence([{suit:"H",rank:8},{suit:"S",rank:7},{suit:"D",rank:6}]));
assert(!E.freeCellSequence([{suit:"H",rank:8},{suit:"D",rank:7}]));

const freeScore=E.createGame("freecell","score-test",{});
freeScore.tableau=[[{id:"ace-score",suit:"S",rank:1,faceUp:true}],[],[],[],[],[],[],[]];
freeScore.cells=[null,null,null,null];freeScore.stock=[];freeScore.waste=[];
freeScore.foundations={S:[],H:[],D:[],C:[]};freeScore.history=[];freeScore.score=0;
assert(E.moveFreeCell(freeScore,{kind:"tableau",pile:0,index:0},{kind:"foundation",suit:"S"}));
assert.equal(freeScore.score,10);
assert(E.moveFreeCell(freeScore,{kind:"foundation",suit:"S"},{kind:"tableau",pile:0}));
assert.equal(freeScore.score,0,"moving a foundation card back must reverse its scoring value");
assert(E.moveFreeCell(freeScore,{kind:"tableau",pile:0,index:0},{kind:"foundation",suit:"S"}));
assert.equal(freeScore.score,10,"foundation score must not be farmable");

const s=E.createGame("spider","spider-test",{suits:4});
assert.equal(s.tableau.reduce((n,p)=>n+p.length,0),54);assert.equal(s.stock.length,50);
assert(E.dealSpiderRow(s));assert.equal(s.stock.length,40);
s.tableau[0]=[];assert.equal(E.dealSpiderRow(s),false,"Spider cannot deal over an empty column");

const cascade=E.createGame("spider","cascade-test",{suits:1});
const run=(prefix,from,to)=>Array.from({length:from-to+1},(_,i)=>({id:`${prefix}-${from-i}`,suit:"S",rank:from-i,faceUp:true}));
cascade.tableau=[
  [...run("lower",13,1),...run("upper",13,2)],
  [{id:"moving-ace",suit:"S",rank:1,faceUp:true}],
  [],[],[],[],[],[],[],[]
];
cascade.stock=[];cascade.completed=[];cascade.history=[];cascade.score=0;
assert(E.moveSpider(cascade,{kind:"tableau",pile:1,index:0},{kind:"tableau",pile:0}));
assert.equal(cascade.completed.length,2,"stacked complete Spider runs should both clear immediately");
assert.equal(cascade.tableau[0].length,0);

const p=E.createGame("pyramid","pyramid-test",{});
assert.equal(p.pyramid.length,28);assert.equal(p.stock.length,24);
for(let i=21;i<28;i++)assert(E.pyramidExposed(p,i));
assert(!E.pyramidExposed(p,20));
assert.deepEqual(E.pyramidChildren(0),[1,2]);

const wastePair=E.createGame("pyramid","waste-pair",{});
wastePair.waste.push(wastePair.stock.pop());wastePair.waste[0].faceUp=true;
const wasteRank=wastePair.waste[0].rank;
if(wasteRank===13)assert(E.removePyramidPair(wastePair,{kind:"waste"},null));
else{wastePair.pyramid[27].rank=13-wasteRank;assert(E.removePyramidPair(wastePair,{kind:"pyramid",index:27},{kind:"waste"}));}
assert.equal(wastePair.waste.length,0);assert.equal(wastePair.cleared.length,1);
assert(E.validateState(wastePair),"cleared waste cards must remain represented in saved Pyramid state");

console.log("Solitaire engine: all rule and deal tests passed.");
