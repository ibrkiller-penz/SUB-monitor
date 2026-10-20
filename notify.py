"""쿨메신저 등 메신저의 안읽은 메시지/알림 수집 (Windows 전용, 다른 OS에서는 빈 결과).

쿨메신저는 공개 API가 없어서 세 가지 경로로 감지한다 (위쪽이 우선).
  0) 쿨메신저 로컬 DB(UDB, SQLite) 직접 읽기: ref/쿨메신저_예약매니저 가 쓰는 방식. 수신 쪽지 = tbl_recv,
     본문은 "{COMP}" 접두 압축. 파일 위치·컬럼은 PC마다 달라서 config.json 의 udb 설정으로 맞춘다.
  1) Windows 알림(토스트) 수신: winsdk 의 UserNotificationListener (설정 > 알림 접근 허용 필요)
  2) 창 제목 감지: "쿨메신저 (3)" 처럼 제목에 안읽은 개수가 붙는 경우
실제 동작 여부는 tools/coolmsg_probe.py 로 확인한다.
"""
import base64
import glob
import os
import re
import sqlite3
import sys
import time
import zlib
from datetime import datetime
from pathlib import Path

IS_WIN = sys.platform == "win32"

# ---------- 0) UDB(SQLite) 리더 ----------
UDB_SEARCH = [r"C:\CoolMessenger", r"C:\Program Files\CoolMessenger", r"C:\Program Files (x86)\CoolMessenger",
              os.path.join(os.environ.get("APPDATA", ""), "CoolMessenger"), os.path.join(os.environ.get("LOCALAPPDATA", ""), "CoolMessenger"),
              os.path.join(os.environ.get("PROGRAMDATA", ""), "CoolMessenger")]
COL_GUESS = {  # 역할별 후보 컬럼명 (소문자 비교)
    "sender": ["sender", "send_name", "sendname", "from_name", "fromname", "sendid", "send_id", "from_id", "name", "user_name"],
    "title": ["title", "subject", "msg_title"],
    # MessageText = 평문, MessageBody = "{COMP}" 압축 HTML. 평문이 있으면 그쪽을 먼저 쓴다.
    "content": ["messagetext", "content", "contents", "body", "msg", "message", "text", "msg_content", "messagebody"],
    "date": ["receivedate", "recv_date", "recvdate", "date", "send_date", "senddate", "reg_date", "regdate", "time", "recv_time", "wdate"],
    "read": ["isunread", "is_unread", "read_yn", "readyn", "isread", "is_read", "read", "confirm", "confirm_yn", "read_flag", "readflag", "open_yn"],
    "key": ["messagekey", "key", "idx", "id", "seq", "no", "msg_id", "msgid"],
}


def decomp(text):
    """'{COMP}...' 형태의 본문을 복원한다. 압축 방식이 확실치 않아 여러 조합을 시도."""
    if not isinstance(text, (str, bytes)):
        return str(text or "")
    raw = text if isinstance(text, bytes) else text.encode("utf-8", "ignore")
    if not raw.startswith(b"{COMP}"):
        return text if isinstance(text, str) else raw.decode("utf-8", "ignore")
    body = raw[6:]
    cands = [body]
    try:
        cands.append(base64.b64decode(body, validate=False))
    except Exception:
        pass
    for c in cands:
        for fn in (lambda b: zlib.decompress(b), lambda b: zlib.decompress(b, -15), lambda b: zlib.decompress(b, 31)):
            try:
                out = fn(c)
                for enc in ("utf-8", "cp949", "utf-16"):
                    try:
                        return out.decode(enc)
                    except Exception:
                        continue
            except Exception:
                continue
    return "(압축 본문)"


