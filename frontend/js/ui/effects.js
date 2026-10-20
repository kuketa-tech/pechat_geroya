// Визуальные эффекты: искры, взрывы комбо, конфетти, тлеющие угольки, тряска.
// Один полноэкранный canvas, пул частиц, цикл rAF крутится только пока есть частицы.

import { cssVar } from '../core/utils.js';

const MAX_PARTICLES = 480;

let canvas = null;
let g = null;
let dpr = 1;
let particles = [];
let rafId = 0;
let lastT = 0;
let level = 'full';
let additive = true;
let emberEl = null;
let emberAcc = 0;
let palette = {};
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

function resize() {
  if (!canvas) return;
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = innerWidth * dpr;
  canvas.height = innerHeight * dpr;
  canvas.style.width = `${innerWidth}px`;
  canvas.style.height = `${innerHeight}px`;
}

const active = () => canvas && level !== 'off' && !reduceMotion.matches;
const scale = () => (level === 'lite' ? 0.45 : 1);

function spawn(p) {
  if (particles.length >= MAX_PARTICLES) particles.shift();
  particles.push(p);
  if (!rafId) {
    lastT = performance.now();
    rafId = requestAnimationFrame(loop);
  }
}

function emitEmbers(dt) {
  if (!emberEl || !emberEl.isConnected) return;
  emberAcc += dt * 0.06 * scale();
  const r = emberEl.getBoundingClientRect();
  while (emberAcc >= 1) {
    emberAcc -= 1;
    spawn({
      kind: 'ember',
      x: r.left + Math.random() * r.width,
      y: r.top + r.height * (0.3 + Math.random() * 0.6),
      vx: (Math.random() - 0.5) * 0.5,
      vy: -0.6 - Math.random() * 1.1,
      life: 0,
      max: 700 + Math.random() * 700,
      size: 1.2 + Math.random() * 2,
      color: Math.random() < 0.5 ? palette.combo5 : palette.combo3,
      gravity: -0.004,
    });
  }
}

function loop(now) {
  const dt = Math.min(48, now - lastT);
  lastT = now;
  const k = dt / 16.67;
  emitEmbers(dt);

  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, innerWidth, innerHeight);
  g.globalCompositeOperation = additive ? 'lighter' : 'source-over';

  const next = [];
  for (const p of particles) {
    p.life += dt;
    if (p.life >= p.max) continue;
    p.vy += p.gravity * k;
    if (p.drag) {
      const d = Math.pow(p.drag, k);
      p.vx *= d;
      p.vy *= d;
    }
    p.x += p.vx * k;
    p.y += p.vy * k;
    const t = 1 - p.life / p.max;
    g.globalAlpha = Math.min(1, t * 1.6);

    if (p.kind === 'confetti') {
      p.rot += p.vr * k;
      g.save();
      g.translate(p.x, p.y);
      g.rotate(p.rot);
      g.scale(1, Math.cos(p.rot * 1.7));
      g.fillStyle = p.color;
      g.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      g.restore();
    } else if (p.kind === 'ember') {
      g.fillStyle = p.color;
      g.beginPath();
      g.arc(p.x + Math.sin((p.life + p.x) / 90) * 1.5, p.y, p.size * t, 0, Math.PI * 2);
      g.fill();
    } else {
      g.strokeStyle = p.color;
      g.lineWidth = p.size * (0.4 + t * 0.6);
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(p.x, p.y);
      g.lineTo(p.x - p.vx * 2.2, p.y - p.vy * 2.2);
      g.stroke();
    }
    next.push(p);
  }
  particles = next;
  g.globalAlpha = 1;

  if (particles.length || (emberEl && active())) {
    rafId = requestAnimationFrame(loop);
  } else {
    rafId = 0;
    g.clearRect(0, 0, innerWidth, innerHeight);
  }
}

