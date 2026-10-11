import assert from 'node:assert/strict';
import { chromium, browserLaunchOptions } from './browser-runtime.mjs';
import { startStaticFixture } from './static-fixture.mjs';

const fixture = await startStaticFixture();
let browser;
const normalize = text => text.replace(/\s+/g, ' ').trim();

async function speechPage(activity, mode) {
  const page = await browser.newPage({ viewport: { width: 320, height: 568 } });
  await page.addInitScript(({ mode }) => {
    globalThis.__speech = { calls: [], stops: 0, active: null, events: [], alerts: [], ready: false };
    window.alert = text => __speech.alerts.push(text);
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: mode === 'browser' ? {
      cancel() { __speech.stops++; __speech.active = null; },
      resume() {},
      getVoices() { return [{ lang: 'en-US', name: 'fixture voice' }]; },
      speak(utterance) { __speech.calls.push(utterance.text); __speech.active = utterance; }
    } : undefined });
    globalThis.SpeechSynthesisUtterance = mode === 'browser' ? class { constructor(text) { this.text = text; } } : undefined;
    if (mode === 'native' || mode === 'native-events') {
      globalThis.ArcadeNative = {
        // The presence of a bridge still allows a request during asynchronous TTS initialization.
        hasSpeech() { return __speech.ready; },
        speak(text) { __speech.calls.push(text); },
        stopSpeech() { __speech.stops++; }
      };
      if (mode === 'native-events') ArcadeNative.speakWithId = (text, rate, pitch, id) => {
        __speech.calls.push(text); __speech.events.push({ text, rate, pitch, id }); __speech.active = id;
      };
    }
    globalThis.__completeSpeech = () => {
      if (typeof __speech.active === 'string') {
        const id = __speech.active; __speech.active = null;
        window.dispatchEvent(new CustomEvent('arcade-native-speech', { detail: { id, type: 'end' } }));
      } else if (__speech.active) {
        const utterance = __speech.active; __speech.active = null; utterance.onend();
      }
    };
  }, { mode });
  await page.goto(`${fixture.base}/${activity}/`);
  if (activity === 'mad-libs') {
    await page.waitForFunction(() => !!window.MadLibsAutosave);
    await page.evaluate(() => MadLibsAutosave.restore({ storyIndex: 0,
      values: Array.from({ length: 18 }, (_, index) => ['Logan', 'Scarlett'][index % 2]), screen: 'result' }));
  } else await page.waitForFunction(() => __LOGAN_CYOA_DEBUG__.engine.isReady());
  return page;
}

