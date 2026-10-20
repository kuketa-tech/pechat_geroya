// Глобальное состояние клиента: пользователь, прогресс, настройки.
// Прогресс приходит из API (сейчас — локальный мок), настройки живут в localStorage.

import { Emitter } from './emitter.js';
import { storageGet, storageSet } from './utils.js';

const SETTINGS_KEY = 'pg.settings.v1';

export const DEFAULT_SETTINGS = {
  theme: 'dark', // dark | light | system
  effects: 'full', // full | lite | off
  sound: true,
  volume: 0.55,
  showKeyboard: true,
  showHands: true,
  fontSize: 'm', // s | m | l
  dailyGoalMin: 10,
  unlockAll: false,
  train: { mode: 'words', lang: 'ru', difficulty: 1, duration: 60, codeLang: 'python', errorMode: 'strict' },
  customText: '',
};

class Store extends Emitter {
  user = null;
  progress = null;
  insights = null; // ответ ML-сервиса: персональные и общие выводы
  settings = loadSettings();

  setInsights(insights) {
    this.insights = insights;
    this.emit('insights', insights);
  }

  setSession(user, progress) {
    this.user = user;
    this.progress = progress;
    this.emit('user', user);
    this.emit('progress', progress);
  }

  setProgress(progress) {
    this.progress = progress;
    this.emit('progress', progress);
  }

  updateSettings(patch) {
    const next = { ...this.settings, ...patch };
    if (patch.train) next.train = { ...this.settings.train, ...patch.train };
    this.settings = next;
    storageSet(SETTINGS_KEY, next);
    this.emit('settings', patch);
  }
}

function loadSettings() {
  const saved = storageGet(SETTINGS_KEY, {});
  return {
    ...DEFAULT_SETTINGS,
    ...saved,
    train: { ...DEFAULT_SETTINGS.train, ...(saved.train || {}) },
  };
}

export const store = new Store();
