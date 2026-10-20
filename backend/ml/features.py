"""Признаки одного нажатия для модели ошибок.

Каждая строка — первая попытка на позиции текста (лог из game/engine.js): что нужно было
нажать, в какой момент и ошиблись ли. Признаки описывают контекст движения:

  shift        нужен Shift (заглавная буква, знак)
  same_finger  тот же палец, что на прошлом символе, но другая клавиша
  same_key     повтор той же клавиши
  hand_alt     смена руки относительно прошлого символа
  row_jump     через сколько рядов прыгает палец (0–3)
  word_start   первая буква слова
  symbol       цифра или знак препинания
  tempo        насколько это нажатие быстрее вашего обычного темпа: −ln(интервал / медиана)
  fatigue      доля пройденной тренировки (0 — начало, 1 — конец)

Плюс one-hot физической клавиши: собственная трудность клавиши для пальца.
"""

from __future__ import annotations

import math

import numpy as np

from .layout import CODE_INDEX, CODES, hand, key_info

FACTORS = ['shift', 'same_finger', 'same_key', 'hand_alt', 'row_jump', 'word_start', 'symbol', 'tempo', 'fatigue']
N_FACTORS = len(FACTORS)
N_FEATURES = N_FACTORS + len(CODES)
PAUSE_MS = 2000  # дольше — пауза на раздумье, а не темп печати


def median_interval(keylogs: list[dict]) -> float:
    """Типичный интервал между нажатиями игрока (мс) — точка отсчёта для признака темпа."""
    gaps = []
    for log in keylogs:
        t = log['t']
        gaps.extend(b - a for a, b in zip(t, t[1:]) if 0 < b - a < PAUSE_MS)
    return float(np.median(gaps)) if gaps else 250.0


def context_row(ch: str, prev: str, lang: str, *, tempo: float = 0.0, fatigue: float = 0.5) -> np.ndarray | None:
    """Вектор признаков для символа ch после prev (без интервала — для «типичного» контекста)."""
    info = key_info(ch, lang)
    if not info or info[0] not in CODE_INDEX:
        return None
    code, shift, finger, row = info
    x = np.zeros(N_FEATURES, dtype=np.float32)
    x[0] = shift
    p = key_info(prev, lang) if prev else None
    if p:
        pcode, _, pfinger, prow = p
        x[1] = pfinger == finger and pcode != code and finger != 'th'
        x[2] = pcode == code
        x[3] = hand(pfinger) != hand(finger) and 'b' not in (hand(pfinger), hand(finger))
        if row != 4 and prow != 4:
            x[4] = abs(row - prow)
    x[5] = prev in (' ', '\n', '') and ch not in (' ', '\n')
    x[6] = not ch.isalpha() and ch not in (' ', '\n')
    x[7] = tempo
    x[8] = fatigue
    x[N_FACTORS + CODE_INDEX[code]] = 1
    return x


def session_rows(log: dict, lang: str, med: float) -> tuple[list[np.ndarray], list[int], list[str], list[str], list[float]]:
    """Строки признаков одной тренировки → (X, y, символы, предыдущие символы, интервалы)."""
    t, chars, errs = log['t'], log['ch'], log['err']
    n = min(len(t), len(chars), len(errs))
    if n < 2:
        return [], [], [], [], []
    total = max(t[n - 1], 1)
    X, y, cs, ps, gaps = [], [], [], [], []
    for i in range(n):
        ch = chars[i]
        prev = chars[i - 1] if i else ''
        gap = t[i] - t[i - 1] if i else 0
        tempo = 0.0
        if i and 0 < gap < PAUSE_MS:
            tempo = max(-2.0, min(2.0, -math.log(gap / med)))
        row = context_row(ch, prev, lang, tempo=tempo, fatigue=t[i] / total)
        if row is None:
            continue
        X.append(row)
        y.append(1 if errs[i] == '1' else 0)
        cs.append(ch)
        ps.append(prev)
        gaps.append(float(gap) if i and 0 < gap < PAUSE_MS else math.nan)
    return X, y, cs, ps, gaps
