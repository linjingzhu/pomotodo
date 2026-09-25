# Owner Actions

Work only the repository owner can do. One row per item, with a stable id
and a status. Cited by id elsewhere; this file is the single source of
truth for status — do not restate it in reports.

| id | item | status |
|----|------|--------|
| OA-1 | Run `build.bat` (or `npm install && npm run dist`) on a Windows machine (or a Linux/macOS machine with Wine installed) to produce `PomodoroTimer-Setup-1.0.0.exe` and `PomodoroTimer-Portable-1.0.0.exe` in `dist/`. This container has no Windows/Wine, so the installer cannot be built or run here. | OPEN |
| OA-2 | Manually smoke-test the built installer and portable `.exe` on Windows: install, launch, start/pause/reset timer, toggle always-on-top, drag the window by its in-app titlebar (no native frame anymore) and confirm the in-app close (✕) button quits, snap to each corner on a real multi-monitor setup, confirm the Windows notification AND the chime both fire once on phase change, restart the app and confirm settings persisted, minimize the window and confirm it drops to the tray, click/right-click the tray icon and confirm show/hide and quit both work, enable "닫기(X) 시 트레이로 보내기" and confirm the close button hides instead of quitting while the tray menu's "종료" still quits, and confirm the ring around the timer digits smoothly depletes as time passes and resets full on phase switch. | OPEN |
| OA-3 | Decide on and provide a code-signing certificate if unsigned-binary SmartScreen warnings become a problem for distribution. | OPEN |
| OA-5 | On Windows, use the settings panel's "배경 이미지 선택..." to pick a real photo (the native file dialog can't be exercised from this headless container), confirm it fills the window cropped to the short side, then check the blur slider, tint color/strength, and key color picker all update live and persist after a restart — and confirm the glass panels (titlebar, timer card, settings) stay legible over a busy photo. | OPEN |
