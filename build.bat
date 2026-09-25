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
  echo npm install failed. Node.js가 설치되어 있는지 확인하세요: https://nodejs.org
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
  echo  Build failed. 위 로그(이 폴더의 build.log)를 확인하세요.
  echo ================================
  echo.
  echo  자주 발생하는 원인: Windows "개발자 모드"가 꺼져 있으면 electron-builder가
  echo  내부적으로 필요한 심볼릭 링크를 만들지 못해 실패합니다 ^(로그에
  echo  "symbolic link" 또는 "privilege"라는 단어가 보이면 이 경우입니다^).
  echo  해결: 설정 -^> 개인 정보 및 보안 -^> 개발자용 -^> "개발자 모드" 켜기
  echo  ^(또는 build.bat를 마우스 오른쪽 클릭 -^> "관리자 권한으로 실행"^) 후
  echo  다시 시도해보세요.
  echo.
  echo  그래도 안 되면 build.log 내용을 그대로 복사해서 문의해주세요.
  pause
  exit /b 1
)

echo.
echo 완료! dist 폴더에서 설치 파일(.exe)을 확인하세요.
pause
