import { T } from '../../tokens';

/** v0.9.0 이상치 알람 팝업 — 발화만으론 스쳐 지나가 확인이 어렵다는 요청. 이전값→현재값과 변화량
 *  (절대차 또는 %)을 상단에 띄우고, '확인'/'유지'/새 값 입력 또는 다음 필드 진입 시 해제(store에서).
 *  v0.10.0 A2: 화면 수직 중앙 + 1.3× 확대(화면 안 가드: min(560px,94vw)/88vh/overflowY).
 *  v0.12.0 AREA2:
 *   - V2: 어떤 샘플·행을 보는지(`샘플: <키>` 또는 `행 N` 폴백)와, 직전 값이 어느 조사 회차의
 *     것인지(`직전 (YYYY-MM-DD)` ISO 날짜 라벨 — prevDate 있을 때만)를 표시. 샘플키가 길어도
 *     박스를 넘지 않게 word-break.
 *   - V3: 색을 RED로 통일(증가=amber 분기 제거). 방향은 '증가/감소' 텍스트로만 전달. */
export function AnomalyAlertPopup({
  a,
}: {
  a: {
    colName: string;
    prev: string;
    next: string;
    direction: 'up' | 'down';
    changeText: string;
    row: number;
    sampleKey?: string;
    prevDate?: string;
  };
}) {
  const up = a.direction === 'up';
  // V3 — 톤 RED 통일(이전: up ? T.red : T.amber). 방향은 아래 증가/감소 텍스트로만 전달.
  const accent = T.red;
  return (
    <div
      data-testid="anomaly-alert"
      aria-live="assertive"
      style={{
        position: 'fixed', inset: 0, zIndex: 45,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px', pointerEvents: 'none',
      }}
    >
      <div
        style={{
          maxWidth: 'min(560px, 94vw)', maxHeight: '88vh', overflowY: 'auto',
          padding: '20px 28px', borderRadius: 18,
          background: 'rgba(34,18,18,0.96)', border: `2px solid ${accent}`,
          boxShadow: '0 10px 36px rgba(0,0,0,0.5)',
          display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'center',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 20, fontWeight: 800, color: T.text }}>{a.colName} 이상치</span>
          <span style={{ fontSize: 19, fontWeight: 800, color: accent }}>
            {a.changeText ? `${a.changeText} ` : ''}{up ? '증가' : '감소'}
          </span>
        </div>
        {/* V2 — 어떤 샘플/행을 보는지. 샘플키 미상이면 '행 N' 폴백. 긴 키도 박스 안에서 줄바꿈. */}
        <div
          style={{
            fontSize: 14, color: T.textDim, fontWeight: 600, textAlign: 'center',
            lineHeight: 1.4, maxWidth: '100%', wordBreak: 'break-all', overflowWrap: 'anywhere',
          }}
        >
          샘플: {a.sampleKey || `행 ${a.row}`}
        </div>
        <div
          style={{
            display: 'flex', alignItems: 'flex-end', gap: 12,
            fontFamily: 'JetBrains Mono, ui-monospace, monospace',
          }}
        >
          {/* V2 — 직전 값을 그 회차 날짜로 라벨링(prevDate 있을 때만 날짜 표기). */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
            <span
              style={{
                fontSize: 12, fontWeight: 700, color: T.textMute, letterSpacing: -0.2,
                fontFamily: 'system-ui, sans-serif',
              }}
            >
              직전{a.prevDate ? ` (${a.prevDate})` : ''}
            </span>
            <span style={{ fontSize: 30, fontWeight: 800, color: T.textDim }}>{a.prev}</span>
          </div>
          <span style={{ fontSize: 24, color: T.textMute, paddingBottom: 4 }}>→</span>
          <span style={{ fontSize: 'clamp(40px, 11vw, 60px)', fontWeight: 900, color: T.text, letterSpacing: -0.5 }}>
            {a.next}
          </span>
        </div>
        <div style={{ fontSize: 15, color: T.textDim, fontWeight: 600 }}>'확인' 또는 새 값으로 정정</div>
      </div>
    </div>
  );
}
