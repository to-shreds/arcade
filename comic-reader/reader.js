import {
  GITHUB_API, MAX_IMAGE_BYTES,
  supportedFile, extensionOf, naturalCompare, imageEntries, githubLibrary, localBook,
  spreadStart, nextPage, previousPage, formatSize
} from './core.mjs';

const $ = id => document.getElementById(id);
const UI = Object.fromEntries([
  'shelf','arcadeHome','refresh','chooseFile','filePicker','search','libraryStatus','books',
  'reader','readerTitle','backShelf','menuBtn','stage','pages','continuous','readingStatus',
  'prevPage','nextPage','pageSlider','pageCounter','modal','closeMenu','fitMode','readingMode',
  'direction','bookmarkBtn','showBookmarks','keepOffline','removeOffline','menuLibrary',
  'menuHome','menuStatus','bookmarkModal','bookmarksList','closeBookmarks','pageModal',
  'pageInput','pageForm','closePageInput'
].map(id => [id, $(id)]));
const PREF_KEY = 'arcade.comics.preferences.v1';
const PROGRESS_KEY = 'arcade.comics.progress.v1';
const DB_NAME = 'arcade.comics.library.v1';
const MAX_CACHE_PAGES = 12;

function storedObject(key, fallback) {
  try { const o = JSON.parse(localStorage.getItem(key)); return o && typeof o === 'object' && !Array.isArray(o) ? o : fallback; }
  catch (_) { return fallback; }
}
let preferences = { fit: 'page', mode: 'single', direction: 'ltr', ...storedObject(PREF_KEY, {}) };
if (!['page','width'].includes(preferences.fit)) preferences.fit = 'page';
if (!['single','continuous','spread'].includes(preferences.mode)) preferences.mode = 'single';
if (!['ltr','rtl'].includes(preferences.direction)) preferences.direction = 'ltr';
let progress = storedObject(PROGRESS_KEY, {});
let books = [];
let metadata = new Map();
let activeBook = null;
let activeBlob = null;
let pdfDocument = null;
let cbzEntries = null;
let cbzReader = null;
let pdfRangeTransport = null;
let count = 0;
let page = 0;
let documentGeneration = 0;
let displayGeneration = 0;
let pageCache = new Map();
let pendingPages = new Map();
let observer = null;
let libraryRequest = null;
let currentDownload = null;
let activeModal = null;
let zoom = 1, panX = 0, panY = 0;
let touchBegin = null, lastTap = null, suppressClickUntil = 0;
let continuousTick = false;
let dbInstance = null;
let dbPromise = null;

function savePreferences() { try { localStorage.setItem(PREF_KEY, JSON.stringify(preferences)); } catch (_) {} }
function saveProgress() { try { localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress)); } catch (_) {} }
function pagesRead(id) { const s = progress[id]; return s && Number.isInteger(s.page) && s.page >= 0 ? s.page : 0; }
function bookmarkPages(id) {
  const a = progress[id]?.bookmarks;
  return Array.isArray(a) ? [...new Set(a.filter(n => Number.isInteger(n) && n >= 0 && n < count))].sort((a,b) => a-b) : [];
}
function recordProgress() {
  if (!activeBook || !count) return;
  progress[activeBook.id] = { ...progress[activeBook.id], page, count, lastOpened: Date.now() };
  saveProgress();
}
function status(message, error = false) { UI.libraryStatus.textContent = message; UI.libraryStatus.classList.toggle('error', !!error); }
function readerStatus(message) { UI.readingStatus.textContent = message || ''; UI.readingStatus.hidden = !message; }
function menuStatus(message) { UI.menuStatus.textContent = message || ''; }
function home() {
  // The shared helper preserves the persistent Arcade shell, saves and native fallback.
  if (typeof window.ArcadeSave?.goHome === 'function') window.ArcadeSave.goHome();
}
function openModal(modal) { closeModals(); activeModal = modal; modal.hidden = false; }
function closeModals() { for (const modal of [UI.modal, UI.bookmarkModal, UI.pageModal]) modal.hidden = true; activeModal = null; }

