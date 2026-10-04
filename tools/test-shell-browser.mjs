#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
import { chromium, browserLaunchOptions } from './browser-runtime.mjs';
const port = 8791;
const base = `http://127.0.0.1:${port}`;
const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: root, stdio: 'ignore' });
let browser;
try {
  for (let attempt = 0; ; attempt++) {
    try { if ((await fetch(base)).ok) break; } catch {}
    if (attempt === 100) throw new Error('Static fixture failed to start');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  browser = await chromium.launch(browserLaunchOptions);
  const catalog = JSON.parse(await readFile(new URL('../catalog.json', import.meta.url)));
  const available = catalog.items.filter(item => item.enabled && !item.warning);
  await mkdir(new URL('../test-results/shell', import.meta.url), { recursive: true });
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 320, height: 568 }, { width: 844, height: 390 }]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base);
    await page.waitForFunction(count => document.querySelectorAll('.card').length === count && window.ArcadeShell, available.length);
    assert.equal(await page.locator('.card').count(), available.length);
    assert.equal(await page.locator('.card').filter({ hasText: 'Backyard Baseball' }).count(), 0);
    await page.locator('[data-filter="activity"]').click();
    assert.equal(await page.locator('.card').count(), available.filter(item => item.type === 'activity').length);
    await page.locator('[data-filter="all"]').click();
    await page.locator('#category').selectOption('word');
    assert.equal(await page.locator('.card').count(), available.filter(item => item.categories.includes('word')).length);
    await page.locator('#category').selectOption('');
    await page.locator('.card').filter({ hasText: /^.*Tic Tac Toe.*$/ }).click();
    await page.waitForFunction(() => document.querySelector('#shellGameFrame')?.src.includes('/tic-tac-toe/'));
    assert.match(page.url(), /game=tic-tac-toe/);
    const shellIdentity = await page.evaluate(() => { window.__testedShellSession = ArcadeShell; return !!window.__testedShellSession; });
    assert.equal(shellIdentity, true);
    await page.goBack();
    await page.waitForFunction(() => !document.querySelector('#shellGameFrame'));
    await page.goForward();
    await page.waitForFunction(() => document.querySelector('#shellGameFrame')?.src.includes('/tic-tac-toe/'));
    assert.equal(await page.evaluate(() => ArcadeShell === window.__testedShellSession), true);
    await page.evaluate(() => ArcadeShell.goHome());
    await page.waitForFunction(() => !document.querySelector('#shellGameFrame'));
    await page.locator('#manage').click();
    await page.locator('#arcadeSettingsOverlay').waitFor({ state: 'visible' });
    assert.equal(await page.locator('.app').evaluate(element => element.inert), true);
    await page.keyboard.press('Escape');
    await page.locator('#arcadeSettingsOverlay').waitFor({ state: 'hidden' });
    assert.equal(await page.locator('.app').evaluate(element => element.inert), false);
    assert.deepEqual(errors, []);
    await page.screenshot({ path: `${root}/test-results/shell/${viewport.width}x${viewport.height}.png` });
    console.log(`Shell ${viewport.width}x${viewport.height}: catalog, filters, launch, Back/Forward, persistent session, settings, Escape passed.`);
    await context.close();
  }
  const offlineContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const offlinePage = await offlineContext.newPage();
  const offlineErrors = [];
  offlinePage.on('pageerror', error => offlineErrors.push(error.message));
  await offlinePage.goto(base);
  // Production registers automatically on GitHub Pages. This fixture runs at localhost.
  await offlinePage.evaluate(async () => { await navigator.serviceWorker.register('/sw.js', { scope: '/' }); });
  await offlinePage.waitForFunction(() => navigator.serviceWorker.controller);
  await offlinePage.locator('#offlineBadge').click();
  await offlinePage.waitForFunction(() => document.getElementById('offlineBadgeText')?.textContent === 'Offline Ready', null, { timeout: 120000 });
  await offlineContext.setOffline(true);
  await offlinePage.reload();
  await offlinePage.waitForFunction(count => document.querySelectorAll('.card').length === count && window.ArcadeShell, available.length);
  await offlinePage.evaluate(() => ArcadeShell.openGame('paint-lab'));
  const offlineFrame = offlinePage.frameLocator('#shellGameFrame');
  await offlineFrame.locator('#shared-launch').waitFor({ state: 'visible' });
  assert.equal(await offlineFrame.locator('canvas').count() > 0, true);
  await offlinePage.evaluate(() => ArcadeShell.goHome());
  await offlinePage.waitForFunction(() => !document.querySelector('#shellGameFrame'));
  assert.deepEqual(offlineErrors, []);
  console.log('PWA: complete verified offline snapshot, offline reload, all catalog tiles, shared activity scripts, Paint canvas, and Home passed.');
  await offlineContext.close();
} catch (error) {
  if (browser) {
    for (const [contextIndex, context] of browser.contexts().entries()) {
      for (const [pageIndex, page] of context.pages().entries()) {
        try {
          await page.screenshot({ path: `${root}/test-results/shell/failure-${contextIndex}-${pageIndex}.png` });
          console.error(JSON.stringify({ url: page.url(), frames: await Promise.all(page.frames().map(frame => frame.evaluate(() => ({ url: location.href, title: document.title, shared: !!window.ArcadeSharedActivity, launch: document.getElementById('shared-launch')?.outerHTML, body: document.body?.innerText.slice(0, 300) })))) }));
        } catch {}
      }
    }
  }
  throw error;
} finally {
  await browser?.close();
  server.kill();
}
