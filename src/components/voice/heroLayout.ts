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
