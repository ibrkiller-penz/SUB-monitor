"""바로가기 패널: 정해진 경로의 프로그램을 실행한다 (Windows 전용). 찾기·검색은 하지 않는다.

아이콘은 web/apps/<id>.png (프로그램에 넣어 둔 공식 아이콘).
경로는 선생님 PC 실측값. 버전 폴더만 * 로 두어 업데이트돼도 그대로 열리게 했다.
목록은 config.json > launchers 로 바꿀 수 있다 (id, name, paths[], aumid).
"""
import glob
import os
import subprocess
import sys

IS_WIN = sys.platform == "win32"

DEFAULT_LAUNCHERS = [
    {"id": "cool", "name": "쿨메신저", "paths": [r"C:\Program Files (x86)\CoolMessenger Gentoo\CoolMessenger.exe"]},
    {"id": "kakao", "name": "카카오톡", "paths": [r"C:\Program Files\Kakao\KakaoTalk\KakaoTalk.exe"]},
    {"id": "claude", "name": "Claude", "paths": [r"C:\Program Files\WindowsApps\Claude_2.42304.2.0_x64__pzs8sxrjxfjjc\app\Claude.exe",
                                                 r"C:\Program Files\WindowsApps\Claude_*_x64__pzs8sxrjxfjjc\app\Claude.exe"],
     "aumid": "Claude_pzs8sxrjxfjjc!Claude"},   # 스토어 앱: exe 직접 실행이 막히면 shell:AppsFolder 로
    {"id": "hwp", "name": "한글", "paths": [r"C:\Program Files (x86)\Hnc\Office 2024\HOffice130\Bin\Hwp.exe"]},
    {"id": "excel", "name": "엑셀", "paths": [r"C:\Program Files\Microsoft Office\root\Office16\EXCEL.EXE"]},
    {"id": "ppt", "name": "파워포인트", "paths": [r"C:\Program Files\Microsoft Office\root\Office16\POWERPNT.EXE"]},
]


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

    def list(self):
        return [{"id": it["id"], "name": it["name"], "icon": f"apps/{it['id']}.png"} for it in self.items]

    def launch(self, lid):
        it = next((x for x in self.items if x["id"] == lid), None)
        if not it or not IS_WIN:
            return {"ok": False, "error": "알 수 없는 프로그램"}
        err = ""
        for p in it.get("paths", []):
            hits = [p] if os.path.exists(p) else sorted(glob.glob(p), reverse=True)
            for h in hits:
                try:
                    os.startfile(h)
                    return {"ok": True}
                except Exception as e:
                    err = str(e)
        if it.get("aumid"):
            try:
                subprocess.Popen(["explorer.exe", "shell:AppsFolder\\" + it["aumid"]], **_no_window())
                return {"ok": True}
            except Exception as e:
                err = str(e)
        self.log(f"launch {lid} failed: {err or '경로 없음'} {it.get('paths')}")
        return {"ok": False, "error": f"{it['name']}: {err or '경로에 파일이 없습니다'}"}
