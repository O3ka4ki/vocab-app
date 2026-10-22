export const ReviewGrade = {
  AGAIN: 1, // もう一度（忘れた）
  HARD: 2,  // 難しい（あやふや）
  GOOD: 3,  // 普通（覚えている）
  EASY: 4   // 簡単（完璧）
};

export function createDefaultSRSData() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return {
    reps: 0,
    interval: 0,
    easeFactor: 2.5,
    dueDate: today.getTime(),
    lastReviewed: null,
    state: 'new',
    history: []
  };
}

export function calculateNextSRS(currentSRS, grade) {
  const srs = currentSRS || createDefaultSRSData();
  let { reps = 0, interval = 0, easeFactor = 2.5 } = srs;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

  let nextInterval = 0;
  let nextReps = reps;
  let nextEase = easeFactor;
  let nextState = 'review';

  const q = grade + 1;
  nextEase = easeFactor + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
  if (nextEase < 1.3) nextEase = 1.3;

  if (grade === ReviewGrade.AGAIN) {
    nextReps = 0;
    nextInterval = 1;
    nextState = 'learning';
  } else {
    if (nextReps === 0) {
      nextInterval = (grade === ReviewGrade.EASY) ? 3 : 1;
      nextReps = 1;
    } else if (nextReps === 1) {
      if (grade === ReviewGrade.HARD) nextInterval = 2;
      else if (grade === ReviewGrade.GOOD) nextInterval = 4;
      else nextInterval = 7;
      nextReps = 2;
    } else {
      let multiplier = nextEase;
      if (grade === ReviewGrade.HARD) multiplier = 1.2;
      else if (grade === ReviewGrade.EASY) multiplier = nextEase * 1.3;

      nextInterval = Math.max(1, Math.round(interval * multiplier));
      nextReps += 1;
    }

    nextState = nextInterval >= 21 ? 'mastered' : 'review';
  }

  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  const nextDueDate = today + (nextInterval * MS_PER_DAY);

  return {
    reps: nextReps,
    interval: nextInterval,
    easeFactor: parseFloat(nextEase.toFixed(2)),
    dueDate: nextDueDate,
    lastReviewed: now.getTime(),
    state: nextState,
    history: [
      ...(srs.history || []).slice(-19),
      { date: now.getTime(), grade, interval: nextInterval }
    ]
  };
}

export function isDueToday(word, targetDate = new Date()) {
  if (!word.srs) return true;
  const endOfTarget = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate(), 23, 59, 59, 999).getTime();
  return word.srs.dueDate <= endOfTarget;
}