function database() {
  if (!('indexedDB' in window)) return Promise.resolve(null);
  if (dbPromise) return dbPromise;
  dbPromise = new Promise(resolve => {
    let req;
    try { req = indexedDB.open(DB_NAME, 1); } catch (_) { resolve(null); return; }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('files')) db.createObjectStore('files');
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'id' });
    };
    req.onsuccess = () => { dbInstance = req.result; dbInstance.onversionchange = () => { dbInstance.close(); dbInstance = null; dbPromise = null; }; resolve(dbInstance); };
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
  return dbPromise;
}
async function databaseGet(store, key) {
  const db = await database(); if (!db) return null;
  return new Promise(resolve => {
    try {
      const tx = db.transaction(store, 'readonly');
      const req = tx.objectStore(store).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    } catch (_) { resolve(null); }
  });
}
async function allMetadata() {
  const db = await database(); if (!db) return [];
  return new Promise(resolve => {
    try { const req = db.transaction('meta', 'readonly').objectStore('meta').getAll();
      req.onsuccess = () => resolve(Array.isArray(req.result) ? req.result : []);
      req.onerror = () => resolve([]);
    } catch (_) { resolve([]); }
  });
}
async function putMetadata(meta) {
  if (!meta || !meta.id) return false;
  const db = await database(); if (!db) return false;
  return new Promise(resolve => {
    try { const tx = db.transaction('meta', 'readwrite'); tx.objectStore('meta').put(meta);
      tx.oncomplete = () => { metadata.set(meta.id, meta); resolve(true); };
      tx.onerror = () => resolve(false); tx.onabort = () => resolve(false);
    } catch (_) { resolve(false); }
  });
}
async function saveOfflineFile(id, blob, meta) {
  const db = await database(); if (!db) throw new Error('This browser cannot save books for offline use.');
  await new Promise((resolve,reject) => {
    try { const tx = db.transaction(['files','meta'],'readwrite');
      tx.objectStore('files').put(blob, id);
      tx.objectStore('meta').put(meta);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error || new Error('Storage unavailable'));
      tx.onabort = () => reject(tx.error || new Error('Storage unavailable'));
    } catch (e) { reject(e); }
  });
  metadata.set(id, meta);
}
async function removeOfflineFile(id) {
  const db = await database(); if (!db) throw new Error('Storage is unavailable.');
  const meta = metadata.get(id);
  if (!meta) return;
  await new Promise((resolve,reject) => {
    try { const tx = db.transaction(['files','meta'], 'readwrite');
      tx.objectStore('files').delete(id);
      tx.objectStore('meta').put({ ...meta, saved: false });
      tx.oncomplete = resolve; tx.onerror = () => reject(tx.error || new Error('Storage failed'));
    } catch (e) { reject(e); }
  });
  metadata.set(id, { ...meta, saved: false });
}

