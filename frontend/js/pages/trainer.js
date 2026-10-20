// Страница тренажёра: выбор режима, поле печати, HUD, комбо, бонусы, клавиатура.
// Горячий путь (обработка клавиши) пишет в DOM точечно — без перерисовки текста.

import { store } from '../core/store.js';
import { api } from '../api/index.js';
import { fmtClock, fmtNum, pick, dayKey, esc } from '../core/utils.js';
import { MODES, DIFFICULTIES, DURATIONS, CODE_LANGS, LANGS, ERROR_MODES, isUnlocked, modeById } from '../data/modes.js';
import { TIPS } from '../data/texts.js';
import { keyForChar, isCyrillic, isLatin } from '../data/layouts.js';
import { createTextSource, normalizeCustomText } from '../game/textgen.js';
import { TypingSession, ST } from '../game/engine.js';
import { BonusManager } from '../game/bonuses.js';
import { COMBO_TIERS, comboTier, comboProgress, POINTS_PER_CHAR, xpFromScore, finishBonus } from '../game/scoring.js';
import { riskFor } from '../game/analysis.js';
import { icon } from '../ui/icons.js';
import { seg, onSeg } from '../ui/widgets.js';
import { VirtualKeyboard } from '../ui/keyboard.js';
import { fx } from '../ui/effects.js';
import { sound } from '../ui/sound.js';
import { toast } from '../ui/toast.js';
import { isModalOpen, openModal } from '../ui/modal.js';
import { navigate } from '../core/router.js';
import { showResults } from './trainer-results.js';

const FONT_SIZES = { s: '22px', m: '26px', l: '31px' };
const MIN_CHARS_TO_SAVE = 5;

export default {
  name: 'train',
  title: 'Тренировка',
  render(root, { query }) {
    return mountTrainer(root, query);
  },
};

