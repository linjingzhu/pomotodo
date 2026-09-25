# Pomodoro Timer (뽀모도로 타이머)

설치형 Windows 앱. Electron(웹 기술로 데스크톱 앱을 만드는 프레임워크) 기반.

## 빌드 방법 (최초 1회, 인터넷 필요)

1. `build.bat` 더블클릭
   - 또는 터미널에서: `npm install` → `npm run dist`
2. 완료되면 `dist` 폴더에 다음 파일이 생성됩니다:
   - `PomodoroTimer-Setup-1.0.0.exe` — 설치형 인스톨러 (Program Files에 설치, 시작 메뉴/바탕화면 바로가기 생성, 제어판에서 제거 가능)
   - `PomodoroTimer-Portable-1.0.0.exe` — 설치 없이 바로 실행하는 포터블 버전

Node.js가 없다면 https://nodejs.org (LTS 버전) 설치 후 진행하세요.

## 개발 중 실행 (빌드 없이 바로 테스트)

```
npm install
npm start
```

## 구현된 기능

- 작업/쉬는 시간 설정 (기본 25분 / 5분), 변경 즉시 저장
- 항상 위 표시 (always on top)
- 전체화면 ↔ 창 모드 전환
- 창 기본 크기: 작게 (260×200), 설정 패널은 톱니바퀴(⚙) 버튼으로 펼침
- 모니터 선택 후 좌상/우상/좌하/우하 4개 모서리로 창 붙이기
- 타이머 종료 시 Windows 알림, 작업↔휴식 자동 전환
- 시스템 트레이 아이콘 (좌클릭: 창 보이기/숨기기, 우클릭: 열기/종료 메뉴)
- 최소화 시 트레이로 보내기 (설정에서 끄고 켤 수 있음, 기본 켜짐)
- 닫기(X) 시 트레이로 보내고 종료하지 않기 (설정에서 끄고 켤 수 있음, 기본 꺼짐)
- 배경에 계속 움직이는 우주(별/광선/나선) 애니메이션 — 남은 시간(미래)은 골드,
  이미 지난 시간(과거)은 회색조로 표시되어 진행 상태를 시각적으로 보여줌
- 마지막 설정(작업/휴식 시간, 항상 위 여부, 트레이 관련 옵션, 창 크기)은
  다음 실행 시에도 유지

## 파일 구조

```
pomotodo/
  main.js         메인 프로세스 (창 생성, 모니터/알림 등 OS 연동)
  preload.js      렌더러에 안전하게 API 노출
  renderer/       화면(UI) — index.html, style.css, renderer.js
  package.json    electron-builder 빌드 설정 포함
  docs/OWNER_ACTIONS.md   사용자(오너)만 할 수 있는 작업 목록 (Windows 빌드 등)
```

## 개발 방법론

이 저장소는 `.ai/` 아래의 AI 엔지니어링 정책 세트로 운영됩니다. 자세한 내용은
`.ai/PROJECT_CONTEXT.md`를 참고하세요.
