import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { T } from '../tokens';
import { I } from '../components/icons';
import { ScreenHeader } from '../components/ScreenHeader';
import { useDataStore } from '../stores/dataStore';
import { useSettingsStore } from '../stores/settingsStore';
import { syncSelected, type SyncReport, type SyncFailure } from '../lib/sync';
import { downloadCsv, sessionsToCsv } from '../lib/csv';
import { deleteSession as dbDeleteSession, saveSession, loadAudioClip, resetDb } from '../lib/db';
import type { Column, Session } from '../types';
import { exportLogZip, downloadZip } from '../lib/exportLog';
import { uploadLogToBothDrives, LOG_FOLDER_ID } from '../lib/driveUpload';
import { hydrateSessions } from '../lib/hydrate';

export function DataScreen() {
  const sessions = useDataStore((s) => s.sessions);
  const expandedSessionId = useDataStore((s) => s.expandedSessionId);
  const toggleExpand = useDataStore((s) => s.toggleExpand);
  const updateRowValue = useDataStore((s) => s.updateRowValue);
  const removeSession = useDataStore((s) => s.removeSession);
  const upsertSession = useDataStore((s) => s.upsertSession);
  const hydrationError = useDataStore((s) => s.hydrationError);

  const unsynced = sessions.filter((s) => s.syncedRows < s.completedRows).length;
  const empty = sessions.length === 0;
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [syncModalOpen, setSyncModalOpen] = useState(false);
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Session | null>(null);
  const [failureReport, setFailureReport] = useState<SyncReport | null>(null);
  // 다중 세션 로그 ZIP 내보내기 확인 대상 (v0.12 Codex MEDIUM): 여러 세션의 클립을 한 번에 압축하면
  // 용량/지연이 커질 수 있어 2개 이상일 때 확인 단계를 거친다. CSV는 가벼우니 확인 없이 즉시 진행.
  const [pendingZipIds, setPendingZipIds] = useState<string[] | null>(null);

  const lastSelectedIdsRef = useRef<string[]>([]);

  // 데이터탭을 떠나면(언마운트) 재생 중인 음성 클립 정지 — 전역 싱글톤이라 화면 밖에서 계속 재생되지 않도록 (Codex HIGH)
  useEffect(() => () => { clipPlayer.stop(); }, []);

  // 선택 세션을 로그 ZIP으로 압축해 다운로드 (직접 경로 + 확인 후 경로 공용).
  // 압축 중 busy='로그 압축 중...' 표시 — 액션바 내보내기 버튼이 busy일 때 비활성화되어 중복 클릭 차단.
  const runZipExport = useCallback(async (ids: string[]) => {
    setBusy('로그 압축 중...');
    try {
      const blob = await exportLogZip(ids);
      const filename = `growth-log_${new Date().toISOString().slice(0, 10)}_${Date.now()}.zip`;
      downloadZip(blob, filename);
      setMsg(`✓ ${filename} 다운로드됨`);
    } catch (err) {
      setMsg('로그 다운로드 실패: ' + (err as Error).message);
    } finally {
      setBusy(null);
    }
  }, []);

  // 통합 내보내기: 선택한 세션을 CSV 또는 로그 ZIP으로 기기에 다운로드 (v0.12).
  // 기존 doCsv(전체 세션 CSV) + doSessionLogDownload(개별 세션 ZIP)를 하나로 흡수.
  const handleExport = useCallback(async (ids: string[], format: 'csv' | 'zip') => {
    setExportModalOpen(false);
    const targets = useDataStore.getState().sessions.filter((s) => ids.includes(s.id));
    if (targets.length === 0) {
      setMsg('내보낼 세션을 선택하세요.');
      return;
    }
    if (format === 'csv') {
      // CSV는 가벼우니 확인 없이 즉시 생성.
      const today = new Date().toISOString().slice(0, 10);
      setBusy('CSV 생성 중...');
      try {
        const csv = sessionsToCsv(targets);
        const filename = `survey_${today}.csv`;
        downloadCsv(filename, csv);
        setMsg(`✓ ${filename} 다운로드됨`);
      } catch (err) {
        setMsg('CSV 내보내기 실패: ' + (err as Error).message);
      } finally {
        setBusy(null);
      }
    } else {
      // 로그 ZIP: 다중 세션이면 용량/지연 경고 확인을 거친 뒤 압축. 단일 세션은 기존처럼 즉시 진행.
      if (targets.length > 1) {
        setPendingZipIds(ids);
        return;
      }
      await runZipExport(ids);
    }
  }, [runZipExport]);

  const handleCellSave = async (sessionId: string, rowIndex: number, colId: string, value: string) => {
    updateRowValue(sessionId, rowIndex, colId, value);
    const updated = useDataStore.getState().sessions.find((x) => x.id === sessionId);
    if (updated) {
      try { await saveSession(updated); } catch { /* ignore */ }
    }
  };

  const runSyncInner = async (ids: string[]): Promise<{ report: SyncReport; backupOk: boolean } | null> => {
    if (ids.length === 0) return null;
    lastSelectedIdsRef.current = ids;
    setBusy('시트에 추가 중...');
    setMsg(null);
    let backupOk = false;
    try {
      const report = await syncSelected(ids);
      // 1) 시트 추가 결과 메시지
      if (report.message) {
        setMsg(report.message);
      } else if (report.failed > 0) {
        setMsg(`${report.ok}개 세션 성공, ${report.failed}개 실패 (${report.rows}행 추가됨)`);
        setFailureReport(report);
      } else if (report.ok > 0) {
        setMsg(`✓ ${report.rows}행을 시트에 추가했습니다`);
      } else {
        setMsg('추가할 새 데이터가 없습니다.');
      }

      // 2) 로그 백업: 사용자 본인 드라이브 + 관리자 폴더 양쪽 업로드 (v0.10 멀티유저).
      // v0.10.1 Codex HIGH 수정: 관리자 폴더 설정 시 admin 업로드도 성공해야 backupOk → autoDelete 차단.
      if (report.successIds.length > 0) {
        try {
          const blob = await exportLogZip(report.successIds);
          const filename = `growth-log_${new Date().toISOString().slice(0, 10)}_${Date.now()}.zip`;
          const dual = await uploadLogToBothDrives(blob, filename);
          // backupOk: 본인 Drive 필수 + 관리자 폴더 설정 시 admin Drive도 필수
          backupOk = !!dual.userDriveId && (!dual.adminConfigured || !!dual.adminDriveId);
          const parts: string[] = [];
          if (dual.userDriveId) parts.push('본인 Drive');
          if (dual.adminDriveId) parts.push('관리자 Drive');
          if (parts.length > 0) {
            setMsg((m) => (m ? `${m} · 로그 ${parts.join('+')} 백업` : `✓ 로그 ${parts.join('+')} 백업`));
          }
          if (dual.errors.length > 0) {
            const failedDests = dual.errors.map((e) => e.split(':')[0]).join(', ');
            setMsg((m) => `${m ?? ''} · ⚠️ 백업 실패: ${failedDests}`);
            console.warn('Drive 로그 부분 실패', dual.errors);
          }
        } catch (err) {
          setMsg((m) => (m ? `${m} · ⚠️ 로그 백업 실패` : '⚠️ 시트 추가 OK, 로그 백업 실패'));
          console.warn('Drive 로그 업로드 실패', err);
        }
      } else {
        // ok == 0 (전부 실패 또는 preflight) → 백업 대상 없음, backupOk false → autoDelete 차단
      }
      return { report, backupOk };
    } catch (err) {
      setMsg('실패: ' + (err as Error).message);
      return null;
    } finally {
      setBusy(null);
    }
  };

  const handleSyncConfirm = async (ids: string[], autoDelete: boolean) => {
    setSyncModalOpen(false);
    const result = await runSyncInner(ids);
    if (!result) return;
    const { report, backupOk } = result;
    // 시트 업로드 성공한 세션 자동 삭제. 로그 백업 실패 시 데이터 유실 방지를 위해 삭제 보류.
    if (autoDelete && report.ok > 0 && report.successIds.length > 0) {
      if (!backupOk) {
        setMsg((m) =>
          (m ? `${m} · ` : '') +
          `자동 삭제 보류: 로그 백업 실패로 ${report.successIds.length}개 세션을 로컬에 유지합니다.`,
        );
        return;
      }
      const successIds = report.successIds;
      clipPlayer.stop(); // 클립 IDB 삭제 전 재생 정지 — 삭제된 세션 클립이 계속 재생되지 않도록 (Codex HIGH)
      for (const id of successIds) {
        try { await dbDeleteSession(id); } catch { /* ignore */ }
        removeSession(id);
      }
      setMsg((m) => (m ? m + ` · ${successIds.length}개 세션 삭제됨` : `✓ ${successIds.length}개 세션 삭제됨`));
    }
  };

  const handleRetry = async () => {
    setFailureReport(null);
    const ids = failureReport?.failures.map((f) => f.sessionId) ?? lastSelectedIdsRef.current;
    if (ids.length) await runSyncInner(ids);
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    const id = deleteTarget.id;
    setDeleteTarget(null);
    clipPlayer.stop(); // 클립 IDB 삭제 전 재생 정지 (Codex HIGH)
    try { await dbDeleteSession(id); } catch { /* ignore */ }
    removeSession(id);
    setMsg('세션 삭제됨');
  };

  // 세션 복구: 앱 업데이트/새로고침으로 목록에서 사라져 보이는 세션을 IDB에서 다시 불러온다.
  // (v0.4.4: 입력은 값 커밋마다 증분 저장되므로 진행 중이던 행도 함께 복구됨.)
  // (v0.4.5 D1: resetDb()로 stale/끊긴 IDB 연결을 버리고 새로 열어 재시도 — 앱 업데이트 후 복구 실패 방지.)
  const handleRecoverClick = async () => {
    setMsg(null);
    setBusy('세션 복구 중...');
    try {
      const before = useDataStore.getState().sessions.length;
      resetDb();
      await hydrateSessions();
      const after = useDataStore.getState().sessions.length;
      const err = useDataStore.getState().hydrationError;
      if (err) {
        setMsg('복구 실패: ' + err);
      } else if (after > before) {
        setMsg(`✓ 세션 ${after - before}개를 복구했습니다.`);
      } else {
        setMsg(`✓ 저장된 세션 ${after}개를 모두 불러왔습니다.`);
      }
    } finally {
      setBusy(null);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <ScreenHeader title="데이터" sub={`${sessions.length}개 세션`} />

      {/* Action bar */}
      <div style={{ padding: '0 16px 10px', display: 'flex', gap: 8, flexShrink: 0 }}>
        <button
          onClick={() => setSyncModalOpen(true)}
          disabled={busy !== null || sessions.length === 0}
          style={{
            flex: 1, height: 52, borderRadius: 14, border: 'none',
            background: sessions.length === 0 ? '#2A2D32' : T.blue,
            color: '#fff', fontSize: 15, fontWeight: 800, letterSpacing: -0.2,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            cursor: sessions.length === 0 ? 'not-allowed' : 'pointer',
            position: 'relative',
            boxShadow: sessions.length === 0 ? 'none' : `0 4px 14px ${T.blueGlow}`,
            opacity: sessions.length === 0 ? 0.6 : 1,
          }}
        >
          {I.sync(18, '#fff')} 시트에 추가
          {unsynced > 0 && (
            <span
              style={{
                position: 'absolute', top: -6, right: -6,
                minWidth: 24, height: 24, padding: '0 7px',
                borderRadius: 999, background: T.amber, color: '#1a1300',
                fontSize: 12, fontWeight: 800,
                fontFamily: 'JetBrains Mono, ui-monospace, monospace',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                border: '2px solid #0E0F11',
              }}
            >
              {unsynced}
            </span>
          )}
        </button>
        <button
          onClick={handleRecoverClick}
          disabled={busy !== null}
          style={{
            height: 52, padding: '0 14px', borderRadius: 14,
            border: `1px solid ${T.lineStrong}`, background: T.card,
            color: T.text, fontSize: 13, fontWeight: 700,
            display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer',
          }}
          title="사라진 세션 복구 (저장된 기록 다시 불러오기)"
        >
          {I.download(18, T.text)} 세션 복구
        </button>
        <button
          onClick={() => setExportModalOpen(true)}
          disabled={busy !== null || sessions.length === 0}
          style={{
            height: 52, padding: '0 14px', borderRadius: 14,
            border: `1px solid ${T.lineStrong}`, background: T.card,
            color: T.text, fontSize: 13, fontWeight: 700,
            display: 'flex', alignItems: 'center', gap: 6,
            cursor: sessions.length === 0 ? 'not-allowed' : 'pointer',
            opacity: sessions.length === 0 ? 0.6 : 1,
          }}
          title="기기로 내보내기 (CSV / 로그 ZIP)"
        >
          {I.download(18, T.text)} 내보내기
        </button>
      </div>


      {/* 시트 추가 시 로그 자동 백업 안내 */}
      <div
        style={{
          padding: '0 16px 6px',
          fontSize: 11, color: T.textMute, lineHeight: 1.4, flexShrink: 0,
        }}
      >
        시트 추가 시 해당 세션의 음성 로그도 Drive에 자동 백업됩니다.{' '}
        <span
          style={{
            fontFamily: 'JetBrains Mono, ui-monospace, monospace',
            fontSize: 10, color: T.textMute,
          }}
        >
          ({LOG_FOLDER_ID.slice(0, 12)}…)
        </span>
      </div>

      {(busy || msg) && (
        <div
          style={{
            margin: '0 16px 10px',
            padding: '10px 14px', borderRadius: 10,
            background: 'rgba(255,255,255,0.04)',
            fontSize: 14, color: msg?.startsWith('✓') ? T.green : T.textDim,
            flexShrink: 0,
            display: 'flex', alignItems: 'center', gap: 10,
          }}
        >
          <span style={{ flex: 1 }}>{busy || msg}</span>
          {failureReport && failureReport.failures.length > 0 && (
            <button
              onClick={() => setFailureReport(failureReport)}
              style={{
                background: 'transparent', border: `1px solid ${T.line}`,
                color: T.text, fontSize: 12, padding: '4px 10px', borderRadius: 6,
                cursor: 'pointer',
              }}
            >
              자세히
            </button>
          )}
        </div>
      )}

      <div
        style={{
          flex: 1, minHeight: 0, padding: '0 16px 16px',
          display: 'flex', flexDirection: 'column', gap: 10,
          overflowY: 'auto', overflowX: 'hidden',
          WebkitOverflowScrolling: 'touch',
        }}
      >
        {empty ? (
          hydrationError ? (
            <LoadErrorState error={hydrationError} onRetry={() => { void hydrateSessions(); }} />
          ) : (
            <EmptyState />
          )
        ) : (
          sessions.map((s) => (
            <SessionCard
              key={s.id}
              session={s}
              expanded={expandedSessionId === s.id}
              onToggle={() => toggleExpand(s.id)}
              onDelete={() => setDeleteTarget(s)}
              onCellSave={(rowIndex, colId, value) => handleCellSave(s.id, rowIndex, colId, value)}
            />
          ))
        )}
      </div>

      {syncModalOpen && (
        <SyncSessionModal
          sessions={sessions}
          onCancel={() => setSyncModalOpen(false)}
          onConfirm={handleSyncConfirm}
        />
      )}

      {exportModalOpen && (
        <ExportModal
          sessions={sessions}
          onCancel={() => setExportModalOpen(false)}
          onExport={handleExport}
        />
      )}

      {deleteTarget && (
        <ConfirmModal
          title="세션 삭제"
          body={`${deleteTarget.date} 세션 (${deleteTarget.completedRows}행)을 삭제할까요?\n복구할 수 없습니다.`}
          confirmLabel="삭제"
          danger
          onCancel={() => setDeleteTarget(null)}
          onConfirm={handleDeleteConfirm}
        />
      )}

      {failureReport && (
        <FailureModal
          report={failureReport}
          onClose={() => setFailureReport(null)}
          onRetry={handleRetry}
        />
      )}

      {pendingZipIds && (
        <ConfirmModal
          title="음성 로그 ZIP 내보내기"
          body={`${pendingZipIds.length}개 세션의 음성 로그를 ZIP으로 압축합니다.\n용량이 크거나 시간이 걸릴 수 있어요.\n\n계속할까요?`}
          confirmLabel="압축"
          onCancel={() => setPendingZipIds(null)}
          onConfirm={() => {
            const ids = pendingZipIds;
            setPendingZipIds(null);
            void runZipExport(ids);
          }}
        />
      )}

    </div>
  );
}

// ─── sync session modal ───────────────────────────────────────
function SyncSessionModal({
  sessions, onCancel, onConfirm,
}: {
  sessions: Session[];
  onCancel: () => void;
  onConfirm: (ids: string[], autoDelete: boolean) => void;
}) {
  const defaultIds = useMemo(
    () => sessions.filter((s) => s.syncedRows < s.completedRows).map((s) => s.id),
    [sessions],
  );
  const [selected, setSelected] = useState<Set<string>>(new Set(defaultIds));
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
          {sessions.length === 0 ? (
            <div style={{ padding: 20, textAlign: 'center', color: T.textMute }}>세션 없음</div>
          ) : (
            sessions.map((s) => {
              const checked = selected.has(s.id);
              const fullySynced = s.syncedRows >= s.completedRows && s.completedRows > 0;
              const pending = s.completedRows - s.syncedRows;
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
                      {fullySynced ? ' · ✓ 업로드완료' : pending > 0 ? ` · ${pending}행 신규` : ''}
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
              onClick={() => onConfirm([...selected], autoDelete)}
              disabled={selected.size === 0}
              style={{
                flex: 1, height: 48, borderRadius: 14, border: 'none',
                background: selected.size === 0 ? '#2A2D32' : T.blue,
                color: selected.size === 0 ? T.textMute : '#fff',
                fontSize: 15, fontWeight: 800, letterSpacing: -0.2,
                cursor: selected.size === 0 ? 'not-allowed' : 'pointer',
                boxShadow: selected.size === 0 ? 'none' : `0 4px 14px ${T.blueGlow}`,
              }}
            >
              추가 ({selected.size})
            </button>
          </div>
        </div>
      </div>
    </Backdrop>
  );
}

// ─── export modal ─────────────────────────────────────────────
// 통합 내보내기 모달 (v0.12): 세션을 선택하고 CSV 또는 로그 ZIP으로 기기에 다운로드.
// SyncSessionModal의 세션 선택 UI 패턴을 재사용하되, 기본 전체 선택 + 전체 선택 토글을 추가.
function ExportModal({
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
              {I.download(16, selected.size === 0 ? T.textMute : T.text)} 로그 ZIP
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

// ─── failure modal ───────────────────────────────────────────
function FailureModal({
  report, onClose, onRetry,
}: {
  report: SyncReport;
  onClose: () => void;
  onRetry: () => void;
}) {
  return (
    <Backdrop onClose={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: T.card, borderRadius: 18, border: `1px solid ${T.line}`,
          width: '100%', maxWidth: 380, maxHeight: '78vh',
          display: 'flex', flexDirection: 'column',
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
        }}
      >
        <div
          style={{
            padding: '14px 16px',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            borderBottom: `1px solid ${T.line}`,
          }}
        >
          <div style={{ fontSize: 17, fontWeight: 700, color: T.red }}>업로드 실패</div>
          <button
            onClick={onClose}
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

        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px' }}>
          <div style={{ fontSize: 14, color: T.textDim, marginBottom: 12 }}>
            성공 {report.ok}개, 실패 {report.failed}개 ({report.rows}행 추가됨)
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {report.failures.map((f) => (
              <FailureItem key={f.sessionId} f={f} />
            ))}
          </div>
        </div>

        <div
          style={{
            padding: '12px 16px',
            display: 'flex', gap: 10,
            borderTop: `1px solid ${T.line}`,
          }}
        >
          <button
            onClick={onClose}
            style={{
              flex: 1, height: 48, borderRadius: 14,
              border: `1px solid ${T.lineStrong}`, background: 'transparent',
              color: T.textDim, fontSize: 15, fontWeight: 700, cursor: 'pointer',
            }}
          >
            닫기
          </button>
          <button
            onClick={onRetry}
            style={{
              flex: 1, height: 48, borderRadius: 14, border: 'none',
              background: T.blue, color: '#fff',
              fontSize: 15, fontWeight: 800, letterSpacing: -0.2,
              cursor: 'pointer',
              boxShadow: `0 4px 14px ${T.blueGlow}`,
            }}
          >
            재시도
          </button>
        </div>
      </div>
    </Backdrop>
  );
}

function FailureItem({ f }: { f: SyncFailure }) {
  const isNetworkError = /network|fetch|offline/i.test(f.reason);
  const isAuthError = /401|403|토큰|로그인/i.test(f.reason);
  const isRateLimit = /429|503|busy|rate/i.test(f.reason);
  const hint = isRateLimit
    ? '잠시 후 다시 시도하세요. 구글 시트 일시적 과부하일 수 있습니다.'
    : isAuthError
    ? '설정 탭에서 다시 로그인 후 시도하세요.'
    : isNetworkError
    ? '네트워크 상태를 확인하세요.'
    : '';
  return (
    <div
      style={{
        padding: 12, borderRadius: 10,
        background: 'rgba(255,82,82,0.08)',
        border: `1px solid rgba(255,82,82,0.20)`,
      }}
    >
      <div style={{ fontSize: 14, color: T.text, fontWeight: 700, marginBottom: 4 }}>
        {f.sessionDate}{f.sessionLabel ? ` · ${f.sessionLabel}` : ''}
      </div>
      <div style={{ fontSize: 13, color: T.textDim, lineHeight: 1.5 }}>{f.reason}</div>
      {hint && (
        <div style={{ fontSize: 12, color: T.amber, marginTop: 6, fontStyle: 'italic' }}>
          💡 {hint}
        </div>
      )}
    </div>
  );
}

function Checkbox({ checked }: { checked: boolean }) {
  return (
    <div
      style={{
        width: 24, height: 24, borderRadius: 6,
        border: `2px solid ${checked ? T.blue : T.lineStrong}`,
        background: checked ? T.blue : 'transparent',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0,
        transition: 'background 150ms, border 150ms',
      }}
    >
      {checked && I.check(14, '#fff')}
    </div>
  );
}

// ─── confirm modal ────────────────────────────────────────────
function ConfirmModal({
  title, body, confirmLabel = '확인', danger, onCancel, onConfirm,
}: {
  title: string;
  body: string;
  confirmLabel?: string;
  danger?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Backdrop onClose={onCancel}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: T.card, borderRadius: 18, border: `1px solid ${T.line}`,
          width: '100%', maxWidth: 360,
          padding: 20,
          display: 'flex', flexDirection: 'column', gap: 14,
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
        }}
      >
        <div style={{ fontSize: 18, fontWeight: 700, color: T.text }}>{title}</div>
        <div
          style={{
            fontSize: 14, color: T.textDim, whiteSpace: 'pre-line', lineHeight: 1.5,
          }}
        >
          {body}
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
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
            onClick={onConfirm}
            style={{
              flex: 1, height: 48, borderRadius: 14, border: 'none',
              background: danger ? T.red : T.blue,
              color: '#fff', fontSize: 15, fontWeight: 800, letterSpacing: -0.2,
              cursor: 'pointer',
              boxShadow: danger ? '0 4px 14px rgba(255,82,82,0.32)' : `0 4px 14px ${T.blueGlow}`,
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </Backdrop>
  );
}

function Backdrop({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 100,
        background: 'rgba(0,0,0,0.55)',
        backdropFilter: 'blur(4px)',
        WebkitBackdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
        animation: 'fade-up 200ms ease-out',
      }}
    >
      {children}
    </div>
  );
}

// ─── session card ────────────────────────────────────────────
function SessionCard({
  session, expanded, onToggle, onDelete, onCellSave,
}: {
  session: Session;
  expanded: boolean;
  onToggle: () => void;
  onDelete: () => void;
  onCellSave: (rowIndex: number, colId: string, value: string) => void;
}) {
  const fullySynced = session.syncedRows >= session.completedRows && session.completedRows > 0;
  const partial = session.syncedRows > 0 && !fullySynced;
  const syncIcon = fullySynced
    ? I.cloudCheck(16, T.green)
    : partial
    ? I.cloud(16, T.amber)
    : I.cloudOff(16, T.textMute);
  const syncLabel = fullySynced
    ? '업로드완료'
    : partial
    ? `${session.syncedRows}/${session.completedRows}`
    : '미업로드';
  const syncColor = fullySynced ? T.green : partial ? T.amber : T.textMute;

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
          <div
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              color: syncColor, fontSize: 13, fontWeight: 700,
            }}
          >
            {syncIcon}
            <span style={{ fontFamily: 'JetBrains Mono, ui-monospace, monospace' }}>{syncLabel}</span>
          </div>
          <div
            style={{
              color: T.textDim,
              transform: expanded ? 'rotate(90deg)' : 'none',
              transition: 'transform 180ms',
            }}
          >
            {I.chevron(18, T.textDim)}
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
      {expanded && <FullRowTable session={session} onCellSave={onCellSave} />}
    </div>
  );
}

