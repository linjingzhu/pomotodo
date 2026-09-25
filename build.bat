@echo off
chcp 65001 > nul
cd /d "%~dp0"
echo ================================
echo  Pomodoro Timer - Windows Build
echo ================================
echo.
echo [1/2] Installing dependencies (npm install)...
call npm install
if errorlevel 1 (
  echo.
  echo npm install failed. Please check that Node.js is installed: https://nodejs.org
  pause
  exit /b 1
)

echo.
echo [2/2] Building installer (electron-builder)...
call npm run dist > build.log 2>&1
type build.log
if errorlevel 1 (
  echo.
  echo ================================
  echo  Build failed. See build.log in this folder for the full output.
  echo ================================
  echo.
  echo  Most common cause on Windows: Developer Mode is off, so
  echo  electron-builder cannot create a symlink it needs internally
  echo  (look for "symbolic link" or "privilege" in build.log).
  echo  Fix: Settings -^> Privacy ^& security -^> For developers -^>
  echo  turn on "Developer Mode" (or right-click build.bat and choose
  echo  "Run as administrator"), then try again.
  echo.
  echo  If it still fails, send the contents of build.log.
  pause
  exit /b 1
)

echo.
echo Done! Check the dist folder for the installer (.exe).
pause
