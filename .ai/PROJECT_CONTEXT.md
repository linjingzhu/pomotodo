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
test_command: npm test
lint_command: none
build_command: npm run dist
generated: build/icon.ico, renderer/icon.png, renderer/tray-icon.png, renderer/tray-icon@2x.png (from assets/pomodoro-app-icon.svg via `npm run icons`; add --no-sandbox when running as root)
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
- First real Windows build showed a rectangle around the rounded `#app`
  shape. First attempt, `backgroundColor: '#00000000'` on the
  `BrowserWindow`, was a MISDIAGNOSIS: I assumed a Windows-only
  compositing quirk I couldn't reproduce here, and the user confirmed the
  box was still there. Kept anyway (harmless, correct practice).
  Real cause, reproduced here once I used the user's actual settings
  (gray tint ~75%): `#bg-image` and `#bg-tint` were children of `<body>`,
  siblings of `#app`, so `#app`'s rounded `overflow: hidden` never clipped
  them. Any non-zero tint or a background image painted the whole
  rectangular window. The CSS comment even claimed they were clipped.
  Every earlier test used a fresh settings.json (tint 0, no image), so the
  layers were invisible and the bug hid. Fixed by moving both inside `#app`
  with `z-index: -1` (above its glass background, below its content).
  Evidence: the corner pixel went from `rgba(60,60,60,193)` to
  `rgba(0,0,0,9)` (only the box-shadow edge).
  Lesson: reproduce with the user's real settings before blaming the
  platform.
- Added a 4th hover dot (last): fullscreen/window toggle. Removed
  `fullscreenable: false`. Works while pinned. main.js captures the windowed
  bounds on entry and restores them itself on 'leave-full-screen' (with
  the pinned size if pinned). Without that, Xvfb (no window manager) left
  the window screen-sized after exit, and it no longer depended on the OS.
  Resize, snap and saving size on close are all ignored while fullscreen.
  Verified under Xvfb, both pinned and unpinned: fullscreen, then settings
  open/close, then exit returns 420x340. Real Windows is OA-9.
- Timer states made distinct, set as `data-state` on #app
  (idle/running/paused):
  - idle: no color, empty ring, dim digits, glass start button.
  - running: accent ring with glow, plus a tip dot that rotates with the
    arc end.
  - paused: ring at 40% with no glow, digits blink slowly (static under
    prefers-reduced-motion).
  - Phase switch: the ring refills clockwise in the new color (dashoffset
    jumps to +C, then transitions to 0).
- Streak: 4 dots under the digits count consecutive completed work
  sessions per set of four, with "xN" for full sets. The reset button
  zeroes the streak only in work mode.
- Verified under Xvfb by speeding up the renderer's setInterval from the
  test harness (no app code changed for the test).
- Found while screenshotting: #app's `0 12px 40px` outer shadow overflowed
  the 3px window margin. It was cut off at the window edge, leaving a
  hard-edged shadow rectangle (alpha 78 at the bottom edge), which is a
  second contributor to the user's "box". Shrunk it to `0 1px 2px`; the
  edge alpha is now 0-4.
- Replaced the streak dots, at the user's request, with persisted totals
  under the controls: 총 턴 (completed work sessions), 총 학습시간 (every
  work-mode second actually ticked, including abandoned sessions), and a
  초기화 button.
  - The totals reset is a single click, per the user's request. An
    earlier version asked for a second click within 3s.
  - The timer reset no longer touches any count.
  - Totals are saved to settings.json on each phase switch, on
    pause/reset, and every 10 work seconds, so at most 10s is lost if the
    app is killed.
  - Verified across a restart under Xvfb: 2 turns / 151s saved and
    restored, then the two-click reset cleared both.
- All UI text switched to English at the user's request: HTML labels and
  tooltips, renderer strings (notifications, study-time format `3h 5m`),
  tray menu, display labels, file dialog title, package description, and
  `lang="en"`. Grep for Hangul across the app sources returns 0. Checked
  under Xvfb: no settings or stats row overflows.
- Ring: replaced the white tip dot, which the user found awkward, with a
  color gradient along the arc. The arc is now a conic-gradient div masked
  to the ring band. The SVG keeps only the track. Arc angles are
  `@property` angles, so depletion and the phase-switch refill still
  animate. The color runs from the accent at the moving end to
  `oklch(from accent, h+45)` at 30% alpha. The glow sits on a parent
  wrapper, because a filter on the masked element gets masked away.
