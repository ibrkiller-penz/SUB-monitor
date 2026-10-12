@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist .venv (
    echo [최초 1회] 필요한 라이브러리를 설치합니다...
    python -m venv .venv || (echo Python이 설치되어 있지 않습니다. https://www.python.org 에서 설치하세요. & pause & exit /b)
    .venv\Scripts\python -m pip install -r requirements.txt
)
start "" .venv\Scripts\pythonw app.py
