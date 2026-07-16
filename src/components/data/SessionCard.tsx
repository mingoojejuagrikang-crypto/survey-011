import { T } from '../../tokens';
import { I } from '../icons';
import type { Session } from '../../types';
import { sessionPending, sessionEverUploaded, sessionDirtyCount } from '../../lib/sessionSync';

// ─── session card ────────────────────────────────────────────
export function SessionCard({
  session, expanded, onToggle, onDelete, onCellSave,
}: {
  session: Session;
  expanded: boolean;
  onToggle: () => void;
  onDelete: () => void;
  onCellSave: (rowIndex: number, colId: string, value: string) => void;
}) {
  const pending = sessionPending(session);
  const fullySynced = pending === 0 && session.completedRows > 0;
  // F9: "uploaded before" is row-based, not the raw syncedRows counter — a session whose uploaded
  // rows were all edited since (now 'dirty', syncedRows=0) must still read as partial, not 미업로드.
  const everUploaded = sessionEverUploaded(session);
  const partial = everUploaded && !fullySynced;
  const dirtyCount = sessionDirtyCount(session);
  const syncIcon = fullySynced
    ? I.cloudCheck(16, T.green)
    : partial
    ? I.cloud(16, T.amber)
    : I.cloudOff(16, T.textMute);
  // Label: fully synced → 업로드완료. Partial with edits-since → "N행 변경" (distinct amber state).
  // Partial without edits (some rows just not uploaded yet) → "synced/completed" progress.
  const syncLabel = fullySynced
    ? '업로드완료'
    : partial
    ? (dirtyCount > 0 ? `${dirtyCount}행 변경` : `${session.syncedRows}/${session.completedRows}`)
    : '미업로드';
  const syncColor = fullySynced ? T.green : partial ? T.amber : T.textMute;
  // v0.33.0 #9 — 완료/작성중 구분(07-10 QA P1 #4). 부분입력 세션이 "0행"으로만 보여 데이터가
  // 없다고 오판·삭제할 위험 → 미완료 행이 있으면 amber '작성중 N' 배지를 완료 배지 옆에 표시.
  const draftRows = Math.max(0, session.rows.length - session.completedRows);

  return (
    <div
      style={{
        background: T.card, borderRadius: 12,
        border: `1px solid ${expanded ? 'rgba(41,121,255,0.4)' : T.line}`,
        overflow: 'hidden',
        transition: 'border 200ms',
        flexShrink: 0,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'stretch' }}>
        <button
          onClick={onToggle}
          style={{
            flex: 1, border: 'none', background: 'transparent',
            padding: '14px 14px',
            display: 'flex', alignItems: 'center', gap: 12,
            cursor: 'pointer', textAlign: 'left', color: 'inherit', minHeight: 56,
            minWidth: 0, overflow: 'hidden',
          }}
        >
          <div>
            <div
              style={{
                fontSize: 16, fontWeight: 700, color: T.text,
                letterSpacing: -0.2,
                fontFamily: 'JetBrains Mono, ui-monospace, monospace',
                whiteSpace: 'nowrap',
              }}
            >
              {session.date}
            </div>
            {session.label && (
              <div style={{ fontSize: 13, color: T.textMute, marginTop: 3 }}>{session.label}</div>
            )}
          </div>
          <div style={{ flex: 1 }} />
          <div
            style={{
              display: 'flex', alignItems: 'baseline', gap: 4,
              padding: '6px 12px', borderRadius: 10,
              background: 'rgba(255,255,255,0.04)',
            }}
          >
            <span
              style={{
                fontSize: 18, fontWeight: 800, color: T.text,
                fontFamily: 'JetBrains Mono, ui-monospace, monospace',
              }}
            >
              {session.completedRows}
            </span>
            <span style={{ fontSize: 13, color: T.textMute, fontWeight: 600 }}>행</span>
          </div>
          {draftRows > 0 && (
            <div
              data-testid="draft-badge"
              title={`미완료(작성중) ${draftRows}행 — 카드를 열어 이어서 채울 수 있습니다`}
              style={{
                display: 'flex', alignItems: 'baseline', gap: 4,
                padding: '6px 10px', borderRadius: 10,
                background: 'rgba(255,179,0,0.10)',
              }}
            >
              <span style={{ fontSize: 13, color: T.amber, fontWeight: 600 }}>작성중</span>
              <span
                style={{
                  fontSize: 18, fontWeight: 800, color: T.amber,
                  fontFamily: 'JetBrains Mono, ui-monospace, monospace',
                }}
              >
                {draftRows}
              </span>
            </div>
          )}
          <div
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              color: syncColor, fontSize: 13, fontWeight: 700,
            }}
          >
            {syncIcon}
            <span style={{ fontFamily: 'JetBrains Mono, ui-monospace, monospace' }}>{syncLabel}</span>
          </div>
          {/* v0.13.0 R5 — 상세는 인라인 확장이 아니라 팝업으로 연다. chevron은 '열기' 어포던스로
              유지(회전 애니메이션 제거 — 더는 펼침/접힘이 아님). */}
          <div style={{ color: expanded ? T.blue : T.textDim }}>
            {I.chevron(18, expanded ? T.blue : T.textDim)}
          </div>
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          style={{
            padding: '0 14px',
            background: 'transparent', border: 'none', borderLeft: `1px solid ${T.line}`,
            color: T.red, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0, minWidth: 44,
          }}
          title="세션 삭제"
        >
          {I.trash(18, T.red)}
        </button>
      </div>
    </div>
  );
}
