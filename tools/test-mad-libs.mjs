import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const html=await readFile(new URL('../mad-libs/index.html',import.meta.url),'utf8');
const data=JSON.parse(html.match(/var DATA=(.*?);\nvar stories=/s)[1]);
const archive=await readFile(new URL('../mad-libs/legacy-stories-v2.js',import.meta.url),'utf8');
const legacyContext={window:{}};vm.runInNewContext(archive,legacyContext);
const oldStories=legacyContext.window.ArcadeMadLibsLegacyV2;
assert.equal(data.stories.length,68);
assert.equal(oldStories.length,data.stories.length);
const ordinaryTypes=new Set(['name','person','adjective','adverb','animal','bodyPart','clothing','color','exclamation','food','game','holiday','job','liquid','noun','number','place','pluralNoun','sillyWord','sound','treasure','vehicle','verbPresent','verbPast','verbIng','weather','magicalObject','monster','schoolSubject']);
let fixed=0,uses=0,totalWords=0;
for(const [storyIndex,story] of data.stories.entries()){
  const refs=[...story.template.matchAll(/\{(\d+)\}/g)].map(m=>Number(m[1]));
  assert.equal(story.prompts.length,12,story.title);
  assert.deepEqual([...new Set(refs)].sort((a,b)=>a-b),Array.from({length:12},(_,i)=>i),story.title+' uses every answer');
  assert.equal(story.title,oldStories[storyIndex].title,'existing theme preserved');
  assert.equal(story.category,oldStories[storyIndex].category,story.title+' category preserved');
  assert.deepEqual(story.prompts.map(prompt=>prompt[1]),Array.from(oldStories[storyIndex].prompts.slice(0,12),prompt=>prompt[1]),story.title+' original standard labels preserved');
  assert.equal(story.icon,oldStories[storyIndex].icon,story.title+' icon preserved');
  assert.deepEqual(story.prompts.slice(0,12).map(prompt=>prompt[0]),Array.from(oldStories[storyIndex].prompts.slice(0,12),prompt=>prompt[0]),story.title+' original first 12 answer types preserved');
  const words=story.template.replace(/\{\d+\}/g,'word').split(/\s+/).filter(Boolean).length;
  assert.ok(words>=110&&words<=150,story.title+' is a full story: '+words+' words');
  assert.ok(refs.length>=18&&refs.length<=24,story.title+' reuses its 12 answers through the story: '+refs.length+' variable occurrences');
  const fixedWords=story.template.replace(/\{\d+\}/g,' ').split(/\s+/).filter(Boolean).length;
  const sentences=[];
  for(const part of story.template.match(/[^.!?]+[.!?]+|[^.!?]+$/g)||[]){
    const previous=sentences[sentences.length-1]||'';
    // Punctuation inside dialogue does not separate its speech attribution.
    const attribution=/^["”]\s+(?:said|shouted|yelled|asked|replied|added|whispered|called|announced|muttered|came|(?:he|she|they|it|we|I|[A-Z][A-Za-z'-]*|(?:the|a|an|its|our|my|your)\s+[A-Za-z'-]+)\s+(?:said|shouted|yelled|asked|replied|added|whispered|called|announced|muttered))\b/.test(part.trim());
    const openQuote=(previous.match(/"/g)||[]).length%2===1||((previous.match(/“/g)||[]).length>(previous.match(/”/g)||[]).length);
    if(attribution&&openQuote)sentences[sentences.length-1]+=part;
    else sentences.push(part);
  }
  for(const sentence of sentences){
    if(!/[A-Za-z0-9]/.test(sentence))continue;
    assert.match(sentence,/\{\d+\}/,story.title+' has no sentence without blanks: '+sentence.trim());
  }
  for(const run of story.template.split(/\{\d+\}/g)){
    const runWords=run.trim().split(/\s+/).filter(Boolean).length;
    assert.ok(runWords<=15,story.title+' fixed passage has '+runWords+' words: '+run.trim());
  }
  for(const prompt of story.prompts){
    assert.ok(data.meta[prompt[0]],story.title+' has metadata for '+prompt[0]);
    assert.ok(ordinaryTypes.has(prompt[0]),story.title+' uses an ordinary word category: '+prompt[0]);
    assert.ok(prompt[1],story.title+' labels its word category');
    assert.doesNotMatch(prompt[1],/main character|sidekick|helper|mission|reward|goal|want to do|fixes it|last thing|solution/i,story.title+' uses word prompts, not plot questions');
  }
  fixed+=fixedWords;uses+=refs.length;totalWords+=words;
}
for(const script of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))new vm.Script(script[1]);
console.log(JSON.stringify({stories:68,answersPerStory:12,totalWords,averageStoryWords:totalWords/68,fixedWords:fixed,variableUses:uses,averageFixedWords:fixed/68}));
