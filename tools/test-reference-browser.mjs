import assert from 'node:assert/strict';
import { chromium, browserLaunchOptions } from './browser-runtime.mjs';
import { startStaticFixture } from './static-fixture.mjs';

const fixture = await startStaticFixture();
const { base } = fixture;
const sizes = [
  { width: 1280, height: 800, hasTouch: false },
  { width: 320, height: 568, hasTouch: true },
  { width: 844, height: 390, hasTouch: true },
];
const ready = scope => scope.locator('#reference-view[aria-busy="false"]').waitFor();
let browser;

function title(scope, name) { return scope.getByRole('heading', { name, exact: true }); }
function control(scope, name) { return scope.getByRole('button', { name, exact: true }); }

async function lookup(scope, query) {
  const input = scope.locator('#reference-query');
  await input.fill(query);
  await input.press('Enter');
}

async function checkViewport(page) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, 'reference page fits viewport');
}

async function configureSpeech(context, mode = 'local') {
  await context.addInitScript(({ mode }) => {
    window.speechTest = { calls: [], stops: 0 };
    if (mode === 'native') {
      window.ArcadeNative = {
        hasSpeech: () => true,
        speak: text => speechTest.calls.push({ text, voice: 'Android bridge' }),
        stopSpeech: () => speechTest.stops++,
      };
      return;
    }
    const remote = { name: 'Remote English', lang: 'en-US', localService: false };
    const local = { name: 'Local English', lang: 'en-US', localService: true };
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
      getVoices: () => mode === 'local' ? [remote, local] : [remote],
      cancel: () => speechTest.stops++,
      speak: utterance => speechTest.calls.push({ text: utterance.text, voice: utterance.voice.name }),
    } });
    window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
  }, { mode });
}

