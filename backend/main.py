"""Точка входа: uvicorn backend.main:app — фронтенд и REST API на одном порту."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from . import db, seed
from .api import DEMO_RIVALS, ApiError, router
from .game.util import now_ms

FRONTEND = db.ROOT / 'frontend'
log = logging.getLogger('uvicorn.error')  # пишет в тот же вывод, что и uvicorn


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init_db()
    conn = db.connect()
    try:
        conn.execute('DELETE FROM auth_tokens WHERE expires_at < ?', (now_ms(),))
        if DEMO_RIVALS:
            added = seed.top_up(conn, force=True)
            if added:
                log.info('Демо-соперники: добавлено тренировок %s', added)
    finally:
        conn.close()
    yield


app = FastAPI(title='Печать героя', version='1.0.0', lifespan=lifespan, docs_url='/api/docs', openapi_url='/api/openapi.json',
              redoc_url=None)


@app.exception_handler(ApiError)
async def api_error(request: Request, exc: ApiError):
    return JSONResponse({'error': {'message': exc.message, 'field': exc.field}}, status_code=exc.status)


@app.exception_handler(RequestValidationError)
async def validation_error(request: Request, exc: RequestValidationError):
    details = [f"{'.'.join(str(p) for p in e['loc'][1:])}: {e['msg']}" for e in exc.errors()]
    return JSONResponse({'error': {'message': 'Некорректные данные запроса', 'details': details[:10]}}, status_code=422)


@app.middleware('http')
async def no_stale_frontend(request: Request, call_next):
    """ES-модули без сборки: просим браузер сверять версию файлов, чтобы не держать старый JS."""
    response = await call_next(request)
    if request.url.path.startswith('/api/'):
        response.headers.setdefault('Cache-Control', 'no-store')
    else:
        response.headers.setdefault('Cache-Control', 'no-cache')
    return response


app.include_router(router)
app.mount('/', StaticFiles(directory=FRONTEND, html=True), name='frontend')
