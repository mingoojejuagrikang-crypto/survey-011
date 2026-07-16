import { T } from '../../tokens';
import type { Column } from '../../types';
import { autoValue } from '../../lib/autoValue';

/** v0.20.0 설정탭#1 — 입력방식 라벨(자동/음성/수동). 설정탭 SegmentToggle 라벨과 일치. */
const INPUT_LABELS: Record<Column['input'], string> = {
  auto: '자동',
  voice: '음성',
  touch: '수동',
};

/** v0.32.0 — 컬럼의 값/범위 표기(ColumnDetailRow·ColumnGridCell 공용). 고정값 → 그 값,
 *  순차 → from~to, 옵션 → 선택값들, 음성/수동 → 입력대기 표시. */
function columnValueText(col: Column): string {
  if (col.input === 'voice') return '음성 입력';
  if (col.input === 'touch') return '직접 입력';
  if (col.auto.kind === 'seq') return `${col.auto.from} ~ ${col.auto.to}`;
  if (col.type === 'date') {
    // v0.21.0 설정탭#3 — 자동입력+날짜는 실제 치환될 날짜를 함께 보여준다. autoValue()(autoValue.ts)
    //   가 '오늘'→ISO 날짜 변환을 이미 보유 — 재사용. '오늘'(또는 빈값=오늘)이면 "오늘 (YYYY-MM-DD)"로,
    //   날짜 지정이면 그 날짜를 그대로 표시(이 분기는 col.auto.kind==='fixed' 전제).
    const resolved = autoValue(col, 1); // '오늘'/빈값 → 오늘 ISO, 지정일 → 그 날짜
    const isTodayDynamic =
      col.auto.kind === 'fixed' && (col.auto.value === '오늘' || col.auto.value === '');
    return isTodayDynamic ? `오늘 (${resolved})` : resolved || '(빈값)';
  }
  if (col.auto.kind === 'fixed') return col.auto.value || '(빈값)';
  if (col.auto.kind === 'options') {
    return col.auto.selected.length > 0 ? col.auto.selected.join(', ') : '(미선택)';
  }
  return '';
}

/** v0.20.0 설정탭#1 — 게이트 컬럼별 상세 한 줄. 값/범위·알람조건·이상값 범위를 columns에서 파생.
 *  v0.32.0 B1 — 무스크롤 게이트에 맞춰 밀도 압축(패딩 4px·본문 12px). ≤12컬럼 경로 전용. */
export function ColumnDetailRow({ col }: { col: Column }) {
  const valueText = columnValueText(col);
  const trendText =
    col.trendRule === 'increase' ? '증가' : col.trendRule === 'decrease' ? '감소' : null;
  const pctText =
    typeof col.pctThreshold === 'number' && Number.isFinite(col.pctThreshold) && col.pctThreshold > 0
      ? `±${col.pctThreshold}%`
      : null;

  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '4px 8px', borderRadius: 8, background: 'rgba(255,255,255,0.02)',
      }}
    >
      <span
        style={{
          fontSize: 12, fontWeight: 800, color: T.text, flexShrink: 0,
          maxWidth: 96, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}
        title={col.name}
      >
        {col.name || '(이름없음)'}
      </span>
      <span
        style={{
          fontSize: 10, fontWeight: 700, color: T.textMute, flexShrink: 0,
          padding: '1px 7px', borderRadius: 999, border: `1px solid ${T.line}`,
        }}
      >
        {INPUT_LABELS[col.input]}
      </span>
      <span
        style={{
          flex: 1, minWidth: 0, fontSize: 12, fontWeight: 700, color: T.textDim,
          fontFamily: 'JetBrains Mono, ui-monospace, monospace', letterSpacing: -0.2,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textAlign: 'right',
        }}
        title={valueText}
      >
        {valueText}
      </span>
      {trendText && (
        <span
          style={{
            fontSize: 10, fontWeight: 800, color: T.amber, flexShrink: 0,
            padding: '1px 7px', borderRadius: 999, background: 'rgba(255,179,0,0.12)',
          }}
        >
          추세 {trendText}
        </span>
      )}
      {pctText && (
        <span
          style={{
            fontSize: 10, fontWeight: 800, color: T.red, flexShrink: 0,
            padding: '1px 7px', borderRadius: 999, background: 'rgba(255,82,82,0.12)',
            fontFamily: 'JetBrains Mono, ui-monospace, monospace',
          }}
        >
          {pctText}
        </span>
      )}
    </div>
  );
}

/** v0.32.0 B1 — >12컬럼용 2열 그리드 셀(무스크롤 유지를 위한 고밀도 모드).
 *  1행: 이름 + 입력방식 pill / 2행: 값·범위(ellipsis, title로 전체값). */
export function ColumnGridCell({ col }: { col: Column }) {
  const valueText = columnValueText(col);
  return (
    <div
      style={{
        display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0,
        padding: '3px 6px', borderRadius: 8, background: 'rgba(255,255,255,0.02)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
        <span
          style={{
            flex: 1, minWidth: 0, fontSize: 11, fontWeight: 800, color: T.text,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}
          title={col.name}
        >
          {col.name || '(이름없음)'}
        </span>
        <span
          style={{
            fontSize: 9, fontWeight: 700, color: T.textMute, flexShrink: 0,
            padding: '0 6px', borderRadius: 999, border: `1px solid ${T.line}`,
          }}
        >
          {INPUT_LABELS[col.input]}
        </span>
      </div>
      <span
        style={{
          fontSize: 11, fontWeight: 700, color: T.textDim, minWidth: 0,
          fontFamily: 'JetBrains Mono, ui-monospace, monospace', letterSpacing: -0.2,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}
        title={valueText}
      >
        {valueText}
      </span>
    </div>
  );
}

/** v0.32.0 설정탭 UX(Vance) B1/B2 공용 — 설정 요약 블록(무스크롤): 입력방식 카운트 pill + 세션명 +
 *  컬럼 목록. 내부 스크롤 금지 — 컬럼 ≤12는 한 줄씩(ColumnDetailRow), >12는 2열 그리드로 밀도 전환.
 *  게이트('설정값 확인')와 설정 요약 팝업이 같은 컴포넌트를 쓴다(표기 불일치 방지). */
