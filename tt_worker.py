"""시간표 사이트를 잠깐 띄워 전 주차 데이터를 긁어 로컬 캐시에 저장하고 바로 종료하는 프로세스.

app.py 가 필요할 때(캐시 없음·오래됨·교사 변경·새로고침)만 자식 프로세스로 실행한다.
창은 화면 밖 최소화 상태로 몇 초만 떠 있다가 저장이 끝나면 스스로 닫힌다.

  사용법: tt_worker.py <url> <교사이름>
  결과:   ~/.lesown_dashboard/tt_cache/<교사이름>.json
          { ready, teachers, teacher, currentWeek, totalWeeks, today, weeks:[...], fetchedAt }
  교사를 바꿔도 이전 교사 캐시는 남아 있어서 되돌아오면 바로 뜬다.
"""
import json
import sys
import threading
import time
from pathlib import Path

import webview

BASE = Path(getattr(sys, "_MEIPASS", Path(__file__).parent))
DATA_DIR = Path.home() / ".lesown_dashboard"
CACHE_DIR = DATA_DIR / "tt_cache"   # 교사별 캐시: <이름>.json (미설정은 _none.json)
TT_VER = 3   # tt_extract.js 변환 규칙 버전 (app.py 의 TT_VER 와 같게)
LOG_FILE = DATA_DIR / "tt_worker.log"
TIMEOUT = 150   # 이 시간 안에 못 긁으면 포기 (app.py 가 나중에 다시 띄움)


def cache_path(teacher):
    safe = "".join(ch for ch in (teacher or "") if ch.isalnum() or ch in "가-힣_-") or "_none"
    return CACHE_DIR / f"{safe}.json"


def log(msg):
    try:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write(f"{time.strftime('%H:%M:%S')} {msg}\n")
    except Exception:
        pass


TT_INJECT = """
(function () {
  if (window.__ttLoopStarted) return; window.__ttLoopStarted = true;
  window.__ttExtract = function (REQ_TEACHER, REQ_WEEK) { return (
__EXTRACT__
  ); };
  let done = false;
  function tick() {
    if (done) return;
    try {
      if (!window.pywebview || !pywebview.api) return;
      const data = window.__ttExtract(__TEACHER_JSON__, -2);   // -2 = 전 주차
      if (data && data.ready) { done = true; pywebview.api.push(JSON.stringify(data)); }
      else if (data && data.error) pywebview.api.log('extract error: ' + data.error);
    } catch (e) { try { pywebview.api.log('tick error: ' + e); } catch (_) {} }
  }
  setInterval(tick, 2000); setTimeout(tick, 500);
})();
"""


class Bridge:
    def __init__(self):
        self.win = None
        self.done = False

    def push(self, data_json):
        try:
            d = json.loads(data_json)
            d["fetchedAt"] = time.strftime("%Y-%m-%d %H:%M:%S")
            d["ver"] = TT_VER
            out = cache_path(d.get("teacher") if d.get("teacher") is not None else "")
            CACHE_DIR.mkdir(parents=True, exist_ok=True)
            tmp = out.with_suffix(".tmp")
            tmp.write_text(json.dumps(d, ensure_ascii=False), encoding="utf-8")
            tmp.replace(out)
            log(f"cache saved teacher={d.get('teacher')} weeks={len(d.get('weeks') or [])}")
        except Exception as e:
            log(f"push write failed: {e}")
        self.done = True
        threading.Thread(target=self._close, daemon=True).start()
        return True

    def _close(self):
        time.sleep(0.3)
        try:
            self.win.destroy()
        except Exception as e:
            log(f"destroy failed: {e}")

    def log(self, msg):
        log(str(msg))
        return True


def main():
    url = sys.argv[1] if len(sys.argv) > 1 else "https://teacher-2026.vercel.app/widget"
    teacher = sys.argv[2] if len(sys.argv) > 2 else ""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    extract_js = (BASE / "web" / "tt_extract.js").read_text(encoding="utf-8")
    extract_js = extract_js.replace("__TEACHER__", "REQ_TEACHER").replace("__WEEK__", "REQ_WEEK")
    inject = TT_INJECT.replace("__EXTRACT__", extract_js.strip().rstrip(";")).replace("__TEACHER_JSON__", json.dumps(teacher, ensure_ascii=False))
    log(f"start url={url} teacher={teacher}")

    bridge = Bridge()
    win = webview.create_window("시간표 불러오는 중…", url=url, js_api=bridge,
                                width=420, height=720, x=-5000, y=100, minimized=True, on_top=False)
    bridge.win = win

    def on_loaded():
        def _go():
            time.sleep(2)
            try:
                win.evaluate_js(inject)
                log("inject ok")
            except Exception as e:
                log(f"inject failed: {e}")
        threading.Thread(target=_go, daemon=True).start()

    def watchdog():
        time.sleep(TIMEOUT)
        if not bridge.done:
            log("timeout — giving up")
            try:
                win.destroy()
            except Exception:
                pass

    win.events.loaded += on_loaded
    threading.Thread(target=watchdog, daemon=True).start()
    # 대시보드와 다른 WebView2 프로필을 써야 두 프로세스가 충돌하지 않는다
    webview.start(private_mode=False, storage_path=str(DATA_DIR / "tt_profile"))
    log("exit" if bridge.done else "exit without data")
    sys.exit(0 if bridge.done else 2)


if __name__ == "__main__":
    main()
