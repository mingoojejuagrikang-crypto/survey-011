/**
 * 비교탭 AND 필터 바 — 차원 조건 칩([농가명:강남호 ×]) + 회차(주차) 비교 칩
 * ([주차: 26 vs 직전 × baselineBack ▾]) + [+필터] 버튼. 모든 차원 칩은 AND(교집합).
 *
 * 회차 칩은 행을 제거하는 필터가 아니라 "비교 기준 회차(target) + baseline(N회차 전)"을 지정한다
 * (플랜 1A/1C). 회차 칩 ×는 target을 자동(최근 회차)으로 되돌린다(reviewTargetRound=null).
 */
import { T } from '../../tokens';
import { I } from '../icons';
import { FS } from './reviewShared';
import { roundLabel } from './reviewShared';
import type { ReviewFilter } from '../../lib/reviewQuery';
import type { Column } from '../../types';

/** colId → 표시명(필터 칩 라벨). 미존재 컬럼은 colId 그대로. */
function colName(columns: Column[], colId: string): string {
  return columns.find((c) => c.id === colId)?.name ?? colId;
}

function ChipBox({
  testId,
  children,
  onRemove,
  removeLabel,
}: {
  testId: string;
  children: React.ReactNode;
  onRemove: () => void;
  removeLabel: string;
}) {
  return (
    <span
      data-testid={testId}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '0 6px 0 11px',
        minHeight: 36,
        borderRadius: 999,
        border: `1px solid ${T.blue}`,
        background: T.blueGlow,
        color: '#BBD4FF',
        fontSize: FS.small,
        fontWeight: 700,
        letterSpacing: -0.1,
        whiteSpace: 'nowrap',
      }}
    >
      {children}
      <button
        aria-label={removeLabel}
        onClick={onRemove}
        style={{
          width: 24,
          height: 24,
          borderRadius: 999,
          border: 'none',
          background: 'transparent',
          color: '#BBD4FF',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          flexShrink: 0,
        }}
      >
        {I.close(13, 'currentColor')}
      </button>
    </span>
  );
}

export function FilterBar({
  columns,
  filters,
  targetRound,
  baselineRound,
  baselineBack,
  onRemoveFilter,
  onClearTarget,
  onOpenPicker,
}: {
  columns: Column[];
  filters: ReviewFilter[];
  /** 비교 기준 회차(ISO). null = 자동(최근). null이면 회차 칩을 노출하되 "최근"으로 표기. */
  targetRound: string | null;
  baselineRound: string | null;
  baselineBack: number;
  /** index(필터 배열 위치)로 한 칩 제거(같은 colId 중복 칩도 정확히 1개만 지운다). */
  onRemoveFilter: (index: number) => void;
  /** 회차 칩 × — target을 자동(최근)으로 되돌린다. */
  onClearTarget: () => void;
  onOpenPicker: () => void;
}) {
  const baselineText = baselineBack <= 1 ? '직전' : `${baselineBack}회차 전`;
  const targetText = targetRound ? roundLabel(targetRound).replace(/\s*\(.*\)$/, '') : '최근';
  return (
    <div
      data-testid="review-filterbar"
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 8,
        alignItems: 'center',
      }}
    >
      {filters.map((f, i) => (
        <ChipBox
          key={`${f.colId}:${f.value}:${i}`}
          testId="review-filter-chip"
          onRemove={() => onRemoveFilter(i)}
          removeLabel={`${colName(columns, f.colId)} ${f.value} 필터 제거`}
        >
          <span style={{ color: '#8FB6FF', fontWeight: 600 }}>{colName(columns, f.colId)}</span>
          {f.value}
        </ChipBox>
      ))}

      {/* 회차(주차) 비교 칩 — 항상 노출(target/baseline 표시). target만 ×로 자동 복귀. */}
      <ChipBox
        testId="review-filter-round"
        onRemove={onClearTarget}
        removeLabel="비교 기준 회차를 자동(최근)으로 되돌리기"
      >
        <span style={{ color: '#8FB6FF', fontWeight: 600 }}>주차</span>
        {targetText} <span style={{ color: T.textMute, fontWeight: 500 }}>vs</span> {baselineText}
        {baselineRound === null && targetRound && (
          <span style={{ color: T.amber, fontWeight: 600 }}>(없음)</span>
        )}
      </ChipBox>

      <button
        data-testid="review-filter-add"
        onClick={onOpenPicker}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 5,
          minHeight: 36,
          padding: '0 12px',
          borderRadius: 999,
          border: `1px dashed ${T.lineStrong}`,
          background: T.inputBg,
          color: T.textDim,
          fontSize: FS.small,
          fontWeight: 700,
          cursor: 'pointer',
        }}
      >
        <span style={{ display: 'flex' }}>{I.plus(13, 'currentColor')}</span>
        필터
      </button>
    </div>
  );
}
