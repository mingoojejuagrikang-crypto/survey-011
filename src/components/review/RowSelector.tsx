/**
 * 비교탭 행 선택 패널 — 후보 행(candidateRows) 중 표시할 행을 사용자가 직접 체크한다.
 * 후보 외 키는 애초에 노출되지 않으므로 "후보 외 선택불가"가 구조적으로 보장된다.
 *
 * 상태 표현(reviewSelectedRows: string[]|null):
 *  - null = 후보 전체 표시(기본). 화면에선 전부 체크된 것으로 그린다.
 *  - string[] = 선택된 키 부분집합(빈 배열이면 0행).
 * 토글은 항상 명시 배열로 정규화해 set한다. "전체"는 null(전체), "해제"는 [](0행).
 *
 * 후보가 1개뿐이거나 0개면 선택 UI를 숨긴다(선택할 게 없음 — 표가 그대로 전체를 보여줌).
 */
import { T } from '../../tokens';
import { I } from '../icons';
import { FS } from './reviewShared';
import type { ReviewRow } from '../../lib/reviewQuery';
import type { Column } from '../../types';

/** 후보 행을 가변 차원으로 라벨링(없으면 키 그대로). FilterPickerSheet/PivotTable과 동일 규칙. */
function rowLabel(r: ReviewRow, rowDims: Column[]): string {
  if (rowDims.length === 0) return r.key;
  return rowDims.map((c) => (r.rec[c.id] ?? '').trim()).filter(Boolean).join(' · ') || r.key;
}

export function RowSelector({
  candidateRows,
  rowDims,
  selected,
  onChange,
}: {
  candidateRows: ReviewRow[];
  rowDims: Column[];
  /** reviewSelectedRows: null=전체, []=0행, [...]=부분집합. */
  selected: string[] | null;
  onChange: (next: string[] | null) => void;
}) {
  if (candidateRows.length <= 1) return null;

  const selectedSet = selected === null ? null : new Set(selected);
  const isOn = (key: string) => selectedSet === null || selectedSet.has(key);
  const onCount = selectedSet === null ? candidateRows.length : candidateRows.filter((r) => selectedSet.has(r.key)).length;
  const allOn = onCount === candidateRows.length;

  const toggle = (key: string) => {
    // 현재 명시 집합(없으면 전체)에서 한 키만 뒤집어 명시 배열로 정규화.
    const base = selectedSet === null ? new Set(candidateRows.map((r) => r.key)) : new Set(selectedSet);
    if (base.has(key)) base.delete(key);
    else base.add(key);
    // 전부 켜졌으면 null(전체)로 환원 — 후보 변동 시 자연 추종.
    if (base.size === candidateRows.length) onChange(null);
    else onChange(candidateRows.filter((r) => base.has(r.key)).map((r) => r.key));
  };

  return (
    <div
      data-testid="review-rowselector"
      style={{
        background: T.card,
        border: `1px solid ${T.line}`,
        borderRadius: 14,
        padding: '10px 12px',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ fontSize: FS.small, color: T.textMute, fontWeight: 700 }}>
          표시할 행 ({onCount}/{candidateRows.length})
        </span>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            data-testid="review-rows-all"
            onClick={() => onChange(null)}
            disabled={allOn}
            style={miniBtn(allOn)}
          >
            전체
          </button>
          <button
            data-testid="review-rows-none"
            onClick={() => onChange([])}
            disabled={onCount === 0}
            style={miniBtn(onCount === 0)}
          >
            해제
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {candidateRows.map((r) => {
          const on = isOn(r.key);
          return (
            <button
              key={r.key}
              data-testid="review-row-check"
              data-key={r.key}
              aria-pressed={on}
              onClick={() => toggle(r.key)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                minHeight: 38,
                padding: '0 12px',
                borderRadius: 999,
                border: `1px solid ${on ? T.blue : T.line}`,
                background: on ? T.blueGlow : T.inputBg,
                color: on ? '#BBD4FF' : T.textDim,
                fontSize: FS.small,
                fontWeight: on ? 700 : 600,
                cursor: 'pointer',
                letterSpacing: -0.1,
              }}
            >
              <span
                style={{
                  width: 16,
                  height: 16,
                  borderRadius: 5,
                  border: `1.5px solid ${on ? T.blue : T.lineStrong}`,
                  background: on ? T.blue : 'transparent',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                {on && I.check(11, '#fff')}
              </span>
              {rowLabel(r, rowDims)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function miniBtn(disabled: boolean): React.CSSProperties {
  return {
    minHeight: 32,
    padding: '0 12px',
    borderRadius: 999,
    border: `1px solid ${T.line}`,
    background: T.inputBg,
    color: disabled ? T.textMute : T.textDim,
    fontSize: 12,
    fontWeight: 700,
    cursor: disabled ? 'default' : 'pointer',
    opacity: disabled ? 0.5 : 1,
  };
}
