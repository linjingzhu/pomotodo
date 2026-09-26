// Regenerates every icon from assets/pomodoro-app-icon.svg:
//   build/icon.ico                 exe / taskbar (16-256px, one PNG per size)
//   renderer/icon.png              window icon (256px)
//   renderer/tray-icon.png, @2x    tray (16px, 32px for 200% displays)
// Each size is rasterized from the SVG itself (not downscaled from one big
// bitmap), so small sizes stay as sharp as Chromium can make them.
// Run: npm run icons
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SOURCE = path.join(ROOT, 'assets', 'pomodoro-app-icon.svg');
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.disableHardwareAcceleration();

// ICO with PNG-compressed entries (supported since Windows Vista).
function buildIco(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  const entries = [];
  let offset = 6 + 16 * pngs.length;
  for (const { size, data } of pngs) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt8(0, 2);
    e.writeUInt8(0, 3);
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += data.length;
    entries.push(e);
  }
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.data)]);
}

app.whenReady().then(async () => {
  const svg = fs.readFileSync(SOURCE).toString('base64');
  const win = new BrowserWindow({
    width: 300,
    height: 300,
    show: false,
    transparent: true,
    frame: false,
    backgroundColor: '#00000000',
    webPreferences: { offscreen: true },
  });
  await win.loadURL(`data:text/html,${encodeURIComponent(`<!doctype html>
    <html><body style="margin:0;background:transparent">
    <img id="i" src="data:image/svg+xml;base64,${svg}" style="display:block">
    </body></html>`)}`);

  async function render(size) {
    await win.webContents.executeJavaScript(`new Promise((resolve) => {
      const i = document.getElementById('i');
      i.style.width = i.style.height = '${size}px';
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    })`);
    await new Promise((r) => setTimeout(r, 150));
    const image = await win.webContents.capturePage({ x: 0, y: 0, width: size, height: size });
    const actual = image.getSize();
    if (actual.width !== size || actual.height !== size) {
      throw new Error(`rendered ${actual.width}x${actual.height}, expected ${size}x${size}`);
    }
    return image.toPNG();
  }

  const pngs = [];
  for (const size of ICO_SIZES) pngs.push({ size, data: await render(size) });
  fs.mkdirSync(path.join(ROOT, 'build'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'build', 'icon.ico'), buildIco(pngs));
  fs.writeFileSync(path.join(ROOT, 'renderer', 'icon.png'), pngs.find((p) => p.size === 256).data);
  fs.writeFileSync(path.join(ROOT, 'renderer', 'tray-icon.png'), pngs.find((p) => p.size === 16).data);
  fs.writeFileSync(path.join(ROOT, 'renderer', 'tray-icon@2x.png'), pngs.find((p) => p.size === 32).data);
  console.log(`icons written: build/icon.ico (${ICO_SIZES.join(', ')}), renderer/icon.png, renderer/tray-icon.png, renderer/tray-icon@2x.png`);
  app.quit();
}).catch((e) => {
  console.error(e);
  app.exit(1);
});
