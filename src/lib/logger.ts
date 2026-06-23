/** Event logger for voice session diagnostics.
 *  In-memory ring buffer for fast access + IDB persistence (v5.2 Codex 4차 MEDIUM)
 *  so reload-before-sync flows still have diagnostic events available for the auto-uploaded ZIP.
 */
import { appendLogEvent } from './db';

export interface LogEntry {
  ts: number;
  type: 'stt' | 'tts' | 'command' | 'session' | 'value' | 'error' | 'clip'
    | 'stt_blocked_tts_muted' | 'stt_barge_in' | 'stt_rejected_col_name' | 'stt_alt_used' | 'stt_parse_failed'
    | 'stt_rejected_ambiguous_syllable'
    // v0.9.0 빠른 인식(조기확정): interim 안정화로 final 대기 없이 커밋. 절단/정정율 측정 근거.
    | 'stt_early_commit'
    // v0.5.0 W7(T-19): 세션 밖 앱 수명주기 이벤트 — app_boot / hydration_ok / recover_* /
    // drive_upload / setting_changed 등. sessionId가 없으면 '__app__' sentinel이 붙는다.
    | 'app'
    // v0.7.0 B4: 추세 검증 — extra에 trend_alert_fired / trend_alert_confirmed /
    // trend_alert_corrected / trend_alert_dismissed:<cmd> / trend_skip:<cause>를 싣는다.
    // 차기 로그 분석이 오알림률(fired 대비 corrected 비율)을 측정하는 근거.
    | 'trend';
  sessionId?: string;
  row?: number;
  colId?: string;
  colName?: string;
  text?: string;
  confidence?: number;
  alts?: string[];
  ttsText?: string;
  parsed?: string;
  command?: string;
  durationMs?: number;
  /** TTS engine cold-start latency (enqueue → audio onstart). v5.2 Additional-2. */
  startDelayMs?: number | null;
  extra?: string;
  altIdx?: number;
  originalText?: string;
  altsCount?: number;
  /** v0.9.0 딜레이 계측: 마지막 interim → final까지의 간격(ms) = 브라우저 무음 종료감지(EOS) 꼬리.
   *  `stt` 이벤트에 동봉. 앱 처리는 ~1ms이므로 이 값이 사용자 체감 딜레이의 실제 병목 지표. */
  eosTailMs?: number;
  /** v0.11.0 post-TTS 가드 계측: TTS 종료(onend) 이후 이 입력이 도착하기까지 경과(ms). 스피커폰
   *  모드에서 `stt_blocked_tts_muted` + `extra:'post_tts_guard'`로 차단된 입력에만 동봉. 차기 로그가
   *  "에코 잔향 차단 vs 정상 입력 오차단"을 분포로 보고 가드 윈도우를 튜닝하는 근거. */
  msSinceTtsEnd?: number;
  // ── reach telemetry (additive; all optional, only set on specific events) ──
  /** Session-meta, attached to the `session` start/stop events. Lets multiple sessions be
   *  aggregated for real-field reach without changing existing `extra:'start'|'stop'` tags. */
  meta?: SessionMeta;
  /** value event during a correction: the value that was committed BEFORE this modify.
   *  Pairs with `parsed` (final value) to tell STT misrecognition (prefix-drop) apart from
   *  deliberate user re-entry. Only present when the value was reached via modify. */
  previousValue?: string;
  /** clip-preservation telemetry (additive; set on `clip` events only).
   *  `attempt` is the 1-based try index for a cell — every correction archives the prior clip
   *  under a fresh attempt key, so all tries for one cell survive in IDB. `kind` distinguishes a
   *  measurement-value clip from the '수정'/'정정' command utterance that declared the correction.
   *  `clipKey` is the IDB key the clip was preserved under, so analysis can re-join attempts. */
  attempt?: number;
  kind?: 'value' | 'command';
  clipKey?: string;
  /** v0.5.0 W6: preroll length (ms) merged into this clip — set on `clip_duration` /
   *  `clip_trimmed` events. 0 = no preroll captured for this clip. */
  prerollMs?: number;
  /** v0.7.0 B5: measured post-roll (ms) actually delivered before the recorder stopped —
   *  stop-request → actual stop. ≈500 when the full post-roll ran; <500 when a fast next-field
   *  startClip (or dispose) truncated it gracefully. Set on `clip_duration` events whose clip
   *  had a stop requested; absent on clips that were never stop-requested. */
  postrollMs?: number;
}

