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
- 행사일 칸은 과목을 크게, "교실 · 행사명"을 작게. 맞교환(swap_active)은 type swap(교실 · 맞교환 표시), 다른 시간으로 옮겨 간 칸(swap_moved_out)은 type moved("수업 이동 ➔ 요일N교시"). 학평·정기고사(isGradeExam) 칸은 사이트처럼 "학평"을 크게, "원래 과목"을 작게(type exam). 추출 규칙을 바꾸면 app.py·tt_worker.py 의 TT_VER 를 올려 캐시를 다시 긁게 한다. /widget 은 교체·보강 내역(getModifications)을 화면 표시 약 3초 뒤 서버에서 받으므로 tt_extract.js 는 그 개수가 0이 아니고 두 번 연속 같을 때까지(최대 20초) 기다린다.

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
- 패널은 시계 제외 최대 5개(`MAX_PANELS`). `launcher.py` 바로가기 띠(쿨메신저·카톡·Claude·한글·엑셀·PPT, 아이콘은 `web/apps/<id>.png`(공식 아이콘 128px)를 프로그램에 넣어 씀. 실행 경로는 PowerShell 한 번으로 바로가기·레지스트리·폴더·스토어 앱을 뒤져 찾음, 그 외 항목은 아이콘 추출 → `~/.lesown_dashboard/icons2`, 설정 "컴퓨터에서 다시 찾기", `config.json > launchers`로 변경), 시계 아래 요약 칩은 `summary` 설정(exam/next/duty/weather/msg/events/school).
- 허브 패널 표시 여부는 설정(⚙)에서 고르고 `config.json`의 `panels`에 저장. PC 상태는 시계 아래 한 줄(`#pcMini`)로도 항상 보임.

## exe 빌드
- `.github/workflows/build-exe.yml`: main 푸시마다 windows-latest에서 PyInstaller(onedir) 빌드 → `latest` 릴리스에 `SUBmonitor-win.zip` 첨부. 로컬은 `build_exe.bat`.
- exe 안에서는 `app.py --tt-worker <url> <교사>`로 같은 exe를 시간표 워커로 재실행한다(`sys.frozen`). `config.json`은 exe 옆에서 읽고, `config.local.json`도 exe 옆에 생긴다.

- GPU는 `nvidia-smi`를 `CREATE_NO_WINDOW`로 직접 호출(`read_gpu`). GPUtil은 windowed exe에서 10초마다 콘솔 창이 깜빡여서 제거함. 외부 명령은 항상 창 없이 실행할 것.

- `web/weatherfx.js` — 날씨 연출(화면 맨 앞 z40, pointer-events 없음). Open-Meteo `weather_code`·`is_day`·`wind_speed_10m` → 구름(노이즈 뭉게구름, 위쪽 가장자리에 둥둥)/비(빗줄기+액정 물방울)/뇌우(번개)/눈(3겹+패널 위 쌓임+성에)/안개/맑은 낮(햇살)/맑은 밤(별)/바람(25km/h↑ 낙엽, 40km/h↑ 강풍 줄기). 설정에서 끄기·30초 미리보기(`previewWeatherFx`).
- `web/dragon.js` — 화면 보호 용. 기본은 `web/dragon.webm`(클링 황금용 영상을 정면 구간만 편집·1.25배속·왕복·초록 키잉한 투명 webm) + 금빛 후광·금가루. exe 옆 dragon.mp4/webm 이 있으면 그걸 씀(초록이면 실시간 키잉). 없으면 캔버스 그림 용.
- 야간 모드(기본 22~08시 검은 화면, 터치 5분), 배경 밝기 4단계(밤 .5·아침 .78·낮 1·저녁 .72, `#bg` filter 만 — 글자색 불변).

## 아직 확인 못 한 것
- Windows 실기기에서 숨김 창 시간표 추출, 전체화면/모니터 자동 선택, 터치 동작.
- Open-Meteo 7일 예보 실데이터(개발 중 429 제한).
