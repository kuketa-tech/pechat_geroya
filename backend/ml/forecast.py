"""Прогноз скорости по кривой обучения.

Скорость растёт быстро в начале и всё медленнее потом — классическая кривая навыка.
Модель: cpm(x) = a + b · ln(1 + x / τ), где x — минуты практики до тренировки.
При фиксированном τ модель линейна по признаку ln(1 + x/τ), поэтому её коэффициенты
оцениваем робастной регрессией Хьюбера (scikit-learn HuberRegressor): единичные
неудачные тренировки не тянут кривую вниз. τ подбираем перебором по ошибке.

Из кривой получаем: прогноз скорости через 7/14/30 дней при вашем темпе занятий,
сколько практики нужно до ближайшей цели и коридор неопределённости (по разбросу остатков).
"""

from __future__ import annotations

import math

import numpy as np
from sklearn.linear_model import HuberRegressor

TAUS = (10, 20, 40, 80, 160, 320)
MIN_POINTS = 5


def _fit(x: np.ndarray, y: np.ndarray, tau: float) -> tuple[HuberRegressor, float]:
    f = np.log1p(x / tau)[:, None]
    reg = HuberRegressor(epsilon=1.5, alpha=1e-4, max_iter=500).fit(f, y)
    resid = y - reg.predict(f)
    return reg, float(np.median(np.abs(resid)))


def fit_curve(x: np.ndarray, y: np.ndarray) -> dict | None:
    """x — минуты практики, y — скорость. → параметры кривой или None, если данных мало."""
    if len(x) < MIN_POINTS or x.max() - x.min() < 5:
        return None
    best = None
    for tau in TAUS:
        reg, mad = _fit(x, y, tau)
        if best is None or mad < best[2]:
            best = (tau, reg, mad)
    tau, reg, mad = best
    return {'a': float(reg.intercept_), 'b': float(reg.coef_[0]), 'tau': float(tau), 'sigma': max(5.0, mad * 1.4826)}


def predict(curve: dict, x: float | np.ndarray):
    return curve['a'] + curve['b'] * np.log1p(np.asarray(x) / curve['tau'])


def minutes_to(curve: dict, target: float) -> float | None:
    """Сколько минут практики нужно, чтобы кривая дошла до target (None — не дойдёт)."""
    if curve['b'] <= 0.5:
        return None
    return curve['tau'] * (math.exp((target - curve['a']) / curve['b']) - 1)


def personal_forecast(points: list[tuple[float, float]], daily_minutes: float, best_cpm: float) -> dict | None:
    """points — (минуты практики до тренировки, скорость) в хронологическом порядке."""
    if len(points) < MIN_POINTS:
        return None
    x = np.array([p[0] for p in points], dtype=float)
    y = np.array([p[1] for p in points], dtype=float)
    curve = fit_curve(x, y)
    if not curve:
        return None
    now_x = float(x.max())
    pace = max(daily_minutes, 3.0)
    now_fit = float(predict(curve, now_x))
    horizons = []
    for days in (7, 14, 30):
        v = float(predict(curve, now_x + pace * days))
        horizons.append({'days': days, 'cpm': round(v), 'low': round(v - curve['sigma']), 'high': round(v + curve['sigma'])})

    target = max(100, math.ceil((max(best_cpm, now_fit) + 1) / 50) * 50)
    need = minutes_to(curve, target)
    goal = None
    if need is not None:
        left = max(0.0, need - now_x)
        goal = {'cpm': target, 'minutes': round(left), 'days': math.ceil(left / pace) if left else 0}

    grid = np.linspace(0, now_x + pace * 30, 60)
    gain_week = horizons[0]['cpm'] - now_fit
    return {
        'curve': {k: round(v, 3) for k, v in curve.items()},
        'nowFit': round(now_fit),
        'pace': round(pace, 1),
        'horizons': horizons,
        'goal': goal,
        'plateau': gain_week < 3,
        'points': [{'x': round(px / 60, 2), 'y': round(py)} for px, py in points[-120:]],
        'line': [{'x': round(g / 60, 2), 'y': round(float(predict(curve, g)))} for g in grid],
        'nowX': round(now_x / 60, 2),
        'sigma': round(curve['sigma'], 1),
    }


def population_curve(per_user: list[list[tuple[float, float]]]) -> dict | None:
    """Средняя кривая обучения по всем игрокам (каждый со своей шкалой практики)."""
    xs, ys = [], []
    for pts in per_user:
        for px, py in pts:
            xs.append(px)
            ys.append(py)
    if len(xs) < 20:
        return None
    x, y = np.array(xs, dtype=float), np.array(ys, dtype=float)
    curve = fit_curve(x, y)
    if not curve:
        return None
    grid = np.linspace(0, float(np.percentile(x, 95)), 60)
    return {
        'curve': {k: round(v, 3) for k, v in curve.items()},
        'line': [{'x': round(g / 60, 2), 'y': round(float(predict(curve, g)))} for g in grid],
        'players': len(per_user),
        'points': len(xs),
    }
