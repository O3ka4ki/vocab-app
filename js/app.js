import { db } from './db.js';
import { engine, AppMode } from './engine.js';
import { SwipeController } from './swipe.js';
import { speechService } from './speech.js';
import { parseCSV, cleanMeaningTag } from './importer.js';

const DATA_VERSION = 20;

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
    this.history = [];

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

    // Header Timer Badge & Individual Sound Toggles (EN / JA)
    this.btnSoundEn = document.getElementById('btn-sound-en');
    this.soundIconEn = document.getElementById('sound-icon-en');
    this.btnSoundJa = document.getElementById('btn-sound-ja');
    this.soundIconJa = document.getElementById('sound-icon-ja');
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

    this.btnUndo = document.getElementById('btn-undo');
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
    const soundEn = speechService.soundEn;
    const soundJa = speechService.soundJa;

    if (this.btnSoundEn) {
      this.btnSoundEn.classList.toggle('off', !soundEn);
      this.btnSoundEn.title = soundEn ? '英語自動音声: ON (タップでOFF)' : '英語自動音声: OFF (タップでON)';
    }
    if (this.soundIconEn) {
      this.soundIconEn.textContent = soundEn ? '🔊' : '🔇';
    }

    if (this.btnSoundJa) {
      this.btnSoundJa.classList.toggle('off', !soundJa);
      this.btnSoundJa.title = soundJa ? '日本語めくり音声: ON (タップでOFF)' : '日本語めくり音声: OFF (タップでON)';
    }
    if (this.soundIconJa) {
      this.soundIconJa.textContent = soundJa ? '🔊' : '🔇';
    }

    if (this.btnAudio) {
      this.btnAudio.classList.toggle('muted', !soundEn);
      this.btnAudio.textContent = soundEn ? '🔊' : '🔈';
      this.btnAudio.title = '英語の発音を聞く (タップで再生)';
    }
  }

  async start() {
    await db.init();
    
    const savedVer = await db.getState('data_version', 1);
    if (savedVer < DATA_VERSION) {
      await db.clearAllWords();
      const logicalDate = engine.getLogicalDate();
      await db.setState(`deck_${logicalDate}`, null);
      await db.setState('carryover_ids', []);
      await db.setState('day_study_started_at', null);
      await db.setState('day_study_round_failed_ids', null);
      await db.setState('day_study_current_index', 0);
      await db.setState('day_study_round_results', {});
      await this.loadInitialSampleWords(); // 新しい単語リストのみを登録
      await db.setState('data_version', DATA_VERSION);
    } else {
      this.allWords = await db.getAllWords();
      if (this.allWords.length === 0) {
        await this.loadInitialSampleWords();
        await db.setState('data_version', DATA_VERSION);
      }
    }

    // 初めに開く画面はどの時間帯でも常に「日中スキマ学習」
    this.currentMode = AppMode.DAY_STUDY;
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
    this.history = [];
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

      // 途中保存された間違えた単語リストがあれば優先して再開（合格済み単語は除外）
      const savedFailedIds = await db.getState('day_study_round_failed_ids', null);
      if (savedFailedIds && savedFailedIds.length > 0) {
        const validFailedIds = savedFailedIds.filter(id => {
          const w = wordMap.get(id);
          return w && w.status !== 'weekly_pending' && w.status !== 'mastered';
        });
        this.queue = validFailedIds.map(id => wordMap.get(id)).filter(Boolean);
      } else {
        this.queue = this.deck.wordIds.map(id => wordMap.get(id)).filter(Boolean);
      }

      // 途中の進行状況（インデックス＆解答）の復元
      this.currentIndex = await db.getState('day_study_current_index', 0);
      this.currentRoundResults = await db.getState('day_study_round_results', {});
      if (this.currentIndex >= this.queue.length) {
        this.currentIndex = 0;
      }
    } else if (this.currentMode === AppMode.MORNING_TEST) {
      // 🌅 翌朝の復習テスト: 昨日の単語をテスト対象とする（なければ当日のデッキ）
      const yesterdayDate = engine.getYesterdayLogicalDate();
      const yesterdayDeck = await db.getState(`deck_${yesterdayDate}`, null);

      let testWordIds = [];
      if (yesterdayDeck && yesterdayDeck.wordIds && yesterdayDeck.wordIds.length > 0) {
        testWordIds = yesterdayDeck.wordIds;
      } else {
        testWordIds = this.deck.wordIds;
      }

      this.queue = testWordIds.map(id => wordMap.get(id)).filter(Boolean);
      this.currentIndex = 0;
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
    this.history = [];

    const wordMap = new Map(this.allWords.map(w => [w.id, w]));
    this.queue = this.deck.wordIds.map(id => wordMap.get(id)).filter(Boolean);

    this.switchView('study');
    this.updateModeUI();
    this.currentIndex = 0;
    this.showCurrentWord();
  }

  updateUndoButtonState() {
    if (this.btnUndo) {
      this.btnUndo.disabled = this.currentIndex <= 0;
    }
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
    this.updateUndoButtonState();
    if (this.queue.length === 0) {
      this.cardNum.textContent = '0 / 0';
      this.wordText.textContent = '単語が登録されていません';
      this.phoneticText.textContent = '';
      this.meaningText.textContent = '参考書のスクショから単語を追加してください';
      this.meaningContainer.classList.add('visible');
      this.progressBar.style.width = '0%';
      return;
    }
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
    this.meaningText.textContent = cleanMeaningTag(item.meaning);
    if (item.example) {
      this.exampleBox.style.display = 'block';
      this.exampleBox.textContent = `Ex: ${item.example}`;
    } else {
      this.exampleBox.style.display = 'none';
    }

    this.completeOverlay.style.display = 'none';

    if (autoSpeak && item && item.word) {
      speechService.speakEnglish(item.word);
    }
  }

  toggleMeaning() {
    this.isRevealed = !this.isRevealed;

    // めくった瞬間に日本語の意味を発話
    if (this.isRevealed) {
      const item = this.queue[this.currentIndex];
      if (item && item.meaning) {
        speechService.speakJapanese(item.meaning);
      }
    }

    this.meaningContainer.style.display = this.isRevealed ? 'flex' : 'none';
  }

  handleAnswer(isPass) {
    if (this.currentIndex >= this.queue.length) return;
    const currentItem = this.queue[this.currentIndex];

    // 全てのモード共通: 1つ前のカードに戻れるよう履歴に退避
    this.history.push({
      index: this.currentIndex,
      item: currentItem,
      prevStatus: currentItem.status,
      prevCurrentRoundResult: this.currentRoundResults[currentItem.id],
      prevDeckResult: this.deck.results ? this.deck.results[currentItem.id] : undefined,
      prevNightResult: this.deck.nightResults ? this.deck.nightResults[currentItem.id] : undefined,
      prevMorningResult: this.deck.morningResults ? this.deck.morningResults[currentItem.id] : undefined,
      isPass: isPass
    });

    // 結果の記録
    if (!this.deck.results) this.deck.results = {};
    this.deck.results[currentItem.id] = isPass;
    this.currentRoundResults[currentItem.id] = isPass;

    // 1. 【最優先・ゼロ遅延】即座に次のカードへ進めて表示＆音声を流す
    this.currentIndex++;
    this.showCurrentWord(true);

    // 2. DBへの書き込み処理は裏側で非同期に実行（UIや音声を一切待たせない）
    this.persistAnswerProgress(currentItem, isPass);
  }

  async handleUndo() {
    if (this.currentIndex <= 0) return;

    // 完了オーバーレイが表示されていれば閉じる
    if (this.completeOverlay.style.display !== 'none') {
      this.completeOverlay.style.display = 'none';
    }

    const lastAction = this.history.pop();
    this.currentIndex--;
    const item = this.queue[this.currentIndex];

    if (lastAction) {
      // 1. ラウンド結果の巻き戻し
      if (lastAction.prevCurrentRoundResult !== undefined) {
        this.currentRoundResults[item.id] = lastAction.prevCurrentRoundResult;
      } else {
        delete this.currentRoundResults[item.id];
      }

      // 2. deck.results の巻き戻し
      if (this.deck.results) {
        if (lastAction.prevDeckResult !== undefined) {
          this.deck.results[item.id] = lastAction.prevDeckResult;
        } else {
          delete this.deck.results[item.id];
        }
      }

      // 3. nightResults の巻き戻し
      if (this.deck.nightResults) {
        if (lastAction.prevNightResult !== undefined) {
          this.deck.nightResults[item.id] = lastAction.prevNightResult;
        } else {
          delete this.deck.nightResults[item.id];
        }
      }

      // 4. morningResults の巻き戻し
      if (this.deck.morningResults) {
        if (lastAction.prevMorningResult !== undefined) {
          this.deck.morningResults[item.id] = lastAction.prevMorningResult;
        } else {
          delete this.deck.morningResults[item.id];
        }
      }

      // 5. 確認テストで間違えた場合の持ち越し・ステータス復元
      if (this.currentMode === AppMode.CONFIRMATION_TEST && !lastAction.isPass) {
        const carryovers = await db.getState('carryover_ids', []);
        const filtered = carryovers.filter(id => id !== item.id);
        await db.setState('carryover_ids', filtered);
        item.status = lastAction.prevStatus || 'mastered';
        await db.saveWord(item);
      }
    }

    // 6. DB進行状況の巻き戻し
    if (this.currentMode === AppMode.DAY_STUDY) {
      await db.setState('day_study_current_index', this.currentIndex);
      await db.setState('day_study_round_results', this.currentRoundResults);
    }
    const logicalDate = engine.getLogicalDate();
    if (this.currentMode !== AppMode.CONFIRMATION_TEST) {
      await db.setState(`deck_${logicalDate}`, this.deck);
    }

    // 7. 直前の単語を表示（音声も再生）
    this.showCurrentWord(true);
  }

  async persistAnswerProgress(currentItem, isPass) {
    // 日中スキマ学習: 最初の1問回答時に開始時刻をセット（30分タイマースタート）
    if (this.currentMode === AppMode.DAY_STUDY) {
      const startedAt = await db.getState('day_study_started_at', null);
      if (!startedAt) {
        await db.setState('day_study_started_at', Date.now());
        this.updateTimerDisplay();
      }
      await db.setState('day_study_current_index', this.currentIndex);
      await db.setState('day_study_round_results', this.currentRoundResults);
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
  }

  async handleSessionComplete() {
    this.updateUndoButtonState();
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

      // 1. 持ち越し（✕だった単語）を保存
      await db.setState('carryover_ids', failedIds);

      // 2. 合格した単語（◯）を weekly_pending（習得済み）に更新してDB保存
      for (const pid of passedIds) {
        const w = this.allWords.find(x => x.id === pid);
        if (w) {
          w.status = 'weekly_pending';
          await db.saveWord(w);
        }
      }

      // 3. 【最重要】本日の日中スキマ学習デッキを完全再生成！
      // 朝テストで合格した単語は除外され、✕だった持ち越し単語 ＋ 新規単語で本日の100問を構築
      const logicalDate = engine.getLogicalDate();
      this.deck = engine.generateDailyDeck(this.allWords, failedIds, null);
      await db.setState(`deck_${logicalDate}`, this.deck);

      // 日中スキマ学習の進捗状態を初期化（今日の新しい100問からスタートできる）
      await db.setState('day_study_started_at', null);
      await db.setState('day_study_round_failed_ids', null);
      await db.setState('day_study_current_index', 0);
      await db.setState('day_study_round_results', {});

      this.completeIcon.textContent = '🌅';
      this.completeTitle.textContent = '朝のテスト完了！';
      this.completeDesc.innerHTML = `合格: <strong>${passedIds.length}</strong> 単語（マスター済へ移動）<br>未記憶: <strong>${failedIds.length}</strong> 単語（本日の100問へスライド持ち越し）<br><br>※本日の昼の100単語デッキが更新されました！`;
      this.btnNextSession.textContent = '☀️ 本日の日中スキマ学習を始める';
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
          <span class="wrong-word-meaning">${cleanMeaningTag(w.meaning)}</span>
        </div>
        <button class="btn-mini-audio" title="発音を聞く">🔊</button>
      `;
      const audioBtn = item.querySelector('.btn-mini-audio');
      audioBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        speechService.speakEnglish(w.word, true);
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
    this.history = [];
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
    if (this.btnUndo) this.btnUndo.addEventListener('click', () => this.handleUndo());
    this.btnFail.addEventListener('click', () => this.swipe.triggerSwipe('left'));
    this.btnPass.addEventListener('click', () => this.swipe.triggerSwipe('right'));
    this.btnFlip.addEventListener('click', () => this.toggleMeaning());

    if (this.btnSoundEn) {
      this.btnSoundEn.addEventListener('click', () => {
        speechService.toggleSoundEn();
        this.updateSoundUI();
      });
    }

    if (this.btnSoundJa) {
      this.btnSoundJa.addEventListener('click', () => {
        speechService.toggleSoundJa();
        this.updateSoundUI();
      });
    }

    this.btnAudio.addEventListener('click', (e) => {
      e.stopPropagation();
      const item = this.queue[this.currentIndex];
      if (!item) return;

      // 手動でタップした場合は設定に関わらず英語音声を強制再生
      speechService.speakEnglish(item.word, true);
    });

    window.addEventListener('keydown', (e) => {
      if (this.viewStudy.style.display === 'none') return;
      if (e.code === 'ArrowLeft') this.swipe.triggerSwipe('left');
      else if (e.code === 'ArrowRight') this.swipe.triggerSwipe('right');
      else if (e.code === 'Space' || e.code === 'Enter') this.toggleMeaning();
      else if (e.code === 'Backspace' || e.code === 'KeyZ' || e.code === 'ArrowDown') this.handleUndo();
    });

    this.btnNextSession.addEventListener('click', async () => {
      if (this.currentMode === AppMode.MORNING_TEST) {
        // 朝テスト完了時: 自動的に本日の日中スキマ学習へ移行
        this.currentMode = AppMode.DAY_STUDY;
        this.completeOverlay.style.display = 'none';
        await this.setupDeck();
        return;
      }

      if (this.currentMode === AppMode.DAY_STUDY) {
        if (this.dayStudyRoundFailed && this.dayStudyRoundFailed.length > 0) {
          // 間違えた単語のみで次の一周を開始
          this.queue = [...this.dayStudyRoundFailed];
          this.dayStudyRoundFailed = [];
          this.currentRoundResults = {};
          this.history = [];
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
      this.history = [];
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

  async loadInitialSampleWords(statusMap = null) {
    try {
      const resp = await fetch('samples/sample_words.csv');
      const text = await resp.text();
      const parsedWords = parseCSV(text);
      
      const wordsWithStatus = parsedWords.map((w, idx) => ({
        id: idx + 1,
        word: w.word,
        meaning: cleanMeaningTag(w.meaning),
        phonetic: (w.phonetic && !w.phonetic.includes('TOEIC') && !w.phonetic.includes('単語') && !w.phonetic.includes('熟語')) ? w.phonetic : '',
        example: w.example || '',
        category: w.category || 'General',
        status: (statusMap && statusMap.has(w.word)) ? statusMap.get(w.word) : 'unseen'
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
