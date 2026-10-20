"""Демо-соперники для таблицы лидеров, чтобы она не была пустой на свежей базе.

Соперники — обычные строки users (kind = 'demo') с тренировками в trainings, поэтому рейтинг
считается одним SQL-запросом для всех. Генерация детерминирована по (соперник, день) и
«докручивается» до текущего момента: сервер вызывает top_up() при старте и при запросе
рейтинга, так что у соперников всегда есть результаты «сегодня» и «за неделю».

    python -m backend.seed            # создать/дополнить соперников
    python -m backend.seed --reset    # пересоздать с нуля
    python -m backend.seed --remove   # удалить всех демо-соперников

Автозаполнение при старте отключается переменной окружения PG_DEMO_RIVALS=0.
"""

from __future__ import annotations

import argparse
import json
import math
import sqlite3
from datetime import date, datetime, timedelta

from . import db
from .auth import DEFAULT_TZ
from .game.progression import create_progress
from .game.scoring import POINTS_PER_CHAR, level_from_xp, xp_from_score
from .game.util import js_round, now_ms, pick, round1, seeded_random
from .ml import synth

RIVALS = [
    'Клавогонщик', 'neo_typer', 'Мизинец', 'ФЫВА_ОЛДЖ', 'Быстрые_пальцы', 'QwertyQueen', 'Тихий_Ход', 'dvorak_fan',
    'Стенографист', 'Летописец', 'Пиксель', 'Ctrl_Alt_Win', 'Сова_в_ночи', 'Ra1nbow', 'keymaster', 'Ласточка',
    'Капитан Пробел', 'Shift_Happens', 'Кузнец слов', 'Вжух', 'Lumen', 'Бармалей', 'ТурбоУлитка', 'Echo',
    'Нарвал', 'Alt_F4', 'Медведь', 'Zenith', 'Котопёс', 'КнязьТекста', 'Байт', 'Glitch', 'Рысь', 'Штурман',
    'Полярник', 'Mira', 'Ёжик', 'Nova', 'Тайпер3000', 'Аврора', 'Grizzly', 'Скороход', 'Volt', 'Дрон', 'Кедр',
    'Orion', 'Ветерок', 'Марс',
]
HISTORY_DAYS = 35
META_UNTIL = 'rivals.until'
TOP_UP_EVERY_MS = 10 * 60_000
TZ = DEFAULT_TZ
GROWTH_FROM = date(2026, 9, 1)  # соперники тоже учатся: скорость растёт ~на 20% за два месяца
KEYLOG_DAYS = 7
KEYLOG_CHARS = 360


def _profiles() -> list[dict]:
    """Базовые характеристики соперников — те же, что были в моке."""
    rnd = seeded_random('rivals:v1')
    out = []
    for i, name in enumerate(RIVALS):
        skill = rnd() ** 1.6
        out.append({
            'id': f'demo-r{i}',
            'name': name,
            'cpm': js_round(140 + skill * 420 + rnd() * 30),
            'accuracy': round1(89 + rnd() * 10.5),
            'xp': js_round(400 + skill ** 0.8 * 48000 + rnd() * 2000),  # опыт «до начала истории»
            'activity': 0.35 + rnd() * 0.5,
        })
    return out


def _day_sessions(r: dict, i: int, day: date) -> list[dict]:
    rnd = seeded_random(f'rival:{i}:{day.isoformat()}')
    if rnd() > r['activity']:
        return []
    out = []
    for _ in range(1 + math.floor(rnd() * 4)):
        hour = rnd() * 7 if rnd() < 0.15 else 7 + rnd() * 17  # кое-кто тренируется и ночью
        start = datetime.combine(day, datetime.min.time(), TZ) + timedelta(hours=hour)
        mode = pick(['words', 'words', 'sentences', 'sentences', 'symbols', 'code'], rnd)
        growth = 0.8 + 0.2 * min(1.0, max(0, (day - GROWTH_FROM).days) / 60)
        cpm = js_round(r['cpm'] * growth * (0.78 + rnd() * 0.22) * (0.85 if mode in ('symbols', 'code') else 1))
        accuracy = round1(min(99.9, max(84, r['accuracy'] + (rnd() - 0.6) * 2.5)))
        duration = pick([30, 60, 60, 120], rnd)
        chars = js_round(cpm * duration / 60)
        errors = js_round(chars * (100 / accuracy - 1))
        score = js_round(chars * POINTS_PER_CHAR * (1.4 + rnd() * 1.6))
        out.append({
            'ts': int(start.timestamp() * 1000), 'mode': mode, 'lang': 'ru' if rnd() < 0.7 else 'en',
            'difficulty': 1 + math.floor(rnd() * 4), 'duration': duration, 'cpm': cpm, 'wpm': js_round(cpm / 5),
            'accuracy': round1(chars / (chars + errors) * 100), 'errors': errors, 'chars': chars,
            'keystrokes': chars + errors, 'maxStreak': min(chars, js_round(chars / (errors + 1) * (1 + rnd() * 1.5))),
            'score': score, 'bonuses': math.floor(rnd() * 3), 'xp': xp_from_score(score, accuracy),
        })
    return out


def _ensure_users(conn: sqlite3.Connection, profiles: list[dict], now: int) -> None:
    created = now - HISTORY_DAYS * 86_400_000
    for r in profiles:
        conn.execute(
            "INSERT INTO users(id, kind, name, provider, created_at) VALUES(?, 'demo', ?, 'demo', ?) "
            'ON CONFLICT(id) DO UPDATE SET name = excluded.name',
            (r['id'], r['name'], created),
        )


