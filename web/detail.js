/* ===== 허브 ↔ 상세 화면 =====
 * 허브의 패널을 터치하면 전체화면 상세로 전환, ← 버튼 / Esc / 90초 무조작 시 허브로 복귀.
 */
let detailKind = null, idleT = null, calSel = null, procs = [];
const DETAIL_IDLE = 90 * 1000;
const PANEL_KIND = { clock: 'today', weather: 'weather', tt: 'timetable', eventsPanel: 'events', school: 'school', msg: 'messages', pc: 'pc' };

function openDetail(kind) {
  detailKind = kind; calSel = null; document.body.classList.add('detail'); $('detail').classList.add('on'); renderDetail(); bumpIdle();
  if (kind === 'pc' && window.pywebview) pywebview.api.get_processes().then(p => { procs = p || []; renderDetail(); });
}
function closeDetail() { detailKind = null; document.body.classList.remove('detail'); $('detail').classList.remove('on'); clearTimeout(idleT); }
function bumpIdle() { clearTimeout(idleT); if (detailKind) idleT = setTimeout(closeDetail, DETAIL_IDLE); }
const VIEW_DEPS = { today: ['timetable', 'events'], weather: ['weather'], timetable: ['timetable'], events: ['events'], school: ['events'], pc: ['system'], messages: ['messages'] };
let schoolDept = '';
function onDataChange(kind) { if (detailKind && (!kind || VIEW_DEPS[detailKind].includes(kind))) renderDetail(); }
let evDraft = { title: '', date: '', time: '', all_day: false }, evMsg = '';

function renderDetail() {
  const views = { today: viewToday, weather: viewWeather, timetable: viewTimetable, events: viewEvents, school: viewSchool, pc: viewPC, messages: viewMessages };
  const v = views[detailKind]; if (!v) return;
  const { title, html } = v();
  $('dtitle').textContent = title; $('dbody').innerHTML = html;
  const d = new Date(); $('dclock').textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function tickDetail(d) {
  if (!detailKind) return;
  const c = $('dclock'); if (c) c.textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  const bt = document.querySelector('#detail .bt'), bs = document.querySelector('#detail .bs');
  if (bt) bt.innerHTML = `${pad(d.getHours() % 12 || 12)}<span>:</span>${pad(d.getMinutes())}`;
  if (bs) bs.textContent = `${d.getHours() < 12 ? '오전' : '오후'} · ${pad(d.getSeconds())}초`;
  if (detailKind === 'today' && d.getSeconds() === 0) renderDetail();
}
const nowMinutes = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };

