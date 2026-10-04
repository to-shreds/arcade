// Optional smoke test against the public site and its actual Internet Worker.
// Run manually after publishing: node tools/test-production-browser.mjs
// Navigation only, without creating rooms: PRODUCTION_NAVIGATION_ONLY=1 node tools/test-production-browser.mjs
// Never added to the default CI suite. No routes, local fixtures or endpoint substitutions.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium, browserLaunchOptions } from './browser-runtime.mjs';

const base = (process.env.ARCADE_PRODUCTION_BASE || 'https://to-shreds.github.io/arcade').replace(/\/$/, '');
const output = fileURLToPath(new URL('../test-results/production-browser/', import.meta.url));
const navigationOnly = process.env.PRODUCTION_NAVIGATION_ONLY === '1';
const managedProxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
let proxy;
if (managedProxy) {
  try {
    const url = new URL(managedProxy);
    proxy = { server: url.origin, ...(url.username ? { username: decodeURIComponent(url.username) } : {}), ...(url.password ? { password: decodeURIComponent(url.password) } : {}) };
  } catch { throw new Error('The managed proxy configuration is invalid.'); }
}
function safeText(value) {
  let text = String(value);
  for (const secret of [managedProxy, proxy?.server, proxy?.username, proxy?.password]) if (secret) text = text.split(secret).join('[managed proxy]');
  return text;
}
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const report = { base, navigationOnly, status: 'running', checks: [], navigation: [], errors: [], cleanup: [] };
const networkUnavailable = error => /net::ERR_(?:TUNNEL_CONNECTION_FAILED|PROXY_CONNECTION_FAILED|NAME_NOT_RESOLVED|CONNECTION_TIMED_OUT|NETWORK_ACCESS_DENIED|INTERNET_DISCONNECTED|CERT_AUTHORITY_INVALID|EMPTY_RESPONSE|CONNECTION_CLOSED|CONNECTION_RESET|CONNECTION_REFUSED)|ENOTFOUND|EAI_AGAIN/.test(String(error));
await mkdir(output, { recursive: true });
let browser;

// Observe responses without changing any request, URL, body or transport.
function telemetry() {
  window.__productionRoom = null;
  const observe = body => { if (body?.room) window.__productionRoom = body.room; };
  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const response = await nativeFetch(...args);
    try { observe(await response.clone().json()); } catch {}
    return response;
  };
  const NativeSocket = window.WebSocket;
  window.WebSocket = class extends NativeSocket {
    constructor(url, protocols) {
      if (protocols === undefined) super(url); else super(url, protocols);
      this.addEventListener('message', event => { try { observe(JSON.parse(event.data)); } catch {} });
    }
  };
}
async function until(page, predicate, argument, timeout = 20000) {
  // Spectator game timers are intentionally frozen; poll from Node instead.
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await page.evaluate(predicate, argument)) return;
    await delay(100);
  }
  throw new Error('Production condition timed out: ' + String(predicate));
}
async function click(page, selector) {
  await until(page, selector => { const button = document.querySelector(selector); return button && !button.disabled && button.getBoundingClientRect().width > 0; }, selector);
  await page.locator(selector).click({ force: true });
}
async function visit(page, activity) {
  const url = `${base}/${activity}/`;
  const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
  const entry = { url, status: response?.status(), title: await page.title() };
  report.navigation.push(entry);
  const body = (await page.locator('body').innerText()).slice(0, 1200);
  if (/ROBOTS_DENIED|Proxy request unsuccessful|blocked by (?:the )?(?:proxy|network)|network access denied/i.test(body)) {
    const error = new Error('Public navigation blocked by the environment network policy: ' + url);
    error.environmentBlocked = true; throw error;
  }
  assert.ok(response?.ok(), `Public navigation returned HTTP ${entry.status}: ${url}`);
}
async function screenshots(activity, pages) {
  for (const [index, page] of pages.entries()) {
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), activity + ' fits the viewport');
    await page.screenshot({ path: `${output}/${activity}-${index ? 'mobile' : 'desktop'}.png`, animations: 'disabled', timeout: 30000 });
  }
}
async function leaveShared(page) {
  if (await page.evaluate(() => !!window.ArcadeSharedActivity?.getState().active)) {
    await page.evaluate(() => ArcadeSharedActivity.leave());
    await until(page, () => !ArcadeSharedActivity.getState().active);
    report.cleanup.push('Left shared typing room');
  }
}
async function leaveChat(page) {
  if (await page.evaluate(() => !!window.__productionRoom && !document.querySelector('#roomView')?.classList.contains('hidden'))) {
    // Mobile keeps Leave room in the member drawer.
    if (!(await page.locator('#leaveBtn').isVisible())) await click(page, '#membersBtn');
    page.once('dialog', dialog => dialog.accept());
    await click(page, '#leaveBtn');
    await until(page, () => document.querySelector('#roomView').classList.contains('hidden'));
    report.cleanup.push('Left chat room');
  }
}

