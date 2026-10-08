#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium, browserLaunchOptions } from './browser-runtime.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const results = fileURLToPath(new URL('../test-results/family-activities/', import.meta.url));
const port = Number(process.env.ARCADE_FAMILY_TEST_PORT || 8797);
const base = `http://127.0.0.1:${port}`;
const onlyAdventure = process.argv.includes('--adventure-only');
const onlyTV = process.argv.includes('--tv-only');
const onlyOffline = process.argv.includes('--offline-only');
const summaryFile = `${results}/${onlyOffline ? 'offline-summary' : 'summary'}.json`;
const WEB_ORIGIN = 'https://to-shreds.github.io';
const WEB_BASE = `${WEB_ORIGIN}/arcade/`;
const API_ORIGIN = 'https://torbox-web-player-key.onrender.com';
const KEY_FIXTURE = 'family-tv-private-fixture-key';
const SESSION_FIXTURE = 's'.repeat(43);
const MEDIA_FIXTURE = 'm'.repeat(43);
// 1.4-second VP9 WebM black-video fixture, generated with ffmpeg; no external media requests.
const VIDEO_FIXTURE = Buffer.from('GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQJChYECGFOAZwEAAAAAAAT5EU2bdLpNu4tTq4QVSalmU6yBoU27i1OrhBZUrmtTrIHYTbuMU6uEElTDZ1OsggEeTbuMU6uEHFO7a1OsggTj7AEAAAAAAABZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVSalmsirXsYMPQkBNgI1MYXZmNjAuMTYuMTAwV0GNTGF2ZjYwLjE2LjEwMESJiECV4AAAAAAAFlSua8GuAQAAAAAAADjXgQFzxYhn+vnlDcXmxJyBACK1nIN1bmSIgQCGhVZfVlA5g4EBI+ODhAJiWgDgibCBoLqBWpqBAhJUw2dAgHNzoGPAgGfImkWjh0VOQ09ERVJEh41MYXZmNjAuMTYuMTAwc3PaY8CLY8WIZ/r55Q3F5sRnyKVFo4dFTkNPREVSRIeYTGF2YzYwLjMxLjEwMiBsaWJ2cHgtdnA5Z8ihRaOIRFVSQVRJT05Eh5MwMDowMDowMS40MDAwMDAwMDAAH0O2dUM554EAo6aBAACAgkmDQgAJ8AWWADgkHBhKAAAwYAAAZz///1ZFZO7jPhk+AKOVgQAoAIYAQJKcAFAAAAMgAABZ+Ybgo5WBAFAAhgBAkpwATuAAAyAAAFn5huCjlYEAeACGAECSnABQAAADIAAAWfmG4KOVgQCgAIYAQJKcAE1AAAMgAABZ+Ybgo5WBAMgAhgBAkpwAUAAAAyAAAFn5huCjlYEA8ACGAECSnABO4AADIAAAWfmG4KOVgQEYAIYAQJKcAFAAAAMgAABZ+Ybgo5WBAUAAhgBAkpwASiAAAyAAAFn5huCjlYEBaACGAECSnABQAAADIAAAWfmG4KOVgQGQAIYAwJKcAEogAAMgAABZ+Ybgo5WBAbgAhgBAkpwAUAAAAyAAAFn5huCjlYEB4ACGAECSnABNQAADIAAAWfmG4KOVgQIIAIYAQJKcAFAAAAMgAABZ+Ybgo5WBAjAAhgBAkpwATuAAAyAAAFn5huCjlYECWACGAECSnABQAAADIAAAWfmG4KOVgQKAAIYAQJKcAEogAAMgAABZ+Ybgo5WBAqgAhgBAkpwAUAAAAyAAAFn5huCjlYEC0ACGAECSnABO4AADIAAAWfmG4KOVgQL4AIYAQJKcAFAAAAMgAABZ+Ybgo5WBAyAAhgDAkpwASiAAAyAAAFn5huCjlYEDSACGAECSnABQAAADIAAAWfmG4KOVgQNwAIYAQJKcAE7gAAMgAABZ+Ybgo5WBA5gAhgBAkpwAUAAAAyAAAFn5huCjlYEDwACGAECSnABKIAADIAAAWfmG4KOVgQPoAIYAQJKcAFAAAAMgAABZ+Ybgo5WBBBAAhgBAkpwATuAAAyAAAFn5huCjlYEEOACGAECSnABQAAADIAAAWfmG4KOVgQRgAIYAQJKcAE1AAAMgAABZ+Ybgo5WBBIgAhgBAkpwAUAAAAyAAAFn5huCjlYEEsACGAMCSnABKIAADIAAAWfmG4KOVgQTYAIYAQJKcAFAAAAMgAABZ+Ybgo5WBBQAAhgBAkpwASiAAAyAAAFn5huCjlYEFKACGAECSnABQAAADIAAAWfmG4KOVgQVQAIYAQJKcAE7gAAMgAABZ+YbgHFO7a5G7j7OBALeK94EB8YIBpPCBAw==', 'base64');
const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: root, stdio: 'ignore' });
const evidence = [];
let browser;

