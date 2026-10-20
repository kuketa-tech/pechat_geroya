// Окно итогов упражнения: оценка, скорость, опыт с анимацией уровня, награды, трудные символы.

import { store } from '../core/store.js';
import { esc, fmtNum, fmtDuration, animateNumber, plural } from '../core/utils.js';
import { modeById, rankFor, LANGS, CODE_LANGS } from '../data/modes.js';
import { grade, GRADE_TEXT, levelProgress } from '../game/scoring.js';
import { hardest, sessionBreakdown } from '../game/analysis.js';
import { icon } from '../ui/icons.js';
import { badge } from '../ui/widgets.js';
import { openModal } from '../ui/modal.js';
import { lineChart } from '../ui/charts.js';
import { fx } from '../ui/effects.js';
import { sound } from '../ui/sound.js';
import { achievementToast } from '../ui/toast.js';
import { navigate } from '../core/router.js';

const KIND_ICON = { base: 'keyboard', quest: 'target', ach: 'award' };

export function showResults({ payload, report, cfg, onNext, onRepeat }) {
  const g = grade(payload.cpm, payload.accuracy);
  const mode = modeById(cfg.mode);
  const sub = cfg.mode === 'code'
    ? CODE_LANGS.find((c) => c.id === cfg.codeLang)?.title
    : LANGS.find((l) => l.id === payload.lang)?.short;
  const weak = hardest(payload.charStats, { limit: 6, minAttempts: 1 });
  const before = levelProgress(report.xpBefore);
  const after = levelProgress(report.xpAfter);
  const leveled = report.levelAfter > report.levelBefore;
  const bd = sessionBreakdown(payload, payload.lang);
  const maxThird = Math.max(0.02, ...bd.thirds);
  const ROW_LABELS = ['Цифры', 'Верхний', 'Основной', 'Нижний', 'Пробел'];
  const fb = payload.finishBonus;

  const html = `
    <div class="results">
      <div class="results-head">
        <div class="grade grade-${g}"><span>${g}</span></div>
        <div class="results-title">
          <div class="eyebrow">${esc(mode.title)} · ${esc(sub || '')} · ${fmtDuration(payload.duration)}</div>
          <h2 class="h2">${esc(GRADE_TEXT[g])}</h2>
        </div>
      </div>

      <div class="results-main">
        <div class="res-big">
          <div class="res-num num" data-count="${payload.cpm}">0</div>
          <div class="res-unit">знаков в минуту</div>
          ${report.isBestCpm ? `<div class="chip chip-accent res-record">${icon('crown')}Новый рекорд</div>` : ''}
        </div>
        <div class="res-big">
          <div class="res-num num" data-count="${payload.wpm}">0</div>
          <div class="res-unit">слов в минуту</div>
        </div>
        <div class="res-big">
          <div class="res-num num" data-count="${payload.accuracy}" data-decimals="1">0</div>
          <div class="res-unit">точность, %</div>
        </div>
      </div>

      <div class="results-grid">
        <div class="res-cell">${icon('x')}<b class="num">${payload.errors}</b><span>${plural(payload.errors, 'ошибка', 'ошибки', 'ошибок')}</span></div>
        <div class="res-cell">${icon('flame')}<b class="num">${payload.maxStreak}</b><span>макс. серия</span></div>
        <div class="res-cell">${icon('star')}<b class="num">${fmtNum(payload.score)}</b><span>очков</span></div>
        <div class="res-cell">${icon('gift')}<b class="num">${payload.bonuses}</b><span>${plural(payload.bonuses, 'бонус', 'бонуса', 'бонусов')}</span></div>
      </div>

      ${fb?.parts?.length ? `<div class="xp-list bonus-list">${fb.parts.map((b) => `<span class="xp-item xp-quest">${icon('gift')}<span>${esc(b.label)}</span><b>+${b.points} очков</b></span>`).join('')}</div>` : ''}

      ${report.rhythm?.flagged ? `<div class="res-flag">${icon('shield')}<span>Результат сохранён, но не попадёт в рейтинг: ${esc(report.rhythm.reason)}. Так AI-детектор отсекает автоматический ввод.</span></div>` : ''}
      ${report.challenge ? `<div class="res-flag res-flag-ok">${icon('star')}<span>Засчитано в испытание дня — загляните в рейтинг испытания.</span></div>` : ''}

      <div class="res-analytics">
        <div class="res-panel">
          <div class="res-panel-title">Ошибки по ходу</div>
          <div class="thirds">
            ${bd.thirds.map((r, i) => `<div class="third"><b>${(r * 100).toFixed(1).replace('.', ',')}%</b><i style="--h:${Math.max(4, (r / maxThird) * 46)}px"></i><span>${['начало', 'середина', 'конец'][i]}</span></div>`).join('')}
          </div>
        </div>
        <div class="res-panel">
          <div class="res-panel-title">Ошибки</div>
          <div class="mini-rows">
            <div><span>Ошибочных нажатий</span><b>${payload.errors}</b></div>
            <div><span>${payload.errorMode === 'free' ? 'Исправлено' : 'Исправлено сразу'}</span><b>${Math.max(0, bd.firstTryErrors - (payload.uncorrected || 0))}</b></div>
            ${payload.errorMode === 'free' ? `<div><span>Пропущено (не исправлено)</span><b>${payload.uncorrected || 0}</b></div><div><span>Нажатий Backspace</span><b>${payload.backspaces || 0}</b></div>` : ''}
            ${bd.reactionMs ? `<div><span>Время на символ</span><b>${bd.reactionMs} мс</b></div>` : ''}
          </div>
        </div>
        <div class="res-panel">
          <div class="res-panel-title">Ошибки по рядам</div>
          <div class="mini-rows">
            ${[0, 1, 2, 3].map((r) => `<div><span>${ROW_LABELS[r]}</span><b>${bd.rows[r]}</b></div>`).join('')}
          </div>
        </div>
      </div>

      ${payload.samples.length > 2 ? `
        <div class="results-chart">
          <div class="results-chart-head"><span class="dim">Скорость по ходу упражнения</span><span class="legend"><i style="background:var(--accent)"></i>средняя <i style="background:var(--info)"></i>мгновенная</span></div>
          <div class="chart-box chart-sm"><canvas data-chart></canvas></div>
        </div>` : ''}

      <div class="results-xp ${leveled ? 'is-levelup' : ''}">
        <div class="results-xp-head">
          <div class="row">
            <span class="lvl-badge" data-lvl>Ур. ${before.level}</span>
            <span class="dim" data-rank>${esc(rankFor(before.level).title)}</span>
          </div>
          <div class="xp-gain">+<span data-xp>0</span> XP</div>
        </div>
        <div class="xpbar bar-lg"><i data-xpbar style="--p:${before.pct}%"></i></div>
        <div class="levelup-banner" data-levelup>${icon('sparkles')}<span>Новый уровень <b>${report.levelAfter}</b> · ${esc(rankFor(report.levelAfter).title)}</span></div>
        <ul class="xp-list">
          ${report.breakdown.map((b) => `<li class="xp-item xp-${b.kind}">${icon(KIND_ICON[b.kind])}<span>${esc(b.label)}</span><b>+${b.xp}</b></li>`).join('')}
        </ul>
      </div>

      ${report.newAchievements.length ? `
        <div class="results-section">
          <div class="results-section-title">${icon('award')}Новые достижения</div>
          <div class="res-ach">
            ${report.newAchievements.map((a) => `
              <div class="res-ach-item" style="--rar: var(--rar-${a.rarity})">
                ${badge(a, true, 48)}
                <div><b>${esc(a.title)}</b><span>${esc(a.desc)}</span></div>
              </div>`).join('')}
          </div>
        </div>` : ''}

      ${weak.length ? `
        <div class="results-section">
          <div class="results-section-title">${icon('target')}Над чем поработать</div>
          <div class="weak-chips">
            ${weak.map((w) => `<span class="weak-chip"><kbd>${esc(w.ch)}</kbd><span>${w.errors} из ${w.attempts}</span></span>`).join('')}
          </div>
        </div>` : ''}

      <div class="results-actions">
        <button class="btn btn-ghost" data-act="stats">${icon('chart')}Статистика</button>
        <div class="spacer"></div>
        <button class="btn btn-secondary" data-act="repeat">${icon('rotate')}Повторить<span class="kbd">Esc</span></button>
        <button class="btn btn-primary" data-act="next">Дальше<span class="kbd">Enter</span></button>
      </div>
    </div>`;

  let action = 'next';
  const modal = openModal(html, {
    cls: 'modal-results',
    onClose: () => {
      window.removeEventListener('keydown', onKey, true);
      chart?.destroy();
      if (action === 'stats') navigate('/stats');
      else if (action === 'repeat') onRepeat();
      else onNext();
    },
  });

  function close(act) {
    action = act;
    modal.close();
  }

  function onKey(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      close('next');
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close('repeat');
    }
  }
  window.addEventListener('keydown', onKey, true);

  modal.el.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (btn) close(btn.dataset.act);
  });

  // Анимации чисел
  modal.el.querySelectorAll('[data-count]').forEach((node, i) => {
    const decimals = Number(node.dataset.decimals || 0);
    const fmt = (v) => (decimals ? v.toFixed(decimals).replace('.', ',') : fmtNum(v));
    setTimeout(() => animateNumber(node, Number(node.dataset.count), { duration: 900, format: fmt }), 120 + i * 90);
  });

  // График скорости
  let chart = null;
  const canvas = modal.el.querySelector('[data-chart]');
  if (canvas) {
    const raw = payload.samples.map((s) => s.raw);
    const smooth = raw.map((_, i) => Math.round((raw[i - 1] ?? raw[i]) * 0.25 + raw[i] * 0.5 + (raw[i + 1] ?? raw[i]) * 0.25));
    chart = lineChart(canvas, {
      labels: payload.samples.map((s) => `${s.t} с`),
      datasets: [
        { label: 'Мгновенная', data: smooth, color: 'info', width: 1.5, dash: [4, 4] },
        { label: 'Средняя', data: payload.samples.map((s) => s.cpm), color: 'accent', fill: true },
      ],
      unit: ' зн/мин',
      suggestedMin: 0,
    });
  }

  // Опыт и уровень
  const xpEl = modal.el.querySelector('[data-xp]');
  const bar = modal.el.querySelector('[data-xpbar]');
  setTimeout(() => {
    animateNumber(xpEl, report.xpGained, { duration: 1100 });
    if (leveled) {
      bar.style.setProperty('--p', '100%');
      setTimeout(() => {
        bar.style.transition = 'none';
        bar.style.setProperty('--p', '0%');
        void bar.offsetWidth;
        bar.style.transition = '';
        bar.style.setProperty('--p', `${after.pct}%`);
        modal.el.querySelector('[data-lvl]').textContent = `Ур. ${after.level}`;
        modal.el.querySelector('[data-rank]').textContent = rankFor(after.level).title;
        modal.el.querySelector('[data-levelup]').classList.add('is-visible');
        fx.confetti(160);
        if (store.settings.sound) sound.levelUp();
      }, 950);
    } else {
      bar.style.setProperty('--p', `${after.pct}%`);
    }
  }, 450);

  // Достижения — ещё и тостами, со звуком
  report.newAchievements.forEach((a, i) => {
    setTimeout(() => {
      achievementToast(a);
      if (store.settings.sound) sound.achievement();
      if (a.rarity === 'epic' || a.rarity === 'legend') fx.confetti(90);
    }, 1400 + i * 700);
  });
}
