import { db } from './db.js';
import { engine, AppMode } from './engine.js';
import { SwipeController } from './swipe.js';
import { speechService } from './speech.js';

class VocabSwipeApp {
  constructor() {
    this.allWords = [];
    this.deck = null;
    this.queue = [];
    this.currentIndex = 0;
    this.isRevealed = false;
    this.currentMode = null;

    this.initElements();
    this.bindEvents();
  }

  initElements() {
    this.card = document.getElementById('swipe-card');
    this.cardNum = document.getElementById('card-num');
    this.wordText = document.getElementById('word-text');
    this.phoneticText = document.getElementById('phonetic-text');
    this.meaningContainer = document.getElementById('meaning-container');
    this.meaningText = document.getElementById('meaning-text');
    this.exampleBox = document.getElementById('example-box');
    this.btnAudio = document.getElementById('btn-audio');

    this.progressBar = document.getElementById('progress-bar');
    this.modeBadge = document.getElementById('mode-badge');
    this.modeBtns = document.querySelectorAll('.mode-btn');

    this.btnFail = document.getElementById('btn-fail');
    this.btnPass = document.getElementById('btn-pass');
    this.btnFlip = document.getElementById('btn-flip');

    this.completeOverlay = document.getElementById('complete-overlay');
    this.completeDesc = document.getElementById('complete-desc');
    this.btnNextSession = document.getElementById('btn-next-session');

    // Swipe Controller 初期化
    this.swipe = new SwipeController(
      this.card,
      () => this.handleAnswer(false), // 左スワイプ: ✕ 分からない
      () => this.handleAnswer(true),  // 右スワイプ: ◯ 分かる
      () => this.toggleMeaning()      // タップ: 意味表示
    );
  }

  async start() {
    await db.init();
    this.allWords = await db.getAllWords();

    // 初回起動で単語がなければサンプルを読み込む
    if (this.allWords.length === 0) {
      await this.loadInitialSampleWords();
    }

    this.currentMode = engine.getRecommendedMode();
    await this.setupDeck();
  }

  async setupDeck() {
    const logicalDate = engine.getLogicalDate();
    const existingDeck = await db.getState(`deck_${logicalDate}`, null);
    const carryovers = await db.getState('carryover_ids', []);

    // デッキ生成
    this.deck = engine.generateDailyDeck(this.allWords, carryovers, existingDeck);
    await db.setState(`deck_${logicalDate}`, this.deck);

    // キューの作成
    const wordMap = new Map(this.allWords.map(w => [w.id, w]));
    this.queue = this.deck.wordIds.map(id => wordMap.get(id)).filter(Boolean);

    this.updateModeUI();
    this.currentIndex = 0;
    this.showCurrentWord();
  }

  updateModeUI() {
    const labels = {
      [AppMode.DAY_STUDY]: '☀️ 日中スキマ学習',
      [AppMode.NIGHT_TEST]: '🌙 夜のテスト (10秒)',
      [AppMode.MORNING_TEST]: '🌅 翌朝の復習テスト',
      [AppMode.SUNDAY_REVIEW]: '👑 日曜総復習テスト'
    };
    this.modeBadge.textContent = labels[this.currentMode] || '学習中';

    this.modeBtns.forEach(b => {
      b.classList.toggle('active', b.dataset.mode === this.currentMode);
    });
  }

  showCurrentWord() {
    if (this.currentIndex >= this.queue.length) {
      this.handleSessionComplete();
      return;
    }

    const item = this.queue[this.currentIndex];
    this.isRevealed = false;

    // プログレスバー
    const progress = (this.currentIndex / this.queue.length) * 100;
    this.progressBar.style.width = `${progress}%`;
    this.cardNum.textContent = `${this.currentIndex + 1} / ${this.queue.length}`;

    // 表面（英語）
    this.wordText.textContent = item.word;
    this.phoneticText.textContent = item.phonetic || '';

    // 裏面（日本語）は隠す
    this.meaningContainer.style.display = 'none';
    this.meaningText.textContent = item.meaning;
    if (item.example) {
      this.exampleBox.style.display = 'block';
      this.exampleBox.textContent = `Ex: ${item.example}`;
    } else {
      this.exampleBox.style.display = 'none';
    }

    this.completeOverlay.style.display = 'none';
  }

  toggleMeaning() {
    this.isRevealed = !this.isRevealed;
    this.meaningContainer.style.display = this.isRevealed ? 'flex' : 'none';
    if (this.isRevealed) {
      const item = this.queue[this.currentIndex];
      speechService.speak(item.word);
    }
  }

