"""바로가기 패널: 자주 쓰는 프로그램을 찾아 실행하고, 실제 프로그램 아이콘을 뽑아 PNG 로 캐시한다 (Windows 전용).

찾는 순서: config 의 path → 알려진 설치 경로(글롭) → 시작 메뉴 바로가기(.lnk) 이름 검색.
아이콘: PowerShell 의 System.Drawing.Icon.ExtractAssociatedIcon 으로 뽑아 ~/.lesown_dashboard/icons/<id>.png 에 저장 (창 없이 실행).
목록은 config.json > launchers 로 바꿀 수 있다.
"""
import base64
import glob
import os
import subprocess
import sys
import threading
from pathlib import Path

IS_WIN = sys.platform == "win32"
ICON_DIR = Path.home() / ".lesown_dashboard" / "icons"

PF = os.environ.get("ProgramFiles", r"C:\Program Files")
PF86 = os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)")
LAD = os.environ.get("LOCALAPPDATA", "")
APD = os.environ.get("APPDATA", "")

# 기본 바로가기 6개 (아이콘을 못 뽑으면 abbr·color 로 글자 배지)
DEFAULT_LAUNCHERS = [
    {"id": "cool", "name": "쿨메신저", "abbr": "쿨", "color": "#2b7de9", "fg": "#fff",
     "globs": [rf"{PF86}\CoolMessenger\CoolMessenger.exe", rf"{PF}\CoolMessenger\CoolMessenger.exe", r"C:\CoolMessenger\CoolMessenger.exe",
               rf"{LAD}\CoolMessenger\CoolMessenger.exe", rf"{PF86}\Jiran\CoolMessenger\*.exe"],
     "lnk": ["쿨메신저", "CoolMessenger"]},
    {"id": "kakao", "name": "카카오톡", "abbr": "톡", "color": "#fee500", "fg": "#3a1d1d",
     "globs": [rf"{PF86}\Kakao\KakaoTalk\KakaoTalk.exe", rf"{PF}\Kakao\KakaoTalk\KakaoTalk.exe", rf"{LAD}\Kakao\KakaoTalk\KakaoTalk.exe"],
     "lnk": ["카카오톡", "KakaoTalk"]},
    {"id": "claude", "name": "Claude", "abbr": "C", "color": "#d97757", "fg": "#fff",
     "globs": [rf"{LAD}\AnthropicClaude\claude.exe", rf"{LAD}\Programs\Claude\Claude.exe", rf"{LAD}\AnthropicClaude\app-*\claude.exe"],
     "lnk": ["Claude"]},
    {"id": "hwp", "name": "한글", "abbr": "한", "color": "#2a6fd6", "fg": "#fff",
     "globs": [rf"{PF86}\Hnc\Office*\HOffice*\Bin\Hwp.exe", rf"{PF}\Hnc\Office*\HOffice*\Bin\Hwp.exe", rf"{PF86}\Hnc\Hwp*\Bin\Hwp.exe"],
     "lnk": ["한글", "한컴오피스 한글", "Hwp"]},
    {"id": "excel", "name": "엑셀", "abbr": "X", "color": "#1d6f42", "fg": "#fff",
     "globs": [rf"{PF}\Microsoft Office\root\Office*\EXCEL.EXE", rf"{PF86}\Microsoft Office\root\Office*\EXCEL.EXE"],
     "lnk": ["Excel"], "app": "excel"},
    {"id": "ppt", "name": "파워포인트", "abbr": "P", "color": "#c43e1c", "fg": "#fff",
     "globs": [rf"{PF}\Microsoft Office\root\Office*\POWERPNT.EXE", rf"{PF86}\Microsoft Office\root\Office*\POWERPNT.EXE"],
     "lnk": ["PowerPoint"], "app": "powerpnt"},
]

START_MENUS = [rf"{APD}\Microsoft\Windows\Start Menu\Programs", os.path.join(os.environ.get("ProgramData", r"C:\ProgramData"), r"Microsoft\Windows\Start Menu\Programs")]


