const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');

async function launch(t, ownsInstance = true) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pomodoro-main-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const app = new EventEmitter();
  let quits = 0;
  Object.assign(app, {
    getPath: () => dir, getVersion: () => 'test', setAppUserModelId() {},
    requestSingleInstanceLock: () => ownsInstance, whenReady: () => Promise.resolve(),
    quit() { const event = { preventDefault() { this.prevented = true; } }; app.emit('before-quit', event); if (!event.prevented) quits++; },
  });
  const ipcMain = new EventEmitter();
  const handlers = new Map();
  ipcMain.handle = (name, fn) => handlers.set(name, fn);
  const sent = [];
  const timeouts = new Map();
  const intervals = new Map();
  let win;
  class Window extends EventEmitter {
    constructor() {
      super(); win = this; this.resizable = false;
      this.webContents = new EventEmitter();
      Object.assign(this.webContents, { send: (...args) => sent.push(args), isDestroyed: () => false, isCrashed: () => false });
    }
    loadFile() {}
    isDestroyed() { return false; }
    isVisible() { return true; }
    isMinimized() { return false; }
    getBounds() { return { x: 0, y: 0, width: 340, height: 470 }; }
    getPosition() { return [0, 0]; }
    getSize() { return [340, 470]; }
    isResizable() { return this.resizable; }
    setResizable(value) { this.resizable = value; }
    setBounds() {}
    setFullScreen() {}
    show() {}
    focus() {}
  }
  class Tray extends EventEmitter { setToolTip() {} setContextMenu() {} }
  const errors = [];
  const electron = {
    app, ipcMain, BrowserWindow: Window, Tray,
    screen: { getPrimaryDisplay: () => ({ workAreaSize: { height: 1080 } }), getCursorScreenPoint: () => ({ x: 0, y: 0 }) },
    Menu: { buildFromTemplate: (value) => value }, nativeImage: { createFromPath() {} },
    powerMonitor: new EventEmitter(), dialog: { showErrorBox: (...args) => errors.push(args), showMessageBox: async () => ({ response: 0 }) },
  };
  const context = vm.createContext({
    require: (name) => name === 'electron' ? electron : name.startsWith('./') ? require(`../${name.slice(2)}`) : require(name),
    __dirname: path.join(__dirname, '..'), process, Buffer,
    setInterval(fn) { const id = Symbol(); intervals.set(id, fn); return id; },
    clearInterval(id) { intervals.delete(id); },
    setTimeout(fn) { const id = Symbol(); timeouts.set(id, fn); return id; },
    clearTimeout(id) { timeouts.delete(id); },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8'), context);
  await Promise.resolve();
  return { app, ipcMain, handlers, sent, win, intervals, timeouts, errors, electron, context, quits: () => quits, dir };
}

test('quit waits for the renderer and rejects an unrelated sender', async (t) => {
  const h = await launch(t);
  h.ipcMain.emit('app:rendererReady', { sender: h.win.webContents });
  h.app.quit(); h.app.quit();
  assert.equal(h.quits(), 0);
  assert.equal(h.sent.filter(([name]) => name === 'app:prepareQuit').length, 1);
  h.ipcMain.emit('app:quitPrepared', { sender: {} }, null);
  assert.equal(h.quits(), 0);
  h.ipcMain.emit('app:quitPrepared', { sender: h.win.webContents }, null);
  assert.equal(h.quits(), 1);
});

test('a failed quit flush keeps the app open and can be retried', async (t) => {
  const h = await launch(t);
  h.app.quit();
  h.ipcMain.emit('app:quitPrepared', { sender: h.win.webContents }, true);
  assert.equal(h.quits(), 0);
  assert.equal(h.errors.length, 1);
  assert.equal(h.app.isQuitting, false);
  h.app.quit();
  h.ipcMain.emit('app:quitPrepared', { sender: h.win.webContents }, null);
  assert.equal(h.quits(), 1);
});

test('early quit is delivered when the renderer becomes ready', async (t) => {
  const h = await launch(t);
  h.app.quit();
  assert.equal(h.sent.length, 0);
  h.ipcMain.emit('app:rendererReady', { sender: h.win.webContents });
  assert.equal(h.sent[0][0], 'app:prepareQuit');
  h.ipcMain.emit('app:quitPrepared', { sender: h.win.webContents }, null);
  assert.equal(h.quits(), 1);
  assert.equal(h.timeouts.size, 0);
});

test('unresponsive renderer offers a bounded quit recovery', async (t) => {
  const h = await launch(t);
  let prompts = 0;
  h.electron.dialog.showMessageBox = async () => { prompts++; return { response: 0 }; };
  h.app.quit();
  await [...h.timeouts.values()][0]();
  assert.equal(prompts, 1);
  assert.equal(h.app.isQuitting, false);
  assert.equal(h.quits(), 0);
  h.electron.dialog.showMessageBox = async () => ({ response: 1 });
  h.app.quit();
  await [...h.timeouts.values()].at(-1)();
  assert.equal(h.quits(), 1);
});

test('close reports settings write failures instead of throwing', async (t) => {
  const h = await launch(t);
  fs.mkdirSync(path.join(h.dir, 'settings.json.tmp'));
  let prevented = false;
  assert.doesNotThrow(() => h.win.emit('close', { preventDefault() { prevented = true; } }));
  assert.equal(prevented, true);
  assert.equal(h.errors.length, 1);
});

test('clearing a background cancels an older pending pick', async (t) => {
  const h = await launch(t);
  const file = path.join(h.dir, 'input.png');
  fs.writeFileSync(file, 'image fixture');
  h.electron.dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
  let release;
  h.context.delayedRead = () => new Promise((resolve) => { release = resolve; });
  vm.runInContext('imageFileToDataUrl = delayedRead', h.context);
  const pick = h.handlers.get('background:pick')();
  await new Promise(setImmediate);
  h.handlers.get('background:clear')();
  release('data:image/png;base64,aW1hZ2U=');
  assert.equal(await pick, null);
  assert.equal(fs.existsSync(path.join(h.dir, 'background.png')), false);
});

test('clearing a background invalidates an in-flight startup image read', async (t) => {
  const h = await launch(t);
  h.handlers.get('settings:save')(null, { backgroundImageFile: 'background.png' });
  let release;
  h.context.delayedRead = () => new Promise((resolve) => { release = resolve; });
  vm.runInContext('imageFileToDataUrl = delayedRead', h.context);
  const read = h.handlers.get('background:get')();
  h.handlers.get('background:clear')();
  release('data:image/png;base64,aW1hZ2U=');
  assert.equal(await read, null);
});

test('second instances quit before creating a window or writing settings', async (t) => {
  const h = await launch(t, false);
  assert.equal(h.quits(), 1);
  assert.equal(h.win, undefined);
  assert.equal(fs.existsSync(path.join(h.dir, 'settings.json')), false);
});

test('hiding or destroying the window stops drag polling', async (t) => {
  const h = await launch(t);
  const idle = h.intervals.size;
  for (const event of ['hide', 'blur', 'closed']) {
    h.ipcMain.emit('window:moveStart');
    assert.equal(h.intervals.size, idle + 1);
    h.win.emit(event);
    assert.equal(h.intervals.size, idle);
  }
});

test('resize lock is restored after a platform error', async (t) => {
  const h = await launch(t);
  assert.throws(() => vm.runInContext('withResizeUnlocked(() => { throw new Error("platform failure"); })', h.context));
  assert.equal(h.win.resizable, false);
});

test('background reads reject oversized images before allocating their content', async (t) => {
  const h = await launch(t);
  const file = path.join(h.dir, 'large.bmp');
  const fd = fs.openSync(file, 'w');
  fs.ftruncateSync(fd, 21 * 1024 * 1024);
  fs.closeSync(fd);
  h.context.imagePath = file;
  await assert.rejects(vm.runInContext('imageFileToDataUrl(imagePath)', h.context), /smaller than 20 MB/);
});
