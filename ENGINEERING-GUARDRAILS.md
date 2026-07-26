# ENGINEERING-GUARDRAILS — 다시 어기면 안 되는 계약

> **이 문서는 "해결된 문제"가 아니라 "계속 지켜야 하는 규칙"이다.**
>
> 여기 있는 항목은 전부 **실제로 터졌고, 고쳐졌고, 다시 어기면 같은 방식으로 다시 터진다.**
> [KNOWN-ISSUES.md](./KNOWN-ISSUES.md)(지금 열려 있는 문제)와 분리한 이유가 그것이다 —
> 해결됐다는 이유로 아카이브에 묻으면, 다음 사람이 같은 함정을 다시 판다.
>
> **읽는 법:** 전체를 매번 컨텍스트에 넣지 말고, 지금 만지는 영역의 절만 읽어라.
> 코드를 쓰기 **전에** 훑는 것이 이 문서의 용도다.

## 상태 모델 (4상태)

이 프로젝트의 이슈 문서 전체가 쓰는 상태 값이다.

| 상태 | 뜻 | 사는 곳 |
|------|-----|---------|
| `OPEN` | 지금 재현되는 문제 | [KNOWN-ISSUES.md](./KNOWN-ISSUES.md) |
| `MONITORING` | 수정했지만 **실기기 판정 대기** | [KNOWN-ISSUES.md](./KNOWN-ISSUES.md) |
| `GUARDRAIL` | 해결됐지만 다시 어기면 안 되는 계약 | **이 문서** |
| `RESOLVED` | 종결·아카이브 | [KNOWN-ISSUES-ARCHIVE.md](./KNOWN-ISSUES-ARCHIVE.md) |

`MONITORING`을 `RESOLVED`로 올리는 유일한 근거는 **실기기 확인**이다. 데스크톱 테스트 통과는
`MONITORING` 유지 사유이지 종결 사유가 아니다 ([AGENTS.md](./AGENTS.md) 계약 4).

---

## ① 실패를 숨기지 않는다

### [REVIEW-1] 빈 catch가 근본 버그를 수개월 가렸다
- **규칙:** **모든 영속화/네트워크 실패는 로깅한다.** "에러 없음"은 "성공"이 아니다.
  진단 계측(breadcrumb)을 먼저 깔고 실기기 로그로 근본 원인을 확정하라.
- **사건:** 빈 `catch{}`가 iOS 클립 저장 실패를 삼켜 "에러 0건"으로 보이게 했다. 근본 원인
  확정까지 수개월이 걸렸다. 아카이브의 `[CLIP-IDB-1]`(구 `[CLIP-1]`)의 핵심.
- **출처:** `growth-survey-010@c8dd276`, `@fd3177a`
- **관련 원칙:** [PRINCIPLES.md](./PRINCIPLES.md) §1 (durable 실패를 삼키지 않는다), §4 (텔레메트리)

### [REVIEW-4] 진행 멈춤(silent return)은 reprompt로 — 무음 return 금지
- **규칙:** 거부 경로가 **silent return**하면 음성 세션이 그냥 멈춰 사용자가 영문을 모른다.
  거부 시 **reprompt**(다시 안내)로 흐름을 살려라.
- **사건:** `stt_rejected_col_name` 등 거부 경로의 무음 return.
- **출처:** `growth-survey-010@7dd6e8b`(입력-A)
- **당시 상태:** 조상 레포에서 확인·수정. **현재 상태:** survey-011 전체 거부 경로에 대한
  일괄 점검은 아직 수행되지 않았다 — 거부 경로를 새로 추가할 때 이 규칙을 적용하라.

---

## ② 안전 게이트와 파괴적 경로

### [REVIEW-2] adversarial review는 데이터 유실을 잡는다 — 여러 회차 돌려라
- **규칙:** 한 번의 리뷰로 끝내지 마라. 특히 **삭제·업로드·정정 경로**는 반복 검증한다.
- **사건:** Codex adversarial review가 조상 v5.2에서만 **3~5차**에 걸쳐 CRITICAL/HIGH
  데이터 유실·유출을 연속 발견했다(autoDelete 미업로드 삭제, 미동의 데이터 유출, dispose race,
  recorder 오염, partial sync 백업 누락).
