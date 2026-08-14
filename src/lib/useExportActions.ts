/**
 * v0.49 R1 리팩토링 P2 — 데이터탭 «내보내기» 서브 훅 (useDataActions에서 순수 이동 — [ENV-12] #0
 * 해소 계획 명시분: export 절(handleExport/runZipExport) 분리).
 * busy/msg는 조립 훅(useDataActions) 소유 — setter를 받는다. 로직·계측은 이동 전과 바이트 동일.
 * 🔴 `ExportResult` 소비처(ExportDoneModal)는 계속 `./useDataActions`에서 import한다(재수출 유지).
 */
import { useCallback, useState } from 'react';
import { useDataStore } from '../stores/dataStore';
import { downloadCsv, csvToBlob, sessionsToCsv, sessionsToCsvZip } from './csv';
import { exportLogZip, downloadZip } from './exportLog';

/** 내보내기 결과 — 완료 팝업(ExportDoneModal)이 보관해 클릭 시 공유/재다운로드에 재사용한다. */
export interface ExportResult {
  blob: Blob;
  filename: string;
  kind: 'csv' | 'zip';
}

export function useExportActions(deps: {
  setBusy: (v: string | null) => void;
  setMsg: (v: string | null) => void;
}) {
  const { setBusy, setMsg } = deps;
  const [exportModalOpen, setExportModalOpen] = useState(false);
  // 다중 세션 로그 ZIP 내보내기 확인 대상 (v0.12 Codex MEDIUM): 여러 세션의 클립을 한 번에 압축하면
  // 용량/지연이 커질 수 있어 2개 이상일 때 확인 단계를 거친다. CSV는 가벼우니 확인 없이 즉시 진행.
  const [pendingZipIds, setPendingZipIds] = useState<string[] | null>(null);
  // v0.13.0 R6 — 내보내기 결과(완료 팝업용). 작은 줄 배너(msg) 대신 큰 모달로 띄우고, 보관한 Blob으로
  // 클릭 시 공유시트/재다운로드를 제공한다. 모달을 닫을 때 null로 비워 Blob 참조를 해제(메모리 회수).
  const [exportResult, setExportResult] = useState<ExportResult | null>(null);

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
  }, [setBusy, setMsg]);

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
  }, [runZipExport, setBusy, setMsg]);

  return {
    exportModalOpen, setExportModalOpen,
    pendingZipIds, setPendingZipIds,
    exportResult, setExportResult,
    runZipExport, handleExport,
  };
}
