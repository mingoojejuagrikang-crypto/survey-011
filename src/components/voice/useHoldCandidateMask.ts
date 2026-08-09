/**
 * 🔴 v0.47.0-r2 P5 보강(FB-F 후속 · 민구 확정 08-09) — **미확정 후보값을 칩에 넣지 않는다.**
 *
 * 민구 원문 맥락: *"알람 발생시킨 값이 칩에 안 들어가 있다면 그건 내가 더 원하는 상황."*
 * 선택지 셋(후보값 숨김 / 현행 유지 / 후보에도 빨간 체크) 중 **숨김**을 골랐다.
 *
 * ## 무엇을 가리나
 * 수동 입력 이상치가 **보류**(manualHold)되면 후보값은 [확인] 전까지 확정값이 아니다. 그런데
 * 칩존은 그 값을 이미 확정값처럼 크게 보여 줬다 — 현장에서 폰을 2~3m 떨어뜨려 두는 사용자에게
 * *"저 값이 들어갔다"* 로 읽힌다. 후보값은 **알람 팝업에만** 남긴다(팝업이 「현재 <값>」으로
 * 이미 크게 띄운다 — 정보 손실이 없다).
 *
 * ## 왜 저장이 아니라 표시에서 가리나 (설계 판단)
 * 후보는 `rows[].values[colId]`에 **후보값 그대로** + `pendingValidation` 태그로 저장된다.
 * 그게 v0.34.0의 크래시 안전 설계다 — 후보와 태그를 **단일 IDB put**으로 써서, 그 사이
 * reload가 끼어도 후보가 확정값으로 오인되지 않는다. 외부 유출은 `withoutPendingCandidate`
 * (Sheets·CSV·백업 ZIP의 안전 뷰)가 이미 막는다.
 * 👉 그래서 저장 구조를 건드리면 **크래시 안전성과 export 경계를 동시에 다시 증명해야 한다.**
 *    가려야 하는 것은 «화면에 보이는 값» 하나뿐이므로 **렌더 직전 한 곳**에서 치환한다.
 *    부수 효과: reload 복구(restorePendingValidation이 rows 값을 그대로 싣는다)도 **같은 마스크로
 *    자동 처리**된다 — 복원 경로에 별도 배선이 필요 없다.
 *
 * ## 무엇을 가리지 *않나* (의도)
 *  - **[수정] 시트의 프리필**(`ManualValueSheet currentValue`)은 후보값 그대로다. 사용자가 방금
 *    넣은 값의 한 자리를 고치는 흐름이라 거절된 옛 값으로 되돌리면 오히려 방해다.
 *  - 「이 칩이 알람 대상」 표시(활성 칩의 빨강 강조·칩존 하단 경계)는 **유지**한다 — 값만 숨긴다.
 *  - 저장·동기화·복원 어디도 건드리지 않는다.
 *
 * ## ✓의 색과의 계약 (놓치기 쉬운 지점)
 * 마스크가 걸린 칩은 **직전 확정값**을 보여 준다. 그 값은 알람 대상이 아니므로 체크는
 * **원래 색(초록)** 이어야 한다(민구: *"기존 값이 있던 셀이면 그 옛 값(+원래 색 체크)"*).
 * 알람 셀을 빨갛게 칠하는 `useCommitMarkAlertColId`와 정면으로 부딪히므로, 호출부가
 * `maskedColId`로 그 빨강을 눌러야 한다. 그래서 이 훅은 값뿐 아니라 **가린 좌표도 함께** 돌려준다.
 */
import { useMemo } from 'react';
import { useSessionStore } from '../../stores/sessionStore';
import { useDataStore } from '../../stores/dataStore';

export interface HoldCandidateMask {
  /** 칩존에 내릴 값 묶음. 마스크가 없으면 입력 객체를 **그대로**(참조 동일) 돌려준다. */
  chipValues: Record<string, string>;
  /** 후보값을 가린 칩의 colId(없으면 null). ✓ 빨강 억제에 쓴다 — 위 「✓의 색과의 계약」. */
  maskedColId: string | null;
}

/** 이 행에 미확정 후보가 있으면 그 칸만 **직전 확정값**으로 되돌린 값 묶음을 만든다.
 *  `pendingValidation`은 보류 중에만 존재하고 [확인]·정상 재커밋·롤백에서 사라지므로,
 *  마스크의 수명은 보류의 수명과 정확히 같다(해제 배선이 따로 필요 없다). */
export function useHoldCandidateMask(
  row: number,
  rowValues: Record<string, string>,
): HoldCandidateMask {
  const sessionId = useSessionStore((s) => s.sessionId);
  const pending = useDataStore(
    (s) => s.sessions.find((sess) => sess.id === sessionId)?.pendingValidation,
  );
  const maskedColId = pending && pending.row === row ? pending.colId : null;
  const previousValue = pending && pending.row === row ? pending.previousValue : null;
  const chipValues = useMemo(
    () => (maskedColId === null || previousValue === null
      ? rowValues
      // 빈 문자열이면 「빈 채로」가 맞다(민구) — ChipZone의 hasValue 게이트가 마크까지 함께 거둔다.
      : { ...rowValues, [maskedColId]: previousValue }),
    [rowValues, maskedColId, previousValue],
  );
  return { chipValues, maskedColId };
}
