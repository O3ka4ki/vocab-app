class SpeechService {
  constructor() {
    this.synth = window.speechSynthesis;
    this.voice = null;
    this.rate = 0.9;
    this.isMuted = localStorage.getItem('vocab_muted') === 'true';
    this.currentUtterance = null;
    this.isUnlocked = false;

    this.initVoices();
  }

  initVoices() {
    if (!this.synth) return;
    const loadVoices = () => {
      const voices = this.synth.getVoices();
      if (!voices || voices.length === 0) return;
      this.voice = voices.find(v => (v.lang.startsWith('en-US') || v.lang.startsWith('en-GB')) && (v.name.includes('Natural') || v.name.includes('Google') || v.name.includes('Samantha') || v.name.includes('Siri')))
                || voices.find(v => v.lang.startsWith('en'))
                || null;
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

  setMuted(muted) {
    this.isMuted = muted;
    localStorage.setItem('vocab_muted', String(muted));
    if (muted && this.synth) {
      try {
        this.synth.cancel();
      } catch (e) {}
    }
  }

  toggleMuted() {
    this.setMuted(!this.isMuted);
    return this.isMuted;
  }

  speak(text) {
    if (!this.synth || !text || this.isMuted) return;

    this.unlock();

    try {
      if (this.synth.paused) {
        this.synth.resume();
      }
    } catch (e) {}

    // 音声インスタンスを毎回新しく生成（使い回しによる無音バグを完全防止）
    const utter = new SpeechSynthesisUtterance(text);
    if (!this.voice) {
      this.initVoices();
    }
    if (this.voice) utter.voice = this.voice;
    utter.lang = 'en-US';
    utter.rate = this.rate;

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
        if (!this.isMuted) {
          try {
            this.synth.speak(utter);
          } catch (e) {}
        }
      }, 15);
    } else {
      try {
        this.synth.speak(utter);
      } catch (e) {}
    }
  }
}

export const speechService = new SpeechService();
