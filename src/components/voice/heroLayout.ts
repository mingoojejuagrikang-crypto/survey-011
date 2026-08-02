/** v0.23.0 입력탭#1(중앙 흡수, Vance) — 중앙 흡수영역 카드들이 공유하는 레이아웃 헬퍼.
 *  VoiceHero(VoiceScreen)와 ModifyIndicatorPill(components/voice)이 같은 타이포 스케일을 쓰도록
 *  SSOT로 분리(순환 import 방지 — VoiceScreen이 컴포넌트를 import하므로 헬퍼는 별도 모듈). */

/** UI-a 타이포 하한과 scale=1 기준값. 최소 가독값은 미확정이라 현행값을 한 상수에 보존한다. */
export const HERO_MIN_FONT_PX = { name: 22, value: 26, interim: 24 } as const;
export const HERO_BASE_FONT_PX = { name: 34, value: 64, interim: 44 } as const;
export const COMPLETE_SUMMARY_MIN_FONT_PX = 24;
export const COMPLETE_SUMMARY_BASE_FONT_PX = 40;

/** 🔴 프로덕션 라벨 예약용 잠정 하한 — ui-standard §7-2의 민구 확정값이 오면 이 한 곳을 대체한다.
 *  ba87426 402px 실측 61.67px의 90%를 보존하며, 상한이 아니므로 fit은 더 커질 수 있다. */
export const HERO_LABEL_PROVISIONAL_RESERVE_PX = 55;

/** 회귀 대조용 실측 기준선. compact는 테스트 오라클 전용이며 fit 기제 입력이 아니다. */
export const HERO_LABEL_BASELINE_PX = {
  standard: HERO_LABEL_PROVISIONAL_RESERVE_PX,
  compact: 48,
} as const;
export const HERO_LABEL_RESERVE_SCALE =
  HERO_LABEL_PROVISIONAL_RESERVE_PX / HERO_BASE_FONT_PX.name;

/** ba87426 슬롯식 `max(72px, …)`의 첫 항을 보존한다. 당시 빈 슬롯 실측 높이는 72px가 아니라
 *  402에서 161px·375에서 142px였고 둘째 항이 이겼다. content-sizing에서는 긴 interim의 실제
 *  line box가 72px보다 작을 때 이 floor가 물려 값 변화의 중심 이동을 흡수한다. 폰트 목표/상한은 아니다. */
export const HERO_VALUE_SLOT_MIN_PX = 72;

/** fit 배율과 함께 열리는 hero 행간. ba87426의 clamp(8px,1.6vh,18px)(402에서 13.98px)를
 *  대체한다. vw/vh 제거로 기준이 8px가 되어 402에서 약 6px 좁아졌으며, 이 값을 SSOT로 둔다. */
export const HERO_GAP_PX = { min: 4, base: 8 } as const;

const fittedHeroType = (minPx: number, basePx: number, variable: string) =>
  `max(${minPx}px, calc(${basePx}px * var(${variable}, 1)))`;

/** v0.43.0 UI-a — hero 타이포 SSOT. 사람은 하한과 기준값만 정하고, 배정 영역이 실제 크기를 정한다.
 *  하드코딩 최대 px와 vw/vh 비례항은 없다. useFitGroup이 실제 렌더 폭·전체 높이로 scale을 찾는다.
 *  **항목명 크기는 모든 상태(listening/confirm/review/reask)에서 동일**해야 한다 — 민구 지적:
 *  "상태에 따라 식별이 불가할 만큼 작아지는 경우가 존재". 상태별 인라인 정의 금지, 여기 상수만 소비.
 *  그룹별 변수는 같은 계열 멤버가 한 배율을 공유하게 한다. */
export const HERO_TYPE = {
  name: fittedHeroType(HERO_MIN_FONT_PX.name, HERO_BASE_FONT_PX.name, '--fit-label'),
  value: fittedHeroType(HERO_MIN_FONT_PX.value, HERO_BASE_FONT_PX.value, '--fit-value'),
  interim: fittedHeroType(HERO_MIN_FONT_PX.interim, HERO_BASE_FONT_PX.interim, '--fit-value'),
} as const;

/** 칩 내부 타이포 SSOT. HERO_TYPE과 같은 뷰포트 양축 + fit 배율 계약을 따른다.
 *  값이 주인공인 위계는 유지하되, rounded rect가 회수한 세로 공간을 항목명 크기로 돌려준다. */
