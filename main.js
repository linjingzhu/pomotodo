const { app, BrowserWindow, ipcMain, screen, Menu, Tray, Notification, nativeImage, dialog, powerMonitor } = require('electron');
const path = require('path');
const fs = require('fs');
const store = require('./store');
const { phaseToastXml } = require('./toast');

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
  backgroundImageFile: null, // the app's own copy, in the userData folder
  backgroundImagePath: null, // before 1.0.8: the original file's path
  backgroundBlur: 0,
  backgroundTintColor: '#15161e',
  backgroundTintOpacity: 0,
  accentColor: '#f2405a',
  gaugeStyle: 'pie',
  panelSplit: 0.48, // the panel's share of #app's height, dragged via the splitter
  clockTimeZone: '', // '' = the device's own zone; else an IANA name (Goals tab clock)
  currentTask: '',
  windowWidth: 340,
  windowHeight: 470,
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

// Settings only ever store a file name; the data URL is rebuilt on demand
// so settings.json stays small.
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

// Launch size = the last windowed size, else the default (340x470, the
// compact timer; the panel grows the window while it's open, see
// fitPanel). Installs still on an earlier default size, never resized,
// move to this one once.
const OLD_DEFAULT_SIZES = ['300x780', '300x460'];

function initialWindowSize(settings) {
  if (!settings.compactDefault) {
    const size = `${settings.windowWidth}x${settings.windowHeight}`;
    if (!settings.fullHeightLayout || OLD_DEFAULT_SIZES.includes(size)) {
      settings.windowWidth = DEFAULT_SETTINGS.windowWidth;
      settings.windowHeight = DEFAULT_SETTINGS.windowHeight;
    }
    saveSettings({ windowWidth: settings.windowWidth, windowHeight: settings.windowHeight, fullHeightLayout: true, compactDefault: true });
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
    // (without the height the open panel added)
    if (!isFullscreen()) {
      const [w, h] = mainWindow.getSize();
      saveSettings({ windowWidth: w, windowHeight: Math.max(MIN_SIZE.height, h - (panelGrowth ? panelGrowth.dh : 0)) });
    }
    // A real quit (from the tray menu, or window-all-closed on non-mac) must
    // go through; only an interactive close (the in-app close button) can be
    // redirected.
    if (app.isQuitting) return;
    if (loadSettings().closeToTray) {
      event.preventDefault();
      mainWindow.hide();
      return;
    }
    // Not set to always keep running: ask first rather than quitting (and
    // dropping a running session) on a single click with no warning.
    event.preventDefault();
    dialog.showMessageBox(mainWindow, {
      type: 'question',
      buttons: ['Quit', 'Hide to Tray', 'Cancel'],
      defaultId: 0,
      cancelId: 2,
      title: 'Close Pomodoro Timer?',
      message: 'Quit, or keep it running in the tray?',
    }).then(({ response }) => {
      if (response === 0) {
        app.isQuitting = true;
        app.quit();
      } else if (response === 1) {
        mainWindow.hide();
      }
    });
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

  // The PC going to sleep pauses the timer (renderer); it stays paused.
  powerMonitor.on('suspend', () => mainWindow.webContents.send('power:suspend'));

  trackPointer();
}

// Tells the renderer when the cursor is over the window, to reveal the
// corner dots. Polled because the widget used to be a drag region, which
// on Windows gets no mouse events (so no CSS :hover); kept as it also
// covers the window's transparent margin.
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

ipcMain.handle('app:getVersion', () => app.getVersion());

// The Data section's "Reset configuration": every Settings-tab value
// (not the running totals, the current goal, the window's size/position,
// or the records themselves - those have their own reset already) back
// to its default, including dropping the stored background image copy.
const CONFIG_KEYS = [
  'workMinutes', 'breakMinutes', 'longBreakMinutes', 'longBreakEvery',
  'autoStartBreaks', 'autoStartFocus', 'notifyOnPhaseChange',
  'alwaysOnTop', 'minimizeToTray', 'closeToTray',
  'backgroundBlur', 'backgroundTintColor', 'backgroundTintOpacity',
  'accentColor', 'gaugeStyle', 'panelSplit',
];
ipcMain.handle('settings:resetConfig', () => {
  removeStoredBackgrounds(null);
  const defaults = {};
  for (const key of CONFIG_KEYS) defaults[key] = DEFAULT_SETTINGS[key];
  defaults.backgroundImageFile = null;
  defaults.backgroundImagePath = null;
  // alwaysOnTop is the one Settings value also mirrored live onto the
  // window (see window:setAlwaysOnTop); writing the default to
  // settings.json alone wouldn't un-set it if it was already on.
  mainWindow.setAlwaysOnTop(defaults.alwaysOnTop);
  return saveSettings(defaults);
});

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

// Moving and resizing the window. The widget has no native drag region or
// resize border (a drag region hides every mouse event from the page on
// Windows, double-clicks included; see the fullscreen toggle), so the
// renderer's edge/corner handles and its drag-anywhere-else area both
// drive the window from here, through a single poll timer.
//
// The poll reads the cursor via screen.getCursorScreenPoint() rather than
// trusting dx/dy computed in the renderer from a mouse event's own
// screenX/screenY: Electron's screen module reports the cursor in the
// same DIP space as BrowserWindow bounds on every monitor, regardless of
// that monitor's DPI scale (trackPointer() below relies on the same
// guarantee), where a renderer mouse event does not consistently. Reading
// it in main is what keeps a drag tracking 1:1 with the cursor across
// monitors at different scale factors, instead of drifting.
//
// Every move tick also reasserts the exact size the window had when the
// drag began (never just carrying over whatever size the OS currently
// reports), wrapped in withResizeUnlocked so that reassertion can win even
// if something already nudged the size - this is the fix for the window
// growing while being dragged with the size locked.
const RESIZE_EDGES = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];
let dragPoll = null;
let moveFrom = null; // { origin: [x, y], size: [w, h], cursor: {x, y} }
let resizeFrom = null; // { bounds, edge, cursor: {x, y} }

