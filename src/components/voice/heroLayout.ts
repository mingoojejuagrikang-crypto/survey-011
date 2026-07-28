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

/** v0.36.0 코덱스 시안 보정(2026-07-20, 민구 확정) — hero 타이포 SSOT. 절대 px 단독 금지:
 *  전부 `clamp(최소, vw/vh 비례, 최대)` 뷰포트 비례(코덱스 스펙 38~44px/80~100px은 402×874 목표치).
 *  **항목명 크기는 모든 상태(listening/confirm/review/reask)에서 동일**해야 한다 — 민구 지적:
 *  "상태에 따라 식별이 불가할 만큼 작아지는 경우가 존재". 상태별 인라인 정의 금지, 여기 상수만 소비.
 *  `--fit-lo/--fit-hi`(useFitScale)는 오버플로 시에만 개입 — 상태 간 기본 크기 차이는 없다. */
export const HERO_TYPE = {
  /** 항목명 — 중앙에 남는 높이를 쓰되 긴 이름은 useFitScale이 실제 영역에 맞춘다. */
  name: 'max(22px, calc(clamp(34px, min(13vw, 6.8vh), 58px) * var(--fit-lo, 1)))',
  /** 확정값(원거리 판독용 tabular hero) — GL-005 가독 하한 26px. */
  value: 'max(26px, calc(clamp(64px, min(28vw, 16vh), 132px) * var(--fit-hi, 1)))',
  /** 인식 중 원문 문자열 — 확정값과 같은 슬롯에서 긴 발화를 수용한다. */
  interim: 'max(24px, calc(clamp(44px, min(19vw, 11vh), 96px) * var(--fit-hi, 1)))',
} as const;

/** 칩 내부 타이포 SSOT. HERO_TYPE과 같은 뷰포트 양축 + fit 배율 계약을 따른다.
 *  값이 주인공인 위계는 유지하되, rounded rect가 회수한 세로 공간을 항목명 크기로 돌려준다. */
export const CHIP_TYPE = {
  name: 'max(12px, calc(clamp(14px, min(7vw, 3.5vh), 30px) * var(--fit-lo, 1)))',
  inputValue: 'max(16px, calc(clamp(18px, min(10vw, 5.2vh), 42px) * var(--fit-hi, 1)))',
  value: 'max(18px, calc(clamp(22px, min(13vw, 6.5vh), 52px) * var(--fit-hi, 1)))',
} as const;

/** 와이어프레임 §공통규칙1 — 입력화면 공간 배정 **칩존 25% / 중앙 50% / 하단 25%**.
 *  (SSOT: `Deliverables/2026-07-24-survey-011-active-screen-wireframe.md`)
 *
 *  🔴 비율의 분모는 **ActiveState 자신의 높이에서 상단 행/진행 스트립을 뺀 나머지**다.
 *  와이어프레임 목업에서 `[칩존 25%]` 격벽은 행/진행 스트립 **아래**에서 시작하고, 하단 nav
 *  (설정/입력/데이터/개선)는 `[하단 25%]` 안에 그려져 있지만 실제 nav는 App 레벨(TabBar)이라
 *  ActiveState 박스 밖이다. 따라서 `auto`(스트립) + 1:2:1(=25:50:25)이 유일하게 자기모순 없는
 *  해석이다. 테스트도 `window.innerHeight`가 아니라 이 박스 높이를 분모로 써야 한다. */
export const ACTIVE_ZONE_ROWS = 'auto 1fr 2fr 1fr';

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