- **출처:** `growth-survey-010@a36b4da, @55bb61e, @e207513, @a5950f0, @9a9c004, @8ce8dca, @79cbf2c`(Ultrareview), `@dae3e2f`(gpt-5.5)

### [REVIEW-3] "best-effort"라는 말이 게이트를 같은 날 두 번 뒤집게 했다
- **규칙:** **삭제의 cascade 범위를 먼저 확인**하고, 안전 게이트를 제거하는 변경은 특히 의심하라.
  리뷰 판단 한 줄("백업은 best-effort")을 근거로 게이트를 걷어내지 않는다.
- **사건:** 게이트를 제거했다가 cascade 삭제의 실제 blast radius 때문에 **같은 날 도로 복원**했다.
  아카이브 `[AUTH-1]`의 핵심.
- **출처:** `growth-survey-010@55bb61e → @ad60ba5 → @222f337`

---

## ③ 문구·값의 조립부는 하나여야 한다

### [UI-ALERT-1] 같은 문구를 두 곳에서 조립하면 "글자까지 동일" 계약은 반드시 깨진다
- **규칙:** **"두 곳에서 같은 문자열을 만든다"가 보이면 그 자체가 결함이다.** 주석으로 계약을
  선언하지 말고 **조립부를 하나로 만들어 물리적으로 불가능하게** 하라. 그리고 계약 위반을 발견한
  테스트가 단언을 느슨하게 바꾸고 있다면, 그건 테스트 수정이 아니라 **결함 승인**이다.
- **사건:** 경보 문구의 시각·청각 일치 계약([PRINCIPLES.md](./PRINCIPLES.md) §2)이 콜론만큼
  어긋나 있었다 — 화면 `범위 알람 : +20%` / TTS·텔레메트리 `범위 알람 +20%`. 화면을 안 보고
  귀로만 듣는 현장에서 "들리는 말"과 "보이는 글"이 달라진다.
- **왜 놓쳤나(핵심):** `AnomalyAlertPopup.tsx`가 **"이 라벨은 alertText와 글자까지 동일해야
  한다"는 주석을 달아놓고, 바로 그 아래에서 문구를 따로 조립**하고 있었다. 계약을 아는 코드가
  계약을 깼다. 더 나쁜 건 회귀 테스트가 이를 잡는 대신 *"문장부호 차이 — 단어는 동일"* 이라는
  주석으로 **위반을 정당화해 고정**한 것이다.
- **수정(v0.39.0):** 조립부를 `src/lib/anomalyAlert.ts`의 `anomalyAlarmLabel()` **하나로 통합**.
  팝업은 같은 페이로드로 그 함수를 호출해 **렌더만** 한다. 콜론만 맞추는 수정은 거부했다 — 두
  조립부가 남아 있는 한 다음 변경에서 또 어긋난다. 화면 == TTS == 로그 `text=` **동등성을 직접
  단언**하는 테스트를 추가했고, SSOT 호출을 옛 자체조립으로 되돌리는 **반증 4건 실패**로
  안전망을 확인했다.
- **⚠️ 텔레메트리 바이트가 바뀌었다:** `trend_alert_fired`의 `text=` 값에 ` : `가 들어간다
  (민구 결정). v0.39.0 **이전 로그와 문자열이 불연속**이므로 과거 로그를 문자열로 매칭하는
  분석은 컷오버를 감안해야 한다. SOP-003 매핑표에는 이 이벤트·필드가 없어 파서는 무영향(확인 완료).
- **출처:** survey-011 v0.39.0, 2026-07-25 (F3 리뷰 라운드 `f3-ui` Codex 지적 #1 — agy Flash는
  오히려 이 변경을 "계약을 바르게 반영한 것"으로 승인했다. **합집합 판정이 아니었으면 통째로
  놓쳤다**).
