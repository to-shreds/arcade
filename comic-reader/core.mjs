export const REPO = 'to-shreds/Misc';
export const DIRECTORY = 'cbz';
export const GITHUB_API = 'https://api.github.com/repos/to-shreds/Misc/contents/cbz?ref=main';
export const MAX_FILE_BYTES = 150 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 40 * 1024 * 1024;
export const MAX_UNCOMPRESSED_BYTES = 750 * 1024 * 1024;

export const supportedFile = name => /\.(cbz|pdf)$/i.test(String(name || ''));
export const extensionOf = name => (/\.([^.]+)$/.exec(String(name || ''))?.[1] || '').toLowerCase();
export function displayTitle(name) {
  return String(name || 'Untitled').replace(/\.(cbz|pdf)$/i, '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Untitled';
}
export function naturalCompare(a, b) {
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
}
export function imageEntries(files) {
  const images = Object.values(files || {}).filter(file => {
    if (!file || file.dir) return false;
    const path = String(file.name || '').replace(/\\/g, '/');
    const parts = path.split('/');
    return !parts.some(p => !p || p.startsWith('.') || p === '__MACOSX') && /\.(jpe?g|png|webp|gif|avif)$/i.test(path);
  });
  images.sort((a, b) => naturalCompare(a.name, b.name));
  return images;
}
export function githubBook(item) {
  if (!item || item.type !== 'file' || !supportedFile(item.name) ||
    typeof item.path !== 'string' || !item.path.startsWith('cbz/') ||
    !item.download_url?.startsWith('https://raw.githubusercontent.com/to-shreds/Misc/')) return null;
  return { id: `gh:${item.path}`, name: item.name, title: displayTitle(item.name),
    kind: extensionOf(item.name), source: 'github', url: item.download_url,
    size: Number(item.size) || 0, sha: item.sha || '' };
}
export function localBook(file) {
  if (!file || !supportedFile(file.name)) return null;
  return { id: `local:${file.name}:${file.size}:${file.lastModified || 0}`,
    name: file.name, title: displayTitle(file.name), kind: extensionOf(file.name),
    source: 'local', size: file.size || 0, file };
}
export function spreadStart(page, twoUp) {
  if (!twoUp || page <= 0) return Math.max(0, page);
  return 1 + Math.floor((page - 1) / 2) * 2;
}
export function nextPage(page, count, twoUp, readingDirection = 'ltr') {
  const start = spreadStart(page, twoUp);
  return Math.min(count - 1, start + (twoUp ? (start === 0 ? 1 : 2) : 1));
}
export function previousPage(page, twoUp) {
  const start = spreadStart(page, twoUp);
  return Math.max(0, start - (twoUp && start > 1 ? 2 : 1));
}
export function formatSize(bytes) {
  const n = Number(bytes || 0);
  return n > 1024 * 1024 ? `${(n / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(0, Math.round(n / 1024))} KB`;
}