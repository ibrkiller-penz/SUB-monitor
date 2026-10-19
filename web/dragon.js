// 화면 잔상(번인) 방지: 10분마다 동양 용이 오른쪽에서 왼쪽으로 물결치며 지나간다.
// 세로 모드에서는 아래에서 위로 지나간다. 지나가는 동안 화면을 살짝 어둡게 해 같은 픽셀이 계속 밝지 않게 한다.
(function () {
  // 설정(⚙ > 화면 보호 용): 몇 분마다(0 = 끔), 영상 파일(exe 옆 dragon.mp4 → 있으면 그림 대신 영상)
  const CFG = window.DRAGON_CFG = window.DRAGON_CFG || { min: 10, video: '' };
  const DURATION = 13000;            // 한 번 지나가는 시간(ms)
  const N = 84;                      // 몸통 표본 수
  const STEP = 13;                   // 표본 간격(px) → 몸 길이 약 1090px
  const R = 25;                      // 몸통 최대 반폭(px)

  const C = {
    body0: '#0d3b3a', body1: '#16615b', body2: '#2a9a86', hi: '#8fe0c4',
    scale: 'rgba(4,28,27,.55)', scaleHi: 'rgba(214,190,120,.45)',
    belly0: '#f3d58a', belly1: '#c99a3d', plate: 'rgba(120,80,20,.55)',
    fire0: '#ffe08a', fire1: '#ff8a2a', fire2: '#c3231b',
    gold: '#f2c35b', gold2: '#a8781f', horn0: '#fff0c4', horn1: '#c79a45',
  };

  let cv, ctx, running = false;
  function ensureCanvas() {
    if (cv) return;
    cv = document.createElement('canvas');
    cv.id = 'dragon';
    cv.style.cssText = 'position:absolute;inset:0;z-index:50;pointer-events:none;opacity:0;transition:opacity .8s';
    document.getElementById('stage').appendChild(cv);
    ctx = cv.getContext('2d');
  }

  // 몸 굵기: 목은 조금 가늘고, 어깨~허리가 가장 굵고, 꼬리로 갈수록 가늘게
  const prof = k => k < 0.1 ? 0.72 + 2.6 * k : Math.max(0.1, 1 - 0.9 * Math.pow((k - 0.1) / 0.9, 1.35));

  // 영상 용: exe 옆 dragon.mp4 (크로마키 초록 배경 권장, 검은 배경도 됨)를 오른쪽 → 왼쪽으로 옮긴다.
  // 첫 프레임 모서리 색을 보고 초록이면 크로마키로 초록을 지우고, 어두우면 '스크린' 합성으로 검은색을 투명처럼 보이게 한다.
  function flyVideo() {
    const st = document.getElementById('stage');
    const portrait = document.body.classList.contains('portrait');
    const W = st.offsetWidth, H = st.offsetHeight;
    const v = document.createElement('video');
    v.src = CFG.video; v.muted = true; v.loop = true; v.playsInline = true; v.autoplay = true;
    v.style.cssText = 'position:absolute;width:2px;height:2px;opacity:0;pointer-events:none';
    const dim = document.createElement('div');
    dim.style.cssText = 'position:absolute;inset:0;z-index:49;pointer-events:none;background:#000;opacity:0;transition:opacity 1s';
    const out = document.createElement('canvas');
    out.style.cssText = 'position:absolute;left:0;top:0;z-index:50;pointer-events:none;transform-origin:0 0';
    st.appendChild(v); st.appendChild(dim); st.appendChild(out);
    const octx = out.getContext('2d', { willReadFrequently: true });
    running = true;
    let started = false, mode = '';
    const cleanup = () => { dim.remove(); v.remove(); out.remove(); running = false; };
    v.onerror = () => { cleanup(); CFG.video = ''; fly(); };
    v.onloadeddata = () => {
      if (started) return; started = true;
      const ar = v.videoWidth / v.videoHeight || 16 / 9;
      const vh = Math.round((portrait ? W : H) * 0.8), vw = Math.round(vh * ar);   // 위아래로 크게 움직일 여유를 두고 조금 작게
      // 크로마키 계산량을 줄이려고 영상은 화면 크기로 줄여서 처리
      out.width = vw; out.height = vh;
      dim.style.opacity = '.38';
      v.play().catch(() => {});
      const t0 = performance.now(), dur = DURATION + 2000, Lz = (portrait ? H : W) + vw;
      (function step(now) {
        const p = (now - t0) / dur;
        if (p >= 1) { dim.style.opacity = '0'; out.style.opacity = '0'; setTimeout(cleanup, 1000); return; }
        octx.clearRect(0, 0, vw, vh);
        octx.drawImage(v, 0, 0, vw, vh);
        if (!mode) {   // 모서리 네 곳 평균 색으로 배경 판단
          let r = 0, g = 0, b = 0;
          for (const [x, y] of [[2, 2], [vw - 3, 2], [2, vh - 3], [vw - 3, vh - 3]]) { const d = octx.getImageData(x, y, 1, 1).data; r += d[0]; g += d[1]; b += d[2]; }
          const a0 = octx.getImageData(2, 2, 1, 1).data[3];
          mode = a0 < 20 ? 'alpha'                                  // 투명 배경 영상(webm): 그대로
            : (g > 4 * 150 && g > r * 1.4 && g > b * 1.4) ? 'green' : 'black';
          out.style.mixBlendMode = mode === 'black' ? 'screen' : 'normal';
        }
        if (mode === 'green') {
          const img = octx.getImageData(0, 0, vw, vh), d = img.data;
          for (let k = 0; k < d.length; k += 4) {
            const r = d[k], g = d[k + 1], b = d[k + 2], m = Math.max(r, b);
            const ex = g - m;                         // 초록이 얼마나 튀는지
            if (ex > 24) { d[k + 3] = Math.max(0, 255 - (ex - 24) * 7); d[k + 1] = Math.min(g, m + 8); }   // 초록이 튀는 만큼 투명 + 초록 번짐 제거
          }
          octx.putImageData(img, 0, 0);
        }
        const s = (portrait ? H : W) - p * Lz;
        // 물결 비행: 크게 오르내리고, 내려갈 때는 머리를 숙이고 올라갈 때는 머리를 든다
        const side = portrait ? W : H, A = side * 0.1, w = Math.PI * 2 * 2.2;
        const yy = A * Math.sin(w * p) + A * 0.25 * Math.sin(w * 2.3 * p + 1);
        const vy = A * w * Math.cos(w * p) + A * 0.25 * w * 2.3 * Math.cos(w * 2.3 * p + 1);   // 세로 속도(진행 1당)
        const tilt = Math.max(-14, Math.min(14, -Math.atan2(vy, Lz) * 180 / Math.PI * 2.4));   // 기울기(도)
        out.style.transformOrigin = '50% 50%';
        out.style.transform = portrait
          ? `translate(${(W - vw) / 2 + yy}px, ${s + vw / 2 - vh / 2}px) rotate(${90 + tilt}deg)`
          : `translate(${s}px, ${(H - vh) / 2 + yy}px) rotate(${tilt}deg)`;
        requestAnimationFrame(step);
      })(t0);
    };
  }

  function fly() {
    if (running) return;
    if (CFG.video) return flyVideo();
    ensureCanvas();
    const st = document.getElementById('stage');
    const portrait = document.body.classList.contains('portrait');
    const W = st.offsetWidth, H = st.offsetHeight;
    cv.width = W; cv.height = H;
    const L = portrait ? H : W, mid = portrait ? W / 2 : H / 2;
    const amp = (portrait ? W : H) * 0.24;
    const total = L + N * STEP + 520;
    const t0 = performance.now();
    running = true;
    cv.style.opacity = '1';

    const wave = (s, t) => mid + amp * Math.sin(s / 170 - t * 2.6) + amp * 0.22 * Math.sin(s / 67 + t * 1.5);
    const pt = (s, t) => portrait ? [wave(s, t), L + 260 - s] : [L + 260 - s, wave(s, t)];

    function frame(now) {
      const p = (now - t0) / DURATION;
      if (p >= 1) { cv.style.opacity = '0'; setTimeout(() => { ctx.clearRect(0, 0, W, H); running = false; }, 900); return; }
      const t = (now - t0) / 1000;
      const head = p * total;
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = `rgba(0,0,0,${Math.sin(Math.PI * p) * 0.38})`;
      ctx.fillRect(0, 0, W, H);

      // 등뼈 표본: 위치·진행방향(머리 쪽)·등 쪽 법선·반폭
      const S = [];
      for (let i = 0; i <= N; i++) {
        const [x, y] = pt(head - i * STEP, t);
        const [ax, ay] = pt(head - (i - 1) * STEP, t), [bx, by] = pt(head - (i + 1) * STEP, t);
        let tx = ax - bx, ty = ay - by; const l = Math.hypot(tx, ty) || 1; tx /= l; ty /= l;
        S.push({ x, y, tx, ty, nx: ty, ny: -tx, w: R * prof(i / N), k: i / N });
      }
      // 등 쪽(n)이 화면 위가 되도록 법선 방향 통일
      if (!portrait) for (const s of S) if (s.tx > 0) { s.nx = -s.nx; s.ny = -s.ny; }

      drawClouds(S, t);
      drawLegs(S, t, false);         // 뒤쪽 다리(몸 뒤)
      drawFins(S, t);
      drawBody(S);
      drawLegs(S, t, true);          // 앞쪽 다리
      drawTail(S, t);
      drawHead(S[0], t);
      drawPearl(pt(head + 175, t), t);
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  function bodyPath(S, f = 1) {
    ctx.beginPath();
    ctx.moveTo(S[0].x + S[0].nx * S[0].w * f, S[0].y + S[0].ny * S[0].w * f);
    for (const s of S) ctx.lineTo(s.x + s.nx * s.w * f, s.y + s.ny * s.w * f);
    const e = S[S.length - 1];
    ctx.lineTo(e.x - e.tx * 6, e.y - e.ty * 6);
    for (let i = S.length - 1; i >= 0; i--) { const s = S[i]; ctx.lineTo(s.x - s.nx * s.w * f, s.y - s.ny * s.w * f); }
    ctx.closePath();
  }

  function drawBody(S) {
    // 그림자 테두리
    ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.55)'; ctx.shadowBlur = 18;
    bodyPath(S, 1.06); ctx.fillStyle = C.body0; ctx.fill(); ctx.restore();
    bodyPath(S); ctx.fillStyle = C.body1; ctx.fill();
    ctx.save(); bodyPath(S); ctx.clip();
    // 등 쪽 밝은 띠
    ctx.beginPath();
    S.forEach((s, i) => { const x = s.x + s.nx * s.w * .45, y = s.y + s.ny * s.w * .45; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.strokeStyle = C.body2; ctx.lineWidth = 2; ctx.stroke();
    for (const s of S) { ctx.fillStyle = 'rgba(42,154,134,.35)'; ctx.beginPath(); ctx.arc(s.x + s.nx * s.w * .4, s.y + s.ny * s.w * .4, s.w * .45, 0, 7); ctx.fill(); }
    // 비늘: 머리 쪽으로 열린 반달 무늬
    for (let i = 1; i < S.length - 1; i++) {
      const s = S[i]; const a = Math.atan2(s.ty, s.tx);
      for (const off of (i % 2 ? [-.05, .55] : [.25, .8])) {
        const cx = s.x + s.nx * s.w * off, cy = s.y + s.ny * s.w * off, r = Math.max(3, s.w * .34);
        ctx.beginPath(); ctx.arc(cx, cy, r, a + Math.PI * .5, a + Math.PI * 1.5); ctx.strokeStyle = C.scale; ctx.lineWidth = 1.6; ctx.stroke();
        ctx.beginPath(); ctx.arc(cx, cy, r * .82, a + Math.PI * .75, a + Math.PI * 1.1); ctx.strokeStyle = C.scaleHi; ctx.lineWidth = 1; ctx.stroke();
      }
    }
    // 배: 금빛 판
    ctx.beginPath();
    S.forEach((s, i) => { const x = s.x - s.nx * s.w * .15, y = s.y - s.ny * s.w * .15; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    for (let i = S.length - 1; i >= 0; i--) { const s = S[i]; ctx.lineTo(s.x - s.nx * s.w * 1.1, s.y - s.ny * s.w * 1.1); }
    ctx.closePath();
    ctx.fillStyle = C.belly0; ctx.fill();
    for (let i = 0; i < S.length; i++) {
      const s = S[i];
      ctx.beginPath(); ctx.moveTo(s.x - s.nx * s.w * .15, s.y - s.ny * s.w * .15); ctx.lineTo(s.x - s.nx * s.w, s.y - s.ny * s.w);
      ctx.strokeStyle = C.plate; ctx.lineWidth = 1.4; ctx.stroke();
    }
    ctx.beginPath();
    S.forEach((s, i) => { const x = s.x - s.nx * s.w * .78, y = s.y - s.ny * s.w * .78; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.strokeStyle = 'rgba(160,110,30,.5)'; ctx.lineWidth = s0w(S) * .5; ctx.stroke();
    ctx.restore();
    // 몸 테두리 금선
    bodyPath(S); ctx.strokeStyle = 'rgba(242,195,91,.35)'; ctx.lineWidth = 1.2; ctx.stroke();
  }
  const s0w = S => Math.max(2, S[10].w * .25);

  function fireGrad(x0, y0, x1, y1) {
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, C.fire2); g.addColorStop(.55, C.fire1); g.addColorStop(1, C.fire0);
    return g;
  }

  // 등지느러미: 불꽃처럼 일렁이는 갈기
  function drawFins(S, t) {
    for (let i = 2; i < S.length - 4; i += 2) {
      const s = S[i], h = 10 + 22 * prof(s.k) + 5 * Math.sin(t * 7 + i * .6);
      const bx = s.x + s.nx * s.w * .8, by = s.y + s.ny * s.w * .8;
      const tipx = bx + s.nx * h - s.tx * h * .9, tipy = by + s.ny * h - s.ty * h * .9;
      const nx2 = S[i + 2];
      ctx.beginPath(); ctx.moveTo(bx, by);
      ctx.quadraticCurveTo(bx + s.nx * h * .9, by + s.ny * h * .9, tipx, tipy);
      ctx.quadraticCurveTo(bx + s.nx * h * .3 - s.tx * h, by + s.ny * h * .3 - s.ty * h, nx2.x + nx2.nx * nx2.w * .8, nx2.y + nx2.ny * nx2.w * .8);
      ctx.closePath(); ctx.fillStyle = fireGrad(bx, by, tipx, tipy); ctx.globalAlpha = .92; ctx.fill(); ctx.globalAlpha = 1;
    }
  }

  // 다리: 어깨 → 팔꿈치(불꽃 털) → 발(금빛 발톱 4개)
  function drawLegs(S, t, front) {
    for (const [idx, ph] of [[Math.round(N * .17), 0], [Math.round(N * .56), 2.2]]) {
      const s = S[idx]; if (!s) continue;
      const side = front ? 1 : -1;
      const sw = Math.sin(t * 4.5 + ph + (front ? 0 : 1.6));
      const sx = s.x - s.nx * s.w * .3 + s.tx * side * 4, sy = s.y - s.ny * s.w * .3 + s.ty * side * 4;
      const ex = sx - s.nx * (s.w + 14) - s.tx * (14 + 10 * sw), ey = sy - s.ny * (s.w + 14) - s.ty * (14 + 10 * sw);
      const fx = ex - s.nx * 16 + s.tx * (22 + 8 * sw), fy = ey - s.ny * 16 + s.ty * (22 + 8 * sw);
      const col = front ? C.body1 : C.body0;
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.strokeStyle = C.body0; ctx.lineWidth = 15; ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.lineTo(fx, fy); ctx.stroke();
      ctx.strokeStyle = col; ctx.lineWidth = 11; ctx.stroke();
      // 팔꿈치 불꽃
      ctx.beginPath(); ctx.moveTo(ex, ey);
      ctx.quadraticCurveTo(ex + s.tx * -18 - s.nx * 4, ey + s.ty * -18 - s.ny * 4, ex - s.tx * 30 + s.nx * 6, ey - s.ty * 30 + s.ny * 6 + 3 * sw);
      ctx.quadraticCurveTo(ex - s.tx * 12, ey - s.ty * 12, ex, ey);
      ctx.fillStyle = fireGrad(ex, ey, ex - s.tx * 30, ey - s.ty * 30); ctx.fill();
      // 발톱
      const fa = Math.atan2(fy - ey, fx - ex);
      ctx.strokeStyle = C.gold; ctx.lineWidth = 3;
      for (const d of [-.7, -.25, .2, .65]) {
        const a = fa + d, cx1 = fx + Math.cos(a) * 9, cy1 = fy + Math.sin(a) * 9;
        ctx.beginPath(); ctx.moveTo(fx, fy); ctx.quadraticCurveTo(cx1, cy1, cx1 + Math.cos(a + 1.2) * 6, cy1 + Math.sin(a + 1.2) * 6); ctx.stroke();
      }
    }
  }

  function drawTail(S, t) {
    const e = S[S.length - 1];
    for (let j = -2; j <= 2; j++) {
      const a = Math.atan2(-e.ty, -e.tx) + j * .32 + .15 * Math.sin(t * 5 + j);
      const len = 46 - Math.abs(j) * 8;
      const tx = e.x + Math.cos(a) * len, ty = e.y + Math.sin(a) * len;
      ctx.beginPath(); ctx.moveTo(e.x + e.nx * 4, e.y + e.ny * 4);
      ctx.quadraticCurveTo(e.x + Math.cos(a + .3) * len * .6, e.y + Math.sin(a + .3) * len * .6, tx, ty);
      ctx.quadraticCurveTo(e.x + Math.cos(a - .3) * len * .5, e.y + Math.sin(a - .3) * len * .5, e.x - e.nx * 4, e.y - e.ny * 4);
      ctx.fillStyle = fireGrad(e.x, e.y, tx, ty); ctx.globalAlpha = .9; ctx.fill(); ctx.globalAlpha = 1;
    }
  }

  // 머리(옆모습): 진행 방향이 +x, 등 쪽이 -y
  function drawHead(s, t) {
    const a = Math.atan2(s.ty, s.tx);
    const flip = (s.nx * -Math.sin(a) + s.ny * Math.cos(a)) > 0 ? -1 : 1;   // 등 쪽이 -y 가 되게
    const open = 4 + 4 * Math.sin(t * 2.2);
    ctx.save(); ctx.translate(s.x, s.y); ctx.rotate(a); ctx.scale(1.45, 1.45 * flip);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';

    // 갈기: 머리 뒤로 흩날리는 불꽃 털
    for (let j = 0; j < 9; j++) {
      const y0 = -16 + j * 4.5, len = 52 + 14 * Math.sin(j * 1.3), wv = 7 * Math.sin(t * 5 + j);
      ctx.beginPath(); ctx.moveTo(-6, y0);
      ctx.bezierCurveTo(-24, y0 - 10 + wv, -40, y0 + 12 - wv, -6 - len, y0 - 6 + wv * 1.4);
      ctx.strokeStyle = j % 2 ? C.fire1 : C.fire2; ctx.lineWidth = 5 - j * .25; ctx.stroke();
    }
    // 뿔(사슴뿔 모양): 뒤쪽 것은 어둡게
    const antler = (ox, oy, col, sc) => {
      ctx.strokeStyle = col; ctx.lineWidth = 4.2 * sc;
      ctx.beginPath(); ctx.moveTo(ox, oy); ctx.bezierCurveTo(ox - 14, oy - 18, ox - 34, oy - 30, ox - 58 * sc, oy - 40 * sc); ctx.stroke();
      ctx.lineWidth = 3 * sc;
      ctx.beginPath(); ctx.moveTo(ox - 16, oy - 17); ctx.quadraticCurveTo(ox - 14, oy - 32, ox - 8, oy - 40 * sc); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(ox - 34 * sc, oy - 29 * sc); ctx.quadraticCurveTo(ox - 33 * sc, oy - 44 * sc, ox - 26 * sc, oy - 52 * sc); ctx.stroke();
    };
    antler(-2, -18, C.gold2, .9);
    antler(6, -20, C.horn0, 1);

    // 아래턱
    const hg = ctx.createLinearGradient(0, -26, 0, 26);
    hg.addColorStop(0, C.body2); hg.addColorStop(.6, C.body1); hg.addColorStop(1, C.body0);
    ctx.beginPath(); ctx.moveTo(-18, 14); ctx.lineTo(22, 8 + open * .3); ctx.quadraticCurveTo(52, 10 + open, 70, 12 + open);
    ctx.quadraticCurveTo(66, 22 + open, 50, 22 + open); ctx.quadraticCurveTo(16, 26, -16, 24); ctx.closePath();
    ctx.fillStyle = C.body1; ctx.fill(); ctx.strokeStyle = 'rgba(242,195,91,.5)'; ctx.lineWidth = 1; ctx.stroke();
    // 아래 이빨
    ctx.fillStyle = '#fffbe8';
    for (let x = 30; x <= 64; x += 9) { ctx.beginPath(); ctx.moveTo(x, 10 + open * (x / 70)); ctx.lineTo(x + 3, 4 + open * (x / 70)); ctx.lineTo(x + 6, 10 + open * (x / 70)); ctx.fill(); }
    // 수염(턱 아래)
    for (let j = 0; j < 5; j++) {
      ctx.beginPath(); ctx.moveTo(40 - j * 9, 22 + open * .5);
      ctx.quadraticCurveTo(30 - j * 12, 40 + 4 * Math.sin(t * 4 + j), 18 - j * 14, 52 + j * 2 + 6 * Math.sin(t * 3 + j));
      ctx.strokeStyle = j % 2 ? C.fire1 : C.fire0; ctx.lineWidth = 2.5; ctx.stroke();
    }
    // 위턱·머리
    ctx.beginPath(); ctx.moveTo(-22, 14); ctx.quadraticCurveTo(-26, -10, -14, -22);
    ctx.quadraticCurveTo(4, -30, 22, -26); ctx.quadraticCurveTo(32, -30, 40, -20);
    ctx.quadraticCurveTo(60, -16, 78, -8); ctx.quadraticCurveTo(88, -4, 84, 4);
    ctx.quadraticCurveTo(76, 9, 66, 8); ctx.lineTo(22, 8); ctx.quadraticCurveTo(0, 10, -22, 14); ctx.closePath();
    ctx.fillStyle = hg; ctx.fill(); ctx.strokeStyle = 'rgba(242,195,91,.6)'; ctx.lineWidth = 1.2; ctx.stroke();
    // 위 이빨
    ctx.fillStyle = '#fffbe8';
    for (let x = 28; x <= 68; x += 8) { ctx.beginPath(); ctx.moveTo(x, 8); ctx.lineTo(x + 3, 14); ctx.lineTo(x + 6, 8); ctx.fill(); }
    // 코 위 금빛 비늘 줄
    ctx.strokeStyle = 'rgba(242,195,91,.55)'; ctx.lineWidth = 2;
    for (let x = 44; x <= 72; x += 7) { ctx.beginPath(); ctx.arc(x, -10 + (x - 44) * .2, 5, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke(); }
    // 콧구멍
    ctx.fillStyle = '#04201f'; ctx.beginPath(); ctx.ellipse(78, -3, 4, 2.4, -.4, 0, 7); ctx.fill();
    // 눈썹 능선
    ctx.strokeStyle = C.gold; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(12, -22); ctx.quadraticCurveTo(28, -30, 44, -18); ctx.stroke();
    // 눈: 빛나는 노란 홍채, 세로 동공
    ctx.save(); ctx.shadowColor = '#ffd23a'; ctx.shadowBlur = 14;
    ctx.fillStyle = '#ffe56b'; ctx.beginPath(); ctx.ellipse(30, -15, 8, 5, -.15, 0, 7); ctx.fill(); ctx.restore();
    ctx.fillStyle = '#2a0e02'; ctx.beginPath(); ctx.ellipse(31, -15, 1.8, 4.6, 0, 0, 7); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.beginPath(); ctx.arc(28, -17, 1.4, 0, 7); ctx.fill();
    // 볼 지느러미
    ctx.beginPath(); ctx.moveTo(4, -2);
    ctx.quadraticCurveTo(-14, -14 + 3 * Math.sin(t * 6), -36, -4 + 4 * Math.sin(t * 5));
    ctx.quadraticCurveTo(-16, 2, -12, 12); ctx.closePath();
    ctx.fillStyle = fireGrad(4, 0, -36, -4); ctx.fill();
    // 긴 수염(콧수염) 두 가닥
    for (const [dy, ph, col] of [[-2, 0, C.gold], [4, 1.7, C.horn0]]) {
      ctx.beginPath(); ctx.moveTo(74, dy);
      ctx.bezierCurveTo(60, dy + 30 * Math.sin(t * 2 + ph), 10, dy - 40 * Math.sin(t * 1.6 + ph), -60, dy + 30 * Math.sin(t * 2.4 + ph));
      ctx.bezierCurveTo(-90, dy + 40 * Math.sin(t * 2.4 + ph), -120, dy - 10, -150, dy + 20 * Math.sin(t * 3 + ph));
      ctx.strokeStyle = col; ctx.lineWidth = 2.2; ctx.globalAlpha = .9; ctx.stroke(); ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  // 여의주: 빛나는 구슬 + 감도는 불꽃
  function drawPearl([x, y], t) {
    ctx.save();
    ctx.shadowColor = '#fff2b0'; ctx.shadowBlur = 30;
    const g = ctx.createRadialGradient(x - 6, y - 7, 2, x, y, 20);
    g.addColorStop(0, '#ffffff'); g.addColorStop(.4, '#fff3c2'); g.addColorStop(1, '#f2b84b');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, 18, 0, 7); ctx.fill();
    ctx.restore();
    for (let j = 0; j < 3; j++) {
      const a = t * 3 + j * 2.1;
      ctx.beginPath(); ctx.arc(x, y, 26, a, a + 1.1);
      ctx.strokeStyle = j % 2 ? C.fire1 : C.fire0; ctx.lineWidth = 3; ctx.globalAlpha = .7; ctx.stroke(); ctx.globalAlpha = 1;
    }
  }

  // 상서로운 구름: 배 아래로 흐르는 소용돌이 구름
  function drawClouds(S, t) {
    for (let i = 6; i < S.length; i += 9) {
      const s = S[i], fade = 1 - s.k * .6;
      const cx = s.x - s.nx * (s.w + 26), cy = s.y - s.ny * (s.w + 26);
      ctx.globalAlpha = .28 * fade;
      ctx.fillStyle = '#e9f3ff';
      for (const [dx, dy, r] of [[0, 0, 18], [-20, 6, 13], [20, 5, 14], [-8, -10, 12], [10, -9, 11]]) {
        ctx.beginPath(); ctx.arc(cx + dx, cy + dy, r, 0, 7); ctx.fill();
      }
      ctx.globalAlpha = .45 * fade; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.6;
      ctx.beginPath(); for (let a = 0; a < 9; a += .2) { const r = 1.6 * a; const x = cx - 12 + Math.cos(a + t) * r, y = cy + 2 + Math.sin(a + t) * r; a ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  window.dragonFly = fly;   // 시험용·설정의 '지금 보기'
  let last = Date.now();
  setInterval(() => { if (CFG.min > 0 && !window.NIGHT_ON && Date.now() - last >= CFG.min * 60000) { last = Date.now(); fly(); } }, 15000);
})();
