#!/usr/bin/env node
// Real browser interactions against the shipped game, with read-only state
// inspection. Multiplayer uses the actual Worker and Durable Object fixture.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';
import { chromium, browserLaunchOptions } from './browser-runtime.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const out = fileURLToPath(new URL('../test-results/tanks-browser/', import.meta.url));
const base = process.env.ARCADE_TANKS_URL || 'http://127.0.0.1:8787';
const api = process.env.ARCADE_TANKS_API || 'http://127.0.0.1:8788';
const results = [], errors = [];
let serverLog = '', fixture, browser;
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
await mkdir(out, { recursive: true });

function mapping({ api }) {
  window.__tanksRooms = []; window.__tanksSockets = []; window.__tanksSession = null;
  const note = value => { if (value?.room) window.__tanksRooms.push(value.room); if (value?.token) window.__tanksSession = value; };
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input, options) => {
    const url = typeof input === 'string' ? input.replace('https://arcade-chess.jonathanjablon.workers.dev', api) : input;
    const response = await originalFetch(url, options);
    if (String(url).includes('/api/')) try { note(await response.clone().json()); } catch {}
    return response;
  };
  const NativeWebSocket = window.WebSocket;
  window.WebSocket = class extends NativeWebSocket {
    constructor(url, protocols) {
      const mapped = String(url).replace('wss://arcade-chess.jonathanjablon.workers.dev', api.replace(/^http/, 'ws'));
      if (protocols === undefined) super(mapped); else super(mapped, protocols);
      window.__tanksSockets.push(this);
      this.addEventListener('message', event => { try { note(JSON.parse(event.data)); } catch {} });
    }
  };
}

