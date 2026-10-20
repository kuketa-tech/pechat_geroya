"""Прогресс игрока — порт game/progression.js.

Отличие от клиента: история тренировок живёт в отдельной таблице trainings, поэтому
apply_session не дописывает её в документ прогресса, а возвращает запись для вставки.
"""

from __future__ import annotations

import copy
from datetime import tzinfo

from .achievements import ACHIEVEMENTS, RARITY, public_achievement
from .quests import apply_quests, daily_quests, public_quest
from .scoring import level_from_xp
from .util import day_key, days_between, local_dt, uid

EMPTY_DAY = {'sessions': 0, 'timeSec': 0, 'chars': 0, 'xp': 0, 'cpmSum': 0, 'accSum': 0, 'bestCpm': 0}


def create_progress(now: int) -> dict:
    return {
        'version': 1,
        'createdAt': now,
        'xp': 0,
        'level': 1,
        'totals': {
            'sessions': 0, 'timeSec': 0, 'chars': 0, 'keystrokes': 0, 'errors': 0, 'bonuses': 0,
            'bestCpm': 0, 'bestStreak': 0, 'accuracyRun': 0,
            'langs': {'ru': 0, 'en': 0},
            'modes': {},
        },
        'modeBest': {},
        'flags': {},
        'charStats': {'ru': {}, 'en': {}},
        'bigramStats': {'ru': {}, 'en': {}},
        'achievements': {},
        'streak': {'current': 0, 'best': 0, 'lastDay': None},
        'quests': {'day': None, 'items': []},
        'days': {},
    }


def ensure_day(p: dict, now: int, tz: tzinfo) -> bool:
    """Выдаёт задания нового дня. Мутирует p, возвращает True, если что-то поменялось."""
    today = day_key(now, tz)
    if p['quests']['day'] == today:
        return False
    p['quests'] = {'day': today, 'items': daily_quests(today, p['level'])}
    return True


def _merge_stats(target: dict, src: dict) -> None:
    for k, (e, a) in (src or {}).items():
        rec = target.setdefault(k, [0, 0])
        rec[0] += e
        rec[1] += a


def apply_session(progress: dict, session: dict, now: int, tz: tzinfo) -> tuple[dict, dict]:
    """Применить завершённую тренировку → (новый прогресс, отчёт). Отчёт содержит entry для истории."""
    p = copy.deepcopy(progress)
    ensure_day(p, now, tz)
    day = day_key(now, tz)
    t = p['totals']
    level_before = level_from_xp(p['xp'])
    prev_best_cpm = t['bestCpm']
    counts = session['chars'] >= 20 and session['duration'] >= 8

    entry = {
        'id': uid(),
        'ts': now,
        'mode': session['mode'],
        'lang': session['lang'],
        'codeLang': session.get('codeLang'),
        'difficulty': session['difficulty'],
        'cpm': session['cpm'],
        'wpm': session['wpm'],
        'accuracy': session['accuracy'],
        'errors': session['errors'],
        'chars': session['chars'],
        'duration': session['duration'],
        'maxStreak': session['maxStreak'],
        'score': session['score'],
        'bonuses': session['bonuses'],
        'samples': [s['cpm'] for s in session.get('samples') or []],
    }

    t['sessions'] += 1
    t['timeSec'] += session['duration']
    t['chars'] += session['chars']
    t['keystrokes'] += session['keystrokes']
    t['errors'] += session['errors']
    t['bonuses'] += session.get('bonuses') or 0
    t['bestStreak'] = max(t['bestStreak'], session['maxStreak'])
    t['langs'][session['lang']] = t['langs'].get(session['lang'], 0) + 1
    t['modes'][session['mode']] = t['modes'].get(session['mode'], 0) + 1
    t['accuracyRun'] = t['accuracyRun'] + 1 if session['accuracy'] >= 98 and session['chars'] >= 50 else 0
    is_best_cpm = counts and session['cpm'] > t['bestCpm']
    if is_best_cpm:
        t['bestCpm'] = session['cpm']
    if counts:
        p['modeBest'][session['mode']] = max(p['modeBest'].get(session['mode'], 0), session['cpm'])

    hour = local_dt(now, tz).hour
    flags = p['flags']
    if session['accuracy'] == 100 and session['chars'] >= 100:
        flags['cleanSheet'] = True
    if session['mode'] == 'symbols' and session['accuracy'] >= 95 and session['chars'] >= 50:
        flags['cipher'] = True
    if session['mode'] == 'code' and session['errors'] == 0 and session['chars'] >= 40:
        flags['flawlessCode'] = True
    if hour < 5:
        flags['nightOwl'] = True
    elif hour < 8:
        flags['earlyBird'] = True

    _merge_stats(p['charStats'].setdefault(session['lang'], {}), session.get('charStats'))
    _merge_stats(p['bigramStats'].setdefault(session['lang'], {}), session.get('bigramStats'))

    streak = p['streak']
    if streak['lastDay'] != day:
        gap = days_between(streak['lastDay'], day) if streak['lastDay'] else None
        streak['current'] = streak['current'] + 1 if gap == 1 else 1
        streak['lastDay'] = day
        streak['best'] = max(streak['best'], streak['current'])

    d = p['days'].setdefault(day, dict(EMPTY_DAY))
    d['sessions'] += 1
    d['timeSec'] += session['duration']
    d['chars'] += session['chars']
    d['cpmSum'] += session['cpm']
    d['accSum'] += session['accuracy']
    d['bestCpm'] = max(d['bestCpm'], session['cpm'])

    # Опыт: тренировка → задания → достижения (достижения уровня проверяем после начисления)
    breakdown = [{'kind': 'base', 'label': 'За тренировку', 'xp': session['xp']}]
    gained = session['xp']

    quests_completed = apply_quests(p['quests']['items'], session)
    for q in quests_completed:
        breakdown.append({'kind': 'quest', 'label': q['title'], 'xp': q['reward']})
        gained += q['reward']
    p['xp'] += gained
    p['level'] = level_from_xp(p['xp'])

    new_achievements = []
    for _ in range(2):
        for a in ACHIEVEMENTS:
            if a['id'] in p['achievements']:
                continue
            cur, target = a['progress'](p)
            if cur < target:
                continue
            p['achievements'][a['id']] = now
            new_achievements.append(a)
            bonus = RARITY[a['rarity']]['xp']
            breakdown.append({'kind': 'ach', 'label': a['title'], 'xp': bonus})
            gained += bonus
            p['xp'] += bonus
        p['level'] = level_from_xp(p['xp'])

    d['xp'] += gained
    entry['xp'] = gained

    return p, {
        'entry': entry,
        'xpGained': gained,
        'breakdown': breakdown,
        'xpBefore': progress['xp'],
        'xpAfter': p['xp'],
        'levelBefore': level_before,
        'levelAfter': p['level'],
        'newAchievements': [public_achievement(a) for a in new_achievements],
        'questsCompleted': [public_quest(q) for q in quests_completed],
        'isBestCpm': bool(is_best_cpm and prev_best_cpm > 0),
        'prevBestCpm': prev_best_cpm,
    }
