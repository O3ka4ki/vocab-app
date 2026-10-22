import { db } from './db.js';
import { engine, AppMode } from './engine.js';
import { SwipeController } from './swipe.js';
import { speechService } from './speech.js';

const DATA_VERSION = 12;

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
    // Views & Tabs
    this.tabBtnStudy = document.getElementById('tab-btn-study');
    this.tabBtnProgress = document.getElementById('tab-btn-progress');
    this.viewStudy = document.getElementById('view-study');
    this.viewProgress = document.getElementById('view-progress');
    this.studyProgressContainer = document.getElementById('study-progress-container');

    // Dashboard Elements
    this.dashPercentage = document.getElementById('dash-percentage');
    this.dashProgressFill = document.getElementById('dash-progress-fill');
    this.dashMasteredCount = document.getElementById('dash-mastered-count');
    this.dashTotalCount = document.getElementById('dash-total-count');
    this.statCountMastered = document.getElementById('stat-count-mastered');
    this.statCountLearning = document.getElementById('stat-count-learning');
    this.statCountUnseen = document.getElementById('stat-count-unseen');
    this.dashCarryoverCount = document.getElementById('dash-carryover-count');
    this.btnStartConfirmTest = document.getElementById('btn-start-confirm-test');

    // Card Elements
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

    this.btnFail = document.getElementById('btn-fail');
    this.btnPass = document.getElementById('btn-pass');
    this.btnFlip = document.getElementById('btn-flip');

    this.completeOverlay = document.getElementById('complete-overlay');
    this.completeDesc = document.getElementById('complete-desc');
    this.btnNextSession = document.getElementById('btn-next-session');

    // Swipe Controller
    this.swipe = new SwipeController(
      this.card,
      () => this.handleAnswer(false),
      () => this.handleAnswer(true),
      () => this.toggleMeaning()
    );
  }

  async start() {
    await db.init();
    
    const savedVer = await db.getState('data_version', 1);
    if (savedVer < DATA_VERSION) {
      await db.clearAllWords();
      await this.loadInitialSampleWords();
      await db.setState('data_version', DATA_VERSION);
    } else {
      this.allWords = await db.getAllWords();
      if (this.allWords.length === 0) {
        await this.loadInitialSampleWords();
        await db.setState('data_version', DATA_VERSION);
      }
    }

    this.currentMode = engine.getRecommendedMode();
    await this.setupDeck();
    this.updateDashboardStats();
  }

  async setupDeck() {
    const logicalDate = engine.getLogicalDate();
    const existingDeck = await db.getState(`deck_${logicalDate}`, null);
    const carryovers = await db.getState('carryover_ids', []);

    this.deck = engine.generateDailyDeck(this.allWords, carryovers, existingDeck);
    await db.setState(`deck_${logicalDate}`, this.deck);

    const wordMap = new Map(this.allWords.map(w => [w.id, w]));
    this.queue = this.deck.wordIds.map(id => wordMap.get(id)).filter(Boolean);

    this.updateModeUI();
    this.currentIndex = 0;
    this.showCurrentWord();
  }

    async startConfirmationTest() {
    const pool = this.allWords.filter(w => w.status === 'mastered' || w.status === 'weekly_pending');
    if (pool.length === 0) {
      alert('まだ合格した単語がありません。まずは日々の「翌朝の復習テスト」で単語を合格させましょう！');
      return;
    }
    const testCount = Math.min(pool.length, 100);
    this.currentMode = AppMode.CONFIRMATION_TEST;
    this.deck = engine.generateConfirmationTestDeck(this.allWords, testCount);

    const wordMap = new Map(this.allWords.map(w => [w.id, w]));
    this.queue = this.deck.wordIds.map(id => wordMap.get(id)).filter(Boolean);

    this.switchView('study');
    this.updateModeUI();
    this.currentIndex = 0;
    this.showCurrentWord();
  }

  updateModeUI() {
    const labels = {
      [AppMode.DAY_STUDY]: '☀️ 日中スキマ学習',
      [AppMode.NIGHT_TEST]: '🌙 夜のテスト (10秒)',
      [AppMode.MORNING_TEST]: '🌅 翌朝の復習テスト',
      [AppMode.SUNDAY_REVIEW]: '👑 日曜総復習テスト',
      [AppMode.CONFIRMATION_TEST]: '🎯 実力確認テスト (100問)'
    };
    this.modeBadge.textContent = (labels[this.currentMode] || '学習中') + ' ▾';
  }

  async updateDashboardStats() {
    this.allWords = await db.getAllWords();
    const carryovers = await db.getState('carryover_ids', []);

    let mastered = 0;
    let learning = 0;
    let unseen = 0;

    for (const w of this.allWords) {
      if (w.status === 'mastered' || w.status === 'weekly_pending') mastered++;
      else if (w.status === 'learning' || carryovers.includes(w.id)) learning++;
      else unseen++;
    }

    const total = this.allWords.length;
    const percentage = total > 0 ? Math.round((mastered / total) * 100) : 0;

    this.dashPercentage.textContent = `${percentage}%`;
    this.dashProgressFill.style.width = `${percentage}%`;
    this.dashMasteredCount.textContent = mastered;
    this.dashTotalCount.textContent = total;

    this.statCountMastered.textContent = mastered;
    this.statCountLearning.textContent = learning;
    this.statCountUnseen.textContent = unseen;
    this.dashCarryoverCount.textContent = `${carryovers.length} 語`;
    // 確認テストボタンの状態更新
    if (mastered === 0) {
      this.btnStartConfirmTest.disabled = true;
      this.btnStartConfirmTest.innerHTML = '<span>🔒</span> 合格した単語がまだありません (0語)';
    } else {
      this.btnStartConfirmTest.disabled = false;
      const testCount = Math.min(mastered, 100);
      this.btnStartConfirmTest.innerHTML = `<span>🚀</span> 合格単語から確認テスト（${testCount}問）を開始`;
    }

  }

  showCurrentWord() {
    if (this.currentIndex >= this.queue.length) {
      this.handleSessionComplete();
      return;
    }

    const item = this.queue[this.currentIndex];
    this.isRevealed = false;

    const progress = (this.currentIndex / this.queue.length) * 100;
    this.progressBar.style.width = `${progress}%`;
    this.cardNum.textContent = `${this.currentIndex + 1} / ${this.queue.length}`;

    this.wordText.textContent = item.word;
    this.phoneticText.textContent = item.phonetic || '';

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
    if (!this.deck.results) this.deck.results = {};
    this.deck.results[currentItem.id] = isPass;

    if (this.currentMode === AppMode.NIGHT_TEST) {
      if (!this.deck.nightResults) this.deck.nightResults = {};
      this.deck.nightResults[currentItem.id] = isPass;
    } else if (this.currentMode === AppMode.MORNING_TEST) {
      if (!this.deck.morningResults) this.deck.morningResults = {};
      this.deck.morningResults[currentItem.id] = isPass;
    }

    // ★重要: 確認テストで間違えた場合、即座に明日の持ち越しキューへ移送
    if (this.currentMode === AppMode.CONFIRMATION_TEST) {
      if (!isPass) {
        const carryovers = await db.getState('carryover_ids', []);
        if (!carryovers.includes(currentItem.id)) {
          carryovers.unshift(currentItem.id);
          await db.setState('carryover_ids', carryovers);
        }
        currentItem.status = 'learning';
        await db.saveWord(currentItem);
      }
    }

    const logicalDate = engine.getLogicalDate();
    if (this.currentMode !== AppMode.CONFIRMATION_TEST) {
      await db.setState(`deck_${logicalDate}`, this.deck);
    }

    this.currentIndex++;
    this.showCurrentWord();
  }

  async handleSessionComplete() {
    this.progressBar.style.width = '100%';
    this.completeOverlay.style.display = 'flex';

    if (this.currentMode === AppMode.CONFIRMATION_TEST) {
      // 確認テスト完了
      const failed = [];
      const passed = [];
      for (const [widStr, ok] of Object.entries(this.deck.results || {})) {
        if (!ok) failed.push(parseInt(widStr, 10));
        else passed.push(parseInt(widStr, 10));
      }

      this.completeDesc.innerHTML = `実力テスト完了！<br>正解: <strong>${passed.length}</strong> 問<br>間違えた <strong>${failed.length}</strong> 語は明日の100単語デッキに組み込みました！`;
      await this.updateDashboardStats();
    } else if (this.currentMode === AppMode.MORNING_TEST) {
      const failedIds = [];
      const passedIds = [];
      for (const [widStr, ok] of Object.entries(this.deck.morningResults || {})) {
        const wid = parseInt(widStr, 10);
        if (!ok) failedIds.push(wid);
        else passedIds.push(wid);
      }

      await db.setState('carryover_ids', failedIds);

      for (const pid of passedIds) {
        const w = this.allWords.find(x => x.id === pid);
        if (w) {
          w.status = 'weekly_pending';
          await db.saveWord(w);
        }
      }

      this.completeDesc.innerHTML = `朝のテスト完了！<br>合格: <strong>${passedIds.length}</strong> 単語<br>未記憶(翌日へスライド): <strong>${failedIds.length}</strong> 単語`;
      await this.updateDashboardStats();
    } else {
      this.completeDesc.innerHTML = `全単語のチェックが完了しました！<br>テンポよく反復して脳に定着させましょう。`;
    }
  }

  switchView(viewName) {
    if (viewName === 'progress') {
      this.viewStudy.style.display = 'none';
      this.viewProgress.style.display = 'block';
      this.studyProgressContainer.style.display = 'none';
      this.tabBtnStudy.classList.remove('active');
      this.tabBtnProgress.classList.add('active');
      this.updateDashboardStats();
    } else {
      this.viewStudy.style.display = 'flex';
      this.viewProgress.style.display = 'none';
      this.studyProgressContainer.style.display = 'block';
      this.tabBtnStudy.classList.add('active');
      this.tabBtnProgress.classList.remove('active');
    }
  }

  bindEvents() {
    // タブ切り替え
    
    // モード切り替えモーダル
    this.modeModal = document.getElementById('mode-modal');
    this.modalCloseBtn = document.getElementById('modal-close-btn');

    if (this.modeBadge && this.modeModal) {
      this.modeBadge.addEventListener('click', () => {
        // 現在のモードにactiveクラスをつける
        document.querySelectorAll('.mode-option-item').forEach(item => {
          item.classList.toggle('active', item.dataset.mode === this.currentMode);
        });
        this.modeModal.classList.add('open');
      });

      this.modalCloseBtn.addEventListener('click', () => {
        this.modeModal.classList.remove('open');
      });

      this.modeModal.addEventListener('click', (e) => {
        if (e.target === this.modeModal) this.modeModal.classList.remove('open');
      });

      document.querySelectorAll('.mode-option-item').forEach(item => {
        item.addEventListener('click', async () => {
          this.currentMode = item.dataset.mode;
          this.modeModal.classList.remove('open');
          await this.setupDeck();
          this.switchView('study');
        });
      });
    }

    this.tabBtnStudy.addEventListener('click', () => this.switchView('study'));
    this.tabBtnProgress.addEventListener('click', () => this.switchView('progress'));

    // 確認テスト開始ボタン
    this.btnStartConfirmTest.addEventListener('click', () => this.startConfirmationTest());

    // カード操作
    this.btnFail.addEventListener('click', () => this.swipe.triggerSwipe('left'));
    this.btnPass.addEventListener('click', () => this.swipe.triggerSwipe('right'));
    this.btnFlip.addEventListener('click', () => this.toggleMeaning());

    this.btnAudio.addEventListener('click', (e) => {
      e.stopPropagation();
      const item = this.queue[this.currentIndex];
      if (item) speechService.speak(item.word);
    });

    window.addEventListener('keydown', (e) => {
      if (this.viewStudy.style.display === 'none') return;
      if (e.code === 'ArrowLeft') this.swipe.triggerSwipe('left');
      else if (e.code === 'ArrowRight') this.swipe.triggerSwipe('right');
      else if (e.code === 'Space' || e.code === 'Enter') this.toggleMeaning();
    });

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
        const cols = line.match(/(".*?"|[^",\s]+)(?=\s*,|\s*$)/g) || line.split(',');
        const clean = (s) => (s || '').replace(/^"|"$/g, '').trim();
        return {
          id: idx + 1,
          word: clean(cols[0]),
          meaning: clean(cols[1]),
          phonetic: clean(cols[2]),
          example: clean(cols[3]),
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
