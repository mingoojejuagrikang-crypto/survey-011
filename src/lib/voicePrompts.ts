/** v0.36.0 FB#4(Vance) — 음성 안내(TTS)와 화면 재질문 큐가 **글자까지 일치**해야 하는 프롬프트의
 *  SSOT(PRINCIPLES §2 시각·청각 일치 계약). 소수점 유실 재질문 문구가 종전엔 세 콜사이트에 인라인
 *  리터럴로 흩어져 있어(useVoiceSession) TTS로만 나가고 화면엔 없었다. 여기 한 곳으로 모아 say()와
 *  ReaskCue가 같은 상수를 공유한다. **문구 자체는 불변**(민구 미승인) — 추출·공유만 한다. */
export function decimalReaskPrompt(whole: string | number): string {
  return `${whole} 점, 소수점 아래 숫자만 말씀해 주세요.`;
}

/** v0.48.0 P3(NEW-2, 민구 제보 08-10) — 재질문 사유 2버킷의 SSOT. 화면(`ReaskCue`)과
 *  TTS(`useVoiceSession`)가 같은 문자열을 공유한다(위 `decimalReaskPrompt`와 동일 패턴,
 *  PRINCIPLES §2 시각·청각 일치 계약). 종전엔 `ReaskCue.tsx` 로컬 상수라 화면에만 떴고 TTS는
 *  못 읽었다 — 민구 원문: *"음성인식 실패시, 원인도 음성안내 할 것. 예) '숫자로 인식 실패' +
 *  '횡경 다시 말씀해 주세요'"*. 사유 세분화(digit_token_unparsed/multi_numeric/extraneous_token)
 *  없이 기존 2버킷 그대로 쓴다 — 민구 예시 자체가 버킷 수준과 일치한다(scout-v048 조사). */
export const REASK_COPY: Record<'low_confidence' | 'parse_failed', string> = {
  low_confidence: '소리가 불확실',
  parse_failed: '숫자로 인식 실패',
};
