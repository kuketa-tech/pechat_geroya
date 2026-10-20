"""REST API под /api — тот же контракт, что был у mockBackend во frontend/js/api/mock.js."""

from __future__ import annotations

import os
import re
import sqlite3
from typing import Literal

from fastapi import APIRouter, Depends, Query, Request, Response

from . import auth, db, demo, leaderboard, repo, seed
from .ml import service as ml
from .auth import GUEST_COOKIE, GUEST_TTL, SESSION_COOKIE, SESSION_TTL, Identity
from .game.anticheat import Rejected, validate_session
from .game.progression import apply_session
from .game.util import day_key, day_start, now_ms, uid
from .schemas import LoginIn, ProfileIn, RegisterIn, SessionIn, SocialIn

router = APIRouter(prefix='/api')

EMAIL_RE = re.compile(r'^[^\s@]+@[^\s@]+\.[^\s@]{2,}$')
PROVIDERS = {'vk': 'VK ID', 'yandex': 'Яндекс ID', 'google': 'Google', 'github': 'GitHub'}
DEMO_RIVALS = os.environ.get('PG_DEMO_RIVALS', '1') != '0'


class ApiError(Exception):
    def __init__(self, message: str, field: str | None = None, status: int = 400):
        super().__init__(message)
        self.message, self.field, self.status = message, field, status


def get_conn():
    conn = db.connect()
    try:
        yield conn
    finally:
        conn.close()


Conn = Depends(get_conn)


def _payload(conn: sqlite3.Connection, request: Request, user_id: str | None) -> dict:
    return repo.progress_payload(conn, user_id, now_ms(), auth.request_tz(request))


def _create_user(conn: sqlite3.Connection, *, kind: str, name: str, provider: str, email: str | None = None,
                 social_id: str | None = None, pass_hash: str | None = None) -> str:
    user_id = uid()
    conn.execute(
        'INSERT INTO users(id, kind, name, email, social_id, provider, pass_hash, created_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?)',
        (user_id, kind, name, email, social_id, provider, pass_hash, now_ms()),
    )
    return user_id


def _adopt_guest(conn: sqlite3.Connection, ident: Identity, request: Request, response: Response, user_id: str) -> bool:
    """Перенос прогресса гостя в новый аккаунт — чтобы первая тренировка не терялась."""
    guest = ident.guest
    if not guest:
        return False
    migrated = repo.sessions_count(conn, guest['id']) > 0
    if migrated:
        repo.move_user_data(conn, guest['id'], user_id)
    conn.execute('DELETE FROM users WHERE id = ?', (guest['id'],))
    auth.revoke_token(conn, request, response, GUEST_COOKIE)
    return migrated


def _login(conn: sqlite3.Connection, request: Request, response: Response, user_id: str) -> None:
    auth.revoke_token(conn, request, response, SESSION_COOKIE, clear=False)  # сразу выдаём новую cookie
    auth.issue_token(conn, response, user_id, SESSION_COOKIE, SESSION_TTL)


def _session_user(conn: sqlite3.Connection, user_id: str) -> dict:
    return auth.public_user(conn.execute('SELECT * FROM users WHERE id = ?', (user_id,)).fetchone())


def _ensure_player(conn: sqlite3.Connection, ident: Identity, response: Response) -> str:
    """Вошедший игрок или гость этого браузера; гостя создаём при первом сохранении."""
    if ident.user_id:
        return ident.user_id
    guest_id = _create_user(conn, kind='guest', name='Гость', provider='local')
    auth.issue_token(conn, response, guest_id, GUEST_COOKIE, GUEST_TTL)
    return guest_id


# ---------------- сессия и аккаунт ----------------

@router.get('/health')
def health():
    return {'ok': True}


@router.get('/me')
def me(request: Request, conn: sqlite3.Connection = Conn):
    return auth.identify(conn, request).public()


@router.post('/auth/register')
def register(body: RegisterIn, request: Request, response: Response, conn: sqlite3.Connection = Conn):
    name, email = body.name.strip(), body.email.strip().lower()
    if not 2 <= len(name) <= 32:
        raise ApiError('Имя — от 2 до 32 символов', 'name')
    if not EMAIL_RE.match(email):
        raise ApiError('Проверьте адрес почты', 'email')
    if len(body.password) < 6:
        raise ApiError('Минимум 6 символов', 'password')
    pass_hash = auth.hash_password(body.password)  # вне транзакции: scrypt намеренно медленный

    with db.tx(conn):
        if conn.execute('SELECT 1 FROM users WHERE email = ?', (email,)).fetchone():
            raise ApiError('Этот email уже зарегистрирован', 'email', 409)
        ident = auth.identify(conn, request)
        user_id = _create_user(conn, kind='user', name=name, provider='email', email=email, pass_hash=pass_hash)
        migrated = _adopt_guest(conn, ident, request, response, user_id)
        _login(conn, request, response, user_id)
    return {'user': _session_user(conn, user_id), 'progress': _payload(conn, request, user_id), 'migrated': migrated}


@router.post('/auth/login')
def login(body: LoginIn, request: Request, response: Response, conn: sqlite3.Connection = Conn):
    email = body.email.strip().lower()
    user = conn.execute("SELECT * FROM users WHERE email = ? AND kind = 'user'", (email,)).fetchone()
    if not user or user['provider'] != 'email':
        raise ApiError('Аккаунт с таким email не найден', 'email', 401)
    if not auth.verify_password(body.password, user['pass_hash']):
        raise ApiError('Неверный пароль', 'password', 401)
    with db.tx(conn):
        _login(conn, request, response, user['id'])
    return {'user': auth.public_user(user), 'progress': _payload(conn, request, user['id'])}


