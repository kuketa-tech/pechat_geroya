"""Синтетические логи нажатий для демо-истории и демо-соперников.

Чтобы на свежей базе ML-часть было что показать, демо-данные печатает «виртуальный
игрок» с заданными слабостями: вероятность ошибки — логистическая функция от тех же
факторов, что видит модель (Shift, тот же палец, прыжок через ряд, темп, усталость,
слабые клавиши), интервалы — логнормальные. У каждого соперника свои веса факторов,
поэтому общая модель учится на разнородной популяции, а персональная находит отличия.
"""

from __future__ import annotations

import math

from ..game.util import seeded_random
from .features import context_row
from .layout import key_info

WORDS = {
    'ru': ('время дело жизнь день рука работа слово место лицо друг глаз вопрос дом сторона страна мир случай '
           'голова ребенок сила конец вид система часть город отношение женщина деньги земля машина вода отец '
           'проблема час право нога решение дверь образ история власть закон война голос книга возможность '
           'результат ночь стол имя область статья число компания народ жена группа развитие процесс суд '
           'условие средство начало свет пора путь душа уровень форма связь минута улица вечер качество мысль '
           'дорога мать действие месяц государство язык любовь взгляд мама век школа цель общество деятельность '
           'щит жук журнал объем съезд экран эхо юла хвост фраза шесть щука чаща ёжик подъезд роща щедрый '
           'жизнь жажда хижина этаж эпоха поэт хор хлеб ухо вещь ещё площадь товарищ жест ножи').split(),
    'en': ('time person year way day thing man world life hand part child eye woman place work week case point '
           'government company number group problem fact quick brown fox jumps over lazy dog keyboard practice '
           'accuracy progress training mountain treasure champion dragon castle knight shield sword legend journey '
           'victory rhythm finger letter typing record winner simple better change follow friend future garden '
           'island market nature people planet reason school system window zebra quiz box jazz pixel puzzle '
           'vivid python script value object method').split(),
}

FACTOR_KEYS = ('shift', 'same_finger', 'same_key', 'hand_alt', 'row_jump', 'word_start', 'symbol', 'tempo', 'fatigue')


def profile(seed: str, cpm: float, accuracy: float, lang_weak: dict[str, str] | None = None) -> dict:
    """Параметры виртуального игрока, детерминированно по seed."""
    rnd = seeded_random(f'synth:{seed}')
    base_err = max(0.004, min(0.2, (100 - accuracy) / 100 * 0.55))
    weak = lang_weak or {
        'ru': ''.join(rnd_pick(rnd, 'щжэъюхыфцчшзйё', 4)),
        'en': ''.join(rnd_pick(rnd, 'qzxpbvyjkw;', 4)),
    }
    return {
        'interval': 60000 / max(cpm, 60),
        'sigma': 0.3 + rnd() * 0.35,
        'base': math.log(base_err / (1 - base_err)),
        'weak': weak,
        'w': {
            'shift': 0.4 + rnd() * 0.9,
            'same_finger': 0.3 + rnd() * 0.8,
            'same_key': -0.3 + rnd() * 0.5,
            'hand_alt': -0.35 + rnd() * 0.3,
            'row_jump': 0.1 + rnd() * 0.35,
            'word_start': 0.1 + rnd() * 0.5,
            'symbol': 0.3 + rnd() * 0.8,
            'tempo': 0.6 + rnd() * 1.4,
            'fatigue': rnd() * 0.8,
            'weak': 1.0 + rnd() * 1.0,
        },
    }


def rnd_pick(rnd, alphabet: str, k: int) -> list[str]:
    pool = list(alphabet)
    out = []
    for _ in range(min(k, len(pool))):
        out.append(pool.pop(int(rnd() * len(pool))))
    return out


def _text(rnd, lang: str, n_chars: int, caps: float) -> str:
    words, size = [], 0
    vocab = WORDS[lang]
    while size < n_chars:
        w = vocab[int(rnd() * len(vocab))]
        if rnd() < caps:
            w = w[0].upper() + w[1:]
        if rnd() < 0.06:
            w += ',' if rnd() < 0.7 else '.'
        if rnd() < 0.03:
            w = str(int(rnd() * 90) + 10)
        words.append(w)
        size += len(w) + 1
    return ' '.join(words)[:n_chars]


def keylog(prof: dict, seed: str, lang: str, n_chars: int) -> dict:
    """Лог первой попытки на каждой позиции: {t: [мс], ch: str, err: '0101…'}."""
    rnd = seeded_random(f'keylog:{seed}')
    text = _text(rnd, lang, n_chars, caps=0.12)
    w = prof['w']
    weak = prof['weak'].get(lang, '')
    t_ms, chars, errs = [], [], []
    clock = 0.0
    n = len(text)
    for i, ch in enumerate(text):
        prev = text[i - 1] if i else ''
        info = key_info(ch, lang)
        row = context_row(ch, prev, lang)
        if not info or row is None:
            continue
        # интервал: логнормальный, длиннее на Shift, на первой букве слова и тем же пальцем
        mult = 1.0 + 0.35 * row[0] + 0.3 * row[5] + 0.25 * row[1] + (0.25 if ch in weak else 0)
        z = (rnd() + rnd() + rnd() - 1.5) * 2  # ~N(0, 1)
        gap = prof['interval'] * mult * math.exp(prof['sigma'] * z - prof['sigma'] ** 2 / 2)
        if rnd() < 0.02:
            gap += 600 + rnd() * 900  # раздумье
        clock += gap if i else 0
        tempo = max(-2.0, min(2.0, -math.log(max(gap, 20) / prof['interval']))) if i else 0.0
        logit = prof['base'] + w['weak'] * (ch.lower() in weak) + w['tempo'] * tempo + w['fatigue'] * (i / max(n, 1))
        for j, name in enumerate(FACTOR_KEYS[:7]):
            logit += w[name] * float(row[j])
        p = 1 / (1 + math.exp(-logit))
        t_ms.append(int(clock))
        chars.append(ch)
        errs.append('1' if rnd() < p else '0')
    return {'t': t_ms, 'ch': ''.join(chars), 'err': ''.join(errs)}
