const { app, BrowserWindow, ipcMain, screen, Menu, Tray, Notification, nativeImage, dialog, powerMonitor } = require('electron');
const path = require('path');
const fs = require('fs');
const store = require('./store');

// ---- Settings persistence (simple JSON file, no external deps) ----
const SETTINGS_PATH = path.join(app.getPath('userData'), 'settings.json');
const DEFAULT_SETTINGS = {
  workMinutes: 25,
  breakMinutes: 5,
  longBreakMinutes: 15,
  longBreakEvery: 4,
  autoStartBreaks: true,
  autoStartFocus: true,
  alwaysOnTop: false,
  minimizeToTray: true,
  closeToTray: false,
  sizeLocked: false,
  notifyOnPhaseChange: true,
  backgroundImagePath: null,
  backgroundBlur: 0,
  backgroundTintColor: '#15161e',
  backgroundTintOpacity: 0,
  accentColor: '#f2405a',
  gaugeStyle: 'pie',
  currentTask: '',
  windowWidth: 300,
  windowHeight: 780,
  totalTurns: 0,
  totalStudySeconds: 0,
};

const IMAGE_MIME_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
};

// Settings only ever store the file path; the data URL is rebuilt on demand
// so settings.json stays small and always reflects the file's current bytes.
function imageFileToDataUrl(filePath) {
  const mime = IMAGE_MIME_TYPES[path.extname(filePath).toLowerCase()];
  if (!mime) return null;
  const buffer = fs.readFileSync(filePath);
  return `data:${mime};base64,${buffer.toString('base64')}`;
}

