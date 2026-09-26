(() => {
  const el = {
    app: document.getElementById('app'),
    totalTurns: document.getElementById('total-turns'),
    totalStudy: document.getElementById('total-study'),
    statsResetBtn: document.getElementById('stats-reset-btn'),
    timerDisplay: document.getElementById('timer-display'),
    startPauseBtn: document.getElementById('start-pause-btn'),
    resetBtn: document.getElementById('reset-btn'),
    pinBtn: document.getElementById('pin-btn'),
    fullscreenBtn: document.getElementById('fullscreen-btn'),
    gearBtn: document.getElementById('gear-btn'),
    closeBtn: document.getElementById('close-btn'),
    settingsPanel: document.getElementById('settings-panel'),
    workMin: document.getElementById('work-min'),
    breakMin: document.getElementById('break-min'),
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
    bgBlur: document.getElementById('bg-blur'),
    bgTintColor: document.getElementById('bg-tint-color'),
    bgTintOpacity: document.getElementById('bg-tint-opacity'),
    accentColor: document.getElementById('accent-color'),
    gaugeStyle: document.getElementById('gauge-style'),
  };


  const COLLAPSED_SIZE = { width: 300, height: 460 };
  const EXPANDED_SIZE = { width: 300, height: 780 };

  let mode = 'work'; // 'work' | 'break'
  let remainingSec = 25 * 60;
  let timerId = null;
  let running = false;
  let userAccentColor = '#f2405a';
  let pinnedSize = null; // set while the window size is locked; restored when settings close
  const BREAK_ACCENT_COLOR = '#40e0d0'; // turquoise
  let totalTurns = 0; // completed work sessions, persisted
  let totalStudySeconds = 0; // every second the timer actually ran in work mode, persisted
  let unsavedStudySeconds = 0;

  function fmt(sec) {
    const m = Math.floor(sec / 60).toString().padStart(2, '0');
    const s = Math.floor(sec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }

  function timerState() {
    if (running) return 'running';
    return remainingSec === currentDurationSec() ? 'idle' : 'paused';
  }

  function render() {
    const state = timerState();
    el.app.dataset.state = state;
    el.timerDisplay.textContent = fmt(remainingSec);
    el.startPauseBtn.classList.toggle('running', running);
    el.startPauseBtn.title = running ? 'Pause' : 'Start';
    const remainingFraction = remainingSec / currentDurationSec();
    // The arc spans [start, 360deg]; start advancing clockwise from 12
    // o'clock is the depleted portion growing clockwise.
    el.ringFill.style.setProperty('--ring-start', `${360 * (1 - remainingFraction)}deg`);
    renderStats();
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
  }

  // Work mode uses the user's chosen key color; break mode is always
  // turquoise, regardless of that setting.
  function applyModeColor() {
    document.documentElement.style.setProperty('--accent', mode === 'work' ? userAccentColor : BREAK_ACCENT_COLOR);
  }

  function applyBackgroundBlur(px) {
    el.bgImage.style.filter = `blur(${px}px)`;
  }

  function applyBackgroundTint(color, opacityPercent) {
    el.bgTint.style.background = color;
    el.bgTint.style.opacity = String(opacityPercent / 100);
  }

  function setBackgroundImage(dataUrl) {
    el.bgImage.style.backgroundImage = dataUrl ? `url(${dataUrl})` : 'none';
  }

  function currentDurationSec() {
    const minutes = mode === 'work' ? Number(el.workMin.value || 25) : Number(el.breakMin.value || 5);
    return Math.max(1, minutes) * 60;
  }

  function resetTimer() {
    stopTick();
    remainingSec = currentDurationSec();
    running = false;
    render();
  }

  // A single short chime, synthesized on the fly (no bundled audio asset,
  // no autoplay-policy issues since it only ever fires after the user has
  // already clicked Start).
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

  function switchMode() {
    if (mode === 'work') totalTurns += 1;
    mode = mode === 'work' ? 'break' : 'work';
    saveStats();
    remainingSec = currentDurationSec();
    applyModeColor();
    // `mode` is already the phase that's starting.
    const title = mode === 'work' ? 'Break is over' : 'Focus time is over';
    const body = mode === 'work' ? 'Time to focus.' : 'Take a short break.';
    if (el.notifyOnPhaseChange.checked) {
      window.pomodoro.notify(title, body);
    }
    playChime();
    playPhaseSweep();
  }

  function tick() {
    if (mode === 'work') {
      totalStudySeconds += 1;
      // Batched so a running timer doesn't rewrite settings.json every second;
      // at most this many seconds are lost if the app is killed outright.
      if (++unsavedStudySeconds >= 10) saveStats();
    }
    remainingSec -= 1;
    if (remainingSec <= 0) {
      switchMode();
    }
    render();
  }

  function startTick() {
    if (timerId) return;
    running = true;
    timerId = setInterval(tick, 1000);
    render();
  }

  function stopTick() {
    if (timerId) {
      clearInterval(timerId);
      timerId = null;
    }
    if (unsavedStudySeconds > 0) saveStats();
    running = false;
    render();
  }

  el.startPauseBtn.addEventListener('click', () => {
    window.pomodoro.closeNotification();
    if (running) stopTick();
    else startTick();
  });

  el.resetBtn.addEventListener('click', () => {
    window.pomodoro.closeNotification();
    resetTimer();
  });

  el.statsResetBtn.addEventListener('click', () => {
    totalTurns = 0;
    totalStudySeconds = 0;
    saveStats();
    renderStats();
  });

  // Changing minute inputs while stopped updates the visible countdown immediately.
  el.workMin.addEventListener('change', () => {
    window.pomodoro.saveSettings({ workMinutes: Number(el.workMin.value) });
    if (!running && mode === 'work') resetTimer();
  });
  el.breakMin.addEventListener('change', () => {
    window.pomodoro.saveSettings({ breakMinutes: Number(el.breakMin.value) });
    if (!running && mode === 'break') resetTimer();
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
    window.close();
  });

  function setPinButtonState(locked) {
    el.pinBtn.setAttribute('aria-pressed', String(locked));
  }

  el.pinBtn.addEventListener('click', async () => {
    const locked = el.pinBtn.getAttribute('aria-pressed') !== 'true';
    const result = await window.pomodoro.setSizeLocked(locked);
    setPinButtonState(result.sizeLocked);
    // Remember the size at the moment of pinning, so closing settings later
    // (which always expands first) restores this instead of the default.
    pinnedSize = result.sizeLocked ? { width: result.width, height: result.height } : null;
  });

  // Works whether or not pinned; leaving fullscreen while pinned returns to
  // the pinned size (main applies it once fullscreen has actually ended).
  el.fullscreenBtn.addEventListener('click', async () => {
    const isFullscreen = await window.pomodoro.toggleFullscreen(pinnedSize);
    el.fullscreenBtn.title = isFullscreen ? 'Windowed' : 'Fullscreen';
  });

  el.bgPickBtn.addEventListener('click', async () => {
    const result = await window.pomodoro.pickBackgroundImage();
    if (result) setBackgroundImage(result.dataUrl);
  });

  el.bgClearBtn.addEventListener('click', async () => {
    await window.pomodoro.clearBackgroundImage();
    setBackgroundImage(null);
  });

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
    el.app.dataset.gauge = el.gaugeStyle.value;
    window.pomodoro.saveSettings({ gaugeStyle: el.gaugeStyle.value });
  });

  el.accentColor.addEventListener('change', () => {
    window.pomodoro.saveSettings({ accentColor: el.accentColor.value });
  });

  let panelOpen = false;
  el.gearBtn.addEventListener('click', async () => {
    panelOpen = !panelOpen;
    el.settingsPanel.classList.toggle('hidden', !panelOpen);
    // Opening always expands to fit the panel; closing returns to whatever
    // size was pinned, if any, rather than always the generic default.
    const size = panelOpen ? EXPANDED_SIZE : (pinnedSize || COLLAPSED_SIZE);
    await window.pomodoro.resizeWindow(size.width, size.height);
  });

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
  }

  async function init() {
    const [settings, background] = await Promise.all([
      window.pomodoro.getSettings(),
      window.pomodoro.getBackgroundImage(),
    ]);
    el.workMin.value = settings.workMinutes;
    el.breakMin.value = settings.breakMinutes;
    el.notifyOnPhaseChange.checked = settings.notifyOnPhaseChange;
    el.alwaysTop.checked = settings.alwaysOnTop;
    setPinButtonState(settings.sizeLocked);
    el.minimizeToTray.checked = settings.minimizeToTray;
    el.closeToTray.checked = settings.closeToTray;
    el.bgBlur.value = settings.backgroundBlur;
    el.bgTintColor.value = settings.backgroundTintColor;
    el.bgTintOpacity.value = Math.round(settings.backgroundTintOpacity * 100);
    el.accentColor.value = settings.accentColor;
    el.gaugeStyle.value = settings.gaugeStyle;
    el.app.dataset.gauge = settings.gaugeStyle;
    userAccentColor = settings.accentColor;
    applyModeColor();
    applyBackgroundBlur(settings.backgroundBlur);
    applyBackgroundTint(settings.backgroundTintColor, Math.round(settings.backgroundTintOpacity * 100));
    if (background) setBackgroundImage(background.dataUrl);
    totalTurns = settings.totalTurns;
    totalStudySeconds = settings.totalStudySeconds;
    remainingSec = settings.workMinutes * 60;
    render();
    await populateDisplays();
  }

  window.pomodoro.onPointerInside((inside) => el.app.classList.toggle('pointer-inside', inside));

  init();
})();
