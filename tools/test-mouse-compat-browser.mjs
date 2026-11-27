import assert from 'node:assert/strict';
import { chromium, browserLaunchOptions } from './browser-runtime.mjs';
import { startStaticFixture } from './static-fixture.mjs';

const fixture = await startStaticFixture();
const browser = await chromium.launch(browserLaunchOptions);
let failures = 0;

async function run(name, viewport, scenario, hasTouch = false) {
  const context = await browser.newContext({ viewport, hasTouch });
  const page = await context.newPage();
  page.setDefaultTimeout(7000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(fixture.base + '/' + name + '/');
    await scenario(page, context);
    assert.deepEqual(errors, []);
    console.log(`PASS ${name} ${viewport.width}x${viewport.height}${hasTouch ? ' touch' : ' mouse'}`);
  } catch (error) {
    failures++;
    console.error(`FAIL ${name} ${viewport.width}x${viewport.height}: ${error.message}`);
  } finally {
    await context.close();
  }
}

async function center(locator) {
  const bounds = await locator.boundingBox();
  assert(bounds);
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
}

const desktop = { width: 1280, height: 800 };
const phone = { width: 390, height: 844 };
const startMines = page => page.locator('[data-diff=easy]').click();
const state = page => page.evaluate(() => MinesweeperAutosave.capture());

try {
  await run('minesweeper', desktop, async page => {
    await startMines(page);
    const first = page.locator('#grid .cell').first();
    await first.click({ button: 'right' });
    let capture = await state(page);
    assert.equal(capture.grid[0][0].flagged, true, 'right mouse button flags the first cell');
    assert.equal(capture.minesPlaced, false, 'flagging does not reveal the cell or place mines');
    await first.click({ button: 'right' });
    assert.equal((await state(page)).grid[0][0].flagged, false, 'second right-click removes the flag');
    await first.click({ button: 'middle' });
    assert.equal((await state(page)).minesPlaced, false, 'middle button does not reveal a cell');

    const cellAt = await center(first);
    await page.mouse.move(cellAt.x, cellAt.y);
    await page.mouse.down();
    await page.mouse.move(cellAt.x + 75, cellAt.y + 50, { steps: 5 });
    await page.mouse.up();
    assert.equal((await state(page)).minesPlaced, false, 'dragging across the board cancels the click');

    await page.mouse.move(cellAt.x, cellAt.y);
    await page.mouse.down();
    await page.waitForFunction(() => MinesweeperAutosave.capture().grid[0][0].flagged);
    await page.mouse.up();
    capture = await state(page);
    assert.equal(capture.minesPlaced, false, 'holding the left mouse button still flags without revealing');
    await first.click({ button: 'right' });
    await first.click();
    assert.equal((await state(page)).grid[0][0].revealed, true, 'left click reveals the cell');
  });

  await run('minesweeper', phone, async (page, context) => {
    await page.locator('[data-diff=easy]').tap();
    const first = page.locator('#grid .cell').first();
    const cellAt = await center(first);
    const touch = await context.newCDPSession(page);
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [cellAt] });
    await page.waitForFunction(() => MinesweeperAutosave.capture().grid[0][0].flagged);
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    let capture = await state(page);
    assert.equal(capture.minesPlaced, false, 'touch long press still flags without revealing');
    assert.equal(capture.grid[0][0].revealed, false);
    await page.locator('#grid .cell').nth(1).tap();
    capture = await state(page);
    assert.equal(capture.grid[0][1].revealed, true, 'a short tap still reveals');
    assert.equal(capture.grid[0][0].flagged, true, 'neighbor stays flagged when the first minefield is placed');
  }, true);

  await run('mini-golf', desktop, async page => {
    await page.locator('[onclick="MiniGolf.startOrContinue()"]').click();
    const slider = page.locator('#mg-power-slider');
    const stickAt = await center(page.locator('#mg-stick'));
    await page.mouse.move(stickAt.x, stickAt.y);
    await page.mouse.down();
    await page.mouse.move(stickAt.x + 26, stickAt.y + 14, { steps: 10 });
    await page.mouse.up();
    await slider.click();
    assert(Number(await slider.inputValue()) > 0);
    await page.locator('#mg-shoot-btn').click();
    assert.equal(await page.locator('#mg-strokes').textContent(), '1');
  });

  await run('simon', desktop, async page => {
    await page.locator('#si-menu [onclick="SimonGame.start()"]').click();
    await page.waitForFunction(() => SimonAutosave.capture().phase === 'input');
    const first = await page.evaluate(() => SimonAutosave.capture().seq[0]);
    await page.locator(`#si-${first}`).click();
    await page.waitForFunction(() => SimonAutosave.capture().seq.length === 2);
    assert.equal(await page.locator('#si-level').textContent(), '2');
  });

  await run('sorry', desktop, async page => {
    await page.locator('#startBtn').click();
    const deckSize = await page.evaluate(() => SorryGame.getState().deck.length);
    await page.locator('#boardCard').click();
    assert.equal(await page.evaluate(() => SorryGame.getState().deck.length), deckSize - 1);
  });

  await run('music-maker', desktop, async page => {
    const pad = page.locator('.pad').last();
    const padAt = await center(pad);
    await page.mouse.move(padAt.x, padAt.y);
    await page.mouse.down();
    await page.waitForFunction(() => [...document.querySelectorAll('.pad')].at(-1).classList.contains('pressed'));
    await page.mouse.up();
    assert.equal(await pad.evaluate(el => el.classList.contains('pressed')), false);
  });

  await run('train-trouble', desktop, async page => {
    await page.locator('#campaignBtn').click();
    await page.locator('#job-0').click();
    const train = page.locator('#send-t1');
    await train.click();
    assert.equal(await page.evaluate(() => TrainTrouble.debug().paused), false);
    await page.locator('#brake-t1').click();
    assert.equal(await page.evaluate(() => TrainTrouble.debug().rail.trains[0].braking), true);
  });

  await run('retro-vault', desktop, async page => {
    await page.locator('button.tile[data-game="snake"]').click();
    await page.locator('button[data-control="down"]').click();
    assert.equal(await page.evaluate(() => s.d.next), 'down');
    await page.locator('#gameMenu').click();
    await page.locator('#resume').click();
    assert.equal(await page.locator('#menu').isHidden(), true);
  });

  await run('monopoly', desktop, async page => {
    await page.locator('#startBtn').click();
    const before = await page.evaluate(() => MonopolyGame.getState());
    await page.locator('[data-act="roll"]').click();
    await page.evaluate(() => MonopolyGame.whenIdle());
    const after = await page.evaluate(() => MonopolyGame.getState());
    assert.notEqual(after.phase, before.phase, 'mouse click resolves the opening roll');
    assert.notDeepEqual(after.players, before.players, 'opening roll changes the board');
  });

  assert.equal(failures, 0, 'All focused input checks pass');
} finally {
  await browser.close();
  await fixture.close();
}
