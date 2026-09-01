#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const toolDirectory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(toolDirectory, '..');
const rootRuntimeFiles = [
  'index.html',
  'catalog.json',
  'arcade-ui.css',
  'arcade-save.js',
  'arcade.png',
  'sw.js'
];
const ignoredDirectoryNames = new Set([
  '.git', '.github', 'node_modules', 'coverage', 'test-results',
  'playwright-report', 'test', 'tests', 'spec', 'specs'
]);
const ignoredFileNames = new Set(['.DS_Store', 'Thumbs.db', 'offline-manifest.json', 'test.cjs']);

function usage(message) {
  if (message) console.error(message);
  console.error('Usage: node tools/generate-offline-manifest.mjs --version <release-id> [--output <path>]');
  process.exit(2);
}

function argumentsFrom(argv) {
  let version = '';
  let output = path.join(root, 'offline-manifest.json');
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--version') version = argv[++index] || '';
    else if (argument === '--output') output = path.resolve(argv[++index] || '');
    else usage(`Unknown argument: ${argument}`);
  }
  if (!version || version.length > 100 || !/^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(version)) {
    usage('A short, path-safe --version is required.');
  }
  return { version, output };
}

function directChild(value, label) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)) {
    throw new Error(`${label} must name one direct child of the repository root: ${String(value)}`);
  }
  return value;
}

function relativeSitePath(absolutePath) {
  const relative = path.relative(root, absolutePath).split(path.sep).join('/');
  if (!relative || relative.startsWith('../') || relative.includes('/../') || path.isAbsolute(relative)) {
    throw new Error(`File escaped the site root: ${absolutePath}`);
  }
  return relative;
}

async function collectDirectory(directory, files) {
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    if (entry.isSymbolicLink()) throw new Error(`Symlinks are not allowed in the offline archive: ${path.join(directory, entry.name)}`);
    if (entry.isDirectory()) {
      if (entry.name.startsWith('.') || ignoredDirectoryNames.has(entry.name)) continue;
      await collectDirectory(path.join(directory, entry.name), files);
      continue;
    }
    if (!entry.isFile() || entry.name.startsWith('.') || ignoredFileNames.has(entry.name) ||
        /(?:^test-|\.test\.)/i.test(entry.name) || /\.(?:part|tmp)$/i.test(entry.name)) continue;
    files.add(relativeSitePath(path.join(directory, entry.name)));
  }
}

async function requireRegularFile(relativePath) {
  const absolutePath = path.join(root, ...relativePath.split('/'));
  const information = await lstat(absolutePath);
  if (!information.isFile() || information.isSymbolicLink()) throw new Error(`Required runtime file is not a regular file: ${relativePath}`);
  return absolutePath;
}

const { version, output } = argumentsFrom(process.argv.slice(2));
const catalog = JSON.parse(await readFile(path.join(root, 'catalog.json'), 'utf8'));
if (!catalog || !Array.isArray(catalog.items)) throw new Error('catalog.json does not contain an items array.');

const selectedFiles = new Set(rootRuntimeFiles);
const selectedFolders = new Set();
for (const item of catalog.items) {
  if (!item || item.enabled !== true) continue;
  const folder = directChild(item.folder, 'Catalog folder');
  const entry = directChild(item.entry, `Catalog entry for ${folder}`);
  const icon = directChild(item.icon, `Catalog icon for ${folder}`);
  if (item.launchPath !== `${folder}/${entry}`) throw new Error(`Catalog launchPath must be ${folder}/${entry}`);
  if (selectedFolders.has(folder)) throw new Error(`Duplicate enabled catalog folder: ${folder}`);
  selectedFolders.add(folder);
  const folderPath = path.join(root, folder);
  const information = await lstat(folderPath);
  if (!information.isDirectory() || information.isSymbolicLink()) throw new Error(`Catalog folder is not a regular direct child directory: ${folder}`);
  await requireRegularFile(`${folder}/${entry}`);
  await requireRegularFile(`${folder}/${icon}`);
  await collectDirectory(folderPath, selectedFiles);
}

const paths = [...selectedFiles].sort((left, right) => left.localeCompare(right));
const files = [];
let totalBytes = 0;
for (const relativePath of paths) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(relativePath) || relativePath.includes('//') || relativePath.split('/').some(part => part === '.' || part === '..')) {
    throw new Error(`Unsafe offline path: ${relativePath}`);
  }
  const bytes = await readFile(await requireRegularFile(relativePath));
  const size = bytes.byteLength;
  totalBytes += size;
  if (!Number.isSafeInteger(totalBytes)) throw new Error('Offline archive byte total exceeds JavaScript safe integer range.');
  files.push({
    path: relativePath,
    bytes: size,
    sha256: createHash('sha256').update(bytes).digest('hex')
  });
}

for (const required of ['index.html', 'catalog.json', 'sw.js']) {
  if (!files.some(file => file.path === required)) throw new Error(`Required offline file is missing: ${required}`);
}

const manifest = {
  schema: 1,
  version,
  generatedAt: new Date().toISOString(),
  fileCount: files.length,
  totalBytes,
  files
};
await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: 'utf8', mode: 0o644 });
console.log(`${path.relative(root, output) || path.basename(output)}: ${files.length} files, ${totalBytes} bytes, ${version}`);
