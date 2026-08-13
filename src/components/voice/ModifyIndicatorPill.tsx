import { useRef } from 'react';
import { T } from '../../tokens';
import { useSessionStore } from '../../stores/sessionStore';
import { ABSORB_CLAMP, HERO_BASE_FONT_PX, HERO_TYPE } from './heroLayout';
import { useFitGroup } from './useFitGroup';
import { ReaskCue, type ReaskReason } from './ReaskCue';

/** v0.12.0 AREA2 V4 — 수정 재안내 중 어떤 항목을 다시 말해야 하는지 알리는 안내.
 *  v0.14.0 E(민구 요청) — 모든 알람/안내를 화면 중앙·최대 크기로 통일. 기존 상단 작은 pill을
 *  이상치 팝업과 같은 중앙 대형 카드로 교체(톤은 BLUE로 구분 — 수정은 오류가 아니라 재입력 안내).
 *  v0.23.0 입력탭#1(중앙 흡수, Vance): 기존 position:fixed; inset:0 오버레이를 제거하고 카드만
 *   반환한다. ActiveState 중앙 흡수영역(grid row3, 1fr, overflow:hidden)이 자식으로 직접 렌더·중앙
 *   정렬한다. 컴포넌트명은 호환 위해 ...Pill 유지하나 실 렌더는 대형 카드다.
 *  v0.27.0 무스크롤·반응형(민구 07-03): 양손 측정 중이라 스크롤 불가 → 고정 px를 vh/vw clamp로
 *   비례화해 중앙 흡수영역 안에서 렌더한다.
 *  v0.42.0 제보 #7 — 카드 chrome 제거(민구 결정 2026-07-29). animation은 box-shadow를
 *   애니메이션하므로 함께 제거.
 *  v0.43.0 UI-c — 수정 중 항목명·지시문은 활성 칩과 상태 문양이 이미 말하므로 시각 삭제한다.
 *   그 공간은 interim/새 값이 열린 fit으로 회수하고, 항목명·듣는 중·인식 중은 aria-label에 남긴다. */
