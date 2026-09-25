(() => {
  const canvas = document.getElementById('cosmos-canvas');
  if (!canvas || !canvas.getContext) return;
  const ctx = canvas.getContext('2d');

  let width = 0;
  let height = 0;

  // Fraction (0..1) of the current work/break phase already elapsed.
  // Set from renderer.js on every tick; read continuously by the draw loop.
  let progress = 0;

  function resize() {
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    width = canvas.clientWidth;
    height = canvas.clientHeight;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener('resize', resize);
  if (window.ResizeObserver) new ResizeObserver(resize).observe(canvas);

  // ---- Field: spiral arms of particles (core = past, tip = future),
  // a scattering of twinkling stars, and a few slowly-rotating light rays.
  const ARMS = 3;
  const PARTICLES_PER_ARM = 70;
  const TURNS = 2.4;

  const particles = [];
  for (let arm = 0; arm < ARMS; arm++) {
    const armOffset = (arm / ARMS) * Math.PI * 2;
    for (let i = 0; i < PARTICLES_PER_ARM; i++) {
      const t = i / (PARTICLES_PER_ARM - 1); // 0 = core, 1 = tip
      particles.push({
        t,
        angle: armOffset + t * TURNS * Math.PI * 2,
        radius: t,
        jitter: (Math.random() - 0.5) * 0.04,
        size: 1 + Math.random() * 1.8,
        twinkleSpeed: 0.4 + Math.random() * 0.8,
        twinklePhase: Math.random() * Math.PI * 2,
      });
    }
  }

  const stars = [];
  for (let i = 0; i < 90; i++) {
    stars.push({
      x: Math.random(),
      y: Math.random(),
      size: 0.6 + Math.random() * 1.2,
      twinkleSpeed: 0.3 + Math.random() * 0.9,
      twinklePhase: Math.random() * Math.PI * 2,
    });
  }

  const rays = [];
  for (let i = 0; i < 8; i++) {
    rays.push({
      angle: (i / 8) * Math.PI * 2 + Math.random() * 0.3,
      length: 0.35 + Math.random() * 0.55,
      width: 0.4 + Math.random() * 0.8,
    });
  }

  let rotation = 0;
  let lastTime = performance.now();

  function draw(now) {
    const dt = Math.min(0.05, (now - lastTime) / 1000);
    lastTime = now;
    rotation += dt * 0.02; // slow continuous drift — the piece never sits still

    if (width > 0 && height > 0) {
      ctx.clearRect(0, 0, width, height);

      const cx = width / 2;
      const cy = height / 2;
      const maxR = Math.hypot(width, height) / 2;

      const bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxR);
      bg.addColorStop(0, '#101018');
      bg.addColorStop(1, '#05050a');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, width, height);

      for (const s of stars) {
        const tw = 0.5 + 0.5 * Math.sin((now / 1000) * s.twinkleSpeed + s.twinklePhase);
        ctx.globalAlpha = 0.25 + tw * 0.55;
        ctx.fillStyle = '#e8e8f0';
        ctx.beginPath();
        ctx.arc(s.x * width, s.y * height, s.size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(rotation * 0.5);
      for (const r of rays) {
        const len = r.length * maxR;
        const grad = ctx.createLinearGradient(0, 0, Math.cos(r.angle) * len, Math.sin(r.angle) * len);
        grad.addColorStop(0, 'rgba(240, 220, 180, 0.35)');
        grad.addColorStop(1, 'rgba(240, 220, 180, 0)');
        ctx.strokeStyle = grad;
        ctx.lineWidth = r.width;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(r.angle) * len, Math.sin(r.angle) * len);
        ctx.stroke();
      }
      ctx.restore();

      // Past (already elapsed) renders grayscale; future (remaining) renders
      // in warm gold. The swirl keeps drifting regardless of that split.
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(rotation);
      for (const p of particles) {
        const r = (p.radius + p.jitter) * maxR * 0.92;
        const x = Math.cos(p.angle) * r;
        const y = Math.sin(p.angle) * r;
        const tw = 0.6 + 0.4 * Math.sin((now / 1000) * p.twinkleSpeed + p.twinklePhase);
        const isPast = p.t <= progress;
        ctx.fillStyle = isPast
          ? `rgba(150, 150, 158, ${0.25 + tw * 0.25})`
          : `rgba(236, 198, 130, ${0.35 + tw * 0.45})`;
        ctx.beginPath();
        ctx.arc(x, y, p.size * (isPast ? 0.8 : 1), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      const coreR = maxR * 0.05;
      const coreGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR * 4);
      coreGrad.addColorStop(0, 'rgba(255, 244, 214, 0.9)');
      coreGrad.addColorStop(0.3, 'rgba(240, 210, 150, 0.35)');
      coreGrad.addColorStop(1, 'rgba(240, 210, 150, 0)');
      ctx.fillStyle = coreGrad;
      ctx.beginPath();
      ctx.arc(cx, cy, coreR * 4, 0, Math.PI * 2);
      ctx.fill();
    }

    requestAnimationFrame(draw);
  }

  resize();
  requestAnimationFrame(draw);

  window.setCosmosProgress = (fraction) => {
    progress = Math.max(0, Math.min(1, fraction || 0));
  };
})();
