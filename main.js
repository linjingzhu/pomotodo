const { app, BrowserWindow, ipcMain, screen, Menu, Tray, Notification, nativeImage, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

// ---- Settings persistence (simple JSON file, no external deps) ----
const SETTINGS_PATH = path.join(app.getPath('userData'), 'settings.json');
const DEFAULT_SETTINGS = {
  workMinutes: 25,
  breakMinutes: 5,
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
  windowWidth: 300,
  windowHeight: 460,
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
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(merged, null, 2), 'utf-8');
  } catch (e) {
    // best effort; ignore write failures
  }
  return merged;
}

let mainWindow = null;
let tray = null;

function createWindow() {
  const settings = loadSettings();

  mainWindow = new BrowserWindow({
    width: settings.windowWidth,
    height: settings.windowHeight,
    minWidth: 180,
    minHeight: 140,
    alwaysOnTop: settings.alwaysOnTop,
    resizable: !settings.sizeLocked,
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
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.on('close', (event) => {
    // persist the windowed size so next launch remembers it - never the
    // fullscreen size, which would reopen as a screen-sized window
    if (!mainWindow.isFullScreen()) {
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

  mainWindow.on('leave-full-screen', restoreAfterFullscreen);
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
    .createFromPath(path.join(__dirname, 'renderer', 'icon.png'))
    .resize({ width: 16, height: 16 });
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
  mainWindow.setResizable(!flag);
  const sizeLocked = saveSettings({ sizeLocked: !!flag }).sizeLocked;
  // Pinning while fullscreen must record the windowed size, not the screen.
  const { width, height } = mainWindow.isFullScreen()
    ? (preFullscreenBounds || mainWindow.getNormalBounds())
    : mainWindow.getBounds();
  return { sizeLocked, width, height };
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

// corner: 'tl' | 'tr' | 'bl' | 'br'
ipcMain.handle('window:snapToCorner', (_evt, { displayId, corner }) => {
  if (mainWindow.isFullScreen()) return null;
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
// resizable is false (reproduced even with no app code involved) - briefly
// unlock around our own programmatic resize, then restore the lock. The
// window is never draggable-by-the-user in between: this runs synchronously.
function withResizeUnlocked(fn) {
  const wasLocked = !mainWindow.isResizable();
  if (wasLocked) mainWindow.setResizable(true);
  fn();
  if (wasLocked) mainWindow.setResizable(false);
}

ipcMain.handle('window:resize', (_evt, { width, height }) => {
  // Opening/closing settings while fullscreen must not shrink the window.
  if (mainWindow.isFullScreen()) return;
  withResizeUnlocked(() => mainWindow.setSize(Math.round(width), Math.round(height), true));
});

// Fullscreen works whether or not the size is pinned. The windowed bounds
// are captured on the way in and restored explicitly on the way out (sized
// to the pinned size, if pinned at that moment) instead of trusting the OS
// to restore them - without a window manager it doesn't, and a pinned
// window must come back at its pinned size even if settings were open.
// Restoring on 'leave-full-screen' because setFullScreen(false) isn't
// guaranteed to have finished when it returns.
let preFullscreenBounds = null;
let fullscreenRestoreSize = null;

function restoreAfterFullscreen() {
  if (!preFullscreenBounds) return;
  const target = fullscreenRestoreSize
    ? { ...preFullscreenBounds, width: fullscreenRestoreSize.width, height: fullscreenRestoreSize.height }
    : preFullscreenBounds;
  preFullscreenBounds = null;
  fullscreenRestoreSize = null;
  withResizeUnlocked(() => mainWindow.setBounds(target));
}

ipcMain.handle('window:toggleFullscreen', (_evt, restoreSize) => {
  const entering = !mainWindow.isFullScreen();
  if (entering) preFullscreenBounds = mainWindow.getBounds();
  else fullscreenRestoreSize = restoreSize || null;
  mainWindow.setFullScreen(entering);
  return entering;
});

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
