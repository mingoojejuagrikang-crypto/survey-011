import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Column, SheetConfig, LegacyInputMode } from '../types';
import { inferSampleKey, reconcileColumnFlags } from '../lib/columnFlags';

interface SettingsState {
  googleConnected: boolean;
  userEmail: string | null;
  sheet: SheetConfig | null;
  sheetUrl: string;
  sheetTab: string;
  availableSheets: string[];
  manualMode: boolean;
  columns: Column[];
  tableGenerated: boolean;
  totalRows: number;
  /** TTS playback rate (0.5 ~ 2.0) */
  ttsRate: number;
  /** Which auto column's value is used as the session label suffix. null = auto-pick. */
  sessionLabelColId: string | null;
  /** Pre-computed session label captured at table generation time. */
  sessionAutoLabel: string | null;
  /** Noisy environment mode — raises STT confidence threshold + rejects single-char results. */
  noisyMode: boolean;
  /** v0.4.5 Q2: 스피커폰(에코 방지) 모드 — 이어폰 없이 스피커로 쓸 때 TTS 자기 음성이 STT로
   *  오인식되는 것을 막는다. ON이면 TTS 재생 중 음성입력(값·명령어 barge-in)을 차단하고 신뢰도
   *  임계를 상향(사실상 TTS 중 half-duplex). 기본 false. */
  speakerphoneMode: boolean;
  /** Preferred Web Speech API voice name for ko-KR TTS. Empty string = auto (first available). */
  preferredVoiceName: string;
  /** v0.10.1: 캐시된 관리자 폴더 내 본인 팀 하위 폴더 ID — race 방지용. 첫 결정 후 재사용. */
  teamFolderId: string | null;
  /** v0.4.5 Q1b: 캐시된 사용자 Drive 내 `survey-011/log/` 폴더 ID — 매 업로드 검색 방지. */
  userLogFolderId: string | null;
  /** v0.7.0 — 추세 검증 알림 전역 마스터 토글. 컬럼별 방향은 Column.trendRule. 기본 false. */
  trendAlertEnabled: boolean;
  /** v0.7.0 — 조사시기(회차) 컬럼 id. null = 자동(첫 date 컬럼, '조사일자' 우선) —
   *  해석은 pastValues.resolveRoundCol. */
  roundDateColId: string | null;
  /** v0.7.0 — 조회 탭 기본 비교 범위: 직전 조사 vs 작기 전체. */
  reviewScope: 'prevRound' | 'season';

  set: (partial: Partial<Omit<SettingsState, 'set' | 'updateColumn' | 'addColumn' | 'removeColumn' | 'reorderColumns'>>) => void;
  updateColumn: (id: string, next: Column) => void;
  addColumn: () => void;
  removeColumn: (id: string) => void;
  reorderColumns: (fromIdx: number, toIdx: number) => void;
}

const MOCK_COLUMNS: Column[] = [
  { id: 'c1',  name: '조사일자', type: 'date',  input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '오늘' } },
  { id: 'c2',  name: '기준일자', type: 'date',  input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '2026-05-13' } },
  { id: 'c3',  name: '농가명',   type: 'text',  input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '이원창' } },
  { id: 'c4',  name: '라벨',     type: 'text',  input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: 'A' } },
  { id: 'c5',  name: '처리',     type: 'text',  input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '시험' } },
  { id: 'c6',  name: '조사나무', type: 'int',   input: 'auto', ttsAnnounce: true,  auto: { kind: 'seq', from: 1, to: 10 } },
  { id: 'c7',  name: '조사과실', type: 'int',   input: 'auto', ttsAnnounce: true,  auto: { kind: 'seq', from: 1, to: 5 } },
  { id: 'c8',  name: '횡경',     type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1 },
  { id: 'c9',  name: '종경',     type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1 },
  { id: 'c10', name: '비고',     type: 'text',  input: 'touch', ttsAnnounce: false, auto: { kind: 'fixed', value: '' } },
];

/**
 * 항목명 기반 의미 기본값(파일/시트/기존 사용자 불문 일관 적용):
 *  - "비고" → 터치 입력(메모). 사용자가 자유롭게 메모할 수 있어야 함.
 *
 * 롤백(v0.4.3): '농가명 → 이름 데이터형' 강제는 실사용에서 불편하여 제거. 세션명은 이름 문자열
 * 식별로 대체(VoiceScreen/SettingsScreen). 기존 persisted 'name' 컬럼은 로드 시 'text'로 치유.
 */
export function applySemanticDefaults(col: Column): Column {
  const nm = col.name?.trim();
  if (nm === '비고' && col.input !== 'touch') return { ...col, input: 'touch' };
  if (col.type === 'name') return { ...col, type: 'text' };
  return col;
}

