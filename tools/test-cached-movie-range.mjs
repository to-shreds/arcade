import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const source=await readFile(new URL('../sw.js',import.meta.url),'utf8');
const context={URL,Headers,Response,Map,Set,Promise,self:{registration:{scope:'https://example.test/arcade/'},location:{origin:'https://example.test'},addEventListener(){}}};
vm.runInNewContext(source+'\nself.movieRange=cachedMovieRange;',context);
test('verified offline movie bytes support native seeks without changing the cached original',async()=>{
 const original=new Response('0123456789',{headers:{'content-type':'video/mp4','content-encoding':'gzip'}});
 for(const [range,want,contentRange] of [['bytes=0-','0123456789','bytes 0-9/10'],['bytes=2-5','2345','bytes 2-5/10'],['bytes=-3','789','bytes 7-9/10']]){
  const r=await context.self.movieRange(original.clone(),range);assert.equal(r.status,206);assert.equal(r.headers.get('content-range'),contentRange);assert.equal(r.headers.get('content-type'),'video/mp4');assert.equal(r.headers.get('content-encoding'),null);assert.equal(await r.text(),want);
 }
 for(const range of ['bytes=20-','bytes=5-2','bytes=-0','items=0-1','bytes=0-1,4-5']){
  const r=await context.self.movieRange(original.clone(),range);assert.equal(r.status,416);assert.equal(r.headers.get('content-range'),'bytes */10');
 }
 assert.equal(await original.text(),'0123456789');
});
