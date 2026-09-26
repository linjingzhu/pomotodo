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



  let mode = 'work'; // 'work' | 'break'
  let remainingSec = 25 * 60;
  let timerId = null;
  let running = false;
  let userAccentColor = '#f2405a';
  const BREAK_ACCENT_COLOR = '#40e0d0'; // turquoise
  let totalTurns = 0; // completed work sessions, persisted
  let totalStudySeconds = 0; // every second the timer actually ran in work mode, persisted
  let unsavedStudySeconds = 0;
  // The focus session in progress: when it began and the seconds actually
  // ticked (pauses excluded). Recorded when it completes, or when it's reset
  // after at least a minute of work.
  let session = null;
  const MIN_RECORDED_SEC = 60;

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
    if (mode === 'work') finishSession(false);
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

  function finishSession(completed) {
    const done = session;
    session = null;
    if (!done || (!completed && done.workedSec < MIN_RECORDED_SEC)) return;
    window.pomodoro.addSession({
      start: done.start,
      end: new Date().toISOString(),
      workedSec: done.workedSec,
      note: el.taskInput.value.trim(),
      completed,
    }).then(() => window.dispatchEvent(new Event('session-recorded')));
  }

  function switchMode() {
    if (mode === 'work') {
      totalTurns += 1;
      finishSession(true);
    }
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
      if (!session) session = { start: new Date(Date.now() - 1000).toISOString(), workedSec: 0 };
      session.workedSec += 1;
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

  // Reset Session: the timer goes all the way back to a fresh, idle focus
  // period (like ↻, an in-progress focus session of a minute or more is
  // still recorded), and both totals return to 0.
  el.statsResetBtn.addEventListener('click', () => {
    window.pomodoro.closeNotification();
    stopTick();
    if (mode === 'work') finishSession(false);
    session = null;
    mode = 'work';
    applyModeColor();
    remainingSec = currentDurationSec();
    totalTurns = 0;
    totalStudySeconds = 0;
    saveStats();
    render();
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
    el.app.classList.toggle('size-locked', locked);
  }

  // Edge and corner handles resize the window (the window is transparent,
  // so it has no native resize border). Pointer capture keeps the moves
  // coming while the cursor is outside the window; at most one resize is
  // sent per frame, and the last one always goes out.
  document.querySelectorAll('#resize-handles > div').forEach((handle) => {
    handle.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      handle.setPointerCapture(e.pointerId);
      const { edge } = handle.dataset;
      const startX = e.screenX;
      const startY = e.screenY;
      let pending = null;
      let done = false;
      const flush = () => {
        if (pending) window.pomodoro.resizeMove(edge, pending.dx, pending.dy);
        pending = null;
      };
      const move = (ev) => {
        if (!pending) requestAnimationFrame(flush);
        pending = { dx: ev.screenX - startX, dy: ev.screenY - startY };
      };
      const end = () => {
        if (done) return;
        done = true;
        flush();
        window.pomodoro.resizeEnd();
        handle.removeEventListener('pointermove', move);
      };
      window.pomodoro.resizeStart();
      handle.addEventListener('pointermove', move);
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
    // The window already has room for the panel, so it opens in place
    // without resizing the window.
    el.settingsPanel.classList.toggle('hidden', !panelOpen);
    window.dispatchEvent(new CustomEvent('panel-toggled', { detail: panelOpen }));
  });

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
  async function refreshGoalCheck() {
    const token = ++goalCheckToken;
    el.goalField.classList.toggle('has-goal', !!el.taskInput.value.trim());
    const goal = matchGoal(await window.pomodoro.listGoals());
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
    const goals = await window.pomodoro.listGoals();
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

  ['goals-changed', 'task-changed'].forEach((name) => window.addEventListener(name, refreshGoalCheck));
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
    el.taskInput.value = settings.currentTask;
    refreshGoalCheck();
    totalTurns = settings.totalTurns;
    totalStudySeconds = settings.totalStudySeconds;
    remainingSec = settings.workMinutes * 60;
    render();
    await populateDisplays();
  }

  window.pomodoro.onPointerInside((inside) => el.app.classList.toggle('pointer-inside', inside));

  init();
})();
