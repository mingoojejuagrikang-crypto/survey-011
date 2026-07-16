import { Fragment } from 'react';
import { T } from '../../tokens';
import type { Column, Session } from '../../types';
import { EditableCell } from './EditableCell';
import { ClipCell } from './ClipCell';

// ─── full editable table ─────────────────────────────────────
export function FullRowTable({
  session, onCellSave, tableMaxHeight = 360,
}: {
  session: Session;
  onCellSave: (rowIndex: number, colId: string, value: string) => void;
  /** v0.13.0 R5 — 상세 모달에서는 표를 더 크게(예: 'calc(90vh - 150px)'). 기본은 인라인 시절 360. */
  tableMaxHeight?: number | string;
}) {
  const cols = session.columns;
  const rows = session.rows;
  const colWidthFor = (c: Column) =>
    c.type === 'date' ? 110 : c.type === 'text' || c.type === 'name' ? 140 : c.type === 'options' ? 100 : 80;
  // v0.33.0 #9 — 값/클립 컬럼 분리(07-10 QA P1). 재생 버튼이 값 셀 안에 붙어 있어 값을 탭하려다
  // 클립을 오터치하던 구조를 해체: 클립이 하나라도 있는 voice 컬럼 오른쪽에 44px 클립 전용 컬럼을
  // 렌더하고, 값 셀(EditableCell)은 값 전용으로 만든다. 클립 없는 세션은 컬럼 자체가 안 생긴다.
  const clipColIds = cols
    .filter((c) => c.input === 'voice' && rows.some((r) => !!r.audioClips?.[c.id]))
    .map((c) => c.id);

  return (
    <div
      style={{
        padding: 10,
        background: 'rgba(255,255,255,0.015)',
        animation: 'fade-up 200ms ease-out',
        flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column',
      }}
    >
      <div
        style={{
          maxHeight: tableMaxHeight, overflow: 'auto',
          WebkitOverflowScrolling: 'touch',
          border: `1px solid ${T.line}`, borderRadius: 8,
        }}
      >
        <div style={{ minWidth: 'max-content' }}>
          <div
            style={{
              display: 'flex',
              position: 'sticky', top: 0, zIndex: 2,
              background: T.card,
              borderBottom: `1px solid ${T.line}`,
            }}
          >
            <div
              style={{
                width: 40, padding: '8px 6px',
                fontSize: 12, fontWeight: 700, color: T.textMute,
                textAlign: 'center', position: 'sticky', left: 0, background: T.card, zIndex: 3,
                borderRight: `1px solid ${T.line}`,
              }}
            >
              #
            </div>
            {cols.map((c) => (
              <Fragment key={c.id}>
                <div
                  style={{
                    width: colWidthFor(c), padding: '8px 8px',
                    fontSize: 12, fontWeight: 700, color: T.textDim,
                    borderRight: `1px solid ${T.line}`,
                    whiteSpace: 'normal', wordBreak: 'break-word', overflowWrap: 'anywhere',
                  }}
                >
                  {c.name}
                </div>
                {clipColIds.includes(c.id) && (
                  <div
                    data-testid={`clip-col-header-${c.id}`}
                    title={`${c.name} 음성 클립`}
                    style={{
                      width: 44, flexShrink: 0, padding: '8px 4px',
                      fontSize: 11, fontWeight: 700, color: T.textMute,
                      textAlign: 'center', whiteSpace: 'nowrap',
                      borderRight: `1px solid ${T.line}`,
                    }}
                  >
                    클립
                  </div>
                )}
              </Fragment>
            ))}
          </div>

          {rows.map((r) => (
            <div
              key={r.index}
              style={{ display: 'flex', borderBottom: `1px solid ${T.line}` }}
            >
              <div
                style={{
                  width: 40, padding: '8px 6px',
                  // v0.5.0 NAV-1/요청3: '다음'으로 건너뛴(미완료) placeholder 행은 행 번호를
                  // amber로 강조해 빈 행임을 한눈에 알 수 있게 한다. 셀 탭으로 채우면 된다.
                  fontSize: 13, color: r.complete === false ? T.amber : T.textMute, textAlign: 'center',
                  position: 'sticky', left: 0, background: T.card, zIndex: 1,
                  borderRight: `1px solid ${T.line}`,
                  fontFamily: 'JetBrains Mono, ui-monospace, monospace', fontWeight: 700,
                }}
                title={r.complete === false ? '미완료 행 — 셀을 탭해 채워주세요' : undefined}
              >
                {r.index}
              </div>
              {cols.map((c) => (
                <Fragment key={c.id}>
                  <EditableCell
                    col={c}
                    value={r.values[c.id] ?? ''}
                    width={colWidthFor(c)}
                    onSave={(v) => onCellSave(r.index, c.id, v)}
                  />
                  {clipColIds.includes(c.id) && (
                    <ClipCell clipKey={r.audioClips?.[c.id]} value={r.values[c.id] ?? ''} />
                  )}
                </Fragment>
              ))}
            </div>
          ))}

          {rows.length === 0 && (
            <div style={{ padding: 14, textAlign: 'center', fontSize: 13, color: T.textMute }}>
              이 세션에 저장된 행이 없습니다
            </div>
          )}
        </div>
      </div>
      <div
        style={{
          paddingTop: 8, fontSize: 12, color: T.textMute, textAlign: 'center',
        }}
      >
        {clipColIds.length > 0
          ? `총 ${rows.length}행 · 값 셀 탭=수정 · 클립 열 탭=음성 재생`
          : `총 ${rows.length}행 · 셀을 탭하면 수정할 수 있습니다`}
      </div>
    </div>
  );
}
