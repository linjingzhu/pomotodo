(() => {
  const el = {
    modeLabel: document.getElementById('mode-label'),
    timerDisplay: document.getElementById('timer-display'),
    startPauseBtn: document.getElementById('start-pause-btn'),
    resetBtn: document.getElementById('reset-btn'),
    gearBtn: document.getElementById('gear-btn'),
    settingsPanel: document.getElementById('settings-panel'),
    workMin: document.getElementById('work-min'),
    breakMin: document.getElementById('break-min'),
    alwaysTop: document.getElementById('always-top'),
    minimizeToTray: document.getElementById('minimize-to-tray'),
    closeToTray: document.getElementById('close-to-tray'),
    fullscreenBtn: document.getElementById('fullscreen-btn'),
    displaySelect: document.getElementById('display-select'),
    cornerButtons: Array.from(document.querySelectorAll('#corner-grid button')),
    ringProgress: document.getElementById('ring-progress'),
  };

  const RING_RADIUS = 52;
  const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
  el.ringProgress.style.strokeDasharray = String(RING_CIRCUMFERENCE);

  const COLLAPSED_SIZE = { width: 260, height: 250 };
  const EXPANDED_SIZE = { width: 300, height: 520 };

  let mode = 'work'; // 'work' | 'break'
  let remainingSec = 25 * 60;
  let timerId = null;
  let running = false;

  function fmt(sec) {
    const m = Math.floor(sec / 60).toString().padStart(2, '0');
    const s = Math.floor(sec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }

  function render() {
    el.timerDisplay.textContent = fmt(remainingSec);
    el.modeLabel.textContent = mode === 'work' ? '작업' : '휴식';
    el.startPauseBtn.textContent = running ? '일시정지' : '시작';
    const remainingFraction = remainingSec / currentDurationSec();
    el.ringProgress.style.strokeDashoffset = String(RING_CIRCUMFERENCE * (1 - remainingFraction));
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

  function switchMode() {
    mode = mode === 'work' ? 'break' : 'work';
    remainingSec = currentDurationSec();
    const title = mode === 'work' ? '작업 시간' : '휴식 시간';
    const body = mode === 'work' ? '휴식이 끝났습니다. 작업을 시작하세요.' : '작업이 끝났습니다. 잠시 쉬세요.';
    window.pomodoro.notify(title, body);
  }

  function tick() {
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
    running = false;
    render();
  }

  el.startPauseBtn.addEventListener('click', () => {
    if (running) stopTick();
    else startTick();
  });

  el.resetBtn.addEventListener('click', resetTimer);

  // Changing minute inputs while stopped updates the visible countdown immediately.
  el.workMin.addEventListener('change', () => {
    window.pomodoro.saveSettings({ workMinutes: Number(el.workMin.value) });
    if (!running && mode === 'work') resetTimer();
  });
  el.breakMin.addEventListener('change', () => {
    window.pomodoro.saveSettings({ breakMinutes: Number(el.breakMin.value) });
    if (!running && mode === 'break') resetTimer();
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

  el.fullscreenBtn.addEventListener('click', async () => {
    await window.pomodoro.toggleFullscreen();
  });

  let panelOpen = false;
  el.gearBtn.addEventListener('click', async () => {
    panelOpen = !panelOpen;
    el.settingsPanel.classList.toggle('hidden', !panelOpen);
    const size = panelOpen ? EXPANDED_SIZE : COLLAPSED_SIZE;
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
    const settings = await window.pomodoro.getSettings();
    el.workMin.value = settings.workMinutes;
    el.breakMin.value = settings.breakMinutes;
    el.alwaysTop.checked = settings.alwaysOnTop;
    el.minimizeToTray.checked = settings.minimizeToTray;
    el.closeToTray.checked = settings.closeToTray;
    remainingSec = settings.workMinutes * 60;
    render();
    await populateDisplays();
  }

  init();
})();