- **당시 상태:** ✅수정 + 반증 4건 확인. **현재 상태:** v0.39.0 배포 포함.
  **실기기 상태:** ⚠️미확인 — TTS가 `:`를 어떻게 발음/멈춤 처리하는지는 기기 게이트.

### [REVIEW-5] 날짜 컬럼 '오늘' sentinel을 type=date 입력이 덮어쓴다
- **규칙:** `col.auto.value === '오늘'`인 **동적 날짜 sentinel**을 `type=date` 입력에 물리지
  마라. `value !== '오늘'`일 때만 `type=date`를 쓴다.
- **사건:** `type=date`가 sentinel을 표시·편집하지 못해 빈 상태가 되고, 사용자가 날짜를 고르면
  ISO 리터럴로 덮어써 **동적성이 사라졌다.**
- **출처:** `growth-survey-010@2eea438`
- **당시 상태:** 조상 레포에서 확인·수정. **현재 상태:** survey-011의 날짜 컬럼 설정 경로에
  대한 직접 점검은 아직 수행되지 않았다 — 날짜 컬럼 UI를 건드리면 이 규칙을 먼저 확인하라.

---

## ④ 가시성·레이아웃 판정

### [UI-GLOW-1] `position:fixed`에 `offsetParent === null` 가시성 판정을 쓰면 상시 오탐
- **규칙:** 가시성 판정에 `offsetParent`를 쓰는 코드는 **대상이 fixed로 바뀌는 순간 조용히
  망가진다.** `el.getClientRects().length === 0`을 써라 — `display:none`(또는 조상 none)이면
  박스가 생성되지 않아 0개, **보이는 fixed면 1개 이상**이라 두 경우를 정확히 가른다.
  비용은 동일한 레이아웃 읽기 1회다.
- **더 넓은 규칙:** 레이아웃 방식 변경(absolute→fixed)은 **원격에 있는 판정 로직을 함께
  깨뜨릴 수 있다.** 포지셔닝을 바꿀 때 그 엘리먼트를 관찰하는 코드를 같이 찾아라.
- **사건:** 목소리에 반응하는 테두리 글로우(`EdgeGlow`)가 **0.5초 살고 0.5초 죽는** 주기로
  끊겼다. `useAudioLevelVar`가 keep-alive `display:none`(탭 이탈)을 감지하려고 30프레임마다
  `el.offsetParent === null`을 봤는데, **HTML 스펙상 `position:fixed`는 보이는 상태에서도
  `offsetParent`가 항상 null**이다. v0.37.0에서 `EdgeGlow`를 full-bleed(`position:fixed`)로
  바꾸면서 판정이 상시 오탐이 됐다 → 30프레임마다 `--voice-level`을 0으로 쓰고 500ms 정지.
- **놓친 경위:** e2e `v034-wave-glow` B7·B8 2건이 v0.38.0에서 **이미 실패 중이었고 그 상태로
  릴리스됐다.**
- **수정(v0.38.1):** `getClientRects()` 판정으로 교체. 회귀 `v034-wave-glow` 21/21 통과.
- **출처:** survey-011 v0.38.1, 2026-07-24
- **현재 상태:** v0.38.1 포함, 회귀 통과.

---

## ⑤ 오디오 클립 트림

두 항목 모두 `src/lib/audioTrim.ts`의 같은 검출부를 건드린다. **여기를 수정하려면 둘 다 읽어라.**

### [CLIP-MIDSPEECH-1] 트림이 발화 *중간*을 잘라 이어붙이면 사람이 값을 못 알아듣는다
- **규칙:** `buildKeptRanges`는 **모든 세그먼트를 감싸는 단일 포괄 범위**를 반환한다
  (`[max(0,min(start)−PAD_FRONT), min(len,max(end)+PAD_BACK)]`). 세그먼트 사이를 이어붙이는
  `concatRanges` 경로로 되돌리지 마라 — **발화 중간의 자연스러운 멈춤(선언↔값, 호흡)이 잘린다.**
