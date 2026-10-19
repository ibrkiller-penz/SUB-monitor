"""LESOWN 11.3" (1920x440) 가로 스트립 대시보드.

시계 · 날씨 · 시간표(웹) · 구글 캘린더 일정 · PC 상태를 한 화면에 표시한다.
"""
import json
import os
import re
import shutil
import subprocess
import sys
import threading
import time
from datetime import date, datetime, timedelta
from pathlib import Path

import psutil
import requests
import webview

from notify import MessageWatcher


def _find_nvidia_smi():
    """NVIDIA 전용. 없으면 None → GPU 항목 생략."""
    p = shutil.which("nvidia-smi")
    if p:
        return p
    if sys.platform == "win32":
        for c in (Path(os.environ.get("SystemRoot", r"C:\Windows")) / "System32" / "nvidia-smi.exe",
                  Path(os.environ.get("ProgramFiles", r"C:\Program Files")) / "NVIDIA Corporation" / "NVSMI" / "nvidia-smi.exe"):
            if c.exists():
                return str(c)
    return None


NVIDIA_SMI = _find_nvidia_smi()


def read_gpu():
    """nvidia-smi 를 콘솔 창 없이 호출한다 (GPUtil 은 창이 깜빡여서 직접 호출)."""
    if not NVIDIA_SMI:
        return None
    kw = {}
    if sys.platform == "win32":
        si = subprocess.STARTUPINFO()
        si.dwFlags |= subprocess.STARTF_USESHOWWINDOW
        kw = dict(startupinfo=si, creationflags=subprocess.CREATE_NO_WINDOW)
    out = subprocess.run([NVIDIA_SMI, "--query-gpu=utilization.gpu,temperature.gpu,name", "--format=csv,noheader,nounits"],
                         capture_output=True, text=True, timeout=5, **kw).stdout
    line = out.strip().splitlines()[0]
    load, temp, name = [x.strip() for x in line.split(",", 2)]
    return {"load": int(float(load)), "temp": int(float(temp)), "name": name}

BASE = Path(getattr(sys, "_MEIPASS", Path(__file__).parent))
CONFIG_PATH = Path(sys.argv[0]).resolve().parent / "config.json"
if not CONFIG_PATH.exists():
    CONFIG_PATH = BASE / "config.json"


DATA_DIR = Path.home() / ".lesown_dashboard"
LOG_FILE = DATA_DIR / "app.log"
TT_CACHE_DIR = DATA_DIR / "tt_cache"   # tt_worker.py 가 교사별 전 주차 시간표를 긁어 저장 (사이트 창은 저장 후 바로 닫힘)
WEEKDAYS = ["월", "화", "수", "목", "금", "토", "일"]


def log(msg):
    """문제 추적용 로그 (~/.lesown_dashboard/app.log)."""
    try:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write(f"{time.strftime('%H:%M:%S')} {msg}\n")
    except Exception:
        pass


LOCAL_CONFIG = CONFIG_PATH.with_name("config.local.json")   # 이 PC·이 교사만의 설정 (git 에 안 올라감)
LOCAL_KEYS = ("teacher_name", "panels", "ical_urls", "udb", "orientation", "summary")


def load_config():
    """config.json(공용 기본값) 위에 config.local.json(개인 설정)을 덮어쓴다."""
    with open(CONFIG_PATH, encoding="utf-8") as f:
        cfg = json.load(f)
    try:
        local = json.loads(LOCAL_CONFIG.read_text(encoding="utf-8"))
        # udb 는 통째로 덮어쓰지 않고 키별로 합친다. unread_only 는 항상 공용 설정(config.json)을 따른다
        # (예전 버전이 설정 저장 때 udb 전체를 config.local.json 에 복사해 두어 새 기본값이 안 먹던 문제)
        if isinstance(local.get("udb"), dict) and isinstance(cfg.get("udb"), dict):
            u = dict(cfg["udb"])
            u.update({k: v for k, v in local.pop("udb").items() if k != "unread_only"})
            cfg["udb"] = u
        cfg.update(local)
    except FileNotFoundError:
        pass
    except Exception as e:
        log(f"config.local.json read failed: {e}")
    return cfg


