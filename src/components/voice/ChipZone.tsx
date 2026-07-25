import { type Ref } from 'react';
import { T } from '../../tokens';
import { ColumnChip } from './ColumnChip';
import { useChipFlowFit } from './useChipFlowFit';
import { nestedAutoValue } from '../../lib/autoValue';
import type { Column } from '../../types';

/** 와이어프레임 §공통규칙1·4 — **칩존 25%**.
 *  "2줄 표시, 25%내 최대 크게, 활성칸 하이라이트+점멸. 넘치는 칩은 (2줄 유지) 스크롤로."
 *
 *  구현:
 *   - 이 구역은 grid 트랙(1fr = 25%)을 **꽉 채운다**. 종전의 `maxHeight: min(30dvh, 2줄 픽셀 캡)`은
 *     칩을 44px 고정으로 묶어 25%를 다 못 쓰게 만들었다 → 트랙 높이에서 2줄을 역산한다.
 *   - `--chip-row-h`가 칩 한 줄의 높이다(트랙 높이에서 gap·padding을 뺀 절반). 칩은 이 높이를
 *     그대로 쓰므로 화면이 클수록 칩도 커진다("25%내 최대 크게"). 44px 하한은 ColumnChip이 건다.
 *   - 2줄을 넘는 칩은 글자 배율(--chip-fit, useChipFlowFit)로 먼저 줄이고, 그래도 넘치면 **2줄을
 *     유지한 채 내부 스크롤**로 남긴다. 활성 칩은 항상 가시영역으로 스크롤된다(ActiveState). */
const CHIP_GAP = 8;
const CHIP_PAD_Y = 6;

export function ChipZone({
  columns, rowValues, row, currentColId, activeTone, anomalyPending, editingColId,
  activeChipRef, fitDeps, onActivate, onCommit, onCancel,
}: {
  columns: Column[];
  rowValues: Record<string, string>;
  row: number;
  currentColId?: string;
  activeTone: string;
  anomalyPending: boolean;
  editingColId: string | null;
  activeChipRef: Ref<HTMLDivElement>;
  fitDeps: unknown[];
  onActivate: (c: Column) => void;
  onCommit: (c: Column, value: string, prevValue: string) => void;
  onCancel: () => void;
}) {
  const chipFitRef = useChipFlowFit<HTMLDivElement>(fitDeps);
  return (
    <div
      data-testid="voice-chip-grid"
      ref={chipFitRef}
      style={{
        // 트랙(25%)을 꽉 채우고, 초과분만 내부 스크롤.
        height: '100%', minHeight: 0,
        // 와이어프레임 §공통규칙4 — 한 줄 높이 = (구역 내부 높이 − 줄간격) / 2.
        //   `100%`는 flex 컨테이너의 **content box**(패딩 제외)라 패딩을 또 빼면 3줄이 들어간다.
        ['--chip-row-h' as string]: `calc((100% - ${CHIP_GAP}px) / 2)`,
        overflowX: 'hidden',
        overflowY: 'auto',
        WebkitOverflowScrolling: 'touch',
        position: 'relative',
        padding: `${CHIP_PAD_Y}px 12px`,
        display: 'flex',
        flexWrap: 'wrap',
        justifyContent: 'center',
        alignItems: 'flex-start',
        alignContent: 'flex-start',
        gap: CHIP_GAP,
        borderBottom: `1px solid ${anomalyPending ? 'rgba(255,82,82,0.42)' : T.line}`,
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