async function settleServer() {
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(base)).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Family activity static fixture did not start.');
}

async function finishPages(frame) {
  for (let i = 0; i < 100; i++) {
    if (await frame.locator('#nextPageButton').isDisabled()) return;
    await frame.locator('#nextPageButton').click();
  }
  throw new Error('Adventure page navigation did not end.');
}

async function adventure(viewport, { shell = false } = {}) {
  const context = await browser.newContext({ viewport });
  await context.addInitScript(() => {
    window.__familySpeech = { cancel: 0, speak: 0, utterances: [] };
    // Keep a pending utterance until cancellation, independent of installed OS voices.
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
      cancel() { window.top.__familySpeech.cancel++; },
      speak(utterance) { window.top.__familySpeech.speak++; window.top.__familySpeech.utterances.push(utterance.text); }
    } });
    window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(shell ? base : `${base}/adventure/`);
  let frame = page;
  if (shell) {
    await page.waitForFunction(() => !!window.ArcadeShell);
    await page.evaluate(() => ArcadeShell.openGame('adventure'));
    await page.locator('#shellGameFrame').waitFor();
    frame = page.frameLocator('#shellGameFrame');
  }
  await frame.locator('#sceneTitle').waitFor();
  await frame.locator('#storyText p').first().waitFor();
  assert.equal(await frame.locator('#homeButton').isVisible(), true, 'Adventure Arcade/Home button must be reachable');
  const geometry = await frame.locator('body').evaluate(body => ({
    width: body.clientWidth, height: body.clientHeight,
    scrollWidth: body.scrollWidth, scrollHeight: body.scrollHeight,
    story: (() => { const text = document.getElementById('storyText'); return { height: text.clientHeight, scrollHeight: text.scrollHeight }; })(),
    buttons: Array.from(document.querySelectorAll('.topbar button,.choices:not(.waiting) button')).filter(button => !button.hidden).map(button => { const r = button.getBoundingClientRect(); return { id: button.id, text: button.textContent, left: r.left, right: r.right, top: r.top, bottom: r.bottom }; })
  }));
  assert.ok(geometry.scrollWidth <= geometry.width + 1, 'Adventure must not overflow horizontally');
  assert.ok(geometry.scrollHeight <= geometry.height + 1, 'Adventure must not require page scrolling');
  assert.ok(geometry.story.scrollHeight <= geometry.story.height + 1, 'Visible Adventure story page must fit');
  for (const button of geometry.buttons) {
    assert.ok(button.left >= -1 && button.right <= geometry.width + 1, `Adventure control outside horizontal viewport: ${button.text}`);
    assert.ok(button.top >= -1 && button.bottom <= geometry.height + 1, `Adventure control outside vertical viewport: ${button.text}`);
  }
  const firstTitle = await frame.locator('#sceneTitle').textContent();
  await finishPages(frame);
  await frame.locator('#choices button').first().click();
  await frame.locator('#backButton').click();
  assert.equal(await frame.locator('#sceneTitle').textContent(), firstTitle, 'Adventure Back must restore the prior scene');
  await frame.locator('#readButton').click();
  assert.equal(await frame.locator('#readButton').getAttribute('aria-pressed'), 'true');
  const cancellations = await page.evaluate(() => __familySpeech.cancel);
  assert.equal(await page.evaluate(() => __familySpeech.speak), 1);
  if (shell) {
    await page.evaluate(() => { window.__familyShellIdentity = ArcadeShell; });
    await frame.locator('#homeButton').click();
    await page.waitForFunction(() => !document.querySelector('#shellGameFrame'));
    assert.ok(await page.evaluate(() => __familySpeech.cancel) > cancellations, 'Home must cancel Adventure narration');
    assert.equal(await page.evaluate(() => ArcadeShell === __familyShellIdentity), true, 'Shell session must survive Adventure Home');
    await page.evaluate(() => ArcadeShell.openGame('adventure'));
    frame = page.frameLocator('#shellGameFrame');
    await frame.locator('#continueButton').waitFor();
    await frame.locator('#continueButton').click();
    await frame.locator('#readButton').click();
    const backCancellations = await page.evaluate(() => __familySpeech.cancel);
    await page.goBack();
    await page.waitForFunction(() => !document.querySelector('#shellGameFrame'));
    assert.ok(await page.evaluate(() => __familySpeech.cancel) > backCancellations, 'Browser Back must cancel Adventure narration');
  } else {
    await frame.locator('#restartButton').click();
    if (await frame.locator('#confirmRestartButton').isVisible()) await frame.locator('#confirmRestartButton').click();
    assert.equal(await frame.locator('#sceneTitle').textContent(), firstTitle, 'Adventure Restart must restore opening scene');
    assert.ok(await page.evaluate(() => __familySpeech.cancel) > cancellations, 'Restart must cancel narration');
  }
  assert.deepEqual(errors, [], 'Adventure must not emit uncaught JavaScript errors');
  if (!shell) await frame.locator('#storyCard').evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished.catch(() => {}))));
  await page.screenshot({ path: `${results}/adventure-${shell ? 'shell-' : ''}${viewport.width}x${viewport.height}.png` });
  evidence.push({ activity: 'adventure', shell, viewport, geometry, errors, passed: true });
  console.log(`Adventure ${shell ? 'shell ' : ''}${viewport.width}x${viewport.height}: viewport fit, choice, Back, narration, ${shell ? 'Home/browser Back/session preservation' : 'Restart'} passed.`);
  await context.close();
}

