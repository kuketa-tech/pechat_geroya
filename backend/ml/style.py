"""Стиль печати: кластеризация игроков (KMeans) по шести признакам.

  speed      медианная скорость
  accuracy   средняя точность
  stability  1 − коэффициент вариации скорости между тренировками
  endurance  средняя длительность тренировки
  variety    доля тренировок вне «Слов» и «Предложений»
  rhythm     ровность ритма: 1 − CV интервалов между нажатиями

Признаки стандартизуются, KMeans делит игроков на 4 группы. Названия группам даём
по центроидам: каждому центроиду венгерским алгоритмом сопоставляется ближайший
по косинусу прототип архетипа, так что имена не зависят от порядка кластеров.
Для игрока — его архетип и перцентили по каждой оси относительно всех.
"""

from __future__ import annotations

import numpy as np
from scipy.optimize import linear_sum_assignment
from sklearn.cluster import KMeans
from sklearn.preprocessing import StandardScaler

AXES = ['speed', 'accuracy', 'stability', 'endurance', 'variety', 'rhythm']
AXIS_LABELS = {
    'speed': 'Скорость', 'accuracy': 'Точность', 'stability': 'Стабильность',
    'endurance': 'Выносливость', 'variety': 'Разнообразие', 'rhythm': 'Ровный ритм',
}

ARCHETYPES = {
    'sprinter': {
        'name': 'Спринтер', 'icon': 'zap',
        'desc': 'Высокая скорость, но точность проседает. Ваш резерв — аккуратность: ошибки обнуляют комбо.',
        'proto': [1.2, -0.8, 0, 0, 0, -0.2],
    },
    'sniper': {
        'name': 'Снайпер', 'icon': 'target',
        'desc': 'Почти без ошибок, скорость приходит следом. Можно смелее ускоряться — точность выдержит.',
        'proto': [-0.2, 1.2, 0.3, 0, 0, 0.3],
    },
    'metronome': {
        'name': 'Метроном', 'icon': 'clock',
        'desc': 'Ровный ритм и стабильные результаты от тренировки к тренировке — фундамент слепой печати.',
        'proto': [0, 0.2, 1.0, 0.3, -0.3, 1.0],
    },
    'explorer': {
        'name': 'Исследователь', 'icon': 'layers',
        'desc': 'Пробуете всё: символы, код, свой текст. Разносторонний навык — сильная сторона.',
        'proto': [0, 0, -0.3, 0.4, 1.3, 0],
    },
}
K = len(ARCHETYPES)


def player_features(rows: list[dict], rhythm: float | None) -> dict | None:
    """rows — тренировки игрока (cpm, accuracy, duration, mode)."""
    if len(rows) < 3:
        return None
    cpm = np.array([r['cpm'] for r in rows], dtype=float)
    return {
        'speed': float(np.median(cpm)),
        'accuracy': float(np.mean([r['accuracy'] for r in rows])),
        'stability': float(max(0.0, 1 - cpm.std() / max(cpm.mean(), 1))),
        'endurance': float(np.mean([r['duration'] for r in rows])),
        'variety': float(np.mean([r['mode'] not in ('words', 'sentences') for r in rows])),
        'rhythm': rhythm,
    }


def fit(players: dict[str, dict]) -> dict | None:
    """players — {user_id: признаки}. → модель кластеров с названиями или None."""
    ids = list(players)
    if len(ids) < K * 3:
        return None
    raw = np.array([[players[i][a] if players[i][a] is not None else np.nan for a in AXES] for i in ids], dtype=float)
    col_median = np.nanmedian(raw, axis=0)
    filled = np.where(np.isnan(raw), col_median, raw)

    scaler = StandardScaler().fit(filled)
    Z = scaler.transform(filled)
    km = KMeans(n_clusters=K, n_init=10, random_state=0).fit(Z)

    keys = list(ARCHETYPES)
    protos = np.array([ARCHETYPES[k]['proto'] for k in keys], dtype=float)
    cn = km.cluster_centers_ / (np.linalg.norm(km.cluster_centers_, axis=1, keepdims=True) + 1e-9)
    pn = protos / np.linalg.norm(protos, axis=1, keepdims=True)
    rows, cols = linear_sum_assignment(-(cn @ pn.T))
    names = {int(r): keys[c] for r, c in zip(rows, cols)}

    sizes = np.bincount(km.labels_, minlength=K)
    return {
        'ids': ids, 'raw': filled, 'Z': Z, 'labels': km.labels_, 'names': names, 'scaler': scaler,
        'centers': km.cluster_centers_, 'median': col_median, 'sizes': sizes,
    }


def _percentile(col: np.ndarray, v: float) -> int:
    return int(round(100 * float(np.mean(col <= v))))


def describe_player(model: dict, user_id: str, feats: dict | None) -> dict | None:
    if not model or not feats:
        return None
    vec = np.array([feats[a] if feats[a] is not None else model['median'][i] for i, a in enumerate(AXES)], dtype=float)
    z = model['scaler'].transform(vec[None, :])[0]
    cluster = int(np.argmin(np.linalg.norm(model['centers'] - z, axis=1)))
    key = model['names'][cluster]
    center_raw = model['scaler'].inverse_transform(model['centers'][cluster][None, :])[0]
    raw = model['raw']
    axes = []
    for i, a in enumerate(AXES):
        axes.append({
            'id': a, 'label': AXIS_LABELS[a],
            'you': _percentile(raw[:, i], vec[i]),
            'group': _percentile(raw[:, i], center_raw[i]),
        })
    arch = ARCHETYPES[key]
    return {
        'id': key, 'name': arch['name'], 'icon': arch['icon'], 'desc': arch['desc'],
        'axes': axes, 'groupSize': int(model['sizes'][cluster]), 'players': len(model['ids']),
    }


def describe_population(model: dict | None) -> list[dict]:
    if not model:
        return []
    out = []
    for cluster, key in sorted(model['names'].items(), key=lambda kv: -model['sizes'][kv[0]]):
        center = model['scaler'].inverse_transform(model['centers'][cluster][None, :])[0]
        out.append({
            'id': key, 'name': ARCHETYPES[key]['name'], 'icon': ARCHETYPES[key]['icon'],
            'size': int(model['sizes'][cluster]),
            'speed': round(float(center[0])), 'accuracy': round(float(center[1]), 1),
        })
    return out
