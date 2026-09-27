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
  // Time is kept by the wall clock, not by counting ticks: a hidden or
  // minimized window's timers can be throttled to one wake-up a minute,
  // which made a tick-counting timer all but stop in the tray. Ticks only
  // sample the clock.
  let remainingMs = 25 * 60 * 1000;
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
  const MIN_RECORDED_SEC = 60;

  function fmt(sec) {
    const m = Math.floor(sec / 60).toString().padStart(2, '0');
    const s = Math.floor(sec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }

  function timerState() {
    if (running) return 'running';
    return remainingMs === currentDurationSec() * 1000 ? 'idle' : 'paused';
  }

  function render() {
    const state = timerState();
    el.app.dataset.state = state;
    el.timerDisplay.textContent = fmt(Math.ceil(remainingMs / 1000));
    el.startPauseBtn.classList.toggle('running', running);
    el.startPauseBtn.title = running ? 'Pause' : 'Start';
    const remainingFraction = remainingMs / (currentDurationSec() * 1000);
    // The arc spans [start, 360deg]; start advancing clockwise from 12
    // o'clock is the depleted portion growing clockwise.
    el.ringFill.style.setProperty('--ring-start', `${360 * (1 - remainingFraction)}deg`);
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
  }

  // Work mode uses the user's chosen key color; break mode is always
  // turquoise, regardless of that setting.
  function applyModeColor() {
    document.documentElement.style.setProperty('--accent', mode === 'work' ? userAccentColor : BREAK_ACCENT_COLOR);
    document.documentElement.style.setProperty('--key', userAccentColor);
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
    const minutes = mode === 'work' ? Number(el.workMin.value || 25)
      : mode === 'longBreak' ? Number(el.longBreakMin.value || 15)
        : Number(el.breakMin.value || 5);
    return Math.max(1, minutes) * 60;
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
    remainingMs = currentDurationSec() * 1000;
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

  function finishSession(completed) {
    const done = session;
    session = null;
    workCarryMs = 0;
    if (!done || (!completed && done.workedSec < MIN_RECORDED_SEC)) return;
    window.pomodoro.addSession({
      start: done.start,
      end: new Date().toISOString(),
      workedSec: done.workedSec,
      note: el.taskInput.value.trim(),
      completed,
    }).then(() => window.dispatchEvent(new Event('session-recorded')));
  }

  // Every Nth finished focus session is followed by a long break.
  function switchMode() {
    if (mode === 'work') {
      totalTurns += 1;
      finishSession(true);
      focusInCycle += 1;
      const long = focusInCycle >= Math.max(2, Number(el.longBreakEvery.value || 4));
      if (long) focusInCycle = 0;
      mode = long ? 'longBreak' : 'break';
    } else {
      mode = 'work';
    }
    saveStats();
    remainingMs = currentDurationSec() * 1000;
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
    if (!session) session = { start: new Date(lastTickAt).toISOString(), workedSec: 0 };
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
      switchMode();
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
    const now = Date.now();
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
    lastTickAt = Date.now();
    phaseEndAt = lastTickAt + remainingMs;
    timerId = setInterval(tick, TICK_MS);
    render();
  }

  // Stops the clock as of `at` (now, or the last tick before a sleep).
  function pauseAt(at) {
    if (timerId) {
      clearInterval(timerId);
      timerId = null;
      advanceTo(at);
    }
    if (unsavedStudySeconds > 0) saveStats();
    running = false;
    render();
  }

  function stopTick() {
    pauseAt(Date.now());
  }

  // The PC going to sleep pauses the timer; it stays paused after waking.
  window.pomodoro.onSuspend(() => stopTick());

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
  el.statsResetBtn.addEventListener('click', async () => {
    if (!(await window.pomodoro.confirmResetSession())) return;
    window.pomodoro.closeNotification();
    stopTick();
    if (mode === 'work') finishSession(false);
    session = null;
    mode = 'work';
    focusInCycle = 0;
    applyModeColor();
    remainingMs = currentDurationSec() * 1000;
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
  el.longBreakMin.addEventListener('change', () => {
    window.pomodoro.saveSettings({ longBreakMinutes: Number(el.longBreakMin.value) });
    if (!running && mode === 'longBreak') resetTimer();
  });
  el.longBreakEvery.addEventListener('change', () => {
    window.pomodoro.saveSettings({ longBreakEvery: Number(el.longBreakEvery.value) });
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
    window.close();
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
      list.style.left = `${Math.round(r.left)}px`;
      list.style.width = `${Math.round(r.width)}px`;
      const estHeight = Math.min(list.scrollHeight || items().length * 28 + 8, 200);
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
      btn.focus();
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
    document.addEventListener('pointerdown', (e) => { if (isOpen() && !wrap.contains(e.target)) close(); }, true);
    window.addEventListener('resize', () => { if (isOpen()) position(); });
    build();
    return { refresh: build };
  }
  const gaugeDropdown = makeDropdown(el.gaugeStyle);
  const displayDropdown = makeDropdown(el.displaySelect);

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
    el.app.dataset.gauge = settings.gaugeStyle;
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
    const settings = await window.pomodoro.resetConfig();
    applyConfigToUI(settings);
    setBackgroundImage(null); // resetConfig also drops the stored copy
    // Matches editing Work/Break directly: only while idle, so a running
    // or paused countdown is never yanked out from under the user.
    if (!running && (mode === 'work' || mode === 'break' || mode === 'longBreak')) resetTimer();
  });

  async function init() {
    const [settings, background, version] = await Promise.all([
      window.pomodoro.getSettings(),
      window.pomodoro.getBackgroundImage(),
      window.pomodoro.getVersion(),
    ]);
    applyConfigToUI(settings);
    setPinButtonState(settings.sizeLocked);
    if (background) setBackgroundImage(background.dataUrl);
    el.taskInput.value = settings.currentTask;
    refreshGoalCheck();
    totalTurns = settings.totalTurns;
    totalStudySeconds = settings.totalStudySeconds;
    remainingMs = currentDurationSec() * 1000;
    render();
    el.aboutVersion.textContent = `v${version}`;
    await populateDisplays();
    await refreshResetRecordsBtn();
  }

  window.pomodoro.onPointerInside((inside) => el.app.classList.toggle('pointer-inside', inside));

  init();
})();
