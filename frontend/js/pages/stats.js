// Статистика: KPI за период, графики скорости и точности, тепловая карта ошибок,
// трудные символы и сочетания, календарь активности, история тренировок.

import { store } from '../core/store.js';
import { api } from '../api/index.js';
import { esc, fmtNum, fmtPct, fmtDuration, fmtDayShort, daysBetween, dayKey } from '../core/utils.js';
import { modeById, CODE_LANGS } from '../data/modes.js';
import { historyInPeriod, summary, dailySeries, activityGrid, hardest, errorRates } from '../game/analysis.js';
import { icon } from '../ui/icons.js';
import { seg, onSeg, setSegValue, statTile, emptyState } from '../ui/widgets.js';
import { lineChart, chartsAvailable } from '../ui/charts.js';
import { VirtualKeyboard } from '../ui/keyboard.js';

const PERIOD_OPTS = [
  { id: 'week', label: '7 дней' },
  { id: 'month', label: '30 дней' },
  { id: 'all', label: 'Всё время' },
];

export default {
  name: 'stats',
  title: 'Статистика',
  render(root) {
    const state = { period: 'month', lang: mostUsedLang() };
    let charts = [];
    let kb = null;

    const destroy = () => {
      charts.forEach((c) => c?.destroy());
      charts = [];
      kb?.destroy();
      kb = null;
    };

    const draw = () => {
      destroy();
      ({ charts, kb } = paint(root, state));
    };

    const offSeg = onSeg(root, (name, value, btn, group) => {
      state[name] = value;
      setSegValue(group, value);
      draw();
    });

    root.addEventListener('click', async (e) => {
      if (e.target.closest('[data-seed]')) {
        await api.seedDemo();
        draw();
      }
    });

    draw();
    return () => {
      offSeg();
      destroy();
    };
  },
};

const TREND = {
  worse: { cls: 'is-worse', mark: '▲', tip: 'За последнюю неделю ошибок стало больше' },
  better: { cls: 'is-better', mark: '▼', tip: 'За последнюю неделю ошибок стало меньше' },
};

function trendMark(r) {
  const t = TREND[r.trend];
  return t ? ` <span class="weak-trend ${t.cls}" title="${t.tip}">${t.mark}</span>` : '';
}

function mostUsedLang() {
  const l = store.progress.totals.langs;
  return (l.en || 0) > (l.ru || 0) ? 'en' : 'ru';
}

function chartDays(p, period) {
  if (period === 'week') return 7;
  if (period === 'month') return 30;
  const first = p.history[p.history.length - 1];
  if (!first) return 14;
  return Math.min(120, Math.max(14, daysBetween(dayKey(first.ts), dayKey()) + 1));
}

