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
  backgroundImagePath: null,
  backgroundBlur: 0,
  backgroundTintColor: '#15161e',
  backgroundTintOpacity: 0,
  accentColor: '#f2405a',
  windowWidth: 260,
  windowHeight: 250,
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
    resizable: true,
    frame: false,
    fullscreenable: false,
    icon: path.join(__dirname, 'renderer', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.on('close', (event) => {
    // persist current window size so next launch remembers it
    const [w, h] = mainWindow.getSize();
    saveSettings({ windowWidth: w, windowHeight: h });
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
      { label: '열기', click: showWindow },
      { type: 'separator' },
      {
        label: '종료',
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
    label: `모니터 ${idx + 1}${d.id === primaryId ? ' (주 모니터)' : ''} — ${d.bounds.width}x${d.bounds.height}`,
    bounds: d.bounds,
  }));
});

// corner: 'tl' | 'tr' | 'bl' | 'br'
ipcMain.handle('window:snapToCorner', (_evt, { displayId, corner }) => {
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

ipcMain.handle('window:resize', (_evt, { width, height }) => {
  mainWindow.setSize(Math.round(width), Math.round(height), true);
});

ipcMain.handle('notify', (_evt, { title, body }) => {
  if (Notification.isSupported()) {
    new Notification({ title, body }).show();
  }
});

ipcMain.handle('background:pick', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '배경 이미지 선택',
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
