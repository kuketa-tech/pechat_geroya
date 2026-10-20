#!/usr/bin/env sh
# Печать героя: при первом запуске создаёт .venv и ставит зависимости, затем запускает сервер.
set -e
cd "$(dirname "$0")"

PY=python3
command -v "$PY" >/dev/null 2>&1 || PY=python

if [ ! -x .venv/bin/python ]; then
  echo "[1/2] Создаю виртуальное окружение .venv…"
  "$PY" -m venv .venv
  echo "[2/2] Ставлю зависимости (1–2 минуты, нужен интернет)…"
  .venv/bin/python -m pip install --upgrade pip >/dev/null
  .venv/bin/python -m pip install -r backend/requirements.txt
fi

echo
echo "  Печать героя: http://127.0.0.1:8000   (Ctrl+C — остановить)"
echo
exec .venv/bin/python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
