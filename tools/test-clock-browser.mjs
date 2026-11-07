import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium, browserLaunchOptions } from './browser-runtime.mjs';
import { startStaticFixture } from './static-fixture.mjs';

const fixture = await startStaticFixture();
const browser = await chromium.launch(browserLaunchOptions);
const output = new URL('../test-results/clock/', import.meta.url);
await mkdir(output, { recursive: true });
const errors = [];
let scenarios = 0;

async function inspectClock(page, label) {
  await page.waitForFunction(() => {
    const canvas = document.getElementById('clock-canvas');
    return canvas.clientWidth > 0 && canvas.width === Math.round(canvas.clientWidth * devicePixelRatio) && canvas.height === Math.round(canvas.clientHeight * devicePixelRatio);
  });
  const result = await page.locator('#clock-canvas').evaluate(canvas => {
    const rect = canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    const ctx = canvas.getContext('2d');
    const center = Array.from(ctx.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data);
    return {
      width: rect.width, height: rect.height,
      backingWidth: canvas.width, backingHeight: canvas.height,
      contentWidth: canvas.clientWidth, contentHeight: canvas.clientHeight,
      ratio, center,
      inView: rect.x >= 0 && rect.y >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight
    };
  });
  assert.ok(Math.abs(result.width - result.height) <= 1, `${label}: circular frame stays square`);
  assert.equal(result.backingWidth, Math.round(result.contentWidth * result.ratio), `${label}: backing width matches rendered content`);
  assert.equal(result.backingHeight, Math.round(result.contentHeight * result.ratio), `${label}: backing height matches rendered content`);
  assert.ok(result.center[0] < 40 && result.center[1] < 40 && result.center[2] < 40 && result.center[3] === 255, `${label}: hand pivot is at the center of the visible face`);
  assert.ok(result.inView, `${label}: entire clock is visible`);
  for (const element of await page.locator('.clock-ui:visible button').all()) {
    const rect = await element.boundingBox();
    const viewport = page.viewportSize();
    assert.ok(rect && rect.x >= -1 && rect.y >= -1 && rect.x + rect.width <= viewport.width + 1 && rect.y + rect.height <= viewport.height + 1, `${label}: game controls stay visible`);
  }
}

try {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 320, height: 568 }, { width: 844, height: 390 }, { width: 568, height: 320 }]) {
    for (const deviceScaleFactor of [1, 2]) {
      const context = await browser.newContext({ viewport, deviceScaleFactor, hasTouch: viewport.width < 500 });
      const page = await context.newPage();
      page.setDefaultTimeout(6000);
      page.on('pageerror', error => errors.push(error.message));
      try {
        await page.goto(`${fixture.base}/time/`);
        for (const mode of [1, 2, 3]) {
          await page.evaluate(mode => ClockGame.start(mode), mode);
          const label = `${viewport.width}x${viewport.height} DPR ${deviceScaleFactor} mode ${mode}`;
          await inspectClock(page, label);
          scenarios++;
          if (deviceScaleFactor === 2 && mode === 3) await page.screenshot({ path: new URL(`clock-${viewport.width}x${viewport.height}.png`, output).pathname });
        }
        await page.evaluate(() => ClockGame.restoreState({ mode: 3, targetH: 12, targetM: 15, userH: 12, userM: 0, input: '', active: true }));
        const rect = await page.locator('#clock-canvas').boundingBox();
        const x = rect.x + rect.width * .84, y = rect.y + rect.height / 2;
        if (viewport.width < 500) await page.touchscreen.tap(x, y);
        else await page.mouse.click(x, y);
        assert.equal(await page.evaluate(() => ClockGame.captureState().userM), 15, 'Pointer at three o clock sets 15 minutes');
        const before = await page.evaluate(() => ClockGame.captureState());
        await page.setViewportSize({ width: viewport.height, height: viewport.width });
        await inspectClock(page, 'After rotation');
        assert.deepEqual(await page.evaluate(() => ClockGame.captureState()), before, 'Rotation preserves the exact question and hand setting');
        scenarios++;
        await page.evaluate(saved => {
          const view = document.getElementById('g-clock');
          view.style.display = 'none';
          ClockGame.restoreState(saved);
        }, before);
        const hiddenBacking = await page.locator('#clock-canvas').evaluate(canvas => ({ width: canvas.width, height: canvas.height }));
        assert.ok(hiddenBacking.width > 1 && hiddenBacking.height > 1, 'A hidden restore preserves the previous bitmap until reveal');
        await page.setViewportSize(viewport);
        await page.evaluate(() => { document.getElementById('g-clock').style.display = 'flex'; });
        await page.waitForFunction(() => {
          const canvas = document.getElementById('clock-canvas');
          return canvas.clientWidth > 0 && canvas.width === Math.round(canvas.clientWidth * devicePixelRatio) && canvas.height === Math.round(canvas.clientHeight * devicePixelRatio);
        });
        await inspectClock(page, 'After hidden restore and reveal');
        assert.deepEqual(await page.evaluate(() => ClockGame.captureState()), before, 'Hidden restore and reveal preserve the exact question and hand setting');
        scenarios++;
      } finally {
        await context.close();
      }
    }
  }
  assert.deepEqual(errors, [], 'No clock page errors');
  console.log(`PASS ${scenarios} clock rendering, pointer and rotation scenarios`);
} finally {
  await browser.close();
  await fixture.close();
}
