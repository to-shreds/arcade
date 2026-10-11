#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, browserLaunchOptions } from './browser-runtime.mjs';

const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const output = resolve(root, 'test-results/catalog');
const catalog = JSON.parse(await readFile(resolve(root, 'catalog.json'), 'utf8'));
const available = catalog.items.filter(item => item.enabled && !item.warning);
const byFolder = new Map(available.map(item => [item.folder, item]));
const alpha = items => [...items].sort((a, b) => a.title.localeCompare(b.title, 'en', { sensitivity: 'base', numeric: true }) || a.folder.localeCompare(b.folder));
const titles = items => items.map(item => item.title);
const recentKey = 'arcade.recent.v1';
const results = [];
const errors = [];
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.wasm': 'application/wasm' };

// Bind an unused port so this test can run beside the existing browser suites.
const server = createServer(async (request, response) => {
  try {
    const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const file = resolve(root, '.' + (path.endsWith('/') ? path + 'index.html' : path));
    if (file !== root && !file.startsWith(root + sep)) { response.writeHead(403).end(); return; }
    const contents = await readFile(file);
    response.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    response.end(contents);
  } catch { response.writeHead(404).end('Not found'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
await mkdir(output, { recursive: true });
let browser;

async function pageIn(context, label, suffix = '/') {
  const page = await context.newPage();
  page.on('pageerror', error => errors.push({ label, url: page.url(), message: error.message }));
  await page.goto(base + suffix);
  await page.waitForFunction(() => window.ArcadeShell && Array.isArray(window.ArcadeCatalogItems) && document.querySelector('#search') && !document.querySelector('#grid.loading'));
  return page;
}
async function shown(page) { return page.locator('#grid .card .name').allTextContents(); }
async function expectShown(page, expected, label) {
  await page.waitForFunction(expected => JSON.stringify([...document.querySelectorAll('#grid .card .name')].map(node => node.textContent)) === JSON.stringify(expected), expected);
  assert.deepEqual(await shown(page), expected, label);
}
async function history(page) { return page.evaluate(key => JSON.parse(localStorage.getItem(key) || '[]'), recentKey); }
async function expectHistory(page, expected, label) {
  await page.waitForFunction(({ key, expected }) => localStorage.getItem(key) === JSON.stringify(expected), { key: recentKey, expected });
  assert.deepEqual(await history(page), expected, label);
}
async function home(page) {
  await page.evaluate(() => ArcadeShell.goHome());
  await page.waitForFunction(() => !document.querySelector('#shellGameFrame') && !new URL(location.href).searchParams.has('game'));
}
async function open(page, folder) {
  assert.equal(await page.evaluate(folder => ArcadeShell.openGame(folder), folder), true, `shell opens ${folder}`);
  await page.waitForFunction(folder => document.querySelector('#shellGameFrame')?.src.includes('/' + folder + '/'), folder);
}
function matches(query) {
  const needle = query.trim().toLowerCase();
  return available.filter(item => [item.title, ...(item.categories || [])].join(' ').toLowerCase().includes(needle));
}

try {
  browser = await chromium.launch(browserLaunchOptions);
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 320, height: 568 }, { width: 844, height: 390 }]) {
    const label = `${viewport.width}x${viewport.height}`;
    const context = await browser.newContext({ viewport });
    const page = await pageIn(context, label);
    assert.equal(await page.locator('#sort').inputValue(), 'alpha', 'first visit defaults to A-Z');
    await expectShown(page, titles(alpha(available)), 'enabled catalog is alphabetical');
    assert.equal(await page.locator('#grid .card').filter({ hasText: 'Backyard Baseball' }).count(), 0, 'disabled game is excluded');

    const layout = await page.evaluate(() => {
      const bounds = element => { const r = element.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; };
      return {
        width: innerWidth, height: innerHeight,
        documentWidth: document.documentElement.scrollWidth,
        bodyWidth: document.body.scrollWidth,
        filters: bounds(document.querySelector('.filters')),
        browse: bounds(document.querySelector('.browse')),
        grid: bounds(document.getElementById('grid')),
        gridScrollWidth: document.getElementById('grid').scrollWidth,
        gridClientWidth: document.getElementById('grid').clientWidth,
        controls: ['search', 'clearSearch', 'sort', 'playerFilter', 'category'].map(id => ({ id, ...bounds(document.getElementById(id)) })),
      };
    });
    assert.ok(layout.documentWidth <= viewport.width + 1 && layout.bodyWidth <= viewport.width + 1, `${label} has no page horizontal overflow`);
    assert.ok(layout.browse.top >= layout.filters.bottom - 1, `${label} search and ordering controls do not overlap filters`);
    assert.ok(layout.grid.top >= layout.browse.bottom - 1, `${label} activity grid does not overlap search and ordering controls`);
    assert.ok(layout.grid.top >= Math.max(...layout.controls.map(control => control.bottom)) - 1, `${label} activity grid starts below every visible control`);
    assert.ok(layout.grid.width > 0 && layout.grid.height >= 100 && layout.grid.bottom <= viewport.height + 1, `${label} retains a usable on-screen activity grid`);
    assert.ok(layout.gridScrollWidth <= layout.gridClientWidth + 1, `${label} grid has no horizontal overflow`);
    for (const control of layout.controls) {
      // Clear is allowed to be hidden until there is a query.
      if (control.id === 'clearSearch' && !control.width) continue;
      assert.ok(control.width > 0 && control.left >= -1 && control.right <= viewport.width + 1 && control.top >= -1 && control.bottom <= viewport.height + 1, `${label} ${control.id} fits the screen`);
    }
    await page.screenshot({ path: resolve(output, `${label}.png`) });

    // Real keystrokes verify that rerendering cards leaves the input focused.
    await page.locator('#search').focus();
    let query = '';
    for (const character of 'mAtH') {
      query += character;
      await page.keyboard.type(character);
      await expectShown(page, titles(alpha(matches(query))), `live query ${query}`);
      assert.equal(await page.evaluate(() => document.activeElement.id), 'search', 'live search keeps keyboard focus');
    }
    await page.locator('#search').fill('  gUeSs wHo  ');
    await expectShown(page, ['Guess Who'], 'search trims spaces and ignores case');
    await page.locator('#clearSearch').click();
    assert.equal(await page.locator('#search').inputValue(), '', 'clear empties the query');
    await expectShown(page, titles(alpha(available)), 'clear restores catalog');
    await page.locator('#search').fill('CREATIVE');
    await expectShown(page, titles(alpha(matches('creative'))), 'search matches category names');
    await page.locator('[data-filter="activity"]').click();
    await expectShown(page, titles(alpha(matches('creative').filter(item => item.type === 'activity'))), 'Activities intersects search');
    await page.locator('#category').selectOption('word');
    const creativeWords = matches('creative').filter(item => item.type === 'activity' && item.categories.includes('word'));
    await expectShown(page, titles(alpha(creativeWords)), 'category intersects type and search');
    await page.locator('#clearSearch').click();
    await expectShown(page, titles(alpha(available.filter(item => item.type === 'activity' && item.categories.includes('word')))), 'clearing search retains other filters');
    await page.locator('[data-filter="all"]').click();
    await page.locator('[data-filter="game"]').click();
    await page.locator('#search').fill('BOARD');
    await page.locator('#playerFilter').click();
    await expectShown(page, titles(alpha(matches('board').filter(item => item.type === 'game' && item.playersMin <= 1 && item.playersMax >= 1))), 'Games and one-player intersect category search');
    await page.locator('#playerFilter').click();
    await expectShown(page, titles(alpha(matches('board').filter(item => item.type === 'game' && Math.max(item.playersMax, item.onlinePlayersMax || 0) >= 2))), 'two-player filter intersects search');
    await page.locator('#search').fill('no such activity 987654321');
    assert.equal(await page.locator('#grid .empty').innerText(), 'No matches', 'unmatched query has clear feedback');
    assert.equal(await page.locator('#grid .card').count(), 0);
    await page.locator('[data-filter="all"]').click();
    await page.locator('#clearSearch').click();
    await page.locator('#sort').selectOption('recent');
    assert.equal(await page.locator('#grid .empty').innerText(), 'No recently used activities yet', 'fresh device explains empty Recent');
    await page.locator('#search').fill('paint');
    assert.equal(await page.locator('#grid .empty').innerText(), 'No matches', 'filtered Recent uses no-matches feedback');
    results.push({ check: 'catalog, search, composed filters, empty history, responsive layout', viewport, layout, status: 'passed' });
    await context.close();
    console.log(`PASS catalog ${label}: A-Z, live title/category search, filters, clear, empty states, focus, layout.`);
  }

  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await pageIn(context, 'recency');
  await open(page, 'paint-lab');
  await expectHistory(page, ['paint-lab'], 'direct shell launch is recorded');
  await home(page);
  await page.locator('#search').fill('Tic Tac Toe');
  await page.locator('#grid .card').click();
  await page.waitForFunction(() => document.querySelector('#shellGameFrame')?.src.includes('/tic-tac-toe/'));
  await expectHistory(page, ['tic-tac-toe', 'paint-lab'], 'tile launch moves newest to front');
  await home(page);
  await page.waitForFunction(() => document.activeElement?.dataset.arcadeFolder === 'tic-tac-toe');
  assert.equal(await page.evaluate(() => document.activeElement.isConnected), true, 'Home restores focus to the replacement tile after catalog rerender');
  assert.equal(await page.locator('#search').inputValue(), 'Tic Tac Toe', 'Home preserves current search');
  await page.locator('#sort').selectOption('recent');
  await expectShown(page, ['Tic Tac Toe'], 'Recent also intersects search');
  await page.locator('#clearSearch').click();
  await expectShown(page, ['Tic Tac Toe', 'Paint Lab'], 'Recent shows launch order rather than alphabetic order');
  await open(page, 'paint-lab');
  await expectHistory(page, ['paint-lab', 'tic-tac-toe'], 'reopening deduplicates and moves entry to front');
  await home(page);
  await expectShown(page, ['Paint Lab', 'Tic Tac Toe'], 'Home refreshes Recent without reloading');
  const sequence = ['time', 'math', 'maze', 'patterns', 'spelling', 'memory', 'balloons', 'hangman', 'jigsaw', 'codebreaking', 'regex-lab', 'tic-tac-toe'];
  let expected = ['paint-lab', 'tic-tac-toe'];
  for (const folder of sequence) {
    await open(page, folder);
    expected = [folder, ...expected.filter(value => value !== folder)].slice(0, 10);
    await expectHistory(page, expected, `${folder} updates bounded history`);
    await home(page);
  }
  assert.equal(expected.length, 10);
  await expectShown(page, titles(expected.map(folder => byFolder.get(folder))), 'only the last 10 distinct launches are displayed');
  await open(page, 'hangman');
  expected = ['hangman', ...expected.filter(folder => folder !== 'hangman')];
  await expectHistory(page, expected, 'reopening one of ten stays at ten');
  assert.equal(new Set(expected).size, 10);
  await home(page);
  const beforeInvalid = await history(page);
  assert.equal(await page.evaluate(() => ArcadeShell.openGame('not-an-activity')), false);
  assert.equal(await page.evaluate(() => ArcadeShell.openGame('baseball')), false);
  assert.deepEqual(await history(page), beforeInvalid, 'unavailable launch does not enter Recent');
  await page.reload();
  await page.waitForFunction(() => window.ArcadeShell && !document.querySelector('#grid.loading'));
  assert.equal(await page.locator('#sort').inputValue(), 'alpha', 'reload starts in A-Z');
  await page.locator('#sort').selectOption('recent');
  await expectShown(page, titles(expected.map(folder => byFolder.get(folder))), 'history survives a real page reload');
  const sibling = await pageIn(context, 'same-device-tab');
  await open(sibling, 'paint-lab');
  expected = ['paint-lab', ...expected.filter(folder => folder !== 'paint-lab')].slice(0, 10);
  await expectHistory(sibling, expected, 'same-device second tab records its launch');
  await expectShown(page, titles(expected.map(folder => byFolder.get(folder))), 'storage event updates Recent in another tab on the same device');
  await sibling.close();
  const isolated = await browser.newContext();
  const isolatedPage = await pageIn(isolated, 'isolation');
  await isolatedPage.locator('#sort').selectOption('recent');
  assert.equal(await isolatedPage.locator('#grid .card').count(), 0, 'another browser storage partition has no history');
  assert.equal(await isolatedPage.locator('#grid .empty').innerText(), 'No recently used activities yet');
  await isolated.close();
  results.push({ check: 'real tile and shell launches, Home, deduplication, 10-item bound, reload, same-device tabs and storage isolation', folders: expected, status: 'passed' });
  await context.close();
  console.log('PASS Recent: real launches, Home, search intersection, newest first, unique last 10, reload, isolation, invalid launch rejection.');

  const deepContext = await browser.newContext();
  const deepPage = await pageIn(deepContext, 'deep-link', '/?game=paint-lab');
  await deepPage.waitForFunction(() => document.querySelector('#shellGameFrame')?.src.includes('/paint-lab/'));
  await expectHistory(deepPage, ['paint-lab'], 'deep-link launch records activity');
  await home(deepPage);
  await deepPage.locator('#sort').selectOption('recent');
  await expectShown(deepPage, ['Paint Lab'], 'deep-linked activity appears on Home');
  results.push({ check: 'deep-link launch and Home', status: 'passed' });
  await deepContext.close();

  for (const [label, value] of [['invalid-json', '{not json'], ['wrong-type', '{"folder":"paint-lab"}'], ['invalid-entries', JSON.stringify(['not-a-game', 'baseball', null, 17, 'paint-lab', 'paint-lab', 'math'])]]) {
    const fixture = await browser.newContext();
    await fixture.addInitScript(({ key, value }) => {
      if (window.top === window && !sessionStorage.getItem('catalog-history-seeded')) {
        localStorage.setItem(key, value);
        sessionStorage.setItem('catalog-history-seeded', '1');
      }
    }, { key: recentKey, value });
    const fixturePage = await pageIn(fixture, label);
    await fixturePage.locator('#sort').selectOption('recent');
    await expectShown(fixturePage, label === 'invalid-entries' ? ['Paint Lab', 'Math'] : [], `${label} is handled safely`);
    if (label !== 'invalid-entries') assert.equal(await fixturePage.locator('#grid .empty').innerText(), 'No recently used activities yet');
    await open(fixturePage, 'tic-tac-toe');
    await expectHistory(fixturePage, label === 'invalid-entries' ? ['tic-tac-toe', 'paint-lab', 'math'] : ['tic-tac-toe'], 'valid launch replaces malformed history with validated folders');
    await home(fixturePage);
    results.push({ check: label, status: 'passed' });
    await fixture.close();
  }

  const denied = await browser.newContext();
  await denied.addInitScript(key => {
    const get = Storage.prototype.getItem;
    const set = Storage.prototype.setItem;
    Storage.prototype.getItem = function(value) { if (value === key) throw new DOMException('Storage denied', 'SecurityError'); return get.call(this, value); };
    Storage.prototype.setItem = function(value, data) { if (value === key) throw new DOMException('Storage denied', 'SecurityError'); return set.call(this, value, data); };
  }, recentKey);
  const deniedPage = await pageIn(denied, 'denied-storage');
  await deniedPage.locator('#search').fill('paint');
  await expectShown(deniedPage, ['Paint Lab'], 'search remains usable with history storage denied');
  await deniedPage.locator('#grid .card').click();
  await deniedPage.waitForFunction(() => document.querySelector('#shellGameFrame')?.src.includes('/paint-lab/'));
  await home(deniedPage);
  await deniedPage.locator('#clearSearch').click();
  await deniedPage.locator('#sort').selectOption('recent');
  await expectShown(deniedPage, ['Paint Lab'], 'in-memory Recent remains usable when persistence is denied');
  await deniedPage.reload();
  await deniedPage.waitForFunction(() => window.ArcadeShell && !document.querySelector('#grid.loading'));
  await deniedPage.locator('#sort').selectOption('recent');
  assert.equal(await deniedPage.locator('#grid .card').count(), 0, 'denied persistence does not pretend to survive reload');
  results.push({ check: 'denied recent storage: search, launch, session history, reload', status: 'passed' });
  await denied.close();

  // A legacy wrapper can still launch directly through the native bridge.
  const nativeContext = await browser.newContext();
  await nativeContext.route('**/arcade-shell.js', route => route.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
  await nativeContext.addInitScript(() => {
    window.__nativeLaunches = [];
    window.ArcadeNative = { arcadeReady() {}, openGameWithOrientation(path, orientation) { window.__nativeLaunches.push({ path, orientation }); } };
  });
  const nativePage = await nativeContext.newPage();
  nativePage.on('pageerror', error => errors.push({ label: 'legacy-native', message: error.message }));
  await nativePage.goto(base);
  await nativePage.waitForFunction(() => document.querySelector('#search') && !document.querySelector('#grid.loading'));
  await nativePage.locator('#search').fill('paint');
  await nativePage.locator('#grid .card').click();
  assert.deepEqual(await nativePage.evaluate(() => window.__nativeLaunches), [{ path: 'paint-lab/index.html', orientation: 'any' }]);
  await expectHistory(nativePage, ['paint-lab'], 'legacy native launch records Recent');
  results.push({ check: 'legacy native bridge launch records history', status: 'passed' });
  await nativeContext.close();

  assert.deepEqual(errors, [], 'catalog flows have no browser JavaScript errors');
  await writeFile(resolve(output, 'report.json'), JSON.stringify({ results, errors }, null, 2) + '\n');
  console.log(`PASS ${results.length} catalog scenarios; no browser JavaScript errors. Evidence: test-results/catalog/report.json`);
} catch (error) {
  if (browser) for (const [contextIndex, context] of browser.contexts().entries()) for (const [pageIndex, page] of context.pages().entries()) {
    try { await page.screenshot({ path: resolve(output, `failure-${contextIndex}-${pageIndex}.png`) }); } catch {}
  }
  await writeFile(resolve(output, 'report.json'), JSON.stringify({ results, errors, failure: error.stack || String(error) }, null, 2) + '\n');
  throw error;
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