/* ---------- 오늘: 큰 시계 + 하루 타임라인 ---------- */
function viewToday() {
  const d = new Date(), nowMin = nowMinutes();
  const a = toMin('08:00'), b = toMin('17:00');
  const px = m => ((m - a) / (b - a) * 100).toFixed(2) + '%';
  const wpx = (s, e) => ((e - s) / (b - a) * 100).toFixed(2) + '%';
  let tl = '<div class="tl">';
  for (let hh = 8; hh <= 17; hh++) tl += `<span class="tlh" style="left:${px(hh * 60)}">${hh}시</span>`;
  const isSchoolDay = tt && !tt.noTimetable && WD[d.getDay()] === tt.today;
  if (isSchoolDay) {
    const data = tt.days[tt.today];
    PERIODS.forEach(([p, s, e]) => {
      let label, cls;
      if (p === '점심') { label = data.lunchDuty ? '🍱 급식지도' : '점심'; cls = 'lunch' + (data.lunchDuty ? ' dutyon' : ''); }
      else {
        const c = data.periods[p - 1] || { type: 'free', subject: '공강' };
        const jido = data.jido.find(j => Number(j.period) === p);
        cls = jido && c.type === 'free' ? 'duty' : c.type;
        label = jido && c.type === 'free' ? '공강지도' : shortName(c.subject);
      }
      tl += `<div class="tlb ${cls}" style="left:${px(toMin(s))};width:${wpx(toMin(s), toMin(e))}"><small>${p === '점심' ? '점심' : p + '교시'}</small><b>${esc(label)}</b></div>`;
    });
  }
  const today0 = new Date(d.toDateString());
  eventsCache.filter(e => !e.all_day && new Date(e.start).toDateString() === d.toDateString()).forEach(e => {
    const s = new Date(e.start), en = new Date(e.end || e.start);
    const sm = s.getHours() * 60 + s.getMinutes(), em = Math.max(sm + 30, en.getHours() * 60 + en.getMinutes());
    if (em < a || sm > b) return;
    tl += `<div class="tle" style="left:${px(Math.max(a, sm))};width:${wpx(Math.max(a, sm), Math.min(b, em))}"><small>${pad(s.getHours())}:${pad(s.getMinutes())}</small>${esc(e.title)}</div>`;
  });
  if (nowMin >= a && nowMin <= b) tl += `<div class="tln" style="left:${px(nowMin)}"></div>`;
  tl += '</div>';

  const todays = eventsCache.filter(e => { const s = new Date(e.start), en = e.end ? new Date(e.end) : s; return s < new Date(today0.getTime() + 864e5) && en > today0; });
  const list = todays.length ? todays.map(e => { const s = new Date(e.start), en = e.end ? new Date(e.end) : s;
    return `<div class="dli ${!e.all_day && d >= s && d < en ? 'now' : ''}"><span class="t">${e.all_day ? '종일' : pad(s.getHours()) + ':' + pad(s.getMinutes())}</span><span class="n">${esc(e.title)}</span>${e.tag ? `<small class="tag">${esc(e.tag)}</small>` : ''}</div>`; }).join('')
    : '<div class="dli muted">오늘 일정 없음</div>';
  const title = tt && tt.days[tt.today].title && isSchoolDay ? `<div class="tchip hl" style="margin-top:8px">📌 ${esc(tt.days[tt.today].title)}</div>` : '';
  const big = `<div class="dcard tclock"><div class="bt">${pad(d.getHours() % 12 || 12)}<span>:</span>${pad(d.getMinutes())}</div>
    <div class="bs">${d.getHours() < 12 ? '오전' : '오후'} · ${pad(d.getSeconds())}초</div>
    <div class="bd">${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 ${WD[d.getDay()]}요일</div>${title}</div>`;
  return { title: '오늘', html: `<div class="dgrid today">${big}<div class="dcol"><div class="dcard"><div class="dc-t">오늘의 흐름<b>${isSchoolDay ? `${tt.teacher} · ${tt.week}주차` : (d.getDay() % 6 === 0 ? '주말' : '시간표 갱신 대기')}</b></div>${tl}</div>
    <div class="dcard"><div class="dc-t">오늘 일정<b>${todays.length}건</b></div><div class="dlist">${list}</div></div></div></div>` };
}

