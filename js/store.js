// Local storage for the book (IndexedDB) and settings (localStorage).
// The book text only ever lives on this device.

const DB_NAME = 'tao-meditation';
const STORE = 'chapters';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'n' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(mode, fn) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const out = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(out && 'result' in out ? out.result : undefined);
    t.onerror = () => reject(t.error);
  }));
}

export const saveChapters = chapters =>
  tx('readwrite', s => { s.clear(); chapters.forEach(c => s.put(c)); });

export const getChapter = n => tx('readonly', s => s.get(n));
export const countChapters = () => tx('readonly', s => s.count());
export const clearBook = () => tx('readwrite', s => s.clear());

export async function askPersistence() {
  try {
    if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist();
  } catch (e) { /* ignore */ }
  return false;
}

const SETTINGS_KEY = 'tao-meditation-settings';
export function loadSettings() {
  try { return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; } catch (e) { return {}; }
}
export function saveSettings(s) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch (e) { /* ignore */ }
}
