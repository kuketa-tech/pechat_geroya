// Таблица лидеров: скорость / точность / опыт за сегодня / неделю / всё время.

import { store } from '../core/store.js';
import { api } from '../api/index.js';
import { esc, fmtNum, fmtPct } from '../core/utils.js';
import { icon } from '../ui/icons.js';
import { seg, onSeg, setSegValue, avatar, emptyState } from '../ui/widgets.js';

const METRICS = [
  { id: 'speed', label: 'Скорость', icon: 'zap' },
  { id: 'accuracy', label: 'Точность', icon: 'target' },
  { id: 'xp', label: 'Опыт', icon: 'star' },
  { id: 'streak', label: 'Серия', icon: 'flame' },
  { id: 'daily', label: 'Испытание дня', icon: 'medal' },
];
const PERIODS = [
  { id: 'day', label: 'Сегодня' },
  { id: 'week', label: 'Неделя' },
  { id: 'all', label: 'Всё время' },
];

const FORMAT = {
  speed: { main: (r) => fmtNum(r.bestCpm), unit: 'зн/мин', sub: (r) => `${Math.round(r.bestCpm / 5)} сл/мин`, col: 'Слов/мин', colVal: (r) => Math.round(r.bestCpm / 5) },
  accuracy: { main: (r) => fmtPct(r.accuracy), unit: '', sub: (r) => `${r.sessions} трен.`, col: 'Тренировок', colVal: (r) => r.sessions },
  xp: { main: (r) => fmtNum(r.periodXp), unit: 'XP', sub: (r) => `уровень ${r.level}`, col: 'Скорость', colVal: (r) => `${r.bestCpm} зн/мин` },
  streak: { main: (r) => fmtNum(r.bestStreak), unit: 'подряд', sub: (r) => `${r.bestCpm} зн/мин`, col: 'Скорость', colVal: (r) => `${r.bestCpm} зн/мин` },
  daily: { main: (r) => fmtNum(r.bestCpm), unit: 'зн/мин', sub: (r) => `точность ${fmtPct(r.accuracy)}`, col: 'Точность', colVal: (r) => fmtPct(r.accuracy) },
};
const METRIC_HEAD = { speed: 'Знаков/мин', accuracy: 'Точность', xp: 'Опыт', streak: 'Серия', daily: 'Знаков/мин' };

export default {
  name: 'leaderboard',
  title: 'Рейтинг',
  render(root, { query }) {
    const state = { metric: METRICS.some((m) => m.id === query.metric) ? query.metric : 'speed', period: 'week' };
    let alive = true;

    root.innerHTML = `
      <header class="page-head">
        <div>
          <div class="eyebrow">Соревнование</div>
          <h1 class="h1">Таблица лидеров</h1>
          <p class="muted">Соревнуйтесь по скорости, точности и набранному опыту. Учитывается лучший результат за период.</p>
        </div>
      </header>
      <div class="lb-controls">
        ${seg('metric', METRICS, state.metric, { cls: 'seg-metrics' })}
        <div data-period>${seg('period', PERIODS, state.period)}</div>
      </div>
      <p class="lb-note dim" data-note></p>
      <div data-board></div>`;

    const board = root.querySelector('[data-board]');

    const periodBox = root.querySelector('[data-period]');
    const note = root.querySelector('[data-note]');
    async function load() {
      periodBox.classList.toggle('hidden', state.metric === 'daily');
      note.innerHTML = state.metric === 'daily'
        ? `${icon('medal')} Сегодняшний текст одинаков у всех. Считается лучшая попытка с точностью от 90%. <a class="card-link" href="#/train?mode=daily">Пройти испытание ${icon('chevronRight')}</a>`
        : state.metric === 'streak' ? `${icon('flame')} Самая длинная серия правильных нажатий подряд за период.` : '';
      board.classList.add('is-loading');
      const data = await api.leaderboard(state.metric, state.period);
      if (!alive) return;
      board.classList.remove('is-loading');
      board.innerHTML = renderBoard(data, state);
    }

    const offSeg = onSeg(root, (name, value, btn, group) => {
      state[name] = value;
      setSegValue(group, value);
      load();
    });

    load();
    return () => {
      alive = false;
      offSeg();
    };
  },
};

