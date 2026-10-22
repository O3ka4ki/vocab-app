import { db } from './db.js';
import { engine, AppMode } from './engine.js';
import { SwipeController } from './swipe.js';
import { speechService } from './speech.js';
import { parseCSV } from './importer.js';

const DATA_VERSION = 16;

class VocabSwipeApp {
  constructor() {
    this.allWords = [];
    this.deck = null;
    this.queue = [];
    this.currentIndex = 0;
    this.isRevealed = false;
    this.currentMode = null;
    this.currentRoundResults = {};
    this.dayStudyRoundFailed = [];
    this.timerInterval = null;

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

    // Header Timer Badge & Sound Toggle
    this.btnSoundToggle = document.getElementById('btn-sound-toggle');
    this.soundToggleIcon = document.getElementById('sound-toggle-icon');
    this.soundToggleText = document.getElementById('sound-toggle-text');
    this.headerTimerBadge = document.getElementById('header-timer-badge');
    this.headerTimerText = document.getElementById('header-timer-text');

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

    // Complete Overlay Elements
    this.completeOverlay = document.getElementById('complete-overlay');
    this.completeIcon = document.getElementById('complete-icon');
    this.completeTitle = document.getElementById('complete-title');
    this.completeDesc = document.getElementById('complete-desc');
    this.wrongWordsSection = document.getElementById('wrong-words-section');
    this.wrongWordsCount = document.getElementById('wrong-words-count');
    this.wrongWordsList = document.getElementById('wrong-words-list');
    this.timerIndicator = document.getElementById('timer-indicator');
    this.timerCountdown = document.getElementById('timer-countdown');
    this.btnNextSession = document.getElementById('btn-next-session');
    this.btnResetFull = document.getElementById('btn-reset-full');

    // Swipe Controller
    this.swipe = new SwipeController(
      this.card,
      () => this.handleAnswer(false),
      () => this.handleAnswer(true),
      () => this.toggleMeaning()
    );
  }

  updateSoundUI() {
    const isMuted = speechService.isMuted;
    if (this.btnSoundToggle) {
      this.btnSoundToggle.classList.toggle('muted', isMuted);
      this.btnSoundToggle.title = isMuted ? '音無しモード中 (タップで音ありへ)' : '音ありモード中 (タップで音無しへ)';
    }
    if (this.soundToggleIcon) {
      this.soundToggleIcon.textContent = isMuted ? '🔇' : '🔊';
    }
    if (this.soundToggleText) {
      this.soundToggleText.textContent = isMuted ? '音なし' : '音あり';
    }
    if (this.btnAudio) {
      this.btnAudio.classList.toggle('muted', isMuted);
      this.btnAudio.textContent = isMuted ? '🔇' : '🔊';
      this.btnAudio.title = isMuted ? '音無しモード中 (タップで解除)' : '発音を聞く';
    }
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
    this.updateSoundUI();
    this.startTimerLoop();
  }

