@echo off
cd /d "%~dp0"
echo ================================
echo  Pomodoro Timer - Windows Build
echo ================================
echo.
echo [1/2] Installing dependencies (npm install)...
call npm install
if errorlevel 1 (
  echo.
  echo npm install failed. Node.js가 설치되어 있는지 확인하세요: https://nodejs.org
  pause
  exit /b 1
)

echo.
echo [2/2] Building installer (electron-builder)...
call npm run dist
if errorlevel 1 (
  echo.
  echo Build failed. 위 오류 메시지를 확인하세요.
  pause
  exit /b 1
)

echo.
echo 완료! dist 폴더에서 설치 파일(.exe)을 확인하세요.
pause
