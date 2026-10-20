"""Интеграционные тесты API и базы данных: аккаунты, изоляция данных, статистика, рейтинг, ML.

Запуск из корня проекта:  python -m pytest backend/tests -q
Каждый тест работает на своей временной базе SQLite.
"""

from __future__ import annotations

import importlib
import itertools

import pytest
from fastapi.testclient import TestClient

from backend.tests.helpers import make_session

START = 1_790_000_000_000  # фиксированное «сейчас»: между сохранениями проходит по 5 минут


@pytest.fixture()
def app_ctx(tmp_path, monkeypatch):
    monkeypatch.setenv('PG_DB', str(tmp_path / 'test.db'))
    monkeypatch.setenv('PG_DEMO_RIVALS', '0')
    from backend import db
    importlib.reload(db)
    from backend import api, main
    importlib.reload(api)
    importlib.reload(main)
    clock = itertools.count(START, 5 * 60_000)
    monkeypatch.setattr(api, 'now_ms', lambda: next(clock))
    from backend.ml import service
    service._cache.update(state=None, at=0, n=-1)
    return main.app, db


def client(app) -> TestClient:
    return TestClient(app)


def register(c: TestClient, name: str, email: str) -> dict:
    r = c.post('/api/auth/register', json={'name': name, 'email': email, 'password': 'secret-42'})
    assert r.status_code == 200, r.text
    return r.json()


def test_register_login_persist_and_isolation(app_ctx):
    app, _ = app_ctx
    with client(app) as a:
        user = register(a, 'Анна', 'anna@test.dev')['user']
        assert user['name'] == 'Анна' and not user.get('guest')
        for i in range(3):
            r = a.post('/api/sessions', json=make_session(seed=i, cpm=200 + i * 20))
            assert r.status_code == 200, r.text
        p = a.get('/api/progress').json()
        assert p['totals']['sessions'] == 3
        assert len(p['history']) == 3
        assert p['xp'] > 0
        a.post('/api/auth/logout')
        assert a.get('/api/me').json().get('guest')

        r = a.post('/api/auth/login', json={'email': 'anna@test.dev', 'password': 'wrong'})
        assert r.status_code == 401
        r = a.post('/api/auth/login', json={'email': 'anna@test.dev', 'password': 'secret-42'})
        assert r.status_code == 200
        assert r.json()['progress']['totals']['sessions'] == 3, 'прогресс восстановился после входа'

    with client(app) as b:
        register(b, 'Борис', 'boris@test.dev')
        p = b.get('/api/progress').json()
        assert p['totals']['sessions'] == 0, 'чужие тренировки не видны'
        assert p['history'] == []
        r = b.post('/api/auth/register', json={'name': 'Клон', 'email': 'anna@test.dev', 'password': 'secret-42'})
        assert r.status_code == 409


def test_guest_progress_moves_to_account(app_ctx):
    app, _ = app_ctx
    with client(app) as c:
        assert c.post('/api/sessions', json=make_session(seed=5)).status_code == 200
        res = register(c, 'Гость стал героем', 'guest@test.dev')
        assert res['migrated'] is True
        assert res['progress']['totals']['sessions'] == 1


def test_data_survives_restart(app_ctx):
    app, db = app_ctx
    with client(app) as c:
        register(c, 'Вера', 'vera@test.dev')
        c.post('/api/sessions', json=make_session(seed=7))
    conn = db.connect()  # новое соединение — как после перезапуска сервера
    try:
        row = conn.execute("SELECT u.name, COUNT(t.id) AS n, p.xp FROM users u JOIN trainings t ON t.user_id = u.id "
                           "JOIN progress p ON p.user_id = u.id WHERE u.email = 'vera@test.dev'").fetchone()
        assert row['name'] == 'Вера' and row['n'] == 1 and row['xp'] > 0
        keylog = conn.execute('SELECT keylog FROM trainings').fetchone()['keylog']
        assert keylog and '"t"' in keylog, 'лог нажатий сохранён для модели'
    finally:
        conn.close()


def test_leaderboard_metrics(app_ctx):
    app, _ = app_ctx
    with client(app) as c:
        register(c, 'Гонщик', 'racer@test.dev')
        c.post('/api/sessions', json=make_session(seed=1, cpm=300))
        for metric in ('speed', 'accuracy', 'xp', 'streak'):
            data = c.get(f'/api/leaderboard?metric={metric}&period=all').json()
            assert data['me'] and data['me']['rank'] == 1, metric
        assert c.get('/api/leaderboard?metric=daily').json()['me'] is None


def test_anticheat_rejects_impossible_speed(app_ctx):
    app, _ = app_ctx
    with client(app) as c:
        s = make_session(seed=2, cpm=5000)
        r = c.post('/api/sessions', json=s)
        assert r.status_code == 422
        assert 'не засчитан' in r.json()['error']['message']


def test_robotic_rhythm_is_flagged_and_hidden(app_ctx):
    app, _ = app_ctx
    with client(app) as c:
        register(c, 'Робот', 'robot@test.dev')
        r = c.post('/api/sessions', json=make_session(seed=3, cpm=500, robotic=True, n_chars=200))
        assert r.status_code == 200
        assert r.json()['report']['rhythm']['flagged'] is True
        assert c.get('/api/leaderboard?metric=speed&period=all').json()['me'] is None, 'в рейтинг не попадает'


def test_ml_insights_personal_and_global(app_ctx):
    app, _ = app_ctx
    with client(app) as c:
        assert c.post('/api/progress/demo').status_code == 200
        data = c.get('/api/ml/insights').json()
        me, everyone = data['personal'], data['global']
        assert me['model']['ready'] and me['model']['auc'] > 0.55
        assert me['forecast']['horizons'][0]['days'] == 7
        assert me['recommendations']
        assert everyone['ready'] and everyone['dataset']['players'] >= 1
        assert {f['id'] for f in everyone['factors']} >= {'shift', 'tempo', 'fatigue'}
