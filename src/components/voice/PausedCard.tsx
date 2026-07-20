import { T } from '../../tokens';
import { ABSORB_CLAMP } from './heroLayout';
import { useFitScale } from './useFitScale';

/** v0.15.0 A5 → v0.36.0 코덱스 시안(2026-07-20, 민구 확정) — 일시정지 상태 표시. 카드 chrome(배경
 *  박스·테두리) 제거 — hero와 같은 문법으로 [주황 pause 심볼 원] + [행·항목 대형] + [안내]만 남긴다.
 *  화면 전체의 주황 엣지글로우(2.4s 호흡) + 파형 주황 평선이 상태를 함께 말한다(§5.2).
 *  v0.27.0 무스크롤 계약 유지: vh/vw clamp + useFitScale로 스크롤 잔여 0(양손 측정 중 스크롤 불가).
 *  data-testid="paused-card"·aria-live 불변. */
export function PausedCard({ row, colName }: { row?: number; colName?: string }) {
  const fitRef = useFitScale<HTMLDivElement>([row, colName]);
  const target = row && colName ? `${row}행 · ${colName}` : colName || (row ? `${row}행` : '');
  return (
    <div
      ref={fitRef}
      data-testid="paused-card"
      aria-live="polite"
      style={{
        maxWidth: 'min(560px, 94vw)', width: '100%', ...ABSORB_CLAMP,
        padding: 'clamp(8px, 1.6vh, 16px) clamp(16px, 5vw, 30px)',
        display: 'flex', flexDirection: 'column', gap: 'clamp(8px, 1.6vh, 14px)', alignItems: 'center',
        textAlign: 'center',
      }}
    >
      <PauseBadge />
      <span
        style={{
          fontSize: 'max(14px, calc(clamp(17px, min(4.6vw, 2.6vh), 24px) * var(--fit-lo, 1)))',
          fontWeight: 900,
          color: T.amber,
          letterSpacing: -0.2,
          lineHeight: 1.12,
          wordBreak: 'keep-all',
        }}
      >
        일시정지
      </span>
      {target && (
        <span
          style={{
            fontSize: 'calc(clamp(30px, min(10vw, 6.6vh), 54px) * var(--fit-hi, 1))',
            fontWeight: 950,
            color: T.text,
            letterSpacing: -0.8,
            lineHeight: 1.06,
            wordBreak: 'keep-all',
            overflowWrap: 'anywhere',
            textAlign: 'center',
            maxWidth: '100%',
          }}
        >
          {target}
        </span>
      )}
      <span
        style={{
          fontSize: 'max(13px, calc(clamp(15px, min(4vw, 2.3vh), 20px) * var(--fit-lo, 1)))',
          color: T.textDim,
          fontWeight: 800,
          lineHeight: 1.2,
          wordBreak: 'keep-all',
        }}
      >
        재시작 또는 종료
      </span>
    </div>
  );
}

/** 주황 pause 심볼 원(76~82px, 5px stroke — hero 상태 심볼과 동일 문법, §6.1). */
function PauseBadge() {
  const size = 'clamp(56px, min(18vw, 9vh), 82px)';
  return (
    <span
      aria-hidden
      style={{
        flexShrink: 0,
        width: size, height: size, minWidth: size, borderRadius: '50%',
        border: `5px solid ${T.amber}`,
        boxShadow: `0 0 18px ${T.amberGlow}`,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <svg viewBox="0 0 24 24" width="46%" height="46%" fill={T.amber}>
        <rect x="7" y="5" width="3.6" height="14" rx="1.4" />
        <rect x="13.4" y="5" width="3.6" height="14" rx="1.4" />
      </svg>
    </span>
  );
}
