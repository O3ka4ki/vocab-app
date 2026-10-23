/**
 * engine.js - 100単語メソッド＆進捗管理
 */

export const AppMode = {
  DAY_STUDY: 'day_study',         // 日中スキマ学習
  NIGHT_TEST: 'night_test',       // 夜のテスト
  MORNING_TEST: 'morning_test',   // 翌朝のテスト
  SUNDAY_REVIEW: 'sunday_review', // 日曜総復習
  CONFIRMATION_TEST: 'confirm_test' // 実力確認テスト (100問)
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
    const day = this.getLogicalDayOfWeek(now);
    if (day === 0) return AppMode.SUNDAY_REVIEW;

    const hour = now.getHours();
    if (hour >= 21 || hour < 3) return AppMode.NIGHT_TEST;
    else if (hour >= 3 && hour < 12) return AppMode.MORNING_TEST;
    else return AppMode.DAY_STUDY;
  }

  generateDailyDeck(allWords, carryoverIds = [], existingDeck = null) {
    const logicalDate = this.getLogicalDate();
    const dayOfWeek = this.getLogicalDayOfWeek();
    const wordMap = new Map(allWords.map(w => [w.id, w]));

    if (existingDeck && existingDeck.date === logicalDate && existingDeck.mode !== AppMode.CONFIRMATION_TEST) {
      // 既存デッキの中に、朝テスト等で合格（weekly_pending / mastered）した単語が含まれていないか検査
      const activeIds = (existingDeck.wordIds || []).filter(id => {
        const w = wordMap.get(id);
        return w && w.status !== 'weekly_pending' && w.status !== 'mastered';
      });

      // 合格した単語が除外されて100語未満になった場合は、新規単語(unseen)で100語まで補充する
      if (activeIds.length < (existingDeck.wordIds || []).length) {
        const needed = this.DAILY_LIMIT - activeIds.length;
        if (needed > 0) {
          const usedSet = new Set(activeIds);
          const unseen = allWords.filter(w => (!w.status || w.status === 'unseen' || w.status === 'new') && !usedSet.has(w.id));
          const newIds = unseen.slice(0, needed).map(w => w.id);
          activeIds.push(...newIds);
        }
        existingDeck.wordIds = activeIds;
      }
      return existingDeck;
    }

    if (dayOfWeek === 0) {
      const weeklyIds = allWords.filter(w => w.status === 'weekly_pending' || w.status === 'mastered').map(w => w.id);
      this.shuffle(weeklyIds);
      return {
        date: logicalDate,
        mode: AppMode.SUNDAY_REVIEW,
        wordIds: weeklyIds,
        results: {}
      };
    }

    const selectedIds = [];
    // 1. 持ち越し単語（未習得のもののみ）
    for (const cid of carryoverIds) {
      if (selectedIds.length >= this.DAILY_LIMIT) break;
      const w = wordMap.get(cid);
      if (w && w.status !== 'weekly_pending' && w.status !== 'mastered') {
        selectedIds.push(cid);
      }
    }

    // 2. 新規単語（unseen）の補充
    const needed = this.DAILY_LIMIT - selectedIds.length;
    if (needed > 0) {
      const usedSet = new Set(selectedIds);
      const unseen = allWords.filter(w => (!w.status || w.status === 'unseen' || w.status === 'new') && !usedSet.has(w.id));
      const newIds = unseen.slice(0, needed).map(w => w.id);
      selectedIds.push(...newIds);
    }

    this.shuffle(selectedIds);

    return {
      date: logicalDate,
      mode: AppMode.DAY_STUDY,
      wordIds: selectedIds,
      nightResults: {},
      morningResults: {}
    };
  }

  /**
   * これまでに覚えた単語から100問の確認テストデッキを生成
   */
  generateConfirmationTestDeck(allWords, limit = 100) {
    // 実際に朝テスト・日曜テストで合格した単語のみを対象にする
    const pool = allWords.filter(w => w.status === 'mastered' || w.status === 'weekly_pending');
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
