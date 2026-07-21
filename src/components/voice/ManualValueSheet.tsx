import { useState } from 'react';
import { T } from '../../tokens';
import type { Column } from '../../types';
import { choicesFor, validateManual } from '../../lib/manualInput';
import { ModalBase } from '../ModalBase';

/** v0.33.0 항목6 — 칩 터치 수동 입력 하단 시트.
 *
 *  음성 인식이 어려운 상황(소음·발화 피로·반복 오인식)에서 활성/완료 음성 칩을 탭해 값을 손으로
 *  넣는 경로. 열려 있는 동안 STT는 hard-suspend(suspendRecognitionForUi — 도움말 팝업과 동일
 *  검증 경로)되고, 닫으면 resume된다(배선은 VoiceScreen).
 *
 *  타입별 UI(choicesFor가 SSOT):
 *   - options → 선택지 버튼 그리드(탭 즉시 커밋, 버튼 ≥44px)
 *   - seq     → 범위 버튼 그리드(≤24개, 탭 즉시 커밋)
 *   - int/float → 대형 키패드(키 56px, validateManual로 자리수/범위 검증 후 "입력")
 *   - text/name → textarea + "입력"
 *   - date    → date input + "입력"
 *  하단: [음성으로 다시 입력](기존 restartFromCol 경로 보존) · [취소].
 *
 *  장갑/한 손 기준: 모든 터치 타깃 ≥44px, 키패드 키 56px, 하단 시트라 엄지 도달권.
 *  safe-area: 홈 인디케이터 침범 방지 paddingBottom max(16px, var(--sab)). */
