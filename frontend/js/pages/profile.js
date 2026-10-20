// Профиль и настройки: данные игрока, внешний вид, звук, клавиатура, цель дня, данные.

import { store } from '../core/store.js';
import { api } from '../api/index.js';
import { navigate, rerender } from '../core/router.js';
import { esc, fmtNum, fmtDuration, fmtPct, fmtDayShort } from '../core/utils.js';
import { rankFor, MODES, isUnlocked } from '../data/modes.js';
import { hardest, activityGrid } from '../game/analysis.js';
import { levelProgress } from '../game/scoring.js';
import { icon } from '../ui/icons.js';
import { seg, onSeg, setSegValue, avatarRing, xpBar } from '../ui/widgets.js';
import { toast } from '../ui/toast.js';
import { openModal } from '../ui/modal.js';
import { sound } from '../ui/sound.js';

const PROVIDER_LABEL = { email: 'Email', vk: 'VK ID', yandex: 'Яндекс ID', google: 'Google', github: 'GitHub', local: 'Гость' };

const switchRow = (key, title, desc, checked) => `
  <label class="setting">
    <div class="setting-text"><b>${title}</b><span>${desc}</span></div>
    <span class="switch"><input type="checkbox" data-switch="${key}" ${checked ? 'checked' : ''}><span class="switch-track"></span></span>
  </label>`;

const segRow = (title, desc, control) => `
  <div class="setting">
    <div class="setting-text"><b>${title}</b><span>${desc}</span></div>
    ${control}
  </div>`;

export default {
  name: 'profile',
  title: 'Профиль',
  render(root) {
    const draw = () => paint(root);
    draw();

    const offSeg = onSeg(root, (name, value, btn, group) => {
      setSegValue(group, value);
      const patch = { [name]: name === 'dailyGoalMin' ? Number(value) : value };
      store.updateSettings(patch);
    });

    const onChange = (e) => {
      const sw = e.target.closest('[data-switch]');
      if (sw) {
        store.updateSettings({ [sw.dataset.switch]: sw.checked });
        if (sw.dataset.switch === 'sound' && sw.checked) sound.achievement();
      }
      if (e.target.matches('[data-volume]')) {
        const v = Number(e.target.value) / 100;
        store.updateSettings({ volume: v });
        sound.key();
      }
    };
    const onInput = (e) => {
      if (e.target.matches('[data-volume]')) e.target.style.setProperty('--fill', `${e.target.value}%`);
    };

    const onClick = async (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (!act) return;
      if (act === 'logout') {
        await api.logout();
        toast({ title: 'Вы вышли из аккаунта', type: 'info', icon: 'logout' });
        navigate('/');
      } else if (act === 'edit-name') {
        editName(root);
      } else if (act === 'seed') {
        await api.seedDemo();
        toast({ title: 'Демо-история создана', text: '4 недели тренировок — загляните в статистику.', type: 'ok', icon: 'database' });
        rerender();
      } else if (act === 'reset') {
        confirmReset();
      }
    };

    root.addEventListener('change', onChange);
    root.addEventListener('input', onInput);
    root.addEventListener('click', onClick);
    const offUser = store.on('user', draw);

    return () => {
      offSeg();
      offUser();
    };
  },
};

