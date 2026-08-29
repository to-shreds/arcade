const VERSION='2026-08-29-remote-v1';
const CORE_CACHE=`family-arcade-core-${VERSION}`;
const MEDIA_CACHE=`family-arcade-media-${VERSION}`;
const CORE_SEEDS=['./','index.html','catalog.json','arcade-ui.css','arcade-save.js','arcade-keyboard.js','arcade.png'];

const absolute=path=>new URL(path,self.registration.scope).href;

async function fetchFresh(path){
  const response=await fetch(absolute(path),{cache:'no-store'});
  if(!response.ok)throw new Error(`${path}: ${response.status}`);
  return response;
}

async function catalogAssets(){
  const response=await fetchFresh('catalog.json');
  const data=await response.clone().json();
  const assets=[...CORE_SEEDS];
  for(const item of data.items||[]){
    if(item.launchPath)assets.push(item.launchPath);
    if(item.folder&&item.icon)assets.push(`${item.folder}/${item.icon}`);
    if(item.folder)assets.push(`${item.folder}/game.json`);
  }
  assets.push('music-maker/style.css','music-maker/music-maker.js','music-maker/audio/pitch-processor.js');
  return {assets:[...new Set(assets)],catalog:response};
}

async function cacheInBatches(cache,assets,size=8){
  for(let start=0;start<assets.length;start+=size){
    await Promise.allSettled(assets.slice(start,start+size).map(async path=>{
      const response=await fetchFresh(path);
      await cache.put(absolute(path),response);
    }));
  }
}

async function refreshCore(){
  const cache=await caches.open(CORE_CACHE);
  const {assets,catalog}=await catalogAssets();
  await cache.put(absolute('catalog.json'),catalog);
  await cacheInBatches(cache,assets.filter(path=>path!=='catalog.json'));
  return cache;
}

self.addEventListener('install',event=>{
  event.waitUntil((async()=>{
    const cache=await refreshCore();
    if(!await cache.match(absolute('index.html')))throw new Error('Arcade index was not cached');
    await self.skipWaiting();
  })());
});

self.addEventListener('message',event=>{
  if(event.data&&event.data.type==='REFRESH_CORE')event.waitUntil(refreshCore());
});

self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    const keep=new Set([CORE_CACHE,MEDIA_CACHE]);
    await Promise.all((await caches.keys()).filter(name=>name.startsWith('family-arcade-')&&!keep.has(name)).map(name=>caches.delete(name)));
    await self.clients.claim();
  })());
});

async function networkFirst(request,cacheName,timeoutMs=5500){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    const response=await fetch(request,{signal:controller.signal});
    if(response.ok)(await caches.open(cacheName)).put(request,response.clone());
    return response;
  }catch(error){
    const cached=await caches.match(request,{ignoreSearch:true});
    if(cached)return cached;
    throw error;
  }finally{clearTimeout(timer)}
}

async function cacheFirst(request,cacheName){
  const cached=await caches.match(request,{ignoreSearch:true});
  if(cached)return cached;
  const response=await fetch(request);
  if(response.ok)(await caches.open(cacheName)).put(request,response.clone());
  return response;
}

async function staleWhileRevalidate(request,cacheName){
  const cache=await caches.open(cacheName);
  const cached=await cache.match(request,{ignoreSearch:true});
  const update=fetch(request).then(response=>{
    if(response.ok)cache.put(request,response.clone());
    return response;
  }).catch(()=>null);
  if(cached){update.then(()=>{});return cached}
  const fresh=await update;
  if(fresh)return fresh;
  throw new Error('Resource unavailable');
}

self.addEventListener('fetch',event=>{
  const request=event.request;
  if(request.method!=='GET')return;
  const url=new URL(request.url);
  if(url.origin!==self.location.origin||!url.pathname.startsWith(new URL(self.registration.scope).pathname))return;
  if(request.mode==='navigate'){
    event.respondWith(networkFirst(request,CORE_CACHE).catch(async()=>{
      const exact=await caches.match(request,{ignoreSearch:true});
      return exact||caches.match(absolute('index.html'));
    }));
    return;
  }
  if(url.pathname.endsWith('/catalog.json')){
    event.respondWith(networkFirst(request,CORE_CACHE));
    return;
  }
  if(url.pathname.endsWith('.wav'))event.respondWith(cacheFirst(request,MEDIA_CACHE));
  else event.respondWith(staleWhileRevalidate(request,CORE_CACHE));
});