function combinedBooks() {
  const byId = new Map(books.map(book => [book.id, book]));
  for (const meta of metadata.values()) {
    if (!meta.saved || byId.has(meta.id)) continue;
    byId.set(meta.id, { id:meta.id, name:meta.name, title:meta.title, kind:meta.kind,
      source:meta.source, size:meta.size, saved:true });
  }
  return [...byId.values()].sort((a,b) => naturalCompare(a.title,b.title));
}
function shelf() {
  UI.reader.hidden = true; UI.shelf.hidden = false; closeModals(); renderShelf();
}
function renderShelf() {
  const term = UI.search.value.trim().toLowerCase();
  const list = combinedBooks().filter(book => !term || book.title.toLowerCase().includes(term));
  UI.books.replaceChildren();
  if (!list.length) {
    const empty = document.createElement('p'); empty.className = 'status';
    empty.textContent = term ? 'No matching comics.' : 'No comics yet. Upload CBZ or PDF files to Misc/cbz, or tap Open CBZ or PDF.';
    UI.books.append(empty); return;
  }
  for (const book of list) {
    const button = document.createElement('button'); button.className = 'book'; button.type='button';
    button.setAttribute('aria-label', `Open ${book.title}`);
    const cover = document.createElement('div'); cover.className = 'cover';
    const meta = metadata.get(book.id);
    if (meta?.cover?.startsWith('data:image/')) {
      const image = document.createElement('img'); image.src = meta.cover; image.alt=''; image.loading='lazy'; cover.append(image);
    } else {
      const placeholder = document.createElement('span'); placeholder.className='placeholder'; placeholder.textContent = book.kind === 'pdf' ? 'PDF' : 'CBZ'; cover.append(placeholder);
    }
    const title = document.createElement('span'); title.className='title'; title.textContent=book.title;
    const info = document.createElement('span'); info.className='meta';
    info.textContent = `${book.kind.toUpperCase()} · ${book.source==='local' ? 'Device' : 'GitHub'}${meta?.saved ? ' · Saved' : ''}${book.size ? ' · '+formatSize(book.size) : ''}`;
    button.append(cover,title,info);
    const s = progress[book.id];
    if (s && Number.isInteger(s.page) && s.count > 1) {
      const bar = document.createElement('div'); bar.className='progress';
      const filled = document.createElement('span'); filled.style.width=`${Math.min(100,Math.max(0,100*(s.page+1)/s.count))}%`;
      bar.append(filled); button.append(bar);
    }
    button.addEventListener('click', () => openBook(book)); UI.books.append(button);
  }
}
async function refreshLibrary() {
  if (libraryRequest) libraryRequest.abort();
  const controller = new AbortController(); libraryRequest = controller;
  UI.refresh.disabled = true; status('Checking GitHub library…');
  try {
    const response = await fetch(GITHUB_API, { signal:controller.signal, headers: { Accept: 'application/vnd.github+json' }, cache:'no-store' });
    if (response.status === 404) { books = books.filter(b => b.source === 'local'); status('GitHub folder Misc/cbz is empty or not yet created. Local books still work.'); return; }
    if (!response.ok) throw new Error(response.status === 403 ? 'GitHub temporarily refused the listing (possibly an API rate limit).' : `GitHub returned HTTP ${response.status}.`);
    const result = await response.json();
    if (!Array.isArray(result)) throw new Error('GitHub did not return a directory listing.');
    books = [...books.filter(b => b.source === 'local'), ...githubLibrary(result)];
    const n = books.filter(b => b.source === 'github').length;
    status(`${n} book${n===1?'':'s'} available on GitHub${metadata.size ? ' · Offline copies are available below' : ''}.`);
  } catch(e) {
    if (controller.signal.aborted) return;
    status(`Couldn't refresh GitHub: ${e.message}. Saved books and local files still work.`, true);
  } finally { if (libraryRequest === controller) { libraryRequest = null; UI.refresh.disabled = false; renderShelf(); } }
}
async function readRemote(book) {
  currentDownload = new AbortController();
  const signal=currentDownload.signal;
  const urls=book.parts?.length ? book.parts.map(part=>part.url) : [book.url];
  if (urls.some(url=>typeof url!=='string' || !url.startsWith('https://raw.githubusercontent.com/to-shreds/Misc/'))) {
    throw new Error('This GitHub book has no trusted download address.');
  }
  const mime = book.kind === 'pdf' ? 'application/pdf' : 'application/zip';
  const blobs=[];let complete=0;
  for(let i=0;i<urls.length;i++) {
    const response=await fetch(urls[i],{signal,cache:'no-store'});
    if(!response.ok)throw new Error(`Download failed (HTTP ${response.status}).`);
    const expected=Number(response.headers.get('content-length')||book.parts?.[i]?.size||book.size||0);
    let received=0;
    let blob;
    if(response.body && typeof TransformStream==='function') {
      const progressStream=response.body.pipeThrough(new TransformStream({
        transform(chunk,controller) {
          received+=chunk.byteLength;
          const loaded=complete+received;
          readerStatus(`Downloading ${book.title}: ${book.size ? Math.round(100*loaded/book.size)+'%' : formatSize(loaded)}${urls.length>1 ? ` · Part ${i+1}/${urls.length}`:''}`);
          controller.enqueue(chunk);
        }
      }),{signal});
      blob=await new Response(progressStream).blob();
    } else blob=await response.blob();
    if(expected && blob.size!==expected)throw new Error(`Part ${i+1} was incomplete. Please retry.`);
    complete+=blob.size;
    blobs.push(blob);
  }
  return blobs.length===1?blobs[0]:new Blob(blobs,{type:mime});
}

