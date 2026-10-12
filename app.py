"""LESOWN 11.3" (1920x440) 가로 스트립 대시보드.

시계 · 날씨 · 시간표(웹) · 구글 캘린더 일정 · PC 상태를 한 화면에 표시한다.
"""
import json
import sys
import time
from datetime import date, datetime, timedelta
from pathlib import Path

import psutil
import requests
import webview

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


class Api:
    def __init__(self, cfg):
        self.cfg = cfg
        self.tt_window = None  # 시간표 사이트를 띄워두는 숨김 창
        self._extract_js = (BASE / "web" / "tt_extract.js").read_text(encoding="utf-8")
        self._net = psutil.net_io_counters()
        self._net_t = time.time()
        psutil.cpu_percent(None)

    def get_config(self):
        return {
            "weather_name": self.cfg.get("weather", {}).get("name", ""),
        }

    def get_timetable(self, week=-1):
        """숨김 창의 시간표 사이트 엔진에서 계산된 데이터만 가져온다. week: 0-based, -1이면 오늘 주차."""
        if not self.tt_window:
            return {"ready": False}
        js = (self._extract_js.replace("__TEACHER__", json.dumps(self.cfg.get("teacher_name", "")))
              .replace("__WEEK__", str(int(week) if week is not None else -1)))
        try:
            return self.tt_window.evaluate_js(js) or {"ready": False}
        except Exception as e:
            return {"ready": False, "error": str(e)}

    def set_teacher(self, name):
        self.cfg["teacher_name"] = name
        save_config(self.cfg)
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
        gpu = None
        if GPUtil:
            try:
                g = GPUtil.getGPUs()
                if g:
                    gpu = {"load": round(g[0].load * 100), "temp": g[0].temperature,
                           "name": g[0].name}
            except Exception:
                gpu = None
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
        frameless=True,
        easy_drag=False,
        background_color="#0b0f17",
        fullscreen=fullscreen,
        screen=screen,
    )
    if screen is not None and hasattr(screen, "x"):
        kwargs.update(x=screen.x, y=screen.y)
    webview.create_window(**kwargs)
    api.tt_window = webview.create_window(
        "timetable-source", url=cfg["timetable_url"], hidden=True, width=400, height=800)
    webview.start(private_mode=False, storage_path=str(Path.home() / ".lesown_dashboard"))


if __name__ == "__main__":
    main()
