import { useEffect, useRef, useState } from 'react';
import { T } from '../../tokens';
import type { Column } from '../../types';
import { choicesFor, validateManual } from '../../lib/manualInput';
import { EdgeButton } from './ActiveControlBar';
import type { GlowTone } from './EdgeGlow';
import { VOICE_TYPE } from './heroLayout';
import { useFitGroup } from './useFitGroup';

/** 음성 칩을 눌렀을 때 활성 화면의 중앙·하단 트랙을 승계하는 인라인 수동 입력.
 *
 * 열려 있는 동안 STT는 hard-suspend되고 닫히면 resume된다(수명주기 배선은 ActiveState/VoiceScreen).
 * 모달·backdrop·포커스 트랩은 없으며 상단 진행바, 칩존, 하단 TabBar는 계속 보이고 탭 가능하다.
 * 숫자 입력은 전화 다이얼 순서와 44px 터치 하한을 지키고, 문자 `_` 대신 실제 블록 커서를 그린다. */
export function ManualValueSheet({
  col, currentValue, tone, onCommit, onClose,
}: {
  col: Column;
  /** 셀의 현재 값(있으면 새 입력 전 힌트로 표시). */
  currentValue: string;
  /** 이상치 수정 중 red, 일반 수동 입력은 green. 저장 버튼의 긍정 green과는 별도 축이다. */
  tone: GlowTone;
  onCommit: (value: string) => void;
  onClose: () => void;
}) {
  const choices = choicesFor(col);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const regionRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    regionRef.current?.focus({ preventScroll: true });
  }, []);

  const tryCommit = (raw: string) => {
    const result = validateManual(col, raw);
    if (!result.ok) {
      setError(result.reason);
      return;
    }
    onCommit(result.value);
  };

  const appendKey = (key: string) => {
    setError(null);
    setDraft((value) => {
      if (key === '.' && (value.includes('.') || value === '')) return value;
      return value + key;
    });
  };
  const backspace = () => {
    setError(null);
    setDraft((value) => value.slice(0, -1));
  };

  const isKeypad = choices.kind === 'int' || choices.kind === 'float';
  const hasSave = isKeypad || choices.kind === 'text' || choices.kind === 'date';
  const toneColor = tone === 'red' ? T.red : tone === 'amber' ? T.amber : T.green;
  const toneBackground = tone === 'red'
    ? T.redGlowFaint
    : tone === 'amber' ? T.amberGlowFaint : T.greenGlowFaint;
  const visibleValue = draft || currentValue;
  /** 🔴 v0.46.1 WP-9(민구 FB-11) — 표시 영역 안에서 값 글자를 **실제로 줄인다.**
   *  deps에 `visibleValue`가 있어 한 자 칠 때마다 재fit한다 — 민구가 요구한
   *  *"입력되는 값에 따라서 유동적으로 사이즈 조절"*이 이 한 줄에서 나온다.
   *  `searchBasePx`는 종전 고정값(128.64)이라 **짧은 값에서는 종전과 같은 크기**로 착지한다
   *  (배율 1). 길어질 때만 내려간다 — 회귀 없이 필요한 때만 작동하는 형태다. */
  const displayValueRef = useRef<HTMLSpanElement>(null);
  const displayFitRef = useFitGroup<HTMLDivElement>(
    [visibleValue, isKeypad],
    [{ variable: '--fit-sheet', members: [displayValueRef], searchBasePx: 128.64 }],
  );

  return (
    <div
      style={{
        gridRow: '3 / 5', minHeight: 0, overflow: 'hidden',
        position: 'relative', zIndex: 55,
      }}
    >
      <section
        ref={regionRef}
        role="region"
        aria-label={`${col.name} 수정 입력, 값 입력 중`}
        tabIndex={-1}
        data-testid="manual-value-sheet"
        data-tone={tone}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return;
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }}
        style={{
          width: '100%', height: '100%', minHeight: 0, overflow: 'hidden', boxSizing: 'border-box',
          display: 'grid', gridTemplateRows: 'minmax(0, 3fr) minmax(0, 5fr)',
        }}
      >
      {/* 🔴 v0.46.1 WP-9(민구 FB-11) — 이 영역이 **fit 컨테이너**다. 값 길이가 바뀌면
          `useFitGroup`이 `--fit-sheet` 배율을 다시 이진탐색해 폭·높이 안에 맞춘다.
          종전엔 fit이 아예 없어 고정 128.64px가 `ellipsis`로 잘렸다(heroLayout §sheetDisplay). */}
      <div
        ref={displayFitRef}
        data-testid="manual-value-display-zone"
        style={{
          position: 'relative', minHeight: 0, overflow: 'hidden',
          display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
          padding: '4px 16px 8px', boxSizing: 'border-box',
        }}
      >
        {isKeypad ? (
          <div
            data-testid="manual-keypad-display"
            role="status"
            aria-live="polite"
            aria-atomic="true"
            aria-label={draft ? `입력값 ${draft}` : currentValue ? `현재값 ${currentValue}, 새 입력 없음` : '새 입력 없음'}
            style={{
              maxWidth: '100%', minWidth: 0, overflow: 'hidden',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.08em',
              color: draft ? T.text : T.textDim,
              fontSize: VOICE_TYPE.sheetDisplay,
              fontWeight: 900, lineHeight: 0.9, letterSpacing: -1,
              fontFamily: 'JetBrains Mono, ui-monospace, monospace',
              fontVariantNumeric: 'tabular-nums',
              // 🔴 민구 확정(08-07): **축약 금지.** 폭이 모자라면 글자를 줄이거나(위 fit)
              //    줄을 바꾼다 — 값을 감추지 않는다. 숫자열이라 어디서 끊어도 뜻이 상하지 않는다.
              //    민구 원문: *"만약 빈 공간이 있다면 줄바꿈 형태로 입력값에 대해서 출력해도 좋아."*
              whiteSpace: 'normal', wordBreak: 'break-all', textAlign: 'center',
            }}
          >
            {/* 🔴 `textOverflow: 'ellipsis'`를 **제거했다** — 이것이 `311…`을 그리던 당사자다.
                이 레포의 원칙과도 어긋나 있었다: `useFitScale` 주석 *"ellipsis 잘림 금지 —
                줄바꿈+축소만"*. */}
            <span ref={displayValueRef} style={{ minWidth: 0 }}>
              {visibleValue}
            </span>
            <span
              data-testid="manual-block-cursor"
              aria-hidden="true"
              style={{
                display: 'inline-block', flex: '0 0 0.12em', width: '0.12em', height: '0.72em',
                borderRadius: 2, background: toneColor,
              }}
            />
          </div>
        ) : currentValue ? (
          <div
            role="status"
            aria-label={`현재값 ${currentValue}`}
            style={{ color: T.textDim, fontSize: VOICE_TYPE.sheetTitle, fontWeight: 850, whiteSpace: 'nowrap' }}
          >
            {currentValue}
          </div>
        ) : null}

        {error && (
          <div
            data-testid="manual-error"
            role="alert"
            style={{
              position: 'absolute', top: 6, left: 12, right: 12,
              color: T.red, fontSize: VOICE_TYPE.caption, fontWeight: 850, textAlign: 'center',
            }}
          >
            {error}
          </div>
        )}
      </div>

      <div
        data-testid="manual-input-bottom-zone"
        style={{
          minHeight: 0, overflow: 'hidden',
          display: 'grid', gridTemplateRows: 'minmax(0, 4fr) minmax(44px, 1fr)', gap: 8,
          padding: '0 12px 2px', boxSizing: 'border-box',
        }}
      >
        <div style={{ minHeight: 0, overflow: 'hidden' }}>
          {choices.kind === 'options' && (
            <div
              data-testid="manual-options-grid"
              style={{
                width: '100%', height: '100%', minHeight: 0, overflowY: 'auto',
                display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
                gridAutoRows: 'minmax(44px, 1fr)', gap: 8,
              }}
            >
              {(choices.options ?? []).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => tryCommit(option)}
                  style={{
                    minHeight: 44, borderRadius: 14,
                    border: `1px solid ${option === currentValue ? toneColor : T.lineStrong}`,
                    background: option === currentValue ? toneBackground : T.card,
                    color: T.text, fontSize: VOICE_TYPE.actionLabel, fontWeight: 800, cursor: 'pointer',
                    touchAction: 'manipulation',
                  }}
                >
                  {option}
                </button>
              ))}
            </div>
          )}

          {choices.kind === 'seq' && (
            <div
              data-testid="manual-seq-grid"
              style={{
                width: '100%', height: '100%', minHeight: 0, overflowY: 'auto',
                display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(64px, 1fr))',
                gridAutoRows: 'minmax(44px, 1fr)', gap: 8,
              }}
            >
              {(choices.seqValues ?? []).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => tryCommit(value)}
                  style={{
                    minHeight: 44, borderRadius: 14,
                    border: `1px solid ${value === currentValue ? toneColor : T.lineStrong}`,
                    background: value === currentValue ? toneBackground : T.card,
                    color: T.text, fontSize: VOICE_TYPE.bodyStrong, fontWeight: 800,
                    fontFamily: 'JetBrains Mono, ui-monospace, monospace',
                    cursor: 'pointer', touchAction: 'manipulation',
                  }}
                >
                  {value}
                </button>
              ))}
            </div>
          )}

          {isKeypad && (
            <div
              data-testid="manual-keypad"
              style={{
                width: '100%', height: '100%', minHeight: 0,
                display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                gridTemplateRows: 'repeat(4, minmax(44px, 1fr))', gap: 8,
              }}
            >
              {['1', '2', '3', '4', '5', '6', '7', '8', '9',
                choices.kind === 'float' ? '.' : '', '0', '⌫'].map((key, index) =>
                key === '' ? (
                  <span key={`spacer-${index}`} />
                ) : (
                  <button
                    key={key}
                    type="button"
                    data-testid={key === '⌫' ? 'manual-key-back' : `manual-key-${key}`}
                    title={key === '⌫' ? '한 글자 지우기' : key}
                    aria-label={key === '⌫' ? '한 글자 지우기' : key}
                    onClick={() => (key === '⌫' ? backspace() : appendKey(key))}
                    style={{
                      width: '100%', height: '100%', minHeight: 44, minWidth: 0,
                      borderRadius: 14, border: `1px solid ${toneColor}`,
                      background: toneBackground, color: T.text,
                      fontSize: VOICE_TYPE.keypadKey, fontWeight: 850, cursor: 'pointer',
                      fontFamily: 'JetBrains Mono, ui-monospace, monospace',
                      touchAction: 'manipulation',
                    }}
                  >
                    {key}
                  </button>
                ),
              )}
            </div>
          )}

          {choices.kind === 'text' && (
            <textarea
              data-testid="manual-text-input"
              value={draft}
              onChange={(event) => { setError(null); setDraft(event.target.value); }}
              placeholder={currentValue || `${col.name} 입력`}
              style={{
                width: '100%', height: '100%', minHeight: 44, boxSizing: 'border-box',
                borderRadius: 14, border: `1px solid ${toneColor}`,
                background: 'rgba(0,0,0,0.3)', color: T.text,
                fontSize: VOICE_TYPE.bodyStrong, fontWeight: 600, padding: 12, resize: 'none',
              }}
            />
          )}

          {choices.kind === 'date' && (
            <input
              type="date"
              data-testid="manual-date-input"
              value={draft}
              onChange={(event) => { setError(null); setDraft(event.target.value); }}
              style={{
                width: '100%', height: '100%', minHeight: 44, boxSizing: 'border-box',
                borderRadius: 14, border: `1px solid ${toneColor}`,
                background: 'rgba(0,0,0,0.3)', color: T.text,
                fontSize: VOICE_TYPE.bodyStrong, fontWeight: 700, padding: '0 12px', colorScheme: 'dark',
              }}
            />
          )}
        </div>

        <div
          data-testid="manual-action-row"
          style={{
            minHeight: 44, display: 'grid',
            gridTemplateColumns: hasSave ? 'repeat(2, minmax(0, 1fr))' : 'minmax(0, 1fr)',
            gap: 8,
          }}
        >
          <EdgeButton
            kind="text"
            testId="manual-cancel"
            label="✕ 취소"
            title="취소"
            onClick={onClose}
            accent={T.red}
            accentBg={T.redGlowFaint}
          />
          {hasSave && (
            <EdgeButton
              kind="text"
              testId="manual-commit"
              label="✓ 저장"
              title="저장"
              onClick={() => tryCommit(draft)}
              disabled={draft.trim() === ''}
              accent={T.green}
              accentBg={T.greenGlowFaint}
            />
          )}
        </div>
      </div>
      </section>
    </div>
  );
}
