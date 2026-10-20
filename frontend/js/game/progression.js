// Прогресс игрока: применение итога тренировки к агрегатам, опыт, серия дней,
// задания и достижения. Чистые функции — их же повторит бэкенд для валидации.

import { ACHIEVEMENTS, RARITY } from '../data/achievements.js';
import { dailyQuests, applyQuests } from './quests.js';
import { levelFromXp } from './scoring.js';
import { dayKey, daysBetween, uid } from '../core/utils.js';

const HISTORY_LIMIT = 300;
const SAMPLES_KEEP = 40;

export function createProgress(now = Date.now()) {
  return {
    version: 1,
    createdAt: now,
    xp: 0,
    level: 1,
    totals: {
      sessions: 0, timeSec: 0, chars: 0, keystrokes: 0, errors: 0, bonuses: 0,
      bestCpm: 0, bestStreak: 0, accuracyRun: 0,
      langs: { ru: 0, en: 0 },
      modes: {},
    },
    modeBest: {},
    flags: {},
    charStats: { ru: {}, en: {} },
    bigramStats: { ru: {}, en: {} },
    achievements: {},
    streak: { current: 0, best: 0, lastDay: null },
    quests: { day: null, items: [] },
    days: {},
    history: [],
  };
}

/** Обновляет задания дня, если наступили новые сутки. Мутирует p. */
export function ensureDay(p, now = Date.now()) {
  const today = dayKey(now);
  if (p.quests.day !== today) p.quests = { day: today, items: dailyQuests(today, p.level) };
  return p;
}

/** Текущая серия с учётом пропуска: если вчера не занимались — серия сгорела. */
export function activeStreak(p, now = Date.now()) {
  if (!p.streak.lastDay) return 0;
  const gap = daysBetween(p.streak.lastDay, dayKey(now));
  return gap <= 1 ? p.streak.current : 0;
}

export function todayStats(p, now = Date.now()) {
  return p.days[dayKey(now)] || { sessions: 0, timeSec: 0, chars: 0, xp: 0, cpmSum: 0, accSum: 0, bestCpm: 0 };
}

function mergeStats(target, src) {
  for (const [k, [e, a]] of Object.entries(src || {})) {
    const rec = target[k] || (target[k] = [0, 0]);
    rec[0] += e;
    rec[1] += a;
  }
}

/**
 * Применить завершённую тренировку.
 * @param session { mode, lang, codeLang, difficulty, durationSetting, duration, cpm, wpm, accuracy,
 *                  errors, chars, keystrokes, maxStreak, score, bonuses, xp, charStats, bigramStats, samples }
 * @returns {{ progress, report }}
 */
export function applySession(progress, session, now = Date.now()) {
  const p = structuredClone(progress);
  ensureDay(p, now);
  const day = dayKey(now);
  const t = p.totals;
  const levelBefore = levelFromXp(p.xp);
  const prevBestCpm = t.bestCpm;
  const counts = session.chars >= 20 && session.duration >= 8;

  const entry = {
    id: uid(),
    ts: now,
    mode: session.mode,
    lang: session.lang,
    codeLang: session.codeLang,
    difficulty: session.difficulty,
    cpm: session.cpm,
    wpm: session.wpm,
    accuracy: session.accuracy,
    errors: session.errors,
    chars: session.chars,
    duration: session.duration,
    maxStreak: session.maxStreak,
    score: session.score,
    bonuses: session.bonuses,
    samples: session.samples?.map((s) => s.cpm),
  };
  p.history.unshift(entry);
  p.history.length = Math.min(p.history.length, HISTORY_LIMIT);
  p.history.slice(SAMPLES_KEEP).forEach((h) => delete h.samples);

  t.sessions++;
  t.timeSec += session.duration;
  t.chars += session.chars;
  t.keystrokes += session.keystrokes;
  t.errors += session.errors;
  t.bonuses += session.bonuses || 0;
  t.bestStreak = Math.max(t.bestStreak, session.maxStreak);
  t.langs[session.lang] = (t.langs[session.lang] || 0) + 1;
  t.modes[session.mode] = (t.modes[session.mode] || 0) + 1;
  t.accuracyRun = session.accuracy >= 98 && session.chars >= 50 ? t.accuracyRun + 1 : 0;
  const isBestCpm = counts && session.cpm > t.bestCpm;
  if (isBestCpm) t.bestCpm = session.cpm;
  if (counts) p.modeBest[session.mode] = Math.max(p.modeBest[session.mode] || 0, session.cpm);

  const hour = new Date(now).getHours();
  if (session.accuracy === 100 && session.chars >= 100) p.flags.cleanSheet = true;
  if (session.mode === 'symbols' && session.accuracy >= 95 && session.chars >= 50) p.flags.cipher = true;
  if (session.mode === 'code' && session.errors === 0 && session.chars >= 40) p.flags.flawlessCode = true;
  if (hour < 5) p.flags.nightOwl = true;
  else if (hour < 8) p.flags.earlyBird = true;

  p.charStats[session.lang] ??= {};
  p.bigramStats[session.lang] ??= {};
  mergeStats(p.charStats[session.lang], session.charStats);
  mergeStats(p.bigramStats[session.lang], session.bigramStats);

  if (p.streak.lastDay !== day) {
    const gap = p.streak.lastDay ? daysBetween(p.streak.lastDay, day) : null;
    p.streak.current = gap === 1 ? p.streak.current + 1 : 1;
    p.streak.lastDay = day;
    p.streak.best = Math.max(p.streak.best, p.streak.current);
  }

  const d = (p.days[day] ||= { sessions: 0, timeSec: 0, chars: 0, xp: 0, cpmSum: 0, accSum: 0, bestCpm: 0 });
  d.sessions++;
  d.timeSec += session.duration;
  d.chars += session.chars;
  d.cpmSum += session.cpm;
  d.accSum += session.accuracy;
  d.bestCpm = Math.max(d.bestCpm, session.cpm);

  // Опыт: тренировка → задания → достижения (достижения уровня проверяем после начисления)
  const breakdown = [{ kind: 'base', label: 'За тренировку', xp: session.xp }];
  let gained = session.xp;

  const questsCompleted = applyQuests(p.quests.items, session);
  for (const q of questsCompleted) {
    breakdown.push({ kind: 'quest', label: q.title, xp: q.reward });
    gained += q.reward;
  }
  p.xp += gained;
  p.level = levelFromXp(p.xp);

  const newAchievements = [];
  for (let pass = 0; pass < 2; pass++) {
    for (const a of ACHIEVEMENTS) {
      if (p.achievements[a.id]) continue;
      const [cur, target] = a.progress(p);
      if (cur < target) continue;
      p.achievements[a.id] = now;
      newAchievements.push(a);
      const bonus = RARITY[a.rarity].xp;
      breakdown.push({ kind: 'ach', label: a.title, xp: bonus });
      gained += bonus;
      p.xp += bonus;
    }
    p.level = levelFromXp(p.xp);
  }

  d.xp += gained;
  entry.xp = gained;

  return {
    progress: p,
    report: {
      entry,
      xpGained: gained,
      breakdown,
      xpBefore: progress.xp,
      xpAfter: p.xp,
      levelBefore,
      levelAfter: p.level,
      newAchievements,
      questsCompleted,
      isBestCpm: isBestCpm && prevBestCpm > 0,
      prevBestCpm,
    },
  };
}
