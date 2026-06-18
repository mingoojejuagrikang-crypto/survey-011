export type DataType = 'date' | 'text' | 'int' | 'float' | 'options' | 'name';

/** Legacy mode kept for migration only. New code uses input + ttsAnnounce. */
export type LegacyInputMode = 'auto' | 'voice' | 'silent';

export type AutoValue =
  | { kind: 'fixed'; value: string }
  | { kind: 'seq'; from: number; to: number }
  | { kind: 'options'; available: string[]; selected: string[] };

/** v0.8.0 — 이상치 알람 방향(의미 반전). increase = 직전 조사보다 **커지면** 알람,
 *  decrease = 직전 조사보다 **작아지면** 알람. Column.trendRule이 없으면(undefined) 방향 알람 off.
 *  (telemetry 키 'trend'/trend_alert_* 는 로그 연속성을 위해 유지 — 사용자 노출 문자열만 변경.) */
export type TrendRule = 'increase' | 'decrease';

export interface Column {
  id: string;
  name: string;
  type: DataType;
  /** 입력 방식: 자동 채움 vs 사용자 음성 입력 vs 사용자 터치 입력 */
  input: 'auto' | 'voice' | 'touch';
  /** TTS로 안내할지 (auto일 땐 자동값 읽기, voice일 땐 항목명 안내) */
  ttsAnnounce: boolean;
  auto: AutoValue;
  /** decimal places when type === 'float' (default 1) */
  decimals?: number;
  /** v0.7.0 — 샘플 식별 키 컬럼 여부. 기본값은 자동 유추(input==='auto' && type!=='date');
   *  규칙·폴백은 src/lib/columnFlags.ts가 SSOT. undefined = 아직 유추 전(소비자는 폴백 적용). */
  sampleKey?: boolean;
  /** v0.8.0 — 이상치 알람 방향(의미 반전: increase=커지면 알람). 적격 컬럼((int|float) &&
   *  input!=='auto')에서만 유지. 없으면 방향 알람 off. */
  trendRule?: TrendRule;
  /** v0.8.0 — 변동률 % 임계값(방향 무관). |Δ|/|prev|×100 ≥ 임계값이면 알람. 적격 컬럼에서만
   *  유지. undefined = off(값을 입력했을 때만 활성). 방향 알람과 독립(OR). */
  pctThreshold?: number;
}

export interface SheetConfig {
  url: string;
  spreadsheetId: string;
  sheetName: string;
  availableSheets: string[];
}

/** v0.13.0 R1 — 사용자가 자주 쓰는 스프레드시트를 '파일명'으로 저장해 두는 항목(민구 요청).
 *  OAuth 토큰은 ~1시간이면 만료되는데(refresh token 없음, [AUTH-4]) 토큰이 만료되면 연결이 풀린
 *  것처럼 보여, 매번 Drive에서 공유링크를 복사해 다시 붙여넣는 수고가 반복됐다. 저장 목록에서 한 번에
 *  다시 선택할 수 있게 한다(재로그인은 토큰 만료 시 1회 필요 — 설계 한계). sheetId로 중복을 가린다. */
export interface SavedSheet {
  /** 스프레드시트 파일명(properties.title). 사용자가 목록에서 식별하는 라벨. */
  name: string;
  /** 원본 공유 URL(선택 시 그대로 재연결에 사용). */
  url: string;
  /** parseSpreadsheetId(url) — 중복 판정 및 안정 식별자. */
  sheetId: string;
  /** 마지막으로 저장/사용한 시각(ms) — 최근 사용 순 정렬용. */
  addedAt: number;
}

export interface AppSettings {
  googleConnected: boolean;
  userEmail: string | null;
  sheet: SheetConfig | null;
  manualMode: boolean;
  columns: Column[];
  ttsRate: number;
}

/** A single row in the day's pre-built table */
export interface SessionRow {
  index: number;
  /** Column id → value (string for everything; parsed at sync time) */
  values: Record<string, string>;
  /** Has been entered (voice or auto)? */
  complete: boolean;
  /** colId → IDB key for audio clip blob */
  audioClips?: Record<string, string>;
  /** v0.6.0 — Sheets 1-based row number this row was appended to. Set after the row's first
   *  append so a later re-sync can UPDATE the same sheet row instead of appending a duplicate.
   *  undefined = never appended yet (or append updatedRange parse failed → retry next sync). */
  sheetRow?: number;
  /** v0.6.0 — per-row sync state for row-level re-sync.
   *  'synced' = matches the sheet; 'dirty' = locally edited after upload, needs UPDATE.
   *  undefined = not yet appended (legacy sessions also lack this; see syncedRows fallback). */
  syncState?: 'synced' | 'dirty';
}

export interface Session {
  id: string;
  /** ISO date e.g. 2026-05-13 */
  date: string;
  /** "A구역 정밀측정" 같은 라벨 (선택) */
  label?: string;
  columns: Column[];
  rows: SessionRow[];
  /** rows fully completed */
  completedRows: number;
  /** rows already pushed to Sheets */
  syncedRows: number;
  /** time stamps */
  startedAt: number;
  finishedAt?: number;
}

export type VoiceState = 'IDLE' | 'READY' | 'ANNOUNCE' | 'LISTEN' | 'ECHO' | 'ROW_DONE' | 'DONE';
