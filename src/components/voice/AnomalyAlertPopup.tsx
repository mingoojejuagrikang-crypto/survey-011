import { T } from '../../tokens';
import { useFitScale } from './useFitScale';
import { HERO_TYPE } from './heroLayout';

/** v0.28.0 — 이 카드 전용 확장 축소 단계(useFitScale 공용 FIT_STEPS 하위 참고). 다른 카드
 *  (PausedCard/ModifyIndicatorPill/VoiceHero)는 375/412/430 전부 기존 PASS라 그 카드들의
 *  useFitScale 호출은 그대로 둔다 — 이 확장 배열은 이상치 카드에만 전달된다. 모든 폰트/여백에
 *  절대 하한(`max(px, calc(... * var(--fit-lo)))`)을 같이 걸어, 이 배열이 아무리 낮은 단계까지
 *  가도 텍스트가 읽을 수 없는 크기로 무한 축소되지 않는다(2026-07-06 Sonar 재현 QA 수정). */
const ANOMALY_FIT_STEPS = [
  1.12, 1.06, 1, 0.94, 0.88, 0.82, 0.76, 0.7, 0.64, 0.58,
  // v0.28.0 — 0.58 밑은 더 촘촘한 간격(0.03)으로: useFitScale의 fits() 판정에 +1px 허용오차가
  // 있어(부동소수 rAF 스래싱 방지용, 공용 로직 불변), 성긴 간격에서는 "거의 맞지만 1px 초과"
  // 단계에서 조기 정지해버릴 수 있다(375×667 실측에서 관측). 더 촘촘한 단계로 그 확률을 줄인다.
  0.55, 0.52, 0.49, 0.46, 0.43, 0.4, 0.37, 0.34, 0.31, 0.28, 0.25, 0.22, 0.19, 0.16, 0.13,
] as const;

/** v0.9.0 이상치 알람 팝업 — 발화만으론 스쳐 지나가 확인이 어렵다는 요청. 이전값→현재값과 변화량
 *  (절대차 또는 %)을 상단에 띄우고, '확인'/'유지'/새 값 입력 또는 다음 필드 진입 시 해제(store에서).
 *  v0.10.0 A2: 화면 수직 중앙 + 1.3× 확대(화면 안 가드: min(560px,94vw)/88vh/overflowY).
 *  v0.12.0 AREA2:
 *   - V2: 어떤 샘플·행을 보는지(`샘플: <키>` 또는 `행 N` 폴백)와, 직전 값이 어느 조사 회차의
 *     것인지(`직전 (YYYY-MM-DD)` ISO 날짜 라벨 — prevDate 있을 때만)를 표시. 샘플키가 길어도
 *     박스를 넘지 않게 word-break.
 *   - V3: 색을 RED로 통일(증가=amber 분기 제거). 방향은 '증가/감소' 텍스트로만 전달.
 *  v0.13.0:
 *   - R3(민구 요청): hero 현재값(가장 큰 숫자) 바로 위에 측정 항목명을 라벨로 붙인다. 정수값(예 120)이
 *     화면 최대 요소일 때 상단 헤더와 시선이 떨어져 '어느 항목 값인가'가 즉시 안 보이던 문제 해소.
 *     직전값/현재값을 '라벨 + 값' 2단 대칭 구조로 만든다.
 *   - R2(민구 요청): status='corrected'면 톤을 GREEN으로 바꾸고 헤더를 '정상 복귀'로, 현재값을 정정값
 *     으로 즉시 반영한다(정정 재측정이 정상으로 판명된 경우). 빨강(이상치)↔초록(정정완료) 구분.
 *  v0.23.0 입력탭#1(중앙 흡수, Vance): 기존 position:fixed; inset:0 오버레이를 **제거**하고, 카드만
 *   반환한다. ActiveState의 중앙 흡수영역(grid row3, 1fr, overflow:hidden)이 직접 자식으로 렌더해
 *   중앙 정렬한다.
 *  v0.27.0 입력탭(무스크롤·반응형, Vance — 민구 07-03 결정): 사용자는 양손 측정 중이라 카드 내부
 *   스크롤이 불가능하다. ① 고정 px 폰트·간격을 전부 clamp(min, vh/vw, max)로 뷰포트 비례화(기기
 *   크기·iOS 텍스트 확대에 자동 대응), ② useFitScale이 흡수영역 높이를 실측해 넘칠 때만 --fit-lo
 *   (하위 우선순위: 직전값·식별정보·안내문)를 먼저·더 크게, --fit-hi(상위: 현재값·알람 라벨)를
 *   완만하게 줄여 **스크롤 잔여 0**(scrollHeight ≤ clientHeight)을 보장한다. overflowY:auto는 훅
 *   미작동 시 최후 폴백일 뿐 정상 경로에선 스크롤이 생기지 않는다. ellipsis 잘림은 계속 금지.
 *  v0.34.0 A6(실기기 피드백): 직전값을 현재값과 같은 급 폰트로 승격해 [직전값]→[현재값]을 같은
 *   행(grid, baseline)으로, 값 위에 소형 라벨('직전'/'현재'), 직전 조사일은 직전값 아래 소형 줄.
 *   직전값은 --fit-hi를 따르되 절대 하한을 22px(현재값 26px보다 한 단계 낮게)로 둬 fit 예산 확보. */