function renderBoard({ items, me, total }, state) {
  const f = FORMAT[state.metric];
  if (!items.length) {
    return `<div class="card card-pad">${emptyState({ ic: 'trophy', title: 'Пока никого', text: 'В этом периоде ещё нет результатов.' })}</div>`;
  }
  const [first, second, third] = items;
  const podium = [second, first, third].filter(Boolean);
  const rest = items.slice(3);

  const meCard = me
    ? `<div class="lb-me card">
        ${avatar(store.user.name, 44)}
        <div class="lb-me-body">
          <span class="dim">Ваше место</span>
          <b><span class="grad-text">#${me.rank}</span> из ${total}</b>
        </div>
        <div class="lb-me-val"><b class="num">${f.main(me)}</b> <span class="dim">${f.unit}</span></div>
        ${me.rank > 1 ? `<div class="lb-me-gap dim">${gapText(items, me, state.metric)}</div>` : `<span class="chip chip-accent">${icon('crown')}Вы лидер</span>`}
      </div>`
    : `<div class="lb-me card is-empty">
        <div class="icon-box">${icon('swords')}</div>
        <div class="lb-me-body"><b>Вас пока нет в рейтинге</b><span class="dim">Пройдите тренировку за этот период, чтобы занять место.</span></div>
        <a class="btn btn-primary btn-sm" href="#/train">${icon('play')}Тренироваться</a>
      </div>`;

  return `
    ${meCard}
    <div class="podium">
      ${podium.map((r) => `
        <div class="podium-col place-${r.rank} ${r.me ? 'is-me' : ''}">
          <div class="podium-user">
            ${r.rank === 1 ? `<div class="podium-crown">${icon('crown')}</div>` : ''}
            ${avatar(r.name, r.rank === 1 ? 76 : 62)}
            <div class="podium-name">${esc(r.name)}</div>
            <span class="lvl-badge">ур. ${r.level}</span>
          </div>
          <div class="podium-block">
            <div class="podium-rank">${r.rank}</div>
            <div class="podium-val num">${f.main(r)}<small>${f.unit}</small></div>
            <div class="podium-sub">${f.sub(r)}</div>
          </div>
        </div>`).join('')}
    </div>

    ${rest.length ? `<section class="card lb-table">
      <div class="table-scroll">
        <table class="table">
          <thead><tr><th>#</th><th>Игрок</th><th class="t-right">${METRIC_HEAD[state.metric]}</th><th class="t-right lb-col-extra">${f.col}</th></tr></thead>
          <tbody>
            ${rest.map((r) => `
              <tr class="${r.me ? 'is-me' : ''}">
                <td class="lb-rank num">${r.rank}</td>
                <td><div class="lb-player">${avatar(r.name, 34)}<span class="lb-name">${esc(r.name)}</span><span class="lvl-badge">ур. ${r.level}</span>${r.me ? '<span class="chip chip-accent lb-you">вы</span>' : ''}</div></td>
                <td class="t-right"><b class="num">${f.main(r)}</b> <span class="dim">${f.unit}</span></td>
                <td class="t-right dim num lb-col-extra">${f.colVal(r)}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </section>` : ''}`;
}

function gapText(items, me, metric) {
  const ahead = items[me.rank - 2];
  if (!ahead) return '';
  const d = ahead.value - me.value;
  if (metric === 'speed') return `до #${ahead.rank} — ${fmtNum(Math.ceil(d) || 1)} зн/мин`;
  if (metric === 'accuracy') return `до #${ahead.rank} — ${String(Math.max(0.1, d).toFixed(1)).replace('.', ',')} п.п.`;
  if (metric === 'streak') return `до #${ahead.rank} — ${fmtNum(Math.ceil(d) || 1)} нажатий`;
  if (metric === 'daily') return `до #${ahead.rank} — ${fmtNum(Math.ceil(d) || 1)} зн/мин`;
  return `до #${ahead.rank} — ${fmtNum(Math.ceil(d) || 1)} XP`;
}
