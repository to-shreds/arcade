// Real Chromium desktop/mobile clients and the deployed Worker implementation.
// Run: CHROMIUM_PATH=/path/to/chromium node tools/test-chat-browser.mjs
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { chromium, browserLaunchOptions } from './browser-runtime.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const out = fileURLToPath(new URL('../test-results/chat-browser/', import.meta.url));
await mkdir(out, { recursive: true });
const fixture = spawn(process.execPath, ['guess-who/test-server.mjs'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
let serverLog = '';
fixture.stdout.on('data', data => { serverLog += data; });
fixture.stderr.on('data', data => { serverLog += data; });
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let browser;
const report = { passed: false, checks: [], errors: [] };

const mapping = () => {
  window.__room = null; window.__session = null; window.__sockets = [];
  const note = data => { if (data?.room) window.__room = data.room; if (data?.token) window.__session = data; };
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input, options) => {
    const mapped = typeof input === 'string' ? input.replace('https://arcade-chess.jonathanjablon.workers.dev', 'http://127.0.0.1:8788') : input;
    const response = await originalFetch(mapped, options);
    if (String(mapped).includes('/api/')) try { note(await response.clone().json()); } catch {}
    return response;
  };
  const NativeWebSocket = window.WebSocket;
  window.WebSocket = class extends NativeWebSocket {
    constructor(url, protocols) {
      const mapped = String(url).replace('wss://arcade-chess.jonathanjablon.workers.dev', 'ws://127.0.0.1:8788');
      if (protocols === undefined) super(mapped); else super(mapped, protocols);
      window.__sockets.push(this);
      this.addEventListener('message', event => { try { note(JSON.parse(event.data)); } catch {} });
    }
  };
};

try {
  for (let attempt = 0; attempt < 100; attempt++) {
    try { if ((await fetch('http://127.0.0.1:8787/chat-room/')).ok) break; } catch {}
    if (fixture.exitCode !== null || attempt === 99) throw new Error('Chat fixture failed: ' + serverLog);
    await wait(100);
  }
  browser = await chromium.launch(browserLaunchOptions);
  const contexts = await Promise.all([{ width: 1440, height: 900 }, { width: 390, height: 844 }].map(viewport => browser.newContext({ viewport, deviceScaleFactor: 1 })));
  const pages = [];
  for (const context of contexts) {
    await context.addInitScript(mapping);
    const page = await context.newPage(); page.setDefaultTimeout(10000);
    page.on('pageerror', error => report.errors.push(String(error)));
    await page.goto('http://127.0.0.1:8787/chat-room/'); pages.push(page);
  }
  const [a, b] = pages;
  await a.locator('#startName').fill('Alice'); await a.locator('#createBtn').click();
  await a.waitForFunction(() => window.__session?.token);
  const code = await a.locator('#roomCode').textContent();
  await b.locator('#startName').fill('Bob'); await b.locator('#joinOpenBtn').click(); await b.locator('#joinCode').fill(code); await b.locator('#joinSubmitBtn').click();
  await a.waitForFunction(() => window.__room?.members.length === 2 && Object.values(window.__room.presence).every(Boolean));
  const source = await a.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 1400; canvas.height = 900;
    const context = canvas.getContext('2d'), image = context.createImageData(canvas.width, canvas.height);
    let seed = 1234567;
    for (let index = 0; index < image.data.length; index += 4) { seed = (Math.imul(seed,1664525)+1013904223) >>> 0; image.data[index] = seed & 255; image.data[index+1] = (seed >>> 8) & 255; image.data[index+2] = (seed >>> 16) & 255; image.data[index+3] = 255; }
    context.putImageData(image,0,0); return canvas.toDataURL('image/png').split(',')[1];
  });
  const upload = { name: 'stress-image.png', mimeType: 'image/png', buffer: Buffer.from(source,'base64') };
  await a.locator('#imageInput').setInputFiles(upload);
  await a.waitForFunction(() => !document.querySelector('#imageDraft').hidden && !document.querySelector('#sendBtn').disabled);
  assert.ok(await a.locator('#draftImage').evaluate(image => image.naturalWidth > 0));
  await a.locator('#removeImageBtn').click(); assert.equal(await a.locator('#imageDraft').evaluate(element => element.hidden), true);
  await a.locator('#imageInput').setInputFiles(upload);
  await a.waitForFunction(() => !document.querySelector('#imageDraft').hidden && !document.querySelector('#sendBtn').disabled);
  const caption = '<img src=x onerror="window.hacked=true"> My picture';
  await a.locator('#messageInput').fill(caption); await a.locator('#sendBtn').click();
  await b.waitForFunction(() => window.__room?.chat.length === 1);
  for (const page of pages) {
    await page.waitForFunction(() => document.querySelector('.chatImage')?.complete && document.querySelector('.chatImage')?.naturalWidth > 0);
    assert.equal(await page.locator('.messageText').textContent(), caption);
    assert.equal(await page.locator('.messageText img').count(), 0);
    assert.equal(await page.evaluate(() => window.hacked), undefined);
  }
  const image = await a.evaluate(() => window.__room.chat[0].image);
  assert.ok(image.dataUrl.length <= 24 * 1024); assert.ok(image.width <= 1280 && image.height <= 1280);
  assert.deepEqual(await a.evaluate(() => window.__room.chat), await b.evaluate(() => window.__room.chat));
  report.checks.push('Real file upload, adaptive compression, preview/remove, caption safety, HTTP authority and WebSocket image delivery');

  await b.locator('.chatImageButton').click(); assert.equal(await b.locator('#imageViewer').isVisible(), true);
  assert.equal(await b.locator('#viewerCaption').textContent(), caption);
  await b.keyboard.press('Escape'); assert.equal(await b.locator('#imageViewer').isVisible(), false);
  assert.equal(await b.locator('.chatImageButton').evaluate(element => document.activeElement === element), true);
  await b.reload(); await b.locator('#resumeBtn').click();
  await b.waitForFunction(() => document.querySelector('.chatImage')?.naturalWidth > 0);
  assert.deepEqual(await a.evaluate(() => window.__room.chat), await b.evaluate(() => window.__room.chat));
  report.checks.push('Full image viewer, Escape/focus restoration, explicit resume and image history after reload');

  await b.locator('#imageInput').setInputFiles({ name: 'pixel.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABQAAAAMCAIAAADtbgqsAAAAGUlEQVR4nGMUOXGHgVzARLbOUc2jmmmuGQALXwHQpdKmfgAAAABJRU5ErkJggg==','base64') });
  await b.waitForFunction(() => !document.querySelector('#imageDraft').hidden && !document.querySelector('#sendBtn').disabled);
  let dropped = false;
  await b.route('http://127.0.0.1:8788/api/arcade/rooms/*/actions', async route => {
    if (!dropped) { dropped = true; await route.fetch(); await route.abort('failed'); } else await route.continue();
  });
  await b.locator('#sendBtn').click(); await a.waitForFunction(() => window.__room?.chat.length === 2);
  await b.waitForFunction(() => !document.querySelector('#sendBtn').disabled);
  assert.equal(await b.locator('#imageDraft').evaluate(element => element.hidden), false, 'dropped response preserves the retry draft');
  await b.locator('#sendBtn').click(); await b.waitForFunction(() => document.querySelector('#imageDraft').hidden);
  assert.equal(await a.evaluate(() => window.__room.chat.length), 2);
  assert.equal(await b.evaluate(() => window.__room.chat[1].text), '');
  assert.deepEqual(await a.evaluate(() => window.__room.chat), await b.evaluate(() => window.__room.chat));
  report.checks.push('Image-only message and a lost HTTP response retry commits exactly one message');

  for (const eventType of ['paste','drop']) {
    await a.evaluate(eventType => {
      const binary=atob('iVBORw0KGgoAAAANSUhEUgAAABQAAAAMCAIAAADtbgqsAAAAGUlEQVR4nGMUOXGHgVzARLbOUc2jmmmuGQALXwHQpdKmfgAAAABJRU5ErkJggg==');
      const file=new File([Uint8Array.from(binary,character=>character.charCodeAt(0))],'pasted.png',{type:'image/png'}),transfer=new DataTransfer(); transfer.items.add(file);
      const event=eventType==='paste'?new ClipboardEvent('paste',{clipboardData:transfer,bubbles:true,cancelable:true}):new DragEvent('drop',{dataTransfer:transfer,bubbles:true,cancelable:true});
      document.querySelector('#messageInput').dispatchEvent(event);
    },eventType);
    await a.waitForFunction(() => !document.querySelector('#imageDraft').hidden && !document.querySelector('#sendBtn').disabled);
    assert.ok(await a.locator('#draftImage').evaluate(image => image.naturalWidth > 0));
    await a.locator('#removeImageBtn').click();
  }
  report.checks.push('Clipboard paste and drag/drop use the same bounded image preparation');

  await b.locator('#imageInput').setInputFiles({ name: 'unsafe.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>') });
  assert.equal(await b.locator('#imageDraft').evaluate(element => element.hidden), true);
  await b.waitForFunction(() => document.querySelector('#toast').textContent.includes('Choose a JPEG'));
  report.checks.push('Unsupported vector input is rejected before decoding');

  for (const [name, page, viewport] of [['desktop',a,{width:1440,height:900}],['mobile',b,{width:390,height:844}],['narrow',a,{width:320,height:568}],['landscape',b,{width:844,height:390}]]) {
    await page.setViewportSize(viewport); await wait(100);
    const diagnostics = await page.evaluate(() => {
      const outside = [...document.querySelectorAll('header button,#composer button,#messageInput')].filter(element => { const box = element.getBoundingClientRect(); return box.width > 0 && (box.left < -1 || box.right > innerWidth+1 || box.bottom > innerHeight+1 || box.top < -1); }).map(element => element.id);
      return { outside, scroll: document.documentElement.scrollWidth, width: innerWidth };
    });
    assert.deepEqual(diagnostics.outside, [], name + ' controls fit the viewport'); assert.ok(diagnostics.scroll <= diagnostics.width+1);
    await page.screenshot({path:out+'/'+name+'.png'});
  }
  report.checks.push('Desktop, mobile, 320 px narrow mobile and landscape controls fit, with rendered images');
  assert.deepEqual(report.errors, []); report.passed = true;
  console.log(JSON.stringify(report,null,2));
} finally {
  await writeFile(out+'/report.json',JSON.stringify(report,null,2));
  await writeFile(out+'/server.log',serverLog);
  if (browser) await browser.close();
  fixture.kill('SIGTERM');
}
