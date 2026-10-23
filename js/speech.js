class SpeechService {
  constructor() {
    this.synth = window.speechSynthesis;
    this.voice = null;
    this.enVoice = null;
    this.jaVoice = null;
    this.rate = 0.9;
    this.jaRate = 1.0;

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

      // 英語音声
      this.enVoice = voices.find(v => (v.lang.startsWith('en-US') || v.lang.startsWith('en-GB')) && (v.name.includes('Natural') || v.name.includes('Google') || v.name.includes('Samantha') || v.name.includes('Siri')))
                  || voices.find(v => v.lang.startsWith('en'))
                  || null;

      // 日本語音声（一番最初の標準・通常の音声）
      this.jaVoice = voices.find(v => (v.lang.startsWith('ja') || v.lang === 'ja_JP') && (v.name.includes('Natural') || v.name.includes('Google') || v.name.includes('Kyoko') || v.name.includes('Otoya') || v.name.includes('Siri') || v.name.includes('Nanami') || v.name.includes('Haruka') || v.name.includes('Ayumi')))
                  || voices.find(v => v.lang.startsWith('ja') || v.lang === 'ja_JP')
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
      utter.rate = this.jaRate;
    } else {
      utter.lang = 'en-US';
      if (this.enVoice) utter.voice = this.enVoice;
      utter.rate = this.rate;
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
