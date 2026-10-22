/**
 * engine.js - 100単語カード学習メソッド エンジン
 * 
 * 1. 1日のデッキは常に「100単語」キープ
 * 2. 日中学習: スワイプで自由に反復
 * 3. 夜テスト & 翌朝テスト: 朝テストで×だった単語が翌日へスライド持ち越し
 * 4. 日曜日は新規追加なしの「総復習テスト専用の日」
 * 5. 日付変更線は「午前3:00」
 */

export const AppMode = {
  DAY_STUDY: 'day_study',         // 日中スキマ学習
  NIGHT_TEST: 'night_test',       // 夜のテスト
  MORNING_TEST: 'morning_test',   // 翌朝のテスト
  SUNDAY_REVIEW: 'sunday_review'  // 日曜総復習
};

export class MethodEngine {
  constructor() {
    this.DAILY_LIMIT = 100;
  }

  /**
   * 午前3時を基準とした論理日付を取得 (YYYY-MM-DD)
   */
  getLogicalDate(now = new Date()) {
    // 3時間引くことで、深夜2:59までは前日扱いになる
    const shifted = new Date(now.getTime() - 3 * 60 * 60 * 1000);
    const y = shifted.getFullYear();
    const m = String(shifted.getMonth() + 1).padStart(2, '0');
    const d = String(shifted.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  /**
   * 論理日付の曜日 (0:日, 1:月, ..., 6:土)
   */
  getLogicalDayOfWeek(now = new Date()) {
    const shifted = new Date(now.getTime() - 3 * 60 * 60 * 1000);
    return shifted.getDay();
  }

  /**
   * 現在時刻に応じた推奨モード
   * - 日曜日は終日「日曜総復習」
   * - 月〜土:
   *   - 03:00 〜 11:59: 翌朝のテスト (Morning) または 日中学習
   *   - 12:00 〜 20:59: 日中スキマ学習 (Day)
   *   - 21:00 〜 翌02:59: 夜のテスト (Night)
   */
  getRecommendedMode(now = new Date()) {
    const day = this.getLogicalDayOfWeek(now);
    if (day === 0) {
      return AppMode.SUNDAY_REVIEW;
    }

    const hour = now.getHours();
    if (hour >= 21 || hour < 3) {
      return AppMode.NIGHT_TEST;
    } else if (hour >= 3 && hour < 12) {
      return AppMode.MORNING_TEST;
    } else {
      return AppMode.DAY_STUDY;
    }
  }

  /**
   * 1日の100単語デッキを生成
   * @param {Array} allWords - 全登録単語
   * @param {Array} carryoverIds - 前日からスライドされた未記憶単語ID
   * @param {Object} existingDeck - 本日既に生成済みのデッキ情報があれば渡す
   */
  generateDailyDeck(allWords, carryoverIds = [], existingDeck = null) {
    const logicalDate = this.getLogicalDate();
    const dayOfWeek = this.getLogicalDayOfWeek();

    // 既に本日デッキがある場合はそれを返す
    if (existingDeck && existingDeck.date === logicalDate) {
      return existingDeck;
    }

    const wordMap = new Map(allWords.map(w => [w.id, w]));

    // 日曜日の場合: 週次総復習モード（新規追加なし）
    if (dayOfWeek === 0) {
      // 今週マスタープールにある単語を抽出
      const weeklyIds = allWords.filter(w => w.status === 'weekly_pending').map(w => w.id);
      this.shuffle(weeklyIds);
      return {
        date: logicalDate,
        mode: AppMode.SUNDAY_REVIEW,
        wordIds: weeklyIds,
        results: {} // id -> boolean
      };
    }

    // 月〜土の場合: スライド単語優先 + 新規単語で合計100単語
    const selectedIds = [];

    // 1. スライド持ち越し単語
    for (const cid of carryoverIds) {
      if (selectedIds.length >= this.DAILY_LIMIT) break;
      if (wordMap.has(cid)) {
        selectedIds.push(cid);
      }
    }

    // 2. 新規単語（unseen）の補充
    const needed = this.DAILY_LIMIT - selectedIds.length;
    if (needed > 0) {
      const unseen = allWords.filter(w => !w.status || w.status === 'unseen' || w.status === 'new');
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

  shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }
}

export const engine = new MethodEngine();
