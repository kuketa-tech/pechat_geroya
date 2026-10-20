// Генерация текста упражнения под режим, язык и сложность.
// Для режимов на время текст «бесконечный»: source.more() дописывает следующий кусок.

import { WORDS, SENTENCES, CODE, SYMBOL_SETS } from '../data/texts.js';
import { keyForChar } from '../data/layouts.js';
import { pick, shuffle, seededRandom } from '../core/utils.js';

const WORD_LEN = { 1: [2, 5], 2: [3, 7], 3: [4, 9], 4: [5, 10] };
const CODE_LEVELS = { 1: [1, 1], 2: [1, 2], 3: [2, 3], 4: [3, 3] };
const PASSAGE_WORDS = { 1: 28, 2: 32, 3: 34, 4: 36 };

/** Колода без повторов: тянем по одному, перетасовываем по кругу. */
function deck(items, rnd) {
  let pile = [];
  let last = null;
  return () => {
    if (!pile.length) {
      pile = shuffle(items, rnd);
      if (pile.length > 1 && pile[pile.length - 1] === last) pile.unshift(pile.pop());
    }
    last = pile.pop();
    return last;
  };
}

function wordsChunk(lang, difficulty, count, rnd) {
  const [min, max] = WORD_LEN[difficulty] || WORD_LEN[1];
  const pool = WORDS[lang].filter((w) => w.length >= min && w.length <= max);
  const out = [];
  let last = '';
  for (let i = 0; i < count; i++) {
    let w = pick(pool, rnd);
    if (w === last && pool.length > 1) w = pick(pool, rnd);
    last = w;
    if (difficulty >= 3 && rnd() < (difficulty === 4 ? 0.3 : 0.18)) w = w[0].toUpperCase() + w.slice(1);
    if (difficulty === 4 && rnd() < 0.15) w += pick([',', '.', '!', '?', ';', ':'], rnd);
    out.push(w);
  }
  return out.join(' ');
}

function sentencePool(lang, difficulty) {
  const all = SENTENCES[lang];
  const plain = all.filter((s) => !/\d/.test(s));
  let pool = plain;
  if (difficulty === 1) pool = plain.filter((s) => s.length <= 60);
  else if (difficulty === 2) pool = plain.filter((s) => s.length <= 85);
  else if (difficulty === 4) pool = all;
  return pool.length >= 4 ? pool : all;
}

function codePool(codeLang, difficulty) {
  const [lo, hi] = CODE_LEVELS[difficulty] || CODE_LEVELS[1];
  const all = CODE[codeLang] || CODE.python;
  const pool = all.filter((s) => s.level >= lo && s.level <= hi);
  return (pool.length ? pool : all).map((s) => s.text);
}

const SYMBOL_WEIGHTS = {
  1: { letters: 0.5, digits: 0.5 },
  2: { letters: 0.35, digits: 0.3, punct: 0.35 },
  3: { letters: 0.25, digits: 0.25, punct: 0.25, brackets: 0.25 },
  4: { letters: 0.15, upper: 0.1, digits: 0.2, punct: 0.15, brackets: 0.2, special: 0.2 },
};

function symbolsChunk(lang, difficulty, groups, rnd) {
  const sets = { ...SYMBOL_SETS[lang], upper: SYMBOL_SETS[lang].letters.toUpperCase() };
  const weights = Object.entries(SYMBOL_WEIGHTS[difficulty] || SYMBOL_WEIGHTS[1]);
  const pickSet = () => {
    let r = rnd();
    for (const [name, w] of weights) {
      if ((r -= w) <= 0) return sets[name];
    }
    return sets.letters;
  };
  const [minLen, maxLen] = difficulty === 1 ? [2, 4] : [3, 5];
  const out = [];
  for (let g = 0; g < groups; g++) {
    const len = minLen + Math.floor(rnd() * (maxLen - minLen + 1));
    let grp = '';
    for (let i = 0; i < len; i++) grp += pick(pickSet(), rnd);
    out.push(grp);
  }
  return out.join(' ');
}

/**
 * Умная тренировка: слова выбираются с вероятностью ∝ exp(k·z), где z — нормированный
 * суммарный риск ошибки на буквах и переходах слова. Риск даёт модель ошибок на сервере
 * (или локальная статистика без сервера). Каждое седьмое слово — случайное, для ритма.
 */
