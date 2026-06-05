# survey-011

음성 입력 기반 현장 측정 기록 PWA. 이어폰을 끼고 양손이 자유롭지 않은 상태에서
TTS 안내와 음성 인식만으로 측정값을 Google Sheets에 기록합니다.

## 📱 접속 링크 (바로 사용)

> **👉 https://mingoojejuagrikang-crypto.github.io/survey-011/**
>
> - 스마트폰 **Chrome**으로 위 주소에 접속하세요.
> - 메뉴 → **홈 화면에 추가**를 누르면 앱처럼 설치됩니다.
> - **현재 버전: v0.4.0**

> 🛠️ **개발자/AI**: 작업 전 [`KNOWN-ISSUES.md`](./KNOWN-ISSUES.md)(알려진 함정·과거 버그 교훈)를 먼저 읽고, 새 오류를 만나면 거기에 추가해 주세요.

## 변경 내역 (Changelog)

> 최근 변경이 맨 위입니다. 어떤 점이 바뀌었는지 쉬운 말로 정리합니다.

- **v0.4.0** (2026-06-05) — 데이터 보호와 음성 입력 사용성을 크게 개선했습니다.
  - **세션이 사라져 보이는 문제를 고쳤습니다.** 앱 업데이트 등으로 목록을 못 불러오면 "데이터 없음" 대신 **"불러오지 못했습니다 · 다시 시도"** 안내가 뜹니다(기록은 그대로 보관되어 있습니다).
  - **일시정지 중 화면(탭)을 옮겼다 돌아와도 기록이 안전합니다.** 이어서 종료해도 빈 기록으로 저장되지 않습니다.
  - **음성 명령을 기능당 한 단어로 통일**했습니다(수정 / 스킵 / 일시정지 / 재시작 / 종료 / 취소 / 다시). 입력 화면의 **"？명령어"** 버튼으로 전체 목록을 볼 수 있습니다.
  - **행을 오갈 수 있습니다.** 화면의 **◀이전행 / 다음행▶ 버튼**이나 음성 **"이전행" / "다음행"**으로 앞뒤 행을 검토·수정합니다.
  - **인식한 값이 화면 중앙에 "항목 : 값" 형태로 크게** 표시됩니다.
- **v0.3.0** (2026-06-04) — 실기기 테스트 로그 분석을 반영한 음성 인식 정확도·기록 안정성 개선입니다.
  - **잘못 들은 값을 조용히 저장하지 않습니다.** 한 칸에 숫자가 두 덩이로 섞여 들리면(예: "105시 5.5") 그냥 저장하지 않고 다시 묻습니다.
  - **시끄러운 곳에서 명령 오작동을 줄였습니다.** "수정"·"정정" 같은 명령은 또렷하게 인식됐을 때만 실행됩니다.
  - **헷갈리는 한 글자(예: "이")를 함부로 숫자로 바꾸지 않고 다시 확인**합니다.
  - **정정할 때 이전 음성을 지우지 않고 보관**합니다. "수정" 선언과 매 시도의 음성이 모두 남아, 다음 분석에서 무엇을 말했는지 정확히 확인할 수 있습니다.
  - (내부) 현장 사용 분석을 위한 기록(세션 정보·사용 마이크·정정 직전 값)을 보강했습니다.
- **v0.1.0** (2026-06-04) — 첫 버전. 기존 `growth-survey-010` 앱을 독립 복제해 새 프로젝트로 시작했습니다.

> `growth-survey-010`을 독립 복제한 후속 라인. 원본과 분리되어 독자적으로 진행합니다.
> 팀 지침의 단일 진실원천(SSOT)은 myPKA 루트 `AGENTS.md`입니다 — `CLAUDE.md` 참조.

## 기능

- **설정**: Google OAuth 로그인 → 스프레드시트 URL 붙여넣기 → 컬럼 자동 분석 → 데이터형/입력방식 설정 → 오늘 테이블 생성
- **입력**: 항상 켜진 마이크 + TTS 안내 + 자동 행 진행 + Wake Lock (화면 꺼짐 방지)
- **데이터**: IndexedDB 영속화 + Google Sheets 자동 동기화 + CSV 내보내기

## 음성 명령

> v0.4.0부터 **기능당 한 단어**로 통일했습니다. 입력 화면의 **"？명령어"** 버튼으로 전체 목록을 볼 수 있습니다.

| 키워드 | 동작 |
|--------|------|
| 숫자 | 현재 항목에 입력 (한글 수사·아라비아 모두 지원) |
| `수정` (+ 값) | 직전 입력 값 수정 (`178.1 수정`처럼 값 뒤에 붙여도 됨) |
| `다시` | 현재 항목 재입력 (`다시 8.4`처럼 값 동반 가능) |
| `취소` | 현재 인식값 삭제 후 재입력 대기 |
| `스킵` | 현재 행 건너뛰기 |
| `이전행` / `다음행` | 이전·다음 행으로 이동(검토·수정 후 복귀) |
| `일시정지` / `재시작` | 입력 멈춤 / 재개 |
| `종료` | 세션 종료 |

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
