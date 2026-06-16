/**
 * 비교탭 피벗 표 — 한 행 = 한 샘플(키)의 target 회차(집계 없음). 앞열 = 가변 차원(rowDims)
 * 라벨, 뒷열 = 측정 항목별 baseline|target 2열. 기존 CompareTable/CompareValueCells를 일반화
 * (rows는 buildReviewView의 표시 행, dims/measures는 그 분해 결과를 그대로 소비).
 *
 * 가로 스크롤 0 정책 유지: 측정이 많아도 minmax(0,1fr) 압축으로 모든 열이 뷰포트 안에
 * 들어오게 한다(문서·표 가로 스크롤 모두 0). 셀은 ellipsis로 절단해 짤림 없이 한 줄 유지.
 */
import { T } from '../../tokens';
import { FS, MONO, computeChange } from './reviewShared';
import { pastValue, type PastIndex } from '../../lib/pastValues';
import type { ReviewRow } from '../../lib/reviewQuery';
import type { Column } from '../../types';

const cellBase = {
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
} as const;

export function PivotTable({
  rows,
  index,
  rowDims,
  measures,
  targetRound,
  baselineRound,
}: {
  rows: ReviewRow[];
  index: PastIndex;
  rowDims: Column[];
  measures: Column[];
  targetRound: string | null;
  baselineRound: string | null;
}) {
  // disambiguator(플랜 "키 차원 숨김 시"): 표시 차원(rowDims)이 0개이거나, rowDims만으론 행이
  // 유일하게 구분되지 않을 때(라벨 충돌) 키 자체를 라벨 열로 보여준다(1행=1샘플 식별 보장).
  // 예: 그룹에서 '조사과실'을 끄면 rowDims=[조사나무]만 남아 "1"이 둘, "2"가 둘… → 충돌 → 키 폴백.
  const dimLabels = rows.map((r) => rowDims.map((c) => (r.rec[c.id] ?? '').trim()).join(''));
  const labelsCollide = new Set(dimLabels).size !== rows.length;
  const showKeyFallback = rowDims.length === 0 || labelsCollide;
  const labelCount = showKeyFallback ? 1 : rowDims.length;
  // 앞열 = 가변 차원(라벨), 뒷열 = 측정 항목별 직전|현재 2열. 가로 스크롤 0(minmax(0,1fr) 압축).
  const template =
    `${Array.from({ length: labelCount }, () => 'minmax(0, 1.2fr)').join(' ')} ` +
    `repeat(${measures.length * 2}, minmax(0, 1fr))`;

  return (
    <div
      data-testid="review-table"
      role="table"
      aria-label="샘플별 baseline→target 비교 표"
      style={{
        background: T.card,
        border: `1px solid ${T.line}`,
        borderRadius: 14,
        padding: 8,
        overflowX: 'hidden',
      }}
    >
      {/* 헤더: 가변 차원명(앞) + 측정 항목명(2열 span, 아래 직전/현재) */}
      <div
        role="row"
        style={{
          display: 'grid',
          gridTemplateColumns: template,
          columnGap: 4,
          alignItems: 'end',
          borderBottom: `1px solid ${T.line}`,
          paddingBottom: 4,
        }}
      >
        {showKeyFallback ? (
          <span
            role="columnheader"
            style={{ ...cellBase, fontSize: FS.small, fontWeight: 700, color: T.textDim, padding: '0 2px' }}
          >
            샘플
          </span>
        ) : (
          rowDims.map((c) => (
            <span
              role="columnheader"
              key={c.id}
              style={{ ...cellBase, fontSize: FS.small, fontWeight: 700, color: T.textDim, padding: '0 2px' }}
            >
              {c.name}
            </span>
          ))
        )}
        {measures.map((c) => (
          <div role="columnheader" key={c.id} style={{ gridColumn: 'span 2', minWidth: 0 }}>
            <div
              style={{ ...cellBase, fontSize: FS.small, fontWeight: 700, color: T.text, textAlign: 'center' }}
            >
              {c.name}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 4 }}>
              <span style={{ ...cellBase, fontSize: 11, color: T.textMute, fontWeight: 600, textAlign: 'center' }}>
                직전
              </span>
              <span style={{ ...cellBase, fontSize: 11, color: T.textMute, fontWeight: 600, textAlign: 'center' }}>
                현재
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* 본문: 샘플 1행 (앞열 가변 차원 값 + 측정 항목별 baseline/target 셀) */}
      {rows.map((r, i) => (
        <div
          role="row"
          key={r.key}
          data-testid="review-sample"
          data-key={r.key}
          style={{
            display: 'grid',
            gridTemplateColumns: template,
            columnGap: 4,
            alignItems: 'center',
            padding: '5px 0',
            borderTop: i === 0 ? 'none' : `1px solid ${T.line}`,
            background: i % 2 === 1 ? 'rgba(255,255,255,0.02)' : 'transparent',
          }}
        >
          {showKeyFallback ? (
            <span
              role="cell"
              style={{ ...cellBase, fontSize: FS.label, fontWeight: 700, color: T.text, padding: '0 2px' }}
            >
              {r.key}
            </span>
          ) : (
            rowDims.map((c) => (
              <span
                role="cell"
                key={c.id}
                style={{ ...cellBase, fontSize: FS.label, fontWeight: 700, color: T.text, padding: '0 2px' }}
              >
                {(r.rec[c.id] ?? '').trim() || '—'}
              </span>
            ))
          )}
          {measures.map((col) => (
            <ValueCells
              key={col.id}
              col={col}
              prev={baselineRound ? pastValue(index, r.key, baselineRound, col.id) : null}
              latest={targetRound ? pastValue(index, r.key, targetRound, col.id) : null}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/** 한 측정 항목의 baseline/target 2개 셀(Fragment로 그리드 2열에 직접 배치). target 셀에 화살표·
 *  이상치 강조 + testid(review-cell-<colId>), baseline 셀은 review-prev-<colId>. */
function ValueCells({
  col,
  prev,
  latest,
}: {
  col: Column;
  prev: string | null;
  latest: string | null;
}) {
  const ch = computeChange(col, prev, latest);
  const arrowGlyph = ch.arrow === 'up' ? '↑' : ch.arrow === 'down' ? '↓' : '';
  const latestColor = ch.violation ? T.red : ch.latest === null ? T.textMute : T.text;
  return (
    <>
      <span
        role="cell"
        data-testid={`review-prev-${col.id}`}
        style={{
          ...cellBase,
          fontFamily: MONO,
          fontSize: FS.value,
          fontWeight: 700,
          color: ch.prev === null ? T.textMute : T.textDim,
          textAlign: 'center',
        }}
      >
        {ch.prev ?? '—'}
      </span>
      <span
        role="cell"
        data-testid={`review-cell-${col.id}`}
        data-arrow={ch.arrow ?? undefined}
        data-violation={ch.violation ? 'true' : undefined}
        style={{
          ...cellBase,
          fontFamily: MONO,
          fontSize: FS.value,
          fontWeight: 800,
          color: latestColor,
          textAlign: 'center',
          borderRadius: 6,
          background: ch.violation ? 'rgba(255,82,82,0.14)' : 'transparent',
        }}
      >
        {arrowGlyph}{ch.latest ?? '—'}
      </span>
    </>
  );
}
