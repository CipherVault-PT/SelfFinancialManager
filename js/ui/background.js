/** Fundo animado em canvas: Aurora / Rede / Estrelas / Nebulosa / Nenhum. */
export function initBackground(canvas, getMode) {
  const ctx = canvas?.getContext?.('2d');
  if (!ctx) return { restart() {} };

  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const bands = [[201, 169, 106], [95, 199, 154], [124, 108, 224], [92, 150, 210]];
  let W = 0, H = 0, t = 0, raf = null, pts = [], stars = [], blobs = [];

  const accent = () => getComputedStyle(document.documentElement).getPropertyValue('--accent-rgb').trim() || '201,169,106';

  function seed() {
    const rnd = Math.random;
    pts = Array.from({ length: Math.min(60, Math.round((W * H) / 24000)) }, () =>
      ({ x: rnd() * W, y: rnd() * H, vx: (rnd() - 0.5) * 0.22, vy: (rnd() - 0.5) * 0.22, r: rnd() * 1.5 + 0.5 }));
    stars = Array.from({ length: Math.min(120, Math.round((W * H) / 12000)) }, () =>
      ({ x: rnd() * W, y: rnd() * H, r: rnd() * 1.2 + 0.3, ph: rnd() * 6.283, sp: rnd() * 0.7 + 0.2 }));
    blobs = Array.from({ length: 5 }, () =>
      ({ x: rnd() * W, y: rnd() * H, r: rnd() * 160 + 140, dx: (rnd() - 0.5) * 0.12, dy: (rnd() - 0.5) * 0.12, h: rnd() * 360 }));
  }

  function size() {
    W = canvas.clientWidth; H = canvas.clientHeight;
    canvas.width = Math.max(1, W * dpr); canvas.height = Math.max(1, H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    seed();
    if (!raf) draw();
  }

  function drawAurora() {
    const ac = accent().split(',').map(Number);
    if (ac.length === 3 && ac.every(Number.isFinite)) bands[0] = ac;
    bands.forEach((c, b) => {
      const yBase = H * (0.14 + b * 0.15), amp = H * 0.15, sp = t * 0.0005 * (1 + b * 0.22), fx = b * 1.3;
      ctx.beginPath(); ctx.moveTo(0, H);
      for (let x = 0; x <= W; x += 16) ctx.lineTo(x, yBase + Math.sin(x * 0.0055 + sp + fx) * amp + Math.sin(x * 0.012 + sp * 1.4) * amp * 0.4);
      ctx.lineTo(W, H); ctx.closePath();
      const g = ctx.createLinearGradient(0, yBase - amp, 0, H);
      g.addColorStop(0, `rgba(${c},0.15)`); g.addColorStop(0.5, `rgba(${c},0.05)`); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.fill();
    });
  }

  function drawNet() {
    const col = accent();
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      p.x += p.vx; p.y += p.vy;
      if (p.x < 0 || p.x > W) p.vx *= -1;
      if (p.y < 0 || p.y > H) p.vy *= -1;
      for (let j = i + 1; j < pts.length; j++) {
        const q = pts[j], d = (p.x - q.x) ** 2 + (p.y - q.y) ** 2;
        if (d < 13000) {
          ctx.strokeStyle = `rgba(${col},${(1 - d / 13000) * 0.28})`; ctx.lineWidth = 0.6;
          ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
        }
      }
    }
    ctx.fillStyle = `rgba(${col},.6)`;
    for (const p of pts) { ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.283); ctx.fill(); }
  }

  function drawStars() {
    const col = accent();
    for (const s of stars) {
      const tw = (Math.sin(t * 0.002 * s.sp + s.ph) + 1) * 0.5;
      s.y += 0.03 * s.sp; if (s.y > H) s.y = 0;
      ctx.fillStyle = `rgba(255,255,255,${0.2 + tw * 0.6})`;
      ctx.beginPath(); ctx.arc(s.x, s.y, s.r * (0.6 + tw * 0.7), 0, 6.283); ctx.fill();
    }
    for (let g = 0; g < stars.length; g += 6) {
      const s = stars[g], pp = (Math.sin(t * 0.003 + s.ph) + 1) * 0.5;
      ctx.fillStyle = `rgba(${col},${0.3 + pp * 0.5})`;
      ctx.beginPath(); ctx.arc(s.x, s.y, s.r * (1 + pp), 0, 6.283); ctx.fill();
    }
  }

  function drawNebula() {
    ctx.globalCompositeOperation = 'lighter';
    blobs.forEach((b, i) => {
      b.x += b.dx * 3; b.y += b.dy * 3;
      if (b.x < -b.r) b.x = W + b.r; if (b.x > W + b.r) b.x = -b.r;
      if (b.y < -b.r) b.y = H + b.r; if (b.y > H + b.r) b.y = -b.r;
      const R = b.r * (1 + Math.sin(t * 0.012 + i * 1.7) * 0.22), hue = (b.h + t * 0.1) % 360;
      const g = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, R);
      g.addColorStop(0, `hsla(${hue},75%,60%,0.22)`); g.addColorStop(0.5, `hsla(${(hue + 40) % 360},70%,55%,0.10)`); g.addColorStop(1, 'hsla(0,0%,0%,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(b.x, b.y, R, 0, 6.283); ctx.fill();
    });
    ctx.globalCompositeOperation = 'source-over';
  }

  const DRAW = { aurora: drawAurora, net: drawNet, stars: drawStars, nebula: drawNebula };

  function draw() {
    ctx.clearRect(0, 0, W, H);
    DRAW[getMode()]?.();
  }

  function frame() {
    t += 16;
    draw();
    raf = requestAnimationFrame(frame);
  }

  function start() {
    if (raf || document.hidden) return;
    if (reduce || getMode() === 'none') draw();
    else raf = requestAnimationFrame(frame);
  }

  function stop() {
    if (raf) cancelAnimationFrame(raf);
    raf = null;
  }

  addEventListener('resize', size);
  document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));
  size();
  start();

  return { restart() { stop(); start(); } };
}
