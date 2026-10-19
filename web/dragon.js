// 화면 잔상(번인) 방지: 10분마다 용이 오른쪽에서 왼쪽으로 물결치며 지나간다.
// 세로 모드에서는 아래에서 위로 지나간다. 지나가는 동안 화면 전체를 살짝 어둡게 해 같은 픽셀이 계속 밝지 않게 한다.
(function () {
  const EVERY_MS = 10 * 60 * 1000;   // 10분
  const DURATION = 11000;            // 한 번 지나가는 시간(ms)
  const SEG = 46;                    // 몸통 마디 수
  const GAP = 15;                    // 마디 간격(px)

  let cv, ctx, running = false;

  function ensureCanvas() {
    if (cv) return;
    cv = document.createElement('canvas');
    cv.id = 'dragon';
    cv.style.cssText = 'position:absolute;inset:0;z-index:50;pointer-events:none;opacity:0;transition:opacity .8s';
    document.getElementById('stage').appendChild(cv);
    ctx = cv.getContext('2d');
  }

  function fly() {
    if (running) return;
    ensureCanvas();
    const st = document.getElementById('stage');
    const portrait = document.body.classList.contains('portrait');
    const W = st.offsetWidth, H = st.offsetHeight;
    cv.width = W; cv.height = H;
    // 가로: 진행축 = x (오른쪽→왼쪽), 세로: 진행축 = y (아래→위)
    const L = portrait ? H : W, C = portrait ? W / 2 : H / 2;
    const amp = (portrait ? W : H) * 0.26;
    const total = L + SEG * GAP + 300;
    const t0 = performance.now();
    running = true;
    cv.style.opacity = '1';

    // 진행축 위치 s(오른쪽 끝에서 0)와 시간으로 물결 모양 좌표
    const wave = (s, t) => C + amp * Math.sin(s / 150 - t * 3.2) + amp * 0.25 * Math.sin(s / 61 + t * 1.7);
    const pt = (s, t) => portrait ? [wave(s, t), L + 150 - s] : [L + 150 - s, wave(s, t)];

    function frame(now) {
      const p = (now - t0) / DURATION;
      if (p >= 1) { cv.style.opacity = '0'; setTimeout(() => { ctx.clearRect(0, 0, W, H); running = false; }, 900); return; }
      const t = (now - t0) / 1000;
      const head = p * total;
      ctx.clearRect(0, 0, W, H);
      // 지나가는 동안 화면을 살짝 어둡게 (번인 완화)
      const dim = Math.sin(Math.PI * p) * 0.35;
      ctx.fillStyle = `rgba(0,0,0,${dim})`; ctx.fillRect(0, 0, W, H);

      // 몸통: 꼬리부터 머리 쪽으로 그려야 머리가 위에 온다
      const pts = [];
      for (let i = SEG; i >= 0; i--) pts.push([i, pt(head - i * GAP, t)]);
      for (const [i, [x, y]] of pts) {
        const k = 1 - i / SEG;                       // 머리 쪽 1, 꼬리 쪽 0
        const r = 5 + 17 * Math.pow(k, 0.55);          // 머리 쪽이 굵고 꼬리로 갈수록 가늘게
        const g = ctx.createRadialGradient(x - r * .3, y - r * .4, r * .1, x, y, r);
        g.addColorStop(0, '#ffe7a3'); g.addColorStop(.45, '#f2a03a'); g.addColorStop(1, '#a8331c');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(90,20,12,.35)'; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.arc(x, y, r * .72, Math.PI * .15, Math.PI * .85); ctx.stroke();
        // 등지느러미
        if (i % 2 === 0 && i > 2 && i < SEG - 3) {
          const [nx, ny] = pt(head - (i - 1) * GAP, t);
          const ang = Math.atan2(ny - y, nx - x) - Math.PI / 2;
          ctx.fillStyle = 'rgba(214,66,40,.9)';
          ctx.beginPath();
          ctx.moveTo(x + Math.cos(ang) * r * .7, y + Math.sin(ang) * r * .7);
          ctx.lineTo(x + Math.cos(ang) * (r + 12 * k + 4), y + Math.sin(ang) * (r + 12 * k + 4));
          ctx.lineTo(nx + Math.cos(ang) * r * .7, ny + Math.sin(ang) * r * .7);
          ctx.fill();
        }
        // 다리 두 쌍
        if (i === 9 || i === 27) {
          const [nx, ny] = pt(head - (i - 1) * GAP, t);
          const ang = Math.atan2(ny - y, nx - x) + Math.PI / 2;
          const sw = Math.sin(t * 6 + i) * 0.5;
          ctx.strokeStyle = '#a8331c'; ctx.lineWidth = 5; ctx.lineCap = 'round';
          ctx.beginPath(); ctx.moveTo(x, y);
          const lx = x + Math.cos(ang + sw) * (r + 16), ly = y + Math.sin(ang + sw) * (r + 16);
          ctx.lineTo(lx, ly); ctx.stroke();
          ctx.strokeStyle = '#ffe7a3'; ctx.lineWidth = 2;
          for (const d of [-.5, 0, .5]) { ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(lx + Math.cos(ang + d) * 8, ly + Math.sin(ang + d) * 8); ctx.stroke(); }
        }
      }

      { const [tx, ty] = pt(head - SEG * GAP, t), [ux, uy] = pt(head - (SEG - 1) * GAP, t);
        const ta = Math.atan2(ty - uy, tx - ux);
        ctx.fillStyle = 'rgba(214,66,40,.85)';
        for (const d of [-.5, 0, .5]) { ctx.beginPath(); ctx.moveTo(tx, ty);
          ctx.quadraticCurveTo(tx + Math.cos(ta + d) * 22, ty + Math.sin(ta + d) * 22 + 6 * Math.sin(t * 5), tx + Math.cos(ta + d * 1.4) * 34, ty + Math.sin(ta + d * 1.4) * 34);
          ctx.lineTo(tx + Math.cos(ta + d) * 10, ty + Math.sin(ta + d) * 10); ctx.fill(); } }
      // 머리
      const [hx, hy] = pt(head, t), [px, py] = pt(head - GAP, t);
      const a = Math.atan2(hy - py, hx - px);
      ctx.save(); ctx.translate(hx, hy); ctx.rotate(a); ctx.scale(1.35, 1.35);
      // 수염
      ctx.strokeStyle = 'rgba(255,231,163,.9)'; ctx.lineWidth = 2.2;
      for (const sgn of [-1, 1]) {
        ctx.beginPath(); ctx.moveTo(22, sgn * 6);
        ctx.bezierCurveTo(50, sgn * (16 + 10 * Math.sin(t * 4)), 70, sgn * (2 - 14 * Math.sin(t * 3)), 96, sgn * (22 + 8 * Math.sin(t * 5)));
        ctx.stroke();
      }
      // 뿔
      ctx.fillStyle = '#ffe7a3';
      for (const sgn of [-1, 1]) { ctx.beginPath(); ctx.moveTo(-8, sgn * 12); ctx.quadraticCurveTo(-30, sgn * 34, -46, sgn * 30); ctx.quadraticCurveTo(-24, sgn * 22, -2, sgn * 6); ctx.fill(); }
      // 얼굴
      const hg = ctx.createLinearGradient(-20, -20, 30, 20);
      hg.addColorStop(0, '#f6b14a'); hg.addColorStop(1, '#b8391e');
      ctx.fillStyle = hg;
      ctx.beginPath(); ctx.moveTo(-22, -20); ctx.quadraticCurveTo(10, -26, 34, -9); ctx.lineTo(40, 0); ctx.lineTo(34, 9); ctx.quadraticCurveTo(10, 26, -22, 20); ctx.quadraticCurveTo(-30, 0, -22, -20); ctx.fill();
      // 입
      ctx.strokeStyle = '#5a140c'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(40, 1); ctx.lineTo(8, 6 + 3 * Math.sin(t * 5)); ctx.stroke();
      // 눈
      for (const sgn of [-1, 1]) {
        ctx.fillStyle = '#fff6c8'; ctx.beginPath(); ctx.ellipse(6, sgn * 10, 6, 4, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#1a0a04'; ctx.beginPath(); ctx.arc(8, sgn * 10, 2.4, 0, Math.PI * 2); ctx.fill();
      }
      // 여의주
      ctx.restore();
      const [ox, oy] = pt(head + 70, t);
      const og = ctx.createRadialGradient(ox - 5, oy - 6, 2, ox, oy, 16);
      og.addColorStop(0, '#ffffff'); og.addColorStop(.5, '#ffe7a3'); og.addColorStop(1, 'rgba(244,162,89,.2)');
      ctx.fillStyle = og; ctx.beginPath(); ctx.arc(ox, oy, 15, 0, Math.PI * 2); ctx.fill();

      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  window.dragonFly = fly;   // 시험용: 콘솔에서 dragonFly()
  setInterval(fly, EVERY_MS);
})();
