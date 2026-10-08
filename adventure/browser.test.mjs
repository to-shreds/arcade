import assert from 'node:assert/strict';
import { chromium, browserLaunchOptions } from '../tools/browser-runtime.mjs';
import { startStaticFixture } from '../tools/static-fixture.mjs';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const fixture = await startStaticFixture();
let browser;
const viewports = [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
  { width: 320, height: 568 },
  { width: 844, height: 390 },
];
const normalize = text => text.replace(/\s+/g, ' ').trim();

async function inspectPage(page, viewport) {
  const check = await page.evaluate(() => {
    const debug = __LOGAN_CYOA_DEBUG__;
    const snap = debug.engine.snapshot();
    const pages = debug.engine.pagination();
    const source = __LOGAN_ADVENTURE__.textLines(debug.story[snap.nodeId], snap.state);
    const text = document.getElementById('storyText');
    const rects = [...document.querySelectorAll('#homeButton,#backButton,#restartButton,#readButton,.choice')].map(el => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
    });
    return {
      source, pages, nodeId: snap.nodeId, rects,
      copyHeight: text.clientHeight, contentHeight: text.scrollHeight,
      copyWidth: text.clientWidth, contentWidth: text.scrollWidth,
      pageHeight: document.documentElement.scrollHeight,
      pageWidth: document.documentElement.scrollWidth,
      choicesReady: !document.getElementById('choices').classList.contains('waiting'),
    };
  });
  for (const words of check.pages.pages) assert(words.join(' ').trim().split(/\s+/).length <= 70, 'Each reading page stays within 70 words');
  assert.equal(normalize(check.pages.pages.flat().join(' ')), normalize(check.source.join(' ')), 'Pagination preserves every word in order');
  assert(check.copyHeight > 0, 'Text has usable screen space');
  assert(check.contentHeight <= check.copyHeight + 1, `${check.nodeId} text fits vertically`);
  assert(check.contentWidth <= check.copyWidth + 1, `${check.nodeId} text fits horizontally`);
  assert(check.pageWidth <= viewport.width + 1 && check.pageHeight <= viewport.height + 1, 'The document does not need scrolling');
  assert.equal(check.choicesReady, check.pages.pageIndex === check.pages.pages.length - 1, 'Only the last text page enables choices');
  for (const r of check.rects) assert(r.width > 0 && r.height > 0 && r.x >= -1 && r.y >= -1 && r.right <= viewport.width + 1 && r.bottom <= viewport.height + 1, 'All reading/choice controls fit the screen');
  return check;
}

