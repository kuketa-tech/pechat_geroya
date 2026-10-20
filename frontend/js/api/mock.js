// Временный «бэкенд» в localStorage. Повторяет контракт будущего REST API
// (FastAPI + SQLite), чтобы фронтенд работал уже сейчас. Подменяется в api/index.js.

import { createProgress, applySession, ensureDay } from '../game/progression.js';
import { levelFromXp, xpFromScore, POINTS_PER_CHAR } from '../game/scoring.js';
import { storageGet, storageSet, storageRemove, seededRandom, hashStr, dayKey, addDays, uid, pick } from '../core/utils.js';
import { PERIODS } from '../game/analysis.js';

const USERS_KEY = 'pg.users.v1';
const SESSION_KEY = 'pg.session.v1';
const progressKey = (id) => `pg.progress.v1.${id}`;

export const GUEST = { id: 'guest', name: 'Гость', guest: true, provider: 'local' };

const PROVIDERS = {
  vk: 'VK ID',
  yandex: 'Яндекс ID',
  google: 'Google',
  github: 'GitHub',
};

const DEMO_BIGRAMS = {
  ru: ['ст', 'но', 'то', 'на', 'ен', 'ов', 'ни', 'ра', 'пр', 'ро', 'щи', 'жэ', 'ъе', 'ую', 'ыв', 'хо', 'ющ', 'эт', 'фы', 'жи'],
  en: ['th', 'he', 'in', 'er', 'an', 're', 'on', 'at', 'nd', 'qu', 'zy', 'xt', 'pl', 'bv', 'ck', 'ty', 'ou', 'wh', 'py', 'ex'],
};

class ApiError extends Error {
  constructor(message, field) {
    super(message);
    this.field = field;
  }
}

async function hashPassword(password) {
  if (crypto?.subtle) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`pg:${password}`));
    return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
  }
  return String(hashStr(`pg:${password}`));
}

const users = () => storageGet(USERS_KEY, {});
const saveUsers = (u) => storageSet(USERS_KEY, u);
const publicUser = ({ passHash, ...u }) => u;

function loadProgress(id) {
  const p = storageGet(progressKey(id), null) || createProgress();
  return ensureDay(p);
}
const saveProgress = (id, p) => storageSet(progressKey(id), p);

/** Перенос прогресса гостя в новый аккаунт — чтобы первая тренировка не терялась. */
function adoptGuestProgress(userId) {
  const guest = storageGet(progressKey(GUEST.id), null);
  if (!guest || !guest.totals.sessions) return false;
  saveProgress(userId, guest);
  storageRemove(progressKey(GUEST.id));
  return true;
}

