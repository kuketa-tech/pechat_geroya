"""Физическая клавиатура для признаков модели — порт frontend/js/data/layouts.js.

Модель работает с физическими клавишами, а не с буквами: «ф» и «a» — одна клавиша KeyA,
один палец и одно движение. Поэтому навык, натренированный на одной раскладке, помогает
предсказывать ошибки на другой, а общая модель учится сразу на русских и английских текстах.
"""

from __future__ import annotations

LETTER_CODES = [f'Key{c}' for c in 'QWERTYUIOPASDFGHJKLZXCVBNM']
LETTERS = {'en': 'qwertyuiopasdfghjklzxcvbnm', 'ru': 'йцукенгшщзфывапролдячсмить'}

_BASE = {
    'en': {
        'Backquote': '`~', 'Digit1': '1!', 'Digit2': '2@', 'Digit3': '3#', 'Digit4': '4$', 'Digit5': '5%',
        'Digit6': '6^', 'Digit7': '7&', 'Digit8': '8*', 'Digit9': '9(', 'Digit0': '0)', 'Minus': '-_', 'Equal': '=+',
        'BracketLeft': '[{', 'BracketRight': ']}', 'Backslash': '\\|', 'Semicolon': ';:', 'Quote': '\'"',
        'Comma': ',<', 'Period': '.>', 'Slash': '/?',
    },
    'ru': {
        'Backquote': 'ёЁ', 'Digit1': '1!', 'Digit2': '2"', 'Digit3': '3№', 'Digit4': '4;', 'Digit5': '5%',
        'Digit6': '6:', 'Digit7': '7?', 'Digit8': '8*', 'Digit9': '9(', 'Digit0': '0)', 'Minus': '-_', 'Equal': '=+',
        'BracketLeft': 'хХ', 'BracketRight': 'ъЪ', 'Backslash': '\\/', 'Semicolon': 'жЖ', 'Quote': 'эЭ',
        'Comma': 'бБ', 'Period': 'юЮ', 'Slash': '.,',
    },
}

FINGER_KEYS = {
    'lp': ['Backquote', 'Digit1', 'KeyQ', 'KeyA', 'KeyZ'],
    'lr': ['Digit2', 'KeyW', 'KeyS', 'KeyX'],
    'lm': ['Digit3', 'KeyE', 'KeyD', 'KeyC'],
    'li': ['Digit4', 'Digit5', 'KeyR', 'KeyT', 'KeyF', 'KeyG', 'KeyV', 'KeyB'],
    'th': ['Space'],
    'ri': ['Digit6', 'Digit7', 'KeyY', 'KeyU', 'KeyH', 'KeyJ', 'KeyN', 'KeyM'],
    'rm': ['Digit8', 'KeyI', 'KeyK', 'Comma'],
    'rr': ['Digit9', 'KeyO', 'KeyL', 'Period'],
    'rp': ['Digit0', 'Minus', 'Equal', 'KeyP', 'BracketLeft', 'BracketRight', 'Backslash', 'Semicolon', 'Quote',
           'Enter', 'Slash'],
}
FINGER_OF = {code: f for f, codes in FINGER_KEYS.items() for code in codes}
FINGER_NAMES = {
    'lp': 'Левый мизинец', 'lr': 'Левый безымянный', 'lm': 'Левый средний', 'li': 'Левый указательный',
    'th': 'Большие пальцы', 'ri': 'Правый указательный', 'rm': 'Правый средний', 'rr': 'Правый безымянный',
    'rp': 'Правый мизинец',
}
FINGER_ORDER = ['lp', 'lr', 'lm', 'li', 'th', 'ri', 'rm', 'rr', 'rp']

ROWS = {
    0: ['Backquote', 'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0',
        'Minus', 'Equal'],
    1: ['KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT', 'KeyY', 'KeyU', 'KeyI', 'KeyO', 'KeyP', 'BracketLeft', 'BracketRight',
        'Backslash'],
    2: ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyK', 'KeyL', 'Semicolon', 'Quote', 'Enter'],
    3: ['KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB', 'KeyN', 'KeyM', 'Comma', 'Period', 'Slash'],
    4: ['Space'],
}
ROW_OF = {code: row for row, codes in ROWS.items() for code in codes}
ROW_NAMES = {0: 'Цифровой ряд', 1: 'Верхний ряд', 2: 'Основной ряд', 3: 'Нижний ряд', 4: 'Пробел'}

CODES = [code for row in sorted(ROWS) for code in ROWS[row]]
CODE_INDEX = {code: i for i, code in enumerate(CODES)}


def _build_index() -> dict[str, dict[str, tuple[str, bool]]]:
    out = {}
    for lang, base in _BASE.items():
        pairs = dict(base)
        for code, ch in zip(LETTER_CODES, LETTERS[lang]):
            pairs[code] = ch + ch.upper()
        idx: dict[str, tuple[str, bool]] = {' ': ('Space', False), '\n': ('Enter', False)}
        for code, (lo, hi) in pairs.items():
            idx.setdefault(lo, (code, False))
            idx.setdefault(hi, (code, True))
        out[lang] = idx
    return out


CHAR_INDEX = _build_index()


def key_info(ch: str, lang: str) -> tuple[str, bool, str, int] | None:
    """Символ → (клавиша, нужен ли Shift, палец, ряд). Ищем в своей раскладке, потом в другой."""
    hit = CHAR_INDEX[lang].get(ch) or CHAR_INDEX['en' if lang == 'ru' else 'ru'].get(ch)
    if not hit:
        return None
    code, shift = hit
    return code, shift, FINGER_OF.get(code, 'rp'), ROW_OF.get(code, 2)


def hand(finger: str) -> str:
    return finger[0] if finger != 'th' else 'b'


def alphabet(lang: str) -> str:
    """Символы, для которых считаем риск (тепловая карта и умная тренировка)."""
    return LETTERS[lang] + ('ёхъжэбю' if lang == 'ru' else '') + '0123456789.,;:-'
