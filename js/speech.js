class SpeechService {
  constructor() {
    this.synth = window.speechSynthesis;
    this.voice = null;
    this.enVoice = null;
    this.jaVoice = null;
    this.rate = 0.9;
    this.jaRate = 0.95; // 落ち着いて聞き取りやすい自然なスピード

    // 英語・日本語の個別設定（初期値はON）
    const legacyMuted = localStorage.getItem('vocab_muted');
    if (legacyMuted !== null) {
      const wasMuted = legacyMuted === 'true';
      this.soundEn = !wasMuted;
      this.soundJa = !wasMuted;
      localStorage.removeItem('vocab_muted');
      localStorage.setItem('vocab_sound_en', String(this.soundEn));
      localStorage.setItem('vocab_sound_ja', String(this.soundJa));
    } else {
      this.soundEn = localStorage.getItem('vocab_sound_en') !== 'false';
      this.soundJa = localStorage.getItem('vocab_sound_ja') !== 'false';
    }

    this.currentUtterance = null;
    this.isUnlocked = false;

    this.initVoices();
  }

  get isMuted() {
    return !this.soundEn && !this.soundJa;
  }

  initVoices() {
    if (!this.synth) return;
    const loadVoices = () => {
      const voices = this.synth.getVoices();
      if (!voices || voices.length === 0) return;

      // 英語: 自然でクリアなボイスを優先
      const enVoices = voices.filter(v => v.lang.startsWith('en-US') || v.lang.startsWith('en-GB') || v.lang.startsWith('en'));
      this.enVoice = enVoices.find(v => v.name.includes('Natural') || v.name.includes('Google') || v.name.includes('Samantha') || v.name.includes('Siri'))
                  || enVoices[0]
                  || null;

      // 日本語: 最も自然で落ち着いて聞き取りやすいボイスを優先（甲高い音は除外）
      const jaVoices = voices.filter(v => v.lang.startsWith('ja') || v.lang === 'ja_JP');
      this.jaVoice = jaVoices.find(v => v.name.includes('Natural') || v.name.includes('Nanami'))
                  || jaVoices.find(v => v.name.includes('Google'))
                  || jaVoices.find(v => v.name.includes('Kyoko') || v.name.includes('Otoya'))
                  || jaVoices.find(v => v.name.includes('Haruka'))
                  || jaVoices.find(v => v.name.includes('Siri'))
                  || jaVoices[0]
                  || null;

      this.voice = this.enVoice;
    };

    loadVoices();
    if (this.synth.onvoiceschanged !== undefined) {
      this.synth.onvoiceschanged = loadVoices;
    }
  }

  unlock() {
    if (this.isUnlocked || !this.synth) return;
    this.isUnlocked = true;
    try {
      if (this.synth.paused) this.synth.resume();
      const silentUtter = new SpeechSynthesisUtterance('');
      silentUtter.volume = 0;
      this.synth.speak(silentUtter);
    } catch (e) {}
  }

  setSoundEn(enabled) {
    this.soundEn = enabled;
    localStorage.setItem('vocab_sound_en', String(enabled));
    if (!enabled && this.synth && this.currentUtterance && this.currentUtterance.lang.startsWith('en')) {
      try { this.synth.cancel(); } catch (e) {}
    }
  }

  setSoundJa(enabled) {
    this.soundJa = enabled;
    localStorage.setItem('vocab_sound_ja', String(enabled));
    if (!enabled && this.synth && this.currentUtterance && this.currentUtterance.lang.startsWith('ja')) {
      try { this.synth.cancel(); } catch (e) {}
    }
  }

  toggleSoundEn() {
    this.setSoundEn(!this.soundEn);
    return this.soundEn;
  }

  toggleSoundJa() {
    this.setSoundJa(!this.soundJa);
    return this.soundJa;
  }

  speakEnglish(text, force = false) {
    if (!force && !this.soundEn) return;
    this.speak(text, 'en-US');
  }

  speakJapanese(text, force = false) {
    if (!force && !this.soundJa) return;
    let cleanText = text || '';
    // 品詞タグ（[名]、[動]等）を確実に除去
    cleanText = cleanText.replace(/[\[［【\(（](?:名|動|形|副|前|接|他|自|間|代|他動詞|自動詞|名詞|動詞|形容詞|副詞|前置詞|接続詞)[\]］】\)）]\s*/g, '');
    cleanText = cleanText.replace(/[／/]/g, '、').replace(/[;；]/g, '、');
    this.speak(cleanText, 'ja-JP');
  }

  speak(text, lang = 'en-US') {
    if (!this.synth || !text) return;

    this.unlock();

    try {
      if (this.synth.paused) {
        this.synth.resume();
      }
    } catch (e) {}

    // 音声インスタンスを毎回新しく生成（使い回しによる無音バグを完全防止）
    const utter = new SpeechSynthesisUtterance(text);
    if (!this.enVoice && !this.jaVoice) {
      this.initVoices();
    }

    if (lang.startsWith('ja')) {
      utter.lang = 'ja-JP';
      if (this.jaVoice) utter.voice = this.jaVoice;
      utter.rate = this.jaRate; // 0.95（落ち着いた自然な速度）
      utter.volume = 1.0;       // 日本語は最大音量
      utter.pitch = 1.0;        // ピッチを標準(1.0)にして高音の尖り・金属的な響きを完全に解消
    } else {
      utter.lang = 'en-US';
      if (this.enVoice) utter.voice = this.enVoice;
      utter.rate = this.rate;   // 0.9
      utter.volume = 0.85;      // 英語の音量
      utter.pitch = 1.0;
    }

    this.currentUtterance = utter;
    utter.onend = () => {
      if (this.currentUtterance === utter) this.currentUtterance = null;
    };
    utter.onerror = () => {
      if (this.currentUtterance === utter) this.currentUtterance = null;
    };

    // 再生中の場合は安全にキャンセルして即時再生
    if (this.synth.speaking) {
      try {
        this.synth.cancel();
      } catch (e) {}
      setTimeout(() => {
        try {
          this.synth.speak(utter);
        } catch (e) {}
      }, 15);
    } else {
      try {
        this.synth.speak(utter);
      } catch (e) {}
    }
  }
}

export const speechService = new SpeechService();
