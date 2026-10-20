// AI-тренер: выводы ML-моделей сервера. Вкладка «Мои данные» — персональная модель ошибок,
// прогноз скорости, стиль печати, ритм и рекомендации; «Все игроки» — общие закономерности.

import { store } from '../core/store.js';
import { api } from '../api/index.js';
import { navigate } from '../core/router.js';
import { esc, fmtNum, fmtPct } from '../core/utils.js';
import { icon } from '../ui/icons.js';
import { seg, onSeg, setSegValue, statTile, emptyState } from '../ui/widgets.js';
import { VirtualKeyboard } from '../ui/keyboard.js';
import { chartsAvailable, palette, alpha, baseOptions } from '../ui/charts.js';

const TABS = [
  { id: 'me', label: 'Мои данные', icon: 'user' },
  { id: 'all', label: 'Все игроки', icon: 'globe' },
];

const pct = (p) => `${(p * 100).toFixed(1).replace('.', ',')}%`;
const signed = (v) => `${v > 0 ? '+' : ''}${Math.round(v)}%`;

export default {
  name: 'coach',
  title: 'AI-тренер',
  render(root, { query }) {
    const state = { tab: query.tab === 'all' ? 'all' : 'me', lang: mostUsedLang(), data: null };
    let charts = [];
    let keyboards = [];
    let alive = true;

    const destroy = () => {
      charts.forEach((c) => c?.destroy());
      keyboards.forEach((k) => k.destroy());
      charts = [];
      keyboards = [];
    };

    root.innerHTML = `
      <header class="page-head">
        <div>
          <div class="eyebrow">Машинное обучение</div>
          <h1 class="h1">AI-тренер</h1>
          <p class="muted">Модели учатся на каждом вашем нажатии и на данных всех игроков: предсказывают, где вы ошибётесь, прогнозируют рост скорости и подбирают упражнения.</p>
        </div>
        ${seg('tab', TABS, state.tab)}
      </header>
      <div data-body><div class="coach-loading card card-pad"><div class="spinner"></div><span class="dim">Модели обучаются на свежих данных…</span></div></div>`;
    const body = root.querySelector('[data-body]');

    const draw = () => {
      destroy();
      if (!state.data) {
        body.innerHTML = offline();
        return;
      }
      const out = state.tab === 'me' ? paintMe(body, state) : paintAll(body, state);
      charts = out.charts;
      keyboards = out.keyboards;
    };

    const offSeg = onSeg(root, (name, value, btn, group) => {
      state[name] = value;
      setSegValue(group, value);
      draw();
    });

    root.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const action = JSON.parse(btn.dataset.action);
      startAction(action);
    });

    api.insights({ force: true })
      .then((data) => {
        if (!alive) return;
        state.data = data;
        draw();
      })
      .catch((err) => {
        if (!alive) return;
        body.innerHTML = `<div class="card card-pad">${emptyState({ ic: 'alert', title: 'Не удалось получить выводы', text: err.message })}</div>`;
      });

    return () => {
      alive = false;
      offSeg();
      destroy();
    };
  },
};

function mostUsedLang() {
  const l = store.progress?.totals?.langs || {};
  return (l.en || 0) > (l.ru || 0) ? 'en' : 'ru';
}

/** Применить рекомендацию: настроить тренажёр и открыть его. */
export function startAction(action) {
  if (action.route) {
    navigate(action.route);
    return;
  }
  const { mode, ...rest } = action;
  store.updateSettings({ train: { ...store.settings.train, ...rest, ...(mode ? { mode } : {}) } });
  navigate(mode ? `/train?mode=${mode}` : '/train');
}

function offline() {
  return `<div class="card card-pad">${emptyState({
    ic: 'cloud',
    title: 'AI-тренер работает вместе с сервером',
    text: 'Модели обучаются на сервере по данным всех игроков. Запустите приложение командой uvicorn backend.main:app (см. README) — и здесь появятся прогноз, модель ошибок и стиль печати.',
  })}</div>`;
}

