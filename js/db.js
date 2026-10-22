/**
 * db.js - IndexedDB 単語・デッキ永続化
 */
const DB_NAME = 'Method100DB';
const DB_VERSION = 1;

class MethodDB {
  constructor() {
    this.db = null;
  }

  async init() {
    if (this.db) return this.db;

    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        this.db = req.result;
        resolve(this.db);
      };
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('words')) {
          db.createObjectStore('words', { keyPath: 'id', autoIncrement: true });
        }
        if (!db.objectStoreNames.contains('app_state')) {
          db.createObjectStore('app_state', { keyPath: 'key' });
        }
      };
    });
  }

  async getAllWords() {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['words'], 'readonly');
      const store = tx.objectStore('words');
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async saveWordsBulk(words) {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['words'], 'readwrite');
      const store = tx.objectStore('words');
      for (const w of words) {
        store.put(w);
      }
      tx.oncomplete = () => resolve(words.length);
      tx.onerror = () => reject(tx.error);
    });
  }

  async saveWord(word) {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['words'], 'readwrite');
      const store = tx.objectStore('words');
      const req = store.put(word);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async clearAllWords() {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['words', 'app_state'], 'readwrite');
      tx.objectStore('words').clear();
      tx.objectStore('app_state').clear();
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  }

  async getState(key, defaultValue = null) {
    await this.init();
    return new Promise((resolve) => {
      const tx = this.db.transaction(['app_state'], 'readonly');
      const store = tx.objectStore('app_state');
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result ? req.result.value : defaultValue);
      req.onerror = () => resolve(defaultValue);
    });
  }

  async setState(key, value) {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['app_state'], 'readwrite');
      const store = tx.objectStore('app_state');
      const req = store.put({ key, value });
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  }
}

export const db = new MethodDB();
