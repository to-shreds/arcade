import assert from 'node:assert/strict';
import { chromium, browserLaunchOptions } from './browser-runtime.mjs';
import { startStaticFixture } from './static-fixture.mjs';

const fixture = await startStaticFixture();
const browser = await chromium.launch(browserLaunchOptions);
const url = fixture.base + '/mouse-lab/';
const pageErrors = [];
const remoteRequests = [];
const localFailures = [];
const storageKey = 'arcade.mouse-lab.progress.v1';

async function open(context) {
  const page = await context.newPage();
  page.setDefaultTimeout(7000);
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('request', request => {
    if (!request.url().startsWith(fixture.base + '/')) remoteRequests.push(request.url());
  });
  page.on('response', response => {
    if (response.status() >= 400) localFailures.push(response.url());
  });
  await page.goto(url);
  await page.getByRole('heading', { name: 'Click', exact: true }).waitFor();
  return page;
}

async function lesson(page, name, action = 'click') {
  const control = page.getByRole('navigation', { name: 'Practice exercises' }).getByRole('button', { name: new RegExp(`^${name}(, completed)?$`, 'i') });
  await control.scrollIntoViewIfNeeded();
  await control[action]();
  await page.getByRole('heading', { name, exact: true }).waitFor().catch(async error => {
    throw new Error(`Could not open ${name}; current exercise is ${await page.locator('#lesson-title').textContent()}`, { cause: error });
  });
}

async function done(page, message) {
  await page.locator('#next').waitFor({ state: 'visible' });
  assert.match(await page.locator('#feedback').textContent(), message);
  assert.equal(new URL(page.url()).pathname, '/mouse-lab/', 'training input cannot navigate outside the exercise');
}

async function center(locator) {
  await locator.scrollIntoViewIfNeeded();
  const bounds = await locator.boundingBox();
  assert(bounds);
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
}

async function drag(page, from, to) {
  const start = await center(from);
  const end = await center(to);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 12 });
  await page.mouse.up();
}

async function tracePoints(page) {
  const drawing = page.locator('.trace-area');
  await drawing.scrollIntoViewIfNeeded();
  return drawing.evaluate(svg => {
    const matrix = svg.getScreenCTM();
    return [...svg.querySelectorAll('circle')].map(dot => {
      const pos = new DOMPoint(dot.cx.baseVal.value, dot.cy.baseVal.value).matrixTransform(matrix);
      return { x: pos.x, y: pos.y };
    });
  });
}

