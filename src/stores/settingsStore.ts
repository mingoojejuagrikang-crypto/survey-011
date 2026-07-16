import { create } from 'zustand';
import { persist, createJSONStorage, type StateStorage } from 'zustand/middleware';
import type { Column, SheetConfig, SavedSheet, LegacyInputMode } from '../types';
import { inferSampleKey, reconcileColumnFlags } from '../lib/columnFlags';
import { isCycling } from '../lib/autoValue';
import {
  DEFAULT_POSITIVE_BEEP_ID,
  DEFAULT_NEGATIVE_BEEP_ID,
  isBeepVariantId,
} from '../lib/beepVariants';
import {
  saveSettingsBackup,
  loadSettingsBackup,
  deleteSettingsBackup,
  saveSheetsRecord,
  loadSheetsRecord,
} from '../lib/db';
import { logger } from '../lib/logger';

/**
 * v0.14.0 C — localStorage + IDB 내구 미러 스토리지. iOS Safari는 일정시간 경과(ITP)나 강제종료
 * 후 localStorage를 evict해 시트 등록(URL·컬럼·저장시트)이 통째로 풀리는 문제가 보고됐다(민구).
 * localStorage를 1차(동기·기존 동작 보존)로 쓰되 모든 쓰기를 IDB('kv')에 미러하고, getItem에서
 * localStorage가 비어 있으면 IDB에서 복원한다. localStorage 히트 시 동기 반환 → 정상 경로의
 * 하이드레이션 레이스 표면은 늘리지 않는다(IDB 폴백은 evict된 경우에만 비동기로 탄다).
 *
 * v0.19.0 W2 — 하이드레이션 게이트(레이스 가드). 근본원인: 홈 설치형 앱 업데이트 부팅 시
 * localStorage가 evict되면 getItem이 **비동기** IDB 복원 Promise를 반환한다. 그 복원이 끝나기 전,
 * 부팅 초기에 일어나는 `set()`(인증 부트스트랩·컬럼 reconcile 등)이 기본 상태(savedSheets:[])를
 * 직렬화해 setItem write-through를 호출하면 IDB 미러가 **빈 배열로 덮여 영구 소실**된다. 따라서
 * 하이드레이션(onRehydrateStorage)이 끝날 때까지 IDB write-through를 보류한다 — localStorage 1차
 * 쓰기는 그대로(동기 동작 보존), IDB 미러만 게이트. 게이트가 풀린 뒤의 모든 쓰기는 정상 미러된다.
 * (시트 목록 자체는 saveSheet/removeSavedSheet의 전용 IDB 레코드로도 별도 미러돼 이 bulk 경로와
 * 무관하게 결정론적으로 복원된다 — 아래 saveSheet 참고.)
 */
let hydrationComplete = false;
/** v0.19.0 W2 — onRehydrateStorage 콜백에서 호출. 세 부팅 경로(localStorage 동기 히트 / IDB 비동기
 *  복원 / 신규 설치) 모두에서 하이드레이션 완료 직후 게이트를 연다. 안 열리면 이후 모든 쓰기가
 *  영구히 미러되지 않으므로 반드시 onRehydrateStorage에서 1회 호출돼야 한다. */
function markHydrationComplete(): void {
  hydrationComplete = true;
}

const mirroredStorage: StateStorage = {
  getItem: (name) => {
    let local: string | null = null;
    try { local = localStorage.getItem(name); } catch { /* private mode 등 */ }
    if (local != null) return local; // 정상 경로: 동기 반환
    // localStorage 비었음 — evict됐을 수 있으니 IDB 미러에서 복원 시도(비동기).
    return loadSettingsBackup(name).then((fromIdb) => {
      if (fromIdb != null) {
        try { localStorage.setItem(name, fromIdb); } catch { /* ignore */ }
        logger.log({ type: 'app', extra: 'settings_restored_from_idb' });
      }
      return fromIdb;
    });
  },
  setItem: (name, value) => {
    try { localStorage.setItem(name, value); } catch { /* ignore */ }
    // v0.19.0 W2 — 하이드레이션 완료 전에는 IDB 미러를 덮지 않는다(빈 기본값 clobber 방지).
    if (!hydrationComplete) {
      logger.log({ type: 'app', extra: 'settings_write_pre_hydration_skipped_idb' });
      return;
    }
    void saveSettingsBackup(name, value); // write-through 미러(best-effort)
  },
  removeItem: (name) => {
    try { localStorage.removeItem(name); } catch { /* ignore */ }
    void deleteSettingsBackup(name);
  },
};

