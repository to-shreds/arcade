#!/usr/bin/env node
// Real interactions with the shipped UI and the real Worker/DO fixture.
// Engine calls below only inspect state and select legal test moves.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';
import { chromium, browserLaunchOptions } from './browser-runtime.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const out = fileURLToPath(new URL('../test-results/upwords-browser/', import.meta.url));
const base = process.env.ARCADE_UPWORDS_URL || 'http://127.0.0.1:8787';
const api = process.env.ARCADE_UPWORDS_API || 'http://127.0.0.1:8788';
const results = [], errors = [];
let fixture, browser, serverLog = '';
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
await mkdir(out, { recursive: true });

function mapping({ api }) {
  window.__upwordsWireRooms = [];
  window.__upwordsSockets = [];
  window.__upwordsCredential = null;
  const record = data => {
    if (data?.room) window.__upwordsWireRooms.push(data.room);
    if (data?.token) window.__upwordsCredential = data;
  };
  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (input, options) => {
    const url = typeof input === 'string' ? input.replace('https://arcade-chess.jonathanjablon.workers.dev', api) : input;
    const response = await nativeFetch(url, options);
    if (String(url).includes('/api/')) try { record(await response.clone().json()); } catch {}
    return response;
  };
  const NativeWebSocket = window.WebSocket;
  window.WebSocket = class extends NativeWebSocket {
    constructor(url, protocols) {
      const mapped = String(url).replace('wss://arcade-chess.jonathanjablon.workers.dev', api.replace(/^http/, 'ws'));
      if (protocols === undefined) super(mapped); else super(mapped, protocols);
      window.__upwordsSockets.push(this);
      this.addEventListener('message', event => { try { record(JSON.parse(event.data)); } catch {} });
    }
  };
}