try {
  const desktop = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await open(desktop);
  const target = page.locator('.target');
  const firstSize = (await target.boundingBox()).width;
  await target.click();
  assert((await target.boundingBox()).width < firstSize, 'targets get smaller');
  for (let i = 0; i < 4; i++) await target.click();
  await done(page, /all 5 targets/);

  await page.locator('#next').click();
  await page.locator('#difficulty').selectOption('challenge');
  assert.equal((await target.boundingBox()).width, 28);
  await page.locator('#difficulty').selectOption('easy');
  for (let i = 0; i < 6; i++) await target.click();
  await done(page, /all 6 targets/);

  await lesson(page, 'Moving targets');
  const originalPosition = await target.evaluate(el => el.style.left);
  await target.evaluate((el, original) => new Promise(resolve => {
    function wait() {
      if (el.style.left !== original) resolve();
      else requestAnimationFrame(wait);
    }
    wait();
  }), originalPosition);
  const live = await target.boundingBox();
  assert(live);
  await page.mouse.click(live.x + live.width / 2, live.y + live.height / 2);
  assert.match(await page.locator('#feedback').textContent(), /1 of 3/);
  await page.getByRole('checkbox', { name: 'Pause moving targets' }).check();
  await target.click();
  await target.click();
  await done(page, /all 3 targets/);

  await lesson(page, 'Drag and drop');
  const tile = name => page.getByRole('button', { name, exact: true });
  const folder = name => page.locator(`.folder-drop[data-folder="${name}"]`);
  await drag(page, tile('Apple'), folder('Shapes'));
  assert.match(await page.locator('#feedback').textContent(), /different folder/);
  assert.equal(await tile('Apple').isEnabled(), true);
  await drag(page, tile('Apple'), folder('Fruit'));
  await drag(page, tile('Triangle'), folder('Shapes'));
  await drag(page, tile('Dog'), folder('Animals'));
  await done(page, /sorted every tile/);
  assert.equal(await page.locator('.drag-ghost').count(), 0);

  await lesson(page, 'Trace');
  const points = await tracePoints(page);
  await page.mouse.move(points[0].x, points[0].y);
  await page.mouse.down();
  const drawing = await page.locator('.trace-area').boundingBox();
  await page.mouse.move(points[0].x + 50, drawing.y + drawing.height * .93, { steps: 5 });
  await page.mouse.up();
  assert.match(await page.locator('#feedback').textContent(), /left the line/);
  assert.equal(await page.locator('.trace-dot.done').count(), 1);
  await page.mouse.move(points[0].x, points[0].y);
  await page.mouse.down();
  for (const point of points.slice(1)) await page.mouse.move(point.x, point.y, { steps: 9 });
  await page.mouse.up();
  await done(page, /whole line/);

  await lesson(page, 'Click and hold');
  const pad = page.locator('.practice-pad');
  await pad.click();
  assert.match(await page.locator('#feedback').textContent(), /try again/);
  const holdAt = await center(pad);
  await page.mouse.move(holdAt.x, holdAt.y);
  await page.mouse.down();
  await done(page, /pad lit up/);
  await page.mouse.up();

  await lesson(page, 'Double-click');
  await pad.click();
  assert.equal(await page.locator('#next').isVisible(), false);
  await pad.dblclick();
  await done(page, /opened the box/);

  await lesson(page, 'Right-click');
  await pad.click({ button: 'right' });
  assert.equal(await page.locator('#pin-card').isVisible(), true);
  await page.getByRole('button', { name: 'Pin card' }).click();
  await done(page, /card is pinned/);

  await lesson(page, 'Scroll');
  const wheel = page.getByRole('region', { name: 'Scroll to the garden gate' });
  const scrollAt = await center(wheel);
  await page.mouse.move(scrollAt.x, scrollAt.y);
  const priorScroll = await page.evaluate(() => scrollY);
  await page.mouse.wheel(0, 700);
  await page.waitForFunction(() => {
    const box = document.querySelector('.wheel-box');
    return box.scrollTop + box.clientHeight >= box.scrollHeight - 2;
  });
  assert.equal(await page.evaluate(() => scrollY), priorScroll, 'wheel stays inside the exercise');
  await page.getByRole('button', { name: 'Finish', exact: true }).click();
  await done(page, /garden gate/);

  await lesson(page, 'Folders and files');
  await page.getByRole('button', { name: /Stories/ }).click();
  await page.getByRole('button', { name: /Dragon/ }).click();
  assert.match(await page.locator('#feedback').textContent(), /Look for Moon/);
  await page.getByRole('button', { name: /Desktop/ }).click();
  await page.getByRole('button', { name: /School/ }).click();
  await page.getByRole('button', { name: /Moon/ }).click();
  await done(page, /found Moon/);
  assert.equal(await page.locator('#progress').textContent(), '10 of 10 exercises completed');

  await page.reload();
  assert.equal(await page.locator('#lesson-title').textContent(), 'Folders and files');
  assert.equal(await page.locator('#progress').textContent(), '10 of 10 exercises completed');
  const reset = page.locator('#reset');
  const dialog = page.locator('#reset-dialog');
  await reset.click();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  assert.equal(await page.locator('#progress').textContent(), '10 of 10 exercises completed');
  await reset.click();
  await dialog.getByRole('button', { name: 'Reset progress' }).click();
  await page.waitForFunction(() => document.getElementById('progress').textContent === '0 of 10 exercises completed');
  const stored = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), storageKey);
  assert.deepEqual(stored, { active: 'click', difficulty: 'easy', completed: [] });
  await desktop.close();
  console.log('PASS Mouse Lab mouse: ten exercises, native context click, wrong folder, trace recovery, wheel containment, reset and reload');

  const mobile = await browser.newContext({ viewport: { width: 320, height: 568 }, hasTouch: true, isMobile: true, reducedMotion: 'reduce' });
  const phone = await open(mobile);
  await phone.locator('.target').tap();
  assert.match(await phone.locator('#feedback').textContent(), /1 of 5/);
  await lesson(phone, 'Aim', 'tap');
  for (let i = 0; i < 6; i++) await phone.locator('.target').tap();
  await done(phone, /all 6 targets/);
  await lesson(phone, 'Moving targets', 'tap');
  assert.equal(await phone.getByRole('checkbox', { name: 'Pause moving targets' }).isChecked(), true);
  for (let i = 0; i < 3; i++) await phone.locator('.target').tap();
  await done(phone, /all 3 targets/);

  await lesson(phone, 'Drag and drop', 'tap');
  const cdp = await mobile.newCDPSession(phone);
  const apple = await center(phone.getByRole('button', { name: 'Apple', exact: true }));
  const fruit = await center(phone.locator('.folder-drop[data-folder="Fruit"]'));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [apple] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [fruit] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  assert.match(await phone.locator('#feedback').textContent(), /Apple is in Fruit/);
  for (const [tileName, folderName] of [['Triangle', 'Shapes'], ['Dog', 'Animals']]) {
    await phone.getByRole('button', { name: tileName, exact: true }).tap();
    assert.match(await phone.locator('#feedback').textContent(), new RegExp(`Choose a folder for ${tileName}`));
    await phone.locator(`.folder-drop[data-folder="${folderName}"]`).tap();
    assert.equal(await phone.getByRole('button', { name: `${tileName} ✓`, exact: true }).isDisabled(), true, await phone.locator('#feedback').textContent());
  }
  await done(phone, /sorted every tile/);

  await lesson(phone, 'Trace', 'tap');
  const touchPath = await tracePoints(phone);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [touchPath[0]] });
  for (const point of touchPath.slice(1)) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [point] });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await done(phone, /whole line/);

  await lesson(phone, 'Click and hold');
  const touchPad = await center(phone.locator('.practice-pad'));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [touchPad] });
  await done(phone, /pad lit up/);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });

  await lesson(phone, 'Double-click', 'tap');
  await phone.locator('.practice-pad').tap();
  await phone.locator('.practice-pad').tap();
  await done(phone, /opened the box/);

  await lesson(phone, 'Right-click', 'tap');
  await phone.getByRole('button', { name: 'Open card menu' }).tap();
  await phone.getByRole('button', { name: 'Pin card' }).tap();
  await done(phone, /card is pinned/);

  await lesson(phone, 'Scroll', 'tap');
  const touchScroll = phone.getByRole('region', { name: 'Scroll to the garden gate' });
  await touchScroll.scrollIntoViewIfNeeded();
  const touchScrollBounds = await touchScroll.boundingBox();
  assert(touchScrollBounds);
  const scrollX = touchScrollBounds.x + touchScrollBounds.width / 2;
  const scrollStartY = touchScrollBounds.y + touchScrollBounds.height - 18;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: scrollX, y: scrollStartY }] });
  for (let n = 32; n <= 128; n += 32) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: scrollX, y: scrollStartY - n }] });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await phone.waitForFunction(() => document.querySelector('.wheel-box').scrollTop > 0);
  await phone.getByRole('button', { name: 'Finish', exact: true }).click();
  await done(phone, /garden gate/);

  await lesson(phone, 'Folders and files', 'tap');
  await phone.getByRole('button', { name: /School/ }).tap();
  await phone.getByRole('button', { name: /Moon/ }).tap();
  await done(phone, /found Moon/);
  for (const viewport of [{ width: 320, height: 568 }, { width: 568, height: 320 }]) {
    await phone.setViewportSize(viewport);
    assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  }
  await mobile.close();
  console.log('PASS Mouse Lab touch: native tap, slower motion setting, drag, sorting alternative, long hold, double tap, card menu, phone and short landscape layout');

  const keyboard = await browser.newContext();
  const keys = await open(keyboard);
  await keys.keyboard.press('Tab');
  assert.equal(await keys.evaluate(() => document.activeElement.getAttribute('aria-label')), 'Back to Arcade');
  await keys.getByRole('button', { name: 'Trace', exact: true }).focus();
  await keys.keyboard.press('Enter');
  assert.equal(await keys.evaluate(() => document.activeElement.id), 'lesson-title');
  await keys.keyboard.press('Tab');
  assert.equal(await keys.evaluate(() => document.activeElement.textContent), 'Mark next dot');
  for (let i = 0; i < 4; i++) await keys.keyboard.press('Enter');
  await done(keys, /whole line/);
  assert.equal(await keys.evaluate(() => document.activeElement.id), 'next');
  await keys.keyboard.press('Enter');
  await keys.keyboard.press('Tab');
  assert.equal(await keys.evaluate(() => document.activeElement.textContent), 'Hold here');
  await keys.keyboard.down('Space');
  await done(keys, /pad lit up/);
  await keys.keyboard.up('Space');
  await keyboard.close();
  console.log('PASS Mouse Lab keyboard: focus order, trace alternate, next lesson, timed hold');

  const denied = await browser.newContext();
  await denied.addInitScript(() => {
    Storage.prototype.getItem = Storage.prototype.setItem = function () {
      throw new DOMException('Storage blocked', 'SecurityError');
    };
  });
  const transient = await open(denied);
  for (let i = 0; i < 5; i++) await transient.locator('.target').click();
  await done(transient, /all 5 targets/);
  await denied.close();
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(localFailures, []);
  assert.deepEqual(remoteRequests, []);
  console.log('PASS Mouse Lab denied-storage fallback; no page errors, missing local assets or external requests');
} finally {
  await browser.close();
  await fixture.close();
}
