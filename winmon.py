"""Windows 모니터 목록과 창 옮기기 (ctypes, pywebview 의 screen/fullscreen 대신).

모니터가 여러 대면 pywebview 전체화면이 엉뚱한 모니터에 뜨는 일이 있어서,
EnumDisplayMonitors 로 모니터 사각형을 받아 SetWindowPos 로 창을 그 사각형에 꼭 맞춘다.
EnumDisplayMonitors 와 SetWindowPos 는 같은 좌표계를 쓰므로 배율(DPI)이 달라도 위치가 맞는다.
"""
import ctypes
import os
from ctypes import wintypes


class _MI(ctypes.Structure):
    _fields_ = [("cbSize", wintypes.DWORD), ("rcMonitor", wintypes.RECT), ("rcWork", wintypes.RECT),
                ("dwFlags", wintypes.DWORD), ("szDevice", wintypes.WCHAR * 32)]


def monitors():
    """[{id, name, x, y, w, h, primary}] — id 는 \\\\.\\DISPLAY2 같은 장치 이름."""
    if os.name != "nt":
        return []
    u = ctypes.windll.user32
    out = []
    proc_t = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HMONITOR, wintypes.HDC, ctypes.POINTER(wintypes.RECT), wintypes.LPARAM)

    def cb(hmon, hdc, rc, lp):
        mi = _MI()
        mi.cbSize = ctypes.sizeof(_MI)
        if u.GetMonitorInfoW(hmon, ctypes.byref(mi)):
            r = mi.rcMonitor
            out.append({"id": mi.szDevice, "x": r.left, "y": r.top, "w": r.right - r.left, "h": r.bottom - r.top,
                        "primary": bool(mi.dwFlags & 1)})
        return True

    u.EnumDisplayMonitors(None, None, proc_t(cb), 0)
    for i, m in enumerate(out, 1):
        kind = "가로 띠" if m["w"] / max(1, m["h"]) > 3 else "세로 띠" if m["h"] / max(1, m["w"]) > 3 else "일반"
        m["name"] = f"{i}번 · {m['w']}×{m['h']} · {kind}{' · 주 모니터' if m['primary'] else ''}"
    return out


def pick(mons, want=""):
    """설정에서 고른 모니터(id) → 없으면 가로·세로 비율 3 이상인 띠 모니터 → 없으면 None."""
    if want:
        for m in mons:
            if m["id"] == want:
                return m
    strips = [m for m in mons if max(m["w"], m["h"]) / max(1, min(m["w"], m["h"])) > 3]
    return strips[0] if strips else None


def place(title, m):
    """제목이 title 인 창을 테두리 없이 모니터 m 전체에 맞춘다."""
    if os.name != "nt" or not m:
        return False
    u = ctypes.windll.user32
    hwnd = u.FindWindowW(None, title)
    if not hwnd:
        return False
    GWL_STYLE, WS_CAPTION, WS_THICKFRAME = -16, 0x00C00000, 0x00040000
    try:
        get = u.GetWindowLongPtrW
        put = u.SetWindowLongPtrW
        get.restype = put.restype = ctypes.c_ssize_t
        get.argtypes = [wintypes.HWND, ctypes.c_int]
        put.argtypes = [wintypes.HWND, ctypes.c_int, ctypes.c_ssize_t]
    except AttributeError:
        get, put = u.GetWindowLongW, u.SetWindowLongW
    style = get(hwnd, GWL_STYLE)
    put(hwnd, GWL_STYLE, style & ~WS_CAPTION & ~WS_THICKFRAME)
    u.ShowWindow(hwnd, 9)   # SW_RESTORE (최대화·최소화 풀기)
    SWP_FRAMECHANGED, SWP_SHOWWINDOW = 0x0020, 0x0040
    return bool(u.SetWindowPos(hwnd, 0, m["x"], m["y"], m["w"], m["h"], SWP_FRAMECHANGED | SWP_SHOWWINDOW))
