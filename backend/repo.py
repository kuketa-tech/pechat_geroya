"""Чтение и запись прогресса и тренировок."""

from __future__ import annotations

import json
import sqlite3
from datetime import tzinfo

from .game.analysis import analyze_lang
from .game.progression import create_progress, ensure_day

HISTORY_LIMIT = 300
SAMPLES_KEEP = 40
ANALYSIS_DAYS = 120
ANALYSIS_ROWS = 800
LANGS = ('ru', 'en')


def load_progress(conn: sqlite3.Connection, user_id: str | None, now: int, tz: tzinfo) -> dict:
    row = user_id and conn.execute('SELECT data FROM progress WHERE user_id = ?', (user_id,)).fetchone()
    p = json.loads(row['data']) if row else create_progress(now)
    ensure_day(p, now, tz)
    return p


def save_progress(conn: sqlite3.Connection, user_id: str, p: dict, now: int) -> None:
    conn.execute(
        'INSERT INTO progress(user_id, xp, data, updated_at) VALUES(?, ?, ?, ?) '
        'ON CONFLICT(user_id) DO UPDATE SET xp = excluded.xp, data = excluded.data, updated_at = excluded.updated_at',
        (user_id, p['xp'], json.dumps(p, ensure_ascii=False, separators=(',', ':')), now),
    )


def insert_training(conn: sqlite3.Connection, user_id: str, entry: dict, session: dict) -> None:
    dumps = lambda v: json.dumps(v, ensure_ascii=False, separators=(',', ':'))  # noqa: E731
    keylog = session.get('keylog')
    conn.execute(
        'INSERT INTO trainings(id, user_id, ts, mode, lang, code_lang, difficulty, duration, cpm, wpm, accuracy, errors, '
        'chars, keystrokes, max_streak, score, bonuses, xp, samples, char_stats, bigram_stats, keylog, error_mode, '
        'uncorrected, challenge, flagged) '
        'VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        (
            entry['id'], user_id, entry['ts'], entry['mode'], entry['lang'], entry.get('codeLang'), entry['difficulty'],
            entry['duration'], entry['cpm'], entry['wpm'], entry['accuracy'], entry['errors'], entry['chars'],
            session['keystrokes'], entry['maxStreak'], entry['score'], entry['bonuses'], entry['xp'],
            dumps(entry.get('samples') or []), dumps(session.get('charStats') or {}), dumps(session.get('bigramStats') or {}),
            dumps(keylog) if keylog and keylog.get('t') else None, session.get('errorMode') or 'strict',
            session.get('uncorrected') or 0, session.get('challenge'), 1 if session.get('flagged') else 0,
        ),
    )


def _entry(row: sqlite3.Row, with_samples: bool) -> dict:
    e = {
        'id': row['id'], 'ts': row['ts'], 'mode': row['mode'], 'lang': row['lang'], 'codeLang': row['code_lang'],
        'difficulty': row['difficulty'], 'cpm': row['cpm'], 'wpm': row['wpm'], 'accuracy': row['accuracy'],
        'errors': row['errors'], 'chars': row['chars'], 'duration': row['duration'], 'maxStreak': row['max_streak'],
        'score': row['score'], 'bonuses': row['bonuses'], 'xp': row['xp'],
        'flagged': bool(row['flagged']), 'challenge': row['challenge'],
    }
    if with_samples and row['samples']:
        e['samples'] = json.loads(row['samples'])
    return e


def history(conn: sqlite3.Connection, user_id: str) -> list[dict]:
    rows = conn.execute(
        'SELECT id, ts, mode, lang, code_lang, difficulty, cpm, wpm, accuracy, errors, chars, duration, max_streak, '
        'score, bonuses, xp, samples, flagged, challenge FROM trainings WHERE user_id = ? ORDER BY ts DESC LIMIT ?',
        (user_id, HISTORY_LIMIT),
    ).fetchall()
    return [_entry(r, i < SAMPLES_KEEP) for i, r in enumerate(rows)]


def analysis(conn: sqlite3.Connection, user_id: str, p: dict, now: int) -> dict:
    rows = conn.execute(
        'SELECT ts, lang, char_stats, bigram_stats FROM trainings '
        'WHERE user_id = ? AND ts >= ? AND char_stats IS NOT NULL ORDER BY ts DESC LIMIT ?',
        (user_id, now - ANALYSIS_DAYS * 86_400_000, ANALYSIS_ROWS),
    ).fetchall()
    out = {}
    for lang in LANGS:
        mine = [r for r in rows if r['lang'] == lang]
        out[lang] = analyze_lang(
            [(r['ts'], json.loads(r['char_stats'])) for r in mine],
            [(r['ts'], json.loads(r['bigram_stats'] or '{}')) for r in mine],
            p['charStats'].get(lang, {}),
            p['bigramStats'].get(lang, {}),
            now,
        )
    return out


def progress_payload(conn: sqlite3.Connection, user_id: str | None, now: int, tz: tzinfo) -> dict:
    """Прогресс в том виде, который ждёт фронтенд: агрегаты + история + серверный анализ ошибок."""
    p = load_progress(conn, user_id, now, tz)
    p['history'] = history(conn, user_id) if user_id else []
    p['analysis'] = analysis(conn, user_id, p, now) if user_id else {lang: None for lang in LANGS}
    return p


def last_save(conn: sqlite3.Connection, user_id: str, since: int) -> tuple[int | None, int]:
    """Время последней тренировки и сколько их было начиная с since."""
    row = conn.execute(
        'SELECT MAX(ts) AS last, SUM(ts >= ?) AS recent FROM trainings WHERE user_id = ?', (since, user_id)
    ).fetchone()
    return row['last'], row['recent'] or 0


def sessions_count(conn: sqlite3.Connection, user_id: str) -> int:
    return conn.execute('SELECT COUNT(*) FROM trainings WHERE user_id = ?', (user_id,)).fetchone()[0]


def move_user_data(conn: sqlite3.Connection, from_id: str, to_id: str) -> None:
    """Перенос прогресса (гостя) в аккаунт: тренировки и агрегаты целиком."""
    conn.execute('DELETE FROM trainings WHERE user_id = ?', (to_id,))
    conn.execute('DELETE FROM progress WHERE user_id = ?', (to_id,))
    conn.execute('UPDATE trainings SET user_id = ? WHERE user_id = ?', (to_id, from_id))
    conn.execute('UPDATE progress SET user_id = ? WHERE user_id = ?', (to_id, from_id))


def reset(conn: sqlite3.Connection, user_id: str, now: int) -> None:
    conn.execute('DELETE FROM trainings WHERE user_id = ?', (user_id,))
    save_progress(conn, user_id, create_progress(now), now)
