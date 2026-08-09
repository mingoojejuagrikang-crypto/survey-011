/**
 * v0.45.0 UI③ (민구 확정 08-05) — 방금 **음성으로** 확정된 칩에 체크표시 '✓' 마크를 잠깐 표시하기
 * 위한 파생 상태. 중앙 '✓+항목명' 확인 라벨 삭제의 승계 표시다 — 성공 표시는 칩존이 담당한다.
 * (v0.46.0 WP-0에서 알파벳 'V' → '✓'로 정정. 민구의 "V"는 처음부터 체크표시의 표기였다.)
 *
 *  - `valueBurst`는 음성 커밋 경로만 발행한다(수동·터치·이상치 정정은 commitReceipt) — 그 자체가
 *    "음성으로 입력된"의 판별식이다(민구: 음성 입력 칩만 ✓).
 *  - 표시 창은 VoiceHero의 값 플래시(CONFIRM_MS)와 같은 1.5초 — 중앙과 칩이 같은 리듬으로 꺼진다.
 *  - 마운트 시 과거 burst는 재생하지 않는다(useConfirmFlash와 같은 seq 가드 계약).
 */
import { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { useSessionStore } from '../../stores/sessionStore';

export const VOICE_COMMIT_MARK_MS = 1500;

// ── v0.47.0 W4(FB-E, 민구 확정 08-08) — **세션 영속 ✓ 집합** ─────────────────────────────
// ✅ 민구 확정: ✓ 대상 = **성공 입력 전부(수동·터치·이상치 정정 포함)**. v0.45.0 UI③의
// "음성만 ✓" 원칙은 이 결정이 **대체**했다. ✓ 의미 = "이 칸은 채워졌다" — 성공 입력으로
// 덮으면 유지, 값이 비면 회수.
//
//  - 위 1.5초 플래시(useVoiceCommitMarkColId)와 **공존**한다: 플래시는 "방금 확정" 리듬
//    (VoiceHero CONFIRM_MS 동조), 이 집합은 "이 세션에서 확정된 적 있음"의 영속 표시.
//    C13 가드(행 전환 시 플래시 즉시 회수)도 그대로다 — 이 집합은 (row,colId) 키라
//    다른 행으로 이식될 구조 자체가 없다.
//  - ~~**add 전용**이다~~ → 🔴 **v0.47.0-r2 P5(FB-F, 민구 08-09)에서 뒤집혔다.** 아래 「✓ 억제」
//    절 참조. 값 삭제(비움) 시 회수는 여전히 렌더 게이트가 맡는다 — ChipZone이
//    `hasValue && has(key)`로 조회하므로 빈 셀은 집합에 남아 있어도 ✓가 안 뜬다.
//    삭제 사이트(cascade clear·redo)를 일일이 쫓지 않는 이유는 그대로다: 재커밋이 다시 add하므로
//    집합의 잉여 키는 표시에 영향이 없고, 누락 add만이 결함이 된다(그쪽만 지키면 된다).
//    `remove`는 그 예외가 아니라 **다른 축**이다 — 「값이 없다」가 아니라 「지금 부정적 상태다」.
//  - 🔴 시트 불특정(§) — colId 키만. 컬럼 이름·개수·순서 가정 없음.
//  - 쓰기 지점(전부 useVoiceSession): ①음성 커밋(handleFinal 값 확정) ②수동/터치 커밋
//    (persistCellValue 공유 코어 — manualHold 후보 경로는 안 지나므로 미확정 후보는 제외)
//    ③이상치 정정 [확인](confirmManualAnomaly) ④직접 수정("수정 88.9") ⑤세션 시작 reset.
//  - 🟡 hydrate(manualHold reload 복구) 가정: 복원된 세션의 **값이 있는 셀 = 과거 성공
//    커밋**으로 재구성하되, 미확정 후보 셀(pendingValidation)은 제외한다. "이 칸은
//    채워졌다" 의미가 reload를 넘어 이어지는 쪽이 자연스럽다고 읽었다 — 어긋나면 여기만 고친다.

// ── 🔴 v0.47.0-r2 P5(FB-F · 민구 실기기 08-09) — **✓ 억제: 「채워졌다」에서 「괜찮다」로** ────
// 민구 원문: *"이상값 알람이 뜬 상태인데, 칩존의 초록색 체크 표시는 지금의 부정적 상황과
// 일치하지 않음. 칩존의 녹색표시는 알람 없이 정상입력 될 경우와, 알람이 발생해도 사용자의
// 수정, 확인값을 긍정적 상황으로 돌아갔을때만 표시 할 것."*
//
// 즉 ✓의 의미가 바뀌었다: W4의 「이 칸은 채워졌다」 → **「이 칸은 지금 괜찮다」.**
// 값이 있다는 사실만으로는 부족하고, **부정 상태(이상치 알람)가 걸려 있지 않아야** 한다.
//  - 억제: 알람 발화 지점(useVoiceSession의 3곳 — 음성 커밋·직접 수정·수동 커밋)에서 `remove`.
//  - 복원: **긍정 해소**에서만 다시 `add` — 「확인」/「유지」(음성 trendResolve · 터치 [확인] ·
//    보류 [확인]) 또는 정상값 재커밋(기존 add 지점이 그대로 복원 역할을 한다).
//    ⚠️ 타 명령으로 알람이 dismiss된 경우는 **복원하지 않는다** — 사용자가 그 값을 승인한 적이
//    없다. 민구 정의를 문자 그대로 따른 결과다.
//  - 🟡 **알려진 결과**: 수동 커밋의 **비-hold 정보성 알람**은 확인 절차 자체가 없어(팝업만 뜨고
//    흐름이 계속된다) 그 셀은 재커밋 전까지 세션 내내 ✓ 없이 남는다. 「값은 있는데 체크가
//    없다」로 보이는 유일한 경로다 — 민구 정의의 직접 귀결이라 그대로 두되, 재점검에서
//    되돌아오면 여기만 예외 처리하면 된다.

export const commitMarkKey = (row: number, colId: string) => `${row}:${colId}`;

interface SessionCommitMarksState {
  /** `${row}:${colId}` 키 집합 — 이 세션에서 성공 커밋됐고 **지금 부정 상태가 아닌** 셀. */
  keys: ReadonlySet<string>;
  add: (row: number, colId: string) => void;
  /** P5 — 이상치 알람이 걸린 셀의 ✓ 억제. 없는 키를 지우는 것은 무해한 no-op이다
   *  (수동 보류처럼 애초에 add되지 않는 경로가 있어 호출부가 존재 여부를 몰라도 되게 한다). */
  remove: (row: number, colId: string) => void;
  /** 세션 경계 리셋. `seed`는 hydrate 재구성용(복원 세션의 기존 확정 셀). */
  reset: (seed?: Array<{ row: number; colId: string }>) => void;
}

export const useSessionCommitMarks = create<SessionCommitMarksState>((set) => ({
  keys: new Set<string>(),
  add: (row, colId) =>
    set((s) => {
      const key = commitMarkKey(row, colId);
      if (s.keys.has(key)) return s; // 동일 셀 재커밋 — 참조 유지(불필요 렌더 방지)
      const next = new Set(s.keys);
      next.add(key);
      return { keys: next };
    }),
  remove: (row, colId) =>
    set((s) => {
      const key = commitMarkKey(row, colId);
      if (!s.keys.has(key)) return s; // 없던 키 — 참조 유지(불필요 렌더 방지, add와 대칭)
      const next = new Set(s.keys);
      next.delete(key);
      return { keys: next };
    }),
  reset: (seed) =>
    set(() => ({ keys: new Set((seed ?? []).map((c) => commitMarkKey(c.row, c.colId))) })),
}));

/** 지금 V 마크를 표시할 칩의 colId(없으면 null). ActiveState가 구독해 ChipZone에 내린다.
 *  리뷰 C13 — 칩존은 **현재 행**의 값을 렌더하므로, 마크 창(1.5초) 안에 행이 바뀌면(이전/다음·
 *  터미널 컬럼 커밋의 자동 advance) 마크를 즉시 거둔다 — 다른 행의 셀에 "방금 확정" 표시가
 *  이식되는 시각 오표시 방지.
 *
 *  🔴 v0.47.0-r2 P5 — **여기도 게이트한다.** 위 집합(remove)만 다루면 1.5초 플래시가 남는다:
 *  버스트는 커밋 즉시 발행되고 알람은 그 직후에 서므로, 알람 팝업이 뜨는 바로 그 순간
 *  「초록 ✓」가 1.5초간 함께 보인다 — 민구가 지적한 화면 그 자체다.
 *  🔑 게이트를 **여기**(파생 훅)에 두면 `ChipZone.tsx`를 건드릴 필요가 없다. 렌더 조건은
 *  `commitMarkColId != null || sessionMarks.has(...)`의 OR라, 두 출처를 각자의 소유 파일에서
 *  막는 것이 칩존 스크롤/왕복 로직과의 충돌면을 0으로 만든다. */
export function useVoiceCommitMarkColId(): string | null {
  const burst = useSessionStore((st) => st.valueBurst);
  const activeRow = useSessionStore((st) => st.activeRow);
  const anomalyAlert = useSessionStore((st) => st.anomalyAlert);
  const [mark, setMark] = useState<{ colId: string; row: number } | null>(null);
  const seenSeqRef = useRef<number | null>(null);
  useEffect(() => {
    const seq = burst?.seq ?? 0;
    if (seenSeqRef.current === null) { seenSeqRef.current = seq; return; } // 마운트 시 재생 안 함
    if (!burst || seq === seenSeqRef.current) return;
    seenSeqRef.current = seq;
    if (!burst.colId) return; // 구 발행 경로(colId 미동봉) 방어 — 마크 없음
    setMark({ colId: burst.colId, row: useSessionStore.getState().activeRow });
    const t = window.setTimeout(() => setMark(null), VOICE_COMMIT_MARK_MS);
    return () => window.clearTimeout(t);
  }, [burst]);
  if (!mark || mark.row !== activeRow) return null;
  // P5 — 이 셀에 **미해소** 이상치 알람이 걸려 있으면 플래시도 내지 않는다.
  //   `status === 'corrected'`는 제외한다: 정정값이 정상으로 판명된 초록 팝업이라 이미
  //   긍정 상태다(민구 정의의 "수정·확인으로 긍정적 상황으로 돌아갔을 때").
  if (
    anomalyAlert
    && anomalyAlert.status !== 'corrected'
    && anomalyAlert.row === mark.row
    && anomalyAlert.colId === mark.colId
  ) return null;
  return mark.colId;
}
