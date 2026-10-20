// Ежедневные задания: три штуки на день, одинаковые для всех игроков в этот день
// (выбор детерминирован датой), но учитывают открытые режимы.

import { seededRandom, shuffle } from '../core/utils.js';

export const QUEST_POOL = [
  { id: 'sessions3', title: 'Завершите 3 тренировки', icon: 'rotate', target: 3, reward: 60, kind: 'sum', value: () => 1 },
  { id: 'chars1500', title: 'Наберите 1 500 символов', icon: 'keyboard', target: 1500, reward: 50, kind: 'sum', value: (s) => s.chars },
  { id: 'combo60', title: 'Соберите серию из 60 нажатий', icon: 'flame', target: 60, reward: 50, kind: 'max', value: (s) => s.maxStreak },
  { id: 'acc97', title: 'Точность 97% в упражнении', icon: 'target', target: 97, reward: 50, kind: 'max', unit: '%', value: (s) => (s.chars >= 80 ? s.accuracy : 0) },
  { id: 'minutes8', title: 'Потренируйтесь 8 минут', icon: 'clock', target: 480, reward: 60, kind: 'sum', unit: 'time', value: (s) => s.duration },
  { id: 'speed180', title: 'Разгонитесь до 180 зн/мин', icon: 'zap', target: 180, reward: 60, kind: 'max', value: (s) => s.cpm },
  { id: 'symbols1', title: 'Пройдите упражнение «Символы»', icon: 'hash', target: 1, reward: 40, kind: 'sum', unlock: 2, value: (s) => (s.mode === 'symbols' ? 1 : 0) },
  { id: 'code1', title: 'Пройдите упражнение «Код»', icon: 'code', target: 1, reward: 45, kind: 'sum', unlock: 4, value: (s) => (s.mode === 'code' ? 1 : 0) },
  { id: 'bonus2', title: 'Поймайте 2 бонуса', icon: 'gift', target: 2, reward: 40, kind: 'sum', value: (s) => s.bonuses || 0 },
];

export const questDef = (id) => QUEST_POOL.find((q) => q.id === id);

export function dailyQuests(day, level) {
  const rnd = seededRandom(`quests:${day}`);
  const available = QUEST_POOL.filter((q) => !q.unlock || level >= q.unlock);
  return shuffle(available, rnd)
    .slice(0, 3)
    .map((q) => ({ id: q.id, progress: 0, done: false }));
}

/** Применяет итог тренировки к заданиям дня. Мутирует items, возвращает выполненные. */
export function applyQuests(items, session) {
  const completed = [];
  for (const item of items) {
    if (item.done) continue;
    const def = questDef(item.id);
    if (!def) continue;
    const v = def.value(session);
    item.progress = def.kind === 'sum' ? item.progress + v : Math.max(item.progress, v);
    if (item.progress >= def.target) {
      item.progress = def.target;
      item.done = true;
      completed.push(def);
    }
  }
  return completed;
}
