import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const wrapper = path.dirname(fileURLToPath(import.meta.url));
const repository = path.dirname(wrapper);
const staging = path.join(wrapper, "out", "child-snapshot");
const readJson = async (base, name) => JSON.parse(await readFile(path.join(base, name), "utf8"));
const catalog = await readJson(repository, "catalog.json");
const manifest = await readJson(repository, "offline-manifest.json");
const child = await readJson(wrapper, "child-activities.json");
const archived = new Map(manifest.files.map(file => [file.path, file]));
const approvedExtensions = /\.(?:css|js|mjs|json|svg|png|jpe?g|webp|gif|woff2|wav|ogg|mp3)$/;
const unavailableBrowserFeature = /type\s*=\s*["']file|\.(?:showDirectoryPicker|showOpenFilePicker|showSaveFilePicker)\s*\(|<iframe\b|\.requestDevice\s*\(/i;
const safePath = /^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/;
const activities = [];
const files = new Set(child.commonAssets);
const editorial = /(?:^|\/)(?:sources?|provenance|inventory|editorial|reviews?|issues?)(?:\/|[-.])/i;

for (const id of child.activities) {
  const item = catalog.items.find(entry => entry.enabled && entry.folder === id);
  if (!item) {
    if (["dictionary", "encyclopedia", "mouse-lab"].includes(id)) continue;
    throw new Error(`Approved activity missing from Arcade catalog: ${id}`);
  }
  if (item.launchPath !== `${id}/index.html` || !safePath.test(`${id}/${item.icon}`)) {
    throw new Error(`Unexpected entry or icon for ${id}`);
  }
  const activity = { id, title: item.title, entry: item.launchPath, icon: `${id}/${item.icon}` };
  activities.push(activity);
  files.add(activity.entry);
  files.add(activity.icon);
  for (const file of archived.keys()) {
    if (file.startsWith(`${id}/`) && approvedExtensions.test(file) &&
        !editorial.test(file) && !file.endsWith("/game.json")) files.add(file);
  }
}

if (activities.some(activity => ["encyclopedia", "dictionary"].includes(activity.id))) {
  execFileSync(process.execPath, ["tools/build-reference.mjs", "--check"], { cwd: repository, stdio: "inherit" });
  files.add("reference/library.mjs");
  files.add("reference/search.mjs");
  const packs = [...archived.keys()].filter(file =>
    /^reference\/packs\/(?:catalog|articles(?:\/[-a-z0-9]+)?|words(?:\/[-a-z0-9]+)?)\.json$/.test(file));
  for (const index of ["catalog.json", "articles.json", "words.json"]) {
    if (!packs.includes(`reference/packs/${index}`)) throw new Error(`Reference pack missing: ${index}`);
  }
  packs.forEach(file => files.add(file));
}

async function copyVerified(relativePath, replacement) {
  if (!safePath.test(relativePath)) throw new Error(`Unsafe snapshot path: ${relativePath}`);
  const expected = archived.get(relativePath);
  if (!expected) throw new Error(`Absent from Arcade snapshot: ${relativePath}`);
  const source = path.join(repository, relativePath);
  if (!(await lstat(source)).isFile()) throw new Error(`Not a regular file: ${relativePath}`);
  const bytes = await readFile(source);
  if (bytes.length !== expected.bytes || createHash("sha256").update(bytes).digest("hex") !== expected.sha256) {
    throw new Error(`Arcade snapshot differs from its manifest: ${relativePath}`);
  }
  if (bytes.length > 16 * 1024 * 1024) throw new Error(`Arcade asset too large: ${relativePath}`);
  if (!replacement && /\.(?:html|js|mjs)$/.test(relativePath) && unavailableBrowserFeature.test(bytes.toString())) {
    throw new Error(`Activity requires an excluded browser feature: ${relativePath}`);
  }
  const destination = path.join(staging, relativePath);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, replacement ?? bytes);
}

await rm(staging, { recursive: true, force: true });
await Promise.all([...files].map(file => copyVerified(file)));
await Promise.all(child.offlineScriptReplacements.map(file =>
  copyVerified(file, "/* Multiplayer is disabled in Arcade for Windows child mode. */\n")));
await writeFile(path.join(staging, "child-snapshot.json"),
  JSON.stringify({ version: manifest.version, activities }, null, 2) + "\n");
console.log(`Prepared ${manifest.version}: ${activities.length} activities and ${files.size + child.offlineScriptReplacements.length} assets.`);
