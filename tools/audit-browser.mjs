// Reproducible visual and interaction smoke sweep for every catalog entry.
// Run: node tools/audit-browser.mjs [--quick] [--game=folder] [--out=test-results/browser-audit]
// Set ARCADE_AUDIT_URL and PLAYWRIGHT_CHROMIUM_EXECUTABLE when needed.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium, browserLaunchOptions } from './browser-runtime.mjs';
import { startStaticFixture } from './static-fixture.mjs';
const args = process.argv.slice(2);
const option = name => args.find(v => v.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const output = resolve(option('out') || 'test-results/browser-audit');
const fixture = await startStaticFixture();
const base = fixture.base;
const items = JSON.parse(await readFile('catalog.json', 'utf8')).items;
const games = [{ folder: 'shell', launchPath: 'index.html', enabled: true }, ...items].filter(i => !option('game') || i.folder === option('game'));
const sizes = args.includes('--quick') ? [{ name: 'narrow', width: 320, height: 568 }] : [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
  { name: 'narrow', width: 320, height: 568 },
  { name: 'landscape', width: 844, height: 390 },
];
const launch = {
  'make-10': '#startBtn', balloons: '[onclick="BalloonGame.start()"]', blackjack: '[onclick="BJGame.init(1)"]',
  checkers: '[onclick="CheckersGame.start(\'pvp\')"]', chess: '#modePvp', time: '[onclick="ClockGame.start(1)"]', insultinator: '#pickNice',
  dots: '[onclick="DotsGame.startGame(5,5)"]', hangman: '[onclick="HangmanGame.startRandom()"]',
  solitaire: '#startBtn', jigsaw: '#startBtn', codebreaking: '#play', math: '[onclick="MathGame.start(1)"]',
  spelling: '#play', maze: '[onclick="MazeGame.start(12,12)"]', memory: '#startBtn',
  minesweeper: '[data-preset="easy"], [data-level="easy"], [data-diff="easy"]',
  'mini-golf': '[onclick="MiniGolf.startOrContinue()"]', 'orb-slicer': '#orb-ov-btn', 'two-truths': '#play', patterns: '#play',
  shuffleboard: '#btnApply', simon: '#si-menu [onclick="SimonGame.start()"]', 'regex-lab': '#startBtn',
  'tic-tac-toe': '[onclick="TicTacToe.start(\'pvp\')"]', trivia: '[onclick="Game.start(\'science\')"]',
  'contraption-maker': '#starter', sorry: '#startBtn', 'bug-squish': '#startBtn',
  'firefighter-frenzy': '#startBtn', 'monster-dentist': '#startBtn', bowling: '#start', monopoly: '#startBtn',
};
const actions = {
  'make-10': '#hintBtn', blackjack: '[onclick="BJGame.addBet(10)"]', time: '.clock-keypad .kp-btn, .kp-btn',
  hangman: '#keyboard [role="button"]', solitaire: '[data-action="draw-klondike"]',
  codebreaking: '#palette button', math: '.kp-btn', spelling: '#keyboard button',
  memory: '.memory-card, .card[data-index], .card', minesweeper: '#grid .cell',
  'mini-golf': '#mg-shoot-btn', 'two-truths': '#claims button', patterns: '#puzzle button',
  'regex-lab': '[data-pick], [data-one]', 'tic-tac-toe': '#ttt-board .ttt-cell, .ttt-cell',
  trivia: '#tr-options button, .ans-btn', 'build-my-joke': '#random', insultinator: '#btnGenerate',
  typing: '[data-key="a"]', 'contraption-maker': '#drop', 'mad-libs': '#randomStoryButton',
  'silly-face-lab': '[aria-label="Make a surprise face"]', bowling: '#roll', monopoly: '[data-act="roll"]',
};
async function visibleClick(page, selector) {
  for (const candidate of await page.locator(selector).all()) {
    if (await candidate.isVisible() && await candidate.isEnabled()) {
      await candidate.click({ timeout: 5000, noWaitAfter: true }); return true;
    }
  }
  return false;
}
async function diagnostics(page) {
  return page.evaluate(() => {
    const visible = el => {
      const r = el.getBoundingClientRect(), s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && !el.closest('[hidden]');
    };
    const describe = el => ({ tag: el.tagName, id: el.id, text: (el.innerText || el.getAttribute('aria-label') || '').trim().slice(0, 55), rect: (() => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; })() });
    const controls = [...document.querySelectorAll('button,input,select,textarea,[role=button]')].filter(visible);
    const canvases = [...document.querySelectorAll('canvas')].filter(visible).map(el => ({...describe(el), width: el.width, height: el.height}));
    const outside = controls.filter(el => { const r = el.getBoundingClientRect(); return r.right > innerWidth + 3 || r.left < -3 || r.bottom > innerHeight + 3 || r.top < -3; }).map(describe);
    const unreachable = controls.filter(el => {
      const r=el.getBoundingClientRect();
      const outsideX=r.right>innerWidth+3||r.left < -3, outsideY=r.bottom>innerHeight+3||r.top < -3;
      if(!outsideX&&!outsideY)return false;
      const rootScroll=document.scrollingElement;
      const documentCanScroll=axis=>[document.documentElement,document.body].every(node=>getComputedStyle(node)[axis]!=='hidden');
      let canScrollX=rootScroll.scrollWidth>innerWidth+2&&documentCanScroll('overflowX'),canScrollY=rootScroll.scrollHeight>innerHeight+2&&documentCanScroll('overflowY');
      for(let parent=el.parentElement;parent;parent=parent.parentElement){const style=getComputedStyle(parent);if(/auto|scroll/.test(style.overflowX)&&parent.scrollWidth>parent.clientWidth+2)canScrollX=true;if(/auto|scroll/.test(style.overflowY)&&parent.scrollHeight>parent.clientHeight+2)canScrollY=true;}
      return outsideX&&!canScrollX||outsideY&&!canScrollY;
    }).map(describe);
    const blocked = controls.filter(el => { const r = el.getBoundingClientRect(); if (r.x < 0 || r.y < 0 || r.right > innerWidth || r.bottom > innerHeight) return false; const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return hit && !el.contains(hit) && !hit.contains(el); }).map(describe);
    return { title: document.title, viewport: { w: innerWidth, h: innerHeight }, scroll: { w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight }, outside, unreachable, blocked, canvases, buttons: controls.map(describe), bodyText: document.body.innerText.slice(0, 1800), brokenImages: [...document.images].filter(el => el.getAttribute('src') && visible(el) && (!el.complete || !el.naturalWidth)).map(el => el.src) };
  });
}
await mkdir(output, { recursive: true });
let browser;
const results = [];
try {
  browser = await chromium.launch(browserLaunchOptions);
  for (const size of sizes) {
    const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: 1, hasTouch: size.name !== 'desktop' });
    await context.addInitScript(() => { localStorage.setItem('arcade.online.endpoint', 'http://127.0.0.1:8788'); localStorage.setItem('arcade.worker.url', 'http://127.0.0.1:8788'); });
    for (const game of games) {
      const page = await context.newPage();
      const record = { game: game.folder, viewport: size.name, enabled: game.enabled, errors: [], missing: [], interactions: [], failures: [] };
      page.on('pageerror', e => record.errors.push(e.message));
      page.on('response', r => { if (r.status() >= 400) record.missing.push(`${r.status()} ${r.url()}`); });
      page.on('requestfailed', request => { if (new URL(request.url()).origin === new URL(base).origin && ['document','script','stylesheet','image','font'].includes(request.resourceType())) record.missing.push(`${request.failure()?.errorText} ${request.url()}`); });
      page.on('dialog', d => d.dismiss());
      try {
        await page.goto(`${base}/${game.launchPath}`, { waitUntil: 'domcontentloaded', timeout: 15000 });
        if(game.folder==='shell')await page.waitForFunction(()=>document.querySelectorAll('#grid .card').length>0&&window.ArcadeShell);
        await page.waitForTimeout(250);
        record.menu = await diagnostics(page);
        if(!args.includes('--no-screenshots'))await page.screenshot({ path: `${output}/${size.name}-${game.folder}-menu.png` });
        if (game.enabled && launch[game.folder]) {
          if (await visibleClick(page, launch[game.folder])) record.interactions.push(`launch: ${launch[game.folder]}`);
          else record.failures.push(`No visible launch control: ${launch[game.folder]}`);
          await page.waitForTimeout(350);
        }
        if (game.enabled && actions[game.folder]) {
          if(game.folder==='monopoly')await page.locator('[data-act="roll"]').waitFor({state:'visible',timeout:10000});
          if (await visibleClick(page, actions[game.folder])) record.interactions.push(`action: ${actions[game.folder]}`);
          else record.failures.push(`No visible action control: ${actions[game.folder]}`);
        }
        if(game.folder==='blackjack') { await visibleClick(page,'#btn-deal'); record.interactions.push('deal after bet'); await page.waitForTimeout(2500); await visibleClick(page,'#btn-stand'); }
        if(game.folder==='mad-libs') { await visibleClick(page,'#fillEmptyButton'); await visibleClick(page,'#makeStoryButton'); record.interactions.push('fill story fields and render story'); }
        if(game.folder==='music-maker' && ['desktop','landscape'].includes(size.name)) { await visibleClick(page,'[data-player="1"] .pad'); record.interactions.push('music pad'); }
        const canvas = page.locator('canvas').filter({visible:true}).first();
        if (game.enabled && !actions[game.folder] && await canvas.count() && await canvas.isVisible()) {
          const box = await canvas.boundingBox();
          if (box.width > 10 && box.height > 10) {
            await page.mouse.move(box.x + box.width * .5, box.y + box.height * .65);
            await page.mouse.down();
            await page.mouse.move(box.x + box.width * .6, box.y + box.height * .4, { steps: 8 });
            await page.mouse.up(); record.interactions.push('canvas pointer drag');
          }
        }
        if (game.folder === 'typing') { await page.keyboard.type('Arcade test'); record.interactions.push('physical keyboard text'); if(!(await page.locator('#editor').innerText()).includes('Arcade test')) record.failures.push('Physical keyboard text did not appear'); }
        if (game.folder === 'maze') { await page.keyboard.press('ArrowRight'); record.interactions.push('arrow-key move'); }
        if (game.folder === 'shell') {
          await visibleClick(page, '[data-filter="activity"]');
          record.interactions.push('Activities filter');
          await visibleClick(page, '[data-filter="all"]');
          record.interactions.push('All filter');
        }
        await page.waitForTimeout(350);
        record.play = await diagnostics(page);
        record.missing.push(...record.play.brokenImages.map(url=>`Broken image ${url}`));
        if(!args.includes('--no-screenshots'))await page.screenshot({ path: `${output}/${size.name}-${game.folder}-play.png` });
      } catch (e) { record.failures.push(e.message); }
      results.push(record);
      await page.close();
      console.log(`${size.name} ${game.folder}: ${record.errors.length} errors; ${record.failures.length} interaction warnings; ${record.play?.outside.length ?? '-'} outside controls`);
    }
    await context.close();
    await writeFile(`${output}/results.json`, JSON.stringify(results, null, 2));
  }
} finally { await browser?.close(); await fixture.close(); }
const failures = results.filter(r => r.errors.length || r.missing.length || r.failures.length || r.menu?.outside.length || r.play?.outside.length);
await writeFile(`${output}/summary.json`, JSON.stringify(failures.map(r => ({ game:r.game, viewport:r.viewport, errors:r.errors, missing:r.missing, failures:r.failures, menuOutside:r.menu?.outside, playOutside:r.play?.outside })), null, 2));
console.log(`Wrote ${results.length} viewport/game records to ${output}/results.json`);

process.exitCode = results.some(r => r.errors.length || r.missing.length || r.failures.length) ? 1 : 0;
