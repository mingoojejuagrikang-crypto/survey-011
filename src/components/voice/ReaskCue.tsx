import { T } from '../../tokens';

/** v0.23.0 입력탭#2(재질문 사유 큐, Vance) — 상단 인식률 %(허용범위 기준 색)와 **구분되는** 짧은
 *  사유 큐. 인식률은 높은데도 재질문되는 경우(파싱 실패) vs 신뢰도 자체가 낮은 경우를 사용자가 알게
 *  한다("왜 또 물어보지?" 혼란 해소). reaskReason은 sessionStore(Mack 소유)에서 읽으며, Mack이
 *  null로 리셋하면 자동으로 사라진다. listening hero의 하위 보조선으로 두어 4-way 상호배타(일시정지
 *  /이상치/수정/hero)와 경쟁하지 않는다 — hero가 보일 때만(=듣는 중) 함께 노출된다.
 *   - 'low_confidence' → "신뢰도 낮음 — 다시 또렷이"(소음·잡음으로 신뢰도 미달)
 *   - 'parse_failed'   → "숫자 인식 실패 — 다시 또렷이"(인식은 됐으나 숫자로 파싱 불가) */
export type ReaskReason = 'low_confidence' | 'parse_failed' | null;

const REASK_COPY: Record<NonNullable<ReaskReason>, { icon: string; text: string }> = {
  low_confidence: { icon: '🔊', text: '신뢰도 낮음 — 다시 또렷이' },
  parse_failed: { icon: '↺', text: '숫자 인식 실패 — 다시 또렷이' },
};

export function ReaskCue({ reason }: { reason: ReaskReason }) {
  if (!reason) return null;
  const copy = REASK_COPY[reason];
  return (
    <div
      data-testid="reask-cue"
      data-reason={reason}
      role="status"
      aria-live="assertive"
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        maxWidth: '100%',
        padding: '6px 14px', borderRadius: 999,
        background: 'rgba(255,179,0,0.14)', border: `1px solid ${T.amber}`,
        color: T.amber, fontWeight: 800,
        fontSize: 'clamp(14px, 4.2vw, 17px)', letterSpacing: -0.2, lineHeight: 1.25,
        // 긴 사유도 좁은 기기에서 줄바꿈(잘림 0).
        wordBreak: 'keep-all', overflowWrap: 'anywhere', textAlign: 'center',
      }}
    >
      <span aria-hidden style={{ flexShrink: 0 }}>{copy.icon}</span>
      <span>{copy.text}</span>
    </div>
  );
}
