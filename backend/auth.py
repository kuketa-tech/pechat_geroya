"""Пароли, токены сессий в httpOnly-cookie и определение текущего игрока.

Две cookie:
  pg_session — вход в аккаунт (email или демо-соцсеть);
  pg_guest   — гость, который уже сохранил хотя бы одну тренировку.
Гость без тренировок нигде не хранится. После выхода из аккаунта снова виден прогресс
гостя этого браузера — как было в локальном моке.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import os
import secrets
import sqlite3
from dataclasses import dataclass
from datetime import timedelta, timezone, tzinfo
from zoneinfo import ZoneInfo

from fastapi import Request, Response

from .game.util import now_ms

SESSION_COOKIE = 'pg_session'
GUEST_COOKIE = 'pg_guest'
DEVICE_COOKIE = 'pg_device'
SESSION_TTL = timedelta(days=30)
GUEST_TTL = timedelta(days=180)
DEVICE_TTL = timedelta(days=365)
COOKIE_SECURE = os.environ.get('PG_COOKIE_SECURE') == '1'

DEFAULT_TZ = ZoneInfo('Europe/Moscow')

SCRYPT_N, SCRYPT_R, SCRYPT_P = 2 ** 14, 8, 1

GUEST = {'id': 'guest', 'name': 'Гость', 'guest': True, 'provider': 'local'}


# ---------- пароли ----------

def hash_password(password: str) -> str:
    salt = os.urandom(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=SCRYPT_N, r=SCRYPT_R, p=SCRYPT_P, dklen=32)
    b64 = lambda b: base64.b64encode(b).decode()  # noqa: E731
    return f'scrypt${SCRYPT_N}${SCRYPT_R}${SCRYPT_P}${b64(salt)}${b64(digest)}'


def verify_password(password: str, stored: str | None) -> bool:
    try:
        algo, n, r, p, salt, digest = (stored or '').split('$')
        if algo != 'scrypt':
            return False
        expected = base64.b64decode(digest)
        actual = hashlib.scrypt(password.encode(), salt=base64.b64decode(salt), n=int(n), r=int(r), p=int(p),
                                dklen=len(expected))
        return hmac.compare_digest(actual, expected)
    except (ValueError, TypeError):
        return False


# ---------- токены ----------

def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def issue_token(conn: sqlite3.Connection, response: Response, user_id: str, cookie: str, ttl: timedelta) -> None:
    token = secrets.token_urlsafe(32)
    now = now_ms()
    conn.execute(
        'INSERT INTO auth_tokens(token_hash, user_id, created_at, expires_at) VALUES(?, ?, ?, ?)',
        (_token_hash(token), user_id, now, now + int(ttl.total_seconds() * 1000)),
    )
    set_cookie(response, cookie, token, ttl)


def set_cookie(response: Response, name: str, value: str, ttl: timedelta) -> None:
    response.set_cookie(name, value, max_age=int(ttl.total_seconds()), httponly=True, samesite='lax',
                        secure=COOKIE_SECURE, path='/')


def revoke_token(conn: sqlite3.Connection, request: Request, response: Response, cookie: str, *, clear: bool = True) -> None:
    token = request.cookies.get(cookie)
    if token:
        conn.execute('DELETE FROM auth_tokens WHERE token_hash = ?', (_token_hash(token),))
    if clear:
        response.delete_cookie(cookie, path='/', httponly=True, samesite='lax', secure=COOKIE_SECURE)


def user_by_token(conn: sqlite3.Connection, token: str | None, kind: str) -> sqlite3.Row | None:
    if not token:
        return None
    return conn.execute(
        'SELECT u.* FROM auth_tokens t JOIN users u ON u.id = t.user_id '
        'WHERE t.token_hash = ? AND t.expires_at > ? AND u.kind = ?',
        (_token_hash(token), now_ms(), kind),
    ).fetchone()


def device_id(request: Request, response: Response) -> str:
    """Постоянный id браузера — чтобы демо-вход «через VK» в каждом браузере вёл в свой аккаунт."""
    value = request.cookies.get(DEVICE_COOKIE)
    if not value or len(value) > 64:
        value = secrets.token_urlsafe(16)
    set_cookie(response, DEVICE_COOKIE, value, DEVICE_TTL)
    return value


# ---------- текущий игрок ----------

@dataclass
class Identity:
    account: sqlite3.Row | None  # вошёл в аккаунт
    guest: sqlite3.Row | None  # гость этого браузера (если уже что-то сохранял)

    @property
    def user(self) -> sqlite3.Row | None:
        return self.account or self.guest

    @property
    def user_id(self) -> str | None:
        return self.user['id'] if self.user else None

    def public(self) -> dict:
        return public_user(self.account) if self.account else guest_user(self.guest)


def identify(conn: sqlite3.Connection, request: Request) -> Identity:
    return Identity(
        account=user_by_token(conn, request.cookies.get(SESSION_COOKIE), 'user'),
        guest=user_by_token(conn, request.cookies.get(GUEST_COOKIE), 'guest'),
    )


def public_user(row: sqlite3.Row) -> dict:
    out = {'id': row['id'], 'name': row['name'], 'provider': row['provider'], 'createdAt': row['created_at']}
    if row['email']:
        out['email'] = row['email']
    return out


def guest_user(row: sqlite3.Row | None) -> dict:
    return {**GUEST, 'createdAt': row['created_at']} if row else dict(GUEST)


# ---------- часовой пояс ----------

def request_tz(request: Request) -> tzinfo:
    """Часовой пояс игрока: от него зависят «сегодня», серия дней, задания и «Ночная сова»."""
    name = request.headers.get('x-timezone')
    if name:
        try:
            return ZoneInfo(name)
        except (ValueError, KeyError, OSError):
            pass
    offset = request.headers.get('x-tz-offset')
    if offset and offset.lstrip('-').isdigit() and abs(int(offset)) <= 14 * 60:
        return timezone(-timedelta(minutes=int(offset)))  # getTimezoneOffset(): UTC − местное
    return DEFAULT_TZ
