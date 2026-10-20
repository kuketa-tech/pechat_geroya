// Фасад API для страниц. Страницы зовут только api.*, а не бэкенд напрямую.
// За фасадом — REST-бэкенд (http.js). Если сайт открыт статическим сервером без
// бэкенда, при загрузке переключаемся на локальный мок в localStorage (mock.js).

import { httpBackend } from './http.js';
import { mockBackend } from './mock.js';
import { store } from '../core/store.js';

let backend = httpBackend;

export const api = {
  /** Восстановить сессию при загрузке приложения. */
  async bootstrap() {
    let user;
    try {
      user = await backend.me();
    } catch (err) {
      if (!err.offline) throw err;
      console.warn('Бэкенд недоступен — прогресс хранится только в этом браузере.');
      backend = mockBackend;
      user = await backend.me();
    }
    const progress = await backend.getProgress(user.id);
    store.setSession(user, progress);
  },

  async register(data) {
    const res = await backend.register(data);
    store.setSession(res.user, res.progress);
    return res;
  },

  async login(data) {
    const res = await backend.login(data);
    store.setSession(res.user, res.progress);
    return res;
  },

  async loginSocial(provider) {
    const res = await backend.loginSocial(provider);
    store.setSession(res.user, res.progress);
    return res;
  },

  async logout() {
    const res = await backend.logout();
    store.setSession(res.user, res.progress);
  },

  /** Сохранить итог тренировки → отчёт о начисленном опыте, наградах, заданиях. */
  async saveSession(session) {
    const { progress, report } = await backend.saveSession(store.user.id, session);
    store.setProgress(progress);
    return report;
  },

  async refreshProgress() {
    store.setProgress(await backend.getProgress(store.user.id));
  },

  async updateProfile(patch) {
    const user = await backend.updateProfile(store.user.id, patch);
    store.setSession(user, store.progress);
  },

  async resetProgress() {
    store.setProgress(await backend.resetProgress(store.user.id));
  },

  async seedDemo() {
    store.setProgress(await backend.seedDemo(store.user.id));
  },

  leaderboard(metric, period) {
    return backend.leaderboard({ metric, period }, store.user, store.progress);
  },

  /** AI-тренер: выводы ML-моделей по вам и по всем игрокам. Без сервера — null. */
  async insights({ force = false } = {}) {
    if (!force && store.insights) return store.insights;
    const data = backend.insights ? await backend.insights() : null;
    store.setInsights(data);
    return data;
  },

  get online() {
    return backend !== mockBackend;
  },
};

// Новые тренировки, вход и выход меняют выводы модели — сбрасываем кэш
store.on('progress', () => {
  store.insights = null;
});
