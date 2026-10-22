"""뱀부랩 프린터(P2S 등) 같은 네트워크 직접 연결.

- 상태: MQTT(8883, TLS, 사용자 bblp / 비밀번호 = 액세스 코드), device/<시리얼>/report 구독,
  연결 직후 pushall 요청으로 전체 상태를 받고 이후엔 바뀐 값만 와서 합친다.
- 카메라: RTSPS(322) rtsps://bblp:<코드>@<IP>:322/streaming/live/1 을 ffmpeg 로 받아
  초당 2장 JPEG 로 바꿔 최근 한 장만 들고 있는다. 화면이 안 보면(20초) ffmpeg 를 끈다.
  (P1·A1 계열의 6000번 포트 JPEG 방식은 아직 안 넣음)
"""
import base64
import json
import os
import shutil
import ssl
import subprocess
import sys
import threading
import time
from pathlib import Path

NO_WINDOW = 0x08000000 if os.name == "nt" else 0


def find_ffmpeg():
    here = Path(getattr(sys, "_MEIPASS", Path(__file__).parent))
    for p in (Path(sys.executable).parent / "ffmpeg.exe", here / "ffmpeg.exe", Path(__file__).parent / "ffmpeg.exe"):
        if p.exists():
            return str(p)
    return shutil.which("ffmpeg")


class Printer:
    def __init__(self, ip, code, serial, log=print):
        self.ip, self.code, self.serial, self.log = ip.strip(), code.strip(), serial.strip().upper(), log
        self.state, self.connected, self.error, self.updated = {}, False, "", 0
        self.frame, self.frame_at, self.cam_error = None, 0, ""
        self._want_cam, self._ff, self._stop = 0, None, False
        self._mqtt = None
        threading.Thread(target=self._mqtt_loop, daemon=True).start()
        threading.Thread(target=self._cam_loop, daemon=True).start()

    def stop(self):
        self._stop = True
        try:
            self._mqtt and self._mqtt.disconnect()
        except Exception:
            pass
        self._kill_ff()

    # ---------- 상태 (MQTT) ----------
    def _mqtt_loop(self):
        try:
            import paho.mqtt.client as mqtt
        except Exception as e:
            self.error = f"paho-mqtt 없음: {e}"
            return
        while not self._stop:
            try:
                try:
                    c = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
                except AttributeError:
                    c = mqtt.Client()
                self._mqtt = c
                c.username_pw_set("bblp", self.code)
                ctx = ssl.create_default_context()
                ctx.check_hostname, ctx.verify_mode = False, ssl.CERT_NONE   # 프린터는 자체 서명 인증서
                c.tls_set_context(ctx)
                c.on_connect = self._on_connect
                c.on_message = self._on_message
                c.on_disconnect = lambda *a: setattr(self, "connected", False)
                c.connect(self.ip, 8883, keepalive=60)
                c.loop_forever()
            except Exception as e:
                self.connected, self.error = False, f"연결 실패: {e}"
            if not self._stop:
                time.sleep(15)

    def _on_connect(self, c, userdata, flags, rc, *a):
        ok = (getattr(rc, "value", rc) == 0)
        self.connected, self.error = ok, "" if ok else f"접속 거부({rc}) — 액세스 코드 확인"
        if ok:
            c.subscribe(f"device/{self.serial}/report")
            c.publish(f"device/{self.serial}/request", json.dumps({"pushing": {"sequence_id": "0", "command": "pushall"}}))

    def _on_message(self, c, userdata, msg):
        try:
            p = json.loads(msg.payload).get("print")
        except Exception:
            return
        if isinstance(p, dict):
            self.state.update(p)
            self.updated = time.time()

    def status(self):
        s = self.state
        nozzle = s.get("nozzle_temper")
        if nozzle is None:   # 신형 펌웨어(P2S·H2D)는 device.extruder 안에 있을 때가 있다
            try:
                nozzle = s["device"]["extruder"]["info"][0]["temp"] & 0xFFFF
            except Exception:
                nozzle = None
        return {
            "configured": True, "connected": self.connected, "error": self.error,
            "updated": self.updated,
            "state": s.get("gcode_state", ""),          # IDLE / PREPARE / RUNNING / PAUSE / FINISH / FAILED
            "percent": s.get("mc_percent"), "remaining": s.get("mc_remaining_time"),   # 분
            "layer": s.get("layer_num"), "layers": s.get("total_layer_num"),
            "nozzle": nozzle, "nozzle_target": s.get("nozzle_target_temper"),
            "bed": s.get("bed_temper"), "bed_target": s.get("bed_target_temper"),
            "chamber": s.get("chamber_temper"),
            "name": s.get("subtask_name") or s.get("gcode_file", ""),
            "speed": s.get("spd_lvl"),
            "cam_error": self.cam_error,
        }

    # ---------- 카메라 (RTSPS → ffmpeg → JPEG) ----------
    def get_frame(self):
        self._want_cam = time.time()
        if not self.frame:
            return {"ok": False, "error": self.cam_error or "카메라 연결 중…"}
        return {"ok": True, "src": "data:image/jpeg;base64," + base64.b64encode(self.frame).decode(), "age": time.time() - self.frame_at}

    def _kill_ff(self):
        p, self._ff = self._ff, None
        if p:
            try:
                p.kill()
            except Exception:
                pass

    def _cam_loop(self):
        while not self._stop:
            if time.time() - self._want_cam > 20:   # 아무도 안 보면 끈다
                self._kill_ff()
                time.sleep(1)
                continue
            ff = find_ffmpeg()
            if not ff:
                self.cam_error = "ffmpeg 없음"
                time.sleep(10)
                continue
            url = f"rtsps://bblp:{self.code}@{self.ip}:322/streaming/live/1"
            try:
                self._ff = subprocess.Popen(
                    [ff, "-hide_banner", "-loglevel", "error", "-rtsp_transport", "tcp", "-i", url,
                     "-an", "-vf", "fps=2,scale=960:-2", "-q:v", "6", "-f", "image2pipe", "-vcodec", "mjpeg", "-"],
                    stdout=subprocess.PIPE, stderr=subprocess.PIPE, stdin=subprocess.DEVNULL, creationflags=NO_WINDOW)
                threading.Thread(target=self._ff_err, args=(self._ff,), daemon=True).start()
                self._read_jpegs(self._ff)
            except Exception as e:
                self.cam_error = f"카메라 오류: {e}"
            self._kill_ff()
            if not self._stop:
                time.sleep(5)

    def _ff_err(self, p):
        try:
            for line in p.stderr:
                t = line.decode("utf-8", "replace").strip()
                if t:
                    self.cam_error = t.replace(self.code, "****")[:160]   # 액세스 코드는 숨김
        except Exception:
            pass

    def _read_jpegs(self, p):
        buf = b""
        while not self._stop and p.poll() is None:
            if time.time() - self._want_cam > 20:
                return
            chunk = p.stdout.read1(65536) if hasattr(p.stdout, "read1") else p.stdout.read(65536)
            if not chunk:
                return
            buf += chunk
            while True:
                s = buf.find(b"\xff\xd8")
                e = buf.find(b"\xff\xd9", s + 2) if s >= 0 else -1
                if s < 0 or e < 0:
                    break
                self.frame, self.frame_at, self.cam_error = buf[s:e + 2], time.time(), ""
                buf = buf[e + 2:]
            if len(buf) > 4_000_000:
                buf = b""
