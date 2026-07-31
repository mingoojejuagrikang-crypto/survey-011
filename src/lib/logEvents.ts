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
 *  없으면 "재검증했는데 그대로였다"와 "재검증 자체가 실패했다"가 로그에서 같아 보인다.
 *
 *  🔴 v0.42.0 계측 F — **`catch` 침묵만 메운다.** 2026-07-29에 이 이벤트가 **0건**이었는데
 *  그 0이 무엇의 0인지 판정할 수 없었다. 조기 반환이 세 갈래였기 때문이다:
 *  `!rec` / 방출 게이트 / `catch`.
 *
 *  실측으로 세 갈래를 갈라보니 **둘은 이미 다른 이벤트가 덮고 있었다**(07-29 복귀 5건 대조):
 *   - `!rec` → 같은 복귀의 `foreground_return:teardown=no_recorder`가 남긴다(`bg_s=256`·`7058`)
 *   - 게이트 → 같은 복귀의 `foreground_return:bg_s`가 임계 미달을 보여준다(`bg_s=48`·`15`)
 *   - `catch` → **어떤 이벤트로도 남지 않는다** ← 진짜 공백
 *
 *  그래서 `catch`에서만 `status='error'`로 1건 남긴다. `bg_s=67,teardown=completed`(레코더도
 *  있었고 게이트도 통과했는데 침묵)의 정체를 다음 회차가 판정할 수 있게 하는 것이 목적이다.
 *
 *  ⚠️ **세 갈래를 전부 방출하려던 초안은 게이트에서 반증됐다.** `[F5]` 스펙이 *"임계 미만
 *  복귀는 무발행"* 을 **링버퍼 잠식 방지** 계약으로 못박고 있고, 실제로 전수 방출하자 레코더가
 *  붙기 전 복귀(`bg_s=0` 즉시 pageshow 포함)까지 4건이 쌓였다. 로그는 2000개 링버퍼다 —
 *  **계측을 늘리면 다른 계측이 밀려난다.** 이미 관측 가능한 것을 중복으로 남기지 마라. */
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

/** [EXIT-PERSIST-1] 끝 도달 상태에서 CenterStage가 실제 선택한 렌더 분기. */
export function endReachedRender(fields: {
  branch: 'paused' | 'anomaly' | 'end' | 'modify' | 'hero';
  alertStatus: 'none' | 'pending' | 'corrected';
}): string {
  return `end_reached_render:${kv(fields)}`;
}

/** [EXIT-PERSIST-1] 이상치 알람 객체가 화면에서 내려간 경로와 직전 상태. */
export function anomalyAlertCleared(fields: {
  reason: string;
  hadStatus: 'pending' | 'corrected';
}): string {
  return `trend_alert_cleared:${kv(fields)}`;
}

/** v0.43.0 #3 — **저신뢰인데 파싱돼서 커밋된 값.** 종전에는 신뢰도 게이트가 파서보다 앞에 있어
 *  이 발화들이 파싱 시도조차 없이 버려졌다(07-30 실기기: `300` conf 0.097 · `190` conf 0.021).
 *  순서를 뒤집었으니 이제 통과한다 — **그 판단이 옳았는지 다음 회차에 가릴 모수가 필요하다.**
 *
 *  🔴 **왜 `value` 이벤트에 붙이는가**(plan §2-5-b 4번 · [ORCH-47]):
 *   - 신규 LogEntry 타입을 안 만든다 → log-replay 호환. 링버퍼 2000개 압박도 **0 증가**
 *     (이미 발행되는 커밋 이벤트에 문자열 하나를 더할 뿐, 별도 이벤트를 늘리지 않는다).
 *   - ⛔ **기존 `stt_rejected_low_confidence`를 확장하지 않는다.** 커밋된 건에 "rejected"
 *     이벤트를 내면 **거절률의 분모가 오염된다** — 이 계측이 만들려는 바로 그 모수가 망가진다.
 *
 *  판정 방법: 이 마커가 달린 커밋값을 `SOP-003 §3` 클립 감사로 시트값과 대조한다.
 *  어긋나면 확정안(파싱되면 신뢰도 무관 커밋)이 오인식을 통과시킨 것이고, 맞으면 옳았던 것이다. */
export function lowConfidenceParsed(fields: {
  conf: number;
  minConf: number;
  /** 다이얼 위치(recognitionTolerance). minConf와 함께 실어 반전식을 몰라도 읽히게 한다. */
  tolerance: number;
  /** 어느 경로로 파싱됐나 — primary 그대로인지, alt 폴백인지, 소수부 합성인지. */
  via: 'primary' | 'alt' | 'frac';
}): string {
  return `low_conf_parsed:${kv(fields)}`;
}

