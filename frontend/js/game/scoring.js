// Очки, комбо-множители, опыт и уровни.

export const POINTS_PER_CHAR = 10;

/** Пороги серии правильных нажатий → множитель очков. */
export const COMBO_TIERS = [
  { min: 0, mult: 1, name: 'Без комбо', color: 'var(--combo-1)' },
  { min: 10, mult: 2, name: 'Разогрев', color: 'var(--combo-2)' },
  { min: 25, mult: 3, name: 'В ударе', color: 'var(--combo-3)' },
  { min: 50, mult: 5, name: 'В огне', color: 'var(--combo-5)' },
];

/**
 * Бонус за упражнение: P = C·M + B, где B — за завершение и за высокую точность.
 * → { total, parts: [{ label, points }] }
 */
export function finishBonus({ accuracy, chars }) {
  const parts = [];
  if (chars >= 20) parts.push({ label: 'Упражнение завершено', points: 100 });
  if (chars >= 20 && accuracy >= 98) parts.push({ label: 'Точность 98%+', points: 150 });
  else if (chars >= 20 && accuracy >= 95) parts.push({ label: 'Точность 95%+', points: 75 });
  return { total: parts.reduce((s, p) => s + p.points, 0), parts };
}

export function comboTier(streak) {
  let idx = 0;
  for (let i = 0; i < COMBO_TIERS.length; i++) if (streak >= COMBO_TIERS[i].min) idx = i;
  return idx;
}

/** Прогресс до следующего порога комбо, 0..1 (на последнем — всегда 1). */
export function comboProgress(streak) {
  const idx = comboTier(streak);
  const next = COMBO_TIERS[idx + 1];
  if (!next) return 1;
  const cur = COMBO_TIERS[idx].min;
  return (streak - cur) / (next.min - cur);
}

/** Опыт за упражнение: очки (с учётом бонуса ×2 XP) и поправка на точность. */
export function xpFromScore(xpScore, accuracy) {
  const accFactor = accuracy >= 97 ? 1.25 : accuracy >= 93 ? 1.1 : accuracy >= 85 ? 1 : 0.75;
  return Math.max(1, Math.round((xpScore / 50) * accFactor));
}

/** Сколько всего опыта нужно, чтобы достичь уровня: 0, 100, 300, 600, 1000… */
export const xpForLevel = (level) => 50 * (level - 1) * level;

export function levelFromXp(xp) {
  let level = 1;
  while (xpForLevel(level + 1) <= xp) level++;
  return level;
}

export function levelProgress(xp) {
  const level = levelFromXp(xp);
  const base = xpForLevel(level);
  const next = xpForLevel(level + 1);
  return { level, cur: xp - base, need: next - base, pct: ((xp - base) / (next - base)) * 100 };
}

/** Оценка за упражнение — игровая «буква», как в аркадах. */
export function grade(cpm, accuracy) {
  if (accuracy >= 98 && cpm >= 250) return 'S';
  if (accuracy >= 95 && cpm >= 180) return 'A';
  if (accuracy >= 92 && cpm >= 120) return 'B';
  if (accuracy >= 85) return 'C';
  return 'D';
}

export const GRADE_TEXT = {
  S: 'Безупречно. Так печатают герои.',
  A: 'Отличный результат — быстро и чисто.',
  B: 'Хорошо! Ещё немного точности — и будет A.',
  C: 'Неплохо. Сбавьте темп и целитесь в точность.',
  D: 'Разминка засчитана. Медленнее — значит точнее.',
};
