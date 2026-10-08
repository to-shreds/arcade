// This independent vault is never part of the Arcade save/export mechanism.
const DB_NAME = 'arcade-tv-key-vault';
const STORE = 'vault';
let writes = Promise.resolve();
const serialize = action => {
  const result = writes.then(action, action);
  writes = result.catch(() => {});
  return result;
};

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function transaction(mode, action) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode), request = action(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(request?.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}
const get = id => transaction('readonly', store => store.get(id));

export function rememberApiKey(apiKey) {
  return serialize(async () => {
    if (!globalThis.crypto?.subtle || typeof apiKey !== 'string' || !apiKey) throw new Error('This browser cannot remember a key securely. Connect without Remember.');
    let key = await get('device-key');
    if (!key) key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(apiKey));
    await transaction('readwrite', store => {
      store.put(key, 'device-key');
      return store.put({ iv: Array.from(iv), data: Array.from(new Uint8Array(encrypted)) }, 'api-key');
    });
    return true;
  });
}
export async function loadRememberedApiKey() {
  await writes;
  if (!globalThis.crypto?.subtle) return '';
  try {
    const [key, saved] = await Promise.all([get('device-key'), get('api-key')]);
    if (!key || !Array.isArray(saved?.iv) || !Array.isArray(saved?.data)) return '';
    return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(saved.iv) }, key, new Uint8Array(saved.data)));
  } catch { return ''; }
}
export function forgetApiKey() {
  return serialize(() => transaction('readwrite', store => store.clear()));
}