/** [CLIP-WINDOW-2] UI suspend 래치가 신규 셀 녹음창 개시를 차단한 요청. */
export function clipArmBlocked(fields: {
  reason: string;
  row: number;
  col: string;
}): string {
  return `clip_arm_blocked:${kv(fields)}`;
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

/* ────────────────────────────────────────────────────────────────────────────
 * v0.42.0 계측 — 2026-07-29 실기기 회차가 "판정 불가"로 닫은 축들을 연다.
 *
 * 🔑 이 묶음의 공통 원칙: **어떤 이벤트도 0건이 두 가지 뜻을 갖게 두지 않는다.**
 * 배선이 틀린 계측과 재현되지 않은 결함은 로그에서 똑같이 0건으로 보인다(`[FG-RETURN-LOG-1]`).
 * 그래서 "일어나지 않았다"를 남기는 값(`skipped`·`silent`·`none`)을 유니온에 명시한다.
 *
 * ⚠️ 신규 이벤트를 추가할 때는 **볼트 `SOP-003` 파서 매핑표도 함께 갱신**해야 한다.
 * 안 하면 이벤트는 남는데 다음 회차 분석이 읽지 못한다(v0.39.0 `trend_alert_fired` 전례).
 * ──────────────────────────────────────────────────────────────────────────── */

/** 계측 A — **알람음 재생 시도와 그 결과.** 제보 #5 *"알람음이 안 들린다"*의 3갈래를 가른다.
 *
 *  현재 `beep.ts`에는 **로깅이 전무**하고 07-29 로그의 `beep` 이벤트는 0건이다. 그래서
 *  ①호출 자체가 없었다 ②호출됐으나 무음이었다 ③TTS에 묻혔다 — 셋을 구별할 수 없다.
 *  `playBeep`·`playSchedule`이 둘 다 `catch {}`로 삼키는 구조라 실패도 흔적이 없다.
 *
 *  `result`가 셋을 가른다:
 *   - `played`     오실레이터를 실제로 스케줄했다. 안 들렸다면 원인은 앱 밖(무음 스위치·볼륨·TTS 중첩)
 *   - `no_ctx`     `getCtx()`가 null — AudioContext 자체가 없다(iOS 제스처 미획득 등)
 *   - `suspended`  ctx가 있으나 `state='suspended'` — **스케줄해도 소리가 안 난다.** 가장 유력한 무음 원인
 *   - `silent`     마스터 게인이 0 — 볼륨 설정이 0이거나 배수가 0으로 클램프됐다
 *   - `empty`      재생할 톤이 0개 — 변형 조회가 빈 스케줄을 냈다
 *   - `error`      예외
 *
 *  `gain`은 실제 적용된 마스터 배수(소수 3자리)다. `silent` 판정의 근거를 남긴다.
 *
 *  🔴 **`ctx`에 iOS 전용 `interrupted`를 별도 값으로 둔다**(구현 중 레인 질의로 드러났다).
 *  TS DOM의 `AudioContextState`는 이 값을 포함하는데, 초안 유니온에는 없어서 `suspended`로
 *  정규화할 뻔했다. **그러면 안 된다** — 이 앱은 농가 현장에서 아이폰으로 돌고, 전화·Siri
 *  인터럽션은 일상이다. `suspended`(사용자 제스처 전 미개시)와 `interrupted`(개시됐다가
 *  OS가 뺏음)는 **원인도 대응도 다른데** 뭉개면 로그에서 영원히 구분되지 않는다.
 *  제보 #5 "알람음 안 들림"의 유력 후보라 더더욱 갈라야 한다.
 *
 *  `result`는 뭉개도 된다 — `interrupted`든 `suspended`든 *"스케줄해도 소리가 안 난다"*는
 *  **결과는 같다**(`result='suspended'`). 두 필드는 직교한다: `result`=무슨 일이 벌어졌나,
 *  `ctx`=왜 그랬나. */
export function beepPlay(fields: {
  kind: string;
  result: 'played' | 'no_ctx' | 'suspended' | 'silent' | 'empty' | 'error';
  ctx: 'running' | 'suspended' | 'interrupted' | 'closed' | 'none';
  gain: number;
  tones: number;
}): string {
  return `beep_play:${kv({
    kind: fields.kind,
    result: fields.result,
    ctx: fields.ctx,
    gain: Math.round(fields.gain * 1000) / 1000,
    tones: fields.tones,
  })}`;
}

/** 계측 G — **개선요청 업로드가 마이크를 죽이는가.** 07-29 최대 미판정 축.
 *
 *  **왜 초 단위로는 안 갈리나:** 모달 닫힘 10건을 갈라보니 실제 업로드 6건 중 **5건**에서 마이크가
 *  죽었고 취소·큐잉 4건은 **0건**이었다. 그런데 사망 3건이 `feedback_uploaded`와 **같은 초**에
 *  찍혀 인과 방향이 확정되지 않는다. 가설은 *"6.77~7.12MB zip 업로드가 메인스레드·메모리를 압박해
 *  iOS가 오디오 트랙을 회수한다"* 인데, 이를 판정하려면 **ms 해상도와 zip 바이트**가 필요하다.
 *
 *  `phase`가 같은 제출을 앞뒤로 묶는다 — `start`(업로드 직전)와 종료(`uploaded`/`queued`/`failed`)를
 *  **같은 `bytes`로 짝지어** 읽는다. 그 사이 `elapsedMs` 동안 `track`이 `live`→`ended`로 바뀌었다면
 *  업로드가 원인이라는 직접 증거가 된다.
 *
 *  🔴 `track`은 **업로드 경로가 아니라 레코더에서 읽은 실제 트랙 상태**다. `unknown`은 레코더를
 *  못 읽었다는 뜻이며 *"트랙이 없다"(`none`)와 다르다* — 이 구분이 없으면 계측 실패가 결함으로
 *  오독된다. */
export function feedbackUploadMic(fields: {
  phase: 'start' | 'uploaded' | 'queued' | 'failed';
  track: 'none' | 'ended' | 'muted' | 'live' | 'unknown';
  bytes: number;
  elapsedMs: number;
}): string {
  return `feedback_upload_mic:${kv({
    phase: fields.phase,
    track: fields.track,
    bytes: fields.bytes,
    ms: fields.elapsedMs,
  })}`;
}

/** 계측 H — **백그라운드 진입 *시점*의 오디오 스택 스냅샷.**
 *
 *  **메우는 공백:** 07-29의 `foreground_return:bg_s=7058,teardown=no_recorder`는 *복귀 시점에*
 *  레코더가 null이었음을 알려줄 뿐, **언제 어디서 사라졌는지**는 말하지 않는다. 진입 시점 상태가
 *  없으면 "들어갈 때 이미 없었다"와 "백그라운드에서 회수됐다"가 구분되지 않는다 — [MIC-B2]의
 *  근인 축이 3회차째 여기서 막혔다.
 *
 *  기존 `lifecycle:vis_hidden`·`visibility_context`는 **화면 상태만** 찍는다. 이 이벤트는 같은
 *  순간의 **레코더·트랙·인식기**를 함께 찍어 복귀 시점 스냅샷과 앞뒤로 대조하게 한다.
 *
 *  `rec=none`이면 진입 시점에 이미 레코더가 없었다는 뜻이고, 그 경우 복귀의 `no_recorder`는
 *  백그라운드 회수가 **아니다**. */
export function bgEnterSnapshot(fields: {
  rec: 'none' | 'idle' | 'recording';
  track: 'none' | 'ended' | 'muted' | 'live' | 'unknown';
  stt: 'none' | 'idle' | 'listening' | 'suspended';
  phase: string;
}): string {
  return `bg_enter_snapshot:${kv({
    rec: fields.rec,
    track: fields.track,
    stt: fields.stt,
    phase: fields.phase,
  })}`;
}

/** 계측 I — **회전이 실제로 일어났는가.** 3회차 연속 판정 불가였던 축.
 *
 *  **왜 필요한가:** 민구가 `PortraitGuard` 안내 화면을 **눈으로 봤다고 진술**했는데 로그에는
 *  회전·방향 이벤트가 **0건**이다. 회전 진동(fb-01) 재현 조건을 세 회차째 못 잡은 이유가 여기다 —
 *  안내가 떴다는 것조차 로그로 확인이 안 되니 진동 보고와 대조할 축이 없다.
 *
 *  `guard`가 **안내 오버레이의 실제 표시 여부**다. `(orientation: landscape)`만으로는 안 뜨고
 *  `(pointer: coarse)` 게이트를 함께 통과해야 하므로(데스크톱 제외), 방향 전환과 안내 표시는
 *  별개 사실이다. 둘을 한 이벤트에 담아 *"돌렸는데 안내가 안 떴다"*도 판정 가능하게 한다.
 *
 *  ⚠️ `standalone` 여부는 여기 싣지 않는다 — 부팅 시 `sa_insets`가 이미 남기므로(2026-07-29
 *  실측 확인) 중복이다. 그 값이 이 이벤트 판독의 분모다. */
export function orientationChange(fields: {
  to: 'portrait' | 'landscape';
  guard: 'shown' | 'hidden';
  w: number;
  h: number;
}): string {
  return `orientation_change:${kv({
    to: fields.to,
    guard: fields.guard,
    w: fields.w,
    h: fields.h,
  })}`;
}
