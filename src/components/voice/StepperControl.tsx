import { T } from '../../tokens';
import { VOICE_TYPE } from './heroLayout';

/** 스텝퍼 프리미티브 — `ActiveControlSteppers.tsx`에서 분리해 나왔다(2026-08-14, 리팩토링 R1 P1-1).
 *
 *  🔴 **왜 갈랐나:** 본 파일이 499줄로 `max-lines` 500 상한까지 여유 1줄이었다 — 08-07에
 *  `VoiceHero.tsx`가 같은 상한을 넘겨 배포가 막힌 전례가 있다(그때의 처방이
 *  `AlarmInterimStrip.tsx` 분리). 범용 프리미티브(StepperControl·StepperButton·clampStep)는
 *  본 파일의 어떤 로컬 심볼에도 의존하지 않아 가장 깨끗한 절단면이다.
 *
 *  🔴🔴 **이 파일을 `src/components/voice/` 밖으로 옮기지 마라.**
 *  `tests/v043-typo-contract.spec.ts`가 그 디렉터리를 **재귀 순회**해 `.tsx`의 타이포 계약
 *  참조 **총 개수**를 단언한다. 같은 디렉터리 안이면 개수가 보존되지만 밖으로 나가면
 *  계약 4건이 사라져 red가 된다 — StepperControl의 3건 + StepperButton의 1건
 *  `VOICE_TYPE` 참조가 그 4건이다.
 *
 *  ⚠️ 이 주석 블록에 `font` + `Size` 붙여쓴 낱말을 넣지 마라. 그 검사기는 줄 선두가 `*`면
 *  **comment로 집계**하는데 그 개수 역시 단언 대상이라, 설명을 적는 것만으로 red가 된다.
 *
 *  ⚠️ `StepperButton`은 모듈 내부 전용이다 — 파일 밖 이용자가 없는 export는
 *  `check:unused`(knip)의 신규 검출이 된다. 밖에서 쓰게 되는 날 export로 승격하라. */

/** 스텝 증감값을 [min, max]로 클램프 — 0.05 스텝 부동소수 오차를 2자리 반올림으로 정리. */
export function clampStep(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value * 100) / 100));
}

export function StepperControl({
  testId, label, value, detail, accent, minusLabel, plusLabel, canMinus, canPlus, onMinus, onPlus,
  fullWidth = false,
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
  /** v0.46.0 WP-D — 2열 그리드에서 한 행을 통째로 쓴다(BargeInToggle과 같은 관례). */
  fullWidth?: boolean;
}) {
  return (
    <div
      data-testid={testId}
      style={{
        ...(fullWidth ? { gridColumn: '1 / -1' } : null),
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
        <span style={{ fontSize: VOICE_TYPE.captionXs, color: T.textMute, fontWeight: 800, lineHeight: 1 }}>{label}</span>
        <span style={{ fontSize: VOICE_TYPE.stepperValue, color: accent, fontWeight: 950, lineHeight: 1.15, fontFamily: 'JetBrains Mono, ui-monospace, monospace' }}>
          {value}
        </span>
        <span style={{ fontSize: VOICE_TYPE.captionXxs, color: T.textMute, fontWeight: 650, lineHeight: 1.2, whiteSpace: 'nowrap' }}>{detail}</span>
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
        fontSize: VOICE_TYPE.stepperValueLg,
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