/* ---------- 날씨 상세 ---------- */
function viewWeather() {
  const d = weatherData;
  if (!d || d.error) return { title: '날씨', html: '<div class="dcard"><div class="muted">날씨 정보를 불러오지 못했습니다.</div></div>' };
  const c = d.current, [ic, desc] = wmo(c.weather_code, c.is_day), air = d.air || {};
  const nowH = new Date(); nowH.setMinutes(0, 0, 0);
  const i0 = Math.max(0, d.hourly.time.findIndex(t => new Date(t) >= nowH)), N = Math.min(24, d.hourly.time.length - i0);
  const T = d.hourly.temperature_2m.slice(i0, i0 + N), P = d.hourly.precipitation_probability.slice(i0, i0 + N);
  const C = d.hourly.weather_code.slice(i0, i0 + N), H = d.hourly.time.slice(i0, i0 + N).map(t => new Date(t).getHours());
  const W = 1000, Hh = 300, L = 30, R = 30, top = 60, bot = 210;
  const tmin = Math.min(...T) - 2, tmax = Math.max(...T) + 2;
  const x = i => L + i * (W - L - R) / (N - 1), y = v => top + (tmax - v) / (tmax - tmin) * (bot - top);
  const pts = T.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  let svg = `<svg viewBox="0 0 ${W} ${Hh}" class="wchart" preserveAspectRatio="none">`;
  svg += `<polygon points="${x(0)},${bot} ${pts} ${x(N - 1)},${bot}" fill="var(--accent)" opacity=".15"/>`;
  svg += `<polyline points="${pts}" fill="none" stroke="var(--accent)" stroke-width="3" vector-effect="non-scaling-stroke"/>`;
  P.forEach((p, i) => { const bh = (p || 0) / 100 * 50; svg += `<rect x="${x(i) - 9}" y="${270 - bh}" width="18" height="${bh}" rx="3" fill="#8ac4ff" opacity=".8"/>`; });
  T.forEach((v, i) => {
    if (i % 3) return;
    svg += `<text x="${x(i)}" y="${y(v) - 12}" font-size="20" text-anchor="middle" fill="#fff" font-weight="600">${Math.round(v)}°</text>`;
    svg += `<text x="${x(i)}" y="${Hh - 6}" font-size="17" text-anchor="middle" fill="rgba(255,255,255,.65)">${H[i]}시</text>`;
    svg += `<text x="${x(i)}" y="34" font-size="26" text-anchor="middle">${wmo(C[i], H[i] >= 6 && H[i] < 19)[0]}</text>`;
    if (P[i] >= 20) svg += `<text x="${x(i)}" y="${262 - P[i] / 100 * 50}" font-size="14" text-anchor="middle" fill="#bfe0ff">${P[i]}%</text>`;
  });
  svg += '</svg>';
  const left = `<div class="dcard wnowd"><div class="wicon big">${ic}</div><div class="wtemp big">${Math.round(c.temperature_2m)}°</div>
    <div class="wdesc big"><b>${desc}</b> · 체감 ${Math.round(c.apparent_temperature)}°</div>${window.rainAlert && rainAlert(d) ? `<div class="wrain">☔ ${rainAlert(d)}</div>` : ""}
    <div class="kv"><span>습도</span><b>${c.relative_humidity_2m}%</b></div><div class="kv"><span>바람</span><b>${(c.wind_speed_10m / 3.6).toFixed(1)} m/s</b></div>
    <div class="kv"><span>미세먼지 PM10</span><b>${air.pm10 ?? '-'} ㎍/㎥ · ${grade(air.pm10, [30, 80, 150])}</b></div>
    <div class="kv"><span>초미세 PM2.5</span><b>${air.pm2_5 ?? '-'} ㎍/㎥ · ${grade(air.pm2_5, [15, 35, 75])}</b></div>
    ${d.daily.sunrise ? `<div class="kv"><span>일출 / 일몰</span><b>${d.daily.sunrise[0].slice(11)} / ${d.daily.sunset[0].slice(11)}</b></div>` : ''}</div>`;
  const ND = Math.min(10, d.daily.time.length);   // 기상청 중기예보면 10일
  const allMin = Math.min(...d.daily.temperature_2m_min.slice(0, ND)), allMax = Math.max(...d.daily.temperature_2m_max.slice(0, ND)), span = Math.max(1, allMax - allMin);
  const right = `<div class="dcard${ND > 7 ? ' dense' : ''}"><div class="dc-t">${ND > 7 ? ND + '일 예보' : '주간 예보'}</div>` + d.daily.time.slice(0, ND).map((t, i) => {
    const dt = new Date(t), lo = d.daily.temperature_2m_min[i], hi = d.daily.temperature_2m_max[i];
    return `<div class="drow"><span class="dn ${dt.getDay() === 0 ? 'sun' : dt.getDay() === 6 ? 'sat' : ''}">${i === 0 ? '오늘' : ND > 7 ? `${dt.getDate()} ${WD[dt.getDay()]}` : WD[dt.getDay()]}</span><span class="di">${wmo(d.daily.weather_code[i])[0]}</span>
      <span class="pp">☔ ${d.daily.precipitation_probability_max[i] ?? 0}%</span><span class="lo">${Math.round(lo)}°</span>
      <i class="tb"><b style="left:${(lo - allMin) / span * 100}%;width:${(hi - lo) / span * 100}%"></b></i><span class="hi">${Math.round(hi)}°</span></div>`;
  }).join('') + '</div>';
  return { title: `${weatherName} 날씨`, html: `<div class="dgrid w">${left}<div class="dcard"><div class="dc-t">24시간 예보<b>온도 · 강수확률</b></div>${svg}</div>${right}</div>` };
}

