// Агрегации для страницы статистики. Разбор трудных символов здесь базовый
// (сглаженная доля ошибок); развитие алгоритма — на стороне бэкенда.

import { dayKey, addDays, avg } from '../core/utils.js';
import { keyForChar } from '../data/layouts.js';

const PRIOR_ATTEMPTS = 6;

/** Самые проблемные символы/сочетания: доля ошибок со сглаживанием к среднему. */
export function hardest(stats, { limit = 10, minAttempts = 5 } = {}) {
  const rows = Object.entries(stats || {}).filter(([, [, a]]) => a >= minAttempts);
  if (!rows.length) return [];
  const totalE = rows.reduce((s, [, [e]]) => s + e, 0);
  const totalA = rows.reduce((s, [, [, a]]) => s + a, 0);
  const base = totalA ? totalE / totalA : 0;
  return rows
    .map(([ch, [errors, attempts]]) => ({
      ch,
      errors,
      attempts,
      rate: errors / attempts,
      score: (errors + base * PRIOR_ATTEMPTS) / (attempts + PRIOR_ATTEMPTS),
    }))
    .filter((r) => r.errors > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/**
 * Риск ошибки по буквам и переходам для умной тренировки.
 * Если сервер обучил модель — берём её предсказания, иначе сглаженную долю ошибок.
 */
export function riskFor(store, lang) {
  const ml = store.insights?.personal?.risk?.[lang];
  if (ml && Object.keys(ml.chars || {}).length) return ml;
  const smooth = (stats) => {
    const rows = Object.entries(stats || {});
    const e = rows.reduce((s, [, [x]]) => s + x, 0);
    const a = rows.reduce((s, [, [, y]]) => s + y, 0);
    const base = a ? e / a : 0.03;
    return Object.fromEntries(rows.map(([k, [x, y]]) => [k, (x + base * PRIOR_ATTEMPTS) / (y + PRIOR_ATTEMPTS)]));
  };
  return {
    chars: smooth(store.progress?.charStats?.[lang]),
    bigrams: smooth(store.progress?.bigramStats?.[lang]),
  };
}

/**
 * Разбор одной тренировки по логу нажатий: ошибки в начале/середине/конце,
 * среднее время реакции на символ, ошибки по рядам клавиатуры.
 */
export function sessionBreakdown(result, lang) {
  const log = result.keylog || { t: [], ch: '', err: '' };
  const n = log.t.length;
  const thirds = [0, 1, 2].map(() => ({ e: 0, a: 0 }));
  const rows = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0 };
  const gaps = [];
  for (let i = 0; i < n; i++) {
    const third = Math.min(2, Math.floor((i / n) * 3));
    thirds[third].a++;
    const err = log.err[i] === '1';
    if (err) {
      thirds[third].e++;
      const info = keyForChar(log.ch[i], lang) || keyForChar(log.ch[i], lang === 'ru' ? 'en' : 'ru');
      if (info) rows[rowOf(info.code)]++;
    }
    if (i) {
      const gap = log.t[i] - log.t[i - 1];
      if (gap > 0 && gap < 2000) gaps.push(gap);
    }
  }
  gaps.sort((a, b) => a - b);
  return {
    thirds: thirds.map((t) => (t.a ? t.e / t.a : 0)),
    reactionMs: gaps.length ? Math.round(gaps[Math.floor(gaps.length / 2)]) : null,
    rows,
    firstTryErrors: Array.from(log.err).filter((c) => c === '1').length,
  };
}

function rowOf(code) {
  if (code === 'Space') return 4;
  if (/^(Digit|Backquote|Minus|Equal)/.test(code)) return 0;
  if (/^Key[QWERTYUIOP]$|^Bracket|^Backslash/.test(code)) return 1;
  if (/^Key[ASDFGHJKL]$|^Semicolon|^Quote|^Enter/.test(code)) return 2;
  return 3;
}

/** Доля ошибок по каждой клавише — для тепловой карты клавиатуры. */
export function errorRates(stats) {
  const out = {};
  for (const [ch, [e, a]] of Object.entries(stats || {})) if (a > 0) out[ch] = { rate: e / a, attempts: a };
  return out;
}

export const PERIODS = { week: 7, month: 30, all: 0 };

export function historyInPeriod(p, period, now = Date.now()) {
  const days = PERIODS[period];
  if (!days) return p.history;
  const from = addDays(now, -days + 1);
  const fromKey = dayKey(from);
  return p.history.filter((h) => dayKey(h.ts) >= fromKey);
}

export function summary(list) {
  const counted = list.filter((h) => h.chars >= 20);
  return {
    sessions: list.length,
    timeSec: list.reduce((s, h) => s + h.duration, 0),
    chars: list.reduce((s, h) => s + h.chars, 0),
    avgCpm: Math.round(avg(counted.map((h) => h.cpm))),
    bestCpm: Math.max(0, ...counted.map((h) => h.cpm)),
    avgAcc: avg(counted.map((h) => h.accuracy)),
    errors: list.reduce((s, h) => s + h.errors, 0),
    xp: list.reduce((s, h) => s + (h.xp || 0), 0),
  };
}

/** Ряды по дням для графиков. Пустые дни — null, чтобы линия не падала в ноль. */
export function dailySeries(p, days, now = Date.now()) {
  const keys = [];
  for (let i = days - 1; i >= 0; i--) keys.push(dayKey(addDays(now, -i)));
  const rows = keys.map((k) => p.days[k]);
  return {
    keys,
    cpm: rows.map((d) => (d && d.sessions ? Math.round(d.cpmSum / d.sessions) : null)),
    best: rows.map((d) => (d && d.sessions ? d.bestCpm : null)),
    acc: rows.map((d) => (d && d.sessions ? Math.round((d.accSum / d.sessions) * 10) / 10 : null)),
    minutes: rows.map((d) => (d ? Math.round(d.timeSec / 60) : 0)),
    sessions: rows.map((d) => (d ? d.sessions : 0)),
  };
}

/** Сетка активности (недели × 7 дней), как календарь вкладов. */
export function activityGrid(p, weeks = 18, now = Date.now()) {
  const today = new Date(now);
  const dow = (today.getDay() + 6) % 7; // пн = 0
  const start = addDays(now, -(weeks - 1) * 7 - dow);
  const cells = [];
  for (let i = 0; i < weeks * 7; i++) {
    const ts = addDays(start, i);
    const key = dayKey(ts);
    const d = p.days[key];
    cells.push({ key, ts, future: ts > now, minutes: d ? d.timeSec / 60 : 0, sessions: d ? d.sessions : 0 });
  }
  return cells;
}
