// Главная: уровень, серия дней, дневная цель, задания, режимы, последние тренировки.

import { store } from '../core/store.js';
import { navigate } from '../core/router.js';
import { esc, fmtNum, fmtPct, fmtDuration, greeting, timeAgo, dayKey, addDays, plural, clamp } from '../core/utils.js';
import { MODES, LANGS, CODE_LANGS, DURATIONS, rankFor, isUnlocked, modeById } from '../data/modes.js';
import { ACHIEVEMENTS } from '../data/achievements.js';
import { questDef } from '../game/quests.js';
import { levelProgress } from '../game/scoring.js';
import { activeStreak, todayStats } from '../game/progression.js';
import { icon } from '../ui/icons.js';
import { ring, bar, badge, emptyState } from '../ui/widgets.js';
import { lineChart } from '../ui/charts.js';
import { api } from '../api/index.js';
import { riskFor } from '../game/analysis.js';
import { startAction } from './coach.js';

const WEEK = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

export default {
  name: 'dashboard',
  title: 'Главная',
  render(root) {
    const draw = () => paint(root);
    let chart = draw();
    const off = store.on('progress', () => {
      chart?.destroy();
      chart = draw();
    });
    const onKey = (e) => {
      if (e.key === 'Enter' && !e.target.closest('input, textarea, button, a')) navigate('/train');
    };
    document.addEventListener('keydown', onKey);
    return () => {
      off();
      chart?.destroy();
      document.removeEventListener('keydown', onKey);
    };
  },
};

/** Главная рекомендация AI-тренера; без сервера — по локальной статистике ошибок. */
async function fillAiCard(root) {
  const card = root.querySelector('[data-ai-card] .ai-card-body');
  let rec = null;
  try {
    rec = (await api.insights())?.personal?.recommendations?.[0] || null;
  } catch {
    rec = null;
  }
  if (!card.isConnected) return;
  if (!rec) {
    const lang = store.settings.train.lang;
    const risk = riskFor(store, lang).chars;
    const keys = Object.entries(risk).filter(([ch]) => /\p{L}/u.test(ch)).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([ch]) => ch.toUpperCase());
    rec = keys.length
      ? { title: `Умная тренировка: ${keys.join(', ')}`, text: 'Слова подобраны под клавиши, на которых вы ошибаетесь чаще всего.', action: { mode: 'smart', lang } }
      : { title: 'Начните с разминки', text: 'После пары тренировок AI-тренер найдёт ваши слабые клавиши и подберёт упражнения.', action: { mode: 'words' } };
  }
  card.innerHTML = `
    <div class="eyebrow">AI-тренер рекомендует</div>
    <h3 class="rec-title">${esc(rec.title)}</h3>
    <p class="rec-text">${esc(rec.text)}</p>
    <div class="row">
      <button class="btn btn-primary btn-sm" data-ai-go>${icon('play')}Начать</button>
      <a class="btn btn-ghost btn-sm" href="#/coach">${icon('sparkles')}Открыть AI-тренера</a>
    </div>`;
  card.querySelector('[data-ai-go]').addEventListener('click', () => startAction(rec.action));
}

function questValue(def, v) {
  if (def.unit === 'time') return fmtDuration(v);
  if (def.unit === '%') return `${Math.floor(v)}%`;
  return fmtNum(v);
}

