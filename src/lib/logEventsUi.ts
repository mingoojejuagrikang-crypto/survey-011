/**
 * v0.49 R1 리팩토링 P1-3 — 로그 이벤트 빌더 «설정·UI 계측» 도메인
 * (logEvents.ts에서 순수 이동 — 500줄 게이트).
 *
 * 🔴 소비처는 계속 `./logEvents`(배럴)에서 import한다 — 바이트 계약·SOP-003 파서 매핑·계약
 * 전문은 `logEvents.ts` 헤더가 정본이다. 방출 문자열은 이동 전과 바이트 동일
 * (tests/logEvents.spec.ts 특성화 테스트가 고정). `kv` 순환 import는 logEventsAudio.ts 헤더 참조.
 */
import { kv } from './logEvents';

/** `setting_changed:${key}=${value}` — 설정 변경 계측(다이얼·토글 공유 패밀리). */
export function settingChanged(key: string, value: string | number | boolean): string {
  return `setting_changed:${key}=${value}`;
}

/** 조절판을 실제로 펼친 횟수(오탭률의 분모). 기존 command 이벤트는 바이트 불변으로 별도 유지한다. */
export function inputControlPanelOpened(source: 'touch' | 'voice'): string {
  return `input_control_panel:${kv({ action: 'open', source })}`;
}

/** 계측 I — **회전이 실제로 일어났는가.** 3회차 연속 판정 불가였던 축.
 *
 *  **왜 필요한가:** 민구가 `PortraitGuard` 안내 화면을 **눈으로 봤다고 진술**했는데 로그에는
 *  회전·방향 이벤트가 **0건**이다. 회전 진동(fb-01) 재현 조건을 세 회차째 못 잡은 이유가 여기다 —
 *  안내가 떴다는 것조차 로그로 확인이 안 되니 진동 보고와 대조할 축이 없다.
 *
 *  `guard`가 **안내 오버레이의 실제 표시 여부**다. `(orientation: landscape)`만으로는 안 뜨고
 *  `(pointer: coarse)` 게이트를 함께 통과해야 하므로(데스크톱 제외), 방향 전환과 안내 표시는
 *  별개 사실이다. 둘을 한 이벤트에 담아 *"돌렸는데 안내가 안 떴다"*도 판정 가능하게 한다.
 *
 *  ⚠️ `standalone` 여부는 여기 싣지 않는다 — 부팅 시 `sa_insets`가 이미 남기므로(2026-07-29
 *  실측 확인) 중복이다. 그 값이 이 이벤트 판독의 분모다. */
export function orientationChange(fields: {
  to: 'portrait' | 'landscape';
  guard: 'shown' | 'hidden';
  w: number;
  h: number;
}): string {
  return `orientation_change:${kv({
    to: fields.to,
    guard: fields.guard,
    w: fields.w,
    h: fields.h,
  })}`;
}