- **사각지대 교훈:** STT 재인식은 갭 제거에 강건해서 **자동 하니스가 이 결함을 통과시켰다.**
  사람 청취 품질은 기계 재인식으로 대체 검증되지 않는다.
- **사건(v0.20.0 실기기 2세션, 2026-06-25):** 민구 "인식값은 정상인데 음성클립을 들으면 값을
  알 수 없음." 코드 시뮬 + raw 클립 72개 분석: `concatRanges`가 세그먼트 사이 150ms↑ 무음을
  "긴 공백"으로 보고 제거 → **72클립 중 15개(21%)에서 발화 중간을 splice**.
- **영향:** 데이터 무결성 무관(라이브 STT 정답, CSV 일치). 클립 감사·재청취 품질 문제.
- **수정(v0.21.0):** 단일 포괄 범위로 통합 → splice 0, 중간 무음 보존, 앞 침묵/TTS·뒤 EOS
  꼬리 가장자리 트림만 유지. `concatRanges`/`findSpeechSegments`는 휴면 폴백으로 잔존.
  KEEP_RATIO·MIN_KEPT_MS 가드 불변. 회귀 `tests/audioTrim.spec.ts`.
- **출처:** `2026-06-25 v0.20.0 2세션 분석` → survey-011 v0.21.0
- **현재 상태:** v0.21.0 포함. **실기기 상태:** ✅확인됨 — [CLIP-BLANK-2]의 v0.24.0 실기기
  측정에서 값 잘림 회귀 0건으로 함께 확인됐다.
- **연관:** [CLIP-9](decode-fail 계측)·[CLIP-10](첫값 truncation, 별개 메커니즘) — 둘 다
  [KNOWN-ISSUES.md](./KNOWN-ISSUES.md).

### [CLIP-BLANK-2] 약한 초반 세그먼트 하나가 트림 시작을 값 발화보다 한참 앞으로 끌어당긴다
- **규칙:** `findSpeechSegments`의 **약한 세그먼트 솎기**(`SEG_KEEP_RATIO = 0.25`)를 제거하지
  마라. 세그먼트별 내부 최대 RMS를 추적해, 가장 강한 세그먼트 대비 25% 미만의 약한 세그먼트를
  버린다(2개 이상일 때만, 전부 약하면 원본 유지). **0.25는 287클립 스윕으로 결정된 값**이다 —
  0.3 이상은 값 잘림을 6건 이상 유발했다.
- **사건(v0.23.0 실기기, 2026-06-29):** "일부 클립 전단에 공백이 너무 길다." 8개 세션 **287
  클립** 정량 분석: **51/287(18%)** 가 앞에 0.6s↑ 공백, 최악 **10.8s**.
- **원인:** `thr = robustPeak(97pct) * 0.08`이 **조용한/노이즈 클립에서 노이즈 수준으로 붕괴**
  (예 peak 0.023) → 초반 잡음·TTS 잔향이 약한 세그먼트로 검출되고, `buildKeptRanges`가
  `min(seg.start)`로 앵커하므로 트림 시작이 앞으로 끌려갔다.
- **수정(v0.24.0):** 약한 세그먼트 솎기 도입. 효과: 앞 공백 사례 **63→16건, 값 잘림 0건**.
  회귀는 별도 하네스 `clip-regression`이 실제 `audioTrim`에 누적 raw 클립을 돌려 RED→GREEN·
  known-good 비퇴행을 고정한다.
- **출처:** `2026-06-29 v0.23.0 실기기 제보` + 287클립 분석 → survey-011 v0.24.0
- **현재 상태:** v0.24.0 포함.
  **실기기 상태:** ✅**확인됨(2026-06-30 v0.24.0 2세션 측정)** — 값클립 71개 silencedetect
  결과 앞공백 **max 0.31/0.32s, 0/71 ≥ 0.6s**(v0.21+ 18%·최악 10.8s 대비 소멸), 잔여 ~0.30s는
  의도한 `PAD_FRONT`. **값 잘림 회귀 0**(`clip_trim_failed` 0/0).

