// Движок упражнения: обработка ввода, таймер, метрики. Ничего не знает о DOM.
//
// Два режима ошибок:
//  - строгий (по умолчанию, по ТЗ): засчитываются только верные символы, при ошибке
//    курсор стоит на месте, пока не будет нажат нужный символ;
//  - свободный: при ошибке курсор идёт дальше, символ остаётся красным, Backspace
//    возвращает назад. Неисправленные ошибки к концу текста считаются пропущенными.
//
// Для анализа (сервер обучает на этом модель ошибок) пишется лог первой попытки
// на каждой позиции: время от старта, ожидаемый символ, была ли ошибка.

import { Emitter } from '../core/emitter.js';

export const ST = { PENDING: 0, CORRECT: 1, FIXED: 2, AUTO: 3, ERROR: 4 };

const EXTEND_AHEAD = 60;
const KEYLOG_LIMIT = 8000;

const statKey = (ch) => (ch === ' ' ? '␣' : ch === '\n' ? '↵' : ch.toLowerCase());
const isWordChar = (ch) => ch && !/\s/.test(ch);

function bump(map, key, idx) {
  const rec = map[key] || (map[key] = [0, 0]); // [ошибки, попытки]
  rec[idx]++;
}

export class TypingSession extends Emitter {
  /**
   * @param {{ text: string, timeLimit?: number, more?: (() => string) | null, errorMode?: 'strict'|'free' }} opts
   *   timeLimit — секунды; 0 — пока не закончится текст.
   */
  constructor({ text, timeLimit = 0, more = null, errorMode = 'strict' }) {
    super();
    this.text = text;
    this.timeLimitMs = timeLimit * 1000;
    this.more = more;
    this.free = errorMode === 'free';

    this.pos = 0;
    this.states = new Array(text.length).fill(ST.PENDING);
    this.hadError = new Array(text.length).fill(false);
    this.touchedPos = new Array(text.length).fill(false);
    this.logIdx = new Array(text.length).fill(-1);

    this.startedAt = 0;
    this.endedAt = 0;
    this.pausedAt = 0;

    this.keystrokes = 0;
    this.correctKeys = 0;
    this.errors = 0;
    this.typed = 0;
    this.streak = 0;
    this.maxStreak = 0;
    this.backspaces = 0;

    this.charStats = {};
    this.bigramStats = {};
    this.samples = [];
    this.lastSample = { t: 0, typed: 0, errors: 0 };
    this.keyT = [];
    this.keyCh = [];
    this.keyErr = [];
  }

  get started() { return this.startedAt > 0; }
  get finished() { return this.endedAt > 0; }
  get timed() { return this.timeLimitMs > 0; }
  get expected() { return this.text[this.pos]; }
  get paused() { return this.pausedAt > 0; }

  elapsed(now = performance.now()) {
    if (!this.started) return 0;
    const end = this.finished ? this.endedAt : this.pausedAt || now;
    return end - this.startedAt;
  }

  /** Пауза при потере фокуса: время не идёт, пока игрок не вернётся. */
  pause(now = performance.now()) {
    if (this.started && !this.finished && !this.pausedAt) this.pausedAt = now;
  }

  resume(now = performance.now()) {
    if (!this.pausedAt) return;
    this.startedAt += now - this.pausedAt;
    this.pausedAt = 0;
  }

  remaining(now = performance.now()) {
    return this.timed ? Math.max(0, this.timeLimitMs - this.elapsed(now)) : null;
  }

  cpm(now = performance.now()) {
    const ms = this.elapsed(now);
    return ms < 800 ? 0 : (this.typed / ms) * 60000;
  }

  accuracy() {
    return this.keystrokes ? (this.correctKeys / this.keystrokes) * 100 : 100;
  }

  /**
   * Обработать один символ.
   * → { ok:true, from, to } | { ok:false, pos, to, expected, typed, shielded } | null
   *   (в свободном режиме при ошибке to > pos — курсор ушёл дальше)
   */
  input(ch, now = performance.now(), { shield = false } = {}) {
    if (this.finished) return null;
    const pos = this.pos;
    const expected = this.text[pos];
    if (expected === undefined) return null;

    if (!this.started) {
      this.startedAt = now;
      this.emit('start');
    }
    this.resume(now);

    this.keystrokes++;
    const key = statKey(expected);
    const prev = this.text[pos - 1];
    const bigram = isWordChar(prev) && isWordChar(expected) ? (prev + expected).toLowerCase() : null;

    const first = !this.touchedPos[pos];
    if (first) {
      this.touchedPos[pos] = true;
      bump(this.charStats, key, 1);
      if (bigram) bump(this.bigramStats, bigram, 1);
      if (this.keyT.length < KEYLOG_LIMIT) {
        this.logIdx[pos] = this.keyT.length;
        this.keyT.push(Math.max(0, Math.round(now - this.startedAt)));
        this.keyCh.push(expected);
        this.keyErr.push(ch === expected ? 0 : 1);
      }
    }

    if (ch === expected) {
      this.correctKeys++;
      this.typed++;
      this.streak++;
      if (this.streak > this.maxStreak) this.maxStreak = this.streak;
      this.states[pos] = this.hadError[pos] ? ST.FIXED : ST.CORRECT;
      this.#advance(now);
      return { ok: true, from: pos, to: this.pos, expected };
    }

    this.errors++;
    const shielded = shield && this.streak > 0;
    if (!shielded) this.streak = 0;
    if (!this.hadError[pos]) {
      this.hadError[pos] = true;
      bump(this.charStats, key, 0);
      if (bigram) bump(this.bigramStats, bigram, 0);
    }
    if (this.free) {
      this.states[pos] = ST.ERROR;
      this.#advance(now);
    }
    return { ok: false, pos, to: this.pos, expected, typed: ch, shielded };
  }

