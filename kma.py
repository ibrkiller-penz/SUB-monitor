"""기상청 단기예보(공공데이터포털 VilageFcstInfoService_2.0) → Open-Meteo 응답 형태에 덮어쓰기.

- 초단기실황(getUltraSrtNcst): 지금 기온·습도·풍속·강수형태·1시간 강수량 (관측 기반)
- 초단기예보(getUltraSrtFcst): 하늘상태·낙뢰 (실황엔 하늘상태가 없음)
- 단기예보(getVilageFcst): 3일치 시간별 기온·강수확률·하늘·강수형태, 일 최저·최고
화면 코드는 WMO 날씨 코드를 쓰므로 기상청 값을 WMO 코드로 바꿔 넣는다.
주간(4일 이후)·일출·일몰·미세먼지는 Open-Meteo 값을 그대로 둔다.
"""
import math
from datetime import datetime, timedelta, timezone

import requests

URL = "https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/"


def grid(lat, lon):
    """위경도 → 기상청 격자(nx, ny). 기상청 Lambert 정각원추 변환식."""
    RE, GRID, SLAT1, SLAT2, OLON, OLAT, XO, YO = 6371.00877, 5.0, 30.0, 60.0, 126.0, 38.0, 43, 136
    d = math.pi / 180.0
    re = RE / GRID
    s1, s2, olon, olat = SLAT1 * d, SLAT2 * d, OLON * d, OLAT * d
    sn = math.log(math.cos(s1) / math.cos(s2)) / math.log(math.tan(math.pi * .25 + s2 * .5) / math.tan(math.pi * .25 + s1 * .5))
    sf = math.tan(math.pi * .25 + s1 * .5) ** sn * math.cos(s1) / sn
    ro = re * sf / math.tan(math.pi * .25 + olat * .5) ** sn
    ra = re * sf / math.tan(math.pi * .25 + lat * d * .5) ** sn
    th = lon * d - olon
    th = (th + 2 * math.pi) if th < -math.pi else (th - 2 * math.pi) if th > math.pi else th
    th *= sn
    return int(ra * math.sin(th) + XO + .5), int(ro - ra * math.cos(th) + YO + .5)


def kst_now():
    return datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(hours=9)


def _get(key, op, base, nx, ny, rows):
    for n in range(2):   # 공공데이터포털은 가끔 연결을 끊는다 → 한 번 더
        try:
            r = requests.get(URL + op, params={
                "serviceKey": key, "pageNo": 1, "numOfRows": rows, "dataType": "JSON",
                "base_date": base.strftime("%Y%m%d"), "base_time": base.strftime("%H%M"), "nx": nx, "ny": ny}, timeout=10)
            break
        except requests.RequestException as e:
            if n:
                raise RuntimeError(type(e).__name__) from None
    if r.status_code != 200:   # 오류 문구에 인증키가 든 주소가 섞이지 않게
        raise RuntimeError("인증키 오류" if r.status_code in (401, 403) else f"HTTP {r.status_code}")
    try:
        j = r.json()["response"]
    except Exception:
        raise RuntimeError(r.text[:200])   # 인증키 오류는 XML 로 온다
    if j["header"]["resultCode"] != "00":
        raise RuntimeError(j["header"]["resultMsg"])
    return j["body"]["items"]["item"]


def _code(pty, sky=1, rain=0.0, lgt=0):
    """기상청 강수형태(PTY)·하늘상태(SKY) → WMO 코드."""
    pty, sky = int(pty or 0), int(sky or 1)
    if pty:
        if lgt:
            return 95
        return {1: 63 if rain >= 3 else 61, 2: 67, 3: 71, 4: 80, 5: 51, 6: 51, 7: 71}.get(pty, 61)
    return {1: 0, 3: 2, 4: 3}.get(sky, 1)


def _num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0   # "강수없음" 등


def check(key, lat, lon):
    """설정 저장 때 인증키가 되는지 확인."""
    nx, ny = grid(lat, lon)
    base = (kst_now() - timedelta(minutes=45)).replace(minute=0, second=0, microsecond=0)
    _get(key, "getUltraSrtNcst", base, nx, ny, 10)
    return True


