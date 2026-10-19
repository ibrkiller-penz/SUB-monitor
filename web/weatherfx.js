// 날씨 연출: 지금 날씨(WMO 코드)에 맞춰 화면 맨 앞에 비·물방울·눈·안개를 그린다.
// 원칙(가독성): 글자를 가리지 않도록 얇고 반투명하게, 큰 덩어리는 화면 가장자리 쪽에 더 많이.
//   비   — 기울어진 빗줄기(앞·뒤 깊이감) + 유리에 맺히는 물방울(커지면 흘러내리며 자국) + 뇌우면 번개 번쩍
//   이슬비 — 가는 빗줄기 + 잔 물방울 위주
//   눈   — 화면 전체에 3겹(먼 눈·가까운 눈·흐릿한 큰 눈송이), 바람에 흔들림 + 패널 윗면·화면 아래에 눈이 쌓임
//   흐림·안개 — 옅은 안개 띠가 앞쪽을 천천히 지나감
// 설정 > '날씨 효과' 로 끌 수 있고, 야간 모드 동안에는 멈춘다.
(function () {
  const FX = window.WEATHER_FX = window.WEATHER_FX || { on: true, kind: 'none', level: 0 };
  let cv, ctx, W = 0, H = 0, raf = 0, last = 0, t = 0;
  let streaks = [], beads = [], flakes = [], fogs = [], caps = [], flash = 0, nextBolt = 0;

  function classify(code) {
    code = Number(code);
    if ([95, 96, 99].includes(code)) return ['storm', 3];
    if ([65, 67, 82].includes(code)) return ['rain', 3];
    if ([63, 66, 81].includes(code)) return ['rain', 2];
    if ([61, 80].includes(code)) return ['rain', 1];
    if ([51, 53, 55, 56, 57].includes(code)) return ['drizzle', 1];
    if ([75, 86].includes(code)) return ['snow', 3];
    if ([73, 85].includes(code)) return ['snow', 2];
    if ([71, 77].includes(code)) return ['snow', 1];
    if ([45, 48].includes(code)) return ['fog', 2];
    if (code === 3) return ['cloud', 2];
    if (code === 2) return ['cloud', 1];
    return ['none', 0];
  }
  const isRain = k => k === 'rain' || k === 'drizzle' || k === 'storm';

  function ensure() {
    if (cv) return;
    cv = document.createElement('canvas');
    cv.id = 'wfx';
    // 맨 앞(패널 위). 설정 창·용·야간 화면보다는 아래
    cv.style.cssText = 'position:absolute;inset:0;z-index:40;pointer-events:none;';
    document.getElementById('stage').appendChild(cv);
    ctx = cv.getContext('2d');
  }
  function resize() {
    const st = document.getElementById('stage');
    W = st.offsetWidth; H = st.offsetHeight;
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; caps = []; }
  }
  const rnd = (a, b) => a + Math.random() * (b - a);
  // 가장자리 쪽에 더 많이: 0~1 위치를 가장자리로 치우치게
  const edgeBias = () => { const u = Math.random(); return u < .5 ? Math.pow(u * 2, 1.8) / 2 : 1 - Math.pow((1 - u) * 2, 1.8) / 2; };

  function seed() {
    resize();
    streaks = []; beads = []; flakes = []; fogs = []; caps = [];
    const { kind, level } = FX, area = W * H / (1920 * 440);
    if (isRain(kind)) {
      const n = Math.round((kind === 'drizzle' ? 90 : [0, 130, 220, 320][level]) * area);
      for (let i = 0; i < n; i++) streaks.push(newStreak(true));
    }
    if (kind === 'snow') {
      const n = Math.round([0, 90, 160, 240][level] * area);
      for (let i = 0; i < n; i++) flakes.push(newFlake(true));
    }
    const nf = kind === 'fog' ? 6 : kind === 'cloud' ? (level === 2 ? 4 : 2) : isRain(kind) ? 2 : kind === 'snow' ? 1 : 0;
    for (let i = 0; i < nf; i++) fogs.push(newFog(true));
  }

  // ---------- 비 ----------
  function newStreak(any) {
    const z = Math.random();                          // 0 먼 비 ~ 1 가까운 비
    return { x: rnd(-40, W + 80), y: any ? rnd(-H, H) : rnd(-H * .6, -20), z, len: 10 + z * 26, sp: 700 + z * 700 };
  }
  function newBead() {
    const big = Math.random() < .25;
    return { x: edgeBias() * W, y: Math.random() < .6 ? edgeBias() * H : Math.random() * H,
             r: big ? rnd(3.5, 6.5) : rnd(1.2, 3.2), grow: rnd(.05, .25), slide: 0, vy: 0, trail: [], life: 0 };
  }
  function drawBead(b) {
    const { x, y, r } = b;
    // 물방울: 투명한 몸통 + 아래쪽 어두운 테 + 위왼쪽 반짝임 (빛이 굴절된 느낌)
    const g = ctx.createRadialGradient(x - r * .3, y - r * .35, r * .1, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,.28)'); g.addColorStop(.55, 'rgba(200,220,240,.10)'); g.addColorStop(1, 'rgba(20,30,45,.30)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(x, y, r, r * 1.08, 0, 0, 7); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.beginPath(); ctx.arc(x - r * .35, y - r * .4, Math.max(.6, r * .22), 0, 7); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.12)'; ctx.lineWidth = .8; ctx.beginPath(); ctx.arc(x, y + r * .1, r * .9, .2, Math.PI - .2); ctx.stroke();
  }
  function stepRain(dt) {
    const { kind, level } = FX;
    const wind = kind === 'storm' ? .28 : .14;
    ctx.lineCap = 'round';
    for (const s of streaks) {
      s.y += s.sp * dt * (kind === 'drizzle' ? .55 : 1); s.x -= s.sp * wind * dt;
      if (s.y - s.len > H || s.x < -60) Object.assign(s, newStreak(false));
      const a = (kind === 'drizzle' ? .12 : .16) + .28 * s.z;
      const len = s.len * (kind === 'drizzle' ? .5 : 1);
      ctx.strokeStyle = `rgba(210,228,255,${a})`; ctx.lineWidth = .6 + 1.1 * s.z;
      ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(s.x + len * wind, s.y - len); ctx.stroke();
    }
    // 유리에 맺히는 물방울
    const maxBeads = Math.round((kind === 'drizzle' ? 70 : [0, 45, 70, 95][level]) * W / 1920);
    if (beads.length < maxBeads && Math.random() < dt * (kind === 'drizzle' ? 14 : 8 + level * 4)) beads.push(newBead());
    for (let i = beads.length - 1; i >= 0; i--) {
      const b = beads[i]; b.life += dt;
      if (!b.slide) { b.r += b.grow * dt; if (b.r > 5.8 && Math.random() < dt * 1.5) b.slide = 1; }
      else {                                            // 무거워진 물방울이 흘러내리며 가는 자국을 남긴다
        b.vy = Math.min(220, b.vy + 260 * dt); b.y += b.vy * dt; b.x += Math.sin(b.y * .05) * .3;
        b.trail.push([b.x, b.y]); if (b.trail.length > 40) b.trail.shift();
        b.r = Math.max(2.5, b.r - dt * .6);
        // 지나가며 작은 물방울을 삼킨다
        for (let j = beads.length - 1; j >= 0; j--) if (j !== i && !beads[j].slide && Math.hypot(beads[j].x - b.x, beads[j].y - b.y) < b.r + beads[j].r) { b.r = Math.min(7, b.r + beads[j].r * .3); beads.splice(j, 1); if (j < i) i--; }
      }
      if (b.trail.length > 1) {
        ctx.strokeStyle = 'rgba(220,235,255,.10)'; ctx.lineWidth = Math.max(1, b.r * .7);
        ctx.beginPath(); b.trail.forEach(([x, y], k) => k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.stroke();
      }
      drawBead(b);
      if (b.y > H + 10 || b.life > 90) beads.splice(i, 1);
    }
    // 뇌우: 가끔 번개
    if (kind === 'storm') {
      if (t > nextBolt) { flash = 1; nextBolt = t + rnd(9, 22); }
      if (flash > 0) {
        const f = flash > .7 ? 1 : flash > .5 ? .2 : flash > .35 ? .8 : flash * .5;
        ctx.fillStyle = `rgba(230,240,255,${.16 * f})`; ctx.fillRect(0, 0, W, H);
        flash -= dt * 1.6;
      }
    }
  }

  // ---------- 눈 ----------
  function newFlake(any) {
    const layer = Math.random() < .1 ? 2 : Math.random() < .45 ? 1 : 0;   // 0 먼 눈, 1 가까운 눈, 2 흐릿한 큰 눈송이
    return { x: rnd(-20, W + 20), y: any ? rnd(-20, H) : -12, layer, ph: rnd(0, 6.3),
             r: layer === 2 ? rnd(5, 9) : layer === 1 ? rnd(1.8, 3.2) : rnd(.8, 1.6),
             vy: layer === 2 ? rnd(40, 60) : layer === 1 ? rnd(28, 45) : rnd(14, 24) };
  }
  // 패널 윗면에 눈이 쌓인다 (윗면 위치를 화면 좌표로)
  function panelTops() {
    const st = document.getElementById('stage'), sr = st.getBoundingClientRect();
    const k = sr.width / (st.offsetWidth || 1);
    return [...document.querySelectorAll('#root > .panel:not(.off)')].map(el => {
      const r = el.getBoundingClientRect();
      return { x0: (r.left - sr.left) / k + 10, x1: (r.right - sr.left) / k - 10, y: (r.top - sr.top) / k };
    });
  }
  function stepSnow(dt) {
    const gust = Math.sin(t * .35) * 22 + Math.sin(t * 1.3) * 8;
    if (!caps.length) caps = panelTops().map(p => ({ ...p, h: new Float32Array(48) }));
    for (const f of flakes) {
      f.ph += dt * (1.2 + f.layer * .4);
      f.y += f.vy * dt; f.x += (Math.sin(f.ph) * (8 + f.layer * 6) + gust * (.4 + f.layer * .35) - 6) * dt;
      // 가까운 눈이 패널 윗면에 닿으면 조금씩 쌓인다
      if (f.layer === 1) for (const c of caps) if (f.x > c.x0 && f.x < c.x1 && Math.abs(f.y - c.y) < 2) {
        const i = Math.floor((f.x - c.x0) / (c.x1 - c.x0) * c.h.length); c.h[i] = Math.min(7, c.h[i] + .35); Object.assign(f, newFlake(false));
      }
      if (f.y > H + 12) Object.assign(f, newFlake(false));
      if (f.x < -30) f.x = W + 20; if (f.x > W + 30) f.x = -20;
      if (f.layer === 2) {        // 흐릿한 큰 눈송이(초점 밖)
        const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, f.r);
        g.addColorStop(0, 'rgba(255,255,255,.30)'); g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, 7); ctx.fill();
      } else {
        ctx.fillStyle = `rgba(255,255,255,${f.layer ? .85 : .5})`;
        ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, 7); ctx.fill();
      }
    }
    // 쌓인 눈: 패널 윗면을 따라 울퉁불퉁한 하얀 띠
    for (const c of caps) {
      const n = c.h.length, w = (c.x1 - c.x0) / (n - 1);
      for (let i = 1; i < n - 1; i++) c.h[i] = c.h[i] * .9 + (c.h[i - 1] + c.h[i + 1]) * .05;   // 고르게 퍼짐
      ctx.beginPath(); ctx.moveTo(c.x0, c.y);
      for (let i = 0; i < n; i++) ctx.lineTo(c.x0 + i * w, c.y - c.h[i]);
      ctx.lineTo(c.x1, c.y); ctx.closePath();
      ctx.fillStyle = 'rgba(250,252,255,.85)'; ctx.fill();
    }
  }

  // ---------- 안개 ----------
  function newFog(any) {
    const w = rnd(W * .35, W * .7);
    return { x: any ? rnd(-w, W) : W + 10, y: rnd(H * .1, H * .9), w, h: rnd(H * .35, H * .7), v: rnd(10, 22), a: FX.kind === 'fog' ? .16 : .09, ph: rnd(0, 6) };
  }
  function stepFog(dt) {
    for (let i = 0; i < fogs.length; i++) {
      const f = fogs[i]; f.x -= f.v * dt; f.ph += dt * .2;
      if (f.x < -f.w) fogs[i] = newFog(false);
      const y = f.y + Math.sin(f.ph) * 12;
      const g = ctx.createRadialGradient(f.x + f.w / 2, y, 0, f.x + f.w / 2, y, f.w / 2);
      g.addColorStop(0, `rgba(232,238,246,${f.a})`); g.addColorStop(.6, `rgba(232,238,246,${f.a * .5})`); g.addColorStop(1, 'rgba(232,238,246,0)');
      ctx.save(); ctx.translate(f.x + f.w / 2, y); ctx.scale(1, f.h / f.w); ctx.translate(-(f.x + f.w / 2), -y);
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(f.x + f.w / 2, y, f.w / 2, 0, 7); ctx.fill(); ctx.restore();
    }
  }

  function frame(now) {
    raf = 0;
    if (!FX.on || FX.kind === 'none' || window.NIGHT_ON) { if (ctx) ctx.clearRect(0, 0, W, H); return; }
    const dt = Math.min(.05, (now - (last || now)) / 1000); last = now; t += dt;
    resize();
    ctx.clearRect(0, 0, W, H);
    stepFog(dt);
    if (isRain(FX.kind)) stepRain(dt);
    if (FX.kind === 'snow') stepSnow(dt);
    raf = requestAnimationFrame(frame);
  }
  function start() { ensure(); seed(); if (!raf) { last = 0; raf = requestAnimationFrame(frame); } }

  window.updateWeatherFx = function (code) {
    const [k, l] = classify(code);
    if (k === FX.kind && l === FX.level && raf) return;
    FX.kind = k; FX.level = l; start();
  };
  // 시험용: setWeatherFx('rain'|'drizzle'|'storm'|'snow'|'cloud'|'fog'|'none', 세기)
  window.setWeatherFx = function (kind, level = 2) { FX.kind = kind; FX.level = level; start(); };
  window.weatherFxOn = function (on) { FX.on = !!on; start(); };
  // 패널 배치가 바뀌면 눈 쌓일 자리 다시 계산
  window.addEventListener('resize', () => { caps = []; });
  setInterval(() => { caps = caps.filter(Boolean); if (FX.kind === 'snow') { const tops = panelTops(); if (tops.length !== caps.length) caps = []; } }, 5000);
  setInterval(() => { if (FX.on && FX.kind !== 'none' && !window.NIGHT_ON && !raf) start(); }, 20000);
})();
