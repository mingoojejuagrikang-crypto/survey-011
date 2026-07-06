import { T } from '../../tokens';
import { useFitScale } from './useFitScale';

/** v0.28.0 — 이 카드 전용 확장 축소 단계(useFitScale 공용 FIT_STEPS 하위 참고). 다른 카드
 *  (PausedCard/ModifyIndicatorPill/VoiceHero)는 375/412/430 전부 기존 PASS라 그 카드들의
 *  useFitScale 호출은 그대로 둔다 — 이 확장 배열은 이상치 카드에만 전달된다. 모든 폰트/여백에
 *  절대 하한(`max(px, calc(... * var(--fit-lo)))`)을 같이 걸어, 이 배열이 아무리 낮은 단계까지
 *  가도 텍스트가 읽을 수 없는 크기로 무한 축소되지 않는다(2026-07-06 Sonar 재현 QA 수정). */
const ANOMALY_FIT_STEPS = [
  1, 0.94, 0.88, 0.82, 0.76, 0.7, 0.64, 0.58,
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
 *   미작동 시 최후 폴백일 뿐 정상 경로에선 스크롤이 생기지 않는다. ellipsis 잘림은 계속 금지. */
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
    /** v0.20.0 입력탭#6 — 어떤 규칙이 발동했는지(추세 방향 알람 vs 변동률 범위 알람). Mack이
     *  useVoiceSession.ts에서 채운다(Wave 2). 미제공이면 기존 표시(changeText+증가/감소)로 폴백. */
    kind?: 'trend' | 'range';
    /** v0.20.0 — range 알람일 때 임계 변동률(%). kind==='range'에서만 사용. */
    threshold?: number;
  };
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
      aria-live="assertive"
      style={{
        // v0.23.0 입력탭#1 — 중앙 흡수: 흡수영역(1fr, overflow:hidden) 가용 높이에 맞춘다.
        //   v0.27.0 — 무스크롤: 패딩·간격도 vh 비례. overflowY:auto는 훅 폴백으로만 잔존.
        width: '100%', maxWidth: 'min(620px, 96vw)',
        maxHeight: '100%', minHeight: 0, overflowY: 'auto',
        // v0.28.0 — 패딩·행간격도 --fit-lo에 연동(하한 有)해 극단 압축 시 여백까지 함께 줄어든다.
        // 이전엔 폰트만 줄고 여백은 vh 고정이라, 375×667처럼 진짜 여유가 없는 화면에서 텍스트를
        // 아무리 줄여도 고정 여백(패딩+행간격 합 약 50px)이 남아 무스크롤을 못 채웠다.
        padding: 'max(3px, calc(clamp(12px, 2.6vh, 24px) * var(--fit-lo, 1))) max(8px, calc(clamp(16px, 5vw, 30px) * var(--fit-lo, 1)))',
        borderRadius: 18,
        background: corrected ? 'rgba(18,34,22,0.96)' : 'rgba(34,18,18,0.96)',
        border: `2px solid ${accent}`,
        boxShadow: '0 10px 36px rgba(0,0,0,0.5)',
        display: 'flex', flexDirection: 'column',
        gap: 'max(1px, calc(clamp(4px, 0.8vh, 8px) * var(--fit-lo, 1)))', alignItems: 'center',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
        {/* 헤더 항목명 = 식별정보(P4) → --fit-lo. 줄바꿈 허용(잘림 금지). */}
        <span
          style={{
            // v0.28.0 — max(하한, ...)로 절대 최소 크기 보장(ANOMALY_FIT_STEPS가 더 낮은 단계까지
            // 가도 이 아래로는 안 줄어든다). 하한 값은 각 요소의 정보 우선순위(GL-005)에 맞춰
            // 낮을수록(P5에 가까울수록) 더 작게 잡았다.
            fontSize: 'max(10px, calc(clamp(16px, 2.4vh, 21px) * var(--fit-lo, 1)))', fontWeight: 800, color: T.text,
            maxWidth: '100%', wordBreak: 'keep-all', overflowWrap: 'anywhere', textAlign: 'center', lineHeight: 1.15,
          }}
        >
          {a.colName}
        </span>
        {/* 알람 라벨 = 변화(P2, 현재값 다음 우선) → --fit-hi(완만 축소). */}
        <span style={{ fontSize: 'max(12px, calc(clamp(16px, 2.3vh, 20px) * var(--fit-hi, 1)))', fontWeight: 800, color: accent, lineHeight: 1.15 }}>
          {alarmLabel}
        </span>
      </div>
      {/* V2 — 어떤 샘플/행을 보는지. 샘플키 미상이면 '행 N' 폴백. 긴 키도 박스 안에서 줄바꿈.
          v0.18.0 1d — 원거리 가독: 샘플 식별 줄을 키우고 대비 보강(textDim→text). P4 → --fit-lo. */}
      <div
        style={{
          fontSize: 'max(9px, calc(clamp(13px, min(4.4vw, 2.1vh), 17px) * var(--fit-lo, 1)))',
          color: T.text, fontWeight: 700, textAlign: 'center',
          lineHeight: 1.25, maxWidth: '100%', wordBreak: 'break-all', overflowWrap: 'anywhere',
        }}
      >
        샘플: {a.sampleKey || `행 ${a.row}`}
      </div>
      {/* v0.22.0 입력탭#2(P2 잘림): 직전값→현재값 행. flexWrap + maxWidth로 긴 값이 가로로
          넘쳐 박스를 벗어나지 못하게 한다(필요시 줄바꿈). 자식 컬럼은 minWidth:0로 축소 허용.
          v0.28.0 — gap도 --fit-lo에 연동(하한 有), 375×667 무스크롤 예산 확보. */}
      <div
        style={{
          display: 'flex', alignItems: 'flex-end', justifyContent: 'center', flexWrap: 'wrap',
          gap: 'max(4px, calc(clamp(8px, 1.4vh, 12px) * var(--fit-lo, 1)))',
          maxWidth: '100%',
          fontFamily: 'JetBrains Mono, ui-monospace, monospace',
        }}
      >
        {/* V2 — 직전 값을 그 회차 날짜로 라벨링(prevDate 있을 때만 날짜 표기). P4 → --fit-lo.
            v0.28.0 — 이 라벨("직전 (날짜)")은 실제 비교값(바로 아래 숫자, P3)의 부가 설명일 뿐
            그 자체가 핵심 정보는 아니다. 375급(≤700px)에서는 라벨을 숨기고 숫자만 남긴다 —
            "직전값 vs 현재값 비교"라는 카드의 핵심 목적은 숫자만으로 유지된다. */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, minWidth: 0, maxWidth: '100%' }}>
          <span
            className="aa-prev-label"
            style={{
              fontSize: 'max(9px, calc(clamp(11px, 1.6vh, 13px) * var(--fit-lo, 1)))', fontWeight: 700,
              color: T.textDim, letterSpacing: -0.2,
              fontFamily: 'system-ui, sans-serif',
            }}
          >
            직전{a.prevDate ? ` (${a.prevDate})` : ''}
          </span>
          {/* v0.18.0 1d — 직전값 대비 보강. P3(직전값) → --fit-lo(현재값보다 먼저 축소). */}
          <span
            style={{
              fontSize: 'max(15px, calc(clamp(24px, min(8vw, 4.4vh), 36px) * var(--fit-lo, 1)))', fontWeight: 800, color: T.textDim,
              maxWidth: '100%', overflowWrap: 'anywhere', wordBreak: 'break-word', textAlign: 'center', lineHeight: 1.0,
            }}
          >
            {a.prev}
          </span>
        </div>
        <span style={{ fontSize: 'max(12px, calc(clamp(18px, 3.2vh, 26px) * var(--fit-lo, 1)))', color: T.textDim, paddingBottom: 4 }}>→</span>
        {/* R3 — hero 현재값 위에 항목명 라벨(accent색)을 붙여 정수값도 어느 항목인지 즉시 식별.
            v0.22.0 입력탭#2(P2 잘림): 긴 항목명("과실 횡경 평균값" 등)이 ellipsis로 …잘리던 문제 →
            줄바꿈 허용(whiteSpace:normal + wordBreak:keep-all/overflowWrap:anywhere)으로 전부 표시.
            v0.28.0 — 이 라벨은 헤더 줄({a.colName}, 위쪽)의 **중복**이다(375급에서 폰트 하한을
            건 뒤에도 남는 잔여 초과분은 이 중복 줄 하나만큼의 여백에서 나온다). 매우 짧은
            화면(≤700px, class="aa-hero-dup-label")에서만 CSS로 숨긴다 — 정보 손실 없음(항목명은
            헤더에 이미 표시), 측정 기반 토글이 아니라 뷰포트 높이 고정 조건이라 되튐(oscillation)
            없음. 412/915·430/932(기존 PASS)는 이 media query 밖이라 그대로 보인다. */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, minWidth: 0, maxWidth: '100%' }}>
          <span
            className="aa-hero-dup-label"
            style={{
              fontSize: 'max(9px, calc(clamp(11px, 1.6vh, 13px) * var(--fit-lo, 1)))', fontWeight: 800,
              color: accent, letterSpacing: -0.2,
              fontFamily: 'system-ui, sans-serif', maxWidth: 'min(280px, 60vw)',
              whiteSpace: 'normal', wordBreak: 'keep-all', overflowWrap: 'anywhere',
              textAlign: 'center', lineHeight: 1.25,
            }}
          >
            {a.colName}
          </span>
          {/* 현재값 = P1(최우선 정보) → --fit-hi(가장 늦게·완만하게 축소). vh 상한 결합으로 짧은
              화면(가로모드 포함)에서도 CSS 단계에서 이미 비례 축소된다. 줄바꿈 허용(잘림 0).
              v0.28.0 — 하한 26px: v027-voice-cards-fit.spec.ts의 기존 GL-005 가독 하한(hero
              폰트 ≥26px, 402×874/375×812에서 이미 단언됨)과 동일 기준을 375×667에도 그대로
              적용 — "현재값은 항상 크게 유지"(민구 원칙)를 이 카드의 다른 어떤 요소보다 높은
              floor로 못박는다. */}
          <span
            style={{
              fontSize: 'max(26px, calc(clamp(32px, min(11vw, 7.4vh), 60px) * var(--fit-hi, 1)))',
              fontWeight: 900, color: T.text, letterSpacing: -0.5,
              maxWidth: '100%', overflowWrap: 'anywhere', wordBreak: 'break-word',
              textAlign: 'center', lineHeight: 1.0,
            }}
          >
            {a.next}
          </span>
        </div>
      </div>
      {/* 안내문 = P5(최하위) → --fit-lo. */}
      <div style={{ fontSize: 'max(8px, calc(clamp(12px, 1.8vh, 15px) * var(--fit-lo, 1)))', color: corrected ? T.green : T.textDim, fontWeight: 600, lineHeight: 1.15 }}>
        {corrected ? '✓ 정정되었습니다' : "'확인' 또는 새 값으로 정정"}
      </div>
    </div>
  );
}
