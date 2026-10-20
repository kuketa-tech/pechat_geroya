"""ML-сервис: обучение моделей по данным из БД и выводы для AI-тренера.

Два уровня:
  • общий — модели по всем игрокам: закономерности ошибок, самые трудные клавиши,
    средняя кривая обучения, группы стилей печати, детектор автоматического ввода;
  • персональный — ваша модель ошибок (поправка к общей), прогноз скорости,
    ваш стиль относительно всех, ритм по пальцам и рекомендации.

Общие модели обучаются лениво и кэшируются в памяти процесса: переобучение — не чаще
раза в GLOBAL_TTL_MS или когда накопилось заметно больше новых данных.
"""

from __future__ import annotations

import json
import sqlite3
import threading
from collections import defaultdict

import numpy as np

from . import error_model, forecast, rhythm, style
from .features import median_interval, session_rows
from .layout import FINGER_NAMES, FINGER_ORDER, key_info

GLOBAL_TTL_MS = 10 * 60_000
RETRAIN_AFTER_NEW = 25
GLOBAL_SESSIONS = 3000
PERSONAL_SESSIONS = 80
MIN_GLOBAL_SAMPLES = 400
MIN_PERSONAL_SAMPLES = 150
STYLE_DAYS = 60
DAY_MS = 86_400_000

_lock = threading.Lock()
_cache: dict = {'state': None, 'at': 0, 'n': -1}


# ---------------- данные ----------------

def _keylog_rows(conn: sqlite3.Connection, user_id: str | None, limit: int) -> list[sqlite3.Row]:
    where = 'keylog IS NOT NULL AND flagged = 0' + (' AND user_id = ?' if user_id else '')
    args = (user_id, limit) if user_id else (limit,)
    return conn.execute(
        f'SELECT user_id, ts, lang, keylog FROM trainings WHERE {where} ORDER BY ts DESC LIMIT ?', args
    ).fetchall()


def _dataset(rows: list[sqlite3.Row]) -> dict:
    """Строки признаков из логов, темп — относительно медианы каждого игрока."""
    by_user = defaultdict(list)
    for r in rows:
        by_user[r['user_id']].append(r)
    X, y, chars, prevs, gaps, langs, users, sess = [], [], [], [], [], [], [], []
    for uid_, urows in by_user.items():
        logs = [json.loads(r['keylog']) for r in urows]
        med = median_interval(logs)
        for r, log in zip(urows, logs):
            xs, ys, cs, ps, gs = session_rows(log, r['lang'], med)
            X.extend(xs)
            y.extend(ys)
            chars.extend(cs)
            prevs.extend(ps)
            gaps.extend(gs)
            langs.extend([r['lang']] * len(ys))
            users.extend([uid_] * len(ys))
            sess.extend([r['ts']] * len(ys))
    return {
        'X': np.array(X, dtype=np.float32) if X else np.zeros((0, 1), dtype=np.float32),
        'y': np.array(y, dtype=np.float64),
        'chars': chars, 'prevs': prevs, 'gaps': np.array(gaps, dtype=float), 'langs': langs,
        'users': users, 'ts': np.array(sess, dtype=np.int64),
    }


def _risk_by_char(model: error_model.Model, data: dict, mask: np.ndarray | None = None) -> dict[str, dict]:
    """Риск по символам для каждой раскладки: средние предсказания на реальных контекстах."""
    p = model.predict(data['X']) if len(data['y']) else np.zeros(0)
    out = {}
    for lang in ('ru', 'en'):
        pairs = defaultdict(list)
        for i, (ch, prev, lg) in enumerate(zip(data['chars'], data['prevs'], data['langs'])):
            if lg != lang or (mask is not None and not mask[i]):
                continue
            if prev and prev.isalpha() and ch.isalpha():
                pairs[prev.lower() + ch.lower()].append(p[i])
        chars = error_model.char_risk(model, lang)
        bigrams = {bg: round(float(np.mean(v)), 4) for bg, v in pairs.items() if len(v) >= 3}
        out[lang] = {'chars': chars, 'bigrams': bigrams}
    return out