export const mockBackend = {
  async me() {
    const session = storageGet(SESSION_KEY, null);
    const user = session && users()[session.email];
    return user ? publicUser(user) : GUEST;
  },

  async register({ name, email, password }) {
    const all = users();
    const key = email.trim().toLowerCase();
    if (all[key]) throw new ApiError('Этот email уже зарегистрирован', 'email');
    const user = {
      id: uid(),
      name: name.trim(),
      email: key,
      provider: 'email',
      createdAt: Date.now(),
      passHash: await hashPassword(password),
    };
    all[key] = user;
    saveUsers(all);
    storageSet(SESSION_KEY, { email: key });
    const migrated = adoptGuestProgress(user.id);
    return { user: publicUser(user), progress: loadProgress(user.id), migrated };
  },

  async login({ email, password }) {
    const key = email.trim().toLowerCase();
    const user = users()[key];
    if (!user || user.provider !== 'email') throw new ApiError('Аккаунт с таким email не найден', 'email');
    if (user.passHash !== (await hashPassword(password))) throw new ApiError('Неверный пароль', 'password');
    storageSet(SESSION_KEY, { email: key });
    return { user: publicUser(user), progress: loadProgress(user.id) };
  },

  async loginSocial(provider) {
    const all = users();
    const key = `${provider}@oauth.local`;
    let migrated = false;
    if (!all[key]) {
      all[key] = { id: uid(), name: `Игрок ${PROVIDERS[provider] || provider}`, email: key, provider, createdAt: Date.now() };
      saveUsers(all);
      migrated = adoptGuestProgress(all[key].id);
    }
    storageSet(SESSION_KEY, { email: key });
    return { user: publicUser(all[key]), progress: loadProgress(all[key].id), migrated };
  },

  async logout() {
    storageRemove(SESSION_KEY);
    return { user: GUEST, progress: loadProgress(GUEST.id) };
  },

  async getProgress(userId) {
    return loadProgress(userId);
  },

  async saveSession(userId, session) {
    const { progress, report } = applySession(loadProgress(userId), session);
    saveProgress(userId, progress);
    return { progress, report };
  },

  async updateProfile(userId, patch) {
    const all = users();
    const entry = Object.values(all).find((u) => u.id === userId);
    if (!entry) throw new ApiError('Профиль гостя нельзя изменить — войдите в аккаунт');
    Object.assign(entry, { name: patch.name?.trim() || entry.name });
    saveUsers(all);
    return publicUser(entry);
  },

  async resetProgress(userId) {
    const p = ensureDay(createProgress());
    saveProgress(userId, p);
    return p;
  },

  async leaderboard({ metric, period }, user, progress) {
    return buildLeaderboard(metric, period, user, progress);
  },

  /** Для разработки: заполнить историю правдоподобными тренировками за 4 недели. */
  async seedDemo(userId) {
    let p = createProgress(addDays(Date.now(), -30));
    const rnd = seededRandom(`demo:${userId}`);
    const now = Date.now();
    const weakRu = 'щжэъюхыф';
    const weakEn = 'qzxp;bvy';
    for (let d = 27; d >= 0; d--) {
      if (rnd() < 0.18 && d > 1) continue;
      const sessions = 1 + Math.floor(rnd() * 3);
      for (let s = 0; s < sessions; s++) {
        const progressT = 1 - d / 27;
        const lang = rnd() < 0.7 ? 'ru' : 'en';
        const mode = pick(['words', 'words', 'sentences', 'sentences', 'symbols', 'code'], rnd);
        const cpm = Math.round(150 + progressT * 120 + (rnd() - 0.5) * 50 - (mode === 'code' ? 40 : 0));
        const accuracy = Math.min(100, Math.round((90 + progressT * 6.5 + (rnd() - 0.5) * 4) * 10) / 10);
        const duration = pick([30, 60, 60, 120], rnd);
        const chars = Math.round((cpm * duration) / 60);
        const errors = Math.round((chars * (100 - accuracy)) / 100);
        const maxStreak = Math.round(20 + rnd() * (60 + progressT * 160));
        const score = Math.round(chars * POINTS_PER_CHAR * (1.6 + progressT * 1.4));
        const charStats = {};
        const letters = lang === 'ru' ? 'оеаинтсрвлкмдпуяыьгзбчйхжшюцщэфъ' : 'etaoinshrdlcumwfgypbvkjxqz';
        const weak = lang === 'ru' ? weakRu : weakEn;
        for (const ch of letters) {
          const attempts = Math.round(chars / letters.length * (0.5 + rnd()));
          const rate = weak.includes(ch) ? 0.06 + rnd() * 0.1 : rnd() * 0.035;
          charStats[ch] = [Math.round(attempts * rate), attempts];
        }
        const bigramStats = {};
        for (const bg of DEMO_BIGRAMS[lang]) {
          const attempts = Math.round(4 + rnd() * chars / 40);
          const hard = [...bg].some((c) => weak.includes(c));
          bigramStats[bg] = [Math.round(attempts * (hard ? 0.08 + rnd() * 0.14 : rnd() * 0.04)), attempts];
        }
        const ts = addDays(now, -d) - (sessions - s) * 3600000 * (1 + rnd());
        const res = applySession(p, {
          mode, lang, codeLang: 'python', difficulty: 1 + Math.floor(progressT * 2),
          duration, cpm, wpm: Math.round(cpm / 5), accuracy, errors, chars, keystrokes: chars + errors,
          maxStreak, score, bonuses: rnd() < 0.5 ? 1 : 0, xp: xpFromScore(score, accuracy),
          charStats, bigramStats, samples: [],
        }, Math.min(ts, now - 60000));
        p = res.progress;
      }
    }
    ensureDay(p);
    saveProgress(userId, p);
    return p;
  },
};

