"""시간표 사이트를 띄워 데이터를 뽑아 파일로 넘기는 별도 프로세스.

app.py 가 이 스크립트를 자식 프로세스로 실행한다. 대시보드와 완전히 분리돼 있어서
이 창이 느리거나 멈춰도 대시보드는 영향을 받지 않는다.

  요청: ~/.lesown_dashboard/tt_request.json   {"teacher": "...", "week": -1}   (app.py 가 씀)
  결과: ~/.lesown_dashboard/tt_data.json      추출 결과                        (여기서 씀)
"""
import json
import sys
import threading
import time
from pathlib import Path

import webview

BASE = Path(getattr(sys, "_MEIPASS", Path(__file__).parent))
DATA_DIR = Path.home() / ".lesown_dashboard"
REQ_FILE = DATA_DIR / "tt_request.json"
OUT_FILE = DATA_DIR / "tt_data.json"
LOG_FILE = DATA_DIR / "tt_worker.log"


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


class Bridge:
    def request(self):
        try:
            return json.loads(REQ_FILE.read_text(encoding="utf-8"))
        except Exception:
            return {"teacher": "", "week": -1}

    def push(self, data_json):
        try:
            tmp = OUT_FILE.with_suffix(".tmp")
            tmp.write_text(data_json if isinstance(data_json, str) else json.dumps(data_json, ensure_ascii=False), encoding="utf-8")
            tmp.replace(OUT_FILE)
        except Exception as e:
            log(f"push write failed: {e}")
        return True

    def log(self, msg):
        log(str(msg))
        return True


def main():
    url = sys.argv[1] if len(sys.argv) > 1 else "https://teacher-2026.vercel.app/widget"
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    extract_js = (BASE / "web" / "tt_extract.js").read_text(encoding="utf-8")
    extract_js = extract_js.replace("__TEACHER__", "REQ_TEACHER").replace("__WEEK__", "REQ_WEEK")
    inject = TT_INJECT.replace("__EXTRACT__", extract_js.strip().rstrip(";"))
    log(f"start url={url}")

    win = webview.create_window("시간표 데이터 (닫지 마세요)", url=url, js_api=Bridge(),
                                width=420, height=720, x=-5000, y=100, minimized=True, on_top=False)

    def on_loaded():
        def _go():
            time.sleep(2)
            try:
                win.evaluate_js(inject)
                log("inject ok")
            except Exception as e:
                log(f"inject failed: {e}")
        threading.Thread(target=_go, daemon=True).start()

    win.events.loaded += on_loaded
    # 대시보드와 다른 WebView2 프로필을 써야 두 프로세스가 충돌하지 않는다
    webview.start(private_mode=False, storage_path=str(DATA_DIR / "tt_profile"))
    log("exit")


if __name__ == "__main__":
    main()
