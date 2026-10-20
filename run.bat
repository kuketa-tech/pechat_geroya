@echo off
rem Pechat geroya: first run creates .venv and installs dependencies, then starts the server.
cd /d "%~dp0"

where python >nul 2>nul
if errorlevel 1 (
  echo Python 3.10+ is required: https://www.python.org/downloads/ ^(check "Add python.exe to PATH"^)
  pause
  exit /b 1
)

if not exist ".venv\Scripts\python.exe" (
  echo [1/2] Creating virtual environment .venv ...
  python -m venv .venv || goto :error
  echo [2/2] Installing dependencies ^(1-2 minutes, needs internet^) ...
  ".venv\Scripts\python.exe" -m pip install --upgrade pip >nul
  ".venv\Scripts\python.exe" -m pip install -r backend\requirements.txt || goto :error
)

echo.
echo   Pechat geroya: http://127.0.0.1:8000   ^(Ctrl+C to stop^)
echo.
start "" cmd /c "timeout /t 3 >nul & start http://127.0.0.1:8000"
".venv\Scripts\python.exe" -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
goto :eof

:error
echo.
echo Failed to prepare the environment. See JURY.md, troubleshooting section.
pause
exit /b 1
