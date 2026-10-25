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
- 행사일 칸은 과목을 크게, "교실 · 행사명"을 작게. 맞교환(swap_active)은 type swap(교실 · 맞교환 표시), 다른 시간으로 옮겨 간 칸(swap_moved_out)은 type moved("수업 이동 ➔ 요일N교시"). 학평·정기고사(isGradeExam) 칸은 사이트처럼 "학평"을 크게, "원래 과목"을 작게(type exam). 추출 규칙을 바꾸면 app.py·tt_worker.py 의 TT_VER 를 올려 캐시를 다시 긁게 한다. /widget 은 교체·보강 내역(getModifications)을 화면 표시 약 3초 뒤 서버에서 받으므로 tt_extract.js 는 그 개수가 0이 아니고 두 번 연속 같을 때까지(최대 20초) 기다린다. 시험일에는 사이트의 ExamProctor.getTeacherDay(iso, 교사)로 감독표(교시·시간·영역·감독 반)를 days[d].proctor 에 넣고, 화면은 평소 교시 대신 감독표 시간으로 그린다(요약 칩 "다음 감독").

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
- 패널은 시계 제외 최대 5개(`MAX_PANELS`) + 바로가기(가는 띠라 개수에 안 셈, `capPanels`·`set_panels`). `launcher.py` 바로가기 띠(쿨메신저·카톡·Claude·한글·엑셀·PPT, 아이콘은 `web/apps/<id>.png`(공식 아이콘 128px)를 프로그램에 넣어 씀. 실행 경로는 PowerShell 한 번으로 바로가기·레지스트리·폴더·스토어 앱을 뒤져 찾음, 그 외 항목은 아이콘 추출 → `~/.lesown_dashboard/icons2`, 설정 "컴퓨터에서 다시 찾기", `config.json > launchers`로 변경), 시계 아래 요약 칩은 `summary` 설정(exam/next/duty/weather/msg/events/school).
- 일과 후(config day_end 기본 16:40, 감독표가 있으면 마지막 시험 끝) `get_timetable(-1)` 은 다음 날(금요일이면 다음 주 월요일)을 today 로, tomorrow=true 로 돌려준다 → 시간표 "N주차 · 내일", 요약 칩 "내일 첫 수업/감독". 목록 깜빡임 방지: fitAll 은 MutationObserver → requestAnimationFrame(그리기 전), events·ttList·schoolList 는 같은 HTML 이면 다시 안 그림.
- 허브 패널 표시 여부는 설정(⚙)에서 고르고 `config.json`의 `panels`에 저장. PC 상태는 시계 아래 한 줄(`#pcMini`)로도 항상 보임.

## exe 빌드
- `.github/workflows/build-exe.yml`: main 푸시마다 windows-latest에서 PyInstaller(onedir) 빌드 → `latest` 릴리스에 `SUBmonitor-win.zip` 첨부. 로컬은 `build_exe.bat`.
- exe 안에서는 `app.py --tt-worker <url> <교사>`로 같은 exe를 시간표 워커로 재실행한다(`sys.frozen`). `config.json`은 exe 옆에서 읽고, `config.local.json`도 exe 옆에 생긴다.

- GPU는 `nvidia-smi`를 `CREATE_NO_WINDOW`로 직접 호출(`read_gpu`). GPUtil은 windowed exe에서 10초마다 콘솔 창이 깜빡여서 제거함. 외부 명령은 항상 창 없이 실행할 것.

