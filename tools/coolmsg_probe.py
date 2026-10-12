"""쿨메신저가 이 PC에서 어떤 식으로 드러나는지 조사하는 진단 스크립트 (Windows 에서 실행).

실행:  .venv\\Scripts\\python tools\\coolmsg_probe.py
결과:  tools\\coolmsg_probe_result.txt  → 이 파일 내용을 Claude 에게 붙여넣으면 감지 방식을 확정할 수 있다.
       (조사 중 60초 동안 쿨메신저로 메시지를 하나 받아보면 알림 수신 여부까지 확인된다)
"""
import ctypes
import os
import re
import sys
import time
from pathlib import Path

OUT = Path(__file__).with_name("coolmsg_probe_result.txt")
KEYS = ["cool", "쿨", "jiran", "지란"]
lines = []


def log(s=""):
    print(s)
    lines.append(s)


def section(t):
    log(); log("=" * 60); log(t); log("=" * 60)


if sys.platform != "win32":
    print("Windows 에서 실행하세요."); sys.exit(1)

section("1. 창 제목 (보이는 창)")
user32 = ctypes.windll.user32
from ctypes import wintypes
titles = []


@ctypes.WINFUNCTYPE(ctypes.c_bool, wintypes.HWND, wintypes.LPARAM)
def cb(hwnd, _):
    n = user32.GetWindowTextLengthW(hwnd)
    if n:
        buf = ctypes.create_unicode_buffer(n + 1)
        user32.GetWindowTextW(hwnd, buf, n + 1)
        cls = ctypes.create_unicode_buffer(256)
        user32.GetClassNameW(hwnd, cls, 256)
        titles.append((bool(user32.IsWindowVisible(hwnd)), buf.value, cls.value))
    return True


user32.EnumWindows(cb, 0)
for vis, t, c in titles:
    if any(k in (t + c).lower() for k in KEYS):
        log(f"  [{'보임' if vis else '숨김'}] 제목='{t}'  클래스='{c}'")

section("2. 프로세스")
try:
    import psutil
    for p in psutil.process_iter(["name", "exe"]):
        try:
            if any(k in (p.info["name"] or "").lower() for k in KEYS):
                log(f"  {p.info['name']}  →  {p.info['exe']}")
        except Exception:
            pass
except ImportError:
    log("  psutil 없음 (run.bat 으로 설치 후 재실행)")

section("3. 데이터 폴더 후보")
for base in [os.environ.get("APPDATA", ""), os.environ.get("LOCALAPPDATA", ""), os.environ.get("PROGRAMDATA", ""),
             r"C:\Program Files", r"C:\Program Files (x86)"]:
    try:
        for d in Path(base).iterdir():
            if any(k in d.name.lower() for k in KEYS):
                log(f"  {d}")
                for f in list(d.rglob("*"))[:40]:
                    if f.is_file() and f.suffix.lower() in (".db", ".sqlite", ".mdb", ".dat", ".ini", ".xml", ".json", ".log"):
                        log(f"      {f.relative_to(d)}  ({f.stat().st_size} bytes)")
    except Exception:
        pass

section("3-1. 쿨메신저 UDB(SQLite) 후보 조사")
import sqlite3, glob
cands = []
for base in [r"C:\CoolMessenger", r"C:\Program Files\CoolMessenger", r"C:\Program Files (x86)\CoolMessenger",
             os.path.join(os.environ.get("APPDATA", ""), "CoolMessenger"), os.path.join(os.environ.get("LOCALAPPDATA", ""), "CoolMessenger"),
             os.path.join(os.environ.get("PROGRAMDATA", ""), "CoolMessenger"), r"C:\Program Files", r"C:\Program Files (x86)", os.environ.get("APPDATA", ""), os.environ.get("LOCALAPPDATA", "")]:
    if base and os.path.isdir(base):
        for pat in ("**/*.udb", "**/*.db", "**/*.sqlite", "**/*.db3"):
            for f in glob.glob(os.path.join(base, pat), recursive=True):
                if any(k in f.lower() for k in KEYS) and os.path.getsize(f) > 10_000:
                    cands.append(f)