export const CHIP_TYPE = {
  // 항목명은 값 이하에서 최대한 키운다(민구 제보 #6). 양축 비례항과 50px 상한 모두 value보다
  // 작아서, 어떤 뷰포트에서도 2행 값의 시각 위계를 뒤집지 않는다(402×874: name 46.23 / value 52px).
  name: 'max(12px, calc(clamp(14px, min(11.5vw, 6.5vh), 50px) * var(--fit-lo, 1)))',
  inputValue: 'max(16px, calc(clamp(18px, min(10vw, 5.2vh), 42px) * var(--fit-hi, 1)))',
  value: 'max(18px, calc(clamp(22px, min(13vw, 6.5vh), 52px) * var(--fit-hi, 1)))',
} as const;

/** 입력화면 공간 배정 — 🔴 **칩존 20% / 중앙 50% / 하단 30%** (v0.43.0 UI-b).
 *  현행 SSOT는 `deliverables/2026-07-31-survey-011-v0430-ui-standard.md` §2다.
 *  (구 와이어프레임 `Deliverables/2026-07-24-…-active-screen-wireframe.md`의 25/50/25를 대체한다)
 *
 *  🔴 비율의 분모는 **ActiveState 자신의 높이에서 상단 행/진행 스트립을 뺀 나머지**다.
 *  구 와이어프레임 목업에서 칩존 격벽은 행/진행 스트립 **아래**에서 시작하고, 하단 nav
 *  (설정/입력/데이터/개선)는 하단 구역 안에 그려져 있지만 실제 nav는 App 레벨(TabBar)이라
 *  ActiveState 박스 밖이다. 테스트도 `window.innerHeight`가 아니라 이 박스 높이를 분모로 써야 한다.
 *  ---
 *  🔴 v0.43.0 UI-b — **20 / 50 / 30 으로 바꿨다** (ui-standard §2, 민구 확정).
 *  하단을 30%로 올리라는 지시에 대해 **중앙을 지키려고 칩존에서 5%p를 뺐다.** 칩은 한 행 +
 *  가로 스크롤이라 높이 손실을 흡수한다는 것이 근거이고, **그 근거가 T3 7회차 위험**이다
 *  (`v037-chip-2row`의 잘림 가드가 기계로 지킨다 · plan §7:809-811).
 *
 *  ⚠️ **UI-b가 한 일은 「하단 30% 확보」뿐이다.** ui-standard §2는 하단을 1행(도트·파형 20%)과
 *  2행(버튼 10%)으로 나누지만, 현재 `ActiveControlBar`는 `[‹][도트·파형][›]`가 **한 행에
 *  가로로** 놓인 구조(`voice-nav-row`, `flex-direction: row`)라 세로로 나눌 그릇이 없다.
 *  🔴 **버튼 높이는 안 건드렸다** — `EdgeButton`의 `min(100%, 56px)`이 그대로 살아 있고,
 *  그 `56px`은 규칙 2가 금지하는 하드코딩 상한이다.
 *  👉 **UI-e가 하단 2행 구조 전환과 `56px` 제거를 함께 처리해야 한다.** 지금 10%를 nav row에
 *  물리면 기준이 하단 트랙이 아니라 nav row가 되어 새 하드코딩만 는다. */
export const ACTIVE_ZONE_RATIOS = {
  base: { chip: 20, center: 50, bottom: 30 },
  /** 수정 입력 — 키패드가 4행이라 하단이 커진다(136px면 버튼 34px로 iOS 권장 44px 미달, 272px면 61px). */
  modify: { chip: 20, center: 30, bottom: 50 },
  /** 일시정지·저장 확인 — 하단 도트가 없으므로 **중앙이 회수한다.** */
  dotless: { chip: 20, center: 70, bottom: 10 },
} as const;

/** 🔴 배분 합이 100이어야 한다 — **모듈 로드 시 fail-fast.**
 *  `fr`은 **비율**이라 합이 110이어도 grid가 조용히 정규화해 렌더한다(20:60:30 → 18.2/54.5/27.3%).
 *  즉 잘못된 값이 화면을 바꾸면서 **아무 신호도 안 낸다.**
 *  ⚠️ 이 상수가 테스트 전용이던 동안엔 무해했으나, `ACTIVE_ZONE_ROWS` 생성 입력이 되면서
 *  **제품 위험이 됐다**(Codex 리뷰 2R 지적). UI-e가 `modify`/`dotless`를 배선할 때 걸린다. */
function assertZoneRatios(ratios: typeof ACTIVE_ZONE_RATIOS): void {
  for (const [name, r] of Object.entries(ratios)) {
    const sum = r.chip + r.center + r.bottom;
    if (sum !== 100) {
      throw new Error(
        `ACTIVE_ZONE_RATIOS.${name}의 합이 ${sum}이다(100이어야 한다). ` +
        `fr은 비율이라 합이 틀려도 조용히 정규화되어 렌더된다 — ui-standard §2를 확인해라.`,
      );
    }
  }
}
assertZoneRatios(ACTIVE_ZONE_RATIOS);

