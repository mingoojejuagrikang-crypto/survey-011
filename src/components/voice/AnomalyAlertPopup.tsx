import { T } from '../../tokens';
import { useFitScale } from './useFitScale';

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
  const fitRef = useFitScale<HTMLDivElement>([
    a.colName, a.prev, a.next, a.changeText, a.sampleKey, a.prevDate, a.status, a.kind,
  ]);
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
        padding: 'clamp(12px, 2.6vh, 24px) clamp(16px, 5vw, 30px)', borderRadius: 18,
        background: corrected ? 'rgba(18,34,22,0.96)' : 'rgba(34,18,18,0.96)',
        border: `2px solid ${accent}`,
        boxShadow: '0 10px 36px rgba(0,0,0,0.5)',
        display: 'flex', flexDirection: 'column', gap: 'clamp(4px, 0.8vh, 8px)', alignItems: 'center',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
        {/* 헤더 항목명 = 식별정보(P4) → --fit-lo. 줄바꿈 허용(잘림 금지). */}
        <span
          style={{
            fontSize: 'calc(clamp(16px, 2.4vh, 21px) * var(--fit-lo, 1))', fontWeight: 800, color: T.text,
            maxWidth: '100%', wordBreak: 'keep-all', overflowWrap: 'anywhere', textAlign: 'center', lineHeight: 1.25,
          }}
        >
          {a.colName}
        </span>
        {/* 알람 라벨 = 변화(P2, 현재값 다음 우선) → --fit-hi(완만 축소). */}
        <span style={{ fontSize: 'calc(clamp(16px, 2.3vh, 20px) * var(--fit-hi, 1))', fontWeight: 800, color: accent }}>
          {alarmLabel}
        </span>
      </div>
      {/* V2 — 어떤 샘플/행을 보는지. 샘플키 미상이면 '행 N' 폴백. 긴 키도 박스 안에서 줄바꿈.
          v0.18.0 1d — 원거리 가독: 샘플 식별 줄을 키우고 대비 보강(textDim→text). P4 → --fit-lo. */}
      <div
        style={{
          fontSize: 'calc(clamp(13px, min(4.4vw, 2.1vh), 17px) * var(--fit-lo, 1))',
          color: T.text, fontWeight: 700, textAlign: 'center',
          lineHeight: 1.4, maxWidth: '100%', wordBreak: 'break-all', overflowWrap: 'anywhere',
        }}
      >
        샘플: {a.sampleKey || `행 ${a.row}`}
      </div>
      {/* v0.22.0 입력탭#2(P2 잘림): 직전값→현재값 행. flexWrap + maxWidth로 긴 값이 가로로
          넘쳐 박스를 벗어나지 못하게 한다(필요시 줄바꿈). 자식 컬럼은 minWidth:0로 축소 허용. */}
      <div
        style={{
          display: 'flex', alignItems: 'flex-end', justifyContent: 'center', flexWrap: 'wrap',
          gap: 'clamp(8px, 1.4vh, 12px)',
          maxWidth: '100%',
          fontFamily: 'JetBrains Mono, ui-monospace, monospace',
        }}
      >
        {/* V2 — 직전 값을 그 회차 날짜로 라벨링(prevDate 있을 때만 날짜 표기). P4 → --fit-lo. */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, minWidth: 0, maxWidth: '100%' }}>
          <span
            style={{
              fontSize: 'calc(clamp(11px, 1.6vh, 13px) * var(--fit-lo, 1))', fontWeight: 700,
              color: T.textDim, letterSpacing: -0.2,
              fontFamily: 'system-ui, sans-serif',
            }}
          >
            직전{a.prevDate ? ` (${a.prevDate})` : ''}
          </span>
          {/* v0.18.0 1d — 직전값 대비 보강. P3(직전값) → --fit-lo(현재값보다 먼저 축소). */}
          <span
            style={{
              fontSize: 'calc(clamp(24px, min(8vw, 4.4vh), 36px) * var(--fit-lo, 1))', fontWeight: 800, color: T.textDim,
              maxWidth: '100%', overflowWrap: 'anywhere', wordBreak: 'break-word', textAlign: 'center', lineHeight: 1.05,
            }}
          >
            {a.prev}
          </span>
        </div>
        <span style={{ fontSize: 'calc(clamp(18px, 3.2vh, 26px) * var(--fit-lo, 1))', color: T.textDim, paddingBottom: 4 }}>→</span>
        {/* R3 — hero 현재값 위에 항목명 라벨(accent색)을 붙여 정수값도 어느 항목인지 즉시 식별.
            v0.22.0 입력탭#2(P2 잘림): 긴 항목명("과실 횡경 평균값" 등)이 ellipsis로 …잘리던 문제 →
            줄바꿈 허용(whiteSpace:normal + wordBreak:keep-all/overflowWrap:anywhere)으로 전부 표시. */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, minWidth: 0, maxWidth: '100%' }}>
          <span
            style={{
              fontSize: 'calc(clamp(11px, 1.6vh, 13px) * var(--fit-lo, 1))', fontWeight: 800,
              color: accent, letterSpacing: -0.2,
              fontFamily: 'system-ui, sans-serif', maxWidth: 'min(280px, 60vw)',
              whiteSpace: 'normal', wordBreak: 'keep-all', overflowWrap: 'anywhere',
              textAlign: 'center', lineHeight: 1.25,
            }}
          >
            {a.colName}
          </span>
          {/* 현재값 = P1(최우선 정보) → --fit-hi(가장 늦게·완만하게 축소). vh 상한 결합으로 짧은
              화면(가로모드 포함)에서도 CSS 단계에서 이미 비례 축소된다. 줄바꿈 허용(잘림 0). */}
          <span
            style={{
              fontSize: 'calc(clamp(32px, min(11vw, 7.4vh), 60px) * var(--fit-hi, 1))',
              fontWeight: 900, color: T.text, letterSpacing: -0.5,
              maxWidth: '100%', overflowWrap: 'anywhere', wordBreak: 'break-word',
              textAlign: 'center', lineHeight: 1.05,
            }}
          >
            {a.next}
          </span>
        </div>
      </div>
      {/* 안내문 = P5(최하위) → --fit-lo. */}
      <div style={{ fontSize: 'calc(clamp(12px, 1.8vh, 15px) * var(--fit-lo, 1))', color: corrected ? T.green : T.textDim, fontWeight: 600 }}>
        {corrected ? '✓ 정정되었습니다' : "'확인' 또는 새 값으로 정정"}
      </div>
    </div>
  );
}
