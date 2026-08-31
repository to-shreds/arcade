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

const f=E.createGame("freecell","free-test",{});
assert.equal(f.tableau.reduce((n,p)=>n+p.length,0),52);
assert.equal(E.maxFreeCellRun(f,0),5);
assert(E.freeCellSequence([{suit:"H",rank:8},{suit:"S",rank:7},{suit:"D",rank:6}]));
assert(!E.freeCellSequence([{suit:"H",rank:8},{suit:"D",rank:7}]));

const s=E.createGame("spider","spider-test",{suits:4});
assert.equal(s.tableau.reduce((n,p)=>n+p.length,0),54);assert.equal(s.stock.length,50);
assert(E.dealSpiderRow(s));assert.equal(s.stock.length,40);
s.tableau[0]=[];assert.equal(E.dealSpiderRow(s),false,"Spider cannot deal over an empty column");

const p=E.createGame("pyramid","pyramid-test",{});
assert.equal(p.pyramid.length,28);assert.equal(p.stock.length,24);
for(let i=21;i<28;i++)assert(E.pyramidExposed(p,i));
assert(!E.pyramidExposed(p,20));
assert.deepEqual(E.pyramidChildren(0),[1,2]);

console.log("Solitaire engine: all rule and deal tests passed.");