- `web/weatherfx.js` — 날씨 연출(화면 맨 앞 z40, pointer-events 없음). Open-Meteo `weather_code`·`is_day`·`wind_speed_10m` → 구름(노이즈 뭉게구름, 위쪽 가장자리에 둥둥)/비(빗줄기+유리창 물방울: 배경 사진을 뒤집어 비추는 렌즈 굴절, 진한 테두리·아래 빛 띠, 일부 길쭉한 방울, 촘촘하게 맺히고 큰 방울만 가끔 흘러내리며 작은 방울을 남김)/뇌우(번개)/눈(3겹+패널 위 쌓임+성에)/안개/맑은 낮(빛내림: 화면 위 바깥 구름 뒤 해에서 가는 빛줄기 26가닥이 부채꼴로 내려옴, 줄기마다 사인 합으로 밝기가 천천히 변하고 부채가 미세하게 기울어짐, 매 프레임 1/4 해상도+blur 후 screen 합성; 해 위치는 7시 왼쪽→17시 오른쪽, 색은 정오 이후 금빛)/맑은 밤(별 반짝임 + 20~60초마다 별똥별: 빛나는 머리·가늘게 사라지는 꼬리, 방향·속도 무작위)/바람(25km/h↑ 낙엽, 40km/h↑ 강풍 줄기). 설정에서 끄기·30초 미리보기(`previewWeatherFx`). 모델 "현재 날씨"가 부슬비를 놓치는 문제 → app.py `_infer_drizzle`: 15분 강수(최근 30분·다음 15분)가 있거나, 구름 60%↑이면서 이번 시간 강수확률 80%↑이면 weather_code 를 51(1mm↑이면 61)로 바꿈(weather_code_model 에 원값).
- `web/dragon.js` — 화면 보호 용. 기본은 `web/dragon.webm`(클링 황금용 영상을 정면 구간만 편집·1.25배속·왕복·초록 키잉한 투명 webm) + 금빛 후광·금가루. exe 옆 dragon.mp4/webm 이 있으면 그걸 씀(초록이면 실시간 키잉). 없으면 캔버스 그림 용.
- 날씨 출처: 설정의 기상청 인증키(공공데이터포털 단기예보, `config.local.json > kma_key`, 저장소에 넣지 말 것 — 저장소 공개)가 있으면 `kma.py`가 Open-Meteo 응답에 실황(기온·습도·바람·강수형태)·초단기예보(하늘·낙뢰)·단기예보(3일 시간별·최저최고)를 WMO 코드로 바꿔 덮어씀. 중기예보(MidFcstInfoService getMidLandFcst `kma_mid_land` 11H20000 부산·울산·경남, getMidTa `kma_mid_ta` 11H20201 부산; 06·18시 발표)로 4~10일 뒤(단기예보가 하루치를 다 채운 날은 제외)를 채움 → 허브는 7일, 상세는 10일. 일출은 Open-Meteo. 미세먼지는 같은 키로 에어코리아 측정소 실시간(`kma.airkorea`, `weather.air_station` 기본 명장동, 값이 "-"면 최근 시간 값) → 실패 시 Open-Meteo. 기상청이면 `_infer_drizzle` 안 씀. 패널 지명 옆 "· 기상청". 12시간 비 알림: `rainAlert(d)`(앞 12시간 중 비 코드 또는 강수확률 60%↑ 첫 시각 → "N시부터 비 P%", 비 오는 중이면 "N시쯤 그침")를 습도·바람 줄 대신 파란 띠로, 요약 날씨 칩도 강조. 시간별 6칸은 2시간씩 묶어 비 오는 쪽 아이콘·높은 확률(30%↑ 숫자).
- 야간 모드(기본 22~08시 검은 화면, 터치 5분), 배경 밝기 4단계(밤 .5·아침 .78·낮 1·저녁 .72, `#bg` filter 만 — 글자색 불변).

## 아직 확인 못 한 것
- Windows 실기기에서 숨김 창 시간표 추출, 전체화면/모니터 자동 선택, 터치 동작.
- Open-Meteo 7일 예보 실데이터(개발 중 429 제한).
- 3D 프린터(`bambu.py`, 패널 id `printer`, 상세 `viewPrinter`): 뱀부랩 같은 네트워크 직접. 설정에 IP·액세스 코드·시리얼(`config.local.json > printer`, 코드는 get_config 로 안 내보냄). 상태는 MQTT 8883 TLS(bblp/액세스 코드, `device/<시리얼>/report`, 접속 시 pushall), 카메라는 P2S·X1 방식 RTSPS 322 `/streaming/live/1` → exe 옆 `ffmpeg.exe`(빌드 때 gyan.dev essentials 받아 넣음)로 초당 2장 JPEG → `get_printer_frame` 이 data URL 로 넘김. 프린터 칸이나 상세가 안 보이면 20초 뒤 ffmpeg 끔. P1·A1(6000번 JPEG)은 아직 안 넣음. 학교 PC는 프린터와 다른 네트워크(Bambu Studio 도 클라우드 경유)라 뱀부 계정 방식 추가: 설정 "로그인" → `printer_cloud_login`(api.bambulab.com 비공식 API: user/login → 메일 인증 코드(loginType verifyCode → sendemail/code) → my/preference uid → iot-service user/bind 기기 목록), 토큰·uid·시리얼만 저장(비밀번호 저장 안 함, get_config 로 토큰 안 내보냄), MQTT us.mqtt.bambulab.com 8883 사용자 u_<uid>/토큰. 카메라 없음(camera:false → 허브는 큰 진행률, 상세는 왼쪽에 큰 %). 토큰은 약 3개월 뒤 만료 → 다시 로그인. 실기기 미확인.
- 프린터 전체 화면 알림(`#pralert`, `checkPrAlert`): 상태가 PAUSE·FAILED 로 바뀌면 주황/빨강 깜빡이는 경고(원인: `stg_cur` → `PR_STAGE` 한국어, 없으면 print_error·HMS), 출력 중에서 FINISH 로 바뀌면 초록 완료 알림. 확인 누를 때까지 유지(경고는 30초마다 삐 소리), 다시 출력 시작하면 자동 닫힘. 확인한 알림은 localStorage `prAck`(상태|파일|층)로 다시 안 띄움. 야간 검은 화면(z80)보다 위(z90), 떠 있는 동안 용 화면 보호 안 나옴(`window.PR_ALERT`).
