/**
 * sync.js - Firebase Firestore を用いたクラウド双方向同期モジュール
 * 
 * 特徴:
 * 1. ローカルファースト (Local-First): すべての操作はIndexedDBで即座に動作し、バックグラウンドで差分同期
 * 2. 完全オフライン対応: ネット接続がない環境でも100%学習可能、オンライン復帰時に自動同期
 * 3. 差分同期 (Incremental Sync): 変更された単語のみを送受信し、Firebaseの無料枠と通信量を最小化
 */

import { firebaseConfig, isFirebaseConfigured } from './firebase-config.js';
import { db } from './db.js';

// Firebase SDK (CDN / ES Modules)
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { 
  getFirestore, 
  collection, 
  doc, 
  getDocs, 
  getDoc,
  setDoc, 
  writeBatch,
  query,
  where
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

export const SyncStatus = {
  IDLE: 'idle',
  SYNCING: 'syncing',
  ONLINE: 'online',
  OFFLINE: 'offline',
  ERROR: 'error'
};

class SyncManager {
  constructor() {
    this.app = null;
    this.firestore = null;
    this.initialized = false;
    this.isOnline = navigator.onLine;
    this.status = SyncStatus.IDLE;
    this.statusListeners = [];
    this.dirtyWordIds = new Set();
    this.dirtyDeck = false;
    this.syncTimeout = null;

    // ネットワーク状態監視
    window.addEventListener('online', () => {
      this.isOnline = true;
      this.notifyStatus(SyncStatus.ONLINE);
      this.sync();
    });

    window.addEventListener('offline', () => {
      this.isOnline = false;
      this.notifyStatus(SyncStatus.OFFLINE);
    });
  }

  onStatusChange(fn) {
    this.statusListeners.push(fn);
    fn(this.status, this.isOnline);
  }

  notifyStatus(status, detail = '') {
    this.status = status;
    for (const fn of this.statusListeners) {
      fn(status, this.isOnline, detail);
    }
  }

  init() {
    if (this.initialized) return true;
    if (!isFirebaseConfigured()) {
      console.warn('[Sync] Firebase config is not set.');
      return false;
    }

    try {
      this.app = initializeApp(firebaseConfig);
      this.firestore = getFirestore(this.app);
      this.initialized = true;
      this.notifyStatus(this.isOnline ? SyncStatus.IDLE : SyncStatus.OFFLINE);
      console.log('[Sync] Firebase initialized successfully.');
      return true;
    } catch (err) {
      console.error('[Sync] Firebase initialization error:', err);
      this.notifyStatus(SyncStatus.ERROR, err.message);
      return false;
    }
  }

  /**
   * 単語が学習等で更新されたことを通知（デバウンスして後でまとめて同期）
   */
  markWordDirty(wordId) {
    this.dirtyWordIds.add(wordId);
    this.scheduleDebouncedSync();
  }

  /**
   * デッキや持ち越し等の学習状態が更新されたことを通知
   */
  markDeckDirty() {
    this.dirtyDeck = true;
    this.scheduleDebouncedSync();
  }

  scheduleDebouncedSync(delayMs = 5000) {
    if (this.syncTimeout) {
      clearTimeout(this.syncTimeout);
    }
    this.syncTimeout = setTimeout(() => {
      this.sync();
    }, delayMs);
  }

  /**
   * 双方向同期のメイン実行
   * @param {boolean} forceAll - 強制的に全単語をクラウドへ送信するか
   */
  async sync(forceAll = false) {
    if (!this.initialized && !this.init()) {
      return { success: false, reason: 'unconfigured' };
    }

    if (!this.isOnline) {
      this.notifyStatus(SyncStatus.OFFLINE);
      return { success: false, reason: 'offline' };
    }

    this.notifyStatus(SyncStatus.SYNCING);

    try {
      let pullCount = 0;
      let pushCount = 0;

      // 1. クラウド側の変更を端末ローカルへ反映（Pull）
      pullCount = await this.pullFromCloud();

      // 2. ローカル側の変更をクラウドへ反映（Push）
      pushCount = await this.pushToCloud(forceAll);

      // 3. デッキ・進行状態の同期
      await this.syncDeckState();

      // 最終同期時刻を記録
      const now = Date.now();
      await db.setState('last_cloud_sync_at', now);

      this.notifyStatus(SyncStatus.ONLINE, `同期完了 (取得: ${pullCount}件, 送信: ${pushCount}件)`);
      return { success: true, pullCount, pushCount };
    } catch (err) {
      console.error('[Sync] Sync failed:', err);
      this.notifyStatus(SyncStatus.ERROR, err.message || '同期エラー');
      return { success: false, error: err };
    }
  }

  /**
   * クラウドから最新の単語をローカルへ取り込む（差分取得）
   */
  async pullFromCloud() {
    const lastSyncAt = (await db.getState('last_cloud_sync_at', 0)) || 0;
    const wordsCol = collection(this.firestore, 'words');

    let q;
    if (lastSyncAt > 0) {
      // 差分同期: 最終同期以降に更新されたものだけ取得
      q = query(wordsCol, where('updatedAt', '>', lastSyncAt));
    } else {
      // 初回同期: 全件取得
      q = wordsCol;
    }

    const snap = await getDocs(q);
    if (snap.empty) {
      return 0;
    }

    const localWords = await db.getAllWords();
    const localMap = new Map(localWords.map(w => [w.id, w]));
    const toSave = [];

    snap.forEach(docSnap => {
      const rawRemote = docSnap.data();
      const remote = {
        ...rawRemote,
        id: Number(rawRemote.id),
        updatedAt: Number(rawRemote.updatedAt || 0)
      };
      const local = localMap.get(remote.id);

      if (!local) {
        // ローカルにない新単語はそのまま保存
        toSave.push(remote);
      } else {
        // すでにローカルにある場合、更新日時が新しい方を採用
        const localUpdated = local.updatedAt || 0;
        const remoteUpdated = remote.updatedAt || 0;
        if (remoteUpdated >= localUpdated) {
          toSave.push({
            ...local,
            ...remote
          });
        }
      }
    });

    if (toSave.length > 0) {
      await db.saveWordsBulk(toSave);
    }

    return toSave.length;
  }

  /**
   * ローカルで変更された単語をクラウドへ送信
   */
  async pushToCloud(forceAll = false) {
    let wordsToPush = [];
    const allLocal = await db.getAllWords();

    if (forceAll) {
      wordsToPush = allLocal;
    } else if (this.dirtyWordIds.size > 0) {
      const localMap = new Map(allLocal.map(w => [w.id, w]));
      for (const id of this.dirtyWordIds) {
        const w = localMap.get(id);
        if (w) wordsToPush.push(w);
      }
    }

    if (wordsToPush.length === 0) {
      return 0;
    }

    // Firestore の batch は 1回最大 500 操作
    const BATCH_SIZE = 400;
    const now = Date.now();

    for (let i = 0; i < wordsToPush.length; i += BATCH_SIZE) {
      const chunk = wordsToPush.slice(i, i + BATCH_SIZE);
      const batch = writeBatch(this.firestore);

      for (const w of chunk) {
        w.updatedAt = w.updatedAt || now;
        const docRef = doc(this.firestore, 'words', `word_${w.id}`);
        // undefined を防ぐためシリアライズ
        const data = JSON.parse(JSON.stringify(w));
        batch.set(docRef, data, { merge: true });
      }

      await batch.commit();
    }

    // 更新日時をローカルにも反映してダーティフラグをクリア
    for (const w of wordsToPush) {
      w.updatedAt = now;
      await db.saveWord(w);
    }
    this.dirtyWordIds.clear();

    return wordsToPush.length;
  }

  /**
   * 今日のデッキ進行状況の同期
   */
  async syncDeckState() {
    const metaDocRef = doc(this.firestore, 'meta', 'app_state');

    if (this.dirtyDeck) {
      // ローカルの持ち越しリストや最新状態をクラウドへ保存
      const carryovers = await db.getState('carryover_ids', []);
      const logicalDate = (await db.getState('last_logical_date', '')) || '';
      const deck = (await db.getState('last_day_study_deck', null))
                || (logicalDate ? await db.getState(`deck_${logicalDate}`, null) : null);

      await setDoc(metaDocRef, {
        carryovers,
        logicalDate,
        deck,
        updatedAt: Date.now()
      }, { merge: true });

      this.dirtyDeck = false;
    } else {
      // クラウド側に最新のデッキがあれば取得（初回等）
      const snap = await getDoc(metaDocRef);
      if (snap.exists()) {
        const data = snap.data();
        if (data.carryovers) {
          const localCarryovers = await db.getState('carryover_ids', null);
          if (!localCarryovers || localCarryovers.length === 0) {
            await db.setState('carryover_ids', data.carryovers);
          }
        }
        if (data.deck) {
          const localDeck = await db.getState('last_day_study_deck', null);
          if (!localDeck) {
            await db.setState('last_day_study_deck', data.deck);
          }
        }
      }
    }
  }

  /**
   * PCから「今ある単語をすべてクラウドへ一括アップロード」
   */
  async forceUploadAllWords() {
    return await this.sync(true);
  }
}

export const syncManager = new SyncManager();

