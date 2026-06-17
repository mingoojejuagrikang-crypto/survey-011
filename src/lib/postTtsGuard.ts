/**
 * v0.11.0 post-TTS 가드 — 스피커폰(소프트 half-duplex) 모드에서 TTS 안내가 끝난 직후 스피커
 * 잔향/리버브가 마이크로 새어 들어와 가짜 final(값·명령)로 수락되는 빈틈을 닫는다.
 *
 * 배경: `unmuteForTts()`가 TTS `onend` 즉시 `ttsMuted=false`로 풀기 때문에, 종료 직후의
 * 잔향이 곧장 통과할 수 있었다. 스피커 모드는 echoCancellation도 OFF라 잔향이 그대로 유입된다.
 * 이어폰(기본) 모드는 barge-in을 유지해야 하므로 가드 비대상.
 *
 * 호출자(useVoiceSession.handleFinal)의 상태머신에서 판정만 분리한 순수 함수 — 클럭/타이머
 * 의존 없이 단위 테스트할 수 있게 한다(`tests/postTtsGuard.spec.ts`).
 */

/** 스피커폰 모드에서 TTS 종료 후 이 시간(ms) 동안 입력을 추가 차단한다. 스피커폰 사용자는 안내가
 *  끝난 뒤 말하므로 체감 영향이 없다. 초기값 250ms — 실기기 로그(post_tts_guard·msSinceTtsEnd
 *  분포)로 튜닝한다. */
export const POST_TTS_GUARD_MS = 250;

export interface PostTtsGuardInput {
  /** TTS가 아직 재생 중인가(SpeechController.isTtsMuted). */
  muted: boolean;
  /** 스피커폰(소프트 half-duplex) 모드인가. false(이어폰)면 항상 통과. */
  speakerphone: boolean;
  /** 마지막 TTS 종료(unmuteForTts) 이후 경과(ms). 종료 이력 없으면 +Infinity. */
  msSinceTtsEnd: number;
  /** 가드 윈도우(ms). 기본 POST_TTS_GUARD_MS. */
  guardMs?: number;
}

export interface PostTtsGuardResult {
  /** 이 입력을 폐기해야 하는가. */
  block: boolean;
  /** 폐기 사유가 "재생 중(muted)"이 아니라 "종료 직후 가드 윈도우"인가(계측용 — post_tts_guard). */
  viaGuard: boolean;
}

/**
 * 스피커폰 모드에서만 동작. 재생 중(muted)이거나 종료 후 guardMs 이내면 block=true.
 * 이어폰 모드는 항상 block=false(barge-in/정상 처리는 호출자 책임).
 */
export function evalPostTtsGuard(i: PostTtsGuardInput): PostTtsGuardResult {
  const guardMs = i.guardMs ?? POST_TTS_GUARD_MS;
  if (!i.speakerphone) return { block: false, viaGuard: false };
  const viaGuard = !i.muted && i.msSinceTtsEnd < guardMs;
  return { block: i.muted || viaGuard, viaGuard };
}
