"""Модель вероятности ошибки на нажатии: общая для всех и персональная.

Общая модель — логистическая регрессия (scikit-learn) на нажатиях всех игроков.
Персональная — та же регрессия, но с априорным распределением, центрированным на общей:

    β_you = argmin  −logL(β | ваши нажатия) + λ/2 · ‖β − β_all‖²

При малом числе ваших данных β_you ≈ β_all (модель говорит «как у всех»), по мере
накопления — подстраивается под вас. Это иерархическая (байесовская) модель в форме MAP.
Коэффициенты признаков-факторов переводятся в «+N % к риску ошибки» (отношение шансов).
"""

from __future__ import annotations

import numpy as np
from scipy.optimize import minimize
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score

from .features import FACTORS, N_FACTORS, context_row
from .layout import alphabet

PRIOR_LAMBDA = 4.0

# Как показывать фактор: подпись и «типичное изменение» признака для отношения шансов
FACTOR_VIEW = {
    'shift': ('Нужен Shift — заглавные и знаки', 1.0),
    'same_finger': ('Тот же палец подряд на другой клавише', 1.0),
    'same_key': ('Повтор той же клавиши', 1.0),
    'hand_alt': ('Смена руки', 1.0),
    'row_jump': ('Прыжок пальца через два ряда', 2.0),
    'word_start': ('Первая буква слова', 1.0),
    'symbol': ('Цифры и знаки препинания', 1.0),
    'tempo': ('Темп на 35% быстрее обычного', 0.3),
    'fatigue': ('Конец тренировки против начала', 1.0),
}


def sigmoid(z: np.ndarray) -> np.ndarray:
    return 1.0 / (1.0 + np.exp(-np.clip(z, -30, 30)))


class Model:
    """Коэффициенты логистической регрессии: w — признаки, b — свободный член."""

    def __init__(self, w: np.ndarray, b: float):
        self.w, self.b = np.asarray(w, dtype=np.float64), float(b)

    def predict(self, X: np.ndarray) -> np.ndarray:
        return sigmoid(X @ self.w + self.b)

    def factors(self) -> list[dict]:
        out = []
        for i, name in enumerate(FACTORS):
            label, delta = FACTOR_VIEW[name]
            odds = float(np.exp(self.w[i] * delta))
            out.append({'id': name, 'label': label, 'odds': round(odds, 3), 'effect': round((odds - 1) * 100, 1)})
        return sorted(out, key=lambda f: -abs(f['effect']))


def fit_global(X: np.ndarray, y: np.ndarray) -> Model:
    clf = LogisticRegression(C=1.0, max_iter=400, solver='lbfgs')
    clf.fit(X, y)
    return Model(clf.coef_[0], clf.intercept_[0])


def fit_personal(X: np.ndarray, y: np.ndarray, prior: Model, lam: float = PRIOR_LAMBDA) -> Model:
    """MAP-оценка с гауссовым априорным распределением вокруг общей модели."""
    theta0 = np.append(prior.w, prior.b)

    def loss(theta: np.ndarray) -> tuple[float, np.ndarray]:
        w, b = theta[:-1], theta[-1]
        z = X @ w + b
        p = sigmoid(z)
        eps = 1e-9
        nll = -np.sum(y * np.log(p + eps) + (1 - y) * np.log(1 - p + eps))
        diff = theta - theta0
        grad = np.append(X.T @ (p - y), np.sum(p - y)) + lam * diff
        return nll + 0.5 * lam * float(diff @ diff), grad

    res = minimize(loss, theta0, jac=True, method='L-BFGS-B', options={'maxiter': 200})
    return Model(res.x[:-1], res.x[-1])


def auc(y: np.ndarray, p: np.ndarray) -> float | None:
    if len(y) < 30 or y.min() == y.max():
        return None
    return round(float(roc_auc_score(y, p)), 3)


def char_risk(model: Model, lang: str) -> dict[str, float]:
    """Риск ошибки по символам раскладки в одинаковом «типичном» контексте: после частой буквы,
    обычный темп, середина тренировки. Так сравнивается трудность самих клавиш, а не того,
    в каких словах они вам попадались. Для редких клавиш персональная модель опирается на общую."""
    out = {}
    for ch in alphabet(lang):
        row = context_row(ch, 'о' if lang == 'ru' else 'e', lang)
        if row is not None:
            out[ch] = round(float(model.predict(row[None, :])[0]), 4)
    return out


def factor_contrast(personal: Model, prior: Model) -> list[dict]:
    """Чем вы отличаетесь от всех: разница эффектов факторов, отсортированная по модулю."""
    mine = {f['id']: f for f in personal.factors()}
    all_ = {f['id']: f for f in prior.factors()}
    out = []
    for name in FACTORS[:N_FACTORS]:
        a, b = mine[name], all_[name]
        out.append({**a, 'global': b['effect'], 'delta': round(a['effect'] - b['effect'], 1)})
    return sorted(out, key=lambda f: -abs(f['effect']))
