import assert from 'node:assert/strict';
import { browserTransportIsOffline, chromium, browserLaunchOptions } from './browser-runtime.mjs';
import { startStaticFixture } from './static-fixture.mjs';

const fixture = await startStaticFixture();
const browser = await chromium.launch(browserLaunchOptions);
const pageErrors = [];

try {
  const offline = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const shell = await offline.newPage();
  shell.setDefaultTimeout(15000);
  shell.on('pageerror', error => pageErrors.push(error.message));
  await shell.goto(fixture.base + '/');
  await shell.evaluate(() => navigator.serviceWorker.register('/sw.js', { scope: '/' }));
  await shell.waitForFunction(() => navigator.serviceWorker.controller);
  await shell.locator('#offlineBadge').click();
  await shell.waitForFunction(() => document.getElementById('offlineBadgeText')?.textContent === 'Offline Ready', null, { timeout: 120000 });
  assert.equal(await browserTransportIsOffline(shell), false, 'the server responds before disconnecting');
  await offline.setOffline(true);
  await shell.reload();
  assert.equal(await browserTransportIsOffline(shell), true, 'a real uncached request cannot reach the server');
  const launcher = shell.locator('[data-arcade-folder="mouse-lab"]');
  await launcher.click();
  const embedded = shell.frameLocator('#shellGameFrame');
  for (let i = 0; i < 5; i++) await embedded.locator('.target').click();
  await embedded.getByRole('button', { name: 'Next exercise' }).waitFor();
  assert.match(await embedded.locator('#progress').textContent(), /1 of 10/);
  await embedded.getByRole('link', { name: 'Back to Arcade' }).click();
  await shell.locator('#shellGameFrame').waitFor({ state: 'detached' });
  await launcher.click();
  await embedded.getByRole('heading', { name: 'Click', exact: true }).waitFor();
  assert.match(await embedded.locator('#progress').textContent(), /1 of 10/);
  assert.deepEqual(pageErrors, []);
  await offline.close();
  console.log('PASS Mouse Lab real offline snapshot install, cold shell launch, playable lesson, Home and persisted progress');
} finally {
  await browser.close();
  await fixture.close();
}
