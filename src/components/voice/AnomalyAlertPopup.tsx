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
  //  - 🔴 fb-27-8(민구 확정 2026-07-27) — 정정 후 `정상 : 복귀` 문구는 **렌더하지 않는다**.
  //    민구 근거: "이미 하단에 아이콘과 엣지 글로우로 알 수 있음." 실제로 `ActiveState`가 corrected
  //    시 glyph·tone을 green으로 바꿔 같은 정보를 이미 준다. 이 문구는 alertText/TTS/로그 경로가
  //    없는 **이 카드 전용**이었으므로 삭제 부작용이 없다(오늘 실기기에서 19회 노출됐다).
  //    지운 자리는 비우지 않고 값 영역이 그만큼 커진다(아래 gap/fit이 자동 흡수).
  const alarmLabel = corrected ? null : anomalyAlarmLabel(a);
  // corrected(정정 후 정상)면 GREEN, 그 외(이상치 대기)는 RED 통일.
  const accent = corrected ? T.green : T.red;
  // fb-27-7 3항(민구 확정) — **연도를 빼고 `mm-dd`만**, 값 **앞**에 둔다. 현장에서 연도는 늘 올해다.
  const previousLabel = formatCompareDate(a.prevDate);
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
      {alarmLabel !== null && (
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
      )}
      {/* 직전/현재는 상하 2줄을 유지하되, 각 행을 같은 폭의 라벨/값 영역으로 나눈다.
          2026-07-29 민구 제보 #3 — 각 영역 중앙정렬은 글자 크기 차이 때문에 시각 무게가 오른쪽으로
          쏠려 반려됐다. 라벨 끝과 값 시작을 화면 중앙축으로 모아 한 비교 덩어리로 읽히게 한다. */}
      <div
        data-testid="anomaly-comparison"
        style={{
          width: '100%',
          display: 'grid',
          gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
          gridTemplateRows: 'auto auto',
          columnGap: 'clamp(4px, 1.5vw, 12px)',
          rowGap: 'max(2px, calc(clamp(4px, 0.9vh, 10px) * var(--fit-lo, 1)))',
          alignItems: 'center',
        }}
      >
        <span data-testid="anomaly-prev-label" style={COMPARE_LABEL}>{previousLabel}</span>
        <span data-testid="anomaly-prev-value" style={{ ...COMPARE_VALUE, color: T.textDim }}>{a.prev}</span>
        <span data-testid="anomaly-next-label" style={COMPARE_LABEL}>현재</span>
        <span data-testid="anomaly-next-value" style={{ ...COMPARE_VALUE, color: accent }}>{a.next}</span>
      </div>
    </div>
  );
}

/** `2026-07-26` → `07-26`. 날짜 형식이 아니면 그대로 두고, 없으면 `직전`. */
function formatCompareDate(raw?: string): string {
  if (!raw) return '직전';
  const m = raw.match(/(\d{2})-(\d{2})$/);
  return m ? `${m[1]}-${m[2]}` : raw;
}

/** 🔴 `lineHeight`는 **임계 1.15 위**여야 한다(v0.44.0 A2 실측).
 *
 *  Pretendard `fontWeight 800~900`에서 글리프(어센더~디센더)가 line box를 넘어
 *  `scrollHeight`가 상시 초과하고, 그 초과가 `useFitGroup`/`useFitScale`의 **높이 판정을
 *  오염시켜 fit이 최저 단계에 갇힌다**(§C0 배선이 막혔던 원인).
 *
 *  실측(375×667, `fontWeight 900` + `letterSpacing -1.4px` + nowrap + tabular):
 *  ```
 *    lineHeight   1.0   1.02   1.1   1.15   1.2
 *    excess@72.75px  5      5     2      0     0
 *    excess@30px     2      1     1      0     0
 *  ```
 *  🔴 **1.15에 딱 붙이지 않는다** — 경계값은 폰트 폴백(-apple-system 등)이나 굵기가 바뀌는
 *  순간 다시 넘친다(T6 재발 형태). `1.2`는 임계 대비 약 4% 여유이고 흔한 값이라 폴백에서도
 *  안전한 쪽이다. 세로 비용은 실측 **+25~27px**이며, 알람 카드 하단 여유가 375×667에서 46px ·
 *  402×874에서 56.8px이라 **카드 높이·3구역 배분·무스크롤(`card.excess = 0`)이 모두 불변**이다.
 *
 *  ⚠️ **`ExitConfirmInline.tsx:19` · `VoiceHero.tsx:341`이 이미 1.15를 쓴다** — 같은 계열이다.
 *
 *  🔴 **이 선언은 현재 런타임에서 효과가 없다. 그래도 되돌리지 않았다.**
 *  이 4개 요소(`anomaly-{prev,next}-{label,value}`)에서 **인라인 `line-height`가 무시되는
 *  현상**이 있다 — DOM `style` 속성과 CSSOM에는 `1.2`가 들어 있는데 computed는 `font-size`와
 *  같은 값(ratio 1.0)으로 나오고, `!important`를 붙일 때만 적용된다. 원인 **미확정**이며
 *  후보 10가지를 소거했다(CSS 규칙 0건 · 폰트 · 굵기 · `font-size` 형태 8종 · 애니메이션 0건 ·
 *  적용 순서/시점). 🔑 **같은 `style` 문자열의 `cloneNode` 복제본은 정상 작동한다.**
 *  전체 기록과 다음 조사 출발점: `Deliverables/2026-08-03-survey-011-v0440-A0-probe.md` §8.
 *
 *  **되돌리지 않은 이유:** 값 `1.2`는 실측 임계(1.15) 기준으로 옳고 **해가 없다**(효과가 없을
 *  뿐 회귀도 없다 — 블래스트 실측 완료). 되돌리면 다음 사람이 `1.02`를 보고 **같은 조사를
 *  처음부터 반복한다.** 무시 현상이 풀리는 순간 이 값이 그대로 살아난다.
 *
 *  ⚠️ **이 선언이 실제로 먹는지는 소스가 아니라 `getComputedStyle`로 재라.** */
const COMPARE_LINE_HEIGHT = 1.2;

const COMPARE_LABEL: React.CSSProperties = {
  maxWidth: '100%',
  color: T.textMute,
  fontSize: STATE_TYPE.compareLabel,
  fontWeight: 800,
  lineHeight: COMPARE_LINE_HEIGHT,
  letterSpacing: -0.3,
  whiteSpace: 'nowrap',
  textAlign: 'right',
  justifySelf: 'end',
};

const COMPARE_VALUE: React.CSSProperties = {
  maxWidth: '100%',
  fontSize: STATE_TYPE.compareValue,
  fontWeight: 900,
  // 🔴 COMPARE_LABEL 위 주석의 임계 실측을 그대로 따른다(종전 1.02는 임계 1.15 미만이었다).
  lineHeight: COMPARE_LINE_HEIGHT,
  letterSpacing: -1.4,
  fontVariantNumeric: 'tabular-nums',
  whiteSpace: 'nowrap',
  textAlign: 'left',
  justifySelf: 'start',
};
