(function(){
  'use strict';

  if(window.ArcadeSave) return;

  var DB_NAME = 'arcade-autosaves';
  var DB_VERSION = 1;
  var STORE_NAME = 'saves';
  var REGISTRY_KEY = 'arcade.autosave.registry.v1';
  var FALLBACK_PREFIX = 'arcade.autosave.data.v1.';
  var adapter = null;
  var currentEntry = null;
  var saveTimer = 0;
  var intervalTimer = 0;
  var restoring = false;
  var decisionPending = false;
  var sessionEngaged = false;
  var dirty = false;
  var saving = false;
  var saveChain = Promise.resolve();
  var ui = null;

  function now(){ return Date.now(); }
  function clone(value){
    if(value === undefined) return value;
    return JSON.parse(JSON.stringify(value));
  }
  function safeCall(fn, fallback){
    try{
      var value = typeof fn === 'function' ? fn() : fn;
      return value === undefined ? fallback : value;
    }catch(_){ return fallback; }
  }
  function deriveId(){
    var parts = location.pathname.split('/').filter(Boolean);
    return (parts[parts.length - 2] || parts[parts.length - 1] || document.title || 'item')
      .replace(/index\.html?$/i, '').replace(/[^a-z0-9_-]+/gi, '-').toLowerCase();
  }
  function readRegistry(){
    try{
      var parsed = JSON.parse(localStorage.getItem(REGISTRY_KEY) || '{}');
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    }catch(_){ return {}; }
  }
  function writeRegistry(registry){
    try{ localStorage.setItem(REGISTRY_KEY, JSON.stringify(registry)); }catch(_){}
  }
  function setRegistryEntry(entry){
    var registry = readRegistry();
    if(entry){
      registry[entry.id] = {
        id: entry.id,
        title: entry.title,
        updatedAt: entry.updatedAt,
        version: entry.version,
        summary: entry.summary || ''
      };
    }else if(adapter){
      delete registry[adapter.id];
    }
    writeRegistry(registry);
  }

  function openDb(){
    return new Promise(function(resolve, reject){
      if(!window.indexedDB){ reject(new Error('IndexedDB unavailable')); return; }
      var request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = function(){
        var db = request.result;
        if(!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME, {keyPath:'id'});
      };
      request.onsuccess = function(){ resolve(request.result); };
      request.onerror = function(){ reject(request.error || new Error('Could not open save storage')); };
    });
  }
  function idbRequest(mode, action){
    return openDb().then(function(db){
      return new Promise(function(resolve, reject){
        var tx = db.transaction(STORE_NAME, mode);
        var store = tx.objectStore(STORE_NAME);
        var request;
        try{ request = action(store); }
        catch(error){ db.close(); reject(error); return; }
        tx.oncomplete = function(){ db.close(); resolve(request && request.result); };
        tx.onerror = function(){ var error = tx.error || new Error('Save storage failed'); db.close(); reject(error); };
        tx.onabort = tx.onerror;
      });
    });
  }
  function fallbackRead(id){
    try{ return JSON.parse(localStorage.getItem(FALLBACK_PREFIX + id) || 'null'); }
    catch(_){ return null; }
  }
  function fallbackWrite(entry){
    try{ localStorage.setItem(FALLBACK_PREFIX + entry.id, JSON.stringify(entry)); }catch(_){}
    return entry;
  }
  function fallbackDelete(id){
    try{ localStorage.removeItem(FALLBACK_PREFIX + id); }catch(_){}
  }
  function readEntry(id){
    var fallback = fallbackRead(id);
    return idbRequest('readonly', function(store){ return store.get(id); })
      .then(function(stored){
        if(fallback && (!stored || Number(fallback.updatedAt || 0) > Number(stored.updatedAt || 0))) return fallback;
        return stored || fallback;
      })
      .catch(function(){ return fallback; });
  }
  function writeEntry(entry){
    // A synchronous shadow copy protects navigation-triggered saves when the
    // browser closes the page before IndexedDB finishes its transaction.
    fallbackWrite(entry);
    return idbRequest('readwrite', function(store){ return store.put(entry); })
      .then(function(){ fallbackDelete(entry.id); return entry; })
      .catch(function(){ return entry; });
  }
  function deleteEntry(id){
    return idbRequest('readwrite', function(store){ return store.delete(id); })
      .catch(function(){})
      .then(function(){ fallbackDelete(id); });
  }

  function ageLabel(timestamp){
    var seconds = Math.max(0, Math.round((now() - Number(timestamp || 0)) / 1000));
    if(seconds < 10) return 'just now';
    if(seconds < 60) return seconds + ' seconds ago';
    var minutes = Math.round(seconds / 60);
    if(minutes < 60) return minutes + (minutes === 1 ? ' minute ago' : ' minutes ago');
    var hours = Math.round(minutes / 60);
    if(hours < 24) return hours + (hours === 1 ? ' hour ago' : ' hours ago');
    var days = Math.round(hours / 24);
    return days + (days === 1 ? ' day ago' : ' days ago');
  }
  function ensureUi(){
    if(ui) return ui;
    var style = document.createElement('style');
    style.id = 'arcade-save-style';
    style.textContent = [
      '.arcade-save-layer{position:fixed;inset:0;z-index:2147483646;display:grid;place-items:center;padding:max(16px,env(safe-area-inset-top)) max(16px,env(safe-area-inset-right)) max(16px,env(safe-area-inset-bottom)) max(16px,env(safe-area-inset-left));background:rgba(3,7,20,.78);backdrop-filter:blur(8px);font-family:system-ui,-apple-system,"Segoe UI",sans-serif;color:#fff}',
      '.arcade-save-layer[hidden]{display:none!important}',
      '.arcade-save-card{width:min(430px,94vw);max-height:min(560px,92vh);overflow:auto;border:1px solid rgba(255,255,255,.2);border-radius:24px;padding:22px;background:linear-gradient(145deg,#17203f,#0e142d);box-shadow:0 24px 70px rgba(0,0,0,.55);text-align:center}',
      '.arcade-save-icon{width:68px;height:68px;margin:0 auto 12px;display:grid;place-items:center;border-radius:22px;background:linear-gradient(135deg,#21dcff,#6d72ff);color:#071126;font-size:34px;font-weight:1000;box-shadow:0 12px 28px rgba(33,220,255,.25)}',
      '.arcade-save-card h2{margin:0 0 7px;font-size:clamp(24px,7vw,34px);line-height:1.05;font-weight:1000;letter-spacing:-.6px}',
      '.arcade-save-card p{margin:0;color:#c5cee9;font-size:15px;line-height:1.35;font-weight:700}',
      '.arcade-save-summary{margin-top:8px!important;color:#fff!important}',
      '.arcade-save-actions{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:20px}',
      '.arcade-save-actions button{min-height:52px;border:1px solid rgba(255,255,255,.18);border-radius:16px;padding:10px 12px;background:rgba(255,255,255,.08);color:#fff;font:900 15px/1.1 system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-tap-highlight-color:transparent}',
      '.arcade-save-actions button:active{transform:scale(.97)}',
      '.arcade-save-actions .arcade-save-primary{border-color:transparent;background:linear-gradient(135deg,#21dcff,#4d7cff);color:#071126}',
      '.arcade-save-toast{position:fixed;left:50%;bottom:max(18px,env(safe-area-inset-bottom));z-index:2147483647;translate:-50% 0;max-width:min(420px,90vw);padding:10px 14px;border-radius:999px;background:rgba(9,13,30,.94);border:1px solid rgba(255,255,255,.18);color:#fff;font:850 13px/1.2 system-ui,-apple-system,"Segoe UI",sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.4);opacity:0;pointer-events:none;transition:opacity .18s ease,transform .18s ease;transform:translateY(8px);text-align:center}',
      '.arcade-save-toast.show{opacity:1;transform:translateY(0)}',
      '@media(max-width:380px),(max-height:480px){.arcade-save-card{padding:17px;border-radius:19px}.arcade-save-icon{width:54px;height:54px;border-radius:17px;font-size:27px}.arcade-save-actions{margin-top:14px}.arcade-save-actions button{min-height:46px;font-size:13px}}'
    ].join('');
    document.head.appendChild(style);

    var layer = document.createElement('div');
    layer.className = 'arcade-save-layer';
    layer.hidden = true;
    layer.innerHTML = '<section class="arcade-save-card" role="dialog" aria-modal="true" aria-labelledby="arcade-save-heading">' +
      '<div class="arcade-save-icon" aria-hidden="true">↺</div>' +
      '<h2 id="arcade-save-heading">Continue?</h2>' +
      '<p class="arcade-save-meta"></p>' +
      '<p class="arcade-save-summary"></p>' +
      '<div class="arcade-save-actions"><button class="arcade-save-fresh" type="button">Start Fresh</button><button class="arcade-save-primary" type="button">Load Saved</button></div>' +
      '</section>';
    document.body.appendChild(layer);
    var toast = document.createElement('div');
    toast.className = 'arcade-save-toast';
    toast.setAttribute('role','status');
    toast.setAttribute('aria-live','polite');
    document.body.appendChild(toast);
    ui = {
      layer: layer,
      heading: layer.querySelector('h2'),
      meta: layer.querySelector('.arcade-save-meta'),
      summary: layer.querySelector('.arcade-save-summary'),
      fresh: layer.querySelector('.arcade-save-fresh'),
      load: layer.querySelector('.arcade-save-primary'),
      toast: toast,
      toastTimer: 0
    };
    return ui;
  }
  function toast(message){
    var controls = ensureUi();
    clearTimeout(controls.toastTimer);
    controls.toast.textContent = message;
    controls.toast.classList.add('show');
    controls.toastTimer = setTimeout(function(){ controls.toast.classList.remove('show'); }, 1800);
  }
  function showPrompt(entry){
    var controls = ensureUi();
    decisionPending = true;
    controls.heading.textContent = 'Continue ' + adapter.title + '?';
    controls.meta.textContent = 'Autosaved ' + ageLabel(entry.updatedAt) + '.';
    var summary = entry.summary || '';
    controls.summary.textContent = summary;
    controls.summary.hidden = !summary;
    controls.layer.hidden = false;
    controls.load.onclick = function(){ restoreEntry(entry, true); };
    controls.fresh.onclick = function(){
      decisionPending = false;
      sessionEngaged = true;
      controls.layer.hidden = true;
      clearSaved(false).then(function(){
        if(typeof adapter.startFresh === 'function'){
          try{ adapter.startFresh(); }catch(_){}
        }
        toast('Fresh start ready.');
      });
    };
    setTimeout(function(){ try{ controls.load.focus({preventScroll:true}); }catch(_){} }, 40);
  }

  function isMeaningful(){
    return adapter && safeCall(adapter.meaningful, true) !== false;
  }
  function captureEntry(){
    if(!adapter || restoring || decisionPending || !sessionEngaged) return Promise.resolve(null);
    if(!isMeaningful()){
      if(currentEntry) return clearSaved(false).then(function(){ return null; });
      return Promise.resolve(null);
    }
    var data;
    try{ data = adapter.capture(); }
    catch(error){ return Promise.reject(error); }
    function persist(resolved){
      if(resolved === undefined) return null;
      var summary = safeCall(adapter.summary, '');
      var entry = {
        schema: 1,
        id: adapter.id,
        title: adapter.title,
        version: adapter.version,
        updatedAt: now(),
        summary: typeof summary === 'string' ? summary.slice(0, 160) : '',
        data: clone(resolved)
      };
      return writeEntry(entry).then(function(){
        currentEntry = entry;
        dirty = false;
        setRegistryEntry(entry);
        return entry;
      });
    }
    if(data && typeof data.then === 'function') return Promise.resolve(data).then(persist);
    return persist(data);
  }
  function saveNow(){
    clearTimeout(saveTimer);
    saveTimer = 0;
    function runCapture(){
      saving = true;
      var result;
      try{ result = captureEntry(); }
      catch(_){ result = null; }
      return Promise.resolve(result).then(function(value){ saving = false; return value; }, function(){ saving = false; return null; });
    }
    if(!saving) saveChain = runCapture();
    else saveChain = saveChain.then(runCapture, runCapture);
    return saveChain;
  }
  function scheduleSave(delay){
    if(!adapter || restoring || decisionPending || !sessionEngaged) return;
    dirty = true;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, typeof delay === 'number' ? delay : 550);
  }
  function clearSaved(showToast){
    if(!adapter) return Promise.resolve();
    currentEntry = null;
    dirty = false;
    setRegistryEntry(null);
    return deleteEntry(adapter.id).then(function(){ if(showToast) toast('Saved progress cleared.'); });
  }
  function compatible(entry){
    return entry && entry.schema === 1 && entry.id === adapter.id && entry.data !== undefined;
  }
  function stripResumeQuery(){
    try{
      var url = new URL(location.href);
      url.searchParams.delete('resume');
      url.searchParams.delete('load');
      history.replaceState(null, document.title, url.pathname + (url.search ? url.search : '') + (url.hash || ''));
    }catch(_){}
  }
  function wantsAutomaticResume(){
    try{
      var params = new URLSearchParams(location.search);
      return params.get('resume') === '1' || params.get('load') === '1';
    }catch(_){ return false; }
  }
  function restoreEntry(entry, showToast){
    if(!compatible(entry)) return Promise.resolve(false);
    decisionPending = false;
    restoring = true;
    if(ui) ui.layer.hidden = true;
    var data = entry.data;
    if(entry.version !== adapter.version && typeof adapter.migrate === 'function'){
      try{ data = adapter.migrate(clone(data), entry.version); }
      catch(_){ data = undefined; }
    }
    if(data === undefined){ restoring = false; toast('This saved game is not compatible.'); return Promise.resolve(false); }
    var restored;
    try{ restored = adapter.restore(clone(data)); }
    catch(error){ restored = Promise.reject(error); }
    return Promise.resolve(restored).then(function(result){
      restoring = false;
      sessionEngaged = true;
      currentEntry = entry;
      stripResumeQuery();
      if(showToast) toast('Saved progress loaded.');
      scheduleSave(900);
      return result !== false;
    }).catch(function(){
      restoring = false;
      sessionEngaged = true;
      toast('Could not load this saved game.');
      return false;
    });
  }

  function activityTarget(event){
    var target = event && event.target;
    if(!target || !target.closest) return true;
    if(target.closest('.arcade-save-layer')) return false;
    var element = target.closest('button,input,select,textarea,[contenteditable="true"],canvas,[role="button"],svg');
    return !!element || event.type === 'keydown';
  }
  function wireAutosave(){
    ['pointerup','click','change','input','keydown'].forEach(function(type){
      document.addEventListener(type, function(event){ if(activityTarget(event)) scheduleSave(type === 'input' ? 850 : 450); }, true);
    });
    window.addEventListener('pagehide', saveNow);
    window.addEventListener('beforeunload', saveNow);
    window.addEventListener('arcadepause', saveNow);
    document.addEventListener('arcadepause', saveNow);
    document.addEventListener('visibilitychange', function(){ if(document.visibilityState === 'hidden') saveNow(); });
    intervalTimer = setInterval(function(){
      if(document.visibilityState !== 'hidden' && (dirty || adapter.alwaysSave)) saveNow();
    }, 5000);
  }

  function register(options){
    if(adapter) throw new Error('ArcadeSave is already registered for this page.');
    options = options || {};
    if(typeof options.capture !== 'function' || typeof options.restore !== 'function'){
      throw new Error('ArcadeSave requires capture and restore functions.');
    }
    adapter = {
      id: String(options.id || deriveId()),
      title: String(options.title || document.title || 'this game'),
      version: Number(options.version || 1),
      capture: options.capture,
      restore: options.restore,
      meaningful: options.meaningful,
      summary: options.summary,
      migrate: options.migrate,
      startFresh: options.startFresh,
      alwaysSave: options.alwaysSave === true
    };
    wireAutosave();
    var ready = readEntry(adapter.id).then(function(entry){
      if(entry && !compatible(entry)){
        return deleteEntry(adapter.id).then(function(){ setRegistryEntry(null); return null; });
      }
      currentEntry = entry || null;
      if(entry) setRegistryEntry(entry);
      if(entry && wantsAutomaticResume()) return restoreEntry(entry, true);
      if(entry){ showPrompt(entry); return true; }
      sessionEngaged = true;
      return false;
    }).catch(function(){ sessionEngaged = true; return false; });
    return ready;
  }

  window.ArcadeSave = {
    register: register,
    saveNow: saveNow,
    touch: scheduleSave,
    load: function(){ return currentEntry ? restoreEntry(currentEntry, true) : readEntry(adapter.id).then(function(entry){ return entry ? restoreEntry(entry, true) : false; }); },
    clear: function(){ return clearSaved(true); },
    hasSave: function(){ return !!currentEntry; },
    getRegistry: readRegistry,
    getCurrentEntry: function(){ return currentEntry ? clone(currentEntry) : null; }
  };
})();
