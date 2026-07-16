/* eslint-disable max-lines -- [ENV-12] 기존 초과 파일(GL-006 §5 도입 시점), Stage 2(섹션 분리)에서 해소. 해소 시 이 주석 제거. */
import { useEffect, useState } from 'react';
import { T } from '../tokens';
import { I, AuthMark } from '../components/icons';
import { ScreenHeader } from '../components/ScreenHeader';
import { makeSettingsDefaults, useSettingsStore } from '../stores/settingsStore';
import { saveSheetsRecord, deletePastIndexBackup } from '../lib/db';
import { prefetchPastIndex, resetPastIndexRetries } from '../lib/pastValues';
import { ConnectionStatusCard } from '../components/ConnectionStatusCard';
import type { Column, DataType } from '../types';
import {
  getAccessToken,
  getCurrentEmail,
  getStoredToken,
  isConfigured as isGoogleConfigured,
  onTokenSettled,
  signIn as googleSignIn,
  signOut as googleSignOut,
  warmupGoogleAuth,
} from '../lib/googleAuth';
import {
  fetchHeaderAndSample,
  fetchSpreadsheetMeta,
  fetchColumnUniqueValues,
  inferColumns,
  preserveInferredColumnIds,
  parseSpreadsheetId,
  readonlySheetsAuth,
} from '../lib/sheets';
import { computeTotalRows } from '../lib/autoValue';
import { buildSessionLabel, pickSessionLabelValue } from '../lib/sessionLabel';
import { getPickerApiKey, openDrivePicker } from '../lib/drivePicker';
import { setPreferredVoiceName } from '../lib/speech';
import { logger } from '../lib/logger';
import { HelpButton, SettingsHelpModal } from '../components/settings/SettingsHelp';
import { COLUMN_HELP, DATA_TYPE_HELP, FIRST_ENTRY_TIP, SETTINGS_TIP_SEEN_KEY } from '../components/settings/helpCopy';
import { UpdateControl } from '../components/settings/UpdateControl';
import { ColumnCard } from '../components/settings/ColumnCard';
import { TtsVoiceSelector } from '../components/settings/TtsVoiceSelector';
import { BeepPicker } from '../components/settings/BeepPicker';
import { TypeReviewModal } from '../components/settings/TypeReviewModal';
import { TablePreviewModal } from '../components/settings/TablePreviewModal';
import { SettingsSummary } from '../components/settings/SettingsSummary';
import { SettingsSummaryModal } from '../components/settings/SettingsSummaryModal';
import { SettingsResetModal } from '../components/settings/SettingsResetModal';

// ─── screen root ───────────────────────────────────────────────
/** S-2: a column whose saved type differs from the sheet's inferred data type. */
interface TypeMismatch { id: string; name: string; saved: DataType; sheet: DataType; }

