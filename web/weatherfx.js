// 날씨 연출: 지금 날씨에 맞춰 화면 맨 앞에 그린다. 글자를 크게 가리지 않게 반투명·가장자리 위주.
//   구름   — 위에서 빛을 받은 입체 구름 덩어리가 둥둥 떠다니며 천천히 지나감 (흐림일수록 많고 진하게)
//   비     — 부슬부슬 가는 빗줄기 + 액정에 맺히는 물방울(굴절 반짝임, 커지면 주르륵 흘러내림) + 위쪽 비구름
//   뇌우   — 비 + 짙은 구름 + 갈라지는 번개 줄기와 번쩍임
//   눈     — 화면 전체 3겹 눈송이 + 패널 위에 쌓이는 눈 + 네 모서리 성에
//   안개   — 짙은 안개 띠가 화면을 가로질러 흐름
//   맑은 낮 — 위쪽에서 비스듬히 내리는 햇살 줄기
//   맑은 밤 — 위쪽에 깜빡이는 별 + 가끔 별똥별
//   바람   — (바람이 강하면) 단풍잎이 날려 지나감
// 설정 > '날씨 효과' 로 끄거나 미리보기, 야간 모드 동안에는 멈춘다.
(function () {
  const FX = window.WEATHER_FX = window.WEATHER_FX || { on: true, kind: 'none', level: 0 };
  let cv, ctx, W = 0, H = 0, raf = 0, last = 0, t = 0;
  let streaks = [], beads = [], flakes = [], clouds = [], fogs = [], caps = [], stars = [], leaves = [], rays = [];
  let gusts = [], flash = 0, nextBolt = 3, bolt = null, shoot = null, frost = null, beadSprites = {};
  const rnd = (a, b) => a + Math.random() * (b - a);

  function classify(code, isDay, wind) {
    code = Number(code);
    let k = 'clear', l = 1;
    if ([95, 96, 99].includes(code)) [k, l] = ['storm', 3];
    else if ([65, 67, 82].includes(code)) [k, l] = ['rain', 3];
    else if ([63, 66, 81].includes(code)) [k, l] = ['rain', 2];
    else if ([61, 80].includes(code)) [k, l] = ['rain', 1];
    else if ([51, 53, 55, 56, 57].includes(code)) [k, l] = ['drizzle', 1];
    else if ([75, 86].includes(code)) [k, l] = ['snow', 3];
    else if ([73, 85].includes(code)) [k, l] = ['snow', 2];
    else if ([71, 77].includes(code)) [k, l] = ['snow', 1];
    else if ([45, 48].includes(code)) [k, l] = ['fog', 2];
    else if (code === 3) [k, l] = ['cloud', 3];
    else if (code === 2) [k, l] = ['cloud', 2];
    else if (code === 1) [k, l] = ['cloud', 1];
    if (k === 'clear') k = isDay === 0 ? 'night' : 'sunny';
    return [k, l, Number(wind) >= 40 ? 2 : Number(wind) >= 25 ? 1 : 0];   // 풍속 25km/h(약 7m/s)↑ 바람, 40km/h(약 11m/s)↑ 강풍
  }
  const isRain = k => k === 'rain' || k === 'drizzle' || k === 'storm';

  function ensure() {
    if (cv) return;
    cv = document.createElement('canvas');
    cv.id = 'wfx';
    cv.style.cssText = 'position:absolute;inset:0;z-index:40;pointer-events:none;';   // 패널 위, 설정 창·용·야간 화면 아래
    document.getElementById('stage').appendChild(cv);
    ctx = cv.getContext('2d');
  }
  function resize() {
    const st = document.getElementById('stage');
    W = st.offsetWidth; H = st.offsetHeight;
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; caps = []; frost = null; }
  }

  // ---------- 구름: 노이즈로 만든 뭉게구름(위는 빛받아 밝고 몽글몽글, 아래는 평평하고 그늘) ----------
  // 값 노이즈 + 프랙탈(fBm)로 가장자리를 자연스럽게 깎는다. 구름마다 한 번 그려 두고 움직이기만 한다.
  function hash(x, y, s) { const n = Math.sin(x * 127.1 + y * 311.7 + s * 74.7) * 43758.5453; return n - Math.floor(n); }
  function vnoise(x, y, s) {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = hash(xi, yi, s), b = hash(xi + 1, yi, s), c2 = hash(xi, yi + 1, s), d = hash(xi + 1, yi + 1, s);
    return a + (b - a) * u + (c2 - a) * v + (a - b - c2 + d) * u * v;
  }
  const fbm = (x, y, s) => vnoise(x, y, s) * .5 + vnoise(x * 2.1, y * 2.1, s + 1) * .27 + vnoise(x * 4.3, y * 4.3, s + 2) * .15 + vnoise(x * 8.7, y * 8.7, s + 3) * .08;
  const sstep = (a, b, x) => { const t2 = Math.min(1, Math.max(0, (x - a) / (b - a))); return t2 * t2 * (3 - 2 * t2); };
  function makeCloudSprite(w, dark) {
    const h = Math.round(w * .56), c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d'), img = g.createImageData(w, h), d = img.data, seed = Math.random() * 100;
    const baseY = h * .78;                                   // 평평한 바닥선
    // 뭉게 덩어리: 가운데가 높이 솟고 양 끝은 낮게 (전부 그림 안쪽에 들어오게)
    const puffs = [], n = 7 + Math.floor(Math.random() * 4);
    for (let i = 0; i < n; i++) {
      const u = (i + .5) / n + rnd(-.04, .04), hump = Math.sin(Math.PI * u);
      const r = h * (.16 + .2 * hump) * rnd(.85, 1.15);
      puffs.push([w * (.14 + .72 * u), baseY - r * .55 - hump * h * .2, r]);
    }
    const sc = 3.2 / w;                                       // 노이즈 크기
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let dens = 0;
      for (const [px, py, r] of puffs) { const dx = (x - px) / r, dy = (y - py) / r; dens += Math.exp(-(dx * dx + dy * dy) * 1.6); }
      const nz = fbm(x * sc * 3, y * sc * 3, seed);
      dens = dens * (.62 + .55 * nz) * sstep(baseY + h * .08, baseY - h * .02, y);   // 노이즈로 가장자리 깎고 바닥은 평평하게
      const a = sstep(.42, .78, dens);
      if (a <= 0) continue;
      // 명암: 위쪽은 햇빛 받아 밝게, 아래로 갈수록 회청색 그늘, 노이즈로 몽글몽글한 결
      const top = 1 - Math.min(1, Math.max(0, (y - h * .1) / (baseY - h * .1)));
      const lit = Math.min(1, .55 + .45 * top + (nz - .5) * .35 + (dens > 1.2 ? .08 : 0));
      const k = dark ? .66 : 1;
      const k4 = (x + y * w) * 4;
      d[k4] = (150 + 105 * lit) * k; d[k4 + 1] = (158 + 97 * lit) * k; d[k4 + 2] = (176 + 79 * lit) * k; d[k4 + 3] = a * 245;
    }
    g.putImageData(img, 0, 0);
    return c;
  }
  function newCloud(any, idx) {
    const dark = FX.kind === 'storm' || (isRain(FX.kind) && Math.random() < .55);
    const w = Math.round(rnd(240, 470) * (FX.kind === 'storm' ? 1.1 : 1));
    const h = w * .56;
    // 위쪽 가장자리에 걸쳐 떠다님 (글자 가림 최소화). 흐림이 짙으면 아래쪽에도 하나둘
    const low = FX.kind === 'cloud' && FX.level === 3 && idx % 4 === 3;
    const y = low ? rnd(H - h * .55, H - h * .35) : (FX.kind === 'storm' || isRain(FX.kind)) ? rnd(-h * .55, -h * .3) : rnd(-h * .45, -h * .15) + rnd(0, H * .06);
    const strength = FX.kind === 'storm' ? .92 : FX.kind === 'cloud' ? [0, .7, .82, .9][FX.level] : isRain(FX.kind) ? .85 : FX.kind === 'snow' ? .75 : .8;
    return { sprite: makeCloudSprite(w, dark), x: any ? rnd(-w * .5, W) : W + rnd(20, 260), y, w, h,
             v: rnd(7, 15) * (FX.wind ? 2.5 : 1), a: strength * rnd(.85, 1), ph: rnd(0, 6.3), bob: rnd(4, 9), bs: rnd(.25, .45) };
  }
  function stepClouds(dt) {
    for (let i = 0; i < clouds.length; i++) {
      const c = clouds[i]; c.x -= c.v * dt; c.ph += dt * c.bs;
      if (c.x < -c.w - 20) clouds[i] = newCloud(false, i);
      const s = 1 + Math.sin(c.ph * .7) * .025;               // 살짝 부풀었다 줄었다
      const y = c.y + Math.sin(c.ph) * c.bob;                  // 둥둥 오르내림
      ctx.globalAlpha = c.a;
      ctx.drawImage(c.sprite, c.x - c.w * (s - 1) / 2, y, c.w * s, c.h * s);
      ctx.globalAlpha = 1;
    }
  }

  // ---------- 비 ----------
  function newStreak(any) { return { x: rnd(-40, W + 80), y: any ? rnd(-H, H) : rnd(-H * .6, -20), z: Math.random() }; }
  function beadSprite(r) {   // 물방울 그림: 그림자, 투명한 몸통, 굴절 반짝임, 아래 반사광
    const k = Math.round(r * 2) / 2; if (beadSprites[k]) return beadSprites[k];
    const s = Math.ceil(k * 2 + 6), c = document.createElement('canvas'); c.width = c.height = s;
    const g = c.getContext('2d'), x = s / 2, y = s / 2;
    g.fillStyle = 'rgba(0,0,0,.22)'; g.beginPath(); g.ellipse(x + k * .15, y + k * .25, k, k * 1.05, 0, 0, 7); g.fill();
    const body = g.createRadialGradient(x, y + k * .2, k * .1, x, y, k);
    body.addColorStop(0, 'rgba(255,255,255,.10)'); body.addColorStop(.75, 'rgba(210,225,245,.16)'); body.addColorStop(1, 'rgba(40,55,75,.55)');
    g.fillStyle = body; g.beginPath(); g.ellipse(x, y, k, k * 1.05, 0, 0, 7); g.fill();
    g.fillStyle = 'rgba(255,255,255,.85)'; g.beginPath(); g.ellipse(x - k * .32, y - k * .42, k * .26, k * .18, -.6, 0, 7); g.fill();
    g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = Math.max(.8, k * .12);
    g.beginPath(); g.arc(x, y, k * .78, Math.PI * .2, Math.PI * .8); g.stroke();
    return (beadSprites[k] = c);
  }
  const edgeBias = () => { const u = Math.random(); return u < .5 ? Math.pow(u * 2, 1.6) / 2 : 1 - Math.pow((1 - u) * 2, 1.6) / 2; };
  function newBead() {
    const big = Math.random() < .3;
    return { x: edgeBias() * W, y: Math.random() < .5 ? edgeBias() * H : Math.random() * H,
             r: big ? rnd(4, 8) : rnd(1.5, 3.8), grow: rnd(.08, .3), slide: false, vy: 0, trail: [], life: 0, fade: 1 };
  }
  function stepRain(dt) {
    const { kind, level } = FX, soft = kind === 'drizzle' || level === 1;
    const wind = kind === 'storm' ? .3 : FX.wind ? .25 : .1;
    ctx.lineCap = 'round';
    for (const s of streaks) {
      const sp = (soft ? 420 : 650) + s.z * (soft ? 380 : 650);
      s.y += sp * dt; s.x -= sp * wind * dt;
      if (s.y > H + 30 || s.x < -60) Object.assign(s, newStreak(false));
      const len = (soft ? 8 : 14) + s.z * (soft ? 12 : 22);
      ctx.strokeStyle = `rgba(215,230,255,${(soft ? .14 : .18) + .26 * s.z})`; ctx.lineWidth = .5 + s.z;
      ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(s.x + len * wind, s.y - len); ctx.stroke();
    }
    const maxB = Math.round((kind === 'drizzle' ? 90 : [0, 80, 110, 140][level]) * W / 1920);
    if (beads.length < maxB && Math.random() < dt * (soft ? 10 : 16)) beads.push(newBead());
    for (let i = beads.length - 1; i >= 0; i--) {
      const b = beads[i]; b.life += dt;
      if (!b.slide) { b.r = Math.min(9, b.r + b.grow * dt); if (b.r > 6.5 && Math.random() < dt * .8) b.slide = true; }
      else {
        b.vy = Math.min(160, b.vy + 140 * dt); b.y += b.vy * dt; b.x += Math.sin(b.y * .07 + b.life) * .25;
        if (Math.random() < dt * 6) b.vy *= .3;                 // 멈칫멈칫 흘러내림
        b.trail.push([b.x, b.y]); if (b.trail.length > 60) b.trail.shift();
        b.r = Math.max(3, b.r - dt * .4);
        for (let j = beads.length - 1; j >= 0; j--) {
          const o = beads[j];
          if (o !== b && !o.slide && Math.hypot(o.x - b.x, o.y - b.y) < b.r + o.r) { b.r = Math.min(9, b.r + o.r * .25); beads.splice(j, 1); if (j < i) i--; }
        }
      }
      if (b.trail.length > 2) {
        ctx.strokeStyle = 'rgba(225,238,255,.13)'; ctx.lineWidth = Math.max(1.2, b.r * .55);
        ctx.beginPath(); b.trail.forEach(([x, y], k) => k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.stroke();
        for (let k = 0; k < b.trail.length; k += 9) { const [x, y] = b.trail[k]; ctx.drawImage(beadSprite(1.2), x - 3, y - 3); }
      }
      if (b.life > 70) b.fade -= dt * .5;
      ctx.globalAlpha = Math.max(0, b.fade);
      const sp = beadSprite(b.r); ctx.drawImage(sp, b.x - sp.width / 2, b.y - sp.height / 2);
      ctx.globalAlpha = 1;
      if (b.y > H + 12 || b.fade <= 0) beads.splice(i, 1);
    }
    if (kind === 'storm') stepLightning(dt);
  }
  function makeBolt() {
    const pts = [[rnd(W * .15, W * .85), -5]]; let [x, y] = pts[0];
    while (y < H * rnd(.55, .95)) { x += rnd(-40, 40); y += rnd(18, 40); pts.push([x, y]); }
    const branch = pts.slice(Math.floor(pts.length / 3)).slice(0, 4).map(([px, py], i) => [px + i * rnd(10, 25), py + i * rnd(15, 30)]);
    return { pts, branch, life: .35 };
  }
  function stepLightning(dt) {
    if (t > nextBolt) { bolt = makeBolt(); flash = 1; nextBolt = t + rnd(8, 18); }
    if (flash > 0) {
      const f = flash > .75 ? 1 : flash > .55 ? .25 : flash > .4 ? .7 : flash * .4;
      ctx.fillStyle = `rgba(225,235,255,${.18 * f})`; ctx.fillRect(0, 0, W, H);
      flash -= dt * 1.4;
    }
    if (bolt && bolt.life > 0) {
      bolt.life -= dt;
      ctx.save(); ctx.shadowColor = 'rgba(190,210,255,.9)'; ctx.shadowBlur = 18;
      for (const [line, w] of [[bolt.pts, 2.6], [bolt.branch, 1.4]]) {
        ctx.strokeStyle = `rgba(245,248,255,${Math.min(1, bolt.life * 4)})`; ctx.lineWidth = w;
        ctx.beginPath(); line.forEach(([x, y], k) => k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.stroke();
      }
      ctx.restore();
    }
  }

  // ---------- 눈 ----------
  function newFlake(any) {
    const layer = Math.random() < .1 ? 2 : Math.random() < .45 ? 1 : 0;
    return { x: rnd(-20, W + 20), y: any ? rnd(-20, H) : -12, layer, ph: rnd(0, 6.3),
             r: layer === 2 ? rnd(5, 9) : layer === 1 ? rnd(1.8, 3.2) : rnd(.8, 1.6),
             vy: layer === 2 ? rnd(40, 60) : layer === 1 ? rnd(28, 45) : rnd(14, 24) };
  }
  function panelTops() {
    const st = document.getElementById('stage'), sr = st.getBoundingClientRect(), k = sr.width / (st.offsetWidth || 1);
    return [...document.querySelectorAll('#root > .panel:not(.off)')].map(el => {
      const r = el.getBoundingClientRect();
      return { x0: (r.left - sr.left) / k + 10, x1: (r.right - sr.left) / k - 10, y: (r.top - sr.top) / k };
    });
  }
  function makeFrost() {
    const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
    for (const [cx, cy] of [[0, 0], [W, 0], [0, H], [W, H]]) {
      const gr = g.createRadialGradient(cx, cy, 0, cx, cy, H * .55);
      gr.addColorStop(0, 'rgba(235,245,255,.30)'); gr.addColorStop(1, 'rgba(235,245,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, W, H);
      g.strokeStyle = 'rgba(255,255,255,.22)'; g.lineWidth = 1;
      for (let i = 0; i < 26; i++) {
        let x = cx + rnd(-10, 10), y = cy + rnd(-10, 10), a = Math.atan2(H / 2 - cy, W / 2 - cx) + rnd(-.9, .9);
        g.beginPath(); g.moveTo(x, y);
        for (let j = 0; j < 6; j++) { x += Math.cos(a) * rnd(8, 18); y += Math.sin(a) * rnd(8, 18); a += rnd(-.5, .5); g.lineTo(x, y); }
        g.stroke();
      }
    }
    return c;
  }
  function stepSnow(dt) {
    if (!frost) frost = makeFrost();
    ctx.drawImage(frost, 0, 0);
    const gust = Math.sin(t * .35) * 22 + Math.sin(t * 1.3) * 8 + (FX.wind ? 40 : 0);
    if (!caps.length) caps = panelTops().map(p => ({ ...p, h: new Float32Array(48) }));
    for (const f of flakes) {
      f.ph += dt * (1.2 + f.layer * .4);
      f.y += f.vy * dt; f.x += (Math.sin(f.ph) * (8 + f.layer * 6) - gust * (.4 + f.layer * .35)) * dt;
      if (f.layer === 1) for (const c of caps) if (f.x > c.x0 && f.x < c.x1 && Math.abs(f.y - c.y) < 2) {
        const i = Math.floor((f.x - c.x0) / (c.x1 - c.x0) * c.h.length); c.h[i] = Math.min(7, c.h[i] + .35); Object.assign(f, newFlake(false));
      }
      if (f.y > H + 12) Object.assign(f, newFlake(false));
      if (f.x < -30) f.x = W + 20; if (f.x > W + 30) f.x = -20;
      if (f.layer === 2) {
        const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, f.r);
        g.addColorStop(0, 'rgba(255,255,255,.32)'); g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, 7); ctx.fill();
      } else { ctx.fillStyle = `rgba(255,255,255,${f.layer ? .88 : .5})`; ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, 7); ctx.fill(); }
    }
    for (const c of caps) {
      const n = c.h.length, w = (c.x1 - c.x0) / (n - 1);
      for (let i = 1; i < n - 1; i++) c.h[i] = c.h[i] * .9 + (c.h[i - 1] + c.h[i + 1]) * .05;
      ctx.beginPath(); ctx.moveTo(c.x0, c.y);
      for (let i = 0; i < n; i++) ctx.lineTo(c.x0 + i * w, c.y - c.h[i]);
      ctx.lineTo(c.x1, c.y); ctx.closePath(); ctx.fillStyle = 'rgba(250,252,255,.88)'; ctx.fill();
    }
  }

  // ---------- 안개 ----------
  function newFog(any) {
    const w = rnd(W * .45, W * .9);
    return { x: any ? rnd(-w, W) : W + 10, y: rnd(H * .15, H * .85), w, h: rnd(H * .4, H * .8), v: rnd(10, 20), ph: rnd(0, 6) };
  }
  function stepFog(dt) {
    for (let i = 0; i < fogs.length; i++) {
      const f = fogs[i]; f.x -= f.v * dt; f.ph += dt * .2;
      if (f.x < -f.w) fogs[i] = newFog(false);
      const y = f.y + Math.sin(f.ph) * 14, cx = f.x + f.w / 2;
      ctx.save(); ctx.translate(cx, y); ctx.scale(1, f.h / f.w);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, f.w / 2);
      g.addColorStop(0, 'rgba(228,234,242,.22)'); g.addColorStop(.6, 'rgba(228,234,242,.10)'); g.addColorStop(1, 'rgba(228,234,242,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, f.w / 2, 0, 7); ctx.fill(); ctx.restore();
    }
  }

  // ---------- 맑은 낮: 햇살 줄기 ----------
  function stepSun(dt) {
    const sx = W * .08, sy = -H * .5;
    for (const r of rays) {
      r.ph += dt * r.sp;
      const a = r.ang + Math.sin(r.ph) * .03, alpha = .045 + .035 * Math.sin(r.ph * 1.7);
      ctx.save(); ctx.translate(sx, sy); ctx.rotate(a);
      const g = ctx.createLinearGradient(0, 0, W * 1.2, 0);
      g.addColorStop(0, `rgba(255,236,190,${alpha * 1.6})`); g.addColorStop(.6, `rgba(255,236,190,${alpha})`); g.addColorStop(1, 'rgba(255,236,190,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(W * 1.2, -r.w); ctx.lineTo(W * 1.2, r.w); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
    const glow = ctx.createRadialGradient(sx, 0, 0, sx, 0, H * .9);
    glow.addColorStop(0, 'rgba(255,240,200,.16)'); glow.addColorStop(1, 'rgba(255,240,200,0)');
    ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);
  }

  // ---------- 맑은 밤: 별 ----------
  function stepNight(dt) {
    for (const s of stars) {
      s.ph += dt * s.sp;
      ctx.fillStyle = `rgba(255,255,240,${.25 + .5 * (.5 + .5 * Math.sin(s.ph))})`;
      ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, 7); ctx.fill();
    }
    if (!shoot && Math.random() < dt / 12) shoot = { x: rnd(W * .3, W), y: rnd(0, H * .25), life: 1 };
    if (shoot) {
      shoot.life -= dt * 1.3; shoot.x -= 600 * dt; shoot.y += 160 * dt;
      const g = ctx.createLinearGradient(shoot.x, shoot.y, shoot.x + 120, shoot.y - 32);
      g.addColorStop(0, `rgba(255,255,255,${Math.max(0, shoot.life)})`); g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.strokeStyle = g; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(shoot.x, shoot.y); ctx.lineTo(shoot.x + 120, shoot.y - 32); ctx.stroke();
      if (shoot.life <= 0) shoot = null;
    }
  }

  // ---------- 바람: 날리는 단풍잎 ----------
  const LEAF_COLORS = ['#d9542b', '#e8892f', '#c23b22', '#e6b13a', '#a8441c'];
  function newLeaf(any) {
    return { x: any ? rnd(0, W) : W + rnd(10, 200), y: rnd(-20, H * .9), s: rnd(6, 12), rot: rnd(0, 6.3), vr: rnd(-4, 4),
             vx: rnd(160, 300), ph: rnd(0, 6), col: LEAF_COLORS[Math.floor(Math.random() * LEAF_COLORS.length)] };
  }
  function stepLeaves(dt) {
    for (let i = 0; i < leaves.length; i++) {
      const l = leaves[i]; l.ph += dt * 2; l.x -= l.vx * dt; l.y += (Math.sin(l.ph) * 50 + 25) * dt; l.rot += l.vr * dt;
      if (l.x < -30 || l.y > H + 30) leaves[i] = newLeaf(false);
      ctx.save(); ctx.translate(l.x, l.y); ctx.rotate(l.rot); ctx.scale(1, .55 + .45 * Math.abs(Math.sin(l.ph * 1.3)));
      ctx.fillStyle = l.col; ctx.globalAlpha = .85;
      ctx.beginPath(); ctx.moveTo(0, -l.s); ctx.quadraticCurveTo(l.s * .9, 0, 0, l.s); ctx.quadraticCurveTo(-l.s * .9, 0, 0, -l.s); ctx.fill();
      ctx.strokeStyle = 'rgba(80,30,10,.5)'; ctx.lineWidth = .8; ctx.beginPath(); ctx.moveTo(0, -l.s); ctx.lineTo(0, l.s); ctx.stroke();
      ctx.restore(); ctx.globalAlpha = 1;
    }
  }

  // ---------- 강한 바람: 휘몰아치는 바람 줄기 ----------
  function stepGusts(dt) {
    if (Math.random() < dt * (FX.wind === 2 ? 3 : 1.2)) gusts.push({ x: W + rnd(0, 200), y: rnd(H * .05, H * .95), len: rnd(180, 420), amp: rnd(6, 18), ph: rnd(0, 6), v: rnd(700, 1100), life: 0 });
    for (let i = gusts.length - 1; i >= 0; i--) {
      const g = gusts[i]; g.x -= g.v * dt; g.life += dt;
      if (g.x < -g.len - 50) { gusts.splice(i, 1); continue; }
      const grad = ctx.createLinearGradient(g.x, 0, g.x + g.len, 0);
      grad.addColorStop(0, 'rgba(255,255,255,0)'); grad.addColorStop(.3, `rgba(255,255,255,${FX.wind === 2 ? .3 : .2})`); grad.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.strokeStyle = grad; ctx.lineWidth = 1.4; ctx.lineCap = 'round';
      ctx.beginPath();
      for (let k = 0; k <= 24; k++) { const x = g.x + g.len * k / 24, y = g.y + Math.sin(k / 24 * 6 + g.ph + g.life * 3) * g.amp * (k / 24);
        k ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
      if (Math.random() < .5) {   // 끝이 말려 올라가는 소용돌이
        const ex = g.x + g.len, ey = g.y + Math.sin(6 + g.ph + g.life * 3) * g.amp;
        ctx.arc(ex - 10, ey - 10, 10, Math.PI * .5, Math.PI * 2.1, true);
      }
      ctx.stroke();
    }
  }

  function seed() {
    resize();
    streaks = []; beads = []; flakes = []; clouds = []; fogs = []; caps = []; stars = []; leaves = []; rays = []; bolt = null; flash = 0; frost = null;
    const { kind, level } = FX, area = W * H / (1920 * 440);
    if (isRain(kind)) {
      const n = Math.round((kind === 'drizzle' ? 80 : [0, 90, 170, 260][level]) * area);
      for (let i = 0; i < n; i++) streaks.push(newStreak(true));
      for (let i = 0; i < 25; i++) beads.push(newBead());
    }
    if (kind === 'snow') { const n = Math.round([0, 90, 160, 240][level] * area); for (let i = 0; i < n; i++) flakes.push(newFlake(true)); }
    const nc = kind === 'cloud' ? [0, 4, 6, 8][level] : kind === 'storm' ? 8 : isRain(kind) ? 6 : kind === 'snow' ? 4 : kind === 'fog' ? 2 : 0;
    for (let i = 0; i < nc; i++) clouds.push(newCloud(true, i));
    if (kind === 'fog') for (let i = 0; i < 7; i++) fogs.push(newFog(true));
    if (kind === 'sunny') for (let i = 0; i < 5; i++) rays.push({ ang: rnd(.12, .5), w: rnd(30, 90), ph: rnd(0, 6), sp: rnd(.2, .5) });
    if (kind === 'night') for (let i = 0; i < Math.round(70 * area); i++) stars.push({ x: rnd(0, W), y: rnd(0, H * .35), r: rnd(.5, 1.4), ph: rnd(0, 6), sp: rnd(1, 3) });
    if (FX.wind) for (let i = 0; i < 10 * FX.wind; i++) leaves.push(newLeaf(true));
    gusts = [];
  }

  function frame(now) {
    raf = 0;
    if (!FX.on || FX.kind === 'none' || window.NIGHT_ON) { if (ctx) ctx.clearRect(0, 0, W, H); return; }
    const dt = Math.min(.05, (now - (last || now)) / 1000); last = now; t += dt;
    resize();
    ctx.clearRect(0, 0, W, H);
    if (FX.kind === 'sunny') stepSun(dt);
    if (FX.kind === 'night') stepNight(dt);
    stepFog(dt);
    stepClouds(dt);
    if (isRain(FX.kind)) stepRain(dt);
    if (FX.kind === 'snow') stepSnow(dt);
    if (FX.wind) { stepGusts(dt); stepLeaves(dt); }
    raf = requestAnimationFrame(frame);
  }
  function start() { ensure(); seed(); if (!raf) { last = 0; raf = requestAnimationFrame(frame); } }

  let auto = null, previewUntil = 0;
  // index.html 의 loadWeather 에서 호출: (날씨 코드, 낮=1/밤=0, 풍속 km/h)
  window.updateWeatherFx = function (code, isDay, wind) {
    auto = [code, isDay, wind];
    if (Date.now() < previewUntil) return;
    const [k, l, w] = classify(code, isDay, wind);
    if (k === FX.kind && l === FX.level && w === FX.wind && raf) return;
    FX.kind = k; FX.level = l; FX.wind = w; start();
  };
  window.setWeatherFx = function (kind, level = 2, wind = 0) { FX.kind = kind; FX.level = level; FX.wind = wind; start(); };
  window.weatherFxOn = function (on) { FX.on = !!on; start(); };
  // 설정의 '미리보기': kind 를 secs 초 동안 보여 주고 실제 날씨로 돌아간다 ('wind' = 맑은 낮 + 낙엽)
  window.previewWeatherFx = function (kind, secs = 30) {
    previewUntil = Date.now() + secs * 1000;
    const wasOn = FX.on; FX.on = true;
    FX.kind = kind === 'wind' ? 'sunny' : kind; FX.level = (kind === 'drizzle' || kind === 'rain') ? 1 : 3; FX.wind = kind === 'wind' ? 2 : 0;
    start();
    clearTimeout(window.__wfxPv);
    window.__wfxPv = setTimeout(() => {
      previewUntil = 0; FX.on = wasOn;
      if (auto) { FX.kind = ''; window.updateWeatherFx(...auto); } else { FX.kind = 'none'; start(); }
    }, secs * 1000);
  };
  window.addEventListener('resize', () => { caps = []; frost = null; });
  setInterval(() => { if (FX.kind === 'snow' && panelTops().length !== caps.length) caps = []; }, 5000);
  setInterval(() => { if (FX.on && FX.kind !== 'none' && !window.NIGHT_ON && !raf) start(); }, 20000);
})();
