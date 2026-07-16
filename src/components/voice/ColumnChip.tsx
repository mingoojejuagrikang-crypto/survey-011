import { useEffect, useRef, useState, type Ref } from 'react';
import { T } from '../../tokens';
import type { Column } from '../../types';

// ─── A-hero → components/voice/VoiceHero.tsx로 추출(v0.35.0, Vance). 3-상태 카드(대기: 항목+파형 / 확인: ✓+값 / 검토: N행 완료). HeroStatusLine·HeroPrimaryLine·HERO_PANEL도 이전.

// ─── chip with optional inline edit ────────────────────────────
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

  let bg: string = 'rgba(255,255,255,0.05)';
  let border: string = 'transparent';
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
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '8px 10px',
        borderRadius: 12,
        fontSize: 'clamp(13px, 4vw, 16px)',
        background: bg,
        border: `2px solid ${border}`,
        color: textColor,
        fontWeight: isActive ? 800 : 700,
        cursor: clickable ? 'pointer' : 'default',
        letterSpacing: -0.1,
        minHeight: 44,
        minWidth: 0,
        flex: compact ? '0 0 clamp(180px, 48vw, 260px)' : undefined,
        scrollSnapAlign: compact ? 'start' : undefined,
        // Active chip anchors the floating value badge and must draw over its
        // neighbours, so it unclips and lifts above sibling chips. Inactive
        // chips keep overflow:hidden for value/label ellipsis.
        position: 'relative',
        zIndex: isActive ? 20 : undefined,
        overflow: isActive ? 'visible' : 'hidden',
        transition: 'background 150ms, border 150ms',
        animation: isActive ? 'chip-pulse 1.2s ease-in-out infinite' : 'none',
      }}
    >
      <span
        style={{
          color: isActive ? activeTone : T.textMute,
          fontSize: 'clamp(11px, 3.4vw, 13px)',
          fontWeight: 700,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          minWidth: 0,
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
            fontSize: 'clamp(13px, 4vw, 17px)', fontWeight: 800,
            textAlign: 'right',
          }}
        />
      ) : (
        <span
          style={{
            flex: 1,
            display: 'block',
            textAlign: 'right',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            minWidth: 0,
          }}
        >
          <span
            key={popKey}
            style={{
              display: 'inline-block',
              lineHeight: 1,
              transformOrigin: 'right center',
              fontFamily: 'JetBrains Mono, ui-monospace, monospace',
              color: isActive ? T.text : isDone ? T.text : T.textDim,
              // v0.17.0 A-hero: 거대 값은 중앙 hero가 담당 → 칩은 컴팩트 진행 레일로서
              // 작은 확인값만 유지(활성도 과하게 키우지 않음).
              fontSize: isActive ? 'clamp(14px, 4.4vw, 18px)' : 'clamp(13px, 4vw, 17px)',
              fontWeight: 800,
              letterSpacing: -0.3,
              maxWidth: '100%',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              // The floating value badge below is now the recognition effect;
              // the in-chip value stays as the persistent display.
              animation: 'none',
            }}
          >
            {value || '—'}
          </span>
        </span>
      )}
    </div>
  );
}
