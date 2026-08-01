import { type Ref } from 'react';
import { T } from '../../tokens';
import { ColumnChip } from './ColumnChip';
import { nestedAutoValue } from '../../lib/autoValue';
import type { Column } from '../../types';

/** 칩존 **20%** 트랙(v0.43.0 UI-b, 종전 25%) — **한 행 · 가로 스크롤 · 진행중 칩 우측 끝 정렬**
 *  (민구 확정 2026-07-27). 🔴 20%는 T3 7회차 위험이라 `v037-chip-2row`의 잘림 가드가 지킨다.
 *
 *  ## 무엇이 바뀌었나 (v0.40.0)
 *  종전은 **2줄 + 세로 스크롤**이었고, 2줄에 맞추려고 글자를 배율(`--chip-fit`)로 줄였다.
 *  민구가 실기기에서 보고 뒤집었다 — 칩이 작아 값을 읽기 어려웠고, 25% 트랙에서 세로로 스크롤할
 *  공간이 애초에 없었다("세로 스크롤 영역이 너무 작기에").
 *
 *  ⚠️ **fb-27-2 원문은 "가로가 아닌 세로"였다.** 원문만 보고 되돌리지 마라 — 민구가 화면을 보고
 *  판단을 바꾼 것이고, 그게 최신 결정이다.
 *
 *  이제 한 행이 트랙을 통째로 쓰므로 칩 높이가 약 2배가 되고, 그만큼 항목명·값을 크게 쓸 수 있다.
 *  넘치는 칩은 줄을 늘리는 대신 **가로로** 밀린다.
 *
 *  ## 크기는 전부 컨테이너 비례다
 *  민구 조건: "기기 변경 되어도 일정 비율로 조절되어서 어색하지 않아야 함."
 *  그래서 이 요소가 **컨테이너**(`container-type: size`)이고, 칩의 글자·여백은 `cqh`/`cqw`로
 *  이 트랙에 비례한다. 고정 px은 `clamp()`의 하한/상한(가독 한계·과대 방지)에만 쓴다.
 *
 *  ## 삭제된 것: `--chip-fit` / `useChipFlowFit`
 *  그 훅은 "2줄 안에 우겨넣기" 전용이었다. 한 행 + 가로 스크롤에서는 넘침을 스크롤이 받으므로
 *  글자를 줄일 이유가 사라졌다 — 오히려 민구 요구(비율 사이즈업)와 정반대로 작동한다. */
const CHIP_GAP = 8;
/** 🔴 v0.43.0 UI-b — `6`에서 내렸다. 칩존을 25→20%로 줄이자 390×568에서 칩 내용이 6px 넘쳤고,
 *  처방은 **글자를 줄이는 것이 아니라 빈 공간을 회수하는 것**이다(HANDOFF UI-a 함정 2).
 *  이 패딩은 근거 주석이 없던 값이고, 칩존은 이미 `borderBottom`으로 경계를 그린다.
 *  ⚠️ `v039-active-zones:88`이 `zone.chipHeight - 12`로 이 값을 이중 기록하고 있었다 —
 *  거기도 함께 고쳤다. 다시 갈라지면 한쪽만 고쳐진 채 테스트가 통과한다. */
const CHIP_PAD_Y = 3;

export function ChipZone({
  columns, rowValues, row, currentColId, activeTone, anomalyPending, editingColId,
  activeChipRef, gridRef, onActivate, onCommit, onCancel,
}: {
  columns: Column[];
  rowValues: Record<string, string>;
  row: number;
  currentColId?: string;
  activeTone: string;
  anomalyPending: boolean;
  editingColId: string | null;
  activeChipRef: Ref<HTMLDivElement>;
  /** 자동 스크롤(우측 끝 정렬)을 ActiveState가 수행하기 위한 스크롤 컨테이너 핸들. */
  gridRef: Ref<HTMLDivElement>;
  onActivate: (c: Column) => void;
  onCommit: (c: Column, value: string, prevValue: string) => void;
  onCancel: () => void;
}) {
  return (
    <div
      data-testid="voice-chip-grid"
      ref={gridRef}
      style={{
        // 배정 트랙(v0.43.0 UI-b 기준 20%)을 꽉 채우고, 초과분은 가로 스크롤.
        height: '100%', minHeight: 0,
        // 칩 높이 = 트랙 안쪽 높이 전체(한 행). 44px 하한은 ColumnChip이 건다.
        ['--chip-row-h' as string]: '100%',
        // 🔴 칩의 cqh/cqw가 **이 트랙**을 기준으로 계산되게 한다. 칩 자신에 걸면 안 된다 —
        //    칩은 내용 기반 폭이라 size containment가 폭을 0으로 무너뜨린다.
        ['containerType' as string]: 'size',
        ['containerName' as string]: 'chipzone',
        overflowX: 'auto',
        overflowY: 'hidden',
        WebkitOverflowScrolling: 'touch',
        // ⚠️ `scrollBehavior: 'smooth'`를 걸지 마라. `scrollLeft` 대입 직후 읽은 값이 **애니메이션
        //    중간값**이라 측정·복원이 틀어진다(프리뷰 단계에서 실제로 간헐 실패했다).
        position: 'relative',
        padding: `${CHIP_PAD_Y}px 12px`,
        display: 'flex',
        flexWrap: 'nowrap',
        justifyContent: 'flex-start',
        alignItems: 'stretch',
        gap: CHIP_GAP,
        borderBottom: `1px solid ${anomalyPending ? 'rgba(255,23,68,0.42)' : T.line}`,
        transition: 'border-color 180ms ease',
      }}
    >
      {columns.map((c) => {
        const isVoice = c.input === 'voice';
        const isTouch = c.input === 'touch';
        const value = isVoice || isTouch
          ? rowValues[c.id] ?? ''
          : nestedAutoValue(columns, c, row);
        const isActive = c.id === currentColId;
        const hasValue = rowValues[c.id] !== undefined && rowValues[c.id] !== '';
        return (
          <ColumnChip
            key={c.id}
            containerRef={isActive ? activeChipRef : undefined}
            col={c}
            value={value}
            isActive={isActive}
            activeTone={activeTone}
            isDone={(isVoice || isTouch) && hasValue}
            isEditing={editingColId === c.id}
            onActivate={() => onActivate(c)}
            onCommit={(newValue) => onCommit(c, newValue, value)}
            onCancel={onCancel}
          />
        );
      })}
    </div>
  );
}