/** Migrate legacy mode-based columns to new input/ttsAnnounce shape. */
function migrateColumn(c: unknown): Column {
  const x = c as Partial<Column> & { mode?: LegacyInputMode };
  if (x.input !== undefined && x.ttsAnnounce !== undefined) {
    return applySemanticDefaults(x as Column);
  }
  let input: 'auto' | 'voice' = 'auto';
  let ttsAnnounce = true;
  switch (x.mode) {
    case 'voice':  input = 'voice'; ttsAnnounce = true;  break;
    case 'silent': input = 'auto';  ttsAnnounce = false; break;
    case 'auto':
    default:       input = 'auto';  ttsAnnounce = true;  break;
  }
  return applySemanticDefaults({
    id: x.id || `c${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    name: x.name || '새 항목',
    type: x.type || 'text',
    input,
    ttsAnnounce,
    auto: x.auto || { kind: 'fixed', value: '' },
    decimals: x.decimals,
  });
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      googleConnected: false,
      userEmail: null,
      sheet: null,
      sheetUrl: '',
      sheetTab: '',
      availableSheets: [],
      manualMode: false,
      // 신규 설치 기본 컬럼에도 샘플키 유추값을 미리 부여(prev===next → undefined일 때만 유추).
      columns: MOCK_COLUMNS.map((c) => reconcileColumnFlags(c, c)),
      tableGenerated: false,
      totalRows: 50,
      ttsRate: 1.05,
      sessionLabelColId: null,
      sessionAutoLabel: null,
      noisyMode: false,
      speakerphoneMode: false,
      preferredVoiceName: '',
      teamFolderId: null,
      userLogFolderId: null,
      trendAlertEnabled: false,
      roundDateColId: null,
      reviewScope: 'prevRound',

      set: (partial) => set(partial),
      updateColumn: (id, next) =>
        set((state) => ({
          // v0.7.0 — input/type 변경 시 sampleKey 재유추 + 부적격 trendRule 제거(columnFlags 규칙).
          columns: state.columns.map((c) => (c.id === id ? reconcileColumnFlags(c, next) : c)),
        })),
      addColumn: () =>
        set((state) => {
          const col: Column = {
            id: 'c' + Date.now(),
            name: '새 항목',
            type: 'text',
            input: 'auto',
            ttsAnnounce: false,
            auto: { kind: 'fixed', value: '' },
          };
          // v0.7.0 — 신규 컬럼도 샘플키 유추 기본값을 받는다(auto+text → true).
          col.sampleKey = inferSampleKey(col);
          return { columns: [...state.columns, col] };
        }),
      removeColumn: (id) =>
        set((state) => ({ columns: state.columns.filter((c) => c.id !== id) })),
      reorderColumns: (fromIdx, toIdx) =>
        set((state) => {
          if (fromIdx === toIdx) return state;
          const copy = [...state.columns];
          const [moved] = copy.splice(fromIdx, 1);
          copy.splice(toIdx, 0, moved);
          return { columns: copy };
        }),
    }),
    {
      name: 'survey-011-settings-v3',
      version: 5,
      migrate: (persisted: unknown, _version: number) => {
        const s = persisted as Partial<SettingsState> & { columns?: unknown[] };
        if (Array.isArray(s.columns)) {
          // v5 — 기존 컬럼 전부에 샘플키 유추 기본값 부여(사용자가 이미 토글한 boolean은 보존:
          // prev===next 호출은 structural change가 아니므로 undefined일 때만 유추) + 잘못된
          // trendRule 값 방어적 정규화(columnFlags 규칙).
          s.columns = (s.columns as unknown[])
            .map(migrateColumn)
            .map((c) => reconcileColumnFlags(c, c));
        }
        if (typeof s.ttsRate !== 'number') s.ttsRate = 1.05;
        if (typeof s.sessionLabelColId !== 'string' && s.sessionLabelColId !== null) s.sessionLabelColId = null;
        if (typeof s.sessionAutoLabel !== 'string' && s.sessionAutoLabel !== null) s.sessionAutoLabel = null;
        if (typeof s.noisyMode !== 'boolean') s.noisyMode = false;
        if (typeof s.speakerphoneMode !== 'boolean') s.speakerphoneMode = false;
        if (typeof s.preferredVoiceName !== 'string') s.preferredVoiceName = '';
        if (typeof s.teamFolderId !== 'string' && s.teamFolderId !== null) s.teamFolderId = null;
        if (typeof s.userLogFolderId !== 'string' && s.userLogFolderId !== null) s.userLogFolderId = null;
        // v5 — 추세 검증·조회 탭 설정 기본값
        if (typeof s.trendAlertEnabled !== 'boolean') s.trendAlertEnabled = false;
        if (typeof s.roundDateColId !== 'string' && s.roundDateColId !== null) s.roundDateColId = null;
        if (s.reviewScope !== 'prevRound' && s.reviewScope !== 'season') s.reviewScope = 'prevRound';
        return s as SettingsState;
      },
    },
  ),
);
