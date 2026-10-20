"""Проверка правдоподобности итога тренировки.

Клиент присылает сырые метрики, сервер проверяет, что они согласованы между собой и
физически достижимы. Ограничения выведены из движка (game/engine.js):
  keystrokes = chars + errors;  accuracy = chars / keystrokes;  cpm = chars / duration;
  maxStreak ≤ chars;  ошибки делят верные нажатия максимум на errors + 1 серий;
  каждая позиция текста даёт ровно одну «попытку» в charStats;
  очки за символ — от 10 (без комбо) до 75 (×5 и +50%), опыт — из очков по xpFromScore.
Плюс поведенческие: человек не печатает быстрее ~1200 зн/мин, а 60-секундную
тренировку нельзя закончить через 10 секунд после предыдущей.
"""

from __future__ import annotations

import math

from .scoring import MAX_COMBO_MULT, MAX_SCORE_BONUS, MAX_XP_MULT, POINTS_PER_CHAR, xp_from_score
from .util import js_round

MAX_CPM = 1200  # рекорды слепой печати — около 1000–1100 зн/мин на дистанции
MAX_BURST_CPM = 2400  # одна секунда: 40 символов — уже за гранью
MAX_DURATION = 60 * 60
TIME_BONUS_SEC = 5
MIN_BONUS_STREAK = 10  # game/bonuses.js: MIN_STREAK
MAX_SAVES_PER_DAY = 400


class Rejected(ValueError):
    """Результат не прошёл проверку — текст объясняет причину игроку."""


def _check(cond: bool, reason: str) -> None:
    if not cond:
        raise Rejected(reason)


def _stats_sums(stats: dict) -> tuple[int, int]:
    errors = attempts = 0
    for e, a in stats.values():
        errors += e
        attempts += a
    return errors, attempts


def validate_session(s: dict, *, last_save_ts: int | None, saves_today: int, now: int) -> None:
    """Бросает Rejected, если итог неправдоподобен. s — уже провалидированный по типам payload."""
    chars, errors, keys = s['chars'], s['errors'], s['keystrokes']
    duration, cpm = s['duration'], s['cpm']

    # --- согласованность метрик ---
    _check(chars >= 5, 'Напечатано слишком мало символов.')
    _check(0 < duration <= MAX_DURATION, 'Некорректная длительность тренировки.')
    _check(keys == chars + errors, 'Число нажатий не сходится с символами и ошибками.')

    expected_cpm = chars / (max(duration, 1) / 60)
    _check(abs(cpm - expected_cpm) <= max(3, expected_cpm * 0.03), 'Скорость не соответствует времени и числу символов.')
    _check(abs(s['wpm'] - js_round(cpm / 5)) <= 1, 'Скорость в словах не сходится со скоростью в знаках.')
    expected_acc = chars / keys * 100
    _check(abs(s['accuracy'] - expected_acc) <= 0.15, 'Точность не сходится с числом ошибок.')

    # --- физические пределы ---
    _check(cpm <= MAX_CPM, f'Скорость выше {MAX_CPM} зн/мин — так быстро люди не печатают.')

    setting = s.get('durationSetting') or 0
    if setting:
        _check(duration <= setting + TIME_BONUS_SEC * s['bonuses'] + 1.5, 'Тренировка длилась дольше выбранного времени.')

    # --- серии ---
    _check(s['maxStreak'] <= chars, 'Серия длиннее числа верных символов.')
    _check(s['maxStreak'] >= math.ceil(chars / (errors + 1)), 'Серия слишком короткая для такого числа ошибок.')

    # --- очки и опыт ---
    # Последний символ текста завершает упражнение раньше, чем тренажёр начислит за него очки
    _check((chars - 1) * POINTS_PER_CHAR <= s['score'] <= chars * POINTS_PER_CHAR * MAX_COMBO_MULT * MAX_SCORE_BONUS,
           'Очки не соответствуют числу символов.')
    if s['bonuses'] == 0:
        _check(s['xp'] == xp_from_score(s['score'], s['accuracy']), 'Опыт не соответствует очкам.')
    else:
        _check(xp_from_score(s['score'], s['accuracy']) <= s['xp'] <= xp_from_score(s['score'] * MAX_XP_MULT, s['accuracy']),
               'Опыт не соответствует очкам.')
    # Бонус выпадает на верное нажатие при серии от 10. Ограничить их временем нельзя:
    # кулдаун идёт по часам, а пауза (потеря фокуса) в длительность не входит.
    _check(s['bonuses'] <= max(0, chars - MIN_BONUS_STREAK + 1), 'Слишком много бонусов для такой тренировки.')

    # --- статистика по клавишам ---
    char_errors, char_attempts = _stats_sums(s['charStats'])
    _check(all(0 <= e <= a for e, a in s['charStats'].values()), 'Некорректная статистика по клавишам.')
    _check(all(0 <= e <= a for e, a in s['bigramStats'].values()), 'Некорректная статистика по сочетаниям.')
    # + errors: в свободном режиме позиции с неисправленной ошибкой тронуты, но не напечатаны верно
    _check(chars <= char_attempts <= chars + errors + 1, 'Статистика по клавишам не сходится с числом символов.')
    _check(s.get('uncorrected', 0) <= errors, 'Неисправленных ошибок больше, чем всего ошибок.')
    _check(char_errors <= errors, 'Ошибок по клавишам больше, чем всего ошибок.')
    _, bigram_attempts = _stats_sums(s['bigramStats'])
    _check(bigram_attempts <= char_attempts, 'Сочетаний больше, чем напечатанных символов.')

    # --- лог нажатий (для модели ошибок) ---
    log = s.get('keylog')
    if log and log.get('t'):
        _check(len(log['t']) <= char_attempts, 'Лог нажатий длиннее напечатанного текста.')
        _check(log['err'].count('1') <= char_errors, 'В логе нажатий больше ошибок, чем в статистике.')
        _check(log['t'][-1] / 1000 <= duration + 2, 'Лог нажатий длиннее тренировки.')

    # --- посекундные замеры ---
    samples = s['samples']
    _check(len(samples) <= duration + 2, 'Замеров больше, чем секунд тренировки.')
    _check(all(sm['raw'] <= MAX_BURST_CPM for sm in samples), 'Нечеловеческий всплеск скорости в одном из замеров.')
    _check(sum(sm['raw'] for sm in samples) / 60 <= chars + 1, 'Замеры скорости не сходятся с числом символов.')

    # --- темп сохранений ---
    if last_save_ts is not None:
        since = (now - last_save_ts) / 1000
        _check(since + 2 >= duration * 0.9, 'Новая тренировка закончилась раньше, чем могла начаться.')
    _check(saves_today < MAX_SAVES_PER_DAY, 'Достигнут дневной лимит тренировок.')
