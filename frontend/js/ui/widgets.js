// Переиспользуемые фрагменты разметки: аватары, кольца, шкалы, плитки, значки наград.

import { icon } from './icons.js';
import { esc, hashStr, clamp } from '../core/utils.js';
import { RARITY } from '../data/achievements.js';

const AVATAR_GRADS = [
  ['#ffb23f', '#ff6a2b'], ['#5cc8ff', '#5b6cff'], ['#4fd6a4', '#1e9e8a'], ['#b48cff', '#7b4fe0'],
  ['#ff7aa8', '#e0264a'], ['#ffd34a', '#f08c1a'], ['#6ee7f2', '#2b8ae6'], ['#a3e635', '#16a34a'],
];

export function initials(name = '') {
  const parts = String(name).replace(/[^\p{L}\p{N}\s_-]/gu, '').split(/[\s_-]+/).filter(Boolean);
  if (!parts.length) return '?';
  const letters = parts.length > 1 ? parts[0][0] + parts[1][0] : parts[0].slice(0, 2);
  return letters.toUpperCase();
}

export function avatarStyle(name = '') {
  const [a, b] = AVATAR_GRADS[hashStr(name) % AVATAR_GRADS.length];
  return `--avatar-bg: linear-gradient(135deg, ${a}, ${b})`;
}

export function avatar(name, size = 40) {
  return `<div class="avatar" style="--size:${size}px; ${avatarStyle(name)}">${esc(initials(name))}</div>`;
}

/** Аватар в кольце прогресса уровня. */
export function avatarRing(name, { size = 44, level = 1, pct = 0 } = {}) {
  const box = size + 8;
  const stroke = 3;
  const r = (box - stroke) / 2;
  const c = 2 * Math.PI * r;
  return `<div class="avatar-ring" style="width:${size}px;height:${size}px">
    <svg viewBox="0 0 ${box} ${box}">
      <circle class="ring-track" cx="${box / 2}" cy="${box / 2}" r="${r}" fill="none" stroke-width="${stroke}"/>
      <circle class="ring-fill" cx="${box / 2}" cy="${box / 2}" r="${r}" fill="none" stroke-width="${stroke}"
        stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - clamp(pct, 0, 100) / 100)}"/>
    </svg>
    ${avatar(name, size)}
    <span class="avatar-lvl">${level}</span>
  </div>`;
}

export function ring(pct, { size = 120, stroke = 10, color = 'url(#accentGrad)', cls = '' } = {}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return `<svg class="ring-progress ${cls}" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <circle class="ring-track" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke-width="${stroke}"/>
    <circle class="ring-fill" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}"
      stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - clamp(pct, 0, 100) / 100)}"/>
  </svg>`;
}

export const xpBar = (pct, cls = '') => `<div class="xpbar ${cls}"><i style="--p:${clamp(pct, 0, 100)}%"></i></div>`;
export const bar = (pct, cls = '') => `<div class="bar ${cls}"><i style="--p:${clamp(pct, 0, 100)}%"></i></div>`;

export function statTile({ label, value, unit = '', ic = null, sub = '', cls = '' }) {
  return `<div class="card tile stat ${cls}">
    <div class="stat-label">${ic ? icon(ic) : ''}${esc(label)}</div>
    <div class="stat-value">${value}${unit ? `<small>${esc(unit)}</small>` : ''}</div>
    ${sub ? `<div class="stat-sub dim">${sub}</div>` : ''}
  </div>`;
}

/** Шестигранный значок достижения с цветом редкости. */
export function badge(def, unlocked, size = 56) {
  return `<div class="badge rar-${def.rarity} ${unlocked ? 'is-on' : 'is-off'}" style="--s:${size}px" title="${esc(RARITY[def.rarity].title)}">
    <svg class="badge-hex" viewBox="0 0 64 64" aria-hidden="true">
      <path class="badge-hex-outer" d="M32 2.5 58 17.5v29L32 61.5 6 46.5v-29z"/>
      <path class="badge-hex-inner" d="M32 9 52.5 20.8v22.4L32 55 11.5 43.2V20.8z"/>
    </svg>
    <span class="badge-icon">${icon(unlocked ? def.icon : 'lock')}</span>
  </div>`;
}

export function emptyState({ ic = 'info', title, text = '', action = '' }) {
  return `<div class="empty">
    <div class="empty-icon">${icon(ic)}</div>
    <div class="empty-title">${esc(title)}</div>
    ${text ? `<p>${esc(text)}</p>` : ''}
    ${action}
  </div>`;
}

/**
 * Сегментированный переключатель.
 * options: [{ id, label, icon?, locked?, tip? }]
 */
export function seg(name, options, value, { cls = '' } = {}) {
  return `<div class="seg ${cls}" data-seg="${name}" role="radiogroup">
    ${options
      .map((o) => {
        const active = String(o.id) === String(value);
        return `<button type="button" role="radio" aria-checked="${active}" data-value="${o.id}"
          class="${active ? 'is-active' : ''} ${o.locked ? 'is-locked' : ''}" ${o.tip ? `data-tip="${esc(o.tip)}"` : ''}>
          ${o.locked ? icon('lock') : o.icon ? icon(o.icon) : ''}${esc(o.label)}
        </button>`;
      })
      .join('')}
  </div>`;
}

/** Делегирование кликов по сегментам: onSeg(root, (name, value, button) => …) */
export function onSeg(root, handler) {
  const listener = (e) => {
    const btn = e.target.closest('[data-seg] button');
    if (!btn || !root.contains(btn)) return;
    const group = btn.closest('[data-seg]');
    handler(group.dataset.seg, btn.dataset.value, btn, group);
  };
  root.addEventListener('click', listener);
  return () => root.removeEventListener('click', listener);
}

export function setSegValue(group, value) {
  group.querySelectorAll('button').forEach((b) => {
    const on = b.dataset.value === String(value);
    b.classList.toggle('is-active', on);
    b.setAttribute('aria-checked', on);
  });
}
