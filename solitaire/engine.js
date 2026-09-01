(function(root, factory){
  const api = factory();
  if(typeof module === "object" && module.exports) module.exports = api;
  if(root) root.SolitaireEngine = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function(){
  "use strict";

  const SUITS = ["S", "H", "D", "C"];
  const RED = new Set(["H", "D"]);

  function hashSeed(value){
    let h = 2166136261 >>> 0;
    const s = String(value == null ? "" : value);
    for(let i = 0; i < s.length; i++){
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0 || 1;
  }

  function rng(seed){
    let n = hashSeed(seed);
    return function(){
      n += 0x6D2B79F5;
      let t = n;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffle(cards, seed){
    const a = cards.slice();
    const random = rng(seed);
    for(let i = a.length - 1; i > 0; i--){
      const j = Math.floor(random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function rankName(rank){
    return rank === 1 ? "A" : rank === 11 ? "J" : rank === 12 ? "Q" : rank === 13 ? "K" : String(rank);
  }

  function makeDeck(copies, suitPool){
    const suits = suitPool || SUITS;
    const cards = [];
    let serial = 0;
    for(let copy = 0; copy < (copies || 1); copy++){
      for(const suit of suits){
        for(let rank = 1; rank <= 13; rank++){
          cards.push({id: `${suit}${rank}-${copy}-${serial++}`, suit, rank, faceUp:false});
        }
      }
    }
    return cards;
  }

  function clone(value){ return JSON.parse(JSON.stringify(value)); }
  function color(card){ return RED.has(card.suit) ? "red" : "black"; }
  function sameColor(a, b){ return color(a) === color(b); }
  function top(pile){ return pile && pile[pile.length - 1]; }

  function makeBase(variant, seed, options){
    return {
      schema:2,
      variant,
      seed:String(seed),
      options:clone(options || {}),
      moves:0,
      score:0,
      startedAt:Date.now(),
      elapsed:0,
      won:false,
      history:[],
      message:""
    };
  }

  function snapshot(state){
    return clone({...state, history:[]});
  }

  function checkpoint(state){
    state.history.push(snapshot(state));
    if(state.history.length > 120) state.history.shift();
  }

  function undo(state){
    if(!state.history.length) return false;
    const previous = state.history.pop();
    const history = state.history;
    Object.keys(state).forEach(k => delete state[k]);
    Object.assign(state, previous);
    state.history = history;
    return true;
  }

  function dealKlondike(seed, drawCount){
    const state = makeBase("klondike", seed, {drawCount:drawCount === 3 ? 3 : 1});
    const deck = shuffle(makeDeck(1), `${seed}:klondike`);
    state.tableau = Array.from({length:7}, () => []);
    for(let col = 0; col < 7; col++){
      for(let row = 0; row <= col; row++){
        const card = deck.pop();
        card.faceUp = row === col;
        state.tableau[col].push(card);
      }
    }
    state.stock = deck;
    state.waste = [];
    state.foundations = {S:[], H:[], D:[], C:[]};
    state.passes = 0;
    return state;
  }

  function klondikeSequence(cards){
    if(!cards.length || cards.some(c => !c.faceUp)) return false;
    for(let i = 1; i < cards.length; i++){
      if(cards[i - 1].rank !== cards[i].rank + 1 || sameColor(cards[i - 1], cards[i])) return false;
    }
    return true;
  }

  function canPlaceKlondike(card, dest){
    const t = top(dest);
    return t ? t.faceUp && t.rank === card.rank + 1 && !sameColor(t, card) : card.rank === 13;
  }

  function drawKlondike(state){
    if(state.variant !== "klondike") return false;
    if(!state.stock.length){
      if(!state.waste.length) return false;
      checkpoint(state);
      state.stock = state.waste.reverse().map(c => ({...c, faceUp:false}));
      state.waste = [];
      state.passes++;
      state.moves++;
      state.message = "Waste returned to the stock.";
      return true;
    }
    checkpoint(state);
    const count = Math.min(state.options.drawCount, state.stock.length);
    for(let i = 0; i < count; i++){
      const c = state.stock.pop();
      c.faceUp = true;
      state.waste.push(c);
    }
    state.moves++;
    state.message = count === 1 ? "Drew a card." : `Drew ${count} cards.`;
    return true;
  }

  function flipExposed(pile){
    const c = top(pile);
    if(c && !c.faceUp){ c.faceUp = true; return 5; }
    return 0;
  }

  function moveKlondike(state, from, to){
    if(state.variant !== "klondike") return false;
    let moving;
    let sourcePile;
    if(from.kind === "waste"){
      sourcePile = state.waste;
      moving = top(sourcePile) ? [top(sourcePile)] : [];
    }else if(from.kind === "tableau"){
      sourcePile = state.tableau[from.pile];
      if(!sourcePile || from.index < 0 || from.index >= sourcePile.length) return false;
      moving = sourcePile.slice(from.index);
      if(!klondikeSequence(moving)) return false;
    }else if(from.kind === "foundation"){
      sourcePile = state.foundations[from.suit];
      moving = top(sourcePile) ? [top(sourcePile)] : [];
    }else return false;
    if(!moving.length) return false;

    if(to.kind === "tableau"){
      const dest = state.tableau[to.pile];
      if(!dest || !canPlaceKlondike(moving[0], dest)) return false;
      checkpoint(state);
      sourcePile.splice(sourcePile.length - moving.length, moving.length);
      dest.push(...moving);
      if(from.kind === "waste") state.score += 5;
      else if(from.kind === "foundation") state.score = Math.max(0, state.score - 10);
      state.score += flipExposed(sourcePile);
    }else if(to.kind === "foundation"){
      if(moving.length !== 1) return false;
      const card = moving[0];
      const dest = state.foundations[to.suit];
      if(card.suit !== to.suit || card.rank !== dest.length + 1) return false;
      checkpoint(state);
      sourcePile.pop();
      dest.push(card);
      state.score += 10 + flipExposed(sourcePile);
    }else return false;
    state.moves++;
    state.message = "Nice move.";
    state.won = SUITS.every(s => state.foundations[s].length === 13);
    return true;
  }

  function klondikeHints(state){
    const hints = [];
    const sources = [];
    if(state.waste.length) sources.push({loc:{kind:"waste"}, cards:[top(state.waste)]});
    state.tableau.forEach((pile, p) => pile.forEach((card, i) => {
      if(card.faceUp && klondikeSequence(pile.slice(i))) sources.push({loc:{kind:"tableau", pile:p, index:i}, cards:pile.slice(i)});
    }));
    for(const src of sources){
      if(src.cards.length === 1){
        const card = src.cards[0];
        if(card.rank === state.foundations[card.suit].length + 1) hints.push({from:src.loc, to:{kind:"foundation", suit:card.suit}, text:`Move ${rankName(card.rank)}${card.suit} to its foundation.`});
      }
      state.tableau.forEach((pile, p) => {
        if(src.loc.kind === "tableau" && src.loc.pile === p) return;
        if(canPlaceKlondike(src.cards[0], pile)) hints.push({from:src.loc, to:{kind:"tableau", pile:p}, text:`Move ${rankName(src.cards[0].rank)}${src.cards[0].suit} onto tableau ${p + 1}.`});
      });
    }
    if(state.stock.length || state.waste.length) hints.push({from:{kind:"stock"}, to:{kind:"stock"}, text:"Draw from the stock."});
    return hints;
  }

  function dealFreeCell(seed){
    const state = makeBase("freecell", seed, {});
    const deck = shuffle(makeDeck(1), `${seed}:freecell`).map(c => ({...c, faceUp:true}));
    state.tableau = Array.from({length:8}, () => []);
    deck.forEach((card, i) => state.tableau[i % 8].push(card));
    state.cells = [null, null, null, null];
    state.foundations = {S:[], H:[], D:[], C:[]};
    return state;
  }

  function freeCellSequence(cards){
    if(!cards.length) return false;
    for(let i = 1; i < cards.length; i++){
      if(cards[i - 1].rank !== cards[i].rank + 1 || sameColor(cards[i - 1], cards[i])) return false;
    }
    return true;
  }

  function maxFreeCellRun(state, destinationPile){
    const free = state.cells.filter(c => !c).length;
    let empty = state.tableau.filter(p => !p.length).length;
    if(destinationPile != null && !state.tableau[destinationPile].length) empty--;
    return (free + 1) * Math.pow(2, Math.max(0, empty));
  }

  function moveFreeCell(state, from, to){
    if(state.variant !== "freecell") return false;
    let moving = [];
    let remove;
    if(from.kind === "cell"){
      const c = state.cells[from.pile];
      if(!c) return false;
      moving = [c]; remove = () => { state.cells[from.pile] = null; };
    }else if(from.kind === "tableau"){
      const pile = state.tableau[from.pile];
      if(!pile || from.index < 0 || from.index >= pile.length) return false;
      moving = pile.slice(from.index);
      if(!freeCellSequence(moving)) return false;
      remove = () => pile.splice(from.index);
    }else if(from.kind === "foundation"){
      const pile = state.foundations[from.suit];
      if(!pile.length) return false;
      moving = [top(pile)]; remove = () => pile.pop();
    }else return false;

    if(to.kind === "cell"){
      if(moving.length !== 1 || state.cells[to.pile]) return false;
      checkpoint(state); remove(); state.cells[to.pile] = moving[0];
    }else if(to.kind === "foundation"){
      const c = moving[0], dest = state.foundations[to.suit];
      if(moving.length !== 1 || c.suit !== to.suit || c.rank !== dest.length + 1) return false;
      checkpoint(state); remove(); dest.push(c); state.score += 10;
    }else if(to.kind === "tableau"){
      const dest = state.tableau[to.pile];
      if(!dest || moving.length > maxFreeCellRun(state, to.pile)) return false;
      const t = top(dest);
      if(t && (t.rank !== moving[0].rank + 1 || sameColor(t, moving[0]))) return false;
      checkpoint(state); remove(); dest.push(...moving);
    }else return false;
    if(from.kind === "foundation" && to.kind !== "foundation") state.score = Math.max(0, state.score - 10);
    state.moves++; state.message = "Move complete.";
    state.won = SUITS.every(s => state.foundations[s].length === 13);
    return true;
  }

  function freeCellHints(state){
    const result = [];
    const singles = [];
    state.cells.forEach((c, i) => { if(c) singles.push({loc:{kind:"cell", pile:i}, card:c}); });
    state.tableau.forEach((p, i) => { if(p.length) singles.push({loc:{kind:"tableau", pile:i, index:p.length - 1}, card:top(p)}); });
    for(const src of singles){
      if(src.card.rank === state.foundations[src.card.suit].length + 1) result.push({from:src.loc, to:{kind:"foundation", suit:src.card.suit}, text:`Send ${rankName(src.card.rank)}${src.card.suit} home.`});
    }
    for(const src of singles){
      state.tableau.forEach((dest, i) => {
        const t = top(dest);
        if((t && t.rank === src.card.rank + 1 && !sameColor(t, src.card)) || (!t && src.loc.kind !== "tableau")) result.push({from:src.loc, to:{kind:"tableau", pile:i}, text:`Move ${rankName(src.card.rank)}${src.card.suit} to column ${i + 1}.`});
      });
    }
    const open = state.cells.findIndex(c => !c);
    if(open >= 0){
      const source = state.tableau.findIndex(p => p.length);
      if(source >= 0) result.push({from:{kind:"tableau", pile:source, index:state.tableau[source].length - 1}, to:{kind:"cell", pile:open}, text:"Use a free cell to uncover a card."});
    }
    return result;
  }

  function spiderSuits(count){
    if(count === 1) return ["S", "S", "S", "S", "S", "S", "S", "S"];
    if(count === 2) return ["S", "S", "S", "S", "H", "H", "H", "H"];
    return ["S", "S", "H", "H", "D", "D", "C", "C"];
  }

  function dealSpider(seed, suitCount){
    const suits = [1,2,4].includes(suitCount) ? suitCount : 1;
    const state = makeBase("spider", seed, {suits});
    const pool = spiderSuits(suits);
    let serial = 0, deck = [];
    pool.forEach((suit, copy) => { for(let rank=1; rank<=13; rank++) deck.push({id:`${suit}${rank}-${copy}-${serial++}`, suit, rank, faceUp:false}); });
    deck = shuffle(deck, `${seed}:spider:${suits}`);
    state.tableau = Array.from({length:10}, () => []);
    for(let col=0; col<10; col++){
      const count = col < 4 ? 6 : 5;
      for(let i=0; i<count; i++) state.tableau[col].push(deck.pop());
      top(state.tableau[col]).faceUp = true;
    }
    state.stock = deck;
    state.completed = [];
    return state;
  }

  function spiderPacked(cards){
    if(!cards.length || cards.some(c => !c.faceUp)) return false;
    for(let i=1; i<cards.length; i++) if(cards[i-1].rank !== cards[i].rank + 1 || cards[i-1].suit !== cards[i].suit) return false;
    return true;
  }

  function completeSpider(state){
    let removed = 0;
    for(let p=0; p<10; p++){
      const pile = state.tableau[p];
      while(pile.length >= 13){
        const run = pile.slice(-13);
        if(run[0].rank !== 13 || run[12].rank !== 1 || !spiderPacked(run)) break;
        pile.splice(-13);
        state.completed.push(run[0].suit);
        state.score += 100;
        flipExposed(pile);
        removed++;
      }
    }
    return removed;
  }

  function moveSpider(state, from, to){
    if(state.variant !== "spider" || from.kind !== "tableau" || to.kind !== "tableau" || from.pile === to.pile) return false;
    const source = state.tableau[from.pile], dest = state.tableau[to.pile];
    if(!source || !dest || from.index < 0 || from.index >= source.length) return false;
    const moving = source.slice(from.index);
    if(!spiderPacked(moving)) return false;
    const t = top(dest);
    if(t && (!t.faceUp || t.rank !== moving[0].rank + 1)) return false;
    checkpoint(state);
    source.splice(from.index); dest.push(...moving);
    state.score = Math.max(0, state.score - 1);
    flipExposed(source); completeSpider(state);
    state.moves++; state.won = state.completed.length === 8; state.message = "Web woven.";
    return true;
  }

  function dealSpiderRow(state){
    if(state.variant !== "spider" || state.stock.length < 10 || state.tableau.some(p => !p.length)) return false;
    checkpoint(state);
    for(let p=0; p<10; p++){
      const c = state.stock.pop(); c.faceUp = true; state.tableau[p].push(c);
    }
    completeSpider(state); state.moves++; state.message = "A new row was dealt.";
    return true;
  }

  function spiderHints(state){
    const result = [];
    state.tableau.forEach((pile, p) => {
      pile.forEach((card, i) => {
        const moving = pile.slice(i);
        if(!spiderPacked(moving)) return;
        state.tableau.forEach((dest, d) => {
          if(d === p) return;
          const t = top(dest);
          if((t && t.rank === card.rank + 1) || (!t && i > 0)) result.push({from:{kind:"tableau",pile:p,index:i},to:{kind:"tableau",pile:d},text:`Move the ${rankName(card.rank)} run to column ${d+1}.`});
        });
      });
    });
    if(state.stock.length >= 10 && state.tableau.every(p => p.length)) result.push({from:{kind:"stock"},to:{kind:"stock"},text:"Deal another row."});
    return result;
  }

  function dealPyramid(seed){
    const state = makeBase("pyramid", seed, {});
    const deck = shuffle(makeDeck(1), `${seed}:pyramid`).map(c => ({...c, faceUp:true}));
    state.pyramid = [];
    for(let i=0; i<28; i++) state.pyramid.push(deck.pop());
    state.removed = [];
    state.cleared = [];
    state.stock = deck;
    state.waste = [];
    return state;
  }

  function pyramidChildren(index){
    let row = 0, start = 0;
    while(index >= start + row + 1){ start += row + 1; row++; }
    if(row >= 6) return [];
    const offset = index - start;
    const next = start + row + 1;
    return [next + offset, next + offset + 1];
  }

  function pyramidExposed(state, index){
    if(index < 0 || index >= 28 || state.removed.includes(index)) return false;
    const children = pyramidChildren(index);
    return children.every(i => state.removed.includes(i));
  }

  function pyramidCard(state, loc){
    if(loc.kind === "pyramid") return pyramidExposed(state, loc.index) ? state.pyramid[loc.index] : null;
    if(loc.kind === "waste") return top(state.waste) || null;
    if(loc.kind === "stock") return top(state.stock) || null;
    return null;
  }

  function removePyramidPair(state, a, b){
    if(state.variant !== "pyramid") return false;
    const ca = pyramidCard(state,a), cb = b ? pyramidCard(state,b) : null;
    if(!ca || (b && !cb)) return false;
    if(b && a.kind === b.kind && ((a.kind === "pyramid" && a.index === b.index) || a.kind === "waste")) return false;
    if((!b && ca.rank !== 13) || (b && ca.rank + cb.rank !== 13)) return false;
    checkpoint(state);
    [a,b].filter(Boolean).forEach(loc => {
      if(loc.kind === "pyramid") state.removed.push(loc.index);
      else if(loc.kind === "waste") state.cleared.push(state.waste.pop());
    });
    state.score += b ? 10 : 5; state.moves++;
    state.won = state.removed.length === 28; state.message = b ? "Pair cleared." : "King cleared.";
    return true;
  }

  function drawPyramid(state){
    if(state.variant !== "pyramid") return false;
    if(!state.stock.length){
      if(!state.waste.length) return false;
      checkpoint(state); state.stock = state.waste.reverse(); state.waste = []; state.moves++; state.message = "Stock recycled."; return true;
    }
    checkpoint(state); state.waste.push(state.stock.pop()); state.moves++; state.message = "Drew a card."; return true;
  }

  function pyramidHints(state){
    const locs = [];
    for(let i=0;i<28;i++) if(pyramidExposed(state,i)) locs.push({kind:"pyramid",index:i});
    if(state.waste.length) locs.push({kind:"waste"});
    const result=[];
    locs.forEach((a,i) => {
      const ca=pyramidCard(state,a);
      if(ca.rank===13) result.push({from:a,to:a,text:`Clear the exposed ${rankName(ca.rank)}.`});
      for(let j=i+1;j<locs.length;j++){
        const b=locs[j], cb=pyramidCard(state,b);
        if(ca.rank+cb.rank===13) result.push({from:a,to:b,text:`Pair ${rankName(ca.rank)} with ${rankName(cb.rank)}.`});
      }
    });
    if(state.stock.length || state.waste.length) result.push({from:{kind:"stock"},to:{kind:"stock"},text:"Draw from the stock."});
    return result;
  }

  function createGame(variant, seed, options){
    const s = seed == null ? `${Date.now()}-${Math.floor(Math.random()*1e6)}` : seed;
    if(variant === "spider") return dealSpider(s, Number(options && options.suits) || 1);
    if(variant === "freecell") return dealFreeCell(s);
    if(variant === "pyramid") return dealPyramid(s);
    return dealKlondike(s, Number(options && options.drawCount) || 1);
  }

  function hints(state){
    if(state.variant === "spider") return spiderHints(state);
    if(state.variant === "freecell") return freeCellHints(state);
    if(state.variant === "pyramid") return pyramidHints(state);
    return klondikeHints(state);
  }

  function validateState(s){
    if(!s || s.schema !== 2 || !["klondike","spider","freecell","pyramid"].includes(s.variant)) return false;
    const ids=[];
    const take = c => { if(c) ids.push(c.id); };
    (s.tableau || []).forEach(p => p.forEach(take));
    (s.stock || []).forEach(take); (s.waste || []).forEach(take);
    Object.values(s.foundations || {}).forEach(p => p.forEach(take));
    (s.cells || []).forEach(take); (s.pyramid || []).forEach(take);
    (s.cleared || []).forEach(take);
    const expected = s.variant === "spider" ? 104 : 52;
    const cleared = s.variant === "spider" ? (s.completed || []).length * 13 : 0;
    return ids.length + cleared === expected && new Set(ids).size === ids.length;
  }

  return {
    SUITS, RED, rankName, color, shuffle, createGame, clone, checkpoint, undo,
    drawKlondike, moveKlondike, dealSpiderRow, moveSpider, moveFreeCell,
    drawPyramid, removePyramidPair, pyramidExposed, pyramidChildren,
    hints, validateState, klondikeSequence, spiderPacked, freeCellSequence,
    maxFreeCellRun
  };
});
