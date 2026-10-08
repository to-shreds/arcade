import assert from 'node:assert/strict';
import { chromium, browserLaunchOptions } from '../tools/browser-runtime.mjs';
import { startStaticFixture } from '../tools/static-fixture.mjs';
import { mkdir, writeFile } from 'node:fs/promises';

const fixture = await startStaticFixture();
const SAVE_KEY = 'logan.operationGiggle.progress.v1';
const results = [];
const failures = [];
let browser;
const errorsFor = new WeakMap();

async function test(name, run) {
  try { await run(); results.push({ name, passed: true }); console.log(`PASS: ${name}`); }
  catch (error) { failures.push(error); results.push({ name, passed: false, error: error.stack }); console.error(`FAIL: ${name}\n${error.stack}`); }
}

async function openPage({ viewport = { width: 390, height: 844 }, init, initArg } = {}) {
  const page = await browser.newPage({ viewport });
  page.setDefaultTimeout(10000);
  const errors = [];
  errorsFor.set(page, errors);
  page.on('pageerror', error => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  if (init) await page.addInitScript(init, initArg);
  await page.goto(`${fixture.base}/adventure/index.html`);
  await page.waitForFunction(() => typeof globalThis.__LOGAN_CYOA_DEBUG__?.engine.captureSave === 'function');
  await page.waitForFunction(() => __LOGAN_CYOA_DEBUG__.engine.isReady());
  return page;
}

async function assertNoErrors(page) {
  assert.deepEqual(errorsFor.get(page), [], 'No uncaught browser errors');
}

async function snapshot(page) {
  return page.evaluate(() => __LOGAN_CYOA_DEBUG__.engine.snapshot());
}

async function captured(page) {
  return page.evaluate(() => __LOGAN_CYOA_DEBUG__.engine.captureSave());
}

async function reading(page) {
  return page.evaluate(() => ({
    pages: __LOGAN_CYOA_DEBUG__.engine.pagination(),
    text: document.getElementById('storyText').textContent,
    title: document.getElementById('sceneTitle').textContent,
    anchor: __LOGAN_CYOA_DEBUG__.engine.pageAnchor(),
  }));
}

async function lastPage(page) {
  while (await page.evaluate(() => {
    const p = __LOGAN_CYOA_DEBUG__.engine.pagination();
    return p.pageIndex < p.pages.length - 1;
  })) await page.locator('#nextPageButton').click();
}

async function choose(page, index) {
  await lastPage(page);
  const before = await snapshot(page);
  const count = await page.locator('#choices .choice').count();
  await page.locator('#choices .choice').nth(index % count).click();
  await page.waitForFunction(old => __LOGAN_CYOA_DEBUG__.engine.snapshot().nodeId !== old, before.nodeId);
  return { before, index: index % count, after: await snapshot(page) };
}

async function savedLocally(page) {
  const reference = await captured(page);
  await page.waitForFunction(({ key, reference }) => {
    const save = JSON.parse(localStorage.getItem(key) || 'null');
    return save && JSON.stringify(save.state) === JSON.stringify(reference.state) &&
      JSON.stringify(save.history) === JSON.stringify(reference.history) && save.nodeId === reference.nodeId &&
      JSON.stringify(save.pageAnchor) === JSON.stringify(reference.pageAnchor);
  }, { key: SAVE_KEY, reference });
  return reference;
}

async function continueAfterReload(page) {
  await page.reload();
  await page.locator('#resumeDialog').waitFor({ state: 'visible' });
  assert.equal(await page.locator('.arcade-save-layer:not([hidden])').count(), 0, 'Only one Continue prompt appears');
  await page.locator('#continueButton').click();
  await page.locator('#resumeDialog').waitFor({ state: 'hidden' });
}

try {
  browser = await chromium.launch(browserLaunchOptions);
  await mkdir('test-results/adventure-save', { recursive: true });
  await test('automatic saves retain exact choices, inventory, Back history, recipe and reading page after reload', async () => {
    const page = await openPage();
    const transitions = [];
    for (let step = 0; step < 18; step++) {
      const current = await snapshot(page);
      if (step >= 8 && current.state.items.length > 0) break;
      const itemChoice = await page.evaluate(() => {
        const snap = __LOGAN_CYOA_DEBUG__.engine.snapshot();
        const choices = __LOGAN_ADVENTURE__.availableChoices(__LOGAN_CYOA_DEBUG__.story[snap.nodeId], snap.state);
        return choices.findIndex(choice => choice.effect?.addItems?.length > 0);
      });
      transitions.push(await choose(page, itemChoice >= 0 ? itemChoice : step % 3));
    }
    await lastPage(page);
    const before = await snapshot(page);
    const beforeReading = await reading(page);
    assert(before.history.length >= 8, 'This is actual progress, not an opening recipe');
    assert(before.state.storyPath.length >= 8, 'Decisions are recorded');
    assert(before.state.items.length > 0, 'The route has collected an item before the persistence test');
    const local = await savedLocally(page);
    assert.equal(local.nodeId, before.nodeId);
    await continueAfterReload(page);
    assert.deepEqual(await snapshot(page), before, 'Continue restores exact state, inventory, recipe and complete Back history');
    assert.deepEqual(await reading(page), beforeReading, 'Continue restores the current title, text and page');
    await page.locator('#backButton').click();
    const previous = before.history.at(-1);
    assert.deepEqual(await snapshot(page), { nodeId: previous.nodeId, state: previous.state, history: before.history.slice(0, -1) });
    await savedLocally(page);
    await continueAfterReload(page);
    assert.deepEqual(await snapshot(page), { nodeId: previous.nodeId, state: previous.state, history: before.history.slice(0, -1) }, 'Back changes the saved progress as well');
    await choose(page, transitions.at(-1).index);
    assert.deepEqual(await snapshot(page), before, 'The same choice after Back restores the same deterministic story state');
    await assertNoErrors(page);
    await page.screenshot({ path: 'test-results/adventure-save/continued-mobile.png' });
    await page.close();
  });

  await test('page changes and responsive reflow save the reading place without losing any story words', async () => {
    const page = await openPage({ viewport: { width: 320, height: 568 } });
    let found = false;
    for (let step = 0; step < 12; step++) {
      const pages = (await reading(page)).pages;
      if (pages.pages.length > 1) { found = true; break; }
      await choose(page, step % 3);
    }
    assert(found, 'A real scene spans multiple pages on a small phone');
    await page.locator('#nextPageButton').click();
    const before = await reading(page);
    assert(before.pages.pageIndex > 0);
    await savedLocally(page);
    await continueAfterReload(page);
    assert.deepEqual(await reading(page), before, 'Reload preserves a page selected with Next');
    const words = before.pages.pages.flat().join(' ').trim().split(/\s+/);
    const oldOffset = before.pages.pages.slice(0, before.pages.pageIndex).flat().join(' ').trim().split(/\s+/).filter(Boolean).length;
    await page.setViewportSize({ width: 844, height: 390 });
    await page.waitForFunction(() => document.getElementById('storyText').clientWidth > 500);
    const after = await reading(page);
    assert.deepEqual(after.pages.pages.flat().join(' ').trim().split(/\s+/), words, 'Reflow preserves every word in order');
    const offsets = after.pages.pages.map((_, index) => after.pages.pages.slice(0, index).flat().join(' ').trim().split(/\s+/).filter(Boolean).length);
    const expectedPage = offsets.findLastIndex(offset => offset <= oldOffset);
    assert.equal(after.pages.pageIndex, expectedPage, 'Reflow follows the current word anchor instead of the old numeric page');
    const fit = await page.evaluate(() => {
      const text = document.getElementById('storyText');
      return { h: text.clientHeight, content: text.scrollHeight, w: text.clientWidth, contentWidth: text.scrollWidth };
    });
    assert(fit.content <= fit.h + 1 && fit.contentWidth <= fit.w + 1, 'The resumed story still fits the viewport');
    await savedLocally(page);
    await continueAfterReload(page);
    assert.deepEqual(await reading(page), after, 'The reflowed page persists after a second reload');
    await assertNoErrors(page);
    await page.close();
  });

  await test('Restart and New Adventure require confirmation before replacing a saved route', async () => {
    const page = await openPage();
    for (let step = 0; step < 3; step++) await choose(page, step);
    const original = await snapshot(page);
    await savedLocally(page);
    await page.locator('#restartButton').click();
    await page.locator('#restartDialog').waitFor({ state: 'visible' });
    await page.locator('#cancelRestartButton').click();
    assert.deepEqual(await snapshot(page), original, 'Cancelling Restart preserves current progress');
    await continueAfterReload(page);
    assert.deepEqual(await snapshot(page), original, 'Cancelling Restart preserves the saved route');
    await page.reload();
    await page.locator('#resumeDialog').waitFor({ state: 'visible' });
    await page.locator('#newAdventureButton').click();
    await page.locator('#restartDialog').waitFor({ state: 'visible' });
    await page.locator('#cancelRestartButton').click();
    await page.locator('#resumeDialog').waitFor({ state: 'visible' });
    await page.locator('#continueButton').click();
    assert.deepEqual(await snapshot(page), original, 'Cancelling New Adventure returns to the existing Continue choice');
    await page.locator('#restartButton').click();
    await page.locator('#confirmRestartButton').click();
    const restarted = await snapshot(page);
    assert.equal(restarted.nodeId, 'opening');
    assert.equal(restarted.history.length, 0);
    assert.notEqual(restarted.state.director.recipeSignature, original.state.director.recipeSignature);
    await assertNoErrors(page);
    await page.close();
  });

  await test('ArcadeSave capture and restore survive JSON export with the full route and reading page', async () => {
    const page = await openPage();
    for (let step = 0; step < 5; step++) await choose(page, step);
    await lastPage(page);
    const before = await snapshot(page);
    const beforeReading = await reading(page);
    const json = await page.evaluate(() => {
      const adapter = ArcadeSave.getAdapter();
      if (!adapter || adapter.id !== 'adventure') throw new Error('Adventure must register with ArcadeSave');
      return JSON.stringify(adapter.capture());
    });
    await choose(page, 0);
    assert.notEqual((await snapshot(page)).nodeId, before.nodeId);
    assert.equal(await page.evaluate(json => ArcadeSave.getAdapter().restore(JSON.parse(json)), json), true);
    assert.deepEqual(await snapshot(page), before);
    assert.deepEqual(await reading(page), beforeReading);
    const invalid = JSON.parse(json);
    invalid.storyVersion = 'old-story-version';
    assert.equal(await page.evaluate(data => {
      try { return ArcadeSave.getAdapter().restore(data); }
      catch (_) { return false; }
    }, invalid), false);
    assert.deepEqual(await snapshot(page), before, 'An incompatible imported save cannot replace the current route');
    await assertNoErrors(page);
    await page.close();
  });

  await test('a real IndexedDB-only Arcade save offers Continue and restores the complete route', async () => {
    const page = await openPage();
    for (let step = 0; step < 4; step++) await choose(page, step);
    await lastPage(page);
    const before = await snapshot(page);
    const beforeReading = await reading(page);
    assert.equal(await page.evaluate(() => __LOGAN_CYOA_DEBUG__.engine.save()), true);
    const idbEntry = await page.evaluate(() => new Promise((resolve, reject) => {
      const request = indexedDB.open('arcade-autosaves', 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const read = db.transaction('saves', 'readonly').objectStore('saves').get('adventure');
        read.onsuccess = () => { db.close(); resolve(read.result); };
        read.onerror = () => { db.close(); reject(read.error); };
      };
    }));
    assert.equal(idbEntry.id, 'adventure');
    assert.deepEqual(idbEntry.data.state, before.state, 'IndexedDB contains full story state, not just a replay recipe');
    assert.deepEqual(idbEntry.data.history, before.history);
    assert.equal(idbEntry.data.nodeId, before.nodeId);
    await page.evaluate(key => {
      localStorage.removeItem(key);
      localStorage.removeItem('arcade.autosave.data.v1.adventure');
    }, SAVE_KEY);
    await continueAfterReload(page);
    assert.deepEqual(await snapshot(page), before, 'Continue restores the save even after its own localStorage copy is removed');
    assert.deepEqual(await reading(page), beforeReading);
    await assertNoErrors(page);
    await page.close();
  });

  await test('waiting at Continue cannot overwrite saved progress with a new opening', async () => {
    const page = await openPage();
    for (let step = 0; step < 3; step++) await choose(page, step);
    const before = await snapshot(page);
    const saved = await savedLocally(page);
    await page.reload();
    await page.locator('#resumeDialog').waitFor({ state: 'visible' });
    await page.keyboard.press('1');
    await page.keyboard.press('ArrowRight');
    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    const stillSaved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), SAVE_KEY);
    const { savedAt: previousTime, ...savedRoute } = saved;
    const { savedAt: pendingTime, ...pendingRoute } = stillSaved;
    assert.deepEqual(pendingRoute, savedRoute, 'Keyboard, page events and shared autosave cannot erase pending progress');
    assert(pendingTime >= previousTime - 100, 'The saved route remains a current progress record');
    await page.reload();
    await page.locator('#continueButton').click();
    assert.deepEqual(await snapshot(page), before);
    await assertNoErrors(page);
    await page.close();
  });

  await test('a complete thirty-decision adventure resumes its ending and still supports exact Back', async () => {
    const page = await openPage();
    for (let step = 0; step < 30; step++) await choose(page, step);
    await lastPage(page);
    const ending = await snapshot(page);
    assert.equal(ending.history.length, 30);
    assert.equal(await page.evaluate(() => __LOGAN_CYOA_DEBUG__.story[__LOGAN_CYOA_DEBUG__.engine.snapshot().nodeId].ending), true);
    const endingText = await reading(page);
    await savedLocally(page);
    await continueAfterReload(page);
    assert.deepEqual(await snapshot(page), ending);
    assert.deepEqual(await reading(page), endingText);
    await page.locator('#backButton').click();
    const previous = ending.history.at(-1);
    assert.deepEqual(await snapshot(page), { nodeId: previous.nodeId, state: previous.state, history: ending.history.slice(0, -1) });
    await assertNoErrors(page);
    await page.close();
  });

  await test('malformed, old-version and inconsistent saves cannot revive invented progress', async () => {
    const source = await openPage();
    await choose(source, 1);
    const valid = await captured(source);
    await source.close();
    const cases = [
      { name: 'invalid JSON', value: '{broken' },
      { name: 'wrong schema', value: JSON.stringify({ ...valid, schema: 99 }) },
      { name: 'old story version', value: JSON.stringify({ ...valid, storyVersion: 'legacy-story-v0' }) },
      { name: 'unknown scene', value: JSON.stringify({ ...valid, nodeId: 'missing_scene' }) },
      { name: 'missing Back history', value: JSON.stringify({ ...valid, history: [] }) },
      { name: 'invented inventory', value: JSON.stringify({ ...valid, state: { ...valid.state, items: ['invented-secret-tool'] } }) },
    ];
    for (const item of cases) {
      const page = await openPage({ init: ({ key, value }) => localStorage.setItem(key, value), initArg: { key: SAVE_KEY, value: item.value } });
      assert.equal((await snapshot(page)).nodeId, 'opening', `${item.name} starts safely at the opening`);
      assert.equal(await page.locator('#resumeDialog').isVisible(), false, `${item.name} cannot offer Continue`);
      await choose(page, 0);
      assert.equal((await snapshot(page)).history.length, 1, `${item.name} does not stop a fresh adventure`);
      await assertNoErrors(page);
      await page.close();
    }
  });

  await test('blocked persistent storage keeps play available and never reports a successful save', async () => {
    const page = await openPage({ init: () => {
      Object.defineProperty(globalThis, 'localStorage', { get() { throw new Error('Storage is blocked'); } });
      Object.defineProperty(globalThis, 'sessionStorage', { get() { throw new Error('Storage is blocked'); } });
      Object.defineProperty(globalThis, 'indexedDB', { get() { throw new Error('Storage is blocked'); } });
    } });
    await choose(page, 0);
    await page.locator('#saveButton').click();
    await page.waitForFunction(() => /unavailable|could not|cannot|not saved|blocked/i.test(document.getElementById('saveStatus').textContent));
    assert.doesNotMatch(await page.locator('#saveStatus').textContent(), /^saved\b/i, 'The save label must not claim that blocked storage persisted anything');
    await page.reload();
    assert.equal((await snapshot(page)).nodeId, 'opening');
    assert.equal(await page.locator('#resumeDialog').isVisible(), false);
    await assertNoErrors(page);
    await page.close();
  });

  await test('Home saves the current route and stops active narration before leaving', async () => {
    const page = await openPage({ init: () => {
      globalThis.__speech = { active: null, cancelled: 0 };
      Object.defineProperty(globalThis, 'speechSynthesis', { value: {
        cancel() { __speech.cancelled++; __speech.active = null; globalThis.__recordCancel?.(); },
        speak(utterance) { __speech.active = utterance; },
      } });
      globalThis.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
    } });
    let cancelled = 0;
    await page.exposeFunction('__recordCancel', () => { cancelled++; });
    await choose(page, 2);
    const before = await snapshot(page);
    await page.locator('#readButton').click();
    assert.equal(await page.locator('#readButton').getAttribute('aria-pressed'), 'true');
    const beforeCancel = cancelled;
    await page.locator('#homeButton').click();
    await page.waitForURL(`${fixture.base}/index.html`);
    assert(cancelled > beforeCancel, 'Home cancels the active utterance');
    await page.goto(`${fixture.base}/adventure/index.html`);
    await page.locator('#continueButton').click();
    assert.deepEqual(await snapshot(page), before, 'Home persists progress before removing the story frame');
    assert.equal(await page.locator('#readButton').getAttribute('aria-pressed'), 'false');
    await assertNoErrors(page);
    await page.close();
  });
} finally {
  await writeFile('test-results/adventure-save/summary.json', JSON.stringify(results, null, 2));
  await browser?.close();
  await fixture.close();
}
if (failures.length) throw new AggregateError(failures, `${failures.length} Adventure save browser checks failed`);
