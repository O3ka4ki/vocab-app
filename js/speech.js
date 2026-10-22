class SpeechService {
  constructor() {
    this.synth = window.speechSynthesis;
    this.voice = null;
    this.rate = 0.9;
    this.isMuted = localStorage.getItem('vocab_muted') === 'true';
    this.currentUtterance = null;
    this.preloadedUtterance = null;
    this.preloadedWord = '';

    this.initVoices();
  }

  initVoices() {
    if (!this.synth) return;
    const loadVoices = () => {
      const voices = this.synth.getVoices();
      this.voice = voices.find(v => (v.lang.startsWith('en-US') || v.lang.startsWith('en-GB')) && (v.name.includes('Natural') || v.name.includes('Google') || v.name.includes('Samantha')))
                || voices.find(v => v.lang.startsWith('en'))
                || null;
    };

    loadVoices();
    if (this.synth.onvoiceschanged !== undefined) {
      this.synth.onvoiceschanged = loadVoices;
    }
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

  preload(text) {
    if (!this.synth || !text) return;
    if (this.preloadedWord === text && this.preloadedUtterance) return;

    this.preloadedWord = text;
    const utter = new SpeechSynthesisUtterance(text);
    if (this.voice) utter.voice = this.voice;
    utter.lang = 'en-US';
    utter.rate = this.rate;
    this.preloadedUtterance = utter;
  }

  speak(text) {
    if (!this.synth || !text || this.isMuted) return;

    // Chromiumのバックグラウンド停止・一時停止対策
    if (this.synth.paused) {
      try {
        this.synth.resume();
      } catch (e) {}
    }

    // 再生中の場合のみキャンセル
    if (this.synth.speaking) {
      try {
        this.synth.cancel();
      } catch (e) {}
    }

    let utter;
    if (this.preloadedWord === text && this.preloadedUtterance) {
      utter = this.preloadedUtterance;
    } else {
      utter = new SpeechSynthesisUtterance(text);
      if (this.voice) utter.voice = this.voice;
      utter.lang = 'en-US';
      utter.rate = this.rate;
    }

    // GCによる中断を防ぐために参照を保持
    this.currentUtterance = utter;

    utter.onend = () => {
      if (this.currentUtterance === utter) {
        this.currentUtterance = null;
      }
    };
    utter.onerror = () => {
      if (this.currentUtterance === utter) {
        this.currentUtterance = null;
      }
    };

    // 音声を即時発火
    this.synth.speak(utter);
  }
}

export const speechService = new SpeechService();
