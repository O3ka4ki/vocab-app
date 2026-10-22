/**
 * swipe.js - スマホ向け左右スワイプジェスチャー
 * 右スワイプ: ◯ 分かる (PASS)
 * 左スワイプ: ✕ 分からない (FAIL)
 */

export class SwipeController {
  constructor(cardElement, onSwipeLeft, onSwipeRight, onClickCard) {
    this.card = cardElement;
    this.onSwipeLeft = onSwipeLeft;   // 不正解
    this.onSwipeRight = onSwipeRight; // 正解
    this.onClickCard = onClickCard;   // タップで裏返し

    this.startX = 0;
    this.startY = 0;
    this.currentX = 0;
    this.currentY = 0;
    this.isDragging = false;
    this.hasMoved = false;

    this.bindEvents();
  }

  bindEvents() {
    // Touch Events
    this.card.addEventListener('touchstart', (e) => this.onStart(e.touches[0].clientX, e.touches[0].clientY), { passive: true });
    window.addEventListener('touchmove', (e) => this.onMove(e.touches[0].clientX, e.touches[0].clientY), { passive: false });
    window.addEventListener('touchend', () => this.onEnd());

    // Mouse / Pointer Events (PC動作確認用)
    this.card.addEventListener('mousedown', (e) => {
      if (e.target.closest('.btn-audio')) return;
      this.onStart(e.clientX, e.clientY);
    });
    window.addEventListener('mousemove', (e) => this.onMove(e.clientX, e.clientY));
    window.addEventListener('mouseup', () => this.onEnd());
  }

  onStart(x, y) {
    this.startX = x;
    this.startY = y;
    this.currentX = x;
    this.currentY = y;
    this.isDragging = true;
    this.hasMoved = false;
    this.card.style.transition = 'none';
  }

  onMove(x, y) {
    if (!this.isDragging) return;
    const deltaX = x - this.startX;
    const deltaY = y - this.startY;

    if (Math.abs(deltaX) > 8 || Math.abs(deltaY) > 8) {
      this.hasMoved = true;
    }

    this.currentX = x;
    this.currentY = y;

    // 水平移動量に応じた回転と平行移動
    const rotate = deltaX * 0.08;
    this.card.style.transform = `translate3d(${deltaX}px, ${deltaY * 0.25}px, 0) rotate(${rotate}deg)`;

    // バッジ表示（右でPASS、左でFAIL）
    if (deltaX > 40) {
      this.card.classList.add('swiping-right');
      this.card.classList.remove('swiping-left');
    } else if (deltaX < -40) {
      this.card.classList.add('swiping-left');
      this.card.classList.remove('swiping-right');
    } else {
      this.card.classList.remove('swiping-left', 'swiping-right');
    }
  }

  onEnd() {
    if (!this.isDragging) return;
    this.isDragging = false;
    const deltaX = this.currentX - this.startX;
    const threshold = window.innerWidth * 0.28; // 画面幅の28%以上でスワイプ認定

    this.card.style.transition = 'transform 0.25s ease-out, opacity 0.25s ease-out';
    this.card.classList.remove('swiping-left', 'swiping-right');

    if (!this.hasMoved) {
      // 単なるタップ ➔ カード反転
      this.card.style.transform = '';
      if (this.onClickCard) this.onClickCard();
      return;
    }

    if (deltaX > threshold) {
      // 右スワイプ: 合格
      this.card.style.transform = `translate3d(120vw, 0, 0) rotate(35deg)`;
      this.card.style.opacity = '0';
      setTimeout(() => {
        this.resetCard();
        if (this.onSwipeRight) this.onSwipeRight();
      }, 200);
    } else if (deltaX < -threshold) {
      // 左スワイプ: 不正解（未記憶）
      this.card.style.transform = `translate3d(-120vw, 0, 0) rotate(-35deg)`;
      this.card.style.opacity = '0';
      setTimeout(() => {
        this.resetCard();
        if (this.onSwipeLeft) this.onSwipeLeft();
      }, 200);
    } else {
      // 元の位置に戻す
      this.card.style.transform = '';
    }
  }

  resetCard() {
    this.card.style.transition = 'none';
    this.card.style.transform = '';
    this.card.style.opacity = '1';
    this.card.classList.remove('swiping-left', 'swiping-right');
  }

  triggerSwipe(direction) {
    this.card.style.transition = 'transform 0.25s ease-out, opacity 0.25s ease-out';
    if (direction === 'right') {
      this.card.style.transform = `translate3d(120vw, 0, 0) rotate(35deg)`;
      this.card.style.opacity = '0';
      setTimeout(() => {
        this.resetCard();
        if (this.onSwipeRight) this.onSwipeRight();
      }, 200);
    } else {
      this.card.style.transform = `translate3d(-120vw, 0, 0) rotate(-35deg)`;
      this.card.style.opacity = '0';
      setTimeout(() => {
        this.resetCard();
        if (this.onSwipeLeft) this.onSwipeLeft();
      }, 200);
    }
  }
}
