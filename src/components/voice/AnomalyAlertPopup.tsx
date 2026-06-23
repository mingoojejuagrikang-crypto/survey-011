import { T } from '../../tokens';

/** v0.9.0 이상치 알람 팝업 — 발화만으론 스쳐 지나가 확인이 어렵다는 요청. 이전값→현재값과 변화량
 *  (절대차 또는 %)을 상단에 띄우고, '확인'/'유지'/새 값 입력 또는 다음 필드 진입 시 해제(store에서).
 *  v0.10.0 A2: 화면 수직 중앙 + 1.3× 확대(화면 안 가드: min(560px,94vw)/88vh/overflowY).
 *  v0.12.0 AREA2:
 *   - V2: 어떤 샘플·행을 보는지(`샘플: <키>` 또는 `행 N` 폴백)와, 직전 값이 어느 조사 회차의
 *     것인지(`직전 (YYYY-MM-DD)` ISO 날짜 라벨 — prevDate 있을 때만)를 표시. 샘플키가 길어도
 *     박스를 넘지 않게 word-break.
 *   - V3: 색을 RED로 통일(증가=amber 분기 제거). 방향은 '증가/감소' 텍스트로만 전달.
 *  v0.13.0:
 *   - R3(민구 요청): hero 현재값(가장 큰 숫자) 바로 위에 측정 항목명을 라벨로 붙인다. 정수값(예 120)이
 *     화면 최대 요소일 때 상단 헤더와 시선이 떨어져 '어느 항목 값인가'가 즉시 안 보이던 문제 해소.
 *     직전값/현재값을 '라벨 + 값' 2단 대칭 구조로 만든다.
 *   - R2(민구 요청): status='corrected'면 톤을 GREEN으로 바꾸고 헤더를 '정상 복귀'로, 현재값을 정정값
 *     으로 즉시 반영한다(정정 재측정이 정상으로 판명된 경우). 빨강(이상치)↔초록(정정완료) 구분. */
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
    status?: 'pending' | 'corrected';
  };
}) {
  const up = a.direction === 'up';
  const corrected = a.status === 'corrected';
  // R2 — corrected(정정 후 정상)면 GREEN, 그 외(이상치 대기)는 RED 통일(V3).
  const accent = corrected ? T.green : T.red;
  return (
    <div
      data-testid="anomaly-alert"
      data-status={corrected ? 'corrected' : 'pending'}
      aria-live="assertive"
      style={{
        position: 'fixed', inset: 0, zIndex: 45,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px', pointerEvents: 'none',
      }}
    >
      <div
        style={{
          maxWidth: 'min(620px, 96vw)', maxHeight: '90vh', overflowY: 'auto',
          padding: '24px 30px', borderRadius: 18,
          background: corrected ? 'rgba(18,34,22,0.96)' : 'rgba(34,18,18,0.96)',
          border: `2px solid ${accent}`,
          boxShadow: '0 10px 36px rgba(0,0,0,0.5)',
          display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'center',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 20, fontWeight: 800, color: T.text }}>
            {a.colName} {corrected ? '정상 복귀' : '추세 알림'}
          </span>
          <span style={{ fontSize: 19, fontWeight: 800, color: accent }}>
            {corrected ? '정상' : `${a.changeText ? `${a.changeText} ` : ''}${up ? '증가' : '감소'}`}
          </span>
        </div>
        {/* V2 — 어떤 샘플/행을 보는지. 샘플키 미상이면 '행 N' 폴백. 긴 키도 박스 안에서 줄바꿈.
            v0.18.0 1d — 원거리 가독: 샘플 식별 줄을 키우고 대비 보강(textDim→text). */}
        <div
          style={{
            fontSize: 'clamp(15px, 4.4vw, 17px)', color: T.text, fontWeight: 700, textAlign: 'center',
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
                fontSize: 13, fontWeight: 700, color: T.textDim, letterSpacing: -0.2,
                fontFamily: 'system-ui, sans-serif',
              }}
            >
              직전{a.prevDate ? ` (${a.prevDate})` : ''}
            </span>
            {/* v0.18.0 1d — 직전값 대비 보강(textDim→text 인접 대비 위해 크기 유지·굵게). */}
            <span style={{ fontSize: 'clamp(30px, 8vw, 36px)', fontWeight: 800, color: T.textDim }}>{a.prev}</span>
          </div>
          <span style={{ fontSize: 26, color: T.textDim, paddingBottom: 4 }}>→</span>
          {/* R3 — hero 현재값 위에 항목명 라벨(accent색)을 붙여 정수값도 어느 항목인지 즉시 식별. */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
            <span
              style={{
                fontSize: 13, fontWeight: 800, color: accent, letterSpacing: -0.2,
                fontFamily: 'system-ui, sans-serif', maxWidth: 'min(280px, 60vw)',
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}
            >
              {a.colName}
            </span>
            <span style={{ fontSize: 'clamp(40px, 11vw, 60px)', fontWeight: 900, color: T.text, letterSpacing: -0.5 }}>
              {a.next}
            </span>
          </div>
        </div>
        <div style={{ fontSize: 15, color: corrected ? T.green : T.textDim, fontWeight: 600 }}>
          {corrected ? '✓ 정정되었습니다' : "'확인' 또는 새 값으로 정정"}
        </div>
      </div>
    </div>
  );
}