export const fx = {
  init(el) {
    canvas = el;
    g = canvas.getContext('2d');
    resize();
    window.addEventListener('resize', resize);
    this.refreshPalette();
  },

  enabled() {
    return active();
  },

  setLevel(next) {
    level = next;
    if (!active()) {
      particles = [];
      emberEl = null;
    }
  },

  /** Перечитать цвета темы (после переключения светлая/тёмная). */
  refreshPalette() {
    additive = document.documentElement.dataset.theme !== 'light';
    palette = {
      accent: cssVar('--accent'),
      gold: cssVar('--accent-2'),
      ok: cssVar('--ok'),
      err: cssVar('--err'),
      info: cssVar('--info'),
      epic: cssVar('--rar-epic'),
      combo1: cssVar('--text-3'),
      combo2: cssVar('--combo-2'),
      combo3: cssVar('--combo-3'),
      combo5: cssVar('--combo-5'),
    };
  },

  colorsForTier(tier) {
    return [
      [palette.gold, palette.combo1],
      [palette.combo2, palette.gold],
      [palette.combo3, palette.combo2, palette.gold],
      [palette.combo5, palette.combo3, palette.gold],
    ][tier] || [palette.gold];
  },

  /** Искры у каретки на верное нажатие; интенсивность растёт с уровнем комбо. */
  sparks(x, y, tier = 0) {
    if (!active()) return;
    const colors = this.colorsForTier(tier);
    const count = Math.round([2, 3, 5, 8][tier] * scale()) || 1;
    for (let i = 0; i < count; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.1;
      const v = 1.6 + Math.random() * (1.4 + tier * 0.7);
      spawn({
        kind: 'spark', x, y,
        vx: Math.cos(a) * v, vy: Math.sin(a) * v,
        life: 0, max: 280 + Math.random() * 260 + tier * 60,
        size: 1.4 + Math.random() * (1 + tier * 0.4),
        color: colors[i % colors.length],
        gravity: 0.11, drag: 0.97,
      });
    }
  },

  burst(x, y, { colors, count = 44, power = 6 } = {}) {
    if (!active()) return;
    const cols = colors || [palette.accent, palette.gold, palette.combo5];
    const n = Math.round(count * scale());
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.3;
      const v = power * (0.45 + Math.random() * 0.75);
      spawn({
        kind: 'spark', x, y,
        vx: Math.cos(a) * v, vy: Math.sin(a) * v,
        life: 0, max: 500 + Math.random() * 450,
        size: 1.8 + Math.random() * 2.2,
        color: cols[i % cols.length],
        gravity: 0.06, drag: 0.955,
      });
    }
  },

  confetti(count = 150) {
    if (!active()) return;
    const cols = [palette.accent, palette.gold, palette.ok, palette.info, palette.epic, palette.combo5];
    const n = Math.round(count * scale());
    for (let i = 0; i < n; i++) {
      const fromLeft = i % 2 === 0;
      spawn({
        kind: 'confetti',
        x: fromLeft ? -10 : innerWidth + 10,
        y: innerHeight * (0.35 + Math.random() * 0.3),
        vx: (fromLeft ? 1 : -1) * (5 + Math.random() * 9),
        vy: -7 - Math.random() * 9,
        life: 0, max: 2200 + Math.random() * 1200,
        w: 6 + Math.random() * 6, h: 9 + Math.random() * 8,
        rot: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.3,
        color: cols[i % cols.length],
        gravity: 0.24, drag: 0.985,
      });
    }
  },

  /** Непрерывные угольки над элементом (режим «В огне»). null — выключить. */
  embers(el) {
    emberEl = active() ? el : null;
    if (emberEl && !rafId) {
      lastT = performance.now();
      rafId = requestAnimationFrame(loop);
    }
  },

  shake(el, strength = 6) {
    if (!el || level !== 'full' || reduceMotion.matches) return;
    el.animate(
      [
        { transform: 'translateX(0)' },
        { transform: `translateX(${-strength}px)` },
        { transform: `translateX(${strength * 0.8}px)` },
        { transform: `translateX(${-strength * 0.5}px)` },
        { transform: 'translateX(0)' },
      ],
      { duration: 260, easing: 'ease-out' },
    );
  },
};
