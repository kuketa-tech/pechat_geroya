"""Ежедневные задания — порт game/quests.js. Выбор на день детерминирован датой и совпадает с клиентом."""

from .util import seeded_random, shuffle

QUEST_POOL = [
    {'id': 'sessions3', 'title': 'Завершите 3 тренировки', 'icon': 'rotate', 'target': 3, 'reward': 60, 'kind': 'sum',
     'value': lambda s: 1},
    {'id': 'chars1500', 'title': 'Наберите 1 500 символов', 'icon': 'keyboard', 'target': 1500, 'reward': 50, 'kind': 'sum',
     'value': lambda s: s['chars']},
    {'id': 'combo60', 'title': 'Соберите серию из 60 нажатий', 'icon': 'flame', 'target': 60, 'reward': 50, 'kind': 'max',
     'value': lambda s: s['maxStreak']},
    {'id': 'acc97', 'title': 'Точность 97% в упражнении', 'icon': 'target', 'target': 97, 'reward': 50, 'kind': 'max', 'unit': '%',
     'value': lambda s: s['accuracy'] if s['chars'] >= 80 else 0},
    {'id': 'minutes8', 'title': 'Потренируйтесь 8 минут', 'icon': 'clock', 'target': 480, 'reward': 60, 'kind': 'sum', 'unit': 'time',
     'value': lambda s: s['duration']},
    {'id': 'speed180', 'title': 'Разгонитесь до 180 зн/мин', 'icon': 'zap', 'target': 180, 'reward': 60, 'kind': 'max',
     'value': lambda s: s['cpm']},
    {'id': 'symbols1', 'title': 'Пройдите упражнение «Символы»', 'icon': 'hash', 'target': 1, 'reward': 40, 'kind': 'sum', 'unlock': 2,
     'value': lambda s: 1 if s['mode'] == 'symbols' else 0},
    {'id': 'code1', 'title': 'Пройдите упражнение «Код»', 'icon': 'code', 'target': 1, 'reward': 45, 'kind': 'sum', 'unlock': 4,
     'value': lambda s: 1 if s['mode'] == 'code' else 0},
    {'id': 'bonus2', 'title': 'Поймайте 2 бонуса', 'icon': 'gift', 'target': 2, 'reward': 40, 'kind': 'sum',
     'value': lambda s: s.get('bonuses') or 0},
]

_BY_ID = {q['id']: q for q in QUEST_POOL}


def quest_def(quest_id: str):
    return _BY_ID.get(quest_id)


def public_quest(q: dict) -> dict:
    """Описание задания без функции подсчёта — для JSON."""
    return {k: v for k, v in q.items() if k != 'value'}


def daily_quests(day: str, level: int) -> list[dict]:
    rnd = seeded_random(f'quests:{day}')
    available = [q for q in QUEST_POOL if not q.get('unlock') or level >= q['unlock']]
    return [{'id': q['id'], 'progress': 0, 'done': False} for q in shuffle(available, rnd)[:3]]


def apply_quests(items: list[dict], session: dict) -> list[dict]:
    """Применяет итог тренировки к заданиям дня. Мутирует items, возвращает выполненные."""
    completed = []
    for item in items:
        if item['done']:
            continue
        d = quest_def(item['id'])
        if not d:
            continue
        v = d['value'](session)
        item['progress'] = item['progress'] + v if d['kind'] == 'sum' else max(item['progress'], v)
        if item['progress'] >= d['target']:
            item['progress'] = d['target']
            item['done'] = True
            completed.append(d)
    return completed
