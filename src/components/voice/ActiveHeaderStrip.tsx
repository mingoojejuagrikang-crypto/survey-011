import { T } from '../../tokens';

/** 와이어프레임 상단 스트립 — `[5/18행]  진행 ====------   (?)`, 상태에 따라 우측에
 *  **"일시정지"**(§[3]) / **"완료"**(§[4]) 배지가 함께 붙는다.
 *
 *  ⚠️ 와이어프레임 §[3]·§[4]는 `(?)` 자리에 상태 텍스트를 그렸지만, 여기서는 **둘 다** 둔다.
 *  `?`가 명령어 도움말의 유일한 터치 경로이고, 일시정지 화면에서도 도움말/조절판이 보여야 한다는
 *  기존 계약(HANDOFF 이월 [Medium] "일시정지 중 UI 음성명령")이 살아 있기 때문이다. 도움말 접근을
 *  상태에 따라 없애는 것은 와이어프레임의 의도가 아니라고 판단했다 — 보고서에 명시한다. */
export function ActiveHeaderStrip({
  row, totalRows, progressPct, progressAccent, paused, endReached, onOpenHelp,
}: {
  row: number;
  totalRows: number;
  progressPct: number;
  progressAccent: string;
  paused: boolean;
  endReached: boolean;
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
      {/* 와이어프레임 §[3] — 상단 "일시정지" 표시. 종전엔 중앙 대형 카드(PausedCard)가 이 역할을
          겸했지만 §[3]이 **중앙 비움**을 확정했으므로 상태 표시만 여기로 올라온다.
          `data-testid="paused-card"`는 "일시정지 상태 표시"라는 계약 그대로 이 노드가 승계한다
          (여러 스펙이 이 노드로 일시정지 진입을 판정한다 — 셀렉터 계약 보존). */}
      {paused && <StatusBadge testId="paused-card" text="일시정지" color={T.amber} />}
      {endReached && <StatusBadge testId="session-complete-badge" text="완료" color={T.green} />}
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

function StatusBadge({ testId, text, color }: { testId: string; text: string; color: string }) {
  return (
    <span
      data-testid={testId}
      aria-live="polite"
      style={{
        flexShrink: 0,
        padding: '4px 10px', borderRadius: 999,
        border: `1px solid ${color}`,
        color,
        fontSize: 14, fontWeight: 900, letterSpacing: -0.2, whiteSpace: 'nowrap',
      }}
    >
      {text}
    </span>
  );
}