def _no_window():
    if not IS_WIN:
        return {}
    si = subprocess.STARTUPINFO()
    si.dwFlags |= subprocess.STARTF_USESHOWWINDOW
    return dict(startupinfo=si, creationflags=subprocess.CREATE_NO_WINDOW)


class Launchers:
    def __init__(self, cfg_list=None, log=print):
        self.items = cfg_list or DEFAULT_LAUNCHERS
        self.log = log
        self.paths = {}
        self._busy = False

    def _find(self, it):
        p = (it.get("path") or "").strip()
        if p:
            p = os.path.expandvars(p)
            if os.path.exists(p):
                return p
        for g in it.get("globs", []):
            hits = sorted(glob.glob(os.path.expandvars(g)), reverse=True)   # 최신 버전 폴더가 앞에
            if hits:
                return hits[0]
        names = [n.lower() for n in it.get("lnk", [])]
        best = None
        for root in START_MENUS:
            for lnk in glob.glob(os.path.join(root, "**", "*.lnk"), recursive=True):
                stem = Path(lnk).stem.lower()
                if any(stem == n or stem.startswith(n) for n in names):
                    if "uninstall" in stem or "제거" in stem:
                        continue
                    if best is None or len(stem) < len(Path(best).stem):
                        best = lnk
        return best

    def refresh(self):
        """경로 찾기 + 아이콘 뽑기 (뒤에서). 이미 뽑아 둔 아이콘은 그대로."""
        if not IS_WIN or self._busy:
            return
        self._busy = True

        def work():
            try:
                ICON_DIR.mkdir(parents=True, exist_ok=True)
                todo = []
                for it in self.items:
                    p = self._find(it)
                    self.paths[it["id"]] = p
                    png = ICON_DIR / f"{it['id']}.png"
                    if p and not png.exists():
                        todo.append((p, png))
                if todo:   # 한 번의 PowerShell 로 여러 아이콘
                    lines = ["Add-Type -AssemblyName System.Drawing"]
                    for p, png in todo:
                        sp, so = p.replace("'", "''"), str(png).replace("'", "''")
                        lines.append(f"try {{ $i=[System.Drawing.Icon]::ExtractAssociatedIcon('{sp}'); $b=$i.ToBitmap(); $b.Save('{so}',[System.Drawing.Imaging.ImageFormat]::Png) }} catch {{}}")
                    subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", "; ".join(lines)],
                                   capture_output=True, timeout=60, **_no_window())
                self.log(f"launchers: {{{', '.join(f'{k}: {bool(v)}' for k, v in self.paths.items())}}}")
            except Exception as e:
                self.log(f"launchers refresh failed: {e}")
            finally:
                self._busy = False
        threading.Thread(target=work, daemon=True).start()

    def list(self):
        out = []
        for it in self.items:
            png = ICON_DIR / f"{it['id']}.png"
            icon = ""
            if png.exists():
                try:
                    icon = "data:image/png;base64," + base64.b64encode(png.read_bytes()).decode()
                except Exception:
                    pass
            out.append({"id": it["id"], "name": it["name"], "abbr": it.get("abbr", it["name"][:1]), "color": it.get("color", "#555"),
                        "fg": it.get("fg", "#fff"), "icon": icon, "found": bool(self.paths.get(it["id"]) or it.get("app"))})
        return out

    def launch(self, lid):
        it = next((x for x in self.items if x["id"] == lid), None)
        if not it or not IS_WIN:
            return {"ok": False, "error": "알 수 없는 프로그램"}
        p = self.paths.get(lid) or self._find(it)
        try:
            if p:
                os.startfile(p)                                   # exe 든 .lnk 든 그대로 실행
            elif it.get("app"):
                os.startfile(it["app"])                           # App Paths 에 등록된 이름 (excel, powerpnt)
            else:
                return {"ok": False, "error": f"{it['name']} 설치 위치를 찾지 못했습니다"}
            return {"ok": True}
        except Exception as e:
            return {"ok": False, "error": str(e)}
