import { T } from '../../tokens';
import { useFitScale } from './useFitScale';
import { STATE_TYPE } from './heroLayout';
import { anomalyAlarmLabel } from '../../lib/anomalyAlert';

/** v0.28.0 — 이 카드 전용 확장 축소 단계(useFitScale 공용 FIT_STEPS 하위 참고). 다른 카드
 *  (ModifyIndicatorPill/VoiceHero)는 375/412/430 전부 기존 PASS라 그 카드들의 useFitScale 호출은
 *  그대로 둔다 — 이 확장 배열은 이상치 카드에만 전달된다. 모든 폰트/여백에 절대 하한
 *  (`max(px, calc(... * var(--fit-lo)))`)을 같이 걸어, 이 배열이 아무리 낮은 단계까지 가도 텍스트가
 *  읽을 수 없는 크기로 무한 축소되지 않는다(2026-07-06 Sonar 재현 QA 수정). */
const ANOMALY_FIT_STEPS = [
  1.12, 1.06, 1, 0.94, 0.88, 0.82, 0.76, 0.7, 0.64, 0.58,
  // v0.28.0 — 0.58 밑은 더 촘촘한 간격(0.03)으로: useFitScale의 fits() 판정에 +1px 허용오차가
  // 있어(부동소수 rAF 스래싱 방지용, 공용 로직 불변), 성긴 간격에서는 "거의 맞지만 1px 초과"
  // 단계에서 조기 정지해버릴 수 있다(375×667 실측에서 관측). 더 촘촘한 단계로 그 확률을 줄인다.
  0.55, 0.52, 0.49, 0.46, 0.43, 0.4, 0.37, 0.34, 0.31, 0.28, 0.25, 0.22, 0.19, 0.16, 0.13,
] as const;

/** 와이어프레임 §[2] anomaly — 중앙 50%의 이상치 경보 표시.
 *
 * ```
 *        추세알람 : 0.80
 *     직전(2026-07-22)       현재
 *          88.8              88
 * ```
 *  - 경보행: `<추세|범위>알람 : <넘어선 정도>`(추세=숫자 / 범위=% 표현). **값 위·값 안 가림.**
 *  - 2열 비교: `직전(날짜)`↓과거값 / `현재`↓알람 유발값(음성 따라 실시간 반영·교정).
 *  - `[확인]`/`[수정]`은 이 카드가 아니라 **하단 `<` `>` 자리**로 옮겼다(§[2] 하단부). 카드 안에서
 *    버튼이 빠지면서 375×667의 무스크롤 예산도 함께 넉넉해진다.
 *  - 항목명은 그리지 않는다 — 칩존의 활성칩이 빨강으로 같은 정보를 이미 준다(§[2] "활성칸 빨강 강조").
 *
 *  이력: v0.9.0 신설(발화만으론 스쳐 지나감) → v0.12.0 샘플/직전일자 → v0.13.0 정정 GREEN 톤 →
 *  v0.23.0 중앙 흡수영역 자식으로 이전 → v0.27.0/v0.28.0 무스크롤(useFitScale) → 와이어프레임 §[2]. */
