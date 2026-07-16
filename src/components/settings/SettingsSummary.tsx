import { T } from '../../tokens';
import type { Column } from '../../types';
import { ColumnDetailRow, ColumnGridCell } from './ColumnPreviewParts';

export function SettingsSummary({ columns, totalRows, sessionLabel }: {
  columns: Column[];
  totalRows: number;
  sessionLabel?: string | null;
}) {
  const voiceCount = columns.filter((c) => c.input === 'voice').length;
  const autoCount = columns.filter((c) => c.input === 'auto').length;
  const touchCount = columns.filter((c) => c.input === 'touch').length;
  const dense = columns.length > 12;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        <SummaryPill label="음성입력" value={voiceCount} accent />
        <SummaryPill label="자동입력" value={autoCount} />
        <SummaryPill label="수동입력" value={touchCount} />
        <SummaryPill label="전체 항목" value={columns.length} />
        <SummaryPill label="총 행수" value={totalRows} />
      </div>
      {sessionLabel && (
        <div
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '7px 12px', borderRadius: 10,
            background: 'rgba(0,200,83,0.10)', border: '1px solid rgba(0,200,83,0.30)',
          }}
        >
          <span style={{ fontSize: 12, fontWeight: 700, color: T.textDim, flexShrink: 0 }}>
            세션명
          </span>
          <span
            style={{
              flex: 1, minWidth: 0, fontSize: 13, fontWeight: 800, color: T.text,
              fontFamily: 'JetBrains Mono, ui-monospace, monospace', letterSpacing: -0.2,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textAlign: 'right',
            }}
            title={sessionLabel}
          >
            {sessionLabel}
          </span>
        </div>
      )}
      <div
        style={{
          display: dense ? 'grid' : 'flex',
          ...(dense
            ? { gridTemplateColumns: '1fr 1fr', gap: 3 }
            : { flexDirection: 'column' as const, gap: 3 }),
          border: `1px solid ${T.line}`, borderRadius: 10, padding: 4,
          background: T.inputBg,
        }}
      >
        {columns.map((c) => (dense ? <ColumnGridCell key={c.id} col={c} /> : <ColumnDetailRow key={c.id} col={c} />))}
      </div>
    </div>
  );
}

/** v0.19.0 W3 — 게이트 요약 칩(라벨 + 숫자). 의미색 변경 없음(음성=blue accent).
 *  v0.32.0 B1 — 무스크롤 게이트/팝업에 맞춰 압축(패딩 4px·숫자 15px). */
function SummaryPill({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div
      style={{
        display: 'flex', alignItems: 'baseline', gap: 5,
        padding: '4px 10px', borderRadius: 10,
        background: accent ? 'rgba(41,121,255,0.12)' : 'rgba(255,255,255,0.05)',
        border: `1px solid ${accent ? 'rgba(41,121,255,0.35)' : T.line}`,
      }}
    >
      <span style={{ fontSize: 11, color: accent ? T.blue : T.textDim, fontWeight: 700 }}>{label}</span>
      <span
        style={{
          fontSize: 15, fontWeight: 800, color: accent ? T.blue : T.text,
          fontFamily: 'JetBrains Mono, ui-monospace, monospace', letterSpacing: -0.5,
        }}
      >
        {value}
      </span>
    </div>
  );
}

// ─── v0.32.0 설정탭 UX(Vance) — 설정 요약 팝업 + 초기화 확인 모달 ─────────────

/** 요약 팝업의 상태 한 줄(라벨 + 값). ok=true면 값이 green, false면 dim. */
export function SummaryStatusRow({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
      <span style={{ fontSize: 12, fontWeight: 700, color: T.textDim, flexShrink: 0, width: 52 }}>
        {label}
      </span>
      <span
        style={{
          flex: 1, minWidth: 0, fontSize: 13, fontWeight: 700,
          color: ok ? T.green : T.textMute, textAlign: 'right',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}
        title={value}
      >
        {value}
      </span>
    </div>
  );
}

/** v0.32.0 B2 — 설정 요약 팝업(설정탭 전용, 닫기 전용, 375×812 무스크롤). 로그인·시트 연결 상태,
 *  SettingsSummary(게이트와 공용), 다이얼/토글 한 줄, 생성 상태를 한 화면에 모은다.
 *  '생성됨' 문구는 이 팝업이 열려 있을 때만 DOM에 존재(조건부 마운트) — 기존 text=생성됨 로케이터는
 *  액션바 버튼만 보는 흐름이라 충돌 없음. */
