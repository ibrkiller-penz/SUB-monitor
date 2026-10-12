# SUB모니터 — LESOWN 11.3" (1920×440) 서브모니터 대시보드

Windows PC 옆에 두는 가로 스트립 디스플레이용 Python(pywebview) 앱. 사용자는 부산 동래고 교사(임병율, 1-4 담임).

## 구조
- `app.py` — pywebview 창 + JS API (`get_timetable(week)`, `get_weather`, `get_events`, `add_event`, `delete_event`, `get_system`, `get_processes`, `set_teacher`, `reload_timetable`). 시간표 사이트(https://teacher-2026.vercel.app/widget)를 숨김 창으로 열고 `web/tt_extract.js`를 주입해 계산된 데이터만 가져온다.
- `web/index.html` — 허브 화면(시계·날씨·시간표·일정·PC). CSS/JS 인라인. 글자 넘침은 `fitAll()`이 자동 축소/숨김.
- `web/detail.css`, `web/detail.js` — 패널 클릭 시 전체화면 상세 5종(오늘/날씨/시간표/일정/PC). `← 허브로`, Esc, 90초 무조작 시 복귀.
- `web/tt_extract.js` — 사이트 엔진(`TimetableEngine`)에서 주차별 시간표·공강지도·급식지도 추출. `__TEACHER__`, `__WEEK__` 치환.
- `web/bg/01~12.jpg` — 월별 배경(1920×440). `web/fonts/` — 에스코어드림 3·4·5.
- `config.json` — 교사명, 날씨 좌표, 구글 캘린더 iCal 주소, 표시 설정.
- 로컬 입력 일정: `~/.lesown_dashboard/local_events.json`.

## 디자인 원칙 (사용자 요구)
- 큰 글씨, 가독성 최우선. 폰트는 에스코어드림 3~5만 사용.
- 배경 사진 위 반투명 유리 패널. 월별 포인트 색은 `THEMES`(index.html).
- 시간표 사이트의 색/디자인은 쓰지 않고 데이터만 가져온다.
- 시험·행사일 칸은 과목을 크게, "교실 · 행사명"을 작게.

## 검증 방법
- 실제 실행은 Windows에서 `run.bat`. 리눅스에서는 pywebview GUI를 못 띄우므로, `window.pywebview.api`를 가짜로 만든 뒤 Playwright(1920×440)로 스크린샷을 찍어 확인했다.
- 브라우저 데모(https://claude.ai/artifact/YRc1FRkmoMkibk9vAHe61B)는 같은 방식의 가짜 API로 돌아간다. 데모 생성 스크립트는 저장소에 없음(세션 임시 파일).

## 메시지(쿨메신저) 패널 — 진행 상태
- 쿨메신저는 공개 API 없음. `notify.py`가 ① Windows 알림(winsdk UserNotificationListener) ② 창 제목 "(N)" 두 경로로 감지. 어느 쪽이 실제로 되는지는 **Windows에서 `tools/coolmsg_probe.py`를 실행**해 결과(`tools/coolmsg_probe_result.txt`)를 보고 확정해야 한다.
- 사용자가 `C:\Users\pc\Desktop\안티그래비티 결과\쿨잡도리` 폴더에 쿨메신저 관련 이전 작업물이 있다고 함 → 받으면 그 방식(로컬 DB·창 구조 등)으로 바꿀 것.
- 허브 패널 표시 여부는 설정(⚙)에서 고르고 `config.json`의 `panels`에 저장. PC 상태는 시계 아래 한 줄(`#pcMini`)로도 항상 보임.

## 아직 확인 못 한 것
- Windows 실기기에서 숨김 창 시간표 추출, 전체화면/모니터 자동 선택, 터치 동작.
- Open-Meteo 7일 예보 실데이터(개발 중 429 제한).