async function fixture(context, { uncached = false, failedLogin = false, metadataFailure = false, deferLogin = false } = {}) {
  const calls = [], unexpected = [];
  let releaseLogin;
  const loginGate = deferLogin ? new Promise(resolve => { releaseLogin = resolve; }) : null;
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin === WEB_ORIGIN && url.pathname.startsWith('/arcade/')) {
      let relative = decodeURIComponent(url.pathname.slice('/arcade/'.length));
      if (!relative || relative.endsWith('/')) relative += 'index.html';
      const file = path.resolve(root, relative);
      assert.ok(file.startsWith(path.resolve(root) + path.sep), 'Fixture static path must remain in repository');
      try {
        const body = await readFile(file), extension = path.extname(file);
        const contentType = ({ '.html': 'text/html', '.js': 'application/javascript', '.mjs': 'application/javascript', '.json': 'application/json', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' })[extension] || 'application/octet-stream';
        await route.fulfill({ status: 200, contentType, body });
      } catch { await route.fulfill({ status: 404, body: 'Fixture file missing' }); }
      return;
    }
    if (url.origin === API_ORIGIN) {
      const headers = { 'Access-Control-Allow-Origin': WEB_ORIGIN, 'Access-Control-Allow-Headers': 'authorization,content-type', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Cache-Control': 'no-store' };
      if (request.method() === 'OPTIONS') { await route.fulfill({ status: 204, headers }); return; }
      if (url.pathname.startsWith('/media/')) {
        calls.push({ path: url.pathname, method: request.method(), headers: request.headers() });
        await route.fulfill({ status: 200, headers: { ...headers, 'Content-Type': 'video/webm', 'Content-Length': String(VIDEO_FIXTURE.length) }, body: VIDEO_FIXTURE });
        return;
      }
      const data = request.postDataJSON();
      calls.push({ path: url.pathname, query: Object.fromEntries(url.searchParams), method: request.method(), headers: request.headers(), data });
      let status = 200, body;
      if (url.pathname === '/api/session') body = { authenticated: request.headers().authorization === `Bearer ${SESSION_FIXTURE}`, authMode: 'api-key' };
      else if (url.pathname === '/api/login') {
        if (loginGate) await loginGate;
        if (failedLogin) { status = 401; body = { error: 'BAD_API_KEY', message: 'Enter a valid TorBox API key.' }; }
        else { assert.equal(data.apiKey, KEY_FIXTURE); body = { sessionToken: SESSION_FIXTURE, authMode: 'api-key' }; }
      } else if (url.pathname === '/api/logout') body = { ok: true };
      else if (url.pathname === '/api/discover/meta') {
        if (metadataFailure) { status = 502; body = { error: 'CATALOG_UNAVAILABLE', message: 'The TV catalog could not be reached. Try again.' }; }
        else body = { meta: { id: url.searchParams.get('id'), type: url.searchParams.get('type'), name: 'Elena of Avalor', year: 2016, episodes: [
          { season: 1, episode: 2, name: 'Second episode', released: '2016-07-23' },
          { season: 0, episode: 1, name: 'Special', released: '2016-07-20' },
          { season: 2, episode: 1, name: 'Third episode', released: '2017-07-22' },
          { season: 1, episode: 1, name: 'First episode', released: '2016-07-22' },
          { season: 1, episode: 1, name: 'Duplicate episode', released: '2016-07-22' },
          { season: 3, episode: 1, name: 'Future episode', released: '2099-07-22' }
        ] } };
      } else if (url.pathname === '/api/discover/lookup') body = { sources: [{ id: 'source-1', hash: 'abc', name: 'Fixture episode.webm', cached: !uncached, browserContainer: true, score: 1 }] };
      else if (url.pathname === '/api/discover/sources') body = { sources: [{ id: 'source-1', hash: 'abc', cached: !uncached, browserContainer: true, score: 1 }] };
      else if (url.pathname === '/api/discover/prepare') body = { state: 'ready', file: { id: 'torrents:1:0', title: 'Fixture episode.webm' } };
      else if (url.pathname === '/api/playback') body = { mediaUrl: `/media/${MEDIA_FIXTURE}`, file: { id: 'torrents:1:0', title: 'Fixture episode.webm' } };
      else { status = 404; body = { error: 'NOT_FOUND', message: 'Fixture route not found.' }; unexpected.push(request.url()); }
      await route.fulfill({ status, headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      return;
    }
    unexpected.push(request.url()); await route.abort();
  });
  return { calls, unexpected, releaseLogin };
}

async function connectTV(frame, { remember = false } = {}) {
  await frame.locator('#connect').click();
  assert.equal(await frame.locator('#api-key').getAttribute('type'), 'password');
  await frame.locator('#api-key').fill(KEY_FIXTURE);
  if (remember) await frame.locator('#remember').check();
  await frame.locator('#login').click();
  await frame.locator('#connection-dialog').waitFor({ state: 'hidden' });
  assert.equal(await frame.locator('#api-key').inputValue(), '', 'Submitted key must be cleared from the password field');
}

async function tv(viewport, { shell = false, deniedStorage = false, fullscreenDenied = false, autoplayDenied = false } = {}) {
  const context = await browser.newContext({ viewport, serviceWorkers: 'block' });
  await context.addInitScript(() => {
    window.__familyVideoCleanup = 0;
    const remove = Element.prototype.removeAttribute;
    Element.prototype.removeAttribute = function(name) {
      if (this.id === 'video' && name === 'src') window.top.__familyVideoCleanup++;
      return remove.call(this, name);
    };
  });
  if (deniedStorage) await context.addInitScript(() => {
    for (const name of ['sessionStorage', 'localStorage']) Object.defineProperty(window, name, { configurable: true, get() { throw new DOMException('Storage denied', 'SecurityError'); } });
  });
  if (fullscreenDenied || autoplayDenied) await context.addInitScript(({ fullscreenDenied, autoplayDenied }) => {
    if (fullscreenDenied) Element.prototype.requestFullscreen = () => Promise.reject(new DOMException('Fullscreen denied', 'NotAllowedError'));
    if (autoplayDenied) HTMLMediaElement.prototype.play = () => Promise.reject(new DOMException('Autoplay denied', 'NotAllowedError'));
  }, { fullscreenDenied, autoplayDenied });
  const { calls, unexpected } = await fixture(context);
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('requestfailed', request => console.error(`Fixture request failed: ${request.url()} (${request.failure()?.errorText})`));
  page.on('console', message => { if (message.type() === 'error') console.error(`Fixture browser: ${message.text()}`); });
  await page.goto(shell ? WEB_BASE : `${WEB_BASE}tv/`);
  let frame = page;
  if (shell) {
    await page.waitForFunction(() => !!window.ArcadeShell);
    await page.evaluate(() => { window.__familyShellIdentity = ArcadeShell; ArcadeShell.openGame('tv'); });
    frame = page.frameLocator('#shellGameFrame');
  }
  await frame.locator('#titles button').first().waitFor();
  assert.equal(await frame.locator('input[type=search]').count(), 0, 'TV must have no search field');
  const shows = await frame.locator('#titles button b').allTextContents();
  assert.equal(shows.length, 4, 'TV must start with the four requested shows');
  assert.deepEqual(shows, [...shows].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' })), 'TV show list must be alphabetized');
  await connectTV(frame);
  await frame.locator('#titles button').filter({ hasText: 'Elena of Avalor' }).click();
  await frame.locator('#season option').first().waitFor({ state: 'attached' });
  assert.equal(await frame.locator('#season').inputValue(), '1', 'TV must default to normal season 1, skipping Specials');
  assert.deepEqual(await frame.locator('#episode option').allTextContents(), ['1. First episode', '2. Second episode'], 'Episodes must be sorted, unique, and released');
  assert.equal(await frame.locator('#autoplay').isChecked(), true, 'Auto-next must default on');
  await frame.locator('#play').click();
  if (autoplayDenied) {
    await frame.locator('#tap-play').waitFor({ state: 'visible' });
    assert.match(await frame.locator('#player-status').textContent(), /tap/i, 'Autoplay denial must have an actionable tap fallback');
  } else {
    await frame.locator('#video').evaluate(video => new Promise(resolve => video.readyState >= 2 && !video.paused ? resolve() : video.addEventListener('playing', resolve, { once: true })));
    await frame.locator('#video').evaluate(video => video.pause());
  }
  const playerBounds = await frame.locator('#player').boundingBox();
  assert.ok(playerBounds.width >= viewport.width - 1 && playerBounds.height >= viewport.height - 1, 'TV player must fill the viewport by default');
  assert.equal(await frame.locator('#player-back').isVisible(), true);
  const videoHandle = await frame.locator('#video').elementHandle();
  if (!autoplayDenied) {
    await frame.locator('#video').evaluate(video => { video.currentTime = Math.max(0, video.duration - 0.06); return video.play(); });
    await frame.locator('#playing-title').filter({ hasText: 'S1 E2' }).waitFor();
    await frame.locator('#video').evaluate(video => new Promise(resolve => video.readyState >= 2 && !video.paused ? resolve() : video.addEventListener('playing', resolve, { once: true })));
    await frame.locator('#video').evaluate(video => video.pause());
    assert.equal(await videoHandle.evaluate(video => video === document.getElementById('video')), true, 'Auto-next must retain the same video element');
    await frame.locator('#video').evaluate(video => { video.currentTime = Math.max(0, video.duration - 0.06); return video.play(); });
    await frame.locator('#playing-title').filter({ hasText: 'S2 E1' }).waitFor();
    await frame.locator('#video').evaluate(video => new Promise(resolve => video.readyState >= 2 && !video.paused ? resolve() : video.addEventListener('playing', resolve, { once: true })));
    await frame.locator('#video').evaluate(video => video.pause());
    assert.equal(await frame.locator('#season').inputValue(), '2');
  }
  await page.screenshot({ path: `${results}/tv-${shell ? 'shell-' : ''}${viewport.width}x${viewport.height}${deniedStorage ? '-no-storage' : ''}${fullscreenDenied ? '-no-fullscreen' : ''}${autoplayDenied ? '-no-autoplay' : ''}.png` });
  await frame.locator('#player-back').click();
  await frame.locator('#player').waitFor({ state: 'hidden' });
  assert.equal(await frame.locator('#video').getAttribute('src'), null, 'Player Back must clear media source');
  if (await frame.locator('#list-back').isVisible()) await frame.locator('#list-back').click();
  await frame.locator('#movies-tab').click();
  const movies = await frame.locator('#titles button b').allTextContents();
  assert.deepEqual(movies, [...movies].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' })), 'TV movies must be alphabetized');
  assert.ok(movies.some(name => name === 'Jumanji'), 'Original Jumanji must be present');
  assert.ok(movies.filter(name => name.startsWith('Night at the Museum')).length >= 3, 'Night at the Museum trilogy must be present');
  if (shell) {
    const cleanupCount = await page.evaluate(() => __familyVideoCleanup);
    await frame.locator('#home').click();
    await page.waitForFunction(() => !document.querySelector('#shellGameFrame'));
    assert.ok(await page.evaluate(() => __familyVideoCleanup) > cleanupCount, 'Arcade Home must clear TV media source before iframe removal');
    assert.equal(await page.evaluate(() => ArcadeShell === __familyShellIdentity), true, 'TV Home must preserve shell session');
    await page.evaluate(() => ArcadeShell.openGame('tv'));
    frame = page.frameLocator('#shellGameFrame');
    await frame.locator('#titles button').first().waitFor();
    await page.goBack();
    await page.waitForFunction(() => !document.querySelector('#shellGameFrame'));
  } else {
    await frame.locator('#connect').click();
    await frame.locator('#disconnect').click();
    await frame.locator('#connection-status').filter({ hasText: 'remembered key was removed' }).waitFor();
  }
  assert.ok(!page.url().includes(KEY_FIXTURE), 'Master key must never enter address');
  assert.ok(calls.filter(call => call.path !== '/api/login').every(call => !JSON.stringify(call).includes(KEY_FIXTURE)), 'Master key must be limited to login request body');
  assert.ok(calls.filter(call => call.path === '/api/discover/prepare').every(call => call.data.onlyCached === true), 'Automatic playback must stay cached-only');
  assert.deepEqual(unexpected, [], 'TV must not contact other services directly');
  assert.deepEqual(errors, [], 'TV must not emit uncaught JavaScript errors');
  evidence.push({ activity: 'tv', viewport, shell, deniedStorage, fullscreenDenied, autoplayDenied, shows, movieCount: movies.length, calls: calls.map(call => ({ path: call.path, method: call.method })), errors, unexpected, passed: true });
  console.log(`TV ${shell ? 'shell ' : ''}${viewport.width}x${viewport.height}${deniedStorage ? ' denied storage' : ''}${fullscreenDenied ? ' fullscreen fallback' : ''}${autoplayDenied ? ' autoplay fallback' : ''}: preset list, password, episode order, screen-filling player, ${autoplayDenied ? 'tap fallback' : 'cross-season auto-next'}, cleanup, key isolation passed.`);
  await context.close();
}

async function blockedTV({ nearby = false } = {}) {
  const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } });
  if (nearby) await context.addInitScript(token => sessionStorage.setItem('arcade-tv.session.v1', token), SESSION_FIXTURE);
  const calls = [];
  context.on('request', request => { if (new URL(request.url()).origin === API_ORIGIN) calls.push(request.url()); });
  if (nearby) await fixture(context);
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(nearby ? `${WEB_BASE}tv/?_arcadeTransport=nearby` : `${base}/tv/`);
  await page.locator('#titles button').first().waitFor();
  await page.locator('#connect').click();
  assert.equal(await page.locator('#api-key').isDisabled(), true);
  assert.equal(await page.locator('#remember').isDisabled(), true);
  assert.equal(await page.locator('#login').isDisabled(), true);
  if (nearby) {
    await page.locator('#disconnect').click();
    await page.locator('#connection-status').filter({ hasText: 'remembered key was removed' }).waitFor();
  }
  await page.locator('#connection-close').click();
  if (nearby) assert.match(await page.locator('#connection-note').textContent(), /Disconnect Nearby/);
  else assert.equal(await page.locator('#connection-note a').getAttribute('href'), `${WEB_BASE}?game=tv`);
  await page.locator('#titles button').first().click();
  assert.equal(await page.locator('#play').isDisabled(), true);
  assert.deepEqual(calls, [], 'Blocked/local TV must not send credentials or requests');
  assert.deepEqual(errors, []);
  evidence.push({ activity: 'tv', blocked: nearby ? 'nearby' : 'local-origin', calls, errors, passed: true });
  console.log(`TV ${nearby ? 'Nearby' : 'local-origin'}: clear guidance, key/login/play disabled, zero backend requests passed.`);
  await context.close();
}

async function vaultState(page) {
  return page.evaluate(async () => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('arcade-tv-key-vault', 1);
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    const value = await new Promise((resolve, reject) => {
      const tx = database.transaction('vault', 'readonly'), store = tx.objectStore('vault');
      const key = store.get('device-key'), encrypted = store.get('api-key'), keys = store.getAllKeys();
      tx.oncomplete = () => resolve({ key: key.result, encrypted: encrypted.result, keys: keys.result }); tx.onerror = () => reject(tx.error);
    });
    database.close();
    let exportBlocked = false;
    if (value.key) { try { await crypto.subtle.exportKey('raw', value.key); } catch { exportBlocked = true; } }
    return { keys: value.keys, extractable: value.key?.extractable, algorithm: value.key?.algorithm?.name, exportBlocked, encrypted: value.encrypted,
      browserStorage: { local: { ...localStorage }, session: { ...sessionStorage } }, adapter: window.ArcadeSave?.getAdapter?.() };
  });
}