/* ---------- 시간표 상세: 주간 전체 ---------- */
function viewTimetable() {
  if (!tt) return { title: '시간표', html: '<div class="dcard"><div class="muted">시간표를 불러오는 중…</div></div>' };
  if (tt.noTimetable) return { title: '시간표', html: '<div class="dcard"><div class="muted">선택한 직위(교장·교감)는 시간표가 없습니다.</div></div>' };
  const days = ['월', '화', '수', '목', '금'], nowMin = nowMinutes(), todayReal = WD[new Date().getDay()];
  const isCurWeek = tt.week === tt.currentWeek;
  const tsel = `<select class="tsel" id="dTeacher">${(tt.teachers || []).map(t => `<option ${t === tt.teacher ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>`;
  const nav = `<div class="wnav"><button data-wk="-1">◀</button><span class="${isCurWeek ? '' : 'other'}">${tt.week}주차 (${tt.range})</span><button data-wk="1">▶</button>${isCurWeek ? '' : '<button data-wk="0" class="today">오늘</button>'}<em>${isCurWeek ? '이번 주' : ''}</em>${tsel}</div>`;
  let h = '<div class="wt"><div class="wt-h"></div>' + days.map(d => `<div class="wt-h ${d === tt.today ? 'td' : ''}">${d}<small>${tt.days[d].date.slice(5).replace('.', '/')}</small>${tt.days[d].title ? `<em>${esc(tt.days[d].title)}</em>` : ''}</div>`).join('');
  PERIODS.forEach(([p, s, e]) => {
    h += `<div class="wt-p">${p === '점심' ? '점심' : p + '교시'}<small>${s}</small></div>`;
    days.forEach(d => {
      const data = tt.days[d];
      const isNow = isCurWeek && d === tt.today && todayReal === tt.today && nowMin >= toMin(s) && nowMin < toMin(e);
      if (p === '점심') { h += `<div class="wt-c lunch ${data.lunchDuty ? 'dutyon' : ''} ${isNow ? 'now' : ''}">${data.lunchDuty ? '🍱 급식지도' : '·'}</div>`; return; }
      const c = data.periods[p - 1] || { type: 'free', subject: '공강', room: '' };
      const jido = data.jido.find(j => Number(j.period) === p), asDuty = jido && c.type === 'free';
      const isEv = c.type === 'event' && c.room;
      const main = asDuty ? '공강지도' : c.subject, sub = jido ? jido.target : c.room;   // 상세는 전체 표시
      h += `<div class="wt-c ${asDuty ? 'duty' : c.type} ${isEv ? 'evc' : ''} ${isNow ? 'now' : ''} ${isCurWeek && d === tt.today ? 'td' : ''}"><b>${esc(main)}</b><small>${esc(sub)}</small></div>`;
    });
  });
  h += '</div>';
  let side = '<div class="dcard"><div class="dc-t">이번 주 지도 배정</div>';
  let any = false;
  days.forEach(d => {
    const data = tt.days[d];
    data.jido.forEach(j => { any = true; side += `<div class="dli">🛡 ${d} ${j.period}교시 · <span class="n">${esc(j.target)}</span></div>`; });
    if (data.lunchDuty) { any = true; side += `<div class="dli">🍱 ${d} 점심 급식지도</div>`; }
  });
  if (!any) side += '<div class="dli muted">이번 주 배정 없음</div>';
  side += '</div><div class="dcard"><div class="dc-t">요일별 수업</div>' + days.map(d => {
    const n = tt.days[d].periods.filter(c => ['class', 'sub', 'swap'].includes(c.type)).length;
    return `<div class="dli"><span>${d}</span><i class="bar"><b style="width:${n / 7 * 100}%"></b></i><span>${n}시간</span></div>`;
  }).join('') + '</div>';
  return { title: `${tt.teacher}${tt.homeroom ? ` (${tt.homeroom})` : ''} · ${tt.week}주차 주간 시간표`, html: `<div class="dgrid tt"><div class="dcard">${nav}${h}</div><div class="dside">${side}</div></div>` };
}

/* ---------- 일정 상세: 큰 달력 + 선택일 일정 ---------- */
function viewEvents() {
  const now = new Date(), y = now.getFullYear(), m = now.getMonth();
  const sel = calSel || now.toDateString();
  const byDay = {};
  const first = new Date(y, m, 1), start = new Date(y, m, 1 - first.getDay());
  eventsCache.forEach(e => {
    const s = new Date(e.start);
    if (e.all_day && e.end) {
      const en = new Date(e.end), days = Math.round((en - s) / 864e5);
      if (days > 3) {   // 장기 일정: 첫 표시일 한 번만, 종료일 표기
        const d0 = s < start ? new Date(start) : s;
        const last = new Date(en.getTime() - 864e5);
        (byDay[d0.toDateString()] ||= []).push({ ...e, title: `${e.title} ~${last.getMonth() + 1}/${last.getDate()}`, long: true });
      } else for (let d = new Date(s); d < en; d.setDate(d.getDate() + 1)) (byDay[d.toDateString()] ||= []).push(e);
    } else (byDay[s.toDateString()] ||= []).push(e);
  });
  const weeks = Math.ceil((first.getDay() + new Date(y, m + 1, 0).getDate()) / 7);
  let cal = '<div class="bcal">' + WD.map(w => `<div class="wk">${w}</div>`).join('');
  for (let i = 0; i < weeks * 7; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i); const k = d.toDateString(), evs = byDay[k] || [];
    cal += `<div class="c ${d.getMonth() !== m ? 'out' : ''} ${d.getDay() === 0 ? 'sun' : d.getDay() === 6 ? 'sat' : ''} ${k === now.toDateString() ? 'td' : ''} ${k === sel ? 'sel' : ''}" data-k="${k}">
      <span class="d">${d.getDate()}</span>${evs.slice(0, 2).map(e => `<i>${esc(e.title)}</i>`).join('')}${evs.length > 2 ? `<i>+${evs.length - 2}</i>` : ''}</div>`;
  }
  cal += '</div>';
  const sd = new Date(sel), diff = Math.round((new Date(sd.toDateString()) - new Date(now.toDateString())) / 864e5);
  const label = `${sd.getMonth() + 1}월 ${sd.getDate()}일 ${WD[sd.getDay()]}요일` + (diff === 0 ? ' · 오늘' : diff === 1 ? ' · 내일' : diff > 0 ? ` · D-${diff}` : '');
  const evs = byDay[sel] || [];
  const row = e => { const s = new Date(e.start), en = e.end ? new Date(e.end) : s;
    return `<div class="dli ${!e.all_day && now >= s && now < en ? 'now' : ''} ${e.local ? 'local' : ''}"><span class="t">${e.all_day ? '종일' : pad(s.getHours()) + ':' + pad(s.getMinutes())}</span>
      <span class="n">${esc(e.title)}${e.location && !e.title.includes(e.location) ? ` <small class="muted">· ${esc(e.location)}</small>` : ''}</span>${e.tag ? `<small class="tag">${esc(e.tag)}</small>` : ''}${e.local ? `<button class="del" data-del="${e.id}" title="삭제">✕</button>` : ''}</div>`; };
  const list = evs.length ? evs.map(row).join('') : '<div class="dli muted">일정 없음</div>';
  const upcoming = eventsCache.filter(e => new Date(e.start) > new Date(sd.getTime() + 864e5)).slice(0, 8).map(e => { const s = new Date(e.start);
    return `<div class="dli ${e.local ? 'local' : ''}"><span class="t">${s.getMonth() + 1}/${s.getDate()} ${WD[s.getDay()]}</span><span class="n">${esc(e.title)}</span>${e.tag ? `<small class="tag">${esc(e.tag)}</small>` : ''}</div>`; }).join('');
  const selIso = `${sd.getFullYear()}-${pad(sd.getMonth() + 1)}-${pad(sd.getDate())}`;
  const form = `<form id="evForm" class="evform" autocomplete="off">
      <input id="evTitle" placeholder="일정 제목" value="${esc(evDraft.title)}" maxlength="80">
      <input id="evDate" type="date" value="${esc(evDraft.date || selIso)}">
      <input id="evTime" type="time" value="${esc(evDraft.time)}" ${evDraft.all_day ? 'disabled' : ''}>
      <label><input id="evAllDay" type="checkbox" ${evDraft.all_day ? 'checked' : ''}> 종일</label>
      <button type="submit" id="evSave">추가</button></form>`;
  return { title: `${y}년 ${m + 1}월 일정`, html: `<div class="dgrid ev"><div class="dcard">${cal}</div><div class="dcol ev3">
    <div class="dcard"><div class="dc-t">${label}<b>${evs.length}건</b></div><div class="dlist">${list}</div></div>
    <div class="dcard"><div class="dc-t">이후 일정</div><div class="dlist">${upcoming || '<div class="dli muted">없음</div>'}</div></div>
    <div class="dcard"><div class="dc-t">일정 추가<b style="font-size:15px;color:${evMsg ? 'var(--accent)' : 'var(--muted)'}">${esc(evMsg || '이 PC에 저장 · ✎ 표시')}</b></div>${form}</div></div></div>` };
}

/* ---------- 학교일정 상세: 부서별 필터 + 학사일정 ---------- */
function viewSchool() {
  const now = new Date(), today0 = new Date(now.toDateString());
  const all = eventsCache.filter(e => e.source === 'school'), acad = eventsCache.filter(e => e.source === 'academic');
  const depts = [...new Set(all.map(e => e.tag).filter(Boolean))];
  const list = (schoolDept ? all.filter(e => e.tag === schoolDept) : all).filter(e => (e.end ? new Date(e.end) : new Date(e.start)) > today0);
  const btns = `<div class="wnav deptbar"><button data-dept="" class="${schoolDept ? '' : 'today'}">전체</button>${depts.map(x => `<button data-dept="${esc(x)}" class="${schoolDept === x ? 'today' : ''}">${esc(x)}</button>`).join('')}</div>`;
  let html = '', lastDay = '';
  for (const e of list) {
    const s = new Date(e.start), en = e.end ? new Date(e.end) : s;
    const key = (s < today0 ? today0 : s).toDateString();
    if (key !== lastDay) { const k = new Date(key), diff = Math.round((k - today0) / 864e5); html += `<div class="day">${diff === 0 ? '오늘' : diff === 1 ? '내일' : `${k.getMonth() + 1}/${k.getDate()} ${WD[k.getDay()]}요일`}</div>`; lastDay = key; }
    const days = e.all_day ? Math.round((en - s) / 864e5) : 1, last = new Date(en.getTime() - 864e5);
    html += `<div class="dli"><span class="t">${e.all_day ? '종일' : pad(s.getHours()) + ':' + pad(s.getMinutes())}</span><span class="n">${esc(e.title)}${days > 1 ? ` <small class="muted">~${last.getMonth() + 1}/${last.getDate()}</small>` : ''}${e.manager ? ` <small class="muted">· ${esc(e.manager)}</small>` : ''}</span><small class="tag">${esc(e.tag || '')}</small></div>`;
  }
  const ac = acad.filter(e => new Date(e.end || e.start) > today0).map(e => { const s = new Date(e.start); return `<div class="dli academic"><span class="t">${s.getMonth() + 1}/${s.getDate()} ${WD[s.getDay()]}</span><span class="n">${esc(e.title)}</span><small class="tag">${esc(e.tag || '')}</small></div>`; }).join('');
  const clock = `<div class="dcard tclock small"><div class="bt">${pad(now.getHours() % 12 || 12)}<span>:</span>${pad(now.getMinutes())}</div>
    <div class="bs">${now.getHours() < 12 ? '오전' : '오후'} · ${pad(now.getSeconds())}초</div>
    <div class="bd">${now.getMonth() + 1}월 ${now.getDate()}일 (${WD[now.getDay()]})</div>
    ${tt && tt.days && tt.days[tt.today] && tt.days[tt.today].title ? `<div class="tchip hl" style="margin-top:10px">📌 ${esc(tt.days[tt.today].title)}</div>` : ''}</div>`;
  const site = schoolUrl ? `<button class="mbtn" data-open="${esc(schoolUrl)}">사이트 가기 ↗</button>` : '';
  return { title: '학교일정', html: `<div class="dgrid sch">${clock}<div class="dcard">${btns}<div class="dlist">${html || '<div class="dli muted">해당 일정 없음</div>'}</div></div>
    <div class="dcard"><div class="dc-t">학사일정 <b class="muted" style="font-size:15px">${acad.length}건</b>${site}</div><div class="dlist">${ac || '<div class="dli muted">없음</div>'}</div></div></div>` };
}

/* ---------- 메시지 상세 ---------- */
function viewMessages() {   // 쪽지만 크게: 보낸 사람·시간 한 줄 + 본문 최대 3줄
  const items = msgData.items.length ? msgData.items.map(m => `<div class="mmsg ${m.unread === false ? 'read' : 'unread'}">
      <div class="mh"><b>${esc(m.title || m.app || '메시지')}</b><span>${timeAgo(m.time)}</span></div>
      ${m.body ? `<div class="mb">${esc(m.body)}</div>` : ''}</div>`).join('')
    : `<div class="dli muted">${msgData.error ? esc(msgData.error) : '새 메시지 없음'}</div>`;
  return { title: `쿨메시지 · 안읽음 ${msgData.count}건`, html: `<div class="dgrid"><div class="dcard"><div class="dc-t">쪽지 ${msgData.items.length}건<b><button class="mbtn" data-msgclear>모두 지우기</button></b></div><div class="dlist mlist">${items}</div></div></div>` };
}

/* ---------- PC 상세 ---------- */
function viewPC() {
  const s = lastSys;
  if (!s) return { title: 'PC 상태', html: '<div class="dcard"><div class="muted">불러오는 중…</div></div>' };
  const g = (label, arr, max, color, val) => `<div class="dcard g"><div class="dc-t"><span>${label}</span><b>${val}</b></div>${spark(arr, max, color, 120)}</div>`;
  const nmax = Math.max(102400, ...hist.net);
  const up = s.uptime, ud = Math.floor(up / 86400), uh = Math.floor(up % 86400 / 3600), um = Math.floor(up % 3600 / 60);
  const pr = procs.length ? procs.map(p => `<span>${esc(p.name)}</span><span class="v">${p.cpu}%</span><span class="v">${p.mem}%</span>`).join('') : '<span class="muted">수집 중…</span>';
  return { title: 'PC 상태', html: `<div class="dgrid pc">
    ${g('CPU', hist.cpu, 100, 'var(--accent)', Math.round(s.cpu) + '%')}
    ${g('RAM', hist.ram, 100, '#9ad37b', `${s.ram_used} / ${s.ram_total} GB`)}
    ${s.gpu ? g(`GPU · ${esc(s.gpu.name || '')}`, hist.gpu, 100, '#f3b5a5', `${s.gpu.load}% · ${Math.round(s.gpu.temp)}°C`) : g('디스크 C:', hist.disk, 100, '#f3b5a5', s.disk + '%')}
    ${g('네트워크', hist.net, nmax, '#a9cdf5', `↓${speed(s.down)} ↑${speed(s.up)}`)}
    <div class="dcard span2"><div class="dc-t">상위 프로세스<b>CPU 기준</b></div><div class="proc"><span class="h">이름</span><span class="h v">CPU</span><span class="h v">RAM</span>${pr}</div></div>
    <div class="dcard"><div class="dc-t">저장 공간 · 전원</div><div class="rings">${ring(s.disk, '디스크 C:')}${s.battery != null ? ring(s.battery, '배터리') : ring(s.ram, 'RAM')}</div></div>
    <div class="dcard"><div class="dc-t">시스템</div><div class="dlist"><div class="dli"><span class="t">가동</span><span class="n">${ud ? ud + '일 ' : ''}${uh}시간 ${um}분</span></div>
      <div class="dli"><span class="t">RAM</span><span class="n">${s.ram_used} / ${s.ram_total} GB (${Math.round(s.ram)}%)</span></div>
      <div class="dli"><span class="t">CPU</span><span class="n">${Math.round(s.cpu)}% 사용 중</span></div>
      ${s.gpu ? `<div class="dli"><span class="t">GPU</span><span class="n">${esc(s.gpu.name || '')}</span></div>` : ''}</div></div></div>` };
}

/* ---------- 바인딩 ---------- */
window.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('#root > .panel').forEach(p => p.addEventListener('click', e => {
    if (e.target.closest('button, select, a, #pcMini')) return;
    const kind = PANEL_KIND[p.id]; if (kind) openDetail(kind);
  }));
  $('dback').onclick = closeDetail;
  $('dbody').addEventListener('change', async e => {
    if (e.target.id !== 'dTeacher') return;
    const name = e.target.value; if (!name || (tt && tt.teacher === name)) return;
    await pywebview.api.set_teacher(name); ttSel = null; ttWant = name; ttRetry = 0; loadTimetable();
  });
  $('dbody').addEventListener('input', e => {
    if (!e.target.closest('#evForm')) return;
    evDraft = { title: $('evTitle').value, date: $('evDate').value, time: $('evTime').value, all_day: $('evAllDay').checked };
    $('evTime').disabled = evDraft.all_day;
  });
  $('dbody').addEventListener('submit', async e => {
    if (e.target.id !== 'evForm') return;
    e.preventDefault();
    evDraft = { title: $('evTitle').value.trim(), date: $('evDate').value, time: $('evTime').value, all_day: $('evAllDay').checked };
    if (!evDraft.title || !evDraft.date) { evMsg = '제목과 날짜를 입력하세요'; renderDetail(); return; }
    const ok = await pywebview.api.add_event(evDraft);
    evMsg = ok ? '추가했습니다' : '저장 실패';
    if (ok) { calSel = new Date(evDraft.date + 'T00:00:00').toDateString(); evDraft = { title: '', date: '', time: '', all_day: false }; }
    await loadEvents(); renderDetail();
    setTimeout(() => { evMsg = ''; if (detailKind === 'events') renderDetail(); }, 3000);
  });
  $('dbody').addEventListener('click', async e => {
    const op = e.target.closest('[data-open]'); if (op) { if (window.pywebview && pywebview.api.open_url) pywebview.api.open_url(op.dataset.open); else window.open(op.dataset.open, '_blank'); return; }
    const dp = e.target.closest('[data-dept]'); if (dp) { schoolDept = dp.dataset.dept; renderDetail(); return; }
    if (e.target.closest('[data-msgclear]')) { await pywebview.api.clear_messages(); await loadMessages(); return; }
    const del = e.target.closest('[data-del]'); if (del) { await pywebview.api.delete_event(del.dataset.del); await loadEvents(); renderDetail(); return; }
    const c = e.target.closest('.bcal .c'); if (c) { calSel = c.dataset.k; evDraft.date = ''; renderDetail(); return; }
    const w = e.target.closest('[data-wk]'); if (w) { const k = Number(w.dataset.wk); if (k === 0) { ttWeekSel = null; ttRetry = 0; loadTimetable(); } else changeWeek(k); }
  });
  document.addEventListener('pointerdown', bumpIdle);
  setInterval(() => {
    if (detailKind === 'pc' && window.pywebview) pywebview.api.get_processes().then(p => { procs = p || []; });
  }, 5000);
});