def save_config(cfg):
    """사용자가 바꾼 항목만 config.local.json 에 저장 (config.json 은 건드리지 않는다)."""
    try:
        with open(CONFIG_PATH, encoding="utf-8") as f:
            base = json.load(f)
    except Exception:
        base = {}
    # 공용 기본값과 같은 항목은 저장하지 않는다 → 나중에 기본값이 바뀌면 그대로 따라감
    local = {k: cfg[k] for k in LOCAL_KEYS if k in cfg and cfg[k] != base.get(k)}
    with open(LOCAL_CONFIG, "w", encoding="utf-8") as f:
        json.dump(local, f, ensure_ascii=False, indent=2)


def timed(fn):
    """API 호출 시간을 로그에 남긴다 (0.5초 넘는 것만)."""
    def wrap(self, *args, **kw):
        t = time.time()
        try:
            return fn(self, *args, **kw)
        finally:
            dt = time.time() - t
            if dt > 0.5:
                log(f"slow api {fn.__name__} {dt:.1f}s")
    return wrap


class Api:
    def __init__(self, cfg):
        self.cfg = cfg
        self.tt_proc = None       # 시간표를 긁는 일회성 프로세스 (tt_worker.py)
        self._tt_spawn_at = 0.0   # 마지막으로 띄운 시각
        self._tt_next = 0.0       # 이 시각 전에는 다시 띄우지 않음 (실패 시 점점 길어짐)
        self._tt_fail = 0
        self._tt_lock = threading.Lock()
        self._tt_mem = (None, 0.0, None)   # (경로, mtime, 캐시 내용)
        threading.Thread(target=self._tt_refresher, daemon=True).start()
        self._gpu = (0.0, None)   # (마지막 조회 시각, 값) — nvidia-smi 는 10초마다만
        self.watcher = MessageWatcher(cfg.get("message_apps", ["쿨메신저", "CoolMessenger"]), udb=cfg.get("udb"))
        self._net = psutil.net_io_counters()
        self._net_t = time.time()
        self._cpu = 0.0
        threading.Thread(target=self._cpu_sampler, daemon=True).start()

    def _cpu_sampler(self):
        """cpu_percent(None)은 호출 간격이 들쭉날쭉하면 0%가 나오므로, 전용 스레드에서 1초 간격으로 잰다."""
        while True:
            try:
                self._cpu = psutil.cpu_percent(interval=1.0)
            except Exception:
                time.sleep(1)

    DEFAULT_PANELS = ["weather", "tt", "events", "msg"]
    PANEL_IDS = ("weather", "tt", "events", "school", "msg", "pc")
    MAX_PANELS = 4   # 시계 제외. 더 켜면 칸이 너무 좁아진다
    DEFAULT_SUMMARY = ["exam", "next", "duty", "msg"]

    @timed
    def get_config(self):
        return {
            "weather_name": self.cfg.get("weather", {}).get("name", ""),
            "panels": self.cfg.get("panels", self.DEFAULT_PANELS),
            "orientation": self.cfg.get("orientation", "landscape"),
            "summary": self.cfg.get("summary", self.DEFAULT_SUMMARY),
            "school_url": self.cfg.get("school_schedule_url", ""),
            "max_panels": self.MAX_PANELS,
        }

    def open_url(self, url):
        """기본 브라우저로 링크 열기 (학교 일정 사이트 등)."""
        import webbrowser
        if isinstance(url, str) and url.startswith(("http://", "https://")):
            webbrowser.open(url)
            return True
        return False

    def set_summary(self, items):
        self.cfg["summary"] = [x for x in items if isinstance(x, str)][:6]
        save_config(self.cfg)
        return self.cfg["summary"]

    def set_orientation(self, o):
        self.cfg["orientation"] = "portrait" if o == "portrait" else "landscape"
        save_config(self.cfg)
        return self.cfg["orientation"]

    def set_panels(self, panels):
        self.cfg["panels"] = [p for p in panels if p in self.PANEL_IDS][: self.MAX_PANELS]
        save_config(self.cfg)
        return self.cfg["panels"]

    # ---- 메신저 알림 (notify.py) ----
    @timed
    def get_messages(self):
        try:
            return self.watcher.poll()
        except Exception as e:
            return {"count": 0, "items": [], "source": "none", "error": str(e)}

    def clear_messages(self):
        return self.watcher.clear()

    # ---- 시간표 (tt_worker.py 가 긁어 둔 로컬 캐시) ----
    def _tt_path(self):
        """현재 설정된 교사의 캐시 파일 (교사별로 따로 저장 → 바꿨다 돌아와도 바로 뜸)."""
        from tt_worker import cache_path
        return cache_path(self.cfg.get("teacher_name") or "")

    def _tt_cache(self):
        """현재 교사의 캐시 파일을 읽는다 (바뀐 경우에만 다시 파싱)."""
        path = self._tt_path()
        try:
            m = path.stat().st_mtime
        except FileNotFoundError:
            return None
        if (str(path), m) != self._tt_mem[:2]:
            try:
                self._tt_mem = (str(path), m, json.loads(path.read_text(encoding="utf-8")))
            except Exception as e:
                log(f"tt_cache read failed: {e}")
                return None
        return self._tt_mem[2]

    def _tt_fresh(self, d):
        """캐시가 지금 설정(교사)·오늘 날짜·갱신 주기에 맞는지."""
        if not d or not d.get("ready"):
            return False
        if (d.get("teacher") or "") != (self.cfg.get("teacher_name") or ""):
            return False
        fetched = d.get("fetchedAt", "")
        if fetched[:10] != date.today().isoformat():
            return False
        try:
            age = time.time() - datetime.strptime(fetched, "%Y-%m-%d %H:%M:%S").timestamp()
        except Exception:
            return False
        return age < max(5, int(self.cfg.get("timetable_refresh_min", 30))) * 60

    def _tt_refresher(self):
        """30초마다 캐시 상태를 보고 필요하면 워커를 띄운다. 워커 결과(성공/실패)도 여기서 정리."""
        while True:
            time.sleep(30)
            try:
                self._tt_reap()
                if not self._tt_fresh(self._tt_cache()):
                    self._ensure_worker()
            except Exception as e:
                log(f"tt refresher error: {e}")

    def _tt_reap(self):
        """끝난 워커 정리: 캐시가 새로 써졌으면 성공, 아니면 실패 횟수 증가(재시도 간격 2분→4→8…최대 30분)."""
        p = self.tt_proc
        if p is None or p.poll() is None:
            return
        self.tt_proc = None
        path = self._tt_path()
        ok = path.exists() and path.stat().st_mtime >= self._tt_spawn_at - 1
        if ok:
            self._tt_fail = 0
            self._tt_next = 0.0
        else:
            self._tt_fail += 1
            self._tt_next = time.time() + min(1800, 120 * 2 ** (self._tt_fail - 1))
            log(f"tt_worker exited code={p.returncode} without new cache (fail {self._tt_fail})")

    def _ensure_worker(self, force=False):
        """워커가 안 돌고 있고 재시도 대기 중이 아니면 띄운다."""
        with self._tt_lock:
            self._tt_reap()
            if self.tt_proc is not None:
                return False
            if not force and time.time() < self._tt_next:
                return False
            if not force and time.time() - self._tt_spawn_at < 60:
                return False
            self.start_worker()
            return True

    @timed
    def get_timetable(self, week=-1):
        """캐시에서 요청 주차를 돌려준다 (블로킹 없음). week: 0-based, -1이면 오늘 주차.
        캐시가 없거나 교사가 다르면 워커를 띄우고 pending 을 돌려준다."""
        d = self._tt_cache()
        teacher = self.cfg.get("teacher_name") or ""
        if not d or not d.get("ready") or (d.get("teacher") or "") != teacher:
            self._ensure_worker()
            err = "시간표 불러오는 중…"
            if self._tt_fail:
                err = f"시간표 사이트 연결 실패 ({self._tt_fail}회) — 잠시 후 자동 재시도"
            teachers = (d or {}).get("teachers") or (self._tt_mem[2] or {}).get("teachers") or []   # 교사 목록은 다른 캐시에서라도
            return {"ready": False, "pending": True, "error": err, "teachers": teachers}
        if not self._tt_fresh(d):
            self._ensure_worker()
        out = {k: v for k, v in d.items() if k != "weeks"}
        out["fetchedAt"] = (d.get("fetchedAt") or "")[11:16]
        weeks = d.get("weeks") or []
        if d.get("noTimetable") or d.get("teacher") is None or not weeks:
            return out
        # 캐시를 받은 날과 오늘이 다르면(예: 주말 동안 사이트 연결 실패) 현재 주차·요일을 날짜로 다시 계산
        if (d.get("fetchedAt") or "")[:10] != date.today().isoformat():
            out["currentWeek"], out["today"] = self._cur_week(weeks)
        cur = int(out.get("currentWeek") or 1) - 1
        w = int(week) if week is not None else -1
        if not (0 <= w < len(weeks)):
            w = max(0, min(cur, len(weeks) - 1))
        out.update(weeks[w])
        return out

    @staticmethod
    def _cur_week(weeks):
        """오늘 날짜가 들어 있는 주차(없으면 다음 주차)와 요일."""
        today = date.today()
        iso = today.isoformat()
        wd = today.weekday()
        for i, wk in enumerate(weeks):
            if any(v.get("iso") == iso for v in wk["days"].values()):
                return i + 1, WEEKDAYS[wd] if wd < 5 else "월"
        for i, wk in enumerate(weeks):
            mon = (wk["days"].get("월") or {}).get("iso") or ""
            if mon > iso:
                return i + 1, "월"
        return len(weeks), "금"

    def set_teacher(self, name):
        self.cfg["teacher_name"] = name
        save_config(self.cfg)
        if not self._tt_fresh(self._tt_cache()):   # 그 교사 캐시가 이미 있으면 긁지 않고 바로 쓴다
            self.stop_worker()
            self._ensure_worker(force=True)
        return True

    def reload_timetable(self):
        """시간표를 사이트에서 다시 긁어온다 (캐시는 새 데이터가 올 때까지 유지)."""
        self.stop_worker()
        self._tt_fail = 0
        self._ensure_worker(force=True)
        return True

    def start_worker(self):
        exe = sys.executable
        teacher = self.cfg.get("teacher_name") or ""
        # exe 로 묶인 경우(PyInstaller)에는 같은 exe 를 --tt-worker 모드로 다시 띄운다
        cmd = [exe, "--tt-worker", self.cfg["timetable_url"], teacher] if getattr(sys, "frozen", False) \
            else [exe, str(BASE / "tt_worker.py"), self.cfg["timetable_url"], teacher]
        try:
            self.tt_proc = subprocess.Popen(cmd, cwd=str(BASE), creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
            self._tt_spawn_at = time.time()
            log(f"tt_worker started pid={self.tt_proc.pid} teacher={teacher}")
        except Exception as e:
            log(f"tt_worker start failed: {e}")
            self.tt_proc = None

    def stop_worker(self):
        if self.tt_proc and self.tt_proc.poll() is None:
            try:
                self.tt_proc.terminate()
            except Exception:
                pass
        self.tt_proc = None

    @timed
    def get_system(self):
        now = time.time()
        net = psutil.net_io_counters()
        dt = max(now - self._net_t, 0.001)
        down = (net.bytes_recv - self._net.bytes_recv) / dt
        up = (net.bytes_sent - self._net.bytes_sent) / dt
        self._net, self._net_t = net, now

        mem = psutil.virtual_memory()
        disk = psutil.disk_usage("C:\\" if sys.platform == "win32" else "/")
        gpu = self._gpu[1]
        if NVIDIA_SMI and now - self._gpu[0] > 10:   # nvidia-smi 호출은 10초마다
            try:
                gpu = read_gpu()
            except Exception:
                gpu = None
            self._gpu = (now, gpu)
        bat = psutil.sensors_battery() if hasattr(psutil, "sensors_battery") else None
        return {
            "cpu": self._cpu,
            "ram": mem.percent,
            "ram_used": round(mem.used / 2**30, 1),
            "ram_total": round(mem.total / 2**30, 1),
            "disk": disk.percent,
            "down": down,
            "up": up,
            "gpu": gpu,
            "battery": round(bat.percent) if bat else None,
            "uptime": int(now - psutil.boot_time()),
        }

    @timed
    def get_processes(self):
        """CPU 사용률 상위 프로세스 (상세 화면용)."""
        ncpu = psutil.cpu_count() or 1
        out = []
        for p in psutil.process_iter(["name", "cpu_percent", "memory_percent"]):
            try:
                i = p.info
                if i["name"] and i["name"] not in ("System Idle Process", "Idle"):
                    out.append(((i["cpu_percent"] or 0) / ncpu, i["memory_percent"] or 0, i["name"]))
            except Exception:
                pass
        out.sort(reverse=True)
        return [{"name": n, "cpu": round(c, 1), "mem": round(m, 1)} for c, m, n in out[:7]]

    @timed
    def get_weather(self):
        w = self.cfg["weather"]
        params = {
            "latitude": w["latitude"],
            "longitude": w["longitude"],
            "current": "temperature_2m,apparent_temperature,relative_humidity_2m,"
                       "weather_code,wind_speed_10m,is_day",
            "hourly": "temperature_2m,weather_code,precipitation_probability",
            "daily": "weather_code,temperature_2m_max,temperature_2m_min,"
                     "precipitation_probability_max,sunrise,sunset",
            "timezone": "Asia/Seoul",
            "forecast_days": 7,
        }
        try:
            r = requests.get("https://api.open-meteo.com/v1/forecast", params=params, timeout=10)
            r.raise_for_status()
            data = r.json()
        except Exception as e:
            return {"error": str(e)}
        try:
            aq = requests.get(
                "https://air-quality-api.open-meteo.com/v1/air-quality",
                params={"latitude": w["latitude"], "longitude": w["longitude"],
                        "current": "pm10,pm2_5", "timezone": "Asia/Seoul"},
                timeout=10).json()
            data["air"] = aq.get("current")
        except Exception:
            data["air"] = None
        return data

    # ---- 화면에서 직접 입력한 일정 (~/.lesown_dashboard/local_events.json) ----
    LOCAL_EVENTS = Path.home() / ".lesown_dashboard" / "local_events.json"

    def _load_local(self):
        try:
            return json.loads(self.LOCAL_EVENTS.read_text(encoding="utf-8"))
        except Exception:
            return []

    def _save_local(self, items):
        self.LOCAL_EVENTS.parent.mkdir(parents=True, exist_ok=True)
        self.LOCAL_EVENTS.write_text(json.dumps(items, ensure_ascii=False, indent=1), encoding="utf-8")

    def add_event(self, ev):
        """ev: {title, date 'YYYY-MM-DD', time 'HH:MM' | '', all_day}"""
        items = self._load_local()
        import uuid
        ev = {"id": uuid.uuid4().hex[:12], "title": str(ev.get("title", "")).strip()[:80],
              "date": ev.get("date", ""), "time": ev.get("time", "") or "", "all_day": bool(ev.get("all_day")) or not ev.get("time")}
        if not ev["title"] or not ev["date"]:
            return False
        items.append(ev)
        self._save_local(items)
        return True

    def delete_event(self, ev_id):
        items = [x for x in self._load_local() if x.get("id") != ev_id]
        self._save_local(items)
        return True

    def _local_events(self, start, end):
        out = []
        for x in self._load_local():
            try:
                d = date.fromisoformat(x["date"])
            except Exception:
                continue
            if not (start - timedelta(days=1) <= d <= end):
                continue
            if x.get("all_day") or not x.get("time"):
                out.append({"title": x["title"], "start": d.isoformat(), "end": (d + timedelta(days=1)).isoformat(),
                            "all_day": True, "location": "", "local": True, "id": x["id"]})
            else:
                s = datetime.combine(d, datetime.strptime(x["time"], "%H:%M").time())
                out.append({"title": x["title"], "start": s.isoformat(), "end": (s + timedelta(hours=1)).isoformat(),
                            "all_day": False, "location": "", "local": True, "id": x["id"]})
        return out

    # ---- 학교 일정 (Google Apps Script 웹앱, 페이지 안의 init-data JSON) ----
    SCHOOL_CACHE = DATA_DIR / "school_schedule.json"

    @staticmethod
    def _parse_school_page(html):
        """Apps Script 샌드박스 페이지 안에 역슬래시-x 로 이스케이프된 사용자 HTML 에서 init-data JSON 을 꺼낸다."""
        i = html.find("init-data")
        if i < 0:
            raise ValueError("init-data 없음")
        seg = html[max(0, i - 200): i + 400000]

        def unesc(s):
            s = re.sub(r"\\x([0-9a-fA-F]{2})", lambda m: chr(int(m.group(1), 16)), s)
            return s.replace("\\\\", "\\").replace("\\/", "/").replace("\\'", "'").replace('\\"', '"')
        dec = seg
        for _ in range(3):
            dec = unesc(dec)
            m = re.search(r'<script id="init-data" type="application/json">(.*?)</script>', dec, re.S)
            if m:
                try:
                    return json.JSONDecoder().raw_decode(m.group(1).strip())[0]
                except Exception:
                    continue
        raise ValueError("init-data JSON 해석 실패")

    def _school_data(self):
        url = (self.cfg.get("school_schedule_url") or "").strip()
        if not url:
            return None
        try:
            st = self.SCHOOL_CACHE.stat()
            if time.time() - st.st_mtime < 30 * 60:
                return json.loads(self.SCHOOL_CACHE.read_text(encoding="utf-8"))
        except Exception:
            pass
        try:
            r = requests.get(url, timeout=20, allow_redirects=True)
            r.raise_for_status()
            data = self._parse_school_page(r.text)
            DATA_DIR.mkdir(parents=True, exist_ok=True)
            self.SCHOOL_CACHE.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
            return data
        except Exception as e:
            log(f"school schedule fetch failed: {e}")
            try:
                return json.loads(self.SCHOOL_CACHE.read_text(encoding="utf-8"))
            except Exception:
                raise

    def _school_events(self, start, end):
        data = self._school_data()
        if not data:
            return []
        out = []
        for s in data.get("schedules", []):
            try:
                d0 = date.fromisoformat(str(s.get("startDate", ""))[:10])
            except Exception:
                continue
            try:
                d1 = date.fromisoformat(str(s.get("endDate") or s.get("startDate"))[:10])
            except Exception:
                d1 = d0
            if d1 < start - timedelta(days=1) or d0 > end:
                continue
            t = str(s.get("time") or "").strip()
            title = str(s.get("title") or "").strip()
            extra = " · ".join(x for x in (t if not re.match(r"^\d{1,2}:\d{2}", t) else "", str(s.get("place") or "").strip()) if x)
            ev = {"title": title + (f" ({extra})" if extra else ""), "location": str(s.get("place") or ""),
                  "source": "school", "tag": str(s.get("dept") or ""), "manager": str(s.get("manager") or ""), "id": f"s{s.get('id')}"}
            m = re.match(r"^(\d{1,2}):(\d{2})", t)
            if m and d0 == d1:
                st = datetime.combine(d0, datetime.min.time()).replace(hour=int(m.group(1)), minute=int(m.group(2)))
                ev.update(start=st.isoformat(), end=(st + timedelta(hours=1)).isoformat(), all_day=False)
            else:
                ev.update(start=d0.isoformat(), end=(d1 + timedelta(days=1)).isoformat(), all_day=True)
            out.append(ev)
        for x in data.get("academic", []):
            try:
                d0 = date.fromisoformat(str(x.get("date", ""))[:10])
            except Exception:
                continue
            if d0 < start - timedelta(days=1) or d0 > end:
                continue
            out.append({"title": str(x.get("name") or ""), "start": d0.isoformat(), "end": (d0 + timedelta(days=1)).isoformat(),
                        "all_day": True, "location": "", "source": "academic", "tag": str(x.get("type") or "학사"), "id": f"a{d0}"})
        return out

    @timed
    def get_events(self):
        urls = [u for u in self.cfg.get("ical_urls", []) if u.strip()]
        start = date.today()
        end = start + timedelta(days=int(self.cfg.get("calendar_days", 7)))
        events = self._local_events(start, end)
        errors = []
        try:
            events += self._school_events(start, end)
        except Exception as e:
            errors.append(f"학교 일정: {e}")
        if not urls:
            events.sort(key=lambda x: (x["start"][:10], not x["all_day"], x["start"]))
            return {"events": events, "error": "; ".join(errors) if errors else (None if events else "일정이 없습니다. 일정 상세에서 직접 입력하거나 config 에 캘린더 주소를 넣으세요.")}
        import icalendar
        import recurring_ical_events

        for url in urls:
            try:
                r = requests.get(url.strip(), timeout=15)
                r.raise_for_status()
                cal = icalendar.Calendar.from_ical(r.content)
                for ev in recurring_ical_events.of(cal).between(start, end):
                    s = ev.get("DTSTART").dt
                    e = ev.get("DTEND").dt if ev.get("DTEND") else s
                    all_day = not isinstance(s, datetime)
                    if not all_day and s.tzinfo:
                        s = s.astimezone().replace(tzinfo=None)
                        e = e.astimezone().replace(tzinfo=None) if isinstance(e, datetime) else e
                    events.append({
                        "title": str(ev.get("SUMMARY", "(제목 없음)")),
                        "start": s.isoformat(),
                        "end": e.isoformat() if hasattr(e, "isoformat") else None,
                        "all_day": all_day,
                        "location": str(ev.get("LOCATION", "") or ""),
                    })
            except Exception as e:
                errors.append(str(e))
        events.sort(key=lambda x: (x["start"][:10], not x["all_day"], x["start"]))
        return {"events": events, "error": "; ".join(errors) if errors else None}

    def close(self):
        self.stop_worker()
        for w in webview.windows:
            w.destroy()


def pick_screen(cfg):
    """1920x440 / 440x1920 해상도 화면을 찾는다. 없으면 None(주 모니터)."""
    d = cfg.get("display", {})
    tw, th = d.get("target_width", 1920), d.get("target_height", 440)
    try:
        for s in webview.screens:
            if (s.width, s.height) in ((tw, th), (th, tw)):
                return s
        # 배율(DPI) 적용으로 해상도가 달라 보이는 경우: 가로세로 비율로 탐색
        for s in webview.screens:
            ratio = max(s.width, s.height) / max(1, min(s.width, s.height))
            if ratio > 3.5:
                return s
    except Exception:
        pass
    return None


def main():
    cfg = load_config()
    api = Api(cfg)
    screen = pick_screen(cfg)
    fullscreen = cfg.get("display", {}).get("fullscreen", True) and screen is not None
    portrait = cfg.get("orientation") == "portrait"
    if screen is not None:
        win_w, win_h = screen.width, screen.height          # 보조모니터 전체
    else:
        win_w, win_h = (470, 1000) if portrait else (1920, 480)   # 일반 창 (화면이 스스로 축소됨)
    kwargs = dict(
        title="SUBmonitor",
        url=str(BASE / "web" / "index.html"),
        js_api=api,
        width=win_w,
        height=win_h,
        background_color="#0b0f17",
        # 보조모니터를 찾으면 그 화면에 테두리 없이 전체화면, 못 찾으면 일반 창
        frameless=screen is not None,
        easy_drag=False,
        fullscreen=fullscreen,
        screen=screen,
    )
    if screen is not None and hasattr(screen, "x"):
        kwargs.update(x=screen.x, y=screen.y)
    log(f"start screens={[(s.width, s.height) for s in webview.screens]} picked={'yes' if screen else 'no'} pywebview={getattr(webview, '__version__', '?')}")
    win = webview.create_window(**kwargs)
    win.events.loaded += lambda: log("main window loaded")
    if not api._tt_fresh(api._tt_cache()):
        api._ensure_worker(force=True)   # 시간표 캐시가 없거나 오래됐으면 지금 긁어온다
    try:
        # 화면 파일이 바뀌면(새 버전) WebView2 프로필을 새로 써서 예전 화면이 캐시에서 뜨지 않게 한다
    import hashlib
    ver = hashlib.md5(b"".join((BASE / "web" / f).read_bytes() for f in ("index.html", "detail.js", "detail.css"))).hexdigest()[:8]
    log(f"web version {ver}")
    webview.start(private_mode=False, storage_path=str(DATA_DIR / "profile" / ver), debug="--debug" in sys.argv)
    finally:
        api.stop_worker()
        log("exit")


if __name__ == "__main__":
    if "--tt-worker" in sys.argv:          # exe 빌드에서 시간표 워커로 동작
        import tt_worker
        sys.argv = [sys.argv[0]] + [x for x in sys.argv[1:] if x != "--tt-worker"]
        tt_worker.main()
    else:
        main()