async function pageFor(viewport = { width: 1440, height: 900 }) {
  const context = await browser.newContext({ viewport, hasTouch: viewport.width < 500 });
  await context.addInitScript(mapping, { api });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push({ viewport, message: error.message }));
  await page.goto(`${base}/tanks/`);
  await page.waitForFunction(() => !!window.TanksGame);
  return { page, context };
}
const state = page => page.evaluate(() => TanksGame.getState());
const debug = page => page.evaluate(() => TanksGame.getDebug());
async function settled(page) { await page.waitForFunction(() => { const s = TanksGame.getDebug(); return !s.animating && !s.busy; }); }
async function snapshot(page, name) { await page.screenshot({ path: `${out}/${name}.png`, animations: 'disabled', fullPage: true, timeout: 30000 }); }
async function run(name, callback) {
  if (process.env.ARCADE_TANKS_CASES && !process.env.ARCADE_TANKS_CASES.split(',').some(filter => name.includes(filter.trim()))) return;
  const start = Date.now();
  try { const evidence = await callback(); results.push({ name, pass: true, ms: Date.now() - start, evidence }); console.log('PASS', name); }
  catch (error) {
    if (error.code === 'TEST_ENVIRONMENT_BLOCKED') { results.push({ name, pass: null, blocked: true, ms: Date.now() - start, reason: error.message }); console.log('BLOCKED', name, error.message); }
    else { results.push({ name, pass: false, ms: Date.now() - start, error: error.stack }); console.error('FAIL', name, error.message); }
  }
  await writeFile(`${out}/report.json`, JSON.stringify({ results, errors }, null, 2) + '\n');
}
async function hasLanInterface() {
  try { return Object.values(networkInterfaces()).flat().some(address => address && !address.internal); }
  catch {
    // The managed network blocks libuv's interface ioctl, but exposes the
    // actual namespace interface list through procfs.
    const devices = await readFile('/proc/net/dev', 'utf8');
    return devices.split('\n').slice(2).map(line => line.split(':')[0].trim()).filter(Boolean).some(name => name !== 'lo');
  }
}
async function changeRange(page, selector, value) {
  // Exercise the real range's keyboard input and therefore its event handlers.
  const input = page.locator(selector);
  await input.focus(); await input.press('Home');
  const minimum = Number(await input.getAttribute('min') || 0);
  const step = Number(await input.getAttribute('step') || 1);
  for (let n = minimum; n < value; n += step) await input.press('ArrowRight');
}
async function chooseWeapon(page, weaponId) {
  await page.locator('#weapon').click();
  await page.locator(`#weaponGrid [data-weapon="${weaponId}"]`).click();
}
async function localStart(page, mode = 'hotseat', terrain = 'flat') {
  await page.locator('#mode').selectOption(mode);
  await page.locator('#terrain').selectOption(terrain);
  await page.locator('#color0').fill('#258df3');
  await page.locator('#color1').fill('#ef8543');
  await page.locator('#localStart').click();
  await page.waitForFunction(() => !!TanksGame.getState());
  await settled(page);
}
async function fastAnimations(page) {
  await page.locator('#settings').click();
  await page.locator('.settings-toggles select').selectOption('fast');
  await page.locator('#modalClose').click();
}
// Aim through the ordinary controls using a basic ballistic estimate. This
// keeps browser coverage independent of the game's computer targeting logic.
function aimAtOpponent(game, weapon = null) {
  const actor = game.turn, tank = game.tanks[actor], target = game.tanks[1 - actor];
  const direction = target.x >= tank.x ? 1 : -1;
  if (weapon?.kind === 'beam') {
    const rightAngle = Math.atan2(tank.y - target.y, Math.abs(target.x - tank.x)) * 180 / Math.PI;
    return { angle: Math.max(0, Math.min(180, Math.round(direction > 0 ? rightAngle : 180 - rightAngle))), power: 100 };
  }
  const angle = 38, radians = angle * Math.PI / 180;
  const distance = Math.max(20, Math.abs(target.x - tank.x) - 26 * Math.cos(radians));
  const rise = target.y - tank.y + 26 * Math.sin(radians);
  const speed = Math.sqrt(110 * distance ** 2 / Math.max(10, 2 * Math.cos(radians) ** 2 * (rise + distance * Math.tan(radians))));
  return { angle: direction > 0 ? angle : 180 - angle, power: Math.max(1, Math.min(100, Math.round((speed - 60) / 4.4))) };
}
async function roomAction(page, action) {
  return page.evaluate(async ({ api, action }) => {
    const room = TanksGame.getDebug().room, session = window.__tanksSession;
    const response = await fetch(`${api}/api/arcade/rooms/${room.code}/actions`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${session.token}` },
      body: JSON.stringify(action)
    });
    return { status: response.status, body: await response.json() };
  }, { api, action });
}
async function sameState(a, b) {
  const expected = await state(a);
  await b.waitForFunction(expected => JSON.stringify(TanksGame.getState()) === JSON.stringify(expected), expected);
  assert.deepEqual(await state(b), expected);
}
async function shoot(page, { weaponId, angle, power } = {}) {
  const before = await state(page);
  const actor = before.turn;
  weaponId ||= before.tanks[actor].inventory[0];
  const weapons = await page.evaluate(() => TanksGame.getWeapons());
  const aim = aimAtOpponent(before, weapons.find(weapon => weapon.id === weaponId));
  angle ??= aim.angle; power ??= aim.power;
  await chooseWeapon(page, weaponId);
  await page.locator('#angleNumber').fill(String(angle)); await page.locator('#angleNumber').press('Tab');
  await page.locator('#powerNumber').fill(String(power)); await page.locator('#powerNumber').press('Tab');
  await page.locator('#fire').click();
  await page.waitForFunction(count => TanksGame.getState()?.shotsTotal > count || TanksGame.getDebug().animating, before.shotsTotal);
  assert.equal(await page.locator('#fire').isDisabled(), true, 'Fire is disabled throughout resolution');
  await settled(page);
  const after = await state(page);
  assert.equal(after.shotsTotal, before.shotsTotal + 1, 'Exactly one UI fire consumes one shot');
  assert.equal(after.tanks[actor].inventory.length, before.tanks[actor].inventory.length - 1);
  assert.equal(after.tanks[actor].inventory.includes(weaponId), false, 'A fired weapon is single-use');
  assert.equal(after.lastShot.weaponId, weaponId);
  assert.equal(after.lastShot.angle, angle); assert.equal(after.lastShot.power, power);
  for (const [index, tank] of after.tanks.entries()) assert.ok(tank.score >= before.tanks[index].score, 'Points never decrease');
  return after;
}

async function geometry(page) {
  return page.evaluate(() => {
    const view = { width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight };
    const controls = [...document.querySelectorAll('#fire,#weapon,#angleNumber,#powerNumber,#moveLeft,#moveRight')].map(control => {
      const r = control.getBoundingClientRect(); return { id: control.id, left: r.left, right: r.right, top: r.top, bottom: r.bottom, visible: r.width > 0 && r.height > 0 };
    });
    const canvas = document.getElementById('battlefield'), r = canvas.getBoundingClientRect();
    return { ...view, controls, canvas: { width: r.width, height: r.height, left: r.left, right: r.right } };
  });
}

try {
  if (!process.env.ARCADE_TANKS_USE_FIXTURE && !process.env.ARCADE_TANKS_URL) {
    fixture = spawn(process.execPath, ['guess-who/test-server.mjs'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    fixture.stdout.on('data', bytes => { serverLog += bytes; }); fixture.stderr.on('data', bytes => { serverLog += bytes; });
  }
  for (let n = 0; ; n++) {
    try { if ((await fetch(`${base}/tanks/`)).ok) break; } catch {}
    if (n === 100 || fixture?.exitCode != null) throw Error(`Tanks fixture failed to start: ${serverLog}`);
    await delay(100);
  }
  // The managed test network exposes loopback only. These flags let two real
  // Chromium peers gather local host candidates without mDNS or STUN servers.
  browser = await chromium.launch({ ...browserLaunchOptions, args: [...browserLaunchOptions.args, '--disable-gpu', '--allow-loopback-in-peer-connection', '--disable-features=WebRtcHideLocalIpsWithMdns'] });
  // Individual cases are deliberately independent, so a UI regression leaves
  // screenshots and does not hide coverage in the remaining cases.
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 320, height: 568 }, { width: 844, height: 390 }]) await run(`viewport ${viewport.width}x${viewport.height}`, async () => {
    const { page, context } = await pageFor(viewport);
    try {
      await localStart(page);
      await fastAnimations(page);
      const layout = await geometry(page);
      await snapshot(page, `playing-${viewport.width}x${viewport.height}`);
      assert.ok(layout.scrollWidth <= layout.width + 1, 'Game has no horizontal document overflow');
      assert.ok(layout.canvas.width > 200 && layout.canvas.height > 80, 'Battlefield remains legible');
      for (const control of layout.controls) assert.ok(control.visible && control.left >= -1 && control.right <= layout.width + 1, `Usable ${control.id} is horizontally contained`);
      await page.locator('#angle').focus(); const previous = Number(await page.locator('#angle').inputValue()); await page.locator('#angle').press(previous < 180 ? 'ArrowRight' : 'ArrowLeft');
      assert.notEqual(Number(await page.locator('#angle').inputValue()), previous, 'Angle range supports keyboard input');
      assert.equal(await page.locator('#angleNumber').inputValue(), await page.locator('#angle').inputValue(), 'Keyboard range input updates paired control');
      await page.locator('#weapon').focus(); await page.locator('#weapon').press('Enter');
      await page.locator('#weaponGrid [data-weapon]').first().waitFor();
      const weaponLayout = await page.locator('#weaponGrid').evaluate(element => ({ width: element.clientWidth, scrollWidth: element.scrollWidth }));
      assert.ok(weaponLayout.scrollWidth <= weaponLayout.width + 1, 'Weapon selection has no horizontal overflow');
      await snapshot(page, `weapons-${viewport.width}x${viewport.height}`);
      await page.locator('#weaponGrid [data-weapon]').first().click();
      await snapshot(page, `playing-${viewport.width}x${viewport.height}`);
      return { layout, weaponLayout };
    } finally { await snapshot(page, `last-viewport-${viewport.width}x${viewport.height}`).catch(() => {}); await context.close(); }
  });
  await run('hotseat full game, movement, scoring and exact save', async () => {
    const { page, context } = await pageFor();
    try {
      await localStart(page);
      await fastAnimations(page);
      const initial = await state(page);
      assert.equal(initial.terrainType, 'flat'); assert.equal(new Set(initial.terrain).size, 1, 'Flat terrain is flat');
      assert.equal(initial.tanks[0].color, '#258df3'); assert.equal(initial.tanks[1].color, '#ef8543');
      for (const tank of initial.tanks) { assert.equal(tank.inventory.length, 10); assert.equal(new Set(tank.inventory).size, 10); assert.equal(tank.movesLeft, 4); assert.equal(tank.shots, 0); assert.equal(tank.score, 0); assert.equal('health' in tank, false, 'This is an accumulating-score game'); }
      await changeRange(page, '#moveDistance', 5);
      for (let index = 0; index < 4; index++) {
        const before = await state(page); await page.locator('#moveRight').click(); await page.waitForFunction(() => TanksGame.getDebug().animating); await settled(page); const after = await state(page);
        assert.equal(after.turn, before.turn); assert.equal(after.shotsTotal, 0); assert.equal(after.tanks[0].movesLeft, 3 - index);
        assert.equal(after.tanks[0].x - before.tanks[0].x, 150, 'A move reaches the chosen five tank lengths');
      }
      assert.equal(await page.locator('#moveRight').isDisabled(), true, 'Fifth movement cannot be performed');
      const shot = await shoot(page, { angle: 37, power: 69 });
      const saved = await state(page); await page.reload();
      await page.waitForFunction(() => !!window.TanksGame);
      if (await page.locator('.arcade-save-primary').count() && await page.locator('.arcade-save-primary').isVisible()) await page.locator('.arcade-save-primary').click();
      await page.waitForFunction(() => !!TanksGame.getState()); await settled(page);
      assert.deepEqual(await state(page), saved, 'Reload restores exact terrain, ammo, score, turn, movement, seed and shot trace');
      const traces = [shot.lastShot];
      while ((await state(page)).shotsTotal < 20) traces.push((await shoot(page)).lastShot);
      const finished = await state(page);
      assert.equal(finished.finished, true); assert.equal(finished.shotsTotal, 20);
      for (const tank of finished.tanks) { assert.equal(tank.shots, 10); assert.equal(tank.inventory.length, 0); }
      assert.equal(await page.locator('#fire').isDisabled(), true);
      assert.ok(traces.every(trace => trace.paths.length || trace.effects.length), 'Every accepted weapon has projectile or impact graphics');
      assert.notDeepEqual(finished.terrain, initial.terrain, 'Ordinary shots reshape the actual terrain');
      assert.ok(finished.tanks.some(tank => tank.score > 0), 'Ordinary aimed shots accumulate visible points');
      await snapshot(page, 'hotseat-finished');
      return { initialInventory: initial.tanks.map(tank => tank.inventory), finalScores: finished.tanks.map(tank => tank.score), firedWeapons: traces.map(trace => trace.weaponId), exactSave: true };
    } finally { await snapshot(page, 'last-hotseat').catch(() => {}); await context.close(); }
  });
  await run('terrain choices and randomized ammunition', async () => {
    const observed = [];
    for (const terrain of ['flat', 'hilly', 'random', 'random']) {
      const { page, context } = await pageFor();
      try {
        await localStart(page, 'hotseat', terrain); const current = await state(page);
        assert.equal(current.terrainType, terrain);
        if (terrain !== 'flat') assert.ok(Math.max(...current.terrain) - Math.min(...current.terrain) > 10, 'Uneven terrain has material elevation variation');
        observed.push({ terrainType: terrain, seed: current.seed, terrain: current.terrain, inventories: current.tanks.map(tank => tank.inventory) });
      } finally { await context.close(); }
    }
    assert.notDeepEqual(observed[2].terrain, observed[3].terrain, 'Separate random games have different terrain');
    assert.notDeepEqual(observed[2].inventories, observed[3].inventories, 'Separate games have different randomized weapons');
    return observed.map(value => ({ terrainType: value.terrainType, seed: value.seed, inventory: value.inventories }));
  });
  await run('computer opponent plays a legal alternating turn', async () => {
    const { page, context } = await pageFor();
    try {
      await localStart(page, 'cpu', 'hilly');
      const first = await state(page); await page.locator('#fire').click();
      await page.waitForFunction(() => TanksGame.getState()?.shotsTotal >= 2, null, { timeout: 30000 }); await settled(page);
      const after = await state(page);
      assert.equal(after.shotsTotal, 2); assert.equal(after.turn, first.turn);
      assert.equal(after.tanks[0].inventory.length, 9); assert.equal(after.tanks[1].inventory.length, 9);
      assert.equal(after.tanks[0].shots, 1); assert.equal(after.tanks[1].shots, 1);
      await snapshot(page, 'computer-after-response');
      return { shotsTotal: after.shotsTotal, scores: after.tanks.map(tank => tank.score) };
    } finally { await snapshot(page, 'last-computer').catch(() => {}); await context.close(); }
  });
  await run('complete weapon arsenal has individual rendered graphics', async () => {
    const { page, context } = await pageFor();
    try {
      await localStart(page); await page.locator('#settings').click();
      await page.getByRole('button', { name: /arsenal/i }).click();
      await page.waitForFunction(() => document.querySelectorAll('#weaponGrid [data-weapon]').length >= 80);
      const catalog = await page.evaluate(async () => {
        const result = [];
        for (const button of document.querySelectorAll('#weaponGrid [data-weapon]')) {
          const svg = button.querySelector('svg');
          if (!svg) { result.push({ id: button.dataset.weapon, graphic: false }); continue; }
          const markup = new XMLSerializer().serializeToString(svg);
          const image = new Image(); image.src = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(markup)))}`; await image.decode();
          const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64;
          const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0, 64, 64);
          const pixels = ctx.getImageData(0, 0, 64, 64).data;
          const paintedPixels = [...pixels].filter((_, index) => index % 4 === 3 && pixels[index] > 0).length;
          const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', pixels));
          const hash = [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
          result.push({ id: button.dataset.weapon, name: button.querySelector('strong')?.textContent, description: button.querySelector('small')?.textContent, graphic: true, paintedPixels, hash });
        }
        return result;
      });
      assert.ok(catalog.length >= 80); assert.equal(new Set(catalog.map(weapon => weapon.id)).size, catalog.length);
      for (const weapon of catalog) assert.ok(weapon.graphic && weapon.paintedPixels > 100 && weapon.name && weapon.description?.length > 12, `${weapon.id} has a real graphic, name and usable description`);
      assert.ok(new Set(catalog.map(weapon => weapon.hash)).size >= 80, 'At least 80 weapon icons actually render differently');
      await snapshot(page, 'arsenal');
      return { count: catalog.length, uniqueRenderedIcons: new Set(catalog.map(weapon => weapon.hash)).size, weapons: catalog };
    } finally { await snapshot(page, 'last-arsenal').catch(() => {}); await context.close(); }
  });
  await run('two real online clients, animation, authority, reconnect and resume', async () => {
    const left = await pageFor(), right = await pageFor({ width: 390, height: 844 });
    const a = left.page, b = right.page;
    try {
      await localStart(a, 'hotseat', 'hilly');
      await chooseWeapon(a, (await state(a)).tanks[0].inventory[1]);
      await a.locator('#angleNumber').fill('23'); await a.locator('#powerNumber').fill('41'); await a.locator('#powerNumber').press('Tab');
      await delay(650);
      const preservedLocal = await a.evaluate(() => TanksGame.capture());
      await a.locator('#newGame').click(); await a.getByRole('button', { name: 'Game setup', exact: true }).click();
      for (const page of [a, b]) await page.locator('#mode').selectOption('network');
      await a.locator('#nickname').fill('Alice'); await a.locator('#create').click();
      await a.waitForFunction(() => !!TanksGame.getDebug().room?.code);
      const code = (await debug(a)).room.code;
      await b.locator('#nickname').fill('Bob'); await b.locator('#joinCode').fill(code); await b.locator('#join').click();
      await a.waitForFunction(() => TanksGame.getDebug().room?.ready);
      await Promise.all([settled(a), settled(b)]);
      await a.locator('#lobbyTerrain').selectOption('flat'); await a.locator('#lobbyColor').fill('#258df3');
      let version = (await debug(a)).room.version; await a.locator('#configureRoom').click();
      await a.waitForFunction(version => TanksGame.getDebug().room.version > version, version);
      await b.locator('#lobbyColor').fill('#ef8543'); version = (await debug(b)).room.version; await b.locator('#configureRoom').click();
      await a.waitForFunction(version => TanksGame.getDebug().room.version > version, version);
      await a.locator('#startRoom').click();
      await Promise.all([a, b].map(page => page.waitForFunction(() => !!TanksGame.getState()))); await sameState(a, b);
      await Promise.all([a, b].map(fastAnimations));
      for (const page of [a, b]) assert.equal(await page.locator('#roomCode').innerText(), code, 'Active battle displays its reusable room code');
      assert.equal((await state(a)).terrainType, 'flat');
      assert.deepEqual((await state(a)).tanks.map(tank => tank.color), ['#258df3', '#ef8543']);
      const initialRoom = (await debug(a)).room, initial = await state(a);
      const active = initial.turn === 0 ? a : b, inactive = initial.turn === 0 ? b : a, inactiveSeat = 1 - initial.turn;
      assert.equal(await inactive.locator('#fire').isDisabled(), true, 'Inactive peer cannot fire');
      const forbidden = await roomAction(inactive, { type: 'fire', expectedVersion: initialRoom.version, weaponId: initial.tanks[inactiveSeat].inventory[0], angle: inactiveSeat === 0 ? 45 : 135, power: 60 });
      assert.equal(forbidden.status, 403, 'Authority rejects a crafted out-of-turn fire');
      const stale = await roomAction(active, { type: 'fire', expectedVersion: initialRoom.version - 1, weaponId: initial.tanks[initial.turn].inventory[0], angle: initial.turn === 0 ? 45 : 135, power: 60 });
      assert.equal(stale.status, 409, 'Authority rejects a stale fire');
      const forged = await roomAction(active, { type: 'fire', expectedVersion: initialRoom.version, weaponId: initial.tanks[initial.turn].inventory[0], angle: initial.turn === 0 ? 45 : 135, power: 60, state: initial });
      assert.equal(forged.status, 400, 'Authority rejects a forged game snapshot');
      const shots = [], families = new Set();
      const weapons = await a.evaluate(() => TanksGame.getWeapons());
      const byId = new Map(weapons.map(weapon => [weapon.id, weapon]));
      for (let number = 0; number < 12; number++) {
        const before = await state(a), actor = before.turn, player = actor === 0 ? a : b, observer = actor === 0 ? b : a;
        const weaponId = before.tanks[actor].inventory.find(id => !families.has(byId.get(id)?.kind)) || before.tanks[actor].inventory[0];
        families.add(byId.get(weaponId)?.kind);
        await chooseWeapon(player, weaponId);
        const { angle, power } = aimAtOpponent(before, byId.get(weaponId));
        await player.locator('#angleNumber').fill(String(angle)); await player.locator('#angleNumber').press('Tab');
        await player.locator('#powerNumber').fill(String(power)); await player.locator('#powerNumber').press('Tab');
        await player.locator('#fire').click();
        await Promise.all([a, b].map(page => page.waitForFunction(() => TanksGame.getDebug().animating)));
        assert.equal(await player.locator('#fire').isDisabled(), true); assert.equal(await observer.locator('#fire').isDisabled(), true);
        if (number < 8) { await delay(250); await Promise.all([snapshot(a, `online-shot-${number + 1}-desktop`), snapshot(b, `online-shot-${number + 1}-mobile`)]); }
        await Promise.all([settled(a), settled(b)]); await sameState(a, b);
        const after = await state(a);
        assert.equal(after.shotsTotal, before.shotsTotal + 1); assert.equal(after.lastShot.weaponId, weaponId);
        for (const [index, tank] of after.tanks.entries()) assert.ok(tank.score >= before.tanks[index].score);
        assert.equal(after.tanks[actor].inventory.includes(weaponId), false);
        shots.push({ weaponId, kind: byId.get(weaponId)?.kind, pathCount: after.lastShot.paths.length, effectCount: after.lastShot.effects.length, scores: after.tanks.map(tank => tank.score) });
      }
      const socketCount = await b.evaluate(() => window.__tanksSockets.length);
      await b.evaluate(() => window.__tanksSockets.filter(socket => socket.readyState === 1).forEach(socket => socket.close(1000, 'test reconnect')));
      await b.waitForFunction(count => window.__tanksSockets.length > count && window.__tanksSockets.some(socket => socket.readyState === 1), socketCount);
      await sameState(a, b);
      const saved = await state(a), savedCode = (await debug(b)).room.code;
      await b.reload(); await b.waitForFunction(() => !!window.TanksGame);
      await b.locator('#mode').selectOption('network'); await b.locator('#resumeRoom').click();
      await b.waitForFunction(code => TanksGame.getDebug().room?.code === code, savedCode); await settled(b);
      assert.deepEqual(await state(b), saved, 'Online resume restores the canonical checkpoint exactly');
      await sameState(a, b); await snapshot(a, 'online-reconnected-desktop'); await snapshot(b, 'online-resumed-mobile');
      while ((await state(a)).shotsTotal < 20) {
        await Promise.all([settled(a), settled(b)]);
        const turn = (await state(a)).turn; await shoot(turn === 0 ? a : b); await sameState(a, b);
      }
      await Promise.all([settled(a), settled(b)]);
      const finished = await state(a);
      assert.equal(finished.finished, true); assert.equal(finished.shotsTotal, 20);
      for (const page of [a, b]) assert.equal(await page.locator('#result').isVisible(), true, 'Both players receive the match result');
      await snapshot(a, 'online-finished-desktop'); await snapshot(b, 'online-finished-mobile');
      await a.locator('#playAgain').click();
      await a.waitForFunction(() => TanksGame.getDebug().room.state.rematchVotes.length === 1);
      await b.locator('#playAgain').click();
      await Promise.all([a, b].map(page => page.waitForFunction(() => TanksGame.getState()?.shotsTotal === 0 && !TanksGame.getState()?.finished)));
      await sameState(a, b); assert.equal((await state(a)).turn, 1 - initial.starter, 'Rematch alternates the starting tank');
      await a.locator('#leave').click(); await a.getByRole('button', { name: 'Leave room', exact: true }).click();
      await a.waitForFunction(() => !TanksGame.getDebug().session);
      assert.deepEqual(await a.evaluate(() => TanksGame.capture()), preservedLocal, 'Joining, aiming, rematching and leaving an online room preserve exact local game and aim settings');
      return { code, shots, weaponFamilies: [...families], fullGameShots: 20, finalScores: finished.tanks.map(tank => tank.score), exactResume: true, reconnect: true, rematch: true, localGamePreserved: true, rejected: { outOfTurn: forbidden.status, stale: stale.status, forgedSnapshot: forged.status } };
    } finally {
      await Promise.all([snapshot(a, 'last-online-desktop').catch(() => {}), snapshot(b, 'last-online-mobile').catch(() => {})]);
      // This also makes the same verification safe to run against production.
      for (const page of [a, b]) if (!page.isClosed() && (await debug(page).catch(() => null))?.session) await roomAction(page, { type: 'leave' }).catch(() => {});
      await Promise.all([left.context.close(), right.context.close()]);
    }
  });
  await run('real offline Nearby transport uses the Tanks authority model', async () => {
    if (!await hasLanInterface()) throw Object.assign(new Error('This browser test network exposes only loopback, so native LAN WebRTC pairing cannot be verified here. Nearby authority/model tests run separately; use a LAN-enabled environment for real pairing.'), { code: 'TEST_ENVIRONMENT_BLOCKED' });
    const left = await pageFor(), right = await pageFor(); const pages = [left.page, right.page];
    try {
      for (const [index, page] of pages.entries()) await page.evaluate(async index => {
        const [{ NearbyArcadeSession }, { MemoryNearbyStorage }, protocol, signaling, webrtc, { NearbyRoomService }] = await Promise.all([
          import('/multiplayer/nearby-session.mjs'), import('/multiplayer/nearby-storage.mjs'), import('/multiplayer/protocol.mjs'),
          import('/multiplayer/signaling.mjs'), import('/multiplayer/webrtc.mjs'), import('/multiplayer/nearby-room-service.js')
        ]);
        window.__tankNearby = new NearbyArcadeSession({ storage: new MemoryNearbyStorage() });
        __tankNearby.configureSignaling({ ...protocol, ...signaling, ...webrtc }); await __tankNearby.initialize();
        window.__tankNearbyMessages = [];
        __tankNearby.on('socket-message', message => __tankNearbyMessages.push(JSON.parse(message.data)));
        const service = new NearbyRoomService({ onEvent: event => {
          if (event.type === 'socket-message') __tankNearby.sendSocketMessage(event.targetMemberId, event.socketId, event.data);
          if (event.type === 'socket-close') __tankNearby.closeSocket(event.targetMemberId, event.socketId, event);
        } });
        __tankNearby.setRpcHandler(async ({ member, operation, payload }) => {
          await service.registerMember({ ...member, connected: true });
          if (operation === 'http') return service.handleHttp(member.memberId, payload);
          if (operation === 'ws-open') return service.openSocket(member.memberId, payload);
          if (operation === 'ws-send') return service.sendSocket(member.memberId, payload);
          return service.closeSocket(member.memberId, payload);
        });
        window.__tankNearbyRpc = async (operation, payload) => {
          await new Promise(resolve => setTimeout(resolve, 20)); return __tankNearby.requestRoomRpc(operation, payload);
        };
        window.__tankNearbyName = index ? 'Nearby Bob' : 'Nearby Alice';
      }, index);
      const [host, guest] = pages;
      await host.evaluate(() => __tankNearby.startHost({ nickname: __tankNearbyName, avatar: '🎮' }));
      const invitation = await host.evaluate(() => __tankNearby.createHostInvitation());
      const answer = await guest.evaluate(wire => __tankNearby.joinFromInvitation({ nickname: __tankNearbyName, avatar: '🚀' }, wire), invitation.wire);
      await host.evaluate(answer => __tankNearby.acceptGuestResponse(answer.wire, answer.pairingId), answer);
      await Promise.all(pages.map(page => page.waitForFunction(() => __tankNearby.snapshot().connected === 2, null, { timeout: 25000 })));
      await Promise.all([left.context.setOffline(true), right.context.setOffline(true)]);
      const created = await host.evaluate(() => __tankNearbyRpc('http', { path: '/api/arcade/rooms', method: 'POST', body: JSON.stringify({ game: 'tanks', maxPlayers: 2 }) }));
      assert.equal(created.status, 200);
      const joined = await guest.evaluate(code => __tankNearbyRpc('http', { path: `/api/arcade/rooms/${code}/join`, method: 'POST', body: '{}' }), created.body.code);
      assert.equal(joined.status, 200);
      for (const [index, page] of pages.entries()) {
        const token = index ? joined.body.token : created.body.token;
        const opened = await page.evaluate(value => __tankNearbyRpc('ws-open', { path: `/api/arcade/rooms/${value.code}/ws?token=${value.token}`, socketId: `tanks-nearby-${value.index}` }), { code: created.body.code, token, index });
        assert.equal(opened.ok, true);
      }
      const started = await host.evaluate(body => __tankNearbyRpc('http', { path: `/api/arcade/rooms/${body.code}/actions`, method: 'POST', body: JSON.stringify({ type: 'start', expectedVersion: body.room.version }) }), joined.body);
      assert.equal(started.status, 200);
      let room = started.body.room;
      assert.equal(room.state.game.tanks[0].inventory.length, 10); assert.equal(room.state.game.tanks[1].inventory.length, 10);
      const initialActor = room.state.game.turn;
      const move = await pages[initialActor].evaluate(body => __tankNearbyRpc('http', { path: `/api/arcade/rooms/${body.room.code}/actions`, method: 'POST', body: JSON.stringify({ type: 'move', expectedVersion: body.room.version, distance: body.actor === 0 ? 150 : -150 }) }), { room, actor: initialActor });
      assert.equal(move.status, 200); assert.equal(move.body.room.state.game.tanks[initialActor].movesLeft, 3); room = move.body.room;
      for (let count = 0; count < 4; count++) {
        const actor = room.state.game.turn, player = pages[actor];
        const fired = await player.evaluate(body => __tankNearbyRpc('http', { path: `/api/arcade/rooms/${body.room.code}/actions`, method: 'POST', body: JSON.stringify({ type: 'fire', expectedVersion: body.room.version, weaponId: body.room.state.game.tanks[body.actor].inventory[0], angle: body.actor === 0 ? 40 : 140, power: 73 }) }), { room, actor });
        assert.equal(fired.status, 200); room = fired.body.room;
        await Promise.all(pages.map(page => page.waitForFunction(expected => __tankNearbyMessages.some(message => message.room?.code === expected.code && message.room?.version === expected.version && JSON.stringify(message.room.state.game) === JSON.stringify(expected.state.game)), room)));
      }
      assert.equal(room.state.game.shotsTotal, 4);
      for (const page of pages) assert.equal(await page.evaluate(() => __tankNearby.snapshot().connected), 2, 'Pair remains connected without Internet throughout moves and firing');
      const checkpoints = await Promise.all(pages.map(page => page.evaluate(() => __tankNearbyMessages.at(-1).room.state.game)));
      assert.deepEqual(checkpoints[0], checkpoints[1], 'Both real RTC clients receive exact canonical game state');
      await Promise.all(pages.map(page => page.evaluate(() => __tankNearby.leave({ preserveCheckpoint: false }))));
      return { offline: true, rtcPeers: 2, shotsTotal: room.state.game.shotsTotal, synchronizedCheckpoint: true };
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
