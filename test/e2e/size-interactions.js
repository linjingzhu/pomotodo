// Window-size interaction test against the real main.js: fullscreen,
// pin (size lock), Reset Size, the panel's grow/shrink, Match-to-image-
// ratio, and real edge drags, in combination. Not part of `npm test`: it
// needs a display with a window manager and xdotool. Run:
//
//   Xvfb :97 -screen 0 1280x900x24 & DISPLAY=:97 openbox &
//   DISPLAY=:97 npx electron --no-sandbox test/e2e/size-interactions.js
//
// Results go to test/e2e/out/size-interactions.txt (PASS/FAIL per check).
const { app, dialog, screen } = require('electron');
const fs = require('fs');
const { execSync } = require('child_process');
const path = require('path');
const D = path.join(__dirname, 'out');
fs.rmSync(D, { recursive: true, force: true });
fs.mkdirSync(D + '/ud', { recursive: true });
app.setPath('userData', D + '/ud');
app.commandLine.appendSwitch('disable-gpu');
dialog.showMessageBox = async () => ({ response: 2 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = [];
let fails = 0;
const out = (s) => { log.push(s); fs.writeFileSync(D + '/size-interactions.txt', log.join('\n') + '\n'); };
const check = (name, cond, detail = '') => { if (!cond) fails++; out(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  [' + detail + ']' : ''}`); };
const settings = () => JSON.parse(fs.readFileSync(D + '/ud/settings.json', 'utf8'));
const xdo = (cmd) => execSync('xdotool ' + cmd, { env: { ...process.env, DISPLAY: process.env.DISPLAY } }).toString().trim();
const MIN = { width: 180, height: 140 };
const DEF = { width: 340, height: 470 };

app.on('browser-window-created', (_e, win) => {
  win.webContents.once('did-finish-load', async () => {
    const js = (s) => win.webContents.executeJavaScript(s);
    const api = (s) => js('window.pomodoro.' + s);
    const b = () => win.getBounds();
    const same = (x, y) => x.x === y.x && x.y === y.y && x.width === y.width && x.height === y.height;
    const sizeIs = (bb, w, h) => bb.width === w && bb.height === h;
    const fs_ = () => js("document.getElementById('app').classList.contains('fullscreen')");
    const panel = async (open) => { await api(`setPanelOpen(${open})`); await js(`document.getElementById('app').classList.toggle('panel-open', ${open}); document.getElementById('settings-panel').classList.toggle('hidden', ${!open})`); await sleep(250); };
    const pin = async (on) => { await api(`setSizeLocked(${on})`); await sleep(50); };
    const toFS = async () => { await api('toggleFullscreen()'); await sleep(700); };
    // Real edge drag with the mouse: start at the window's SE corner and drag.
    const dragSE = async (dx, dy) => {
      const bb = b();
      const x0 = bb.x + bb.width - 3, y0 = bb.y + bb.height - 3;
      xdo(`mousemove ${x0} ${y0}`); await sleep(60);
      await js(`window.pomodoro.resizeStart('se')`);
      for (let i = 1; i <= 8; i++) { xdo(`mousemove ${x0 + Math.round(dx * i / 8)} ${y0 + Math.round(dy * i / 8)}`); await sleep(40); }
      await js(`window.pomodoro.resizeEnd()`); await sleep(120);
    };
    const dragN = async (dy) => {
      const bb = b(); const x0 = Math.round(bb.x + bb.width / 2), y0 = bb.y + 2;
      xdo(`mousemove ${x0} ${y0}`); await sleep(60);
      await js(`window.pomodoro.resizeStart('n')`);
      for (let i = 1; i <= 8; i++) { xdo(`mousemove ${x0} ${y0 + Math.round(dy * i / 8)}`); await sleep(40); }
      await js(`window.pomodoro.resizeEnd()`); await sleep(120);
    };
    const invariants = async (tag) => {
      const bb = b();
      check(`${tag}: never below MIN_SIZE`, bb.width >= MIN.width && bb.height >= MIN.height, `${bb.width}x${bb.height}`);
      const locked = settings().sizeLocked;
      check(`${tag}: resizable flag matches pin`, win.isResizable() === false, `isResizable=${win.isResizable()} pinned=${locked}`);
    };
    try {
      await sleep(1200);
      const area = screen.getPrimaryDisplay().workArea;
      out(`screen workArea ${JSON.stringify(area)}  start ${JSON.stringify(b())}  isFullScreen=${win.isFullScreen()}`);
      check('starts at default size', sizeIs(b(), DEF.width, DEF.height), JSON.stringify(b()));

      // 1. fullscreen -> windowed restores exact bounds
      const b1 = b(); await toFS();
      check('1 fullscreen: OS window fills the screen', b().width >= area.width - 2 && b().height >= area.height - 2, JSON.stringify(b()));
      check('1 fullscreen: renderer told', await fs_() === true);
      await toFS(); await sleep(500);
      check('1 windowed: exact bounds restored', same(b(), b1), `${JSON.stringify(b1)} -> ${JSON.stringify(b())}`);
      check('1 windowed: renderer told', await fs_() === false);
      await invariants('1');

      // 2. custom size (real drag) -> fullscreen -> windowed keeps custom size
      await dragSE(60, 90);
      const b2 = b();
      check('2 drag SE grew the window', b2.width === DEF.width + 60 && b2.height === DEF.height + 90, JSON.stringify(b2));
      await toFS(); await toFS(); await sleep(500);
      check('2 custom size survives fullscreen round trip', same(b(), b2), JSON.stringify(b()));
      await invariants('2');

      // 3. pin: drag refused; fullscreen still works; size restored; drag still refused
      await pin(true);
      const b3 = b(); await dragSE(50, 50);
      check('3 pinned: edge drag refused', same(b(), b3), JSON.stringify(b()));
      await toFS();
      check('3 pinned: fullscreen still works', b().width >= area.width - 2, JSON.stringify(b()));
      await toFS(); await sleep(500);
      check('3 pinned: size restored after fullscreen', same(b(), b3), JSON.stringify(b()));
      await dragSE(50, 50);
      check('3 pinned: drag still refused after fullscreen', same(b(), b3), JSON.stringify(b()));
      await invariants('3');
      await pin(false);
      await dragSE(-60, -90);
      check('3 unpinned: drag works again', sizeIs(b(), DEF.width, DEF.height), JSON.stringify(b()));

      // 4. panel open grows to 780, close gives it back
      const b4 = b(); await panel(true);
      check('4 panel open: height 780', b().height === 780 && b().width === b4.width, JSON.stringify(b()));
      check('4 panel open: moved up to stay on screen', b().y + b().height <= area.y + area.height, `bottom=${b().y + b().height}`);
      await panel(false);
      check('4 panel closed: original bounds back', same(b(), b4), `${JSON.stringify(b4)} -> ${JSON.stringify(b())}`);

      // 5. panel open -> fullscreen -> close panel in fullscreen -> windowed = original
      await panel(true); await toFS(); await panel(false); await toFS(); await sleep(500);
      check('5 panel closed while fullscreen: windowed = original', same(b(), b4), JSON.stringify(b()));

      // 6. fullscreen -> open panel in fullscreen -> windowed = grown
      await toFS(); await panel(true); await toFS(); await sleep(700);
      check('6 panel opened while fullscreen: windowed grew to 780', b().height === 780, JSON.stringify(b()));
      await panel(false);
      check('6 then closing the panel returns to original', same(b(), b4), JSON.stringify(b()));

      // 7. reset size from fullscreen -> windowed default
      await dragSE(40, 40); await toFS(); await api('resetSize()'); await sleep(900);
      check('7 reset size from fullscreen: windowed at default', sizeIs(b(), DEF.width, DEF.height) && !win.isFullScreen(), JSON.stringify(b()));
      check('7 renderer told windowed', await fs_() === false);

      // 8. reset size while pinned: works, still locked
      await pin(true); await dragSE(30, 30); // refused
      await api('resetSize()'); await sleep(300);
      check('8 pinned reset size: default size', sizeIs(b(), DEF.width, DEF.height), JSON.stringify(b()));
      check('8 pinned reset size: still not resizable', win.isResizable() === false);
      await pin(false);

      // 9. panel open (bottom on the screen edge) then drag the top edge up;
      // closing shrinks only by the growth and undoes only the shift
      await panel(true); await dragN(-100);
      check('9 panel open, top edge up 100: 880 tall at y=20', b().height === 880 && b().y === 20, JSON.stringify(b()));
      await panel(false);
      check('9 panel closed: shrinks by the 310 growth only, y back by the 95 shift', b().height === 570 && b().y === 115, JSON.stringify(b()));
      await panel(true);
      check('9 reopen: grows to 780 in place (bottom 895 still fits)', b().height === 780 && b().y === 115, JSON.stringify(b()));
      await panel(false);
      check('9 close again: 570', b().height === 570, JSON.stringify(b()));
      await api('resetSize()'); await sleep(200);

      // 10. panel open -> reset size -> close panel -> default (no shrink below default)
      await panel(true); await api('resetSize()'); await sleep(300);
      check('10 reset with panel open: 340x780', sizeIs(b(), DEF.width, 780), JSON.stringify(b()));
      await panel(false);
      check('10 close after reset: default', sizeIs(b(), DEF.width, DEF.height), JSON.stringify(b()));

      // 11. fit aspect (16:9 keep width) survives panel and fullscreen round trips
      await panel(true);
      const fit = await api("fitAspect('width', 1600, 900)"); await sleep(300);
      check('11 fit 16:9 keep width: 340x194', fit && fit.width === 340 && fit.height === 194 && b().height === 194, JSON.stringify(b()));
      await panel(false);
      check('11 closing panel keeps fitted size', b().height === 194, JSON.stringify(b()));
      await toFS(); await toFS(); await sleep(600);
      check('11 fitted size survives fullscreen', sizeIs(b(), 340, 194), JSON.stringify(b()));
      check('11 fitted size saved', settings().windowWidth === 340 && settings().windowHeight === 194, `${settings().windowWidth}x${settings().windowHeight}`);
      await invariants('11');

      // 12. pinned fit aspect works and stays locked
      await pin(true); await api("fitAspect('height', 900, 1600)"); await sleep(300);
      check('12 pinned fit 9:16 keep height: not resizable, ratio applied', win.isResizable() === false && Math.abs((b().width - 6) / (b().height - 6) - 9 / 16) < 0.02, JSON.stringify(b()));
      await pin(false); await api('resetSize()'); await sleep(300);

      // 13. Esc leaves fullscreen
      await toFS(); win.focus(); await sleep(200);
      xdo('key --clearmodifiers Escape'); await sleep(900);
      check('13 Esc leaves fullscreen', !win.isFullScreen() && (await fs_()) === false && sizeIs(b(), DEF.width, DEF.height), JSON.stringify(b()));

      // 14. double toggle quickly doesn't get stuck
      await api('toggleFullscreen()'); await api('toggleFullscreen()'); await sleep(1200);
      check('14 rapid toggle twice: windowed at default', !win.isFullScreen() && sizeIs(b(), DEF.width, DEF.height) && (await fs_()) === false, JSON.stringify(b()));

      // 15. move drag refused while fullscreen; resize drag refused while fullscreen
      await toFS(); const bf = b();
      await js('window.pomodoro.moveStart()'); xdo('mousemove_relative 40 40'); await sleep(200); await js('window.pomodoro.moveEnd()');
      check('15 move refused in fullscreen', same(b(), bf), JSON.stringify(b()));
      await dragSE(40, 40);
      check('15 resize refused in fullscreen', same(b(), bf), JSON.stringify(b()));
      await toFS(); await sleep(500);

      // 16. saved size excludes panel growth when closing with the panel open
      await dragSE(20, 20); await panel(true);
      const before = b();
      win.emit('close', { preventDefault() {} }); await sleep(100);
      check('16 close with panel open saves base size (growth removed)', settings().windowWidth === 360 && settings().windowHeight === 490, `${settings().windowWidth}x${settings().windowHeight} (window ${before.width}x${before.height})`);
      await panel(false);
      await invariants('16');

      // 17. fit aspect called while ALREADY fullscreen (not via a round trip):
      // exits fullscreen and lands windowed at the fitted size
      await api('resetSize()'); await sleep(200);
      await toFS();
      check('17 setup: actually fullscreen', win.isFullScreen() === true);
      const fit17 = await api("fitAspect('width', 1600, 900)"); await sleep(700);
      check('17 fit while fullscreen: exits to windowed at fitted size', !win.isFullScreen() && (await fs_()) === false && sizeIs(b(), 340, 194), JSON.stringify(b()));
      check('17 fit while fullscreen: return value matches', fit17 && fit17.width === 340 && fit17.height === 194, JSON.stringify(fit17));
      await api('resetSize()'); await sleep(200);

      // 18. after fitting, a plain edge drag still works (not implicitly locked)
      await api("fitAspect('width', 1600, 900)"); await sleep(200);
      const b18 = b(); await dragSE(40, 40);
      check('18 drag still works after a fit (not implicitly pinned)', b().width === b18.width + 40 && b().height === b18.height + 40, JSON.stringify(b()));
      await api('resetSize()'); await sleep(200);

      // 19. Reset Size after a fit returns to the TRUE default, not the fitted size
      await api("fitAspect('height', 900, 1600)"); await sleep(200);
      const b19 = b();
      check('19 setup: fitted to a non-default size', !sizeIs(b19, DEF.width, DEF.height), JSON.stringify(b19));
      await api('resetSize()'); await sleep(300);
      check('19 reset after fit: true default, not the fit ratio', sizeIs(b(), DEF.width, DEF.height), JSON.stringify(b()));

      // 20. sequential fits with different ratios/keep modes each recompute
      // from the CURRENT bounds (the second is not based on the first image)
      const s20a = await api("fitAspect('width', 2, 1)"); await sleep(200); // 2:1 keep width -> 340x173
      check('20a first fit (2:1 keep width)', s20a.width === 340 && s20a.height === 173, JSON.stringify(s20a));
      // square keep height: from 173 tall, a bare 173x173 is below MIN_SIZE.width
      // (180), so it scales up to 180x180 - still recomputed from 20a's
      // post-fit bounds (173), not from the original 470 or a stale value
      const s20b = await api("fitAspect('height', 1, 1)"); await sleep(200);
      check('20b second fit uses the post-20a bounds, clamped up to MIN_SIZE', s20b.width === 180 && s20b.height === 180, JSON.stringify(s20b));
      await api('resetSize()'); await sleep(200);

      // 21. an extreme ratio that needs scaling DOWN to fit the screen (not
      // just up to MIN_SIZE, as in scenario 12) still preserves the ratio
      await dragSE(area.width - DEF.width - 100, 0); await sleep(100); // widen close to the screen
      const wideBounds = b();
      const fit21 = await api('fitAspect(\'width\', 1, 3)'); await sleep(300); // tall portrait keep-width
      const r21 = (b().width - 6) / (b().height - 6);
      check('21 down-scaled fit still hits the target ratio', Math.abs(r21 - 1 / 3) < 0.01, `ratio=${r21.toFixed(3)} bounds=${JSON.stringify(b())} from=${JSON.stringify(wideBounds)}`);
      check('21 down-scaled fit stays within the work area', b().width <= area.width && b().height <= area.height, JSON.stringify(b()));
      check('21 return value matches window', fit21.width === b().width && fit21.height === b().height, JSON.stringify(fit21));
      await api('resetSize()'); await sleep(200);

      // 22. fit -> toggle the panel open/closed twice in a row -> no drift
      const fit22 = await api("fitAspect('width', 4, 3)"); await sleep(200);
      await panel(true); await panel(false); await panel(true); await panel(false);
      check('22 fit size survives two panel open/close cycles', sizeIs(b(), fit22.width, fit22.height), `expected ${JSON.stringify(fit22)} got ${JSON.stringify(b())}`);
      await api('resetSize()'); await sleep(200);
      await invariants('22');
    } catch (e) { out('ERR ' + e.stack); fails++; }
    out(`DONE fails=${fails}`);
    app.exit(0);
  });
});
require(path.join(__dirname, '..', '..', 'main.js'));
