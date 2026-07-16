/**
 * v0.35.2 Stage 2 — 데이터탭 액션 오케스트레이션 훅 (DataScreen에서 순수 이동, GL-006 §7~8 UI/로직 분리).
 * 시트 동기화·Drive 로그 백업·내보내기·세션 복구·삭제·재로그인 resume의 상태와 핸들러를 소유한다.
 * 화면(DataScreen)은 표현만 담당하고 이 훅의 반환값을 배선한다. 로직·계측(extra 문자열)은 이동 전과
 * 바이트 동일(SOP-003 파서 계약).
 */
import { useCallback, useRef, useState } from 'react';
import { useDataStore } from '../stores/dataStore';
import { useSettingsStore } from '../stores/settingsStore';
import { syncSelected, type SyncReport } from './sync';
import { downloadCsv, csvToBlob, sessionsToCsv, sessionsToCsvZip } from './csv';
import { deleteSession as dbDeleteSession, saveSession, resetDb } from './db';
import type { Session } from '../types';
import { exportLogZip, exportLogZipsPerSession, downloadZip } from './exportLog';
import { uploadLogToBothDrives } from './driveUpload';
import { hydrateSessions } from './hydrate';
import { getAccessToken, signIn } from './googleAuth';
import { restoreSelectedSessions, type ZipCache } from './recoverFromDrive';
import { logger } from './logger';
import { clipPlayer } from './clipPlayer';

/** 내보내기 결과 — 완료 팝업(ExportDoneModal)이 보관해 클릭 시 공유/재다운로드에 재사용한다. */
export interface ExportResult {
  blob: Blob;
  filename: string;
  kind: 'csv' | 'zip';
}


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

export function useDataActions() {
  const updateRowValue = useDataStore((s) => s.updateRowValue);
  const removeSession = useDataStore((s) => s.removeSession);

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
  // v0.13.0 R6 — 내보내기 결과(완료 팝업용). 작은 줄 배너(msg) 대신 큰 모달로 띄우고, 보관한 Blob으로
  // 클릭 시 공유시트/재다운로드를 제공한다. 모달을 닫을 때 null로 비워 Blob 참조를 해제(메모리 회수).
  const [exportResult, setExportResult] = useState<ExportResult | null>(null);

  // v0.20.0 Phase 2 — 범용 "로그인 필요" 팝업 상태. 토큰 만료/미로그인이 감지되는 모든 지점(시트
  // 동기화·Drive 백업·세션 복구)에서 reason 문구와 함께 마운트한다. `resume`은 재로그인 성공 직후
  // 다시 실행할 직전 동작 클로저 — 사용자가 하던 일을 잃지 않고 이어가게 한다(graceful resume).
  const [loginPrompt, setLoginPrompt] = useState<{ reason: string; resume: () => void } | null>(null);

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

  return {
    busy, msg,
    syncModalOpen, setSyncModalOpen,
    exportModalOpen, setExportModalOpen,
    deleteTarget, setDeleteTarget,
    failureReport, setFailureReport,
    pendingZipIds, setPendingZipIds,
    recoverModalOpen, setRecoverModalOpen,
    exportResult, setExportResult,
    loginPrompt, setLoginPrompt,
    handleLoginPromptLogin,
    runZipExport, handleExport, handleCellSave,
    handleSyncConfirm, handleRetry, handleDeleteConfirm,
    handleRecoverClick, handleRecoverRestore,
  };
}
