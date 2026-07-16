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