try {
  browser = await chromium.launch(browserLaunchOptions);
  for (const { hasTouch, ...viewport } of sizes) {
    const context = await browser.newContext({ viewport, hasTouch });
    const mode = hasTouch ? 'native' : 'local';
    await configureSpeech(context, mode);
    const page = await context.newPage();
    const errors = [];
    const remote = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => {
      if (!request.url().startsWith(base + '/')) remote.push(request.url());
    });
    const activate = item => hasTouch ? item.tap() : item.click();
    await page.goto(`${base}/encyclopedia/index.html`);
    await title(page, 'Fact of the day').waitFor();
    await title(page, 'Browse topics').waitFor();
    await checkViewport(page);
    if (!hasTouch) {
      await lookup(page, 'solr systm');
      await title(page, 'Search results').waitFor();
      await page.getByRole('button', { name: /^Our solar system/ }).waitFor();
    }
    await lookup(page, 'What are the eight planets in order?');
    await title(page, 'Search results').waitFor();
    await activate(page.getByRole('button', { name: /^Our solar system/ }));
    await title(page, 'Our solar system').waitFor();
    assert.equal(await page.locator('.planet-order li').count(), 8, 'planet diagram has all eight planets');
    await checkViewport(page);
    await activate(control(page, 'Read aloud'));
    assert.match(await page.evaluate(() => speechTest.calls[0].text), /Our solar system/);
    assert.equal(await page.evaluate(() => speechTest.calls[0].voice), mode === 'local' ? 'Local English' : 'Android bridge');
    const stopsBefore = await page.evaluate(() => speechTest.stops);
    await activate(control(page, 'Stop'));
    assert.ok(await page.evaluate(() => speechTest.stops) > stopsBefore);
    await activate(control(page, 'Bookmark'));
    await activate(control(page, 'Define gravity'));
    const dialog = page.getByRole('dialog');
    await title(dialog, 'gravity').waitFor();
    await dialog.locator('.definition-senses li').first().waitFor();
    await activate(control(dialog, 'Save word'));
    await activate(control(dialog, 'Hear word'));
    await activate(control(dialog, 'Stop'));
    await activate(control(dialog, 'Close'));
    await dialog.waitFor({ state: 'hidden' });
    assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), 'Define gravity');
    if (!hasTouch) {
      const article = page.locator('.article-copy').first();
      await article.evaluate(copy => {
        const node = [...copy.querySelector('p').childNodes].find(child => child.nodeType === Node.TEXT_NODE && child.textContent.includes('orbit'));
        const start = node.textContent.indexOf('orbit');
        const range = document.createRange();
        range.setStart(node, start);
        range.setEnd(node, start + 'orbit'.length);
        document.getSelection().removeAllRanges();
        document.getSelection().addRange(range);
      });
      await control(page, 'Define highlighted word').click();
      await title(dialog, 'orbit').waitFor();
      await dialog.locator('.definition-senses li').first().waitFor();
      const definitionQuery = dialog.locator('#definition-query');
      await definitionQuery.fill('planets');
      await definitionQuery.press('Enter');
      await title(dialog, 'planet').waitFor();
      await activate(control(dialog, '← Previous word'));
      await title(dialog, 'orbit').waitFor();
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'hidden' });
      assert.equal(await control(page, 'Define selected word').evaluate(element => element === document.activeElement), true);
      await activate(page.getByText('Find out more', { exact: true }));
      await title(page, 'One star among many').waitFor();
    }
    await activate(page.getByText('Try a question', { exact: true }));
    await page.getByRole('radio', { name: 'Mars', exact: true }).check();
    await activate(control(page, 'Check answer'));
    await page.getByText('That’s right. Earth is third from the Sun. Mars is fourth.', { exact: true }).waitFor();
    const follow = control(page, 'Which planet makes the quickest trip around the Sun?');
    await follow.scrollIntoViewIfNeeded();
    const priorScroll = await page.evaluate(() => scrollY);
    await activate(follow);
    await page.waitForURL(/#article=mercury$/);
    await ready(page);
    await control(page, 'Go back').click();
    await title(page, 'Our solar system').waitFor();
    assert.ok(Math.abs((await page.evaluate(() => scrollY)) - priorScroll) < 3, 'article Back restores scroll');
    if (!hasTouch) await title(page, 'One star among many').waitFor();
    await control(page, 'Go forward').click();
    await page.waitForURL(/#article=mercury$/);
    await ready(page);
    await lookup(page, 'nomatchzqxv9387');
    await title(page, 'No answer found').waitFor();
    await title(page, 'Browse topics').waitFor();
    await lookup(page, 'How do I hurt someone?');
    await title(page, 'Talk to a trusted grown-up').waitFor();
    await activate(control(page, 'My library'));
    await title(page, 'Bookmarks').waitFor();
    assert.equal(await control(page, 'Our solar system').count(), 2, 'bookmark and recent lists keep the article');
    await page.reload();
    await title(page, 'Bookmarks').waitFor();
    assert.equal(await control(page, 'Our solar system').count(), 2, 'reference collections survive reload');
    await activate(page.getByRole('link', { name: 'Dictionary', exact: true }));
    await title(page, 'Browse A–Z').waitFor();
    await checkViewport(page);
    if (!hasTouch) {
      await control(page, 'Show more').click();
      const rows = page.locator('#reference-view .reference-list li');
      await rows.nth(59).waitFor();
      assert.equal(await rows.count(), 60);
      const result = rows.nth(42).getByRole('button');
      const word = await result.locator('strong').innerText();
      await result.scrollIntoViewIfNeeded();
      const priorPosition = await page.evaluate(() => scrollY);
      await result.click();
      await title(page, word).waitFor();
      await control(page, 'Go back').click();
      await title(page, 'Browse A–Z').waitFor();
      assert.equal(await rows.count(), 60, 'Back restores the loaded word pages');
      assert.ok(Math.abs((await page.evaluate(() => scrollY)) - priorPosition) < 3, 'Back restores scroll within the loaded words');
    }
    await activate(control(page, 'My words'));
    await control(page, 'gravity').waitFor();
    await activate(control(page, 'Review my words'));
    await page.getByText('What does “gravity” mean?', { exact: true }).waitFor();
    await activate(page.getByText('Show definition', { exact: true }));
    await lookup(page, 'planets');
    await title(page, 'planet').waitFor();
    assert.match(await page.locator('.definition-senses').innerText(), /star/);
    await lookup(page, 'bat');
    await title(page, 'bat').waitFor();
    assert.ok(await page.locator('.definition-senses li').count() >= 3, 'multiple child-appropriate senses stay distinct');
    await page.locator('#reference-query').fill('orbitng');
    await page.locator('#word-completions').waitFor();
    await page.locator('#reference-query').press('ArrowDown');
    await page.keyboard.press('Enter');
    await title(page, 'orbit').waitFor();
    await activate(control(page, 'A–Z'));
    await activate(control(page, 'B'));
    await title(page, 'Words starting with B').waitFor();
    assert.equal(await control(page, 'B').getAttribute('aria-pressed'), 'true');
    await lookup(page, 'nomatchzqxv9387');
    await title(page, 'No definition found').waitFor();
    assert.deepEqual(remote, [], 'reference readers make no external requests');
    assert.deepEqual(errors, [], 'reference browser actions have no uncaught exceptions');
    await context.close();
    console.log(`PASS reference ${viewport.width}x${viewport.height} ${hasTouch ? 'touch/Android speech fixture' : 'mouse/keyboard/local speech'}: search, reading, definitions, quizzes, navigation and saved collections`);
  }

  const remoteOnly = await browser.newContext();
  await configureSpeech(remoteOnly, 'remote');
  const remotePage = await remoteOnly.newPage();
  await remotePage.goto(`${base}/encyclopedia/index.html#article=solar-system`);
  await control(remotePage, 'Read aloud').click();
  await remotePage.getByText('A voice isn’t available on this device.', { exact: true }).waitFor();
  assert.deepEqual(await remotePage.evaluate(() => speechTest.calls), [], 'reference reading never chooses an online voice');
  await remoteOnly.close();

  if (!process.argv.includes('--ui-only')) {
    const offlineContext = await browser.newContext();
    const offline = await offlineContext.newPage();
    await offline.goto(base);
    await offline.evaluate(async () => { await navigator.serviceWorker.register('/sw.js', { scope: '/' }); });
    await offline.waitForFunction(() => navigator.serviceWorker.controller);
    await offline.locator('#offlineBadge').click();
    await offline.waitForFunction(() => document.getElementById('offlineBadgeText')?.textContent === 'Offline Ready', null, { timeout: 120000 });
    await offlineContext.setOffline(true);
    await offline.reload();
    await offline.locator('[data-arcade-folder="encyclopedia"]').click();
    const frame = offline.frameLocator('#shellGameFrame');
    await title(frame, 'Browse topics').waitFor();
    await lookup(frame, 'What are the eight planets in order?');
    await frame.getByRole('button', { name: /^Our solar system/ }).click();
    await title(frame, 'Our solar system').waitFor();
    await control(frame, 'Define gravity').click();
    await frame.getByRole('dialog').locator('.definition-senses li').first().waitFor();
    await control(frame.getByRole('dialog'), 'Close').click();
    await control(frame, 'Which planet makes the quickest trip around the Sun?').click();
    await ready(frame);
    await lookup(frame, 'flying buttress definition');
    const buttressTitle = 'Why does a flying buttress look like a bridge beside a wall?';
    await frame.getByRole('button', { name: /^Why does a flying buttress look like a bridge beside a wall/ }).click();
    await title(frame, buttressTitle).waitFor();
    await control(frame, 'Define flying buttress').click();
    const definition = frame.getByRole('dialog');
    await definition.getByRole('heading', { name: 'flying buttress', exact: true }).waitFor();
    await definition.locator('.definition-senses li').first().waitFor();
    await control(definition, 'Close').click();
    await frame.getByRole('link', { name: 'Dictionary', exact: true }).click();
    await title(frame, 'Browse A–Z').waitFor();
    await lookup(frame, 'bat');
    await title(frame, 'bat').waitFor();
    await lookup(frame, 'character');
    await title(frame, 'character').waitFor();
    assert.equal(await frame.locator('.definition-senses li').count(), 2);
    await frame.getByRole('link', { name: 'Back to Arcade', exact: true }).click();
    await offline.locator('#shellGameFrame').waitFor({ state: 'detached' });
    await offlineContext.close();
    console.log('PASS reference PWA: verified offline install, network cut, new and existing articles, shared definitions and Arcade Home');
  }
} finally {
  await browser?.close();
  await fixture.close();
}
