import { T } from '../../tokens';

/** 상단 스트립 — 행 진행값 + 진행바 + 상시 도움말.
 *
 *  v0.43.0 UI-c: 일시정지·완료 배지는 도트 문양·톤·진행바가 이미 말하는 시각 중복이라 제거했다.
 *  접근성 상태명은 `CenterStage`의 aria-only paused surface와 `CompleteSummary`의 `aria-label`이
 *  맡는다. `?`는 상태와 무관하게 언제나 같은 자리에 남는다(GL-007 원칙 3). */
export function ActiveHeaderStrip({
  row, totalRows, progressPct, progressAccent, onOpenHelp,
}: {
  row: number;
  totalRows: number;
  progressPct: number;
  progressAccent: string;
  onOpenHelp: () => void;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px 4px' }}>
      <div
        style={{
          display: 'inline-flex', alignItems: 'baseline', gap: 4,
          padding: '3px 10px', borderRadius: 999,
          background: T.cardAlt, border: `1px solid ${T.lineStrong}`,
          whiteSpace: 'nowrap',
          fontFamily: 'JetBrains Mono, ui-monospace, monospace',
        }}
      >
        <span data-testid="active-row" style={{ fontSize: 18, fontWeight: 800, color: T.text, letterSpacing: -0.5, lineHeight: 1.2 }}>
          {row}
        </span>
        <span style={{ fontSize: 13, fontWeight: 700, color: T.textMute }}>/ {totalRows}행</span>
      </div>
      <div style={{ flex: 1, position: 'relative', height: 4, borderRadius: 2, background: T.line, minWidth: 0 }}>
        <div
          style={{
            position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 2,
            width: `${progressPct}%`,
            background: progressAccent,
            transition: 'width 400ms ease-out, background 200ms',
          }}
        />
      </div>
      <button
        type="button"
        onClick={onOpenHelp}
        aria-label="음성 명령어 도움말"
        title="음성 명령어 도움말"
        style={{
          // 44px 최소 터치 타깃(PRINCIPLES §2 장갑 조작).
          width: 44, height: 44, borderRadius: '50%',
          border: `1px solid ${T.lineStrong}`,
          background: 'transparent',
          color: T.textMute,
          fontSize: 18, fontWeight: 900,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', flexShrink: 0,
        }}
      >
        ?
      </button>
    </div>
  );
}