function recCard(r) {
  return `<article class="rec card">
    <div class="rec-head"><div class="icon-box">${icon(r.icon)}</div><span class="chip ${r.tag === 'AI' ? 'chip-accent' : ''}">${esc(r.tag)}</span></div>
    <h3 class="rec-title">${esc(r.title)}</h3>
    <p class="rec-text">${esc(r.text)}</p>
    <button class="btn btn-secondary btn-sm rec-go" data-action='${esc(JSON.stringify(r.action))}'>${icon('play')}Начать</button>
  </article>`;
}

function factorBars(factors, { withGlobal }) {
  const max = Math.max(50, ...factors.map((f) => Math.abs(f.effect)), ...(withGlobal ? factors.map((f) => Math.abs(f.global)) : []));
  return `<ul class="factors">
    ${factors.map((f) => `
      <li class="factor">
        <div class="factor-top"><span>${esc(f.label)}</span><b class="${f.effect >= 0 ? 'up' : 'down'}">${signed(f.effect)}</b></div>
        <div class="factor-bar"><i class="${f.effect >= 0 ? 'pos' : 'neg'}" style="--w:${Math.min(100, (Math.abs(f.effect) / max) * 100)}%"></i></div>
        ${withGlobal ? `<div class="factor-bar factor-bar-global" title="У всех игроков: ${signed(f.global)}"><i style="--w:${Math.min(100, (Math.abs(f.global) / max) * 100)}%"></i></div>` : ''}
      </li>`).join('')}
  </ul>`;
}

function keyChips(keys) {
  return `<div class="risk-keys">${keys.map((k) => `<span class="risk-key"><kbd>${esc(k.ch.toUpperCase())}</kbd><b>${pct(k.p)}</b>${k.lift ? `<small>×${String(k.lift).replace('.', ',')}</small>` : ''}</span>`).join('')}</div>`;
}

function heatRates(risk) {
  return Object.fromEntries(Object.entries(risk || {}).map(([ch, p]) => [ch, { rate: p, attempts: 'прогноз' }]));
}

/* ---------------- Мои данные ---------------- */