- Notifications on both phase ends stay up until user input:
  - Windows: a toastXml with `scenario="reminder"`, which needs a button,
    so it has a system Dismiss button.
  - Elsewhere: `timeoutType: 'never'`.
  - Silent, because the in-app chime is the only sound.
  - Only one is kept at a time. It closes on toast click (which also shows
    the window), on start/pause/reset, or when the next phase replaces it.
  - Added `app.setAppUserModelId(appId)` on win32. It was missing, which
    can stop toasts from showing on installed builds.
  - The lifecycle was verified with a stubbed Notification via a
    Module._load hook. Windows rendering is OA-12.
- Windows installer built in the container (no Windows machine needed):
  - Installed Wine 9.0 from the Ubuntu archive, with the 32-bit variant,
    because NSIS runs its 32-bit installer to extract the uninstaller.
  - The container's `libgd3` came from the ondrej/php PPA and blocked
    `libgd3:i386`. Downgrading amd64 to the archive version 2.3.3-9ubuntu5
    unblocked it. That downgrade is in the container only, not the repo.
  - Then `npx electron-builder --win --x64` produced
    `dist/PomodoroTimer-Setup-1.0.0.exe` and `-Portable-`, about 78MB
    each, unsigned.
  - Set `build.win.icon` to `renderer/icon.png` (256px), because it had
    been shipping the default Electron icon.
  - Checks:
    - `app.asar` holds HEAD's code.
    - `wine Setup.exe /S` installs to
      `%LOCALAPPDATA%\Programs\Pomodoro Timer` with shortcuts and an
      uninstaller.
    - The installed exe opens a 300x460 window under Wine.
- GitHub Releases, per the user, via Actions (the session has no release
  API). The user's rule is that Actions must never cost money.
  `.github/workflows/release.yml` keeps to that:
  - ubuntu-latest only, with the Windows build in the
    `electronuserland/builder:wine` container. Windows runners bill 2x.
  - Triggered only by changes to package.json or the workflow, or by
    hand.
  - A 1-minute `check` job skips the build when release `v<version>`
    already exists.
  - Timeouts of 3 and 25 minutes.
  - No upload-artifact.
  - Ships the Setup exe, the Portable exe and SHA256SUMS.txt.
  - While the repo was private, GitHub refused to start any job: no
    runner was assigned and there were no logs. The owner chose to make
    the repo public, which makes Actions free.
  - The first real run then failed. The container's mounted HOME,
    /github/home, isn't owned by root, and wine refuses to use it. Fixed
    with `HOME: /root`.
  - Release v1.0.0 is published: Setup, Portable and SHA256SUMS.
  - The Setup exe was downloaded anonymously and its checksum matches.
    It installs under Wine.
- Before merging I read `.ai/REPOSITORY.md` § *Paid automation*. It
  requires an owner approval record plus a workflow that fails closed.
  Neither had been done.
  - Added OA-13 as the approval record.
  - Added a first step that exits unless `repository.private == false`
    and today is on or before 2027-03-26. That date is Claude's proposal;
    the owner can change it.
  - Dropped the feature branch from the triggers.
  - Lesson: read REPOSITORY.md before adding any automation, not at merge
    time.
- Real Windows screenshot, after the merge: the corner dots only appeared
  over the ring, and the stats' second row and Reset were cut off below
  the window edge.
  - Cause of the hover bug: Windows sends no mouse events over
    `-webkit-app-region: drag`, so CSS :hover only fired on the no-drag
    ring. Fix: main.js polls `screen.getCursorScreenPoint()` against the
    window bounds every 120ms and sends `window:pointer`; the renderer
    toggles `#app.pointer-inside`.
  - Cause of the clipping: main had a fixed content height. Fix: main is
    now a size container. The ring is
    `clamp(96px, min(100cqw, 100cqh - 158px), 190px)`, and the digits
    and the ring mask scale with it (the mask now uses percentages).
    Watch out: cq units measure the content box, so padding is not part
    of the reserve.
  - Stats now span the ring's width (label at its left edge, value at
    its right edge, per the user's mockup), are at least 176px wide, and
    have 14px above Reset. The settings panel is capped at 48% and
    scrolls.
  - Verified under Xvfb at 300x460, 320x380, 260x330 and with settings
    open. xdotool hover over a drag area toggles the dots on and off.
- Gauge: the default is now a filled pie (the same conic gradient, masked
  to a disc out to the track's outer edge, 85% alpha at the moving edge
  so the digits stay readable). Settings > Gauge style switches between
  `pie` and `stroke` via `#app[data-gauge]`, persisted as `gaugeStyle`.
  Play/pause lost `.primary` and is now clear glass like reset, so the
  idle-state overrides were dropped. Both styles and persistence across
  a restart were verified under Xvfb.
- Portable-only builds, per the user: the nsis target is dropped, and
  the release workflow ships the Portable exe plus SHA256SUMS.
