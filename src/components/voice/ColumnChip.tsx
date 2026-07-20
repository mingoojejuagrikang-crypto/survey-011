import { useEffect, useRef, useState, type Ref } from 'react';
import { T } from '../../tokens';
import type { Column } from '../../types';

/** v0.36.0 코덱스 시안(2026-07-20, 민구 확정) — 기능형 컬럼 칩을 **유동 폭 pill 플로우**로 재스타일.
 *  고정 간격 그리드 대신 칩 내부 "항목+값" 길이에 맞는 자연 폭(flex-wrap 플로우, 코덱스 pill 느낌).
 *  글자 크기는 부모(voice-chip-grid)의 `--chip-fit` 배율을 따른다(칩 수·길이에 따라 3줄 안에
 *  들어오도록 축소 — useChipFlowFit).
 *
 *  기능 불변: 점프(auto 편집→행 점프)·수동 수정(음성 칩 탭→시트, touch/auto 인라인 편집)·현재값
 *  표시·활성 스크롤 추적. data-testid="column-chip"·data-col-name·data-active 동일 노드 유지
 *  (테스트 직접 클릭 계약). */
export function ColumnChip({
  col, value, isActive, activeTone, isDone, isEditing, onActivate, onCommit, onCancel, containerRef, compact = false,
}: {
  col: Column;
  value: string;
  isActive: boolean;
  activeTone: string;
  isDone: boolean;
  isEditing: boolean;
  onActivate: () => void;
  onCommit: (v: string) => void;
  onCancel: () => void;
  compact?: boolean;
  // v0.19.0 W5 — 활성 칩에만 전달되어 칩 스크롤영역에서 scrollIntoView 대상이 된다.
  containerRef?: Ref<HTMLDivElement>;
}) {
  const [local, setLocal] = useState(value);
  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => { if (!isEditing) setLocal(value); }, [value, isEditing]);
  useEffect(() => { if (isEditing) inputRef.current?.focus(); }, [isEditing]);

  // Transient "pop" of the value: bump a counter whenever the active chip's value
  // changes so the keyed inner span remounts and replays the chip-pop animation.
  const [popKey, setPopKey] = useState(0);
  useEffect(() => {
    if (isActive && value) setPopKey((k) => k + 1);
  }, [value, isActive]);

  const isDate = col.type === 'date';
  // v0.33.0 항목6 — 음성 date 컬럼은 수동 입력 시트(date input)로 편집 가능해야 하므로 클릭 허용.
  // auto date 칩은 기존대로 비클릭(인라인 편집 미지원).
  const clickable = !isDate || col.input === 'voice';

  let bg: string = T.cardAlt;
  let border: string = T.lineStrong;
  let textColor: string = T.textDim;
  if (isActive) {
    const redActive = activeTone === T.red;
    bg = redActive ? 'rgba(255,82,82,0.16)' : 'rgba(0,200,83,0.18)';
    border = activeTone;
    textColor = T.text;
  } else if (isDone) {
    bg = 'rgba(0,200,83,0.10)';
    border = 'rgba(0,200,83,0.30)';
    textColor = T.text;
  }
  if (isEditing) {
    bg = T.blueGlow;
    border = T.blue;
  }

  const inputMode = col.type === 'int'
    ? 'numeric'
    : col.type === 'float'
    ? 'decimal'
    : 'text';

  return (
    <div
      ref={containerRef}
      data-testid="column-chip"
      data-active={isActive ? 'true' : 'false'}
      data-col-name={col.name}
      onClick={() => { if (clickable && !isEditing) onActivate(); }}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 'calc(7px * var(--chip-fit, 1))',
        padding: '6px calc(14px * var(--chip-fit, 1))',
        borderRadius: 999,
        background: bg,
        border: `${isActive || isEditing ? 2 : 1.5}px solid ${border}`,
        color: textColor,
        fontWeight: isActive ? 800 : 700,
        cursor: clickable ? 'pointer' : 'default',
        letterSpacing: -0.1,
        minHeight: 44,
        // 유동 폭 — 내용 길이대로. 편집 중엔 입력폭 확보를 위해 확장. compact(가로 레일)는 기존 유지.
        flex: isEditing ? '1 1 220px' : compact ? '0 0 clamp(180px, 48vw, 260px)' : '0 1 auto',
        maxWidth: '100%',
        minWidth: 0,
        scrollSnapAlign: compact ? 'start' : undefined,
        position: 'relative',
        zIndex: isActive ? 20 : undefined,
        overflow: 'hidden',
        transition: 'background 150ms, border 150ms',
        animation: isActive ? 'chip-pulse 1.2s ease-in-out infinite' : 'none',
      }}
    >
      <span
        style={{
          color: isActive ? activeTone : T.textDim,
          fontSize: 'max(11px, calc(13px * var(--chip-fit, 1)))',
          fontWeight: 700,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          maxWidth: '38vw',
          minWidth: 0,
          flexShrink: 1,
        }}
      >
        {col.name}
      </span>
      {isEditing ? (
        <input
          ref={inputRef}
          value={local}
          inputMode={inputMode as 'numeric' | 'decimal' | 'text'}
          onChange={(e) => setLocal(e.target.value)}
          onBlur={() => onCommit(local)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onCommit(local);
            else if (e.key === 'Escape') onCancel();
          }}
          onClick={(e) => e.stopPropagation()}
          style={{
            flex: 1, minWidth: 0,
            background: 'transparent', border: 'none', outline: 'none',
            color: T.text,
            fontFamily: 'JetBrains Mono, ui-monospace, monospace',
            fontSize: 'max(13px, calc(16px * var(--chip-fit, 1)))', fontWeight: 800,
            textAlign: 'right',
          }}
        />
      ) : (
        <span
          key={popKey}
          style={{
            display: 'inline-block',
            lineHeight: 1,
            fontFamily: 'JetBrains Mono, ui-monospace, monospace',
            color: isActive ? T.text : isDone ? T.text : T.textDim,
            fontSize: `max(12px, calc(${isActive ? 18 : 16}px * var(--chip-fit, 1)))`,
            fontWeight: 800,
            letterSpacing: -0.3,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            maxWidth: '44vw',
            minWidth: 0,
            flexShrink: 1,
          }}
        >
          {value || '—'}
        </span>
      )}
    </div>
  );
}
