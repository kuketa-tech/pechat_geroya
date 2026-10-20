// Каркас: сайдбар, нижняя панель на мобильных, мини-профиль, переключатель темы.

import { icon, logoMark } from './icons.js';
import { avatarRing, xpBar } from './widgets.js';
import { store } from '../core/store.js';
import { esc, fmtNum } from '../core/utils.js';
import { levelProgress } from '../game/scoring.js';
import { rankFor } from '../data/modes.js';

const NAV = [
  { path: '/', label: 'Главная', icon: 'home' },
  { path: '/train', label: 'Тренировка', short: 'Печать', icon: 'keyboard' },
  { path: '/coach', label: 'AI-тренер', short: 'AI', icon: 'sparkles' },
  { path: '/stats', label: 'Статистика', short: 'Статы', icon: 'chart' },
  { path: '/leaderboard', label: 'Рейтинг', icon: 'trophy' },
  { path: '/achievements', label: 'Достижения', icon: 'award' },
  { path: '/profile', label: 'Профиль', icon: 'user' },
];
const TABS = ['/', '/train', '/coach', '/stats', '/leaderboard', '/profile'];

const THEMES = [
  { id: 'light', icon: 'sun', label: 'Светлая тема' },
  { id: 'system', icon: 'monitor', label: 'Как в системе' },
  { id: 'dark', icon: 'moon', label: 'Тёмная тема' },
];

let sidebar;
let tabbar;

export function mountShell() {
  sidebar = document.getElementById('sidebar');
  tabbar = document.getElementById('tabbar');

  sidebar.innerHTML = `
    <a class="brand" href="#/" aria-label="Печать героя — на главную">
      ${logoMark()}
      <span class="brand-text">
        <span class="brand-name">Печать героя</span>
        <span class="brand-sub">Киберрывок · 2026</span>
      </span>
    </a>
    <nav class="nav" aria-label="Основное меню">
      <div class="nav-label">Меню</div>
      ${NAV.map((n) => `
        <a class="nav-item" href="#${n.path}" data-path="${n.path}">
          ${icon(n.icon)}<span>${n.label}</span>
          ${n.path === '/' ? '<em class="nav-badge hidden" data-quests></em>' : ''}
        </a>`).join('')}
    </nav>
    <div class="sidebar-foot">
      <div class="sync-pill" data-sync><i class="sync-dot"></i><span></span></div>
      <a class="user-mini" data-user-mini href="#/profile"></a>
      <div class="theme-switch" role="radiogroup" aria-label="Тема">
        ${THEMES.map((t) => `<button type="button" data-theme-set="${t.id}" aria-label="${t.label}" title="${t.label}">${icon(t.icon)}</button>`).join('')}
      </div>
    </div>`;

  tabbar.innerHTML = `<div class="tabbar-inner">
    ${NAV.filter((n) => TABS.includes(n.path)).map((n) => `
      <a class="tab" href="#${n.path}" data-path="${n.path}">${icon(n.icon)}<span>${n.short || n.label}</span></a>`).join('')}
  </div>`;

  sidebar.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-theme-set]');
    if (btn) store.updateSettings({ theme: btn.dataset.themeSet });
  });

  store.on('user', updateUser);
  store.on('progress', updateUser);
  store.on('settings', updateThemeSwitch);
  updateUser();
  updateThemeSwitch();
}

export function setActiveRoute(path) {
  document.querySelectorAll('.nav-item, .tab').forEach((a) => {
    a.classList.toggle('is-active', a.dataset.path === path);
    if (a.dataset.path === path) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  document.body.classList.remove('is-typing');
}

function updateUser() {
  const { user, progress } = store;
  if (!user || !progress || !sidebar) return;
  const lp = levelProgress(progress.xp);
  const mini = sidebar.querySelector('[data-user-mini]');
  mini.href = user.guest ? '#/login' : '#/profile';
  mini.innerHTML = `
    ${avatarRing(user.name, { size: 40, level: lp.level, pct: lp.pct })}
    <div class="user-mini-body">
      <div class="user-mini-name">${esc(user.name)}</div>
      <div class="user-mini-rank">${user.guest ? 'Войдите, чтобы сохранить прогресс' : `${esc(rankFor(lp.level).title)} · ${fmtNum(lp.cur)}/${fmtNum(lp.need)} XP`}</div>
      ${user.guest ? '' : xpBar(lp.pct)}
    </div>`;

  const sync = sidebar.querySelector('[data-sync]');
  sync.querySelector('.sync-dot').classList.toggle('is-ok', !user.guest);
  sync.querySelector('span').textContent = user.guest ? 'Гостевой режим · локально' : 'Прогресс сохранён';

  const left = progress.quests.items.filter((q) => !q.done).length;
  const badge = sidebar.querySelector('[data-quests]');
  badge.textContent = left;
  badge.classList.toggle('hidden', left === 0);
  badge.title = `Заданий на сегодня: ${left}`;
}

function updateThemeSwitch() {
  sidebar?.querySelectorAll('[data-theme-set]').forEach((b) => {
    const on = b.dataset.themeSet === store.settings.theme;
    b.classList.toggle('is-active', on);
    b.setAttribute('aria-checked', on);
  });
}