async function pageFor(viewport = { width: 1440, height: 900 }, seed = null) {
  const context = await browser.newContext({ viewport, hasTouch: viewport.width < 500 });
  await context.addInitScript(mapping, { api });
  if (seed !== null) await context.addInitScript(seed => {
    const original = crypto.getRandomValues.bind(crypto);
    crypto.getRandomValues = array => array instanceof Uint32Array && array.length === 1 ? (array[0] = seed, array) : original(array);
  }, seed);
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push({ viewport, message: error.message }));
  await page.goto(`${base}/upwords/`);
  await page.waitForFunction(() => !!window.UpwordsGame);
  return { page, context };
}
const state = page => page.evaluate(() => UpwordsGame.getState());
const debug = page => page.evaluate(() => UpwordsGame.getDebug());
const capture = page => page.evaluate(() => UpwordsGame.capture());
async function settled(page) {
  await page.waitForFunction(() => { const d = UpwordsGame.getDebug(); return !d.busy && !d.cpuThinking; }, null, { timeout: 30000 });
}
async function screenshot(page, name) {
  await page.screenshot({ path: `${out}/${name}.png`, fullPage: true, animations: 'disabled', timeout: 30000 });
}
async function run(name, callback) {
  if (process.env.ARCADE_UPWORDS_CASES && !process.env.ARCADE_UPWORDS_CASES.split(',').some(filter => name.includes(filter.trim()))) return;
  const start = Date.now();
  try {
    const evidence = await callback();
    results.push({ name, pass: true, ms: Date.now() - start, evidence });
    console.log('PASS', name);
  } catch (error) {
    if (error.code === 'TEST_ENVIRONMENT_BLOCKED') {
      results.push({ name, pass: null, blocked: true, ms: Date.now() - start, reason: error.message });
      console.log('BLOCKED', name, error.message);
    } else {
      results.push({ name, pass: false, ms: Date.now() - start, error: error.stack });
      console.error('FAIL', name, error.message);
    }
  }
  await writeFile(`${out}/report.json`, JSON.stringify({ results, errors }, null, 2) + '\n');
}
async function showRack(page) {
  if (await page.locator('#handoff').isVisible()) await page.locator('#showRack').click();
}
async function localStart(page, mode = 'hotseat') {
  await page.locator('#mode').selectOption(mode);
  await page.locator('#nameInput0').fill('Alice');
  await page.locator('#nameInput1').fill(mode === 'cpu' ? 'Computer' : 'Bob');
  await page.locator('#localStart').click();
  await page.waitForFunction(() => !!UpwordsGame.getState());
  await showRack(page); await settled(page);
}
async function chooseAction(page, preferStack = false) {
  return page.evaluate(async preferStack => {
    const { chooseCpuAction, previewMove } = await import('/upwords/engine.js');
    const game = UpwordsGame.getState();
    if (preferStack) {
      for (let row = 0; row < 10; row++) for (let col = 0; col < 10; col++) {
        if (!game.board[row][col].length) continue;
        for (let rackIndex = 0; rackIndex < game.players[game.turn].rack.length; rackIndex++) {
          const placements = [{ row, col, rackIndex }];
          if (previewMove(game, placements).valid) return { type: 'play', placements };
        }
      }
    }
    return chooseCpuAction(game, 'normal');
  }, preferStack);
}
async function openingWithStack(page) {
  return page.evaluate(async () => {
    const { applyAction, previewMove, chooseCpuAction } = await import('/upwords/engine.js');
    const game = UpwordsGame.getState(), rack = game.players[game.turn].rack;
    for (const length of [2, 3]) {
      for (let a = 0; a < rack.length; a++) for (let b = 0; b < rack.length; b++) {
        if (a === b) continue;
        for (const c of length === 2 ? [-1] : rack.map((_, index) => index).filter(index => index !== a && index !== b)) {
          const placements = [a, b, c].filter(index => index >= 0).map((rackIndex, index) => ({ row: 4, col: 4 + index, rackIndex }));
          const preview = previewMove(game, placements);
          if (!preview.valid) continue;
          const next = applyAction(game, { type: 'play', placements });
          for (let col = 4; col < 4 + length; col++) for (let rackIndex = 0; rackIndex < next.players[next.turn].rack.length; rackIndex++) {
            const stack = [{ row: 4, col, rackIndex }];
            if (previewMove(next, stack).valid) return { type: 'play', placements };
          }
        }
      }
    }
    return chooseCpuAction(game, 'normal');
  });
}
async function place(page, placements) {
  const boardBefore = await boardBounds(page);
  for (const { row, col, rackIndex } of placements) {
    await page.locator(`#rack [data-rack-index="${rackIndex}"]`).click();
    await page.locator(`#board [data-row="${row}"][data-col="${col}"]`).click();
    await assertBoardUnchanged(page, boardBefore, 'After a tap placement');
  }
  assert.deepEqual((await debug(page)).placements, placements, 'Clicked rack indices and board squares form the exact draft');
}
async function boardBounds(page) {
  return page.locator('#board').evaluate(element => {
    const { x, y, width, height } = element.getBoundingClientRect();
    return { x, y, width, height };
  });
}
async function assertBoardUnchanged(page, expected, label) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const actual = await boardBounds(page);
  for (const key of ['x', 'y', 'width', 'height']) assert.ok(Math.abs(actual[key] - expected[key]) < .1, `${label}: board ${key} stays fixed (${actual[key]} versus ${expected[key]})`);
}
async function dragTile(page, from, to, input = 'mouse', cancel = false) {
  const center = async selector => {
    const rect = await page.locator(selector).boundingBox();
    assert.ok(rect, `Drag target ${selector} is visible`);
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  };
  const start = await center(from), end = await center(to);
  const boardBefore = await boardBounds(page);
  const cdp = input === 'touch' ? await page.context().newCDPSession(page) : null;
  const touch = (type, point) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: point ? [{ ...point, id: 1, radiusX: 6, radiusY: 6 }] : [] });
  if (cdp) await touch('touchStart', start);
  else { await page.mouse.move(start.x, start.y); await page.mouse.down(); }
  // Lift first, then observe the painted tile's offset. Drive its visible center
  // to the desired destination, independently of the implementation's constants.
  const lift = { x: start.x, y: start.y - 10 };
  if (cdp) await touch('touchMove', lift); else await page.mouse.move(lift.x, lift.y);
  assert.equal(await page.locator('.tile-drag-ghost').count(), 1, 'A real pointer gesture lifts one tile');
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const ghost = await page.locator('.tile-drag-ghost').boundingBox();
  const endPointer = { x: end.x + lift.x - ghost.x - ghost.width / 2, y: end.y + lift.y - ghost.y - ghost.height / 2 };
  for (let step = 1; step <= 10; step++) {
    const point = { x: lift.x + (endPointer.x - lift.x) * step / 10, y: lift.y + (endPointer.y - lift.y) * step / 10 };
    if (cdp) await touch('touchMove', point); else await page.mouse.move(point.x, point.y);
  }
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const painted = await page.locator('.tile-drag-ghost').boundingBox();
  assert.ok(Math.abs(painted.x + painted.width / 2 - end.x) < 1 && Math.abs(painted.y + painted.height / 2 - end.y) < 1, `The letter appears over the intended destination: ${JSON.stringify({ from, to, input, end, endPointer, painted })}`);
  const targetIsBoard = to.startsWith('#board');
  if (targetIsBoard && !cancel) {
    assert.ok(await page.locator(to).evaluate(e => e.classList.contains('drag-over') || e.classList.contains('drop-blocked')), 'The highlight follows the visible letter');
    if (cdp) {
      const fingerCell = await page.evaluate(point => document.elementFromPoint(point.x, point.y)?.closest('#board .cell')?.getAttribute('aria-label'), endPointer);
      assert.notEqual(fingerCell, await page.locator(to).getAttribute('aria-label'), 'The finger is below the visible destination, not hiding it');
    }
  }
  if (cdp) { await touch(cancel ? 'touchCancel' : 'touchEnd'); await cdp.detach(); }
  else { if (cancel) await page.keyboard.press('Escape'); await page.mouse.up(); }
  await page.locator('.tile-drag-ghost').waitFor({ state: 'detached' });
  await assertBoardUnchanged(page, boardBefore, 'After a drag or cancellation');
}
async function confirmDialog(page, action) {
  if (!await page.locator('#modal').isVisible()) return;
  const buttons = page.locator('#modalActions button');
  const count = await buttons.count();
  for (let i = 0; i < count; i++) {
    if (action.test(await buttons.nth(i).innerText())) { await buttons.nth(i).click(); return; }
  }
  throw new Error(`Expected ${action} confirmation, found: ${await page.locator('#modalActions').innerText()}`);
}
async function perform(page, action = null, useDrag = false) {
  await showRack(page); await settled(page);
  action ||= await chooseAction(page);
  const before = await state(page);
  if (action.type === 'play') {
    if (useDrag) {
      for (const tile of action.placements) await dragTile(page, `#rack [data-rack-index="${tile.rackIndex}"]`, `#board [data-row="${tile.row}"][data-col="${tile.col}"]`, typeof useDrag === 'string' ? useDrag : 'mouse');
      assert.deepEqual((await debug(page)).placements, action.placements, 'Drag inputs build the exact move intent');
    } else await place(page, action.placements);
    assert.equal(await page.locator('#play').isDisabled(), false, 'A legal preview enables Play');
    if (useDrag) {
      assert.ok(await page.locator('.arcade-app').evaluate(e => e.scrollHeight <= e.clientHeight + 1), 'A dragged move keeps all play controls in the screen');
      if (typeof useDrag === 'string') await screenshot(page, `drag-${useDrag}-ready`);
    }
    await page.locator('#play').click();
  } else if (action.type === 'exchange') {
    await page.locator('#exchange').click();
    await page.locator(`#modal [data-exchange-index="${action.rackIndex}"]`).click();
    await confirmDialog(page, /swap|exchange/i);
  } else {
    await page.locator('#pass').click(); await confirmDialog(page, /pass/i);
  }
  await page.waitForFunction(number => UpwordsGame.getState()?.moveNumber > number, before.moveNumber);
  if ((await debug(page)).mode !== 'cpu') await settled(page);
  const after = await state(page);
  if ((await debug(page)).mode !== 'cpu') assert.equal(after.moveNumber, before.moveNumber + 1, 'One submitted action advances exactly one turn');
  if (action.type === 'play') {
    for (const tile of action.placements) assert.equal(after.board[tile.row][tile.col].length, before.board[tile.row][tile.col].length + 1, 'The committed tile changes the real stack');
    if (!after.finished) assert.ok(after.players[before.turn].score > before.players[before.turn].score, 'A legal word adds points');
  }
  return { before, after, action };
}
function sharedState(game) {
  if (!game) return game;
  return { ...game, players: game.players.map(({ rack, ...player }) => ({ ...player, rackCount: player.rackCount ?? rack?.length })) };
}
async function sameBoard(a, b) {
  const expected = sharedState(await state(a));
  await b.waitForFunction(expected => {
    const game = UpwordsGame.getState();
    if (!game) return false;
    const value = { ...game, players: game.players.map(({ rack, ...player }) => ({ ...player, rackCount: player.rackCount ?? rack?.length })) };
    return JSON.stringify(value) === JSON.stringify(expected);
  }, expected);
  assert.deepEqual(sharedState(await state(b)), expected);
}
async function roomAction(page, action) {
  return page.evaluate(async ({ api, action }) => {
    const { room } = UpwordsGame.getDebug(), credential = window.__upwordsCredential;
    const response = await fetch(`${api}/api/arcade/rooms/${room.code}/actions`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${credential.token}` },
      body: JSON.stringify(action)
    });
    return { status: response.status, body: await response.json() };
  }, { api, action });
}
async function networkSetup(page) {
  if (!await page.locator('#setup').isVisible()) {
    await page.locator('#newGame').click();
    await page.getByRole('button', { name: 'Game setup', exact: true }).click();
  }
  await page.locator('#mode').selectOption('network');
}
function assertPrivateGame(game, ownSeat) {
  assert.equal(Array.isArray(game.players[ownSeat].rack), true, 'Only the recipient receives their rack');
  assert.equal('rack' in game.players[1 - ownSeat], false, 'The opponent rack is absent, not hidden by CSS');
  for (const field of ['bag', 'seed', 'rng']) assert.equal(field in game, false, `${field} cannot reveal future draws`);
}
async function hasLanInterface() {
  try { return Object.values(networkInterfaces()).flat().some(address => address && !address.internal); }
  catch { return (await readFile('/proc/net/dev', 'utf8')).split('\n').slice(2).map(line => line.split(':')[0].trim()).filter(Boolean).some(name => name !== 'lo'); }
}

try {
  if (!process.env.ARCADE_UPWORDS_USE_FIXTURE && !process.env.ARCADE_UPWORDS_URL) {
    fixture = spawn(process.execPath, ['guess-who/test-server.mjs'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    fixture.stdout.on('data', bytes => { serverLog += bytes; });
    fixture.stderr.on('data', bytes => { serverLog += bytes; });
  }
  for (let n = 0; ; n++) {
    try { if ((await fetch(`${base}/upwords/`)).ok) break; } catch {}
    if (n === 100 || fixture?.exitCode != null) throw new Error(`Upwords fixture failed to start: ${serverLog}`);
    await delay(100);
  }
  browser = await chromium.launch({ ...browserLaunchOptions, args: [...browserLaunchOptions.args, '--disable-gpu', '--allow-loopback-in-peer-connection', '--disable-features=WebRtcHideLocalIpsWithMdns'] });

  await run('dictionary, draft editing, exact reload, hotseat privacy and stacking', async () => {
    const { page, context } = await pageFor();
    try {
      await localStart(page);
      await page.locator('.dictionary-panel summary').click();
      for (const [word, valid] of [['UN', true], ['AL', true], ['OK', true], ['CAT', true], ['PLAYED', true], ['XYZNOTWORD', false], ['LONDON', false]]) {
        await page.locator('#wordCheck').fill(word); await page.locator('#wordCheck').press('Enter');
        const result = await page.locator('#wordResult').innerText();
        assert.ok(result.includes(word), 'Dictionary feedback identifies the checked word');
        assert.equal(/not|invalid|isn.t|is not/i.test(result.replace(word, '')), !valid, `Dictionary feedback for ${word}`);
      }
      await page.locator('.dictionary-panel summary').click();
      let opening = await openingWithStack(page);
      for (let attempts = 0; opening.type !== 'play' && attempts < 4; attempts++) {
        await perform(page, opening); await showRack(page); opening = await openingWithStack(page);
      }
      assert.equal(opening.type, 'play', 'The opening rack has a legal word');
      const initial = await state(page);
      await place(page, opening.placements.map((tile, index) => ({ ...tile, row: 0, col: index })));
      assert.equal(await page.locator('#play').isDisabled(), true, 'An otherwise valid word cannot open away from the center');
      assert.match(await page.locator('#previewNote').innerText(), /center/i);
      assert.deepEqual(await state(page), initial, 'An invalid preview consumes no tiles or points');
      await page.locator('#clear').click();
      await place(page, opening.placements);
      assert.equal(await page.locator('#play').isDisabled(), false);
      await page.locator('#undo').click();
      assert.equal((await debug(page)).placements.length, opening.placements.length - 1);
      assert.deepEqual(await state(page), initial, 'Undo never commits or redraws rack tiles');
      await page.locator('#clear').click();
      assert.equal((await debug(page)).placements.length, 0);
      assert.deepEqual(await state(page), initial, 'Clear preserves score, bag and turn');
      await page.locator('#shuffle').click();
      assert.deepEqual(await state(page), initial, 'Shuffle only changes display order');
      await place(page, opening.placements);
      await delay(750);
      const saved = await state(page), draft = (await debug(page)).placements;
      await page.reload(); await page.waitForFunction(() => !!window.UpwordsGame);
      await page.locator('.arcade-save-primary').waitFor({ state: 'visible' });
      await page.locator('.arcade-save-primary').click();
      await page.waitForFunction(() => !!UpwordsGame.getState());
      assert.equal(await page.locator('#handoff').isVisible(), true, 'Restoring a hotseat game requires the privacy handoff');
      assert.equal(await page.locator('#board .placed').count(), 0, 'The saved unplayed word is concealed until the player reveals their rack');
      assert.equal(await page.locator('#rack').innerText().then(text => /[A-Z]/i.test(text)), false, 'Restored rack letters are absent behind the handoff');
      assert.equal(await page.locator('#previewWords').textContent(), '', 'The saved word is absent from the concealed preview');
      assert.equal(await page.locator('#draftFeedback').isVisible(), false, 'Empty or concealed previews take no screen space');
      assert.equal(await page.locator('#play').isDisabled(), true, 'A concealed restored draft cannot be submitted');
      await screenshot(page, 'restored-draft-curtain');
      await showRack(page); await settled(page);
      assert.deepEqual(await state(page), saved, 'Native reload restores the exact game, bag, racks, scores and turn');
      assert.deepEqual((await debug(page)).placements, draft, 'Unsubmitted placements survive reload');
      assert.equal(await page.locator('#play').isDisabled(), false, 'Restored draft is playable');
      await page.locator('#play').click();
      await page.waitForFunction(number => UpwordsGame.getState()?.moveNumber === number + 1, saved.moveNumber);
      // The resolved turn is saved before the next rack/curtain is rendered.
      // Model advancement alone can precede the native IndexedDB save finishing.
      await settled(page);
      assert.equal(await page.locator('#handoff').isVisible(), true, 'Passing the device hides the next rack');
      const concealed = await page.locator('#rack').innerText();
      assert.equal(/[A-Z]/.test(concealed.replace(/Your|tiles/g, '')), false, 'Opponent letters are absent from concealed rack text');
      assert.equal(await page.locator('#play').isDisabled(), true, 'The curtain prevents accidental play');
      await screenshot(page, 'hotseat-curtain');
      await showRack(page);
      let stack = null;
      for (let number = 0; number < 12 && !(await state(page)).finished; number++) {
        const action = await chooseAction(page, true), before = await state(page);
        const changesStack = action.type === 'play' && action.placements.some(tile => before.board[tile.row][tile.col].length > 0);
        const move = await perform(page, action);
        if (changesStack) { stack = move; break; }
      }
      assert.ok(stack, 'Real rack-and-board clicks produce a scored stacking move');
      await showRack(page);
      assert.ok(await page.locator('#board [data-height="2"]').count() > 0, 'Raised stack heights are rendered');
      await screenshot(page, 'hotseat-stacked');
      return { exactReload: true, draftRestored: true, privacyCurtain: true, stackedMove: stack.after.lastMove };
    } finally { await screenshot(page, 'last-hotseat').catch(() => {}); await context.close(); }
  });

  for (const input of ['mouse', 'touch']) await run(`${input} dragging, cancellation, rearrangement, reload and actual stacking`, async () => {
    const { page, context } = await pageFor({ width: 390, height: 640 }, 4);
    const rack = index => `#rack [data-rack-index="${index}"]`, cell = (row, col) => `#board [data-row="${row}"][data-col="${col}"]`;
    try {
      await localStart(page);
      const initial = await state(page), index = initial.players[0].rack.indexOf('QU');
      assert.ok(index >= 0, 'The physical rack contains Qu and duplicate letters');
      await dragTile(page, rack(index), cell(4, 4), input);
      assert.deepEqual((await debug(page)).placements, [{ row: 4, col: 4, rackIndex: index }]);
      assert.equal((await debug(page)).selected, null, 'The release does not cause an extra selection or take-back');
      await dragTile(page, cell(4, 4), cell(4, 5), input);
      const draft = (await debug(page)).placements;
      assert.deepEqual(draft, [{ row: 4, col: 5, rackIndex: index }]);
      await dragTile(page, rack(1), cell(4, 5), input);
      assert.deepEqual((await debug(page)).placements, draft, 'Dropping onto a draft tile preserves both physical tiles');
      await dragTile(page, rack(2), '#help', input);
      assert.deepEqual((await debug(page)).placements, draft, 'An outside drop restores the original draft');
      assert.equal(await page.locator('#modal').isVisible(), false, 'Releasing over Help cannot accidentally click it');
      await dragTile(page, rack(2), cell(4, 6), input, true);
      assert.deepEqual((await debug(page)).placements, draft, 'Escape or native touch cancellation leaves the draft intact');
      if (input === 'touch') {
        const box = await page.locator(rack(3)).boundingBox();
        await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
      } else await page.locator(rack(3)).click();
      assert.equal((await debug(page)).selected, 3, 'The next real tap after cancellation works');
      await page.locator(cell(4, 6)).click();
      await dragTile(page, cell(4, 5), rack(index), input);
      assert.deepEqual((await debug(page)).placements, [{ row: 4, col: 6, rackIndex: 3 }]);
      const oldOrder = (await capture(page)).rackOrder;
      await dragTile(page, rack(0), rack(3), input);
      const changedOrder = (await capture(page)).rackOrder;
      assert.notDeepEqual(changedOrder, oldOrder, 'Rack drag changes display order');
      assert.deepEqual([...changedOrder].sort(), [...oldOrder].sort(), 'Rack drag preserves each physical index exactly once');
      assert.deepEqual(await state(page), initial, 'No drag consumes tiles, scores, bag entries or turns');
      const savedDraft = (await debug(page)).placements;
      await page.evaluate(() => ArcadeSave.saveNow());
      await page.reload(); await page.waitForFunction(() => !!window.UpwordsGame);
      await page.locator('.arcade-save-primary').click(); await page.waitForFunction(() => !!UpwordsGame.getState());
      assert.equal(await page.locator('#handoff').isVisible(), true);
      assert.equal(await page.locator('#board .placed').count(), 0, 'Reloaded dragged tiles stay concealed');
      await showRack(page);
      assert.deepEqual((await debug(page)).placements, savedDraft);
      assert.deepEqual((await capture(page)).rackOrder, changedOrder, 'Native reload restores dragged rack order');
      await page.locator('#clear').click();
      const opening = await openingWithStack(page);
      assert.equal(opening.type, 'play');
      await perform(page, opening, input); await showRack(page);
      const stack = await chooseAction(page, true), before = await state(page);
      assert.equal(stack.type, 'play');
      assert.ok(stack.placements.some(p => before.board[p.row][p.col].length > 0));
      await perform(page, stack, input); await showRack(page);
      await screenshot(page, `drag-${input}`);
      return { realPointer: input, quAndDuplicates: true, canceledSafely: true, exactReload: true, stacked: true };
    } finally { await screenshot(page, `last-drag-${input}`).catch(() => {}); await context.close(); }
  });

  await run('computer responds once and returns controls', async () => {
    const { page, context } = await pageFor();
    try {
      await localStart(page, 'cpu');
      const before = await state(page);
      await perform(page, await chooseAction(page));
      await page.waitForFunction(number => UpwordsGame.getState()?.moveNumber === number + 2, before.moveNumber, { timeout: 30000 });
      await settled(page);
      const after = await state(page);
      assert.equal(after.turn, before.turn, 'Computer returns the turn to the human');
      assert.equal(after.history.length, 2, 'One human action produces only one computer response');
      assert.equal(await page.locator('#handoff').isVisible(), false, 'Computer mode never asks to pass the device');
      assert.equal(await page.locator('#pass').isDisabled(), false, 'Human controls are available after thinking');
      await screenshot(page, 'computer-response');
      return { moves: after.moveNumber, history: after.history, cpuThinking: (await debug(page)).cpuThinking };
    } finally { await screenshot(page, 'last-computer').catch(() => {}); await context.close(); }
  });

  await run('swap confirmation, consecutive passes and final deductions', async () => {
    const { page, context } = await pageFor();
    try {
      await localStart(page);
      const initial = await state(page), fixedBoard = await boardBounds(page);
      await page.locator('#exchange').click();
      assert.equal(await page.locator('#confirmExchange').isDisabled(), true, 'A swap requires selecting a rack tile');
      await page.locator('#modal [data-exchange-index="0"]').click();
      await page.locator('#modalActions').getByRole('button', { name: 'Cancel', exact: true }).click();
      assert.deepEqual(await state(page), initial, 'Canceling an exchange leaves the full game unchanged');
      await perform(page, { type: 'exchange', rackIndex: 0 });
      const swapped = await state(page);
      assert.equal(swapped.lastMove.type, 'exchange');
      assert.equal(swapped.bag.length, initial.bag.length);
      assert.equal(swapped.players[0].rack.length, 7);
      assert.equal(swapped.players[0].score, 0);
      await perform(page, { type: 'pass' });
      assert.equal((await state(page)).passes, 1);
      await perform(page, { type: 'pass' });
      const finished = await state(page);
      assert.equal(finished.finished, true);
      await assertBoardUnchanged(page, fixedBoard, 'End-of-game status');
      assert.equal(finished.endReason, 'passes');
      assert.deepEqual(finished.players.map(player => player.score), [-35, -35], 'Seven unused tiles each deduct exactly 35 points');
      assert.equal(await page.locator('#result').isVisible(), true);
      assert.equal(await page.locator('#play').isDisabled(), true);
      assert.equal(await page.locator('#handoff').isVisible(), false);
      await screenshot(page, 'finished-by-passes');
      return { swapUsesTurn: true, canceledSwapPreservedState: true, finalScores: [-35, -35] };
    } finally { await screenshot(page, 'last-swap-pass').catch(() => {}); await context.close(); }
  });

  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 390, height: 640 }, { width: 320, height: 568 }, { width: 844, height: 390 }]) {
    await run(`viewport ${viewport.width}x${viewport.height}`, async () => {
      const { page, context } = await pageFor(viewport);
      try {
        await localStart(page);
        const before = await state(page);
        const geometry = await page.evaluate(() => {
          const bounds = element => { const r = element.getBoundingClientRect(); return { width: r.width, height: r.height, left: r.left, right: r.right, top: r.top, bottom: r.bottom }; };
          return { width: innerWidth, scrollWidth: document.documentElement.scrollWidth, board: bounds(document.querySelector('#board')), rack: bounds(document.querySelector('#rack')), controls: [...document.querySelectorAll('#play,#undo,#clear,#exchange,#pass,#zoom')].map(element => ({ id: element.id, ...bounds(element) })) };
        });
        assert.ok(geometry.scrollWidth <= geometry.width + 1, 'No horizontal document overflow');
        assert.ok(geometry.board.top >= 0 && geometry.board.bottom <= viewport.height + 1, 'The whole board fits vertically');
        assert.ok(await page.locator('.arcade-app').evaluate(e => e.scrollHeight <= e.clientHeight + 1), 'The play screen requires no vertical scrolling');
        if (viewport.width < 500) assert.ok(geometry.board.width >= viewport.width - 24, 'Portrait board uses almost the full screen width');
        assert.equal(await page.locator('#draftFeedback').isVisible(), false, 'No persistent rules or empty preview block');
        assert.equal(await page.locator('.board-top').count(), 0, 'The rules row does not consume board space');
        const actionRow = await page.locator('.move-actions').evaluate(e => [...e.children].map(b => b.getBoundingClientRect().top));
        assert.ok(Math.max(...actionRow) - Math.min(...actionRow) <= 3, 'Play, Swap, Pass, Undo and Clear share one compact row');
        assert.ok(geometry.board.width >= 140 && Math.abs(geometry.board.width - geometry.board.height) < 2, 'Board remains square and legible');
        for (const control of geometry.controls) assert.ok(control.width > 0 && control.height >= 24 && control.left >= -1 && control.right <= viewport.width + 1 && control.top >= 0 && control.bottom <= viewport.height + 1, `Control ${control.id} fits the screen`);
        const stable = await boardBounds(page);
        const opening = await openingWithStack(page);
        if (opening.type === 'play') {
          await place(page, opening.placements.slice(0, 1));
          await assertBoardUnchanged(page, stable, 'One-tile error message');
          await page.locator('#clear').click();
          await assertBoardUnchanged(page, stable, 'Cleared preview');
          await place(page, opening.placements);
          assert.equal(await page.locator('#play').isDisabled(), false);
          await assertBoardUnchanged(page, stable, 'Valid scored preview');
          await page.locator('#undo').click();
          await assertBoardUnchanged(page, stable, 'Undo preview');
          await page.locator('#clear').click();
          await assertBoardUnchanged(page, stable, 'Empty preview again');
        }
        await screenshot(page, `playing-${viewport.width}x${viewport.height}`);
        await page.locator('#zoom').click();
        assert.equal(await page.locator('#zoom').getAttribute('aria-pressed'), 'true');
        const zoomed = await page.locator('#boardViewport').evaluate(element => ({ width: element.clientWidth, scrollWidth: element.scrollWidth, documentWidth: document.documentElement.scrollWidth }));
        assert.ok(zoomed.documentWidth <= viewport.width + 1, 'Zoom scrolls inside the board viewport');
        assert.deepEqual(await state(page), before, 'Zoom preserves the current game');
        await page.locator('#zoom').click();
        assert.equal(await page.locator('#zoom').getAttribute('aria-pressed'), 'false');
        await page.locator('#rack [data-rack-index]').first().focus();
        await page.locator('#rack [data-rack-index]').first().press('Enter');
        assert.ok((await debug(page)).selected !== null, 'Rack tiles support keyboard selection');
        return { geometry, zoomed };
      } finally { await screenshot(page, `last-viewport-${viewport.width}x${viewport.height}`).catch(() => {}); await context.close(); }
    });
  }

  await run('Internet peers, private racks, synchronized play, resume and local restoration', async () => {
    const left = await pageFor(), right = await pageFor({ width: 390, height: 844 });
    const a = left.page, b = right.page;
    try {
      await localStart(a);
      const localAction = await chooseAction(a);
      if (localAction.type === 'play') await place(a, localAction.placements.slice(0, 1));
      await delay(750);
      const savedLocal = await capture(a);
      for (const page of [a, b]) await networkSetup(page);
      await a.locator('#nickname').fill('Alice'); await a.locator('#create').click();
      await a.waitForFunction(() => !!UpwordsGame.getDebug().room?.code);
      const code = (await debug(a)).room.code;
      await b.locator('#nickname').fill('Bob'); await b.locator('#joinCode').fill(code); await b.locator('#join').click();
      await a.waitForFunction(() => UpwordsGame.getDebug().room?.ready);
      await Promise.all([settled(a), settled(b)]);
      await a.locator('#startRoom').click();
      await Promise.all([a, b].map(page => page.waitForFunction(() => !!UpwordsGame.getState())));
      await sameBoard(a, b);
      const seats = await Promise.all([a, b].map(async page => (await state(page)).players.findIndex(player => Array.isArray(player.rack))));
      assert.deepEqual([...seats].sort(), [0, 1]);
      const scores = [];
      for (let turn = 0; turn < 4; turn++) {
        await Promise.all([settled(a), settled(b)]);
        const current = await state(a), player = seats[0] === current.turn ? a : b, observer = player === a ? b : a;
        assert.equal(await observer.locator('#play').isDisabled(), true, 'The other player cannot submit a turn');
        await perform(player, await chooseAction(player, true), true);
        await sameBoard(player, observer);
        scores.push((await state(a)).players.map(value => value.score));
      }
      for (const [index, page] of [a, b].entries()) {
        assertPrivateGame(await state(page), seats[index]);
        const wireGames = await page.evaluate(() => __upwordsWireRooms.map(room => room.state?.game).filter(Boolean));
        assert.ok(wireGames.length >= 2, 'Actual HTTP/WebSocket room messages were captured');
        for (const game of wireGames) assertPrivateGame(game, seats[index]);
      }
      const socketCount = await b.evaluate(() => __upwordsSockets.length);
      await b.evaluate(() => __upwordsSockets.filter(socket => socket.readyState === 1).forEach(socket => socket.close(1000, 'browser reconnect check')));
      await b.waitForFunction(count => __upwordsSockets.length > count && __upwordsSockets.some(socket => socket.readyState === 1), socketCount);
      await sameBoard(a, b);
      const savedRoom = await state(b);
      await b.reload(); await b.waitForFunction(() => !!window.UpwordsGame);
      await networkSetup(b); await b.locator('#resumeRoom').click();
      await b.waitForFunction(code => UpwordsGame.getDebug().room?.code === code, code);
      await settled(b); assert.deepEqual(await state(b), savedRoom, 'Refresh/resume restores the exact recipient-specific room view');
      await sameBoard(a, b);
      await screenshot(a, 'online-desktop'); await screenshot(b, 'online-mobile');
      await a.locator('#leave').click(); await confirmDialog(a, /leave room/i);
      await a.waitForFunction(() => !UpwordsGame.getDebug().session);
      await showRack(a);
      assert.deepEqual(await capture(a), savedLocal, 'Leaving multiplayer restores the exact prior local game and draft');
      return { code, scores, ownRackOnly: true, socketReconnect: true, exactRoomResume: true, localDraftRestored: true };
    } finally {
      await Promise.all([screenshot(a, 'last-online-desktop').catch(() => {}), screenshot(b, 'last-online-mobile').catch(() => {})]);
      for (const page of [a, b]) if (!page.isClosed() && (await debug(page).catch(() => null))?.session) await roomAction(page, { type: 'leave' }).catch(() => {});
      await Promise.all([left.context.close(), right.context.close()]);
    }
  });

  await run('real Nearby peers play offline with private rack delivery', async () => {
    if (!await hasLanInterface()) throw Object.assign(new Error('Only loopback is available in this environment. Run this case on a LAN-capable host to verify real RTC pairing; Nearby authority tests run separately.'), { code: 'TEST_ENVIRONMENT_BLOCKED' });
    const left = await pageFor(), right = await pageFor(), pages = [left.page, right.page];
    try {
      for (const [index, page] of pages.entries()) await page.evaluate(async index => {
        const [{ NearbyArcadeSession }, { MemoryNearbyStorage }, protocol, signaling, webrtc, { NearbyRoomService }, engine] = await Promise.all([
          import('/multiplayer/nearby-session.mjs'), import('/multiplayer/nearby-storage.mjs'), import('/multiplayer/protocol.mjs'),
          import('/multiplayer/signaling.mjs'), import('/multiplayer/webrtc.mjs'), import('/multiplayer/nearby-room-service.js'), import('/upwords/engine.js')
        ]);
        window.__upwordsNearby = new NearbyArcadeSession({ storage: new MemoryNearbyStorage() });
        __upwordsNearby.configureSignaling({ ...protocol, ...signaling, ...webrtc }); await __upwordsNearby.initialize();
        window.__upwordsNearbyMessages = [];
        __upwordsNearby.on('socket-message', message => __upwordsNearbyMessages.push(JSON.parse(message.data)));
        const service = new NearbyRoomService({ onEvent: event => {
          if (event.type === 'socket-message') __upwordsNearby.sendSocketMessage(event.targetMemberId, event.socketId, event.data);
          if (event.type === 'socket-close') __upwordsNearby.closeSocket(event.targetMemberId, event.socketId, event);
        } });
        __upwordsNearby.setRpcHandler(async ({ member, operation, payload }) => {
          await service.registerMember({ ...member, connected: true });
          if (operation === 'http') return service.handleHttp(member.memberId, payload);
          if (operation === 'ws-open') return service.openSocket(member.memberId, payload);
          if (operation === 'ws-send') return service.sendSocket(member.memberId, payload);
          return service.closeSocket(member.memberId, payload);
        });
        window.__upwordsNearbyRpc = async (operation, payload) => {
          await new Promise(resolve => setTimeout(resolve, 20)); return __upwordsNearby.requestRoomRpc(operation, payload);
        };
        window.__upwordsTestEngine = engine;
        window.__upwordsNearbyName = index ? 'Nearby Bob' : 'Nearby Alice';
      }, index);
      const [host, guest] = pages;
      await host.evaluate(() => __upwordsNearby.startHost({ nickname: __upwordsNearbyName, avatar: '🎮' }));
      const invitation = await host.evaluate(() => __upwordsNearby.createHostInvitation());
      const answer = await guest.evaluate(wire => __upwordsNearby.joinFromInvitation({ nickname: __upwordsNearbyName, avatar: '🚀' }, wire), invitation.wire);
      await host.evaluate(answer => __upwordsNearby.acceptGuestResponse(answer.wire, answer.pairingId), answer);
      await Promise.all(pages.map(page => page.waitForFunction(() => __upwordsNearby.snapshot().connected === 2, null, { timeout: 25000 })));
      await Promise.all([left.context.setOffline(true), right.context.setOffline(true)]);
      const created = await host.evaluate(() => __upwordsNearbyRpc('http', { path: '/api/arcade/rooms', method: 'POST', body: JSON.stringify({ game: 'upwords', maxPlayers: 2 }) }));
      assert.equal(created.status, 200);
      const code = created.body.code;
      const joined = await guest.evaluate(code => __upwordsNearbyRpc('http', { path: `/api/arcade/rooms/${code}/join`, method: 'POST', body: '{}' }), code);
      assert.equal(joined.status, 200);
      for (const [index, page] of pages.entries()) {
        const token = index ? joined.body.token : created.body.token;
        const opened = await page.evaluate(value => __upwordsNearbyRpc('ws-open', { path: `/api/arcade/rooms/${value.code}/ws?token=${value.token}`, socketId: `upwords-nearby-${value.index}` }), { code, token, index });
        assert.equal(opened.ok, true);
      }
      const started = await host.evaluate(body => __upwordsNearbyRpc('http', { path: `/api/arcade/rooms/${body.code}/actions`, method: 'POST', body: JSON.stringify({ type: 'start', dictionaryId: body.room.state.dictionaryId, expectedVersion: body.room.version }) }), joined.body);
      assert.equal(started.status, 200);
      let version = started.body.room.version;
      for (let turn = 0; turn < 4; turn++) {
        await Promise.all(pages.map(page => page.waitForFunction(version => __upwordsNearbyMessages.some(message => message.room?.version === version && message.room?.state?.game), version)));
        const views = await Promise.all(pages.map(page => page.evaluate(version => __upwordsNearbyMessages.findLast(message => message.room?.version === version).room, version)));
        for (const [seat, room] of views.entries()) assertPrivateGame(room.state.game, seat);
        assert.deepEqual(sharedState(views[0].state.game), sharedState(views[1].state.game));
        const actor = views[0].state.game.turn;
        const moved = await pages[actor].evaluate(room => {
          const action = __upwordsTestEngine.chooseCpuAction(room.state.game, 'normal');
          return __upwordsNearbyRpc('http', { path: `/api/arcade/rooms/${room.code}/actions`, method: 'POST', body: JSON.stringify({ ...action, dictionaryId: room.state.dictionaryId, expectedVersion: room.version }) });
        }, views[actor]);
        assert.equal(moved.status, 200); version = moved.body.room.version;
      }
      await Promise.all(pages.map(page => page.waitForFunction(version => __upwordsNearbyMessages.some(message => message.room?.version === version && message.room?.state?.game?.moveNumber === 4), version)));
      for (const page of pages) assert.equal(await page.evaluate(() => __upwordsNearby.snapshot().connected), 2, 'Pairing stays connected with Internet disabled');
      await Promise.all(pages.map(page => page.evaluate(() => __upwordsNearby.leave({ preserveCheckpoint: false }))));
      return { offline: true, realRtcPeers: 2, turns: 4, privateRacks: true };
    } finally { await Promise.all([left.context.close(), right.context.close()]); }
  });
} catch (error) {
  results.push({ name: 'fixture/browser startup', pass: false, error: error.stack });
} finally {
  await writeFile(`${out}/report.json`, JSON.stringify({ results, errors }, null, 2) + '\n');
  await writeFile(`${out}/server.log`, serverLog);
  await browser?.close(); fixture?.kill('SIGTERM');
}
if (results.some(result => result.pass === false) || errors.length) process.exitCode = 1;