/** Snapshot of session-level context, emitted on the `session` start/stop events. */
export interface SessionMeta {
  appVersion: string;
  /** epoch ms; mirrors the sessionId timestamp for convenience */
  startedAt?: number;
  finishedAt?: number;
  /** total rows in the generated table (denominator for completion rate) */
  totalRows?: number;
  /** rows fully completed at the time of the event */
  completedRows?: number;
  /** session label (e.g. auto-built field/plot label). RESERVED — intentionally NOT populated
   *  by the session events: the auto-label derives from a grower-name column (PII). Kept in the
   *  type only so a future de-identified label can slot in without a schema change. */
  label?: string;
  /** active input device actually used for this session (built-in vs external mic) */
  inputDeviceId?: string;
  inputDeviceLabel?: string;
  /** Reserved slot for self-test vs real-field split. Defaults to 'field'; an explicit UI
   *  toggle is a Vance follow-up. userEmail (device.json) + value-pattern already allow
   *  crude post-hoc splitting today. */
  sessionMode?: 'field' | 'test';
}

export interface DeviceInfo {
  userAgent: string;
  platform: string;
  language: string;
  screenW: number;
  screenH: number;
  deviceMemory?: number;
  hardwareConcurrency?: number;
  appVersion: string;
  audioInputDevices?: { deviceId: string; label: string; kind: string }[];
}

const entries: LogEntry[] = [];

/** 현재 세션 컨텍스트. sessionId를 명시하지 않은 로그(예: AudioRecorder 내부)에 자동 첨부되어
 *  exportLogZip(sessionIds)의 세션 필터 ZIP에서 누락되지 않도록 한다. */
let currentSessionId: string | undefined;

export const logger = {
  setSessionId(id: string | undefined): void {
    currentSessionId = id;
  },

  device(): DeviceInfo {
    const nav = navigator as Navigator & { deviceMemory?: number };
    return {
      userAgent: nav.userAgent,
      platform: nav.platform,
      language: nav.language,
      screenW: screen.width,
      screenH: screen.height,
      deviceMemory: nav.deviceMemory,
      hardwareConcurrency: nav.hardwareConcurrency,
      appVersion: typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '?',
    };
  },

  async deviceAsync(): Promise<DeviceInfo> {
    const base = this.device();
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = devices.filter((d) => d.kind === 'audioinput');
      base.audioInputDevices = audioInputs.map((d) => ({
        deviceId: d.deviceId, label: d.label, kind: d.kind,
      }));
    } catch { /* permission denied or unavailable */ }
    return base;
  },

  log(entry: Omit<LogEntry, 'ts'>): void {
    // sessionId 미지정 시 현재 세션 컨텍스트를 자동 첨부(entry가 명시하면 그대로 우선).
    const full = { ts: Date.now(), sessionId: currentSessionId, ...entry };
    // v0.5.0 W7(T-19): 세션 밖 이벤트(app_boot, hydration, recover, 업로드, 설정 변경 등)는
    // sessionId가 없어 IDB `bySessionId` 인덱스에 안 잡히고(undefined는 인덱싱 불가) 세션 필터
    // ZIP에서 통째로 빠졌다. '__app__' sentinel을 부여해 영속화·내보내기 모두에 포함시킨다.
    if (full.sessionId == null) full.sessionId = '__app__';
    entries.push(full);
    // Keep max 2000 entries in memory
    if (entries.length > 2000) entries.splice(0, entries.length - 2000);
    // Fire-and-forget IDB persistence (failures fall back to memory-only behavior)
    void appendLogEvent(full as unknown as Parameters<typeof appendLogEvent>[0]);
  },

  getAll(): LogEntry[] {
    return [...entries];
  },

  clear(): void {
    entries.length = 0;
  },
};