export function AnomalyAlertPopup({
  a,
}: {
  a: {
    colName: string;
    prev: string;
    next: string;
    direction: 'up' | 'down';
    changeText: string;
    row: number;
    sampleKey?: string;
    prevDate?: string;
    status?: 'pending' | 'corrected';
    /** v0.20.0 입력탭#6 — 어떤 규칙이 발동했는지(추세 방향 알람 vs 변동률 범위 알람). */
    kind?: 'trend' | 'range';
    /** v0.20.0 — range 알람일 때 임계 변동률(%). kind==='range'에서만 사용. */
    threshold?: number;
    awaitingResponse?: boolean;
    manualHold?: boolean;
  };
}) {
  const corrected = a.status === 'corrected';
  // 와이어프레임 §[2] `<추세|범위>알람 : <넘어선 정도>` + **방향어 유지**(민구 확정 2026-07-25).
  //
  // 🔴 이 라벨은 TTS(`anomalyAlert.ts`의 `alertText`)·텔레메트리(`text=`)와 **글자까지 동일**해야
  //    한다(시각·청각 일치 계약, PRINCIPLES §2 / v0.20.0 입력탭#6). 현장에선 화면을 안 보고 귀로만
  //    듣는 경우가 많아, "들리는 말"과 "보이는 글"이 다르면 혼란스럽다.
  //    → **여기서 문구를 조립하지 않는다.** 종전엔 이 자리에서 따로 조립해 콜론만큼 TTS와 어긋나
  //      있었다(F3 리뷰 지적). 지금은 `anomalyAlarmLabel`(anomalyAlert.ts) 하나가 화면·TTS·로그의
  //      유일한 출처이고, 이 컴포넌트는 그 함수를 같은 페이로드로 호출해 **렌더만** 한다.
  //      문구를 바꿔야 하면 이 파일이 아니라 그 함수를 고쳐라.
  //  - `정상 : 복귀`(정정 후 정상)는 알람이 아니라 alertText/TTS 경로가 없다 → 이 카드 전용 문구로 남는다.
  const alarmLabel = corrected ? '정상 : 복귀' : anomalyAlarmLabel(a);
  // corrected(정정 후 정상)면 GREEN, 그 외(이상치 대기)는 RED 통일.
  const accent = corrected ? T.green : T.red;
  const previousLabel = a.prevDate ? `직전(${a.prevDate})` : '직전';
  const fitRef = useFitScale<HTMLDivElement>([
    a.colName, a.prev, a.next, a.changeText, a.sampleKey, a.prevDate, a.status, a.kind,
  ], ANOMALY_FIT_STEPS);
  return (
    <div
      ref={fitRef}
      data-testid="anomaly-alert"
      data-status={corrected ? 'corrected' : 'pending'}
      className="anomaly-alert-layout"
      aria-live="assertive"
      style={{
        // 카드 chrome 없이 중앙 흡수영역 자체를 상태판으로 사용한다(§[2] 중앙 50%).
        width: '100%', maxWidth: 'min(720px, 96vw)',
        height: '100%', maxHeight: '100%', minHeight: 0, overflowY: 'auto',
        padding: 'max(2px, calc(clamp(4px, 1vh, 10px) * var(--fit-lo, 1))) 0',
        display: 'flex', flexDirection: 'column',
        justifyContent: 'center', alignItems: 'center',
        gap: 'max(4px, calc(clamp(8px, 1.6vh, 18px) * var(--fit-lo, 1)))',
        textAlign: 'center',
      }}
    >
      <span
        data-testid="anomaly-headline"
        style={{
          maxWidth: '100%', color: accent,
          fontSize: STATE_TYPE.alarmLabel,
          fontWeight: 900, lineHeight: 1.08,
          wordBreak: 'keep-all', overflowWrap: 'anywhere',
        }}
      >
        {alarmLabel}
      </span>
      {/* 와이어프레임 §[2] 2열 비교 — 라벨 행 / 값 행. 두 열의 값이 같은 baseline에 서야 크기를
          눈으로 비교할 수 있으므로 grid 2열로 고정한다(줄바꿈으로 세로로 무너지지 않게 nowrap). */}
      <div
        data-testid="anomaly-comparison"
        style={{
          width: '100%',
          display: 'grid', gridTemplateColumns: '1fr 1fr',
          columnGap: 'clamp(8px, 4vw, 32px)',
          rowGap: 'max(2px, calc(clamp(4px, 0.9vh, 10px) * var(--fit-lo, 1)))',
          alignItems: 'baseline', justifyItems: 'center',
        }}
      >
        <span style={COMPARE_LABEL}>{previousLabel}</span>
        <span style={COMPARE_LABEL}>현재</span>
        <span data-testid="anomaly-prev-value" style={{ ...COMPARE_VALUE, color: T.textDim }}>{a.prev}</span>
        <span data-testid="anomaly-next-value" style={{ ...COMPARE_VALUE, color: accent }}>{a.next}</span>
      </div>
    </div>
  );
}

const COMPARE_LABEL: React.CSSProperties = {
  maxWidth: '100%',
  color: T.textMute,
  fontSize: STATE_TYPE.compareLabel,
  fontWeight: 800,
  lineHeight: 1.1,
  letterSpacing: -0.3,
  whiteSpace: 'nowrap',
};

const COMPARE_VALUE: React.CSSProperties = {
  maxWidth: '100%',
  fontSize: STATE_TYPE.compareValue,
  fontWeight: 900,
  lineHeight: 1.02,
  letterSpacing: -1.4,
  fontVariantNumeric: 'tabular-nums',
  whiteSpace: 'nowrap',
};
