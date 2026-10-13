@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist .venv (
    echo [최초 1회] 가상환경을 만듭니다...
    python -m venv .venv || (echo Python이 설치되어 있지 않습니다. https://www.python.org 에서 설치하세요. ^& pause ^& exit /b)
)
echo 라이브러리 확인 중...
.venv\Scripts\python -m pip install -q -r requirements.txt || (echo 설치 실패. 인터넷 연결을 확인하세요. ^& pause ^& exit /b)
start "" .venv\Scripts\pythonw app.py
