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
  fullscreen toggle, corner-snap to a chosen monitor, native OS notification
  on phase change, system tray icon with minimize-to-tray, settings
  persisted to disk between launches.
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
  (timer state machine, settings panel, corner-snap controls), `cosmos.js`
  (a `<canvas>` background animation — stars, rotating rays and a spiral
  particle field whose already-elapsed portion desaturates to grayscale as
  the current work/break phase progresses; driven by `renderer.js` calling
  `window.setCosmosProgress(fraction)` each tick). No framework; vanilla DOM.
- `package.json` — `electron-builder` config targets `nsis` (installer) and
  `portable` for `win`/`x64`.
- Build/run this repo can verify directly: `npm install`, syntax/lint of the
  JS. Producing and running the actual Windows `.exe` requires Windows (or
  Wine) and is out of reach of this Linux container — see
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
- Restyled onto a dark/pink-red palette (CSS custom properties), then added
  a continuously-animated canvas background (`renderer/cosmos.js`): stars,
  slowly rotating light rays, and a spiral particle field that reads as
  gold for the remaining (future) portion of the current phase and fades
  to grayscale for the already-elapsed (past) portion — the motion itself
  never stops, independent of pause state.
- Next: sound on phase change, as a separate slice, if requested.

## Permanently excluded scope

- No macOS/Linux packaging unless explicitly requested — Windows installer
  is the only committed target for now.
- No cloud sync, accounts, or analytics of any kind.
- No auto-update mechanism (would require a hosted update feed / signing
  infrastructure not currently owned).
