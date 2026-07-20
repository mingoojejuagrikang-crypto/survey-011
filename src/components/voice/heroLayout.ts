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
  /** 항목명(38~44px @402×874 목표) — 모든 hero 상태 공용. */
  name: 'max(20px, calc(clamp(30px, min(11vw, 5.2vh), 44px) * var(--fit-lo, 1)))',
  /** 확정값·행번호(80~100px 목표, tabular). */
  value: 'calc(clamp(56px, min(23vw, 12.5vh), 100px) * var(--fit-hi, 1))',
  /** 인식 중 원문 문자열(56~72px 목표). */
  interim: 'calc(clamp(38px, min(15vw, 8.6vh), 72px) * var(--fit-hi, 1))',
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