export function ModifyIndicatorPill({ name, prevValue, newValue, reaskReason = null }: { name: string; prevValue?: string; newValue?: string; reaskReason?: ReaskReason }) {
  // 정정 구간 두 국면을 한 surface로 표현한다(hero와 z-fight 없음).
  // ① 재프롬프트: 중앙은 비우고 활성 칩 + aria 상태만 남긴다. interim이 오면 값을 크게 표시한다.
  // ② 새 값 도착(echo): 새 값을 가장 크게 두고 직전값은 작은 보조 정보로 남긴다.
  const committed = !!newValue && newValue !== prevValue;
  const interim = useSessionStore((s) => s.interimValue);
  const decimalWhole = useSessionStore((s) => s.reaskDecimalWhole);
  // v0.47.0 W2(FB-C, 민구 08-08) — 성공 국면은 green이다(종전 amber). 재청취(비-committed)는
  //   §C4 amber 톤이 화면 전체(글로우·칩)를 이미 말하므로 여기선 blue(재입력 안내) 유지.
  const accent = committed ? T.green : T.blue;
  const visibleValue = committed ? newValue : interim;
  const valueFitRef = useRef<HTMLSpanElement>(null);
  const fitRef = useFitGroup<HTMLDivElement>(
    // 🔴 v0.49 r3 #5 — `reaskReason`이 deps에 있어야 한다. 아래 `ReaskCue`가 이 컨테이너의
    //   **flex 자식**으로 붙었다 다시 빠지므로 내용 높이가 바뀌는데, deps에 없으면 재측정이
    //   돌지 않는다. 형제 표면(`VoiceHero`)은 이미 그것을 fit 축으로 취급한다(:90) — 한쪽만
    //   빠지면 같은 큐가 표면에 따라 다르게 잘린다.
    //   실측(375×812, 이 픽스처): 넘침 0 · 큐는 카드 안(잘림 없음)이라 **현재는 재현되지 않는다.**
    //   그래도 넣는다 — 부모가 `overflow:'hidden'`이고 컨테이너에 `ABSORB_CLAMP`가 걸려 있어,
    //   항목명이 길거나 화면이 더 좁으면 낡은 fit이 정확히 그 큐를 자른다.
    //   🔴 v0.49 r5 Z9(claude #13) — `reaskDecimalWhole`도 같은 축이다. 정수부가 실리면
    //     `ReaskCue` 문구가 훨씬 길어지는데 `reaskReason`은 그 전환에서 값이 안 바뀐다.
    [name, prevValue, newValue, interim, committed, reaskReason, decimalWhole],
    [{
      variable: '--fit-value',
      members: [valueFitRef],
      searchBasePx: committed ? HERO_BASE_FONT_PX.value : HERO_BASE_FONT_PX.interim,
    }],
  );
  return (
    <div
      ref={fitRef}
      data-testid="modify-indicator"
      role="status"
      aria-live="polite"
      aria-label={committed
        ? `${name} 수정됨, 새 값 ${newValue}${prevValue ? `, 직전 입력 ${prevValue}` : ''}`
        : `${name} 수정, ${interim ? `인식 중: ${interim}` : '듣는 중'}`}
      style={{
        // v0.23.0 — 중앙 흡수영역 가용 높이에 맞춤(부모 overflow:hidden 클립 방지).
        maxWidth: 'min(560px, 94vw)', width: '100%', height: '100%', ...ABSORB_CLAMP,
        padding: 'clamp(12px, 2.4vh, 20px) clamp(16px, 4.6vw, 28px)',
        background: 'transparent',
        display: 'flex', flexDirection: 'column', justifyContent: 'center',
        gap: 'clamp(4px, 0.8vh, 8px)', alignItems: 'center',
      }}
    >
      {committed && (
        <span
          style={{
            fontSize: 'max(12px, calc(clamp(14px, 2.1vh, 18px) * var(--fit-lo, 1)))',
            fontWeight: 800, color: accent, letterSpacing: -0.2,
            maxWidth: '100%', textAlign: 'center', whiteSpace: 'nowrap', lineHeight: 1.25,
          }}
        >
          수정됨
        </span>
      )}
      {visibleValue && (
        <span
          ref={valueFitRef}
          data-fit-group="value"
          data-testid={committed ? 'modify-value' : 'interim-value'}
          aria-label={committed ? `새 값 ${visibleValue}` : `인식 중: ${visibleValue}`}
          style={{
            width: '100%', maxWidth: '100%',
            fontFamily: 'JetBrains Mono, ui-monospace, monospace',
            fontSize: committed ? HERO_TYPE.value : HERO_TYPE.interim,
            // v0.47.0 W2 — 성공 국면 값은 green(민구: "성공 순간부터 green").
            fontWeight: 900, color: committed ? T.green : T.text,
            letterSpacing: -1, lineHeight: 1.04,
            // 🔴 v0.47.0 C-FIX5(리뷰 U7) — **확정값 국면(committed)의 ellipsis를 제거했다.**
            //   W5ⓑ(VoiceHero `6d69165`→`cd6d6d6`)와 동형: 숫자는 잘리면 다른 숫자로
            //   오독된다('29.9'→'29…'). 넘침 방지는 useFitGroup(valueFitRef, searchBasePx=
            //   HERO_BASE_FONT_PX.value)이 맡고, ellipsis는 fit이 늦은 프레임에서 틀린 값을
            //   그럴듯하게 그리는 폴백이었다 — 지우면 그 프레임이 «잘린 글리프»로 남아
            //   오독이 아니라 결함으로 보인다.
            //   ⚠️ interim 국면은 ellipsis **유지**(Larry 확정 08-08 — 확정값 라인만):
            //   임의 길이 STT 문장의 «…»는 "뒤가 더 있다" 표기 계약이다(v043-fit-group:333).
            //   ⚠️ overflow:'hidden'도 유지 — 지우면 넘친 글자가 중앙 흡수영역 밖으로 흐른다.
            whiteSpace: 'nowrap', overflow: 'hidden',
            textOverflow: committed ? 'clip' : 'ellipsis',
            textAlign: 'center',
            animation: committed ? 'chip-pop 320ms ease-out' : undefined,
          }}
        >
          {visibleValue}
        </span>
      )}
      {committed && prevValue ? (
        <span
          style={{
            fontSize: 'max(12px, calc(clamp(14px, 2vh, 17px) * var(--fit-lo, 1)))',
            color: T.textDim,
            fontWeight: 800,
            lineHeight: 1.25,
            wordBreak: 'keep-all',
            overflowWrap: 'anywhere',
            textAlign: 'center',
          }}
        >
          직전 입력 {prevValue}
        </span>
      ) : null}
      {/* 🔴 v0.49 r3 #5(claude r2 HIGH) — **수정 재기록 중의 거절도 재시도 표면을 얻는다.**
          `CenterStage`는 6분기 상호배타이고 `ReaskCue`는 hero 분기 **안**에 살았다. 그래서
          이 분기(수정 재기록)에서 오인식이 나면 두 어절 TTS와 부정 비프 외에 **어느 표면에도**
          「무엇을 다시 말해야 하는지」가 없었다 — "수정" → 재발화 → 오인식은 이 앱에서 가장
          흔한 재질문 문맥이다(W2가 TTS 꼬리를 지우며 화면 큐에 넘긴 바로 그 책임).
          사유가 없으면 `ReaskCue`가 스스로 null을 돌려주므로 평시 레이아웃은 그대로다. */}
      <ReaskCue reason={reaskReason} />
    </div>
  );
}