/** 백분율 → 그리드 트랙. `minmax(0, …)`는 `1fr`의 auto minimum(콘텐츠 최소 크기)을 없앤다.
 *  합이 100임을 위에서 보장하므로 `pct / 10`은 세 트랙 합이 항상 `10fr`이 된다. */
export const zoneTrack = (pct: number) => `minmax(0, ${pct / 10}fr)`;

/** ui-standard §2 배분을 상태에 맞는 그리드 트랙으로 만든다.
 *  🔴 **`ACTIVE_ZONE_RATIOS`에서 생성한다 — 손으로 적은 `2fr 5fr 3fr`이 아니다.**
 *  종전엔 둘이 따로 있어 상수와 트랙이 갈라질 수 있었고, 더 나쁘게는 **테스트가 그 상수를 읽어
 *  기대값을 만들고 있었다.** 제품과 테스트를 같은 diff로 바꾸면 25/50/25 후퇴도 green이 된다
 *  (Codex 리뷰 🔴-1이 실측으로 반증했다: 둘을 함께 되돌리자 `v039` 2/2 통과).
 *  👉 배분의 SSOT는 위 상수 하나이고, **테스트는 이걸 읽지 않고 설계 계약을 직접 고정한다.**
 *
 *  UI-e3는 수동 수정 입력에 `modify`만 배선한다. `dotless`는 저장 확인 전용이며 UI-e4 범위다. */
export type ActiveZoneMode = keyof typeof ACTIVE_ZONE_RATIOS;

export const activeZoneRows = (mode: ActiveZoneMode) => {
  const ratios = ACTIVE_ZONE_RATIOS[mode];
  return `auto ${zoneTrack(ratios.chip)} ${zoneTrack(ratios.center)} ${zoneTrack(ratios.bottom)}`;
};

/** 기본 활성 화면의 기존 공개 계약. 상태 배선은 `activeZoneRows`를 사용한다. */
export const ACTIVE_ZONE_ROWS = activeZoneRows('base');

/** UI-e1 — 하단 트랙 안에서 버튼 행이 갖는 몫(ui-standard §2의 20:10 = `1/3`).
 *  `ActiveControlBar`가 인디케이터 행과 행동행을 세로로 분리해 이 값을 직접 물려받는다. */
export const CONTROL_ROW_FRACTION = 1 / 3;

/** 와이어프레임 §[2]·§[4] — 중앙 50%가 hero 말고 다른 정보를 그릴 때 쓰는 타이포 SSOT.
 *  HERO_TYPE과 같은 계약: 절대 px 단독 금지(전부 clamp + min(vw,vh) 비례 + --fit 배율),
 *  **상태별 인라인 폰트 정의 금지**(민구 지적: "상태에 따라 식별이 불가할 만큼 작아지는 경우"). */
export const STATE_TYPE = {
  /** 경보행 `<추세|범위>알람 : <넘어선 정도>` — 값 **위**에 오고 값을 가리지 않는다(§[2]). */
  alarmLabel: 'max(17px, calc(clamp(22px, min(6.6vw, 3.6vh), 36px) * var(--fit-lo, 1)))',
  /** 2열 비교의 열 라벨(`mm-dd` / `현재`). 402px 폭에서 56px이고, 더 넓은 영역에서는
   *  함께 커진다. `clamp(..., max)`를 다시 넣으면 T6의 상한 재발이다. */
  compareLabel: 'max(22px, 13.93vw)',
  /** 2열 비교의 값 — 402px 폭에서 78px. 고정 상한 없이 영역 폭을 따라 커진다. */
  compareValue: 'max(30px, 19.4vw)',
  /** 완료 요약 `X / N`. UI-c에서 상태어를 지운 폭을 값이 회수한다 — 고정 최대 px 없이 열린 fit. */
  completeSummary: fittedHeroType(
    COMPLETE_SUMMARY_MIN_FONT_PX,
    COMPLETE_SUMMARY_BASE_FONT_PX,
    '--fit-summary',
  ),
  /** 🔴 알람 중 **실시간 인식값**(fb-27-7 5항 "정상 진행될때의 수준만큼 커야 함").
   *  종전 `AlarmInterimStrip`이 이 값을 **인라인 하드코딩**(`clamp(24px, min(8vw,4.8vh), 42px)`)해
   *  실기기에서 32.16px로 렌더됐다 — 정상 진행 InterimLine(90.13px)의 36%. [TYPO-CONTRACT-1]이
   *  "상태별 인라인 정의 금지"로 막으려던 바로 그 증상이 계약을 우회한 코드에서 재현된 것이다.
   *  그래서 여기 상수로 승격한다. **다시 인라인으로 내리지 마라.**
   *  크기는 HERO_TYPE.interim과 같은 급으로 맞추되, 알람 카드가 같은 트랙을 쓰므로 상한만 낮춘다. */
  alarmInterim: 'max(24px, calc(clamp(44px, min(19vw, 11vh), 96px) * var(--fit-hi, 1)))',
} as const;