@router.post('/auth/social')
def login_social(body: SocialIn, request: Request, response: Response, conn: sqlite3.Connection = Conn):
    """Демо-вход через соцсети: без OAuth, один аккаунт на провайдера в каждом браузере."""
    if body.provider not in PROVIDERS:
        raise ApiError('Неизвестный провайдер входа')
    social_id = f'{body.provider}:{auth.device_id(request, response)}'
    migrated = False
    with db.tx(conn):
        row = conn.execute('SELECT id FROM users WHERE social_id = ?', (social_id,)).fetchone()
        if row:
            user_id = row['id']
        else:
            ident = auth.identify(conn, request)
            user_id = _create_user(conn, kind='user', name=f'Игрок {PROVIDERS[body.provider]}', provider=body.provider,
                                   social_id=social_id)
            migrated = _adopt_guest(conn, ident, request, response, user_id)
        _login(conn, request, response, user_id)
    return {'user': _session_user(conn, user_id), 'progress': _payload(conn, request, user_id), 'migrated': migrated}


@router.post('/auth/logout')
def logout(request: Request, response: Response, conn: sqlite3.Connection = Conn):
    ident = auth.identify(conn, request)
    with db.tx(conn):
        auth.revoke_token(conn, request, response, SESSION_COOKIE)
    guest_id = ident.guest['id'] if ident.guest else None
    return {'user': auth.guest_user(ident.guest), 'progress': _payload(conn, request, guest_id)}


@router.patch('/profile')
def update_profile(body: ProfileIn, request: Request, conn: sqlite3.Connection = Conn):
    ident = auth.identify(conn, request)
    if not ident.account:
        raise ApiError('Профиль гостя нельзя изменить — войдите в аккаунт', status=403)
    name = (body.name or '').strip()
    if name:
        if not 2 <= len(name) <= 32:
            raise ApiError('Имя — от 2 до 32 символов', 'name')
        with db.tx(conn):
            conn.execute('UPDATE users SET name = ? WHERE id = ?', (name, ident.account['id']))
    return _session_user(conn, ident.account['id'])


# ---------------- прогресс ----------------

@router.get('/progress')
def get_progress(request: Request, conn: sqlite3.Connection = Conn):
    return _payload(conn, request, auth.identify(conn, request).user_id)


@router.post('/sessions')
def save_session(body: SessionIn, request: Request, response: Response, conn: sqlite3.Connection = Conn):
    """Сохранить тренировку: проверка правдоподобности → прогрессия на сервере → отчёт для окна итогов."""
    session = body.model_dump()
    tz = auth.request_tz(request)
    now = now_ms()
    # Испытание засчитывается только за сегодняшний день и только в его режиме
    session['challenge'] = day_key(now, tz) if session['mode'] == 'daily' and session.get('challengeDay') == day_key(now, tz) else None
    # ML-детектор автоввода по ритму: подозрительный результат сохраняем, но не пускаем в рейтинг
    rhythm = ml.check_rhythm(conn, session.get('keylog'), now)
    session['flagged'] = rhythm['flagged']
    with db.tx(conn):
        ident = auth.identify(conn, request)
        if ident.user_id:
            last, today = repo.last_save(conn, ident.user_id, day_start(now, tz))
        else:
            last, today = None, 0
        try:
            validate_session(session, last_save_ts=last, saves_today=today, now=now)
        except Rejected as err:
            raise ApiError(f'Результат не засчитан: {err}', status=422) from None
        user_id = _ensure_player(conn, ident, response)
        progress, report = apply_session(repo.load_progress(conn, user_id, now, tz), session, now, tz)
        repo.insert_training(conn, user_id, report['entry'], session)
        repo.save_progress(conn, user_id, progress, now)
    report['rhythm'] = rhythm
    report['challenge'] = session['challenge']
    return {'progress': repo.progress_payload(conn, user_id, now, tz), 'report': report}


@router.post('/progress/reset')
def reset_progress(request: Request, conn: sqlite3.Connection = Conn):
    ident = auth.identify(conn, request)
    if ident.user_id:
        with db.tx(conn):
            repo.reset(conn, ident.user_id, now_ms())
    return _payload(conn, request, ident.user_id)


@router.post('/progress/demo')
def seed_demo(request: Request, response: Response, conn: sqlite3.Connection = Conn):
    """Для показа: заполнить историю правдоподобными тренировками за 4 недели."""
    with db.tx(conn):
        user_id = _ensure_player(conn, auth.identify(conn, request), response)
        demo.seed_history(conn, user_id, now_ms(), auth.request_tz(request))
    return _payload(conn, request, user_id)


# ---------------- рейтинг ----------------

@router.get('/leaderboard')
def get_leaderboard(
    request: Request,
    metric: Literal['speed', 'accuracy', 'xp', 'streak', 'daily'] = Query('speed'),
    period: Literal['day', 'week', 'all'] = Query('week'),
    conn: sqlite3.Connection = Conn,
):
    if DEMO_RIVALS:
        seed.top_up(conn)
    ident = auth.identify(conn, request)
    return leaderboard.build(conn, metric, period, ident.user_id, ident.account is None, now_ms(), auth.request_tz(request))


# ---------------- машинное обучение ----------------

@router.get('/ml/insights')
def ml_insights(request: Request, conn: sqlite3.Connection = Conn):
    """AI-тренер: персональные выводы (модель ошибок, прогноз, стиль, ритм, рекомендации) и общие по всем игрокам."""
    tz = auth.request_tz(request)
    now = now_ms()
    user_id = auth.identify(conn, request).user_id
    progress = repo.load_progress(conn, user_id, now, tz)
    return ml.insights(conn, user_id, now, day_start(now, tz), progress)


@router.api_route('/{path:path}', methods=['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], include_in_schema=False)
def not_found(path: str):
    raise ApiError('Нет такого метода API', status=404)
