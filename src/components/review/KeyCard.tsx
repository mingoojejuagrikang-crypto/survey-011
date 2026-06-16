/**
 * 비교탭 sticky 키 카드 — 회차 축(baseline→target, 주차+조사일자 기간) + 후보 행 전체에서
 * 불변인 차원(constantDims) 칩 + (키,회차) 중복 배지. 기존 CompareHeader를 일반화(prev/latest →
 * baseline/target 라벨로 명명만 유지, testid는 회귀 호환을 위해 review-round-prev/-latest 보존).
 */
import { T } from '../../tokens';
import { Chip } from '../Chip';
import { FS, MONO, roundLabel } from './reviewShared';
import type { Column } from '../../types';

export function KeyCard({
  targetRound,
  baselineRound,
  baselineBack,
  constantDims,
  rec,
  duplicateCount,
}: {
  targetRound: string | null;
  baselineRound: string | null;
  /** baseline이 target의 몇 회차 전인지(라벨 "직전" vs "N회차 전" 구분). */
  baselineBack: number;
  constantDims: Column[];
  rec: Record<string, string>;
  duplicateCount: number;
}) {
  const baselineLabel = baselineBack <= 1 ? '직전' : `${baselineBack}회차 전`;
  return (
    <div style={{ position: 'sticky', top: 0, zIndex: 5, background: T.bg, paddingBottom: 2 }}>
      <div
        data-testid="review-key-card"
        style={{
          background: T.card,
          border: `1px solid ${T.line}`,
          borderRadius: 14,
          padding: '10px 12px',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        {/* 회차 축: baseline → target (주차 + 조사일자 기간) */}
        <div
          data-testid="review-rounds"
          style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: FS.small, color: T.textDim }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ color: T.textMute, fontWeight: 700, minWidth: 56 }}>{baselineLabel}</span>
            <span data-testid="review-round-prev" style={{ fontFamily: MONO }}>{roundLabel(baselineRound)}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ color: T.textMute, fontWeight: 700, minWidth: 56 }}>기준</span>
            <span
              data-testid="review-round-latest"
              style={{ fontFamily: MONO, color: T.text, fontWeight: 700 }}
            >
              {roundLabel(targetRound)}
            </span>
          </div>
        </div>

        {/* 공통 키(후보 전체 불변) + 중복 배지 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          {constantDims.length === 0 ? (
            <span style={{ fontSize: FS.small, color: T.textMute }}>공통 키 없음</span>
          ) : (
            constantDims.map((c) => (
              <Chip key={c.id} strong color={T.text} bg="rgba(255,255,255,0.08)">
                <span style={{ color: T.textMute, fontWeight: 500 }}>{c.name}</span>
                {(rec[c.id] ?? '').trim()}
              </Chip>
            ))
          )}
          {duplicateCount > 0 && (
            <span
              data-testid="review-badge-duplicate"
              title="같은 샘플·같은 회차의 행이 시트에 2번 이상 있습니다. 마지막 행 값을 표시합니다."
              style={{
                marginLeft: 'auto',
                padding: '3px 9px',
                borderRadius: 999,
                background: 'rgba(255,179,0,0.13)',
                color: T.amber,
                fontSize: 12,
                fontWeight: 700,
                whiteSpace: 'nowrap',
              }}
            >
              중복 {duplicateCount}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
