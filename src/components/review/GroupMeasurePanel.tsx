/**
 * 비교탭 보기 설정 — 표시할 차원(그룹) 컬럼 / 측정 컬럼을 토글하는 접이식 패널(<details>).
 *
 * 상태(reviewGroupCols / reviewMeasureCols: string[]|null):
 *  - null = 자동(그룹=가변 키 차원, 측정=전 적격 측정). 화면엔 전부 켜진 것으로 그린다.
 *  - string[] = 명시 부분집합(순서·집합). 토글은 명시 배열로 정규화해 set.
 * 전부 켜지면 null(자동)로 환원해, 컬럼 추가/삭제 시 자동 추종한다.
 *
 * 그룹(차원) 후보 = effectiveSampleKey 키 컬럼(전체). 측정 후보 = isTrendEligible 컬럼.
 * 차원을 다 끄면(또는 키가 전부 상수면) PivotTable이 키 자체를 disambiguator 라벨로 보여준다.
 */
import { T } from '../../tokens';
import { FS } from './reviewShared';
import type { Column } from '../../types';

/** null(자동=전체) / 명시 배열을 한 토글로 갱신. 전부 켜지면 null로 환원. */
function toggleList(current: string[] | null, allIds: string[], id: string): string[] | null {
  const base = current === null ? new Set(allIds) : new Set(current);
  if (base.has(id)) base.delete(id);
  else base.add(id);
  if (base.size === allIds.length && allIds.every((x) => base.has(x))) return null;
  // allIds 순서를 보존해 명시 배열 생성.
  return allIds.filter((x) => base.has(x));
}

function Toggles({
  testIdPrefix,
  cols,
  selected,
  onChange,
}: {
  testIdPrefix: string;
  cols: Column[];
  selected: string[] | null;
  onChange: (next: string[] | null) => void;
}) {
  const allIds = cols.map((c) => c.id);
  const on = (id: string) => selected === null || selected.includes(id);
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      {cols.length === 0 ? (
        <span style={{ fontSize: FS.small, color: T.textMute }}>후보 항목 없음</span>
      ) : (
        cols.map((c) => {
          const active = on(c.id);
          return (
            <button
              key={c.id}
              data-testid={`${testIdPrefix}-${c.id}`}
              aria-pressed={active}
              onClick={() => onChange(toggleList(selected, allIds, c.id))}
              style={{
                minHeight: 38,
                padding: '0 14px',
                borderRadius: 999,
                border: `1px solid ${active ? T.blue : T.line}`,
                background: active ? T.blueGlow : T.inputBg,
                color: active ? '#BBD4FF' : T.textDim,
                fontSize: FS.small,
                fontWeight: active ? 700 : 600,
                cursor: 'pointer',
                letterSpacing: -0.1,
              }}
            >
              {c.name}
            </button>
          );
        })
      )}
    </div>
  );
}

export function GroupMeasurePanel({
  groupColumns,
  measureColumns,
  groupSel,
  measureSel,
  onGroupChange,
  onMeasureChange,
}: {
  /** 그룹(차원) 후보 — effectiveSampleKey 키 컬럼. */
  groupColumns: Column[];
  /** 측정 후보 — isTrendEligible 컬럼. */
  measureColumns: Column[];
  groupSel: string[] | null;
  measureSel: string[] | null;
  onGroupChange: (next: string[] | null) => void;
  onMeasureChange: (next: string[] | null) => void;
}) {
  return (
    <details
      data-testid="review-viewpanel"
      style={{ background: T.card, border: `1px solid ${T.line}`, borderRadius: 14 }}
    >
      <summary
        style={{
          listStyle: 'none',
          cursor: 'pointer',
          padding: '11px 14px',
          fontSize: FS.label,
          fontWeight: 700,
          color: T.textDim,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          minHeight: 44,
          boxSizing: 'border-box',
        }}
      >
        보기 설정 (그룹 · 측정)
      </summary>
      <div style={{ padding: '0 14px 14px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <div style={{ fontSize: FS.small, color: T.textMute, fontWeight: 700, marginBottom: 8 }}>
            행을 나눌 항목 (차원)
          </div>
          <Toggles testIdPrefix="review-group" cols={groupColumns} selected={groupSel} onChange={onGroupChange} />
        </div>
        <div>
          <div style={{ fontSize: FS.small, color: T.textMute, fontWeight: 700, marginBottom: 8 }}>
            비교할 측정 항목
          </div>
          <Toggles testIdPrefix="review-measure" cols={measureColumns} selected={measureSel} onChange={onMeasureChange} />
        </div>
      </div>
    </details>
  );
}