async function vaultAndCancellation() {
  const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } });
  const { calls, unexpected } = await fixture(context);
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${WEB_BASE}tv/`);
  await page.locator('#titles button').first().waitFor();
  await connectTV(page, { remember: true });
  const saved = await vaultState(page);
  assert.equal(saved.extractable, false); assert.equal(saved.algorithm, 'AES-GCM'); assert.equal(saved.exportBlocked, true);
  assert.ok(saved.encrypted?.iv?.length === 12 && saved.encrypted?.data?.length > KEY_FIXTURE.length, 'Remember must store authenticated ciphertext');
  assert.ok(!JSON.stringify(saved).includes(KEY_FIXTURE), 'Master key must not be stored in plaintext');
  assert.equal(saved.adapter, null, 'TV must not register a save adapter');
  await page.evaluate(() => sessionStorage.removeItem('arcade-tv.session.v1'));
  await page.reload();
  await page.locator('#connection-note').filter({ hasText: 'connected on this device' }).waitFor();
  assert.equal(calls.filter(call => call.path === '/api/login').length, 2, 'Remember must reconnect from encrypted vault after session loss');
  await page.locator('#connect').click();
  await page.locator('#disconnect').click();
  await page.locator('#connection-status').filter({ hasText: 'remembered key was removed' }).waitFor();
  assert.deepEqual((await vaultState(page)).keys, [], 'Forget must clear encrypted key and device key');
  assert.equal(await page.evaluate(() => sessionStorage.getItem('arcade-tv.session.v1')), null);
  assert.deepEqual(unexpected, []); assert.deepEqual(errors, []);
  await context.close();

  const lateContext = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } });
  const late = await fixture(lateContext, { deferLogin: true });
  const latePage = await lateContext.newPage();
  await latePage.goto(`${WEB_BASE}tv/`);
  await latePage.locator('#titles button').first().waitFor();
  await latePage.locator('#connect').click(); await latePage.locator('#api-key').fill(KEY_FIXTURE); await latePage.locator('#remember').check();
  await latePage.locator('#login').click();
  for (let i = 0; !late.calls.some(call => call.path === '/api/login'); i++) {
    if (i >= 100) throw new Error('Deferred login did not start'); await new Promise(resolve => setTimeout(resolve, 20));
  }
  await latePage.locator('#disconnect').click();
  await latePage.locator('#connection-status').filter({ hasText: 'remembered key was removed' }).waitFor();
  late.releaseLogin();
  for (let i = 0; !late.calls.some(call => call.path === '/api/logout'); i++) {
    if (i >= 100) throw new Error('Cancelled late login was not revoked'); await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.deepEqual((await vaultState(latePage)).keys, [], 'A late login must not resurrect the forgotten key');
  assert.equal(await latePage.evaluate(() => sessionStorage.getItem('arcade-tv.session.v1')), null, 'A late login must not recreate a local session');
  assert.deepEqual(late.unexpected, []);
  await lateContext.close();
  evidence.push({ activity: 'tv', vault: { encrypted: true, nonextractable: true, restore: true, forget: true, lateLoginRevoked: true }, passed: true });
  console.log('TV vault: AES-GCM ciphertext, nonextractable device key, plaintext/save isolation, remembered reconnect, Forget, and late-login revocation passed.');
}

async function offlineAdventure() {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base);
  await page.waitForFunction(() => !!window.ArcadeShell);
  await page.evaluate(() => navigator.serviceWorker.register('/sw.js', { scope: '/' }));
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await page.locator('#offlineBadge').click();
  await page.waitForFunction(() => document.getElementById('offlineBadgeText')?.textContent === 'Offline Ready', null, { timeout: 120000 });
  await context.setOffline(true); await page.reload();
  await page.waitForFunction(() => !!window.ArcadeShell && document.querySelectorAll('.card').length === 45);
  await page.evaluate(() => ArcadeShell.openGame('adventure'));
  const frame = page.frameLocator('#shellGameFrame');
  await frame.locator('#storyText p').first().waitFor();
  await finishPages(frame); await frame.locator('#choices button').first().click();
  assert.equal(await frame.locator('#backButton').isDisabled(), false);
  await frame.locator('#storyCard').evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished.catch(() => {}))));
  await page.screenshot({ path: `${results}/adventure-offline-390x844.png` });
  await frame.locator('#homeButton').click(); await page.waitForFunction(() => !document.querySelector('#shellGameFrame'));
  assert.deepEqual(errors, []);
  evidence.push({ activity: 'adventure', offline: true, catalogTiles: 45, choice: true, home: true, errors, passed: true });
  console.log('Offline PWA: complete verified snapshot, 45 catalog tiles, Adventure launch/story/choice/Home and no JavaScript errors passed.');
  await context.close();
}

try {
  await mkdir(results, { recursive: true });
  await settleServer();
  browser = await chromium.launch(browserLaunchOptions);
  if (!onlyTV && !onlyOffline) for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 320, height: 568 }, { width: 844, height: 390 }]) await adventure(viewport);
  if (!onlyAdventure && !onlyOffline) {
    const catalog = JSON.parse(await readFile(new URL('../catalog.json', import.meta.url)));
    for (const folder of ['adventure', 'tv']) assert.ok(catalog.items.some(item => item.folder === folder && item.enabled), `${folder} must be enabled in Arcade catalog`);
    if (!onlyTV) await adventure({ width: 390, height: 844 }, { shell: true });
    await blockedTV();
    await blockedTV({ nearby: true });
    await tv({ width: 1440, height: 900 });
    await tv({ width: 390, height: 844 }, { shell: true });
    await tv({ width: 320, height: 568 }, { fullscreenDenied: true });
    await tv({ width: 844, height: 390 }, { autoplayDenied: true });
    await tv({ width: 390, height: 844 }, { deniedStorage: true });
    await vaultAndCancellation();
  }
  if (onlyOffline || process.argv.includes('--with-offline')) await offlineAdventure();
  await writeFile(summaryFile, JSON.stringify({ at: new Date().toISOString(), evidence }, null, 2) + '\n');
} catch (error) {
  if (browser) {
    for (const [contextIndex, context] of browser.contexts().entries()) for (const [pageIndex, page] of context.pages().entries()) {
      try { await page.screenshot({ path: `${results}/failure-${contextIndex}-${pageIndex}.png` }); } catch {}
    }
  }
  await writeFile(summaryFile, JSON.stringify({ at: new Date().toISOString(), error: error.message, evidence }, null, 2) + '\n');
  throw error;
} finally {
  await browser?.close();
  server.kill();
}
