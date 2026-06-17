import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Column, SheetConfig, LegacyInputMode } from '../types';
import type { ReviewFilter } from '../lib/reviewQuery';
import { inferSampleKey, reconcileColumnFlags } from '../lib/columnFlags';
import { isCycling } from '../lib/autoValue';

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
  /** v0.9.0 (딜레이 단축 실험) — 빠른 인식. true면 interim(중간) 결과가 유효 숫자로 안정되면
   *  브라우저 final(무음 종료감지)을 기다리지 않고 조기 커밋한다. 미완성 숫자 절단 리스크가 있어
   *  기본 false(실기기 A/B용). */
  fastRecognition: boolean;
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

  // ── v0.10.0 — 비교탭(ReviewScreen) 영속 상태. 해석/파생은 src/lib/reviewQuery.ts가 SSOT. ──
  /** 차원 AND 필터 칩 목록(모두 만족 샘플만, 교집합). 기본 []. */
  reviewFilters: ReviewFilter[];
  /** 비교 기준 회차(ISO). null = 인덱스의 최근 회차. */
  reviewTargetRound: string | null;
  /** baseline = target 기준 N회차 전(strictly before). 기본 1(직전). 최소 1. */
  reviewBaselineBack: number;
  /** 표시 차원(키) 컬럼 id 목록. null = 자동(가변 키 차원). */
  reviewGroupCols: string[] | null;
  /** 표시 측정 컬럼 id 목록. null = 자동(전 적격 측정). */
  reviewMeasureCols: string[] | null;
  /** 표시 행(샘플키) 목록. null = 후보 전체. 필터/회차 변경으로 후보가 바뀌면 호출자가 null 리셋. */
  reviewSelectedRows: string[] | null;

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

/** string[] 타입가드 — 비교탭 영속 배열(reviewGroupCols 등) 손상 방어용. */
function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
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
      fastRecognition: false,
      preferredVoiceName: '',
      teamFolderId: null,
      userLogFolderId: null,
      roundDateColId: null,
      // v0.10.0 — 비교탭 기본값(전부 자동/미선택 → 최근 회차·직전 baseline·후보 전체).
      reviewFilters: [],
      reviewTargetRound: null,
      reviewBaselineBack: 1,
      reviewGroupCols: null,
      reviewMeasureCols: null,
      reviewSelectedRows: null,

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
    }),
    {
      name: 'survey-011-settings-v3',
      version: 7,
      migrate: (persisted: unknown, version: number) => {
        const s = persisted as Partial<SettingsState> & {
          columns?: unknown[];
          trendAlertEnabled?: unknown;
          reviewScope?: unknown;
          speakerOutput?: unknown;
          trendRuleClearedV6?: boolean;
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
        if (typeof s.sessionLabelColId !== 'string' && s.sessionLabelColId !== null) s.sessionLabelColId = null;
        if (typeof s.sessionAutoLabel !== 'string' && s.sessionAutoLabel !== null) s.sessionAutoLabel = null;
        if (typeof s.noisyMode !== 'boolean') s.noisyMode = false;
        if (typeof s.speakerphoneMode !== 'boolean') s.speakerphoneMode = false;
        if (typeof s.fastRecognition !== 'boolean') s.fastRecognition = false;
        if (typeof s.preferredVoiceName !== 'string') s.preferredVoiceName = '';
        if (typeof s.teamFolderId !== 'string' && s.teamFolderId !== null) s.teamFolderId = null;
        if (typeof s.userLogFolderId !== 'string' && s.userLogFolderId !== null) s.userLogFolderId = null;
        // v0.7.0 — 조사시기(회차) 컬럼 id는 유지(UI만 v0.8.0 조회탭으로 이전 — WS4).
        if (typeof s.roundDateColId !== 'string' && s.roundDateColId !== null) s.roundDateColId = null;

        // ── v0.10.0 — 비교탭 영속 상태 기본값/타입가드. 손상·구버전 누락은 안전 기본값으로. ──
        if (
          !Array.isArray(s.reviewFilters) ||
          !s.reviewFilters.every(
            (f) =>
              f !== null &&
              typeof f === 'object' &&
              typeof (f as ReviewFilter).colId === 'string' &&
              typeof (f as ReviewFilter).value === 'string',
          )
        ) {
          s.reviewFilters = [];
        }
        if (typeof s.reviewTargetRound !== 'string' && s.reviewTargetRound !== null) s.reviewTargetRound = null;
        if (typeof s.reviewBaselineBack !== 'number' || !Number.isFinite(s.reviewBaselineBack) || s.reviewBaselineBack < 1) {
          s.reviewBaselineBack = 1;
        }
        if (s.reviewGroupCols !== null && !isStringArray(s.reviewGroupCols)) s.reviewGroupCols = null;
        if (s.reviewMeasureCols !== null && !isStringArray(s.reviewMeasureCols)) s.reviewMeasureCols = null;
        if (s.reviewSelectedRows !== null && !isStringArray(s.reviewSelectedRows)) s.reviewSelectedRows = null;

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
        return s as SettingsState;
      },
    },
  ),
);
