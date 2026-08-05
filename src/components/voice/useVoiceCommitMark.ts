/**
 * v0.45.0 UI③ (민구 확정 08-05) — 방금 **음성으로** 확정된 칩에 "V" 마크를 잠깐 표시하기 위한
 * 파생 상태. 중앙 '✓+항목명' 확인 라벨 삭제의 승계 표시다 — 성공 표시는 칩존이 담당한다.
 *
 *  - `valueBurst`는 음성 커밋 경로만 발행한다(수동·터치·이상치 정정은 commitReceipt) — 그 자체가
 *    "음성으로 입력된"의 판별식이다(민구: 음성 입력 칩만 V).
 *  - 표시 창은 VoiceHero의 값 플래시(CONFIRM_MS)와 같은 1.5초 — 중앙과 칩이 같은 리듬으로 꺼진다.
 *  - 마운트 시 과거 burst는 재생하지 않는다(useConfirmFlash와 같은 seq 가드 계약).
 */
import { useEffect, useRef, useState } from 'react';
import { useSessionStore } from '../../stores/sessionStore';

export const VOICE_COMMIT_MARK_MS = 1500;

/** 지금 V 마크를 표시할 칩의 colId(없으면 null). ActiveState가 구독해 ChipZone에 내린다. */
export function useVoiceCommitMarkColId(): string | null {
  const burst = useSessionStore((st) => st.valueBurst);
  const [colId, setColId] = useState<string | null>(null);
  const seenSeqRef = useRef<number | null>(null);
  useEffect(() => {
    const seq = burst?.seq ?? 0;
    if (seenSeqRef.current === null) { seenSeqRef.current = seq; return; } // 마운트 시 재생 안 함
    if (!burst || seq === seenSeqRef.current) return;
    seenSeqRef.current = seq;
    if (!burst.colId) return; // 구 발행 경로(colId 미동봉) 방어 — 마크 없음
    setColId(burst.colId);
    const t = window.setTimeout(() => setColId(null), VOICE_COMMIT_MARK_MS);
    return () => window.clearTimeout(t);
  }, [burst]);
  return colId;
}