  async handleAnswer(isPass) {
    if (this.currentIndex >= this.queue.length) return;
    const currentItem = this.queue[this.currentIndex];

    // 結果の記録
    const logicalDate = engine.getLogicalDate();
    if (!this.deck.results) this.deck.results = {};
    this.deck.results[currentItem.id] = isPass;

    // モード別の結果保存
    if (this.currentMode === AppMode.NIGHT_TEST) {
      if (!this.deck.nightResults) this.deck.nightResults = {};
      this.deck.nightResults[currentItem.id] = isPass;
    } else if (this.currentMode === AppMode.MORNING_TEST) {
      if (!this.deck.morningResults) this.deck.morningResults = {};
      this.deck.morningResults[currentItem.id] = isPass;
    }

    await db.setState(`deck_${logicalDate}`, this.deck);

    this.currentIndex++;
    this.showCurrentWord();
  }

  async handleSessionComplete() {
    this.progressBar.style.width = '100%';
    this.completeOverlay.style.display = 'flex';

    if (this.currentMode === AppMode.MORNING_TEST) {
      // 翌朝テスト完了時: 不正解（未記憶）の単語を翌日持ち越しキューに確定
      const failedIds = [];
      const passedIds = [];
      for (const [widStr, ok] of Object.entries(this.deck.morningResults || {})) {
        const wid = parseInt(widStr, 10);
        if (!ok) failedIds.push(wid);
        else passedIds.push(wid);
      }

      // 持ち越しキューを更新
      await db.setState('carryover_ids', failedIds);

      // 合格したものは週次マスタープールへ
      for (const pid of passedIds) {
        const w = this.allWords.find(x => x.id === pid);
        if (w) {
          w.status = 'weekly_pending';
          await db.saveWord(w);
        }
      }

      this.completeDesc.innerHTML = `朝のテスト完了！<br>合格: <strong>${passedIds.length}</strong> 単語<br>未記憶(翌日へスライド): <strong>${failedIds.length}</strong> 単語`;
    } else if (this.currentMode === AppMode.SUNDAY_REVIEW) {
      // 日曜総復習完了時: 落ちた単語を月曜の持ち越しへ
      const failedIds = [];
      const passedIds = [];
      for (const [widStr, ok] of Object.entries(this.deck.results || {})) {
        const wid = parseInt(widStr, 10);
        if (!ok) failedIds.push(wid);
        else passedIds.push(wid);
      }
      await db.setState('carryover_ids', failedIds);
      this.completeDesc.innerHTML = `日曜総復習完了！<br>完全習得: <strong>${passedIds.length}</strong> 単語<br>忘却(月曜へスライド): <strong>${failedIds.length}</strong> 単語`;
    } else {
      this.completeDesc.innerHTML = `100単語のチェックが完了しました！<br>テンポよく反復して脳に定着させましょう。`;
    }
  }

  bindEvents() {
    // ボタン操作（スワイプと同じ動作）
    this.btnFail.addEventListener('click', () => this.swipe.triggerSwipe('left'));
    this.btnPass.addEventListener('click', () => this.swipe.triggerSwipe('right'));
    this.btnFlip.addEventListener('click', () => this.toggleMeaning());

    // 音声再生
    this.btnAudio.addEventListener('click', (e) => {
      e.stopPropagation();
      const item = this.queue[this.currentIndex];
      if (item) speechService.speak(item.word);
    });

    // キーボード操作（PC用）
    window.addEventListener('keydown', (e) => {
      if (e.code === 'ArrowLeft') this.swipe.triggerSwipe('left');
      else if (e.code === 'ArrowRight') this.swipe.triggerSwipe('right');
      else if (e.code === 'Space' || e.code === 'Enter') this.toggleMeaning();
    });

    // モード切り替えボタン
    this.modeBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        this.currentMode = btn.dataset.mode;
        this.updateModeUI();
        this.currentIndex = 0;
        this.showCurrentWord();
      });
    });

    // 完了後の再確認
    this.btnNextSession.addEventListener('click', () => {
      this.currentIndex = 0;
      this.showCurrentWord();
    });
  }

  async loadInitialSampleWords() {
    try {
      const resp = await fetch('samples/sample_words.csv');
      const text = await resp.text();
      const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean).slice(1);
      const parsed = lines.map((line, idx) => {
        const cols = line.split(',');
        return {
          id: idx + 1,
          word: cols[0]?.trim(),
          meaning: cols[1]?.trim(),
          phonetic: cols[2]?.trim() || '',
          example: cols[3]?.trim() || '',
          status: 'unseen'
        };
      }).filter(w => w.word && w.meaning);

      await db.saveWordsBulk(parsed);
      this.allWords = parsed;
    } catch (e) {
      console.log('Sample load skipped:', e);
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const app = new VocabSwipeApp();
  app.start();
});