def top_up(conn: sqlite3.Connection, now: int | None = None, *, force: bool = False) -> int:
    """Догенерировать тренировки соперников до текущего момента. → сколько добавлено."""
    now = now or now_ms()
    until = int(db.get_meta(conn, META_UNTIL, '0'))
    if not force and now - until < TOP_UP_EVERY_MS:
        return 0
    profiles = _profiles()
    added = 0
    with db.tx(conn):
        _ensure_users(conn, profiles, now)
        start = until or now - HISTORY_DAYS * 86_400_000
        first = datetime.fromtimestamp(start / 1000, TZ).date()
        last = datetime.fromtimestamp(now / 1000, TZ).date()
        for i, r in enumerate(profiles):
            day = first
            while day <= last:
                for s in _day_sessions(r, i, day):
                    if not start < s['ts'] <= now:
                        continue
                    _insert(conn, r, s, now)
                    added += 1
                day += timedelta(days=1)
            added += _daily_challenge(conn, r, i, last, now)
            _save_rival_progress(conn, r, now)
        db.set_meta(conn, META_UNTIL, str(now))
    return added


def _insert(conn: sqlite3.Connection, r: dict, s: dict, now: int, challenge: str | None = None) -> None:
    keylog = None
    if s['ts'] >= now - KEYLOG_DAYS * 86_400_000:
        prof = synth.profile(r['id'], s['cpm'], s['accuracy'])
        keylog = json.dumps(synth.keylog(prof, f"{r['id']}-{s['ts']}", s['lang'], min(s['chars'], KEYLOG_CHARS)),
                            ensure_ascii=False, separators=(',', ':'))
    conn.execute(
        'INSERT OR IGNORE INTO trainings(id, user_id, ts, mode, lang, difficulty, duration, cpm, wpm, accuracy, '
        'errors, chars, keystrokes, max_streak, score, bonuses, xp, keylog, challenge) '
        'VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        (s.get('id') or f"{r['id']}-{s['ts']}", r['id'], s['ts'], s['mode'], s['lang'], s['difficulty'], s['duration'],
         s['cpm'], s['wpm'], s['accuracy'], s['errors'], s['chars'], s['keystrokes'], s['maxStreak'],
         s['score'], s['bonuses'], s['xp'], keylog, challenge),
    )


def _daily_challenge(conn: sqlite3.Connection, r: dict, i: int, today: date, now: int) -> int:
    """Попытка испытания дня у части соперников — чтобы его рейтинг не пустовал."""
    rnd = seeded_random(f'daily:{i}:{today.isoformat()}')
    if rnd() > 0.6:
        return 0
    start = datetime.combine(today, datetime.min.time(), TZ) + timedelta(hours=7 + rnd() * 15)
    ts = int(start.timestamp() * 1000)
    if ts > now:
        return 0
    cpm = js_round(r['cpm'] * (0.8 + rnd() * 0.2))
    accuracy = round1(min(99.9, max(90, r['accuracy'] + (rnd() - 0.4) * 2)))
    chars = 190
    duration = round1(chars / cpm * 60)
    errors = js_round(chars * (100 / accuracy - 1))
    score = js_round(chars * POINTS_PER_CHAR * (1.6 + rnd() * 1.4))
    s = {
        'id': f"{r['id']}-daily-{today.isoformat()}", 'ts': ts, 'mode': 'daily', 'lang': 'ru', 'difficulty': 2,
        'duration': duration, 'cpm': cpm, 'wpm': js_round(cpm / 5), 'accuracy': round1(chars / (chars + errors) * 100),
        'errors': errors, 'chars': chars, 'keystrokes': chars + errors,
        'maxStreak': min(chars, js_round(chars / (errors + 1) * 1.6)), 'score': score, 'bonuses': 0,
        'xp': xp_from_score(score, accuracy),
    }
    before = conn.total_changes
    _insert(conn, r, s, now, challenge=today.isoformat())
    return conn.total_changes - before


def _save_rival_progress(conn: sqlite3.Connection, r: dict, now: int) -> None:
    row = conn.execute(
        'SELECT COALESCE(SUM(xp), 0) AS xp, COUNT(*) AS n, COALESCE(MAX(cpm), 0) AS best FROM trainings WHERE user_id = ?',
        (r['id'],),
    ).fetchone()
    p = create_progress(now - HISTORY_DAYS * 86_400_000)
    p['xp'] = r['xp'] + row['xp']
    p['level'] = level_from_xp(p['xp'])
    p['totals'].update(sessions=row['n'], bestCpm=row['best'])
    conn.execute(
        'INSERT INTO progress(user_id, xp, data, updated_at) VALUES(?, ?, ?, ?) '
        'ON CONFLICT(user_id) DO UPDATE SET xp = excluded.xp, data = excluded.data, updated_at = excluded.updated_at',
        (r['id'], p['xp'], json.dumps(p, ensure_ascii=False), now),
    )


def remove(conn: sqlite3.Connection) -> int:
    with db.tx(conn):
        n = conn.execute("DELETE FROM users WHERE kind = 'demo'").rowcount
        conn.execute('DELETE FROM meta WHERE key = ?', (META_UNTIL,))
    return n


def main() -> None:
    parser = argparse.ArgumentParser(description='Демо-соперники для таблицы лидеров')
    group = parser.add_mutually_exclusive_group()
    group.add_argument('--reset', action='store_true', help='удалить и создать заново')
    group.add_argument('--remove', action='store_true', help='удалить всех демо-соперников')
    args = parser.parse_args()

    db.init_db()
    conn = db.connect()
    try:
        if args.remove or args.reset:
            print(f'Удалено соперников: {remove(conn)}')
        if not args.remove:
            added = top_up(conn, force=True)
            print(f'Соперников: {len(RIVALS)}, добавлено тренировок: {added}. База: {db.DB_PATH}')
    finally:
        conn.close()


if __name__ == '__main__':
    main()