export function SettingsScreen({ onNavigateToInput }: { onNavigateToInput?: () => void } = {}) {
  const s = useSettingsStore();
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmedUrl, setConfirmedUrl] = useState<string>(s.sheetUrl);
  // v0.32.0 설정탭 UX(Vance) B2/B3 — 설정 요약 팝업 + 초기화 확인 모달(설정탭 전용).
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  // S-2: result of "타입 검토" (null = not run; checked = columns compared).
  const [typeReview, setTypeReview] = useState<{ mismatches: TypeMismatch[]; checked: number } | null>(null);
  const [tablePreviewOpen, setTablePreviewOpen] = useState(false);
  // v0.19.0 W3 — "입력 테이블 생성/재생성" 클릭 시 먼저 뜨는 '최종 설정값 확인' 게이트.
  const [generateGateOpen, setGenerateGateOpen] = useState(false);
  const [showUrlInput, setShowUrlInput] = useState(false);
  // v0.14.0 F — 저장된 시트 목록을 기본 접힌 드롭다운으로(세로 풀리스트가 시트 多 시 화면 점유 과다).
  const [savedSheetsOpen, setSavedSheetsOpen] = useState(false);
  // v0.35.0 FB-E(Vance) — 하단 인라인 설정 요약을 접기식·기본 접힘으로(온디맨드). 인라인 자체는
  //   유지(제거하면 C10 스크롤 마찰 재발) — 헤더 탭으로만 펼친다. savedSheetsOpen과 동일 패턴.
  const [summaryInlineOpen, setSummaryInlineOpen] = useState(false);
  // v0.23.0 설정탭#4(Vance) — `?` 도움말 팝업 열림 여부(카드별 `?` 또는 첫 진입 안내의 "자세히").
  const [helpOpen, setHelpOpen] = useState(false);
  // v0.23.0 설정탭#4 — 첫 진입 안내 배너(1회 dismissible). "본 적 있는지"는 localStorage에 영속
  //   (settingsStore version bump 회피 — settings-migration.spec의 version===11 단정 보호). 초기값은
  //   lazy로 읽어, 이미 본 적 있으면 처음부터 숨긴다. 테스트는 fresh context라 매번 뜨므로, 이 배너는
  //   fixed 오버레이가 아니라 스크롤 영역 내부 인라인 배너 → 기존 Playwright 클릭 흐름을 막지 않는다.
  const [tipDismissed, setTipDismissed] = useState<boolean>(() => {
    try { return localStorage.getItem(SETTINGS_TIP_SEEN_KEY) === '1'; } catch { return false; }
  });
  const dismissTip = () => {
    setTipDismissed(true);
    try { localStorage.setItem(SETTINGS_TIP_SEEN_KEY, '1'); } catch { /* private mode 등 */ }
  };
  const googleConfigured = isGoogleConfigured();
  const previewRowCount = computeTotalRows(s.columns);
  const pickerAvailable = s.googleConnected && !!getPickerApiKey();

  useEffect(() => {
    const t = getStoredToken();
    if (t && !s.googleConnected) {
      s.set({ googleConnected: true, userEmail: getCurrentEmail() });
    } else if (!t && s.googleConnected) {
      // v0.13.0 R1 — 토큰 만료/소실 시 googleConnected를 강등한다. 토큰은 ~1시간이면 만료되는데
      // (refresh token 없음, [AUTH-4]) googleConnected는 통째로 persist되어 true로 재하이드레이트
      // 됐다. 그래서 UI는 '연결됨'이라 거짓 표시하지만 모든 시트 읽기/쓰기는 토큰 없음으로 실패 →
      // 사용자가 '연결이 풀렸다'고 느끼고 매번 URL을 다시 붙여넣던 혼란의 근본. 정직하게 강등해
      // '재로그인 필요'를 노출하고, 재로그인 후엔 저장 URL을 자동 재연결(아래 onGoogleClick)한다.
      // v0.34.0 계측 갭① — 토큰 소실이 '발견'되는 유일한 지점(만료는 이벤트가 아니라 상태)이라
      // 여기서 token_expired를 남긴다. googleConnected=true→false 전이에서만 오므로 로그아웃
      // 상태의 매 마운트마다 반복되지 않는다. 수동 로그아웃은 signOut('manual'|...)이 별도 로깅.
      logger.log({ type: 'app', extra: 'auth_signout:token_expired' });
      s.set({ googleConnected: false });
    }
    // S-1: preload GIS + token client so the first 로그인 click opens the popup in one shot
    // (avoids the "popup_failed_to_open" that required a second click).
    void warmupGoogleAuth();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // v0.29.0 (Mack, 2026-07-07 A5 finding #1) — late-success reconciliation. signIn()'s own
  // SIGNIN_TIMEOUT_MS can fire and reject BEFORE a slow real-world 2FA flow (~60s+ observed)
  // actually completes; the onGoogleClick catch block below then shows "로그인 응답이 지연되어
  // 취소되었습니다" even though the GIS callback lands moments later with a genuine token
  // (storeToken already ran — localStorage has it). Without this subscription the UI stayed
  // wrong ("로그인 실패") until the user remounted the tab (reload / tab-away-and-back), because
  // googleConnected only re-synced from getStoredToken() at mount. Subscribing here closes that
  // gap reactively — no remount needed — using the already-existing onTokenSettled broadcast
  // (googleAuth.ts now fires it for late arrivals too, decoupled from the timed-out promise).
  useEffect(() => {
    const unsubscribe = onTokenSettled(({ email }) => {
      setError(null);
      useSettingsStore.getState().set({ googleConnected: true, userEmail: email });
    });
    return unsubscribe;
  }, []);

  const onGoogleClick = async () => {
    setError(null);
    if (s.googleConnected) {
      await googleSignOut();
      s.set({ googleConnected: false, userEmail: null });
      return;
    }
    if (!googleConfigured) {
      setError('.env.local의 VITE_GOOGLE_CLIENT_ID를 설정해주세요');
      return;
    }
    try {
      setLoading('Google 로그인 중...');
      const { email } = await googleSignIn();
      s.set({ googleConnected: true, userEmail: email });
      // v0.13.0 R1 — 재로그인 직후, 직전에 쓰던 시트(sheetUrl)가 있으면 자동 재연결한다(사용자가
      // 매번 Drive에서 공유링크를 다시 붙여넣지 않도록). 토큰이 막 갱신됐으므로 authFetch가 성공한다.
      const prevUrl = useSettingsStore.getState().sheetUrl.trim();
      if (prevUrl) await onUrlConfirmWithUrl(prevUrl);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(null);
    }
  };

  /** URL 입력은 상태만 갱신, 적용은 confirm 버튼에서 */
  const onUrlTyping = (url: string) => {
    s.set({ sheetUrl: url });
    setError(null);
  };

  /** "확인" 버튼: 현재 URL로 시트 정보 조회 시도 */
  const onUrlConfirm = async () => {
    setError(null);
    const url = s.sheetUrl.trim();
    if (!url) { setError('URL을 입력하세요.'); return; }
    if (!s.googleConnected) { setError('먼저 Google 로그인 후 다시 확인하세요.'); return; }
    await onUrlConfirmWithUrl(url);
  };

  const onSheetTabChange = async (newTab: string) => {
    s.set({ sheetTab: newTab });
    const id = parseSpreadsheetId(s.sheetUrl);
    if (id) await loadHeaders(id, newTab);
  };

  const loadHeaders = async (spreadsheetId: string, sheetTitle: string) => {
    try {
      setLoading('컬럼 분석 중...');
      const { headers, sample } = await fetchHeaderAndSample(spreadsheetId, sheetTitle);
      const inferred = preserveInferredColumnIds(
        inferColumns(headers, sample),
        useSettingsStore.getState().columns,
      );
      // For 'options' columns, fetch a richer set of unique values
      const enriched = await Promise.all(
        inferred.map(async (c, i) => {
          if (c.type !== 'options' || c.auto.kind !== 'options') return c;
          try {
            const uniq = await fetchColumnUniqueValues(spreadsheetId, sheetTitle, i, 500);
            return {
              ...c,
              auto: { kind: 'options' as const, available: uniq, selected: c.auto.selected },
            };
          } catch {
            return c;
          }
        }),
      );
      if (enriched.length) s.set({ columns: enriched, tableGenerated: false });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(null);
    }
  };

  // S-2: re-sample the connected sheet and compare each saved column type against the sheet's
  // inferred data type. 'options' is an app construct (not a sheet data type) so it's skipped on
  // either side — only date/int/float/text mismatches are surfaced. Reuses inferColumns (loadHeaders).
  const reviewTypes = async () => {
    setError(null);
    const id = parseSpreadsheetId(s.sheetUrl);
    if (!id || !s.sheetTab) {
      setError('먼저 스프레드시트와 탭을 연결한 뒤 검토할 수 있어요.');
      return;
    }
    try {
      setLoading('시트 데이터형 검토 중...');
      const { headers, sample } = await fetchHeaderAndSample(id, s.sheetTab);
      const inferred = inferColumns(headers, sample);
      const sheetTypeByName = new Map(inferred.map((c) => [c.name.trim(), c.type]));
      let checked = 0;
      const mismatches: TypeMismatch[] = [];
      for (const col of s.columns) {
        const sheetType = sheetTypeByName.get(col.name.trim());
        if (!sheetType) continue;                 // no matching header (auto/derived column)
        if (sheetType === 'options' || col.type === 'options') continue; // skip app-only 'options'
        if (sheetType === 'name' || col.type === 'name') continue;       // skip app-only 'name'
        checked++;
        if (sheetType !== col.type) {
          mismatches.push({ id: col.id, name: col.name, saved: col.type, sheet: sheetType });
        }
      }
      setTypeReview({ mismatches, checked });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(null);
    }
  };

  const onPickerClick = async () => {
    setError(null);
    const token = getAccessToken();
    if (!token) {
      setError('먼저 Google 로그인 후 Drive에서 선택하세요.');
      return;
    }
    try {
      setLoading('Drive 파일 선택 중...');
      const result = await openDrivePicker(token);
      if (result) {
        s.set({ sheetUrl: result.url });
        setConfirmedUrl('');
        setError(null);
        await onUrlConfirmWithUrl(result.url);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(null);
    }
  };

  /** v0.13.0 R1 — 저장 목록에서 시트를 선택하면 활성 시트로 전환(URL 세팅 후 메타 재조회). 토큰이
   *  만료됐으면 onUrlConfirmWithUrl 내부 authFetch가 실패하므로, 그 경우 재로그인을 안내한다. */
  const onSelectSavedSheet = async (entry: { url: string }) => {
    setError(null);
    if (!s.googleConnected || !getAccessToken()) {
      // 연결이 풀린(토큰 만료) 상태 — URL만 세팅해 두고 재로그인을 유도한다(재로그인 후 자동 재연결).
      // availableSheets/sheetTab도 함께 비워, 저장목록의 'active 배지'(새 시트)와 아래 탭 셀렉터(직전
      // 시트의 탭 목록)가 어긋나지 않게 한다 — onUrlConfirmWithUrl의 선(先)리셋과 동일 처리.
      s.set({ sheetUrl: entry.url, availableSheets: [], sheetTab: '' });
      setConfirmedUrl('');
      setError('연결이 만료되었습니다. Google 로그인을 다시 하면 이 시트로 자동 연결됩니다.');
      return;
    }
    s.set({ sheetUrl: entry.url });
    setConfirmedUrl('');
    await onUrlConfirmWithUrl(entry.url);
  };

  const onUrlConfirmWithUrl = async (url: string) => {
    const id = parseSpreadsheetId(url);
    if (!id) { setError('스프레드시트 URL 형식이 올바르지 않습니다.'); return; }
    s.set({ availableSheets: [], sheetTab: '' });
    try {
      setLoading('시트 정보 조회 중...');
      const meta = await fetchSpreadsheetMeta(id);
      const tabs = meta.sheets.map((sh) => sh.title);
      s.set({ availableSheets: tabs, sheetTab: tabs[0] || '' });
      if (tabs[0]) await loadHeaders(id, tabs[0]);
      setConfirmedUrl(url);
      // v0.13.0 R1 — 연결에 성공한 시트를 '파일명'(meta.title)으로 저장 목록에 자동 등록한다(민구
      // 요청). sheetId 기준 dedupe(saveSheet) — 같은 시트 재연결 시 최근 사용으로 갱신만 된다.
      s.saveSheet({ name: meta.title || url, url, sheetId: id, addedAt: Date.now() });
      // v0.34.0 C9(b) — 시트 연결 확정 직후 프리페치. 이 함수는 Drive Picker 선택·저장목록 선택·
      // URL 확인·재로그인 자동 재연결의 공통 종점이라 여기 1곳 배선으로 전부 커버된다(단일 배선).
      // 컬럼은 위 loadHeaders가 방금 교체했을 수 있으므로 getState()로 최신을 읽는다.
      const st = useSettingsStore.getState();
      const anyRule = st.columns.some(
        (c) => c.trendRule === 'increase' || c.trendRule === 'decrease' || c.pctThreshold != null,
      );
      if (anyRule && readonlySheetsAuth()) { resetPastIndexRetries(); prefetchPastIndex(); }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(null);
    }
  };

  // v0.19.0 W3 — "입력 테이블 생성"/"재생성"은 더 이상 클릭 즉시 생성하지 않는다.
  //   클릭 → 먼저 '최종 설정값 확인' 게이트(TablePreviewModal에 confirmMode로 진입)를 띄우고,
  //   "확인(생성)"을 눌렀을 때만 실제 생성 부수효과(s.set 등)를 실행한다. "취소"면 미생성.
  //   요약(총 행수·세션 라벨)은 store의 (이미 생성됐을 수 있는) 값이 아니라 '현재 columns'에서
  //   파생해 stale을 피한다.
  // v0.22.0 — 세션명 우선순위: 사용자 자유입력(sessionCustomLabel) > (생성일 + 세션 상수들) >
  //   생성일 단독. SSOT는 sessionLabel.buildSessionLabel(입력탭 buildAutoLabel과 동일 결과).
  //   단, 사용자가 세션명 *컬럼*을 명시 선택(sessionLabelColId)한 경우는 그 컬럼 값만 접미로 쓰는
  //   기존 동작을 보존한다(자유입력이 없을 때만). 자유입력이 있으면 무엇보다 우선한다.
  const prospectiveSessionLabel = () => {
    const isoDate = new Date().toISOString().slice(0, 10);
    const custom = (s.sessionCustomLabel ?? '').trim();
    if (custom) return custom; // 자유입력 최우선(날짜 미접두)
    const pickedCol = s.sessionLabelColId
      ? s.columns.find((c) => c.id === s.sessionLabelColId)
      : null;
    if (pickedCol) {
      const colVal = pickSessionLabelValue(s.columns, pickedCol);
      return colVal ? `${isoDate} ${colVal}` : isoDate;
    }
    return buildSessionLabel(s.columns, { isoDate });
  };

  // 게이트 열기 — 생성/재생성 모두 동일 경로. 부수효과는 onGenerateConfirm까지 미룬다.
  const onGenerate = () => {
    // v0.33.0 B-10 — 생성 게이트 열림 계측(생성 퍼널 가시화 — 이전엔 무로깅).
    logger.log({ type: 'command', parsed: 'ui_open', extra: 'generate_gate' });
    setGenerateGateOpen(true);
  };

  // "확인(생성)" — 여기서만 실제 생성 부수효과 실행.
  const onGenerateConfirm = () => {
    const total = computeTotalRows(s.columns);
    const sessionAutoLabel = prospectiveSessionLabel();
    s.set({ tableGenerated: true, totalRows: total, sessionAutoLabel });
    // v0.33.0 항목5 — 테이블 생성 시점 프리페치(세션 시작 start()와 동일 조건). 생성 직후엔 대개
    // 토큰이 살아 있으므로 여기서 미리 당겨 두면, 세션 시작이 늦어져 토큰이 만료돼도 IDB
    // write-through 스냅샷이 폴백으로 남는다(07-13 §4 침묵 창 축소).
    const anyAnomalyRule = s.columns.some(
      (c) => c.trendRule === 'increase' || c.trendRule === 'decrease' || c.pctThreshold != null,
    );
    // v0.34.0 C9(a) — 토큰 조건을 (토큰 || API key)로 완화(readonlySheetsAuth SSOT). 공개 시트면
    // 미로그인 생성 직후에도 과거값이 준비된다(민구: "시트가 연결되면 자동으로 작동해야 함").
    if (anyAnomalyRule && readonlySheetsAuth()) { resetPastIndexRetries(); prefetchPastIndex(); }
    setGenerateGateOpen(false);
  };

  /** v0.32.0 설정탭 UX(Vance) B3 — 전체 초기화. 컬럼·행수·세션명·다이얼·음성/검토 옵션·생성 상태를
   *  기본값(makeSettingsDefaults SSOT)으로 되돌린다. Google 로그인·시트 URL·저장된 시트는 기본
   *  **보존**(민구 확정) — 모달 체크박스로만 opt-in 삭제. 세션 데이터·클립·로그(IDB)는 건드리지 않는다. */
  const onResetConfirm = async ({ clearLogin, clearSheets }: { clearLogin: boolean; clearSheets: boolean }) => {
    const d = makeSettingsDefaults();
    s.set({
      columns: d.columns, // fresh copy — makeSettingsDefaults가 호출마다 새 객체를 만든다
      tableGenerated: false,
      totalRows: d.totalRows,
      ttsRate: d.ttsRate,
      recognitionTolerance: d.recognitionTolerance,
      fastRecognition: d.fastRecognition,
      // v0.33.0 항목10 — 자동 캡처·비프음 선택도 기본값으로(초기화 SSOT = makeSettingsDefaults).
      autoScreenCapture: d.autoScreenCapture,
      beepPositiveId: d.beepPositiveId,
      beepNegativeId: d.beepNegativeId,
      beepVolume: d.beepVolume, // v0.35.0 FIX-5(리뷰 라운드1) — 볼륨도 기본값 복원(누락 수리).
      manualMode: d.manualMode,
      preferredVoiceName: d.preferredVoiceName,
      sessionLabelColId: d.sessionLabelColId,
      sessionAutoLabel: d.sessionAutoLabel,
      sessionCustomLabel: d.sessionCustomLabel,
      roundDateColId: d.roundDateColId,
    });
    setPreferredVoiceName(''); // 라이브 speech 모듈도 스토어 기본값과 동기화
    setTypeReview(null);
    if (clearLogin) {
      await googleSignOut('settings_reset'); // 토큰 없으면 no-op(clearToken만) — 로그아웃 상태에서도 안전
      s.set({ googleConnected: false, userEmail: null });
    }
    if (clearSheets) {
      s.set({ sheetUrl: '', sheet: null, sheetTab: '', availableSheets: [], savedSheets: [] });
      // 전용 IDB 레코드(onRehydrateStorage 복원 경로)도 함께 비운다 — 안 비우면 다음 부팅에서 되살아남.
      void saveSheetsRecord({ savedSheets: [], sheetUrl: '', updatedAt: Date.now() });
      // v0.33.0 항목5 — 과거값 인덱스 영속 스냅샷도 함께 삭제(시트를 지웠으면 그 시트의 비교선도
      // 무의미 — fp 불일치로 어차피 안 쓰이지만 데이터 위생).
      void deletePastIndexBackup();
      setConfirmedUrl('');
    }
    // 첫 진입 안내 배너 재노출(초기화 = 처음부터 다시 시작하는 사용자).
    try { localStorage.removeItem(SETTINGS_TIP_SEEN_KEY); } catch { /* private mode 등 */ }
    setTipDismissed(false);
    logger.log({
      type: 'app',
      extra: `settings_reset:login=${clearLogin ? 'cleared' : 'kept'},sheet=${clearSheets ? 'cleared' : 'kept'}`,
    });
    setResetOpen(false);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <ScreenHeader
        sub="오늘의 측정 항목과 시트 연결"
        right={<HelpButton onOpen={() => setHelpOpen(true)} label="설정 도움말" testid="settings-help-button" />}
      />

      <div
        style={{
          flex: 1, minHeight: 0,
          overflowY: 'auto', overflowX: 'hidden',
          WebkitOverflowScrolling: 'touch',
          paddingBottom: 12,
        }}
      >
        {/* v0.23.0 설정탭#4(Vance) — 첫 진입 1회 안내 배너(dismissible). 스크롤 영역 내부 인라인
            배너라 fixed 오버레이와 달리 버튼/카드 탭을 가로채지 않는다(기존 Playwright 흐름 보존).
            "자세히"로 전체 설명 팝업을, ✕로 영구 닫기(localStorage). */}
        {!tipDismissed && (
          <div
            data-testid="settings-first-tip"
            role="note"
            style={{
              margin: '8px 16px 0', padding: '12px 14px', borderRadius: 14,
              background: 'rgba(41,121,255,0.10)', border: `1px solid ${T.blue}`,
              display: 'flex', alignItems: 'flex-start', gap: 10,
            }}
          >
            <span aria-hidden style={{ fontSize: 18, flexShrink: 0, lineHeight: 1.4 }}>💡</span>
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span style={{ fontSize: 14, color: T.text, fontWeight: 600, lineHeight: 1.5, wordBreak: 'keep-all' }}>
                {FIRST_ENTRY_TIP}
              </span>
              <button
                type="button"
                onClick={() => setHelpOpen(true)}
                style={{
                  alignSelf: 'flex-start', minHeight: 36, padding: '0 14px', borderRadius: 999,
                  border: `1px solid ${T.blue}`, background: 'transparent',
                  color: T.blue, fontSize: 13, fontWeight: 800, cursor: 'pointer',
                }}
              >
                자세히 보기
              </button>
            </div>
            <button
              type="button"
              onClick={dismissTip}
              aria-label="안내 닫기"
              data-testid="settings-first-tip-dismiss"
              style={{
                flexShrink: 0, width: 36, height: 36, borderRadius: '50%',
                border: `1px solid ${T.lineStrong}`, background: 'transparent',
                color: T.textDim, fontSize: 15, cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
              title="닫기"
            >
              ✕
            </button>
          </div>
        )}

        {/* v0.32.0 설정탭 UX(Vance) B2/B3 — 유틸리티 행(항상 첫 콘텐츠 행): 설정 요약 팝업 + 초기화.
            버튼 문구에 '생성' 부분문자열 금지(기존 스펙의 hasText:'생성' .last() 헬퍼 보호). */}
        <div style={{ padding: '8px 16px 10px', display: 'flex', gap: 8 }}>
          <button
            type="button"
            data-testid="settings-summary-open"
            onClick={() => {
              // v0.33.0 B-10 — 설정 요약 팝업 열림 계측.
              logger.log({ type: 'command', parsed: 'ui_open', extra: 'settings_summary' });
              setSummaryOpen(true);
            }}
            style={{
              flex: 1, minHeight: 40, borderRadius: 12,
              border: `1px solid ${T.lineStrong}`, background: T.card,
              color: T.textDim, fontSize: 13, fontWeight: 800, letterSpacing: -0.2,
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}
          >
            {I.table(15, T.textDim)} 설정 요약
          </button>
          <button
            type="button"
            data-testid="settings-reset-open"
            onClick={() => setResetOpen(true)}
            style={{
              minHeight: 40, padding: '0 16px', borderRadius: 12,
              border: '1px solid rgba(255,82,82,0.40)', background: 'rgba(255,82,82,0.08)',
              color: T.red, fontSize: 13, fontWeight: 800, letterSpacing: -0.2, cursor: 'pointer',
            }}
          >
            초기화
          </button>
        </div>

        {/* Section 1 - Google + Sheet URL */}
        <div style={{ padding: '0 16px', flexShrink: 0 }}>
          <div
            style={{
              background: T.card, borderRadius: 16, padding: 14,
              border: `1px solid ${T.line}`,
              display: 'flex', flexDirection: 'column', gap: 10,
            }}
          >
            <button
              onClick={onGoogleClick}
              disabled={loading !== null}
              style={{
                height: 56, borderRadius: 14,
                border: `1px solid ${s.googleConnected ? 'rgba(0,200,83,0.35)' : T.lineStrong}`,
                background: s.googleConnected ? 'rgba(0,200,83,0.10)' : '#2A2D32',
                color: T.text, fontSize: 17, fontWeight: 700,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12,
                cursor: loading ? 'wait' : 'pointer', letterSpacing: -0.2,
                opacity: loading ? 0.7 : 1,
              }}
            >
              <AuthMark s={22} />
              {s.googleConnected ? (
                <>
                  연결됨 · <span style={{ color: T.textDim, fontWeight: 500 }}>{s.userEmail}</span>
                </>
              ) : (
                <>Google 로그인</>
              )}
              {s.googleConnected && I.check(20, T.green)}
            </button>

            {pickerAvailable ? (
              /* Drive Picker를 주 동작으로 승격 */
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <button
                  onClick={onPickerClick}
                  disabled={loading !== null}
                  style={{
                    height: 52, borderRadius: 12, border: 'none',
                    background: T.blue, color: '#fff',
                    fontSize: 15, fontWeight: 800, letterSpacing: -0.2,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                    cursor: loading ? 'wait' : 'pointer',
                    boxShadow: `0 4px 14px ${T.blueGlow}`,
                    opacity: loading ? 0.7 : 1,
                  }}
                >
                  {I.link(16, '#fff')} Drive에서 시트 선택
                </button>
                {s.sheetUrl && (
                  <div
                    style={{
                      fontSize: 12, color: T.textMute, padding: '0 4px',
                      wordBreak: 'break-all', lineHeight: 1.4,
                    }}
                  >
                    {confirmedUrl && s.sheetUrl === confirmedUrl
                      ? <span style={{ color: T.green }}>{I.check(12, T.green)} 연결됨 · </span>
                      : null}
                    <span style={{ fontFamily: 'JetBrains Mono, ui-monospace, monospace', fontSize: 11 }}>
                      {s.sheetUrl.replace(/^https?:\/\//, '').slice(0, 60)}{s.sheetUrl.length > 60 ? '…' : ''}
                    </span>
                  </div>
                )}
                <button
                  onClick={() => setShowUrlInput((v) => !v)}
                  style={{
                    alignSelf: 'flex-start',
                    background: 'transparent', border: 'none',
                    color: T.textMute, fontSize: 12, fontWeight: 600,
                    cursor: 'pointer', textDecoration: 'underline', padding: 0,
                  }}
                >
                  {showUrlInput ? '▲ URL 직접 입력 숨기기' : '▼ URL 직접 입력'}
                </button>
                {showUrlInput && (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <div
                      style={{
                        flex: 1, height: 52, borderRadius: 12,
                        background: T.inputBg, border: `1px solid ${T.line}`,
                        display: 'flex', alignItems: 'center', gap: 10, padding: '0 12px',
                        minWidth: 0,
                      }}
                    >
                      <div style={{ color: T.textMute }}>{I.link(18)}</div>
                      <input
                        value={s.sheetUrl}
                        onChange={(e) => onUrlTyping(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') onUrlConfirm(); }}
                        placeholder="스프레드시트 URL 붙여넣기"
                        style={{
                          flex: 1, background: 'transparent', border: 'none', outline: 'none',
                          fontSize: 15, color: T.text, minWidth: 0,
                        }}
                      />
                    </div>
                    {(() => {
                      const applied = s.sheetUrl.trim() === confirmedUrl.trim() && s.availableSheets.length > 0;
                      const canConfirm = !!s.sheetUrl.trim() && !applied && !loading;
                      return (
                        <button
                          onClick={onUrlConfirm}
                          disabled={!canConfirm && !applied}
                          style={{
                            height: 52, padding: '0 16px', borderRadius: 12,
                            border: 'none',
                            background: applied ? 'rgba(0,200,83,0.18)' : canConfirm ? T.blue : '#2A2D32',
                            color: applied ? T.green : canConfirm ? '#fff' : T.textMute,
                            fontSize: 14, fontWeight: 800, letterSpacing: -0.2,
                            cursor: canConfirm ? 'pointer' : 'default',
                            display: 'flex', alignItems: 'center', gap: 6,
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {applied ? <>{I.check(16, T.green)} 적용됨</> : '확인'}
                        </button>
                      );
                    })()}
                  </div>
                )}
              </div>
            ) : (
              /* Picker 미사용 — 기존 URL 입력 방식 */
              <div style={{ display: 'flex', gap: 8 }}>
                <div
                  style={{
                    flex: 1, height: 52, borderRadius: 12,
                    background: T.inputBg, border: `1px solid ${T.line}`,
                    display: 'flex', alignItems: 'center', gap: 10, padding: '0 12px',
                    minWidth: 0,
                  }}
                >
                  <div style={{ color: T.textMute }}>{I.link(18)}</div>
                  <input
                    value={s.sheetUrl}
                    onChange={(e) => onUrlTyping(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') onUrlConfirm(); }}
                    placeholder="스프레드시트 URL 붙여넣기"
                    style={{
                      flex: 1, background: 'transparent', border: 'none', outline: 'none',
                      fontSize: 15, color: T.text, minWidth: 0,
                    }}
                  />
                </div>
                {(() => {
                  const applied = s.sheetUrl.trim() === confirmedUrl.trim() && s.availableSheets.length > 0;
                  const canConfirm = !!s.sheetUrl.trim() && !applied && !loading;
                  return (
                    <button
                      onClick={onUrlConfirm}
                      disabled={!canConfirm && !applied}
                      style={{
                        height: 52, padding: '0 16px', borderRadius: 12,
                        border: 'none',
                        background: applied ? 'rgba(0,200,83,0.18)' : canConfirm ? T.blue : '#2A2D32',
                        color: applied ? T.green : canConfirm ? '#fff' : T.textMute,
                        fontSize: 14, fontWeight: 800, letterSpacing: -0.2,
                        cursor: canConfirm ? 'pointer' : 'default',
                        display: 'flex', alignItems: 'center', gap: 6,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {applied ? <>{I.check(16, T.green)} 적용됨</> : '확인'}
                    </button>
                  );
                })()}
              </div>
            )}

            {/* v0.13.0 R1 — 저장된 시트 목록(파일명). 한 번 연결한 시트는 자동 저장되어, 토큰 만료로
                연결이 풀려도 매번 공유링크를 다시 붙여넣지 않고 여기서 한 번에 다시 선택할 수 있다. */}
            {s.savedSheets.length > 0 && (() => {
              const activeSheetId = parseSpreadsheetId(s.sheetUrl);
              const activeName = s.savedSheets.find((x) => x.sheetId === activeSheetId)?.name ?? null;
              return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {/* v0.14.0 F — 기본 접힌 드롭다운 헤더. 접힌 상태로도 '사용 중' 시트명을 보여줘 식별
                    가능하고, 탭하면 전체 목록(선택/삭제)이 펼쳐진다. 시트가 많아도 화면 점유 최소. */}
                <button
                  onClick={() => setSavedSheetsOpen((v) => !v)}
                  aria-expanded={savedSheetsOpen}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, minWidth: 0,
                    background: T.inputBg, border: `1px solid ${T.line}`, borderRadius: 12,
                    padding: '10px 12px', cursor: 'pointer', color: T.text, textAlign: 'left',
                  }}
                >
                  <span style={{ fontSize: 13, fontWeight: 800, color: T.textDim, flexShrink: 0 }}>
                    저장된 시트 ({s.savedSheets.length})
                  </span>
                  <span
                    style={{
                      flex: 1, minWidth: 0, fontSize: 13, fontWeight: 700,
                      color: activeName ? T.green : T.textMute, textAlign: 'right',
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}
                  >
                    {activeName ?? (savedSheetsOpen ? '' : '탭하여 선택')}
                  </span>
                  <span
                    style={{
                      flexShrink: 0, display: 'inline-flex',
                      transform: savedSheetsOpen ? 'rotate(180deg)' : 'none', transition: 'transform 150ms',
                    }}
                  >
                    {I.chevDown(16, T.textMute)}
                  </span>
                </button>
                {savedSheetsOpen && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {s.savedSheets.map((sheet) => {
                    const active = parseSpreadsheetId(s.sheetUrl) === sheet.sheetId;
                    return (
                      <div
                        key={sheet.sheetId}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 8,
                          background: active ? 'rgba(0,200,83,0.10)' : T.inputBg,
                          border: `1px solid ${active ? 'rgba(0,200,83,0.4)' : T.line}`,
                          borderRadius: 12, padding: '8px 10px', minWidth: 0,
                        }}
                      >
                        <button
                          onClick={() => { setSavedSheetsOpen(false); void onSelectSavedSheet(sheet); }}
                          disabled={loading !== null}
                          title={sheet.url}
                          style={{
                            flex: 1, minWidth: 0, textAlign: 'left',
                            background: 'transparent', border: 'none', cursor: loading ? 'wait' : 'pointer',
                            display: 'flex', alignItems: 'center', gap: 8, color: T.text, padding: 0,
                          }}
                        >
                          <span style={{ flexShrink: 0, color: active ? T.green : T.textMute }}>
                            {active ? I.check(16, T.green) : I.link(16, T.textMute)}
                          </span>
                          <span
                            style={{
                              flex: 1, minWidth: 0, fontSize: 14, fontWeight: 700,
                              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                            }}
                          >
                            {sheet.name}
                          </span>
                          {active && (
                            <span style={{ flexShrink: 0, fontSize: 11, color: T.green, fontWeight: 700 }}>
                              사용 중
                            </span>
                          )}
                        </button>
                        <button
                          onClick={() => s.removeSavedSheet(sheet.sheetId)}
                          title="목록에서 삭제"
                          style={{
                            flexShrink: 0, width: 30, height: 30, borderRadius: 8,
                            background: 'transparent', border: 'none', color: T.textMute,
                            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                          }}
                        >
                          {I.trash(15, T.textMute)}
                        </button>
                      </div>
                    );
                  })}
                </div>
                )}
              </div>
              );
            })()}

            {(s.availableSheets.length > 0 || s.sheetUrl) && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 12, color: T.textMute, fontWeight: 700, padding: '0 2px' }}>
                  시트 (읽기/쓰기 모두 이 시트 사용)
                </span>
                <select
                  value={s.sheetTab}
                  onChange={(e) => onSheetTabChange(e.target.value)}
                  disabled={s.availableSheets.length === 0}
                  style={{
                    height: 48, borderRadius: 12, background: T.inputBg,
                    border: `1px solid ${T.line}`,
                    padding: '0 12px',
                    fontSize: 16, color: s.sheetTab ? T.text : T.textMute, fontWeight: 600,
                    appearance: 'none', outline: 'none',
                  }}
                >
                  {s.availableSheets.length === 0 ? (
                    <option value="">— 로그인 후 자동 로드 —</option>
                  ) : (
                    s.availableSheets.map((tab) => (
                      <option key={tab} value={tab} style={{ background: T.bg }}>
                        {tab}
                      </option>
                    ))
                  )}
                </select>
              </div>
            )}

            {(loading || error) && (
              <div
                style={{
                  fontSize: 14, color: error ? T.red : T.textDim,
                  padding: '4px 6px', lineHeight: 1.4,
                }}
              >
                {error || loading}
              </div>
            )}
          </div>
        </div>

        {/* v0.33.0 항목5 — 연결 3상태 분리 표시(07-10 QA P1 #1): Google 연결(토큰 실시간 판정,
            [AUTH-7] stale 표시 해소) / 시트 연결 / 과거값 준비(+재시도). 입력탭 시작 카드와 공용. */}
        <div style={{ marginTop: 10, paddingLeft: 16, paddingRight: 16 }}>
          <ConnectionStatusCard />
        </div>

        {/* Section 2 - Column list */}
        <div
          style={{
            marginTop: 14, paddingLeft: 16, paddingRight: 16,
            display: 'flex', flexDirection: 'column', gap: 8,
          }}
        >
          <div
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '0 4px',
            }}
          >
            <span style={{ fontSize: 13, fontWeight: 700, color: T.textDim, letterSpacing: 0.6 }}>
              컬럼 · {s.columns.length}개
            </span>
            {/* S-2: 시트 데이터유형과 저장된 타입 일치 검토 */}
            <button
              onClick={reviewTypes}
              style={{
                fontSize: 12, fontWeight: 700, color: T.textDim, whiteSpace: 'nowrap',
                padding: '4px 10px', borderRadius: 999, cursor: 'pointer',
                border: `1px solid ${T.lineStrong}`, background: 'transparent',
              }}
              title="시트의 실제 데이터형과 일치하는지 검토"
            >
              타입 검토
            </button>
          </div>

          {typeReview && (
            <TypeReviewModal
              checked={typeReview.checked}
              mismatches={typeReview.mismatches}
              onApplyAll={() => {
                for (const m of typeReview.mismatches) {
                  const col = s.columns.find((c) => c.id === m.id);
                  if (col) s.updateColumn(m.id, { ...col, type: m.sheet });
                }
                setTypeReview(null);
              }}
              onClose={() => setTypeReview(null)}
            />
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {s.columns.map((c, idx) => (
              <ColumnCard
                key={c.id}
                col={c}
                index={idx}
                onChange={(n) => s.updateColumn(c.id, n)}
                onRemove={() => s.removeColumn(c.id)}
                onMoveUp={() => s.reorderColumns(idx, idx - 1)}
                onMoveDown={() => s.reorderColumns(idx, idx + 1)}
                isFirst={idx === 0}
                isLast={idx === s.columns.length - 1}
              />
            ))}

            <button
              onClick={s.addColumn}
              style={{
                height: 48, borderRadius: 12,
                background: 'transparent', border: `1px dashed ${T.lineStrong}`,
                color: T.textDim, fontSize: 15, fontWeight: 700,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                cursor: 'pointer', flexShrink: 0,
              }}
            >
              {I.plus(16, T.textDim)} 항목 추가
            </button>
          </div>
        </div>

        {/* 세션 옵션: 세션명 컬럼 선택 + 소음 환경 모드 */}
        <div
          style={{
            marginTop: 14, padding: '0 16px',
            display: 'flex', flexDirection: 'column', gap: 10,
          }}
        >
          <div
            style={{
              background: T.card, borderRadius: 14, padding: 12,
              border: `1px solid ${T.line}`,
              display: 'flex', flexDirection: 'column', gap: 10,
            }}
          >
            <div
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                gap: 10,
              }}
            >
              {/* v0.22.0 — 이 select는 세션명에 쓸 *항목(컬럼)*을 고른다. 자유입력 세션명과 구분해
                  라벨을 "세션명 항목"으로 명확히 한다(아래 텍스트칸이 실제 세션명). */}
              <div style={{ fontSize: 13, fontWeight: 700, color: T.textDim }}>
                세션명 항목
              </div>
              <select
                value={s.sessionLabelColId ?? ''}
                onChange={(e) => {
                  const newColId = e.target.value || null;
                  const isoDate = new Date().toISOString().slice(0, 10);
                  const custom = (s.sessionCustomLabel ?? '').trim();
                  const pickedCol = newColId ? s.columns.find((c) => c.id === newColId) : null;
                  // v0.22.0 — 효과 라벨 = 자유입력 우선, 없으면 (선택 항목값 또는 상수 join).
                  const autoLabel = pickedCol
                    ? (() => { const v = pickSessionLabelValue(s.columns, pickedCol); return v ? `${isoDate} ${v}` : isoDate; })()
                    : buildSessionLabel(s.columns, { isoDate });
                  s.set({
                    sessionLabelColId: newColId,
                    sessionAutoLabel: custom || autoLabel,
                  });
                }}
                style={{
                  flex: 1, maxWidth: 200, height: 36, borderRadius: 8,
                  background: T.inputBg, border: `1px solid ${T.line}`,
                  color: T.text, fontSize: 14, fontWeight: 600,
                  padding: '0 8px', outline: 'none',
                }}
              >
                <option value="">(자동 선택)</option>
                {s.columns
                  .filter(
                    (c) =>
                      c.input === 'auto' &&
                      ((c.auto.kind === 'fixed' && c.auto.value && c.auto.value !== '오늘') ||
                        (c.auto.kind === 'options' && c.auto.selected.length >= 1)),
                  )
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </select>
            </div>
            {/* v0.22.0 — 자유입력 세션명(민구 채택). 입력값이 있으면 자동 라벨보다 우선해 세션명이 된다.
                비우면 자동(생성일 + 상수들)으로 폴백. 입력칸 16px·44px 터치 타깃·줄바꿈 불필요. */}
            <div
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
              }}
            >
              <label htmlFor="session-custom-label" style={{ fontSize: 13, fontWeight: 700, color: T.textDim, flexShrink: 0 }}>
                세션명
              </label>
              <input
                id="session-custom-label"
                type="text"
                value={s.sessionCustomLabel ?? ''}
                placeholder="비우면 자동(생성일 + 항목)"
                onChange={(e) => {
                  const raw = e.target.value;
                  const custom = raw.trim();
                  const isoDate = new Date().toISOString().slice(0, 10);
                  const pickedCol = s.sessionLabelColId
                    ? s.columns.find((c) => c.id === s.sessionLabelColId)
                    : null;
                  const autoLabel = pickedCol
                    ? (() => { const v = pickSessionLabelValue(s.columns, pickedCol); return v ? `${isoDate} ${v}` : isoDate; })()
                    : buildSessionLabel(s.columns, { isoDate });
                  s.set({
                    sessionCustomLabel: raw === '' ? null : raw,
                    sessionAutoLabel: custom || autoLabel,
                  });
                }}
                style={{
                  flex: 1, minWidth: 0, maxWidth: 200, height: 44, borderRadius: 8,
                  background: T.inputBg, border: `1px solid ${T.line}`,
                  color: T.text, fontSize: 16, fontWeight: 600,
                  padding: '0 10px', outline: 'none', textAlign: 'right',
                }}
              />
            </div>
            {/* v0.22.0 — 미리보기는 *효과* 라벨(자유입력 있으면 그것, 없으면 자동 디폴트)을 보여준다.
                store의 sessionAutoLabel은 위 핸들러가 효과 라벨로 유지하지만, 아직 한 번도 편집하지
                않은 초기 상태(null)에서도 디폴트가 보이도록 prospectiveSessionLabel()로 직접 계산한다. */}
            <div style={{ fontSize: 12, color: T.textMute }}>
              세션명 미리보기: <span style={{ color: T.text, fontWeight: 700 }}>{prospectiveSessionLabel()}</span>
            </div>
            {/* v0.19.0 W4-UI — "소음 환경 모드" 토글 UI 제거(민구 결정). store의 noisyMode 필드는
                Mack이 별도로 제거한다(여기선 JSX·참조만 삭제). 아래 "빠른 인식 (실험)" 토글은 보존. */}

            {/* v0.15.0 A6 — 스피커폰 모드 토글 삭제(민구 요청 + Trace 회귀신호 0). 모드로 게이트되던
                가드(TTS-중 명령차단·post-TTS 잔향 폐기·신뢰도 상향)도 함께 제거 — 이어폰 barge-in 기본. */}

            {/* v0.9.0 — 빠른 인식(조기확정) 실험 토글. 기본 OFF(미완성 숫자 절단 리스크). */}
            <div
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                gap: 10, marginTop: 10,
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 700, color: T.textDim }}>
                빠른 인식 (실험)
              </div>
              <button
                onClick={() => {
                  const next = !s.fastRecognition;
                  s.set({ fastRecognition: next });
                  logger.log({ type: 'app', extra: `setting_changed:fastRecognition=${next}` });
                }}
                style={{
                  width: 60, height: 32, borderRadius: 16,
                  background: s.fastRecognition ? T.blue : '#2A2D32',
                  border: 'none', cursor: 'pointer',
                  position: 'relative',
                }}
                title="안내까지의 딜레이를 줄이려 중간 인식이 안정되면 곧바로 확정합니다(실험)"
              >
                <div
                  style={{
                    position: 'absolute',
                    top: 4, left: s.fastRecognition ? 32 : 4,
                    width: 24, height: 24, borderRadius: 12,
                    background: '#fff',
                    transition: 'left 150ms ease',
                  }}
                />
              </button>
            </div>
            <div style={{ fontSize: 11, color: T.textMute, lineHeight: 1.4 }}>
              음성을 멈춘 뒤 인식 확정까지의 대기(딜레이)를 줄입니다. 중간 인식이 잠깐 안정되면 바로
              확정하므로 소수점을 늦게 말하면 잘릴 수 있습니다. 실험 기능이라 기본은 꺼져 있습니다.
            </div>

            {/* v0.33.0 항목10-B — 입력화면 자동 캡처 토글(기본 on, 민구 확정). 트리거/가드/저장은
                src/lib/screenshot.ts가 SSOT — 여기는 스위치만. 빠른 인식 토글 패턴 재사용. */}
            <div
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                gap: 10, marginTop: 10,
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 700, color: T.textDim }}>
                입력화면 자동 캡처
              </div>
              <button
                data-testid="auto-capture-toggle"
                aria-pressed={s.autoScreenCapture}
                onClick={() => {
                  const next = !s.autoScreenCapture;
                  s.set({ autoScreenCapture: next });
                  logger.log({ type: 'app', extra: `setting_changed:autoScreenCapture=${next}` });
                }}
                style={{
                  width: 60, height: 32, borderRadius: 16,
                  background: s.autoScreenCapture ? T.blue : '#2A2D32',
                  border: 'none', cursor: 'pointer',
                  position: 'relative',
                }}
                title="음성 입력에 앱이 반응하는 순간의 화면을 저화질로 저장해 로그와 함께 남깁니다"
              >
                <div
                  style={{
                    position: 'absolute',
                    top: 4, left: s.autoScreenCapture ? 32 : 4,
                    width: 24, height: 24, borderRadius: 12,
                    background: '#fff',
                    transition: 'left 150ms ease',
                  }}
                />
              </button>
            </div>
            <div style={{ fontSize: 11, color: T.textMute, lineHeight: 1.4 }}>
              값 저장·알람·재질문 같은 순간의 화면을 저화질 사진으로 남겨 음성 로그와 함께 백업합니다.
              세션당 최대 100장, 2초에 1장 이하로만 저장돼 측정을 느리게 하지 않습니다.
            </div>

            {/* v0.33.0 항목10-C — 비프음 선택(긍정/부정 각 5종 중 1, 민구 확정). 탭 = 미리듣기 + 선택.
                세그먼트 스펙은 beepVariants.ts, 재생 해석(kind→극성→변형)은 beep.ts가 SSOT. */}
            <BeepPicker />

            {/* v0.8.0 — 추세 검증 전역 마스터 토글 제거(이상치 알람은 컬럼별 규칙 유무로 활성).
                조사시기(회차) 컬럼 선택은 조회탭으로 이전(WS4) — roundDateColId 필드는 유지. */}

            <TtsVoiceSelector />

          </div>
        </div>

        {/* v0.34.0 C10(Vance) — 설정 요약 인라인(스크롤 영역 말미, 민구 요청: "설정 재확인에 페이지
            최상단까지 가는 번거로움"). 상단 '설정 요약' 팝업 버튼은 유지하고, 같은 SettingsSummary
            SSOT를 하단 액션바("총 N행 생성됨 (미리보기)") 바로 위에서 한 번 더 보여준다. 수치는
            팝업(SettingsSummaryModal)과 동일 소스: computeTotalRows(s.columns) +
            prospectiveSessionLabel(). footer(액션바, flexShrink:0 무스크롤 존)에 넣지 않는다 —
            반드시 스크롤 영역 안. 캡션에 '생성됨'/'생성 예정' 부분문자열 금지(기존 text= 로케이터
            보호) — 스펙 단언은 data-testid 기반. */}
        {s.columns.length > 0 && (
          <div
            data-testid="settings-summary-inline"
            style={{
              margin: '18px 16px 0',
              padding: 14,
              background: T.card,
              borderRadius: 16,
              border: `1px solid ${T.line}`,
              display: 'flex',
              flexDirection: 'column',
              gap: summaryInlineOpen ? 10 : 0,
            }}
          >
            {/* v0.35.0 FB-E — 헤더 탭으로만 펼침(기본 접힘). testid는 컨테이너에 상주(항상 마운트),
                내용만 게이트. savedSheets 헤더와 동일 aria-expanded + 회전 셰브런 패턴. */}
            <button
              data-testid="settings-summary-toggle"
              onClick={() => setSummaryInlineOpen((v) => !v)}
              aria-expanded={summaryInlineOpen}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                background: 'transparent', border: 'none', cursor: 'pointer',
                color: T.textDim, textAlign: 'left', width: '100%',
                // v0.35.0 R2-FIX-4(리뷰 라운드2, a11y) — 44px 터치 타깃 확보(장갑 낀 현장 조작).
                //   종전 padding:0 + 18~20px 텍스트라 타깃이 작았다.
                minHeight: 44, padding: '4px 0',
              }}
            >
              <span style={{ fontSize: 14, fontWeight: 800, color: T.textDim, letterSpacing: -0.2, flex: 1 }}>
                설정 요약
              </span>
              <span
                style={{
                  flexShrink: 0, display: 'inline-flex',
                  transform: summaryInlineOpen ? 'rotate(180deg)' : 'none', transition: 'transform 150ms',
                }}
              >
                {I.chevDown(18, T.textMute)}
              </span>
            </button>
            {summaryInlineOpen && (
              <SettingsSummary
                columns={s.columns}
                totalRows={computeTotalRows(s.columns)}
                sessionLabel={prospectiveSessionLabel()}
              />
            )}
          </div>
        )}

        {/* Footer: version + build date */}
        <div
          style={{
            marginTop: 18, padding: '12px 16px 8px',
            textAlign: 'center',
            fontFamily: 'JetBrains Mono, ui-monospace, monospace',
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 700, color: T.text }}>
            v{__APP_VERSION__}{' '}
            <span style={{ color: T.textMute, fontWeight: 500, fontSize: 12 }}>({__BUILD_DATE__})</span>
          </div>
          <div style={{ fontSize: 11, color: T.textMute, marginTop: 4 }}>
            survey-011 · mingoo.jejuagri.kang@gmail.com
          </div>
          {/* v0.18.0 1f — 수동 업데이트 확인/새로고침. 새 버전이 대기 중이면 바로 적용, 아니면
              능동 체크만 트리거(설치형에서 새 버전 반영 경로를 사용자가 직접 호출). */}
          <UpdateControl />
        </div>
      </div>

      {/* Action bar */}
      <div
        style={{
          padding: '12px 16px 12px',
          borderTop: `1px solid ${T.line}`,
          background: 'rgba(255,255,255,0.02)',
          display: 'flex', flexDirection: 'column', gap: 8, flexShrink: 0,
        }}
      >
        {!s.tableGenerated && s.columns.length > 0 && previewRowCount > 0 && (
          <div style={{ textAlign: 'center', fontSize: 13, color: T.textMute }}>
            현재 설정으로 <span style={{ color: T.blue, fontWeight: 700 }}>{previewRowCount}행</span> 생성 예정
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {s.tableGenerated ? (
            <>
              <button
                onClick={() => {
                  // v0.33.0 B-10 — 미리보기 팝업 열림 계측(생성 후 '미리보기' 버튼 경로).
                  logger.log({ type: 'command', parsed: 'ui_open', extra: 'table_preview' });
                  setTablePreviewOpen(true);
                }}
                style={{
                  flex: 1, height: 56, borderRadius: 28,
                  background: 'rgba(0,200,83,0.12)',
                  border: '1px solid rgba(0,200,83,0.35)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
                  fontSize: 16, fontWeight: 700, color: T.green,
                  cursor: 'pointer',
                }}
              >
                {I.check(20, T.green)} 총 {s.totalRows}행 생성됨 (미리보기)
              </button>
              <button
                onClick={onGenerate}
                style={{
                  height: 56, padding: '0 18px', borderRadius: 28,
                  border: `1px solid ${T.lineStrong}`, background: 'transparent',
                  color: T.textDim, fontSize: 15, fontWeight: 700, cursor: 'pointer',
                }}
              >
                재생성
              </button>
            </>
          ) : (
            <button
              onClick={onGenerate}
              style={{
                flex: 1, height: 56, borderRadius: 28, border: 'none',
                background: T.blue, color: '#fff',
                fontSize: 18, fontWeight: 800, letterSpacing: -0.2,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
                cursor: 'pointer',
                boxShadow: `0 6px 18px ${T.blueGlow}`,
              }}
            >
              {I.table(20, '#fff')} 입력 테이블 생성
            </button>
          )}
        </div>
        {/* v0.32.0 설정탭 UX(Vance) B4 — 생성 완료 후 다음 단계 안내 + 입력탭 이동(자동 전환 없음,
            민구 확정). 캡션은 '생성됨'/'생성 예정' 부분문자열을 피한다(기존 text= 로케이터 보호). */}
        {s.tableGenerated && (
          <>
            <div style={{ textAlign: 'center', fontSize: 12, color: T.textMute, lineHeight: 1.4 }}>
              생성 완료 — 입력 탭에서 [음성 입력 시작]을 누르세요
            </div>
            <button
              type="button"
              data-testid="settings-go-input"
              onClick={() => onNavigateToInput?.()}
              style={{
                width: '100%', height: 54, borderRadius: 28, border: 'none',
                background: T.blue, color: '#fff',
                fontSize: 17, fontWeight: 800, letterSpacing: -0.2,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                cursor: 'pointer',
                boxShadow: `0 6px 18px ${T.blueGlow}`,
              }}
            >
              입력탭으로 이동 →
            </button>
          </>
        )}
      </div>

      {/* v0.19.0 W3 — '최종 설정값 확인' 게이트. 요약은 현재 columns에서 파생(stale 방지).
          v0.32.0 B1 — 게이트는 무스크롤 요약 전용으로 재설계(테이블 본문 제거). 표가 필요하면
          게이트 안의 "생성될 테이블 미리보기"로 아래 닫기 전용 미리보기를 게이트 위에 오버레이.
          "확인(이대로 생성)" = onGenerateConfirm에서만 실제 생성, "취소" = 미생성. */}
      {generateGateOpen && (
        <TablePreviewModal
          columns={s.columns}
          totalRows={computeTotalRows(s.columns)}
          sessionLabel={prospectiveSessionLabel()}
          regenerating={s.tableGenerated}
          onConfirm={onGenerateConfirm}
          onOpenPreview={() => {
            // v0.33.0 B-10 — 게이트 안 "생성될 테이블 미리보기" 경로도 동일 계측.
            logger.log({ type: 'command', parsed: 'ui_open', extra: 'table_preview' });
            setTablePreviewOpen(true);
          }}
          onClose={() => setGenerateGateOpen(false)}
        />
      )}

      {/* 생성 후 '미리보기' — 닫기 전용(부수효과 없음). 게이트에서 열었을 때는 게이트 위에 겹쳐야
          하므로 게이트보다 뒤(DOM 순서 = 위)에 마운트하고, 행수는 게이트가 열려 있으면 현재 columns
          에서 파생(생성 전 stale totalRows 방지). '생성' 포함 버튼이 없어 hasText:'생성' .last()는
          여전히 게이트 확인 버튼을 가리킨다. */}
      {tablePreviewOpen && (
        <TablePreviewModal
          columns={s.columns}
          totalRows={generateGateOpen ? computeTotalRows(s.columns) : s.totalRows}
          onClose={() => setTablePreviewOpen(false)}
        />
      )}

      {/* v0.32.0 설정탭 UX(Vance) B2 — 설정 요약 팝업(닫기 전용, 무스크롤). 로그인·시트 연결·컬럼
          요약(SettingsSummary 공용)·다이얼/토글·생성 상태를 한 화면에 모은다. 설정탭 전용. */}
      {summaryOpen && (() => {
        const activeSheetId = parseSpreadsheetId(s.sheetUrl);
        const sheetName = s.savedSheets.find((x) => x.sheetId === activeSheetId)?.name ?? null;
        const sheetLabel = s.sheetUrl.trim()
          ? `${sheetName ?? '시트'}${s.sheetTab ? ` · ${s.sheetTab}` : ''}`
          : null;
        return (
          <SettingsSummaryModal
            googleConnected={s.googleConnected}
            userEmail={s.userEmail}
            sheetLabel={sheetLabel}
            columns={s.columns}
            totalRows={computeTotalRows(s.columns)}
            sessionLabel={prospectiveSessionLabel()}
            recognitionTolerance={s.recognitionTolerance}
            ttsRate={s.ttsRate}
            fastRecognition={s.fastRecognition}
            tableGenerated={s.tableGenerated}
            generatedRows={s.totalRows}
            onClose={() => setSummaryOpen(false)}
          />
        );
      })()}

      {/* v0.32.0 설정탭 UX(Vance) B3 — 초기화 확인 모달. 기본은 로그인·시트 보존, 체크박스로 opt-in
          삭제. 버튼 문구에 '생성' 부분문자열 금지(초기화 실행/취소는 안전). */}
      {resetOpen && (
        <SettingsResetModal
          onCancel={() => setResetOpen(false)}
          onConfirm={(opts) => void onResetConfirm(opts)}
        />
      )}

      {/* v0.23.0 설정탭#4(Vance) — 설명 팝업. 카드별 `?` 또는 첫 진입 안내의 "자세히 보기"에서 연다.
          모든 데이터형/필드 설명을 한 곳에 모은다(COLUMN_HELP). 사용자 명시 오픈 → 자동 노출 아님. */}
      {/* v0.33.0 항목10-A — 데이터형 6종 설명(DATA_TYPE_HELP)을 같은 팝업에 이어 통합. */}
      {helpOpen && (
        <SettingsHelpModal
          title="설정 도움말"
          items={[...COLUMN_HELP, ...DATA_TYPE_HELP]}
          onClose={() => setHelpOpen(false)}
        />
      )}
    </div>
  );
}