function stopDrag() {
  if (dragPoll) {
    clearInterval(dragPoll);
    dragPoll = null;
  }
  moveFrom = null;
  resizeFrom = null;
}

ipcMain.on('window:moveStart', () => {
  stopDrag();
  if (isFullscreen()) return;
  moveFrom = { origin: mainWindow.getPosition(), size: mainWindow.getSize(), cursor: screen.getCursorScreenPoint() };
  dragPoll = setInterval(() => {
    const cur = screen.getCursorScreenPoint();
    const x = Math.round(moveFrom.origin[0] + (cur.x - moveFrom.cursor.x));
    const y = Math.round(moveFrom.origin[1] + (cur.y - moveFrom.cursor.y));
    withResizeUnlocked(() => mainWindow.setBounds({ x, y, width: moveFrom.size[0], height: moveFrom.size[1] }));
  }, 16);
});

ipcMain.on('window:moveEnd', stopDrag);

ipcMain.on('window:resizeStart', (_evt, { edge } = {}) => {
  stopDrag();
  if (isFullscreen() || loadSettings().sizeLocked || !RESIZE_EDGES.includes(edge)) return;
  resizeFrom = { bounds: mainWindow.getBounds(), edge, cursor: screen.getCursorScreenPoint() };
  dragPoll = setInterval(() => {
    const cur = screen.getCursorScreenPoint();
    const dx = cur.x - resizeFrom.cursor.x;
    const dy = cur.y - resizeFrom.cursor.y;
    const from = resizeFrom.bounds;
    const { edge } = resizeFrom;
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
  }, 16);
});

ipcMain.on('window:resizeEnd', stopDrag);

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
    fitPanel(); // the panel may have been opened while fullscreen
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

// The panel (Goals / Calendar / Settings) needs more height than the
// compact default gives, so opening it grows the window to at least
// PANEL_OPEN_HEIGHT (moving it up if the screen bottom is in the way), and
// closing it gives that height and shift back, even if the window was
// moved or resized meanwhile. Fullscreen already has the room; there the
// saved windowed bounds are adjusted instead.
const PANEL_OPEN_HEIGHT = 780;
let panelOpen = false;
let panelGrowth = null; // { dh, dy } while the open panel has grown the window

