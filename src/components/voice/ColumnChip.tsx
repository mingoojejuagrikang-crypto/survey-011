import { useEffect, useRef, useState, type Ref } from 'react';
import { T } from '../../tokens';
import type { Column } from '../../types';

/** v0.36.0 코덱스 시안(2026-07-20, 민구 확정) — 기능형 컬럼 칩을 **유동 폭 pill 플로우**로 재스타일.
 *  고정 간격 그리드 대신 칩 내부 "항목+값" 길이에 맞는 자연 폭(flex-wrap 플로우, 코덱스 pill 느낌).
 *  v0.40.0 — **칩 내부를 2행(항목명 위 / 값 아래)으로** 세우고, 글자를 칩존 트랙 비례(`cqh`/`cqw`)로
 *  키운다(민구 fb-27-2: "항목과 값은 세로로", "기기 변경 되어도 일정 비율로 조절"). 종전의
 *  `--chip-fit` 배율은 "2줄 안에 우겨넣기" 전용이라 함께 제거됐다 — 한 행 + 가로 스크롤에서는
 *  넘침을 스크롤이 받으므로 글자를 줄일 이유가 없다.
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
        // 칩 내부 2행 — 1행 항목명 / 2행 값(민구 fb-27-2).
        display: 'inline-flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        gap: '1.5cqh',
        padding: '2cqh 3.5cqw',
        borderRadius: 999,
        background: bg,
        border: `${isActive || isEditing ? 2 : 1.5}px solid ${border}`,
        color: textColor,
        fontWeight: isActive ? 800 : 700,
        cursor: clickable ? 'pointer' : 'default',
        letterSpacing: -0.1,
        // 와이어프레임 §공통규칙4 "25%내 최대 크게" — 칩 높이는 칩존이 트랙에서 역산한 한 줄 높이
        // (--chip-row-h)를 그대로 쓴다. 44px는 장갑 조작 하한(PRINCIPLES §2)이라 고정 하한으로 남는다.
        height: 'var(--chip-row-h, 44px)',
        minHeight: 44,
        // 🔴 폭은 **내용이 정한다**(`0 0 auto`). 종전 `0 1 auto`는 한 행에 다 넣으려고 칩을 글자
        //    밑으로 찌그러뜨려 항목명이 한 글자로 잘렸다 — 넘치면 줄이지 말고 가로로 밀어야 한다.
        flex: isEditing ? '1 1 220px' : compact ? '0 0 clamp(180px, 48vw, 260px)' : '0 0 auto',
        minWidth: compact ? undefined : '24cqw',   // '—'뿐인 칩이 슬리버로 쪼그라들지 않게
        maxWidth: compact ? '100%' : '96cqw',
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
          // 절대 px 단독 금지 — 칩존 트랙에 비례한다(민구 "기기 변경 되어도 일정 비율").
          fontSize: 'clamp(11px, min(11cqh, 3.4cqw), 22px)',
          fontWeight: 700,
          whiteSpace: 'nowrap',
          // ⚠️ overflow:hidden을 여기 두면 span의 **내재 폭 기여가 0**이 돼서 칩이 값을 담을 만큼
          //    자라지 않는다(글자가 잘린다). 잘라내는 일은 칩(overflow:hidden)이 맡는다.
          maxWidth: '100%',
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
            fontSize: 'clamp(16px, min(24cqh, 8cqw), 40px)', fontWeight: 800,
            textAlign: 'center',
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
            // 값이 칩의 주인공이다 — 항목명보다 확실히 크게, 그리고 트랙 비례로.
            fontSize: 'clamp(18px, min(30cqh, 9cqw), 52px)',
            fontWeight: 800,
            letterSpacing: -0.3,
            whiteSpace: 'nowrap',
            maxWidth: '100%',
          }}
        >
          {value || '—'}
        </span>
      )}
    </div>
  );
}
