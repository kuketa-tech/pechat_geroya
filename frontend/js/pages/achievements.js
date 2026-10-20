// Коллекция достижений с прогрессом и фильтрами по статусу.

import { store } from '../core/store.js';
import { esc, fmtNum, fmtDayShort } from '../core/utils.js';
import { ACHIEVEMENTS, RARITY } from '../data/achievements.js';
import { icon } from '../ui/icons.js';
import { seg, onSeg, setSegValue, badge, bar, ring } from '../ui/widgets.js';

const FILTERS = [
  { id: 'all', label: 'Все' },
  { id: 'open', label: 'Получены' },
  { id: 'locked', label: 'В процессе' },
];

export default {
  name: 'achievements',
  title: 'Достижения',
  render(root) {
    const state = { filter: 'all' };
    const p = store.progress;
    const items = ACHIEVEMENTS.map((a) => {
      const [cur, target] = a.progress(p);
      const at = p.achievements[a.id];
      return { a, at, cur: Math.min(cur, target), target, ratio: at ? 1 : Math.min(cur, target) / target };
    });
    const got = items.filter((i) => i.at);
    const xpFromAch = got.reduce((s, i) => s + RARITY[i.a.rarity].xp, 0);
    const pct = (got.length / items.length) * 100;

    root.innerHTML = `
      <header class="page-head">
        <div>
          <div class="eyebrow">Коллекция</div>
          <h1 class="h1">Достижения</h1>
          <p class="muted">Награды за рекорды скорости, точность, серии и упорство. Каждое достижение приносит опыт.</p>
        </div>
      </header>

      <section class="card ach-summary">
        <div class="ach-summary-ring">
          ${ring(pct, { size: 128, stroke: 11 })}
          <div class="ach-summary-inner"><b class="num">${got.length}</b><span>из ${items.length}</span></div>
        </div>
        <div class="ach-summary-body">
          <h2 class="h2">${got.length ? `Собрано ${Math.round(pct)}% коллекции` : 'Коллекция ждёт героя'}</h2>
          <p class="muted">Получено <b class="text-strong">${fmtNum(xpFromAch)} XP</b> за награды. Самые редкие требуют месяцев практики.</p>
          <div class="rarity-row">
            ${Object.entries(RARITY).map(([id, r]) => {
              const total = items.filter((i) => i.a.rarity === id).length;
              const have = got.filter((i) => i.a.rarity === id).length;
              return `<span class="rarity-chip" style="--rar: var(--rar-${id})"><i></i>${r.title}<b>${have}/${total}</b><small>+${r.xp} XP</small></span>`;
            }).join('')}
          </div>
        </div>
      </section>

      <div class="ach-toolbar">${seg('filter', FILTERS, state.filter)}</div>
      <div class="ach-grid" data-grid></div>`;

    const grid = root.querySelector('[data-grid]');
    const draw = () => {
      const list = items
        .filter((i) => state.filter === 'all' || (state.filter === 'open' ? i.at : !i.at))
        .sort((x, y) => (y.at ? 1 : 0) - (x.at ? 1 : 0) || y.ratio - x.ratio);
      grid.innerHTML = list.map(({ a, at, cur, target, ratio }, idx) => `
        <article class="ach-card card ${at ? 'is-on' : ''}" style="--rar: var(--rar-${a.rarity}); --d:${idx * 25}ms">
          ${badge(a, !!at, 60)}
          <div class="ach-body">
            <div class="ach-rarity">${RARITY[a.rarity].title}</div>
            <h3 class="ach-title">${esc(a.title)}</h3>
            <p class="ach-desc">${esc(a.desc)}</p>
            ${at
              ? `<div class="ach-date">${icon('check')}Получено ${fmtDayShort(at)}</div>`
              : `<div class="ach-progress">${bar(ratio * 100)}<span class="num">${fmtNum(cur)} / ${fmtNum(target)}</span></div>`}
          </div>
        </article>`).join('');
    };

    const offSeg = onSeg(root, (name, value, btn, group) => {
      state[name] = value;
      setSegValue(group, value);
      draw();
    });
    draw();
    return offSeg;
  },
};