// ── v0.26.0 F1 재변경(민구 최종 결정 2026-07-03) — "높을수록(100에 가까울수록) 엄격" ──────────────
// 이력: 종전(v0.24.0까지) 다이얼 값 = 최소 신뢰도(높을수록 엄격) → v0.25.0에서 "높일수록 관대"로
// 게이트 반전 → v0.25.0 실기기 후 민구 최종 결정으로 **원래 방향(높을수록 엄격) 복귀**. 이번에는
// 다이얼 캡션·aria로 방향을 화면에 명시해 의미 오해가 재발하지 않게 한다(VoiceScreen hint 참조).
// 저장값·다이얼 위치·persist(version 11)·기본값(0.60)·대역[0.40~0.90]은 전 과정 내내 불변 —
// 방향 결정은 이 함수 한 곳에만 살고, 값 게이트(useVoiceSession)와 신뢰도 색 임계(VoiceScreen)가
// 공유한다 → 시각·게이트 항상 일치. 또 방향을 바꾸게 되면 이 함수와 hint/aria 문구만 손대면 된다.
export const RECOGNITION_TOLERANCE_MIN = 0.4;
export const RECOGNITION_TOLERANCE_MAX = 0.9;
/** 허용범위 다이얼 값 → 실제 최소 신뢰도(직접 매핑: 다이얼 90% = minConf 0.90 가장 엄격).
 *  2자리 반올림은 반전식 시절의 부동소수 잔여 방지 관례를 유지(로그 문자열·색 임계 안정). */
export function minConfidenceForTolerance(tolerance: number): number {
  return Math.round(tolerance * 100) / 100;
}

interface SettingsState {
  googleConnected: boolean;
  userEmail: string | null;
  sheet: SheetConfig | null;
  sheetUrl: string;
  sheetTab: string;
  availableSheets: string[];
  /** v0.13.0 R1 — 저장된 스프레드시트 목록(파일명 기반, 최근 사용 순). localStorage에 영속(같은
   *  persist 키). 토큰 만료로 연결이 풀려도 목록은 남아, 재로그인 후 한 번에 다시 선택할 수 있다. */
  savedSheets: SavedSheet[];
  manualMode: boolean;
  columns: Column[];
  tableGenerated: boolean;
  totalRows: number;
  /** TTS playback rate (0.5 ~ 2.0) */
  ttsRate: number;
  /** v0.20.0 — 음성인식 허용범위 다이얼(입력탭). 사용자 조절, 범위 0.40~0.90, 기본 0.60. 장갑 손가락
   *  조작용 가로 다이얼이 이 값을 제어한다. v0.26.0 F1 재변경(민구 최종 결정): **높을수록 엄격(적게
   *  수용)**. 저장값은 다이얼 위치이고, 실제 최소 신뢰도 변환은 minConfidenceForTolerance() 한 곳에만
   *  산다(게이트=useVoiceSession, 색 임계=VoiceScreen 공유). 방향 이력은 그 함수 주석 참조. */
  recognitionTolerance: number;
  /** Which auto column's value is used as the session label suffix. null = auto-pick. */
  sessionLabelColId: string | null;
  /** Pre-computed session label captured at table generation time. */
  sessionAutoLabel: string | null;
  /** v0.22.0 — 사용자 자유입력 세션명(설정탭 "세션명" 텍스트칸). 비어있지 않으면 자동 라벨(생성일+
   *  상수들)보다 **우선**해 세션명이 된다(buildSessionLabel의 customName). null/'' = 미사용(자동). */
  sessionCustomLabel: string | null;
  /** v0.9.0 (딜레이 단축 실험) — 빠른 인식. true면 interim(중간) 결과가 유효 숫자로 안정되면
   *  브라우저 final(무음 종료감지)을 기다리지 않고 조기 커밋한다. 미완성 숫자 절단 리스크가 있어
   *  기본 false(실기기 A/B용). */
  fastRecognition: boolean;
  /** v0.33.0 10-B — 입력화면 자동 캡처(음성입력 반응 시점 JPEG 저장, 로그 zip 동봉). 기본 on
   *  (민구 확정). 가드(2초 스로틀·세션당 100장)는 src/lib/screenshot.ts가 SSOT. */
  autoScreenCapture: boolean;
  /** v0.33.0 10-C — 비프음 선택(긍정=값 수용, 부정=이상치 알람). 값은 beepVariants.ts의 변형 id.
   *  기본 = 현행 사운드(상승/하강 스윕). 해석(kind→극성→변형)은 src/lib/beep.ts가 SSOT. */
  beepPositiveId: string;
  beepNegativeId: string;
  /** v0.35.0 FB-D(Vance) — 비프음 마스터 볼륨(0~1). 기존 세그먼트 gain(0.04~0.055 하드코딩)에
   *  beep.ts가 곱하는 마스터 배수로 매핑(0~1 → 0~BEEP_VOLUME_MAX). 기본 0.5(현행 1×보다 큼 —
   *  민구 "확인음 더 크게"). 500–1200Hz·클립경계 제약은 beepVariants.ts에서 유지(STT 오트리거 방지). */
  beepVolume: number;
  /** Preferred Web Speech API voice name for ko-KR TTS. Empty string = auto (first available). */
  preferredVoiceName: string;
  /** v0.10.1: 캐시된 관리자 폴더 내 본인 팀 하위 폴더 ID — race 방지용. 첫 결정 후 재사용. */
  teamFolderId: string | null;
  /** v0.4.5 Q1b: 캐시된 사용자 Drive 내 `survey-011/log/` 폴더 ID — 매 업로드 검색 방지. */
  userLogFolderId: string | null;
  /** v0.7.0 — 조사시기(회차) 컬럼 id. null = 자동(첫 date 컬럼, '조사일자' 우선) —
   *  해석은 pastValues.resolveRoundCol. */
  roundDateColId: string | null;
  /** v0.8.0(v6) 내부 마이그레이션 마커 — "추세→이상치" trendRule 클리어를 이미 1회 수행했는지.
   *  다운그레이드(v5) 라운드트립 후 재업그레이드 시 사용자가 v6에서 새로 지정한 trendRule을
   *  다시 지우지 않도록 한다. 사용자 설정 아님(UI 미노출). */
  trendRuleClearedV6?: boolean;

