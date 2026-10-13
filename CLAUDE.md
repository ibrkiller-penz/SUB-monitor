# SUB모니터 — LESOWN 11.3" (1920×440) 서브모니터 대시보드

Windows PC 옆에 두는 가로 스트립 디스플레이용 Python(pywebview) 앱. 사용자는 부산 동래고 교사(임병율, 1-4 담임).

## 구조
- `app.py` — pywebview 창 + JS API (`get_timetable(week)`, `get_weather`, `get_events`, `add_event`, `delete_event`, `get_system`, `get_processes`, `get_messages`, `set_teacher`, `set_panels`, `reload_timetable`). 시간표는 **일회성 프로세스 `tt_worker.py`**가 맡는다: 사이트(https://teacher-2026.vercel.app/widget)를 화면 밖 최소화 창으로 띄우고 `web/tt_extract.js`를 `__WEEK__=-2`(전 주차)로 주입해 교사 한 명의 전 주차를 `~/.lesown_dashboard/tt_cache/<교사>.json`(미설정 `_none.json`)에 저장하고 **창을 바로 닫는다**. `app.py`는 캐시만 읽고(`get_timetable(week)`가 주차를 골라 예전 응답 형태로 돌려줌), `_tt_refresher` 스레드가 30초마다 캐시가 오래됐으면(`timetable_refresh_min` 기본 30분, 날짜 바뀜, 교사 다름) 워커를 다시 띄운다. 실패 시 2·4·8…30분 백오프(`_tt_reap`). 교사별 캐시라 교사를 바꿨다 돌아오면 안 긁는다. 캐시 날짜가 오늘이 아니면 현재 주차·요일은 `_cur_week`가 `iso` 날짜로 다시 계산. 로그: `~/.lesown_dashboard/app.log`, `tt_worker.log` (0.5초 넘는 API 호출도 기록). `app.py --debug`로 devtools.
  - 이력: 같은 프로세스 안의 숨김 창(evaluate_js 당겨오기)은 WebView2에서 로드가 안 돼 '응답 없음', 화면 밖 두 번째 창도 모든 API가 멈추는 증상 → 프로세스 분리. 상주 창이 작업표시줄에 계속 떠 있는 게 싫다는 요구 → 긁고 바로 닫는 캐시 방식으로 변경.
- 보조모니터(1920×440)를 못 찾으면 일반 창(테두리 있음, 전체화면 아님)으로 뜬다.
- `web/index.html` — 허브 화면(시계·날씨·시간표·일정·PC). CSS/JS 인라인. 글자 넘침은 `fitAll()`이 자동 축소/숨김.
- `web/detail.css`, `web/detail.js` — 패널 클릭 시 전체화면 상세 5종(오늘/날씨/시간표/일정/PC). `← 허브로`, Esc, 90초 무조작 시 복귀.
- `web/tt_extract.js` — 사이트 엔진(`TimetableEngine`)에서 주차별 시간표·공강지도·급식지도 추출. `__TEACHER__`, `__WEEK__`(0-based / -1 오늘 주차 / -2 전 주차 → `weeks` 배열) 치환.
- `web/bg/01~12.jpg` — 월별 배경(1920×440). `web/fonts/` — 에스코어드림 3·4·5.
- `config.json` — 공용 기본값(날씨 좌표, 시간표 URL, udb 스키마 등). 개인 설정(teacher_name, panels, ical_urls, udb)은 `config.local.json`(gitignore)에 저장되고 로드 시 덮어쓴다 → 모든 교사가 같은 저장소로 쓸 수 있다.
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
- 화면은 1920×440(가로) 또는 440×1920(세로) **고정 무대(#stage)** 를 창 크기에 맞춰 `transform: scale`로 축소·확대한다(DPI 배율·일반 창 모두 대응). 방향은 설정(⚙)에서 고르고 `orientation`으로 저장, `body.portrait`로 세로 레이아웃.
- 패널 폭에 따라 `@container` 쿼리로 글자·항목을 줄인다(스타일 끝에 있어야 기본 규칙을 덮어씀).
- 학교일정: `school_schedule_url`(Apps Script 웹앱)의 페이지 안 `init-data` JSON(역슬래시-x 이스케이프)을 `_parse_school_page`로 풀어 `schedules`(부서 일정)·`academic`(학사)을 이벤트로 변환, `~/.lesown_dashboard/school_schedule.json`에 30분 캐시. 이벤트의 `source`: local / ical / school / academic, `tag`: 부서 또는 학사 유형.
- 패널은 시계 제외 최대 4개(`MAX_PANELS`), 시계 아래 요약 칩은 `summary` 설정(exam/next/duty/weather/msg/events/school).
- 허브 패널 표시 여부는 설정(⚙)에서 고르고 `config.json`의 `panels`에 저장. PC 상태는 시계 아래 한 줄(`#pcMini`)로도 항상 보임.

## exe 빌드
- `.github/workflows/build-exe.yml`: main 푸시마다 windows-latest에서 PyInstaller(onedir) 빌드 → `latest` 릴리스에 `LesownDashboard-win.zip` 첨부. 로컬은 `build_exe.bat`.
- exe 안에서는 `app.py --tt-worker <url> <교사>`로 같은 exe를 시간표 워커로 재실행한다(`sys.frozen`). `config.json`은 exe 옆에서 읽고, `config.local.json`도 exe 옆에 생긴다.

- GPU는 `nvidia-smi`를 `CREATE_NO_WINDOW`로 직접 호출(`read_gpu`). GPUtil은 windowed exe에서 10초마다 콘솔 창이 깜빡여서 제거함. 외부 명령은 항상 창 없이 실행할 것.

## 아직 확인 못 한 것
- Windows 실기기에서 숨김 창 시간표 추출, 전체화면/모니터 자동 선택, 터치 동작.
- Open-Meteo 7일 예보 실데이터(개발 중 429 제한).
