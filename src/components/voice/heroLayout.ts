/** v0.23.0 입력탭#1(중앙 흡수, Vance) — 중앙 흡수영역 카드들이 공유하는 레이아웃 헬퍼.
 *  VoiceHero(VoiceScreen)와 ModifyIndicatorPill(components/voice)이 같은 타이포 스케일을 쓰도록
 *  SSOT로 분리(순환 import 방지 — VoiceScreen이 컴포넌트를 import하므로 헬퍼는 별도 모듈). */

/** README 타이포 스케일(A): 값 길이로 hero 숫자 크기 자동 조절. ≤4자 150 / ≤6자 104 / 그 외 50.
 *  clamp로 작은 화면(375px 세로)에서도 안 깨지게 상한만 길이별로 둔다(min은 동일 비율 축소).
 *  v0.27.0 무스크롤(민구 07-03) — vw 단독이던 가변항을 min(vw, vh)로 결합: 세로가 짧은 화면(가로
 *  모드·짧은 기기)에서 세로 기준으로도 비례 축소돼 흡수영역을 넘치지 않는다(useFitScale 1차 CSS 단계). */
export function heroFontSize(value: string): string {
  const len = (value || '').length;
  if (len <= 4) return 'clamp(64px, min(22vw, 17vh), 150px)';
  if (len <= 6) return 'clamp(48px, min(16vw, 12.4vh), 104px)';
  return 'clamp(34px, min(11vw, 6.5vh), 50px)';
}

/** UI-a 타이포 하한과 scale=1 기준값. 최소 가독값은 미확정이라 현행값을 한 상수에 보존한다. */
export const HERO_MIN_FONT_PX = { name: 22, value: 26, interim: 24 } as const;
export const HERO_BASE_FONT_PX = { name: 34, value: 64, interim: 44 } as const;

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

/** 🔴 T3(레이아웃 밀도, 6회차) 7회차 방어선 — UI-b가 칩존을 25→20%로 줄이기 **전에** 박았다.
 *  값은 `36a01b1`(UI-a 완료) 실측 fontSize다: 402×874에서 46.23px, 390×568에서 36.92px.
 *  두 뷰포트를 다 두는 이유는 공식 `min(11.5vw, 6.5vh)`의 **이기는 항이 서로 다르기** 때문이다
 *  (402×874는 vw, 390×568은 vh). 한쪽만 지키면 다른 축의 축소를 못 잡는다.
 *
 *  🔴 이 상수를 낮춰서 테스트를 통과시키지 마라. 그게 T6 6회차 재발의 형태 그 자체다
 *  (`HANDOFF.md` UI-a 함정 2 — 상수 조정 금지). red면 **공간을 회수해서** 값을 되돌린다.
 *  `fb-28-1`("칩 항목명이 너무 작다")이 이 축의 원 제보이고 v0.40.0 `CHIP_TYPE`이 겨우 닫았다.
 *  **테스트 오라클 전용이다** — fit 기제의 입력이 아니다. */
export const CHIP_LABEL_BASELINE_PX = { standard: 46.23, short: 36.92 } as const;

/** 기준선 대비 허용 축소폭. 폰트 로딩·서브픽셀 라운딩 변동만 흡수하는 크기다.
 *  🔴 배분 변경이 라벨을 깎았을 때 이 값을 키워 통과시키는 것은 위 금지의 우회다. */
export const CHIP_LABEL_REGRESSION_TOLERANCE = 0.95;

/** 와이어프레임 §공통규칙1 — 입력화면 공간 배정 **칩존 25% / 중앙 50% / 하단 25%**.
 *  (SSOT: `Deliverables/2026-07-24-survey-011-active-screen-wireframe.md`)
 *
 *  🔴 비율의 분모는 **ActiveState 자신의 높이에서 상단 행/진행 스트립을 뺀 나머지**다.
 *  와이어프레임 목업에서 `[칩존 25%]` 격벽은 행/진행 스트립 **아래**에서 시작하고, 하단 nav
 *  (설정/입력/데이터/개선)는 `[하단 25%]` 안에 그려져 있지만 실제 nav는 App 레벨(TabBar)이라
 *  ActiveState 박스 밖이다. 테스트도 `window.innerHeight`가 아니라 이 박스 높이를 분모로 써야 한다.
 *  ---
 *  🔴 v0.43.0 UI-b — **20 / 50 / 30 으로 바꿨다** (ui-standard §2, 민구 확정).
 *  하단을 30%로 올리라는 지시에 대해 **중앙을 지키려고 칩존에서 5%p를 뺐다.** 칩은 한 행 +
 *  가로 스크롤이라 높이 손실을 흡수한다는 것이 근거이고, **그 근거가 T3 7회차 위험**이다
 *  (`v037-chip-2row`의 잘림 가드가 기계로 지킨다 · plan §7:809-811).
 *
 *  ⚠️ **하단 30%는 아직 한 덩어리다.** ui-standard §2는 하단을 1행(도트·파형 20%)과
 *  2행(버튼 10%)으로 나누지만, 현재 `ActiveControlBar`는 `[‹][도트·파형][›]`가 **한 행에
 *  가로로** 놓인 구조라 나눌 그릇이 없다. 그 분리는 화면 6종을 짓는 **UI-e**의 몫이다.
 *  UI-b는 30%를 확보하고, 버튼 높이가 **배분에서 나오게** 바꾸는 데까지 한다
 *  (종전 `min(100%, 56px)`의 56px은 규칙 2가 금지하는 하드코딩 상한이었다). */
export const ACTIVE_ZONE_ROWS = 'auto minmax(0, 2fr) minmax(0, 5fr) minmax(0, 3fr)';

/** ui-standard §2의 배분 3종. **UI-b는 `base`만 배선한다** — 상태→배분 전환은 UI-e다.
 *  🔴 한 단계는 자기 몫만 깨야 차집합이 판정으로 기능한다. `modify`/`dotless`를 지금 배선하면
 *  `v039:613`(일시정지에서도 중앙 50%)이 UI-b에서 깨지는데, 그건 UI-e의 정당 파손이다.
 *  숫자는 칩존 / 중앙 / 하단 백분율이고 상단 스트립은 `auto`라 분모 밖이다. */
export const ACTIVE_ZONE_RATIOS = {
  base: { chip: 20, center: 50, bottom: 30 },
  /** 수정 입력 — 키패드가 4행이라 하단이 커진다(136px면 버튼 34px로 iOS 권장 44px 미달, 272px면 61px). */
  modify: { chip: 20, center: 30, bottom: 50 },
  /** 일시정지·저장 확인 — 하단 도트가 없으므로 **중앙이 회수한다.** */
  dotless: { chip: 20, center: 70, bottom: 10 },
} as const;

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
  /** 완료 요약 `완료 : X / N`(§[4]). */
  completeSummary: 'max(24px, calc(clamp(30px, min(10vw, 5.4vh), 56px) * var(--fit-hi, 1)))',
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
