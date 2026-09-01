#!/usr/bin/env node

import { access, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const catalog = JSON.parse(await readFile(path.join(root, 'catalog.json'), 'utf8'));
const findings = [];

async function scan(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) await scan(absolute);
    else if (entry.isFile() && /\.(?:html|js)$/i.test(entry.name)) {
      const source = await readFile(absolute, 'utf8');
      const relative = path.relative(root, absolute).split(path.sep).join('/');
      if (/arcade-keyboard\.js|ArcadeKeyboard|arcadeKeyboardBound|data-arcade-keyboard/.test(source)) findings.push(`${relative}: shared custom keyboard reference`);
      if (/<(?:input|textarea)\b[^>]*(?:inputmode=["']none["']|\breadonly\b)/i.test(source)) findings.push(`${relative}: text entry blocks the native keyboard`);
      if (/\.readOnly\s*=\s*true|\.inputMode\s*=\s*["']none["']/.test(source)) findings.push(`${relative}: script blocks the native keyboard`);
    }
  }
}

for (const item of catalog.items) {
  if (item && item.enabled === true) await scan(path.join(root, item.folder));
}

const saveLayer = await readFile(path.join(root, 'arcade-save.js'), 'utf8');
if (/ArcadeKeyboard|readOnly\s*=\s*true|inputMode\s*=\s*["']none["']/.test(saveLayer)) findings.push('arcade-save.js: native keyboard suppression remains');

try {
  await access(path.join(root, 'arcade-keyboard.js'));
  findings.push('arcade-keyboard.js still exists');
} catch (_) {}

if (findings.length) {
  console.error(findings.join('\n'));
  process.exit(1);
}

console.log(`Native keyboard audit passed for ${catalog.items.filter(item => item && item.enabled === true).length} enabled games.`);
