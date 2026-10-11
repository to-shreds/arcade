import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const html=await readFile(new URL('../mad-libs/index.html',import.meta.url),'utf8');
const data=JSON.parse(html.match(/var DATA=(.*?);\nvar stories=/s)[1]);
assert.equal(data.stories.length,68);
let fixed=0,uses=0;
for(const story of data.stories){
  const refs=[...story.template.matchAll(/\{(\d+)\}/g)].map(m=>Number(m[1]));
  assert.equal(story.prompts.length,18,story.title);
  assert.deepEqual([...new Set(refs)].sort((a,b)=>a-b),Array.from({length:18},(_,i)=>i),story.title+' uses every answer');
  const fixedWords=story.template.replace(/\{\d+\}/g,' ').split(/\s+/).filter(Boolean).length;
  assert.ok(fixedWords<=45,story.title+' has short fixed prose');
  for(const sentence of story.template.match(/[^.!?]+[.!?]+|[^.!?]+$/g)||[]){
    if(!/[A-Za-z0-9]/.test(sentence))continue;
    assert.match(sentence,/\{\d+\}/,story.title+' has no sentence without blanks');
  }
  for(const run of story.template.split(/\{\d+\}/g))assert.ok(run.trim().split(/\s+/).filter(Boolean).length<=7,story.title+' has no long fixed passage');
  for(const prompt of story.prompts){assert.ok(data.meta[prompt[0]]);assert.ok(prompt[1]);}
  assert.notEqual(story.prompts[14][2].ideas[0],'get home before dinner',story.title+' has a specific goal');
  fixed+=fixedWords;uses+=refs.length;
}
for(const script of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))new vm.Script(script[1]);
console.log(JSON.stringify({stories:68,answersPerStory:18,fixedWords:fixed,variableUses:uses,averageFixedWords:fixed/68}));
