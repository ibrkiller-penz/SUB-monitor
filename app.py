"""LESOWN 11.3" (1920x440) 가로 스트립 대시보드.

시계 · 날씨 · 시간표(웹) · 구글 캘린더 일정 · PC 상태를 한 화면에 표시한다.
"""
import json
import sys
import threading
import time
from datetime import date, datetime, timedelta
from pathlib import Path

import psutil
import requests
import webview

from notify import MessageWatcher

try:
    import GPUtil  # NVIDIA 전용, 없으면 GPU 항목 생략
except Exception:
    GPUtil = None

BASE = Path(getattr(sys, "_MEIPASS", Path(__file__).parent))
CONFIG_PATH = Path(sys.argv[0]).resolve().parent / "config.json"
if not CONFIG_PATH.exists():
    CONFIG_PATH = BASE / "config.json"


def load_config():
    with open(CONFIG_PATH, encoding="utf-8") as f:
        return json.load(f)


def save_config(cfg):
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)


class TimetableBridge:
    """시간표 사이트 창(화면 밖)에 주입된 스크립트가 주기적으로 데이터를 밀어넣는 통로.

    예전엔 대시보드가 숨김 창에 evaluate_js 로 데이터를 '당겨' 왔는데, Windows(WebView2)에서는
    숨김 창이 로드되지 않아 그 호출이 멈추고 앱 전체가 '응답 없음'이 됐다. 지금은 반대로
    사이트 창 쪽에서 pywebview.api.push(...) 로 '밀어' 주므로 어느 쪽도 기다리지 않는다.
    """

    def __init__(self, cfg):
        self.cfg = cfg
        self.data = {"ready": False}
        self.req = {"teacher": cfg.get("teacher_name", ""), "week": -1}
        self.updated = 0.0

    # --- 사이트 창의 JS가 호출 ---
    def request(self):
        return dict(self.req)

    def push(self, data_json):
        try:
            self.data = json.loads(data_json) if isinstance(data_json, str) else data_json
            self.updated = time.time()
        except Exception as e:
            self.data = {"ready": False, "error": str(e)}
        return True

    def log(self, msg):
        print("[tt]", msg)
        return True


