/**
 * swipe.js - スマホ向け超高感度スワイプコントローラー
 * Pointer Events に一本化し、タップの二重発火・誤動作を完全防止
 */

export class SwipeController {
  constructor(cardElement, onSwipeLeft, onSwipeRight, onClickCard) {
    this.card = cardElement;
    this.onSwipeLeft = onSwipeLeft;
    this.onSwipeRight = onSwipeRight;
    this.onClickCard = onClickCard;

    this.startX = 0;
    this.startY = 0;
    this.currentX = 0;
    this.currentY = 0;
    this.startTime = 0;
    this.isDragging = false;
    this.activePointerId = null;
    this.lastTapTime = 0;

    this.bindEvents();
  }

  bindEvents() {
    this.card.style.touchAction = 'none';

    this.card.addEventListener('pointerdown', (e) => {
      // 音声再生ボタンクリック時はカードスワイプを無効化
      if (e.target.closest('.btn-audio')) return;

      this.activePointerId = e.pointerId;
      this.card.setPointerCapture(e.pointerId);

      this.startX = e.clientX;
      this.startY = e.clientY;
      this.currentX = e.clientX;
      this.currentY = e.clientY;
      this.startTime = Date.now();
      this.isDragging = true;

      this.card.style.transition = 'none';
    });

    this.card.addEventListener('pointermove', (e) => {
      if (!this.isDragging || e.pointerId !== this.activePointerId) return;

      this.currentX = e.clientX;
      this.currentY = e.clientY;

      const deltaX = this.currentX - this.startX;
      const deltaY = this.currentY - this.startY;

      // 追従移動 & わずかな回転
      const rotate = deltaX * 0.08;
      this.card.style.transform = `translate3d(${deltaX}px, ${deltaY * 0.2}px, 0) rotate(${rotate}deg)`;

      // 小さな動き（20px）でもスタンプを早めにプレビュー表示
      if (deltaX > 20) {
        this.card.classList.add('swiping-right');
        this.card.classList.remove('swiping-left');
      } else if (deltaX < -20) {
        this.card.classList.add('swiping-left');
        this.card.classList.remove('swiping-right');
      } else {
        this.card.classList.remove('swiping-left', 'swiping-right');
      }
    });

    const handleRelease = (e) => {
      if (!this.isDragging || e.pointerId !== this.activePointerId) return;
      this.isDragging = false;

      try {
        this.card.releasePointerCapture(e.pointerId);
      } catch (err) {}

      const deltaX = this.currentX - this.startX;
      const deltaY = this.currentY - this.startY;
      const deltaTime = Math.max(1, Date.now() - this.startTime);
      const distance = Math.hypot(deltaX, deltaY);
      const velocity = Math.abs(deltaX) / deltaTime; // px/ms

      this.card.classList.remove('swiping-left', 'swiping-right');

      // 1. タップ判定 (移動が10px未満、かつタップの二重発火防止)
      if (distance < 12) {
        this.resetCard(true);
        const now = Date.now();
        if (now - this.lastTapTime > 250) {
          this.lastTapTime = now;
          if (this.onClickCard) this.onClickCard();
        }
        return;
      }

      // 2. スワイプ判定 (小さなスライドでもOKに調整)
      // 通常スワイプ: 45px以上
      // 素早いフリック (velocity > 0.25): 25px以上
      const threshold = (velocity > 0.25) ? 25 : 45;

      if (deltaX > threshold) {
        // 右スワイプ: ◯ 分かる
        this.card.style.transition = 'transform 0.2s ease-out, opacity 0.2s ease-out';
        this.card.style.transform = 'translate3d(120vw, 0, 0) rotate(30deg)';
        this.card.style.opacity = '0';
        setTimeout(() => {
          this.resetCard(false);
          if (this.onSwipeRight) this.onSwipeRight();
        }, 180);
      } else if (deltaX < -threshold) {
        // 左スワイプ: ✕ 分からない
        this.card.style.transition = 'transform 0.2s ease-out, opacity 0.2s ease-out';
        this.card.style.transform = 'translate3d(-120vw, 0, 0) rotate(-30deg)';
        this.card.style.opacity = '0';
        setTimeout(() => {
          this.resetCard(false);
          if (this.onSwipeLeft) this.onSwipeLeft();
        }, 180);
      } else {
        // 戻す
        this.resetCard(true);
      }
    };

    this.card.addEventListener('pointerup', handleRelease);
    this.card.addEventListener('pointercancel', handleRelease);
  }

  resetCard(animate = true) {
    if (animate) {
      this.card.style.transition = 'transform 0.2s ease-out';
    } else {
      this.card.style.transition = 'none';
    }
    this.card.style.transform = '';
    this.card.style.opacity = '1';
    this.card.classList.remove('swiping-left', 'swiping-right');
  }

  triggerSwipe(direction) {
    this.card.style.transition = 'transform 0.2s ease-out, opacity 0.2s ease-out';
    if (direction === 'right') {
      this.card.style.transform = 'translate3d(120vw, 0, 0) rotate(30deg)';
      this.card.style.opacity = '0';
      setTimeout(() => {
        this.resetCard(false);
        if (this.onSwipeRight) this.onSwipeRight();
      }, 180);
    } else {
      this.card.style.transform = 'translate3d(-120vw, 0, 0) rotate(-30deg)';
      this.card.style.opacity = '0';
      setTimeout(() => {
        this.resetCard(false);
        if (this.onSwipeLeft) this.onSwipeLeft();
      }, 180);
    }
  }
}
