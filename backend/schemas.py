"""Входные данные API. Типы и диапазоны проверяет pydantic, согласованность — game/anticheat.py."""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

MAX_STAT_KEYS = 10_000  # в режиме «Символы» сочетаний бывают тысячи


class _In(BaseModel):
    model_config = ConfigDict(extra='ignore')


class RegisterIn(_In):
    name: str = Field('', max_length=200)
    email: str = Field(max_length=254)
    password: str = Field(max_length=200)


class LoginIn(_In):
    email: str = Field(max_length=254)
    password: str = Field(max_length=200)


class SocialIn(_In):
    provider: str = Field(max_length=32)


class ProfileIn(_In):
    name: Optional[str] = Field(None, max_length=200)


class Sample(_In):
    t: int = Field(ge=0)
    cpm: int = Field(ge=0)
    raw: int = Field(ge=0)
    err: int = Field(ge=0)


def _check_stats(v: dict) -> dict:
    if len(v) > MAX_STAT_KEYS:
        raise ValueError('слишком много ключей')
    for key, rec in v.items():
        if not 0 < len(key) <= 4:
            raise ValueError('некорректный ключ')
        if len(rec) != 2 or any(not isinstance(x, int) or x < 0 for x in rec):
            raise ValueError('ожидается [ошибки, попытки]')
    return v


class KeyLog(_In):
    """Первая попытка на каждой позиции текста: время от старта (мс), символ, ошибка (0/1)."""

    t: list[int] = Field(default_factory=list, max_length=8000)
    ch: str = Field('', max_length=8000)
    err: str = Field('', max_length=8000)

    @model_validator(mode='after')
    def consistent(self) -> 'KeyLog':
        if not len(self.t) == len(self.ch) == len(self.err):
            raise ValueError('длины t, ch и err должны совпадать')
        if any(b < a for a, b in zip(self.t, self.t[1:])) or (self.t and self.t[0] < 0):
            raise ValueError('время нажатий должно не убывать')
        if set(self.err) - {'0', '1'}:
            raise ValueError('err — строка из 0 и 1')
        return self


class SessionIn(_In):
    """Итог тренировки — то, что TypingSession.result() и тренажёр отправляют в api.saveSession()."""

    mode: Literal['words', 'sentences', 'code', 'symbols', 'smart', 'custom', 'daily']
    lang: Literal['ru', 'en']
    codeLang: Optional[Literal['python', 'js', 'html', 'css']] = None
    difficulty: int = Field(ge=1, le=4)
    durationSetting: Literal[0, 30, 60, 120] = 0
    duration: float = Field(gt=0, le=3600)
    cpm: int = Field(ge=0)
    wpm: int = Field(ge=0)
    accuracy: float = Field(ge=0, le=100)
    errors: int = Field(ge=0)
    chars: int = Field(ge=0)
    keystrokes: int = Field(ge=0)
    maxStreak: int = Field(ge=0)
    score: int = Field(ge=0)
    bonuses: int = Field(0, ge=0, le=1000)
    xp: int = Field(ge=0)
    charStats: dict[str, list[int]] = Field(default_factory=dict)
    bigramStats: dict[str, list[int]] = Field(default_factory=dict)
    samples: list[Sample] = Field(default_factory=list, max_length=4000)
    errorMode: Literal['strict', 'free'] = 'strict'
    uncorrected: int = Field(0, ge=0)
    backspaces: int = Field(0, ge=0)
    keylog: Optional[KeyLog] = None
    challengeDay: Optional[str] = Field(None, max_length=10)

    @field_validator('charStats', 'bigramStats')
    @classmethod
    def check_stats(cls, v: dict) -> dict:
        return _check_stats(v)
