import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {serveStaticFile} from './static-response.mjs';
test('offline movie fixtures support complete loads, seeking, suffix ranges and invalid ranges',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'arcade-movie-')),file=join(dir,'clip.mp4');
 await writeFile(file,Buffer.from('0123456789'));
 const server=createServer((q,s)=>serveStaticFile(q,s,file,'video/mp4'));
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const url=`http://127.0.0.1:${server.address().port}/clip.mp4`;
 try{
  let r=await fetch(url);assert.equal(r.status,200);assert.equal(r.headers.get('content-type'),'video/mp4');assert.equal(await r.text(),'0123456789');
  for(const [range,text,header] of [['bytes=2-5','2345','bytes 2-5/10'],['bytes=7-','789','bytes 7-9/10'],['bytes=-3','789','bytes 7-9/10'],['bytes=8-200','89','bytes 8-9/10']]){
   r=await fetch(url,{headers:{Range:range}});assert.equal(r.status,206);assert.equal(r.headers.get('content-range'),header);assert.equal(await r.text(),text);
  }
  for(const range of ['bytes=20-','bytes=8-2','bytes=-0','bytes=','items=1-2','bytes=1-2,4-6']){r=await fetch(url,{headers:{Range:range}});assert.equal(r.status,416);assert.equal(r.headers.get('content-range'),'bytes */10');}
  r=await fetch(url,{method:'HEAD',headers:{Range:'bytes=2-5'}});assert.equal(r.status,206);assert.equal(r.headers.get('content-length'),'4');assert.equal(await r.text(),'');
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});}
});
