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

/** ui-standard §2의 배분 3종 중 **UI-b는 `base`만 배선한다** — 상태→배분 전환은 UI-e다.
 *  🔴 한 단계는 자기 몫만 깨야 차집합이 판정으로 기능한다. `modify`/`dotless`를 지금 배선하면
 *  `v039:613`(일시정지에서도 중앙 50%)이 UI-b에서 깨지는데, 그건 UI-e의 정당 파손이다.
 *
 *  🔴 **`ACTIVE_ZONE_RATIOS`에서 생성한다 — 손으로 적은 `2fr 5fr 3fr`이 아니다.**
 *  종전엔 둘이 따로 있어 상수와 트랙이 갈라질 수 있었고, 더 나쁘게는 **테스트가 그 상수를 읽어
 *  기대값을 만들고 있었다.** 제품과 테스트를 같은 diff로 바꾸면 25/50/25 후퇴도 green이 된다
 *  (Codex 리뷰 🔴-1이 실측으로 반증했다: 둘을 함께 되돌리자 `v039` 2/2 통과).
 *  👉 이제 배분의 SSOT는 위 상수 하나이고, **테스트는 이걸 읽지 않고 설계 계약을 직접 고정한다.** */
export const ACTIVE_ZONE_ROWS =
  `auto ${zoneTrack(ACTIVE_ZONE_RATIOS.base.chip)} ${zoneTrack(ACTIVE_ZONE_RATIOS.base.center)} ${zoneTrack(ACTIVE_ZONE_RATIOS.base.bottom)}`;

/** ⏭ **UI-e 예약** — 하단 트랙 안에서 버튼 행이 갖는 몫(ui-standard §2의 20:10 = `1/3`).
 *  아직 배선하지 않는다. `ActiveControlBar`의 버튼은 도트·파형과 `voice-nav-row` **한 행을
 *  가로로** 나눠 쓰므로 세로로 나눌 행이 없고, 지금 %를 쓰면 기준이 nav row가 되어 하단 트랙
 *  10%와 무관한 값이 나온다. UI-e가 2행을 만들 때 `EdgeButton`의 `56px` 상한과 함께 처리한다. */
export const CONTROL_ROW_FRACTION = 1 / 3;

/** 와이어프레임 §[2]·§[4] — 중앙 50%가 hero 말고 다른 정보를 그릴 때 쓰는 타이포 SSOT.
 *  HERO_TYPE과 같은 계약: 절대 px 단독 금지(전부 clamp + min(vw,vh) 비례 + --fit 배율),
 *  **상태별 인라인 폰트 정의 금지**(민구 지적: "상태에 따라 식별이 불가할 만큼 작아지는 경우"). */
export const STATE_TYPE = {
  /** 경보행 `<추세|범위>알람 : <넘어선 정도>` — 값 **위**에 오고 값을 가리지 않는다(§[2]). */
  alarmLabel: 'max(17px, calc(clamp(22px, min(6.6vw, 3.6vh), 36px) * var(--fit-lo, 1)))',
  /** 2열 비교의 열 라벨(`직전(YYYY-MM-DD)` / `현재`). */
  compareLabel: 'max(12px, calc(clamp(14px, min(4.2vw, 2.2vh), 21px) * var(--fit-lo, 1)))',
  /** 2열 비교의 값 — 원거리에서 두 값을 한눈에 대조한다(GL-005 가독 하한 22px). */
  compareValue: 'max(22px, calc(clamp(30px, min(16vw, 8vh), 62px) * var(--fit-hi, 1)))',
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
