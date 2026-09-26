---
doc_id: ai-project-context
version: 1.1.1
canonical_path: .ai/PROJECT_CONTEXT.md
updated: 2026-09-03
---

# Pomodoro Timer Context

The only file in `.ai/` allowed to know what the project is; every other
document survives being copied elsewhere because this one exists. Keep it a
routing map a run can read in one breath.

## repository_mode

```text
repository_mode: personal
```

`.ai/REPOSITORY.md` § *Repository mode* reads this line and nothing else to
decide merge authority, and defines what each of the three values means. Do not
restate the definitions here — this section is the value, not the rule.

Set it deliberately. It is the one line that decides whether an agent may
complete a merge on its own.

## Facts the checks read

```text
base_branch: stable
merge_deploys: no
runtime_gate: none
test_command: none
lint_command: none
build_command: npm run dist
generated: none
external_scripts: none
public_ids: none
owner_ledger: docs/OWNER_ACTIONS.md
```

Who reads each fact: `merge_deploys` → `.ai/REPOSITORY.md` § *Merge and
deploy*; `runtime_gate` → `.ai/UX.md` § *Runtime/visual gate*; the three
commands → the compile and build ladder and every report; `generated` →
`.ai/CORE.md` § *Generated artefacts*; `external_scripts`, `public_ids` →
`.ai/CORE.md` § *Public identifiers and secrets*; `owner_ledger` →
`.ai/REPORTING.md` § *Owner ledger*.

## Authoritative product constraints

- Installable **native desktop app** (Electron), not a web app or PWA. The
  deliverable is a Windows installer (`electron-builder`, NSIS) plus a
  portable `.exe`; distribution target is Windows first.
- Single-window Pomodoro timer: work/break countdown, always-on-top toggle,
  corner-snap to a chosen monitor, native OS notification plus a single
  synthesized chime on phase change, system tray icon with minimize-to-tray,
  settings persisted to disk between launches. Frameless AND transparent
  window shaped entirely by CSS as a rounded "pill": no native title bar,
  no fullscreen; the pin/settings/close buttons live in a top-right cluster
  hidden until the widget is hovered.
- No account system, no network calls, no telemetry, no ads. Fully offline.
- Korean-language UI (target user is a Korean speaker); code, comments and
  commit messages stay in English per repository convention.

## Current architecture

- `main.js` — Electron main process: window lifecycle, JSON settings file
  under `app.getPath('userData')`, display/monitor queries, corner-snap
  geometry, native `Notification`. No renderer process touches Node/fs
  directly — all of that is IPC through `preload.js`.
- `preload.js` — `contextBridge`-exposed `window.pomodoro` API; renderer runs
  with `contextIsolation: true`, `nodeIntegration: false`.
- `renderer/` — UI: `index.html` (CSP-locked), `style.css`, `renderer.js`
  (timer state machine, settings panel, corner-snap controls, an SVG ring
  around the timer digits whose `stroke-dashoffset` tracks the
  remaining-time fraction each tick, and background image/blur/tint +
  accent-color controls). No framework; vanilla DOM.
- Background image handling: `main.js` stores only the picked file's path
  in settings; `imageFileToDataUrl()` re-reads and base64-encodes it into a
  `data:` URL on demand (`background:pick`/`background:get` IPC), so
  `settings.json` stays small. The renderer applies it via
  `background-size: cover` (fills on the short side, crops the long side)
  behind a separate tint overlay div, both clipped to `#app`'s rounded
  shape (`overflow: hidden`) and behind a set of translucent, saturated
  `backdrop-filter: blur() saturate()` "Liquid Glass" surfaces — `#app`
  itself (the whole widget body) and the settings panel (deliberately
  darker/less saturated than `#app`, for text contrast). The accent color
  is a single CSS custom property (`--accent`) the user repoints live;
  break mode overrides it to a fixed turquoise regardless.
- `#app` is the entire visible widget, not just an inner card: `frame: false`
  plus `transparent: true` on the `BrowserWindow` (`hasShadow: false`, since
  the CSS box-shadow replaces the native one) let a single continuously
  rounded div be the whole shape, window edges included — the area outside
  it is genuinely transparent to the desktop. The pin/gear/close cluster is
  `position: absolute`, `opacity: 0` by default, revealed only on
  `#app:hover`, so the idle widget stays clean. Top to bottom: close,
  settings, pin — no icon glyphs at all now, each button IS a plain 10px
  circle (`width/height: 10px`, `border-radius: 50%`), identified only by
  its native `title=` tooltip. Pin is the one with real state: hollow
  (`border`, transparent `background`) unlocked, solid filled locked. A
  `box-shadow` keeps the white dots legible regardless of what's behind
  the transparent window. No text mode-label — the ring's own color (key
  color for work,
  fixed turquoise for break) is the only mode indicator now.
