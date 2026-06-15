import { create } from 'zustand';

export type VoicePhase = 'ready' | 'active' | 'paused' | 'complete' | 'done';

interface SessionState {
  phase: VoicePhase;
  /** Active session id (`sess_<ms>`). Lives in the store — NOT only in a hook ref — so an
   *  in-app unmount/tab-switch during pause cannot lose it (RACE-7 / D-2). Empty when idle. */
  sessionId: string;
  /** Epoch ms the session started. Stored explicitly so persistSession never derives a NaN
   *  from an empty sessionId after the hook ref is lost. 0 when idle. */
  startedAt: number;
  /** Optional session label, mirrored here so it survives remount alongside sessionId. */
  sessionLabel?: string;
  /** 1-indexed current row */
  activeRow: number;
  /** 0-indexed current voice column */
  activeColIdx: number;
  /** value currently shown on screen (recognized or being entered) */
  recognizedValue: string;
  /** last TTS message echoed to screen */
  lastTts: string;
  /** I-3: most recent recognized value, shown as a screen-centered "항목 : 값" burst.
   *  `seq` increments per recognition so the UI can re-key and replay the animation. */
  valueBurst: { name: string; value: string; seq: number } | null;
  /** v0.9.0 — 이상치 알람 팝업. 알람 발동 시 이전값→현재값과 변화량을 화면에 띄운다(발화만으론
   *  스쳐 지나가 확인이 어렵다는 요청). '확인'/'유지'/새 값 입력 또는 다음 필드 진입 시 해제(null).
   *  changeText = '9.9%'(변동률 트리거) 또는 절대차 '2.2'(증가/감소 트리거). */
  anomalyAlert: {
    colName: string;
    prev: string;
    next: string;
    direction: 'up' | 'down';
    changeText: string;
  } | null;
  /** All row values, keyed by row index → col id → value */
  allRowValues: Record<number, Record<string, string>>;
  /** Row indices that have been fully completed */
  completedRows: number[];
  /** v0.5.0 NAV-1: rows the user skipped with '다음' while incomplete. Persisted as
   *  complete:false placeholder rows so the 데이터탭 shows the gap; removed when the
   *  row is later completed. */
  skippedRows: number[];
  /** When user jumps to another row (modify/chip), where to return after that row finishes */
  returnRow: number | null;
  returnColIdx: number | null;

  setPhase: (p: VoicePhase) => void;
  setSessionMeta: (meta: { sessionId: string; startedAt: number; label?: string }) => void;
  setRecognized: (v: string) => void;
  setLastTts: (v: string) => void;
  pushValueBurst: (name: string, value: string) => void;
  setAnomalyAlert: (a: SessionState['anomalyAlert']) => void;
  setActiveCol: (i: number) => void;
  setActiveRow: (r: number) => void;
  setRowValue: (row: number, colId: string, v: string) => void;
  getRowValues: (row: number) => Record<string, string>;
  markRowComplete: (row: number) => void;
  markRowIncomplete: (row: number) => void;
  markRowSkipped: (row: number) => void;
  isRowComplete: (row: number) => boolean;
  setReturn: (row: number | null, colIdx: number | null) => void;
  resetAll: () => void;
}

export const useSessionStore = create<SessionState>((set, get) => ({
  phase: 'ready',
  sessionId: '',
  startedAt: 0,
  sessionLabel: undefined,
  activeRow: 1,
  activeColIdx: 0,
  recognizedValue: '',
  lastTts: '',
  valueBurst: null,
  anomalyAlert: null,
  allRowValues: {},
  completedRows: [],
  skippedRows: [],
  returnRow: null,
  returnColIdx: null,

  setPhase: (phase) => set({ phase }),
  setSessionMeta: ({ sessionId, startedAt, label }) =>
    set({ sessionId, startedAt, sessionLabel: label }),
  setRecognized: (recognizedValue) => set({ recognizedValue }),
  setLastTts: (lastTts) => set({ lastTts }),
  pushValueBurst: (name, value) =>
    set((s) => ({ valueBurst: { name, value, seq: (s.valueBurst?.seq ?? 0) + 1 } })),
  setAnomalyAlert: (anomalyAlert) => set({ anomalyAlert }),
  setActiveCol: (activeColIdx) => set({ activeColIdx }),
  setActiveRow: (activeRow) => set({ activeRow }),

  setRowValue: (row, colId, v) =>
    set((s) => {
      const cur = s.allRowValues[row] || {};
      return {
        allRowValues: { ...s.allRowValues, [row]: { ...cur, [colId]: v } },
      };
    }),

  getRowValues: (row) => get().allRowValues[row] || {},

  markRowComplete: (row) =>
    set((s) => {
      // 완료되면 skip 표시는 해제 (placeholder가 실데이터로 채워짐).
      const skippedRows = s.skippedRows.includes(row)
        ? s.skippedRows.filter((r) => r !== row)
        : s.skippedRows;
      if (s.completedRows.includes(row)) return { skippedRows };
      return {
        completedRows: [...s.completedRows, row].sort((a, b) => a - b),
        skippedRows,
      };
    }),

  markRowIncomplete: (row) =>
    set((s) => ({ completedRows: s.completedRows.filter((r) => r !== row) })),

  markRowSkipped: (row) =>
    set((s) => {
      if (s.completedRows.includes(row) || s.skippedRows.includes(row)) return s;
      return { skippedRows: [...s.skippedRows, row].sort((a, b) => a - b) };
    }),

  isRowComplete: (row) => get().completedRows.includes(row),

  setReturn: (returnRow, returnColIdx) => set({ returnRow, returnColIdx }),

  resetAll: () =>
    set({
      phase: 'ready',
      sessionId: '',
      startedAt: 0,
      sessionLabel: undefined,
      activeRow: 1,
      activeColIdx: 0,
      recognizedValue: '',
      lastTts: '',
      valueBurst: null,
      anomalyAlert: null,
      allRowValues: {},
      completedRows: [],
      skippedRows: [],
      returnRow: null,
      returnColIdx: null,
    }),
}));