try {
  browser = await chromium.launch({ ...browserLaunchOptions, ...(proxy ? { proxy } : {}) });
  // This managed environment's proxy CA is not in the bundled Chromium store.
  // Public UI testing through that proxy is explicitly separate from TLS checks.
  const contexts = await Promise.all([{ width: 1280, height: 900 }, { width: 390, height: 844 }].map(viewport => browser.newContext({ viewport, hasTouch: viewport.width < 500, ignoreHTTPSErrors: !!proxy })));
  const pages = [];
  for (const context of contexts) {
    await context.addInitScript(telemetry);
    const page = await context.newPage(); page.setDefaultTimeout(20000);
    page.on('pageerror', error => report.errors.push({ url: page.url(), message: String(error) }));
    pages.push(page);
  }
  const [a, b] = pages;
  if (navigationOnly) {
    await visit(a, 'typing'); await visit(b, 'chat-room');
    report.checks.push('Desktop Typing and mobile Chat public direct links load');
  } else {
    try {
      for (const page of pages) await visit(page, 'typing');
      assert.ok(await a.evaluate(() => !!window.ArcadeSharedActivity), 'Published Typing must include the shared activity runtime');
      await click(a, '#shared-launch'); await a.locator('#shared-name').fill('Smoke Desktop'); await click(a, '#shared-create');
      await until(a, () => ArcadeSharedActivity.getState().active && ArcadeSharedActivity.getState().connected);
      const code = await a.evaluate(() => ArcadeSharedActivity.getState().room.code); await click(a, '#shared-close');
      await click(b, '#shared-launch'); await b.locator('#shared-name').fill('Smoke Mobile'); await b.locator('#shared-code').fill(code); await click(b, '#shared-join');
      await until(b, () => ArcadeSharedActivity.getState().appliedSequence >= 0 && ArcadeSharedActivity.getState().connected); await click(b, '#shared-close');
      assert.equal(await b.evaluate(() => ArcadeSharedActivity.isController()), false);
      const before = await a.evaluate(() => TypingAutosave.capture().text);
      await click(a, '[data-key="a"]');
      await until(a, before => TypingAutosave.capture().text !== before, before);
      const text = await a.evaluate(() => TypingAutosave.capture().text);
      await until(b, text => document.querySelector('#editor').textContent === text, text);
      report.checks.push('Actual production shared room create/join and typing edit reaches the mobile observer');
      await click(a, '#shared-launch'); await click(a, '#shared-pass');
      await until(b, () => ArcadeSharedActivity.isController()); await click(a, '#shared-close');
      await click(b, '[data-key="b"]');
      await until(b, text => TypingAutosave.capture().text !== text, text);
      const edited = await b.evaluate(() => TypingAutosave.capture().text);
      await until(a, edited => document.querySelector('#editor').textContent === edited, edited);
      await a.reload(); await click(a, '#shared-launch'); await click(a, '#shared-resume');
      await until(a, edited => ArcadeSharedActivity.getState().connected && document.querySelector('#editor').textContent === edited, edited); await click(a, '#shared-close');
      await screenshots('typing', pages);
      report.checks.push('Mobile takes controls, edits synchronously, and desktop reload/resume preserves the room and text');
    } finally {
      // The most recent owner leaves last so both test-created memberships close.
      for (const page of [a, b]) try { await leaveShared(page); } catch (error) { report.cleanup.push('Shared cleanup failed: ' + error.message); }
    }
    try {
      for (const page of pages) await visit(page, 'chat-room');
      assert.equal(await a.locator('#imageInput').count(), 1, 'Published Chat must include image sharing');
      await a.locator('#startName').fill('Smoke Desktop'); await click(a, '#createBtn');
      await until(a, () => !!window.__productionRoom?.code);
      const code = await a.locator('#roomCode').textContent();
      await b.locator('#startName').fill('Smoke Mobile'); await click(b, '#joinOpenBtn'); await b.locator('#joinCode').fill(code); await click(b, '#joinSubmitBtn');
      await until(b, () => window.__productionRoom?.members.length === 2);
      await a.locator('#imageInput').setInputFiles({ name: 'smoke-image.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABQAAAAMCAIAAADtbgqsAAAAGUlEQVR4nGMUOXGHgVzARLbOUc2jmmmuGQALXwHQpdKmfgAAAABJRU5ErkJggg==', 'base64') });
      await until(a, () => !document.querySelector('#imageDraft').hidden && !document.querySelector('#sendBtn').disabled);
      const caption = 'Arcade production image smoke test';
      await a.locator('#messageInput').fill(caption); await click(a, '#sendBtn');
      for (const page of pages) await until(page, caption => document.querySelector('.chatImage')?.naturalWidth > 0 && document.querySelector('.messageText')?.textContent === caption, caption);
      assert.deepEqual(await a.evaluate(() => window.__productionRoom.chat), await b.evaluate(() => window.__productionRoom.chat));
      await screenshots('chat-room', pages);
      report.checks.push('Actual production chat room create/join and a real file attachment renders on desktop/mobile with its caption');
    } finally {
      for (const page of [b, a]) try { await leaveChat(page); } catch (error) { report.cleanup.push('Chat cleanup failed: ' + error.message); }
    }
  }
  assert.deepEqual(report.errors, [], 'No page JavaScript errors');
  assert.ok(!report.cleanup.some(value => value.includes('failed:')), 'All test-created rooms were left');
  report.status = 'passed';
} catch (error) {
  if (error.environmentBlocked || networkUnavailable(error)) {
    report.status = 'network-unreachable'; report.reason = safeText(error.message || error);
  } else {
    report.status = 'failed'; report.reason = safeText(error.stack || error); process.exitCode = 1;
  }
} finally {
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  if (browser) await browser.close();
  console.log(JSON.stringify(report, null, 2));
}
