"""«Заполнить демо-данными»: правдоподобная история за 4 недели — порт seedDemo() из mock.js.

Тренировки генерирует сервер, поэтому они не проходят через античит, но дальше
обрабатываются тем же apply_session, что и настоящие.
"""

from __future__ import annotations

import math
import sqlite3
from datetime import tzinfo

from . import repo
from .game.progression import apply_session, create_progress, ensure_day
from .game.scoring import POINTS_PER_CHAR, xp_from_score
from .game.util import add_days, js_round, pick, seeded_random
from .ml import synth

DEMO_BIGRAMS = {
    'ru': ['ст', 'но', 'то', 'на', 'ен', 'ов', 'ни', 'ра', 'пр', 'ро', 'щи', 'жэ', 'ъе', 'ую', 'ыв', 'хо', 'ющ', 'эт', 'фы', 'жи'],
    'en': ['th', 'he', 'in', 'er', 'an', 're', 'on', 'at', 'nd', 'qu', 'zy', 'xt', 'pl', 'bv', 'ck', 'ty', 'ou', 'wh', 'py', 'ex'],
}
LETTERS = {'ru': 'оеаинтсрвлкмдпуяыьгзбчйхжшюцщэфъ', 'en': 'etaoinshrdlcumwfgypbvkjxqz'}
WEAK = {'ru': 'щжэъюхыф', 'en': 'qzxp;bvy'}
KEYLOG_DAYS = 12
# Виртуальный «вы»: слабые клавиши и заметные эффекты Shift и темпа — их найдёт модель
DEMO_WEAK = {'ru': 'щжэх', 'en': 'qzxp'}
DEMO_WEIGHTS = {'shift': 1.25, 'tempo': 1.7, 'fatigue': 0.6, 'same_finger': 0.8, 'weak': 1.6}


def _samples(cpm: int, duration: int, rnd) -> list[dict]:
    """Посекундная скорость: разгон в первые секунды и шум."""
    out, typed = [], 0
    for t in range(1, duration + 1):
        warm = min(1.0, 0.55 + t * 0.09)
        raw = max(0, js_round(cpm * warm * (0.85 + rnd() * 0.3)))
        typed += raw / 60
        out.append({'t': t, 'cpm': js_round(typed / t * 60), 'raw': raw, 'err': 1 if rnd() < 0.08 else 0})
    return out


def seed_history(conn: sqlite3.Connection, user_id: str, now: int, tz: tzinfo) -> None:
    p = create_progress(add_days(now, -30, tz))
    rnd = seeded_random(f'demo:{user_id}')
    generated = []
    for d in range(27, -1, -1):
        if rnd() < 0.18 and d > 1:
            continue
        sessions = 1 + math.floor(rnd() * 3)
        for s in range(sessions):
            progress_t = 1 - d / 27
            lang = 'ru' if rnd() < 0.7 else 'en'
            mode = pick(['words', 'words', 'sentences', 'sentences', 'symbols', 'code'], rnd)
            cpm = js_round(150 + progress_t * 120 + (rnd() - 0.5) * 50 - (40 if mode == 'code' else 0))
            accuracy = min(100, js_round((90 + progress_t * 6.5 + (rnd() - 0.5) * 4) * 10) / 10)
            duration = pick([30, 60, 60, 120], rnd)
            chars = js_round(cpm * duration / 60)
            errors = js_round(chars * (100 - accuracy) / 100)
            max_streak = min(chars, js_round(20 + rnd() * (60 + progress_t * 160)))
            score = js_round(chars * POINTS_PER_CHAR * (1.6 + progress_t * 1.4))
            weak = WEAK[lang]
            char_stats = {}
            for ch in LETTERS[lang]:
                attempts = js_round(chars / len(LETTERS[lang]) * (0.5 + rnd()))
                rate = 0.06 + rnd() * 0.1 if ch in weak else rnd() * 0.035
                char_stats[ch] = [js_round(attempts * rate), attempts]
            bigram_stats = {}
            for bg in DEMO_BIGRAMS[lang]:
                attempts = js_round(4 + rnd() * chars / 40)
                hard = any(c in weak for c in bg)
                bigram_stats[bg] = [js_round(attempts * (0.08 + rnd() * 0.14 if hard else rnd() * 0.04)), attempts]
            ts = add_days(now, -d, tz) - js_round((sessions - s) * 3_600_000 * (1 + rnd()))
            session = {
                'mode': mode, 'lang': lang, 'codeLang': 'python' if mode == 'code' else None,
                'difficulty': 1 + math.floor(progress_t * 2), 'duration': duration, 'cpm': cpm, 'wpm': js_round(cpm / 5),
                'accuracy': accuracy, 'errors': errors, 'chars': chars, 'keystrokes': chars + errors,
                'maxStreak': max_streak, 'score': score, 'bonuses': 1 if rnd() < 0.5 else 0,
                'xp': xp_from_score(score, accuracy), 'charStats': char_stats, 'bigramStats': bigram_stats,
                'samples': _samples(cpm, duration, rnd) if d <= 3 else [],
            }
            if d <= KEYLOG_DAYS:
                prof = synth.profile(f'demo:{user_id}', cpm, accuracy, DEMO_WEAK)
                prof['w'].update(DEMO_WEIGHTS)
                session['keylog'] = synth.keylog(prof, f'demo:{user_id}:{d}:{s}', lang, min(chars, 520))
            p, report = apply_session(p, session, min(ts, now - 60_000), tz)
            generated.append((report['entry'], session))

    ensure_day(p, now, tz)
    conn.execute('DELETE FROM trainings WHERE user_id = ?', (user_id,))
    for entry, session in generated:
        repo.insert_training(conn, user_id, entry, session)
    repo.save_progress(conn, user_id, p, now)