  set: (partial: Partial<Omit<SettingsState, 'set' | 'updateColumn' | 'addColumn' | 'removeColumn' | 'reorderColumns' | 'saveSheet' | 'removeSavedSheet'>>) => void;
  updateColumn: (id: string, next: Column) => void;
  addColumn: () => void;
  removeColumn: (id: string) => void;
  reorderColumns: (fromIdx: number, toIdx: number) => void;
  /** v0.13.0 R1 — 시트를 저장 목록에 추가/갱신(sheetId 기준 dedupe — 있으면 name/url/addedAt 갱신
   *  후 최상단으로, 없으면 unshift). 연결 성공 시 자동 호출 + 사용자가 명시 저장할 때도 사용. */
  saveSheet: (entry: SavedSheet) => void;
  /** v0.13.0 R1 — 저장 목록에서 제거(sheetId 기준). */
  removeSavedSheet: (sheetId: string) => void;
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

/** 메서드를 제외한 설정 상태(기본값의 형태). */
export type SettingsDefaults = Omit<
  SettingsState,
  'set' | 'updateColumn' | 'addColumn' | 'removeColumn' | 'reorderColumns' | 'saveSheet' | 'removeSavedSheet'
>;

/**
 * v0.32.0 설정탭 UX(Vance) — 설정 기본값 SSOT. create() 초기 상태와 설정탭 '초기화'가 공유한다.
 * 상수가 아니라 **함수**인 이유: columns가 호출마다 fresh 배열/객체여야 하기 때문(초기 상태와
 * 초기화 결과가 가변 참조를 공유하면 안 됨). structuredClone으로 MOCK_COLUMNS의 중첩 auto까지
 * 새로 만든 뒤 기존과 동일하게 reconcileColumnFlags(c, c)로 샘플키 유추값을 부여한다.
 */
export function makeSettingsDefaults(): SettingsDefaults {
  return {
    googleConnected: false,
    userEmail: null,
    sheet: null,
    sheetUrl: '',
    sheetTab: '',
    availableSheets: [],
    savedSheets: [],
    manualMode: false,
    // 신규 설치 기본 컬럼에도 샘플키 유추값을 미리 부여(prev===next → undefined일 때만 유추).
    columns: structuredClone(MOCK_COLUMNS).map((c) => reconcileColumnFlags(c, c)),
    tableGenerated: false,
    totalRows: 50,
    ttsRate: 1.05,
    recognitionTolerance: 0.6,
    sessionLabelColId: null,
    sessionAutoLabel: null,
    sessionCustomLabel: null,
    fastRecognition: false,
    autoScreenCapture: true,
    beepPositiveId: DEFAULT_POSITIVE_BEEP_ID,
    beepNegativeId: DEFAULT_NEGATIVE_BEEP_ID,
    beepVolume: 0.5,
    preferredVoiceName: '',
    teamFolderId: null,
    userLogFolderId: null,
    roundDateColId: null,
  };
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      ...makeSettingsDefaults(),

      set: (partial) => set(partial),
      updateColumn: (id, next) =>
        set((state) => {
          const prev = state.columns.find((c) => c.id === id) ?? null;
          let merged = next;
          // v0.9.0 — 순차/복수선택(cycling) 자동입력으로 *전이*할 때만 음성확인(ttsAnnounce) 기본값을
          // '유'로 올린다. 전이 기반(객체/파라미터 비교가 아님)이라, 한 번 cycling이 된 뒤 사용자가
          // 수동으로 '무'로 되돌리거나 seq 범위·options를 편집해도 그 값이 보존된다(민구 명시 요구:
          // "굳이 들을 필요 없다고 판단하면 수동으로 다시 무로"). non-cycling→cycling 진입에서만 발동.
          if (prev && !isCycling(prev) && isCycling(next)) {
            merged = { ...next, ttsAnnounce: true };
          }
          // v0.12.0 S1 — 대칭 down-transition(민구 명시 요구): cycling→non-cycling 전이 시 음성확인을
          // 자동으로 '무'로 내린다(다값→단일값 ⇒ 음성확인 무). 전이(edge) 기반이라, 이미 단일값 상태에서
          // 사용자가 수동으로 켠 ttsAnnounce는 건드리지 않고 cycling 해제 edge에서만 발동한다. 이 down-edge는
          // up-transition의 "수동 보존" 주석을 의도적으로 덮어쓴다(민구 결정). up/down edge는 상호배타적.
          if (prev && isCycling(prev) && !isCycling(next)) {
            merged = { ...next, ttsAnnounce: false };
          }
          // v0.7.0 — input/type 변경 시 sampleKey 재유추 + 부적격 trendRule 제거(columnFlags 규칙).
          return {
            columns: state.columns.map((c) => (c.id === id ? reconcileColumnFlags(prev, merged) : c)),
          };
        }),
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
      saveSheet: (entry) =>
        set((state) => {
          if (!entry.sheetId) return state; // id 없으면 dedupe 불가 — 저장하지 않음
          const rest = state.savedSheets.filter((x) => x.sheetId !== entry.sheetId);
          const savedSheets = [entry, ...rest]; // 최근 사용을 최상단으로
          // v0.19.0 W2 — 전용 IDB 레코드에도 미러(bulk write-through와 무관한 결정론적 복원 경로).
          void saveSheetsRecord({ savedSheets, sheetUrl: state.sheetUrl, updatedAt: Date.now() });
          return { savedSheets };
        }),
      removeSavedSheet: (sheetId) =>
        set((state) => {
          const savedSheets = state.savedSheets.filter((x) => x.sheetId !== sheetId);
          void saveSheetsRecord({ savedSheets, sheetUrl: state.sheetUrl, updatedAt: Date.now() });
          return { savedSheets };
        }),
    }),
    {
      name: 'survey-011-settings-v3',
      version: 11,
      // v0.14.0 C — localStorage + IDB 내구 미러(eviction 방어).
      storage: createJSONStorage(() => mirroredStorage),
      // v0.14.0 C — 하이드레이션 breadcrumb. 다음 강제종료/시간경과 테스트 로그에서 시트 등록이
      // 살아있었는지(eviction 여부)와 IDB 복원이 작동했는지 판별할 계측. token은 별도 키라 함께 본다.
      onRehydrateStorage: () => (state) => {
        // v0.19.0 W2 — 하이드레이션 게이트 해제(setItem write-through 재개). 세 부팅 경로 모두 이
        // 콜백을 거치므로 여기서 단 1회 연다. 반드시 호출돼야 이후 쓰기가 IDB로 미러된다.
        markHydrationComplete();
        try {
          const hasUrl = !!(state?.sheetUrl && state.sheetUrl.trim());
          const cols = state?.columns?.length ?? 0;
          const saved = state?.savedSheets?.length ?? 0;
          let token = false;
          try { token = !!localStorage.getItem('gs10_google_token'); } catch { /* ignore */ }
          logger.log({
            type: 'app',
            extra: `settings_hydrated:url=${hasUrl ? 'Y' : 'N'},cols=${cols},saved=${saved},token=${token ? 'Y' : 'N'}`,
          });
          // v0.19.0 W2 — settings의 savedSheets가 비었으면(업데이트/evict로 settings persist는
          // 풀렸으나) 전용 IDB 레코드에서 결정론적으로 복원한다. 전용 레코드는 bulk write-through에
          // 절대 덮이지 않으므로 버전 마이그레이션·evict와 무관한 복원 경로다(비동기, best-effort).
          if (saved === 0) {
            void loadSheetsRecord().then((rec) => {
              if (!rec || !Array.isArray(rec.savedSheets) || rec.savedSheets.length === 0) return;
              const cur = useSettingsStore.getState();
              if (cur.savedSheets.length > 0) return; // 그새 채워졌으면 덮지 않음
              const restored = (rec.savedSheets as unknown[]).filter(
                (x): x is SavedSheet =>
                  x !== null && typeof x === 'object' &&
                  typeof (x as SavedSheet).name === 'string' &&
                  typeof (x as SavedSheet).url === 'string' &&
                  typeof (x as SavedSheet).sheetId === 'string' &&
                  typeof (x as SavedSheet).addedAt === 'number',
              );
              if (restored.length === 0) return;
              const patch: Partial<SettingsState> = { savedSheets: restored };
              // 연결 시트 URL도 비어 있으면 전용 레코드 값으로 함께 복원.
              if (!cur.sheetUrl?.trim() && rec.sheetUrl?.trim()) patch.sheetUrl = rec.sheetUrl;
              cur.set(patch);
              logger.log({ type: 'app', extra: `saved_sheets_restored_from_record:${restored.length}` });
            });
          }
        } catch { /* best-effort 계측 */ }
      },
      migrate: (persisted: unknown, version: number) => {
        const s = persisted as Partial<SettingsState> & {
          columns?: unknown[];
          trendAlertEnabled?: unknown;
          reviewScope?: unknown;
          speakerOutput?: unknown;
          speakerphoneMode?: unknown;
          noisyMode?: unknown;
          trendRuleClearedV6?: boolean;
          savedSheets?: unknown;
          // v0.35.1 Stage 0 — 비교탭 제거로 인터페이스에서 빠진 영속 필드(잔존 키 삭제용).
          reviewFilters?: unknown;
          reviewTargetRound?: unknown;
          reviewBaselineBack?: unknown;
          reviewGroupCols?: unknown;
          reviewMeasureCols?: unknown;
          reviewSelectedRows?: unknown;
        };
        if (Array.isArray(s.columns)) {
          // 기존 컬럼 전부에 샘플키 유추 기본값 부여(사용자가 이미 토글한 boolean은 보존:
          // prev===next 호출은 structural change가 아니므로 undefined일 때만 유추) + 잘못된
          // trendRule/pctThreshold 값 방어적 정규화(columnFlags 규칙).
          s.columns = (s.columns as unknown[])
            .map(migrateColumn)
            .map((c) => reconcileColumnFlags(c, c));
        }
        if (typeof s.ttsRate !== 'number') s.ttsRate = 1.05;
        // v0.20.0 — 인식 허용범위(최소 신뢰도). 구버전 영속본엔 없으므로 기본 0.60으로 치유.
        // 비유한수·범위이탈도 안전 기본값으로(ttsRate와 동일한 무조건 coercion 패턴).
        if (
          typeof s.recognitionTolerance !== 'number' ||
          !Number.isFinite(s.recognitionTolerance) ||
          s.recognitionTolerance < 0.4 ||
          s.recognitionTolerance > 0.9
        ) {
          s.recognitionTolerance = 0.6;
        }
        if (typeof s.sessionLabelColId !== 'string' && s.sessionLabelColId !== null) s.sessionLabelColId = null;
        if (typeof s.sessionAutoLabel !== 'string' && s.sessionAutoLabel !== null) s.sessionAutoLabel = null;
        // v0.22.0 — 자유입력 세션명. 구버전 영속본엔 없으므로 null로 치유(미사용=자동 라벨).
        if (typeof s.sessionCustomLabel !== 'string' && s.sessionCustomLabel !== null) s.sessionCustomLabel = null;
        if (typeof s.fastRecognition !== 'boolean') s.fastRecognition = false;
        // v0.33.0 10-B/10-C — 자동 캡처·비프음 선택 신설. persist version은 11 유지(bump 금지 —
        // sessionCustomLabel과 같은 무조건 coercion 패턴: 구버전 누락/손상은 안전 기본값으로 치유,
        // version을 올리면 settings-migration.spec의 version===11 단정이 깨진다).
        if (typeof s.autoScreenCapture !== 'boolean') s.autoScreenCapture = true;
        if (!isBeepVariantId(s.beepPositiveId, 'positive')) s.beepPositiveId = DEFAULT_POSITIVE_BEEP_ID;
        if (!isBeepVariantId(s.beepNegativeId, 'negative')) s.beepNegativeId = DEFAULT_NEGATIVE_BEEP_ID;
        // v0.35.0 FB-D — 비프 마스터 볼륨. version 11 유지(무조건 coercion 한 줄, beepPositiveId 패턴).
        if (typeof s.beepVolume !== 'number' || !Number.isFinite(s.beepVolume) || s.beepVolume < 0 || s.beepVolume > 1) {
          s.beepVolume = 0.5;
        }
        if (typeof s.preferredVoiceName !== 'string') s.preferredVoiceName = '';
        if (typeof s.teamFolderId !== 'string' && s.teamFolderId !== null) s.teamFolderId = null;
        if (typeof s.userLogFolderId !== 'string' && s.userLogFolderId !== null) s.userLogFolderId = null;
        // v0.7.0 — 조사시기(회차) 컬럼 id는 유지(UI만 v0.8.0 조회탭으로 이전 — WS4).
        if (typeof s.roundDateColId !== 'string' && s.roundDateColId !== null) s.roundDateColId = null;

        // ── v0.35.1 Stage 0 — 비교탭(ReviewScreen) 정식 제거. v0.10.0에 도입된 영속 상태 6필드를
        // 인터페이스에서 없앴으므로 잔존 영속값을 무조건 삭제한다(v7 speakerOutput 패턴 — 필드가
        // 더는 존재하지 않아 다운그레이드 마커 불필요). persist version은 11 동결 유지([ENV-9],
        // settings-migration.spec의 version===11 단정 — 필드 delete는 bump 불요).
        delete s.reviewFilters;
        delete s.reviewTargetRound;
        delete s.reviewBaselineBack;
        delete s.reviewGroupCols;
        delete s.reviewMeasureCols;
        delete s.reviewSelectedRows;

        // ── v6 (v0.8.0) — "추세 검증" → "이상치 알람" 전환 ──────────────────────────
        // 의미가 정반대로 반전됐으므로(increase: 작아지면 알람 → 커지면 알람) 기존 저장값을
        // 그대로 두면 사용자 의도와 반대로 동작한다. 따라서 마이그레이션 시 안전하게 초기화한다.
        //  1) 제거된 전역 마스터 토글 trendAlertEnabled 삭제(이상치 알람은 컬럼별 규칙 유무로 활성).
        //  2) 컬럼별 trendRule을 off로 초기화(민구 확정: swap 아닌 클리어). v0.7.0 신기능이라
        //     운영 설정값이 거의 없고, 라벨(커짐→증가) 혼란을 방지한다.
        //  3) pctThreshold는 신규 필드 → 위 reconcileColumnFlags가 정규화(부적격/비유한수/≤0 제거).
        // idempotent: 이미 v6 이상이면 trendRule은 사용자가 새 의미로 설정한 값이므로 보존한다.
        // 다운그레이드 라운드트립 방어: v0.8.0(v6)에서 설정 → v5 번들로 열려 스토리지가 v5로
        // 재기록 → v0.8.0 재오픈 시 version<6이 다시 참이 되어 사용자가 v6에서 새로 지정한
        // trendRule을 또 지우는 문제가 있다. 1회성 마커(trendRuleClearedV6)로 "이미 클리어함"을
        // 기억해, 한 번 클리어된 뒤에는 재삭제하지 않는다.
        if (version < 6 && !s.trendRuleClearedV6) {
          delete s.trendAlertEnabled;
          // 조회 탭 범위(직전 조사/작기 전체) 모드 폐기 — 조회탭은 이제 최근 2회차 고정(WS4).
          delete s.reviewScope;
          if (Array.isArray(s.columns)) {
            s.columns = (s.columns as Column[]).map((c) => {
              const out = { ...c };
              delete out.trendRule; // 권고: off로 초기화
              // 대안(swap): delete 대신 의미 반전 변환을 쓰려면 아래로 교체.
              //   if (out.trendRule === 'increase') out.trendRule = 'decrease';
              //   else if (out.trendRule === 'decrease') out.trendRule = 'increase';
              return out;
            });
          }
          s.trendRuleClearedV6 = true;
        }

        // ── v7 (v0.12.0 AREA1) — 입력탭 출력 라우팅 토글(speakerOutput) 폐기 ───────────────
        // echoCancellation을 항상 ON으로 하드코딩하고 토글을 읽기전용 입력장치 CATEGORY 배지로
        // 교체했다(IOS-5 후속). 인터페이스에서 필드를 제거했으므로 영속값을 무조건 삭제한다
        // (다운그레이드 라운드트립 마커 불필요 — 필드 자체가 더는 존재하지 않음).
        if (version < 7) {
          delete s.speakerOutput;
        }

        // ── v8 (v0.13.0 R1) — 저장된 시트 목록(savedSheets) 도입 ───────────────────────────
        // 구버전 영속본엔 없으므로 안전 기본값 []로. 손상(배열 아님/항목 형태 불일치)도 []로 치유.
        if (
          !Array.isArray(s.savedSheets) ||
          !s.savedSheets.every(
            (x) =>
              x !== null &&
              typeof x === 'object' &&
              typeof (x as SavedSheet).name === 'string' &&
              typeof (x as SavedSheet).url === 'string' &&
              typeof (x as SavedSheet).sheetId === 'string' &&
              typeof (x as SavedSheet).addedAt === 'number',
          )
        ) {
          s.savedSheets = [];
        }

        // ── v9 (v0.15.0 A6) — 스피커폰(소프트 half-duplex) 모드 폐기 ───────────────────────────
        // speakerphoneMode 토글 + 그것으로 게이트되던 가드(TTS-중 명령차단·post-TTS 잔향 폐기·신뢰도
        // 상향)를 전부 삭제했다(민구 결정 + Trace: 회귀신호 0). 인터페이스에서 필드를 없앴으므로
        // 잔존 영속값을 무조건 삭제한다(다운그레이드 마커 불필요 — 필드 자체가 더는 존재하지 않음).
        if (version < 9) {
          delete s.speakerphoneMode;
        }

        // ── v10 (v0.19.0 W4) — "소음 환경 모드"(noisyMode) 폐기 ──────────────────────────────
        // 토글 UI(Vance)·라이브 참조(신뢰도 상향·단일문자 거부)·세션 meta 필드를 전부 삭제했다
        // (민구 결정: TTS 되읽기로 오인식 판독 가능 → 소음모드는 오히려 방해, 신뢰도 0.65 통일).
        // 인터페이스에서 필드를 없앴으므로 잔존 영속값을 무조건 삭제한다(다운그레이드 마커 불필요).
        if (version < 10) {
          delete s.noisyMode;
        }

        // ── v11 (v0.20.0) — 인식 허용범위(recognitionTolerance) 신설(기본 0.60) ──────────────
        // 구버전 영속본엔 필드가 없다. 위 무조건 coercion 블록(ttsRate 인접)이 누락/손상을 이미
        // 0.60으로 치유하므로 여기선 추가 작업이 필요 없다(version 게이트는 마이그레이션 기록용).
        // 신규 필드라 다운그레이드 라운드트립 마커는 불필요.

        // ── v0.22.0 — 자유입력 세션명(sessionCustomLabel) 신설(기본 null). persist version은
        //   올리지 않는다(불필요): zustand initializer 기본값(null) + 위 sessionAutoLabel 인접
        //   coercion이 누락/손상 영속본을 null로 치유하므로 version bump 없이 안전하다. (version을
        //   12로 올리면 settings-migration.spec의 version===11 단정 5건이 깨지는 것도 회피.)

        return s as SettingsState;
      },
    },
  ),
);