def _top_keys(risk: dict[str, float], limit: int = 8) -> list[dict]:
    letters = [(ch, p) for ch, p in risk.items() if ch.isalpha()]
    base = float(np.mean([p for _, p in letters])) if letters else 0
    return [{'ch': ch, 'p': p, 'lift': round(p / base, 2) if base else None}
            for ch, p in sorted(letters, key=lambda kv: -kv[1])[:limit]]


def _curve_points(rows: list[sqlite3.Row]) -> list[tuple[float, float]]:
    """(минуты практики до тренировки, скорость) по засчитанным тренировкам."""
    pts, minutes = [], 0.0
    for r in rows:
        if r['chars'] >= 20 and not r['flagged']:
            pts.append((minutes, float(r['cpm'])))
        minutes += r['duration'] / 60
    return pts


def _player_rhythm(logs: list[dict]) -> float | None:
    cvs = []
    for log in logs:
        g = rhythm.gaps_of(log['t'])
        if len(g) >= 30 and g.mean() > 0:
            cvs.append(g.std() / g.mean())
    return float(max(0.0, 1 - np.median(cvs))) if cvs else None


# ---------------- общий уровень ----------------

def _train_global(conn: sqlite3.Connection, now: int) -> dict:
    rows = _keylog_rows(conn, None, GLOBAL_SESSIONS)
    data = _dataset(rows)
    state: dict = {'model': None, 'auc': None, 'samples': int(len(data['y']))}

    if len(data['y']) >= MIN_GLOBAL_SAMPLES and data['y'].sum() >= 20:
        rng = np.random.default_rng(0)
        sess_ids = np.unique(data['ts'])
        test_sess = set(rng.choice(sess_ids, size=max(1, len(sess_ids) // 5), replace=False).tolist())
        test = np.array([t in test_sess for t in data['ts']])
        holdout = error_model.fit_global(data['X'][~test], data['y'][~test])
        state['auc'] = error_model.auc(data['y'][test], holdout.predict(data['X'][test]))
        state['model'] = error_model.fit_global(data['X'], data['y'])
        state['risk'] = _risk_by_char(state['model'], data)
        state['errorRate'] = round(float(data['y'].mean()), 4)

    # детектор автоматического ввода — по ритму реальных сессий
    real = [f for f in (rhythm.features(json.loads(r['keylog'])['t']) for r in rows[:1500]) if f is not None]
    state['detector'] = rhythm.train_detector(real)

    # стиль печати — по тренировкам последних STYLE_DAYS дней
    since = now - STYLE_DAYS * DAY_MS
    trows = conn.execute(
        'SELECT user_id, cpm, accuracy, duration, mode FROM trainings WHERE ts >= ? AND chars >= 20 AND flagged = 0',
        (since,),
    ).fetchall()
    per_user = defaultdict(list)
    for r in trows:
        per_user[r['user_id']].append(dict(r))
    logs_by_user = defaultdict(list)
    for r in rows:
        logs_by_user[r['user_id']].append(json.loads(r['keylog']))
    players = {}
    for uid_, urows in per_user.items():
        feats = style.player_features(urows, _player_rhythm(logs_by_user.get(uid_, [])))
        if feats:
            players[uid_] = feats
    state['style'] = style.fit(players)
    state['players'] = players

    # средняя кривая обучения
    curves = []
    for (uid_,) in conn.execute('SELECT DISTINCT user_id FROM trainings').fetchall()[:300]:
        urows = conn.execute(
            'SELECT cpm, chars, duration, flagged FROM trainings WHERE user_id = ? ORDER BY ts', (uid_,)
        ).fetchall()
        pts = _curve_points(urows)
        if len(pts) >= 5:
            curves.append(pts)
    state['curve'] = forecast.population_curve(curves)

    totals = conn.execute(
        "SELECT COUNT(DISTINCT t.user_id) AS players, COUNT(*) AS sessions, "
        "SUM(t.keylog IS NOT NULL) AS logged, SUM(t.flagged) AS flagged, AVG(t.cpm) AS cpm, AVG(t.accuracy) AS acc "
        "FROM trainings t"
    ).fetchone()
    state['dataset'] = {
        'players': totals['players'] or 0, 'sessions': totals['sessions'] or 0,
        'loggedSessions': totals['logged'] or 0, 'keystrokes': int(len(data['y'])),
        'flagged': totals['flagged'] or 0,
        'avgCpm': round(totals['cpm'] or 0), 'avgAccuracy': round(totals['acc'] or 0, 1),
    }
    hist = conn.execute(
        'SELECT MIN(cpm / 50, 12) AS bucket, COUNT(*) AS n FROM trainings WHERE chars >= 20 AND flagged = 0 GROUP BY bucket'
    ).fetchall()
    state['speedHist'] = [{'from': int(r['bucket']) * 50, 'n': r['n']} for r in hist]
    state['trainedAt'] = now
    return state


def global_state(conn: sqlite3.Connection, now: int) -> dict:
    n = conn.execute('SELECT COUNT(*) FROM trainings WHERE keylog IS NOT NULL').fetchone()[0]
    with _lock:
        st = _cache['state']
        fresh = st is not None and now - _cache['at'] < GLOBAL_TTL_MS and n - _cache['n'] < RETRAIN_AFTER_NEW
        if not fresh:
            _cache.update(state=_train_global(conn, now), at=now, n=n)
        return _cache['state']


def public_global(g: dict) -> dict:
    model = g.get('model')
    return {
        'ready': model is not None,
        'auc': g.get('auc'),
        'samples': g.get('samples', 0),
        'errorRate': g.get('errorRate'),
        'factors': model.factors() if model else [],
        'topKeys': {lang: _top_keys(g['risk'][lang]['chars']) for lang in ('ru', 'en')} if model else {},
        'risk': {lang: g['risk'][lang]['chars'] for lang in ('ru', 'en')} if model else {},
        'styles': style.describe_population(g.get('style')),
        'curve': g.get('curve'),
        'dataset': g.get('dataset'),
        'speedHist': g.get('speedHist', []),
        'trainedAt': g.get('trainedAt'),
    }


# ---------------- персональный уровень ----------------

def _rhythm_stats(data: dict) -> dict | None:
    gaps = data['gaps']
    valid = ~np.isnan(gaps)
    if valid.sum() < 50:
        return None
    by_finger = defaultdict(list)
    by_char = defaultdict(list)
    for i in np.where(valid)[0]:
        info = key_info(data['chars'][i], data['langs'][i])
        if info:
            by_finger[info[2]].append(gaps[i])
        by_char[data['chars'][i].lower()].append(gaps[i])
    fingers = [{'id': f, 'label': FINGER_NAMES[f], 'ms': round(float(np.median(by_finger[f])))}
               for f in FINGER_ORDER if len(by_finger[f]) >= 5]
    slow = sorted(((ch, float(np.median(v))) for ch, v in by_char.items() if len(v) >= 6 and ch.strip()),
                  key=lambda kv: -kv[1])[:6]
    g = gaps[valid]
    return {
        'medianMs': round(float(np.median(g))),
        'consistency': round(max(0.0, 1 - float(g.std() / g.mean())) * 100),
        'fingers': fingers,
        'slowKeys': [{'ch': ch, 'ms': round(ms)} for ch, ms in slow],
    }


def _personal_model(data: dict, g: dict) -> dict:
    n, errors = len(data['y']), int(data['y'].sum()) if len(data['y']) else 0
    status = {'samples': n, 'errors': errors, 'need': MIN_PERSONAL_SAMPLES}
    prior = g.get('model')
    if prior is None or n < MIN_PERSONAL_SAMPLES:
        return {'ready': False, **status}

    order = np.argsort(data['ts'], kind='stable')
    cut = int(len(order) * 0.75)
    train_idx, test_idx = order[:cut], order[cut:]
    holdout = error_model.fit_personal(data['X'][train_idx], data['y'][train_idx], prior)
    # Качество — на ваших последних 25% нажатий, которых модель при обучении не видела
    auc_you = error_model.auc(data['y'][test_idx], holdout.predict(data['X'][test_idx]))

    model = error_model.fit_personal(data['X'], data['y'], prior)
    risk = _risk_by_char(model, data)
    return {
        'ready': True, **status,
        'auc': auc_you,
        'factors': error_model.factor_contrast(model, prior),
        'risk': risk,
        'topKeys': {lang: _top_keys(risk[lang]['chars']) for lang in ('ru', 'en')},
        'topBigrams': {lang: sorted(({'ch': k, 'p': v} for k, v in risk[lang]['bigrams'].items()),
                                    key=lambda r: -r['p'])[:8] for lang in ('ru', 'en')},
        'errorRate': round(errors / n, 4) if n else None,
    }


def _recommendations(model: dict, fc: dict | None, langs: dict, daily_done: bool) -> list[dict]:
    recs = []
    lang = 'en' if langs.get('en', 0) > langs.get('ru', 0) else 'ru'
    if model.get('ready'):
        keys = [k['ch'] for k in model['topKeys'][lang][:3]]
        if keys:
            recs.append({
                'id': 'smart', 'icon': 'sparkles', 'tag': 'AI',
                'title': f"Умная тренировка: {', '.join(k.upper() for k in keys)}",
                'text': 'Модель предсказывает, что на этих клавишах вы ошибаетесь чаще всего. '
                        'Текст подобран так, чтобы они встречались часто.',
                'action': {'mode': 'smart', 'lang': lang},
            })
        tips = {
            'shift': ('Заглавные буквы и знаки', 'С Shift вы ошибаетесь на {e}% чаще. Потренируйте «Слова» на сложности «Ветеран» — там есть заглавные.',
                      {'mode': 'words', 'difficulty': 3}),
            'tempo': ('Сбавьте темп', 'Когда вы ускоряетесь, ошибок становится на {e}% больше. Ровный темп даст больше комбо и очков.',
                      {'mode': 'sentences', 'errorMode': 'strict'}),
            'fatigue': ('Короткие подходы', 'К концу тренировки ошибок на {e}% больше — похоже на усталость. Попробуйте подходы по 30 секунд.',
                        {'mode': 'words', 'duration': 30}),
            'symbol': ('Цифры и знаки', 'На цифрах и знаках препинания ошибок на {e}% больше. Режим «Символы» прокачает верхний ряд.',
                       {'mode': 'symbols'}),
            'same_finger': ('Один палец подряд', 'Переходы одним пальцем на соседнюю клавишу дают +{e}% к ошибкам. Умная тренировка подберёт такие слова.',
                            {'mode': 'smart', 'lang': lang}),
            'row_jump': ('Прыжки через ряд', 'Переход через два ряда повышает риск на {e}%. Возвращайте палец на основной ряд после каждой клавиши.',
                         {'mode': 'words', 'difficulty': 2}),
            'word_start': ('Начало слова', 'Первую букву слова вы пропускаете на {e}% чаще. Попробуйте «Предложения» — там больше связных переходов.',
                           {'mode': 'sentences'}),
        }
        for f in model['factors']:
            if f['id'] in tips and f['effect'] >= 25:
                title, text, action = tips[f['id']]
                recs.append({'id': f['id'], 'icon': 'target', 'tag': 'AI', 'title': title,
                             'text': text.format(e=round(f['effect'])), 'action': action})
                break
    if fc and fc.get('plateau'):
        recs.append({
            'id': 'plateau', 'icon': 'mountain', 'tag': 'Прогноз',
            'title': 'Скорость вышла на плато',
            'text': 'Кривая обучения почти не растёт. Новый стимул — сложность выше или свободный режим с исправлением ошибок.',
            'action': {'mode': 'sentences', 'difficulty': 3},
        })
    elif fc and fc.get('goal'):
        goal = fc['goal']
        recs.append({
            'id': 'goal', 'icon': 'rocket', 'tag': 'Прогноз',
            'title': f"До {goal['cpm']} зн/мин — около {max(1, goal['days'])} дн.",
            'text': f"По вашей кривой обучения нужно ещё ~{goal['minutes']} мин практики. При вашем темпе это {max(1, goal['days'])} дн.",
            'action': {'mode': 'words'},
        })
    if not daily_done:
        recs.append({
            'id': 'daily', 'icon': 'star', 'tag': 'Испытание',
            'title': 'Испытание дня ещё не пройдено',
            'text': 'Один текст для всех игроков. Покажите лучший результат и поднимитесь в рейтинге испытания.',
            'action': {'route': '/train?mode=daily'},
        })
    if not model.get('ready'):
        left = max(0, model.get('need', MIN_PERSONAL_SAMPLES) - model.get('samples', 0))
        recs.insert(0, {
            'id': 'collect', 'icon': 'database', 'tag': 'AI',
            'title': 'AI-тренер собирает данные',
            'text': f'Нужно ещё около {left} нажатий, чтобы обучить вашу персональную модель ошибок. Пока работают общие закономерности.',
            'action': {'mode': 'words'},
        })
    return recs[:4]


def personal(conn: sqlite3.Connection, user_id: str | None, now: int, g: dict, day_start_ts: int, progress: dict) -> dict:
    rows = _keylog_rows(conn, user_id, PERSONAL_SESSIONS) if user_id else []
    data = _dataset(rows)
    model = _personal_model(data, g)

    hist = conn.execute(
        'SELECT ts, cpm, chars, duration, accuracy, mode, flagged, challenge FROM trainings WHERE user_id = ? ORDER BY ts',
        (user_id or '',),
    ).fetchall()
    recent_min = sum(r['duration'] for r in hist if r['ts'] >= now - 14 * DAY_MS) / 60
    fc = forecast.personal_forecast(_curve_points(hist), recent_min / 14, progress['totals'].get('bestCpm', 0))

    recent = [dict(r) for r in hist if r['ts'] >= now - STYLE_DAYS * DAY_MS and r['chars'] >= 20 and not r['flagged']]
    feats = style.player_features(recent, _player_rhythm([json.loads(r['keylog']) for r in rows]))
    st = style.describe_player(g.get('style'), user_id or '', feats)

    daily_done = any(r['challenge'] and r['ts'] >= day_start_ts for r in hist)
    return {
        'model': model,
        'risk': model.get('risk') or (g['risk'] if g.get('model') else {}),
        'forecast': fc,
        'style': st,
        'rhythm': _rhythm_stats(data),
        'recommendations': _recommendations(model, fc, progress['totals'].get('langs', {}), daily_done),
        'sessionsLogged': len(rows),
    }


def insights(conn: sqlite3.Connection, user_id: str | None, now: int, day_start_ts: int, progress: dict) -> dict:
    g = global_state(conn, now)
    return {'personal': personal(conn, user_id, now, g, day_start_ts, progress), 'global': public_global(g),
            'generatedAt': now}


def check_rhythm(conn: sqlite3.Connection, keylog: dict | None, now: int) -> dict:
    if not keylog or not keylog.get('t'):
        return {'flagged': False, 'score': None, 'reason': None}
    return rhythm.check(global_state(conn, now).get('detector'), keylog['t'])

