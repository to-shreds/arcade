import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {chromium, browserLaunchOptions} from './browser-runtime.mjs';
import {startStaticFixture} from './static-fixture.mjs';

const fixture = await startStaticFixture();
const catalogPath = 'reference/packs/catalog.json';
const source = async name => JSON.parse(await readFile(new URL(`../${name}`, import.meta.url), 'utf8'));
const baseline = await source('offline-manifest.json');
const catalog = await source(catalogPath);
const nextCatalog = Buffer.from(JSON.stringify({...catalog, offlineUpdateProbe: true}));
const badCatalog = Buffer.from(nextCatalog);
badCatalog[0] ^= 1;
const next = structuredClone(baseline);
next.version += '.update-fixture';
const file = next.files.find(entry => entry.path === catalogPath);
next.totalBytes += nextCatalog.length - file.bytes;
file.bytes = nextCatalog.length;
file.sha256 = createHash('sha256').update(nextCatalog).digest('hex');

let release = 'original';
let candidateRequests = 0;
const proxy = createServer(async (request, response) => {
  try {
    const {pathname} = new URL(request.url, fixture.base);
    if (release !== 'original' && pathname === '/offline-manifest.json') {
      response.writeHead(200, {'content-type': 'application/json', 'cache-control': 'no-store'});
      return response.end(JSON.stringify(next));
    }
    if (release !== 'original' && pathname === '/' + catalogPath) {
      candidateRequests++;
      response.writeHead(200, {'content-type': 'application/json', 'cache-control': 'no-store'});
      return response.end(release === 'broken' ? badCatalog : nextCatalog);
    }
    const source = await fetch(fixture.base + request.url, {headers: request.headers.range ? {range: request.headers.range} : {}});
    response.writeHead(source.status, Object.fromEntries(source.headers));
    response.end(Buffer.from(await source.arrayBuffer()));
  } catch {
    if (!response.headersSent) response.writeHead(502);
    response.end();
  }
});

let browser;
try {
  await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${proxy.address().port}`;
  browser = await chromium.launch(browserLaunchOptions);
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(base);
  await page.evaluate(() => navigator.serviceWorker.register('/sw.js'));
  await page.waitForFunction(() => navigator.serviceWorker.controller);
  const update = phase => page.evaluate(({phase}) => new Promise((resolve, reject) => {
    const controller = navigator.serviceWorker.controller;
    const timer = setTimeout(() => reject(Error('Offline update was not reported')), 110000);
    function onMessage({data}) {
      if (data.type !== 'ARCADE_OFFLINE_PROGRESS' || data.phase !== phase) return;
      clearTimeout(timer);
      navigator.serviceWorker.removeEventListener('message', onMessage);
      resolve(data);
    }
    navigator.serviceWorker.addEventListener('message', onMessage);
    controller.postMessage({type: 'ARCADE_PREPARE_OFFLINE'});
  }), {phase});
  assert.equal((await update('ready')).version, baseline.version);
  const articleURL = base + '/encyclopedia/index.html#article=solar-system';
  await page.goto(articleURL);
  await page.getByRole('button', {name: 'Bookmark', exact: true}).click();

  release = 'broken';
  const rejected = await update('error');
  assert.equal(rejected.version, baseline.version);
  assert.equal(rejected.ready, true);
  assert.match(rejected.error, /reference\/packs\/catalog\.json: integrity check failed/);
  assert.ok(candidateRequests > 0);
  await context.setOffline(true);
  await page.reload();
  await page.getByRole('heading', {name: 'Our solar system', exact: true}).waitFor();
  await page.getByRole('button', {name: 'Remove bookmark', exact: true}).waitFor();
  const catalogProbe = () => fetch('/reference/packs/catalog.json').then(response => response.json());
  assert.equal((await page.evaluate(catalogProbe)).offlineUpdateProbe, undefined);

  await context.setOffline(false);
  release = 'repaired';
  assert.equal((await update('ready')).version, next.version);
  await context.setOffline(true);
  await page.reload();
  await page.getByRole('button', {name: 'Remove bookmark', exact: true}).waitFor();
  assert.equal((await page.evaluate(catalogProbe)).offlineUpdateProbe, true);
  await page.getByRole('button', {name: 'Define gravity', exact: true}).click();
  await page.getByRole('dialog').locator('.definition-senses li').first().waitFor();
  console.log('PASS Chromium offline update: same-length corruption rejected, previous snapshot and bookmark preserved, verified retry and offline definitions passed');
} finally {
  await browser?.close();
  proxy.closeAllConnections();
  await new Promise(resolve => proxy.close(resolve));
  await fixture.close();
}
