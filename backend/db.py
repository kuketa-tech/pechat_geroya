"""SQLite: схема и подключение. Без ORM — запросов немного, а sqlite3 есть в стандартной библиотеке."""

from __future__ import annotations

import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DB_PATH = Path(os.environ.get('PG_DB', ROOT / 'data' / 'pechat.db'))

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id          TEXT PRIMARY KEY,
    kind        TEXT NOT NULL DEFAULT 'user',   -- user | guest | demo
    name        TEXT NOT NULL,
    email       TEXT UNIQUE,                    -- только у входа по email
    social_id   TEXT UNIQUE,                    -- provider:device у демо-входа через соцсети
    provider    TEXT NOT NULL,                  -- email | vk | yandex | google | github | local | demo
    pass_hash   TEXT,
    created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_tokens (
    token_hash  TEXT PRIMARY KEY,               -- sha256 от значения cookie
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  INTEGER NOT NULL,
    expires_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS auth_tokens_user ON auth_tokens(user_id);

-- Агрегаты прогресса (totals, серия, задания, достижения, дни) — JSON того же вида, что на клиенте.
CREATE TABLE IF NOT EXISTS progress (
    user_id     TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    xp          INTEGER NOT NULL DEFAULT 0,
    data        TEXT NOT NULL,
    updated_at  INTEGER NOT NULL
);

-- Каждая тренировка — строка: из них строятся история, рейтинг за период и анализ ошибок.
CREATE TABLE IF NOT EXISTS trainings (
    id           TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ts           INTEGER NOT NULL,
    mode         TEXT NOT NULL,
    lang         TEXT NOT NULL,
    code_lang    TEXT,
    difficulty   INTEGER NOT NULL,
    duration     REAL NOT NULL,
    cpm          INTEGER NOT NULL,
    wpm          INTEGER NOT NULL,
    accuracy     REAL NOT NULL,
    errors       INTEGER NOT NULL,
    chars        INTEGER NOT NULL,
    keystrokes   INTEGER NOT NULL,
    max_streak   INTEGER NOT NULL,
    score        INTEGER NOT NULL,
    bonuses      INTEGER NOT NULL,
    xp           INTEGER NOT NULL,
    samples      TEXT,                          -- JSON: посекундная скорость
    char_stats   TEXT,                          -- JSON: {символ: [ошибки, попытки]}
    bigram_stats TEXT
);
CREATE INDEX IF NOT EXISTS trainings_user_ts ON trainings(user_id, ts DESC);
CREATE INDEX IF NOT EXISTS trainings_ts ON trainings(ts);

CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT
);
"""


def connect() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, isolation_level=None, check_same_thread=False, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA foreign_keys = ON')
    conn.execute('PRAGMA busy_timeout = 10000')
    return conn


# Колонки, добавленные после первой версии схемы: на старой базе дописываются ALTER TABLE
TRAINING_COLUMNS = {
    'keylog': 'TEXT',                                   # JSON {t, ch, err}: первая попытка на каждой позиции
    'error_mode': "TEXT NOT NULL DEFAULT 'strict'",     # strict | free
    'uncorrected': 'INTEGER NOT NULL DEFAULT 0',        # неисправленные ошибки свободного режима
    'challenge': 'TEXT',                                # день испытания (YYYY-MM-DD) или NULL
    'flagged': 'INTEGER NOT NULL DEFAULT 0',            # 1 — ритм похож на автоввод, не идёт в рейтинг
}


def init_db() -> None:
    conn = connect()
    try:
        conn.execute('PRAGMA journal_mode = WAL')
        conn.executescript(SCHEMA)
        have = {r['name'] for r in conn.execute('PRAGMA table_info(trainings)')}
        for name, decl in TRAINING_COLUMNS.items():
            if name not in have:
                conn.execute(f'ALTER TABLE trainings ADD COLUMN {name} {decl}')
        conn.execute('CREATE INDEX IF NOT EXISTS trainings_challenge ON trainings(challenge)')
    finally:
        conn.close()


@contextmanager
def tx(conn: sqlite3.Connection):
    """Транзакция с блокировкой на запись сразу: два сохранения одного игрока не перетрут друг друга."""
    conn.execute('BEGIN IMMEDIATE')
    try:
        yield conn
    except BaseException:
        conn.execute('ROLLBACK')
        raise
    else:
        conn.execute('COMMIT')


def get_meta(conn: sqlite3.Connection, key: str, default: str | None = None) -> str | None:
    row = conn.execute('SELECT value FROM meta WHERE key = ?', (key,)).fetchone()
    return row['value'] if row else default


def set_meta(conn: sqlite3.Connection, key: str, value: str) -> None:
    conn.execute('INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', (key, value))