def overlay(data, key, lat, lon, now=None):
    """data(Open-Meteo 응답, 실패 시 빈 dict)에 기상청 값을 덮어쓴다. 실패한 단계는 건너뛴다."""
    now = now or kst_now()
    nx, ny = grid(lat, lon)
    c = data.setdefault("current", {})
    c.setdefault("time", now.strftime("%Y-%m-%dT%H:00"))
    c.setdefault("is_day", 1 if 6 <= now.hour < 18 else 0)
    errs = []

    # 초단기예보: 다음 1시간의 하늘상태·낙뢰 (매시 30분 발표, 45분쯤부터 조회 가능)
    sky, lgt = 1, 0
    try:
        base = (now - timedelta(minutes=45)).replace(second=0, microsecond=0)
        base = base.replace(minute=30)
        items = _get(key, "getUltraSrtFcst", base, nx, ny, 60)
        first = min(i["fcstDate"] + i["fcstTime"] for i in items)
        for i in items:
            if i["fcstDate"] + i["fcstTime"] == first:
                if i["category"] == "SKY":
                    sky = int(i["fcstValue"])
                elif i["category"] == "LGT":
                    lgt = int(_num(i["fcstValue"]))
    except Exception as e:
        errs.append(f"초단기예보 {e}")

    # 초단기실황: 매시 정각 관측, 40분쯤부터 조회 가능
    try:
        base = (now - timedelta(minutes=45)).replace(minute=0, second=0, microsecond=0)
        v = {i["category"]: i["obsrValue"] for i in _get(key, "getUltraSrtNcst", base, nx, ny, 10)}
        t, om_t = _num(v.get("T1H")), c.get("temperature_2m")
        if om_t is not None and c.get("apparent_temperature") is not None:
            c["apparent_temperature"] = c["apparent_temperature"] + (t - om_t)
        else:
            c["apparent_temperature"] = t
        rain = _num(v.get("RN1"))
        c.update(temperature_2m=t, relative_humidity_2m=int(_num(v.get("REH"))),
                 wind_speed_10m=_num(v.get("WSD")) * 3.6, precipitation=rain)
        if "weather_code" in c:
            c["weather_code_model"] = c["weather_code"]
        c["weather_code"] = _code(v.get("PTY"), sky, rain, lgt)
        c.pop("inferred", None)
        data["source"] = "기상청"
    except Exception as e:
        errs.append(f"실황 {e}")

    # 단기예보: 02·05·08·11·14·17·20·23시 발표(10분 뒤 조회). 3일치 1000줄 정도
    try:
        t0 = now - timedelta(minutes=15)
        h = max(x for x in (-1, 2, 5, 8, 11, 14, 17, 20, 23) if x <= t0.hour)
        base = (t0.replace(hour=23) - timedelta(days=1)) if h < 0 else t0.replace(hour=h)
        base = base.replace(minute=0, second=0, microsecond=0)
        items = _get(key, "getVilageFcst", base, nx, ny, 1200)
        hrs, days = {}, {}
        for i in items:
            ts = f'{i["fcstDate"][:4]}-{i["fcstDate"][4:6]}-{i["fcstDate"][6:]}'
            hrs.setdefault(f'{ts}T{i["fcstTime"][:2]}:00', {})[i["category"]] = i["fcstValue"]
            if i["category"] in ("TMN", "TMX"):
                days.setdefault(ts, {})[i["category"]] = _num(i["fcstValue"])
        _merge_hourly(data, hrs)
        _merge_daily(data, hrs, days)
    except Exception as e:
        errs.append(f"단기예보 {e}")
    if errs:
        data["kma_error"] = "; ".join(errs)
    return data


def _merge_hourly(data, hrs):
    h = data.setdefault("hourly", {})
    tl = h.setdefault("time", [])
    for k in ("temperature_2m", "weather_code", "precipitation_probability"):
        h.setdefault(k, [None] * len(tl))
    idx = {t: n for n, t in enumerate(tl)}
    for t in sorted(hrs):
        v = hrs[t]
        if "TMP" not in v:
            continue
        n = idx.get(t)
        if n is None:
            if tl and t < tl[-1]:
                continue
            tl.append(t)
            for k in ("temperature_2m", "weather_code", "precipitation_probability"):
                h[k].append(None)
            n = len(tl) - 1
        h["temperature_2m"][n] = _num(v["TMP"])
        h["precipitation_probability"][n] = int(_num(v.get("POP")))
        h["weather_code"][n] = _code(v.get("PTY"), v.get("SKY"), _num(v.get("PCP")))


def _merge_daily(data, hrs, days):
    by = {}
    for t, v in hrs.items():
        if "TMP" in v:
            by.setdefault(t[:10], []).append((t, v))
    d = data.setdefault("daily", {})
    tl = d.setdefault("time", [])
    keys = ("weather_code", "temperature_2m_max", "temperature_2m_min", "precipitation_probability_max")
    for k in keys:
        d.setdefault(k, [None] * len(tl))
    for day in sorted(by):
        rows = by[day]
        if len(rows) < 6 and day not in days and day in tl:   # 오늘 밤 몇 시간만 남음 → Open-Meteo 값 유지
            continue
        temps = [_num(v["TMP"]) for _, v in rows]
        dd = days.get(day, {})
        hi, lo = dd.get("TMX", max(temps)), dd.get("TMN", min(temps))
        if day in tl and dd.get("TMX") is None:   # 지난 시간은 빠져 있으니 Open-Meteo 값과 비교
            n = tl.index(day)
            hi = max(hi, d["temperature_2m_max"][n] or hi)
            lo = min(lo, d["temperature_2m_min"][n] or lo)
        day_rows = [v for t, v in rows if 9 <= int(t[11:13]) <= 18] or [v for _, v in rows]
        wet = [v for v in day_rows if int(_num(v.get("PTY")))]
        if wet:
            code = max(_code(v.get("PTY"), v.get("SKY"), _num(v.get("PCP"))) for v in wet)
        else:
            skies = [int(_num(v.get("SKY")) or 1) for v in day_rows]
            code = _code(0, max(set(skies), key=skies.count))
        pop = max(int(_num(v.get("POP"))) for _, v in rows)
        if day in tl:
            n = tl.index(day)
        else:
            if tl and day < tl[-1]:
                continue
            tl.append(day)
            for k in keys:
                d[k].append(None)
            n = len(tl) - 1
        d["weather_code"][n], d["temperature_2m_max"][n], d["temperature_2m_min"][n] = code, hi, lo
        d["precipitation_probability_max"][n] = pop