function fitPanel() {
  if (!panelOpen || panelGrowth || isFullscreen()) return;
  const b = mainWindow.getBounds();
  const area = screen.getDisplayMatching(b).workArea;
  const height = Math.min(Math.max(b.height, PANEL_OPEN_HEIGHT), area.height);
  const dh = Math.max(0, height - b.height);
  const y = dh ? Math.max(area.y, Math.min(b.y, area.y + area.height - height)) : b.y;
  panelGrowth = { dh, dy: b.y - y };
  if (dh) withResizeUnlocked(() => mainWindow.setBounds({ x: b.x, y, width: b.width, height }));
}

function unfitPanel() {
  const growth = panelGrowth;
  panelGrowth = null;
  if (!growth || (!growth.dh && !growth.dy)) return;
  const shrink = (b) => ({ x: b.x, y: b.y + growth.dy, width: b.width, height: Math.max(MIN_SIZE.height, b.height - growth.dh) });
  if (isFullscreen()) {
    fullscreenBounds = shrink(fullscreenBounds);
    return;
  }
  withResizeUnlocked(() => mainWindow.setBounds(shrink(mainWindow.getBounds())));
}

ipcMain.handle('window:setPanelOpen', (_evt, open) => {
  panelOpen = !!open;
  if (panelOpen) fitPanel();
  else unfitPanel();
  return panelOpen;
});

// Reset Size: back to the default size (grown again if the panel is open),
// keeping the top-left corner where it is but on screen. It works while
// the size is locked (it's an explicit request), and from fullscreen it
// returns to windowed mode at the default size.
function resetSize() {
  const { windowWidth: width, windowHeight: height } = DEFAULT_SETTINGS;
  panelGrowth = null;
  if (isFullscreen()) {
    fullscreenBounds = { ...fullscreenBounds, width, height };
    exitFullscreen();
  } else {
    const b = mainWindow.getBounds();
    const area = screen.getDisplayMatching(b).workArea;
    const x = Math.max(area.x, Math.min(b.x, area.x + area.width - width));
    const y = Math.max(area.y, Math.min(b.y, area.y + area.height - height));
    withResizeUnlocked(() => mainWindow.setBounds({ x, y, width, height }));
    fitPanel();
  }
  saveSettings({ windowWidth: width, windowHeight: height });
}

ipcMain.handle('window:resetSize', () => resetSize());

// One phase-end notification at a time: it stays up until the user
// dismisses it, clicks it, or acts on the timer in the app.
let phaseNotification = null;

function closePhaseNotification() {
  if (!phaseNotification) return;
  phaseNotification.close();
  phaseNotification = null;
}

// Resolves true when a Windows toast (which carries the alarm sound) was
// shown; otherwise the renderer plays its own chime instead.
ipcMain.handle('notify', (_evt, { title, body }) => {
  if (!Notification.isSupported()) return false;
  closePhaseNotification();
  const notification = new Notification({
    title,
    body,
    silent: process.platform !== 'win32', // Windows: the toast plays the alarm sound
    timeoutType: 'never',
    ...(process.platform === 'win32' ? { toastXml: phaseToastXml(title, body) } : {}),
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
  return process.platform === 'win32';
});

ipcMain.handle('notify:close', () => closePhaseNotification());

// Reset Session is destructive (it zeros both totals and can't be undone),
// so it asks first, via the OS's own confirm dialog.
ipcMain.handle('confirm:resetSession', async () => {
  const result = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    buttons: ['Reset Session', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    title: 'Reset Session?',
    message: 'Reset the timer and totals?',
    detail: 'Total turns and total study time go back to 0, and the timer returns to an idle work period. This can\'t be undone.',
  });
  return result.response === 0;
});

// The background image is copied into the app's own folder (next to
// settings.json) as background.<ext>, so moving or deleting the original
// doesn't lose it. One copy at a time: picking another replaces it, and
// Clear deletes it.
function removeStoredBackgrounds(keep) {
  for (const ext of Object.keys(IMAGE_MIME_TYPES)) {
    const name = `background${ext}`;
    if (name === keep) continue;
    try {
      fs.unlinkSync(path.join(app.getPath('userData'), name));
    } catch (e) {
      // not there
    }
  }
}

function storeBackgroundImage(sourcePath) {
  const ext = path.extname(sourcePath).toLowerCase();
  if (!IMAGE_MIME_TYPES[ext]) return null;
  const dir = app.getPath('userData');
  fs.mkdirSync(dir, { recursive: true });
  const name = `background${ext}`;
  const tmp = path.join(dir, `${name}.tmp`);
  fs.copyFileSync(sourcePath, tmp); // copied aside, then swapped in
  removeStoredBackgrounds(name);
  fs.renameSync(tmp, path.join(dir, name));
  saveSettings({ backgroundImageFile: name, backgroundImagePath: null });
  return name;
}

ipcMain.handle('background:pick', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose background image',
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] }],
  });
  if (result.canceled || !result.filePaths[0]) return null;
  try {
    const dataUrl = imageFileToDataUrl(result.filePaths[0]);
    if (!dataUrl) return null;
    storeBackgroundImage(result.filePaths[0]);
    return { dataUrl };
  } catch (e) {
    return null;
  }
});

