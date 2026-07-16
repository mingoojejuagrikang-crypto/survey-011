import { useMemo, useState } from 'react';
import { T } from '../../tokens';
import { I } from '../icons';
import type { Session } from '../../types';
import { Backdrop } from './Backdrop';
import { Checkbox } from './Checkbox';

// ─── export modal ─────────────────────────────────────────────
// 통합 내보내기 모달 (v0.12): 세션을 선택하고 CSV 또는 로그 ZIP으로 기기에 다운로드.
// SyncSessionModal의 세션 선택 UI 패턴을 재사용하되, 기본 전체 선택 + 전체 선택 토글을 추가.
export function ExportModal({
  sessions, onCancel, onExport,
}: {
  sessions: Session[];
  onCancel: () => void;
  onExport: (ids: string[], format: 'csv' | 'zip') => void;
}) {
  const allIds = useMemo(() => sessions.map((s) => s.id), [sessions]);
  // 내보내기는 전체 내보내기가 기본 (시트 추가와 달리 미동기화 필터 불필요)
  const [selected, setSelected] = useState<Set<string>>(new Set(allIds));
  const allSelected = selected.size === sessions.length && sessions.length > 0;
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(allIds));

  return (
    <Backdrop onClose={onCancel}>
      <div
        style={{
          background: T.card, borderRadius: 18, border: `1px solid ${T.line}`,
          width: '100%', maxWidth: 360, maxHeight: '78vh',
          display: 'flex', flexDirection: 'column',
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            padding: '14px 16px',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            borderBottom: `1px solid ${T.line}`,
          }}
        >
          <div style={{ fontSize: 17, fontWeight: 700, color: T.text }}>기기로 내보내기</div>
          <button
            onClick={onCancel}
            style={{
              width: 36, height: 36, borderRadius: 18,
              border: 'none', background: 'rgba(255,255,255,0.06)',
              color: T.textDim, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            {I.close(18, T.textDim)}
          </button>
        </div>

        {/* 전체 선택 토글 */}
        {sessions.length > 0 && (
          <button
            onClick={toggleAll}
            style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '10px 14px',
              background: 'transparent', border: 'none', color: 'inherit',
              borderBottom: `1px solid ${T.line}`,
              cursor: 'pointer', textAlign: 'left',
            }}
          >
            <Checkbox checked={allSelected} />
            <span style={{ fontSize: 14, fontWeight: 700, color: T.textDim }}>
              전체 선택 ({selected.size}/{sessions.length})
            </span>
          </button>
        )}

        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 12px' }}>
          {sessions.length === 0 ? (
            <div style={{ padding: 20, textAlign: 'center', color: T.textMute }}>세션 없음</div>
          ) : (
            sessions.map((s) => {
              const checked = selected.has(s.id);
              return (
                <button
                  key={s.id}
                  onClick={() => toggle(s.id)}
                  style={{
                    width: '100%',
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '12px 10px',
                    background: 'transparent', border: 'none', color: 'inherit',
                    borderBottom: `1px solid ${T.line}`,
                    cursor: 'pointer', textAlign: 'left',
                  }}
                >
                  <Checkbox checked={checked} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 15, fontWeight: 700, color: T.text,
                        fontFamily: 'JetBrains Mono, ui-monospace, monospace',
                      }}
                    >
                      {s.date}
                      {s.label && (
                        <span style={{ marginLeft: 8, fontSize: 12, color: T.textMute, fontFamily: 'inherit' }}>
                          {s.label}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: T.textMute, marginTop: 2 }}>
                      {s.completedRows}행
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>

        <div
          style={{
            padding: '10px 16px',
            borderTop: `1px solid ${T.line}`,
            display: 'flex', flexDirection: 'column', gap: 10,
          }}
        >
          <div style={{ fontSize: 12, color: T.textMute, padding: '2px 0' }}>
            형식을 선택하면 즉시 기기로 다운로드됩니다.
          </div>
          {/* 형식별 다운로드 버튼 — 각 기능에 버튼 하나 */}
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              onClick={() => onExport([...selected], 'csv')}
              disabled={selected.size === 0}
              style={{
                flex: 1, height: 48, borderRadius: 14, border: 'none',
                background: selected.size === 0 ? '#2A2D32' : T.blue,
                color: selected.size === 0 ? T.textMute : '#fff',
                fontSize: 14, fontWeight: 800, letterSpacing: -0.2,
                cursor: selected.size === 0 ? 'not-allowed' : 'pointer',
                boxShadow: selected.size === 0 ? 'none' : `0 4px 14px ${T.blueGlow}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              }}
            >
              {I.download(16, selected.size === 0 ? T.textMute : '#fff')} CSV
            </button>
            <button
              onClick={() => onExport([...selected], 'zip')}
              disabled={selected.size === 0}
              style={{
                flex: 1, height: 48, borderRadius: 14,
                border: `1px solid ${T.lineStrong}`,
                background: T.card,
                color: selected.size === 0 ? T.textMute : T.text,
                fontSize: 14, fontWeight: 800, letterSpacing: -0.2,
                cursor: selected.size === 0 ? 'not-allowed' : 'pointer',
                opacity: selected.size === 0 ? 0.6 : 1,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              }}
            >
              {I.download(16, selected.size === 0 ? T.textMute : T.text)} 사용자 로그
            </button>
          </div>
          <button
            onClick={onCancel}
            style={{
              height: 44, borderRadius: 14,
              border: `1px solid ${T.lineStrong}`, background: 'transparent',
              color: T.textDim, fontSize: 14, fontWeight: 700, cursor: 'pointer',
            }}
          >
            취소
          </button>
        </div>
      </div>
    </Backdrop>
  );
}
