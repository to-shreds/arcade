#!/usr/bin/env node
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,readFile,open,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium,browserLaunchOptions} from './browser-runtime.mjs';

const root=resolve(fileURLToPath(new URL('../',import.meta.url)));
const temp=await mkdtemp(join(tmpdir(),'arcade-large-comic-'));
const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAFElEQVR4nGN827qCARtgwio6aCUAp3gCKi6ts+sAAAAASUVORK5CYII=','base64');
function crc32(data){let crc=0xFFFFFFFF;for(const v of data){crc^=v;for(let i=0;i<8;i++)crc=(crc>>>1)^(-(crc&1)&0xEDB88320);}return (crc^0xFFFFFFFF)>>>0;}
function localHeader(name,size,crc){const b=Buffer.alloc(30);b.writeUInt32LE(0x04034b50,0);b.writeUInt16LE(20,4);b.writeUInt32LE(crc,14);b.writeUInt32LE(size,18);b.writeUInt32LE(size,22);b.writeUInt16LE(Buffer.byteLength(name),26);return b;}
function centralHeader(name,size,crc,offset){const b=Buffer.alloc(46);b.writeUInt32LE(0x02014b50,0);b.writeUInt16LE(20,4);b.writeUInt16LE(20,6);b.writeUInt32LE(crc,16);b.writeUInt32LE(size,20);b.writeUInt32LE(size,24);b.writeUInt16LE(Buffer.byteLength(name),28);b.writeUInt32LE(offset,42);return b;}
async function makeLargeCBZ(filePath){
  const filler=160*1024*1024;
  const fh=await open(filePath,'w');
  try{
    const entries=[];let position=0;
    for(const {name,size,content,crc} of [
      {name:'pages/001.png',size:bytes.length,content:bytes,crc:crc32(bytes)},
      {name:'unused-data.bin',size:filler,content:null,crc:0}
    ]){
      const begin=position;
      const head=Buffer.concat([localHeader(name,size,crc),Buffer.from(name)]);
      await fh.write(head,0,head.length,position);position+=head.length;
      if(content){await fh.write(content,0,content.length,position);}
      position+=size;
      entries.push(centralHeader(name,size,crc,begin),Buffer.from(name));
    }
    const central=Buffer.concat(entries),start=position;
    await fh.write(central,0,central.length,position);position+=central.length;
    const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(2,8);end.writeUInt16LE(2,10);end.writeUInt32LE(central.length,12);end.writeUInt32LE(start,16);
    await fh.write(end,0,end.length,position);position+=end.length;
    await fh.truncate(position);
  }finally{await fh.close();}
}
const large=join(temp,'Giant.cbz');await makeLargeCBZ(large);
const mime={'.html':'text/html','.css':'text/css','.js':'text/javascript','.mjs':'text/javascript','.svg':'image/svg+xml','.json':'application/json'};
const server=createServer(async(req,res)=>{try{const parsed=new URL(req.url,'http://localhost');const name=decodeURIComponent(parsed.pathname);const file=resolve(root,'.'+(name.endsWith('/')?name+'index.html':name));if(file!==root&&!file.startsWith(root+sep)){res.writeHead(403).end();return;}
 const data=await readFile(file);res.writeHead(200,{'Content-Type':mime[extname(file)]||'application/octet-stream'}).end(data);
}catch(_){res.writeHead(404).end();}});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
const url=`http://127.0.0.1:${server.address().port}/comic-reader/index.html`;
let browser;
try {
 browser=await chromium.launch(browserLaunchOptions);
 const context=await browser.newContext({viewport:{width:390,height:844}});
 await context.route('https://api.github.com/repos/to-shreds/Misc/contents/cbz?ref=main',route=>route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:'[]'}));
 const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(url);await page.waitForFunction(()=>document.querySelector('#libraryStatus')?.textContent.includes('available on GitHub'));
 await page.locator('#filePicker').setInputFiles(large);
 await page.waitForFunction(()=>document.querySelector('#pageCounter')?.textContent==='1 / 1' && document.querySelector('#pages img')?.naturalWidth>0, null, {timeout:45000});
 assert.equal(await page.locator('#readerTitle').textContent(),'Giant');
 assert.deepEqual(errors,[]);
 console.log('PASS 160 MiB+ local CBZ: seek-only central directory and a single decompressed page');
 await context.close();
}finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));await rm(temp,{recursive:true,force:true});}