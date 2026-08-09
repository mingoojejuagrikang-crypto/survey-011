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
//    🔴 v0.47.0-r2 P5도 이 계약을 **깨지 않는다** — 아래 「✓의 색」 절 참조. 알람은 마크를
//    지우는 것이 아니라 **색을 바꾼다**(중간에 remove를 도입했다가 민구 재정의로 되돌렸다).
//  - 🔴 시트 불특정(§) — colId 키만. 컬럼 이름·개수·순서 가정 없음.
//  - 쓰기 지점(전부 useVoiceSession): ①음성 커밋(handleFinal 값 확정) ②수동/터치 커밋
//    (persistCellValue 공유 코어 — manualHold 후보 경로는 안 지나므로 미확정 후보는 제외)
//    ③이상치 정정 [확인](confirmManualAnomaly) ④직접 수정("수정 88.9") ⑤세션 시작 reset.
//  - 🟡 hydrate(manualHold reload 복구) 가정: 복원된 세션의 **값이 있는 셀 = 과거 성공
//    커밋**으로 재구성하되, 미확정 후보 셀(pendingValidation)은 제외한다. "이 칸은
//    채워졌다" 의미가 reload를 넘어 이어지는 쪽이 자연스럽다고 읽었다 — 어긋나면 여기만 고친다.

// ── 🔴 v0.47.0-r2 P5(FB-F · 민구 실기기 08-09) — **✓의 색: 알람 중 빨강 → 해제되면 초록** ───
// 1차 제보: *"이상값 알람이 뜬 상태인데, 칩존의 초록색 체크 표시는 지금의 부정적 상황과
// 일치하지 않음."*  → 초안은 알람 중 마크를 **지우는** 것이었다.
// 민구 재정의(같은 날, 이 설계를 대체한다): *"알람중에는 색이라도 붉은색으로 유지하고,
// 알람해제 조건이 성립되거나, 사용자가 '확인'시 해당 체크를 녹색으로 변경해줘. 체크 표시
// 대상은 알람을 유발시킨 값에 해당하는 칩만이야. 만약 정상 입력되서 녹색으로 체크 되어 있는
// 칩은 녹색칩을 유지하고 있어야해."*
//
// 즉 ✓는 **사라지지 않는다** — 「이 칸은 채워졌다」(W4)는 그대로고, **색이 상태를 진다**:
//   🟢 초록 = 지금 괜찮다  ·  🔴 빨강 = 지금 이 값에 알람이 걸려 있다
//
// 🔑 **색은 저장하지 않는다 — `anomalyAlert`에서 파생한다.** 이게 설계의 핵심이다:
//   ① 알람이 서는 순간 그 셀이 빨강이 되고, 알람이 **어떤 경로로 내려가든**(확인·유지·정정·
//      터치 [확인]·타 명령 dismiss·announce_field 청소) 자동으로 초록이 된다. 해제 경로를
//      일일이 쫓아 복원 코드를 심을 필요가 없다 — 누락이 구조적으로 불가능하다.
//   ② 초안(remove/add)이 안고 있던 「값은 있는데 체크가 영영 없는 칸」 두 경우가 **소멸**한다:
//      수동 비-hold 정보성 알람(확인 절차 없음)과 타 명령 dismiss. 둘 다 «알람이 지나갔다 =
//      초록»으로 자연 귀결된다.
//   ③ `useVoiceSession`에 배선이 **한 줄도 없다.** 알람 발화/해제 지점을 건드리지 않는다.
//  - 대상은 **알람을 유발한 그 셀만**이다(`anomalyAlert`의 row+colId 일치). 다른 칩의 초록은
//    불변 — 민구가 마지막 문장으로 못박은 조건.
//  - `status === 'corrected'`는 빨강에서 뺀다: 정정값이 정상으로 판명된 **초록 팝업** 상태라
//    이미 «긍정 복귀»다(민구의 "사용자가 '확인'시"와 같은 축).
//  - 🟡 **경계**: 수동 보류(manualHold)의 **미확정 후보**는 애초에 이 집합에 없으므로(W4의
//    "미확정 후보 제외" 계약) 알람 중에도 마크가 없다 — 빨강으로 물들 마크 자체가 없다.
//    [확인]으로 확정되는 순간 add되고, 그때는 알람도 내려가 있으니 **초록**으로 뜬다.
//    민구 문장의 "붉은색으로 **유지**"가 «이미 있는 체크를 유지»로 읽히므로 이쪽을 택했다 —
//    후보에도 빨간 체크를 새로 띄우려면 렌더 게이트 한 줄만 바꾸면 된다.

export const commitMarkKey = (row: number, colId: string) => `${row}:${colId}`;

/** ✓ 글리프의 상태색. 저장되지 않고 `anomalyAlert`에서 매 렌더 파생된다(위 🔑 참조). */
export type CommitMarkTone = 'ok' | 'alert';

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
 *  이식되는 시각 오표시 방지.
 *
 *  v0.47.0-r2 P5 — 이 훅은 **어느 칩에** 마크를 띄울지만 정한다. **무슨 색인지**는
 *  `useCommitMarkAlertColId`가 따로 판정한다(1.5초 플래시와 세션 영속 마크는 «자리·글리프가
 *  같은 하나의 표시»라, 색도 한 곳에서 갈라야 두 출처가 어긋나지 않는다). */
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

/** 🔴 v0.47.0-r2 P5 — 지금 ✓를 **빨강**으로 물들일 칩의 colId(없으면 null).
 *
 *  «알람을 유발한 그 셀만»(민구)이라 `anomalyAlert`의 row+colId가 함께 맞아야 한다.
 *  `row` 인자는 칩존이 지금 렌더 중인 행이다 — 다른 행의 알람이 이 행의 칩을 물들이지
 *  않게 하는 가드(마크 집합이 (row,colId) 키인 것과 같은 이유).
 *  `status === 'corrected'`(정정값이 정상으로 판명된 초록 팝업)는 이미 긍정 복귀라 빨강이 아니다.
 *  ⚠️ 저장 상태가 아니다 — 알람이 어떤 경로로 내려가든 이 값이 자동으로 null이 되고 ✓는
 *  초록으로 돌아간다. 해제 경로마다 복원 코드를 심지 않는 이유가 이것이다. */
export function useCommitMarkAlertColId(row: number): string | null {
  const alert = useSessionStore((st) => st.anomalyAlert);
  if (!alert || alert.status === 'corrected') return null;
  if (alert.row !== row || !alert.colId) return null;
  return alert.colId;
}