function paint(root, state) {
  const p = store.progress;
  const list = historyInPeriod(p, state.period);
  const s = summary(list);
  const prevList = state.period === 'all' ? [] : historyInPeriod(p, state.period === 'week' ? 'month' : 'all').filter((h) => !list.includes(h));
  const prev = summary(prevList);
  const days = chartDays(p, state.period);
  const series = dailySeries(p, days);
  const labels = series.keys.map((k) => fmtDayShort(new Date(`${k}T12:00:00`).getTime()));
  const charStats = p.charStats[state.lang] || {};
  // Разбор считает сервер (давность, сглаживание, тренды); без бэкенда — локальный hardest()
  const server = p.analysis?.[state.lang];
  const weakChars = (server?.chars ?? hardest(charStats, { limit: 8 })).filter((r) => r.ch !== '␣').slice(0, 8);
  const weakBigrams = (server?.bigrams ?? hardest(p.bigramStats[state.lang] || {}, { limit: 8, minAttempts: 4 })).slice(0, 8);
  const weeks = 26;
  const cells = activityGrid(p, weeks);

  const delta = (cur, before, suffix = '') => {
    if (!prevList.length || !before || !cur) return '';
    const d = cur - before;
    if (Math.abs(d) < 0.5) return '';
    return `<span class="stat-delta ${d > 0 ? 'up' : 'down'}">${d > 0 ? '▲' : '▼'} ${fmtNum(Math.abs(d))}${suffix}</span>`;
  };

  const hasData = p.history.length > 0;

  root.innerHTML = `
    <header class="page-head">
      <div>
        <div class="eyebrow">Прогресс</div>
        <h1 class="h1">Статистика</h1>
        <p class="muted">Как растёт скорость, падает число ошибок и какие клавиши даются тяжелее всего.</p>
      </div>
      ${seg('period', PERIOD_OPTS, state.period)}
    </header>

    ${!hasData ? `
      <div class="card card-pad">
        ${emptyState({
          ic: 'chart',
          title: 'Статистики пока нет',
          text: 'Пройдите пару тренировок — здесь появятся графики скорости, точность и разбор трудных букв.',
          action: `<div class="row wrap" style="justify-content:center"><a class="btn btn-primary" href="#/train">${icon('play')}Начать тренировку</a><button class="btn btn-ghost" data-seed>${icon('database')}Заполнить демо-данными</button></div>`,
        })}
      </div>` : `

    <div class="kpi-grid">
      ${statTile({ label: 'Тренировок', value: fmtNum(s.sessions), ic: 'rotate', sub: delta(s.sessions, prev.sessions) })}
      ${statTile({ label: 'Время практики', value: fmtDuration(s.timeSec), ic: 'clock' })}
      ${statTile({ label: 'Средняя скорость', value: fmtNum(s.avgCpm), unit: 'зн/мин', ic: 'zap', sub: `${Math.round(s.avgCpm / 5)} сл/мин ${delta(s.avgCpm, prev.avgCpm)}` })}
      ${statTile({ label: 'Лучшая скорость', value: fmtNum(s.bestCpm), unit: 'зн/мин', ic: 'crown', sub: `${Math.round(s.bestCpm / 5)} сл/мин` })}
      ${statTile({ label: 'Средняя точность', value: fmtPct(s.avgAcc), ic: 'target', sub: delta(s.avgAcc, prev.avgAcc, ' п.п.') })}
      ${statTile({ label: 'Символов', value: fmtNum(s.chars), ic: 'keyboard', sub: `${fmtNum(s.errors)} ошибок` })}
    </div>

    <div class="stats-row">
      <section class="card card-pad span-2">
        <div class="card-head">
          <div class="card-title">${icon('zap')}Динамика скорости</div>
          <span class="legend"><i style="background:var(--accent)"></i>средняя за день <i style="background:var(--accent-2)"></i>лучшая</span>
        </div>
        <div class="chart-box">${chartsAvailable() ? '<canvas data-chart="speed"></canvas>' : '<div class="chart-fallback">Графики недоступны: не загрузился Chart.js</div>'}</div>
      </section>
      <section class="card card-pad">
        <div class="card-head">
          <div class="card-title">${icon('target')}Точность</div>
          <span class="dim">% по дням</span>
        </div>
        <div class="chart-box"><canvas data-chart="acc"></canvas></div>
      </section>
    </div>

    <div class="stats-row">
      <section class="card card-pad span-2">
        <div class="card-head">
          <div class="card-title">${icon('keyboard')}Карта ошибок</div>
          ${seg('lang', [{ id: 'ru', label: 'RU' }, { id: 'en', label: 'EN' }], state.lang, { cls: 'seg-sm' })}
        </div>
        <div data-heatmap></div>
        <div class="heat-legend"><span class="dim">меньше ошибок</span><i></i><span class="dim">больше</span></div>
      </section>
      <section class="card card-pad">
        <div class="card-head">
          <div class="card-title">${icon('alert')}Трудные символы</div>
        </div>
        ${server?.focus && weakChars.length ? `<p class="weak-hint dim">Сейчас в фокусе <b class="weak-focus">${esc(server.focus)}</b> — свежие ошибки весят больше старых</p>` : ''}
        ${weakChars.length ? `<ul class="weak-list">
          ${weakChars.map((r) => `
            <li>
              <kbd class="weak-key">${esc(r.ch)}</kbd>
              <div class="weak-body">
                <div class="weak-top"><b>${fmtPct(r.rate * 100)}${trendMark(r)}</b><span class="dim">${r.errors} из ${fmtNum(r.attempts)}</span></div>
                <div class="bar bar-err"><i style="--p:${Math.min(100, r.rate * 100 * 4)}%"></i></div>
              </div>
            </li>`).join('')}
        </ul>` : emptyState({ ic: 'check', title: 'Нет данных', text: 'Для этой раскладки ещё мало нажатий.' })}
      </section>
    </div>

    <div class="stats-row">
      <section class="card card-pad span-2">
        <div class="card-head">
          <div class="card-title">${icon('calendar')}Активность</div>
          <span class="dim">${fmtNum(Object.keys(p.days).length)} дн. с тренировками</span>
        </div>
        <div class="activity">
          <div class="activity-days"><span>Пн</span><span></span><span>Ср</span><span></span><span>Пт</span><span></span><span>Вс</span></div>
          <div class="activity-grid" style="--weeks:${weeks}">
            ${cells.map((c) => {
              const lvl = c.future ? -1 : c.minutes === 0 ? 0 : c.minutes < 5 ? 1 : c.minutes < 10 ? 2 : c.minutes < 20 ? 3 : 4;
              return `<i class="act-cell lvl-${lvl}" ${c.future ? '' : `data-tip="${fmtDayShort(c.ts)}: ${c.sessions ? `${c.sessions} трен., ${Math.round(c.minutes)} мин` : 'нет тренировок'}"`}></i>`;
            }).join('')}
          </div>
        </div>
        <div class="activity-legend"><span class="dim">меньше</span><i class="act-cell lvl-0"></i><i class="act-cell lvl-1"></i><i class="act-cell lvl-2"></i><i class="act-cell lvl-3"></i><i class="act-cell lvl-4"></i><span class="dim">больше</span></div>
      </section>
      <section class="card card-pad">
        <div class="card-head">
          <div class="card-title">${icon('layers')}Трудные сочетания</div>
        </div>
        ${weakBigrams.length ? `<div class="bigrams">
          ${weakBigrams.map((r) => `<div class="bigram ${r.transition ? 'is-transition' : ''}" ${r.transition ? `title="Ошибаетесь в переходе: в ${String(r.lift).replace('.', ',')} раза чаще, чем на самой букве «${esc(r.ch.slice(-1))}»"` : ''}><span class="bigram-key">${esc(r.ch)}</span><span class="dim">${fmtPct(r.rate * 100, 0)}${trendMark(r)}</span></div>`).join('')}
        </div>` : emptyState({ ic: 'layers', title: 'Пока чисто', text: 'Сочетания появятся, когда наберётся статистика.' })}
      </section>
    </div>

    <section class="card card-pad">
      <div class="card-head">
        <div class="card-title">${icon('clock')}История тренировок</div>
        <span class="dim">последние ${Math.min(15, list.length)}</span>
      </div>
      ${list.length ? `<div class="table-scroll"><table class="table">
        <thead><tr><th>Когда</th><th>Режим</th><th class="t-right">Скорость</th><th class="t-right">Точность</th><th class="t-right">Ошибки</th><th class="t-right">Серия</th><th class="t-right">Опыт</th></tr></thead>
        <tbody>
          ${list.slice(0, 15).map((h) => {
            const m = modeById(h.mode);
            const sub = h.mode === 'code' ? CODE_LANGS.find((c) => c.id === h.codeLang)?.title || '' : h.lang.toUpperCase();
            return `<tr>
              <td class="dim">${new Date(h.ts).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
              <td><span class="mode-cell">${icon(m.icon)}${esc(m.title)} <span class="dim">· ${esc(sub)}</span></span></td>
              <td class="t-right"><b class="num">${h.cpm}</b> <span class="dim">зн/мин</span></td>
              <td class="t-right"><span class="chip ${h.accuracy >= 95 ? 'chip-ok' : h.accuracy >= 88 ? 'chip-warn' : 'chip-err'}">${fmtPct(h.accuracy)}</span></td>
              <td class="t-right num">${h.errors}</td>
              <td class="t-right num">${h.maxStreak}</td>
              <td class="t-right"><b class="num grad-text">+${h.xp || 0}</b></td>
            </tr>`;
          }).join('')}
        </tbody>
      </table></div>` : emptyState({ ic: 'clock', title: 'За этот период тренировок нет' })}
    </section>`}
  `;

  if (!hasData) return { charts: [], kb: null };

  const charts = [
    lineChart(root.querySelector('[data-chart="speed"]'), {
      labels,
      datasets: [
        { label: 'Лучшая', data: series.best, color: 'gold', width: 2, dash: [5, 5], points: days <= 30 ? 3 : 0 },
        { label: 'Средняя', data: series.cpm, color: 'accent', fill: true, points: days <= 30 ? 3.5 : 0 },
      ],
      unit: ' зн/мин',
    }),
    lineChart(root.querySelector('[data-chart="acc"]'), {
      labels,
      datasets: [{ label: 'Точность', data: series.acc, color: 'ok', fill: true, points: days <= 30 ? 3 : 0 }],
      unit: '%',
      suggestedMin: 85,
      suggestedMax: 100,
    }),
  ];

  const kb = new VirtualKeyboard(root.querySelector('[data-heatmap]'), { lang: state.lang, hands: false, heatmap: true });
  kb.heatmap(errorRates(charStats));

  return { charts, kb };
}