ipcMain.handle('background:clear', () => {
  removeStoredBackgrounds(null);
  saveSettings({ backgroundImageFile: null, backgroundImagePath: null });
});

ipcMain.handle('background:get', () => {
  let { backgroundImageFile: name, backgroundImagePath: original } = loadSettings();
  // Before 1.0.8 only the original's path was kept: take a copy now, while
  // it's still there (if it's gone, the setting is left for a later try).
  if (!name && original) {
    try {
      name = storeBackgroundImage(original);
    } catch (e) {
      return null;
    }
  }
  if (!name) return null;
  try {
    const dataUrl = imageFileToDataUrl(path.join(app.getPath('userData'), path.basename(name)));
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

ipcMain.handle('records:deleteSession', (_evt, id) => !!store.deleteSession(RECORDS_PATH, id));

ipcMain.handle('records:hasAny', () => store.hasAnyRecords(RECORDS_PATH));

// The Data section's "Reset all records": every session and goal, gone.
// Asks first (separately from Reset Session's own confirm, different
// wording since this is Goals/Calendar data, not the running totals).
ipcMain.handle('confirm:resetAllRecords', async () => {
  const result = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    buttons: ['Delete All Records', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    title: 'Delete all records?',
    message: 'Delete every Goal and every Calendar session?',
    detail: 'This removes all saved goals and focus-session history on this PC. It can\'t be undone.',
  });
  return result.response === 0;
});

ipcMain.handle('records:resetAll', () => {
  store.resetAllRecords(RECORDS_PATH);
  return true;
});

ipcMain.handle('records:month', (_evt, month) => store.monthRecords(RECORDS_PATH, month));

ipcMain.handle('goals:list', () => store.listGoals(RECORDS_PATH));

ipcMain.handle('goals:add', (_evt, { title, groupId } = {}) => store.addGoal(RECORDS_PATH, title, groupId));

ipcMain.handle('goals:rename', (_evt, { id, title }) => store.renameGoal(RECORDS_PATH, id, title));

ipcMain.handle('goals:setDone', (_evt, { id, done }) => store.setGoalDone(RECORDS_PATH, id, done));

ipcMain.handle('goals:delete', (_evt, id) => !!store.deleteGoal(RECORDS_PATH, id));

ipcMain.handle('goals:reorder', (_evt, { id, beforeId }) => store.reorderGoal(RECORDS_PATH, id, beforeId));

ipcMain.handle('goals:setGroup', (_evt, { id, groupId }) => store.setGoalGroup(RECORDS_PATH, id, groupId));

ipcMain.handle('groups:list', () => store.listGroups(RECORDS_PATH));

ipcMain.handle('groups:add', (_evt, name) => store.addGroup(RECORDS_PATH, name));

ipcMain.handle('groups:rename', (_evt, { id, name }) => store.renameGroup(RECORDS_PATH, id, name));

ipcMain.handle('groups:delete', (_evt, id) => !!store.deleteGroup(RECORDS_PATH, id));

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
