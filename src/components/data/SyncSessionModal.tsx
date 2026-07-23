import { useMemo, useState } from 'react';
import { T } from '../../tokens';
import { I } from '../icons';
import type { Session } from '../../types';
import { sessionPending, isSessionSyncBlocked } from '../../lib/sessionSync';
import { useSessionStore } from '../../stores/sessionStore';
import { Backdrop } from './Backdrop';
import { Checkbox } from './Checkbox';

// ─── sync session modal ───────────────────────────────────────
export function SyncSessionModal({
  sessions, onCancel, onConfirm,
}: {
  sessions: Session[];
  onCancel: () => void;
  onConfirm: (ids: string[], autoDelete: boolean) => void;
}) {
  const recordingSessionId = useSessionStore((s) => s.sessionId);
  const recordingPhase = useSessionStore((s) => s.phase);
  const availableSessions = useMemo(
    () => sessions.filter((s) => !isSessionSyncBlocked(s.id, recordingSessionId, recordingPhase)),
    [sessions, recordingSessionId, recordingPhase],
  );
  const excludedCount = sessions.length - availableSessions.length;
  const defaultIds = useMemo(
    () => availableSessions.filter((s) => sessionPending(s) > 0).map((s) => s.id),
    [availableSessions],
  );
  const [selected, setSelected] = useState<Set<string>>(new Set(defaultIds));
  const availableIds = useMemo(() => new Set(availableSessions.map((s) => s.id)), [availableSessions]);
  const selectedIds = [...selected].filter((id) => availableIds.has(id));
  const [autoDelete, setAutoDelete] = useState(false);
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

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
          <div style={{ fontSize: 17, fontWeight: 700, color: T.text }}>추가할 세션 선택</div>
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
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 12px' }}>
          {excludedCount > 0 && (
            <div
              role="status"
              style={{
                margin: '4px 2px 8px', padding: '10px 12px', borderRadius: 10,
                color: T.textDim, background: 'rgba(255,255,255,0.05)', fontSize: 13, lineHeight: 1.45,
              }}
            >
              입력 중이거나 일시정지된 세션 {excludedCount}개는 입력을 끝낸 뒤 업로드할 수 있습니다.
            </div>
          )}
          {availableSessions.length === 0 ? (
            <div style={{ padding: 20, textAlign: 'center', color: T.textMute }}>세션 없음</div>
          ) : (
            availableSessions.map((s) => {
              const checked = selected.has(s.id);
              const pending = sessionPending(s);
              const fullySynced = pending === 0 && s.completedRows > 0;
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
                      {fullySynced ? ' · ✓ 업로드완료' : pending > 0 ? ` · ${pending}행 변경` : ''}
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
          {/* Log backup notice shown before every sync */}
          <div style={{ fontSize: 12, color: T.textMute, padding: '2px 0' }}>
            시트 추가 시 해당 세션의 음성 로그가 Drive에 자동 백업됩니다.
          </div>
          {/* Auto-delete toggle */}
          <button
            onClick={() => setAutoDelete((v) => !v)}
            style={{
              display: 'flex', alignItems: 'center', gap: 10,
              background: 'transparent', border: 'none', cursor: 'pointer',
              padding: '4px 0', color: 'inherit',
            }}
          >
            <div
              style={{
                width: 20, height: 20, borderRadius: 4, flexShrink: 0,
                border: `2px solid ${autoDelete ? T.red : T.lineStrong}`,
                background: autoDelete ? 'rgba(255,82,82,0.15)' : 'transparent',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              {autoDelete && I.check(12, T.red)}
            </div>
            <span style={{ fontSize: 13, color: T.textDim }}>업로드 성공 시 세션 삭제</span>
          </button>
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              onClick={onCancel}
              style={{
                flex: 1, height: 48, borderRadius: 14,
                border: `1px solid ${T.lineStrong}`, background: 'transparent',
                color: T.textDim, fontSize: 15, fontWeight: 700, cursor: 'pointer',
              }}
            >
              취소
            </button>
            <button
              onClick={() => onConfirm(selectedIds, autoDelete)}
              disabled={selectedIds.length === 0}
              style={{
                flex: 1, height: 48, borderRadius: 14, border: 'none',
                background: selectedIds.length === 0 ? '#2A2D32' : T.blue,
                color: selectedIds.length === 0 ? T.textMute : '#fff',
                fontSize: 15, fontWeight: 800, letterSpacing: -0.2,
                cursor: selectedIds.length === 0 ? 'not-allowed' : 'pointer',
                boxShadow: selectedIds.length === 0 ? 'none' : `0 4px 14px ${T.blueGlow}`,
              }}
            >
              추가 ({selectedIds.length})
            </button>
          </div>
        </div>
      </div>
    </Backdrop>
  );
}
