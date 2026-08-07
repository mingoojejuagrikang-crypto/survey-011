import { useRef } from 'react';
import { T } from '../../tokens';
import { useSessionStore } from '../../stores/sessionStore';
import { useFitGroup } from './useFitGroup';
import { STATE_TYPE, STATE_ALARM_INTERIM_BASE_PX } from './heroLayout';

/** 알람 중 미확정 인식값 스트립 — `VoiceHero.tsx`에서 분리해 나왔다(2026-08-07).
 *
 *  🔴 **왜 갈랐나:** 08-07 위임 4레인이 `VoiceHero.tsx`를 431 → 515줄로 키워
 *  `max-lines` 500 상한을 넘겼고 `check:release`의 lint가 배포를 막았다.
 *  `eslint.config.js`의 관행은 *"기존 초과 파일만 disable + [ENV-12] 예외"* 이므로
 *  **오늘 새로 넘긴 파일에 disable을 붙이는 것은 규칙 취지 위반**이다 → 분리를 골랐다.
 *  이 컴포넌트는 `VoiceHero.tsx`의 어떤 로컬 심볼에도 의존하지 않아 가장 깨끗한 절단면이었다.
 *
 *  🔴🔴 **이 파일을 `src/components/voice/` 밖으로 옮기지 마라.**
 *  `tests/v043-typo-contract.spec.ts`가 그 디렉터리를 **재귀 순회**해 `.tsx`의 타이포 계약
 *  참조 **총 개수**를 단언한다. 같은 디렉터리 안이면 개수가 보존되지만 밖으로 나가면
 *  계약 2건이 사라져 red가 된다 — 아래 두 곳의 `STATE_TYPE.alarmInterim` 참조가 그 2건이다.
 *
 *  ⚠️ 이 주석 블록에 `font` + `Size` 붙여쓴 낱말을 넣지 마라. 그 검사기는 줄 선두가 `*`면
 *  **comment로 집계**하는데 그 개수 역시 단언 대상이라, 설명을 적는 것만으로 red가 된다. */

/** v0.37.0 FB-F(민구) — 이상치/범위 알람 카드 **아래**, 파형 **위**에 뜨는 미확정 인식값 좁은 스트립.
 *  알람 응답 대기 중(값 정정 발화) 사용자가 "지금 이렇게 들렸다"를 카드를 가리지 않고 확인한다.
 *
 *  ⚠️ §10 시각·청각 일치 — 여기 표시값은 **오직 실제 인식 원문**(store `interimValue`, handleInterim의
 *  STT 원문 trim)만 쓴다. `lastTts`나 항목명으로 추정하지 않는다(그건 들은 문장과 어긋날 수 있다).
 *  interim이 없으면 null(알람 카드만). ActiveState를 매 interim마다 리렌더하지 않도록 이 컴포넌트가
 *  interimValue를 **자체 구독**한다(칩·컨트롤 리렌더 회피). */
