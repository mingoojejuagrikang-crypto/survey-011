import { create } from 'zustand';
import type { Session } from '../types';

export type VoicePhase = 'ready' | 'active' | 'paused' | 'complete' | 'stopping' | 'done';

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
  /** v0.36.0 FB#2(Vance) — **미확정(interim) 인식 텍스트**의 표시 전용 필드. handleInterim이 매
   *  interim마다 기록(조기확정·커밋·텔레메트리와 무관한 순수 표시용). 실시간 파형과 함께 "지금
   *  이렇게 들었다(틀렸을 수 있음)"를 원거리에서 보여준다. 확정값(valueBurst)과 시각적으로 명확히
   *  구분(점선·흐림)한다. 커밋(handleFinal 진입)·리셋 시 null로 정리한다. null=표시 안 함. */
  interimValue: string | null;
  /** last TTS message echoed to screen */
  lastTts: string;
  /** I-3: most recent recognized value, shown as a screen-centered "항목 : 값" burst.
   *  `seq` increments per recognition so the UI can re-key and replay the animation. */
  valueBurst: { name: string; value: string; seq: number } | null;
  /** v0.9.0 — 이상치 알람 팝업. 알람 발동 시 이전값→현재값과 변화량을 화면에 띄운다(발화만으론
   *  스쳐 지나가 확인이 어렵다는 요청). '확인'/'유지'/새 값 입력 또는 다음 필드 진입 시 해제(null).
   *  changeText = '9.9%'(변동률 트리거) 또는 절대차 '2.2'(증가/감소 트리거).
   *  v0.12.0 AREA2 V2 — 어떤 샘플·행을 보는지 식별할 수 있게 row(1-indexed) + sampleKey(샘플키
   *  플래그 컬럼 합성, 없으면 undefined → 팝업은 '행 N'으로 폴백) + prevDate(직전 회차 ISO 날짜,
   *  과거값이 어느 조사 회차의 것인지 표기)를 동봉한다. */
  anomalyAlert: {
    colName: string;
    prev: string;
    next: string;
    direction: 'up' | 'down';
    changeText: string;
    row: number;
    sampleKey?: string;
    prevDate?: string;
    /** v0.13.0 R2 — 팝업 상태. 'pending'(또는 미지정)=이상치(빨강), 'corrected'=정정 재측정이
     *  정상으로 판명(초록). 정정 응답이 정상이면 같은 알람 객체의 next를 정정값으로 갱신하고
     *  status='corrected'로만 바꿔, 옛 이상치 값이 남아 echo TTS와 어긋나던 불일치를 없앤다. */
    status?: 'pending' | 'corrected';
    /** v0.20.0 입력탭#6 — 어떤 규칙이 발동했는지. 'trend'=추세 방향 알람(increase/decrease),
     *  'range'=변동률 % 임계(pctThreshold) 알람. Mack이 useVoiceSession.ts에서 trigger로 채운다.
     *  AnomalyAlertPopup(Vance)이 이 값으로 "추세 알람 …" vs "범위 알람 ±NN%" 표시를 가른다.
     *  미지정이면 팝업은 추세 형태로 폴백한다(기존 동작 보존). */
    kind?: 'trend' | 'range';
    /** v0.20.0 — range 알람일 때 임계 변동률(%). kind==='range'에서 팝업이 "±NN%"로 표시한다. */
    threshold?: number;
    /** v0.33.0 항목7 — 이 알람이 응답 대기(trendConfirm) 중인지. true=음성('확인'/'수정')·터치 버튼
     *  둘 다 유효(팝업이 [확인][수정] 버튼을 그린다). false/미지정=정보성 팝업(수동 입력 커밋의
     *  이상치 — 민구 확정: 시각+비프만, 확인 루프 없음 → 버튼 미표시). */
    awaitingResponse?: boolean;
    /** v0.34.0 A1 — 수동 입력(ManualValueSheet) 커밋 이상치의 **진행 보류** 팝업. true면 echo/advance
     *  가 보류된 상태(포인터는 커밋한 칩에 유지)로, [확인][수정] 버튼이 음성 trendConfirm 콜백 대신
     *  useVoiceSession.confirmManualAnomaly/modifyManualAnomaly로 라우팅된다(VoiceScreen이 분기).
     *  음성 확인 루프(trendConfirm)는 무장하지 않는다 — 민구 기존 결정 유지. */
    manualHold?: boolean;
    /** v0.34.0 A1 — 알람 대상 컬럼 id. manualHold의 [수정]이 해당 셀 ManualValueSheet를 재오픈할 때
     *  VoiceScreen이 컬럼을 되찾는 키(colName은 표시용이라 조회 키로 부적합). */
    colId?: string;
  } | null;
  /** v0.12.0 AREA2 V4 — '수정 값' 인디케이터. 수정 재안내(announceField isModify) 중 어떤 항목을
   *  다시 말해야 하는지 화면에 파란 pill로 띄운다. 일반 안내로 진입하면 null로 해제. anomalyAlert가
   *  떠 있을 땐 렌더하지 않는다(중앙 팝업과 겹침 방지 — VoiceScreen에서 상호배타 처리). */
  modifyIndicator: { name: string; colId: string } | null;
  /** v0.34.0 A2 — 전역 UI 모달 열림 신호. 'feedback'=개선요청 팝업(App.tsx 탭 인터셉트) 열림.
   *  useVoiceSession의 구독 effect가 열림에 suspendRecognitionForUi('feedback_modal'), 닫힘에
   *  resumeRecognitionForUi를 배선한다(세션 없으면 자연 no-op — 단일 배선·기능 격리).
   *  단일 작성자 = App.tsx(모달 소유자)뿐이므로 resetAll이 건드리지 않는다(세션 수명과 무관). */
  uiModalOpen: 'feedback' | null;
  /** v0.35.0 R3-FIX-2(리뷰 라운드3, Codex High·데이터무결성) — **최종 저장(stop) 실패** 상태.
   *  persistSession()이 false(IDB 쓰기 실패: 용량부족·DB 연결 종료·트랜잭션 실패)를 반환하면
   *  stop()이 phase를 'ready'로 내리지 **않고** 이 플래그를 세운다. VoiceScreen이 이 값으로 종료
   *  실패 배너(재시도 버튼)를 띄운다. null=정상.
   *
   *  왜 phase를 안 내리나: 'ready'가 되면 '음성 입력 시작' 버튼이 떠 사용자가 새 세션을 시작할 수
   *  있고, 그 start()의 resetAll이 **미저장 값·클립 포인터를 메모리에서 지워** 복구 기회가 영원히
   *  사라진다. v0.34.0 "durable 실패를 삼키지 않는다" 원칙(persistSession 성공 반환·persist_check)과
   *  같은 계약 — 실패는 화면에 남긴다.
   *
   *  retrying=재시도 IDB 쓰기 진행 중(버튼 잠금). 성공하면 stop()이 null로 지우고 ready로 전환. */
  persistError: { retrying: boolean } | null;
  /** v0.23.0 입력탭#2(재질문 사유, Mack) — 직전 음성 입력이 왜 재질문됐는지. 'low_confidence'=신뢰도가
   *  허용범위 미만, 'parse_failed'=인식은 됐으나 숫자/값으로 파싱 불가(항목명·잡음 거부 포함). null=정상.
   *  VoiceScreen(Vance)의 ReaskCue가 이 값으로 "소리가 불확실" vs "숫자로 인식 실패"를 구분 표시한다.
   *  성공 커밋·다음 필드 진입 시 null로 리셋한다(큐가 남지 않도록). 상단 인식률 %와는 독립. */
  reaskReason: 'low_confidence' | 'parse_failed' | null;
  /** v0.36.0 FB#4(Vance) — 소수점 유실 재질문의 **정수부**. null이 아니면 ReaskCue가 일반 사유 문구
   *  대신 소수 재질문 프롬프트(TTS와 글자 일치, voicePrompts.decimalReaskPrompt)를 표시한다. 소수
   *  재질문 진입 시 정수부로 설정, 그 외 모든 재질문·성공 커밋·리셋에서 null(setReaskReason이 함께
   *  정리 → 스테일 방지). 단일 작성 경로 = setDecimalReason. */
  reaskDecimalWhole: string | null;
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
  setInterimValue: (v: string | null) => void;
  setLastTts: (v: string) => void;
  pushValueBurst: (name: string, value: string) => void;
  setAnomalyAlert: (a: SessionState['anomalyAlert']) => void;
  setUiModalOpen: (m: SessionState['uiModalOpen']) => void;
  setPersistError: (e: SessionState['persistError']) => void;
  setModifyIndicator: (m: SessionState['modifyIndicator']) => void;
  setReaskReason: (r: SessionState['reaskReason']) => void;
  /** v0.36.0 FB#4 — 소수 재질문 진입: reason='parse_failed' + 정수부를 함께 세운다(원자적). */
  setDecimalReason: (whole: string) => void;
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
  restorePendingValidation: (session: Session) => void;
}