// ─── full editable table ─────────────────────────────────────
function FullRowTable({
  session, onCellSave,
}: {
  session: Session;
  onCellSave: (rowIndex: number, colId: string, value: string) => void;
}) {
  const cols = session.columns;
  const rows = session.rows;
  const colWidthFor = (c: Column) =>
    c.type === 'date' ? 110 : c.type === 'text' || c.type === 'name' ? 140 : c.type === 'options' ? 100 : 80;

  return (
    <div
      style={{
        borderTop: `1px solid ${T.line}`,
        padding: 10,
        background: 'rgba(255,255,255,0.015)',
        animation: 'fade-up 200ms ease-out',
      }}
    >
      <div
        style={{
          maxHeight: 360, overflow: 'auto',
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
              <div
                key={c.id}
                style={{
                  width: colWidthFor(c), padding: '8px 8px',
                  fontSize: 12, fontWeight: 700, color: T.textDim,
                  borderRight: `1px solid ${T.line}`,
                  whiteSpace: 'normal', wordBreak: 'break-word', overflowWrap: 'anywhere',
                }}
              >
                {c.name}
              </div>
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
                  fontSize: 13, color: T.textMute, textAlign: 'center',
                  position: 'sticky', left: 0, background: T.card, zIndex: 1,
                  borderRight: `1px solid ${T.line}`,
                  fontFamily: 'JetBrains Mono, ui-monospace, monospace', fontWeight: 700,
                }}
              >
                {r.index}
              </div>
              {cols.map((c) => (
                <EditableCell
                  key={c.id}
                  col={c}
                  value={r.values[c.id] ?? ''}
                  width={colWidthFor(c)}
                  audioClipKey={r.audioClips?.[c.id]}
                  onSave={(v) => onCellSave(r.index, c.id, v)}
                />
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
        총 {rows.length}행 · 셀을 탭하면 수정할 수 있습니다
      </div>
    </div>
  );
}

/**
 * 모듈 레벨 단일 오디오 재생 매니저 (v0.11.2).
 * 데이터탭의 여러 음성 클립을 동시에 누르면 동시 재생되던 문제를 해결 —
 * 한 번에 하나만 재생하고 나머지는 큐에 대기, 끝나면 순서대로 재생한다.
 * - 재생 중인 클립을 다시 탭 → 정지 + 대기 큐 전체 취소 (사용자 "그만" 의도)
 * - 대기 중인 클립을 탭 → 해당 클립만 큐에서 취소
 */
type ClipPlayState = 'idle' | 'playing' | 'queued';
const clipPlayer = (() => {
  let current: string | null = null;
  let queue: string[] = [];
  let audio: HTMLAudioElement | null = null;
  let objectUrl: string | null = null;
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((l) => l());

  const cleanup = () => {
    if (audio) { audio.onended = null; audio.onerror = null; audio.pause(); audio = null; }
    if (objectUrl) { URL.revokeObjectURL(objectUrl); objectUrl = null; }
  };

  const stop = () => {
    cleanup();
    current = null;
    queue = [];
    notify();
  };

  const playNext = async () => {
    if (current) return; // 이미 재생 중
    const key = queue.shift();
    if (!key) { notify(); return; }
    current = key;
    notify();
    let blob: Blob | null = null;
    try { blob = await loadAudioClip(key); } catch { blob = null; }
    // await 사이에 정지(stop/toggle)되었으면 이 continuation은 폐기 — stale 재생 방지 (Codex HIGH)
    if (current !== key) return;
    if (!blob) { current = null; notify(); void playNext(); return; }
    cleanup();
    objectUrl = URL.createObjectURL(blob);
    const a = new Audio(objectUrl);
    audio = a;
    const advance = () => {
      if (audio !== a) return; // stale audio의 이벤트는 무시
      cleanup(); current = null; notify(); void playNext();
    };
    a.onended = advance;
    a.onerror = advance;
    try {
      await a.play();
    } catch {
      if (audio === a) { cleanup(); current = null; notify(); void playNext(); }
      return;
    }
    if (audio === a) notify();
  };

  return {
    subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    stateOf(key: string): ClipPlayState {
      if (current === key) return 'playing';
      if (queue.includes(key)) return 'queued';
      return 'idle';
    },
    toggle(key: string) {
      if (current === key) {
        // 재생 중인 클립 탭 → 정지 + 큐 전체 취소
        stop();
        return;
      }
      if (queue.includes(key)) {
        // 대기 중인 클립 탭 → 취소
        queue = queue.filter((k) => k !== key); notify();
        return;
      }
      queue.push(key); notify();
      void playNext();
    },
    // 데이터탭 언마운트·세션 삭제 시 호출 — 전역 재생이 화면 밖에서 지속되지 않도록 (Codex HIGH)
    stop,
  };
})();

function EditableCell({
  col, value, width, audioClipKey, onSave,
}: {
  col: Column;
  value: string;
  width: number;
  audioClipKey?: string;
  onSave: (v: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [local, setLocal] = useState(value);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const skipBlurRef = useRef(false);
  const clipState = useSyncExternalStore(
    clipPlayer.subscribe,
    () => (audioClipKey ? clipPlayer.stateOf(audioClipKey) : 'idle'),
  );

  useEffect(() => { if (!editing) setLocal(value); }, [value, editing]);
  useEffect(() => {
    if (!editing) return;
    const el = inputRef.current;
    el?.focus();
    if (el instanceof HTMLTextAreaElement) {
      el.style.height = 'auto';
      el.style.height = `${el.scrollHeight}px`;
    }
  }, [editing]);

  const commit = () => {
    if (local !== value) onSave(local);
    setEditing(false);
  };
  const cancel = () => {
    setLocal(value);
    setEditing(false);
  };
  // 키보드 commit/cancel 시 직후 발생하는 blur가 한 번 더 commit하지 않도록 가드 (Codex MEDIUM)
  const handleBlur = () => {
    if (skipBlurRef.current) { skipBlurRef.current = false; return; }
    commit();
  };
  const keyCommit = () => { skipBlurRef.current = true; commit(); };
  const keyCancel = () => { skipBlurRef.current = true; cancel(); };

  const isVoice = col.input === 'voice';
  const hasClip = isVoice && !!audioClipKey;
  const isDate = col.type === 'date';
  const isText = col.type === 'text' || col.type === 'name';
  const inputType = isDate ? 'date' : 'text';
  const inputMode = col.type === 'int' ? 'numeric' : col.type === 'float' ? 'decimal' : 'text';

  return (
    <div
      style={{
        width, padding: 0,
        borderRight: `1px solid ${T.line}`,
        background: editing ? 'rgba(41,121,255,0.08)' : 'transparent',
        display: 'flex', alignItems: 'stretch',
      }}
    >
      {editing ? (
        isText ? (
          <textarea
            ref={(el) => { inputRef.current = el; }}
            value={local}
            onChange={(e) => {
              setLocal(e.target.value);
              e.target.style.height = 'auto';
              e.target.style.height = `${e.target.scrollHeight}px`;
            }}
            onBlur={handleBlur}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); keyCommit(); }
              else if (e.key === 'Escape') keyCancel();
            }}
            rows={1}
            style={{
              flex: 1,
              padding: '8px 8px',
              background: 'transparent', border: 'none', outline: 'none',
              color: T.text,
              fontFamily: 'JetBrains Mono, ui-monospace, monospace',
              fontSize: 14, fontWeight: 700,
              minHeight: 36, resize: 'none', overflow: 'hidden',
              whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.4,
            }}
          />
        ) : (
          <input
            ref={(el) => { inputRef.current = el; }}
            type={inputType}
            value={local}
            inputMode={isDate ? undefined : (inputMode as 'numeric' | 'decimal' | 'text')}
            onChange={(e) => setLocal(e.target.value)}
            onBlur={handleBlur}
            onKeyDown={(e) => {
              if (e.key === 'Enter') keyCommit();
              else if (e.key === 'Escape') keyCancel();
            }}
            style={{
              flex: 1, height: '100%',
              padding: '8px 8px',
              background: 'transparent', border: 'none', outline: 'none',
              color: T.text,
              fontFamily: 'JetBrains Mono, ui-monospace, monospace',
              fontSize: 14, fontWeight: 700,
              minHeight: 36,
            }}
          />
        )
      ) : (
        <>
          <button
            onClick={() => setEditing(true)}
            style={{
              flex: 1, minHeight: 36, minWidth: 0,
              padding: '8px 8px',
              background: 'transparent', border: 'none',
              color: isVoice ? T.text : T.textDim,
              fontSize: 14, fontWeight: 700,
              fontFamily: 'JetBrains Mono, ui-monospace, monospace',
              textAlign: 'left', cursor: 'pointer',
              whiteSpace: 'normal', wordBreak: 'break-word', overflowWrap: 'anywhere',
            }}
          >
            {value || <span style={{ color: T.textMute, opacity: 0.5 }}>—</span>}
          </button>
          {hasClip && (
            <button
              onClick={(e) => { e.stopPropagation(); if (audioClipKey) clipPlayer.toggle(audioClipKey); }}
              title={clipState === 'playing' ? '정지' : clipState === 'queued' ? '대기 중 (탭하면 취소)' : '음성 재생'}
              style={{
                flexShrink: 0,
                width: 28, padding: '0 4px',
                background: 'transparent', border: 'none',
                color: clipState === 'playing' ? T.amber : clipState === 'queued' ? T.textMute : T.blue,
                cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              {clipState === 'playing' ? I.stop(12, T.amber) : I.play(12, clipState === 'queued' ? T.textMute : T.blue)}
            </button>
          )}
        </>
      )}
    </div>
  );
}

/** Shown when IndexedDB hydration FAILED (D-1) — distinct from a genuinely empty list.
 *  Reassures the user their data is likely intact and offers a retry rather than a blank state.
 *  A version mismatch (app update + stale tab) needs a full refresh, so we surface that hint. */
function LoadErrorState({ error, onRetry }: { error: string; onRetry: () => void }) {
  const isVersion = /version/i.test(error);
  return (
    <div
      style={{
        flex: 1, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        gap: 16, padding: '40px 32px',
      }}
    >
      <div
        style={{
          width: 110, height: 110, borderRadius: '50%',
          background: 'rgba(255,82,82,0.06)',
          border: `1px dashed ${T.red}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: T.red, fontSize: 44, fontWeight: 800,
        }}
      >
        !
      </div>
      <div
        style={{
          fontSize: 17, fontWeight: 700, color: T.text,
          letterSpacing: -0.2, textAlign: 'center',
        }}
      >
        데이터를 불러오지 못했습니다
      </div>
      <div style={{ fontSize: 14, color: T.textMute, textAlign: 'center', lineHeight: 1.5 }}>
        저장된 세션은 안전할 수 있습니다.<br />
        {isVersion
          ? '앱이 업데이트되었습니다. 앱을 새로고침한 뒤 다시 시도하세요.'
          : '잠시 후 다시 시도해 주세요.'}
      </div>
      <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
        <button
          onClick={onRetry}
          style={{
            padding: '10px 20px', borderRadius: 12, border: `1px solid ${T.blue}`,
            background: T.blue, color: '#fff',
            fontSize: 14, fontWeight: 700, cursor: 'pointer',
          }}
        >
          다시 시도
        </button>
        {isVersion && (
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: '10px 20px', borderRadius: 12, border: `1px solid ${T.lineStrong}`,
              background: 'transparent', color: T.text,
              fontSize: 14, fontWeight: 700, cursor: 'pointer',
            }}
          >
            새로고침
          </button>
        )}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div
      style={{
        flex: 1, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        gap: 18, padding: '40px 32px',
      }}
    >
      <div
        style={{
          width: 110, height: 110, borderRadius: '50%',
          background: 'rgba(255,255,255,0.03)',
          border: `1px dashed ${T.lineStrong}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: T.textMute,
        }}
      >
        {I.data(50, T.textMute)}
      </div>
      <div
        style={{
          fontSize: 17, fontWeight: 700, color: T.textDim,
          letterSpacing: -0.2, textAlign: 'center',
        }}
      >
        아직 기록된 데이터가 없습니다
      </div>
      <div style={{ fontSize: 14, color: T.textMute, textAlign: 'center', lineHeight: 1.5 }}>
        입력 탭에서 음성 세션을 시작하거나<br />시트에서 가져올 수 있습니다
      </div>
    </div>
  );
}
