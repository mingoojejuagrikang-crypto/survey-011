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
   *  🔴 **배율이 1을 넘어 커지는 것은 「민구 확정(08-07)」으로 의도된 동작이다. 상한을 두지 마라.**
   *  민구 판단: *"빈 공간을 안 남기는 게 원거리 가독에 낫다. 값마다 크기가 출렁이는 것은 감수한다."*
   *  `heroLayout.ts` §sheetDisplay의 *"상한은 두지 않는다 — 고정 상한은 T6 6회차 재발 원인"*과도 같다.
   *
   *  ⚠️ **커밋 `6d69165` 메시지·종전 주석의 「짧은 값에서는 종전과 같은 크기로 착지한다(배율 1)」은
   *  실측으로 반증됐다**(08-07 레인 V). `searchBasePx`는 탐색 **유도값**일 뿐 상한이 아니다 —
   *  402×874·`3`에서 `--fit-sheet=1.7976` → **231.2px**(종전 128.64px보다 크다).
   *  값이 길어지면 내려간다: 402×513 `311`→111.5px · `3115.75`→85.3px · `311575.25`→67.3px.
   *  🔑 이 「1 초과」 축은 `v0461-fb11-manual-display.spec.ts`가 **일부러 안 재는 것**이다
   *  (그 파일 §안 재는 것 참조) — 민구가 허용한 동작이라 단언으로 굳히면 안 된다. */
  const displayValueRef = useRef<HTMLSpanElement>(null);
  const displayFitRef = useFitGroup<HTMLDivElement>(
    [visibleValue, isKeypad],
    // 🔴 `minScale`을 **CSS 하한과 일치**시킨다. `VOICE_TYPE.sheetDisplay`가
    //    `max(44px, calc(128.64px * var(--fit-sheet,1)))`이므로 CSS는 배율 44/128.64≈0.342에서
    //    멈추는데, `fitGroup.ts`의 기본 `minScale`은 **0.25**다. 그 사이 값을 fit이 고르면
    //    CSS가 그것을 무시해 **fit이 「맞췄다」고 보고하지만 실제로는 넘치는** 상태가 된다
    //    (종전 `max(128.64px, …)`가 배율을 통째로 흡수하던 것과 같은 구조의 버그다).
    //    두 하한을 한 값으로 묶으면 fit이 거짓말하지 않는다 — 하한에서도 넘치면 그건
    //    「44px 아래로는 안 줄인다」는 계약의 결과이고, 프로브가 red로 드러낸다.
    [{
      variable: '--fit-sheet', members: [displayValueRef],
      searchBasePx: 128.64, minScale: 44 / 128.64,
    }],
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
          종전엔 fit이 아예 없어 고정 128.64px가 `ellipsis`로 잘렸다(heroLayout §sheetDisplay).

          🔴🔴 **`alignItems: 'flex-end'`로 되돌리지 마라 — 그것이 fit의 높이 판정을 죽인다.**
          (08-07 레인 V 실측, `_probe-fb11-manual-display.spec.ts`)
          `fitGroups`의 `fits()`는 높이를 **이 컨테이너의 `scrollHeight > clientHeight`**로 본다
          (`fitGroup.ts` §overflowsHeight). 그런데 `flex-end`에서 자식이 커지면 넘침이
          **block-start(위) 방향**으로 가고, 그 방향 오버플로는 **스크롤 영역에 잡히지 않는다**
          (`scrollHeight === clientHeight`). 같은 함정을 `fitGroup.ts:44`가 폭에 대해 이미 적어놨다.
          실측: `zOvY=0`인 채로 배율이 **3.6028까지 폭주**해 폰트가 128.64px→**463.5px**,
          높이 111px zone 밖으로 `outTop=1148.3px`. 화면엔 `311575.25` 중 `25`만 보였다 —
          `311…`보다 나쁘다(잘린 표시조차 없다).
          👉 그래서 정렬을 **`flex-start` + 자식의 `marginTop:auto`**로 만든다. auto 여백은
          남는 공간이 **양수일 때만** 분배되므로 ⓐ여유가 있으면 종전과 똑같이 하단 정렬이고
          ⓑ넘치면 0이 되어 자식이 위에 붙고 넘침이 **아래로** 간다 → `scrollHeight`가 잡는다. */}
      <div
        ref={displayFitRef}
        data-testid="manual-value-display-zone"
        style={{
          position: 'relative', minHeight: 0, overflow: 'hidden',
          display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
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
              // 🔴 하단 정렬은 zone의 `alignItems`가 아니라 **이 auto 여백**이 만든다(위 zone 주석).
              //    넘칠 때 넘침을 아래로 보내 fit의 높이 판정을 살리는 것이 목적이다.
              marginTop: 'auto',
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
