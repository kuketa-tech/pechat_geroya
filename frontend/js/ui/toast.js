// Всплывающие уведомления (в т.ч. о полученных достижениях).

import { icon } from './icons.js';
import { esc } from '../core/utils.js';
import { badge } from './widgets.js';

const MAX_VISIBLE = 4;

function root() {
  return document.getElementById('toasts');
}

function dismiss(el) {
  if (!el.isConnected || el.classList.contains('is-leaving')) return;
  el.classList.add('is-leaving');
  el.addEventListener('animationend', () => el.remove(), { once: true });
}

/**
 * @param {{ title: string, text?: string, type?: 'ok'|'err'|'info'|'accent', icon?: string, timeout?: number }} opts
 */
export function toast({ title, text = '', type = 'accent', icon: ic = 'info', timeout = 3800, html = null, cls = '', style = '' }) {
  const host = root();
  if (!host) return;
  const el = document.createElement('div');
  el.className = `toast toast-${type} ${cls}`;
  el.setAttribute('role', 'status');
  if (style) el.style.cssText = style;
  el.innerHTML = `
    <div class="toast-icon">${html || icon(ic)}</div>
    <div>
      <div class="toast-title">${esc(title)}</div>
      ${text ? `<div class="toast-text">${esc(text)}</div>` : ''}
    </div>`;
  el.addEventListener('click', () => dismiss(el));
  host.appendChild(el);
  while (host.children.length > MAX_VISIBLE) host.firstElementChild.remove();
  setTimeout(() => dismiss(el), timeout);
}

export function achievementToast(def) {
  toast({
    title: def.title,
    text: `Достижение получено · ${def.desc}`,
    html: badge(def, true, 46),
    cls: 'toast-ach',
    style: `--rar: var(--rar-${def.rarity})`,
    timeout: 5200,
  });
}
