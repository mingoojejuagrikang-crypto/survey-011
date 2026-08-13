import { T } from '../../tokens';
import { useSessionStore } from '../../stores/sessionStore';
import { decimalReaskPrompt, REASK_SCREEN } from '../../lib/voicePrompts';

/** v0.23.0 입력탭#2(재질문 사유 큐, Vance) — 상단 인식률 %(허용범위 기준 색)와 **구분되는** 짧은
 *  사유 큐. 인식률은 높은데도 재질문되는 경우(파싱 실패) vs 신뢰도 자체가 낮은 경우를 사용자가 알게
 *  한다("왜 또 물어보지?" 혼란 해소). reaskReason은 sessionStore(Mack 소유)에서 읽으며, Mack이
 *  null로 리셋하면 자동으로 사라진다. listening hero의 하위 보조선으로 두어 4-way 상호배타(일시정지
 *  /이상치/수정/hero)와 경쟁하지 않는다 — hero가 보일 때만(=듣는 중) 함께 노출된다.
 *   - 'low_confidence' → "소리가 불확실"(소음·잡음으로 신뢰도 미달)
 *   - 'parse_failed'   → "숫자로 인식 실패"(인식은 됐으나 숫자로 파싱 불가)
 *  🔴 v0.49 r4 M10(codex r3 F10) — **위 「listening hero에서만/경쟁하지 않는다」는 현행과 반대다.**
 *  r3 #5가 `VoiceHero`의 모드 게이트를 걷어냈고(`VoiceHero.tsx:197`), `ModifyIndicatorPill`에도
 *  같은 큐를 렌더한다(`:127`, 배선은 `CenterStage.tsx:219`). 6분기 상호배타 스테이지에서
 *  hero가 아닌 modify 분기로 갈 때 큐가 **통째로 사라지던 것**이 그 결함이었다.
 *  현행 계약: **사유가 있으면 hero 또는 modify 표면에 표시된다**(둘은 동시에 서지 않는다).
 *  v0.48.0 P3 — 문구 자체는 `voicePrompts.ts`로 옮겼다(SSOT).
 *  🔴 v0.49 r2 W2(민구 08-13) — TTS는 이제 **다른 문구**를 읽는다(`REASK_TTS` = 사유만, 축약).
 *  이 화면 문구는 **그대로 유지**한다 — 축약 압력은 귀에만 걸린다(§2 「의미 동등 + 구조적 분리」).
 *  재질문 지시가 TTS에서 사라졌으므로 **부정 비프 + 이 큐**가 재시도 신호를 전담한다:
 *  이 컴포넌트는 `reason`만 있으면 뜨고 TTS 문구에 의존하지 않는다(아래 `if (!reason) return null`). */
export type ReaskReason = 'low_confidence' | 'parse_failed' | null;

export function ReaskCue({ reason }: { reason: ReaskReason }) {
  // v0.36.0 FB#4(Vance) — 소수점 유실 재질문이면 TTS와 **글자까지 일치**하는 프롬프트를 화면에도
  //   표시한다(voicePrompts SSOT 공유). 정수부(reaskDecimalWhole)가 실려 있을 때만 특화 문구,
  //   그 외엔 기존 짧은 사유 큐.
  //   🔴 v0.49 r4 M3 — 종전 *"소수 재질문은 항상 reason='parse_failed'와 함께 세워진다"* 는
  //   더 이상 사실이 아니다: 소수 문맥에서도 **저신뢰** 거절이 난다(`setDecimalReason(whole, reason)`).
  //   **문구**는 어느 사유든 소수 프롬프트로 같고(확정표 #3), 사유는 `data-reason`에 그대로 실린다.
  const decimalWhole = useSessionStore((s) => s.reaskDecimalWhole);
  if (!reason) return null;
  const copy = decimalWhole != null ? decimalReaskPrompt(decimalWhole) : REASK_SCREEN[reason];
  return (
    <div
      data-testid="reask-cue"
      data-reason={reason}
      role="status"
      aria-live="assertive"
      style={{
        display: 'inline-flex', alignItems: 'center',
        maxWidth: '100%',
        padding: '6px 14px', borderRadius: 999,
        background: 'rgba(255,234,0,0.14)', border: `1px solid ${T.amber}`,
        color: T.amber, fontWeight: 800,
        // v0.27.0 무스크롤 — hero(useFitScale 카드) 내부라 --fit-lo를 상속받아 넘칠 때 함께 축소.
        fontSize: 'calc(clamp(13px, min(4.2vw, 2.1vh), 17px) * var(--fit-lo, 1))', letterSpacing: -0.2, lineHeight: 1.25,
        // 긴 사유도 좁은 기기에서 줄바꿈(잘림 0).
        wordBreak: 'keep-all', overflowWrap: 'anywhere', textAlign: 'center',
      }}
    >
      <span>{copy}</span>
    </div>
  );
}