function mountTrainer(root, query) {
  const settings = store.settings;
  const daily = query.mode === 'daily';
  const cfg = { ...settings.train };
  if (query.mode && MODES.some((m) => m.id === query.mode)) cfg.mode = query.mode;
  // Испытание дня — одинаковые правила для всех: русский текст целиком, строгий режим
  if (daily) Object.assign(cfg, { mode: 'daily', lang: 'ru', duration: 0, difficulty: 2, errorMode: 'strict' });

  root.innerHTML = `
    <div class="trainer">
      <header class="trainer-bar fade-on-type" data-bar></header>

      <section class="hud" aria-label="Показатели">
        <div class="hud-timer">
          <div class="hud-timer-value num" data-timer>0:00</div>
          <div class="hud-timer-label" data-timer-label>осталось</div>
        </div>
        <div class="hud-stats">
          <div class="hud-stat"><b class="num" data-cpm>0</b><span>зн/мин</span></div>
          <div class="hud-stat"><b class="num" data-wpm>0</b><span>сл/мин</span></div>
          <div class="hud-stat"><b class="num" data-acc>100</b><span>точность, %</span></div>
          <div class="hud-stat"><b class="num" data-err>0</b><span>ошибок</span></div>
        </div>
        <div class="hud-game">
          <div class="combo" data-combo data-tier="0">
            <div class="combo-mult" data-mult>×1</div>
            <div class="combo-body">
              <div class="combo-top"><span class="combo-name" data-combo-name>Без комбо</span><span class="combo-count"><b class="num" data-streak>0</b> подряд</span></div>
              <div class="combo-bar"><i data-combo-bar></i></div>
            </div>
          </div>
          <div class="score">
            <span class="score-label">Очки</span>
            <b class="score-value num" data-score>0</b>
          </div>
        </div>
      </section>

      <section class="typing-card" data-card>
        <div class="typing-progress"><i data-progress></i></div>
        <div class="bonus-rail" data-bonuses></div>
        <div class="typing-viewport" data-viewport>
          <div class="typing-lines" data-lines><span class="caret" data-caret></span></div>
        </div>
        <div class="typing-overlay" data-overlay></div>
        <div class="pop-layer" data-pops></div>
        <textarea class="typing-input" data-input rows="1" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" aria-label="Поле ввода тренажёра"></textarea>
      </section>

      <div class="trainer-under fade-on-type">
        <div class="tip" data-tip-line></div>
        <div class="shortcuts"><span><kbd>Esc</kbd> заново</span><span><kbd>Tab</kbd> новый текст</span></div>
      </div>

      <section class="kb-host" data-kb></section>
    </div>`;

  const q = (sel) => root.querySelector(sel);
  const el = {
    bar: q('[data-bar]'),
    timer: q('[data-timer]'),
    timerLabel: q('[data-timer-label]'),
    cpm: q('[data-cpm]'),
    wpm: q('[data-wpm]'),
    acc: q('[data-acc]'),
    err: q('[data-err]'),
    combo: q('[data-combo]'),
    mult: q('[data-mult]'),
    comboName: q('[data-combo-name]'),
    streak: q('[data-streak]'),
    comboBar: q('[data-combo-bar]'),
    score: q('[data-score]'),
    card: q('[data-card]'),
    progress: q('[data-progress]'),
    bonuses: q('[data-bonuses]'),
    viewport: q('[data-viewport]'),
    lines: q('[data-lines]'),
    caret: q('[data-caret]'),
    overlay: q('[data-overlay]'),
    pops: q('[data-pops]'),
    input: q('[data-input]'),
    tip: q('[data-tip-line]'),
    kb: q('[data-kb]'),
  };

  const kb = new VirtualKeyboard(el.kb, { lang: 'ru', hands: settings.showHands });

  // ---- состояние упражнения ----
  let source = null;
  let initialText = '';
  let session = null;
  let bonus = null;
  let spans = [];
  let score = 0;
  let xpScore = 0;
  let pointsAt = [];
  let xpPointsAt = [];
  let tier = 0;
  let lineH = 40;
  let scrollLine = 0;
  let wordRange = [0, 0];
  let curSpan = null;
  let ticker = 0;
  let lastStatsAt = 0;
  let layoutSlips = 0;
  let layoutHintAt = 0;
  let saving = false;
  let textLang = 'ru';

  // ---- панель настроек ----
  function level() {
    return store.progress?.level || 1;
  }

  function normalizeCfg() {
    if (daily) return;
    const lvl = level();
    const all = store.settings.unlockAll;
    if (!isUnlocked(modeById(cfg.mode), lvl, all)) cfg.mode = 'words';
    const diff = DIFFICULTIES.find((d) => d.id === Number(cfg.difficulty)) || DIFFICULTIES[0];
    if (!isUnlocked(diff, lvl, all)) cfg.difficulty = 1;
    cfg.difficulty = Number(cfg.difficulty);
    cfg.duration = Number(cfg.duration);
    if (!ERROR_MODES.some((m) => m.id === cfg.errorMode)) cfg.errorMode = 'strict';
  }

  function renderBar() {
    if (daily) {
      el.bar.innerHTML = `
        <div class="daily-banner">
          <div class="daily-star">${icon('star')}</div>
          <div class="daily-text">
            <b>Испытание дня · ${new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}</b>
            <span>Один текст для всех игроков. Лучший результат за сегодня попадёт в рейтинг испытания.</span>
          </div>
          <a class="btn btn-ghost btn-sm" href="#/leaderboard?metric=daily">${icon('trophy')}Рейтинг</a>
          <a class="btn btn-secondary btn-sm" href="#/train">Обычная тренировка</a>
        </div>`;
      return;
    }
    const lvl = level();
    const all = store.settings.unlockAll;
    const lockTip = (item) => `Откроется на ${item.unlock} уровне`;
    el.bar.innerHTML = `
      <div class="trainer-bar-row">
        ${seg('mode', MODES.map((m) => ({ id: m.id, label: m.title, icon: m.icon, locked: !isUnlocked(m, lvl, all), tip: isUnlocked(m, lvl, all) ? '' : lockTip(m) })), cfg.mode, { cls: 'seg-modes' })}
        <div class="spacer"></div>
        ${cfg.mode === 'code'
          ? seg('codeLang', CODE_LANGS.map((c) => ({ id: c.id, label: c.title })), cfg.codeLang, { cls: 'seg-sm' })
          : cfg.mode === 'custom'
            ? `<button class="btn btn-secondary btn-sm" type="button" data-edit-custom>${icon('edit')}Изменить текст</button>`
            : seg('lang', LANGS.map((l) => ({ id: l.id, label: l.short, icon: 'globe' })), cfg.lang, { cls: 'seg-sm' })}
      </div>
      <div class="trainer-bar-row">
        ${cfg.mode === 'custom' ? '' : seg('difficulty', DIFFICULTIES.map((d) => ({ id: d.id, label: d.title, locked: !isUnlocked(d, lvl, all), tip: isUnlocked(d, lvl, all) ? d.hint : lockTip(d) })), cfg.difficulty, { cls: 'seg-sm' })}
        ${seg('errorMode', ERROR_MODES.map((m) => ({ id: m.id, label: m.label, tip: m.hint })), cfg.errorMode, { cls: 'seg-sm' })}
        <div class="spacer"></div>
        ${seg('duration', DURATIONS.map((d) => ({ id: d.id, label: d.label, icon: d.id ? 'clock' : 'type' })), cfg.duration, { cls: 'seg-sm' })}
      </div>`;
  }

  const offSeg = onSeg(el.bar, (name, value, btn) => {
    if (btn.classList.contains('is-locked')) {
      toast({ title: 'Пока закрыто', text: btn.dataset.tip, type: 'info', icon: 'lock' });
      return;
    }
    cfg[name] = name === 'difficulty' || name === 'duration' ? Number(value) : value;
    store.updateSettings({ train: { ...cfg } });
    renderBar();
    if (cfg.mode === 'custom' && !normalizeCustomText(store.settings.customText)) {
      editCustomText();
      return;
    }
    setup(name !== 'errorMode');
  });

  el.bar.addEventListener('click', (e) => {
    if (e.target.closest('[data-edit-custom]')) editCustomText();
  });

  /** Окно «Свой текст»: вставить текст, увидеть, сколько останется после очистки, начать. */
  function editCustomText() {
    const modal = openModal(`
      <div class="custom-text">
        <div class="eyebrow">Свой текст</div>
        <h2 class="h2">Тренируйтесь на чём угодно</h2>
        <p class="muted">Статья, конспект, код, письмо — вставьте текст. Типографские кавычки и тире заменятся на обычные, а символы, которых нет на клавиатуре, уберутся.</p>
        <textarea class="input custom-area" data-custom-area maxlength="6000" placeholder="Вставьте сюда текст…">${esc(store.settings.customText || '')}</textarea>
        <div class="custom-foot">
          <span class="dim" data-custom-count></span>
          <div class="spacer"></div>
          <button class="btn btn-secondary" data-close>Отмена</button>
          <button class="btn btn-primary" data-custom-go>${icon('play')}Начать</button>
        </div>
      </div>`, { cls: 'modal-custom', onClose: () => focusInput() });
    const area = modal.el.querySelector('[data-custom-area]');
    const count = modal.el.querySelector('[data-custom-count]');
    const update = () => {
      const clean = normalizeCustomText(area.value);
      count.textContent = clean ? `${clean.length} символов к печати` : 'Текст пока пустой';
    };
    area.addEventListener('input', update);
    update();
    setTimeout(() => area.focus(), 50);
    modal.el.querySelector('[data-custom-go]').addEventListener('click', () => {
      if (!normalizeCustomText(area.value)) {
        area.focus();
        return;
      }
      store.updateSettings({ customText: area.value });
      cfg.mode = 'custom';
      store.updateSettings({ train: { ...cfg } });
      modal.close();
      renderBar();
      setup(true);
    });
  }

  // ---- отрисовка текста ----
  function appendChars(text, start) {
    const frag = document.createDocumentFragment();
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      const span = document.createElement('span');
      span.className = 'ch';
      if (ch === '\n') {
        span.className = 'ch nl';
        span.textContent = '↵';
        frag.append(span, document.createTextNode('\n'));
      } else {
        if (ch === ' ') span.className = 'ch sp';
        span.textContent = ch;
        frag.append(span);
      }
      spans[i] = span;
    }
    el.lines.insertBefore(frag, el.caret);
  }

  function measure() {
    lineH = parseFloat(getComputedStyle(el.lines).lineHeight) || 40;
    el.card.style.setProperty('--line-h', `${lineH}px`);
  }

  function placeCaret() {
    const span = spans[session.pos];
    let x;
    let y;
    if (span) {
      x = span.offsetLeft;
      y = span.offsetTop;
    } else {
      const last = spans[spans.length - 1];
      x = last.offsetLeft + last.offsetWidth;
      y = last.offsetTop;
    }
    el.caret.style.transform = `translate(${x}px, ${y}px)`;
    const line = Math.round(y / lineH);
    const target = Math.max(0, line - 1);
    if (target !== scrollLine) {
      scrollLine = target;
      el.lines.style.transform = `translateY(${-target * lineH}px)`;
    }
  }

  function markCurrent() {
    curSpan?.classList.remove('cur');
    curSpan = spans[session.pos] || null;
    curSpan?.classList.add('cur');

    // подсветка текущего слова
    const text = session.text;
    let s = session.pos;
    let e = session.pos;
    while (s > 0 && !/\s/.test(text[s - 1])) s--;
    while (e < text.length && !/\s/.test(text[e])) e++;
    if (s !== wordRange[0] || e !== wordRange[1]) {
      for (let i = wordRange[0]; i < wordRange[1]; i++) spans[i]?.classList.remove('in-word');
      for (let i = s; i < e; i++) spans[i]?.classList.add('in-word');
      wordRange = [s, e];
    }
  }

  // ---- HUD ----
  function resetHud() {
    el.cpm.textContent = '0';
    el.wpm.textContent = '0';
    el.acc.textContent = '100';
    el.err.textContent = '0';
    el.score.textContent = '0';
    el.bonuses.innerHTML = '';
    setTier(0, true);
    updateCombo();
    updateTimer(performance.now());
  }

  function setTier(next, silent = false) {
    tier = next;
    const t = COMBO_TIERS[next];
    el.combo.dataset.tier = next;
    el.mult.textContent = `×${t.mult}`;
    el.comboName.textContent = t.name;
    fx.embers(next === 3 && !silent ? el.combo : null);
    el.card.classList.toggle('is-onfire', next === 3);
  }

  function updateCombo() {
    el.streak.textContent = session ? session.streak : 0;
    el.comboBar.style.transform = `scaleX(${session ? comboProgress(session.streak) : 0})`;
  }

  function updateTimer(now) {
    if (!session) return;
    if (session.timed) {
      const left = session.remaining(now);
      el.timer.textContent = fmtClock(left / 1000);
      el.timerLabel.textContent = session.paused ? 'пауза' : 'осталось';
      el.progress.style.transform = `scaleX(${1 - left / session.timeLimitMs})`;
      el.timer.classList.toggle('is-low', session.started && left < 10000);
    } else {
      el.timer.textContent = fmtClock(session.elapsed(now) / 1000);
      el.timerLabel.textContent = session.paused ? 'пауза' : `${Math.floor((session.pos / session.text.length) * 100)}% текста`;
      el.progress.style.transform = `scaleX(${session.pos / session.text.length})`;
    }
  }

  function updateSpeed(now) {
    const cpm = session.cpm(now);
    el.cpm.textContent = Math.round(cpm);
    el.wpm.textContent = Math.round(cpm / 5);
  }

  function updateBonuses(now) {
    const list = bonus.list(now);
    const ids = list.map((b) => b.id).join(',');
    if (el.bonuses.dataset.ids !== ids) {
      el.bonuses.dataset.ids = ids;
      el.bonuses.innerHTML = list
        .map((b) => `<div class="bonus-pill" style="--bc:${b.color}" data-bonus="${b.id}">${icon(b.icon)}<span>${b.title}</span><i></i></div>`)
        .join('');
    }
    for (const b of list) {
      const pill = el.bonuses.querySelector(`[data-bonus="${b.id}"] i`);
      if (pill) pill.style.transform = `scaleX(${b.frac})`;
    }
  }

  // ---- всплывающие надписи ----
  function pop(html, cls = '') {
    const node = document.createElement('div');
    node.className = `pop ${cls}`;
    node.innerHTML = html;
    el.pops.appendChild(node);
    node.addEventListener('animationend', () => node.remove(), { once: true });
  }

  function overlay(kind) {
    el.overlay.dataset.kind = kind || '';
    el.overlay.classList.toggle('is-visible', !!kind);
    if (kind === 'start') {
      el.overlay.innerHTML = `
        <div class="overlay-inner">
          <div class="overlay-keys"><kbd>Ф</kbd><kbd>Ы</kbd><kbd>В</kbd><kbd>А</kbd><span></span><kbd>О</kbd><kbd>Л</kbd><kbd>Д</kbd><kbd>Ж</kbd></div>
          <div class="overlay-title">Начните печатать</div>
          <div class="overlay-text">Таймер запустится с первой клавиши</div>
        </div>`;
      if (textLang === 'en') {
        el.overlay.querySelector('.overlay-keys').innerHTML = '<kbd>A</kbd><kbd>S</kbd><kbd>D</kbd><kbd>F</kbd><span></span><kbd>J</kbd><kbd>K</kbd><kbd>L</kbd><kbd>;</kbd>';
      }
    } else if (kind === 'paused') {
      el.overlay.innerHTML = `
        <div class="overlay-inner">
          <div class="overlay-icon">${icon('pause')}</div>
          <div class="overlay-title">Пауза</div>
          <div class="overlay-text">Нажмите сюда или любую клавишу, чтобы продолжить</div>
        </div>`;
    } else if (kind === 'saving') {
      el.overlay.innerHTML = `<div class="overlay-inner"><div class="spinner"></div><div class="overlay-text">Сохраняем результат…</div></div>`;
    }
  }

  // ---- жизненный цикл упражнения ----
  function setup(newText = true) {
    clearInterval(ticker);
    session?.clear();
    fx.embers(null);
    document.body.classList.remove('is-typing');
    normalizeCfg();

    // Умной тренировке нужны предсказания модели: если их ещё нет — подгружаем и пересобираем текст
    if (cfg.mode === 'smart' && !store.insights && api.online) {
      api.insights().then(() => {
        if (cfg.mode === 'smart' && session && !session.started) setup(true);
      }).catch(() => {});
    }

    if (newText || !source) {
      source = createTextSource({
        ...cfg,
        custom: store.settings.customText,
        risk: cfg.mode === 'smart' ? riskFor(store, cfg.lang) : null,
        day: dayKey(),
      });
      initialText = source.initial || 'пустой текст';
    }
    textLang = source.lang;

    session = new TypingSession({ text: initialText, timeLimit: cfg.duration, more: source.more, errorMode: cfg.errorMode });
    session.on('extend', ({ start }) => appendChars(session.text, start));
    session.on('finish', onFinish);
    bonus = new BonusManager({ timed: cfg.duration > 0 });

    score = 0;
    xpScore = 0;
    pointsAt = [];
    xpPointsAt = [];
    scrollLine = 0;
    wordRange = [0, 0];
    curSpan = null;
    saving = false;
    spans = [];

    el.lines.replaceChildren(el.caret);
    el.lines.style.transform = 'translateY(0)';
    el.card.classList.toggle('is-code', cfg.mode === 'code');
    el.card.style.setProperty('--type-size', FONT_SIZES[store.settings.fontSize] || FONT_SIZES.m);
    appendChars(initialText, 0);
    measure();
    markCurrent();
    placeCaret();

    kb.setLang(textLang);
    kb.highlight(session.expected);
    el.kb.classList.toggle('hidden', !store.settings.showKeyboard);

    const tip = pick(TIPS);
    el.tip.innerHTML = `${icon(tip.icon)}<span>${tip.text}</span>`;

    resetHud();
    overlay('start');
    ticker = setInterval(onTick, 100);
    focusInput();
  }

  function begin() {
    const now = performance.now();
    bonus.start(now);
    document.body.classList.add('is-typing');
    overlay(null);
    sound.unlock();
  }

  function onTick() {
    if (!session || session.finished) return;
    const now = performance.now();
    session.tick(now);
    if (session.finished) return;
    updateTimer(now);
    if (session.started && !session.paused) {
      if (now - lastStatsAt > 400) {
        lastStatsAt = now;
        updateSpeed(now);
      }
      updateBonuses(now);
    }
  }

  function handleChar(ch, code) {
    if (!session || session.finished || saving || isModalOpen()) return;
    const expected = session.expected;
    if (expected === undefined) return;

    // Неверная раскладка: не штрафуем, а подсказываем переключиться
    if ((isCyrillic(expected) && isLatin(ch)) || (isLatin(expected) && isCyrillic(ch))) {
      layoutSlips++;
      if (code) kb.press(code, false);
      const now = Date.now();
      if (layoutSlips >= 2 && now - layoutHintAt > 4000) {
        layoutHintAt = now;
        toast({
          title: textLang === 'ru' ? 'Включите русскую раскладку' : 'Switch to English layout',
          text: 'Похоже, раскладка не совпадает с языком упражнения. Ошибки не засчитываются.',
          type: 'info',
          icon: 'globe',
        });
      }
      return;
    }
    layoutSlips = 0;

    if (!session.started) begin();
    else if (session.paused) overlay(null);

    const now = performance.now();
    const streakBefore = session.streak;
    const res = session.input(ch, now, { shield: bonus.hasShield(now) });
    if (!res) return;
    const keyCode = code || keyForChar(ch, textLang)?.code;

    if (res.ok) {
      const nextTier = comboTier(session.streak);
      const pts = Math.round(POINTS_PER_CHAR * COMBO_TIERS[nextTier].mult * bonus.scoreMult(now));
      score += pts;
      xpScore += pts * bonus.xpMult(now);
      pointsAt[res.from] = pts;
      xpPointsAt[res.from] = pts * bonus.xpMult(now);

      const span = spans[res.from];
      span.classList.remove('err');
      span.classList.add(session.states[res.from] === ST.FIXED ? 'fix' : 'ok');
      for (let i = res.from + 1; i < res.to; i++) spans[i]?.classList.add('auto');

      if (store.settings.sound) sound.key();
      if (fx.enabled()) {
        const r = span.getBoundingClientRect();
        fx.sparks(r.left + r.width / 2, r.top + r.height * 0.35, nextTier);
      }
      if (nextTier > tier) comboUp(nextTier);

      const got = bonus.roll(session.streak, now);
      if (got) onBonus(got);
    } else {
      const span = spans[res.pos];
      span.classList.add('err');
      span.dataset.typed = res.typed === ' ' ? '␣' : res.typed === '\n' ? '↵' : res.typed;
      for (let i = res.pos + 1; i < res.to; i++) spans[i]?.classList.add('auto');
      if (res.shielded) {
        bonus.consumeShield();
        pop(`${icon('shield')} Щит спас серию`, 'pop-ok');
      } else {
        if (streakBefore >= COMBO_TIERS[1].min) pop(`Серия ${streakBefore} прервана`, 'pop-err');
        if (tier !== 0) setTier(0);
      }
      if (store.settings.sound) sound.error();
      fx.shake(el.viewport, 5);
      el.card.classList.remove('flash-err');
      void el.card.offsetWidth;
      el.card.classList.add('flash-err');
    }

    if (keyCode) kb.press(keyCode, res.ok);
    if (session.finished) return;

    kb.highlight(session.expected);
    markCurrent();
    placeCaret();

    el.acc.textContent = Math.floor(session.accuracy());
    el.err.textContent = session.errors;
    el.score.textContent = fmtNum(score);
    updateCombo();
  }

  function handleBackspace() {
    if (!session || session.finished || saving || isModalOpen()) return;
    const res = session.backspace();
    if (!res) return;
    for (let i = res.to; i < res.from; i++) {
      spans[i]?.classList.remove('ok', 'fix', 'err', 'auto');
      if (i === res.to && (res.undone === ST.CORRECT || res.undone === ST.FIXED)) {
        score -= pointsAt[i] || 0;
        xpScore -= xpPointsAt[i] || 0;
        pointsAt[i] = 0;
        xpPointsAt[i] = 0;
      }
    }
    if (comboTier(session.streak) < tier) setTier(comboTier(session.streak));
    if (store.settings.sound) sound.key();
    kb.press('Backspace', true);
    kb.highlight(session.expected);
    markCurrent();
    placeCaret();
    el.acc.textContent = Math.floor(session.accuracy());
    el.score.textContent = fmtNum(score);
    updateCombo();
  }

  function comboUp(next) {
    setTier(next);
    const t = COMBO_TIERS[next];
    pop(`<b>×${t.mult}</b><span>${t.name}!</span>`, `pop-combo pop-tier-${next}`);
    if (store.settings.sound) sound.combo(next);
    const r = el.mult.getBoundingClientRect();
    fx.burst(r.left + r.width / 2, r.top + r.height / 2, { colors: fx.colorsForTier(next), count: 18 + next * 10, power: 4 + next });
    el.combo.classList.remove('is-bump');
    void el.combo.offsetWidth;
    el.combo.classList.add('is-bump');
  }

  function onBonus(b) {
    if (b.id === 'time') session.addTime(5000);
    if (store.settings.sound) sound.bonus();
    pop(`${icon(b.icon)}<span><b>${b.title}</b><small>${b.desc}</small></span>`, 'pop-bonus');
    const r = el.card.getBoundingClientRect();
    fx.burst(r.left + r.width / 2, r.top + 40, { count: 26, power: 5 });
    updateBonuses(performance.now());
  }

  async function onFinish(result) {
    clearInterval(ticker);
    fx.embers(null);
    document.body.classList.remove('is-typing');
    updateTimer(performance.now());
    updateSpeed(performance.now());

    if (result.chars < MIN_CHARS_TO_SAVE) {
      toast({ title: 'Тренировка не засчитана', text: 'Напечатано слишком мало символов.', type: 'info', icon: 'info' });
      setup(false);
      return;
    }

    // P = C·M + B: бонус за завершение и точность входит и в очки, и в опыт
    const fb = finishBonus(result);
    score += fb.total;
    xpScore += fb.total;
    const payload = {
      ...result,
      mode: cfg.mode,
      lang: textLang,
      codeLang: cfg.mode === 'code' ? cfg.codeLang : null,
      difficulty: cfg.mode === 'custom' ? 1 : cfg.difficulty,
      durationSetting: cfg.duration,
      score,
      bonuses: bonus.count,
      xp: xpFromScore(xpScore, result.accuracy),
      finishBonus: fb,
      challengeDay: daily ? dayKey() : null,
    };

    saving = true;
    overlay('saving');
    if (store.settings.sound) sound.finish();
    let report;
    try {
      report = await api.saveSession(payload);
    } catch (err) {
      console.error(err);
      toast({ title: 'Не удалось сохранить', text: err.message, type: 'err', icon: 'alert' });
      saving = false;
      setup(false);
      return;
    }
    overlay(null);
    renderBar();
    showResults({
      payload,
      report,
      cfg: { ...cfg },
      onNext: () => (daily ? navigate('/leaderboard?metric=daily') : setup(true)),
      onRepeat: () => setup(false),
    });
  }

  // ---- ввод ----
  function focusInput() {
    if (!isModalOpen()) el.input.focus({ preventScroll: true });
  }

  function onKeyDown(e) {
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      setup(false);
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      setup(true);
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'Backspace') {
      e.preventDefault();
      handleBackspace();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      handleChar('\n', 'Enter');
      return;
    }
    if (e.key.length === 1) {
      e.preventDefault();
      handleChar(e.key, e.code);
    }
  }

  function onInput() {
    // Мобильные клавиатуры и IME присылают текст через input, а не keydown
    const value = el.input.value;
    el.input.value = '';
    for (const ch of value) handleChar(ch === '\r' ? '\n' : ch, null);
  }

  function onBlur() {
    if (!session || session.finished || saving) return;
    if (session.started) {
      session.pause(performance.now());
      overlay('paused');
      document.body.classList.remove('is-typing');
      updateTimer(performance.now());
    }
  }

  function onFocus() {
    if (session?.paused) {
      document.body.classList.add('is-typing');
      overlay(null);
    }
  }

  // Набор с клавиатуры, когда фокус ушёл на другой элемент страницы
  function onDocKeyDown(e) {
    if (document.activeElement === el.input || isModalOpen()) return;
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (e.key === 'Tab' || e.key === 'Escape' || e.key.length === 1) {
      focusInput();
      onKeyDown(e);
    }
  }

  function onResize() {
    if (!session) return;
    measure();
    scrollLine = -1;
    placeCaret();
  }

  el.input.addEventListener('keydown', onKeyDown);
  el.input.addEventListener('input', onInput);
  el.input.addEventListener('blur', onBlur);
  el.input.addEventListener('focus', onFocus);
  el.card.addEventListener('mousedown', (e) => {
    e.preventDefault();
    focusInput();
  });
  el.card.addEventListener('touchend', () => focusInput());
  document.addEventListener('keydown', onDocKeyDown);
  window.addEventListener('resize', onResize);

  const offSettings = store.on('settings', (patch) => {
    if ('showKeyboard' in patch) el.kb.classList.toggle('hidden', !store.settings.showKeyboard);
    if ('showHands' in patch) {
      kb.hands = store.settings.showHands;
      kb.render();
    }
    if ('fontSize' in patch || 'theme' in patch) {
      el.card.style.setProperty('--type-size', FONT_SIZES[store.settings.fontSize] || FONT_SIZES.m);
      onResize();
    }
    if ('unlockAll' in patch) renderBar();
  });

  normalizeCfg();
  renderBar();
  setup(true);
  document.fonts?.ready.then(onResize);

  return () => {
    clearInterval(ticker);
    session?.clear();
    fx.embers(null);
    offSeg();
    offSettings();
    document.removeEventListener('keydown', onDocKeyDown);
    window.removeEventListener('resize', onResize);
    document.body.classList.remove('is-typing');
    kb.destroy();
  };
}

