/** v0.36.0 FB#4(Vance) — 음성 안내(TTS)와 화면 재질문 큐가 **글자까지 일치**해야 하는 프롬프트의
 *  SSOT(PRINCIPLES §2 시각·청각 일치 계약). 소수점 유실 재질문 문구가 종전엔 세 콜사이트에 인라인
 *  리터럴로 흩어져 있어(useVoiceSession) TTS로만 나가고 화면엔 없었다. 여기 한 곳으로 모아 say()와
 *  ReaskCue가 같은 상수를 공유한다. **문구 자체는 불변**(민구 미승인) — 추출·공유만 한다. */
export function decimalReaskPrompt(whole: string | number): string {
  return `${whole} 점, 소수점 아래 숫자만 말씀해 주세요.`;
}
