import { useEffect, useRef, useState } from 'react';
import { T } from '../../tokens';
import { useSettingsStore } from '../../stores/settingsStore';
import { logger } from '../../lib/logger';
import { settingChanged } from '../../lib/logEvents';
import { speak } from '../../lib/speech';
import type { VoiceUiCommandSignal } from '../../lib/voiceCommands';

/** v0.20.0 입력탭#1·#2 — 입력 컨트롤바: [인식 허용범위] · [안내 속도] 두 다이얼을 수평 배치.
 *  허용범위(recognitionTolerance) 0.40~0.90 → %로 표시. 속도(ttsRate) 0.5~2.0 → x로 표시·샘플 음성.
 *  두 다이얼은 375 폭에서도 한 줄에 들어가게 동일 flex(각 minWidth:0). */
function clampStep(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value * 100) / 100));
}

export function ActiveControlSteppers({ uiCommand }: { uiCommand: VoiceUiCommandSignal | null }) {
  const s = useSettingsStore();
  const ttsDebounceRef = useRef<number | null>(null);
  const sampleTts = (rate: number) => {
    if (ttsDebounceRef.current !== null) window.clearTimeout(ttsDebounceRef.current);
    ttsDebounceRef.current = window.setTimeout(() => {
      void speak('이 속도로 안내합니다.', { interrupt: true, rate });
      // v0.33.0 B-5 — ttsRate 스탭퍼 변경 로깅(이전엔 무로깅). 샘플 TTS와 같은 디바운스 창에서
      // 최종값만 1회 기록해 연타가 링버퍼(2000)를 잠식하지 않게 한다.
      logger.log({ type: 'app', extra: settingChanged('ttsRate', rate) });
    }, 350);
  };
  // v0.33.0 B-6 — recognitionTolerance 로깅 디바운스(이전엔 탭마다 즉시 로깅 → 연타 시 링버퍼 잠식).
  // ttsDebounceRef와 동일 패턴·동일 350ms 창, 최종값만 기록.
  const tolLogDebounceRef = useRef<number | null>(null);
  const [open, setOpen] = useState(false);
  const setTolerance = (next: number) => {
    const value = clampStep(next, 0.4, 0.9);
    s.set({ recognitionTolerance: value });
    if (tolLogDebounceRef.current !== null) window.clearTimeout(tolLogDebounceRef.current);
    tolLogDebounceRef.current = window.setTimeout(() => {
      logger.log({ type: 'app', extra: settingChanged('recognitionTolerance', value) });
    }, 350);
  };
  const setTtsRate = (next: number) => {
    const value = clampStep(next, 0.5, 2);
    s.set({ ttsRate: value });
    sampleTts(value);
  };
  const handledUiCommandSeqRef = useRef(0);
  useEffect(() => {
    if (!uiCommand || uiCommand.seq <= handledUiCommandSeqRef.current) return;
    handledUiCommandSeqRef.current = uiCommand.seq;
    const current = useSettingsStore.getState();
    switch (uiCommand.id) {
      case 'toggleInputControls': setOpen((v) => !v); break;
      case 'recognitionDown': setTolerance(current.recognitionTolerance - 0.05); break;
      case 'recognitionUp': setTolerance(current.recognitionTolerance + 0.05); break;
      case 'guidanceSlower': setTtsRate(current.ttsRate - 0.05); break;
      case 'guidanceFaster': setTtsRate(current.ttsRate + 0.05); break;
    }
    // 이벤트 seq가 유일한 실행 트리거다. 설정/로컬 상태 변경으로 같은 명령을 재실행하지 않는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uiCommand?.seq]);
  const tolPct = Math.round(s.recognitionTolerance * 100);
  // v0.37.0 FB-K(민구) — 모호한 "입력 조절"·"인식"·"안내" 라벨을 뜻이 분명한 "허용 인식률"·
  //   "안내속도"로 교체(원거리·장갑 현장에서 무엇을 조절하는지 즉시 이해). 요약 접힘 버튼도
  //   포괄 라벨("입력 조절")을 제거하고 두 값만 나열한다.
  const summary = `허용 인식률 ${tolPct}% · 안내속도 ${s.ttsRate.toFixed(2)}x`;
  return (
    <div
      data-testid="input-control-panel"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <button
        type="button"
        data-testid="input-control-toggle"
        aria-expanded={open}
        onClick={() => {
          // v0.33.0 B-7 — 입력 조절 패널 열림/닫힘 계측(ui_suspend/ui_resume의 command 컨벤션).
          // updater 밖에서 로깅(StrictMode의 updater 중복 호출로 이벤트가 2배로 찍히지 않게).
          logger.log({ type: 'command', parsed: open ? 'ui_close' : 'ui_open', extra: 'input_control_panel' });
          setOpen((v) => !v);
        }}
        style={{
          minHeight: 42,
          borderRadius: 14,
          border: `1px solid ${T.lineStrong}`,
          background: T.card,
          color: T.textDim,
          fontSize: 14,
          fontWeight: 850,
          letterSpacing: -0.2,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          cursor: 'pointer',
          touchAction: 'manipulation',
        }}
        title="허용 인식률·안내속도"
      >
        <span>{summary}</span>
        <span aria-hidden style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 150ms' }}>⌄</span>
      </button>
      {open && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <StepperControl
            testId="stepper-tolerance"
            label="허용 인식률"
            value={`${tolPct}%`}
            detail="높을수록 엄격"
            accent={T.green}
            minusLabel="인식 기준 낮추기"
            plusLabel="인식 기준 높이기"
            canMinus={s.recognitionTolerance > 0.4}
            canPlus={s.recognitionTolerance < 0.9}
            onMinus={() => setTolerance(s.recognitionTolerance - 0.05)}
            onPlus={() => setTolerance(s.recognitionTolerance + 0.05)}
          />
          <StepperControl
            testId="stepper-tts-rate"
            label="안내속도"
            value={`${s.ttsRate.toFixed(2)}x`}
            detail="음성 속도"
            accent={T.blue}
            minusLabel="음성 안내 속도 낮추기"
            plusLabel="음성 안내 속도 높이기"
            canMinus={s.ttsRate > 0.5}
            canPlus={s.ttsRate < 2}
            onMinus={() => setTtsRate(s.ttsRate - 0.05)}
            onPlus={() => setTtsRate(s.ttsRate + 0.05)}
          />
        </div>
      )}
    </div>
  );
}

function StepperControl({
  testId, label, value, detail, accent, minusLabel, plusLabel, canMinus, canPlus, onMinus, onPlus,
}: {
  testId: string;
  label: string;
  value: string;
  detail: string;
  accent: string;
  minusLabel: string;
  plusLabel: string;
  canMinus: boolean;
  canPlus: boolean;
  onMinus: () => void;
  onPlus: () => void;
}) {
  return (
    <div
      data-testid={testId}
      style={{
        minWidth: 0,
        borderRadius: 16,
        border: `1px solid ${T.lineStrong}`,
        background: 'rgba(255,255,255,0.035)',
        padding: 8,
        display: 'grid',
        gridTemplateColumns: '48px minmax(0, 1fr) 48px',
        alignItems: 'center',
        gap: 8,
      }}
    >
      <StepperButton label="−" title={minusLabel} disabled={!canMinus} onClick={onMinus} testId={`${testId}-minus`} />
      <div style={{ minWidth: 0, textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontSize: 12, color: T.textMute, fontWeight: 800, lineHeight: 1 }}>{label}</span>
        <span style={{ fontSize: 20, color: accent, fontWeight: 950, lineHeight: 1.15, fontFamily: 'JetBrains Mono, ui-monospace, monospace' }}>
          {value}
        </span>
        <span style={{ fontSize: 10, color: T.textMute, fontWeight: 650, lineHeight: 1.2, whiteSpace: 'nowrap' }}>{detail}</span>
      </div>
      <StepperButton label="+" title={plusLabel} disabled={!canPlus} onClick={onPlus} testId={`${testId}-plus`} />
    </div>
  );
}

function StepperButton({
  label, title, disabled, onClick, testId,
}: {
  label: string;
  title: string;
  disabled: boolean;
  onClick: () => void;
  testId: string;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      style={{
        width: 48,
        height: 48,
        borderRadius: 14,
        border: `1px solid ${T.lineStrong}`,
        background: disabled ? 'rgba(255,255,255,0.025)' : T.card,
        color: disabled ? T.textMute : T.text,
        fontSize: 26,
        fontWeight: 950,
        lineHeight: 1,
        cursor: disabled ? 'default' : 'pointer',
        touchAction: 'manipulation',
      }}
    >
      {label}
    </button>
  );
}
