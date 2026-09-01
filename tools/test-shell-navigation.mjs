#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = relative => readFile(path.join(root, relative), 'utf8');
const catalog = JSON.parse(await read('catalog.json'));
const enabled = catalog.items.filter(item => item?.enabled === true && !item.warning);

const baseball = catalog.items.find(item => item.folder === 'baseball');
assert(baseball && baseball.enabled === false, 'Baseball remains disabled in the Arcade catalog');

const [saveSource, shellSource] = await Promise.all([read('arcade-save.js'), read('arcade-shell.js')]);
assert.match(saveSource, /function goHome\(\)/, 'ArcadeSave exposes the shared Home helper');
assert.match(saveSource, /window\.parent !== window[\s\S]*?window\.parent\.ArcadeShell[\s\S]*?scope:'arcade-shell-navigation', version:1, type:'home'/, 'framed games send a scoped Home request only to the Arcade shell');
assert.match(saveSource, /window\.location\.href = '\.\.\/index\.html'/, 'direct game links keep their top-level Arcade fallback');
assert.match(saveSource, /a\.arcade-home-link\[href\]/, 'legacy real Home links are intercepted by the shared helper');
assert.match(shellSource, /event\?\.origin === location\.origin[\s\S]*?event\?\.source === frame\?\.contentWindow[\s\S]*?navigation\?\.scope === "arcade-shell-navigation"[\s\S]*?navigation\?\.version === 1[\s\S]*?navigation\?\.type === "home"/, 'shell validates Home origin, frame source, scope, version, and type');

function localGameScripts(item, html) {
  const scripts = [];
  for (const match of html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)) {
    const reference = match[1].replace(/[?#].*$/, '');
    if (!reference || /^(?:[a-z]+:|\/\/|\/)/i.test(reference)) continue;
    const relative = path.posix.normalize(path.posix.join(path.posix.dirname(item.launchPath), reference));
    if (relative.startsWith(`${item.folder}/`)) scripts.push(relative);
  }
  return scripts;
}

function removeSafeAnchorFallbacks(source) {
  return source.replace(/<a\b(?=[^>]*\bclass=["'][^"']*\barcade-home-link\b[^"']*["'])(?=[^>]*\bhref=["']\.\.\/index\.html["'])[^>]*>/gi, '');
}

const failures = [];
for (const item of enabled) {
  const html = await read(item.launchPath);
  let gameSource = html;
  for (const script of localGameScripts(item, html)) gameSource += `\n${await read(script)}`;

  if (!/(?:ArcadeSave|ArcadeMultiplayer)\.goHome|arcade-home-link/.test(gameSource)) {
    failures.push(`${item.folder}: no shell-preserving Home route`);
  }

  const programmaticSource = removeSafeAnchorFallbacks(gameSource);
  for (const match of programmaticSource.matchAll(/\.\.\/index\.html/g)) {
    const nearbyCode = programmaticSource.slice(Math.max(0, match.index - 900), match.index + 180);
    if (!/ArcadeMultiplayer\.goHome/.test(nearbyCode)) {
      failures.push(`${item.folder}: unguarded programmatic navigation to ../index.html`);
    }
  }

  if (/arcade-home-link/.test(html)) {
    assert.match(html, /<script\b[^>]*\bsrc=["']\.\.\/arcade-save\.js["'][^>]*>/i, `${item.folder}: legacy Home link loads ArcadeSave interception`);
  }
}

assert.deepEqual(failures, [], `enabled game Home routes must preserve the persistent shell:\n${failures.join('\n')}`);
console.log(`Persistent-shell Home routing verified for ${enabled.length} enabled Arcade activities.`);
