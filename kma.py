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


def overlay(data, key, lat, lon, now=None, land="11H20000", ta="11H20201"):
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
        short = _merge_daily(data, hrs, days)
    except Exception as e:
        short = set()
        errs.append(f"단기예보 {e}")

    # 중기예보: 4~10일 뒤 (06·18시 발표). 단기예보가 채운 날은 건드리지 않음
    try:
        _merge_mid(data, key, now, short, land, ta)
    except Exception as e:
        errs.append(f"중기예보 {e}")
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
    done = set()
    for day in sorted(by):
        rows = by[day]
        if len(rows) < 6 and day not in days and (day in tl or day != min(by)):   # 몇 시간뿐인 날(오늘 밤·마지막 날) → Open-Meteo·중기예보 값
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
        done.add(day)
    return done


def _wf_code(wf):
    """중기예보 하늘 문구 → WMO 코드."""
    wf = wf or ""
    if "비" in wf and "눈" in wf:
        return 67
    if "소나기" in wf:
        return 80
    if "비" in wf:
        return 61
    if "눈" in wf:
        return 71
    if "흐림" in wf:
        return 3
    if "구름" in wf:
        return 2
    return 0


def _merge_mid(data, key, now, short, land, ta):
    t = now - timedelta(minutes=15)
    if t.hour >= 18:
        base = t.replace(hour=18)
    elif t.hour >= 6:
        base = t.replace(hour=6)
    else:
        base = (t - timedelta(days=1)).replace(hour=18)
    base = base.replace(minute=0, second=0, microsecond=0)

    def get(op, reg):
        r = None
        for n in range(3):
            try:
                r = requests.get(URL.replace("VilageFcstInfoService_2.0", "MidFcstInfoService") + op, params={
                    "serviceKey": key, "pageNo": 1, "numOfRows": 10, "dataType": "JSON",
                    "regId": reg, "tmFc": base.strftime("%Y%m%d%H%M")}, timeout=10)
                break
            except requests.RequestException as e:
                if n == 2:
                    raise RuntimeError(type(e).__name__) from None
        if r.status_code != 200:
            raise RuntimeError("인증키 오류" if r.status_code in (401, 403) else f"HTTP {r.status_code}")
        try:
            j = r.json()["response"]
        except Exception:
            raise RuntimeError("중기예보 미승인 또는 응답 오류") from None
        if j["header"]["resultCode"] != "00":
            raise RuntimeError(j["header"]["resultMsg"])
        return j["body"]["items"]["item"][0]

    lf, tf = get("getMidLandFcst", land), get("getMidTa", ta)
    d = data.setdefault("daily", {})
    tl = d.setdefault("time", [])
    keys = ("weather_code", "temperature_2m_max", "temperature_2m_min", "precipitation_probability_max")
    for k in keys:
        d.setdefault(k, [None] * len(tl))
    for k in range(4, 11):
        day = (base + timedelta(days=k)).strftime("%Y-%m-%d")
        if day in short or tf.get(f"taMax{k}") is None:
            continue
        wfs = [lf.get(f"wf{k}Am"), lf.get(f"wf{k}Pm")] if f"wf{k}Am" in lf else [lf.get(f"wf{k}")]
        pops = [lf.get(f"rnSt{k}Am"), lf.get(f"rnSt{k}Pm")] if f"rnSt{k}Am" in lf else [lf.get(f"rnSt{k}")]
        codes = [_wf_code(w) for w in wfs if w]
        code = max(codes, key=lambda c: (c >= 51, c)) if codes else 0
        if day in tl:
            n = tl.index(day)
        else:
            if tl and day < tl[-1]:
                continue
            tl.append(day)
            for kk in keys:
                d[kk].append(None)
            n = len(tl) - 1
        d["weather_code"][n] = code
        d["temperature_2m_max"][n], d["temperature_2m_min"][n] = float(tf[f"taMax{k}"]), float(tf[f"taMin{k}"])
        d["precipitation_probability_max"][n] = int(max(int(p or 0) for p in pops))


def airkorea(key, station):
    """에어코리아 측정소별 실시간 측정정보 (같은 공공데이터포털 인증키).
    최근 몇 시간 중 값이 있는 첫 줄의 PM10·PM2.5 (점검 중이면 '-' 로 옴)."""
    r = None
    for n in range(3):
        try:
            r = requests.get("https://apis.data.go.kr/B552584/ArpltnInforInqireSvc/getMsrstnAcctoRltmMesureDnsty", params={
                "serviceKey": key, "returnType": "json", "numOfRows": 4, "pageNo": 1,
                "stationName": station, "dataTerm": "DAILY", "ver": "1.3"}, timeout=10)
            break
        except requests.RequestException as e:
            if n == 2:
                raise RuntimeError(type(e).__name__) from None
    if r.status_code != 200:
        raise RuntimeError("인증키 오류" if r.status_code in (401, 403) else f"HTTP {r.status_code}")
    try:
        items = r.json()["response"]["body"]["items"]
    except Exception:
        raise RuntimeError("에어코리아 미승인 또는 응답 오류") from None
    num = lambda v: float(v) if v not in (None, "", "-") else None
    pm10 = next((num(i.get("pm10Value")) for i in items if num(i.get("pm10Value")) is not None), None)
    pm25 = next((num(i.get("pm25Value")) for i in items if num(i.get("pm25Value")) is not None), None)
    if pm10 is None and pm25 is None:
        raise RuntimeError("측정값 없음")
    return {"pm10": pm10, "pm2_5": pm25, "source": "에어코리아", "station": station,
            "time": (items[0].get("dataTime") if items else "")}