/** v0.43.0 UI-f — 현장 화면(`src/components/voice/`) 인라인 fontSize 계약 SSOT.
 *  🔴 계약 규정 정정 (민구 확정 08-02):
 *  - VOICE_TYPE 컴포넌트(fit 훅 미물림)에서는 「하한 + 비례」 2요소가 필수 계약이다.
 *  - 🔴 **`var(--fit-lo, 1)`은 현재도 앞으로도 이 슬롯들에서 값을 바꾸지 않는다.**
 *    ① 대상 컴포넌트에 fit 훅이 없어 지금은 fallback `1`이고(실측: 전부 unset),
 *    ② **하한이 곧 기준값**이라 `--fit-lo ≤ 1`인 어떤 값이 들어와도 곱한 결과가
 *       `max()`의 첫 항에 흡수된다(실측: `--fit-lo:0.58`을 상속시켜도 128.64px 그대로).
 *    ③ `--fit-lo`를 쓰는 유일한 훅 `useFitScale`은 **축소 가드**라 1을 넘지 않는다.
 *    👉 즉 **「미래에 자동 연결된다」는 기대는 성립하지 않는다.** 초안 주석이 그렇게 적었으나
 *    독립 리뷰가 실측으로 반증했다. 지금 남겨 두는 이유는 **문법 통일**과,
 *    `ui-standard §7-2`(최소 가독 크기, 민구 미결정)가 확정되어 **하한이 기준값보다 낮아지면**
 *    그때 비로소 배율이 의미를 갖기 때문이다. 🔴 **그 전까지는 장식이다 — 있다고 믿지 마라.**
 *  - 하한(minPx)은 402×874 현재 렌더값 자체이며, 미확정 최소 가독크기가 아니다 (ui-standard §7-2 참조).
 *  - 고정 상한(`clamp(..., max)`)은 T6 6회차 재발의 원인이므로 포함하지 않는다 (규칙 2 준수).
 */