export const useSessionStore = create<SessionState>((set, get) => ({
  phase: 'ready',
  sessionId: '',
  startedAt: 0,
  sessionLabel: undefined,
  activeRow: 1,
  activeColIdx: 0,
  recognizedValue: '',
  interimValue: null,
  lastTts: '',
  valueBurst: null,
  anomalyAlert: null,
  uiModalOpen: null,
  persistError: null,
  modifyIndicator: null,
  reaskReason: null,
  reaskDecimalWhole: null,
  allRowValues: {},
  completedRows: [],
  skippedRows: [],
  returnRow: null,
  returnColIdx: null,

  setPhase: (phase) => set({ phase }),
  setSessionMeta: ({ sessionId, startedAt, label }) =>
    set({ sessionId, startedAt, sessionLabel: label }),
  setRecognized: (recognizedValue) => set({ recognizedValue }),
  setInterimValue: (interimValue) => set({ interimValue }),
  setLastTts: (lastTts) => set({ lastTts }),
  pushValueBurst: (name, value) =>
    set((s) => ({ valueBurst: { name, value, seq: (s.valueBurst?.seq ?? 0) + 1 } })),
  // v0.36.0 리뷰 라운드1(Codex+Flash, 수용) — 알람이 **서는** 순간 미확정 interim 표시를 함께
  //   정리한다(모든 알람 경로의 단일 지점). 알람 대기 중 final이 안 오면 이전 발화 찌꺼기가 재개
  //   화면에 현재 값처럼 남던 경로의 차단축. 표시 전용 필드라 커밋/텔레메트리 계약 무해.
  setAnomalyAlert: (anomalyAlert) =>
    set(anomalyAlert ? { anomalyAlert, interimValue: null } : { anomalyAlert }),
  setUiModalOpen: (uiModalOpen) => set({ uiModalOpen }),
  setPersistError: (persistError) => set({ persistError }),
  setModifyIndicator: (modifyIndicator) => set({ modifyIndicator }),
  // reaskReason의 모든 일반 갱신은 소수 정수부를 함께 정리한다(스테일 방지). 소수 재질문만
  //   setDecimalReason이 이 뒤에 정수부를 다시 세운다(호출 순서: 일반 setReaskReason → setDecimalReason).
  setReaskReason: (reaskReason) => set({ reaskReason, reaskDecimalWhole: null }),
  setDecimalReason: (whole) => set({ reaskReason: 'parse_failed', reaskDecimalWhole: whole }),
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

  restorePendingValidation: (session) => {
    const pending = session.pendingValidation;
    if (!pending) return;
    // 새로고침 뒤 후보값과 팝업을 함께 복구한다. phase='active'여도 실제 STT 컨트롤러는 아직 없지만,
    // manualHold 중앙 게이트가 모든 입력/이동을 막으므로 사용자는 [확인]/[수정]으로만 재개할 수 있다.
    const allRowValues = Object.fromEntries(session.rows.map((r) => [r.index, { ...r.values }]));
    set({
      phase: 'active',
      sessionId: session.id,
      startedAt: session.startedAt,
      sessionLabel: session.label,
      activeRow: pending.row,
      activeColIdx: pending.activeColIdx,
      recognizedValue: pending.candidateValue,
      allRowValues,
      completedRows: session.rows.filter((r) => r.complete).map((r) => r.index),
      skippedRows: session.rows.filter((r) => !r.complete).map((r) => r.index),
      anomalyAlert: pending.alert,
    });
  },

  resetAll: () =>
    set({
      phase: 'ready',
      sessionId: '',
      startedAt: 0,
      sessionLabel: undefined,
      activeRow: 1,
      activeColIdx: 0,
      recognizedValue: '',
      interimValue: null,
      lastTts: '',
      valueBurst: null,
      anomalyAlert: null,
      // v0.35.0 R3-FIX-2 — persistError는 세션 수명에 속하므로 여기서 지운다. 단 이 경로에 도달하려면
      //   phase가 'ready'여야 하고(start 버튼), 저장 실패 중엔 phase가 'ready'가 되지 않으므로
      //   실패 상태를 모르고 덮어쓰는 일은 없다(uiModalOpen과 달리 단일 작성자 = useVoiceSession).
      persistError: null,
      modifyIndicator: null,
      reaskReason: null,
      reaskDecimalWhole: null,
      allRowValues: {},
      completedRows: [],
      skippedRows: [],
      returnRow: null,
      returnColIdx: null,
    }),
}));