  /** Backspace (только в свободном режиме). → { from, to, undone } | null */
  backspace() {
    if (!this.free || this.finished || this.pos === 0) return null;
    const from = this.pos;
    let p = this.pos - 1;
    while (p > 0 && this.states[p] === ST.AUTO) {
      this.states[p] = ST.PENDING;
      p--;
    }
    const undone = this.states[p];
    if (undone === ST.CORRECT || undone === ST.FIXED) {
      // Отменённое верное нажатие перестаёт считаться — так метрики остаются согласованными
      this.typed--;
      this.correctKeys--;
      this.keystrokes--;
      this.streak = Math.max(0, this.streak - 1);
    }
    this.states[p] = ST.PENDING;
    this.pos = p;
    this.backspaces++;
    return { from, to: p, undone };
  }

  #advance(now) {
    const wasNewline = this.text[this.pos] === '\n';
    this.pos++;

    // В коде отступ после Enter пропускается автоматически
    if (wasNewline) {
      while (this.text[this.pos] === ' ' || this.text[this.pos] === '\t') {
        this.states[this.pos] = ST.AUTO;
        this.pos++;
      }
    }

    if (this.more && this.text.length - this.pos < EXTEND_AHEAD) this.extend(this.more());
    if (this.pos >= this.text.length) this.finish(now);
  }

  extend(chunk) {
    const start = this.text.length;
    this.text += chunk;
    for (let i = 0; i < chunk.length; i++) {
      this.states.push(ST.PENDING);
      this.hadError.push(false);
      this.touchedPos.push(false);
      this.logIdx.push(-1);
    }
    this.emit('extend', { start, chunk });
  }

  addTime(ms) {
    if (this.timed) this.timeLimitMs += ms;
  }

  /** Вызывается по таймеру: снимает посекундные замеры и завершает по времени. */
  tick(now = performance.now()) {
    if (!this.started || this.finished || this.paused) return;
    const sec = Math.floor(this.elapsed(now) / 1000);
    while (this.lastSample.t < sec) this.#sample(this.lastSample.t + 1);
    if (this.timed && this.elapsed(now) >= this.timeLimitMs) this.finish(this.startedAt + this.timeLimitMs);
  }

  #sample(t) {
    const raw = Math.max(0, this.typed - this.lastSample.typed);
    const err = this.errors - this.lastSample.errors;
    this.samples.push({ t, cpm: Math.round((this.typed / t) * 60), raw: raw * 60, err });
    this.lastSample = { t, typed: this.typed, errors: this.errors };
  }

  finish(now = performance.now()) {
    if (this.finished || !this.started) return;
    this.endedAt = now;
    this.emit('finish', this.result());
  }

  /** Неисправленные ошибки (свободный режим): позиции, оставшиеся красными. */
  uncorrected() {
    let n = 0;
    for (let i = 0; i < this.pos; i++) if (this.states[i] === ST.ERROR) n++;
    return n;
  }

  result() {
    const ms = this.elapsed();
    const minutes = Math.max(ms, 1000) / 60000;
    const cpm = this.typed / minutes;
    const minStreak = Math.ceil(this.typed / (this.errors + 1));
    return {
      duration: Math.round(ms / 100) / 10,
      cpm: Math.round(cpm),
      wpm: Math.round(cpm / 5),
      accuracy: Math.round(this.accuracy() * 10) / 10,
      errors: this.errors,
      chars: this.typed,
      keystrokes: this.keystrokes,
      maxStreak: Math.min(Math.max(this.maxStreak, minStreak), this.typed),
      errorMode: this.free ? 'free' : 'strict',
      uncorrected: this.uncorrected(),
      backspaces: this.backspaces,
      charStats: this.charStats,
      bigramStats: this.bigramStats,
      samples: this.samples,
      keylog: { t: this.keyT, ch: this.keyCh.join(''), err: this.keyErr.join('') },
    };
  }
}