// PDF.js reads only the requested byte ranges from a Blob instead of
// duplicating the complete PDF into a giant Uint8Array before parsing.
function pdfBlobTransport(blob) {
  const Transport=window.pdfjsLib?.PDFDataRangeTransport;
  if(!Transport)throw new Error('PDF range support is unavailable. Refresh the Arcade.');
  return new class extends Transport {
    constructor(){super(blob.size);this.cancelled=false;}
    requestDataRange(begin,end){
      blob.slice(begin,end).arrayBuffer().then(bytes=>{
        if(!this.cancelled)this.onDataRange(begin,new Uint8Array(bytes));
      }).catch(()=>{});
    }
    abort(){this.cancelled=true;}
  }();
}
async function parseBook(blob, kind, generation) {
  if (kind === 'pdf') {
    if (!window.pdfjsLib) throw new Error('PDF reader could not load. Try refreshing the Arcade.');
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('vendor/pdf.worker.min.js',import.meta.url).href;
    const transport=pdfBlobTransport(blob);pdfRangeTransport=transport;
    const task = window.pdfjsLib.getDocument({range:transport,disableAutoFetch:true,disableStream:true,
      isEvalSupported:false,enableScripting:false});
    const result = await task.promise;
    if (generation !== documentGeneration) { await result.destroy(); return; }
    pdfDocument = result;
    count = result.numPages;
  } else {
    if (!window.zip?.ZipReader || !window.zip?.BlobReader) throw new Error('CBZ reader could not load. Refresh the Arcade.');
    const zip=window.zip;
    const archive=new zip.ZipReader(new zip.BlobReader(blob),{useWebWorkers:false});
    cbzReader=archive;
    const entries=imageEntries(await archive.getEntries());
    if (generation !== documentGeneration) return;
    cbzEntries=entries;
    if(!entries.length)throw new Error('This CBZ contains no supported image pages.');
    for(const entry of entries) {
      if (Number(entry.uncompressedSize)>MAX_IMAGE_BYTES)
        throw new Error(`Page ${entry.filename} expands beyond the per-image safety threshold.`);
    }
    count = entries.length;
  }
  if (!count || count>100000) throw new Error('The book has an invalid page count.');
}
function releasePages() {
  for (const item of pageCache.values()) URL.revokeObjectURL(item.url);
  pageCache.clear(); pendingPages.clear();
}
async function releaseDocument() {
  if (observer) { observer.disconnect(); observer=null; }
  const oldPdf=pdfDocument; pdfDocument=null;
  const oldZip=cbzReader;cbzReader=null;
  if(pdfRangeTransport){pdfRangeTransport.abort();pdfRangeTransport=null;}
  releasePages();
  cbzEntries=null; count=0;
  UI.pages.replaceChildren(); UI.continuous.replaceChildren();
  if (oldPdf) { try { await oldPdf.destroy(); } catch (_) {} }
  if (oldZip) { try { await oldZip.close(); } catch (_) {} }
}
async function closeBook() {
  if (!activeBook) { shelf(); return; }
  const closingGeneration=++documentGeneration; ++displayGeneration;
  if (currentDownload) { currentDownload.abort(); currentDownload=null; }
  recordProgress(); activeBook=null; activeBlob=null;
  await releaseDocument();
  if (closingGeneration===documentGeneration) shelf();
}
function mediaType(name) {
  switch(extensionOf(name)) { case 'png':return 'image/png'; case 'webp':return 'image/webp'; case 'gif':return 'image/gif'; case 'avif':return 'image/avif'; default:return 'image/jpeg'; }
}
function cacheUrl(index, url) {
  if (pageCache.has(index)) URL.revokeObjectURL(pageCache.get(index).url);
  pageCache.set(index,{url,used:Date.now()});
  while (pageCache.size > MAX_CACHE_PAGES) {
    const toDrop=[...pageCache.entries()].sort((a,b)=>a[1].used-b[1].used)[0];
    if (!toDrop) break;
    pageCache.delete(toDrop[0]);
    const continuousPage=UI.continuous.children[toDrop[0]];
    if(continuousPage && continuousPage.dataset.loaded==='1') {
      continuousPage.dataset.loaded='0';
      continuousPage.replaceChildren(document.createTextNode(`Page ${toDrop[0]+1}`));
    }
    URL.revokeObjectURL(toDrop[1].url);
  }
  return url;
}
async function pageUrl(index) {
  if (index < 0 || index >= count) throw new Error('Page is out of range.');
  if (pageCache.has(index)) { const entry=pageCache.get(index); entry.used=Date.now(); return entry.url; }
  if (pendingPages.has(index)) return pendingPages.get(index);
  const generation = documentGeneration;
  const promise = (async () => {
    let blob;
    if (cbzEntries) {
      const entry=cbzEntries[index];
      // zip.js seeks to this page's compressed bytes and inflates only this page.
      blob = await entry.getData(new window.zip.BlobWriter(mediaType(entry.filename)),
        {useWebWorkers:false,checkSignature:true});
      if(blob.size>MAX_IMAGE_BYTES)throw new Error('The selected page is too large for safe rendering.');
    } else if(pdfDocument) {
      const pdfPage = await pdfDocument.getPage(index+1);
      const base = pdfPage.getViewport({scale:1});
      const desiredWidth = Math.max(850,Math.min(2300,(UI.stage.clientWidth || 900) * Math.min(2,window.devicePixelRatio||1)));
      let scale = desiredWidth/base.width;
      scale=Math.min(scale,Math.sqrt(5800000/(base.width*base.height)));
      const viewport = pdfPage.getViewport({scale});
      const canvas=document.createElement('canvas'); canvas.width=Math.max(1,Math.ceil(viewport.width)); canvas.height=Math.max(1,Math.ceil(viewport.height));
      const context=canvas.getContext('2d',{alpha:false});
      if (!context) throw new Error('Canvas graphics are unavailable.');
      await pdfPage.render({canvasContext:context,viewport,background:'white'}).promise;
      blob = await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('Page image could not be rendered.')),'image/jpeg',0.94));
      canvas.width=0;canvas.height=0;
      pdfPage.cleanup();
    } else throw new Error('No book is open.');
    if (generation !== documentGeneration) throw new Error('Book was closed.');
    return cacheUrl(index,URL.createObjectURL(blob));
  })();
  pendingPages.set(index,promise);
  try{return await promise;}finally{ if(pendingPages.get(index)===promise) pendingPages.delete(index); }
}
async function createCover(id) {
  if (!id || metadata.get(id)?.cover || !count) return;
  const generation=documentGeneration;
  try {
    const url=await pageUrl(0);
    const image = new Image(); image.src=url;
    await new Promise((resolve,reject)=>{ image.onload=resolve; image.onerror=reject; if(image.complete&&image.naturalWidth)resolve(); });
    if(documentGeneration !== generation)return;
    const canvas=document.createElement('canvas'); const width=180, height=Math.max(1,Math.min(300,Math.round(image.naturalHeight*width/image.naturalWidth)));
    canvas.width=width;canvas.height=height;
    const context=canvas.getContext('2d'); context.drawImage(image,0,0,width,height);
    const cover=canvas.toDataURL('image/jpeg',.65);
    const existing=metadata.get(id) || {};
    await putMetadata({id,source:activeBook?.source||existing.source,kind:activeBook?.kind||existing.kind,
      title:activeBook?.title||existing.title,name:activeBook?.name||existing.name,size:activeBook?.size||existing.size||0,
      saved:!!existing.saved,cover });
  }catch(_){ /* Cover art is optional. */ }
}
function currentTwoUp() { return preferences.mode === 'spread' && matchMedia('(orientation: landscape) and (min-width: 600px)').matches; }
function resetZoom() { zoom=1;panX=0;panY=0;updateZoom(); }
function updateZoom() {
  const maxX=Math.max(0,UI.stage.clientWidth*(zoom-1)/2);
  const maxY=Math.max(0,UI.stage.clientHeight*(zoom-1)/2);
  panX=Math.max(-maxX,Math.min(maxX,panX)); panY=Math.max(-maxY,Math.min(maxY,panY));
  UI.pages.style.transform=`translate(${panX}px,${panY}px) scale(${zoom})`;
}
function updateControls() {
  UI.readerTitle.textContent = activeBook?.title || 'Comic';
  UI.pageSlider.max=String(Math.max(1,count)); UI.pageSlider.value=String(page+1);
  UI.pageCounter.textContent=`${page+1} / ${Math.max(1,count)}`;
  UI.prevPage.disabled = !count || page <= 0;
  UI.nextPage.disabled = !count || page >= count-1;
  const saved = !!metadata.get(activeBook?.id)?.saved;
  UI.keepOffline.hidden = saved;
  UI.removeOffline.hidden = !saved;
  UI.bookmarkBtn.textContent = bookmarkPages(activeBook?.id).includes(page) ? 'Remove bookmark' : 'Bookmark this page';
}
async function renderSingle() {
  if (!activeBook || !count) return;
  const generation=++displayGeneration;
  const start=spreadStart(page,currentTwoUp());
  const indexes = currentTwoUp() && start !== 0 ? [start,start+1].filter(i=>i<count) : [start];
  if(preferences.direction==='rtl')indexes.reverse();
  UI.continuous.hidden=true;UI.pages.hidden=false;
  UI.pages.className=`pages${currentTwoUp()?' spread':''}${preferences.fit==='width'?' fit-width':''}`;
  UI.pages.replaceChildren(); resetZoom();
  readerStatus(`Loading page ${page+1}…`);
  const pictures = indexes.map(index=>{
    const img=document.createElement('img');img.className='page-image';img.alt=`Page ${index+1}`; img.draggable=false;
    UI.pages.append(img); return {index,img};
  });
  await Promise.all(pictures.map(async ({index,img})=>{
    try { const url=await pageUrl(index); if(generation===displayGeneration && !UI.reader.hidden) img.src=url; }
    catch(e) { if(generation===displayGeneration) { img.alt=`Page ${index+1} could not load: ${e.message}`; img.style.background='#28314e'; } }
  }));
  if(generation!==displayGeneration)return;
  readerStatus('');
  for(const index of [start-2,start-1,start+1,start+2]){
    if(index>=0 && index<count && !pageCache.has(index)) pageUrl(index).catch(()=>{});
  }
}
async function loadContinuousPage(item, index) {
  if (!activeBook || item.dataset.loading === '1' || item.dataset.loaded === '1') return;
  item.dataset.loading='1';
  const generation=documentGeneration;
  try {
    const url=await pageUrl(index);
    if(generation!==documentGeneration || !item.isConnected)return;
    const img = document.createElement('img'); img.className='page-image';img.alt=`Page ${index+1}`;img.loading='lazy';img.src=url;
    item.replaceChildren(img);item.dataset.loaded='1';
  } catch (e) { if(generation===documentGeneration && item.isConnected)item.textContent=`Page ${index+1} unavailable`; }
  finally { item.dataset.loading='0'; }
}
function renderContinuous() {
  if(observer)observer.disconnect();
  ++displayGeneration; UI.pages.hidden=true;UI.continuous.hidden=false;
  UI.continuous.replaceChildren();
  const fragment=document.createDocumentFragment();
  for(let i=0;i<count;i++){
    const item=document.createElement('div');item.className='cont-page';item.dataset.page=i;
    item.textContent=`Page ${i+1}`;fragment.append(item);
  }
  UI.continuous.append(fragment);
  observer = new IntersectionObserver(entries=>{
    for(const entry of entries){if(entry.isIntersecting)loadContinuousPage(entry.target,Number(entry.target.dataset.page));}
  },{root:UI.continuous,rootMargin:'650px 0px'});
  for(const item of UI.continuous.children)observer.observe(item);
  const target=UI.continuous.children[page];
  if(target)UI.continuous.scrollTop=target.offsetTop-UI.continuous.offsetTop;
  readerStatus('');
}
function renderCurrent() {
  updateControls(); recordProgress();
  if(preferences.mode==='continuous') {
    if(UI.continuous.hidden)renderContinuous();
    else { const target=UI.continuous.children[page]; if(target)UI.continuous.scrollTop=target.offsetTop-UI.continuous.offsetTop; }
  } else { if(observer){observer.disconnect();observer=null;} renderSingle().catch(e=>readerStatus(e.message)); }
}
function navigate(target) {
  if(!activeBook || !count)return;
  const index=Math.max(0,Math.min(count-1,Math.trunc(Number(target)||0)));
  if(index===page){updateControls();return;}
  page=index;resetZoom();renderCurrent();
}
function forward() { navigate(nextPage(page,count,currentTwoUp())); }
function backward() { navigate(previousPage(page,currentTwoUp())); }

