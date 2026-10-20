// Виртуальная клавиатура: подсветка следующей клавиши и пальца, анимация нажатий,
// режим тепловой карты ошибок (для статистики).

import { ROWS, LAYOUTS, SPECIAL_LABELS, FINGER_OF, FINGERS, HOME_KEYS, BUMP_KEYS, keyForChar } from '../data/layouts.js';
import { esc } from '../core/utils.js';

const isLetter = (ch) => /\p{L}/u.test(ch);

function handGroup(prefix) {
  // Геометрия левой руки; правая получается зеркалированием.
  return `
    <rect class="hand-palm" x="22" y="92" width="142" height="72" rx="30"/>
    <rect class="hand-f" data-finger="${prefix}p" x="22" y="54" width="28" height="70" rx="14" transform="rotate(-8 36 124)"/>
    <rect class="hand-f" data-finger="${prefix}r" x="56" y="26" width="30" height="92" rx="15" transform="rotate(-3 71 118)"/>
    <rect class="hand-f" data-finger="${prefix}m" x="92" y="15" width="30" height="100" rx="15"/>
    <rect class="hand-f" data-finger="${prefix}i" x="128" y="30" width="30" height="88" rx="15" transform="rotate(4 143 118)"/>
    <rect class="hand-f" data-finger="th" x="150" y="98" width="28" height="62" rx="14" transform="rotate(50 164 160)"/>`;
}

function handsSvg() {
  return `<svg class="hands" viewBox="0 0 470 172" aria-hidden="true">
    <g>${handGroup('l')}</g>
    <g transform="translate(470 0) scale(-1 1)">${handGroup('r')}</g>
  </svg>`;
}

export class VirtualKeyboard {
  /**
   * @param {HTMLElement} host
   * @param {{ lang?: 'ru'|'en', hands?: boolean, heatmap?: boolean }} opts
   */
  constructor(host, { lang = 'ru', hands = true, heatmap = false } = {}) {
    this.host = host;
    this.lang = lang;
    this.hands = hands;
    this.heatmapMode = heatmap;
    this.keys = new Map();
    this.lit = [];
    this.pressTimers = new Map();
    this.lastChar = null;
    this.render();
  }

  render() {
    const rows = ROWS.map((row) => `<div class="kb-row">${row.map(([code, w = 1]) => this.#keyHtml(code, w)).join('')}</div>`).join('');
    this.host.innerHTML = `
      <div class="kb-wrap ${this.heatmapMode ? 'is-heatmap' : ''}">
        <div class="kb" data-lang="${this.lang}">${rows}</div>
        ${this.hands ? `
          <div class="kb-hint">
            <div class="kb-hands">${handsSvg()}</div>
            <div class="kb-finger" aria-live="polite"><span class="kb-finger-dot"></span><span class="kb-finger-text">Положите пальцы на основной ряд</span></div>
          </div>` : ''}
      </div>`;
    this.keys.clear();
    this.host.querySelectorAll('.key').forEach((el) => this.keys.set(el.dataset.code, el));
    this.handsEl = this.host.querySelector('.hands');
    this.fingerEl = this.host.querySelector('.kb-finger');
    this.lit = [];
    if (this.lastChar != null) this.highlight(this.lastChar);
  }

