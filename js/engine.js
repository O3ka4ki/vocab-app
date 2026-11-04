/**
 * engine.js - 100単語メソッド＆進捗管理
 */

export const AppMode = {
  DAY_STUDY: 'day_study',         // ☀️ 日中スキマ学習 (100語)
  MORNING_TEST: 'morning_test',   // 🌅 翌朝の復習テスト (120語)
  CONFIRMATION_TEST: 'confirm_test', // 🎯 実力確認テスト (100問)
  SCREENING: 'screening'          // 🔍 全体初回スクリーニング
};

export class MethodEngine {
  constructor() {
    this.DAILY_LIMIT = 100;
  }

  getLogicalDate(now = new Date()) {
    const shifted = new Date(now.getTime() - 3 * 60 * 60 * 1000);
    const y = shifted.getFullYear();
    const m = String(shifted.getMonth() + 1).padStart(2, '0');
    const d = String(shifted.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  /**
   * 前日の論理日付を取得 (YYYY-MM-DD)
   */
  getYesterdayLogicalDate(now = new Date()) {
    const shifted = new Date(now.getTime() - 3 * 60 * 60 * 1000 - 24 * 60 * 60 * 1000);
    const y = shifted.getFullYear();
    const m = String(shifted.getMonth() + 1).padStart(2, '0');
    const d = String(shifted.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  getLogicalDayOfWeek(now = new Date()) {
    const shifted = new Date(now.getTime() - 3 * 60 * 60 * 1000);
    return shifted.getDay();
  }

  getRecommendedMode(now = new Date()) {
    const hour = now.getHours();
    if (hour >= 3 && hour < 12) return AppMode.MORNING_TEST;
    return AppMode.DAY_STUDY;
  }

  generateDailyDeck(allWords, carryoverIds = [], existingDeck = null) {
    const logicalDate = this.getLogicalDate();
    const wordMap = new Map(allWords.map(w => [w.id, w]));

    // 既存デッキが DAY_STUDY かつ 今日の日付の場合のみ再利用
    if (existingDeck && existingDeck.date === logicalDate && existingDeck.mode === AppMode.DAY_STUDY) {
      // 合格済み単語を除外
      let activeIds = (existingDeck.wordIds || []).filter(id => {
        const w = wordMap.get(id);
        return w && w.status !== 'weekly_pending' && w.status !== 'learned' && w.status !== 'mastered';
      });

      // 100語を超えている場合は100語にカット
      if (activeIds.length > this.DAILY_LIMIT) {
        activeIds = activeIds.slice(0, this.DAILY_LIMIT);
      }

      // 100語未満の場合は新規単語(unseen)で100語きっかりまで補充
      if (activeIds.length < this.DAILY_LIMIT) {
        const needed = this.DAILY_LIMIT - activeIds.length;
        const usedSet = new Set(activeIds);
        const unseen = allWords.filter(w => (!w.status || w.status === 'unseen' || w.status === 'new') && !usedSet.has(w.id));
        unseen.sort((a, b) => a.id - b.id);
        const newIds = unseen.slice(0, needed).map(w => w.id);
        activeIds.push(...newIds);
      }
      existingDeck.wordIds = activeIds;
      return existingDeck;
    }

    const selectedIds = [];
    // 1. 持ち越し単語（未習得のもののみ、最大100語まで）
    for (const cid of carryoverIds) {
      if (selectedIds.length >= this.DAILY_LIMIT) break;
      const w = wordMap.get(cid);
      if (w && w.status !== 'weekly_pending' && w.status !== 'learned' && w.status !== 'mastered') {
        selectedIds.push(cid);
      }
    }

    // 2. 新規単語（unseen）で100語きっかりまで補充（金のフレーズ書籍の番号順）
    const needed = this.DAILY_LIMIT - selectedIds.length;
    if (needed > 0) {
      const usedSet = new Set(selectedIds);
      const unseen = allWords.filter(w => (!w.status || w.status === 'unseen' || w.status === 'new') && !usedSet.has(w.id));
      unseen.sort((a, b) => a.id - b.id);
      const newIds = unseen.slice(0, needed).map(w => w.id);
      selectedIds.push(...newIds);
    }

    // 書籍の番号順（1〜100、101〜200...）に整列して最初から出題
    selectedIds.sort((a, b) => a - b);

    return {
      date: logicalDate,
      mode: AppMode.DAY_STUDY,
      wordIds: selectedIds.slice(0, this.DAILY_LIMIT),
      results: {}
    };
  }

  /**
   * これまでに覚えた単語から100問の確認テストデッキを生成
   */
  /**
   * 🌅 翌朝の復習テストデッキの生成
   * 内訳: 昨日の単語(約100問) + 過去の「学習済み」から抜き打ち復習(最大20問)
   */
  generateMorningDeck(allWords, yesterdayDeck = null, todayDeck = null, reviewLimit = 20) {
    const logicalDate = this.getLogicalDate();
    const wordMap = new Map(allWords.map(w => [w.id, w]));
    let baseWordIds = [];

    if (yesterdayDeck && yesterdayDeck.wordIds && yesterdayDeck.wordIds.length > 0) {
      baseWordIds = [...yesterdayDeck.wordIds];
    } else if (todayDeck && todayDeck.wordIds && todayDeck.wordIds.length > 0) {
      baseWordIds = [...todayDeck.wordIds];
    }

    // baseWordIds は必ず最大100問に制限
    baseWordIds = baseWordIds.slice(0, 100);

    // もし昨日の単語が100問に満たない場合は、学習中・未着手単語から100問まで補充
    if (baseWordIds.length < 100) {
      const needed = 100 - baseWordIds.length;
      const usedSet = new Set(baseWordIds);
      const candidates = allWords.filter(w => w.status !== 'mastered' && !usedSet.has(w.id));
      const addIds = candidates.slice(0, needed).map(w => w.id);
      baseWordIds.push(...addIds);
    }

    // 過去の「学習済み (learned / weekly_pending)」単語から抜き打ち20問を抽出
    const baseSet = new Set(baseWordIds);
    const learnedPool = allWords.filter(w => (w.status === 'learned' || w.status === 'weekly_pending') && !baseSet.has(w.id));
    
    let reviewIds = [];
    if (learnedPool.length > 0) {
      const shuffledLearned = this.shuffle([...learnedPool.map(w => w.id)]);
      reviewIds = shuffledLearned.slice(0, reviewLimit);
    }

    // 昨日の100問 + 抜き打ち20問 ＝ 計120問
    const combinedIds = [...baseWordIds, ...reviewIds];
    this.shuffle(combinedIds);

    return {
      date: logicalDate,
      mode: AppMode.MORNING_TEST,
      wordIds: combinedIds,
      reviewWordIds: reviewIds, // 抜き打ち20問の単語IDセット
      morningResults: {}
    };
  }

  /**
   * 🎯 暗記済み確認テストデッキを生成 (👑 暗記済みのみが対象)
   */
  generateConfirmationTestDeck(allWords, limit = 100) {
    const pool = allWords.filter(w => w.status === 'mastered');
    if (pool.length === 0) {
      return {
        date: this.getLogicalDate(),
        mode: AppMode.CONFIRMATION_TEST,
        wordIds: [],
        results: {}
      };
    }

    const ids = pool.map(w => w.id);
    this.shuffle(ids);

    const selectedIds = ids.slice(0, limit);
    return {
      date: this.getLogicalDate(),
      mode: AppMode.CONFIRMATION_TEST,
      wordIds: selectedIds,
      results: {}
    };
  }

  shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }
}

export const engine = new MethodEngine();