- History, goals and Google Calendar, per the user.
  - UX contract:
    - Entry: the 2nd dot opens a Goals / Calendar / Settings tabbed panel.
    - "What are you working on?" sits under the controls.
    - A focus session is recorded when it completes, or when it is reset
      after at least 60s of work.
    - Goals are checkable and deletable.
    - Calendar: a month grid shaded by focus time, and a day list whose
      notes are editable.
    - Empty-state hints, and Google status/error text in Settings.
  - `store.js` holds records.json: sessions and goals, as pure functions.
  - `gcal.js` holds OAuth for installed apps: loopback plus PKCE (S256)
    plus state, with scope `calendar.app.created`, so it only touches its
    own "Pomodoro Timer" calendar.
    - The refresh token is encrypted with safeStorage (DPAPI), and kept in
      memory only when encryption is unavailable.
    - Sessions become timed events; reached goals become all-day events.
      Unchecking or deleting a goal deletes its event.
    - If the calendar was deleted, it is recreated and everything is
      replayed.
    - `invalid_grant` disconnects with a clear message. Apps left in
      "Testing" get 7-day refresh tokens.
  - main.js `syncPending()` runs after changes and at startup.
  - The client ID and secret are pasted in-app, never committed (OA-15).
  - `npm test` runs node:test: 13 tests for store and gcal, against a fake
    Google plus a fake browser.
  - E2E under Xvfb used the real main/gcal with only fetch and
    shell.openExternal faked. The whole flow passed: task, session, goals,
    calendar, note edit, connect, sync, note patch, un-reach deletes the
    event, disconnect revokes.
  - The portable build contains the new files and runs under Wine.
  - No product-design skill exists for this user (listed and searched);
    `.ai/UX.md` was used instead.
- Panel height is now fixed at 48% of #app for every tab (`flex: 0 0 48%`),
  per the user, so switching tabs never moves the timer. Goals may leave
  empty space; Calendar and Settings scroll. It measured 371px on all
  three tabs under Xvfb. Also added a thin translucent scrollbar and
  bumped the version to 1.0.2.
- Panel tabs, per the user: plain text, no background and no underline. The
  active tab is only in the key color (`var(--accent)`, turquoise during
  breaks).
- The panel no longer scrolls as a whole. The tab bar is fixed and only
  the `.tab` body scrolls, with 32px bottom padding so the last row clears
  the rounded corners. Earlier, the sticky bar's 90%-opaque background let
  rows sliding under it show through. (First misread as a sticky-offset
  bug; measuring disproved that.)
- App icon, per the user: the owner uploaded `pomodoro-app-icon.svg` to
  stable (the SVG chat attachment was rejected). It was reviewed (no
  scripts or external refs) and moved to `assets/`.
  - `scripts/make-icons.js` (`npm run icons`) rasterizes the SVG separately
    at each size in offscreen Chromium, with alpha. It writes a 7-size
    PNG-entry `build/icon.ico` (the exe icon), the 256px window icon, and
    tray 16px plus @2x 32px.
  - `win.icon` now points to build/icon.ico.
  - The tray loads tray-icon.png, and nativeImage picks up @2x (scale
    factors [1,2]). Before, it was a 256px icon resized to 16.
  - The `wrestool` extract of the built exe shows all 7 sizes.
- Google Calendar sync removed, per the user (no external calendar
  connection): gcal.js, its tests, gcal IPC and preload methods, the
  Settings > Google Calendar section, and `gcalEventId` bookkeeping in
  store.js (setGoalEvent, pendingSync, clearEventIds).
  - The user first said to drop the Calendar tab too, then reversed that
    mid-edit. The in-app Calendar tab stays: month grid, day list, note
    editing, all local.
  - OA-15 is marked not applicable.
  - Existing users' google-calendar.json in userData is left alone
    (harmless).
- The panel (gear) dot moved to the bottom-right corner, per the user, in
  `.corner-actions.bottom`. It's placed after the panel in the DOM so it
  stays clickable over the open panel, and is revealed on hover like the
  top-right cluster, which is now close · pin · fullscreen. It sits
  15px/15px from the corner, above the tab body's 32px bottom padding.
  Version 1.0.3.
