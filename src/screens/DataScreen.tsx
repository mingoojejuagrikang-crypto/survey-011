import { Fragment, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { T } from '../tokens';
import { I } from '../components/icons';
import { ScreenHeader } from '../components/ScreenHeader';
import { useDataStore } from '../stores/dataStore';
import { useSettingsStore } from '../stores/settingsStore';
import { syncSelected, type SyncReport, type SyncFailure } from '../lib/sync';
import { hasSyncState } from '../lib/sessionSync';
import { downloadCsv, csvToBlob, downloadBlob, sessionsToCsv, sessionsToCsvZip } from '../lib/csv';
import { deleteSession as dbDeleteSession, saveSession, loadAudioClip, resetDb } from '../lib/db';
import type { Column, Session } from '../types';
import { exportLogZip, exportLogZipsPerSession, downloadZip } from '../lib/exportLog';
import { uploadLogToBothDrives } from '../lib/driveUpload';
import { hydrateSessions } from '../lib/hydrate';
import { getAccessToken, signIn } from '../lib/googleAuth';
import {
  listRecoverableSessionsFromDrive,
  restoreSelectedSessions,
  type ZipCache,
  type ZipSessionMeta,
} from '../lib/recoverFromDrive';
import { logger } from '../lib/logger';
import { LoginRequiredModal } from '../components/LoginRequiredModal';
import { HelpButton, SettingsHelpModal } from '../components/settings/SettingsHelp';
import type { HelpItem } from '../components/settings/helpCopy';

/** v0.25.0 데이터탭#4(Vance) — 작은 인라인 안내를 헤더 `?` on-demand 큰 팝업으로 이전.
 *  현장 기술자(장갑·소음·햇빛) 기준으로 짧고 정확하게. SettingsHelpModal(safe-area·스크롤) 재사용. */
const DATA_GUIDE: HelpItem[] = [
  {
    title: '이 화면은',
    body:
      '조사한 세션(측정 기록)이 카드로 쌓입니다. 카드를 눌러 값을 펼쳐 보고, 잘못 들어간 값은 그 자리에서 고칠 수 있어요.',
  },
  {
    title: '시트에 올리기 — 동기화',
    body:
      '‘동기화’를 누르면 고른 세션이 구글 시트에 추가되거나(같은 행은) 갱신됩니다. ' +
      '시트에 새로 반영되는 세션은 그 음성 로그도 Drive에 자동으로 백업돼요.',
  },
  {
    title: '기기로 내보내기',
    body:
      '‘내보내기’로 CSV(엑셀에서 열림)나 음성 로그를 이 기기에 저장하거나, 공유 버튼으로 다른 앱(엑셀·파일·메일)으로 바로 보낼 수 있어요.',
  },
  {
    title: '자동 백업과 복구',
    body:
      'Drive에 백업된 음성 로그는 나중에 세션을 되살릴 때 쓰입니다. ' +
      '일부만 올라간 경우 안내 메시지의 ‘자세히’에서 어떤 목적지가 실패했는지 확인하세요.',
  },
];

/** v0.6.0 — human label for a sync result that may both append and update rows in place.
 *  "N행 추가", "M행 갱신", or "N행 추가, M행 갱신" depending on what happened. */
function syncCountLabel(report: SyncReport): string {
  const parts: string[] = [];
  if (report.rows > 0) parts.push(`${report.rows}행 추가`);
  if (report.updatedRows > 0) parts.push(`${report.updatedRows}행 갱신`);
  if (parts.length === 0) parts.push('변경 없음');
  let label = parts.join(', ');
  if (report.fallbackAppended > 0) label += ` (${report.fallbackAppended}행 재추가)`;
  return label;
}

/** v0.6.0 — count of rows that still need a push for a session (append OR in-place update).
 *  Per-row syncState is authoritative; legacy sessions (no syncState) fall back to the
 *  completedRows - syncedRows counter so their pending badge keeps working. */
function sessionPending(s: Session): number {
  if (hasSyncState(s.rows)) return s.rows.filter((r) => r.syncState !== 'synced').length;
  return Math.max(0, s.completedRows - s.syncedRows);
}

/** F9 — has this session EVER been uploaded (any row tracked on the sheet)? Row-based, so a
 *  session whose uploaded rows were all later edited (now 'dirty') still reads as "uploaded",
 *  not "미업로드". Legacy sessions fall back to the syncedRows counter. */
function sessionEverUploaded(s: Session): boolean {
  if (hasSyncState(s.rows)) {
    return s.rows.some(
      (r) => r.sheetRow !== undefined || r.syncState === 'synced' || r.syncState === 'dirty',
    );
  }
  return s.syncedRows > 0;
}

/** F9 — count of rows uploaded earlier but edited since (need an in-place UPDATE next sync). */
function sessionDirtyCount(s: Session): number {
  return s.rows.filter((r) => r.syncState === 'dirty').length;
}

export function DataScreen() {
  const sessions = useDataStore((s) => s.sessions);
  const expandedSessionId = useDataStore((s) => s.expandedSessionId);
  const toggleExpand = useDataStore((s) => s.toggleExpand);
  const updateRowValue = useDataStore((s) => s.updateRowValue);
  const removeSession = useDataStore((s) => s.removeSession);
  const upsertSession = useDataStore((s) => s.upsertSession);
  const hydrationError = useDataStore((s) => s.hydrationError);

  const unsynced = sessions.filter((s) => sessionPending(s) > 0).length;
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
  const [recoverModalOpen, setRecoverModalOpen] = useState(false);
  // v0.13.0 R5 — 상세 모달 대상. expandedSessionId가 SSOT, 여기선 그 세션 객체를 파생만 한다.
  const detailSession = sessions.find((s) => s.id === expandedSessionId) ?? null;
  // v0.13.0 R6 — 내보내기 결과(완료 팝업용). 작은 줄 배너(msg) 대신 큰 모달로 띄우고, 보관한 Blob으로
  // 클릭 시 공유시트/재다운로드를 제공한다. 모달을 닫을 때 null로 비워 Blob 참조를 해제(메모리 회수).
  const [exportResult, setExportResult] = useState<ExportResult | null>(null);

  // v0.20.0 Phase 2 — 범용 "로그인 필요" 팝업 상태. 토큰 만료/미로그인이 감지되는 모든 지점(시트
  // 동기화·Drive 백업·세션 복구)에서 reason 문구와 함께 마운트한다. `resume`은 재로그인 성공 직후
  // 다시 실행할 직전 동작 클로저 — 사용자가 하던 일을 잃지 않고 이어가게 한다(graceful resume).
  const [loginPrompt, setLoginPrompt] = useState<{ reason: string; resume: () => void } | null>(null);
  // v0.25.0 데이터탭#4 — 헤더 `?`로 여는 안내 팝업(상시 노출 아님).
  const [guideOpen, setGuideOpen] = useState(false);

  const lastSelectedIdsRef = useRef<string[]>([]);

  // v0.20.0 Phase 2 — 재로그인 핸들러. signIn()은 GIS 팝업을 클릭 제스처 안에서 동기적으로 열어야
  // 하므로(googleAuth S-1) 반드시 모달의 onLogin 클릭에서 직접 호출된다. 재로그인 성공 시:
  //  ① 시트 연결이 풀렸으면(순수 토큰 만료가 아닌 강한 evict 케이스) savedSheets 최상단으로 재연결
  //     ([STORE-1] 설계 의도 — 순수 토큰 만료에선 sheetUrl/sheetTab이 살아 있어 이 분기는 no-op),
  //  ② 팝업을 닫고 ③ 직전 동작(resume)을 이어서 실행한다.
  const handleLoginPromptLogin = useCallback(() => {
    const prompt = loginPrompt;
    logger.log({ type: 'app', extra: 'login_prompt_login_clicked' });
    void signIn()
      .then(() => {
        // graceful resume: 순수 토큰 만료에선 sheetUrl이 살아 있어 재연결 불필요. 강한 evict로 연결이
        // 풀렸고 저장 시트가 있으면 최근 사용 시트로 1-탭 재연결한다(설계 의도, [STORE-1] 연계).
        const st = useSettingsStore.getState();
        if (!st.sheetUrl?.trim() && st.savedSheets.length > 0) {
          const top = st.savedSheets[0];
          st.set({ sheetUrl: top.url });
          logger.log({ type: 'app', extra: 'login_prompt_sheet_reconnected', parsed: top.sheetId });
        }
        setLoginPrompt(null);
        prompt?.resume(); // 중단 없이 직전 동작 재개
      })
      .catch((e) => {
        // 재로그인 실패(취소/팝업 차단 등) — 팝업은 닫고 사유를 배너로 남긴다(조용한 실패 금지).
        setLoginPrompt(null);
        setMsg('로그인 실패: ' + ((e as Error)?.message ?? '다시 시도해 주세요.'));
      });
  }, [loginPrompt]);

  // 데이터탭을 떠나면(언마운트) 재생 중인 음성 클립 정지 — 전역 싱글톤이라 화면 밖에서 계속 재생되지 않도록 (Codex HIGH)
  useEffect(() => () => { clipPlayer.stop(); }, []);

  // 선택 세션을 로그 ZIP으로 압축해 다운로드 (직접 경로 + 확인 후 경로 공용).
  // 압축 중 busy='로그 압축 중...' 표시 — 액션바 내보내기 버튼이 busy일 때 비활성화되어 중복 클릭 차단.
  const runZipExport = useCallback(async (ids: string[]) => {
    setBusy('로그 압축 중...');
    setMsg(null); // v0.13.0 R6 — 성공 시 완료 팝업만 띄우므로, 직전 실패/동기화 배너를 먼저 지운다.
    try {
      const blob = await exportLogZip(ids);
      const filename = `growth-log_${new Date().toISOString().slice(0, 10)}_${Date.now()}.zip`;
      downloadZip(blob, filename);
      // v0.13.0 R6 — 작은 줄 배너(setMsg) 대신 큰 완료 팝업 + 보관 Blob으로 공유/재다운로드.
      setExportResult({ blob, filename, kind: 'zip' });
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
      // 단일 세션 → 평문 .csv. 다중 세션 → 세션별 CSV 1개씩을 ZIP으로 묶음(병합 안 함, v0.12 D1)
      // — 세션마다 컬럼 스키마가 달라 한 표로 합치면 열이 union되며 의미가 흐려지기 때문.
      const today = new Date().toISOString().slice(0, 10);
      setBusy('CSV 생성 중...');
      setMsg(null); // v0.13.0 R6 — 성공 시 완료 팝업만 띄우므로, 직전 실패/동기화 배너를 먼저 지운다.
      try {
        if (targets.length > 1) {
          const blob = await sessionsToCsvZip(targets);
          const filename = `survey_${today}.zip`;
          downloadZip(blob, filename);
          // v0.13.0 R6 — 완료 팝업 + 보관 Blob(공유/재다운로드). kind는 묶음 CSV라도 컨테이너가 zip.
          setExportResult({ blob, filename, kind: 'zip' });
        } else {
          const csv = sessionsToCsv(targets);
          const filename = `survey_${today}.csv`;
          const blob = csvToBlob(csv);
          downloadCsv(filename, csv);
          setExportResult({ blob, filename, kind: 'csv' });
        }
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
    // v0.33.0 B-8 — 데이터탭 셀 수동 편집 계측(음성탭 touch_commit :2256과 대칭 — 이전엔 무로깅이라
    // 오터치/수동 정정을 로그로 재구성할 수 없었다). 편집 대상 세션 id를 명시(현재 음성 세션 아님).
    logger.log({ type: 'command', parsed: 'data_edit', extra: 'touch', text: value, sessionId, row: rowIndex, colId });
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
        setMsg(`${report.ok}개 세션 성공, ${report.failed}개 실패 (${syncCountLabel(report)})`);
        setFailureReport(report);
      } else if (report.ok > 0) {
        setMsg(`✓ ${syncCountLabel(report)}`);
      } else {
        setMsg('추가할 새 데이터가 없습니다.');
      }
      // [SYNC-3] — 로컬 컬럼이 시트 헤더에 없어 일부 값이 비워진 세션이 있으면, 성공/실패 메시지와
      // 별개로 반드시 표면화한다(침묵 오정렬 방지 — report.message가 이미 다른 문구를 쓴 경우에도
      // 덧붙인다). 위 4가지 분기 중 어떤 것이 실행됐든 이 경고는 추가된다.
      if (report.columnWarnings.length > 0) {
        setMsg((prev) => `${prev ? `${prev} ` : ''}⚠ ${report.columnWarnings.join(' / ')}`);
      }

      // 2) 로그 백업: 사용자 본인 드라이브 + 관리자 폴더 양쪽 업로드 (v0.10 멀티유저).
      // v0.10.1 Codex HIGH 수정: 관리자 폴더 설정 시 admin 업로드도 성공해야 backupOk → autoDelete 차단.
      // v0.23.0 데이터탭#1 — 로그 백업을 '새 행이 추가된 세션'(successIds)이 아니라 **선택한 모든
      // 세션(행 보유)**으로 확장한다. 이미 동기화돼 새 행이 0인 세션을 함께 선택해도 그 로그가 누락되지
      // 않게 한다(민구 제보: "일부만 업로드"). autoDelete는 아래에서 여전히 successIds로만 게이트한다.
      const allSessionsForBackup = useDataStore.getState().sessions;
      const hasRows = (id: string) =>
        (allSessionsForBackup.find((s) => s.id === id)?.rows.length ?? 0) > 0;
      const uploadIds = ids.filter(hasRows);
      if (uploadIds.length > 0) {
        try {
          // v0.19.0 W6 — 세션별 개별 zip 업로드. v0.23.0 데이터탭#1 — 대상 = 선택한 모든 세션(행 보유).
          // 파일명은 수확 prefix `growth-log_<date>` + 세션 식별자(rclone/SOP-003·복구 파싱 호환).
          const zips = await exportLogZipsPerSession(uploadIds);
          const anyUser = new Set<string>();   // 업로드 성공한 목적지 라벨 집계(메시지용)
          const anyAdmin = new Set<string>();
          const failedDests = new Set<string>();
          const backedUpOk = new Set<string>(); // 세션별 백업 성공 집계(autoDelete 불변식 + N/N 메시지)
          // v0.20.0 Phase 2 — Drive 백업 실패가 토큰 만료(401/403)면 시트추가와 독립으로 로그인
          // 팝업을 띄울 수 있게 신호를 모은다(시트추가는 성공해도 백업만 만료될 수 있다).
          let backupNeedsLogin = false;
          const isAuth = (s: string) => /\b(401|403)\b/.test(s) || /로그인이 필요/.test(s);
          // 데이터 유실 방지 불변식(v0.23.0): 로그는 선택한 모든 세션을 올리되, autoDelete 대상은
          // successIds(시트에 새로 반영된 세션)로만 한정한다. 그 successIds가 **모두** 완전 백업(본인
          // Drive 필수 + 관리자 설정 시 admin도 필수)됐을 때만 backupOk=true → 부분 성공으로는 삭제 안 함.
          for (const z of zips) {
            try {
              const dual = await uploadLogToBothDrives(z.blob, z.filename);
              const sessionOk = !!dual.userDriveId && (!dual.adminConfigured || !!dual.adminDriveId);
              if (sessionOk) backedUpOk.add(z.sessionId);
              if (dual.userDriveId) anyUser.add('본인 Drive');
              if (dual.adminDriveId) anyAdmin.add('관리자 Drive');
              for (const e of dual.errors) {
                failedDests.add(e.split(':')[0]);
                if (isAuth(e)) backupNeedsLogin = true;
              }
              // 세션별 업로드 결과 계측 — 어느 세션 zip이 어느 목적지에서 실패했는지 정량 확인.
              logger.log({
                type: 'app',
                // v0.25.0 데이터탭 F2(Vance) — '일부 실패' 라벨 오해 소지 제거: 실패 레그(fail=)와
                // 성공 레그(ok=)를 분리 표기(빈 레그는 '-'). 접두 'drive_upload:partial:'는 유지(그렙 호환).
                extra: dual.errors.length === 0
                  ? 'drive_upload:ok'
                  : `drive_upload:partial:fail=${dual.errors.map((e) => e.split(':')[0]).join(',') || '-'}:ok=${
                      [dual.userDriveId ? '본인 Drive' : null, dual.adminDriveId ? '관리자 Drive' : null]
                        .filter(Boolean).join(',') || '-'
                    }`,
                text: z.filename,
                parsed: z.sessionId,
              });
            } catch (err) {
              failedDests.add('exception');
              const emsg = String((err as Error)?.message ?? err);
              if (isAuth(emsg)) backupNeedsLogin = true;
              logger.log({ type: 'app', extra: `drive_upload:failed:${z.sessionId}:${emsg}` });
              console.warn('Drive 로그 업로드 실패(세션)', z.sessionId, err);
            }
          }
          // autoDelete 불변식: 삭제 대상(successIds)이 모두 백업됐을 때만 backupOk.
          backupOk = report.successIds.every((id) => backedUpOk.has(id));
          // 백업이 토큰 만료로 실패했으면 report에 needsLogin을 전파(시트추가 성공/실패와 독립).
          if (backupNeedsLogin) report.needsLogin = true;
          const dest = [...anyUser, ...anyAdmin];
          const okN = backedUpOk.size;
          const totalN = zips.length;
          // N/N 세션 로그 백업(+성공 목적지). '일부만 업로드' 재발 시 즉시 가시화(민구 데이터탭#1).
          setMsg((m) => {
            const base = `로그 ${okN}/${totalN} 세션 백업${dest.length ? ` (${dest.join('+')})` : ''}`;
            return m ? `${m} · ${base}` : `✓ ${base}`;
          });
          if (okN < totalN) {
            const failedIds = zips.filter((z) => !backedUpOk.has(z.sessionId)).map((z) => z.sessionId);
            setMsg((m) => `${m ?? ''} · ⚠️ ${totalN - okN}개 세션 로그 백업 실패`);
            console.warn('Drive 로그 백업 실패 세션', failedIds, [...failedDests]);
          }
        } catch (err) {
          logger.log({ type: 'app', extra: `drive_upload:failed:${String((err as Error)?.message ?? err)}` });
          setMsg((m) => (m ? `${m} · ⚠️ 로그 백업 실패` : '⚠️ 시트 추가 OK, 로그 백업 실패'));
          console.warn('Drive 로그 업로드 실패', err);
        }
      } else {
        // 선택 세션 중 행 보유 세션이 없음 → 백업 대상 없음, backupOk false → autoDelete 차단
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
    // v0.20.0 Phase 2 — 토큰 만료/미로그인(structured needsLogin)이면 로그인 팝업을 띄우고, 재로그인
    // 성공 시 같은 동기화를 그대로 재개한다. report.message는 runSyncInner에서 이미 항상 표면화됐다
    // (조용한 실패 제거) — 팝업은 그 위에 "다음 행동"을 명시한다.
    if (report.needsLogin) {
      setLoginPrompt({
        reason: '시트 동기화에 로그인이 필요합니다. 로그인하면 이어서 업로드합니다.',
        resume: () => { void handleSyncConfirm(ids, autoDelete); },
      });
      return;
    }
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
  // (v0.5.0 W8: 2단계 — 로그인 상태면 Drive의 로그 zip(sessions.json + clips/)에서
  //  로컬에 없는 세션+클립까지 복원. 다운로드는 이 버튼을 눌렀을 때만 발생.)
  const handleRecoverClick = async () => {
    setMsg(null);
    setBusy('세션 복구 중...');
    // v0.5.0 W7(T-19): 복구 버튼 계측 — 사용자가 복구에 의존하는 빈도/성패를 로그로 확인.
    logger.log({ type: 'app', extra: 'recover_clicked' });
    try {
      // ── 1단계: 로컬 IDB 재하이드레이션 (현행) ──
      const before = useDataStore.getState().sessions.length;
      resetDb();
      await hydrateSessions();
      const after = useDataStore.getState().sessions.length;
      const err = useDataStore.getState().hydrationError;
      logger.log({
        type: 'app',
        extra: err ? `recover_result:error:${err}` : `recover_result:ok:${before}->${after}`,
      });
      if (err) {
        setMsg('복구 실패: ' + err);
      } else if (after > before) {
        setMsg(`✓ 세션 ${after - before}개를 복구했습니다.`);
      } else {
        setMsg(`✓ 저장된 세션 ${after}개를 모두 불러왔습니다.`);
      }

      // ── 2단계: 로그인 상태면 RecoverModal(기간 조회 + 세션 선택) 오픈. DB가 깨진 상태(1단계
      //    실패)에 덮어쓰는 것을 피하기 위해 1단계 성공 시에만 진행한다. 미로그인이면 안내만. ──
      if (!err) {
        if (getAccessToken()) {
          setRecoverModalOpen(true);
        } else {
          // v0.20.0 Phase 2 — 미로그인/토큰 만료면 안내 텍스트만 남기던 것을 로그인 팝업으로 승격.
          // 재로그인 성공 시 Drive 복구 모달을 바로 연다(graceful resume). 로컬 IDB 재하이드레이션
          // (1단계)은 이미 끝났으므로 여기서는 Drive 2단계만 이어가면 된다.
          setLoginPrompt({
            reason: 'Drive에서 세션을 복구하려면 로그인이 필요합니다.',
            resume: () => { setRecoverModalOpen(true); },
          });
        }
      }
    } finally {
      setBusy(null);
    }
  };

  // RecoverModal "선택 복구" 완료 콜백 — 선택 세션을 IDB에 저장한 뒤 재하이드레이션해 카드로 노출.
  const handleRecoverRestore = useCallback(async (
    selectedIds: Set<string>,
    cache: ZipCache,
    onProgress: (msg: string) => void,
  ) => {
    const localIds = new Set(useDataStore.getState().sessions.map((s) => s.id));
    const r = await restoreSelectedSessions(selectedIds, localIds, cache, onProgress);
    if (r.sessions > 0) {
      await hydrateSessions();
    }
    return r;
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <ScreenHeader
        sub={`${sessions.length}개 세션`}
        right={
          <HelpButton
            onOpen={() => setGuideOpen(true)}
            label="데이터 탭 안내 보기"
            testid="data-guide-button"
          />
        }
      />

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
          title="기기로 내보내기 (CSV / 사용자 로그)"
        >
          {I.download(18, T.text)} 내보내기
        </button>
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

      {recoverModalOpen && (
        <RecoverModal
          localIds={new Set(sessions.map((s) => s.id))}
          onClose={() => setRecoverModalOpen(false)}
          onRestore={handleRecoverRestore}
        />
      )}

      {pendingZipIds && (
        <ConfirmModal
          title="사용자 로그 내보내기"
          body={`${pendingZipIds.length}개 세션의 사용자 로그를 ZIP으로 압축합니다.\n용량이 크거나 시간이 걸릴 수 있어요.\n\n계속할까요?`}
          confirmLabel="압축"
          onCancel={() => setPendingZipIds(null)}
          onConfirm={() => {
            const ids = pendingZipIds;
            setPendingZipIds(null);
            void runZipExport(ids);
          }}
        />
      )}

      {/* v0.13.0 R5 — 세션 상세 모달. expandedSessionId가 어떤 상세가 열렸는지의 SSOT(새 상태 불필요).
          삭제로 세션이 사라지면 find가 undefined → 자동으로 안 뜸(removeSession이 expandedSessionId도 정리). */}
      {detailSession && (
        <SessionDetailModal
          session={detailSession}
          onClose={() => toggleExpand(detailSession.id)}
          onCellSave={(rowIndex, colId, value) => handleCellSave(detailSession.id, rowIndex, colId, value)}
        />
      )}

      {/* v0.13.0 R6 — 내보내기 완료 큰 팝업(작은 줄 배너 대신). 클릭 시 공유시트/재다운로드. */}
      {exportResult && (
        <ExportDoneModal
          result={exportResult}
          onClose={() => setExportResult(null)}
        />
      )}

      {/* v0.20.0 Phase 2 — 범용 로그인 필요 팝업(시트 동기화·Drive 백업·세션 복구 공용). onLogin은
          GIS 팝업을 클릭 제스처 안에서 열고(googleAuth S-1) 성공 시 직전 동작을 이어서 실행한다. */}
      {loginPrompt && (
        <LoginRequiredModal
          reason={loginPrompt.reason}
          onLogin={handleLoginPromptLogin}
          onClose={() => setLoginPrompt(null)}
        />
      )}

      {/* v0.25.0 데이터탭#4 — 헤더 `?`로 여는 큰 안내 팝업(작은 인라인 안내 대체). */}
      {guideOpen && (
        <SettingsHelpModal
          title="데이터 탭 안내"
          items={DATA_GUIDE}
          onClose={() => setGuideOpen(false)}
          testid="data-guide-modal"
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
    () => sessions.filter((s) => sessionPending(s) > 0).map((s) => s.id),
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

// ─── recover modal ───────────────────────────────────────────
// v0.6.0 W8 — "세션 복구" 2단계: 기간 칩으로 Drive 로그 목록을 조회한 뒤, 복구할 세션을 골라
// IDB로 복원한다. ExportModal/Checkbox/Backdrop 패턴 재사용. 이미 로컬에 있는 세션은 회색·선택 불가.
type RecoverStage = 'idle' | 'listing' | 'list' | 'restoring' | 'done';
const RANGE_CHIPS: { key: '7' | '30' | 'all'; label: string; days: number | null }[] = [
  { key: '7', label: '최근 7일', days: 7 },
  { key: '30', label: '최근 30일', days: 30 },
  { key: 'all', label: '전체', days: null },
];

function RecoverModal({
  localIds, onClose, onRestore,
}: {
  localIds: Set<string>;
  onClose: () => void;
  onRestore: (
    selectedIds: Set<string>,
    cache: ZipCache,
    onProgress: (msg: string) => void,
  ) => Promise<{ sessions: number; clips: number; skipped: number }>;
}) {
  const [rangeKey, setRangeKey] = useState<'7' | '30' | 'all'>('30'); // 기본 30일
  const [stage, setStage] = useState<RecoverStage>('idle');
  const [progress, setProgress] = useState('');
  const [list, setList] = useState<ZipSessionMeta[]>([]);
  const [cache, setCache] = useState<ZipCache>(new Map());
  const [legacyZips, setLegacyZips] = useState(0);
  const [failedZips, setFailedZips] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [resultMsg, setResultMsg] = useState<string | null>(null);

  const runList = async () => {
    setStage('listing');
    setError(null);
    setResultMsg(null);
    const chip = RANGE_CHIPS.find((c) => c.key === rangeKey)!;
    const since = chip.days === null ? null : new Date(Date.now() - chip.days * 86400_000);
    const { result, cache: c } = await listRecoverableSessionsFromDrive(since, (p) => setProgress(p));
    if (result.status === 'no_folder') {
      setError('Drive에 백업된 로그가 없습니다.');
      setStage('idle');
      return;
    }
    if (result.status === 'not_signed_in') {
      setError('설정 탭에서 로그인 후 다시 시도하세요.');
      setStage('idle');
      return;
    }
    if (result.status === 'failed') {
      setError(`Drive 목록 조회 실패: ${result.error ?? '알 수 없는 오류'}`);
      setStage('idle');
      return;
    }
    setList(result.sessions);
    setCache(c);
    setLegacyZips(result.legacyZips);
    setFailedZips(result.failedZips);
    // 로컬에 없는 세션만 기본 선택.
    setSelected(new Set(result.sessions.filter((s) => !localIds.has(s.id)).map((s) => s.id)));
    setStage('list');
  };

  const toggle = (id: string) => {
    if (localIds.has(id)) return; // 이미 있는 세션은 선택 불가
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const runRestore = async () => {
    setStage('restoring');
    setProgress('복구 중...');
    const r = await onRestore(selected, cache, (p) => setProgress(p));
    setResultMsg(`✓ 세션 ${r.sessions}개(클립 ${r.clips}개) 복구됨`);
    // F10: drop the cached zip blobs (each is a full downloaded log zip held in memory) once
    // restore is done — they're no longer needed and would otherwise pin Blob memory until the
    // modal unmounts. A fresh "목록 조회" rebuilds the cache.
    setCache(new Map());
    setStage('done');
  };

  const restorableCount = list.filter((s) => !localIds.has(s.id)).length;

  return (
    <Backdrop onClose={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: T.card, borderRadius: 18, border: `1px solid ${T.line}`,
          width: '100%', maxWidth: 380, maxHeight: '82vh',
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
          <div style={{ fontSize: 17, fontWeight: 700, color: T.text }}>Drive에서 세션 복구</div>
          <button
            onClick={onClose}
            aria-label="닫기"
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

        {/* 기간 칩 */}
        <div style={{ padding: '12px 16px 6px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 12, color: T.textMute }}>조회 기간 (Drive 업로드 날짜 기준)</div>
          <div role="radiogroup" aria-label="조회 기간" style={{ display: 'flex', gap: 8 }}>
            {RANGE_CHIPS.map((c) => {
              const active = rangeKey === c.key;
              return (
                <button
                  key={c.key}
                  role="radio"
                  aria-checked={active}
                  onClick={() => setRangeKey(c.key)}
                  disabled={stage === 'listing' || stage === 'restoring'}
                  style={{
                    flex: 1, height: 40, borderRadius: 10,
                    border: `1px solid ${active ? T.blue : T.lineStrong}`,
                    background: active ? 'rgba(41,121,255,0.14)' : 'transparent',
                    color: active ? T.text : T.textDim,
                    fontSize: 13, fontWeight: 700, cursor: 'pointer',
                  }}
                >
                  {c.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* 본문: idle/list 상태별 */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 12px', minHeight: 60 }}>
          {error && (
            <div style={{ padding: 14, fontSize: 13, color: T.amber, lineHeight: 1.5 }}>{error}</div>
          )}
          {(stage === 'listing' || stage === 'restoring') && (
            <div style={{ padding: 20, textAlign: 'center', color: T.textDim, fontSize: 13 }} aria-live="polite">
              {progress || (stage === 'listing' ? 'Drive 로그 목록 조회 중...' : '복구 중...')}
            </div>
          )}
          {stage === 'done' && (
            <div style={{ padding: 20, textAlign: 'center', color: T.green, fontSize: 15, fontWeight: 700 }} aria-live="polite">
              {resultMsg}
            </div>
          )}
          {stage === 'list' && (
            <>
              {(legacyZips > 0 || failedZips > 0) && (
                <div style={{ padding: '4px 8px 8px', fontSize: 11, color: T.textMute, lineHeight: 1.5 }}>
                  {legacyZips > 0 && `구버전 로그 ${legacyZips}개 제외`}
                  {legacyZips > 0 && failedZips > 0 && ' · '}
                  {failedZips > 0 && `⚠️ 로그 ${failedZips}개 읽기 실패`}
                </div>
              )}
              {list.length === 0 ? (
                <div style={{ padding: 20, textAlign: 'center', color: T.textMute, fontSize: 13 }}>
                  이 기간에 복구할 세션이 없습니다.
                </div>
              ) : (
                list.map((s) => {
                  const already = localIds.has(s.id);
                  const checked = selected.has(s.id);
                  return (
                    <button
                      key={s.id}
                      onClick={() => toggle(s.id)}
                      disabled={already}
                      style={{
                        width: '100%',
                        display: 'flex', alignItems: 'center', gap: 12,
                        padding: '12px 10px',
                        background: 'transparent', border: 'none',
                        color: 'inherit',
                        borderBottom: `1px solid ${T.line}`,
                        cursor: already ? 'not-allowed' : 'pointer',
                        textAlign: 'left', opacity: already ? 0.5 : 1,
                      }}
                    >
                      <Checkbox checked={checked && !already} />
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
                          {s.rowCount}행
                          {/* v0.7.0 B0 — 같은 날짜 세션 구분용 시작 시각(hh:mm).
                              레거시 zip은 startedAt이 없거나 0 → 표시 생략. */}
                          {Number.isFinite(s.startedAt) && s.startedAt > 0 &&
                            ` · ${new Date(s.startedAt).toLocaleTimeString('ko-KR', {
                              hour: '2-digit', minute: '2-digit', hour12: false,
                            })}`}
                          {already && ' · 이미 있음'}
                        </div>
                      </div>
                    </button>
                  );
                })
              )}
            </>
          )}
        </div>

        {/* 푸터 */}
        <div
          style={{
            padding: '10px 16px',
            borderTop: `1px solid ${T.line}`,
            display: 'flex', gap: 10,
          }}
        >
          {stage === 'list' ? (
            <>
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
                onClick={runRestore}
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
                선택 복구 ({selected.size})
              </button>
            </>
          ) : stage === 'done' ? (
            <button
              onClick={onClose}
              style={{
                flex: 1, height: 48, borderRadius: 14, border: 'none',
                background: T.blue, color: '#fff',
                fontSize: 15, fontWeight: 800, cursor: 'pointer',
                boxShadow: `0 4px 14px ${T.blueGlow}`,
              }}
            >
              완료
            </button>
          ) : (
            <button
              onClick={runList}
              disabled={stage === 'listing' || stage === 'restoring'}
              aria-busy={stage === 'listing'}
              style={{
                flex: 1, height: 48, borderRadius: 14, border: 'none',
                background: stage === 'listing' ? '#2A2D32' : T.blue,
                color: stage === 'listing' ? T.textMute : '#fff',
                fontSize: 15, fontWeight: 800, letterSpacing: -0.2,
                cursor: stage === 'listing' ? 'wait' : 'pointer',
                boxShadow: stage === 'listing' ? 'none' : `0 4px 14px ${T.blueGlow}`,
              }}
            >
              {stage === 'listing' ? '조회 중…' : '목록 조회'}
            </button>
          )}
        </div>
        {stage === 'list' && restorableCount === 0 && list.length > 0 && (
          <div style={{ padding: '0 16px 10px', fontSize: 11, color: T.textMute, textAlign: 'center' }}>
            조회된 세션이 모두 이미 기기에 있습니다.
          </div>
        )}
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

// ─── export done modal (v0.13.0 R6) ──────────────────────────
/** 내보내기 결과 — 완료 팝업이 보관해 클릭 시 공유/재다운로드에 재사용한다. */
interface ExportResult {
  blob: Blob;
  filename: string;
  kind: 'csv' | 'zip';
}

/** 내보내기 완료를 작은 줄 배너 대신 큰 중앙 팝업으로 안내(민구 시인성 요청). 클릭 동작:
 *  - '파일 열기/공유': Web Share API Level 2(navigator.share({files})). iOS 스탠드얼론 PWA에서
 *    공유 시트(파일에 저장 / Numbers·엑셀로 열기 / 메일)를 띄운다. PWA는 다운로드 파일을 직접
 *    '실행'할 수 없어(보안 경계), '공유시트로 다른 앱에 넘기기'가 실질적 '파일 열기'다. canShare로
 *    지원 확인될 때만 노출, 미지원이면 숨김.
 *  - '다시 다운로드': 보관 Blob을 같은 방식으로 재다운로드(모든 환경 신뢰 폴백).
 *  닫으면 Blob 참조 해제(메모리 회수 — 큰 ZIP이 모달 동안만 메모리에 핀). */
function ExportDoneModal({ result, onClose }: { result: ExportResult; onClose: () => void }) {
  const [shareError, setShareError] = useState<string | null>(null);
  const mime = result.kind === 'csv' ? 'text/csv' : 'application/zip';
  // canShare 파일 지원 가드(미지원 브라우저는 share 버튼 숨김).
  const canShareFile = (() => {
    try {
      const nav = navigator as Navigator & { canShare?: (d?: ShareData) => boolean };
      if (!nav.share || !nav.canShare) return false;
      const f = new File([result.blob], result.filename, { type: mime });
      return nav.canShare({ files: [f] });
    } catch { return false; }
  })();

  const doShare = async () => {
    setShareError(null);
    try {
      const file = new File([result.blob], result.filename, { type: mime });
      await (navigator as Navigator & { share: (d: ShareData) => Promise<void> }).share({
        files: [file],
        title: result.filename,
      });
    } catch (e) {
      // 사용자가 공유 시트를 취소(AbortError)한 건 오류가 아니므로 무시.
      if ((e as Error)?.name !== 'AbortError') {
        setShareError('공유를 열 수 없습니다. 다시 다운로드를 사용하세요.');
      }
    }
  };

  // 보관 Blob을 그대로 재다운로드(downloadBlob은 mime 무관 범용 다운로더 — csv/zip 공용).
  const doRedownload = () => { downloadBlob(result.blob, result.filename); };

  return (
    <Backdrop onClose={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: T.card, borderRadius: 18, border: `1px solid ${T.line}`,
          width: '100%', maxWidth: 380, padding: 24,
          display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'center',
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
        }}
      >
        <div
          style={{
            width: 56, height: 56, borderRadius: 999,
            background: 'rgba(0,200,83,0.14)', border: `2px solid ${T.green}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          {I.check(28, T.green)}
        </div>
        <div style={{ fontSize: 19, fontWeight: 800, color: T.text }}>내보내기 완료</div>
        <div
          style={{
            fontSize: 14, color: T.textDim, textAlign: 'center', lineHeight: 1.5,
            fontFamily: 'JetBrains Mono, ui-monospace, monospace',
            wordBreak: 'break-all', overflowWrap: 'anywhere',
          }}
        >
          {result.filename}
        </div>
        <div style={{ fontSize: 12.5, color: T.textMute, textAlign: 'center', lineHeight: 1.5 }}>
          기기에 저장되었습니다.{canShareFile ? ' 다른 앱(엑셀·파일·메일)으로 열려면 아래 공유를 누르세요.' : ''}
        </div>
        {shareError && (
          <div style={{ fontSize: 12.5, color: T.red, textAlign: 'center' }}>{shareError}</div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%', marginTop: 2 }}>
          {canShareFile && (
            <button
              onClick={doShare}
              style={{
                width: '100%', height: 50, borderRadius: 14, border: 'none',
                background: T.blue, color: '#fff', fontSize: 15, fontWeight: 800,
                letterSpacing: -0.2, cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                boxShadow: `0 4px 14px ${T.blueGlow}`,
              }}
            >
              {I.share(18, '#fff')} 파일 열기 / 공유
            </button>
          )}
          <button
            onClick={doRedownload}
            style={{
              width: '100%', height: 50, borderRadius: 14,
              border: `1px solid ${T.lineStrong}`, background: 'transparent',
              color: T.text, fontSize: 15, fontWeight: 700, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            }}
          >
            {I.download(18, T.text)} 다시 다운로드
          </button>
          <button
            onClick={onClose}
            style={{
              width: '100%', height: 46, borderRadius: 14,
              border: 'none', background: 'transparent',
              color: T.textDim, fontSize: 14, fontWeight: 700, cursor: 'pointer',
            }}
          >
            닫기
          </button>
        </div>
      </div>
    </Backdrop>
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
        // v0.33.0 safe-area — position:fixed라 App 셸 패딩 밖. 노치/홈인디케이터 침범 방지
        //   (SettingsScreen backdrop 패턴). 일반 Safari 탭에선 var(--sa*)=0 → 기존 16px 유지.
        paddingTop: 'max(16px, var(--sat))',
        paddingBottom: 'max(16px, var(--sab))',
        paddingLeft: 'max(16px, var(--sal))',
        paddingRight: 'max(16px, var(--sar))',
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

// ─── session detail modal (v0.13.0 R5) ───────────────────────
/** 세션 상세를 인라인 확장 대신 넓은 센터 모달로 띄운다(민구 요청). 세션이 늘어날 때 인라인 펼침이
 *  리스트 흐름을 잠식해 데이터 화면이 줄어들던 문제 해소. 멀티컬럼 가로스크롤 표라 기존 좁은 모달
 *  (max 360) 대신 near-fullscreen 센터 패널(min(720px,96vw)/90vh)을 쓴다. 표 자체는 FullRowTable
 *  재사용(maxHeight를 모달용으로 키움). 닫을 때 재생 중 클립 정지. */
function SessionDetailModal({
  session, onClose, onCellSave,
}: {
  session: Session;
  onClose: () => void;
  onCellSave: (rowIndex: number, colId: string, value: string) => void;
}) {
  const close = () => { clipPlayer.stop(); onClose(); };
  return (
    <Backdrop onClose={close}>
      <div
        data-testid="session-detail-modal"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: T.card, borderRadius: 18, border: `1px solid ${T.line}`,
          // v0.33.0 safe-area — maxHeight를 90vh → 100%로. vh는 safe-area를 모르는 물리 뷰포트
          //   기준이라 아이폰 노치/홈바를 침범했다(유력 원인). 부모 Backdrop이 safe-area 패딩을
          //   가지므로 그 콘텐츠 박스의 100%가 곧 "안전한 최대 높이"다.
          width: '100%', maxWidth: 'min(720px, 96vw)', maxHeight: '100%',
          display: 'flex', flexDirection: 'column',
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)', overflow: 'hidden',
        }}
      >
        <div
          style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '16px 18px', borderBottom: `1px solid ${T.line}`, flexShrink: 0,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontSize: 17, fontWeight: 800, color: T.text, letterSpacing: -0.2,
                fontFamily: 'JetBrains Mono, ui-monospace, monospace', whiteSpace: 'nowrap',
              }}
            >
              {session.date}
            </div>
            {session.label && (
              <div style={{ fontSize: 13, color: T.textMute, marginTop: 2 }}>{session.label}</div>
            )}
          </div>
          <div style={{ flex: 1 }} />
          <div
            style={{
              display: 'flex', alignItems: 'baseline', gap: 4,
              padding: '6px 12px', borderRadius: 10, background: 'rgba(255,255,255,0.04)',
            }}
          >
            <span style={{ fontSize: 18, fontWeight: 800, color: T.text, fontFamily: 'JetBrains Mono, ui-monospace, monospace' }}>
              {session.completedRows}
            </span>
            <span style={{ fontSize: 13, color: T.textMute, fontWeight: 600 }}>행</span>
          </div>
          <button
            onClick={close}
            title="닫기"
            data-testid="session-detail-close"
            style={{
              flexShrink: 0, width: 40, height: 40, borderRadius: 12,
              border: `1px solid ${T.lineStrong}`, background: 'transparent',
              color: T.textDim, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            {I.close(18, T.textDim)}
          </button>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <FullRowTable session={session} onCellSave={onCellSave} tableMaxHeight="calc(90vh - 150px)" />
        </div>
      </div>
    </Backdrop>
  );
}

// ─── full editable table ─────────────────────────────────────
function FullRowTable({
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
      // v0.33.0 B-9 — 클립 재생 계측(이전엔 무로깅 → 클립버튼 오터치 제보를 검증할 수 없었다).
      // 실제 재생 의도(enqueue)만 기록 — 정지/취소 탭은 로깅하지 않아 링버퍼를 아낀다. 키에서
      // 세션 id를 파생해 clipsManifest 조인이 가능하게 한다(clipKey 동봉).
      // v0.34.0 계측 갭②(B-9 원안 완성, Trace) — row/colId 동봉: 클립 키는
      // `sess_<ts>:<row>:<colId>[:cmd<n>]` 규약이므로 여기서 파생한다. "클립 재생 중 발화
      // 오인식" 체크리스트가 재생된 셀과 직후 STT 이벤트를 로그만으로 조인하는 판정 근거.
      const parts = key.split(':');
      const rowNum = Number(parts[1]);
      logger.log({
        type: 'clip',
        extra: 'clip_play',
        clipKey: key,
        sessionId: parts[0],
        row: Number.isFinite(rowNum) ? rowNum : undefined,
        colId: parts[2],
      });
      queue.push(key); notify();
      void playNext();
    },
    // 데이터탭 언마운트·세션 삭제 시 호출 — 전역 재생이 화면 밖에서 지속되지 않도록 (Codex HIGH)
    stop,
  };
})();

/** v0.33.0 #9 — 값 전용 셀. 클립 재생 버튼은 ClipCell(전용 44px 컬럼)로 분리되어
 *  값 탭=편집만 남았다(재생 버튼 오터치 구조적 소멸, 07-10 QA P1). */
function EditableCell({
  col, value, width, onSave,
}: {
  col: Column;
  value: string;
  width: number;
  onSave: (v: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [local, setLocal] = useState(value);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const skipBlurRef = useRef(false);

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
      )}
    </div>
  );
}

/** v0.33.0 #9 — 클립 재생 전용 셀(44px 컬럼). 값 셀(EditableCell)에서 재생 버튼을 분리해
 *  오터치를 구조적으로 없앤다. 터치 타깃은 44×44 이상(장갑·한 손 계약). 재생 상태 색·title·
 *  aria-label 규약은 기존(v0.13.0 R4) 그대로 승계 — clipPlayer.toggle 내부의 clip_play 계측도
 *  경로 불변. 클립 없는 행은 빈 자리만 유지해 컬럼 정렬을 지킨다. */
function ClipCell({ clipKey, value }: { clipKey?: string; value: string }) {
  const clipState = useSyncExternalStore(
    clipPlayer.subscribe,
    () => (clipKey ? clipPlayer.stateOf(clipKey) : 'idle'),
  );
  return (
    <div
      data-testid="clip-cell"
      style={{
        width: 44, flexShrink: 0, minHeight: 44,
        borderRight: `1px solid ${T.line}`,
        display: 'flex', alignItems: 'stretch',
      }}
    >
      {clipKey && (
        <button
          onClick={() => clipPlayer.toggle(clipKey)}
          data-testid="clip-cell-button"
          // v0.13.0 R4 — 클립이 부자연/판독불가여도 어떤 값을 말한 클립인지 화면으로 확정할 수 있게
          // 재생 버튼 title에 인식값을 함께 노출.
          title={
            clipState === 'playing' ? '정지'
            : clipState === 'queued' ? '대기 중 (탭하면 취소)'
            : value ? `음성 재생: ${value}` : '음성 재생'
          }
          aria-label={value ? `음성 재생: ${value}` : '음성 재생'}
          style={{
            flex: 1, minWidth: 44, minHeight: 44, padding: 0,
            background: 'transparent', border: 'none',
            color: clipState === 'playing' ? T.amber : clipState === 'queued' ? T.textMute : T.blue,
            cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          {clipState === 'playing' ? I.stop(14, T.amber) : I.play(14, clipState === 'queued' ? T.textMute : T.blue)}
        </button>
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