class UdbReader:
    def __init__(self, cfg):
        cfg = cfg or {}
        self.path = self.resolve(cfg.get("path") or "")
        self.table = cfg.get("table") or "tbl_recv"
        self.cols = {k: v for k, v in (cfg.get("columns") or {}).items() if v}
        self.unread_only = cfg.get("unread_only", True)
        self.error = ""
        if not self.path:
            self.path = self.find()

    @staticmethod
    def resolve(path):
        """경로에 %LOCALAPPDATA% 같은 환경변수와 글롭(*)을 쓸 수 있다.
        udb 파일 이름은 Windows 계정이 아니라 쿨메신저 로그인 이름이라서 글롭이 편하다.
        여러 개가 맞으면 가장 최근에 쓰인 파일을 쓴다 (예: '홍길동 (1).udb' 같은 옛 사본 제외)."""
        path = os.path.expandvars(os.path.expanduser(path or ""))
        if not path:
            return ""
        if os.path.isdir(path):
            path = os.path.join(path, "*.udb")
        if any(c in path for c in "*?["):
            hits = [h for h in glob.glob(path) if os.path.isfile(h)]
            return max(hits, key=os.path.getmtime) if hits else ""
        return path

    @staticmethod
    def find():
        for base in UDB_SEARCH:
            if base and os.path.isdir(base):
                hits = glob.glob(os.path.join(base, "**", "*.udb"), recursive=True) + glob.glob(os.path.join(base, "**", "*.db"), recursive=True)
                hits = [h for h in hits if os.path.getsize(h) > 10_000]
                if hits:
                    return max(hits, key=os.path.getmtime)
        return ""

    def _conn(self):
        return sqlite3.connect(f"file:{Path(self.path).as_uri()[7:]}?mode=ro", uri=True, timeout=2)

    def _resolve_cols(self, con):
        names = [r[1] for r in con.execute(f"PRAGMA table_info({self.table})")]
        low = {n.lower(): n for n in names}
        out = {}
        for role, cands in COL_GUESS.items():
            if role in self.cols and self.cols[role] in names:
                out[role] = self.cols[role]
                continue
            for c in cands:
                if c in low:
                    out[role] = low[c]
                    break
        return out, names

    @staticmethod
    def _unread_cond(col):
        """읽음 컬럼의 극성은 이름으로 판단한다.
        IsUnRead 처럼 '안읽음' 뜻이면 1 이 안읽음, read_yn 처럼 '읽음' 뜻이면 0/'N' 이 안읽음."""
        if "unread" in col.lower().replace("_", ""):
            return f"{col} NOT IN (0, '0', 'N', 'n', '') AND {col} IS NOT NULL"
        return f"({col} IN (0, '0', 'N', 'n', '') OR {col} IS NULL)"

    def poll(self, limit=20):
        if not self.path or not os.path.exists(self.path):
            self.error = "UDB 파일을 찾지 못함 (config.json > udb.path 지정)"
            return []
        with self._conn() as con:
            cols, names = self._resolve_cols(con)
            if "content" not in cols and "title" not in cols:
                self.error = f"{self.table} 컬럼을 해석하지 못함: {names}"
                return []
            conds = []
            if self.unread_only and "read" in cols:
                conds.append(self._unread_cond(cols["read"]))
            del_col = next((c for c in names if c.lower().replace("_", "") in ("deleteddate", "deleted", "isdeleted", "delyn")), None)
            if del_col:
                conds.append(f"({del_col} IS NULL OR {del_col} IN ('', 0, '0', 'N'))")
            where = ("WHERE " + " AND ".join(conds)) if conds else ""
            order = f"ORDER BY {cols['date']} DESC" if "date" in cols else (f"ORDER BY {cols['key']} DESC" if "key" in cols else "")
            rows = con.execute(f"SELECT * FROM {self.table} {where} {order} LIMIT {int(limit)}").fetchall()
            idx = {n: i for i, n in enumerate(names)}
            out = []
            for r in rows:
                g = lambda role: r[idx[cols[role]]] if role in cols else None
                content = decomp(g("content") or "")
                dt = g("date")
                try:
                    ts = datetime.fromisoformat(str(dt)[:19].replace("/", "-")).timestamp()
                except Exception:
                    ts = time.time()
                # 화면에는 발신자 + 내용만. MessageText 가 제목으로 시작하면 그 제목 부분은 떼어 낸다
                title, content = str(g("title") or "").strip(), content.strip()
                body = content[len(title):].lstrip(" \t\r\n:-·") if title and content.startswith(title) else content
                body = body or content or title
                rv = g("read")
                if "read" not in cols:
                    unread = True
                elif "unread" in cols["read"].lower().replace("_", ""):
                    unread = rv not in (None, 0, "0", "N", "n", "")
                else:
                    unread = rv in (None, 0, "0", "N", "n", "")
                out.append({"id": f"u{g('key') if 'key' in cols else hash(r)}", "app": "쿨메신저", "title": str(g("sender") or title or "쪽지"),
                            "body": body[:200], "time": ts, "unread": bool(unread)})
            self.error = ""
            return out


class MessageWatcher:
    def __init__(self, apps, keep=20, udb=None):
        self.keywords = [a.lower() for a in apps if a.strip()]
        self.udb = UdbReader(udb) if IS_WIN else None
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
        if self.udb:
            try:
                items = self.udb.poll(self.keep)
                if items or not self.udb.error:   # DB를 읽었으면 안읽은 쪽지가 0건이어도 그대로(창 제목으로 넘어가지 않음)
                    self.source = "udb"
                    # DB에서 읽은 것은 매번 전체 목록을 다시 받으므로 누적하지 않고 교체
                    self.items = [it for it in items if it["time"] >= self.cleared_at]
                    return self._result()
            except Exception as e:
                self.error = f"UDB 조회 실패: {e}"
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
        return self._result()

    def _result(self):
        if self.source == "udb":
            count = sum(1 for it in self.items if it.get("unread"))
        else:
            count = sum(it.get("count", 1) for it in self.items)
        err = self.error or (self._listener_err if self.source == "none" else "")
        if self.source == "none" and self.udb and self.udb.error:
            err = self.udb.error + (" · " + err if err else "")
        return {"count": count, "items": [dict(it, time=datetime.fromtimestamp(it["time"]).isoformat()) for it in self.items],
                "source": self.source, "error": err}

    def clear(self):
        self.items = []
        self.cleared_at = time.time()
        return True
