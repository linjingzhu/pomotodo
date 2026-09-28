(() => {
  const el = {
    app: document.getElementById('app'),
    taskInput: document.getElementById('task-input'),
    goalField: document.getElementById('goal-field'),
    goalCheck: document.getElementById('goal-check'),
    totalTurns: document.getElementById('total-turns'),
    totalStudy: document.getElementById('total-study'),
    statsResetBtn: document.getElementById('stats-reset-btn'),
    timerDisplay: document.getElementById('timer-display'),
    startPauseBtn: document.getElementById('start-pause-btn'),
    resetBtn: document.getElementById('reset-btn'),
    skipModeBtn: document.getElementById('skip-mode-btn'),
    pinBtn: document.getElementById('pin-btn'),
    fullscreenBtn: document.getElementById('fullscreen-btn'),
    gearBtn: document.getElementById('gear-btn'),
    resetSizeBtn: document.getElementById('reset-size-btn'),
    closeBtn: document.getElementById('close-btn'),
    settingsPanel: document.getElementById('settings-panel'),
    workMin: document.getElementById('work-min'),
    breakMin: document.getElementById('break-min'),
    longBreakMin: document.getElementById('long-break-min'),
    longBreakEvery: document.getElementById('long-break-every'),
    autoStartBreaks: document.getElementById('auto-start-breaks'),
    autoStartFocus: document.getElementById('auto-start-focus'),
    notifyOnPhaseChange: document.getElementById('notify-on-phase-change'),
    alwaysTop: document.getElementById('always-top'),
    minimizeToTray: document.getElementById('minimize-to-tray'),
    closeToTray: document.getElementById('close-to-tray'),
    displaySelect: document.getElementById('display-select'),
    cornerButtons: Array.from(document.querySelectorAll('#corner-grid button')),
    ringFill: document.getElementById('ring-fill'),
    bgImage: document.getElementById('bg-image'),
    bgTint: document.getElementById('bg-tint'),
    bgPickBtn: document.getElementById('bg-pick-btn'),
    bgClearBtn: document.getElementById('bg-clear-btn'),
    bgFitWidthBtn: document.getElementById('bg-fit-width-btn'),
    bgFitHeightBtn: document.getElementById('bg-fit-height-btn'),
    bgBlur: document.getElementById('bg-blur'),
    bgTintColor: document.getElementById('bg-tint-color'),
    bgTintOpacity: document.getElementById('bg-tint-opacity'),
    accentColor: document.getElementById('accent-color'),
    gaugeStyle: document.getElementById('gauge-style'),
    panelSplitter: document.getElementById('panel-splitter'),
    resetRecordsBtn: document.getElementById('reset-records-btn'),
    resetConfigBtn: document.getElementById('reset-config-btn'),
    aboutVersion: document.getElementById('about-version'),
  };



  let mode = 'work'; // 'work' | 'break' | 'longBreak'
  // Focus sessions finished since the last long break (not persisted).
  let focusInCycle = 0;
  // Time is kept by a monotonic clock, not by counting ticks: a hidden or
  // minimized window's timers can be throttled to one wake-up a minute,
  // which made a tick-counting timer all but stop in the tray. Ticks only
  // sample the clock.
  let remainingMs = 25 * 60 * 1000;
  let phaseDurationMs = remainingMs;
  let phaseEndAt = 0; // while running: when the current phase ends (ms)
  let lastTickAt = 0; // while running: the clock time already accounted for
  let workCarryMs = 0; // focus time not yet credited as a whole second
  let timerId = null;
  let running = false;
  const TICK_MS = 250;
  // Ticks this far apart mean the PC was asleep (the suspend event can be
  // missed); that gap isn't counted, and the timer pauses. Well above the
  // one-minute throttling a hidden window can still get.
  const SLEEP_GAP_MS = 3 * 60 * 1000;
  let userAccentColor = '#f2405a';
  const BREAK_ACCENT_COLOR = '#40e0d0'; // turquoise
  let totalTurns = 0; // completed work sessions, persisted
  let totalStudySeconds = 0; // every second the timer actually ran in work mode, persisted
  let unsavedStudySeconds = 0;
  // The focus session in progress: when it began and the seconds actually
  // ticked (pauses excluded). Recorded when it completes, or when it's reset
  // after at least a minute of work.
  let session = null;
  const pendingSessions = new Set();
  const failedSessions = [];
  const MIN_RECORDED_SEC = 60;

  function fmt(sec) {
    const m = Math.floor(sec / 60).toString().padStart(2, '0');
    const s = Math.floor(sec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }

  function timerState() {
    if (running) return 'running';
    return remainingMs === phaseDurationMs ? 'idle' : 'paused';
  }

  function render() {
    const state = timerState();
    el.app.dataset.state = state;
    el.timerDisplay.textContent = fmt(Math.ceil(remainingMs / 1000));
    el.startPauseBtn.classList.toggle('running', running);
    el.startPauseBtn.title = running ? 'Pause' : 'Start';
    const remainingFraction = Math.max(0, Math.min(1, remainingMs / phaseDurationMs));
    // The arc spans [start, 360deg]; start advancing clockwise from 12
    // o'clock is the depleted portion growing clockwise.
    el.ringFill.style.setProperty('--ring-start', `${360 * (1 - remainingFraction)}deg`);
    drawGauge();
    el.skipModeBtn.title = mode === 'work' ? 'Switch to Break' : 'Switch to Focus';
    renderStats();
    reportProgress(state, 1 - remainingFraction);
  }

  // Taskbar progress (elapsed share; yellow while paused, none when idle)
  // and the tray tooltip, for when the window is minimized or in the tray.
  // Sent only when something visible changes: about once a second.
  let lastProgress = '';
  function reportProgress(state, elapsed) {
    const time = fmt(Math.ceil(remainingMs / 1000));
    const suffix = state === 'paused' ? ' (paused)' : state === 'idle' ? ' (ready)' : '';
    const label = `Pomodoro Timer · ${PHASE_NAMES[mode]} ${time}${suffix}`;
    const fraction = Math.round(elapsed * 1000) / 1000;
    const key = `${state}|${fraction}|${label}`;
    if (key === lastProgress) return;
    lastProgress = key;
    window.pomodoro.setProgress(state, fraction, label);
  }

  function fmtStudy(sec) {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }

  function renderStats() {
    el.totalTurns.textContent = String(totalTurns);
    el.totalStudy.textContent = fmtStudy(totalStudySeconds);
  }

  function saveStats() {
    unsavedStudySeconds = 0;
    window.pomodoro.saveSettings({ totalTurns, totalStudySeconds });
  }

  // Collapse the arc to nothing at 12 o'clock without animating, then let
  // its end transition back to 360deg: a clockwise refill from 12.
  function playPhaseSweep() {
    const fill = el.ringFill;
    fill.style.transition = 'none';
    fill.style.setProperty('--ring-start', '0deg');
    fill.style.setProperty('--ring-end', '0deg');
    getComputedStyle(fill).getPropertyValue('--ring-end');
    fill.style.transition = '';
    fill.style.setProperty('--ring-end', '360deg');
    playGaugeSweep();
  }

  // Work mode uses the user's chosen key color; break mode is always
  // turquoise, regardless of that setting.
  function applyModeColor() {
    document.documentElement.style.setProperty('--accent', mode === 'work' ? userAccentColor : BREAK_ACCENT_COLOR);
    document.documentElement.style.setProperty('--key', userAccentColor);
    drawGauge();
  }

  // ---- Gauge styles drawn on a canvas (Settings > Gauge style) ----
  // "Filled pie" and "Stroke" are CSS (#ring-fill); the styles below are
  // drawn here from the same state: the remaining sector is [start, end]
  // degrees clockwise from 12 o'clock, idle shows no color, paused dims the
  // marks to 40%, breaks use the break color. Sizes are designed for a
  // 190px ring and scaled with it.
  const CANVAS_GAUGES = ['disk', 'glow', 'ticks', 'beads', 'liquid', 'hairline', 'dashes', 'sundial', 'bars', 'ink', 'halo', 'arc', 'bar'];
  const GAUGE_PAD = 12; // the canvas overhangs the ring so glows aren't cut off
  const SWEEP_MS = 600; // matches the CSS styles' --ring-end refill
  const gauge = { style: 'pie', canvas: null, ctx: null, sweepAt: -Infinity, raf: 0, lastWave: 0, colorKey: '', warm: '' };

  function gaugeMotionOk() {
    return !(typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  window.addEventListener('resize', () => drawGauge());

  function setGaugeStyle(style) {
    gauge.style = style;
    el.app.dataset.gauge = style;
    el.app.dataset.gaugeKind = CANVAS_GAUGES.includes(style) ? 'canvas' : 'css';
    if (style !== 'ink') el.timerDisplay.style.removeProperty('--ink-level');
    drawGauge();
  }

  // The accent's hue-shifted partner (the same +45deg the CSS styles fade
  // to), resolved once per accent through the CSS color engine.
  function gaugeColors() {
    const main = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#f2405a';
    if (gauge.colorKey !== main) {
      const probe = document.createElement('i');
      probe.style.color = `oklch(from ${main} l c calc(h + 45))`;
      document.body.appendChild(probe);
      gauge.warm = getComputedStyle(probe).color || main;
      probe.remove();
      gauge.colorKey = main;
    }
    return { main, warm: gauge.warm };
  }

  function playGaugeSweep() {
    if (!CANVAS_GAUGES.includes(gauge.style)) return;
    gauge.sweepAt = performance.now();
    scheduleGaugeFrame();
  }

  // Only the refill sweep and the Liquid style's ripple need frames between
  // timer ticks; everything else redraws from render().
  function scheduleGaugeFrame() {
    if (gauge.raf || typeof requestAnimationFrame !== 'function') return;
    gauge.raf = requestAnimationFrame((now) => {
      gauge.raf = 0;
      const sweeping = now - gauge.sweepAt < SWEEP_MS;
      const rippling = gauge.style === 'liquid' && running && gaugeMotionOk();
      if (sweeping || !rippling || now - gauge.lastWave >= 50) {
        if (rippling) gauge.lastWave = now;
        drawGauge();
      }
      if (sweeping || rippling) scheduleGaugeFrame();
    });
  }

  function drawGauge() {
    if (!CANVAS_GAUGES.includes(gauge.style)) return;
    const state = timerState();
    const fraction = Math.max(0, Math.min(1, remainingMs / phaseDurationMs));
    let start = 360 * (1 - fraction);
    let end = 360;
    const sweep = (performance.now() - gauge.sweepAt) / SWEEP_MS;
    if (sweep >= 0 && sweep < 1) { start = 0; end = 360 * (1 - (1 - sweep) ** 3); } // ease-out refill from 12
    const v = {
      start, end, span: Math.max(0, end - start) / 360,
      idle: state === 'idle', paused: state === 'paused',
      minutes: Math.max(1, Math.round(phaseDurationMs / 60000)),
    };
    if (!gauge.canvas) {
      const canvas = document.getElementById('ring-canvas');
      if (canvas && typeof canvas.getContext === 'function') { gauge.canvas = canvas; gauge.ctx = canvas.getContext('2d'); }
    }
    const { canvas, ctx } = gauge;
    const cssW = canvas ? canvas.clientWidth : 0;
    if (canvas) {
      const dpr = window.devicePixelRatio || 1;
      const px = Math.round(cssW * dpr);
      if (canvas.width !== px || canvas.height !== px) { canvas.width = px; canvas.height = px; }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, px, px);
      const S = cssW - GAUGE_PAD * 2;
      Object.assign(v, { S, k: S / 190, C: S / 2, R: S * 0.46 });
      ctx.setTransform(dpr, 0, 0, dpr, GAUGE_PAD * dpr, GAUGE_PAD * dpr);
    }
    if (gauge.style === 'ink') { GAUGE_DRAW.ink(null, v); return; } // CSS-driven, needs no canvas
    if (!cssW) return;
    v.col = gaugeColors();
    GAUGE_DRAW[gauge.style](ctx, v);
    if (gauge.style === 'liquid' && running) scheduleGaugeFrame();
  }

  const TAU = Math.PI * 2;
  const gaugeRad = (deg) => (deg - 90) * Math.PI / 180; // 0deg = 12 o'clock, clockwise
  const inSector = (deg, v) => deg >= v.start - 1e-6 && deg <= v.end + 1e-6;

  function gaugeCircle(ctx, v, radius, width, alpha) {
    ctx.beginPath();
    ctx.arc(v.C, v.C, radius, 0, TAU);
    ctx.strokeStyle = `rgba(255, 255, 255, ${alpha})`;
    ctx.lineWidth = width;
    ctx.stroke();
  }

  function gaugeDim(ctx, v) {
    ctx.globalAlpha = v.paused ? 0.4 : 1;
  }

  const gaugePolar = (v, deg, radius) => [v.C + radius * Math.cos(gaugeRad(deg)), v.C + radius * Math.sin(gaugeRad(deg))];

  function gaugeIndex12(ctx, v, alpha) {
    ctx.beginPath(); ctx.moveTo(v.C, v.C - v.R - 3 * v.k); ctx.lineTo(v.C, v.C - v.R + 3 * v.k);
    ctx.strokeStyle = `rgba(255, 255, 255, ${alpha})`; ctx.lineWidth = 1; ctx.lineCap = 'butt'; ctx.stroke();
  }

  function gaugeDot(ctx, x, y, color, haloRadius, radius) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, haloRadius);
    g.addColorStop(0, color); g.addColorStop(1, 'rgba(0, 0, 0, 0)');
    const a = ctx.globalAlpha;
    ctx.globalAlpha = a * 0.55; ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, haloRadius, 0, TAU); ctx.fill();
    ctx.globalAlpha = a; ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, radius, 0, TAU); ctx.fill();
  }

  // '#rrggbb' -> 'rgba(...)'; the accent always resolves to hex or rgb().
  function gaugeAlpha(color, alpha) {
    const m = /^#([0-9a-f]{6})$/i.exec(color);
    if (m) { const n = parseInt(m[1], 16); return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${alpha.toFixed(3)})`; }
    return color.replace(/^rgba?\(([^)]+?)(?:,[^,]*)?\)$/, (_, rgb) => `rgba(${rgb.split(',').slice(0, 3).join(',')}, ${alpha.toFixed(3)})`);
  }

  // The long-break cycle as a row of dots: filled = focus sessions done,
  // ring = the one running, faint = still to come.
  function gaugeCycleDots(ctx, v, y, spacing, radius) {
    const every = Math.max(2, Number(el.longBreakEvery.value || 4));
    const done = Math.min(every, focusInCycle);
    const sp = Math.min(spacing, (v.R * 1.1) / every);
    const r = Math.min(radius, sp * 0.3);
    for (let i = 0; i < every; i++) {
      const x = v.C + (i - (every - 1) / 2) * sp;
      ctx.save();
      ctx.beginPath(); ctx.arc(x, y, r, 0, TAU);
      if (i < done) { ctx.fillStyle = v.idle ? 'rgba(255, 255, 255, 0.55)' : userAccentColor; gaugeDim(ctx, v); ctx.fill(); }
      else if (i === done && mode === 'work') { ctx.strokeStyle = v.idle ? 'rgba(255, 255, 255, 0.55)' : userAccentColor; ctx.lineWidth = Math.max(1.2, r * 0.45); gaugeDim(ctx, v); ctx.stroke(); }
      else { ctx.fillStyle = 'rgba(255, 255, 255, 0.22)'; ctx.fill(); }
      ctx.restore();
    }
  }

  function gaugeMarks(ctx, v, blur) {
    ctx.globalAlpha = v.paused ? 0.4 : 1;
    if (!v.paused) { ctx.shadowColor = v.col.main; ctx.shadowBlur = blur * v.k; }
  }

  const GAUGE_DRAW = {
    // Time Timer: a flat disk of the remaining time over a minute scale,
    // labelled with the minutes left when the edge reaches each mark.
    disk(ctx, v) {
      const { C, R, k } = v;
      ctx.beginPath(); ctx.arc(C, C, R, 0, TAU); ctx.fillStyle = 'rgba(255, 255, 255, 0.06)'; ctx.fill();
      if (!v.idle && v.span > 0) {
        ctx.save(); gaugeMarks(ctx, v, 8);
        ctx.beginPath(); ctx.moveTo(C, C); ctx.arc(C, C, R, gaugeRad(v.start), gaugeRad(v.end)); ctx.closePath();
        ctx.fillStyle = v.col.main; ctx.fill(); ctx.restore();
      }
      const n = v.minutes;
      const major = n >= 20 ? 5 : 1;
      for (let i = 0; i < n; i++) {
        const a = gaugeRad(i * 360 / n);
        const big = i % major === 0;
        const r1 = R - (big ? 11 : 6) * k;
        ctx.beginPath();
        ctx.moveTo(v.C + Math.cos(a) * r1, v.C + Math.sin(a) * r1);
        ctx.lineTo(v.C + Math.cos(a) * (R - 1.5 * k), v.C + Math.sin(a) * (R - 1.5 * k));
        ctx.strokeStyle = big ? 'rgba(255, 255, 255, 0.85)' : 'rgba(255, 255, 255, 0.45)';
        ctx.lineWidth = (big ? 2 : 1) * k; ctx.stroke();
      }
      if (n <= 90) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
        ctx.font = `600 ${Math.max(8, Math.round(10 * k))}px ${getComputedStyle(document.body).fontFamily}`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        const step = n >= 20 ? 5 * Math.ceil(n / 60) : 1;
        for (let m = 0; m < n; m += step) {
          const a = gaugeRad(m * 360 / n);
          ctx.fillText(String(m === 0 ? n : n - m), v.C + Math.cos(a) * (R - 20 * k), v.C + Math.sin(a) * (R - 20 * k));
        }
      }
      gaugeCircle(ctx, v, R, 1.5 * k, 0.35);
    },

    // A thick rounded ring, brightest at "now", fading toward 12 o'clock.
    glow(ctx, v) {
      const w = 14 * v.k, rr = v.R - w / 2;
      gaugeCircle(ctx, v, rr, w, v.idle ? 0.18 : 0.08);
      if (v.idle || v.span <= 0) return;
      const cap = (w / 2) / rr;
      ctx.save(); gaugeMarks(ctx, v, 12);
      const g = ctx.createConicGradient(gaugeRad(v.start) - cap, v.C, v.C);
      const reach = Math.min(0.999, v.span + cap / TAU);
      g.addColorStop(0, v.col.main); g.addColorStop(reach, v.col.warm); g.addColorStop(1, v.col.warm);
      ctx.beginPath(); ctx.arc(v.C, v.C, rr, gaugeRad(v.start), gaugeRad(v.end));
      ctx.strokeStyle = g; ctx.lineWidth = w; ctx.lineCap = 'round'; ctx.stroke();
      ctx.shadowBlur = 0;
      const a = gaugeRad(v.start);
      ctx.beginPath(); ctx.arc(v.C + Math.cos(a) * rr, v.C + Math.sin(a) * rr, 3.2 * v.k, 0, TAU);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.95)'; ctx.fill();
      ctx.restore();
    },

    // 60 ticks; the remaining ones lit, the one at "now" longer and white.
    ticks(ctx, v) {
      const { C, R, k } = v;
      const N = 60;
      const colored = !v.idle && v.span > 0;
      const edge = colored ? Math.min(N, Math.ceil((v.start - 1e-6) / 6)) % N : -1;
      for (let i = 0; i < N; i++) {
        const deg = i * 6;
        const lit = colored && (inSector(deg, v) || (i === 0 && v.end >= 360 - 1e-6));
        const isEdge = i === edge && lit;
        const big = i % 5 === 0;
        const a = gaugeRad(deg);
        const r1 = R - (isEdge ? 20 : big ? 15 : 10) * k;
        ctx.save();
        if (lit) { gaugeMarks(ctx, v, 6); ctx.strokeStyle = isEdge ? '#ffffff' : v.col.main; }
        else ctx.strokeStyle = v.idle ? 'rgba(255, 255, 255, 0.30)' : 'rgba(255, 255, 255, 0.12)';
        ctx.lineWidth = (isEdge ? 3.2 : big ? 3 : 2) * k; ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(C + Math.cos(a) * r1, C + Math.sin(a) * r1);
        ctx.lineTo(C + Math.cos(a) * (R - k), C + Math.sin(a) * (R - k));
        ctx.stroke(); ctx.restore();
      }
    },

    // One segment per minute of the phase, and the long-break cycle as dots
    // under the digits (filled = done, ring = this focus session).
    beads(ctx, v) {
      const { C, R, k } = v;
      const M = v.minutes;
      const w = 11 * k, rr = R - w / 2;
      const gap = Math.min(2.4, 120 / M);
      for (let i = 0; i < M; i++) {
        const s = i * 360 / M + gap / 2, e = (i + 1) * 360 / M - gap / 2;
        ctx.beginPath(); ctx.arc(C, C, rr, gaugeRad(s), gaugeRad(e));
        ctx.strokeStyle = v.idle ? 'rgba(255, 255, 255, 0.22)' : 'rgba(255, 255, 255, 0.10)';
        ctx.lineWidth = w; ctx.lineCap = 'butt'; ctx.stroke();
        const from = Math.max(s, v.start), to = Math.min(e, v.end);
        if (v.idle || from >= to) continue;
        ctx.save(); gaugeMarks(ctx, v, 6);
        ctx.beginPath(); ctx.arc(C, C, rr, gaugeRad(from), gaugeRad(to));
        ctx.strokeStyle = v.col.main; ctx.lineWidth = w; ctx.stroke(); ctx.restore();
      }
      gaugeCycleDots(ctx, v, C + R * 0.42, 13 * k, 3.6 * k);
    },

    // F: a hairline track, a 2px remaining arc, one bright dot at "now".
    hairline(ctx, v) {
      const { C, R, k } = v;
      gaugeCircle(ctx, v, R, k, 0.10);
      gaugeIndex12(ctx, v, 0.35);
      const [x, y] = gaugePolar(v, v.start, R);
      if (v.idle) { ctx.fillStyle = 'rgba(255, 255, 255, 0.35)'; ctx.beginPath(); ctx.arc(C, C - R, 2.5 * k, 0, TAU); ctx.fill(); return; }
      ctx.save(); gaugeDim(ctx, v); ctx.lineCap = 'round';
      if (v.span > 0.002) { ctx.beginPath(); ctx.arc(C, C, R, gaugeRad(v.start), gaugeRad(v.end)); ctx.strokeStyle = v.col.main; ctx.lineWidth = 2 * k; ctx.stroke(); }
      gaugeDot(ctx, x, y, v.col.warm, 12 * k, 2.5 * k);
      ctx.restore();
    },

    // G: the elapsed part as faint dashes, the remaining part a solid arc.
    dashes(ctx, v) {
      const { C, R, k } = v;
      gaugeIndex12(ctx, v, 0.25);
      ctx.save();
      ctx.lineCap = 'butt'; ctx.setLineDash([1.5 * k, 5 * k]); ctx.lineWidth = 2 * k; ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
      ctx.beginPath(); ctx.arc(C, C, R, gaugeRad(0), gaugeRad(v.idle ? 360 : v.start)); ctx.stroke();
      ctx.restore();
      if (v.idle || v.span <= 0.002) return;
      ctx.save(); gaugeDim(ctx, v); ctx.lineCap = 'round';
      ctx.beginPath(); ctx.arc(C, C, R, gaugeRad(v.start), gaugeRad(v.end)); ctx.strokeStyle = v.col.main; ctx.lineWidth = 3 * k; ctx.stroke();
      ctx.restore();
    },

    // H: one thin hand plus the remaining sector shaded at 10%.
    sundial(ctx, v) {
      const { C, R, k } = v;
      gaugeCircle(ctx, v, R, k, 0.10);
      gaugeIndex12(ctx, v, 0.35);
      const inner = R * 0.5;
      ctx.save(); ctx.lineCap = 'round';
      if (v.idle) {
        ctx.beginPath(); ctx.moveTo(...gaugePolar(v, 0, inner)); ctx.lineTo(...gaugePolar(v, 0, R));
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)'; ctx.lineWidth = 1.5 * k; ctx.stroke(); ctx.restore(); return;
      }
      const a = v.paused ? 0.4 : 1;
      if (v.span > 0.002) {
        ctx.globalAlpha = 0.10 * a; ctx.fillStyle = v.col.main;
        ctx.beginPath(); ctx.moveTo(C, C); ctx.arc(C, C, R - 0.5 * k, gaugeRad(v.start), gaugeRad(v.end)); ctx.closePath(); ctx.fill();
      }
      ctx.globalAlpha = a;
      ctx.beginPath(); ctx.moveTo(...gaugePolar(v, v.start, inner)); ctx.lineTo(...gaugePolar(v, v.start, R));
      ctx.strokeStyle = v.col.main; ctx.lineWidth = 1.5 * k; ctx.stroke();
      const [x, y] = gaugePolar(v, v.start, R);
      ctx.fillStyle = v.col.warm; ctx.beginPath(); ctx.arc(x, y, 2.5 * k, 0, TAU); ctx.fill();
      ctx.restore();
    },

    // I: one thin bar per minute; passed bars go dim, the current one fades.
    bars(ctx, v) {
      const { R, k } = v;
      const n = v.minutes, len = (n <= 10 ? 14 : 10) * k, elapsed = 1 - v.span;
      ctx.save(); ctx.lineWidth = 2 * k; ctx.lineCap = 'butt';
      for (let i = 0; i < n; i++) {
        const ang = (i + 0.5) * 360 / n, lo = i / n, hi = (i + 1) / n;
        let col = 'rgba(255, 255, 255, 0.12)', alpha = 1;
        if (!v.idle) {
          if (elapsed < lo) col = v.col.main;
          else if (elapsed < hi) { col = v.col.main; alpha = 0.35 + 0.65 * (hi - elapsed) * n; }
          if (col === v.col.main && v.paused) alpha *= 0.4;
        }
        ctx.globalAlpha = alpha; ctx.strokeStyle = col;
        ctx.beginPath(); ctx.moveTo(...gaugePolar(v, ang, R - len)); ctx.lineTo(...gaugePolar(v, ang, R)); ctx.stroke();
      }
      ctx.restore();
    },

    // J: no ring; the digits themselves drain (CSS on #timer-display, see
    // style.css) - the level is the time left.
    ink(_ctx, v) {
      const level = v.idle ? 100 : Math.round(v.span * 1000) / 10;
      el.timerDisplay.style.setProperty('--ink-level', `${level}%`);
      el.timerDisplay.style.setProperty('--ink-alpha', v.paused ? '0.4' : '1');
    },

    // K: a glow behind the digits that shrinks and fades, plus a hairline
    // ring with an end dot for the exact reading.
    halo(ctx, v) {
      const { C, R, k } = v;
      gaugeCircle(ctx, v, R, k, v.idle ? 0.10 : 0.08);
      if (v.idle || v.span <= 0) return;
      ctx.save(); gaugeDim(ctx, v);
      const gr = (34 + 52 * v.span) * k, a = 0.10 + 0.32 * v.span;
      const g = ctx.createRadialGradient(C, C, 0, C, C, gr);
      g.addColorStop(0, gaugeAlpha(v.col.main, a)); g.addColorStop(0.55, gaugeAlpha(v.col.main, a * 0.45)); g.addColorStop(1, gaugeAlpha(v.col.main, 0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(C, C, gr, 0, TAU); ctx.fill();
      ctx.lineWidth = 1.5 * k; ctx.lineCap = 'round'; ctx.strokeStyle = v.col.main;
      ctx.beginPath(); ctx.arc(C, C, R, gaugeRad(v.start), gaugeRad(v.end)); ctx.stroke();
      const [x, y] = gaugePolar(v, v.start, R);
      ctx.fillStyle = v.col.warm; ctx.beginPath(); ctx.arc(x, y, 2.5 * k, 0, TAU); ctx.fill();
      ctx.restore();
    },

    // L: a single 120deg arc across the top, plus the long-break cycle as
    // dots under the digits.
    arc(ctx, v) {
      const { C, k } = v;
      const R = v.R * 0.91, a0 = -60, span = 120;
      ctx.save(); ctx.lineCap = 'round'; ctx.lineWidth = 5 * k;
      ctx.strokeStyle = `rgba(255, 255, 255, ${v.idle ? 0.10 : 0.08})`;
      ctx.beginPath(); ctx.arc(C, C, R, gaugeRad(a0), gaugeRad(a0 + span)); ctx.stroke();
      if (!v.idle && v.span > 0) {
        gaugeDim(ctx, v);
        const s = a0 + span * (1 - v.span);
        const g = ctx.createLinearGradient(C - R, 0, C + R, 0);
        g.addColorStop(0, v.col.warm); g.addColorStop(1, v.col.main);
        ctx.strokeStyle = g; ctx.beginPath(); ctx.arc(C, C, R, gaugeRad(s), gaugeRad(a0 + span)); ctx.stroke();
      }
      ctx.restore();
      gaugeCycleDots(ctx, v, C + v.R * 0.375, 12 * k, 2.5 * k);
    },

    // M: no circle; a 2px bar under the digits with a bright end cap.
    bar(ctx, v) {
      const { C, R, k } = v;
      const w = R * 1.27, x0 = C - w / 2, x1 = C + w / 2, y = C + R * 0.3;
      ctx.save(); ctx.lineCap = 'round'; ctx.lineWidth = 2 * k;
      ctx.strokeStyle = `rgba(255, 255, 255, ${v.idle ? 0.14 : 0.10})`;
      ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
      if (!v.idle && v.span > 0) {
        gaugeDim(ctx, v);
        const xs = x0 + w * (1 - v.span);
        ctx.strokeStyle = v.col.main; ctx.beginPath(); ctx.moveTo(xs, y); ctx.lineTo(x1, y); ctx.stroke();
        ctx.shadowColor = v.col.main; ctx.shadowBlur = 6 * k;
        ctx.fillStyle = v.col.warm; ctx.beginPath(); ctx.arc(xs, y, 3 * k, 0, TAU); ctx.fill();
      }
      ctx.restore();
    },

    // The level is the time left; a slow ripple only while running.
    liquid(ctx, v) {
      const { C, S, k } = v;
      const rr = v.R - 2 * k;
      ctx.save();
      ctx.beginPath(); ctx.arc(C, C, rr, 0, TAU); ctx.clip();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.05)'; ctx.fillRect(0, 0, S, S);
      const level = C + rr - 2 * rr * v.span;
      const amp = running && gaugeMotionOk() && v.span > 0 && v.span < 1 ? 3 * k : 0;
      const phase = performance.now() / 700;
      ctx.beginPath(); ctx.moveTo(0, S);
      for (let x = 0; x <= S; x += 2) ctx.lineTo(x, level + Math.sin(x / (18 * k) + phase) * amp);
      ctx.lineTo(S, S); ctx.closePath();
      const g = ctx.createLinearGradient(0, level - 6 * k, 0, S);
      if (v.idle) { g.addColorStop(0, 'rgba(255, 255, 255, 0.22)'); g.addColorStop(1, 'rgba(255, 255, 255, 0.10)'); }
      else { g.addColorStop(0, v.col.warm); g.addColorStop(0.18, v.col.main); g.addColorStop(1, v.col.main); }
      ctx.globalAlpha = v.paused ? 0.4 : 1;
      ctx.fillStyle = g; ctx.fill();
      ctx.restore();
      gaugeCircle(ctx, v, rr + k, 2 * k, 0.30);
    },
  };

  // The image overhangs the widget by twice the blur radius, just enough
  // to push blur's faded edge out of sight - and no more, so an unblurred
  // image in a window matched to its ratio shows whole, uncropped.
  function applyBackgroundBlur(px) {
    el.bgImage.style.filter = `blur(${px}px)`;
    el.bgImage.style.inset = `${-2 * px}px`;
  }

  function applyBackgroundTint(color, opacityPercent) {
    el.bgTint.style.background = color;
    el.bgTint.style.opacity = String(opacityPercent / 100);
  }

  // The image's own pixel size, for the "Match window to image ratio"
  // buttons (null while there's no image, or it hasn't decoded yet).
  let bgImageSize = null;
  let bgImageToken = 0;
  function setBackgroundImage(dataUrl) {
    el.bgImage.style.backgroundImage = dataUrl ? `url(${dataUrl})` : 'none';
    bgImageSize = null;
    el.bgFitWidthBtn.disabled = el.bgFitHeightBtn.disabled = true;
    const token = ++bgImageToken;
    if (!dataUrl) return;
    const img = new Image();
    img.onload = () => {
      if (token !== bgImageToken || !img.naturalWidth || !img.naturalHeight) return; // replaced meanwhile
      bgImageSize = { width: img.naturalWidth, height: img.naturalHeight };
      el.bgFitWidthBtn.disabled = el.bgFitHeightBtn.disabled = false;
    };
    img.src = dataUrl;
  }

  function normalizedMinutes(input, fallback) {
    const value = Number(input.value);
    const min = Number(input.min);
    const max = Number(input.max);
    const minutes = Number.isFinite(value) && value > 0 ? value : fallback;
    return Math.min(max, Math.max(min, Math.round(minutes)));
  }

  function currentDurationSec() {
    const input = mode === 'work' ? el.workMin : mode === 'longBreak' ? el.longBreakMin : el.breakMin;
    return normalizedMinutes(input, mode === 'work' ? 25 : mode === 'longBreak' ? 15 : 5) * 60;
  }

  const PHASE_NAMES = { work: 'Focus', break: 'Break', longBreak: 'Long break' };

  // Whether the phase that just began should run on its own, or wait at
  // full time for Start.
  function autoStartsCurrentPhase() {
    return mode === 'work' ? el.autoStartFocus.checked : el.autoStartBreaks.checked;
  }

  function resetTimer() {
    stopTick();
    if (mode === 'work') finishSession(false);
    phaseDurationMs = currentDurationSec() * 1000;
    remainingMs = phaseDurationMs;
    running = false;
    render();
  }

  // A single short chime, synthesized on the fly (no bundled audio asset,
  // no autoplay-policy issues since it only ever fires after the user has
  // already clicked Start). Only the fallback for when no Windows
  // notification (with its alarm sound) is shown.
  function playChime() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, now);
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.25, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.5);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.5);
      osc.onended = () => ctx.close();
    } catch (e) {
      // best effort; a missing/blocked AudioContext should never break the timer
    }
  }

  function finishSession(completed, endAt = Date.now()) {
    const done = session;
    session = null;
    workCarryMs = 0;
    if (!done || (!completed && done.workedSec < MIN_RECORDED_SEC)) return Promise.resolve();
    const record = {
      start: done.start,
      end: new Date(Math.max(endAt, Date.parse(done.start))).toISOString(),
      workedSec: done.workedSec,
      note: el.taskInput.value.trim(),
      completed,
    };
    const write = window.pomodoro.addSession(record).then(() => window.dispatchEvent(new Event('session-recorded')), (error) => {
      failedSessions.push(record);
      throw error;
    });
    pendingSessions.add(write);
    write.finally(() => pendingSessions.delete(write)).catch(() => {});
    write.catch(() => {}); // ordinary timer actions have no caller to await
    return write;
  }

  // Every Nth finished focus session is followed by a long break.
  function switchMode(boundaryWallAt) {
    if (mode === 'work') {
      totalTurns += 1;
      finishSession(true, boundaryWallAt);
      focusInCycle += 1;
      const long = focusInCycle >= Math.max(2, Number(el.longBreakEvery.value || 4));
      if (long) focusInCycle = 0;
      mode = long ? 'longBreak' : 'break';
    } else {
      mode = 'work';
    }
    saveStats();
    phaseDurationMs = currentDurationSec() * 1000;
    remainingMs = phaseDurationMs;
    applyModeColor();
    // `mode` is already the phase that's starting.
    const title = mode === 'work' ? 'Break is over' : 'Focus time is over';
    let body = mode === 'work' ? 'Time to focus.' : mode === 'longBreak' ? 'Take a long break.' : 'Take a short break.';
    if (!autoStartsCurrentPhase()) body += ' Press Start when you\'re ready.';
    // The Windows notification plays the Windows alarm sound; the app's own
    // chime stands in when notifications are off or none could be shown.
    if (el.notifyOnPhaseChange.checked) {
      window.pomodoro.notify(title, body).then((shown) => { if (!shown) playChime(); }, () => playChime());
    } else {
      playChime();
    }
    playPhaseSweep();
  }

  // Credits focus time in whole seconds; the remainder carries over.
  function creditWork(ms) {
    if (ms <= 0) return;
    if (!session) session = { start: new Date(runWallAt).toISOString(), workedSec: 0 };
    workCarryMs += ms;
    const whole = Math.floor(workCarryMs / 1000);
    workCarryMs -= whole * 1000;
    session.workedSec += whole;
    totalStudySeconds += whole;
    unsavedStudySeconds += whole;
    // Batched so a running timer doesn't rewrite settings.json every second;
    // at most this many seconds are lost if the app is killed outright.
    if (unsavedStudySeconds >= 10) saveStats();
  }

  // Accounts for the clock up to `now`, switching phases as they end. Each
  // new phase starts exactly where the last one ended, so a late tick
  // shifts nothing.
  function advanceTo(now) {
    for (;;) {
      const upTo = Math.min(now, phaseEndAt);
      if (mode === 'work') creditWork(upTo - lastTickAt);
      lastTickAt = upTo;
      if (now < phaseEndAt) break;
      const boundaryWallAt = Date.now() - (performance.now() - upTo);
      switchMode(boundaryWallAt);
      runWallAt = boundaryWallAt;
      if (!autoStartsCurrentPhase()) {
        // Waits at full time (idle) for Start.
        if (timerId) {
          clearInterval(timerId);
          timerId = null;
        }
        running = false;
        return;
      }
      phaseEndAt = upTo + remainingMs;
    }
    remainingMs = phaseEndAt - now;
  }

  function tick() {
    const now = performance.now();
    if (now - lastTickAt > SLEEP_GAP_MS) {
      pauseAt(lastTickAt);
      return;
    }
    advanceTo(now);
    render();
  }

  function startTick() {
    if (timerId) return;
    running = true;
    lastTickAt = performance.now();
    runWallAt = Date.now();
    phaseEndAt = lastTickAt + remainingMs;
    timerId = setInterval(tick, TICK_MS);
    render();
  }

  // Stops the clock as of `at` (now, or the last tick before a sleep).
  function pauseAt(at) {
    if (timerId) {
      clearInterval(timerId);
      timerId = null;
      if (at - lastTickAt > SLEEP_GAP_MS) at = lastTickAt;
      advanceTo(at);
    }
    if (unsavedStudySeconds > 0) saveStats();
    running = false;
    render();
  }

  function stopTick() {
    pauseAt(performance.now());
  }

  let runWallAt = 0;

  // Main waits for this promise before closing the renderer. Retain failed
  // records so a later close attempt can retry without duplicating successes.
  window.pomodoro.onPrepareQuit(async () => {
    await initialized;
    stopTick();
    if (mode === 'work') await finishSession(false);
    const writes = [...pendingSessions];
    const settled = await Promise.allSettled(writes);
    if (settled.some((result) => result.status === 'rejected')) throw new Error('Could not save a focus session');
    while (failedSessions.length) {
      const record = failedSessions[0];
      await window.pomodoro.addSession(record);
      failedSessions.shift();
      window.dispatchEvent(new Event('session-recorded'));
    }
    await window.pomodoro.saveSettings({ totalTurns, totalStudySeconds });
  });

  // The PC going to sleep pauses the timer; it stays paused after waking.
  window.pomodoro.onSuspend(() => pauseAt(lastTickAt));

  el.startPauseBtn.addEventListener('click', () => {
    window.pomodoro.closeNotification();
    if (running) stopTick();
    else startTick();
  });

  el.resetBtn.addEventListener('click', () => {
    window.pomodoro.closeNotification();
    resetTimer();
  });

  // Switches straight to the other phase, right now - not treated as a
  // natural completion: a skipped work phase is recorded like an early
  // stop (no turn credited, no long-break progress), same as Reset. It
  // always lands on the short break, and always returns to work from
  // either kind of break, regardless of what was running.
  el.skipModeBtn.addEventListener('click', () => {
    window.pomodoro.closeNotification();
    stopTick();
    if (mode === 'work') {
      finishSession(false);
      mode = 'break';
    } else {
      mode = 'work';
    }
    applyModeColor();
    phaseDurationMs = currentDurationSec() * 1000;
    remainingMs = phaseDurationMs;
    saveStats();
    render();
  });

  // Reset Session: the timer goes all the way back to a fresh, idle focus
  // period (like ↻, an in-progress focus session of a minute or more is
  // still recorded), and both totals return to 0.
  el.statsResetBtn.addEventListener('click', async () => {
    if (!(await window.pomodoro.confirmResetSession())) return;
    window.pomodoro.closeNotification();
    stopTick();
    if (mode === 'work') finishSession(false);
    session = null;
    mode = 'work';
    focusInCycle = 0;
    applyModeColor();
    phaseDurationMs = currentDurationSec() * 1000;
    remainingMs = phaseDurationMs;
    totalTurns = 0;
    totalStudySeconds = 0;
    saveStats();
    render();
  });

  // Editing a duration updates an idle phase, leaving a paused one intact.
  el.workMin.addEventListener('change', () => {
    const minutes = normalizedMinutes(el.workMin, 25);
    el.workMin.value = minutes;
    window.pomodoro.saveSettings({ workMinutes: minutes });
    if (timerState() === 'idle' && mode === 'work') resetTimer();
  });
  el.breakMin.addEventListener('change', () => {
    const minutes = normalizedMinutes(el.breakMin, 5);
    el.breakMin.value = minutes;
    window.pomodoro.saveSettings({ breakMinutes: minutes });
    if (timerState() === 'idle' && mode === 'break') resetTimer();
  });
  el.longBreakMin.addEventListener('change', () => {
    const minutes = normalizedMinutes(el.longBreakMin, 15);
    el.longBreakMin.value = minutes;
    window.pomodoro.saveSettings({ longBreakMinutes: minutes });
    if (timerState() === 'idle' && mode === 'longBreak') resetTimer();
  });
  el.longBreakEvery.addEventListener('change', () => {
    const count = normalizedMinutes(el.longBreakEvery, 4);
    el.longBreakEvery.value = count;
    window.pomodoro.saveSettings({ longBreakEvery: count });
  });
  el.autoStartBreaks.addEventListener('change', () => {
    window.pomodoro.saveSettings({ autoStartBreaks: el.autoStartBreaks.checked });
  });
  el.autoStartFocus.addEventListener('change', () => {
    window.pomodoro.saveSettings({ autoStartFocus: el.autoStartFocus.checked });
  });

  el.notifyOnPhaseChange.addEventListener('change', () => {
    window.pomodoro.saveSettings({ notifyOnPhaseChange: el.notifyOnPhaseChange.checked });
  });

  el.alwaysTop.addEventListener('change', async () => {
    await window.pomodoro.setAlwaysOnTop(el.alwaysTop.checked);
  });

  el.minimizeToTray.addEventListener('change', async () => {
    await window.pomodoro.setMinimizeToTray(el.minimizeToTray.checked);
  });

  el.closeToTray.addEventListener('change', async () => {
    await window.pomodoro.setCloseToTray(el.closeToTray.checked);
  });

  el.closeBtn.addEventListener('click', () => {
    window.pomodoro.closeWindow();
  });

  function setPinButtonState(locked) {
    el.pinBtn.setAttribute('aria-pressed', String(locked));
    el.app.classList.toggle('size-locked', locked);
  }

  // Edge and corner handles resize the window (the window is transparent,
  // so it has no native resize border). Main does the actual tracking, by
  // polling the cursor (see window:resizeStart in main.js) - not from this
  // pointer's own coordinates, which is what keeps it correct across
  // monitors at different DPI.
  document.querySelectorAll('#resize-handles > div').forEach((handle) => {
    handle.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      handle.setPointerCapture(e.pointerId);
      window.pomodoro.resizeStart(handle.dataset.edge);
      const end = () => window.pomodoro.resizeEnd();
      handle.addEventListener('pointerup', end, { once: true });
      handle.addEventListener('lostpointercapture', end, { once: true });
    });
  });

  el.pinBtn.addEventListener('click', async () => {
    const locked = el.pinBtn.getAttribute('aria-pressed') !== 'true';
    const result = await window.pomodoro.setSizeLocked(locked);
    setPinButtonState(result.sizeLocked);
  });

  // Works whether or not pinned; leaving fullscreen restores the exact size
  // and position the window had before.
  el.fullscreenBtn.addEventListener('click', () => window.pomodoro.toggleFullscreen());
  el.resetSizeBtn.addEventListener('click', () => window.pomodoro.resetSize());
  // Spots where a press or double-click means something of its own.
  const INTERACTIVE = 'button, input, select, textarea, label, [role="button"], #settings-panel, #resize-handles, #panel-splitter';

  // Double-clicking the widget flips fullscreen <-> windowed, except on its
  // controls (and the panel).
  document.addEventListener('dblclick', (e) => {
    if (e.target.closest(INTERACTIVE)) return;
    window.pomodoro.toggleFullscreen();
  });

  // Dragging any other spot moves the window (there's no native drag
  // region; see #app in style.css). The move only starts past a few
  // pixels, so a click or double-click never nudges the window; this
  // slop check is the only thing this pointermove listener is for - once
  // past it, main does the actual tracking by polling the cursor itself
  // (see window:moveStart in main.js), not from this pointer's own
  // coordinates. The pointer is captured then so the slop-past state
  // keeps up outside the window. Main refuses the move while fullscreen.
  const DRAG_SLOP_PX = 3;
  el.app.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest(INTERACTIVE)) return;
    const startX = e.screenX;
    const startY = e.screenY;
    let moving = false;
    const move = (ev) => {
      if (moving) return;
      if (Math.abs(ev.screenX - startX) < DRAG_SLOP_PX && Math.abs(ev.screenY - startY) < DRAG_SLOP_PX) return;
      moving = true;
      try { el.app.setPointerCapture(ev.pointerId); } catch (err) { /* released already */ }
      window.pomodoro.moveStart();
    };
    const end = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      if (moving) window.pomodoro.moveEnd();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  });
  // Also fires when Esc leaves fullscreen.
  window.pomodoro.onFullscreenChange((on) => {
    el.fullscreenBtn.title = on ? 'Windowed (Esc)' : 'Fullscreen';
    el.app.classList.toggle('fullscreen', on);
  });

  el.bgPickBtn.addEventListener('click', async () => {
    const result = await window.pomodoro.pickBackgroundImage();
    if (result) setBackgroundImage(result.dataUrl);
  });

  el.bgClearBtn.addEventListener('click', async () => {
    await window.pomodoro.clearBackgroundImage();
    setBackgroundImage(null);
  });

  for (const [btn, keep] of [[el.bgFitWidthBtn, 'width'], [el.bgFitHeightBtn, 'height']]) {
    btn.addEventListener('click', () => {
      if (bgImageSize) window.pomodoro.fitAspect(keep, bgImageSize.width, bgImageSize.height);
    });
  }

  el.bgBlur.addEventListener('input', () => applyBackgroundBlur(Number(el.bgBlur.value)));
  el.bgBlur.addEventListener('change', () => {
    window.pomodoro.saveSettings({ backgroundBlur: Number(el.bgBlur.value) });
  });

  el.bgTintColor.addEventListener('input', () => {
    applyBackgroundTint(el.bgTintColor.value, Number(el.bgTintOpacity.value));
  });
  el.bgTintColor.addEventListener('change', () => {
    window.pomodoro.saveSettings({ backgroundTintColor: el.bgTintColor.value });
  });

  el.bgTintOpacity.addEventListener('input', () => {
    applyBackgroundTint(el.bgTintColor.value, Number(el.bgTintOpacity.value));
  });
  el.bgTintOpacity.addEventListener('change', () => {
    window.pomodoro.saveSettings({ backgroundTintOpacity: Number(el.bgTintOpacity.value) / 100 });
  });

  el.accentColor.addEventListener('input', () => {
    userAccentColor = el.accentColor.value;
    applyModeColor();
  });
  el.gaugeStyle.addEventListener('change', () => {
    setGaugeStyle(el.gaugeStyle.value);
    window.pomodoro.saveSettings({ gaugeStyle: el.gaugeStyle.value });
  });

  el.accentColor.addEventListener('change', () => {
    window.pomodoro.saveSettings({ accentColor: el.accentColor.value });
  });

  // A dropdown list's actual scrollbar width (0 on a platform/theme with
  // overlay scrollbars) - measured once, used to keep a list that needs to
  // scroll from clipping its own rows by exactly the scrollbar's width.
  const SCROLLBAR_WIDTH = (() => {
    const probe = document.createElement('div');
    probe.style.cssText = 'position:absolute;visibility:hidden;overflow:scroll;width:50px;height:50px;';
    document.body.appendChild(probe);
    const width = probe.offsetWidth - probe.clientWidth;
    probe.remove();
    return width;
  })();

  // A custom-styled view onto a hidden <select>: a native <select> popup's
  // highlighted-row color follows the OS accent and can't be restyled with
  // CSS (a longstanding Chromium limitation), which is why Gauge style and
  // Monitor didn't match the rest of the glass UI. The real <select> (see
  // index.html, class "hidden") keeps its value and fires its usual
  // change event, so every existing listener on it keeps working; this is
  // only a view, rebuilt from its <option>s whenever asked to refresh.
  function makeDropdown(select) {
    const wrap = select.previousElementSibling;
    const btn = wrap.querySelector('.dropdown-btn');
    const label = wrap.querySelector('.dropdown-label');
    const list = wrap.querySelector('.dropdown-list');
    // Moved to <body>: #app and #settings-panel both use backdrop-filter,
    // which (like filter) makes an element the containing block for its
    // fixed-position descendants - so a list left inside them isn't
    // actually fixed to the window at all, it's "fixed" to that filtered
    // ancestor's own box (and clipped by its overflow:hidden besides),
    // landing the open list at some corner unrelated to the button. <body>
    // has no such property, so position: fixed on the list means what it
    // looks like it means.
    document.body.appendChild(list);
    let highlighted = -1;
    const items = () => Array.from(list.children);
    const isOpen = () => !list.classList.contains('hidden');

    function sync() {
      const selected = select.selectedOptions[0];
      label.textContent = selected ? selected.textContent : '';
      items().forEach((li) => li.setAttribute('aria-selected', String(li.dataset.value === select.value)));
    }
    function build() {
      list.replaceChildren(...Array.from(select.options).map((opt) => {
        const li = document.createElement('li');
        li.textContent = opt.textContent;
        li.dataset.value = opt.value;
        li.setAttribute('role', 'option');
        return li;
      }));
      sync();
    }
    function position() {
      const r = btn.getBoundingClientRect();
      const margin = 4;
      // Never narrower than the button, but grown to fit the longest
      // option - a compact trigger button (e.g. the Goals tab's time zone
      // picker, showing just "Local") must not force-clip a list whose
      // items ("KST (Seoul)", ...) are much longer than the button itself.
      // Measured with the list's own max-height/overflow-y suspended (and
      // .hidden - display:none, which reports 0 for scrollWidth - removed):
      // otherwise a list tall enough to need its vertical scrollbar would
      // have that scrollbar's width carved out of the very box being
      // measured, clipping the rows by exactly that width.
      const wasHidden = list.classList.contains('hidden');
      if (wasHidden) { list.classList.remove('hidden'); list.style.visibility = 'hidden'; }
      list.style.maxHeight = 'none';
      list.style.overflowY = 'visible';
      list.style.width = 'max-content';
      const naturalWidth = list.scrollWidth;
      const naturalHeight = list.scrollHeight;
      list.style.maxHeight = '';
      list.style.overflowY = '';
      const needsVScroll = naturalHeight > 200;
      const width = Math.min(
        Math.max(Math.round(r.width), naturalWidth + (needsVScroll ? SCROLLBAR_WIDTH : 0)),
        window.innerWidth - margin * 2
      );
      list.style.width = `${width}px`;
      const estHeight = Math.min(naturalHeight, 200);
      if (wasHidden) { list.classList.add('hidden'); list.style.visibility = ''; }
      const left = Math.min(Math.round(r.left), window.innerWidth - width - margin);
      list.style.left = `${Math.max(margin, left)}px`;
      const spaceBelow = window.innerHeight - r.bottom;
      // Opens downward unless there's not enough room but more room above.
      if (spaceBelow < estHeight + margin && r.top > spaceBelow) {
        list.style.top = 'auto';
        list.style.bottom = `${Math.round(window.innerHeight - r.top + margin)}px`;
      } else {
        list.style.bottom = 'auto';
        list.style.top = `${Math.round(r.bottom + margin)}px`;
      }
    }
    function highlight(i) {
      highlighted = i;
      items().forEach((li, idx) => li.classList.toggle('highlighted', idx === i));
    }
    function open() {
      if (isOpen()) return;
      build(); // Monitor's options can change between opens
      position();
      list.classList.remove('hidden');
      btn.setAttribute('aria-expanded', 'true');
      highlight(items().findIndex((li) => li.dataset.value === select.value));
      list.focus();
    }
    function close() {
      if (!isOpen()) return;
      list.classList.add('hidden');
      btn.setAttribute('aria-expanded', 'false');
      btn.focus({ preventScroll: true }); // a scroll-away close must not yank the panel back
    }
    function choose(i) {
      const li = items()[i];
      if (!li) return;
      select.value = li.dataset.value;
      select.dispatchEvent(new Event('change'));
      sync();
      close();
    }
    btn.addEventListener('click', () => (isOpen() ? close() : open()));
    list.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); close(); } else if (e.key === 'ArrowDown') { e.preventDefault(); highlight(Math.min(items().length - 1, highlighted + 1)); } else if (e.key === 'ArrowUp') { e.preventDefault(); highlight(Math.max(0, highlighted - 1)); } else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(highlighted); }
    });
    list.addEventListener('click', (e) => {
      const li = e.target.closest('li');
      if (li) choose(items().indexOf(li));
    });
    // list is no longer a descendant of wrap (see above), so a click
    // inside it must be checked for separately or it would count as
    // "outside" and close the list out from under its own click handler.
    document.addEventListener('pointerdown', (e) => { if (isOpen() && !wrap.contains(e.target) && !list.contains(e.target)) close(); }, true);
    window.addEventListener('resize', () => { if (isOpen()) position(); });
    // The list is fixed to the window, so when whatever holds the button
    // scrolls - including the scroll that clicking a half-hidden button
    // causes as it takes focus - follow the button, and close only once it
    // has scrolled out of view. The list's own scrolling, or any scroller
    // that doesn't hold the button, is ignored.
    document.addEventListener('scroll', (e) => {
      if (!isOpen() || list.contains(e.target) || !(e.target === document || e.target.contains(btn))) return;
      const area = e.target === document ? { top: 0, bottom: window.innerHeight } : e.target.getBoundingClientRect();
      const b = btn.getBoundingClientRect();
      if (b.bottom <= area.top || b.top >= area.bottom) close();
      else position();
    }, true);
    build();
    return { refresh: build };
  }
  const gaugeDropdown = makeDropdown(el.gaugeStyle);
  const displayDropdown = makeDropdown(el.displaySelect);
  // panel.js (loaded after this script) reuses this for the Goals tab's
  // time zone picker - same reasoning, same widget.
  window.makeDropdown = makeDropdown;

  let panelOpen = false;
  el.gearBtn.addEventListener('click', async () => {
    panelOpen = !panelOpen;
    // The window grows to make room before the panel shows, and shrinks
    // back after it hides, so the timer is never squeezed in between.
    if (panelOpen) await window.pomodoro.setPanelOpen(true);
    el.settingsPanel.classList.toggle('hidden', !panelOpen);
    el.app.classList.toggle('panel-open', panelOpen); // shows the splitter
    if (!panelOpen) await window.pomodoro.setPanelOpen(false);
    window.dispatchEvent(new CustomEvent('panel-toggled', { detail: panelOpen }));
  });

  // Drags the panel's share of #app's height (--panel-split, a percentage
  // so it holds across window sizes), clamped in pixels so neither side
  // can be dragged out of usefulness regardless of the window's height.
  (() => {
    const MIN_PANEL_PX = 100;
    const MIN_MAIN_PX = 90;
    let dragging = false;
    let startY = 0;
    let startPx = 0;
    let appHeight = 0;
    const currentPct = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--panel-split')) || 48;
    el.panelSplitter.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      dragging = true;
      el.panelSplitter.classList.add('dragging');
      el.panelSplitter.setPointerCapture(e.pointerId);
      startY = e.clientY;
      appHeight = el.app.getBoundingClientRect().height;
      startPx = (currentPct() / 100) * appHeight;
    });
    el.panelSplitter.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      // Dragging up grows the panel (its share is measured from the bottom).
      const panelPx = Math.min(appHeight - MIN_MAIN_PX, Math.max(MIN_PANEL_PX, startPx + (startY - e.clientY)));
      document.documentElement.style.setProperty('--panel-split', `${(panelPx / appHeight) * 100}%`);
    });
    const end = () => {
      if (!dragging) return;
      dragging = false;
      el.panelSplitter.classList.remove('dragging');
      window.pomodoro.saveSettings({ panelSplit: currentPct() / 100 });
    };
    el.panelSplitter.addEventListener('pointerup', end);
    el.panelSplitter.addEventListener('lostpointercapture', end);
  })();

  // The session's goal. Enter confirms it and adds it to the Goals list;
  // picking a goal in that list sets it here (panel.js).
  el.taskInput.addEventListener('change', () => {
    window.pomodoro.saveSettings({ currentTask: el.taskInput.value.trim() });
    window.dispatchEvent(new Event('task-changed'));
  });
  el.taskInput.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter') return;
    const title = el.taskInput.value.trim();
    el.taskInput.blur();
    if (!title) return;
    const goal = await window.pomodoro.addGoal(title);
    // an existing goal matched case-insensitively: show its exact title
    if (goal && goal.title !== title) {
      el.taskInput.value = goal.title;
      el.taskInput.dispatchEvent(new Event('change'));
    }
    window.dispatchEvent(new Event('goals-changed'));
  });

  // The timer goal's own entry in the Goals list: an open goal with the
  // same title (any case), else the latest reached one.
  function matchGoal(goals) {
    const title = el.taskInput.value.trim().toLowerCase();
    if (!title) return null;
    const same = goals.filter((g) => g.title.toLowerCase() === title);
    return same.find((g) => !g.doneAt) || same[0] || null;
  }

  let goalCheckToken = 0;
  let cachedGoals = null;
  let goalsRequest = null;
  function getGoals() {
    if (cachedGoals) return Promise.resolve(cachedGoals);
    if (!goalsRequest) {
      const request = window.pomodoro.listGoals();
      goalsRequest = request;
      request.then((goals) => {
        if (goalsRequest === request) cachedGoals = goals;
      }).catch(() => {}).finally(() => {
        if (goalsRequest === request) goalsRequest = null;
      });
    }
    return goalsRequest;
  }

  async function refreshGoalCheck() {
    const token = ++goalCheckToken;
    el.goalField.classList.toggle('has-goal', !!el.taskInput.value.trim());
    const goal = matchGoal(await getGoals());
    if (token !== goalCheckToken) return; // a newer refresh is on its way
    const reached = !!(goal && goal.doneAt);
    el.goalCheck.setAttribute('aria-checked', String(reached));
    el.goalCheck.title = reached ? 'Reached. Click to mark as not reached' : 'Mark this goal as reached';
  }

  // Clicking the check flips the goal's reached state. Reaching it moves the
  // timer on to the next unreached goal in the Goals list; when every goal
  // is reached, this one stays.
  el.goalCheck.addEventListener('click', async () => {
    const title = el.taskInput.value.trim();
    if (!title) return;
    const goals = await getGoals();
    const goal = matchGoal(goals);
    if (goal && goal.doneAt) {
      await window.pomodoro.setGoalDone(goal.id, false);
    } else {
      const reached = goal || await window.pomodoro.addGoal(title);
      await window.pomodoro.setGoalDone(reached.id, true);
      const open = goals.filter((g) => !g.doneAt);
      const at = open.findIndex((g) => g.id === reached.id);
      const next = (at >= 0 && open[at + 1]) || open.find((g) => g.id !== reached.id);
      if (next) {
        el.taskInput.value = next.title;
        el.taskInput.dispatchEvent(new Event('change'));
      }
    }
    window.dispatchEvent(new Event('goals-changed'));
  });

  window.addEventListener('goals-changed', () => {
    cachedGoals = null;
    goalsRequest = null;
    refreshGoalCheck();
  });
  window.addEventListener('task-changed', refreshGoalCheck);
  el.taskInput.addEventListener('input', refreshGoalCheck);

  el.cornerButtons.forEach((btn) => {
    btn.addEventListener('click', async () => {
      const displayId = Number(el.displaySelect.value);
      await window.pomodoro.snapToCorner(displayId, btn.dataset.corner);
    });
  });

  async function populateDisplays() {
    const displays = await window.pomodoro.getDisplays();
    el.displaySelect.innerHTML = '';
    displays.forEach((d) => {
      const opt = document.createElement('option');
      opt.value = String(d.id);
      opt.textContent = d.label;
      el.displaySelect.appendChild(opt);
    });
    displayDropdown.refresh();
  }

  // Every value the Settings tab shows, applied to the UI - shared by
  // init() and by Reset Configuration, which fetches fresh defaults from
  // main and re-applies them the same way.
  function applyConfigToUI(settings) {
    el.workMin.value = settings.workMinutes;
    el.breakMin.value = settings.breakMinutes;
    el.longBreakMin.value = settings.longBreakMinutes;
    el.longBreakEvery.value = settings.longBreakEvery;
    el.autoStartBreaks.checked = settings.autoStartBreaks;
    el.autoStartFocus.checked = settings.autoStartFocus;
    el.notifyOnPhaseChange.checked = settings.notifyOnPhaseChange;
    el.alwaysTop.checked = settings.alwaysOnTop;
    el.minimizeToTray.checked = settings.minimizeToTray;
    el.closeToTray.checked = settings.closeToTray;
    el.bgBlur.value = settings.backgroundBlur;
    el.bgTintColor.value = settings.backgroundTintColor;
    el.bgTintOpacity.value = Math.round(settings.backgroundTintOpacity * 100);
    el.accentColor.value = settings.accentColor;
    el.gaugeStyle.value = settings.gaugeStyle;
    setGaugeStyle(settings.gaugeStyle);
    gaugeDropdown.refresh();
    userAccentColor = settings.accentColor;
    applyModeColor();
    applyBackgroundBlur(settings.backgroundBlur);
    applyBackgroundTint(settings.backgroundTintColor, Math.round(settings.backgroundTintOpacity * 100));
    document.documentElement.style.setProperty('--panel-split', `${settings.panelSplit * 100}%`);
  }

  // Data section: delete every Goal/Calendar record, or reset every
  // Settings value to its default. Both confirm risk in their own way -
  // records ask first (and the button is disabled with nothing to lose),
  // config reset doesn't ask (it's easy to re-pick a color or a minute
  // value) but does undo itself just as completely.
  async function refreshResetRecordsBtn() {
    el.resetRecordsBtn.disabled = !(await window.pomodoro.hasAnyRecords());
  }
  el.resetRecordsBtn.addEventListener('click', async () => {
    if (!(await window.pomodoro.confirmResetAllRecords())) return;
    await window.pomodoro.resetAllRecords();
    window.dispatchEvent(new Event('goals-changed'));
    window.dispatchEvent(new Event('session-recorded'));
    refreshResetRecordsBtn();
  });
  window.addEventListener('goals-changed', refreshResetRecordsBtn);
  window.addEventListener('session-recorded', refreshResetRecordsBtn);

  el.resetConfigBtn.addEventListener('click', async () => {
    const wasIdle = timerState() === 'idle';
    const settings = await window.pomodoro.resetConfig();
    applyConfigToUI(settings);
    setBackgroundImage(null); // resetConfig also drops the stored copy
    // Matches editing Work/Break directly: only while idle, so a running
    // or paused countdown is never yanked out from under the user.
    if (wasIdle && !running) resetTimer();
    else render();
  });

  async function init() {
    const backgroundToken = bgImageToken;
    const [settings, background, version] = await Promise.all([
      window.pomodoro.getSettings(),
      window.pomodoro.getBackgroundImage(),
      window.pomodoro.getVersion(),
    ]);
    applyConfigToUI(settings);
    setPinButtonState(settings.sizeLocked);
    if (background && backgroundToken === bgImageToken) setBackgroundImage(background.dataUrl);
    el.taskInput.value = settings.currentTask;
    refreshGoalCheck();
    totalTurns = settings.totalTurns;
    totalStudySeconds = settings.totalStudySeconds;
    phaseDurationMs = currentDurationSec() * 1000;
    remainingMs = phaseDurationMs;
    render();
    el.aboutVersion.textContent = `v${version}`;
    await populateDisplays();
    await refreshResetRecordsBtn();
  }

  window.pomodoro.onPointerInside((inside) => el.app.classList.toggle('pointer-inside', inside));

  const initialized = init();
})();