export function AlarmInterimStrip() {
  const interim = useSessionStore((st) => st.interimValue);
  // 🔴 v0.46.0 WP-B — 스트립에 **자기 fit 그룹**을 준다(민구 확정 08-05, 안 (a)).
  //  종전엔 `STATE_TYPE.alarmInterim`이 `var(--fit-hi)`를 곱했는데 **그 배율이 여기 도달하지
  //  않았다**: `--fit-hi`를 심는 것은 `AnomalyAlertPopup`의 `useFitScale`이고 이 스트립은 그
  //  **형제**(CenterStage 알람 div의 두 번째 행)라 상속 경로가 없다 — 늘 fallback 1이었다.
  //  게다가 `--fit-hi`는 축소 전용이라 1을 넘지도 않는다. 즉 **위로 여는 경로가 없었다.**
  //
  //  🔴🔴 **v0.46.0 콜드 리뷰 L3-1(critical) — 아래 「높이는 판정에 안 걸린다」 계약은 반증됐다.**
  //  종전 주석은 *"컨테이너를 스트립 자신(`height:auto`)으로 두므로 높이는 판정에 안 걸리고,
  //  `nowrap`+`ellipsis`인 폭이 배율을 정한다 — 이 슬롯에서 의도한 계약 그대로다"* 였다.
  //  **그것이 이 결함의 원인이었다.** 폭만 묶으면 **1~2글자에서는 아무것도 묶이지 않는다** →
  //  이진탐색이 상한까지 열려 실측 402×874에서 폰트 304.8px · 스트립 348px(스테이지 전량) ·
  //  **알람 카드 높이 0 · 터치 도달 실패**. A/B로 v0.46.0 신규 회귀 확정(종전 공식은 76.38px·카드 256px).
  //  🔑 **자기 자신을 컨테이너로 쓰는 fit은 부모가 「내용만큼」 배분할 때 순환한다** —
  //  카드가 눌린 만큼 스트립 배정이 늘어나기 때문이다.
  //  👉 처방은 **부모(`CenterStage`)가 flex column으로 배분하고 이 박스가 `maxHeight:'50%'`로
  //  묶이는 것**이다. 그러면 높이가 판정에 **들어와** 카드가 절반을 항상 확보한다.
  //  🔴 **정확히 적는다(08-07 R1 리뷰 반증):** 이 처방은 *"fit이 스스로 줄어든다"* 가 **아니다.**
  //  실측하면 스트립은 **1글자에서도 상한 50%에 딱 붙는다**(402×874에서 폰트 150.3px).
  //  즉 순환은 끊겼지만 **글자는 여전히 배정량을 꽉 채운다** — 막은 것은 「카드를 먹는 것」이고
  //  「크게 쓰는 것」은 그대로다(민구 F4·F6 *"너무 작게"* 요구와 같은 방향).
  //  ⏭ 짧은 값에서 스트립을 더 줄여 카드를 넓힐지는 **미결**(R1-2 · 다음 회차 판단).
  //  ⚠️ **`height:'auto'`로 되돌리지 마라** — 그 한 줄이 순환을 되살린다.
  //  ⚠️ 종전 시도였던 grid 트랙 `minmax(0, 50%)`는 **폐기됐다** — 내용과 무관하게 절반을
  //  예약해 빈 슬롯에서도 카드를 절반으로 눌렀다(`CenterStage` §근거에 실패 기록이 있다).
  //  게이트: `tests/v0460-cr-alarm-card-floor.spec.ts`
  const valueFitRef = useRef<HTMLSpanElement>(null);
  const fitRef = useFitGroup<HTMLDivElement>(
    [interim],
    [{
      variable: '--fit-alarm-interim',
      members: [valueFitRef],
      searchBasePx: STATE_ALARM_INTERIM_BASE_PX,
    }],
  );
  return (
    <div
      ref={fitRef}
      data-testid={interim ? 'interim-value' : undefined}
      aria-label={interim ? `인식 중: ${interim}` : undefined}
      aria-hidden={interim ? undefined : true}
      style={{
        flexShrink: 0,
        // 🔴 L3-1 처방 — **인식값이 있을 때만** 부모가 clamp한 트랙(`minmax(0, 50%)`)을 채운다.
        //    채워야 fit의 높이 판정이 유한한 제한을 보고 순환이 끊긴다(위 §주석이 계약의 SSOT).
        //    ⚠️ **무조건 `100%`로 두면 회귀다** — 08-06 실측: 인식값이 없을 때도 스트립이 트랙
        //    절반을 차지해 **알람 카드가 항상 절반으로 줄었다**(375×667에서 248.7 → 124.3px).
        //    알람 중 대부분의 시간은 인식값이 없는 상태이므로 그때는 `auto`로 돌려 카드가
        //    스테이지를 거의 다 쓰게 한다. `minHeight` clamp 하한이 빈 슬롯의 자리를 지킨다.
        //    🔴 그리고 **빈 슬롯은 `maxHeight`로 눌러야 한다.** `visibility:hidden`은 레이아웃
        //    박스를 남기고, 인식값이 사라져도 **fit 배율은 유지되므로** 빈 span이 여전히 큰
        //    line box를 갖는다(08-06 실측: 인식값 없이도 트랙 124.3px = 스테이지 절반).
        //    ⚠️ `display:'none'`으로 없애지 마라 — 빈 슬롯 유지가 계약이다
        //    (`v0460-fit-headroom:147`: *"빈 슬롯이 red로 둔갑한다"*).
        //    🔑 **flex item의 `maxHeight:'50%'`는 부모 높이 기준**이라 순환이 없다(그리드 트랙은
        //    자식 max-content를 봐서 안 통했다 — `CenterStage` §근거).
        width: '100%', height: interim ? '100%' : 'auto',
        minHeight: 'clamp(46px, 6.5vh, 68px)',
        maxHeight: interim ? '50%' : 'clamp(46px, 6.5vh, 68px)',
        overflow: 'hidden',
        padding: '2px 8px',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        minWidth: 0,
        // 🔴 `fontSize`를 **바깥에도 유지한다.** 실렌더 텍스트는 안쪽 member span에 있지만,
        //    `data-testid="interim-value"` 계약을 갖는 것은 이 div이고 기존 계측·오라클이
        //    이 요소의 `getComputedStyle().fontSize`를 읽는다(`fontRenderProbe` 계열).
        //    안쪽으로만 옮겼더니 이 div가 상속 기본값 **16px**로 읽혀 하한 오라클이
        //    "16px인데 여유가 있다"는 가짜 red를 냈다(08-05 실측). 두 곳이 같은 상수를 쓰므로
        //    값은 언제나 일치한다.
        fontSize: STATE_TYPE.alarmInterim,
        visibility: interim ? 'visible' : 'hidden',
      }}
    >
      <span
        ref={valueFitRef}
        data-fit-group="alarm-interim"
        style={{
          color: T.text,
          // 🔴 인라인 하드코딩 금지([TYPO-CONTRACT-1]) — heroLayout의 상수 계층을 소비한다.
          //    종전 인라인 값이 실기기에서 32.16px로 렌더돼 fb-27-7("너무 작음")의 근인이었다.
          fontSize: STATE_TYPE.alarmInterim,
          fontWeight: 900,
          // 🔴 v0.46.0 L3-1 처방 — **빈 슬롯에서는 line box를 0으로 접는다.**
          //    `visibility:hidden`은 박스를 남기고 **인식값이 사라져도 fit 배율은 유지되므로**,
          //    빈 span이 그 배율만큼의 line box를 갖는다. 그리드 트랙은 자식의 **max-content**로
          //    크기가 정해지므로(부모의 `maxHeight`로는 안 줄어든다) 트랙이 상한 50%에 계속 걸려
          //    **알람 카드가 항상 절반으로 눌렸다**(08-06 실측 375×667: 카드 124.3px).
          //    ⚠️ 부모의 `maxHeight`만으로 고치려 했다가 실패했다 — 줄여야 하는 것은 **내용**이다.
          lineHeight: interim ? 1.15 : 0,
          letterSpacing: -0.8,
          textAlign: 'center',
          // 🔴 `maxWidth`가 아니라 `width: 100%`다 — `maxWidth`만 두면 박스가 잉크에 딱 붙는
          //    shrink-to-fit이 되어 **넘침 경계가 잉크와 함께 움직여** 이진탐색이 상한을 못
          //    찾는다(`AnomalyAlertPopup.tsx:191-194`가 같은 이유로 같은 처방을 쓴다).
          display: 'block', width: '100%',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {interim}
      </span>
    </div>
  );
}