---

## ⑥ 테스트 계약

### [TEST-UI-1] 테스트는 시각 장식이 아니라 `data-testid` 계약에 붙인다
- **규칙:** UI 상태에는 **안정적인 테스트 계약**을 둔다. 활성 화면 `data-testid="voice-active-state"`,
  활성 행 `data-testid="active-row"`, 칩 `data-testid="column-chip"` + `data-active="true"` +
  `data-col-name="<컬럼명>"`, 칩 구역 `data-testid="voice-chip-grid"`.
  **`REC` 텍스트·`▶` 아이콘 같은 임시 시각 표현에 결합하지 마라.**
- **레이아웃 스펙에도 적용:** 요소 **탐색**은 반드시 testid 계약으로 하고, **계산 스타일은
  단언(assert) 대상으로만** 쓴다.
- **사건 1(v0.31.0):** 입력탭 UI 정리로 `REC`·`▶`를 제거하자, `document.querySelectorAll('span')`
  에서 `▶`를 찾아 활성 칩을 판별하던 helper가 깨졌다. `v54-30rows` 장기 테스트가 행마다 3초씩
  누적 대기해 3분 타임아웃.
- **사건 2(재발 변형, 2026-07-20 v0.36.0):** `v019-active-layout`/`v020-dials-layout`이 칩 구역을
  셀렉터가 아니라 **계산 스타일 탐색**(`display:grid && overflowY:auto`인 div 검색)으로 잡고
  있었다. 칩 구역이 grid → flex-wrap pill 플로우로 바뀌자 탐색이 null을 반환하며 실패.
  두 스펙 모두 `data-testid="voice-chip-grid"`로 교체해 해결.
- **출처:** `2026-07-08 v0.31.0 입력탭 UI 재정리`(커밋 `bbf6a1e`), `2026-07-20 v0.36.0 재작업`
- **현재 상태:** 수정 완료. **새 입력탭 테스트를 작성할 때마다 계속 준수해야 한다.**

### [ENV-4] 문서의 테스트 명령은 package scripts를 가리킨다
- **규칙:** 개발 문서는 **내부 파일을 직접 실행하는 명령을 박아두지 않는다.** 실행 방법의
  SSOT는 `package.json`의 npm scripts다(`npm run test:e2e`, `npm run lint`, `npm run build`,
  `npm run predeploy`). 그래야 실행 방식이 바뀔 때 문서를 여러 곳에서 고치지 않는다.
- **사건:** 문서는 `npx tsx scripts/test-*.mjs`를 안내했는데 실제 회귀는 Playwright였다.
  두 수동 스크립트는 이미 제거된 옛 명령 별칭(`정정`·`스톱` 등)을 계속 검사하고 있어 **현재
  정책과도 충돌**했고, 파일 주석은 `node scripts/...`, README는 `npx tsx`로 서로 달랐다.
- **수정(v0.39.0 문서 정리):** `scripts/test-koreanNum.mjs`·`scripts/test-autoValue.mjs` 삭제
  (`tests/koreanNum.spec.ts`·`tests/autoValue.spec.ts`가 완전 대체). 문서의 테스트 절차는
  [CONTRIBUTING.md](./CONTRIBUTING.md)로 단일화. `scripts/test-sheets-url.mjs`는 대체 스펙이
  없어 존치한다.
- **출처:** `2026-06-04~05 세션` → 정리 `2026-07-26`
- **현재 상태:** 해소. 새 개발 문서를 쓸 때 이 규칙을 유지하라.

---

## 참고

- 앱 고유 설계 원칙: [PRINCIPLES.md](./PRINCIPLES.md)
- 지금 열려 있는 문제: [KNOWN-ISSUES.md](./KNOWN-ISSUES.md)
- 종결된 사건 기록(역사): [KNOWN-ISSUES-ARCHIVE.md](./KNOWN-ISSUES-ARCHIVE.md)
- 개발·테스트·릴리스 절차: [CONTRIBUTING.md](./CONTRIBUTING.md)