try {
  browser = await chromium.launch(browserLaunchOptions);
  for (const mode of ['browser', 'native', 'native-events']) {
    const mad = await speechPage('mad-libs', mode);
    const output = normalize(await mad.locator('#storyOutput').textContent());
    await mad.locator('#speakButton').click();
    assert.equal(await mad.locator('#speakButton').textContent(), '■ Stop Reading');
    if (mode === 'native') {
      assert.deepEqual(await mad.evaluate(() => __speech.calls), [output], 'Existing APK receives a whole normal story once');
      assert.equal(await mad.evaluate(() => __speech.alerts.length), 0, 'Initializing native TTS is not reported unsupported');
    } else {
      await mad.evaluate(() => { for (let i = 0; __speech.active && i < 100; i++) __completeSpeech(); });
      assert.equal(normalize((await mad.evaluate(() => __speech.calls)).join(' ')), output, 'Every word is narrated without truncation');
      assert.equal(await mad.locator('#speakButton').textContent(), '🔊 Read It Aloud', 'Completion restores the reading control');
    }
    if ((await mad.locator('#speakButton').textContent()).includes('Stop')) await mad.locator('#speakButton').click();
    if (mode === 'browser') {
      await mad.locator('#speakButton').click();
      await mad.evaluate(() => { window.__lateUtterance = __speech.active; });
      await mad.locator('#editWordsButton').click();
      await mad.evaluate(() => __lateUtterance.onend());
      assert.equal(await mad.evaluate(() => __speech.active), null, 'Canceled onend does not restart old text');
      await mad.locator('#makeStoryButton').click();
      await mad.locator('#speakButton').click();
      await mad.evaluate(() => __speech.active.onerror({ error: 'voice-unavailable' }));
      assert.equal(await mad.locator('#speakButton').textContent(), '🔊 Read It Aloud');
      assert.match(await mad.evaluate(() => __speech.alerts.at(-1)), /text-to-speech voice/);
    }
    await mad.locator('#speakButton').click();
    const stops = await mad.evaluate(() => __speech.stops);
    await mad.evaluate(() => window.dispatchEvent(new MessageEvent('message', { source: window.parent, origin: location.origin,
      data: { scope: 'arcade-shell', version: 1, type: 'pause' } })));
    assert.equal(await mad.locator('#speakButton').textContent(), '🔊 Read It Aloud', 'Shell pause resets the reading control');
    assert((await mad.evaluate(() => __speech.stops)) > stops, 'Shell pause cancels the speech engine');
    if (mode === 'native') {
      await mad.evaluate(() => MadLibsAutosave.restore({ storyIndex: 0, screen: 'result', values: Array(18).fill('X'.repeat(120)) }));
      const before = await mad.evaluate(() => __speech.calls.length);
      await mad.locator('#speakButton').click();
      assert.equal(await mad.evaluate(() => __speech.calls.length), before, 'Old APK cannot silently truncate a long story');
      assert.match(await mad.evaluate(() => __speech.alerts.at(-1)), /2,000 characters/);
      await mad.evaluate(() => MadLibsAutosave.restore({ storyIndex: 0, screen: 'result', values: Array(18).fill('Logan') }));
      await mad.locator('#speakButton').click();
      await mad.waitForFunction(() => __speech.alerts.at(-1)?.includes('text-to-speech voice'), null, { timeout: 7000 });
      assert.equal(await mad.locator('#speakButton').textContent(), '🔊 Read It Aloud', 'A missing Android voice is reported instead of queuing forever');
      assert.equal(await mad.evaluate(() => __speech.active), null);
      // Installing a voice while initialization completes lets the original queued request continue.
      await mad.locator('#speakButton').click();
      await mad.evaluate(() => { __speech.ready = true; });
      await mad.waitForTimeout(5100);
      assert.equal(await mad.locator('#speakButton').textContent(), '■ Stop Reading');
      await mad.locator('#speakButton').click();
    }
    await mad.close();

    const adventure = await speechPage('adventure', mode);
    assert.equal(await adventure.locator('#readButton').isDisabled(), false, `${mode} enables Adventure narration`);
    await adventure.locator('#readButton').click();
    if (mode === 'native') {
      assert.equal(await adventure.evaluate(() => __speech.calls.length), 1, 'Old APK reads the current page without flushing earlier chunks');
      assert((await adventure.evaluate(() => __speech.calls[0].length)) <= 2000);
      assert.equal(await adventure.evaluate(() => __LOGAN_CYOA_DEBUG__.engine.pagination().pageIndex), 0, 'Legacy native mode does not fake completion or page progress');
      await adventure.locator('#readButton').click();
    } else {
      await adventure.evaluate(() => { for (let i = 0; __speech.active && i < 100; i++) __completeSpeech(); });
      const pages = await adventure.evaluate(() => __LOGAN_CYOA_DEBUG__.engine.pagination());
      assert.equal(pages.pageIndex, pages.pages.length - 1, 'Narration advances through all Adventure pages');
      assert.equal(await adventure.locator('#readButton').getAttribute('aria-pressed'), 'false');
      if (mode === 'native-events') {
        await adventure.locator('#readButton').click();
        await adventure.evaluate(() => {
          const id = __speech.active;
          window.dispatchEvent(new CustomEvent('arcade-native-speech', { detail: { id, type: 'error' } }));
        });
        assert.equal(await adventure.locator('#readButton').getAttribute('aria-pressed'), 'false');
        assert.match(await adventure.evaluate(() => __speech.alerts.at(-1)), /text-to-speech voice/);
      }
    }
    await adventure.locator('#readButton').click();
    await adventure.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    assert.equal(await adventure.locator('#readButton').getAttribute('aria-pressed'), 'false', 'Leaving Adventure cancels narration');
    await adventure.close();
    console.log(`PASS narration ${mode}: whole story, Stop, cancellation, failures, and Adventure page behavior`);
  }
  const unavailable = await speechPage('mad-libs', 'unavailable');
  await unavailable.locator('#speakButton').click();
  assert.match(await unavailable.evaluate(() => __speech.alerts.at(-1)), /Arcade Android app/);
  assert.equal(await unavailable.locator('#speakButton').textContent(), '🔊 Read It Aloud');
  await unavailable.close();
  console.log('PASS narration unavailable: clear recovery message, no stuck reading control');
  const shell = await speechPage('mad-libs', 'native');
  await shell.evaluate(() => { ArcadeSave.setExternalSession(true); return ArcadeSave.clear(); });
  await shell.goto(fixture.base);
  await shell.waitForFunction(() => !!window.ArcadeShell);
  await shell.evaluate(() => ArcadeShell.openGame('mad-libs'));
  const frame = shell.frameLocator('#shellGameFrame');
  await frame.locator('#randomStoryButton').waitFor();
  await frame.locator('#randomStoryButton').click();
  await frame.locator('#fillEmptyButton').click();
  await frame.locator('#makeStoryButton').click();
  await frame.locator('#speakButton').click();
  assert.equal(await frame.locator('#speakButton').textContent(), '■ Stop Reading');
  await shell.evaluate(() => window.dispatchEvent(new Event('arcadepause')));
  assert.equal(await frame.locator('#speakButton').textContent(), '🔊 Read It Aloud', 'Android shell pause reaches speech in its game iframe');
  await shell.close();
  console.log('PASS narration Android shell pause: iframe narration stops and its control resets');
} finally {
  await browser?.close();
  await fixture.close();
}