- `package.json` — `electron-builder` config targets `nsis` (installer) and
  `portable` for `win`/`x64`.
- Build/run this repo can verify directly: `npm install`, syntax/lint of the
  JS, and screenshots captured via `webContents.capturePage()` under Xvfb
  (see the recent commits for what that caught). Producing and running the
  actual Windows `.exe` requires Windows (or Wine) and is out of reach of
  this Linux container — see
  `docs/OWNER_ACTIONS.md`.

## Current development slice

- Brought the Electron prototype (window, timer, settings persistence,
  monitor snapping, notifications) from a prior working session into this
  repository as the project's actual source, under version control.
- Added a system tray icon and minimize-to-tray (toggleable in settings,
  default on): minimizing hides the window instead of dropping to the
  taskbar; the tray icon shows/hides it and offers a real quit.
- Added close-to-tray (toggleable in settings, default off): when on, the
  window's own close (X) button hides to tray instead of quitting; quitting
  from the tray menu, or window-all-closed on non-mac, still quits for real.
- Restyled onto a dark/pink-red palette (CSS custom properties).
- Tried an animated canvas galaxy/black-hole background; the user found it
  too busy and asked to cancel it — reverted, and replaced with a plain SVG
  progress ring around the timer digits instead (remaining-time fraction as
  a depleting accent-colored arc on a muted track). Collapsed window height
  bumped 200 → 250 to fit the ring.
- Added a user-selectable background image (cover-fit, short side fills the
  window), background blur and tint (color + strength), and a
  user-selectable accent/key color for the ring and buttons — settings
  persist and re-apply on the next launch. Restyled the titlebar, the timer
  card and the settings panel onto a glassmorphism look (translucent,
  blurred, thin-bordered "glass" surfaces) so those controls read as
  floating over whatever background the user picks. Expanded settings
  panel height bumped 520 → 660 for the new rows.
- Removed the fullscreen toggle entirely (button, IPC handler, and the
  `isFullScreen()` guards in the resize/snap paths). Removed the native
  window frame (`frame: false`, `fullscreenable: false`); the in-app
  titlebar now carries its own close (✕) button next to the gear icon
  (`window.close()` from the renderer, which still routes through the
  existing close-to-tray logic). Corner-snap buttons dropped their text
  labels down to arrow-only icons (with a `title` tooltip) and shrank.
- Added a single synthesized chime (Web Audio API oscillator, no bundled
  audio asset) alongside the existing native notification on phase change.
- Titlebar mode-label reads "Pomodoro Timer" during work mode (was "작업");
  break mode unchanged ("휴식").