function loadSettings() {
  try {
    const raw = fs.readFileSync(SETTINGS_PATH, 'utf-8');
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch (e) {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(partial) {
  const merged = { ...loadSettings(), ...partial };
  try {
    fs.mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true });
    // Written aside, then swapped in: a crash or power loss mid-write can't
    // leave a truncated file, which would reset every setting and total.
    const tmp = `${SETTINGS_PATH}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(merged, null, 2), 'utf-8');
    fs.renameSync(tmp, SETTINGS_PATH);
  } catch (e) {
    // best effort; ignore write failures
  }
  return merged;
}

let mainWindow = null;
let tray = null;

const MIN_SIZE = { width: 180, height: 140 };

// Launch size = the expanded-panel size (the largest the layout needs);
// the panel opens inside the window instead of resizing it. Installs from
// before this saved the old 460px launch height, so move them once.
function initialWindowSize(settings) {
  if (!settings.fullHeightLayout) {
    settings.windowWidth = DEFAULT_SETTINGS.windowWidth;
    settings.windowHeight = DEFAULT_SETTINGS.windowHeight;
    saveSettings({ windowWidth: settings.windowWidth, windowHeight: settings.windowHeight, fullHeightLayout: true });
  }
  // never taller than the screen can show (e.g. 1366x768 laptops)
  const { height: maxHeight } = screen.getPrimaryDisplay().workAreaSize;
  return { width: settings.windowWidth, height: Math.min(settings.windowHeight, maxHeight) };
}

function createWindow() {
  const settings = loadSettings();
  const size = initialWindowSize(settings);

  mainWindow = new BrowserWindow({
    width: size.width,
    height: size.height,
    minWidth: MIN_SIZE.width,
    minHeight: MIN_SIZE.height,
    alwaysOnTop: settings.alwaysOnTop,
    // Never natively resizable: transparent windows get no working resize
    // border on Windows, yet a resizable frameless window still reserves a
    // dead ~5px strip at its edges for one. Non-resizable, those pixels
    // reach the page, whose own edge handles resize the window
    // (window:resizeMove), honoring the size lock and fullscreen.
    resizable: false,
    frame: false,
    transparent: true,
    // Windows can default a transparent window's backing surface to opaque
    // black unless this is spelled out explicitly (fully-transparent ARGB).
    backgroundColor: '#00000000',
    hasShadow: false, // the CSS box-shadow on the rounded #app shape replaces it
    icon: path.join(__dirname, 'renderer', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // Keep the timer's ticks on time while the window is hidden in the
      // tray or minimized, so a phase ends (and notifies) when it should.
      // The renderer keeps time by the clock either way.
      backgroundThrottling: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.on('close', (event) => {
    // persist the windowed size so next launch remembers it - never the
    // fullscreen size, which would reopen as a screen-sized window
    if (!isFullscreen()) {
      const [w, h] = mainWindow.getSize();
      saveSettings({ windowWidth: w, windowHeight: h });
    }
    // A real quit (from the tray menu, or window-all-closed on non-mac) must
    // go through; only an interactive close (the in-app close button) can be
    // redirected.
    if (!app.isQuitting && loadSettings().closeToTray) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  // Minimizing hides to the tray instead of the taskbar, when enabled; the
  // tray icon is the only way back in, so the window must never be lost.
  mainWindow.on('minimize', (event) => {
    if (loadSettings().minimizeToTray) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('leave-full-screen', onLeaveFullscreen);

  // Esc leaves fullscreen.
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'Escape' && isFullscreen()) {
      event.preventDefault();
      exitFullscreen();
    }
  });

  // The window is locked in place while fullscreen. The renderer already
  // turns off the drag region then; this backstop cancels any other
  // user-initiated move ('will-move' fires on Windows and macOS only).
  mainWindow.on('will-move', (event) => {
    if (isFullscreen()) event.preventDefault();
  });
  // Nor can it be resized then: the renderer hides its edge handles and
  // window:resizeMove refuses; this backstop cancels any user-initiated
  // resize that still gets through ('will-resize' is never emitted for our
  // own setBounds calls).
  mainWindow.on('will-resize', (event) => {
    if (isFullscreen()) event.preventDefault();
  });

  // Double-clicking the widget flips fullscreen <-> windowed. Over the drag
  // region Windows gives the page no mouse events at all, only a
  // non-client double-click on the "caption" (what a drag region is), so
  // catch that here; the renderer handles double-clicks everywhere else.
  // Deferred so the switch doesn't run inside the window procedure.
  if (process.platform === 'win32') {
    mainWindow.hookWindowMessage(WM_NCLBUTTONDBLCLK, (wParam) => {
      if (wParam.readUInt32LE(0) === HTCAPTION) setImmediate(toggleFullscreen);
    });
  }

  // The PC going to sleep pauses the timer (renderer); it stays paused.
  powerMonitor.on('suspend', () => mainWindow.webContents.send('power:suspend'));

  trackPointer();
}

const WM_NCLBUTTONDBLCLK = 0x00a3;
const HTCAPTION = 2;

// Windows delivers no mouse events over -webkit-app-region: drag, which is
// most of the widget, so CSS :hover only fired over the no-drag ring and
// buttons. Poll the cursor here and tell the renderer when it's over the
// window instead.
function trackPointer() {
  let inside = false;
  const timer = setInterval(() => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      clearInterval(timer);
      return;
    }
    if (!mainWindow.isVisible()) return;
    const { x, y } = screen.getCursorScreenPoint();
    const b = mainWindow.getBounds();
    const now = x >= b.x && x < b.x + b.width && y >= b.y && y < b.y + b.height;
    if (now !== inside) {
      inside = now;
      mainWindow.webContents.send('window:pointer', inside);
    }
  }, 120);
}

function showWindow() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function toggleWindow() {
  if (!mainWindow) return;
  if (mainWindow.isVisible()) mainWindow.hide();
  else showWindow();
}

function createTray() {
  const icon = nativeImage
    // loads tray-icon@2x.png too, for 200% displays
    .createFromPath(path.join(__dirname, 'renderer', 'tray-icon.png'));
  tray = new Tray(icon);
  tray.setToolTip('Pomodoro Timer');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open', click: showWindow },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          app.isQuitting = true;
          app.quit();
        },
      },
    ])
  );
  tray.on('click', toggleWindow);
}

// ---- IPC handlers used by the renderer (UI) ----

ipcMain.handle('settings:get', () => loadSettings());

ipcMain.handle('settings:save', (_evt, partial) => saveSettings(partial));

ipcMain.handle('window:setAlwaysOnTop', (_evt, flag) => {
  mainWindow.setAlwaysOnTop(!!flag);
  saveSettings({ alwaysOnTop: !!flag });
  return mainWindow.isAlwaysOnTop();
});

ipcMain.handle('window:setSizeLocked', (_evt, flag) => {
  return { sizeLocked: saveSettings({ sizeLocked: !!flag }).sizeLocked };
});

ipcMain.handle('window:setMinimizeToTray', (_evt, flag) => {
  return saveSettings({ minimizeToTray: !!flag }).minimizeToTray;
});

ipcMain.handle('window:setCloseToTray', (_evt, flag) => {
  return saveSettings({ closeToTray: !!flag }).closeToTray;
});

ipcMain.handle('window:getDisplays', () => {
  const displays = screen.getAllDisplays();
  const primaryId = screen.getPrimaryDisplay().id;
  return displays.map((d, idx) => ({
    id: d.id,
    label: `Monitor ${idx + 1}${d.id === primaryId ? ' (primary)' : ''} — ${d.bounds.width}x${d.bounds.height}`,
    bounds: d.bounds,
  }));
});

// Taskbar button progress: the running phase's elapsed share (normal),
// yellow while paused, cleared when idle. The tray tooltip carries the
// same state, since the window has no taskbar button while in the tray.
ipcMain.on('window:progress', (_evt, { state, fraction, label } = {}) => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (state === 'idle' || !Number.isFinite(fraction)) {
    mainWindow.setProgressBar(-1);
  } else {
    mainWindow.setProgressBar(Math.min(1, Math.max(0, fraction)), { mode: state === 'paused' ? 'paused' : 'normal' });
  }
  if (tray && typeof label === 'string') tray.setToolTip(label.slice(0, 120));
});

// Electron documents transparent windows as not resizable, and on Windows
// they get no native resize border at all, so the renderer draws its own
// edge and corner handles and drives the resize through here. dx/dy are the
// pointer's movement in screen DIPs since the drag began; bounds are
// recomputed from the start each time, so nothing drifts. Ignored while
// the size is locked or fullscreen.
const RESIZE_EDGES = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];
let resizeFrom = null;

ipcMain.on('window:resizeStart', () => {
  resizeFrom = isFullscreen() || loadSettings().sizeLocked ? null : mainWindow.getBounds();
});

ipcMain.on('window:resizeMove', (_evt, { edge, dx, dy } = {}) => {
  if (!resizeFrom || isFullscreen() || !RESIZE_EDGES.includes(edge)) return;
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
  const from = resizeFrom;
  let width = from.width;
  let height = from.height;
  if (edge.includes('e')) width += dx;
  if (edge.includes('w')) width -= dx;
  if (edge.includes('s')) height += dy;
  if (edge.includes('n')) height -= dy;
  width = Math.max(MIN_SIZE.width, Math.round(width));
  height = Math.max(MIN_SIZE.height, Math.round(height));
  // Dragging the left or top edge keeps the opposite edge where it was.
  const x = edge.includes('w') ? from.x + from.width - width : from.x;
  const y = edge.includes('n') ? from.y + from.height - height : from.y;
  withResizeUnlocked(() => mainWindow.setBounds({ x, y, width, height }));
});

ipcMain.on('window:resizeEnd', () => {
  resizeFrom = null;
});

// corner: 'tl' | 'tr' | 'bl' | 'br'
ipcMain.handle('window:snapToCorner', (_evt, { displayId, corner }) => {
  if (isFullscreen()) return null;
  const displays = screen.getAllDisplays();
  const target = displays.find((d) => d.id === displayId) || screen.getPrimaryDisplay();
  const { x: dx, y: dy, width: dw, height: dh } = target.workArea;
  const [winW, winH] = mainWindow.getSize();

  let x = dx;
  let y = dy;
  if (corner === 'tr' || corner === 'br') x = dx + dw - winW;
  if (corner === 'bl' || corner === 'br') y = dy + dh - winH;

  mainWindow.setBounds({ x: Math.round(x), y: Math.round(y), width: winW, height: winH });
  return { x, y };
});

// setSize()/setBounds() are unreliable on at least some platforms while
// resizable is false (Electron then pins the min and max size to the
// current size) - and the window is always non-resizable (see
// createWindow) - so briefly unlock around our own programmatic resize,
// then restore the lock. The user can't grab an edge in between: this
// runs synchronously.
function withResizeUnlocked(fn) {
  const wasLocked = !mainWindow.isResizable();
  if (wasLocked) mainWindow.setResizable(true);
  fn();
  if (wasLocked) mainWindow.setResizable(false);
}

// Fullscreen state is tracked here rather than read back from the OS:
// the windowed bounds are saved on the way in and put back on the way out,
// pinned or not. The restore is applied right away, again on
// 'leave-full-screen', and once more after the exit animation, because the
// OS may apply its own bounds late - or, for transparent windows on
// Windows, never fire 'leave-full-screen' at all.
let fullscreenBounds = null; // windowed bounds while fullscreen, else null
let restoreTarget = null;

function isFullscreen() {
  return fullscreenBounds !== null;
}

// Re-entrancy guard: resizing a window that is still leaving fullscreen can
// synchronously emit 'leave-full-screen' again, which would call back in
// here forever (reproduced on Linux as a stack overflow).
let restoring = false;

function reassertRestore() {
  if (restoring || !restoreTarget || isFullscreen()) return;
  restoring = true;
  try {
    withResizeUnlocked(() => mainWindow.setBounds(restoreTarget));
  } finally {
    restoring = false;
  }
}

function exitFullscreen() {
  restoreTarget = fullscreenBounds;
  fullscreenBounds = null;
  withResizeUnlocked(() => mainWindow.setFullScreen(false));
  mainWindow.webContents.send('window:fullscreen', false);
  reassertRestore();
  setTimeout(() => {
    reassertRestore();
    restoreTarget = null;
  }, 400);
}

// Also covers fullscreen being left by the OS rather than by our button.
function onLeaveFullscreen() {
  if (isFullscreen()) exitFullscreen();
  else reassertRestore();
}

function toggleFullscreen() {
  if (isFullscreen()) {
    exitFullscreen();
    return false;
  }
  restoreTarget = null;
  fullscreenBounds = mainWindow.getBounds();
  withResizeUnlocked(() => mainWindow.setFullScreen(true));
  mainWindow.webContents.send('window:fullscreen', true);
  return true;
}

ipcMain.handle('window:toggleFullscreen', () => toggleFullscreen());

function escapeXml(text) {
  return String(text).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]);
}

// Windows only keeps a toast on screen until the user acts on it in the
// "reminder" scenario, and only when it has at least one button. Silent
// because the renderer already plays its own chime.
function persistentToastXml(title, body) {
  return '<toast scenario="reminder">'
    + `<visual><binding template="ToastGeneric"><text>${escapeXml(title)}</text><text>${escapeXml(body)}</text></binding></visual>`
    + '<actions><action content="Dismiss" arguments="dismiss" activationType="system"/></actions>'
    + '<audio silent="true"/>'
    + '</toast>';
}

// One phase-end notification at a time: it stays up until the user
// dismisses it, clicks it, or acts on the timer in the app.
let phaseNotification = null;

function closePhaseNotification() {
  if (!phaseNotification) return;
  phaseNotification.close();
  phaseNotification = null;
}

ipcMain.handle('notify', (_evt, { title, body }) => {
  if (!Notification.isSupported()) return;
  closePhaseNotification();
  const notification = new Notification({
    title,
    body,
    silent: true,
    timeoutType: 'never',
    ...(process.platform === 'win32' ? { toastXml: persistentToastXml(title, body) } : {}),
  });
  notification.on('click', () => {
    showWindow();
    notification.close();
  });
  notification.on('close', () => {
    if (phaseNotification === notification) phaseNotification = null;
  });
  phaseNotification = notification;
  notification.show();
});

ipcMain.handle('notify:close', () => closePhaseNotification());

ipcMain.handle('background:pick', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose background image',
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] }],
  });
  if (result.canceled || !result.filePaths[0]) return null;
  const filePath = result.filePaths[0];
  try {
    const dataUrl = imageFileToDataUrl(filePath);
    if (!dataUrl) return null;
    saveSettings({ backgroundImagePath: filePath });
    return { dataUrl };
  } catch (e) {
    return null;
  }
});

ipcMain.handle('background:clear', () => {
  saveSettings({ backgroundImagePath: null });
});

ipcMain.handle('background:get', () => {
  const { backgroundImagePath } = loadSettings();
  if (!backgroundImagePath) return null;
  try {
    const dataUrl = imageFileToDataUrl(backgroundImagePath);
    return dataUrl ? { dataUrl } : null;
  } catch (e) {
    return null;
  }
});

// Without an explicit AppUserModelID, Windows attributes (and may drop)
// toasts; it must match the installer's appId.
if (process.platform === 'win32') app.setAppUserModelId('com.danielsword.pomodorotimer');

// ---- Focus-session history and goals (stored locally only) ----

const RECORDS_PATH = path.join(app.getPath('userData'), 'records.json');

ipcMain.handle('records:addSession', (_evt, session) => store.addSession(RECORDS_PATH, session));

ipcMain.handle('records:updateNote', (_evt, { id, note }) => store.updateSession(RECORDS_PATH, id, { note }));

ipcMain.handle('records:month', (_evt, month) => store.monthRecords(RECORDS_PATH, month));

ipcMain.handle('goals:list', () => store.listGoals(RECORDS_PATH));

ipcMain.handle('goals:add', (_evt, title) => store.addGoal(RECORDS_PATH, title));

ipcMain.handle('goals:setDone', (_evt, { id, done }) => store.setGoalDone(RECORDS_PATH, id, done));

ipcMain.handle('goals:delete', (_evt, id) => !!store.deleteGoal(RECORDS_PATH, id));

app.whenReady().then(() => {
  createWindow();
  createTray();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => {
  app.isQuitting = true;
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