export const VOICE_TYPE = {
  /** ManualValueSheet 수동입력 시트 대형 값 디스플레이 — 402×874 기준 128.64px 보존 */
  sheetDisplay: 'max(128.64px, calc(min(32.00vw, 14.72vh) * var(--fit-lo, 1)))',
  /** StoppingState 정지 화면 메인 타이틀 — 402×874 기준 42px 보존 */
  stoppingTitle: 'max(42px, calc(min(10.45vw, 4.81vh) * var(--fit-lo, 1)))',
  /** ExitConfirmInline 종료 확인 메인 문구 — 402×874 기준 38px 보존 */
  exitConfirmTitle: 'max(38px, calc(min(9.45vw, 4.35vh) * var(--fit-lo, 1)))',
  /** ManualValueSheet 수동입력 시트 헤더 제목 — 402×874 기준 28px 보존 */
  sheetTitle: 'max(28px, calc(min(6.97vw, 3.20vh) * var(--fit-lo, 1)))',
  /** ActiveControlSteppers 스텝퍼 +/- 제어 버튼 심볼 — 402×874 기준 26px 보존 */
  stepperValueLg: 'max(26px, calc(min(6.47vw, 2.97vh) * var(--fit-lo, 1)))',
  /** ReadyState 수치 강조 렌더링 값 — 402×874 기준 24px 보존 */
  readyValue: 'max(24px, calc(min(5.97vw, 2.75vh) * var(--fit-lo, 1)))',
  /** ManualValueSheet 키패드 백스페이스/입력 키 — 402×874 기준 24px 보존 */
  keypadKey: 'max(24px, calc(min(5.97vw, 2.75vh) * var(--fit-lo, 1)))',
  /** PersistErrorBanner 경고 배너 제목 — 402×874 기준 22px 보존 */
  bannerTitle: 'max(22px, calc(min(5.47vw, 2.52vh) * var(--fit-lo, 1)))',
  /** CommandHelpPopup 음성 명령어 팝업 제목 — 402×874 기준 21px 보존 */
  popupTitle: 'max(21px, calc(min(5.22vw, 2.40vh) * var(--fit-lo, 1)))',
  /** StateIndicator 상태 표시기 뱃지/라벨 — 402×874 기준 20.1px 보존 */
  statusLabel: 'max(20.1px, calc(min(5.00vw, 2.30vh) * var(--fit-lo, 1)))',
  /** ActiveControlSteppers 스텝퍼 수치 값 — 402×874 기준 20px 보존 */
  stepperValue: 'max(20px, calc(min(4.98vw, 2.29vh) * var(--fit-lo, 1)))',
  /** CommandHelpPopup 팝업 닫기 버튼 심볼 — 402×874 기준 20px 보존 */
  popupClose: 'max(20px, calc(min(4.98vw, 2.29vh) * var(--fit-lo, 1)))',
  /** StoppingState 정지 화면 보조 문구 — 402×874 기준 19px 보존 */
  stoppingBody: 'max(19px, calc(min(4.73vw, 2.17vh) * var(--fit-lo, 1)))',
  /** PersistErrorBanner 경고 배너 액션 버튼 — 402×874 기준 19px 보존 */
  bannerAction: 'max(19px, calc(min(4.73vw, 2.17vh) * var(--fit-lo, 1)))',
  /** ActiveControlBar 하단 제어바 메인 액션 버튼 — 402×874 기준 18.492px 보존 */
  controlButton: 'max(18.492px, calc(min(4.60vw, 2.12vh) * var(--fit-lo, 1)))',
  /** MicReconnectBanner / ActiveHeaderStrip 섹션 헤더 제목 — 402×874 기준 18px 보존 */
  headerTitle: 'max(18px, calc(min(4.48vw, 2.06vh) * var(--fit-lo, 1)))',
  /** ManualValueSheet 폼 입력 필드 및 시트 탭 라벨 — 402×874 기준 18px 보존 */
  bodyStrong: 'max(18px, calc(min(4.48vw, 2.06vh) * var(--fit-lo, 1)))',
  /** CommandHelpPopup / ManualValueSheet / ReadyState 액션 버튼 라벨 — 402×874 기준 17px 보존 */
  actionLabel: 'max(17px, calc(min(4.23vw, 1.95vh) * var(--fit-lo, 1)))',
  /** CommandHelpPopup 카테고리 태그 / PersistErrorBanner 본문 텍스트 — 402×874 기준 16px 보존 */
  bodyText: 'max(16px, calc(min(3.98vw, 1.83vh) * var(--fit-lo, 1)))',
  /** CommandHelpPopup 항목 설명 / ReadyState 항목 라벨 — 402×874 기준 15px 보존 */
  bodySm: 'max(15px, calc(min(3.73vw, 1.72vh) * var(--fit-lo, 1)))',
  /** CommandHelpPopup 서브 설명 / ManualValueSheet 에러 문구 / ActiveControlSteppers 라벨 — 402×874 기준 14px 보존 */
  caption: 'max(14px, calc(min(3.48vw, 1.60vh) * var(--fit-lo, 1)))',
  /** ReadyState 단위 / ActiveHeaderStrip 행 카운터 소형 라벨 — 402×874 기준 13px 보존 */
  captionSm: 'max(13px, calc(min(3.23vw, 1.49vh) * var(--fit-lo, 1)))',
  /** ActiveControlSteppers 소형 스텝퍼 라벨 — 402×874 기준 12px 보존 */
  captionXs: 'max(12px, calc(min(2.99vw, 1.37vh) * var(--fit-lo, 1)))',
  /** ActiveControlSteppers 스텝퍼 캡션 상세설명 — 402×874 기준 10px 보존 */
  captionXxs: 'max(10px, calc(min(2.49vw, 1.14vh) * var(--fit-lo, 1)))',
} as const;

/** v0.23.0 입력탭#1 — 흡수영역(grid row3, 1fr, overflow:hidden) 안에서 카드가 부모에 잘리지 않게
 *  하는 공통 가드. maxHeight:100% + minHeight:0.
 *  v0.27.0 — overflowY:auto는 이제 **폴백**이다: 정상 경로에선 useFitScale이 폰트를 줄여 스크롤
 *  잔여 0(scrollHeight ≤ clientHeight)을 보장한다(양손 측정 중 스크롤 불가 — 민구 07-03).
 *  PausedCard·ModifyIndicatorPill·AnomalyAlertPopup·VoiceHero 모두 이 클램프 + useFitScale 적용. */
export const ABSORB_CLAMP = {
  maxHeight: '100%',
  minHeight: 0,
  overflowY: 'auto',
} as const;
