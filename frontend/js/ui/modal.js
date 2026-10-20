// Модальные окна: openModal(html, { onClose }) → { el, close }.

import { icon } from './icons.js';

let current = null;

export function openModal(content, { onClose, cls = '', closable = true } = {}) {
  current?.close(true);

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal ${cls}" role="dialog" aria-modal="true">
      ${closable ? `<button class="btn btn-ghost btn-icon btn-sm modal-close" data-close aria-label="Закрыть">${icon('x')}</button>` : ''}
      ${content}
    </div>`;
  document.getElementById('modalRoot').appendChild(backdrop);
  const modal = backdrop.querySelector('.modal');

  const onKey = (e) => {
    if (e.key === 'Escape' && closable) {
      e.preventDefault();
      close();
    }
  };

  function close(immediate = false) {
    if (!backdrop.isConnected) return;
    document.removeEventListener('keydown', onKey, true);
    if (current === handle) current = null;
    if (immediate) {
      backdrop.remove();
    } else {
      backdrop.classList.add('is-leaving');
      modal.classList.add('is-leaving');
      setTimeout(() => backdrop.remove(), 200);
    }
    onClose?.();
  }

  backdrop.addEventListener('mousedown', (e) => {
    if (e.target === backdrop && closable) close();
  });
  modal.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) close();
  });
  document.addEventListener('keydown', onKey, true);

  const handle = { el: modal, close };
  current = handle;
  return handle;
}

export const isModalOpen = () => !!current;
