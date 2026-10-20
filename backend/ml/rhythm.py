"""Ритм печати: статистика интервалов и детектор автоматического ввода.

Интервалы между нажатиями у человека распределены примерно логнормально и «шумят»:
коэффициент вариации обычно 0,3–0,7, соседние интервалы почти не повторяются до
миллисекунды. Скрипт или макрос печатает слишком ровно или пачками по 0–5 мс.

Детектор — IsolationForest (scikit-learn), обученный на ритме человеческих тренировок
(реальные сохранённые сессии + смоделированные логнормальные). Аномалия засчитывается,
только если её подтверждает и явный признак (слишком ровный ритм, повторы, пачки) —
так честный игрок не пострадает от случайного срабатывания. Подозрительный результат
сохраняется в прогресс, но не попадает в рейтинг.
"""

from __future__ import annotations

import numpy as np
from sklearn.ensemble import IsolationForest

from .features import PAUSE_MS

MIN_GAPS = 40


def gaps_of(t: list[int]) -> np.ndarray:
    g = np.diff(np.asarray(t, dtype=float))
    return g[(g >= 0) & (g < PAUSE_MS)]


def features(t: list[int]) -> np.ndarray | None:
    g = gaps_of(t)
    if len(g) < MIN_GAPS:
        return None
    med = float(np.median(g))
    mean = float(g.mean())
    cv = float(g.std() / mean) if mean > 0 else 0.0
    fast = float(np.mean(g < 35))
    repeat = float(np.mean(np.abs(np.diff(g)) < 1.0))
    iqr = float(np.subtract(*np.percentile(g, [75, 25]))) / max(med, 1.0)
    ac = float(np.corrcoef(g[:-1], g[1:])[0, 1]) if g.std() > 0 else 1.0
    return np.array([np.log(max(med, 1.0)), cv, fast, repeat, iqr, 0.0 if np.isnan(ac) else ac])


def synthetic_human(rnd: np.random.Generator, n: int = 400) -> list[np.ndarray]:
    """Смоделированные человеческие тренировки: логнормальные интервалы с паузами на словах."""
    out = []
    for _ in range(n):
        median = rnd.uniform(90, 600)
        sigma = rnd.uniform(0.3, 0.75)
        k = int(rnd.integers(80, 600))
        g = rnd.lognormal(np.log(median), sigma, size=k)
        g[rnd.random(k) < 0.15] *= rnd.uniform(1.3, 2.2)
        t = np.concatenate([[0], np.cumsum(g)]).astype(int).tolist()
        f = features(t)
        if f is not None:
            out.append(f)
    return out


def train_detector(real: list[np.ndarray]) -> IsolationForest:
    rnd = np.random.default_rng(7)
    data = np.array(synthetic_human(rnd) + real[-2000:])
    return IsolationForest(n_estimators=150, contamination=0.03, random_state=0).fit(data)


def check(detector: IsolationForest | None, t: list[int]) -> dict:
    f = features(t)
    if f is None or detector is None:
        return {'flagged': False, 'score': None, 'reason': None}
    score = float(detector.decision_function(f[None, :])[0])
    _, cv, fast, repeat, _, _ = f
    reason = None
    if cv < 0.12:
        reason = 'интервалы между нажатиями почти одинаковые'
    elif repeat > 0.35:
        reason = 'интервалы повторяются до миллисекунды'
    elif fast > 0.3:
        reason = 'символы приходят пачками быстрее 35 мс'
    flagged = bool(reason) and (score < 0 or cv < 0.06 or fast > 0.6)
    return {'flagged': flagged, 'score': round(score, 3), 'reason': reason if flagged else None}
