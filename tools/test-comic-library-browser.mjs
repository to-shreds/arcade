#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, browserLaunchOptions } from './browser-runtime.mjs';

const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const mime = {'.html':'text/html','.css':'text/css','.js':'text/javascript','.mjs':'text/javascript','.svg':'image/svg+xml','.json':'application/json'};
const errors=[];

function crc32(bytes) {
  let crc=0xFFFFFFFF;
  for(const byte of bytes){ crc ^= byte; for(let bit=0;bit<8;bit++)crc=(crc>>>1)^(-(crc&1)&0xEDB88320); }
  return (crc^0xFFFFFFFF)>>>0;
}
function createCBZ(names) {
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAFElEQVR4nGN827qCARtgwio6aCUAp3gCKi6ts+sAAAAASUVORK5CYII=','base64');
  const locals=[],centrals=[];let offset=0;
  for(const name of names){
    const filename=Buffer.from(name,'utf8'),bytes=png,crc=crc32(bytes);
    const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50,0);local.writeUInt16LE(20,4);local.writeUInt16LE(0,6);local.writeUInt16LE(0,8);
    local.writeUInt32LE(crc,14);local.writeUInt32LE(bytes.length,18);local.writeUInt32LE(bytes.length,22);local.writeUInt16LE(filename.length,26);
    locals.push(local,filename,bytes);
    const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50,0);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt32LE(crc,16);
    central.writeUInt32LE(bytes.length,20);central.writeUInt32LE(bytes.length,24);central.writeUInt16LE(filename.length,28);central.writeUInt32LE(offset,42);
    centrals.push(central,filename);offset+=local.length+filename.length+bytes.length;
  }
  const directory=Buffer.concat(centrals),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);
  end.writeUInt16LE(names.length,8);end.writeUInt16LE(names.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...locals,directory,end]);
}
function createPDF() {
  const objects=new Map();
  objects.set(1,'<< /Type /Catalog /Pages 2 0 R >>');
  objects.set(2,'<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>');
  objects.set(7,'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  for(let n=0;n<2;n++){
    const pageId=3+n*2,contentId=4+n*2;
    objects.set(pageId,`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 360 520] /Resources << /Font << /F1 7 0 R >> >> /Contents ${contentId} 0 R >>`);
    const stream=`BT /F1 26 Tf 70 350 Td (Page ${n+1}) Tj ET\n`;
    objects.set(contentId,`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`);
  }
  let content='%PDF-1.4\n';const offsets=[0];
  for(let n=1;n<=7;n++){offsets[n]=Buffer.byteLength(content);content+=`${n} 0 obj\n${objects.get(n)}\nendobj\n`;}
  const start=Buffer.byteLength(content);
  content+='xref\n0 8\n0000000000 65535 f \n';
  for(let n=1;n<=7;n++)content+=String(offsets[n]).padStart(10,'0')+' 00000 n \n';
  content+=`trailer\n<< /Size 8 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  return Buffer.from(content,'utf8');
}
const cbz=createCBZ(['pages/001.png','pages/002.png','pages/010.png','__MACOSX/001.png']);
const pdf=createPDF();
const listing=[{name:'Sample.cbz',path:'cbz/Sample.cbz',type:'file',download_url:'https://raw.githubusercontent.com/to-shreds/Misc/main/cbz/Sample.cbz',size:cbz.length,sha:'test1'},
  {name:'Sample.pdf',path:'cbz/Sample.pdf',type:'file',download_url:'https://raw.githubusercontent.com/to-shreds/Misc/main/cbz/Sample.pdf',size:pdf.length,sha:'test2'}];
const server=createServer(async(request,response)=>{
 try{
   const path=decodeURIComponent(new URL(request.url,'http://localhost').pathname);
   const file=resolve(root,'.'+(path.endsWith('/')?path+'index.html':path));
   if(file!==root&&!file.startsWith(root+sep)){response.writeHead(403).end();return;}
   const bytes=await readFile(file);
   response.writeHead(200,{'Content-Type':mime[extname(file)]||'application/octet-stream','Cache-Control':'no-store'}).end(bytes);
 }catch(e){response.writeHead(404).end('Not found');}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url=`http://127.0.0.1:${server.address().port}/comic-reader/index.html`;
let browser;
try {
 browser=await chromium.launch(browserLaunchOptions);
 for(const viewport of [{width:390,height:844},{width:844,height:390},{width:320,height:568},{width:1280,height:800}]){
   const context=await browser.newContext({viewport,hasTouch:true});
   await context.route('https://api.github.com/repos/to-shreds/Misc/contents/cbz?ref=main',route=>route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify(listing)}));
   await context.route('https://raw.githubusercontent.com/to-shreds/Misc/main/cbz/Sample.cbz',route=>route.fulfill({status:200,contentType:'application/zip',headers:{'access-control-allow-origin':'*'},body:cbz}));
   await context.route('https://raw.githubusercontent.com/to-shreds/Misc/main/cbz/Sample.pdf',route=>route.fulfill({status:200,contentType:'application/pdf',headers:{'access-control-allow-origin':'*'},body:pdf}));
   const page=await context.newPage();
   page.on('pageerror',e=>errors.push(`${viewport.width}x${viewport.height}: ${e.message}`));
   await page.goto(url);
   await page.waitForFunction(()=>document.querySelectorAll('#books .book').length===2);
   assert.ok(await page.locator('body').evaluate(el=>el.scrollWidth<=innerWidth+1),'no body overflow');
   await page.getByRole('button',{name:'Open Sample',exact:false}).first().click();
   await page.waitForFunction(()=>document.querySelector('#pageCounter').textContent==='1 / 3'&&document.querySelector('#pages img')?.naturalWidth>0);
   await page.locator('#nextPage').click();
   await page.waitForFunction(()=>document.querySelector('#pageCounter').textContent==='2 / 3');
   await page.locator('#menuBtn').click();await page.locator('#bookmarkBtn').click();
   assert.equal(await page.locator('#bookmarkBtn').innerText(),'Remove bookmark');
   await page.locator('#showBookmarks').click();assert.equal(await page.locator('#bookmarksList button').innerText(),'Page 2');
   await page.locator('#closeBookmarks').click();await page.locator('#backShelf').click();
   await page.locator('#books .book').filter({hasText:'PDF'}).click();
   await page.waitForFunction(()=>document.querySelector('#pageCounter').textContent==='1 / 2'&&document.querySelector('#pages img')?.naturalWidth>0);
   await page.locator('#nextPage').click();await page.waitForFunction(()=>document.querySelector('#pageCounter').textContent==='2 / 2');
   await page.locator('#backShelf').click();
   await page.locator('#filePicker').setInputFiles({name:'Local.cbz',mimeType:'application/zip',buffer:cbz});
   await page.waitForFunction(()=>document.querySelector('#readerTitle').textContent==='Local'&&document.querySelector('#pageCounter').textContent==='1 / 3');
   await page.locator('#menuBtn').click();await page.locator('#keepOffline').click();
   await page.waitForFunction(()=>!document.querySelector('#removeOffline').hidden);
   await page.locator('#closeMenu').click();await page.locator('#backShelf').click();
   await page.waitForFunction(()=>document.querySelectorAll('#books .book').length===3);
   assert.deepEqual(errors,[],'no uncaught JS exceptions');
   await context.close();
   console.log(`PASS Comic Library ${viewport.width}x${viewport.height}: CBZ, real PDF.js, library, bookmarks, local file, offline save`);
 }
} finally { if(browser)await browser.close(); await new Promise(resolve=>server.close(resolve)); }