class Api:
    def __init__(self, cfg):
        self.cfg = cfg
        self.tt_window = None  # 시간표 사이트를 띄워두는 창 (화면 밖)
        self.bridge = TimetableBridge(cfg)
        self._gpu = (0.0, None)   # (마지막 조회 시각, 값) — nvidia-smi 는 10초마다만
        self.watcher = MessageWatcher(cfg.get("message_apps", ["쿨메신저", "CoolMessenger"]), udb=cfg.get("udb"))
        self._net = psutil.net_io_counters()
        self._net_t = time.time()
        psutil.cpu_percent(None)

    DEFAULT_PANELS = ["weather", "tt", "events", "msg"]

    def get_config(self):
        return {
            "weather_name": self.cfg.get("weather", {}).get("name", ""),
            "panels": self.cfg.get("panels", self.DEFAULT_PANELS),
        }

    def set_panels(self, panels):
        self.cfg["panels"] = [p for p in panels if p in ("weather", "tt", "events", "msg", "pc")]
        save_config(self.cfg)
        return self.cfg["panels"]

    # ---- 메신저 알림 (notify.py) ----
    def get_messages(self):
        try:
            return self.watcher.poll()
        except Exception as e:
            return {"count": 0, "items": [], "source": "none", "error": str(e)}

    def clear_messages(self):
        return self.watcher.clear()

    def get_timetable(self, week=-1):
        """사이트 창이 밀어넣은 최신 데이터를 돌려준다 (블로킹 없음). week: 0-based, -1이면 오늘 주차.
        요청(교사·주차)이 바뀌면 사이트 창이 다음 주기(3초 이내)에 새 데이터를 보낸다."""
        self.bridge.req = {"teacher": self.cfg.get("teacher_name", ""), "week": int(week) if week is not None else -1}
        d = dict(self.bridge.data or {})
        if d.get("ready") and self.bridge.updated and time.time() - self.bridge.updated > 180:
            d["stale"] = True
        if not d.get("ready") and not d.get("error"):
            d["error"] = "시간표 사이트 창 로딩 대기 중"
        return d

    def set_teacher(self, name):
        self.cfg["teacher_name"] = name
        save_config(self.cfg)
        self.bridge.req["teacher"] = name
        return True

    def reload_timetable(self):
        if self.tt_window:
            self.tt_window.load_url(self.cfg["timetable_url"])
        return True

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
        if GPUtil and now - self._gpu[0] > 10:   # nvidia-smi 호출은 10초마다
            try:
                g = GPUtil.getGPUs()
                gpu = {"load": round(g[0].load * 100), "temp": g[0].temperature, "name": g[0].name} if g else None
            except Exception:
                gpu = None
            self._gpu = (now, gpu)
        bat = psutil.sensors_battery() if hasattr(psutil, "sensors_battery") else None
        return {
            "cpu": psutil.cpu_percent(None),
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

    def get_events(self):
        urls = [u for u in self.cfg.get("ical_urls", []) if u.strip()]
        start = date.today()
        end = start + timedelta(days=int(self.cfg.get("calendar_days", 7)))
        events = self._local_events(start, end)
        errors = []
        if not urls:
            events.sort(key=lambda x: (x["start"][:10], not x["all_day"], x["start"]))
            return {"events": events, "error": None if events else "config.json 의 ical_urls 에 구글 캘린더 iCal 주소를 넣거나, 일정 상세에서 직접 입력하세요."}
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


TT_INJECT = """
(function () {
  if (window.__ttLoopStarted) return; window.__ttLoopStarted = true;
  window.__ttExtract = function (REQ_TEACHER, REQ_WEEK) { return (
__EXTRACT__
  ); };
  let lastKey = '', lastAt = 0;
  async function tick() {
    try {
      if (!window.pywebview || !pywebview.api) return;
      const req = await pywebview.api.request();
      const key = JSON.stringify(req);
      if (key === lastKey && Date.now() - lastAt < 30000) return;   // 요청이 같으면 30초마다만
      const data = window.__ttExtract(req.teacher || '', Number(req.week ?? -1));
      if (data && data.ready) { lastKey = key; lastAt = Date.now(); }
      await pywebview.api.push(JSON.stringify(data));
    } catch (e) { try { pywebview.api.log('tick error: ' + e); } catch (_) {} }
  }
  setInterval(tick, 3000); setTimeout(tick, 1500);
})();
"""


def main():
    cfg = load_config()
    api = Api(cfg)
    screen = pick_screen(cfg)
    fullscreen = cfg.get("display", {}).get("fullscreen", True) and screen is not None
    kwargs = dict(
        title="LESOWN Dashboard",
        url=str(BASE / "web" / "index.html"),
        js_api=api,
        width=1920,
        height=440,
        background_color="#0b0f17",
        # 보조모니터를 찾으면 그 화면에 테두리 없이 전체화면, 못 찾으면 일반 창
        frameless=screen is not None,
        easy_drag=False,
        fullscreen=fullscreen,
        screen=screen,
    )
    if screen is not None and hasattr(screen, "x"):
        kwargs.update(x=screen.x, y=screen.y)
    webview.create_window(**kwargs)

    # 시간표 사이트 창: 숨기면(WebView2) 로드가 안 되므로 화면 밖에 작게 띄운다
    extract_js = (BASE / "web" / "tt_extract.js").read_text(encoding="utf-8")
    extract_js = extract_js.replace("__TEACHER__", "REQ_TEACHER").replace("__WEEK__", "REQ_WEEK")
    inject = TT_INJECT.replace("__EXTRACT__", extract_js.strip().rstrip(";"))
    api.tt_window = webview.create_window(
        "시간표 데이터 (닫지 마세요)", url=cfg["timetable_url"], js_api=api.bridge,
        width=420, height=720, x=-5000, y=100, minimized=True, on_top=False)

    def on_loaded():
        # 사이트가 로드될 때마다(새로고침 포함) 추출 루프를 다시 심는다
        def _go():
            time.sleep(2)
            try:
                api.tt_window.evaluate_js(inject)
            except Exception as e:
                print("[tt] inject failed:", e)
        threading.Thread(target=_go, daemon=True).start()

    api.tt_window.events.loaded += on_loaded
    webview.start(private_mode=False, storage_path=str(Path.home() / ".lesown_dashboard"))


if __name__ == "__main__":
    main()
