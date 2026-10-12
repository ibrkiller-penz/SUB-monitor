"""쿨메신저 등 메신저의 안읽은 메시지/알림 수집 (Windows 전용, 다른 OS에서는 빈 결과).

쿨메신저는 공개 API가 없어서 두 가지 경로로 감지한다.
  1) Windows 알림(토스트) 수신: winsdk 의 UserNotificationListener (설정 > 알림 접근 허용 필요)
  2) 창 제목 감지: "쿨메신저 (3)" 처럼 제목에 안읽은 개수가 붙는 경우
실제 동작 여부는 tools/coolmsg_probe.py 로 확인한다.
"""
import re
import sys
import time
from datetime import datetime

IS_WIN = sys.platform == "win32"


class MessageWatcher:
    def __init__(self, apps, keep=20):
        self.keywords = [a.lower() for a in apps if a.strip()]
        self.keep = keep
        self.items = []          # [{id, app, title, body, time}]
        self.seen = set()
        self.cleared_at = 0.0
        self.source = "none"
        self.error = ""
        self._listener = None
        self._listener_err = ""
        if IS_WIN:
            self._init_listener()

    # ---------- 1) Windows 알림 리스너 ----------
    def _init_listener(self):
        try:
            import asyncio
            from winsdk.windows.ui.notifications.management import (
                UserNotificationListener, UserNotificationListenerAccessStatus)
            listener = UserNotificationListener.current
            status = asyncio.run(listener.request_access_async())
            if status == UserNotificationListenerAccessStatus.ALLOWED:
                self._listener = listener
            else:
                self._listener_err = "알림 접근이 허용되지 않음 (Windows 설정 > 개인 정보 > 알림)"
        except Exception as e:  # winsdk 미설치 등
            self._listener_err = f"알림 리스너 사용 불가: {e}"

    def _match(self, *texts):
        if not self.keywords:
            return True
        s = " ".join(t for t in texts if t).lower()
        return any(k in s for k in self.keywords)

    def _poll_listener(self):
        import asyncio
        from winsdk.windows.ui.notifications import NotificationKinds, KnownNotificationBindings
        notifs = asyncio.run(self._listener.get_notifications_async(NotificationKinds.TOAST))
        found = []
        for n in notifs:
            try:
                app = n.app_info.display_info.display_name
            except Exception:
                app = ""
            try:
                binding = n.notification.visual.get_binding(KnownNotificationBindings.get_toast_generic())
                texts = [t.text for t in binding.get_text_elements()] if binding else []
            except Exception:
                texts = []
            if not self._match(app, *texts):
                continue
            try:
                ts = n.creation_time.timestamp()
            except Exception:
                ts = time.time()
            found.append({"id": f"n{n.id}", "app": app, "title": texts[0] if texts else app,
                          "body": " ".join(texts[1:]) if len(texts) > 1 else "", "time": ts})
        return found

    # ---------- 2) 창 제목 감지 ----------
    def _poll_titles(self):
        import ctypes
        from ctypes import wintypes
        user32 = ctypes.windll.user32
        titles = []

        @ctypes.WINFUNCTYPE(ctypes.c_bool, wintypes.HWND, wintypes.LPARAM)
        def cb(hwnd, _):
            if not user32.IsWindowVisible(hwnd):
                return True
            n = user32.GetWindowTextLengthW(hwnd)
            if n:
                buf = ctypes.create_unicode_buffer(n + 1)
                user32.GetWindowTextW(hwnd, buf, n + 1)
                titles.append(buf.value)
            return True
        user32.EnumWindows(cb, 0)
        found = []
        for t in titles:
            if not self._match(t):
                continue
            m = re.search(r"[\(\[](\d+)[\)\]]", t)
            if m and int(m.group(1)) > 0:
                found.append({"id": f"t{t}", "app": t, "title": f"안읽은 메시지 {m.group(1)}건", "body": t, "time": time.time(), "count": int(m.group(1))})
        return found

    # ---------- 공개 ----------
    def poll(self):
        if not IS_WIN:
            return {"count": 0, "items": [], "source": "none", "error": "Windows 에서만 동작"}
        items = []
        if self._listener:
            try:
                items = self._poll_listener()
                self.source = "notification"
            except Exception as e:
                self.error = f"알림 조회 실패: {e}"
        if not items:
            try:
                items = self._poll_titles()
                if items:
                    self.source = "title"
            except Exception as e:
                self.error = f"창 제목 조회 실패: {e}"
        for it in items:
            if it["id"] in self.seen or it["time"] < self.cleared_at:
                continue
            self.seen.add(it["id"])
            self.items.append(it)
        self.items = sorted(self.items, key=lambda x: -x["time"])[: self.keep]
        count = sum(it.get("count", 1) for it in self.items)
        err = self.error or (self._listener_err if self.source == "none" else "")
        return {"count": count, "items": [dict(it, time=datetime.fromtimestamp(it["time"]).isoformat()) for it in self.items],
                "source": self.source, "error": err}

    def clear(self):
        self.items = []
        self.cleared_at = time.time()
        return True
