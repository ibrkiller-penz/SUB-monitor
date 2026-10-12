@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist .venv python -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt pyinstaller
.venv\Scripts\pyinstaller --noconfirm --onefile --windowed --name LesownDashboard --add-data "web;web" app.py
copy /y config.json dist\config.json
echo.
echo 완료: dist\LesownDashboard.exe  (config.json 은 exe 옆에 두세요)
pause
