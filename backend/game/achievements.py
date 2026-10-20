"""Каталог достижений — порт data/achievements.js. progress(p) → (текущее, цель)."""

from .util import js_round

RARITY = {
    'common': {'title': 'Обычное', 'xp': 25},
    'rare': {'title': 'Редкое', 'xp': 75},
    'epic': {'title': 'Эпическое', 'xp': 200},
    'legend': {'title': 'Легендарное', 'xp': 500},
}


def _flag(name):
    return lambda p: (1 if p['flags'].get(name) else 0, 1)


def _t(key, target):
    return lambda p: (p['totals'][key], target)


def _a(id_, title, desc, icon, rarity, progress):
    return {'id': id_, 'title': title, 'desc': desc, 'icon': icon, 'rarity': rarity, 'progress': progress}


ACHIEVEMENTS = [
    _a('first_steps', 'Первые шаги', 'Завершите первую тренировку', 'play', 'common', _t('sessions', 1)),
    _a('warmup', 'Разминка', 'Завершите 10 тренировок', 'rotate', 'common', _t('sessions', 10)),
    _a('speed_200', 'Скорость звука', 'Достигните 200 символов в минуту', 'zap', 'common', _t('bestCpm', 200)),
    _a('combo_x5', 'В огне', 'Разгоните комбо до множителя ×5', 'flame', 'common', _t('bestStreak', 50)),
    _a('chars_10k', 'Десять тысяч', 'Наберите 10 000 символов', 'keyboard', 'common', _t('chars', 10000)),
    _a('streak_3', 'Привычка', 'Тренируйтесь 3 дня подряд', 'calendar', 'common', lambda p: (p['streak']['best'], 3)),
    _a('lucky', 'Везунчик', 'Поймайте 10 случайных бонусов', 'dice', 'common', _t('bonuses', 10)),
    _a('level_5', 'Оруженосец', 'Достигните 5 уровня', 'shield', 'common', lambda p: (p['level'], 5)),

    _a('speed_300', 'Молния', 'Достигните 300 символов в минуту', 'zap', 'rare', _t('bestCpm', 300)),
    _a('clean_sheet', 'Чистый лист', '100% точности в тренировке от 100 символов', 'check', 'rare', _flag('cleanSheet')),
    _a('combo_300', 'Огненный шторм', 'Соберите серию из 300 нажатий без ошибок', 'flame', 'rare', _t('bestStreak', 300)),
    _a('marathon', 'Марафонец', 'Проведите за тренировками 1 час', 'mountain', 'rare',
       lambda p: (int(p['totals']['timeSec'] // 60), 60)),
    _a('polyglot', 'Полиглот', 'Тренируйтесь на русском и на английском', 'languages', 'rare',
       lambda p: (int(p['totals']['langs'].get('ru', 0) > 0) + int(p['totals']['langs'].get('en', 0) > 0), 2)),
    _a('coder', 'Кодер', 'Завершите упражнение в режиме «Код»', 'code', 'rare',
       lambda p: (p['totals']['modes'].get('code', 0), 1)),
    _a('cipher', 'Шифровальщик', 'Режим «Символы» с точностью от 95%', 'hash', 'rare', _flag('cipher')),
    _a('streak_7', 'Неделя огня', 'Тренируйтесь 7 дней подряд', 'calendar', 'rare', lambda p: (p['streak']['best'], 7)),
    _a('night_owl', 'Ночная сова', 'Тренировка между полуночью и пятью утра', 'moon', 'rare', _flag('nightOwl')),
    _a('early_bird', 'Ранняя пташка', 'Тренировка с пяти до восьми утра', 'sunrise', 'rare', _flag('earlyBird')),
    _a('level_10', 'Ветеран', 'Достигните 10 уровня', 'swords', 'rare', lambda p: (p['level'], 10)),

    _a('steel_finger', 'Стальной палец', '1000 правильных нажатий подряд', 'hand', 'epic', _t('bestStreak', 1000)),
    _a('sniper', 'Снайпер', '5 тренировок подряд с точностью от 98%', 'target', 'epic', _t('accuracyRun', 5)),
    _a('speed_450', 'Ураган', 'Достигните 450 символов в минуту', 'wind', 'epic', _t('bestCpm', 450)),
    _a('flawless_code', 'Чистый код', 'Упражнение «Код» без единой ошибки', 'code', 'epic', _flag('flawlessCode')),
    _a('chars_100k', 'Летописец', 'Наберите 100 000 символов', 'feather', 'epic', _t('chars', 100000)),

    _a('genius', 'Печатный гений', 'Достигните 300 слов в минуту', 'crown', 'legend',
       lambda p: (js_round(p['totals']['bestCpm'] / 5), 300)),
    _a('streak_30', 'Несгибаемый', 'Тренируйтесь 30 дней подряд', 'flame', 'legend', lambda p: (p['streak']['best'], 30)),
    _a('level_20', 'Герой печати', 'Достигните 20 уровня', 'crown', 'legend', lambda p: (p['level'], 20)),
]


def public_achievement(a: dict) -> dict:
    return {k: v for k, v in a.items() if k != 'progress'}