function paintMe(body, state) {
  const { personal: me, global: g } = state.data;
  const m = me.model;
  const lang = state.lang;
  const fc = me.forecast;
  const st = me.style;
  const rh = me.rhythm;

  body.innerHTML = `
    <section class="recs">${me.recommendations.map(recCard).join('')}</section>

    <div class="coach-row">
      <section class="card card-pad span-2">
        <div class="card-head">
          <div class="card-title">${icon('keyboard')}Модель ваших ошибок</div>
          ${seg('lang', [{ id: 'ru', label: 'RU' }, { id: 'en', label: 'EN' }], lang, { cls: 'seg-sm' })}
        </div>
        ${m.ready ? `
          <div class="model-meta">
            <span class="chip chip-accent">${icon('sparkles')}обучена на ${fmtNum(m.samples)} нажатиях</span>
            ${m.auc ? `<span class="chip" data-tip="Площадь под ROC-кривой на ваших последних нажатиях, которых модель не видела">${icon('target')}AUC ${String(m.auc).replace('.', ',')}</span>` : ''}
            <span class="chip">${icon('alert')}ваша доля ошибок ${pct(m.errorRate || 0)}</span>
          </div>
          <p class="muted model-note">Цвет клавиши — вероятность ошибки, которую предсказывает модель. Для клавиш, на которых у вас мало данных, она опирается на общую модель всех игроков.</p>
          <div data-kb-me></div>
          <div class="model-foot"><span class="dim">Рискованнее всего:</span>${keyChips(m.topKeys[lang].slice(0, 6))}</div>`
        : `
          <div class="collect">
            <div class="collect-num"><b class="num">${fmtNum(m.samples)}</b><span>/ ${fmtNum(m.need)} нажатий</span></div>
            <div class="bar bar-lg"><i style="--p:${Math.min(100, (m.samples / m.need) * 100)}%"></i></div>
            <p class="muted">Персональная модель обучится, когда наберётся достаточно ваших нажатий. Пока подсказки строятся на общей модели всех игроков.</p>
          </div>
          ${g.ready ? `<div data-kb-me></div>` : ''}`}
      </section>

      <section class="card card-pad">
        <div class="card-head">
          <div class="card-title">${icon('alert')}Что повышает риск ошибки</div>
        </div>
        ${m.ready
          ? `<div class="legend factor-legend"><i style="background:var(--accent)"></i>вы <i style="background:var(--text-4)"></i>все игроки</div>${factorBars(m.factors.slice(0, 7), { withGlobal: true })}`
          : g.ready ? `<div class="legend factor-legend"><i style="background:var(--accent)"></i>все игроки</div>${factorBars(g.factors.slice(0, 7), { withGlobal: false })}` : emptyState({ ic: 'database', title: 'Мало данных' })}
      </section>
    </div>

    <div class="coach-row">
      <section class="card card-pad span-2">
        <div class="card-head">
          <div class="card-title">${icon('rocket')}Прогноз скорости</div>
          <span class="legend"><i style="background:var(--accent)"></i>ваша кривая <i style="background:var(--text-3)"></i>средний игрок</span>
        </div>
        ${fc ? `
          <div class="forecast-kpis">
            ${fc.horizons.map((h) => `<div><span class="dim">через ${h.days} дн.</span><b class="num">${h.cpm}</b><small>${h.low}–${h.high} зн/мин</small></div>`).join('')}
            ${fc.goal ? `<div class="forecast-goal"><span class="dim">цель ${fc.goal.cpm} зн/мин</span><b class="num">${fc.goal.days ? `~${fc.goal.days} дн.` : 'уже'}</b><small>${fc.goal.minutes} мин практики</small></div>` : ''}
          </div>
          <div class="chart-box"><canvas data-chart-forecast></canvas></div>
          <p class="dim chart-note">Кривая обучения cpm = a + b·ln(1 + t/τ), робастная регрессия Хьюбера по вашим тренировкам. Темп занятий — ${String(fc.pace).replace('.', ',')} мин/день за последние 2 недели.</p>`
        : emptyState({ ic: 'rocket', title: 'Нужно хотя бы 5 тренировок', text: 'Прогноз строится по вашей кривой обучения — пройдите ещё несколько тренировок.' })}
      </section>

      <section class="card card-pad">
        <div class="card-head"><div class="card-title">${icon('layers')}Стиль печати</div></div>
        ${st ? `
          <div class="archetype">
            <div class="archetype-icon">${icon(st.icon)}</div>
            <div><div class="archetype-name">${esc(st.name)}</div><div class="dim archetype-sub">в группе ${st.groupSize} из ${st.players} игроков</div></div>
          </div>
          <p class="muted archetype-desc">${esc(st.desc)}</p>
          <div class="chart-box chart-radar"><canvas data-chart-radar></canvas></div>`
        : emptyState({ ic: 'layers', title: 'Стиль определится позже', text: 'Нужно 3 тренировки за последние 2 месяца.' })}
      </section>
    </div>

    <div class="coach-row">
      <section class="card card-pad span-2">
        <div class="card-head">
          <div class="card-title">${icon('clock')}Ритм по пальцам</div>
          ${rh ? `<span class="chip">${icon('target')}ровность ${rh.consistency}%</span>` : ''}
        </div>
        ${rh ? `
          <div class="chart-box chart-mid"><canvas data-chart-fingers></canvas></div>
          <div class="model-foot"><span class="dim">Дольше всего ищете:</span><div class="risk-keys">${rh.slowKeys.map((k) => `<span class="risk-key"><kbd>${esc(k.ch.toUpperCase())}</kbd><b>${k.ms} мс</b></span>`).join('')}</div></div>`
        : emptyState({ ic: 'clock', title: 'Ритм появится после тренировки', text: 'Нужны интервалы между нажатиями — они пишутся с этой версии тренажёра.' })}
      </section>
      <section class="card card-pad">
        <div class="card-head"><div class="card-title">${icon('layers')}Трудные переходы</div></div>
        ${m.ready && m.topBigrams[lang].length ? `<div class="bigrams">
          ${m.topBigrams[lang].map((b) => `<div class="bigram"><span class="bigram-key">${esc(b.ch)}</span><span class="dim">${pct(b.p)}</span></div>`).join('')}
        </div><p class="dim chart-note">Средняя предсказанная вероятность ошибки на втором символе пары.</p>`
        : emptyState({ ic: 'layers', title: 'Пока нет данных' })}
      </section>
    </div>`;

  const charts = [];
  const keyboards = [];
  const kbHost = body.querySelector('[data-kb-me]');
  if (kbHost) {
    const kb = new VirtualKeyboard(kbHost, { lang, hands: false, heatmap: true });
    const risk = m.ready ? m.risk[lang].chars : g.risk?.[lang];
    kb.heatmap(heatRates(risk));
    keyboards.push(kb);
  }
  if (chartsAvailable()) {
    if (fc) charts.push(forecastChart(body.querySelector('[data-chart-forecast]'), fc, g.curve));
    if (st) charts.push(radarChart(body.querySelector('[data-chart-radar]'), st));
    if (rh) charts.push(fingerChart(body.querySelector('[data-chart-fingers]'), rh));
  }
  return { charts, keyboards };
}

