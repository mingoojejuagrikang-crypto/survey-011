/**
 * 비동기 공용 유틸(순수 — 단위 테스트 대상). DOM·스토어·로거에 의존하지 않는다.
 *
 * v0.38.0 — `withTimeout`이 pastValues(데이터 계층)에만 있어 다른 계층이 쓸 수 없었다.
 * 무한대기 방어는 데이터 조회만의 문제가 아니라서(마이크 재획득의 `getUserMedia`도 같은 위험)
 * 계층 중립 위치로 옮긴다. 새로 만들지 않고 **기존 구현을 그대로 이동**했다(DRY).
 */

/** 타임아웃으로 인한 reject를 **타입으로** 식별하기 위한 오류.
 *
 *  ⚠️ `message`는 `timeout after <ms>ms`로 종전과 **완전히 동일**하게 유지한다 —
 *  `pastValues.loadPastIndex`의 catch가 이 메시지를 `past_index_skip:<msg>`로 그대로 실어 보내고,
 *  SOP-003 판독이 그 문자열을 읽는다(바이트 계약). 구분이 필요하면 메시지가 아니라 이 타입을 본다. */
export class TimeoutError extends Error {}

/** 무한대기 방지 래퍼. 시간 초과 시 `timeout after <ms>ms`로 reject한다(`TimeoutError`).
 *
 *  **왜 필요한가:** 응답이 resolve도 reject도 되지 않는 경로가 실재한다(느린 fetch, 권한 프롬프트
 *  보류). 그 경우 호출부의 in-flight 가드가 영구히 잠겨 재시도 경로까지 함께 죽는다 —
 *  거부보다 보류가 위험하다. 타임아웃으로 반드시 결말을 만들어 가드가 풀리게 한다.
 *
 *  ⚠️ 원본 Promise는 취소되지 않는다(취소 가능한 Promise는 없다). 늦게 resolve되는 자원을
 *  정리해야 하는 호출부는 **generation guard**를 따로 둬야 한다 — `audioRecorder.recoverStream`이
 *  그 예로, 뒤늦게 열린 MediaStream의 트랙을 즉시 stop한다.
 */
export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new TimeoutError(`timeout after ${ms}ms`)), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}
