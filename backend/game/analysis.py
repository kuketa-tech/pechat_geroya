"""Анализ трудных символов и сочетаний — развитие hardest() из game/analysis.js.

Клиентская версия сглаживает долю ошибок к общему среднему и смотрит на всю историю сразу.
Здесь четыре улучшения:

1. Давность. Каждая тренировка входит с весом 0.5^(возраст / 14 дней): буква, которую
   вы уже «вылечили», уходит из списка, а свежая проблема всплывает сразу.
2. Иерархическое сглаживание. Доля ошибок символа — апостериорное среднее бета-распределения
   с априорным средним, равным вашей личной доле ошибок (K = 10 псевдопопыток). Сочетание
   сглаживается не к общему среднему, а к доле ошибок своей второй буквы: так «щи» с двумя
   попытками не обгонит «щ» с сотней.
3. Уверенность. Ранжируем по нижней границе 80% интервала, а не по среднему: 1 ошибка из 1
   попытки не окажется выше 30 из 300.
4. Объяснение. Для символа — во сколько раз он хуже вашего среднего и тренд за неделю.
   Для сочетания — lift относительно второй буквы: lift ≥ 1,5 значит, что трудность
   именно в переходе между пальцами, а не в самой букве.
"""

from __future__ import annotations

import math

DAY_MS = 86_400_000
HALF_LIFE_DAYS = 14
PRIOR_ATTEMPTS = 10
Z80 = 0.8416  # одностороннее 80%
RECENT_DAYS = 7
TRANSITION_LIFT = 1.5


def _weighted(sessions: list[tuple[int, dict]], now: int) -> tuple[dict, dict, dict]:
    """→ (взвешенные [e, a], последние 7 дней [e, a], более ранние [e, a]) по ключам."""
    weighted, recent, older = {}, {}, {}
    for ts, stats in sessions:
        age = max(0, now - ts) / DAY_MS
        w = 0.5 ** (age / HALF_LIFE_DAYS)
        bucket = recent if age < RECENT_DAYS else older
        for key, (e, a) in stats.items():
            rec = weighted.setdefault(key, [0.0, 0.0])
            rec[0] += w * e
            rec[1] += w * a
            raw = bucket.setdefault(key, [0, 0])
            raw[0] += e
            raw[1] += a
    return weighted, recent, older


def _posterior(e: float, a: float, prior: float) -> tuple[float, float]:
    """Среднее и нижняя граница доли ошибок при бета-априорном распределении."""
    n = a + PRIOR_ATTEMPTS
    mean = (e + prior * PRIOR_ATTEMPTS) / n
    low = mean - Z80 * math.sqrt(max(mean * (1 - mean), 0) / (n + 1))
    return mean, max(0.0, low)


def _trend(key: str, recent: dict, older: dict) -> str | None:
    r, o = recent.get(key), older.get(key)
    if not r or not o or r[1] < 8 or o[1] < 8:
        return None
    rate_r, rate_o = r[0] / r[1], o[0] / o[1]
    if rate_r > rate_o * 1.25 + 0.005:
        return 'worse'
    if rate_r < rate_o * 0.8 - 0.005:
        return 'better'
    return 'flat'


def analyze_lang(
    char_sessions: list[tuple[int, dict]],
    bigram_sessions: list[tuple[int, dict]],
    char_totals: dict,
    bigram_totals: dict,
    now: int,
    *,
    limit: int = 10,
) -> dict:
    """Трудные символы и сочетания одной раскладки.

    *_sessions — пары (ts, {ключ: [ошибки, попытки]}) по тренировкам, *_totals — счётчики за всё время.
    """
    if not char_sessions and char_totals:  # старые данные без разбивки по тренировкам
        char_sessions = [(now, char_totals)]
        bigram_sessions = [(now, bigram_totals)]

    cw, c_recent, c_older = _weighted(char_sessions, now)
    tot_e = sum(e for e, _ in cw.values())
    tot_a = sum(a for _, a in cw.values())
    base = tot_e / tot_a if tot_a else 0.0

    char_rate: dict[str, float] = {}
    chars = []
    for key, (e, a) in cw.items():
        mean, low = _posterior(e, a, base)
        char_rate[key] = mean
        life_e, life_a = char_totals.get(key, (round(e), round(a)))
        if life_e <= 0 or life_a < 5 or mean <= base:
            continue
        chars.append({
            'ch': key,
            'errors': life_e,
            'attempts': life_a,
            'rate': life_e / life_a,
            'score': round(low, 5),
            'severity': round(mean / base, 2) if base else None,
            'trend': _trend(key, c_recent, c_older),
        })
    chars.sort(key=lambda r: r['score'], reverse=True)

    bw, b_recent, b_older = _weighted(bigram_sessions, now)
    bigrams = []
    for key, (e, a) in bw.items():
        second = key[-1:]
        prior = char_rate.get(second, base)
        mean, low = _posterior(e, a, prior)
        life_e, life_a = bigram_totals.get(key, (round(e), round(a)))
        if life_e <= 0 or life_a < 4 or mean <= base:
            continue
        lift = mean / prior if prior else None
        bigrams.append({
            'ch': key,
            'errors': life_e,
            'attempts': life_a,
            'rate': life_e / life_a,
            'score': round(low, 5),
            'lift': round(lift, 2) if lift else None,
            'transition': bool(lift and lift >= TRANSITION_LIFT),
            'trend': _trend(key, b_recent, b_older),
        })
    bigrams.sort(key=lambda r: r['score'], reverse=True)

    focus = ''.join(r['ch'] for r in chars if r['ch'] not in ('␣', '↵'))[:6]
    return {
        'baseRate': round(base, 5),
        'chars': chars[:limit],
        'bigrams': bigrams[:limit],
        'focus': focus,
        'sessions': len(char_sessions),
        'halfLifeDays': HALF_LIFE_DAYS,
    }