export function AnomalyAlertPopup({
  a, onConfirm, onModify,
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
    /** v0.20.0 입력탭#6 — 어떤 규칙이 발동했는지(추세 방향 알람 vs 변동률 범위 알람). Mack이
     *  useVoiceSession.ts에서 채운다(Wave 2). 미제공이면 기존 표시(changeText+증가/감소)로 폴백. */
    kind?: 'trend' | 'range';
    /** v0.20.0 — range 알람일 때 임계 변동률(%). kind==='range'에서만 사용. */
    threshold?: number;
    /** v0.33.0 항목7 — true면 응답 대기(trendConfirm) 알람: [확인][수정] 터치 버튼을 그린다.
     *  false/미지정 = 정보성 팝업(수동 입력 커밋 이상치 — 버튼·확인 루프 없음, 민구 확정). */
    awaitingResponse?: boolean;
    /** v0.34.0 A1 — 수동입력 이상치 **보류** 팝업(터치 [확인]/[수정] 대기). v0.34.0 리뷰·민구 결정
     *  2026-07-14: 이 상태는 **터치 전용**이라 handleFinal이 STT를 전부 무시하므로, '말로도 가능'
     *  힌트를 띄우지 않는다(거짓 어포던스 제거). */
    manualHold?: boolean;
  };
  /** v0.33.0 항목7(07-10 QA P1 #2) — 음성 '확인'/'수정'과 동일 동작의 터치 콜백(useVoiceSession의
   *  confirmAnomalyTouch/modifyAnomalyTouch). awaitingResponse && !corrected일 때만 렌더된다. */
  onConfirm?: () => void;
  onModify?: () => void;
}) {
  const up = a.direction === 'up';
  const corrected = a.status === 'corrected';
  // v0.20.0 입력탭#6 — 표시 문구 단축(목적+값만, "~합니다/하세요" 제거).
  //   추세 알람: "추세 알람 증가|감소 NN"(NN=변화량, changeText에서 숫자만) · 범위 알람(v0.24.0): "범위 알람
  //   +|-NN%"(NN=실제 편차%, 증가=+/감소=−). Mack이 a.kind를 채우기 전엔 폴백(추세 형태)로 동작한다.
  const changeNum = a.changeText ? a.changeText.replace(/[^0-9.]/g, '') : '';
  // 폴백 기본은 **추세 알람 형태**: 이 팝업의 역사적 정체성이 '추세 알림'이고 추세가 지배적 케이스라,
  //   Mack이 a.kind를 채우기 전에도 흔한 경우의 DISPLAY 스펙("추세 알람 감소 NN")이 라이브로 동작한다.
  //   소수 케이스(범위 알람)는 Mack이 같은 릴리스 Wave 2에서 a.kind==='range'로 교정한다.
  // v0.24.0 입력탭 — 범위 알람은 **설정 임계값이 아니라 실제로 벗어난 편차%를 부호와 함께** 보여준다
  //   (민구 요청: "+##%" / "-##%"). changeNum=changeText의 실제 변동%(소수1자리) → 헤드라인은 정수 반올림.
  //   증가=+, 감소=−. changeNum이 비면(드뭄) 설정 임계값으로 폴백.
  const rangePct = changeNum ? Math.round(Number(changeNum)) : a.threshold;
  const alarmLabel = corrected
    ? '정상'
    : a.kind === 'range'
    ? `범위 알람 ${up ? '+' : '-'}${rangePct}%`
    : // a.kind==='trend' 또는 미제공(폴백) — 둘 다 추세 형태로 표시.
      `추세 알람 ${up ? '증가' : '감소'}${changeNum ? ` ${changeNum}` : ''}`;
  // R2 — corrected(정정 후 정상)면 GREEN, 그 외(이상치 대기)는 RED 통일(V3).
  const accent = corrected ? T.green : T.red;
  const previousLabel = a.prevDate ? `직전(${a.prevDate})` : '직전';
  // v0.27.0 — 무스크롤 가드: 콘텐츠가 흡수영역 높이를 넘으면 폰트를 실측 기반으로 줄인다.
  // v0.28.0 — 이상치 카드는 콘텐츠가 더 많아 확장 단계(ANOMALY_FIT_STEPS)를 전달한다. --fit-hi
  // 계산식(hiWeight)은 기본값 그대로 둔다 — 현재값(P1)은 기존 GL-005 가독 하한(≥26px,
  // v027-voice-cards-fit.spec.ts 기존 단언)을 이 카드에서도 지킨다. 375×667 예산은 하위
  // 우선순위 요소(P4/P5) 하한을 더 내려 확보한다(아래 각 요소 주석).
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
        // v0.38.0 #3·#8 — 카드 chrome 없이 중앙 흡수영역 자체를 상태판으로 사용한다.
        width: '100%', maxWidth: 'min(720px, 96vw)',
        height: '100%', maxHeight: '100%', minHeight: 0, overflowY: 'auto',
        padding: 'max(2px, calc(clamp(4px, 1vh, 10px) * var(--fit-lo, 1))) 0',
        display: 'flex', flexDirection: 'column',
        justifyContent: 'center', alignItems: 'center',
        gap: 'max(3px, calc(clamp(6px, 1.2vh, 14px) * var(--fit-lo, 1)))',
        textAlign: 'center',
      }}
    >
      <span style={{
        maxWidth: '100%', color: accent,
        fontSize: 'max(18px, calc(clamp(24px, min(8vw, 4.8vh), 42px) * var(--fit-lo, 1)))',
        fontWeight: 900, lineHeight: 1.08,
        wordBreak: 'keep-all', overflowWrap: 'anywhere',
      }}>
        {alarmLabel}
      </span>
      <span className="anomaly-field-name" style={{
        maxWidth: '100%', color: T.textDim,
        fontSize: HERO_TYPE.name, fontWeight: 900, lineHeight: 1.04,
        letterSpacing: -0.6, wordBreak: 'keep-all', overflowWrap: 'anywhere',
      }}>
        {a.colName}
      </span>
      <span style={{
        maxWidth: '100%', color: T.text,
        fontSize: HERO_TYPE.value, fontWeight: 900, lineHeight: 1,
        letterSpacing: -2, fontVariantNumeric: 'tabular-nums',
        wordBreak: 'keep-all', overflowWrap: 'anywhere',
      }}>
        {a.next}
      </span>
      <div
        data-testid="anomaly-comparison"
        style={{
          maxWidth: '100%', color: T.textDim,
          fontSize: 'max(14px, calc(clamp(18px, min(5.3vw, 3.2vh), 28px) * var(--fit-lo, 1)))',
          fontWeight: 850, lineHeight: 1.1, letterSpacing: -0.5,
          whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums',
        }}
      >
        {previousLabel} {a.prev} →
      </div>
      {/* 응답 대기 알람의 실제 터치 액션은 유지한다. 음성 명령 기능도 그대로이며 안내문만 제거한다. */}
      {!corrected && a.awaitingResponse && onConfirm && onModify && (
        <div
          style={{
            width: 'min(480px, 100%)',
            display: 'grid', gridTemplateColumns: '1fr 1fr',
            gap: 'max(6px, calc(clamp(8px, 1.4vh, 12px) * var(--fit-lo, 1)))',
          }}
        >
            <button
              type="button"
              data-testid="anomaly-confirm-btn"
              onClick={onConfirm}
              style={{
                minHeight: 48, borderRadius: 14,
                border: '1px solid rgba(255,255,255,0.25)',
                background: 'rgba(255,255,255,0.10)',
                color: T.text, fontSize: 18, fontWeight: 900, letterSpacing: -0.3,
                cursor: 'pointer', touchAction: 'manipulation',
              }}
            >
              확인
            </button>
            <button
              type="button"
              data-testid="anomaly-modify-btn"
              onClick={onModify}
              style={{
                minHeight: 48, borderRadius: 14,
                border: `2px solid ${accent}`,
                background: 'rgba(255,82,82,0.12)',
                color: T.text, fontSize: 18, fontWeight: 900, letterSpacing: -0.3,
                cursor: 'pointer', touchAction: 'manipulation',
              }}
            >
              수정
            </button>
        </div>
      )}
    </div>
  );
}