async function openBook(book) {
  if(activeBook)await closeBook();
  const generation=++documentGeneration;
  activeBook=book; count=0;page=0;activeBlob=null;
  UI.shelf.hidden=true;UI.reader.hidden=false;UI.reader.classList.remove('hide-controls');
  UI.readerTitle.textContent=book.title;
  UI.pages.hidden=false;UI.continuous.hidden=true;UI.pages.replaceChildren();
  updateControls();readerStatus(`Opening ${book.title}…`);
  try {
    let blob = book.file;
    const offline = metadata.get(book.id)?.saved;
    if(offline)blob=await databaseGet('files',book.id) || blob;
    if(!blob) {
      if(book.source==='github')blob=await readRemote(book);
      else throw new Error('Choose the original file again to reopen this book.');
    }
    if(generation!==documentGeneration)return;
    activeBlob=blob;
    readerStatus('Preparing pages…');
    await parseBook(blob,book.kind,generation);
    if(generation!==documentGeneration)return;
    page=Math.min(count-1,pagesRead(book.id));
    renderCurrent();
    createCover(book.id).then(()=>renderShelf()).catch(()=>{});
  }catch(e){
    if(generation!==documentGeneration)return;
    readerStatus(`Could not open this book: ${e.message}`);
    UI.pages.replaceChildren();
    UI.continuous.hidden=true;
  }finally { currentDownload=null; }
}
function toggleBookmark() {
  if(!activeBook || !count)return;
  const marks=bookmarkPages(activeBook.id), spot=marks.indexOf(page);
  if(spot>=0)marks.splice(spot,1);else marks.push(page);
  marks.sort((a,b)=>a-b);
  progress[activeBook.id] = {...progress[activeBook.id], page, count, bookmarks:marks};saveProgress();
  updateControls();menuStatus(spot>=0?'Bookmark removed.':'Page bookmarked.');
}
function showBookmarks() {
  UI.bookmarksList.replaceChildren();
  const pages = bookmarkPages(activeBook?.id);
  if(!pages.length){const p=document.createElement('p');p.textContent='No bookmarks yet. Use Bookmark this page in Reading options.';p.className='small-status';UI.bookmarksList.append(p);}
  for(const n of pages){const b=document.createElement('button');b.textContent=`Page ${n+1}`;b.addEventListener('click',()=>{closeModals();navigate(n);});UI.bookmarksList.append(b);}
  openModal(UI.bookmarkModal);
}
async function keepOffline() {
  if(!activeBook || !activeBlob)return;
  menuStatus('Saving book to this device…');UI.keepOffline.disabled=true;
  try {
    const existing=metadata.get(activeBook.id)||{};
    const meta={...existing,id:activeBook.id,name:activeBook.name,title:activeBook.title,
      kind:activeBook.kind,source:activeBook.source,size:activeBlob.size,saved:true};
    await saveOfflineFile(activeBook.id,activeBlob,meta);
    menuStatus('Saved. This book can now open without Internet.');
    updateControls();
  }catch(e){menuStatus(`Could not save offline copy: ${e.name==='QuotaExceededError'?'Device storage is full.':e.message}`);}
  finally{UI.keepOffline.disabled=false;}
}
async function removeOffline() {
  if(!activeBook)return;
  menuStatus('Removing saved copy…');
  try { await removeOfflineFile(activeBook.id);menuStatus('Offline copy removed.');updateControls(); }
  catch(e){menuStatus(`Could not remove saved copy: ${e.message}`);}
}
function trackContinuousScroll() {
  if(preferences.mode!=='continuous' || !activeBook || continuousTick)return;
  continuousTick=true;
  requestAnimationFrame(()=>{
    continuousTick=false;
    if(preferences.mode!=='continuous' || !activeBook)return;
    const top=UI.continuous.getBoundingClientRect().top, focus=top+UI.continuous.clientHeight*.35;
    let closest=Infinity, chosen=page;
    for(const item of UI.continuous.children){const r=item.getBoundingClientRect();
      if(r.bottom<top-150||r.top>top+UI.continuous.clientHeight+150)continue;
      const delta=Math.abs(r.top-focus);
      if(delta<closest){closest=delta;chosen=Number(item.dataset.page);}
    }
    if(chosen!==page){page=chosen;recordProgress();updateControls();}
  });
}
function stageClick(e) {
  if(Date.now() < suppressClickUntil || preferences.mode === 'continuous' || !activeBook || activeModal || !count)return;
  const bounds=UI.stage.getBoundingClientRect();const x=(e.clientX-bounds.left)/bounds.width;
  if(zoom>1)return;
  if(x<.28) preferences.direction==='rtl'?forward():backward();
  else if(x>.72)preferences.direction==='rtl'?backward():forward();
  else UI.reader.classList.toggle('hide-controls');
}
function zoomAt(scale) { zoom=scale; if(zoom===1){panX=0;panY=0;}updateZoom(); }
function tapAt(clientX,clientY) {
  const now=Date.now();
  if(lastTap && now-lastTap.at<350 && Math.hypot(lastTap.x-clientX,lastTap.y-clientY)<32){
    zoomAt(zoom>1?1:2.3);lastTap=null;return;
  }
  lastTap={x:clientX,y:clientY,at:now};
  const r=UI.stage.getBoundingClientRect();const x=(clientX-r.left)/r.width;
  if(zoom>1)return;
  if(x<.28)preferences.direction==='rtl'?forward():backward();
  else if(x>.72)preferences.direction==='rtl'?backward():forward();
  else UI.reader.classList.toggle('hide-controls');
}
function touchDistance(touches){const a=touches[0],b=touches[1];return Math.hypot(a.clientX-b.clientX,a.clientY-b.clientY);}
function touchStart(e) {
  if(preferences.mode==='continuous'||!count)return;
  if(e.touches.length===2){touchBegin={pinch:true,startDistance:touchDistance(e.touches),startZoom:zoom};e.preventDefault();return;}
  if(e.touches.length===1)touchBegin={pinch:false,x:e.touches[0].clientX,y:e.touches[0].clientY,time:Date.now(),panX,panY};
}
function touchMove(e) {
  if(preferences.mode==='continuous'||!touchBegin)return;
  if(e.touches.length===2){
    if(!touchBegin.pinch)touchBegin={pinch:true,startDistance:touchDistance(e.touches),startZoom:zoom};
    zoom=Math.max(1,Math.min(4,touchBegin.startZoom*touchDistance(e.touches)/Math.max(1,touchBegin.startDistance)));
    updateZoom();e.preventDefault();return;
  }
  if(e.touches.length===1 && !touchBegin.pinch && zoom>1){
    panX=touchBegin.panX+e.touches[0].clientX-touchBegin.x;
    panY=touchBegin.panY+e.touches[0].clientY-touchBegin.y;
    updateZoom();e.preventDefault();
  }
}
function touchEnd(e) {
  if(preferences.mode==='continuous'||!touchBegin)return;
  suppressClickUntil=Date.now()+550;
  if(touchBegin.pinch){if(e.touches.length===0)touchBegin=null;return;}
  if(e.changedTouches.length<1)return;
  const t=e.changedTouches[0],dx=t.clientX-touchBegin.x,dy=t.clientY-touchBegin.y;
  if(!e.touches.length){
    if(zoom<=1.02 && Math.abs(dx)>50 && Math.abs(dx)>Math.abs(dy)*1.3){
      const advance=dx<0;
      (preferences.direction==='rtl' ? !advance : advance) ? forward() : backward();
    } else if(Math.abs(dx)<20 && Math.abs(dy)<20 && Date.now()-touchBegin.time<500){tapAt(t.clientX,t.clientY);}
    touchBegin=null;
  }
}
function applySettings() {
  preferences.fit=UI.fitMode.value;preferences.mode=UI.readingMode.value;preferences.direction=UI.direction.value;
  savePreferences(); resetZoom();
  if(activeBook&&count){ UI.continuous.hidden=true;renderCurrent(); }
}
function bind() {
  UI.arcadeHome.addEventListener('click',home);UI.menuHome.addEventListener('click',home);
  UI.chooseFile.addEventListener('click',()=>UI.filePicker.click());
  UI.filePicker.addEventListener('change', async ()=>{
    const file=UI.filePicker.files?.[0];UI.filePicker.value='';
    if(!file)return;
    if(!supportedFile(file.name)){status('Please select a CBZ or PDF file.',true);return;}
    const book=localBook(file);
    books=[book,...books.filter(b=>b.id!==book.id)];
    await openBook(book);
  });
  UI.refresh.addEventListener('click',refreshLibrary);UI.search.addEventListener('input',renderShelf);
  UI.backShelf.addEventListener('click',closeBook);UI.menuLibrary.addEventListener('click',closeBook);
  UI.menuBtn.addEventListener('click',()=>{UI.fitMode.value=preferences.fit;UI.readingMode.value=preferences.mode;UI.direction.value=preferences.direction;menuStatus('');updateControls();openModal(UI.modal);});
  UI.closeMenu.addEventListener('click',closeModals);UI.closeBookmarks.addEventListener('click',closeModals);
  for(const id of ['fitMode','readingMode','direction'])UI[id].addEventListener('change',applySettings);
  UI.bookmarkBtn.addEventListener('click',toggleBookmark);
  UI.showBookmarks.addEventListener('click',showBookmarks);
  UI.keepOffline.addEventListener('click',keepOffline);UI.removeOffline.addEventListener('click',removeOffline);
  UI.prevPage.addEventListener('click',backward);UI.nextPage.addEventListener('click',forward);
  UI.pageSlider.addEventListener('input',()=>{UI.pageCounter.textContent=`${UI.pageSlider.value} / ${count}`;});
  UI.pageSlider.addEventListener('change',()=>navigate(Number(UI.pageSlider.value)-1));
  UI.pageCounter.addEventListener('click',()=>{UI.pageInput.value=String(page+1);UI.pageInput.max=String(count);openModal(UI.pageModal);UI.pageInput.focus();UI.pageInput.select();});
  UI.pageForm.addEventListener('submit',e=>{e.preventDefault();const n=Number(UI.pageInput.value);if(!Number.isInteger(n)||n<1||n>count)return;closeModals();navigate(n-1);});
  UI.closePageInput.addEventListener('click',closeModals);
  for(const modal of [UI.modal,UI.bookmarkModal,UI.pageModal])modal.addEventListener('click',e=>{if(e.target===modal)closeModals();});
  UI.stage.addEventListener('click',stageClick);UI.stage.addEventListener('dblclick',e=>{e.preventDefault();suppressClickUntil=Date.now()+300;zoomAt(zoom>1?1:2.3);});
  UI.stage.addEventListener('touchstart',touchStart,{passive:false});UI.stage.addEventListener('touchmove',touchMove,{passive:false});
  UI.stage.addEventListener('touchend',touchEnd,{passive:false});UI.stage.addEventListener('touchcancel',()=>{touchBegin=null;});
  UI.continuous.addEventListener('scroll',trackContinuousScroll,{passive:true});
  window.addEventListener('resize',()=>{if(activeBook&&count&&preferences.mode==='spread')renderCurrent();});
  window.addEventListener('keydown',e=>{
    if(e.key==='Escape') {if(activeModal){closeModals();e.preventDefault();}else if(activeBook){closeBook();e.preventDefault();}return;}
    if(!activeBook || activeModal || !count || /input|select|textarea/i.test(document.activeElement?.tagName||''))return;
    if(e.key==='ArrowRight'){preferences.direction==='rtl'?backward():forward();e.preventDefault();}
    else if(e.key==='ArrowLeft'){preferences.direction==='rtl'?forward():backward();e.preventDefault();}
    else if(e.key===' '||e.key==='PageDown'){forward();e.preventDefault();}
    else if(e.key==='PageUp'){backward();e.preventDefault();}
  });
}
async function boot() {
  bind();
  const all=await allMetadata();metadata=new Map(all.filter(m=>m&&m.id).map(m=>[m.id,m]));
  renderShelf();refreshLibrary();
}
boot().catch(e=>status(`Comic Library couldn't start: ${e.message}`,true));