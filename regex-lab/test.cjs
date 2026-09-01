"use strict";
const assert=require("node:assert/strict");
const E=require("./engine.js");

assert(E.isSafePattern("^[A-Z]\\d{3}$"));
assert(!E.isSafePattern("(a+)+$"),"nested unbounded quantifiers must be blocked");
assert(!E.isSafePattern("a".repeat(200)),"oversized patterns must be blocked");
assert(!E.safeTest("^a$","","a".repeat(101)),"oversized inputs must be rejected");
assert(E.safeTest("^[A-Z]\\d{3}$","","Q123"));
assert(!E.safeTest("^[A-Z]\\d{3}$","","q123"));

for(const mode of ["hunt","forge","repair","runner"]){
  for(let level=1;level<=4;level++){
    const recent=[];
    for(let i=0;i<80;i++){
      const c=E.makeChallenge({mode,level,seed:`quality-${mode}-${level}-${i}`,recent});
      assert.equal(c.mode,mode);assert.equal(c.level,level);assert(E.isSafePattern(c.pattern));
      assert(!recent.includes(c.fingerprint),"recent challenges should not repeat");
      const reordered={...c,candidates:c.candidates&&c.candidates.slice().reverse(),samples:c.samples&&c.samples.slice().reverse(),choices:c.choices&&c.choices.slice().reverse()};
      assert.equal(E.fingerprint(reordered),c.fingerprint,"reordering buttons must not make a repeated challenge look new");
      recent.push(c.fingerprint);
      if(mode==="hunt"){
        assert(c.candidates.some(x=>x.matches)&&c.candidates.some(x=>!x.matches));
        assert(E.checkAnswer(c,c.answer));assert(!E.checkAnswer(c,[]));
      }else if(mode==="forge"){
        assert.equal(c.choices.length,4);assert.equal(new Set(c.choices).size,4,"forge choices must be distinct");assert(c.answer>=0&&c.answer<4);assert(E.checkAnswer(c,c.answer));
        const truth=c.samples.map(x=>x.matches);
        const result=c.samples.map(x=>E.safeTest(c.choices[c.answer],c.flags,x.text));
        assert.deepEqual(result,truth,"correct forge pattern must classify all samples");
      }else if(mode==="repair"){
        assert.equal(c.choices.length,4);assert.equal(new Set(c.choices).size,4,"repair choices must be distinct");assert(c.broken.includes("___"));assert.equal(c.broken.replace("___",c.patch),c.pattern);assert(E.checkAnswer(c,c.answer));
      }else{
        assert.equal(c.candidates.length,1);assert.equal(E.checkAnswer(c,c.answer),true);assert.equal(E.checkAnswer(c,!c.answer),false);
      }
    }
  }
}
console.log("Regex Lab: 1,280 procedural challenges and safety rules passed.");
