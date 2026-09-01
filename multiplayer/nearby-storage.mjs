import { randomId, randomSecret } from "./arcade-shell-core.mjs";

const DB_NAME = "arcade-nearby-v1";
const DB_VERSION = 1;
const STORE = "records";
const BROWSER_KEY = "browser-identity";
const CHECKPOINT_KEY = "session-checkpoint";
const PROFILE_KEY = "profile-draft";

function requestPromise(request){
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Nearby Arcade storage failed."));
  });
}

export class IndexedDbNearbyStorage {
  constructor({ indexedDB = globalThis.indexedDB, cryptoObject = globalThis.crypto } = {}){
    this.indexedDB = indexedDB;
    this.cryptoObject = cryptoObject;
  }

  async open(){
    if(!this.indexedDB) throw Object.assign(new Error("Persistent browser storage is unavailable."), { code: "indexeddb_unavailable" });
    const request = this.indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if(!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "key" });
    };
    return requestPromise(request);
  }

  async get(key){
    const db = await this.open();
    try{
      const value = await requestPromise(db.transaction(STORE, "readonly").objectStore(STORE).get(key));
      return value ? value.value : null;
    }finally{ db.close(); }
  }

  async set(key, value){
    const db = await this.open();
    try{
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).put({ key, value });
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error || new Error("Nearby Arcade storage failed."));
        tx.onabort = tx.onerror;
      });
    }finally{ db.close(); }
    return value;
  }

  async delete(key){
    const db = await this.open();
    try{
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).delete(key);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error || new Error("Nearby Arcade storage failed."));
        tx.onabort = tx.onerror;
      });
    }finally{ db.close(); }
  }

  async browserIdentity(){
    // A single readwrite transaction serializes first-run creation across tabs.
    // A get-then-set split across two transactions can return two identities,
    // while only the second survives, permanently stranding the first tab's
    // proof-bound Nearby identity.
    const db = await this.open();
    try{
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        const store = tx.objectStore(STORE);
        const request = store.get(BROWSER_KEY);
        let identity = null;
        request.onsuccess = () => {
          const current = request.result?.value;
          if(current && /^[A-Za-z0-9_-]{20,100}$/.test(current.browserId || "") && /^[A-Za-z0-9_-]{22,100}$/.test(current.reconnectSecret || "")){
            identity = current;
            return;
          }
          identity = { browserId: randomId("browser", this.cryptoObject), reconnectSecret: randomSecret(this.cryptoObject), createdAt: Date.now() };
          store.put({ key: BROWSER_KEY, value: identity });
        };
        request.onerror = () => { try{ tx.abort(); }catch(_error){} };
        tx.oncomplete = () => resolve(identity);
        tx.onerror = () => reject(tx.error || request.error || new Error("Nearby Arcade storage failed."));
        tx.onabort = tx.onerror;
      });
    }finally{ db.close(); }
  }

  loadCheckpoint(){ return this.get(CHECKPOINT_KEY); }
  saveCheckpoint(value){ return this.set(CHECKPOINT_KEY, value); }
  clearCheckpoint(){ return this.delete(CHECKPOINT_KEY); }
  loadProfile(){ return this.get(PROFILE_KEY); }
  saveProfile(value){ return this.set(PROFILE_KEY, value); }
}

export class MemoryNearbyStorage {
  constructor({ cryptoObject = globalThis.crypto, seed = [] } = {}){
    this.cryptoObject = cryptoObject;
    this.records = new Map(seed);
    this.browserIdentityTask = null;
  }
  async get(key){ return this.records.has(key) ? structuredClone(this.records.get(key)) : null; }
  async set(key, value){ this.records.set(key, structuredClone(value)); return value; }
  async delete(key){ this.records.delete(key); }
  async browserIdentity(){
    if(!this.browserIdentityTask){
      this.browserIdentityTask = (async() => {
        const current = await this.get(BROWSER_KEY);
        if(current && current.reconnectSecret) return current;
        const created = { browserId: randomId("browser", this.cryptoObject), reconnectSecret: randomSecret(this.cryptoObject), createdAt: Date.now() };
        await this.set(BROWSER_KEY, created);
        return created;
      })().finally(() => { this.browserIdentityTask = null; });
    }
    return this.browserIdentityTask;
  }
  loadCheckpoint(){ return this.get(CHECKPOINT_KEY); }
  saveCheckpoint(value){ return this.set(CHECKPOINT_KEY, value); }
  clearCheckpoint(){ return this.delete(CHECKPOINT_KEY); }
  loadProfile(){ return this.get(PROFILE_KEY); }
  saveProfile(value){ return this.set(PROFILE_KEY, value); }
}

export function createNearbyStorage(options){ return new IndexedDbNearbyStorage(options); }