function smartChunk(lang, count, rnd, risk = {}) {
  const chars = risk.chars || {};
  const bigrams = risk.bigrams || {};
  const values = Object.values(chars);
  const base = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0.03;
  const pool = WORDS[lang].filter((w) => w.length >= 3 && w.length <= 9);
  // Считаем только превышение риска над средним: слово ценно, если в нём есть трудные места,
  // а не просто много букв
  const scoreOf = (w) => {
    let s = 0;
    for (let i = 0; i < w.length; i++) {
      s += Math.max(0, (chars[w[i]] ?? base) - base);
      if (i) s += 0.5 * Math.max(0, (bigrams[w[i - 1] + w[i]] ?? base) - base);
    }
    return s / Math.sqrt(w.length);
  };
  const scores = pool.map(scoreOf);
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  const std = Math.sqrt(scores.reduce((a, b) => a + (b - mean) ** 2, 0) / scores.length) || 1;
  const weights = scores.map((s) => Math.exp(1.15 * ((s - mean) / std)));
  const total = weights.reduce((a, b) => a + b, 0);
  const draw = () => {
    let r = rnd() * total;
    for (let i = 0; i < pool.length; i++) if ((r -= weights[i]) <= 0) return pool[i];
    return pool[pool.length - 1];
  };
  const out = [];
  const used = new Map();
  for (let i = 0; i < count; i++) {
    let w = i % 7 === 6 ? pick(pool, rnd) : draw();
    for (let tries = 0; tries < 4 && (out.slice(-8).includes(w) || (used.get(w) || 0) >= 2); tries++) w = draw();
    used.set(w, (used.get(w) || 0) + 1);
    out.push(w);
  }
  return out.join(' ');
}

/** Текст испытания дня — одинаковый у всех игроков в эти сутки. */
export function dailyText(day) {
  const rnd = seededRandom(`daily:${day}`);
  const pool = SENTENCES.ru.filter((s) => !/\d/.test(s) && s.length <= 85);
  return shuffle(pool, rnd).slice(0, 3).join(' ');
}

/** Свой текст: типографские символы → набираемые, всё, чего нет на клавиатуре, убираем. */
export function normalizeCustomText(raw) {
  let t = String(raw || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[«»„“”]/g, '"')
    .replace(/[‘’‚]/g, "'")
    .replace(/[—–]/g, '-')
    .replace(/…/g, '...')
    .replace(/\t/g, ' ')
    .replace(/ /g, ' ');
  t = Array.from(t).filter((ch) => ch === '\n' || keyForChar(ch, 'ru') || keyForChar(ch, 'en')).join('');
  return t.replace(/ {2,}/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, 3000);
}

export function detectLang(text) {
  const cyr = (text.match(/[а-яё]/gi) || []).length;
  const lat = (text.match(/[a-z]/gi) || []).length;
  return cyr >= lat ? 'ru' : 'en';
}

/**
 * @param {{mode:string, lang:'ru'|'en', difficulty:number, codeLang:string, duration:number}} opts
 * @returns {{ lang: string, initial: string, more: (() => string) | null }}
 */
export function createTextSource({ mode, lang, difficulty, codeLang, duration, custom = '', risk = null, day = '' }, rnd = Math.random) {
  if (mode === 'daily') {
    return { lang: 'ru', initial: dailyText(day), more: null };
  }
  if (mode === 'custom') {
    const text = normalizeCustomText(custom);
    return { lang: detectLang(text), initial: text, more: duration > 0 ? () => `\n${text}` : null };
  }

  const textLang = mode === 'code' ? 'en' : lang;
  const timed = duration > 0;

  let nextSentence;
  let nextSnippet;

  const chunk = (size) => {
    switch (mode) {
      case 'sentences': {
        nextSentence ??= deck(sentencePool(textLang, difficulty), rnd);
        const parts = [];
        let len = 0;
        while (len < size) {
          const s = nextSentence();
          parts.push(s);
          len += s.length + 1;
        }
        return parts.join(' ');
      }
      case 'code': {
        nextSnippet ??= deck(codePool(codeLang, difficulty), rnd);
        const parts = [];
        let len = 0;
        while (len < size) {
          const s = nextSnippet();
          parts.push(s);
          len += s.length + 2;
        }
        return parts.join('\n\n');
      }
      case 'symbols':
        return symbolsChunk(textLang, difficulty, Math.ceil(size / 5), rnd);
      case 'smart':
        return smartChunk(textLang, Math.ceil(size / 6.5), rnd, risk || {});
      default:
        return wordsChunk(textLang, difficulty, Math.ceil(size / 6), rnd);
    }
  };

  const passage = () => {
    switch (mode) {
      case 'sentences': return chunk(difficulty === 1 ? 150 : 230);
      case 'code': return chunk(difficulty === 1 ? 70 : 140);
      case 'symbols': return symbolsChunk(textLang, difficulty, 22, rnd);
      case 'smart': return smartChunk(textLang, 30, rnd, risk || {});
      default: return wordsChunk(textLang, difficulty, PASSAGE_WORDS[difficulty] || 30, rnd);
    }
  };

  const separator = mode === 'code' ? '\n\n' : ' ';

  return {
    lang: textLang,
    initial: timed ? chunk(Math.max(240, duration * 7)) : passage(),
    more: timed ? () => separator + chunk(220) : null,
  };
}