function paint(root) {
  const { user, progress: p, settings } = store;
  const lp = levelProgress(p.xp);
  const rank = rankFor(lp.level);
  const streak = activeStreak(p);
  const today = todayStats(p);
  const goalSec = settings.dailyGoalMin * 60;
  const goalPct = clamp((today.timeSec / goalSec) * 100, 0, 100);
  const train = settings.train;
  const mode = modeById(train.mode);
  const trainSub = train.mode === 'code'
    ? CODE_LANGS.find((c) => c.id === train.codeLang)?.title
    : LANGS.find((l) => l.id === train.lang)?.title;
  const durLabel = DURATIONS.find((d) => d.id === Number(train.duration))?.label;
  const now = new Date();
  const dateLabel = now.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });

  // неделя: пн..вс текущей недели
  const dow = (now.getDay() + 6) % 7;
  const week = WEEK.map((label, i) => {
    const ts = addDays(now.getTime(), i - dow);
    const key = dayKey(ts);
    return { label, done: !!p.days[key]?.sessions, today: i === dow, future: i > dow };
  });

  const nextAch = ACHIEVEMENTS
    .filter((a) => !p.achievements[a.id])
    .map((a) => {
      const [cur, target] = a.progress(p);
      return { a, cur: Math.min(cur, target), target, ratio: Math.min(cur, target) / target };
    })
    .sort((x, y) => y.ratio - x.ratio)
    .slice(0, 3);

  const recent = p.history.slice(0, 5);
  const dailyDone = p.history.some((h) => h.challenge === dayKey());

  root.innerHTML = `
    ${user.guest ? `
      <div class="guest-banner card">
        <div class="icon-box">${icon('cloud')}</div>
        <div class="guest-banner-text">
          <b>Вы тренируетесь как гость</b>
          <span>Прогресс хранится только в этом браузере. Войдите, чтобы попасть в рейтинг и синхронизировать устройства — текущий прогресс перенесётся.</span>
        </div>
        <div class="row">
          <a class="btn btn-secondary btn-sm" href="#/login">Войти</a>
          <a class="btn btn-primary btn-sm" href="#/register">Создать аккаунт</a>
        </div>
      </div>` : ''}

    <header class="page-head">
      <div>
        <div class="eyebrow">${esc(dateLabel)}</div>
        <h1 class="h1">${greeting()}, <span class="grad-text">${esc(user.guest ? 'герой' : user.name)}</span></h1>
        <p class="muted">${p.totals.sessions ? `${esc(rank.title)} · ${fmtNum(p.totals.chars)} символов напечатано. Продолжим?` : 'Первая тренировка займёт минуту. Пальцы — на ФЫВА и ОЛДЖ, взгляд — на экран.'}</p>
      </div>
    </header>

    <div class="dash-grid">
      <section class="card hero-card">
        <div class="hero-keys" aria-hidden="true">${'ГЕРОЙ'.split('').map((c, i) => `<span style="--i:${i}">${c}</span>`).join('')}</div>
        <div class="hero-body">
          <div class="eyebrow">Следующая тренировка</div>
          <h2 class="hero-title">${esc(mode.title)} <span class="dim">·</span> ${esc(trainSub || '')} <span class="dim">·</span> ${esc(durLabel || '')}</h2>
          <p class="muted">${p.modeBest[train.mode] ? `Лучший результат в режиме — <b class="text-strong">${p.modeBest[train.mode]} зн/мин</b>. Побьёте?` : 'Таймер стартует с первой клавиши. Ошибка обнуляет комбо — цельтесь в точность.'}</p>
          <div class="hero-actions">
            <a class="btn btn-primary btn-lg" href="#/train">${icon('play')}Начать тренировку<span class="kbd">Enter</span></a>
            <a class="btn btn-ghost" href="#/stats">${icon('chart')}Мой прогресс</a>
          </div>
        </div>
        <div class="hero-level">
          <div class="level-ring">
            ${ring(lp.pct, { size: 148, stroke: 11 })}
            <div class="level-ring-inner">
              <span class="level-ring-label">уровень</span>
              <span class="level-ring-num">${lp.level}</span>
            </div>
          </div>
          <div class="hero-rank">${esc(rank.title)}</div>
          <div class="dim hero-xp">${fmtNum(lp.cur)} / ${fmtNum(lp.need)} XP</div>
        </div>
      </section>

      <section class="card card-pad streak-card ${streak ? 'is-hot' : ''}">
        <div class="card-head">
          <div class="card-title">${icon('flame')}Серия</div>
          <span class="chip">${icon('trophy')}рекорд ${p.streak.best}</span>
        </div>
        <div class="streak-main">
          <div class="streak-flame">${icon('flame')}</div>
          <div>
            <div class="streak-num">${streak}</div>
            <div class="dim">${plural(streak, 'день', 'дня', 'дней')} подряд</div>
          </div>
        </div>
        <div class="week-dots">
          ${week.map((d) => `<div class="week-dot ${d.done ? 'is-done' : ''} ${d.today ? 'is-today' : ''} ${d.future ? 'is-future' : ''}"><i>${d.done ? icon('check') : ''}</i><span>${d.label}</span></div>`).join('')}
        </div>
        <p class="streak-hint dim">${today.sessions ? 'Сегодня засчитано — серия в безопасности.' : streak ? 'Потренируйтесь сегодня, чтобы не потерять серию.' : 'Начните серию — занимайтесь каждый день.'}</p>
      </section>

      <section class="card card-pad goal-card">
        <div class="card-head">
          <div class="card-title">${icon('target')}Цель дня</div>
          <a class="card-link" href="#/profile">${settings.dailyGoalMin} мин ${icon('chevronRight')}</a>
        </div>
        <div class="goal-ring">
          ${ring(goalPct, { size: 132, stroke: 12, color: 'url(#okGrad)' })}
          <div class="goal-ring-inner">
            <b class="num">${Math.floor(today.timeSec / 60)}</b>
            <span>из ${settings.dailyGoalMin} мин</span>
          </div>
        </div>
        <div class="goal-meta">
          <div><b class="num">${today.sessions}</b><span>${plural(today.sessions, 'тренировка', 'тренировки', 'тренировок')}</span></div>
          <div><b class="num">${fmtNum(today.xp)}</b><span>XP сегодня</span></div>
        </div>
      </section>

      <section class="card card-pad quests-card">
        <div class="card-head">
          <div class="card-title">${icon('swords')}Задания дня</div>
          <span class="dim quests-reset">обновятся в полночь</span>
        </div>
        <ul class="quests">
          ${p.quests.items.map((item) => {
            const def = questDef(item.id);
            if (!def) return '';
            const pct = (item.progress / def.target) * 100;
            return `<li class="quest ${item.done ? 'is-done' : ''}">
              <div class="quest-icon">${icon(item.done ? 'check' : def.icon)}</div>
              <div class="quest-body">
                <div class="quest-top"><span class="quest-title">${esc(def.title)}</span><span class="quest-val num">${questValue(def, item.progress)} / ${questValue(def, def.target)}</span></div>
                ${bar(pct, item.done ? 'bar-ok' : '')}
              </div>
              <div class="quest-reward">+${def.reward}<small>XP</small></div>
            </li>`;
          }).join('')}
        </ul>
      </section>
    </div>

    <div class="dash-ai">
      <section class="card ai-card" data-ai-card>
        <div class="ai-orb">${icon('sparkles')}</div>
        <div class="ai-card-body">
          <div class="eyebrow">AI-тренер рекомендует</div>
          <h3 class="rec-title">Анализируем ваши тренировки…</h3>
        </div>
      </section>
      <section class="card daily-card ${dailyDone ? 'is-done' : ''}">
        <div class="row"><div class="icon-box">${icon(dailyDone ? 'check' : 'star')}</div><div class="eyebrow">Испытание дня</div></div>
        <h3 class="rec-title">${dailyDone ? 'Испытание пройдено — можно улучшить результат' : 'Один текст для всех игроков'}</h3>
        <p class="rec-text">${dailyDone ? 'В рейтинг идёт лучшая попытка за сегодня.' : 'Сегодняшний текст одинаков у всех. Пройдите его и сравните себя с другими в рейтинге испытания.'}</p>
        <div class="row">
          <a class="btn btn-primary btn-sm" href="#/train?mode=daily">${icon('play')}${dailyDone ? 'Ещё попытка' : 'Принять вызов'}</a>
          <a class="btn btn-ghost btn-sm" href="#/leaderboard?metric=daily">${icon('trophy')}Рейтинг</a>
        </div>
      </section>
    </div>

    <section class="dash-section">
      <div class="section-head">
        <h2 class="h2">Режимы</h2>
        <span class="dim">Новые режимы и сложности открываются с ростом уровня</span>
      </div>
      <div class="modes-grid">
        ${MODES.map((m) => {
          const open = isUnlocked(m, lp.level, settings.unlockAll);
          return `<a class="mode-card card ${open ? '' : 'is-locked'}" href="${open ? `#/train?mode=${m.id}` : '#/'}" data-mode="${m.id}" data-open="${open}">
            <div class="mode-glyph">${esc(m.glyph)}</div>
            <div class="mode-title">${esc(m.title)}</div>
            <div class="mode-desc">${esc(m.desc)}</div>
            <div class="mode-foot">
              ${open
                ? `<span class="chip">${icon('zap')}${p.modeBest[m.id] ? `${p.modeBest[m.id]} зн/мин` : 'не пройдено'}</span><span class="mode-go">${icon('arrowRight')}</span>`
                : `<span class="chip chip-warn">${icon('lock')}с ${m.unlock} уровня</span>`}
            </div>
          </a>`;
        }).join('')}
      </div>
    </section>

    <div class="dash-bottom">
      <section class="card card-pad recent-card">
        <div class="card-head">
          <div class="card-title">${icon('clock')}Последние тренировки</div>
          <a class="card-link" href="#/stats">Вся статистика ${icon('chevronRight')}</a>
        </div>
        ${recent.length ? `
          <div class="chart-box chart-spark"><canvas data-spark></canvas></div>
          <ul class="recent-list">
            ${recent.map((h) => {
              const m = modeById(h.mode);
              return `<li class="recent-item">
                <div class="icon-box">${icon(m.icon)}</div>
                <div class="recent-body">
                  <b>${esc(m.title)} <span class="dim">· ${h.mode === 'code' ? esc(CODE_LANGS.find((c) => c.id === h.codeLang)?.title || '') : h.lang.toUpperCase()}</span></b>
                  <span class="dim">${timeAgo(h.ts)} · ${fmtDuration(h.duration)}</span>
                </div>
                <div class="recent-metric"><b class="num">${h.cpm}</b><span>зн/мин</span></div>
                <span class="chip ${h.accuracy >= 95 ? 'chip-ok' : h.accuracy >= 88 ? 'chip-warn' : 'chip-err'}">${fmtPct(h.accuracy)}</span>
              </li>`;
            }).join('')}
          </ul>` : emptyState({ ic: 'keyboard', title: 'Пока пусто', text: 'Здесь появятся ваши тренировки и график скорости.', action: '<a class="btn btn-primary btn-sm" href="#/train">Начать первую</a>' })}
      </section>

      <section class="card card-pad next-ach-card">
        <div class="card-head">
          <div class="card-title">${icon('award')}Ближайшие награды</div>
          <a class="card-link" href="#/achievements">Все ${icon('chevronRight')}</a>
        </div>
        <ul class="next-ach">
          ${nextAch.map(({ a, cur, target, ratio }) => `
            <li>
              ${badge(a, false, 44)}
              <div class="next-ach-body">
                <div class="next-ach-top"><b>${esc(a.title)}</b><span class="dim num">${fmtNum(cur)}/${fmtNum(target)}</span></div>
                <span class="dim">${esc(a.desc)}</span>
                ${bar(ratio * 100)}
              </div>
            </li>`).join('')}
        </ul>
      </section>
    </div>`;

  fillAiCard(root);

  root.querySelectorAll('.mode-card.is-locked').forEach((card) =>
    card.addEventListener('click', (e) => {
      e.preventDefault();
      card.classList.remove('is-denied');
      void card.offsetWidth;
      card.classList.add('is-denied');
    }),
  );

  const spark = root.querySelector('[data-spark]');
  if (!spark) return null;
  const last = p.history.slice(0, 20).reverse();
  return lineChart(spark, {
    labels: last.map((h) => new Date(h.ts).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })),
    datasets: [{ label: 'Скорость', data: last.map((h) => h.cpm), color: 'accent', fill: true, points: 2.5 }],
    unit: ' зн/мин',
    compact: true,
  });
}
