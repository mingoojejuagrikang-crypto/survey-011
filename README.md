# survey-011

음성 입력 기반 현장 측정 기록 PWA. 이어폰을 끼고 양손이 자유롭지 않은 상태에서
TTS 안내와 음성 인식만으로 측정값을 Google Sheets에 기록합니다.

## 📱 접속 링크 (바로 사용)

> **👉 https://mingoojejuagrikang-crypto.github.io/survey-011/**
>
> - 스마트폰 **Chrome**으로 위 주소에 접속하세요.
> - 메뉴 → **홈 화면에 추가**를 누르면 앱처럼 설치됩니다.
> - **현재 버전: v0.2.0**

## 변경 내역 (Changelog)

> 최근 변경이 맨 위입니다. 어떤 점이 바뀌었는지 쉬운 말로 정리합니다.

- **v0.2.0** (2026-06-04) — 음성으로 값을 말하면, 인식된 값이 **큰 글씨 배지로 화면에 퍽 떠올랐다 사라지도록** 강조 효과를 키웠습니다. 무엇이 입력됐는지 한눈에 확인하기 쉬워졌습니다.
- **v0.1.0** (2026-06-04) — 첫 버전. 기존 `growth-survey-010` 앱을 독립 복제해 새 프로젝트로 시작했습니다.

> `growth-survey-010`을 독립 복제한 후속 라인. 원본과 분리되어 독자적으로 진행합니다.
> 팀 지침의 단일 진실원천(SSOT)은 myPKA 루트 `AGENTS.md`입니다 — `CLAUDE.md` 참조.

## 기능

- **설정**: Google OAuth 로그인 → 스프레드시트 URL 붙여넣기 → 컬럼 자동 분석 → 데이터형/입력방식 설정 → 오늘 테이블 생성
- **입력**: 항상 켜진 마이크 + TTS 안내 + 자동 행 진행 + Wake Lock (화면 꺼짐 방지)
- **데이터**: IndexedDB 영속화 + Google Sheets 자동 동기화 + CSV 내보내기

## 음성 명령

| 키워드 | 동작 |
|--------|------|
| 숫자 | 현재 항목에 입력 (한글 수사·아라비아 모두 지원) |
| `수정` 또는 `정정` + 값 | 직전 입력 값 수정 후 다음 항목 진행 |
| `다시`, `재입력` | 현재 항목 재입력 |
| `취소`, `지우기` | 현재 인식값 삭제 후 재입력 대기 |
| `종료`, `끝`, `스톱` | 세션 종료 |

한국어 수사 예시: `삼십오 점 일` → `35.1`, `일점오` → `1.5`, `이천이십육` → `2026`

## 개발

```bash
npm install
cp .env.example .env.local        # VITE_GOOGLE_CLIENT_ID 설정
npm run dev                       # http://localhost:5173
npm run build                     # 프로덕션 빌드
npm run deploy                    # GitHub Pages 배포
```

## 테스트

```bash
npx tsx scripts/test-koreanNum.mjs     # 한글 수사 파서 27 케이스
npx tsx scripts/test-autoValue.mjs     # 테이블 생성 로직 7 케이스
npx playwright test --reporter=list    # E2E
```

## Google Cloud Console 설정

1. `ai-agent-team-493400` 프로젝트 선택 → `API 및 서비스` → `사용자 인증 정보`
2. `OAuth 2.0 클라이언트 ID 만들기` → 애플리케이션 유형: **웹 애플리케이션**
3. 승인된 JavaScript 원본:
   - `http://localhost:5173`
   - `https://mingoojejuagrikang-crypto.github.io` (survey-011 배포 시)
4. `Google Sheets API` 활성화 (`API 라이브러리` → 검색)
5. 발급된 Client ID를 `.env.local`의 `VITE_GOOGLE_CLIENT_ID`에 저장

> ⚠️ survey-011을 GitHub Pages에 새로 배포하면 그 origin이 위 승인 목록에 포함되어 있어야
> OAuth가 동작합니다. 새 repo 경로(`.../survey-011/`)는 도메인 단위(`...github.io`)로 이미 커버됩니다.

## 사용법

1. 스마트폰 Chrome에서 배포 URL 접속
2. 홈 화면에 추가 (PWA 설치)
3. 설정 탭 → Google 로그인 → 스프레드시트 URL 붙여넣기
4. 컬럼 카드에서 각 항목의 데이터형/입력방식 조정
5. `오늘 테이블 생성` 클릭
6. 입력 탭 → 이어폰 착용 → `음성 입력 시작`
7. TTS 안내 → 값 음성 입력 → 자동 진행

## 디렉토리

```
src/
├── tokens.ts             # 디자인 토큰 (색상, 폰트)
├── types.ts              # Column, Session 등 타입
├── App.tsx               # 탭 라우팅 + 디바이스 프레임
├── components/           # TabBar, MicWave, Chip, Icons
├── screens/              # SettingsScreen, VoiceScreen, DataScreen
├── stores/               # Zustand (settings / session / data)
├── lib/
│   ├── koreanNum.ts      # 한글 수사 → 숫자 파서
│   ├── speech.ts         # SpeechController + TTS
│   ├── useVoiceSession.ts# 세션 오케스트레이션
│   ├── googleAuth.ts     # GIS OAuth
│   ├── sheets.ts         # Sheets API
│   ├── db.ts             # IndexedDB
│   ├── sync.ts           # 동기화 워크플로우
│   ├── csv.ts            # CSV 내보내기
│   ├── autoValue.ts      # 순차 증가 + 중첩 카르테시안
│   └── wakeLock.ts       # 화면 잠금 방지
└── styles/global.css     # @keyframes + 폰트
```
