@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist .venv python -m venv .venv
.venv\Scripts\python -m pip install -q -r requirements.txt pyinstaller
.venv\Scripts\pyinstaller --noconfirm --clean --onedir --windowed --name SUBmonitor --icon app.ico ^
  --add-data "web;web" --collect-all webview --hidden-import notify --hidden-import tt_worker app.py
copy /y config.json dist\SUBmonitor\config.json >nul
echo.
echo 완료: dist\SUBmonitor\SUBmonitor.exe  (폴더째 복사해서 쓰세요. config.local.json 은 처음 설정 때 생깁니다)
pause
