// Вход и регистрация: email + пароль или соцсети. Прогресс гостя переносится в аккаунт.

import { api } from '../api/index.js';
import { navigate } from '../core/router.js';
import { esc } from '../core/utils.js';
import { icon, logoMark } from '../ui/icons.js';
import { toast } from '../ui/toast.js';
import { fx } from '../ui/effects.js';

const SOCIAL = [
  { id: 'vk', label: 'VK ID', mark: 'VK', color: '#0077ff' },
  { id: 'yandex', label: 'Яндекс', mark: 'Я', color: '#fc3f1d' },
  { id: 'google', label: 'Google', mark: 'G', color: '#4285f4' },
  { id: 'github', label: 'GitHub', mark: 'GH', color: '#24292f' },
];

const PHRASES = ['Печатай вслепую.', 'Собирай комбо ×5.', 'Ставь рекорды.', 'Стань героем рейтинга.'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export default {
  name: 'auth',
  title: 'Вход',
  render(root, { path }) {
    const isRegister = path === '/register';
    document.title = `${isRegister ? 'Регистрация' : 'Вход'} · Печать героя`;

    root.innerHTML = `
      <div class="auth">
        <aside class="auth-brand">
          <div class="auth-brand-top">${logoMark('auth-logo')}<span class="eyebrow">Киберрывок · 2026</span></div>
          <h1 class="auth-title">Печать<br><span class="grad-text">героя</span></h1>
          <div class="auth-type"><span data-type></span><i class="auth-caret"></i></div>
          <ul class="auth-features">
            <li>${icon('flame')}<div><b>Комбо и бонусы</b><span>Серия без ошибок умножает очки до ×5</span></div></li>
            <li>${icon('award')}<div><b>Уровни и награды</b><span>27 достижений и новые режимы с ростом уровня</span></div></li>
            <li>${icon('trophy')}<div><b>Рейтинг</b><span>Скорость, точность и опыт — за день, неделю, всё время</span></div></li>
          </ul>
        </aside>

        <section class="auth-panel card">
          <div class="auth-tabs" role="tablist">
            <a href="#/login" role="tab" class="${isRegister ? '' : 'is-active'}" aria-selected="${!isRegister}">Вход</a>
            <a href="#/register" role="tab" class="${isRegister ? 'is-active' : ''}" aria-selected="${isRegister}">Регистрация</a>
          </div>
          <h2 class="h2">${isRegister ? 'Создайте аккаунт героя' : 'С возвращением!'}</h2>
          <p class="muted auth-sub">${isRegister ? 'Прогресс сохранится в аккаунте и будет доступен на всех устройствах.' : 'Войдите, чтобы продолжить с того же уровня.'}</p>

          <form class="auth-form" novalidate data-form>
            ${isRegister ? field('name', 'Имя героя', 'text', 'user', 'Например, Быстрые_Пальцы', 'nickname') : ''}
            ${field('email', 'Email', 'email', 'mail', 'you@example.com', 'email')}
            ${field('password', 'Пароль', 'password', 'key', isRegister ? 'Не короче 6 символов' : 'Ваш пароль', isRegister ? 'new-password' : 'current-password')}
            <button class="btn btn-primary btn-lg auth-submit" type="submit">${isRegister ? 'Создать аккаунт' : 'Войти'}${icon('arrowRight')}</button>
          </form>

          <div class="auth-divider"><span>или через</span></div>
          <div class="social-grid">
            ${SOCIAL.map((s) => `<button class="btn btn-secondary social-btn" type="button" data-social="${s.id}"><span class="social-mark" style="--sc:${s.color}">${esc(s.mark)}</span>${esc(s.label)}</button>`).join('')}
          </div>

          <a class="auth-guest" href="#/train">${icon('play')}Продолжить без аккаунта</a>
        </section>
      </div>`;

    const form = root.querySelector('[data-form]');
    const submit = form.querySelector('[type="submit"]');

    function setError(name, message) {
      const f = form.querySelector(`[data-field="${name}"]`);
      if (!f) return;
      f.classList.toggle('is-invalid', !!message);
      f.querySelector('.field-error').textContent = message || '';
    }

    function validate(data) {
      const errors = {};
      if (isRegister && data.name.trim().length < 2) errors.name = 'Минимум 2 символа';
      if (!EMAIL_RE.test(data.email.trim())) errors.email = 'Проверьте адрес почты';
      if (data.password.length < 6) errors.password = 'Минимум 6 символов';
      return errors;
    }

    async function success(res, title) {
      fx.confetti(90);
      toast({ title, text: res.migrated ? 'Прогресс из гостевого режима перенесён в аккаунт.' : '', type: 'ok', icon: 'check' });
      navigate('/');
    }

    form.addEventListener('input', (e) => {
      if (e.target.name) setError(e.target.name, '');
    });

    form.addEventListener('click', (e) => {
      const toggle = e.target.closest('[data-toggle-pass]');
      if (!toggle) return;
      const input = form.querySelector('[name="password"]');
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      toggle.innerHTML = icon(show ? 'eyeOff' : 'eye');
      toggle.setAttribute('aria-label', show ? 'Скрыть пароль' : 'Показать пароль');
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(form));
      data.name ??= '';
      const errors = validate(data);
      ['name', 'email', 'password'].forEach((n) => setError(n, errors[n]));
      if (Object.keys(errors).length) {
        form.querySelector('.is-invalid input')?.focus();
        return;
      }
      submit.disabled = true;
      try {
        const res = isRegister ? await api.register(data) : await api.login(data);
        await success(res, isRegister ? `Добро пожаловать, ${res.user.name}!` : `С возвращением, ${res.user.name}!`);
      } catch (err) {
        if (err.field) setError(err.field, err.message);
        else toast({ title: 'Ошибка', text: err.message, type: 'err', icon: 'alert' });
      } finally {
        submit.disabled = false;
      }
    });

    root.querySelectorAll('[data-social]').forEach((btn) =>
      btn.addEventListener('click', async () => {
        try {
          const res = await api.loginSocial(btn.dataset.social);
          await success(res, `Вход выполнен: ${res.user.name}`);
        } catch (err) {
          toast({ title: 'Не удалось войти', text: err.message, type: 'err', icon: 'alert' });
        }
      }),
    );

    // Анимация печати в бренд-панели
    const typeEl = root.querySelector('[data-type]');
    let phrase = 0;
    let pos = 0;
    let erasing = false;
    const timer = setInterval(() => {
      const text = PHRASES[phrase];
      if (!erasing) {
        pos++;
        if (pos > text.length + 12) erasing = true;
      } else {
        pos -= 2;
        if (pos <= 0) {
          pos = 0;
          erasing = false;
          phrase = (phrase + 1) % PHRASES.length;
        }
      }
      const shown = text.slice(0, Math.min(pos, text.length));
      typeEl.innerHTML = `<span class="ok">${esc(shown)}</span><span class="rest">${esc(text.slice(shown.length))}</span>`;
    }, 85);

    root.querySelector(isRegister ? '[name="name"]' : '[name="email"]')?.focus();
    return () => clearInterval(timer);
  },
};

function field(name, label, type, ic, placeholder, autocomplete) {
  return `<div class="field" data-field="${name}">
    <label class="field-label" for="f-${name}">${label}</label>
    <div class="input-wrap">
      ${icon(ic, 'input-icon')}
      <input class="input has-icon" id="f-${name}" name="${name}" type="${type}" placeholder="${placeholder}" autocomplete="${autocomplete}" ${type === 'email' ? 'inputmode="email"' : ''}>
      ${type === 'password' ? `<button class="input-action" type="button" data-toggle-pass aria-label="Показать пароль">${icon('eye')}</button>` : ''}
    </div>
    <div class="field-error" aria-live="polite"></div>
  </div>`;
}