function paint(root) {
  const { user, progress: p, settings: s } = store;
  const lp = levelProgress(p.xp);
  const achCount = Object.keys(p.achievements).length;
  const counted = p.history.filter((h) => h.chars >= 50);
  const bestAcc = counted.length ? Math.max(...counted.map((h) => h.accuracy)) : 0;
  const lang = (p.totals.langs.en || 0) > (p.totals.langs.ru || 0) ? 'en' : 'ru';
  const weak = (p.analysis?.[lang]?.chars ?? hardest(p.charStats[lang] || {}, { limit: 8 })).filter((r) => r.ch !== '␣').slice(0, 8);
  const cells = activityGrid(p, 14);
  const since = new Date(user.createdAt || p.createdAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });

  root.innerHTML = `
    <header class="page-head">
      <div>
        <div class="eyebrow">Аккаунт</div>
        <h1 class="h1">Профиль</h1>
      </div>
    </header>

    <section class="card profile-card">
      <div class="profile-main">
        ${avatarRing(user.name, { size: 88, level: lp.level, pct: lp.pct })}
        <div class="profile-id">
          <div class="profile-name-row">
            <h2 class="h2" data-name>${esc(user.name)}</h2>
            ${user.guest ? '' : `<button class="btn btn-ghost btn-icon btn-sm" data-act="edit-name" aria-label="Изменить имя">${icon('edit')}</button>`}
          </div>
          <div class="profile-meta">
            <span class="chip chip-accent">${icon('shield')}${esc(rankFor(lp.level).title)}</span>
            <span class="chip">${icon(user.guest ? 'user' : 'mail')}${esc(user.guest ? 'Гостевой режим' : user.provider === 'email' ? user.email : PROVIDER_LABEL[user.provider] || user.provider)}</span>
            <span class="chip">${icon('calendar')}с ${esc(since)}</span>
          </div>
          <div class="profile-xp">
            <div class="row"><b>Уровень ${lp.level}</b><span class="spacer"></span><span class="dim num">${fmtNum(lp.cur)} / ${fmtNum(lp.need)} XP</span></div>
            ${xpBar(lp.pct, 'bar-lg')}
          </div>
        </div>
        ${user.guest ? `
          <div class="profile-actions">
            <a class="btn btn-primary" href="#/register">${icon('user')}Создать аккаунт</a>
            <a class="btn btn-secondary" href="#/login">${icon('login')}Войти</a>
          </div>` : ''}
      </div>
      <div class="profile-stats">
        <div><b class="num">${fmtNum(p.totals.sessions)}</b><span>тренировок</span></div>
        <div><b class="num">${fmtDuration(p.totals.timeSec)}</b><span>практики</span></div>
        <div><b class="num">${fmtNum(p.totals.bestCpm)}</b><span>лучшая, зн/мин</span></div>
        <div><b class="num">${achCount}</b><span>достижений</span></div>
        <div><b class="num">${fmtNum(p.xp)}</b><span>всего XP</span></div>
        <div><b class="num">${bestAcc ? fmtPct(bestAcc) : '—'}</b><span>лучшая точность</span></div>
      </div>
    </section>

    <div class="profile-extra">
      <section class="card card-pad">
        <div class="card-head"><div class="card-title">${icon('alert')}Слабые символы</div><a class="card-link" href="#/coach">AI-тренер ${icon('chevronRight')}</a></div>
        ${weak.length ? `<div class="risk-keys">${weak.map((r) => `<span class="risk-key"><kbd>${esc(r.ch.toUpperCase())}</kbd><b>${fmtPct(r.rate * 100)}</b></span>`).join('')}</div>`
          : '<p class="dim">Пока мало данных — пройдите несколько тренировок.</p>'}
        <div class="card-title profile-sub">${icon('layers')}Открытые режимы</div>
        <div class="row wrap">${MODES.map((m) => `<span class="chip ${isUnlocked(m, lp.level, s.unlockAll) ? 'chip-ok' : ''}">${icon(isUnlocked(m, lp.level, s.unlockAll) ? m.icon : 'lock')}${esc(m.title)}</span>`).join('')}</div>
      </section>
      <section class="card card-pad">
        <div class="card-head"><div class="card-title">${icon('calendar')}Календарь занятий</div><span class="dim">${Object.keys(p.days).length} дн.</span></div>
        <div class="activity">
          <div class="activity-days"><span>Пн</span><span></span><span>Ср</span><span></span><span>Пт</span><span></span><span>Вс</span></div>
          <div class="activity-grid" style="--weeks:14">
            ${cells.map((c) => {
              const lvl = c.future ? -1 : c.minutes === 0 ? 0 : c.minutes < 5 ? 1 : c.minutes < 10 ? 2 : c.minutes < 20 ? 3 : 4;
              return `<i class="act-cell lvl-${lvl}" ${c.future ? '' : `data-tip="${fmtDayShort(c.ts)}: ${c.sessions ? `${c.sessions} трен.` : 'нет тренировок'}"`}></i>`;
            }).join('')}
          </div>
        </div>
      </section>
    </div>

    <div class="settings-grid">
      <section class="card card-pad">
        <div class="card-head"><div class="card-title">${icon('sun')}Внешний вид</div></div>
        ${segRow('Тема', 'Тёмная «кузница» или светлый «пергамент»', seg('theme', [{ id: 'light', label: 'Светлая', icon: 'sun' }, { id: 'system', label: 'Авто', icon: 'monitor' }, { id: 'dark', label: 'Тёмная', icon: 'moon' }], s.theme, { cls: 'seg-sm' }))}
        ${segRow('Эффекты', 'Искры, огонь комбо, конфетти', seg('effects', [{ id: 'full', label: 'Полные' }, { id: 'lite', label: 'Лёгкие' }, { id: 'off', label: 'Выкл' }], s.effects, { cls: 'seg-sm' }))}
        ${segRow('Размер текста', 'Шрифт в поле печати', seg('fontSize', [{ id: 's', label: 'S' }, { id: 'm', label: 'M' }, { id: 'l', label: 'L' }], s.fontSize, { cls: 'seg-sm' }))}
      </section>

      <section class="card card-pad">
        <div class="card-head"><div class="card-title">${icon('keyboard')}Тренировка</div></div>
        ${switchRow('sound', 'Звуки', 'Щелчки клавиш, сигнал ошибки, фанфары', s.sound)}
        <div class="setting ${s.sound ? '' : 'is-disabled'}">
          <div class="setting-text"><b>Громкость</b><span>${icon('volume')}</span></div>
          <input type="range" min="0" max="100" value="${Math.round(s.volume * 100)}" data-volume style="--fill:${Math.round(s.volume * 100)}%" aria-label="Громкость">
        </div>
        ${switchRow('showKeyboard', 'Экранная клавиатура', 'Подсветка следующей клавиши и пальца', s.showKeyboard)}
        ${switchRow('showHands', 'Схема рук', 'Какой палец нажимает клавишу', s.showHands)}
        ${segRow('Цель дня', 'Минут практики в день', seg('dailyGoalMin', [5, 10, 15, 30].map((m) => ({ id: m, label: `${m}` })), s.dailyGoalMin, { cls: 'seg-sm' }))}
      </section>

      <section class="card card-pad">
        <div class="card-head"><div class="card-title">${icon('cloud')}Синхронизация</div></div>
        <div class="sync-state ${user.guest ? '' : 'is-ok'}">
          <div class="icon-box">${icon(user.guest ? 'alert' : 'check')}</div>
          <div>
            <b>${user.guest ? 'Прогресс только на этом устройстве' : 'Прогресс привязан к аккаунту'}</b>
            <span class="dim">${user.guest ? 'Войдите, и всё, что вы натренировали, сохранится в аккаунте.' : 'Войдите с другого устройства — уровень, награды и статистика будут там же.'}</span>
          </div>
        </div>
        ${user.guest ? '' : `<button class="btn btn-secondary" data-act="logout">${icon('logout')}Выйти из аккаунта</button>`}
      </section>

      <section class="card card-pad">
        <div class="card-head"><div class="card-title">${icon('database')}Демо и данные</div></div>
        ${switchRow('unlockAll', 'Открыть все режимы', 'Для демонстрации: снять ограничения по уровню', s.unlockAll)}
        <div class="setting">
          <div class="setting-text"><b>Демо-история</b><span>4 недели тренировок для графиков и AI-тренера</span></div>
          <button class="btn btn-secondary btn-sm" data-act="seed">${icon('database')}Заполнить</button>
        </div>
        <div class="setting">
          <div class="setting-text"><b>Сбросить прогресс</b><span>Уровень, награды и статистика обнулятся</span></div>
          <button class="btn btn-danger btn-sm" data-act="reset">${icon('trash')}Сбросить</button>
        </div>
      </section>
    </div>`;
}

