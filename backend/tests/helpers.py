"""Генератор правдоподобного итога тренировки — такого же, какой шлёт тренажёр (game/engine.js)."""

from __future__ import annotations

import math
import random

from backend.game.scoring import POINTS_PER_CHAR, xp_from_score

WORDS = 'время дело жизнь рука слово место друг глаз вопрос город земля машина вода книга дорога ветер огонь'.split()


def make_session(*, cpm: float = 240, error_rate: float = 0.04, n_chars: int = 160, seed: int = 1,
                 mode: str = 'words', lang: str = 'ru', robotic: bool = False, challenge_day: str | None = None) -> dict:
    rnd = random.Random(seed)
    text = ' '.join(rnd.choice(WORDS) for _ in range(n_chars))[:n_chars].rstrip()
    chars = len(text)
    median = 60000 / cpm

    t, clock = [], 0.0
    for i in range(chars):
        if i:
            clock += median if robotic else median * math.exp(rnd.gauss(0, 0.4) - 0.08)
        t.append(int(clock))
    err_pos = sorted(rnd.sample(range(chars), max(0, round(chars * error_rate))))
    err_set = set(err_pos)
    errors = len(err_pos)

    char_stats: dict[str, list[int]] = {}
    bigram_stats: dict[str, list[int]] = {}
    for i, ch in enumerate(text):
        key = '␣' if ch == ' ' else ch.lower()
        rec = char_stats.setdefault(key, [0, 0])
        rec[1] += 1
        rec[0] += i in err_set
        if i and text[i - 1] != ' ' and ch != ' ':
            bg = bigram_stats.setdefault((text[i - 1] + ch).lower(), [0, 0])
            bg[1] += 1
            bg[0] += i in err_set

    duration = round((t[-1] + median) / 100) / 10
    real_cpm = round(chars / (max(duration, 1) / 60))
    keystrokes = chars + errors
    accuracy = round(chars / keystrokes * 1000) / 10
    runs, prev = [], -1
    for p in err_pos + [chars]:
        runs.append(p - prev - 1)
        prev = p
    score = chars * POINTS_PER_CHAR

    samples = []
    for sec in range(1, int(duration) + 1):
        done = sum(1 for x in t if x < sec * 1000)
        last = sum(1 for x in t if (sec - 1) * 1000 <= x < sec * 1000)
        samples.append({'t': sec, 'cpm': round(done / sec * 60), 'raw': last * 60, 'err': 0})

    return {
        'mode': mode, 'lang': lang, 'codeLang': None, 'difficulty': 1, 'durationSetting': 0,
        'duration': duration, 'cpm': real_cpm, 'wpm': round(real_cpm / 5), 'accuracy': accuracy,
        'errors': errors, 'chars': chars, 'keystrokes': keystrokes, 'maxStreak': max(runs),
        'score': score, 'bonuses': 0, 'xp': xp_from_score(score, accuracy),
        'charStats': char_stats, 'bigramStats': bigram_stats, 'samples': samples,
        'errorMode': 'strict', 'uncorrected': 0, 'backspaces': 0,
        'keylog': {'t': t, 'ch': text, 'err': ''.join('1' if i in err_set else '0' for i in range(chars))},
        'challengeDay': challenge_day,
    }
