/**
 * 비교탭 +필터 바텀시트 — (1) 차원 컬럼 AND 필터 추가(컬럼 선택 → 값 선택, distinctValues),
 * (2) 회차(주차) 비교 기준 지정(target 회차 select + baseline N회차 전). 주차 칩은 단일(라디오).
 *
 * 데이터는 전부 reviewQuery.distinctValues(index, col) / index.rounds에서 온다(추가 fetch 없음).
 * 차원 후보 = effectiveSampleKey 키 컬럼(date 회차 컬럼 제외). 값 선택 즉시 onAddFilter로 닫힌다.
 */
import { useState } from 'react';
import { T } from '../../tokens';
import { I } from '../icons';
import { FS, roundLabel } from './reviewShared';
import { distinctValues } from '../../lib/reviewQuery';
import type { PastIndex } from '../../lib/pastValues';
import type { Column } from '../../types';

export function FilterPickerSheet({
  index,
  dimColumns,
  rounds,
  targetRound,
  baselineBack,
  onAddFilter,
  onSetTarget,
  onSetBaselineBack,
  onClose,
}: {
  index: PastIndex;
  /** 필터 가능한 차원(키) 컬럼 — effectiveSampleKey true, 회차(date) 컬럼 제외. */
  dimColumns: Column[];
  /** 인덱스 회차 ISO 오름차순. */
  rounds: string[];
  targetRound: string | null;
  baselineBack: number;
  onAddFilter: (colId: string, value: string) => void;
  onSetTarget: (iso: string | null) => void;
  onSetBaselineBack: (n: number) => void;
  onClose: () => void;
}) {
  // 단계: 컬럼 선택(null) → 값 선택(선택된 컬럼).
  const [pickCol, setPickCol] = useState<Column | null>(null);
  const values = pickCol ? distinctValues(index, pickCol) : [];

  return (
    <div
      data-testid="review-filter-sheet"
      role="dialog"
      aria-label="비교 필터 추가"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 50,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 'min(560px, 100vw)',
          maxHeight: '82vh',
          overflowY: 'auto',
          WebkitOverflowScrolling: 'touch',
          background: T.card,
          borderTopLeftRadius: 20,
          borderTopRightRadius: 20,
          border: `1px solid ${T.line}`,
          padding: '14px 16px 24px',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 17, fontWeight: 800, color: T.text }}>
            {pickCol ? `${pickCol.name} 값 선택` : '비교 조건'}
          </div>
          <button
            aria-label="닫기"
            onClick={pickCol ? () => setPickCol(null) : onClose}
            style={{
              width: 36,
              height: 36,
              borderRadius: 12,
              border: `1px solid ${T.line}`,
              background: T.inputBg,
              color: T.textDim,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
            }}
          >
            {pickCol ? I.chevron(16, 'currentColor') : I.close(16, 'currentColor')}
          </button>
        </div>

        {pickCol ? (
          // ── 2단계: 값 선택 ──
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {values.length === 0 ? (
              <span style={{ fontSize: FS.small, color: T.textMute }}>선택 가능한 값이 없습니다</span>
            ) : (
              values.map((v) => (
                <button
                  key={v}
                  data-testid="review-filter-value"
                  onClick={() => {
                    onAddFilter(pickCol.id, v);
                    setPickCol(null);
                    onClose();
                  }}
                  style={chipBtn(false)}
                >
                  {v}
                </button>
              ))
            )}
          </div>
        ) : (
          <>
            {/* ── 차원 필터 추가(AND) ── */}
            <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ fontSize: FS.small, color: T.textMute, fontWeight: 700 }}>
                항목으로 좁히기 (AND)
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {dimColumns.length === 0 ? (
                  <span style={{ fontSize: FS.small, color: T.textMute }}>필터 가능한 키 항목이 없습니다</span>
                ) : (
                  dimColumns.map((c) => (
                    <button
                      key={c.id}
                      data-testid={`review-filter-col-${c.id}`}
                      onClick={() => setPickCol(c)}
                      style={chipBtn(false)}
                    >
                      {c.name}
                    </button>
                  ))
                )}
              </div>
            </section>

            {/* ── 회차(주차) 비교 기준 ── */}
            <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ fontSize: FS.small, color: T.textMute, fontWeight: 700 }}>
                비교 기준 회차 (주차)
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                <button
                  data-testid="review-round-auto"
                  onClick={() => onSetTarget(null)}
                  aria-pressed={targetRound === null}
                  style={chipBtn(targetRound === null)}
                >
                  최근 (자동)
                </button>
                {[...rounds].reverse().map((iso) => (
                  <button
                    key={iso}
                    data-testid={`review-round-opt-${iso}`}
                    onClick={() => onSetTarget(iso)}
                    aria-pressed={targetRound === iso}
                    style={chipBtn(targetRound === iso)}
                  >
                    {roundLabel(iso)}
                  </button>
                ))}
              </div>

              <div style={{ fontSize: FS.small, color: T.textMute, fontWeight: 700, marginTop: 4 }}>
                무엇과 비교할까요 (기준 회차로부터)
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {[1, 2, 3].map((n) => (
                  <button
                    key={n}
                    data-testid={`review-baseline-${n}`}
                    onClick={() => onSetBaselineBack(n)}
                    aria-pressed={baselineBack === n}
                    style={chipBtn(baselineBack === n)}
                  >
                    {n === 1 ? '직전' : `${n}회차 전`}
                  </button>
                ))}
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}

function chipBtn(on: boolean): React.CSSProperties {
  return {
    minHeight: 40,
    padding: '0 14px',
    borderRadius: 999,
    border: `1px solid ${on ? T.blue : T.line}`,
    background: on ? T.blueGlow : T.inputBg,
    color: on ? '#BBD4FF' : T.textDim,
    fontSize: FS.small,
    fontWeight: on ? 700 : 600,
    cursor: 'pointer',
    letterSpacing: -0.1,
  };
}