function editName(root) {
  const h = root.querySelector('[data-name]');
  const current = store.user.name;
  h.outerHTML = `<form class="name-form" data-name-form>
    <input class="input" name="name" value="${esc(current)}" maxlength="24" required aria-label="Имя">
    <button class="btn btn-primary btn-sm" type="submit">${icon('check')}</button>
  </form>`;
  const form = root.querySelector('[data-name-form]');
  const input = form.querySelector('input');
  input.focus();
  input.select();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = input.value.trim();
    if (name.length < 2) {
      toast({ title: 'Имя слишком короткое', type: 'err', icon: 'alert' });
      return;
    }
    try {
      await api.updateProfile({ name });
      toast({ title: 'Имя обновлено', type: 'ok', icon: 'check' });
    } catch (err) {
      toast({ title: err.message, type: 'err', icon: 'alert' });
    }
  });
}

function confirmReset() {
  const m = openModal(`
    <div class="confirm">
      <div class="icon-box icon-box-err">${icon('trash')}</div>
      <h2 class="h2">Сбросить весь прогресс?</h2>
      <p class="muted">Уровень, опыт, достижения, серия и статистика будут удалены. Это действие нельзя отменить.</p>
      <div class="row confirm-actions">
        <button class="btn btn-secondary" data-close>Отмена</button>
        <button class="btn btn-danger" data-confirm>${icon('trash')}Сбросить</button>
      </div>
    </div>`, { cls: 'modal-sm' });
  m.el.querySelector('[data-confirm]').addEventListener('click', async () => {
    await api.resetProgress();
    m.close();
    toast({ title: 'Прогресс сброшен', type: 'info', icon: 'rotate' });
    rerender();
  });
}