cands = sorted(set(cands), key=os.path.getmtime, reverse=True)
for f in cands[:10]:
    log(f"  후보: {f}  ({os.path.getsize(f)} bytes, 수정 {time.strftime('%Y-%m-%d %H:%M', time.localtime(os.path.getmtime(f)))})")
    try:
        with open(f, "rb") as fh:
            head = fh.read(16)
        log(f"     헤더: {head!r}")
        if head.startswith(b"SQLite format 3"):
            con = sqlite3.connect(f"file:{Path(f).as_uri()[7:]}?mode=ro", uri=True)
            tables = [r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")]
            log(f"     테이블: {tables}")
            for t in tables:
                if any(k in t.lower() for k in ("recv", "send", "msg", "message", "note")):
                    cols = [(r[1], r[2]) for r in con.execute(f"PRAGMA table_info({t})")]
                    cnt = con.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
                    log(f"     - {t} ({cnt}행): {cols}")
                    try:
                        for row in con.execute(f"SELECT * FROM {t} ORDER BY rowid DESC LIMIT 2"):
                            log("       샘플: " + ", ".join(f"{c[0]}={str(v)[:40]!r}" for c, v in zip(cols, row)))
                    except Exception as e:
                        log(f"       샘플 실패: {e}")
            con.close()
    except Exception as e:
        log(f"     열기 실패: {e}")
if not cands:
    log("  후보 없음 → 쿨메신저 설치 폴더를 탐색기에서 찾아 경로를 알려주세요")

section("3-2. 쿨메신저/예약매니저 로컬 포트")
try:
    import psutil
    for p in psutil.process_iter(["name", "pid"]):
        if any(k in (p.info["name"] or "").lower() for k in KEYS):
            try:
                for c in p.net_connections(kind="inet"):
                    if c.status == "LISTEN":
                        log(f"  {p.info['name']} (pid {p.info['pid']}) LISTEN {c.laddr.ip}:{c.laddr.port}")
            except Exception as e:
                log(f"  {p.info['name']}: 포트 조회 실패 ({e})")
except Exception as e:
    log(f"  실패: {e}")

section("4. Windows 알림(토스트) 60초 수신 테스트")
try:
    import asyncio
    from winsdk.windows.ui.notifications.management import UserNotificationListener, UserNotificationListenerAccessStatus
    from winsdk.windows.ui.notifications import NotificationKinds, KnownNotificationBindings
    listener = UserNotificationListener.current
    status = asyncio.run(listener.request_access_async())
    log(f"  접근 상태: {status}")
    if status == UserNotificationListenerAccessStatus.ALLOWED:
        log("  지금 쿨메신저로 메시지를 하나 받아보세요... (60초)")
        seen = set()
        for _ in range(12):
            for n in asyncio.run(listener.get_notifications_async(NotificationKinds.TOAST)):
                if n.id in seen:
                    continue
                seen.add(n.id)
                try:
                    app = n.app_info.display_info.display_name
                except Exception:
                    app = "?"
                try:
                    b = n.notification.visual.get_binding(KnownNotificationBindings.get_toast_generic())
                    texts = [t.text for t in b.get_text_elements()] if b else []
                except Exception:
                    texts = []
                log(f"  알림: app='{app}' texts={texts}")
            time.sleep(5)
    else:
        log("  → Windows 설정 > 개인 정보 및 보안 > 알림 > '앱이 알림에 접근' 허용 후 재실행")
except ImportError:
    log("  winsdk 미설치: .venv\\Scripts\\pip install winsdk 후 재실행")
except Exception as e:
    log(f"  오류: {e}")

OUT.write_text("\n".join(lines), encoding="utf-8")
print(f"\n결과 저장: {OUT}")
input("Enter 를 누르면 닫힙니다.")