/* ---------------- Таблица лидеров (демо-соперники до подключения БД) ---------------- */

const RIVALS = [
  'Клавогонщик', 'neo_typer', 'Мизинец', 'ФЫВА_ОЛДЖ', 'Быстрые_пальцы', 'QwertyQueen', 'Тихий_Ход', 'dvorak_fan',
  'Стенографист', 'Летописец', 'Пиксель', 'Ctrl_Alt_Win', 'Сова_в_ночи', 'Ra1nbow', 'keymaster', 'Ласточка',
  'Капитан Пробел', 'Shift_Happens', 'Кузнец слов', 'Вжух', 'Lumen', 'Бармалей', 'ТурбоУлитка', 'Echo',
  'Нарвал', 'Alt_F4', 'Медведь', 'Zenith', 'Котопёс', 'КнязьТекста', 'Байт', 'Glitch', 'Рысь', 'Штурман',
  'Полярник', 'Mira', 'Ёжик', 'Nova', 'Тайпер3000', 'Аврора', 'Grizzly', 'Скороход', 'Volt', 'Дрон', 'Кедр',
  'Orion', 'Ветерок', 'Марс',
];

function rivalsFor(period) {
  const rndBase = seededRandom('rivals:v1');
  const base = RIVALS.map((name, i) => {
    const skill = Math.pow(rndBase(), 1.6);
    return {
      id: `r${i}`,
      name,
      bestCpm: Math.round(140 + skill * 420 + rndBase() * 30),
      accuracy: Math.round((89 + rndBase() * 10.5) * 10) / 10,
      xp: Math.round(400 + Math.pow(skill, 0.8) * 48000 + rndBase() * 2000),
    };
  });
  if (period === 'all') return base.map((r) => ({ ...r, level: levelFromXp(r.xp), periodXp: r.xp, sessions: Math.round(r.xp / 90) }));

  const days = PERIODS[period] || 1;
  const rnd = seededRandom(`rivals:${period}:${dayKey()}`);
  const activeShare = period === 'day' ? 0.55 : 0.85;
  return base
    .filter(() => rnd() < activeShare)
    .map((r) => {
      const sessions = Math.max(1, Math.round(rnd() * 4 * days));
      return {
        ...r,
        level: levelFromXp(r.xp),
        bestCpm: Math.round(r.bestCpm * (0.85 + rnd() * 0.15)),
        accuracy: Math.round(Math.min(99.9, r.accuracy + (rnd() - 0.6) * 2) * 10) / 10,
        periodXp: Math.round(sessions * (60 + rnd() * 110)),
        sessions,
      };
    });
}

function myEntry(user, progress, period) {
  const days = PERIODS[period] || (period === 'day' ? 1 : 0);
  const fromKey = days ? dayKey(addDays(Date.now(), -days + 1)) : '';
  const list = progress.history.filter((h) => !days || dayKey(h.ts) >= fromKey);
  if (!list.length) return null;
  const counted = list.filter((h) => h.chars >= 20);
  const ref = counted.length ? counted : list;
  return {
    id: user.id,
    name: user.guest ? 'Вы (гость)' : user.name,
    me: true,
    level: progress.level,
    bestCpm: Math.max(...ref.map((h) => h.cpm)),
    accuracy: Math.round((ref.reduce((s, h) => s + h.accuracy, 0) / ref.length) * 10) / 10,
    periodXp: period === 'all' ? progress.xp : list.reduce((s, h) => s + (h.xp || 0), 0),
    sessions: list.length,
  };
}

const METRIC_VALUE = {
  speed: (r) => r.bestCpm,
  accuracy: (r) => r.accuracy,
  xp: (r) => r.periodXp,
};

function buildLeaderboard(metric, period, user, progress) {
  const rows = rivalsFor(period);
  const mine = progress && myEntry(user, progress, period);
  if (mine) rows.push(mine);
  const value = METRIC_VALUE[metric] || METRIC_VALUE.speed;
  rows.sort((a, b) => value(b) - value(a) || b.bestCpm - a.bestCpm);
  rows.forEach((r, i) => {
    r.rank = i + 1;
    r.value = value(r);
  });
  return {
    items: rows.slice(0, 50),
    me: rows.find((r) => r.me) || null,
    total: rows.length,
  };
}
