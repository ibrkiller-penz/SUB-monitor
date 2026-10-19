// 날씨 효과: 지금 날씨(WMO 코드)에 따라 배경 위·패널 아래에 비/눈/안개 구름을 은은하게 그린다.
// 패널 뒤에 깔리므로 글자를 가리지 않는다. 설정 > '날씨 효과' 로 끌 수 있다.
(function () {
  const FX = window.WEATHER_FX = window.WEATHER_FX || { on: true, kind: 'none', level: 0 };
  let cv, ctx, W = 0, H = 0, parts = [], clouds = [], last = 0, raf = 0;

  // WMO 날씨 코드 → 효과 종류·세기(1~3)
  function classify(code) {
    code = Number(code);
    if ([95, 96, 99].includes(code)) return ['rain', 3];
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

  function ensure() {
    if (cv) return;
    const st = document.getElementById('stage'), bg = document.getElementById('bg');
    cv = document.createElement('canvas');
    cv.id = 'wfx';
    cv.style.cssText = 'position:absolute;inset:0;pointer-events:none;';
    bg.after(cv);                       // 배경 바로 위, 패널(#root) 아래
    ctx = cv.getContext('2d');
  }

  function resize() {
    const st = document.getElementById('stage');
    W = st.offsetWidth; H = st.offsetHeight;
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
  }

  function seed() {
    resize();
    parts = []; clouds = [];
    const { kind, level } = FX;
    const area = W * H / (1920 * 440);
    if (kind === 'rain' || kind === 'drizzle') {
      const n = Math.round((kind === 'drizzle' ? 70 : [0, 110, 200, 320][level]) * area);
      for (let i = 0; i < n; i++) parts.push({ x: Math.random() * W, y: Math.random() * H, z: .4 + Math.random() * .6 });
    }
    if (kind === 'snow') {
      const n = Math.round([0, 70, 130, 210][level] * area);
      for (let i = 0; i < n; i++) parts.push({ x: Math.random() * W, y: Math.random() * H, z: .35 + Math.random() * .65, ph: Math.random() * 6.3 });
    }
    // 흐림·안개·비·눈 모두 옅은 구름이 흘러간다 (흐림/안개일수록 많게)
    const nc = kind === 'fog' ? 9 : kind === 'cloud' ? (level === 2 ? 7 : 4) : (kind === 'none' ? 0 : 4);
    for (let i = 0; i < nc; i++) clouds.push(newCloud(true));
  }

  function newCloud(anywhere) {
    const r = H * (.35 + Math.random() * .45);
    return { x: anywhere ? Math.random() * (W + r * 2) - r : W + r, y: H * (.1 + Math.random() * .8), r,
             v: 6 + Math.random() * 10, a: FX.kind === 'fog' ? .16 : .11, blobs: Array.from({ length: 5 }, () => [Math.random() * 1.6 - .8, Math.random() * .5 - .25, .45 + Math.random() * .4]) };
  }

  function drawCloud(c) {
    for (const [dx, dy, s] of c.blobs) {
      const x = c.x + dx * c.r, y = c.y + dy * c.r, r = c.r * s;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(235,240,248,${c.a})`); g.addColorStop(1, 'rgba(235,240,248,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
    }
  }

  function frame(now) {
    raf = 0;
    if (!FX.on || FX.kind === 'none' || window.NIGHT_ON) { if (ctx) ctx.clearRect(0, 0, W, H); return; }
    const dt = Math.min(.1, (now - (last || now)) / 1000); last = now;
    resize();
    ctx.clearRect(0, 0, W, H);
    // 구름·안개
    for (let i = 0; i < clouds.length; i++) {
      const c = clouds[i]; c.x -= c.v * dt;
      if (c.x < -c.r * 2) clouds[i] = newCloud(false);
      drawCloud(c);
    }
    // 비: 살짝 기운 가는 빗줄기
    if (FX.kind === 'rain' || FX.kind === 'drizzle') {
      const sp = FX.kind === 'drizzle' ? 380 : 620 + FX.level * 120, len = FX.kind === 'drizzle' ? 9 : 14 + FX.level * 3;
      ctx.lineCap = 'round';
      for (const p of parts) {
        p.y += sp * p.z * dt; p.x -= sp * .12 * p.z * dt;
        if (p.y > H + 20) { p.y = -20; p.x = Math.random() * (W + 60); }
        if (p.x < -20) p.x = W + 10;
        ctx.strokeStyle = `rgba(200,220,255,${.18 + .3 * p.z})`; ctx.lineWidth = .7 + .8 * p.z;
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + len * .12 * p.z, p.y - len * p.z); ctx.stroke();
      }
    }
    // 눈: 흔들리며 천천히 떨어지는 눈송이
    if (FX.kind === 'snow') {
      for (const p of parts) {
        p.ph += dt * (1 + p.z); p.y += (22 + 40 * p.z) * dt; p.x += Math.sin(p.ph) * 18 * dt - 6 * dt;
        if (p.y > H + 6) { p.y = -6; p.x = Math.random() * W; }
        const r = 1.2 + 2.6 * p.z;
        ctx.fillStyle = `rgba(255,255,255,${.35 + .5 * p.z})`; ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 7); ctx.fill();
      }
    }
    raf = requestAnimationFrame(frame);
  }

  function start() { ensure(); seed(); if (!raf) { last = 0; raf = requestAnimationFrame(frame); } }

  // 날씨가 바뀔 때 호출 (index.html 의 loadWeather 에서)
  window.updateWeatherFx = function (code) {
    const [k, l] = classify(code);
    if (k === FX.kind && l === FX.level && raf) return;
    FX.kind = k; FX.level = l; start();
  };
  // 시험용: setWeatherFx('rain'|'drizzle'|'snow'|'cloud'|'fog'|'none', 세기)
  window.setWeatherFx = function (kind, level = 2) { FX.kind = kind; FX.level = level; start(); };
  window.weatherFxOn = function (on) { FX.on = !!on; start(); };
  // 야간 모드가 끝나면 다시 시작
  setInterval(() => { if (FX.on && FX.kind !== 'none' && !window.NIGHT_ON && !raf) start(); }, 20000);
})();
