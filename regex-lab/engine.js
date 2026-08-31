(function(root,factory){
  const api=factory();
  if(typeof module==="object"&&module.exports)module.exports=api;
  if(root)root.RegexLabEngine=api;
})(typeof globalThis!=="undefined"?globalThis:this,function(){
  "use strict";

  function hash(value){let h=2166136261>>>0;for(const ch of String(value)){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)}return h>>>0||1}
  function rng(seed){let x=hash(seed);return()=>{x+=0x6D2B79F5;let t=x;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296}}
  function pick(r,a){return a[Math.floor(r()*a.length)]}
  function shuffle(r,a){a=a.slice();for(let i=a.length-1;i;i--){const j=Math.floor(r()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a}
  function sample(r,a,count){return shuffle(r,a).slice(0,count)}
  function int(r,min,max){return min+Math.floor(r()*(max-min+1))}
  function escapeRegex(s){return String(s).replace(/[.*+?^${}()|[\]\\]/g,"\\$&")}

  const SAFE_MAX_PATTERN=160,SAFE_MAX_INPUT=100;
  function isSafePattern(pattern){
    if(typeof pattern!=="string"||!pattern.length||pattern.length>SAFE_MAX_PATTERN)return false;
    if(/\\[1-9]/.test(pattern)&&pattern.length>120)return false;
    if(/\((?:[^()]|\\.)*[+*][^)]*\)[+*{]/.test(pattern))return false;
    if(/(?:\.\*){2,}|(?:\.\+){2,}/.test(pattern))return false;
    if(/\{\d{4,}[,}]/.test(pattern))return false;
    try{new RegExp(pattern);return true}catch(_){return false}
  }
  function safeTest(pattern,flags,input){
    if(!isSafePattern(pattern)||typeof input!=="string"||input.length>SAFE_MAX_INPUT)return false;
    try{return new RegExp(pattern,String(flags||"").replace(/[^imsu]/g,"")).test(input)}catch(_){return false}
  }

  const words={
    starts:["rocket","river","robot","raccoon","rainbow","puzzle","planet","pepper","tiger","tunnel","cactus","castle"],
    ing:["running","jumping","coding","laughing","singing","painting","runner","jumps","coded","laugh"],
    animals:["otter","tiger","panda","gecko","llama","zebra","koala","badger"],
    colors:["red","blue","green","gold","coral","violet"],
    names:["Maya","Logan","Scarlett","Nico","Ava","Theo","Iris","Owen"],
    domains:["arcade.dev","puzzle.net","example.com","kidmail.org"]
  };

  function baseTemplates(){return [
    {
      level:1,skill:"Anchors",title:"Starts with a letter",
      make(r){const letter=pick(r,["r","p","t","c"]),pool=words.starts;return pack(`^${letter}`,"i",pool.filter(x=>x.startsWith(letter)).slice(0,4),pool.filter(x=>!x.startsWith(letter)).slice(0,4),`^ means “start of the text,” so this finds words beginning with ${letter.toUpperCase()}.`,`Look at the very first character. The ^ anchor pins the match there.`)}
    },
    {
      level:1,skill:"End anchor",title:"Ends with a suffix",
      make(r){const suffix=pick(r,["ing","er","a"]);let yes,no;if(suffix==="ing"){yes=["running","coding","singing","painting"];no=["runner","coded","song","paint"]}else if(suffix==="er"){yes=["runner","faster","player","tiger"];no=["run","fast","play","tigers"]}else{yes=["zebra","llama","panda","koala"];no=["otter","tiger","gecko","badger"]}return pack(`${escapeRegex(suffix)}$`,"i",yes,no,`$ means “end of the text,” so the suffix must be the final part.`,`Ignore where the letters appear in the middle. Check the ending.`)}
    },
    {
      level:1,skill:"Character classes",title:"A simple ID",
      make(r){const n=int(r,2,4);return pack(`^[A-Z]\\d{${n}}$`,"",[`A${"1".repeat(n)}`,`Q${String(314159).slice(0,n)}`,`Z${String(987654).slice(0,n)}`,`M${String(246810).slice(0,n)}`],[`aa${"1".repeat(n)}`,`B${"2".repeat(n-1)}`,`${"7".repeat(n+1)}`,`C${"3".repeat(n)}x`],`[A-Z] asks for one capital letter. \\d{${n}} asks for exactly ${n} digits. The anchors require the whole ID to fit.`,`Count carefully: one capital, then exactly ${n} digits.`)}
    },
    {
      level:1,skill:"Wildcards",title:"One mystery character",
      make(r){const a=pick(r,["c","m","p"]),b=pick(r,["t","p","n"]);return pack(`^${a}.${b}$`,"i",[`${a}a${b}`,`${a}7${b}`,`${a}_${b}`,`${a}Z${b}`],[`${a}${b}`,`${a}ab${b}`,`x${a}q${b}`,`${a}qz`],`. matches exactly one character here. The anchors make the whole text exactly three characters long.`,`The dot is one wildcard, not any number of characters.`)}
    },
    {
      level:2,skill:"Alternation",title:"Pick one ending",
      make(r){const root=pick(r,["play","jump","paint"]);return pack(`^${root}(ed|er|ing)$`,"i",[`${root}ed`,`${root}er`,`${root}ing`,`${root.toUpperCase()}ED`],[root,`${root}s`,`${root}ered`,`re${root}ing`],`The parentheses group three alternatives. | means “or.”`,`After ${root}, the ending must be exactly ed, er, or ing.`)}
    },
    {
      level:2,skill:"Optional pieces",title:"Optional punctuation",
      make(r){const area=pick(r,["617","508","781"]);return pack(`^${area}-?\\d{3}-?\\d{4}$`,"",[`${area}-555-1212`,`${area}5551212`,`${area}-4041212`,`${area}404-1212`],[`${area}-55-1212`,`1-${area}-555-1212`,`${area}.555.1212`,`${area}-555-121`],`-? means the dash may appear zero or one time. The digit counts still have to be exact.`,`A ? makes only the item immediately before it optional.`)}
    },
    {
      level:2,skill:"Ranges",title:"Hex color code",
      make(){return pack(`^#[0-9A-F]{6}$`,"i",["#FF8800","#12abEF","#000000","#c0ffee"],["FF8800","#12345","#GG1122","#1234567"],`The # is literal. [0-9A-F] allows a hexadecimal character, and {6} requires six of them.`,`The i flag means lower-case a-f work too.`)}
    },
    {
      level:2,skill:"Word boundaries",title:"A whole word",
      make(r){const w=pick(r,["cat","sun","red"]);return pack(`\\b${w}\\b`,"i",[`a ${w} naps`,`${w}!`,`the ${w} is here`,`${w.toUpperCase()} power`],[`${w}fish`,`copy${w}`,`${w}apult`,`s${w}ter`],`\\b is a word boundary. It stops ${w} from matching as a piece of a longer word.`,`Spaces and punctuation create boundaries; another letter does not.`)}
    },
    {
      level:3,skill:"Backreferences",title:"Repeat the same pair",
      make(r){const pairs=shuffle(r,["AB","XY","GO","HA"]);return pack(`^([A-Z]{2})-\\1$`,"",pairs.slice(0,4).map(x=>`${x}-${x}`),[`${pairs[0]}-${pairs[1]}`,"A-AA","AB-ab","ABC-ABC"],`([A-Z]{2}) captures two capitals. \\1 requires the exact captured pair to appear again.`,`The two sides must be identical, not merely the same length.`)}
    },
    {
      level:3,skill:"Negative lookahead",title:"Allowed unless forbidden",
      make(r){const bad=pick(r,["bad","zzz","no"]);return pack(`^(?!.*${bad})[a-z]{4,9}$`,"i",["rocket","puzzle","tiger","coding"].filter(x=>!x.includes(bad)),[`${bad}ger`,`oh${bad}oh`,`12okay`,`way-too-long`],`(?!.*${bad}) checks that ${bad} never appears. The rest allows 4 to 9 letters.`,`The rule has two jobs: reject the forbidden fragment, then check the format.`)}
    },
    {
      level:3,skill:"Groups and repeats",title:"Ticket format",
      make(r){const sep=pick(r,["-",":"]),esc=escapeRegex(sep);return pack(`^(?:[A-Z]{2}${esc}){2}\\d{3}$`,"",[`AB${sep}CD${sep}123`,`ZZ${sep}XY${sep}007`,`GO${sep}HA${sep}404`,`UP${sep}UP${sep}999`],[`A${sep}BC${sep}123`,`AB${sep}CD${sep}12`,`AB-CD:123`,`AB${sep}12${sep}345`],`(?: ... ){2} repeats the whole two-letter-and-separator unit twice, then \\d{3} finishes the ticket.`,`Count groups, not just individual characters.`)}
    },
    {
      level:3,skill:"Email structure",title:"Friendly email format",
      make(r){const domain=pick(r,words.domains);return pack(`^[a-z][a-z0-9._-]{1,14}@${escapeRegex(domain)}$`,"i",[`maya7@${domain}`,`player.one@${domain}`,`go_go@${domain}`,`x-2@${domain}`],[`7maya@${domain}`,`a@${domain}`,`okay@wrong.com`,`space me@${domain}`],`The name starts with a letter, continues with allowed characters, then must use the exact domain.`,`Check the first character, the @, and the domain separately.`)}
    },
    {
      level:4,skill:"Positive lookaheads",title:"Power code",
      make(){return pack(`^(?=.*[A-Z])(?=.*\\d)[A-Za-z\\d]{6,10}$`,"",["Rocket7","A1b2c3","NINJA9","p4ndaZ"],["rocket","NO7!WAY","123456","ThisCodeIsTooLong9"],`Each (?=...) lookahead requires a feature without consuming it: at least one capital and one digit. The final class controls every character and the total length.`,`A valid code must pass all three checks: capital, digit, and 6–10 letters/digits.`)}
    },
    {
      level:4,skill:"Conditional shape",title:"Matching quote marks",
      make(){return pack(`^(["'])[A-Za-z ]{2,18}\\1$`,"",[`"hello"`,`'great job'`,`"Regex Lab"`,`'go team'`],[`"mismatch'`,`no quotes`,`''`,`"too-long-a-phrase-here"`],`(["']) captures the opening quote. \\1 demands that the closing quote be the same kind.`,`A single quote must close with a single quote; double with double.`)}
    },
    {
      level:4,skill:"Nested structure",title:"Coordinate pair",
      make(){return pack(`^\\((-?\\d{1,3}),\\s*(-?\\d{1,3})\\)$`,"",["(12,34)","(-7, 88)","(0,0)","(-123,-9)"],["12,34","(1234,5)","(a,7)","(4; 8)"],`Escaped parentheses are literal. Each captured coordinate allows an optional minus and 1–3 digits; \\s* permits optional spaces after the comma.`,`Check punctuation first, then each signed number.`)}
    }
  ]}

  function pack(pattern,flags,yes,no,explanation,hint){return {pattern,flags,yes:[...new Set(yes)],no:[...new Set(no)],explanation,hint}}
  function templatesFor(level){return baseTemplates().filter(t=>t.level<=level&&t.level>=Math.max(1,level-1))}
  function fingerprint(c){return [c.mode,c.pattern,c.prompt,c.broken||"",(c.candidates||c.samples||[]).map(x=>x.text).sort().join("|"),(c.choices||[]).slice().sort().join("|")].join("::")}

  function mutatePatterns(base){
    const out=new Set();
    const p=base.pattern;
    if(p.startsWith("^"))out.add(p.slice(1));else out.add("^"+p);
    if(p.endsWith("$"))out.add(p.slice(0,-1));else out.add(p+"$");
    out.add(p.replace(/\\d/g,"\\w"));
    out.add(p.replace(/\{(\d+)\}/,(_,n)=>`{${Math.max(1,Number(n)-1)}}`));
    out.add(p.replace(/\?/g,"+"));
    out.add(p.replace(/\+/g,"*"));
    out.add(p.replace(/\[A-Z\]/g,"[a-z]"));
    out.delete(p);return [...out].filter(isSafePattern);
  }

  function classifications(pattern,flags,samples){return samples.map(x=>safeTest(pattern,flags,x))}
  function makePatternChoices(r,base){
    const samples=shuffle(r,[...sample(r,base.yes,3),...sample(r,base.no,3)]);
    const truth=classifications(base.pattern,base.flags,samples);
    const distractors=[];
    function addDistractor(pattern){
      if(!isSafePattern(pattern)||pattern===base.pattern||distractors.includes(pattern))return;
      const result=classifications(pattern,base.flags,samples);
      if(result.some((value,i)=>value!==truth[i]))distractors.push(pattern);
    }
    mutatePatterns(base).forEach(addDistractor);
    shuffle(r,[...base.yes,...base.no]).forEach(text=>addDistractor(`^${escapeRegex(text)}$`));
    for(let i=0;distractors.length<3;i++)addDistractor(`^regex-lab-never-${i}$`);
    const choices=shuffle(r,[base.pattern,...distractors.slice(0,3)]);
    return {samples:samples.map((text,i)=>({text,matches:truth[i]})),choices,answer:choices.indexOf(base.pattern)};
  }

  function makeRepair(r,base){
    const variants=[];
    const p=base.pattern;
    if(p.startsWith("^")&&p.endsWith("$"))variants.push({broken:p.slice(1),patch:"^",position:"front",alts:["$",".*","?"]});
    if(/\\d/.test(p))variants.push({broken:p.replace("\\d","___"),patch:"\\d",position:"blank",alts:["\\s",".","[A-Z]"]});
    if(/\{\d+(?:,\d+)?\}/.test(p)){
      const token=p.match(/\{\d+(?:,\d+)?\}/)[0];variants.push({broken:p.replace(token,"___"),patch:token,position:"blank",alts:["+","?","{1}"]});
    }
    if(/\$/.test(p))variants.push({broken:p.slice(0,-1),patch:"$",position:"back",alts:["^","+","\\b"]});
    const fallback=p.startsWith("\\b")
      ? {broken:`___${p.slice(2)}`,patch:"\\b",position:"blank",alts:["^","$","."]}
      : {broken:`___${p.slice(1)}`,patch:p[0],position:"blank",alts:["$",".","\\b"]};
    const v=pick(r,variants.length?variants:[fallback]);
    const shown=v.position==="front"?`___${v.broken}`:v.position==="back"?`${v.broken}___`:v.broken;
    const choices=shuffle(r,[v.patch,...v.alts]);
    return {broken:shown,choices,answer:choices.indexOf(v.patch),patch:v.patch};
  }

  function makeChallenge(options){
    options=options||{};const mode=options.mode||"hunt",level=Math.max(1,Math.min(4,Number(options.level)||1)),seed=String(options.seed||Date.now()),recent=new Set(options.recent||[]);
    for(let attempt=0;attempt<120;attempt++){
      const r=rng(`${seed}:${attempt}`),template=pick(r,templatesFor(level)),base=template.make(r);
      let c={schema:1,mode,level,seed,title:template.title,skill:template.skill,pattern:base.pattern,flags:base.flags,explanation:base.explanation,hint:base.hint};
      if(mode==="forge"){
        const x=makePatternChoices(r,base);Object.assign(c,x,{prompt:"Which pattern labels every example correctly?"});
      }else if(mode==="repair"){
        const x=makeRepair(r,base);Object.assign(c,x,{candidates:shuffle(r,[...sample(r,base.yes,2),...sample(r,base.no,2)]).map(text=>({text,matches:safeTest(base.pattern,base.flags,text)})),prompt:"Choose the missing piece that repairs the pattern."});
      }else if(mode==="runner"){
        const match=r()>.45,text=pick(r,match?base.yes:base.no);Object.assign(c,{candidates:[{text,matches:match}],answer:match,prompt:"Does this text match?",limit:Math.max(5,13-level*2)});
      }else{
        const all=shuffle(r,[...sample(r,base.yes,3).map(text=>({text,matches:true})),...sample(r,base.no,3).map(text=>({text,matches:false}))]);
        Object.assign(c,{candidates:all,answer:all.map((x,i)=>x.matches?i:null).filter(x=>x!==null),prompt:"Tap every text that matches."});
      }
      c.fingerprint=fingerprint(c);
      if(!recent.has(c.fingerprint))return c;
    }
    return makeChallenge({...options,seed:`${seed}:fallback`,recent:[]});
  }

  function checkAnswer(challenge,response){
    if(!challenge)return false;
    if(challenge.mode==="hunt"){
      const a=[...(challenge.answer||[])].sort((x,y)=>x-y),b=[...(response||[])].map(Number).sort((x,y)=>x-y);
      return a.length===b.length&&a.every((x,i)=>x===b[i]);
    }
    if(challenge.mode==="runner")return Boolean(response)===Boolean(challenge.answer);
    return Number(response)===Number(challenge.answer);
  }

  return {hash,rng,isSafePattern,safeTest,makeChallenge,checkAnswer,templatesFor,mutatePatterns,fingerprint,SAFE_MAX_PATTERN,SAFE_MAX_INPUT};
});
