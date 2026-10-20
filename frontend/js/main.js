// Точка входа: тема, эффекты, звук, сессия пользователя, каркас и роутинг.

import { store } from './core/store.js';
import { api } from './api/index.js';
import { defineRoutes, startRouter, rerender, currentPath } from './core/router.js';
import { mountShell, setActiveRoute } from './ui/shell.js';
import { fx } from './ui/effects.js';
import { sound } from './ui/sound.js';

import dashboard from './pages/dashboard.js';
import trainer from './pages/trainer.js';
import stats from './pages/stats.js';
import leaderboard from './pages/leaderboard.js';
import achievements from './pages/achievements.js';
import profile from './pages/profile.js';
import auth from './pages/auth.js';
import coach from './pages/coach.js';

const lightQuery = matchMedia('(prefers-color-scheme: light)');

function applyTheme() {
  const pref = store.settings.theme;
  const resolved = pref === 'system' ? (lightQuery.matches ? 'light' : 'dark') : pref;
  document.documentElement.dataset.theme = resolved;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', resolved === 'light' ? '#f5f2ec' : '#0a0b0f');
  fx.refreshPalette();
}

function onThemeChanged() {
  applyTheme();
  // Графики и canvas берут цвета из темы — перерисовываем страницу (кроме тренажёра, чтобы не сбить упражнение)
  if (currentPath() !== '/train') rerender();
}

async function boot() {
  applyTheme();
  fx.init(document.getElementById('fx'));
  fx.setLevel(store.settings.effects);
  sound.configure(store.settings);

  await api.bootstrap();
  mountShell();

  defineRoutes({
    '/': dashboard,
    '/train': trainer,
    '/stats': stats,
    '/coach': coach,
    '/leaderboard': leaderboard,
    '/achievements': achievements,
    '/profile': profile,
    '/login': auth,
    '/register': auth,
  });
  startRouter(document.getElementById('view'), { onRoute: setActiveRoute });

  store.on('settings', (patch) => {
    if ('theme' in patch) onThemeChanged();
    if ('effects' in patch) fx.setLevel(store.settings.effects);
    if ('sound' in patch || 'volume' in patch) sound.configure(store.settings);
  });
  lightQuery.addEventListener('change', () => {
    if (store.settings.theme === 'system') onThemeChanged();
  });

  document.documentElement.classList.add('is-ready');
}

boot().catch((err) => {
  console.error(err);
  document.getElementById('view').innerHTML = `<div class="boot-error">Не удалось запустить приложение: ${err.message}</div>`;
});