/* ---------------- Все игроки ---------------- */

function paintAll(body, state) {
  const g = state.data.global;
  const lang = state.lang;
  const ds = g.dataset || {};
  if (!g.ready) {
    body.innerHTML = `<div class="card card-pad">${emptyState({ ic: 'database', title: 'Общая модель ещё не обучена', text: 'Нужно больше тренировок с записью нажатий.' })}</div>`;
    return { charts: [], keyboards: [] };
  }
  body.innerHTML = `
    <div class="kpi-grid">
      ${statTile({ label: 'Игроков', value: fmtNum(ds.players), ic: 'user' })}
      ${statTile({ label: 'Тренировок', value: fmtNum(ds.sessions), ic: 'rotate', sub: `${fmtNum(ds.loggedSessions)} с логом нажатий` })}
      ${statTile({ label: 'Нажатий в модели', value: fmtNum(ds.keystrokes), ic: 'keyboard' })}
      ${statTile({ label: 'Качество (AUC)', value: g.auc ? String(g.auc).replace('.', ',') : '—', ic: 'target', sub: 'на отложенных тренировках' })}
      ${statTile({ label: 'Средняя скорость', value: fmtNum(ds.avgCpm), unit: 'зн/мин', ic: 'zap' })}
      ${statTile({ label: 'Средняя точность', value: fmtPct(ds.avgAccuracy), ic: 'check', sub: ds.flagged ? `${ds.flagged} подозрительных скрыто` : '' })}
    </div>

    <div class="coach-row">
      <section class="card card-pad">
        <div class="card-head"><div class="card-title">${icon('alert')}Общие закономерности</div></div>
        <p class="muted model-note">Насколько каждый фактор меняет шанс ошибки у всех игроков (логистическая регрессия, отношение шансов).</p>
        ${factorBars(g.factors, { withGlobal: false })}
      </section>
      <section class="card card-pad span-2">
        <div class="card-head">
          <div class="card-title">${icon('keyboard')}Самые трудные клавиши у всех</div>
          ${seg('lang', [{ id: 'ru', label: 'RU' }, { id: 'en', label: 'EN' }], lang, { cls: 'seg-sm' })}
        </div>
        <div data-kb-all></div>
        <div class="model-foot"><span class="dim">Топ по риску:</span>${keyChips((g.topKeys[lang] || []).slice(0, 6))}</div>
      </section>
    </div>

    <div class="coach-row">
      <section class="card card-pad span-2">
        <div class="card-head">
          <div class="card-title">${icon('chart')}Средняя кривая обучения</div>
          <span class="dim">${g.curve ? `${g.curve.players} игроков` : ''}</span>
        </div>
        <div class="chart-box"><canvas data-chart-popcurve></canvas></div>
        <p class="dim chart-note">Как в среднем растёт скорость с часами практики — та же модель, что и ваш прогноз, по данным всех игроков.</p>
      </section>
      <section class="card card-pad">
        <div class="card-head"><div class="card-title">${icon('layers')}Стили печати</div></div>
        <div class="chart-box chart-radar"><canvas data-chart-styles></canvas></div>
        <ul class="styles-list">
          ${g.styles.map((s) => `<li><span class="style-dot" data-style="${s.id}"></span><b>${esc(s.name)}</b><span class="dim">${s.size} игр. · ${s.speed} зн/мин · ${fmtPct(s.accuracy)}</span></li>`).join('')}
        </ul>
      </section>
    </div>

    <section class="card card-pad how">
      <div class="card-head"><div class="card-title">${icon('sparkles')}Как это работает</div></div>
      <div class="how-grid">
        <div><b>Модель ошибок</b><p>Логистическая регрессия по каждому нажатию: Shift, тот же палец, прыжок через ряд, начало слова, темп, усталость и сама клавиша. Персональная модель — байесовская поправка к общей: при малом числе данных она совпадает с общей, а потом подстраивается под вас.</p></div>
        <div><b>Прогноз скорости</b><p>Кривая обучения cpm = a + b·ln(1 + t/τ) по минутам практики. Коэффициенты считает робастная регрессия Хьюбера, τ подбирается перебором. Результат — прогноз на 7–30 дней с коридором и время до цели.</p></div>
        <div><b>Стиль печати</b><p>KMeans по шести признакам: скорость, точность, стабильность, выносливость, разнообразие, ровность ритма. Названия группам даёт венгерский алгоритм по сходству центроидов с прототипами.</p></div>
        <div><b>Честный рейтинг</b><p>IsolationForest по ритму нажатий ловит слишком ровный или пакетный ввод скриптом. Такие результаты сохраняются, но в рейтинг не попадают.</p></div>
      </div>
    </section>`;

  const charts = [];
  const keyboards = [];
  const kb = new VirtualKeyboard(body.querySelector('[data-kb-all]'), { lang, hands: false, heatmap: true });
  kb.heatmap(heatRates(g.risk[lang]));
  keyboards.push(kb);
  if (chartsAvailable()) {
    if (g.curve) charts.push(popCurveChart(body.querySelector('[data-chart-popcurve]'), g.curve, g.speedHist));
    if (g.styles.length) charts.push(stylesChart(body.querySelector('[data-chart-styles]'), g.styles));
  }
  return { charts, keyboards };
}

