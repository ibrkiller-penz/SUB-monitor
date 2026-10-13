# SUB모니터 — LESOWN 11.3" (1920×440) 서브모니터 대시보드

Windows PC 옆에 두는 가로 스트립 디스플레이용 Python(pywebview) 앱. 사용자는 부산 동래고 교사(임병율, 1-4 담임).

## 구조
- `app.py` — pywebview 창 + JS API (`get_timetable(week)`, `get_weather`, `get_events`, `add_event`, `delete_event`, `get_system`, `get_processes`, `get_messages`, `set_teacher`, `set_panels`, `reload_timetable`). 시간표 사이트(https://teacher-2026.vercel.app/widget)는 **화면 밖(x=-5000) 최소화 창**으로 띄우고, 로드 시 `TT_INJECT`+`web/tt_extract.js`를 주입 → 그 창의 JS가 3초마다 `pywebview.api.push(JSON)`로 데이터를 **밀어넣는다**(`TimetableBridge`). 대시보드는 캐시만 읽으므로 블로킹이 없다. (숨김 창 + evaluate_js 당겨오기는 WebView2에서 로드가 안 돼 '응답 없음'을 냈음 — 다시 쓰지 말 것.)
- 보조모니터(1920×440)를 못 찾으면 일반 창(테두리 있음, 전체화면 아님)으로 뜬다.
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
- `ref/쿨메신저_예약매니저/`(참고 사본) 분석 결과: 그 앱은 **쿨메신저 로컬 DB(UDB)를 직접 읽는다** — 수신 쪽지 `tbl_recv`(sender/date/title/content, 본문 `{COMP}` 압축), 예약 `tbl_send`. 백엔드 .py는 exe에 컴파일돼 있어 파일 경로·컬럼명은 미확인.
- 그래서 `notify.py`에 0순위로 `UdbReader`(SQLite, 컬럼명 자동 추정, `{COMP}` zlib/base64 복원, 안읽음 컬럼 있으면 필터) 추가. `config.json > udb`(path/table/columns/unread_only)로 맞춘다. 가짜 DB로 단위 검증만 함.
- **확정됨(직장 PC 실측, 커밋 b3fdf0c)**: `%LOCALAPPDATA%/CoolMessenger/Memo/<로그인명>.udb` (SQLite, WAL). `tbl_recv` 컬럼: MessageKey, Sender, Title, MessageText(평문), MessageBody({COMP} base64→zlib→UTF-16LE HTML), ReceiveDate, IsUnRead(1=안읽음), DeletedDate 등. `config.json > udb` 채워져 있고 실제 읽기 확인됨. 패널은 최근 쪽지를 보여주고 배지는 IsUnRead=1 개수(현재 수신함은 전부 읽음 상태라 0).
- 허브 패널 표시 여부는 설정(⚙)에서 고르고 `config.json`의 `panels`에 저장. PC 상태는 시계 아래 한 줄(`#pcMini`)로도 항상 보임.

## 아직 확인 못 한 것
- Windows 실기기에서 숨김 창 시간표 추출, 전체화면/모니터 자동 선택, 터치 동작.
- Open-Meteo 7일 예보 실데이터(개발 중 429 제한).
