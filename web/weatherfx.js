// 날씨 연출: 지금 날씨에 맞춰 화면 맨 앞에 그린다. 글자를 크게 가리지 않게 반투명·가장자리 위주.
//   구름   — 안개보다 조금 진하고 작은 솜털 구름이 둥둥 떠다니며 지나감 (흐림일수록 많고 진하게)
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

  // ---------- 구름: 안개보다 조금 진하고 작은 솜털 같은 구름 덩어리가 둥둥 떠다닌다 ----------
  // (윤곽이 있는 그림 구름은 쓰지 않는다 — 사용자 요청)
  function newCloud(any) {
    const dark = FX.kind === 'storm' || (isRain(FX.kind) && Math.random() < .6);
    const w = rnd(W * .14, W * .26), h = w * rnd(.35, .5);
    // 덩어리 3~4개를 겹쳐 모양이 둥글지 않고 자연스럽게
    const blobs = Array.from({ length: 3 + Math.floor(Math.random() * 2) }, () => [rnd(-.3, .3), rnd(-.18, .18), rnd(.45, .7)]);
    const dens = FX.kind === 'storm' ? .42 : FX.kind === 'cloud' ? [0, .176, .216, .248][FX.level] : isRain(FX.kind) ? .34 : .28;
    return { x: any ? rnd(-w, W) : W + rnd(20, 240), y: rnd(H * .08, H * .92), w, h, blobs,
             col: dark ? '150,158,170' : '236,240,246', a: dens * rnd(.85, 1.1),
             v: rnd(9, 18) * (FX.wind ? 1 + FX.wind * 1.5 : 1), ph: rnd(0, 6.3), bob: rnd(5, 12), bs: rnd(.25, .45) };
  }
  function stepClouds(dt) {
    for (let i = 0; i < clouds.length; i++) {
      const c = clouds[i]; c.x -= c.v * dt; c.ph += dt * c.bs;
      if (c.x < -c.w * 1.4) clouds[i] = newCloud(false);
      const cy = c.y + Math.sin(c.ph) * c.bob, s = 1 + Math.sin(c.ph * .7) * .04;   // 둥둥 오르내리며 살짝 부풀었다 줄었다
      for (const [dx, dy, r] of c.blobs) {
        const x = c.x + dx * c.w, y = cy + dy * c.h * 2, rx = c.w * r * s, ry = c.h * r * s * 1.6;
        ctx.save(); ctx.translate(x, y); ctx.scale(1, ry / rx);
        const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
        g.addColorStop(0, `rgba(${c.col},${c.a})`); g.addColorStop(.5, `rgba(${c.col},${c.a * .6})`); g.addColorStop(1, `rgba(${c.col},0)`);
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, rx, 0, 7); ctx.fill(); ctx.restore();
      }
    }
  }

  // ---------- 비 ----------
  function newStreak(any) { return { x: rnd(-40, W + 80), y: any ? rnd(-H, H) : rnd(-H * .6, -20), z: Math.random() }; }
  // 유리창 물방울: 뒤 배경이 거꾸로·작게 비치는 렌즈(굴절) + 얇은 어두운 테두리 + 아래쪽 빛 모임 + 작은 반짝임
  let bgCv = null, bgSrc = '';
  function ensureBg() {   // 배경 사진을 무대 크기로 한 장 그려 둔다 (방울 속 굴절용)
    const el = document.getElementById('bg'); if (!el || !W) return;
    const m = getComputedStyle(el).backgroundImage.match(/url\("?(.*?)"?\)/), src = m ? m[1] : '';
    if (!src || (src === bgSrc && bgCv && bgCv.width === W && bgCv.height === H)) return;
    bgSrc = src; const im = new Image();
    im.onload = () => { const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
      const s = Math.max(W / im.width, H / im.height), w = im.width * s, h = im.height * s; g.drawImage(im, (W - w) / 2, (H - h) / 2, w, h);
      bgCv = c; beads.forEach(b => b.sp = null); };
    im.src = src;
  }
  function blob(g, b, cx, cy, r) {   // 완전한 원이 아니라 살짝 일그러지고 아래가 처진 모양
    g.beginPath();
    for (let k = 0; k <= 22; k++) {
      const th = k / 22 * Math.PI * 2, s = Math.sin(th);
      const rr = r * (1 + b.w1 * Math.sin(2 * th + b.p1) + b.w2 * Math.sin(3 * th + b.p2)) * (s > 0 ? 1 + .08 * s : 1 + .03 * s);
      const dx = Math.cos(th) * rr, dy = s * rr * b.el;   // el: 세로로 길쭉한 방울
      const x = cx + dx * Math.cos(b.tilt) - dy * Math.sin(b.tilt), y = cy + dx * Math.sin(b.tilt) + dy * Math.cos(b.tilt); k ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.closePath();
  }
  const DROP = .5;   // 물방울 크기 배율 (계산은 그대로, 그릴 때만 줄임)
  function dropSprite(b) {
    const r = b.r * DROP, s = Math.ceil(r * 2.6 * b.el + 8), c = document.createElement('canvas'); c.width = c.height = s;
    const g = c.getContext('2d'), cx = s / 2, cy = s / 2;
    if (r < .9) {   // 아주 작은 물안개 방울: 밝은 점 + 어두운 가장자리
      const gr = g.createRadialGradient(cx - r * .2, cy - r * .2, 0, cx, cy, r * 1.15);
      gr.addColorStop(0, 'rgba(255,255,255,.75)'); gr.addColorStop(.55, 'rgba(230,238,250,.35)'); gr.addColorStop(1, 'rgba(10,15,25,.35)');
      g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, r * 1.15, 0, 7); g.fill(); return c;
    }
    // 유리에 붙은 방울 아래로 떨어지는 옅은 그림자
    const sh = g.createRadialGradient(cx + r * .1, cy + r * .3, r * .3, cx + r * .1, cy + r * .3, r * 1.25);
    sh.addColorStop(0, 'rgba(0,0,0,.16)'); sh.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = sh; g.fillRect(0, 0, s, s);
    g.save(); blob(g, b, cx, cy, r); g.clip();
    if (bgCv) {   // 렌즈: 주변(반지름의 약 5배 범위)을 뒤집어 작게 비춤 → 방울 속이 밝고 선명하게
      const R = r * 5; g.save(); g.translate(cx, cy); g.scale(-1, -1);
      g.drawImage(bgCv, b.x - R, b.y - R * .8, R * 2, R * 1.6, -r * 1.15, -r * 1.15, r * 2.3, r * 2.3); g.restore();
      g.globalCompositeOperation = 'lighter'; g.fillStyle = 'rgba(38,42,50,.6)'; g.fillRect(0, 0, s, s); g.globalCompositeOperation = 'source-over';
    } else { g.fillStyle = 'rgba(205,218,236,.42)'; g.fillRect(0, 0, s, s); }
    const rim = g.createRadialGradient(cx, cy + r * .1, r * .35, cx, cy, r * 1.1 * b.el);   // 테두리는 진하게 어둡게 (특히 위쪽)
    rim.addColorStop(0, 'rgba(0,0,0,0)'); rim.addColorStop(.6, 'rgba(0,0,0,.22)'); rim.addColorStop(.86, 'rgba(0,0,0,.58)'); rim.addColorStop(1, 'rgba(0,0,0,.85)');
    g.fillStyle = rim; g.fillRect(0, 0, s, s);
    const top = g.createLinearGradient(0, cy - r * b.el, 0, cy + r * .2);
    top.addColorStop(0, 'rgba(0,0,0,.45)'); top.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = top; g.fillRect(0, 0, s, s);
    const cau = g.createRadialGradient(cx + r * .08, cy + r * .48, 0, cx + r * .08, cy + r * .48, r * .62);   // 아래쪽에 빛이 모임
    cau.addColorStop(0, 'rgba(255,255,255,.7)'); cau.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = cau; g.fillRect(0, 0, s, s);
    g.restore();
    g.save(); g.translate(cx, cy); g.rotate(b.tilt);   // 아래쪽 가장자리의 밝은 빛 띠
    g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = Math.max(.7, r * .14); g.lineCap = 'round';
    g.beginPath(); g.ellipse(0, r * .05, r * .78, r * .82 * b.el, 0, Math.PI * .2, Math.PI * .8); g.stroke(); g.restore();
    g.fillStyle = 'rgba(255,255,255,.92)';   // 작고 또렷한 반짝임
    g.beginPath(); g.ellipse(cx - r * .36, cy - r * .4, Math.max(.5, r * .2), Math.max(.4, r * .13), -.6, 0, 7); g.fill();
    return c;
  }
  const edgeBias = () => { const u = Math.random(); return u < .5 ? Math.pow(u * 2, 1.35) / 2 : 1 - Math.pow((1 - u) * 2, 1.35) / 2; };
  function newBead(o) {
    const r = o && o.r || .9 + Math.pow(Math.random(), 1.8) * 7.2;   // 작은 방울이 많고, 큰 방울도 섞임
    return Object.assign({ x: Math.random() < .6 ? edgeBias() * W : Math.random() * W, y: Math.random() * H, r,
      w1: rnd(-.07, .07), w2: rnd(-.045, .045), p1: rnd(0, 6), p2: rnd(0, 6), el: Math.random() < .35 ? rnd(1.15, 1.6) : rnd(.95, 1.1), tilt: rnd(-.25, .25), grow: Math.random() < .12 ? rnd(.05, .18) : 0,
      slide: false, vy: 0, trail: [], dropT: 0, life: 0, fade: 1, a: 0, sp: null, spR: 0, spY: 0,
      drift: rnd(1.5, 4) + r * rnd(.6, 1.4), wob: rnd(0, 6) }, o || {});
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
    ensureBg();
    const maxB = Math.round((kind === 'drizzle' ? 760 : [0, 720, 1000, 1250][level]) * W * H / (1920 * 440));
    if (beads.length < maxB && Math.random() < dt * maxB / 30) beads.push(newBead());   // 30초쯤이면 창이 촘촘해짐
    let sliding = 0;
    for (let i = beads.length - 1; i >= 0; i--) {
      const b = beads[i]; b.life += dt; b.a = Math.min(1, b.a + dt * 1.5);
      if (!b.slide) {
        b.y += b.drift * dt; b.x += Math.sin(b.life * .35 + b.wob) * .03;   // 멈춰 있지 않고 아주 천천히 흘러내림
        if (b.y > H + 10) { b.y = -10; b.x = Math.random() * W; b.sp = null; }
        if (b.grow) { b.r = Math.min(7.5, b.r + b.grow * dt); if (b.r > 5.4 && Math.random() < dt * .25) b.slide = true; }
      } else {
        sliding++;
        b.vy = Math.min(140, b.vy + 120 * dt); b.y += b.vy * dt; b.x += Math.sin(b.y * .06 + b.life) * .2;
        if (Math.random() < dt * 5) b.vy *= .25;                 // 멈칫멈칫 흘러내림
        b.trail.push([b.x, b.y]); if (b.trail.length > 70) b.trail.shift();
        b.dropT += b.vy * dt;
        if (b.dropT > 12) { b.dropT = 0; b.r = Math.max(2.6, b.r - .12);   // 지나간 자리에 아주 작은 방울을 남김
          beads.push(newBead({ x: b.x + rnd(-1, 1), y: b.y - b.r * 1.4 * DROP, r: rnd(.7, 1.6), a: 1 })); }
        for (let j = beads.length - 1; j >= 0; j--) {
          const o = beads[j];
          if (o !== b && !o.slide && Math.abs(o.x - b.x) < (b.r + o.r) * DROP && Math.abs(o.y - b.y) < (b.r + o.r) * DROP && o.r > 1.3) {
            b.r = Math.min(8, Math.sqrt(b.r * b.r + o.r * o.r * .5)); beads.splice(j, 1); if (j < i) i--; }
        }
        b.sp = null;
      }
      if (b.trail.length > 2) {   // 흘러간 자리의 젖은 자국 (아주 옅게)
        ctx.strokeStyle = 'rgba(230,240,255,.07)'; ctx.lineWidth = Math.max(.8, b.r * .5 * DROP);
        ctx.beginPath(); b.trail.forEach(([x, y], k) => k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.stroke();
      }
      if (b.life > 150) b.fade -= dt * .25;
      if (!b.sp || Math.abs(b.r - b.spR) > .35 || Math.abs(b.y - b.spY) > 14) { b.sp = dropSprite(b); b.spR = b.r; b.spY = b.y; }   // 굴절 모습은 조금씩 움직일 때마다 갱신
      ctx.globalAlpha = Math.max(0, b.a * b.fade);
      ctx.drawImage(b.sp, b.x - b.sp.width / 2, b.y - b.sp.height / 2);
      ctx.globalAlpha = 1;
      if (b.y > H + 12 || b.fade <= 0) beads.splice(i, 1);
    }
    if (sliding < 2 && Math.random() < dt * .15) {   // 가끔 큰 방울 하나가 흘러내리기 시작
      const big = beads.find(b => !b.slide && b.r > 4.2); if (big) big.slide = true;
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
      const n0 = Math.round((kind === 'drizzle' ? 620 : 700) * area);   // 시작부터 창에 방울이 맺혀 있게
      for (let i = 0; i < n0; i++) beads.push(newBead({ a: 1, life: rnd(0, 60) }));
    }
    if (kind === 'snow') { const n = Math.round([0, 90, 160, 240][level] * area); for (let i = 0; i < n; i++) flakes.push(newFlake(true)); }
    const nc = kind === 'cloud' ? [0, 4, 6, 7][level] : kind === 'storm' ? 8 : isRain(kind) ? 6 : kind === 'snow' ? 4 : kind === 'fog' ? 3 : 0;
    for (let i = 0; i < nc; i++) clouds.push(newCloud(true));
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
