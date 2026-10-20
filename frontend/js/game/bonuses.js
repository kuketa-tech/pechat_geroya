// Случайные бонусы во время тренировки. Выпадают только при живой серии,
// не чаще одного раза в COOLDOWN мс.

export const BONUS_TYPES = {
  xp2: { id: 'xp2', title: 'Двойной опыт', desc: '×2 опыта на 10 секунд', icon: 'sparkles', duration: 10000, color: 'var(--info)' },
  score50: { id: 'score50', title: 'Огненный рывок', desc: '+50% очков на 15 секунд', icon: 'flame', duration: 15000, color: 'var(--accent)' },
  shield: { id: 'shield', title: 'Щит комбо', desc: 'Следующая ошибка не сбросит серию', icon: 'shield', duration: 30000, color: 'var(--ok)' },
  time: { id: 'time', title: 'Песочные часы', desc: '+5 секунд к таймеру', icon: 'hourglass', duration: 0, color: 'var(--warn)', timedOnly: true },
};

const MIN_STREAK = 10;
const CHANCE_PER_KEY = 0.007;
const COOLDOWN = 9000;
const GRACE = 5000;

export class BonusManager {
  constructor({ timed, rnd = Math.random }) {
    this.timed = timed;
    this.rnd = rnd;
    this.active = new Map(); // id → expiresAt
    this.lastAt = 0;
    this.startedAt = 0;
    this.count = 0;
  }

  start(now) {
    this.startedAt = now;
    this.lastAt = now - COOLDOWN + GRACE;
  }

  /** Вызывается на каждое верное нажатие. Возвращает выпавший бонус или null. */
  roll(streak, now) {
    if (streak < MIN_STREAK || now - this.lastAt < COOLDOWN) return null;
    if (this.rnd() > CHANCE_PER_KEY) return null;
    const pool = Object.values(BONUS_TYPES).filter((b) => (!b.timedOnly || this.timed) && !this.active.has(b.id));
    if (!pool.length) return null;
    const bonus = pool[Math.floor(this.rnd() * pool.length)];
    this.lastAt = now;
    this.count++;
    if (bonus.duration > 0) this.active.set(bonus.id, now + bonus.duration);
    return bonus;
  }

  #isOn(id, now) {
    const until = this.active.get(id);
    if (until == null) return false;
    if (now > until) {
      this.active.delete(id);
      return false;
    }
    return true;
  }

  scoreMult(now) { return this.#isOn('score50', now) ? 1.5 : 1; }
  xpMult(now) { return this.#isOn('xp2', now) ? 2 : 1; }
  hasShield(now) { return this.#isOn('shield', now); }
  consumeShield() { this.active.delete('shield'); }

  /** Список активных бонусов с оставшимся временем — для HUD. */
  list(now) {
    const out = [];
    for (const [id, until] of this.active) {
      if (now > until) { this.active.delete(id); continue; }
      const def = BONUS_TYPES[id];
      out.push({ ...def, left: until - now, frac: (until - now) / def.duration });
    }
    return out;
  }
}