  async setupDeck() {
    const logicalDate = engine.getLogicalDate();
    const existingDeck = await db.getState(`deck_${logicalDate}`, null);
    const carryovers = await db.getState('carryover_ids', []);

    this.currentRoundResults = {};
    this.deck = engine.generateDailyDeck(this.allWords, carryovers, existingDeck);
    await db.setState(`deck_${logicalDate}`, this.deck);

    const wordMap = new Map(this.allWords.map(w => [w.id, w]));

    if (this.currentMode === AppMode.DAY_STUDY) {
      // 30分経過チェック
      const startedAt = await db.getState('day_study_started_at', null);
      if (startedAt && (Date.now() - startedAt >= 30 * 60 * 1000)) {
        await db.setState('day_study_started_at', null);
        await db.setState('day_study_round_failed_ids', null);
        await db.setState('day_study_current_index', 0);
        await db.setState('day_study_round_results', {});
      }

      // 途中保存された間違えた単語リストがあれば優先して再開
      const savedFailedIds = await db.getState('day_study_round_failed_ids', null);
      if (savedFailedIds && savedFailedIds.length > 0) {
        this.queue = savedFailedIds.map(id => wordMap.get(id)).filter(Boolean);
      } else {
        this.queue = this.deck.wordIds.map(id => wordMap.get(id)).filter(Boolean);
      }

      // 途中の進行状況（インデックス＆解答）の復元
      this.currentIndex = await db.getState('day_study_current_index', 0);
      this.currentRoundResults = await db.getState('day_study_round_results', {});
      if (this.currentIndex >= this.queue.length) {
        this.currentIndex = 0;
      }
    } else {
      this.queue = this.deck.wordIds.map(id => wordMap.get(id)).filter(Boolean);
      this.currentIndex = 0;
    }

    this.updateModeUI();
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
    this.updateTimerDisplay();
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

  showCurrentWord(autoSpeak = false) {
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
    const phoneticVal = (item.phonetic && !item.phonetic.includes('TOEIC') && !item.phonetic.includes('単語') && !item.phonetic.includes('熟語'))
      ? item.phonetic
      : '';
    this.phoneticText.textContent = phoneticVal;
    this.phoneticText.style.display = phoneticVal ? 'block' : 'none';

    this.meaningContainer.style.display = 'none';
    this.meaningText.textContent = item.meaning;
    if (item.example) {
      this.exampleBox.style.display = 'block';
      this.exampleBox.textContent = `Ex: ${item.example}`;
    } else {
      this.exampleBox.style.display = 'none';
    }

    this.completeOverlay.style.display = 'none';

    // 次のタップに備えて発音オブジェクトを即座に事前準備（レイテンシゼロ化）
    if (item && item.word) {
      speechService.preload(item.word);
    }

    if (autoSpeak && item && item.word) {
      speechService.speak(item.word);
    }
  }

  toggleMeaning() {
    this.isRevealed = !this.isRevealed;

    // めくった瞬間にレイテンシなく最速で発話
    if (this.isRevealed) {
      const item = this.queue[this.currentIndex];
      if (item && item.word) {
        speechService.speak(item.word);
      }
    }

    this.meaningContainer.style.display = this.isRevealed ? 'flex' : 'none';
  }

  async handleAnswer(isPass) {
    if (this.currentIndex >= this.queue.length) return;
    const currentItem = this.queue[this.currentIndex];

    // 結果の記録
    if (!this.deck.results) this.deck.results = {};
    this.deck.results[currentItem.id] = isPass;
    this.currentRoundResults[currentItem.id] = isPass;

    // 日中スキマ学習: 最初の1問回答時に開始時刻をセット（30分タイマースタート）
    if (this.currentMode === AppMode.DAY_STUDY) {
      const startedAt = await db.getState('day_study_started_at', null);
      if (!startedAt) {
        await db.setState('day_study_started_at', Date.now());
        this.updateTimerDisplay();
      }
    }

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
    if (this.currentMode === AppMode.DAY_STUDY) {
      await db.setState('day_study_current_index', this.currentIndex);
      await db.setState('day_study_round_results', this.currentRoundResults);
    }
    this.showCurrentWord(true);
  }

  async handleSessionComplete() {
    this.progressBar.style.width = '100%';
    this.completeOverlay.style.display = 'flex';

    if (this.currentMode === AppMode.DAY_STUDY) {
      // 日中スキマ学習: 間違えた単語を抽出
      const failedWords = this.queue.filter(w => this.currentRoundResults[w.id] === false);
      this.dayStudyRoundFailed = failedWords;

      if (failedWords.length > 0) {
        // まだ間違えた単語がある場合
        this.completeIcon.textContent = '📝';
        this.completeTitle.textContent = '1周のチェック完了！';
        const correctCount = this.queue.length - failedWords.length;
        this.completeDesc.innerHTML = `正解: <strong>${correctCount}</strong> / <strong>${this.queue.length}</strong> 単語<br>間違えた単語を確認して、次の一周へ進みましょう。`;

        this.wrongWordsSection.style.display = 'flex';
        this.wrongWordsCount.textContent = `${failedWords.length} 語`;
        this.renderWrongWordsList(failedWords);

        this.timerIndicator.style.display = 'inline-flex';
        this.btnNextSession.textContent = `間違えた ${failedWords.length} 語のみをやる`;
        this.btnResetFull.style.display = 'block';
        this.btnResetFull.textContent = '100問を最初からやり直す';

        await db.setState('day_study_round_failed_ids', failedWords.map(w => w.id));
      } else {
        // 全問正解（クリア！）
        this.completeIcon.textContent = '🎉';
        this.completeTitle.textContent = '全問クリア！完全制覇！';
        this.completeDesc.innerHTML = `本日の単語をすべて覚えました！素晴らしい集中力です。<br>最初のスタートから30分後に自動リセットされます。`;

        this.wrongWordsSection.style.display = 'none';
        this.timerIndicator.style.display = 'inline-flex';
        this.btnNextSession.textContent = '今すぐリセットして最初から挑戦';
        this.btnResetFull.style.display = 'none';

        await db.setState('day_study_round_failed_ids', null);
      }
      this.updateTimerDisplay();
      return;
    }

    // 他のモードの完了表示
    this.wrongWordsSection.style.display = 'none';
    this.timerIndicator.style.display = 'none';
    this.btnResetFull.style.display = 'none';
    this.btnNextSession.textContent = 'もう一度回す';

    if (this.currentMode === AppMode.CONFIRMATION_TEST) {
      const failed = [];
      const passed = [];
      for (const [widStr, ok] of Object.entries(this.deck.results || {})) {
        if (!ok) failed.push(parseInt(widStr, 10));
        else passed.push(parseInt(widStr, 10));
      }

      this.completeIcon.textContent = '🎯';
      this.completeTitle.textContent = '実力テスト完了！';
      this.completeDesc.innerHTML = `正解: <strong>${passed.length}</strong> 問<br>間違えた <strong>${failed.length}</strong> 語は明日の100単語デッキに組み込みました！`;
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

      this.completeIcon.textContent = '🌅';
      this.completeTitle.textContent = '朝のテスト完了！';
      this.completeDesc.innerHTML = `合格: <strong>${passedIds.length}</strong> 単語<br>未記憶(翌日へスライド): <strong>${failedIds.length}</strong> 単語`;
      await this.updateDashboardStats();
    } else {
      this.completeIcon.textContent = '🎉';
      this.completeTitle.textContent = 'セッション完了！';
      this.completeDesc.innerHTML = `全単語のチェックが完了しました！<br>テンポよく反復して脳に定着させましょう。`;
    }
  }

  renderWrongWordsList(words) {
    this.wrongWordsList.innerHTML = '';
    words.forEach(w => {
      const item = document.createElement('div');
      item.className = 'wrong-word-item';
      item.innerHTML = `
        <div class="wrong-word-info">
          <span class="wrong-word-text">${w.word}</span>
          <span class="wrong-word-meaning">${w.meaning}</span>
        </div>
        <button class="btn-mini-audio" title="発音を聞く">🔊</button>
      `;
      const audioBtn = item.querySelector('.btn-mini-audio');
      audioBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        speechService.speak(w.word);
      });
      this.wrongWordsList.appendChild(item);
    });
  }

  async resetDayStudySession(isAuto = false) {
    await db.setState('day_study_started_at', null);
    await db.setState('day_study_round_failed_ids', null);
    await db.setState('day_study_current_index', 0);
    await db.setState('day_study_round_results', {});
    this.dayStudyRoundFailed = [];
    this.currentRoundResults = {};
    this.currentIndex = 0;

    const logicalDate = engine.getLogicalDate();
    const carryovers = await db.getState('carryover_ids', []);
    this.deck = engine.generateDailyDeck(this.allWords, carryovers, null);
    await db.setState(`deck_${logicalDate}`, this.deck);

    const wordMap = new Map(this.allWords.map(w => [w.id, w]));
    this.queue = this.deck.wordIds.map(id => wordMap.get(id)).filter(Boolean);

    this.completeOverlay.style.display = 'none';
    this.showCurrentWord(!isAuto);
    this.updateTimerDisplay();

    if (isAuto) {
      alert('⏰ 最初のスタートから30分が経過したため、本日の100問をリセットしました！');
    }
  }

  startTimerLoop() {
    if (this.timerInterval) clearInterval(this.timerInterval);
    this.timerInterval = setInterval(() => this.updateTimerDisplay(), 1000);
    this.updateTimerDisplay();
  }

  async updateTimerDisplay() {
    if (this.currentMode !== AppMode.DAY_STUDY) {
      if (this.headerTimerBadge) this.headerTimerBadge.style.display = 'none';
      if (this.timerIndicator) this.timerIndicator.style.display = 'none';
      return;
    }

    const startedAt = await db.getState('day_study_started_at', null);
    if (!startedAt) {
      if (this.headerTimerBadge) this.headerTimerBadge.style.display = 'none';
      if (this.timerCountdown) this.timerCountdown.textContent = '30:00';
      return;
    }

    const elapsed = Date.now() - startedAt;
    const remaining = 30 * 60 * 1000 - elapsed;

    if (remaining <= 0) {
      // 30分満了
      if (this.headerTimerBadge) this.headerTimerBadge.style.display = 'none';
      await this.resetDayStudySession(true);
      return;
    }

    const totalSec = Math.floor(remaining / 1000);
    const min = String(Math.floor(totalSec / 60)).padStart(2, '0');
    const sec = String(totalSec % 60).padStart(2, '0');
    const timeStr = `${min}:${sec}`;

    if (this.headerTimerBadge) {
      this.headerTimerBadge.style.display = 'inline-flex';
      this.headerTimerText.textContent = timeStr;
    }
    if (this.timerCountdown) {
      this.timerCountdown.textContent = timeStr;
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

    if (this.btnSoundToggle) {
      this.btnSoundToggle.addEventListener('click', () => {
        speechService.toggleMuted();
        this.updateSoundUI();
      });
    }

    this.btnAudio.addEventListener('click', (e) => {
      e.stopPropagation();
      const item = this.queue[this.currentIndex];
      if (!item) return;

      if (speechService.isMuted) {
        speechService.setMuted(false);
        this.updateSoundUI();
      }
      speechService.speak(item.word);
    });

    window.addEventListener('keydown', (e) => {
      if (this.viewStudy.style.display === 'none') return;
      if (e.code === 'ArrowLeft') this.swipe.triggerSwipe('left');
      else if (e.code === 'ArrowRight') this.swipe.triggerSwipe('right');
      else if (e.code === 'Space' || e.code === 'Enter') this.toggleMeaning();
    });

    this.btnNextSession.addEventListener('click', async () => {
      if (this.currentMode === AppMode.DAY_STUDY) {
        if (this.dayStudyRoundFailed && this.dayStudyRoundFailed.length > 0) {
          // 間違えた単語のみで次の一周を開始
          this.queue = [...this.dayStudyRoundFailed];
          this.dayStudyRoundFailed = [];
          this.currentRoundResults = {};
          this.currentIndex = 0;
          await db.setState('day_study_current_index', 0);
          await db.setState('day_study_round_results', {});
          this.completeOverlay.style.display = 'none';
          this.showCurrentWord(true);
          return;
        } else {
          // 全問クリア後の「今すぐリセットして最初から挑戦」
          await this.resetDayStudySession(false);
          return;
        }
      }
      this.currentIndex = 0;
      this.completeOverlay.style.display = 'none';
      this.showCurrentWord(true);
    });

    if (this.btnResetFull) {
      this.btnResetFull.addEventListener('click', async () => {
        if (confirm('本日の100問を最初からやり直しますか？')) {
          await this.resetDayStudySession(false);
        }
      });
    }

    if (this.headerTimerBadge) {
      this.headerTimerBadge.addEventListener('click', async () => {
        if (confirm('30分タイマーと本日の100問をリセットして最初から学習しますか？')) {
          await this.resetDayStudySession(false);
        }
      });
    }
  }

  async loadInitialSampleWords() {
    try {
      const resp = await fetch('samples/sample_words.csv');
      const text = await resp.text();
      const parsedWords = parseCSV(text);
      
      const wordsWithStatus = parsedWords.map((w, idx) => ({
        id: idx + 1,
        word: w.word,
        meaning: w.meaning,
        phonetic: (w.phonetic && !w.phonetic.includes('TOEIC') && !w.phonetic.includes('単語') && !w.phonetic.includes('熟語')) ? w.phonetic : '',
        example: w.example || '',
        category: w.category || 'General',
        status: 'unseen'
      })).filter(w => w.word && w.meaning);

      await db.saveWordsBulk(wordsWithStatus);
      this.allWords = wordsWithStatus;
    } catch (e) {
      console.log('Sample load skipped:', e);
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const app = new VocabSwipeApp();
  app.start();
});
