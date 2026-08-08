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
//  - **add 전용**이다(세션 경계 reset 제외). 값 삭제(비움) 시 회수는 렌더 게이트가 맡는다 —
//    ChipZone이 `hasValue && has(key)`로 조회하므로 빈 셀은 집합에 남아 있어도 ✓가 안 뜬다.
//    삭제 사이트(cascade clear·redo)를 일일이 쫓지 않는 이유: 재커밋이 다시 add하므로
//    집합의 잉여 키는 표시에 영향이 없고, 누락 add만이 결함이 된다(그쪽만 지키면 된다).
//  - 🔴 시트 불특정(§) — colId 키만. 컬럼 이름·개수·순서 가정 없음.
//  - 쓰기 지점(전부 useVoiceSession): ①음성 커밋(handleFinal 값 확정) ②수동/터치 커밋
//    (persistCellValue 공유 코어 — manualHold 후보 경로는 안 지나므로 미확정 후보는 제외)
//    ③이상치 정정 [확인](confirmManualAnomaly) ④직접 수정("수정 88.9") ⑤세션 시작 reset.
//  - 🟡 hydrate(manualHold reload 복구) 가정: 복원된 세션의 **값이 있는 셀 = 과거 성공
//    커밋**으로 재구성하되, 미확정 후보 셀(pendingValidation)은 제외한다. "이 칸은
//    채워졌다" 의미가 reload를 넘어 이어지는 쪽이 자연스럽다고 읽었다 — 어긋나면 여기만 고친다.

export const commitMarkKey = (row: number, colId: string) => `${row}:${colId}`;

interface SessionCommitMarksState {
  /** `${row}:${colId}` 키 집합 — 이 세션에서 성공 커밋된 셀. */
  keys: ReadonlySet<string>;
  add: (row: number, colId: string) => void;
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
  reset: (seed) =>
    set(() => ({ keys: new Set((seed ?? []).map((c) => commitMarkKey(c.row, c.colId))) })),
}));

/** 지금 V 마크를 표시할 칩의 colId(없으면 null). ActiveState가 구독해 ChipZone에 내린다.
 *  리뷰 C13 — 칩존은 **현재 행**의 값을 렌더하므로, 마크 창(1.5초) 안에 행이 바뀌면(이전/다음·
 *  터미널 컬럼 커밋의 자동 advance) 마크를 즉시 거둔다 — 다른 행의 셀에 "방금 확정" 표시가
 *  이식되는 시각 오표시 방지. */
export function useVoiceCommitMarkColId(): string | null {
  const burst = useSessionStore((st) => st.valueBurst);
  const activeRow = useSessionStore((st) => st.activeRow);
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
  return mark && mark.row === activeRow ? mark.colId : null;
}
