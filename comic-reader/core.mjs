export const REPO = 'to-shreds/Misc';
export const DIRECTORY = 'cbz';
export const GITHUB_API = 'https://api.github.com/repos/to-shreds/Misc/contents/cbz?ref=main';
// The archive itself is not size-limited. ZIP metadata and pages are read on demand.
// A per-image safeguard prevents an invalid ZIP entry from exhausting mobile RAM.
export const MAX_IMAGE_BYTES = 256 * 1024 * 1024;

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
    if (!file || file.dir || file.directory) return false;
    const path = String(file.name || file.filename || '').replace(/\\/g, '/');
    const parts = path.split('/');
    return !parts.some(p => !p || p.startsWith('.') || p === '__MACOSX') && /\.(jpe?g|png|webp|gif|avif)$/i.test(path);
  });
  images.sort((a, b) => naturalCompare(a.name || a.filename, b.name || b.filename));
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
/** Group contiguous, ordinary GitHub raw files named Book.cbz.001, .002, etc.
 * A split is byte-for-byte, NOT a 7z multi-volume archive. Each part remains
 * under GitHub's upload limit. The reconstructed Blob is ZIP-compatible. */
export function githubLibrary(items) {
  const regular=[], splitGroups=new Map();
  for (const item of Array.isArray(items) ? items : []) {
    const book=githubBook(item);
    if (book) {regular.push(book);continue;}
    if (!item || item.type!=='file' || typeof item.name!=='string') continue;
    const match=/^(.+\.(cbz|pdf))\.(\d{3,})$/i.exec(item.name);
    if (!match) continue;
    if (typeof item.path!=='string' || item.path!==`cbz/${item.name}` ||
      typeof item.download_url!=='string' ||
      !item.download_url.startsWith('https://raw.githubusercontent.com/to-shreds/Misc/')) continue;
    const base=match[1], groupKey=base.toLowerCase(), sequence=Number(match[3]);
    if (!Number.isSafeInteger(sequence) || !Number.isSafeInteger(item.size) || item.size<0) continue;
    const group=splitGroups.get(groupKey)||{name:base,segments:[]};
    group.segments.push({number:sequence,url:item.download_url,size:item.size,sha:item.sha||''});
    splitGroups.set(groupKey,group);
  }
  for (const group of splitGroups.values()) {
    const parts=group.segments.sort((a,b)=>a.number-b.number);
    if (parts.length < 2 || (parts[0].number!==0 && parts[0].number!==1) ||
      parts.some((entry,i)=>i>0 && entry.number!==parts[0].number+i)) continue;
    regular.push({id:`gh:cbz/${group.name}`,name:group.name,title:displayTitle(group.name),
      kind:extensionOf(group.name),source:'github',parts,
      size:parts.reduce((sum,p)=>sum+p.size,0),sha:parts.map(p=>p.sha).join(':')});
  }
  return regular;
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