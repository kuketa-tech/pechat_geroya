"""Общие функции, повторяющие core/utils.js бит в бит: округление JS, даты, сидируемый ГСЧ.

Ключи дней считаются в часовом поясе игрока (его присылает клиент), как dayKey() в браузере.
"""

from __future__ import annotations

import math
import secrets
from datetime import date, datetime, timedelta, tzinfo

U32 = 0xFFFFFFFF


def js_round(x: float) -> int:
    """Math.round: половина округляется вверх (в Python round — банковское)."""
    return math.floor(x + 0.5)


def round1(x: float) -> float:
    """Math.round(x * 10) / 10."""
    return js_round(x * 10) / 10


def now_ms() -> int:
    return int(datetime.now().timestamp() * 1000)


def local_dt(ts: int, tz: tzinfo) -> datetime:
    return datetime.fromtimestamp(ts / 1000, tz)


def day_key(ts: int, tz: tzinfo) -> str:
    return local_dt(ts, tz).strftime('%Y-%m-%d')


def days_between(key_a: str, key_b: str) -> int:
    return (date.fromisoformat(key_b) - date.fromisoformat(key_a)).days


def add_days(ts: int, n: int, tz: tzinfo) -> int:
    """Тот же час по местному времени n дней спустя (как Date#setDate)."""
    d = local_dt(ts, tz)
    shifted = datetime.combine(d.date() + timedelta(days=n), d.time(), tz)
    return int(shifted.timestamp() * 1000)


def day_start(ts: int, tz: tzinfo) -> int:
    """Полночь местного дня, в который попадает ts."""
    d = local_dt(ts, tz)
    return int(datetime.combine(d.date(), datetime.min.time(), tz).timestamp() * 1000)


def uid() -> str:
    return secrets.token_hex(8)


def hash_str(s: str) -> int:
    """FNV-1a по UTF-16 кодовым единицам — как hashStr() на клиенте."""
    h = 2166136261
    data = s.encode('utf-16-le')
    for i in range(0, len(data), 2):
        h ^= data[i] | (data[i + 1] << 8)
        h = (h * 16777619) & U32
    return h


def seeded_random(seed):
    """mulberry32 — те же последовательности, что seededRandom() в браузере."""
    a = seed & U32 if isinstance(seed, int) else hash_str(str(seed))

    def rnd() -> float:
        nonlocal a
        a = (a + 0x6D2B79F5) & U32
        t = ((a ^ (a >> 15)) * (1 | a)) & U32
        t = ((t + (((t ^ (t >> 7)) * (61 | t)) & U32)) & U32) ^ t
        return ((t ^ (t >> 14)) & U32) / 4294967296

    return rnd


def shuffle(items: list, rnd) -> list:
    a = list(items)
    for i in range(len(a) - 1, 0, -1):
        j = math.floor(rnd() * (i + 1))
        a[i], a[j] = a[j], a[i]
    return a


def pick(items: list, rnd):
    return items[math.floor(rnd() * len(items))]