/* ---------------- графики ---------------- */

const STYLE_COLORS = { sprinter: 'accent', sniper: 'ok', metronome: 'info', explorer: 'epic' };

function linearOptions(p, unit) {
  const o = baseOptions(p, { unit });
  o.interaction = { mode: 'nearest', intersect: false };
  o.scales.x = { ...o.scales.x, type: 'linear', ticks: { ...o.scales.x.ticks, callback: (v) => `${v} ч` } };
  o.plugins.tooltip.callbacks = {
    title: (items) => `${String(items[0].parsed.x).replace('.', ',')} ч практики`,
    label: (ctx) => ` ${ctx.dataset.label}: ${Math.round(ctx.parsed.y)}${unit}`,
  };
  return o;
}

function forecastChart(canvas, fc, pop) {
  const p = palette();
  const past = fc.line.filter((pt) => pt.x <= fc.nowX);
  const future = fc.line.filter((pt) => pt.x >= fc.nowX);
  const upper = future.map((pt) => ({ x: pt.x, y: pt.y + fc.sigma }));
  const lower = future.map((pt) => ({ x: pt.x, y: pt.y - fc.sigma }));
  const datasets = [
    { label: 'Коридор', data: upper, borderWidth: 0, pointRadius: 0, fill: '+1', backgroundColor: alpha(p.accent, 0.12) },
    { label: 'Коридор', data: lower, borderWidth: 0, pointRadius: 0, fill: false },
    { label: 'Прогноз', data: future, borderColor: p.accent, borderDash: [6, 5], borderWidth: 2.5, pointRadius: 0, tension: 0.3 },
    { label: 'Кривая', data: past, borderColor: p.accent, borderWidth: 2.5, pointRadius: 0, tension: 0.3 },
    { label: 'Тренировки', data: fc.points, type: 'scatter', backgroundColor: alpha(p.gold, 0.75), pointRadius: 3.5, pointHoverRadius: 6 },
  ];
  if (pop) {
    const maxX = fc.line[fc.line.length - 1].x;
    datasets.push({ label: 'Средний игрок', data: pop.line.filter((pt) => pt.x <= maxX), borderColor: alpha(p.text3, 0.8), borderWidth: 1.5, borderDash: [2, 4], pointRadius: 0, tension: 0.3 });
  }
  const o = linearOptions(p, ' зн/мин');
  o.plugins.tooltip.filter = (item) => item.dataset.label !== 'Коридор';
  return new window.Chart(canvas, { type: 'line', data: { datasets }, options: o });
}