  #keyHtml(code, w) {
    const pair = LAYOUTS[this.lang][code];
    const finger = FINGER_OF[code] || 'th';
    const cls = ['key', `f-${finger}`];
    let inner;
    if (pair) {
      const [lo, hi] = pair;
      if (isLetter(lo)) {
        inner = `<span class="key-main">${esc(hi)}</span>`;
      } else {
        inner = `<span class="key-alt">${esc(hi)}</span><span class="key-main">${esc(lo)}</span>`;
        cls.push('is-dual');
      }
    } else {
      inner = `<span class="key-label">${esc(SPECIAL_LABELS[code] ?? '')}</span>`;
      cls.push('is-special');
    }
    if (HOME_KEYS.includes(code)) cls.push('is-home');
    if (BUMP_KEYS.includes(code)) cls.push('is-bump');
    if (code === 'Space') cls.push('is-space');
    return `<div class="${cls.join(' ')}" data-code="${code}" style="grid-column: span ${Math.round(w * 4)}">${inner}</div>`;
  }

  setLang(lang) {
    if (lang === this.lang) return;
    this.lang = lang;
    this.render();
  }

  /** Подсветить клавишу (и Shift) для следующего символа. null — снять подсветку. */
  highlight(ch) {
    this.lastChar = ch;
    for (const el of this.lit) el.classList.remove('is-next', 'is-shift');
    this.lit = [];
    // В своём тексте бывают слова на другой раскладке — ищем клавишу и там
    const info = ch == null ? null : keyForChar(ch, this.lang) || keyForChar(ch, this.lang === 'ru' ? 'en' : 'ru');
    if (!info) {
      this.#setFinger(null);
      return;
    }
    const el = this.keys.get(info.code);
    if (el) {
      el.classList.add('is-next');
      this.lit.push(el);
    }
    if (info.shiftCode) {
      const sh = this.keys.get(info.shiftCode);
      sh?.classList.add('is-next', 'is-shift');
      if (sh) this.lit.push(sh);
    }
    this.#setFinger(info.finger, info.shiftCode ? FINGER_OF[info.shiftCode] : null, ch);
  }

  #setFinger(finger, extra = null, ch = '') {
    if (this.handsEl) {
      this.handsEl.querySelectorAll('.hand-f').forEach((f) => {
        const on = f.dataset.finger === finger || f.dataset.finger === extra;
        f.classList.toggle('is-active', on);
      });
    }
    if (!this.fingerEl) return;
    const text = this.fingerEl.querySelector('.kb-finger-text');
    const dot = this.fingerEl.querySelector('.kb-finger-dot');
    if (!finger) {
      text.textContent = 'Положите пальцы на основной ряд';
      dot.style.color = 'var(--text-4)';
      return;
    }
    const f = FINGERS[finger];
    const keyName = ch === ' ' ? 'пробел' : ch === '\n' ? 'Enter' : `«${ch}»`;
    text.innerHTML = `<b>${esc(f.name)}</b> · ${esc(keyName)}${extra ? ' + Shift' : ''}`;
    dot.style.color = f.color;
  }

  /** Анимация физического нажатия: ok — верно, иначе — красная вспышка. */
  press(code, ok) {
    const el = this.keys.get(code);
    if (!el) return;
    const cls = ok ? 'is-press' : 'is-wrong';
    el.classList.remove('is-press', 'is-wrong');
    el.classList.add(cls);
    clearTimeout(this.pressTimers.get(code));
    this.pressTimers.set(code, setTimeout(() => el.classList.remove(cls), ok ? 140 : 320));
  }

  /** Тепловая карта: rates — { символ: { rate, attempts } } в нижнем регистре. */
  heatmap(rates) {
    const max = Math.max(0.05, ...Object.values(rates).map((r) => r.rate));
    for (const [code, el] of this.keys) {
      const pair = LAYOUTS[this.lang][code];
      const ch = code === 'Space' ? '␣' : code === 'Enter' ? '↵' : pair?.[0];
      const rec = ch && rates[ch];
      if (!rec) {
        el.style.removeProperty('--heat');
        el.removeAttribute('data-tip');
        el.classList.remove('has-heat');
        continue;
      }
      const pct = Math.round(Math.min(1, rec.rate / max) * 80);
      el.style.setProperty('--heat', `${pct}%`);
      el.classList.add('has-heat');
      el.dataset.tip = typeof rec.attempts === 'number'
        ? `${(rec.rate * 100).toFixed(1).replace('.', ',')}% ошибок · ${rec.attempts} нажатий`
        : `Модель: ${(rec.rate * 100).toFixed(1).replace('.', ',')}% риск ошибки`;
    }
  }

  destroy() {
    this.pressTimers.forEach(clearTimeout);
    this.host.innerHTML = '';
  }
}
