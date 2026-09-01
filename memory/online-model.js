(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.MemoryOnlineModel=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  function integer(value,min,max){
    const number=Number(value);
    return Number.isInteger(number)&&number>=min&&number<=max?number:null;
  }

  function shortString(value,max){
    return typeof value==='string'&&value.length>0&&value.length<=max?value:null;
  }

  function cleanStats(value,players,scores){
    if(!Array.isArray(value)||value.length!==players)return null;
    const fields=['attempts','misses','flips','curStreak','longestStreak','totalDecision','decisionCount','bestRepeat'];
    const result=[];
    for(let index=0;index<players;index++){
      const source=value[index];
      if(!source||typeof source!=='object'||Array.isArray(source))return null;
      const item={matches:scores[index],mismatchPairCounts:{}};
      for(const field of fields){
        const maximum=field==='totalDecision'?86400000:100000;
        const raw=field==='totalDecision'?Math.floor(Number(source[field])||0):(source[field]||0);
        const safe=integer(raw,0,maximum);
        if(safe===null)return null;
        item[field]=safe;
      }
      if(item.attempts<item.matches||item.flips<item.attempts)return null;
      result.push(item);
    }
    return result;
  }

  function sanitizeMemorySnapshot(value,players){
    if(!value||typeof value!=='object'||Array.isArray(value))return null;
    players=integer(players,2,4);
    if(players===null||integer(value.players,2,4)!==players)return null;
    if(!Array.isArray(value.seatOrder)||value.seatOrder.length!==players)return null;
    const seatOrder=value.seatOrder.map(function(seat){return integer(seat,0,7);});
    if(seatOrder.some(function(seat){return seat===null;})||new Set(seatOrder).size!==players)return null;
    const cols=integer(value.cols,2,9),rows=integer(value.rows,2,9),matchSize=integer(value.matchSize,2,3);
    if(cols===null||rows===null||matchSize===null)return null;
    const playable=(cols*rows)-((cols*rows)%matchSize);
    const totalMatches=playable/matchSize;
    if(integer(value.totalMatches,1,32)!==totalMatches||!Array.isArray(value.deck)||value.deck.length!==playable)return null;

    const deck=[];
    const keyCounts=new Map();
    const ids=new Set();
    for(const source of value.deck){
      if(!source||typeof source!=='object'||source.free)return null;
      const id=shortString(source.id,40),key=shortString(source.key,16),emoji=shortString(source.emoji,16);
      if(!id||!key||!emoji||ids.has(id))return null;
      ids.add(id);keyCounts.set(key,(keyCounts.get(key)||0)+1);
      deck.push({id,key,emoji});
    }
    if(keyCounts.size!==totalMatches||Array.from(keyCounts.values()).some(function(count){return count!==matchSize;}))return null;

    if(!Array.isArray(value.matchedKeys)||value.matchedKeys.length>totalMatches)return null;
    const matchedKeys=[];
    const matchedSet=new Set();
    for(const rawKey of value.matchedKeys){
      if(typeof rawKey!=='string'||!keyCounts.has(rawKey)||matchedSet.has(rawKey))return null;
      matchedSet.add(rawKey);matchedKeys.push(rawKey);
    }

    if(!Array.isArray(value.owners)||value.owners.length!==deck.length)return null;
    const owners=[];
    for(const rawOwner of value.owners){
      const owner=integer(rawOwner,0,players);
      if(owner===null)return null;
      owners.push(owner);
    }

    const expectedScores=Array.from({length:players},function(){return 0;});
    for(const key of keyCounts.keys()){
      const indexes=[];
      deck.forEach(function(card,index){if(card.key===key)indexes.push(index);});
      const groupOwners=indexes.map(function(index){return owners[index];});
      if(matchedSet.has(key)){
        const owner=groupOwners[0];
        if(groupOwners.some(function(item){return item!==owner;}))return null;
        if(owner>0)expectedScores[owner-1]++;
      }else if(groupOwners.some(function(item){return item!==0;}))return null;
    }
    if(!Array.isArray(value.scores)||value.scores.length!==players)return null;
    const scores=value.scores.map(function(score){return integer(score,0,totalMatches);});
    if(scores.some(function(score){return score===null;})||scores.some(function(score,index){return score!==expectedScores[index];}))return null;
    const stats=cleanStats(value.stats,players,scores);
    if(!stats)return null;

    const moves=integer(value.moves||0,0,100000),elapsed=integer(Math.floor(Number(value.tElapsed)||0),0,604800000);
    if(moves===null||elapsed===null)return null;
    return {
      schema:1,players,seatOrder,
      names:Array.from({length:players},function(_,index){return 'Player '+(index+1);}),
      teams:Array.from({length:players},function(_,index){return index+1;}),
      uniqueTeams:Array.from({length:players},function(_,index){return index+1;}),
      teamMode:false,teamNames:['Team 1','Team 2','Team 3','Team 4'],
      cols,rows,matchSize,freeCount:0,totalMatches,deck,revealed:[],matchedKeys,owners,
      lock:false,awaitingTurn:false,moves,tElapsed:elapsed,scores,turn:1,stats,sound:true
    };
  }

  return {sanitizeMemorySnapshot};
});
