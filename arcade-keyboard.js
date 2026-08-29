(function(){
  'use strict';
  if(window.ArcadeKeyboard) return;

  const LETTER_ROWS=[['q','w','e','r','t','y','u','i','o','p'],['a','s','d','f','g','h','j','k','l'],['z','x','c','v','b','n','m']];
  const NUMBER_ROWS=[['1','2','3','4','5','6','7','8','9','0'],['-','/',';',':','(',')','$','&','@','"'],['.','?', '!', "'", '#','+','=','_',',']];
  const EMOJIS=['😀','😂','😍','🤪','🥳','😎','🤖','👻','💩','🦄','🐶','🐱','🦖','🐙','🍕','🍩','🌈','⭐','🔥','❤️','👍','🎉','⚾','🚀','👽','🤮','🩲','🚽','🧻','🪠'];
  let target=null;
  let shifted=true;
  let layout='letters';
  let layer=null;
  let keys=null;
  let title=null;
  let emojiPanel=null;

  function style(){
    if(document.getElementById('arcade-keyboard-style')) return;
    const s=document.createElement('style');
    s.id='arcade-keyboard-style';
    s.textContent=`
      .ak-safe-entry{caret-color:transparent!important;user-select:none!important;-webkit-user-select:none!important}
      .ak-layer{position:fixed;inset:0;z-index:2147483640;display:flex;flex-direction:column;justify-content:flex-end;padding:max(8px,env(safe-area-inset-top)) max(6px,env(safe-area-inset-right)) max(6px,env(safe-area-inset-bottom)) max(6px,env(safe-area-inset-left));background:rgba(2,5,16,.62);backdrop-filter:blur(5px);font-family:system-ui,-apple-system,"Segoe UI",sans-serif;color:#fff}
      .ak-layer[hidden]{display:none!important}
      .ak-board{width:min(760px,100%);margin:0 auto;border:1px solid rgba(255,255,255,.2);border-radius:20px;padding:8px;background:linear-gradient(180deg,#17203f,#0d132a);box-shadow:0 -14px 46px rgba(0,0,0,.46)}
      .ak-head{display:flex;align-items:center;gap:7px;padding:1px 2px 7px}
      .ak-title{flex:1;min-width:0;color:#cbd5ff;font-size:12px;font-weight:900;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .ak-done,.ak-switch{min-height:36px;border:1px solid rgba(255,255,255,.17);border-radius:11px;padding:6px 12px;background:rgba(255,255,255,.09);color:#fff;font:900 12px system-ui}
      .ak-done{background:linear-gradient(135deg,#21dcff,#4d73ff);border:0;color:#061126}
      .ak-keys{display:flex;flex-direction:column;gap:5px}
      .ak-row{display:flex;justify-content:center;gap:4px}
      .ak-key{flex:1 1 0;min-width:0;max-width:64px;height:clamp(38px,6.8vh,53px);border:1px solid rgba(255,255,255,.17);border-radius:10px;background:linear-gradient(180deg,#334064,#222b49);color:#fff;font:1000 clamp(15px,4.3vw,21px)/1 system-ui;box-shadow:0 3px 0 rgba(0,0,0,.34);touch-action:manipulation;user-select:none}
      .ak-key:active{transform:translateY(2px);box-shadow:0 1px 0 rgba(0,0,0,.34);background:#43527b}
      .ak-key.wide{max-width:none;flex:1.45}
      .ak-key.space{max-width:none;flex:4}
      .ak-key.accent{background:linear-gradient(180deg,#7758d8,#563ab7)}
      .ak-emoji-panel{display:grid;grid-template-columns:repeat(10,minmax(0,1fr));gap:4px;max-height:min(216px,35vh);overflow:auto;padding:4px 1px 7px}
      .ak-emoji-panel[hidden]{display:none!important}
      .ak-emoji{min-height:42px;border:1px solid rgba(255,255,255,.14);border-radius:10px;background:rgba(255,255,255,.07);font-size:23px}
      @media(max-width:430px){.ak-board{border-radius:16px;padding:6px}.ak-row{gap:3px}.ak-key{border-radius:8px}.ak-emoji-panel{grid-template-columns:repeat(7,minmax(0,1fr))}}
      @media(max-height:500px){.ak-board{padding:5px}.ak-head{padding-bottom:4px}.ak-key{height:34px;font-size:15px}.ak-emoji-panel{max-height:120px;grid-template-columns:repeat(10,minmax(0,1fr))}.ak-emoji{min-height:34px;font-size:19px}}
    `;
    document.head.appendChild(s);
  }

  function makeButton(label,value,cls){
    const b=document.createElement('button');
    b.type='button';b.className='ak-key'+(cls?' '+cls:'');b.textContent=label;b.dataset.value=value;
    return b;
  }

  function ensure(){
    if(layer) return;
    style();
    layer=document.createElement('div');
    layer.className='ak-layer';
    layer.hidden=true;
    layer.innerHTML='<div class="ak-board" role="dialog" aria-label="Arcade keyboard"><div class="ak-head"><div class="ak-title">Arcade keyboard</div><button type="button" class="ak-switch">ABC</button><button type="button" class="ak-done">Done</button></div><div class="ak-emoji-panel" hidden></div><div class="ak-keys"></div></div>';
    document.body.appendChild(layer);
    keys=layer.querySelector('.ak-keys');
    title=layer.querySelector('.ak-title');
    emojiPanel=layer.querySelector('.ak-emoji-panel');
    EMOJIS.forEach(e=>{const b=document.createElement('button');b.type='button';b.className='ak-emoji';b.textContent=e;b.dataset.emoji=e;emojiPanel.appendChild(b);});
    layer.querySelector('.ak-done').addEventListener('click',close);
    layer.querySelector('.ak-switch').addEventListener('click',()=>{layout=layout==='letters'?'numbers':'letters';shifted=layout==='letters';render();});
    layer.addEventListener('pointerdown',e=>{if(e.target===layer){e.preventDefault();close();}});
    keys.addEventListener('click',e=>{const b=e.target.closest('.ak-key');if(!b)return;press(b.dataset.value);});
    emojiPanel.addEventListener('click',e=>{const b=e.target.closest('.ak-emoji');if(b)insert(b.dataset.emoji||'');});
  }

  function render(){
    ensure();
    keys.replaceChildren();
    const rows=layout==='letters'?LETTER_ROWS:NUMBER_ROWS;
    rows.forEach(row=>{
      const r=document.createElement('div');r.className='ak-row';
      row.forEach(ch=>r.appendChild(makeButton(shifted&&layout==='letters'?ch.toUpperCase():ch,ch)));
      keys.appendChild(r);
    });
    const tools=document.createElement('div');tools.className='ak-row';
    if(layout==='letters') tools.appendChild(makeButton(shifted?'⇧':'⇧','shift','wide'+(shifted?' accent':'')));
    tools.appendChild(makeButton('😀','emoji','wide'));
    tools.appendChild(makeButton('space','space','space'));
    if(target&&target.tagName==='TEXTAREA') tools.appendChild(makeButton('↵','enter','wide'));
    tools.appendChild(makeButton('⌫','backspace','wide'));
    keys.appendChild(tools);
    layer.querySelector('.ak-switch').textContent=layout==='letters'?'123':'ABC';
  }

  function selection(){
    if(!target)return{start:0,end:0};
    const len=String(target.value||'').length;
    const start=Number.isFinite(target.selectionStart)?target.selectionStart:len;
    const end=Number.isFinite(target.selectionEnd)?target.selectionEnd:start;
    return{start,end};
  }
  function fire(){
    if(!target)return;
    target.dispatchEvent(new Event('input',{bubbles:true}));
  }
  function setValue(value,caret){
    if(!target)return;
    const max=Number(target.maxLength)>0?Number(target.maxLength):100000;
    target.value=String(value).slice(0,max);
    const c=Math.min(target.value.length,Math.max(0,caret));
    try{target.setSelectionRange(c,c);}catch(_){ }
    fire();
  }
  function insert(text){
    if(!target)return;
    const s=selection(),v=String(target.value||'');
    setValue(v.slice(0,s.start)+text+v.slice(s.end),s.start+text.length);
    emojiPanel.hidden=true;keys.hidden=false;
  }
  function backspace(){
    if(!target)return;
    const s=selection(),v=String(target.value||'');
    if(s.start!==s.end){setValue(v.slice(0,s.start)+v.slice(s.end),s.start);return;}
    if(s.start<=0)return;
    const before=Array.from(v.slice(0,s.start));before.pop();
    const prefix=before.join('');setValue(prefix+v.slice(s.end),prefix.length);
  }
  function press(value){
    if(value==='shift'){shifted=!shifted;render();return;}
    if(value==='emoji'){emojiPanel.hidden=!emojiPanel.hidden;keys.hidden=!emojiPanel.hidden;return;}
    if(value==='space'){insert(' ');return;}
    if(value==='enter'){insert('\n');return;}
    if(value==='backspace'){backspace();return;}
    insert(shifted&&layout==='letters'?value.toUpperCase():value);
    if(shifted&&layout==='letters')shifted=false;
    render();
  }
  function open(el,opts){
    ensure();
    if(!el)return;
    target=el;
    target.readOnly=true;
    target.inputMode='none';
    target.classList.add('ak-safe-entry');
    title.textContent=(opts&&opts.title)||target.getAttribute('aria-label')||target.placeholder||'Arcade keyboard';
    shifted=!(target.value&&target.value.length);
    layout='letters';
    emojiPanel.hidden=true;keys.hidden=false;render();
    layer.hidden=false;
    try{target.focus({preventScroll:true});const n=target.value.length;target.setSelectionRange(n,n);}catch(_){ }
  }
  function close(){
    if(!layer||layer.hidden)return;
    layer.hidden=true;
    if(target){target.dispatchEvent(new Event('change',{bubbles:true}));try{target.blur();}catch(_){ }}
    target=null;
  }
  function eligible(el){
    if(!el||el.dataset.arcadeKeyboard==='off'||el.disabled)return false;
    if(el.matches('textarea'))return true;
    return el.matches('input:not([type]),input[type="text"],input[type="search"],input[type="email"],input[type="url"]');
  }
  function install(root){
    const scope=root&&root.querySelectorAll?root:document;
    const list=[];
    if(scope.nodeType===1&&eligible(scope))list.push(scope);
    scope.querySelectorAll&&scope.querySelectorAll('textarea,input:not([type]),input[type="text"],input[type="search"],input[type="email"],input[type="url"]').forEach(el=>list.push(el));
    list.forEach(el=>{
      if(el.dataset.arcadeKeyboardBound==='1'||el.dataset.arcadeKeyboard==='off')return;
      el.dataset.arcadeKeyboardBound='1';el.readOnly=true;el.inputMode='none';el.setAttribute('autocomplete','off');el.classList.add('ak-safe-entry');
      el.addEventListener('click',e=>{e.preventDefault();open(el);});
      el.addEventListener('pointerdown',()=>{el.readOnly=true;el.inputMode='none';},{capture:true});
    });
  }
  function autoInstall(){
    install(document);
    if(window.MutationObserver){new MutationObserver(records=>records.forEach(r=>r.addedNodes.forEach(n=>{if(n.nodeType===1)install(n);}))).observe(document.documentElement,{childList:true,subtree:true});}
  }
  window.ArcadeKeyboard={open,close,install,autoInstall,insertText:insert};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',autoInstall,{once:true});else autoInstall();
})();