function popCurveChart(canvas, curve) {
  const p = palette();
  const o = linearOptions(p, ' зн/мин');
  return new window.Chart(canvas, {
    type: 'line',
    data: {
      datasets: [{
        label: 'Средний игрок', data: curve.line, borderColor: p.info, borderWidth: 2.5, pointRadius: 0, tension: 0.3,
        fill: true, backgroundColor: alpha(p.info, 0.1),
      }],
    },
    options: o,
  });
}

function radarChart(canvas, st) {
  const p = palette();
  const font = { family: "'Manrope', system-ui, sans-serif", size: 11, weight: 700 };
  return new window.Chart(canvas, {
    type: 'radar',
    data: {
      labels: st.axes.map((a) => a.label),
      datasets: [
        { label: 'Вы', data: st.axes.map((a) => a.you), borderColor: p.accent, backgroundColor: alpha(p.accent, 0.22), borderWidth: 2, pointRadius: 3, pointBackgroundColor: p.accent },
        { label: st.name, data: st.axes.map((a) => a.group), borderColor: alpha(p.text3, 0.9), backgroundColor: alpha(p.text3, 0.08), borderWidth: 1.5, borderDash: [4, 4], pointRadius: 0 },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { color: p.text2, font, boxWidth: 10, boxHeight: 10, usePointStyle: true } },
        tooltip: { callbacks: { label: (ctx) => ` ${ctx.dataset.label}: ${ctx.parsed.r}-й перцентиль` } },
      },
      scales: {
        r: {
          min: 0, max: 100,
          ticks: { display: false, stepSize: 25 },
          grid: { color: alpha(p.grid, 0.9) },
          angleLines: { color: alpha(p.grid, 0.9) },
          pointLabels: { color: p.text2, font },
        },
      },
    },
  });
}

function fingerChart(canvas, rh) {
  const p = palette();
  const colors = { lp: '--f-pinky', lr: '--f-ring', lm: '--f-middle', li: '--f-index-l', th: '--f-thumb', ri: '--f-index-r', rm: '--f-middle', rr: '--f-ring', rp: '--f-pinky' };
  const css = getComputedStyle(document.documentElement);
  const o = baseOptions(p, { unit: ' мс' });
  o.scales.y.suggestedMin = 0;
  return new window.Chart(canvas, {
    type: 'bar',
    data: {
      labels: rh.fingers.map((f) => f.label.replace('Левый ', 'Л. ').replace('Правый ', 'П. ')),
      datasets: [{
        label: 'Медианный интервал',
        data: rh.fingers.map((f) => f.ms),
        backgroundColor: rh.fingers.map((f) => alpha(css.getPropertyValue(colors[f.id]).trim(), 0.8)),
        borderRadius: 8,
        maxBarThickness: 34,
      }],
    },
    options: o,
  });
}

function stylesChart(canvas, styles) {
  const p = palette();
  return new window.Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: styles.map((s) => s.name),
      datasets: [{ data: styles.map((s) => s.size), backgroundColor: styles.map((s) => alpha(p[STYLE_COLORS[s.id]] || p.accent, 0.85)), borderColor: p.surface, borderWidth: 3 }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '62%',
      plugins: { legend: { display: false } },
    },
  });
}
