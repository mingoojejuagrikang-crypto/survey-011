import { T } from '../../tokens';
import { VOICE_TYPE } from './heroLayout';

/** 말끊기 토글 — `ActiveControlSteppers.tsx`에서 분리해 나왔다(2026-08-14, 리팩토링 R1 P1-1 ②).
 *
 *  🔴 **왜 갈랐나:** 프리미티브 분리(`StepperControl.tsx`) 후에도 본 파일이 413줄 — 08-07
 *  `VoiceHero.tsx`가 한 회차에 431→515줄로 자라 배포가 막힌 전례가 있어, 표시 전용이고
 *  본 파일 로컬 심볼 의존이 없는 이 컴포넌트까지 내려 안전권(~350줄)에 착지시켰다.
 *
 *  🔴🔴 **이 파일을 `src/components/voice/` 밖으로 옮기지 마라.**
 *  `tests/v043-typo-contract.spec.ts`가 그 디렉터리를 **재귀 순회**해 `.tsx`의 타이포 계약
 *  참조 **총 개수**를 단언한다. 밖으로 나가면 아래 `VOICE_TYPE` 참조 4건(captionXs·
 *  stepperValue·captionXxs·stepperValueLg)이 계수에서 빠져 red가 된다.
 *
 *  ⚠️ 이 주석 블록에 `font` + `Size` 붙여쓴 낱말을 넣지 마라. 그 검사기는 줄 선두가 `*`면
 *  **comment로 집계**하는데 그 개수 역시 단언 대상이라, 설명을 적는 것만으로 red가 된다. */

/** v0.44.0 §D1 — 세 번째 서랍 항목: 말끊기 ON/OFF(기본 ON). 두 스텝퍼 아래 전폭 1행
 *  (375 폭에서 3항목 가로 배치는 48px 터치 타깃이 안 나온다). 행 전체가 하나의 토글 버튼 —
 *  터치 타깃 = 행 전체(minHeight 56 ≥ 48). 시각 관례는 StepperControl을 따른다(테두리·배경·
 *  라벨/값/설명 3단 타이포). ON=현행 이어폰 barge-in(안내 중 말하면 즉시 끊고 인식),
 *  OFF=half-duplex(안내 중 인식 중지 — 스피커폰 에코 오인식 방지). */
export function BargeInToggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      data-testid="toggle-barge-in"
      role="switch"
      aria-checked={on}
      aria-label={on ? '말끊기 끄기' : '말끊기 켜기'}
      title={on ? '말끊기 끄기' : '말끊기 켜기'}
      onClick={onToggle}
      style={{
        gridColumn: '1 / -1',
        minHeight: 56,
        borderRadius: 16,
        border: `1px solid ${T.lineStrong}`,
        background: 'rgba(255,255,255,0.035)',
        padding: 8,
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) 48px',
        alignItems: 'center',
        gap: 8,
        cursor: 'pointer',
        touchAction: 'manipulation',
      }}
    >
      <span style={{ minWidth: 0, textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontSize: VOICE_TYPE.captionXs, color: T.textMute, fontWeight: 800, lineHeight: 1 }}>말끊기</span>
        <span style={{ fontSize: VOICE_TYPE.stepperValue, color: on ? T.green : T.textMute, fontWeight: 950, lineHeight: 1.15 }}>
          {on ? '켬' : '끔'}
        </span>
        <span style={{ fontSize: VOICE_TYPE.captionXxs, color: T.textMute, fontWeight: 650, lineHeight: 1.2, whiteSpace: 'nowrap' }}>
          {on ? '안내 중 말하면 즉시 인식' : '안내 중에는 인식 중지'}
        </span>
      </span>
      {/* 상태 심볼 — 스텝퍼의 48px 우측 버튼 자리와 정렬(시각 관례 유지). aria는 버튼 본체가 진다. */}
      <span
        aria-hidden
        style={{
          width: 48,
          height: 48,
          borderRadius: 14,
          border: `1px solid ${on ? T.green : T.lineStrong}`,
          background: on ? T.greenGlowFaint : 'rgba(255,255,255,0.025)',
          color: on ? T.green : T.textMute,
          fontSize: VOICE_TYPE.stepperValueLg,
          fontWeight: 950,
          lineHeight: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {on ? '✓' : '✕'}
      </span>
    </button>
  );
}
