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
/** v0.38.2 F5 — 포그라운드 복귀 시 **오디오 경로 재검증** 결과.
 *
 *  **메우는 공백:** 백그라운드에서는 `devicechange`가 발화하지 않는다. 그래서 2026-07-24 실기기
 *  세션B의 "BT 이어폰 → 아이폰 스피커" 전환은 **어떤 이벤트로도 남지 않았고**, 트리거를 추론으로만
 *  세워야 했다(로그 분석 §2.4). 이 이벤트가 그 구간의 유일한 관측점이다.
 *
 *  `before`는 **백그라운드 진입 시점의 스냅샷**이다(`foregroundReturnPolicy`의 `hiddenInputLabel`).
 *  복귀 후 둘 다 읽으면 항상 같은 값이라 경로 변경을 판정할 수 없다 — 그 설계를 쓰면 이 이벤트가
 *  존재 이유를 잃는다.
 *
 *  값은 raw 장치명이 아니라 `classifyInputDevice`의 **CATEGORY**(내장 마이크/블루투스/유선 이어폰)다.
 *  raw 라벨은 OS·브라우저마다 표기가 제각각이라 로그 대조에 쓸 수 없고, 개인 장치명이 로그에 남는
 *  것도 피한다. 진입 스냅샷이 없으면 `before=unknown`.
 *
 *  `mic_teardown`과 **같은 복귀 이벤트에서 짝으로** 읽는다 — teardown이 `found=none`인데 경로가
 *  바뀌었다면 원인이 JS측 AudioContext가 아니라는 근거가 된다.
 *
 *  🔴 `status`는 **계측이 자기 실패를 숨기지 않게** 한다(라운드A 리뷰 Codex #1·#2).
 *  `ok`=실제로 다시 읽었다 / `unavailable`=읽을 대상이 없었다 / `error`=읽으려다 실패했다.
 *  `ok`가 아니면 `after`는 `unknown`이며, **그 복귀는 경로를 관측하지 못한 것**이다 — 이 구분이
 *  없으면 "재검증했는데 그대로였다"와 "재검증 자체가 실패했다"가 로그에서 같아 보인다. */
export function audioRouteRevalidate(fields: {
  before: string;
  after: string;
  track: 'none' | 'ended' | 'muted' | 'live';
  status: 'ok' | 'unavailable' | 'error';
  evt: string;
  backgroundMs: number;
}): string {
  return `audio_route_revalidate:${kv({
    before: fields.before,
    after: fields.after,
    track: fields.track,
    status: fields.status,
    evt: fields.evt,
    bg_s: Math.round(fields.backgroundMs / 1000),
  })}`;
}

/** 🔴 F6(2026-07-27 실기기 분석) — **포그라운드 복귀를 빠짐없이 1건 남긴다.**
 *
 *  왜 필요한가: `shouldTeardown=false`인 복귀(임계 미달)는 v0.39.0까지 **아무 이벤트도 남기지
 *  않았다.** 그래서 2026-07-27 회차에서 `mic_teardown` 0건을 두고 "판단해서 건너뛴 것"인지
 *  "훅이 아예 안 돈 것"인지 **구별할 수 없었고**, [MIC-B2] 판정 사다리가 통째로 미결로 남았다.
 *  (그 회차의 bg 58.2s < 임계 60s라는 사실조차 `vis_hidden`/`vis_visible` 두 이벤트를 **손으로
 *  뺀 것**이지 계측이 알려준 게 아니다.)
 *
 *  `teardown`은 임계 미달 / 대상 없음 / 실제 완료 / 실패를 서로 다른 값으로 남긴다.
 *  이벤트가 **없으면** 실제 hidden 사이클의 복귀가 아니었다 — 이 구분이 다음 회차 판정을
 *  가능하게 만든다. */
export type ForegroundReturnTeardownResult = 'completed' | 'failed';
export type ForegroundReturnTeardown =
  | 'skipped'
  | 'no_recorder'
  | ForegroundReturnTeardownResult;

export function foregroundReturn(fields: {
  backgroundMs: number;
  teardown: ForegroundReturnTeardown;
  evt: string;
}): string {
  return `foreground_return:${kv({
    bg_s: Math.round(fields.backgroundMs / 1000),
    teardown: fields.teardown,
    evt: fields.evt,
  })}`;
}

/** [WAKELOCK-LOG-1] 화면 wake lock의 요청·결과·해제 전 경로.
 *  실패 reason은 Error.name 같은 저카디널리티 분류만 받는다(원문 메시지/PII 금지). */
export function wakeLockEvent(fields: {
  action: 'acquire' | 'reacquire' | 'release';
  result: 'attempt' | 'ok' | 'failed' | 'unsupported';
  source?: 'browser' | 'cleanup' | 'late_request';
  reason?: string;
}): string {
  return `wake_lock:${kv({
    action: fields.action,
    result: fields.result,
    ...(fields.source ? { source: fields.source } : {}),
    ...(fields.reason ? { reason: fields.reason } : {}),
  })}`;
}

/** [SCREEN-LOCK-1] visibility 전환 순간까지 실제 관측된 수명주기 신호.
 *  `evidence=none`은 화면 잠금/앱 전환을 웹 표준 신호만으로 구별하지 못했다는 뜻이다. */
export function visibilityContext(fields: {
  state: 'hidden' | 'visible';
  focus: boolean;
  evidence: string;
}): string {
  return `visibility_context:${kv({
    state: fields.state,
    focus: fields.focus,
    evidence: fields.evidence,
  })}`;
}

/** [SCREEN-LOCK-1] blur/pagehide/freeze 및 대응 복귀 신호를 추측 없이 원형대로 기록한다. */
export function lifecycleSignal(fields: {
  signal: 'blur' | 'focus' | 'pagehide' | 'pageshow' | 'freeze' | 'resume';
  visibility: 'hidden' | 'visible';
  focus: boolean;
  persisted: 'yes' | 'no' | 'na';
}): string {
  return `lifecycle_signal:${kv({
    signal: fields.signal,
    vis: fields.visibility,
    focus: fields.focus,
    persisted: fields.persisted,
  })}`;
}

/** 조절판을 실제로 펼친 횟수(오탭률의 분모). 기존 command 이벤트는 바이트 불변으로 별도 유지한다. */
export function inputControlPanelOpened(source: 'touch' | 'voice'): string {
  return `input_control_panel:${kv({ action: 'open', source })}`;
}

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
