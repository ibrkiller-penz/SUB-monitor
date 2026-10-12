# 쿨메신저 스마트 예약 & 주소록 매니저 (참고용 사본)

바탕화면 `안티그래비티 결과\쿨메신저_예약매니저` 폴더(PyInstaller 배포본)에서
**소스·설정·문서 파일만** 추려 복사한 참고 자료입니다.
SUB-monitor 본체 코드가 아니라, UI/기능 참고용 ref 입니다.

## 구성

| 경로 | 설명 |
| --- | --- |
| `_internal/index.html` | 앱 UI 전체 (pywebview가 띄우는 단일 HTML, Tailwind CDN 사용). 사실상 이 앱의 프론트엔드 소스 |
| `ai_config.json` | AI 연동 설정 (vendor / api_key — 키는 비어 있음) |
| `ai_tasks_cache.json` | AI가 뽑아낸 할 일 캐시 (today/week/future/general) |
| `ai_tasks_saved.json` | 사용자가 저장한 할 일 |
| `schedules.json` | 예약 전송 일정 목록 |
| `쿨메신저_당번예약_샘플양식.xlsx` | 당번 예약 일괄 등록용 샘플 엑셀 양식 |

## 제외한 것

원본 폴더는 PyInstaller `dist` 결과물이라 대부분이 바이너리입니다. 아래는 복사하지 않았습니다.

- `쿨메신저_예약매니저.exe`, `쿨메신저_예약매니저.zip` (배포 패키지 전체 사본)
- `_internal/` 안의 `.dll` / `.pyd` / `.jar` / `base_library.zip` 등 런타임 바이너리
- numpy · pandas · cryptography · pythonnet · tzdata · pywebview 등 번들된 서드파티 패키지와 그 `dist-info` 라이선스·메타데이터
- 아이콘 이미지 (`app_icon.ico/png`, `favicon.ico/png`)

> 파이썬 백엔드(`.py`) 소스는 exe 안에 컴파일되어 들어가 있어 이 폴더에는 존재하지 않습니다.
> 백엔드 API 목록은 `_internal/index.html` 안의 `fetch('/api/...')` 호출로 역추적할 수 있습니다.
