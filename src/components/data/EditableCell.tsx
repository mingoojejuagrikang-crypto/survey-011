import { useEffect, useRef, useState } from 'react';
import { T } from '../../tokens';
import type { Column } from '../../types';

/** v0.33.0 #9 — 값 전용 셀. 클립 재생 버튼은 ClipCell(전용 44px 컬럼)로 분리되어
 *  값 탭=편집만 남았다(재생 버튼 오터치 구조적 소멸, 07-10 QA P1). */
export function EditableCell({
  col, value, width, onSave,
}: {
  col: Column;
  value: string;
  width: number;
  onSave: (v: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [local, setLocal] = useState(value);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const skipBlurRef = useRef(false);

  useEffect(() => { if (!editing) setLocal(value); }, [value, editing]);
  useEffect(() => {
    if (!editing) return;
    const el = inputRef.current;
    el?.focus();
    if (el instanceof HTMLTextAreaElement) {
      el.style.height = 'auto';
      el.style.height = `${el.scrollHeight}px`;
    }
  }, [editing]);

  const commit = () => {
    if (local !== value) onSave(local);
    setEditing(false);
  };
  const cancel = () => {
    setLocal(value);
    setEditing(false);
  };
  // 키보드 commit/cancel 시 직후 발생하는 blur가 한 번 더 commit하지 않도록 가드 (Codex MEDIUM)
  const handleBlur = () => {
    if (skipBlurRef.current) { skipBlurRef.current = false; return; }
    commit();
  };
  const keyCommit = () => { skipBlurRef.current = true; commit(); };
  const keyCancel = () => { skipBlurRef.current = true; cancel(); };

  const isVoice = col.input === 'voice';
  const isDate = col.type === 'date';
  const isText = col.type === 'text' || col.type === 'name';
  const inputType = isDate ? 'date' : 'text';
  const inputMode = col.type === 'int' ? 'numeric' : col.type === 'float' ? 'decimal' : 'text';

  return (
    <div
      style={{
        width, padding: 0,
        borderRight: `1px solid ${T.line}`,
        background: editing ? 'rgba(41,121,255,0.08)' : 'transparent',
        display: 'flex', alignItems: 'stretch',
      }}
    >
      {editing ? (
        isText ? (
          <textarea
            ref={(el) => { inputRef.current = el; }}
            value={local}
            onChange={(e) => {
              setLocal(e.target.value);
              e.target.style.height = 'auto';
              e.target.style.height = `${e.target.scrollHeight}px`;
            }}
            onBlur={handleBlur}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); keyCommit(); }
              else if (e.key === 'Escape') keyCancel();
            }}
            rows={1}
            style={{
              flex: 1,
              padding: '8px 8px',
              background: 'transparent', border: 'none', outline: 'none',
              color: T.text,
              fontFamily: 'JetBrains Mono, ui-monospace, monospace',
              fontSize: 14, fontWeight: 700,
              minHeight: 36, resize: 'none', overflow: 'hidden',
              whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.4,
            }}
          />
        ) : (
          <input
            ref={(el) => { inputRef.current = el; }}
            type={inputType}
            value={local}
            inputMode={isDate ? undefined : (inputMode as 'numeric' | 'decimal' | 'text')}
            onChange={(e) => setLocal(e.target.value)}
            onBlur={handleBlur}
            onKeyDown={(e) => {
              if (e.key === 'Enter') keyCommit();
              else if (e.key === 'Escape') keyCancel();
            }}
            style={{
              flex: 1, height: '100%',
              padding: '8px 8px',
              background: 'transparent', border: 'none', outline: 'none',
              color: T.text,
              fontFamily: 'JetBrains Mono, ui-monospace, monospace',
              fontSize: 14, fontWeight: 700,
              minHeight: 36,
            }}
          />
        )
      ) : (
        <button
          onClick={() => setEditing(true)}
          style={{
            flex: 1, minHeight: 36, minWidth: 0,
            padding: '8px 8px',
            background: 'transparent', border: 'none',
            color: isVoice ? T.text : T.textDim,
            fontSize: 14, fontWeight: 700,
            fontFamily: 'JetBrains Mono, ui-monospace, monospace',
            textAlign: 'left', cursor: 'pointer',
            whiteSpace: 'normal', wordBreak: 'break-word', overflowWrap: 'anywhere',
          }}
        >
          {value || <span style={{ color: T.textMute, opacity: 0.5 }}>—</span>}
        </button>
      )}
    </div>
  );
}
