export type DataType = 'date' | 'text' | 'int' | 'float' | 'options' | 'name';

/** Legacy mode kept for migration only. New code uses input + ttsAnnounce. */
export type LegacyInputMode = 'auto' | 'voice' | 'silent';

export type AutoValue =
  | { kind: 'fixed'; value: string }
  | { kind: 'seq'; from: number; to: number }
  | { kind: 'options'; available: string[]; selected: string[] };

/** v0.7.0 — 추세 검증 방향. increase = 직전 조사보다 커져야 함, decrease = 작아져야 함.
 *  Column.trendRule이 없으면(undefined) 검증 off. */
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
  /** v0.7.0 — 추세 검증 방향. 적격 컬럼((int|float) && input!=='auto')에서만 유지. 없으면 off. */
  trendRule?: TrendRule;
}

export interface SheetConfig {
  url: string;
  spreadsheetId: string;
  sheetName: string;
  availableSheets: string[];
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