- Window size and fullscreen, per the user:
  - The launch size equals the expanded-panel size, 300x780 (the
    largest). The panel opens inside the window, and `window:resize`, the
    COLLAPSED/EXPANDED sizes and pinnedSize were all removed. It is
    clamped to the primary work area height. Old installs are migrated
    once via `fullHeightLayout`, and later manual sizes are kept.
  - Fullscreen state is tracked in main (`fullscreenBounds`) instead of
    via isFullScreen(). Exit restores the exact pre-fullscreen bounds,
    pinned or not: once immediately, again on 'leave-full-screen', and
    again after 400ms. A re-entrancy guard is needed because setBounds
    while leaving fullscreen re-emits 'leave-full-screen' synchronously
    (a stack overflow reproduced under Xvfb).
  - Esc exits, via before-input-event.
  - The window is locked while fullscreen: `#app.fullscreen` sets
    no-drag, plus a `will-move` preventDefault. The user first asked for
    drag-to-exit, then changed it to locked.
  - The renderer is told of changes via `window:fullscreen` (button title,
    class).
  - Version 1.0.4.
- The timer's goal field is synced with the Goals list, per the user.
  - Enter in `#task-input` adds the text as a goal. `store.addGoal` now
    reuses an open goal with the same title, case-insensitively, and the
    field is then normalized to that goal's title.
  - Clicking a goal title (or Enter/Space on it) in the Goals tab sets it
    as the timer's goal. The current goal is highlighted in the key
    color.
  - Events: `goals-changed` and `task-changed` keep the list fresh.
  - The placeholder is now "Goal for this session".
  - E2E under Xvfb used real typing: insertText plus an Enter keydown.
- 1.0.5 UI fixes, per the user.
  - The gear dot now lives inside `<main>` (`position: relative`), so it
    sits at the bottom-right of the timer area and rides just above the
    panel when that opens, instead of staying pinned to the window corner.
  - Calendar: today is shown in bright orange (#ffa53d, number and ring);
    the goal-reached check marks on days were removed. Reached goals are
    still listed in the day view.
  - The stats reset button reads "Reset Session".
  - Edge-drag resizing, which never worked on Windows: Electron documents
    transparent windows as not resizable, yet a resizable frameless
    window still reserves a dead ~5px native resize strip at its edges.
    The window is now always `resizable: false` (those pixels then reach
    the page, measured with real X input under Xvfb). Eight
    `#resize-handles` strips/corners drive `window:resizeStart/Move/End`,
    which recomputes bounds from the drag start and applies them via
    `withResizeUnlocked`. The size lock is now an app flag only (handles
    hidden, main refuses). Fullscreen hides the handles, main refuses, and
    a `will-resize` backstop cancels anything else; setFullScreen is
    wrapped in `withResizeUnlocked`.
  - Goal check: a round check at the timer goal field's left, shown on
    hover or focus once there is a goal, shows that goal's reached state.
    A click flips it. Reaching it loads the next unreached goal in the
    Goals list order (after it, else the first one); when all are
    reached, the goal stays. Text not yet in the list is added, then
    marked reached. Goal edits anywhere dispatch `goals-changed`.
  - Reset Session also resets the timer fully: stop, record an
    in-progress focus session like ↻ does, back to work mode, idle.
  - A double-click on the widget flips fullscreen <-> windowed. Over the
    drag region Windows gives the page no mouse events, so main hooks
    `WM_NCLBUTTONDBLCLK` (HTCAPTION only) and defers `toggleFullscreen`;
    elsewhere (fullscreen is all no-drag) a page `dblclick` does it,
    skipping buttons, inputs, labels, the panel and the resize handles.
    Not verifiable here: Xvfb has no WM, so a "fullscreen" X window keeps
    its old geometry, and under Wine xdotool input never reached the app
    window. The page path was checked with sendInputEvent.
  - Timer bug found in research: it counted one second per
    `setInterval` tick, and a hidden window's timers are throttled
    (Chromium intensive throttling; `backgroundThrottling` was on), so in
    the tray it ran about 1 second per minute (measured: 7 minutes hidden
    = 5 seconds). Now it keeps time by the wall clock (`phaseEndAt`,
    `advanceTo` crediting focus time in whole seconds with a carry; each
    new phase starts where the last ended), ticks every 250ms, and
    `backgroundThrottling: false` keeps phase ends on time.
    `powerMonitor` 'suspend' pauses it (it stays paused, per the user);
    a gap of more than 3 minutes between ticks is treated as a missed
    suspend: not credited, and paused. settings.json is now written to a
    temp file and renamed, like records.json.
  - Focused text, number and select fields drop the browser focus ring
    (orange on Windows, drawn outside the box and clipped by the
    scrolling panel) for a brighter border. Select options get a dark
    background and light text: the native popup's white background hid
    the inherited white text of unselected items.
- Next: nothing queued; ask before adding more.

## Permanently excluded scope

- No macOS/Linux packaging unless explicitly requested — Windows installer
  is the only committed target for now.
- No cloud sync, accounts, or analytics of any kind.
- No auto-update mechanism (would require a hosted update feed / signing
  infrastructure not currently owned).
