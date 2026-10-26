"""Windows 모니터 목록과 창 옮기기 (ctypes, pywebview 의 screen/fullscreen 대신).

모니터가 여러 대면 pywebview 전체화면이 엉뚱한 모니터에 뜨는 일이 있어서,
EnumDisplayMonitors 로 모니터 사각형을 받아 SetWindowPos 로 창을 그 사각형에 꼭 맞춘다.
두 호출 모두 이 스레드만 모니터별 DPI 인식(_Aware)으로 바꿔 실제 픽셀 좌표로 맞춘다(배율이 다른 모니터가 섞여도 안 어긋남).
"""
import ctypes
import os
from ctypes import wintypes


class _Aware:
    """이 스레드만 '모니터별 DPI 인식'으로 바꿔, 모니터 좌표와 창 좌표를 둘 다 실제 픽셀로 맞춘다.
    (배율이 다른 모니터가 섞이면 가상 좌표끼리 어긋나 창이 엉뚱한 모니터에 작게 뜸)"""
    def __enter__(self):
        self.old = None
        try:
            f = ctypes.windll.user32.SetThreadDpiAwarenessContext
            f.restype = ctypes.c_void_p
            f.argtypes = [ctypes.c_void_p]
            self.old = f(ctypes.c_void_p(-4))   # PER_MONITOR_AWARE_V2
        except Exception:
            pass
        return self

    def __exit__(self, *a):
        if self.old:
            try:
                ctypes.windll.user32.SetThreadDpiAwarenessContext(ctypes.c_void_p(self.old))
            except Exception:
                pass


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

    with _Aware():
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
    with _Aware():
        return _place(title, m)


def is_placed(title, m):
    """창이 이미 모니터 m 에 딱 맞게 있으면 True (최소화돼 있으면 그대로 둠)."""
    if os.name != "nt" or not m:
        return True
    u = ctypes.windll.user32
    with _Aware():
        hwnd = u.FindWindowW(None, title)
        if not hwnd or u.IsIconic(hwnd):
            return True
        r = wintypes.RECT()
        u.GetWindowRect(hwnd, ctypes.byref(r))
        return (r.left, r.top, r.right - r.left, r.bottom - r.top) == (m["x"], m["y"], m["w"], m["h"])


def _place(title, m):
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
    # 맨 위(topmost): 이 모니터에도 작업 표시줄이 있으면 창 위로 올라오므로 그보다 위에 둔다
    return bool(u.SetWindowPos(hwnd, -1, m["x"], m["y"], m["w"], m["h"], SWP_FRAMECHANGED | SWP_SHOWWINDOW))


def keep_top(title):
    """작업 표시줄·시작 메뉴를 누르면 그쪽이 위로 올라오니 주기적으로 다시 맨 위로 (포커스는 안 가져옴)."""
    if os.name != "nt":
        return
    u = ctypes.windll.user32
    hwnd = u.FindWindowW(None, title)
    if hwnd and not u.IsIconic(hwnd):
        SWP_NOSIZE, SWP_NOMOVE, SWP_NOACTIVATE = 0x0001, 0x0002, 0x0010
        u.SetWindowPos(hwnd, -1, 0, 0, 0, 0, SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE)