try {
  browser = await chromium.launch(browserLaunchOptions);
  await mkdir('test-results/adventure', { recursive: true });
  for (const viewport of viewports) {
    const page = await browser.newPage({ viewport });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${fixture.base}/adventure/index.html`);
    await page.waitForFunction(() => Boolean(globalThis.__LOGAN_CYOA_DEBUG__?.engine.isReady()));
    let decisions = 0;
    while (true) {
      const before = await page.evaluate(() => __LOGAN_CYOA_DEBUG__.engine.snapshot());
      let check = await inspectPage(page, viewport);
      if (check.pages.pages.length > 1 && check.pages.pageIndex === 0) {
        await page.keyboard.press('1');
        assert.equal(await page.evaluate(() => __LOGAN_CYOA_DEBUG__.engine.snapshot().nodeId), before.nodeId, 'Keyboard choices cannot skip unread pages');
      }
      while (check.pages.pageIndex < check.pages.pages.length - 1) {
        await page.locator('#nextPageButton').click();
        check = await inspectPage(page, viewport);
      }
      const ending = await page.evaluate(() => __LOGAN_CYOA_DEBUG__.story[__LOGAN_CYOA_DEBUG__.engine.snapshot().nodeId].ending === true);
      if (ending) break;
      const choice = decisions % await page.locator('#choices .choice').count();
      await page.locator('#choices .choice').nth(choice).click();
      const after = await page.evaluate(() => __LOGAN_CYOA_DEBUG__.engine.snapshot());
      assert.notEqual(after.nodeId, before.nodeId, 'A choice advances the story');
      await page.locator('#backButton').click();
      assert.deepEqual(await page.evaluate(() => __LOGAN_CYOA_DEBUG__.engine.snapshot()), before, 'Back restores the exact recipe, state, and decision history');
      let redo = await inspectPage(page, viewport);
      while (redo.pages.pageIndex < redo.pages.pages.length - 1) {
        await page.locator('#nextPageButton').click();
        redo = await inspectPage(page, viewport);
      }
      await page.locator('#choices .choice').nth(choice).click();
      assert.deepEqual(await page.evaluate(() => __LOGAN_CYOA_DEBUG__.engine.snapshot()), after, 'Replaying the same choice keeps deterministic text/state');
      decisions++;
      assert(decisions <= 30, 'Route completes within thirty decisions');
    }
    assert.equal(decisions, 30);
    await page.screenshot({ path: `test-results/adventure/${viewport.width}x${viewport.height}.png` });
    const oldRecipe = await page.evaluate(() => __LOGAN_CYOA_DEBUG__.engine.snapshot().state.director.recipeSignature);
    await page.locator('#restartButton').click();
    if (await page.locator('#confirmRestartButton').isVisible()) await page.locator('#confirmRestartButton').click();
    const restarted = await page.evaluate(() => __LOGAN_CYOA_DEBUG__.engine.snapshot());
    assert.equal(restarted.nodeId, 'opening');
    assert.equal(restarted.history.length, 0);
    assert.notEqual(restarted.state.director.recipeSignature, oldRecipe, 'Restart gets a fresh recipe');
    assert.deepEqual(errors, []);
    await page.close();
    console.log(`PASS: ${viewport.width}x${viewport.height} complete story, text fit, choices, exact Back, deterministic replay, Restart`);
  }

  const speech = await browser.newPage({ viewport: { width: 320, height: 568 } });
  await speech.addInitScript(() => {
    globalThis.__speech = { calls: [], cancelled: 0, active: null };
    Object.defineProperty(globalThis, 'speechSynthesis', { value: {
      cancel() { __speech.cancelled++; __speech.active = null; },
      speak(utterance) { __speech.calls.push(utterance.text); __speech.active = utterance; },
    } });
    globalThis.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
  });
  await speech.goto(`${fixture.base}/adventure/index.html`);
  await speech.waitForFunction(() => __LOGAN_CYOA_DEBUG__.engine.isReady());
  await speech.locator('#readButton').click();
  assert.equal(await speech.locator('#readButton').getAttribute('aria-pressed'), 'true');
  await speech.evaluate(() => {
    while (__speech.active) { const active = __speech.active; __speech.active = null; active.onend(); }
  });
  const narrated = await speech.evaluate(() => ({ pagination: __LOGAN_CYOA_DEBUG__.engine.pagination(), calls: __speech.calls }));
  assert.equal(narrated.calls.length, narrated.pagination.pages.length, 'Narration advances through every text page');
  assert.equal(narrated.pagination.pageIndex, narrated.pagination.pages.length - 1);
  assert.equal(await speech.locator('#readButton').getAttribute('aria-pressed'), 'false');
  for (const event of ['pagehide', 'visibilitychange', 'pause']) {
    await speech.locator('#readButton').click();
    await speech.evaluate(event => {
      if (event === 'visibilitychange') {
        Object.defineProperty(document, 'hidden', { configurable: true, value: true });
        document.dispatchEvent(new Event(event));
        Object.defineProperty(document, 'hidden', { configurable: true, value: false });
      } else if (event === 'pause') {
        window.dispatchEvent(new MessageEvent('message', { source: window.parent, origin: location.origin, data: { scope: 'arcade-shell', version: 1, type: 'pause' } }));
      } else window.dispatchEvent(new Event(event));
    }, event);
    assert.equal(await speech.locator('#readButton').getAttribute('aria-pressed'), 'false', `${event} stops narration`);
    assert.equal(await speech.evaluate(() => __speech.active), null);
  }
  await speech.locator('#readButton').click();
  await speech.setViewportSize({ width: 844, height: 390 });
  await speech.waitForFunction(() => document.getElementById('readButton').getAttribute('aria-pressed') === 'false');
  await inspectPage(speech, { width: 844, height: 390 });
  await speech.close();
  console.log('PASS: narration page advance, shell pause, pagehide, hidden tab, and responsive repagination');

  const offline = await browser.newPage();
  await offline.addInitScript(() => {
    Object.defineProperty(globalThis, 'localStorage', { get() { throw new Error('blocked storage'); } });
    Object.defineProperty(globalThis, 'sessionStorage', { get() { throw new Error('blocked storage'); } });
    Object.defineProperty(globalThis, 'speechSynthesis', { value: undefined });
    globalThis.SpeechSynthesisUtterance = undefined;
  });
  await offline.goto(`file://${fileURLToPath(new URL('index.html', import.meta.url))}`);
  await offline.waitForFunction(() => __LOGAN_CYOA_DEBUG__.engine.isReady());
  assert.equal(await offline.evaluate(() => __LOGAN_CYOA_DEBUG__.engine.snapshot().nodeId), 'opening');
  assert((await offline.locator('#sceneTitle').textContent()).length > 0, 'The first scene has a rendered title');
  assert(await offline.locator('#readButton').isDisabled(), 'Reading works without speech support');
  await offline.locator('#restartButton').click();
  if (await offline.locator('#confirmRestartButton').isVisible()) await offline.locator('#confirmRestartButton').click();
  assert.equal(await offline.evaluate(() => __LOGAN_CYOA_DEBUG__.engine.snapshot().nodeId), 'opening');
  await offline.close();
  console.log('PASS: directly opened offline HTML, blocked storage, and unavailable speech');
} finally {
  await browser?.close();
  await fixture.close();
}
