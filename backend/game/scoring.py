"""Очки, опыт и уровни — порт game/scoring.js."""

from .util import js_round

POINTS_PER_CHAR = 10
MAX_COMBO_MULT = 5
MAX_SCORE_BONUS = 1.5  # бонус «+50% очков»
MAX_XP_MULT = 2  # бонус «двойной опыт»


def xp_from_score(xp_score: float, accuracy: float) -> int:
    acc_factor = 1.25 if accuracy >= 97 else 1.1 if accuracy >= 93 else 1 if accuracy >= 85 else 0.75
    return max(1, js_round((xp_score / 50) * acc_factor))


def xp_for_level(level: int) -> int:
    """Сколько всего опыта нужно, чтобы достичь уровня: 0, 100, 300, 600, 1000…"""
    return 50 * (level - 1) * level


def level_from_xp(xp: int) -> int:
    level = 1
    while xp_for_level(level + 1) <= xp:
        level += 1
    return level