- Widened the window (the ring and buttons read as cramped against the
  glass card's edges at 260px): default/collapsed width 260 → 340,
  expanded width 300 → 340 (now equal, so the window no longer narrows
  when the settings panel opens). Glass-card padding 18px → 26px.
- Added a pin-toggle button (`#pin-btn`, 📌) in the titlebar, left of the
  gear icon: `window:setSizeLocked` IPC calls `mainWindow.setResizable()`
  and persists `sizeLocked`; the button's `aria-pressed` attribute drives
  both its accent-colored active styling and its state on load.
- Added a settings toggle for the native Windows notification on phase
  change (`notifyOnPhaseChange`, default on) — the renderer now gates
  `window.pomodoro.notify(...)` behind it in `switchMode()`; the chime
  added earlier stays unconditional (a separate, later request).
- Pin button restyled from an emoji to an inline SVG circle whose CSS
  fill/stroke toggle with `aria-pressed` (hollow outline off, solid white
  on) instead of a background-color highlight.
- Start/pause button restyled from Korean text to an inline SVG play
  triangle / pause bars, toggled via a `.running` class on the button.
- Break mode now forces `--accent` to a fixed turquoise (`#40e0d0`)
  regardless of the user's key-color setting; work mode still uses it.
  `applyModeColor()` (renamed from `applyAccentColor()`) is called from
  `switchMode()`, the accent-color picker, and init.
- Pin-then-open-settings-then-close now restores the exact size the window
  was pinned at (not the generic collapsed default): `setSizeLocked`
  returns the current size, the renderer remembers it as `pinnedSize` while
  locked, and the gear-close path prefers it. Along the way, found and
  fixed a real bug reproduced in complete isolation (no app code): on this
  platform, `BrowserWindow.setSize()` is unreliable while
  `resizable: false`. Fixed by having the `window:resize` IPC handler
  briefly unlock, resize, and relock around every programmatic resize —
  the window is never user-draggable in between, since it's synchronous.
- Reworked the glassmorphism pass into a "Liquid Glass" look (Apple's
  material language): deeper blur (16px → 26px) plus
  `backdrop-filter: saturate(180%)` for color bleed-through, a layered
  `--glass-shadow` (outer drop shadow + inset top highlight + inset bottom
  shadow) for a sense of glass thickness, pill/circular button shapes
  (`border-radius: 999px`/`50%`), a soft `drop-shadow` glow on the ring's
  accent arc, and `:active` press-scale feedback. The settings panel keeps
  its own darker, less-saturated background (`saturate(140%)` over a
  near-opaque dark gradient, plus a text-shadow on row labels) because the
  saturated titlebar/card treatment made its denser text unreadable over a
  busy background image — verified by screenshotting both before and after
  that fix under Xvfb with a vivid gradient standing in for a busy photo.
- Reshaped the whole window into a rounded "pill" widget per a user-supplied
  reference image: transparent + frameless `BrowserWindow`, `#app` as the
  single rounded glass body (46px radius, `overflow: hidden` clipping
  everything to it), the old horizontal titlebar removed in favor of a
  vertical pin/gear/close cluster pinned to the top-right corner. That
  cluster is invisible until the widget is hovered (a later request in the
  same batch). Ring enlarged (130px → 190px) and thinned (stroke 8 → 3) to
  match the reference's airy outline look; start/pause and reset are both
  large circular icon buttons now (reset gained a ↺ icon, replacing its
  "초기화" text). Default/collapsed size 340×250 → 300×460 (tall, not wide);
  expanded 340×690 → 300×780.
  NOT VERIFIED: because the window is genuinely OS-transparent, its real
  appearance depends on whatever is behind it on the user's actual desktop
  — only tested against Xvfb's plain background here. Flagged to the user.
- Removed the "Pomodoro Timer"/"휴식" text mode-label entirely (element,
  CSS, and the render() line that set it) - the reference image had no
  label. Fixed a real bug the same conversation surfaced: the pin/gear/
  close buttons weren't perfect circles because they inherited the generic
  `button` rule's `padding: 7px 14px`, which (under `box-sizing:
  border-box`) left less width than the 22px box could hold, stretching
  them oval; added `padding: 0` to fix. Then restyled all three from
  icon/emoji buttons (📌/⚙/✕) to plain uniform dots (matching pin's
  existing inline-SVG-circle approach, extended to gear/close) identified
  only by their `title=` tooltip, per a follow-up request in the same
  batch.
- Reordered the top-right cluster to close/settings/pin (top to bottom)
  and gave close and settings distinct shapes again (✕ path, □ rounded
  rect) instead of uniform dots, per a follow-up request — only pin stays
  a circle, since it's the one with actual on/off state. Added a
  `drop-shadow` filter to the cluster's icons: a verification screenshot
  in this plain-background test environment showed them nearly invisible
  (white-on-white), confirmed via computed-style checks to be a contrast
  issue rather than a rendering bug, then fixed with the shadow rather than
  changing the icon color outright (since the transparent window's real
  background is unknown either way).
- Dropped the X/square/circle icon shapes entirely per a follow-up
  request: the three buttons are now plain 10px circles with no inner SVG
  at all, the button element itself is the dot (confirmed 10x10 via
  `getBoundingClientRect()` under Xvfb). Pin's hollow/filled state moved
  from an inner circle's fill/stroke to the button's own
  background/border.
- Reduced `#app`'s outer corner radius 46px → 32px per a follow-up request
  ("iPhone style" — tighter, more device-like corners, less of a full
  pill).
- First real Windows build surfaced the risk flagged at OA-8: the
  transparent window rendered a solid black rectangle around the rounded
  `#app` shape instead of true desktop transparency (never reproducible in
  this Linux/Xvfb container — DWM compositing differs). Fixed with
  `backgroundColor: '#00000000'` on the `BrowserWindow`, since Windows can
  default a transparent window's backing surface to opaque black unless
  that's spelled out explicitly. NOT VERIFIED here either, for the same
  platform reason; waiting on the user's next real-desktop rebuild.
- Next: nothing queued; ask before adding more.

## Permanently excluded scope

- No macOS/Linux packaging unless explicitly requested — Windows installer
  is the only committed target for now.
- No cloud sync, accounts, or analytics of any kind.
- No auto-update mechanism (would require a hosted update feed / signing
  infrastructure not currently owned).