export function ManualValueSheet({
  col, row, currentValue, onCommit, onVoiceRetry, onClose,
}: {
  col: Column;
  row: number;
  /** 셀의 현재 값(있으면 키패드/텍스트 초기값 힌트로 표시). */
  currentValue: string;
  onCommit: (value: string) => void;
  /** "음성으로 다시 입력" — 시트를 닫고 restartFromCol(기존 음성 재입력 경로)로 위임. */
  onVoiceRetry: () => void;
  onClose: () => void;
}) {
  const choices = choicesFor(col);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  const tryCommit = (raw: string) => {
    const result = validateManual(col, raw);
    if (!result.ok) {
      setError(result.reason);
      return;
    }
    onCommit(result.value);
  };

  const appendKey = (k: string) => {
    setError(null);
    setDraft((d) => {
      if (k === '.' && (d.includes('.') || d === '')) return d; // 중복 소수점·선행 점 방지
      return d + k;
    });
  };
  const backspace = () => { setError(null); setDraft((d) => d.slice(0, -1)); };

  const isKeypad = choices.kind === 'int' || choices.kind === 'float';

  return (
    // v0.37.0 FB-I(민구) — 종전 z-50은 EdgeGlow(54) **아래**라, full-bleed 글로우로 바뀐 뒤 초록
    //   가장자리 링/블룸이 수동 입력 시트 위를 덮었다(입력 UI 오염). z-55로 올려 글로우(54) 위,
    //   일반 모달(100) 아래에 둔다(종료 확인 55와 같은 입력탭 오버레이 대역). 시트는 모달로서 하단
    //   나비를 덮는 기존 계약 유지(입력 집중) — 나비를 '띄운 채' 두는 배치는 시트 버튼이 나비 뒤로
    //   숨는 상충이 있어 민구 기기 확인 후 결정(KNOWN-ISSUES [REGION-1]).
    <ModalBase onClose={onClose} zIndex={55} pad={null} align="end">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${col.name} 수동 입력`}
        data-testid="manual-value-sheet"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 620, maxHeight: '86%',
          display: 'flex', flexDirection: 'column', gap: 10,
          background: T.card, borderRadius: '24px 24px 0 0',
          border: `1px solid ${T.lineStrong}`, borderBottom: 'none',
          padding: '16px 16px 0',
          // safe-area — 홈 인디케이터 위로 하단 버튼 전체가 올라오게.
          paddingBottom: 'max(16px, var(--sab))',
          overflowY: 'auto',
        }}
      >
        {/* 헤더 — 어느 행/항목을 고치는지 명시(수동 입력의 오타깃 방지). */}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 20, fontWeight: 900, color: T.text, letterSpacing: -0.3 }}>
            {row}행 {col.name}
          </span>
          <span style={{ fontSize: 14, fontWeight: 700, color: T.textDim }}>
            수동 입력{currentValue ? ` · 현재 ${currentValue}` : ''}
          </span>
        </div>

        {/* ── 타입별 입력 본문 ── */}
        {choices.kind === 'options' && (
          <div
            data-testid="manual-options-grid"
            style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 8 }}
          >
            {(choices.options ?? []).map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => tryCommit(opt)}
                style={{
                  minHeight: 48, borderRadius: 14,
                  border: `1px solid ${opt === currentValue ? T.blue : T.lineStrong}`,
                  background: opt === currentValue ? 'rgba(41,121,255,0.14)' : 'rgba(255,255,255,0.03)',
                  color: T.text, fontSize: 17, fontWeight: 800, cursor: 'pointer',
                  touchAction: 'manipulation',
                }}
              >
                {opt}
              </button>
            ))}
          </div>
        )}

        {choices.kind === 'seq' && (
          <div
            data-testid="manual-seq-grid"
            style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(64px, 1fr))', gap: 8 }}
          >
            {(choices.seqValues ?? []).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => tryCommit(v)}
                style={{
                  minHeight: 48, borderRadius: 14,
                  border: `1px solid ${v === currentValue ? T.blue : T.lineStrong}`,
                  background: v === currentValue ? 'rgba(41,121,255,0.14)' : 'rgba(255,255,255,0.03)',
                  color: T.text, fontSize: 18, fontWeight: 800, cursor: 'pointer',
                  fontFamily: 'JetBrains Mono, ui-monospace, monospace',
                  touchAction: 'manipulation',
                }}
              >
                {v}
              </button>
            ))}
          </div>
        )}

        {isKeypad && (
          <>
            {/* 입력값 디스플레이 — 큰 mono(햇빛 가독), placeholder는 현재값. */}
            <div
              data-testid="manual-keypad-display"
              style={{
                minHeight: 52, borderRadius: 14, border: `1px solid ${T.lineStrong}`,
                background: 'rgba(0,0,0,0.3)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 32, fontWeight: 900, letterSpacing: -0.5,
                fontFamily: 'JetBrains Mono, ui-monospace, monospace',
                color: draft ? T.text : T.textMute,
              }}
            >
              {draft || currentValue || ' '}
            </div>
            <div
              data-testid="manual-keypad"
              style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}
            >
              {['7', '8', '9', '4', '5', '6', '1', '2', '3',
                choices.kind === 'float' ? '.' : '', '0', '⌫'].map((k, i) =>
                k === '' ? (
                  <span key={`sp${i}`} />
                ) : (
                  <button
                    key={k}
                    type="button"
                    data-testid={k === '⌫' ? 'manual-key-back' : `manual-key-${k}`}
                    onClick={() => (k === '⌫' ? backspace() : appendKey(k))}
                    style={{
                      height: 56, borderRadius: 14,
                      border: `1px solid ${T.lineStrong}`,
                      background: 'rgba(255,255,255,0.03)',
                      color: T.text, fontSize: 24, fontWeight: 800, cursor: 'pointer',
                      fontFamily: 'JetBrains Mono, ui-monospace, monospace',
                      touchAction: 'manipulation',
                    }}
                  >
                    {k}
                  </button>
                ),
              )}
            </div>
            <button
              type="button"
              data-testid="manual-commit"
              onClick={() => tryCommit(draft)}
              disabled={draft === ''}
              style={{
                minHeight: 56, borderRadius: 16, border: 'none',
                background: draft === ''
                  ? 'rgba(255,255,255,0.06)'
                  : `linear-gradient(180deg, #5A9BFF 0%, ${T.blue} 58%, #1859D5 100%)`,
                color: draft === '' ? T.textMute : '#fff',
                fontSize: 20, fontWeight: 900, cursor: draft === '' ? 'default' : 'pointer',
                touchAction: 'manipulation',
              }}
            >
              입력
            </button>
          </>
        )}

        {choices.kind === 'text' && (
          <>
            <textarea
              data-testid="manual-text-input"
              value={draft}
              onChange={(e) => { setError(null); setDraft(e.target.value); }}
              placeholder={currentValue || `${col.name} 입력`}
              rows={3}
              style={{
                width: '100%', boxSizing: 'border-box', borderRadius: 14,
                border: `1px solid ${T.lineStrong}`, background: 'rgba(0,0,0,0.3)',
                color: T.text, fontSize: 18, fontWeight: 600, padding: 12,
                resize: 'none',
              }}
            />
            <button
              type="button"
              data-testid="manual-commit"
              onClick={() => tryCommit(draft)}
              disabled={draft.trim() === ''}
              style={{
                minHeight: 56, borderRadius: 16, border: 'none',
                background: draft.trim() === ''
                  ? 'rgba(255,255,255,0.06)'
                  : `linear-gradient(180deg, #5A9BFF 0%, ${T.blue} 58%, #1859D5 100%)`,
                color: draft.trim() === '' ? T.textMute : '#fff',
                fontSize: 20, fontWeight: 900, cursor: draft.trim() === '' ? 'default' : 'pointer',
                touchAction: 'manipulation',
              }}
            >
              입력
            </button>
          </>
        )}

        {choices.kind === 'date' && (
          <>
            <input
              type="date"
              data-testid="manual-date-input"
              value={draft}
              onChange={(e) => { setError(null); setDraft(e.target.value); }}
              style={{
                width: '100%', boxSizing: 'border-box', minHeight: 52, borderRadius: 14,
                border: `1px solid ${T.lineStrong}`, background: 'rgba(0,0,0,0.3)',
                color: T.text, fontSize: 18, fontWeight: 700, padding: '0 12px',
                colorScheme: 'dark',
              }}
            />
            <button
              type="button"
              data-testid="manual-commit"
              onClick={() => tryCommit(draft)}
              disabled={draft === ''}
              style={{
                minHeight: 56, borderRadius: 16, border: 'none',
                background: draft === ''
                  ? 'rgba(255,255,255,0.06)'
                  : `linear-gradient(180deg, #5A9BFF 0%, ${T.blue} 58%, #1859D5 100%)`,
                color: draft === '' ? T.textMute : '#fff',
                fontSize: 20, fontWeight: 900, cursor: draft === '' ? 'default' : 'pointer',
                touchAction: 'manipulation',
              }}
            >
              입력
            </button>
          </>
        )}

        {/* 검증 실패 사유 — 무음 거부 금지([REVIEW-4] 계열): 왜 안 되는지 그대로 보여준다. */}
        {error && (
          <div
            data-testid="manual-error"
            role="alert"
            style={{ fontSize: 14, fontWeight: 800, color: T.red, textAlign: 'center' }}
          >
            {error}
          </div>
        )}

        {/* 하단 행동 — 음성 재입력(기존 restartFromCol 경로) + 취소. 둘 다 ≥44px. */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr minmax(96px, 0.4fr)', gap: 10 }}>
          <button
            type="button"
            data-testid="manual-voice-retry"
            onClick={onVoiceRetry}
            style={{
              minHeight: 48, borderRadius: 14, border: `1px solid ${T.lineStrong}`,
              background: 'rgba(41,121,255,0.10)', color: T.blue,
              fontSize: 16, fontWeight: 850, cursor: 'pointer', touchAction: 'manipulation',
            }}
          >
            음성으로 다시 입력
          </button>
          <button
            type="button"
            data-testid="manual-cancel"
            onClick={onClose}
            style={{
              minHeight: 48, borderRadius: 14, border: `1px solid ${T.lineStrong}`,
              background: 'transparent', color: T.textDim,
              fontSize: 16, fontWeight: 850, cursor: 'pointer', touchAction: 'manipulation',
            }}
          >
            취소
          </button>
        </div>
      </div>
    </ModalBase>
  );
}
