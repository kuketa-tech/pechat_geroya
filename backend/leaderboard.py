"""Таблица лидеров по реальным тренировкам из БД (вместе с демо-соперниками из seed.py)."""

from __future__ import annotations

import sqlite3
from datetime import tzinfo

from .game.scoring import level_from_xp
from .game.util import add_days, day_key, day_start, round1

PERIOD_DAYS = {'day': 1, 'week': 7, 'all': 0}
TOP = 50

METRIC_VALUE = {
    'speed': lambda r: r['bestCpm'],
    'accuracy': lambda r: r['accuracy'],
    'xp': lambda r: r['periodXp'],
    'streak': lambda r: r['bestStreak'],
    'daily': lambda r: r['bestCpm'],
}
DAILY_MIN_ACCURACY = 90


def build(conn: sqlite3.Connection, metric: str, period: str, me_id: str | None, me_guest: bool, now: int, tz: tzinfo) -> dict:
    days = PERIOD_DAYS[period]
    since = day_start(add_days(now, -(days - 1), tz), tz) if days else 0
    # Испытание дня — только сегодняшние попытки с точностью от 90%
    extra = 'AND t.challenge = ? AND t.accuracy >= ?' if metric == 'daily' else ''
    extra_args = (day_key(now, tz), DAILY_MIN_ACCURACY) if metric == 'daily' else ()
    if metric == 'daily':
        since = 0
    rows = conn.execute(
        """
        SELECT u.id, u.name, u.kind, COALESCE(p.xp, 0) AS total_xp,
               COUNT(*) AS sessions,
               MAX(CASE WHEN t.chars >= 20 THEN t.cpm END) AS best_counted,
               MAX(t.cpm) AS best_any,
               AVG(CASE WHEN t.chars >= 20 THEN t.accuracy END) AS acc_counted,
               AVG(t.accuracy) AS acc_any,
               SUM(t.xp) AS period_xp,
               MAX(t.max_streak) AS best_streak
        FROM trainings t
        JOIN users u ON u.id = t.user_id
        LEFT JOIN progress p ON p.user_id = u.id
        WHERE t.ts >= ? AND t.flagged = 0 AND (u.kind != 'guest' OR u.id = ?) """ + extra + """
        GROUP BY u.id
        """,
        (since, me_id or '', *extra_args),
    ).fetchall()

    items = []
    for r in rows:
        me = r['id'] == me_id
        items.append({
            'id': r['id'],
            'name': 'Вы (гость)' if me and me_guest else r['name'],
            'me': me,
            'demo': r['kind'] == 'demo',
            'level': level_from_xp(r['total_xp']),
            'bestCpm': r['best_counted'] if r['best_counted'] is not None else r['best_any'],
            'accuracy': round1(r['acc_counted'] if r['acc_counted'] is not None else r['acc_any']),
            'periodXp': r['total_xp'] if period == 'all' else r['period_xp'],
            'sessions': r['sessions'],
            'bestStreak': r['best_streak'] or 0,
        })

    value = METRIC_VALUE[metric]
    items.sort(key=lambda r: (value(r), r['bestCpm']), reverse=True)
    for i, r in enumerate(items):
        r['rank'] = i + 1
        r['value'] = value(r)
    return {
        'items': items[:TOP],
        'me': next((r for r in items if r['me']), None),
        'total': len(items),
    }
