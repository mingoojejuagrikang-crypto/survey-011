import { T } from '../../tokens';
import { I } from '../icons';
import type { Column } from '../../types';
import { SettingsSummary, SummaryStatusRow } from './SettingsSummary';
import { ModalBase } from '../ModalBase';

export function SettingsSummaryModal({
  googleConnected, userEmail, sheetLabel, columns, totalRows, sessionLabel,
  recognitionTolerance, ttsRate, fastRecognition, tableGenerated, generatedRows, onClose,
}: {
  googleConnected: boolean;
  userEmail: string | null;
  sheetLabel: string | null;
  columns: Column[];
  totalRows: number;
  sessionLabel: string;
  recognitionTolerance: number;
  ttsRate: number;
  fastRecognition: boolean;
  tableGenerated: boolean;
  generatedRows: number;
  onClose: () => void;
}) {
  return (
    <ModalBase
      onClose={onClose}
      testid="settings-summary-modal"
      role="dialog"
      ariaModal
      ariaLabel="설정 요약"
      blur
      animation="fade-up 200ms ease-out"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        data-testid="settings-summary-card"
        style={{
          background: T.card, borderRadius: 18, border: `1px solid ${T.line}`,
          width: '100%', maxWidth: 480, maxHeight: '84vh',
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
          <div style={{ fontSize: 17, fontWeight: 700, color: T.text }}>설정 요약</div>
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

        <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <SummaryStatusRow
              label="Google"
              value={googleConnected ? `연결됨 · ${userEmail ?? ''}` : '미연결'}
              ok={googleConnected}
            />
            <SummaryStatusRow label="시트" value={sheetLabel ?? '미연결'} ok={!!sheetLabel} />
            <SummaryStatusRow
              label="테이블"
              value={tableGenerated ? `생성됨 · 총 ${generatedRows}행` : '미생성'}
              ok={tableGenerated}
            />
          </div>
          <SettingsSummary columns={columns} totalRows={totalRows} sessionLabel={sessionLabel} />
          {/* 다이얼·토글 한 줄 요약(입력탭 다이얼 값 포함 — 설정을 한눈에). */}
          <div
            style={{
              textAlign: 'center', fontSize: 12, fontWeight: 700, color: T.textDim,
              fontFamily: 'JetBrains Mono, ui-monospace, monospace', letterSpacing: -0.2,
            }}
          >
            인식 {Math.round(recognitionTolerance * 100)}% · 안내 {ttsRate}x · 빠른 인식 {fastRecognition ? 'ON' : 'OFF'}
          </div>
        </div>

        <div style={{ padding: '12px 16px', borderTop: `1px solid ${T.line}` }}>
          <button
            onClick={onClose}
            style={{
              width: '100%', height: 48, borderRadius: 14, border: 'none',
              background: T.blue, color: '#fff',
              fontSize: 15, fontWeight: 800, cursor: 'pointer',
              boxShadow: `0 4px 14px ${T.blueGlow}`,
            }}
          >
            닫기
          </button>
        </div>
      </div>
    </ModalBase>
  );
}

/** 초기화 모달의 체크박스 행(44px 터치 타깃, 라벨 전체가 탭 영역). */
