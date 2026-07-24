/**
 * v0.35.2 Stage 2 — 로그 이벤트 extra 문자열 빌더 (SSOT).
 *
 * 계약(SOP-003 파서·과거 zip 하위호환):
 *  - 이 모듈의 빌더는 기존 콜사이트가 방출하던 extra 문자열과 **바이트 동일**하게 방출한다.
 *    tests/logEvents.spec.ts 특성화 테스트가 기대 문자열을 리터럴로 고정한다 — 여기를 바꾸면
 *    외부 파서(SOP-003)·과거 로그 zip과의 계약이 깨진다.
 *  - 기존 이벤트의 표기(유니코드 '→'/ASCII '->' 혼용 포함)는 바꾸지 않는다 — 이미 방출된
 *    이벤트 문자열은 영원히 그 형태가 정답이다.
 *
 * 신규 이벤트 규약(v0.35.2+ — 새 extra는 이 모듈을 경유한다):
 *  - 세그먼트 구분은 ':' — `event:detail` / `event:detail:sub`
 *  - key=value 쌍은 ','로 연결 — `event:key=val,key2=val2` (kv() 사용)
 *  - 전이 표기는 ASCII '->' (유니코드 '→' 금지 — 신규 한정, 기존 이벤트는 불변)
 *  - 에러 접미는 withErr() — `prefix:<message>` 표준화
 */

/** key=value 쌍을 ','로 연결 — 신규 이벤트 표준 표기. 예: kv({row: 3, src: 'voice'}) → 'row=3,src=voice'. */
export function kv(pairs: Record<string, string | number | boolean>): string {
  return Object.entries(pairs)
    .map(([k, v]) => `${k}=${v}`)
    .join(',');
}

/** `${prefix}:${에러 메시지}` — 에러 접미 표준. 기존 콜사이트들의
 *  `String((err as Error)?.message ?? err)` 산출과 바이트 동일. */
export function withErr(prefix: string, err: unknown): string {
  return `${prefix}:${String((err as Error)?.message ?? err)}`;
}

/** `setting_changed:${key}=${value}` — 설정 변경 계측(다이얼·토글 공유 패밀리). */
export function settingChanged(key: string, value: string | number | boolean): string {
  return `setting_changed:${key}=${value}`;
}

/** `${kind}:${row},src=${source}` — 행 완료/스킵 계측(SOP-003 진행 파서 대상). */
export function rowMarked(kind: 'row_complete' | 'row_skipped', row: number, source: string): string {
  return `${kind}:${row},src=${source}`;
}

/** `lifecycle:zombie_restart:stale_ms=<ms>,n=<streak>` — STT 좀비 재시작 진단.
 *  stale_ms/n 순서는 SOP-003 판독 계약이므로 이 빌더와 특성화 테스트에서 고정한다. */
export function zombieRestart(staleMs: number, streak: number): string {
  return `lifecycle:zombie_restart:${kv({ stale_ms: staleMs, n: streak })}`;
}

/** v0.38.0 #5 — 사용자 제스처 밖 자동 마이크 재연결의 시도/결과.
 *  기존 mic_reconnect_* 이벤트는 수동 경로와 공유하므로, 이 이벤트만으로 자동 경로를 식별한다. */
export function micAutoReconnect(stage: 'attempt' | 'ok' | 'failed'): string {
  return stage === 'attempt'
    ? 'mic_auto_reconnect:attempt'
    : `mic_auto_reconnect:${kv({ result: stage })}`;
}

/** v0.38.0 리뷰#1 — 재획득 `getUserMedia`가 **응답 없이 보류**돼 타임아웃으로 포기한 경우.
 *
 *  기존 `clip_recorder_recover_failed:<reason>:<message>`(거부·오류)와 **별도 이벤트**로 둔다.
 *  거부와 보류는 현장 원인이 다르기 때문 — 거부는 권한/정책, 보류는 OS·브라우저 교착이라
 *  로그에서 섞이면 실기기 판독이 불가능하다. 기존 문자열은 바이트 계약이라 변경하지 않는다. */
export function recoverTimeout(reason: string, ms: number): string {
  return `clip_recorder_recover_timeout:${reason}:${kv({ ms })}`;
}

/** v0.38.1 [MIC-B2] 포그라운드 복귀 선-정리(`AudioRecorder.teardownAudioGraph`) 결과 —
 *  **실기기 판정 사다리의 핵심 바이트**.
 *
 *  세 필드가 각각 다른 결론을 가른다(#12-bis — 계측 없이는 "고쳐도 안 풀린 것"과 "애초에 아무것도
 *  안 한 것"을 구분할 수 없다):
 *   - `found`    닫으려 한 컨텍스트 상태. `none`이면 **닫을 게 없었다** = 이 수정이 no-op이었고
 *                원인은 JS측 AudioContext가 아니다(세션-레벨 물림) → 폴백(리로드)으로 분기.
 *   - `closed`   낡은 컨텍스트 close 결과. `timeout`이면 **close 자체가 물렸다**.
 *   - `reattach` 정리 후 캡처 재부착 결과. `ok`가 아니면 마이크는 멀쩡한데 **프리롤·파형만 죽은** 상태다.
 *
 *  ⚠️ 초안(R1)은 필드를 `:`로 잇고 이벤트·경과를 `vis:bg=3000s`로 박아 **세그먼트가 모호**했다
 *  (`reason` 안에 `:`가 들어가 `split(':')` 파서가 필드를 쪼갠다). 이 파일 헤더의 신규 이벤트
 *  규약대로 **kv(',')로 통일**한다 — 배포 전이라 지금 바꾸는 것이 무비용이고, 한 번 방출되면
 *  그 형태가 영원히 정답이 된다. */
export function micTeardown(fields: {
  found: string;
  closed: 'ok' | 'timeout' | 'error';
  reattach: 'ok' | 'timeout' | 'error' | 'skipped';
  evt: string;
  backgroundMs: number;
}): string {
  return `mic_teardown:${kv({
    found: fields.found,
    closed: fields.closed,
    reattach: fields.reattach,
    evt: fields.evt,
    bg_s: Math.round(fields.backgroundMs / 1000),
  })}`;
}
