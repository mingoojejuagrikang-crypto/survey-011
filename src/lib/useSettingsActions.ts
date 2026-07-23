/**
 * v0.35.2 Stage 2 — 설정탭 오케스트레이션 훅 (SettingsScreen에서 순수 이동, GL-006 §7~8 UI/로직 분리).
 * Google 인증·시트 연결/저장목록·컬럼 타입 검토·테이블 생성 게이트·전체 초기화의 상태와 핸들러를
 * 소유한다. 화면(SettingsScreen)은 표현만 담당한다. 로직·계측(extra 문자열)은 이동 전과 바이트 동일
 * (SOP-003 파서 계약).
 */
import { useEffect, useRef, useState } from 'react';
import { makeSettingsDefaults, useSettingsStore } from '../stores/settingsStore';
import { saveSheetsRecord } from './db';
import {
  invalidatePastIndex,
  prefetchPastIndex,
  resetPastIndexRetries,
  shouldPreparePastIndex,
} from './pastValues';
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
} from './googleAuth';
import {
  fetchHeaderAndSample,
  fetchSpreadsheetMeta,
  fetchColumnUniqueValues,
  inferColumns,
  parseSpreadsheetId,
  readonlySheetsAuth,
} from './sheets';
import { mergeInferredColumnsForSheet } from './columnFlags';
import { computeTotalRows } from './autoValue';
import { buildSessionLabel, pickSessionLabelValue } from './sessionLabel';
import { getPickerApiKey, openDrivePicker } from './drivePicker';
import { setPreferredVoiceName } from './speech';
import { logger } from './logger';
import { isSheetSourceBlocked } from './sheetConnection';

/** localStorage 키 — 첫 진입 안내를 본 적 있는지(스토리지 네임스페이스 survey-011 준수).
 *  종전 components/settings/helpCopy.ts 소유였으나 유일 소비자가 이 훅이라 여기로 이동
 *  (v0.35.2 리뷰 r1 공통 지적 — lib→components 역참조 해소). */
export const SETTINGS_TIP_SEEN_KEY = 'survey-011-settings-tip-seen';

/** S-2: a column whose saved type differs from the sheet's inferred data type. */
export interface TypeMismatch { id: string; name: string; saved: DataType; sheet: DataType; }

export function useSettingsActions() {
  const s = useSettingsStore();
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmedUrl, setConfirmedUrl] = useState<string>(s.sheetUrl);
  // URL 입력값은 연결이 검증된 활성 sheetUrl과 분리한다. 메타/헤더 조회가 실패한 URL을 활성 대상으로
  // 먼저 영속하면 이전 columns와 새 URL이 섞이므로, 최신 요청 성공 때만 둘을 함께 게시한다.
  const [sheetUrlDraft, setSheetUrlDraft] = useState<string>(s.sheetUrl);
  // v0.32.0 설정탭 UX(Vance) B3 — 초기화 확인 모달(설정탭 전용; B2 요약 팝업 상태는 화면이 소유).
  const [resetOpen, setResetOpen] = useState(false);
  // S-2: result of "타입 검토" (null = not run; checked = columns compared).
  const [typeReview, setTypeReview] = useState<{ mismatches: TypeMismatch[]; checked: number } | null>(null);
  const [tablePreviewOpen, setTablePreviewOpen] = useState(false);
  // v0.19.0 W3 — "입력 테이블 생성/재생성" 클릭 시 먼저 뜨는 '최종 설정값 확인' 게이트.
  const [generateGateOpen, setGenerateGateOpen] = useState(false);
  const [showUrlInput, setShowUrlInput] = useState(false);
  // v0.14.0 F — 저장된 시트 목록을 기본 접힌 드롭다운으로(세로 풀리스트가 시트 多 시 화면 점유 과다).
  const [savedSheetsOpen, setSavedSheetsOpen] = useState(false);
  // v0.23.0 설정탭#4 — 첫 진입 안내 배너(1회 dismissible). "본 적 있는지"는 localStorage에 영속
  //   (UI 전용 상태라 persist 스키마 확장 불필요). 초기값은
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
    setSheetUrlDraft(url);
    ++sheetRequestSeqRef.current;
    s.set({ tableGenerated: false });
    setLoading(null);
    setError(null);
  };

  /** "확인" 버튼: 현재 URL로 시트 정보 조회 시도 */
  const onUrlConfirm = async () => {
    setError(null);
    const url = sheetUrlDraft.trim();
    if (!url) { setError('URL을 입력하세요.'); return; }
    if (!s.googleConnected) { setError('먼저 Google 로그인 후 다시 확인하세요.'); return; }
    await onUrlConfirmWithUrl(url);
  };

  const onSheetTabChange = async (newTab: string) => {
    const requestSeq = beginSheetRequest();
    const current = useSettingsStore.getState();
    const id = parseSpreadsheetId(current.sheetUrl);
    if (!id) {
      if (isCurrentSheetRequest(requestSeq)) setError('시트 연결을 다시 확인해 주세요.');
      return;
    }
    try {
      setLoading('컬럼 분석 중...');
      const columns = await loadHeaders(id, newTab, requestSeq);
      if (!columns || !isCurrentSheetRequest(requestSeq)) return;
      useSettingsStore.getState().set({
        sheetUrl: current.sheetUrl,
        sheetTab: newTab,
        columns,
        columnsSheetId: id,
        columnsSheetTab: newTab,
        tableGenerated: false,
      });
      if (shouldPreparePastIndex()) {
        resetPastIndexRetries();
        prefetchPastIndex();
      }
    } catch (err) {
      if (isCurrentSheetRequest(requestSeq)) setError((err as Error).message);
    } finally {
      if (isCurrentSheetRequest(requestSeq)) setLoading(null);
    }
  };

  // 대상 전환의 메타→헤더 전체 요청 세대. 메타가 늦게 끝난 이전 요청도 최신 sheetTab/columns를
  // 덮지 못해야 하므로 헤더 단계만이 아니라 연결 파이프라인의 시작점에서 발급한다.
  const sheetRequestSeqRef = useRef(0);
  const isCurrentSheetRequest = (requestSeq: number) => requestSeq === sheetRequestSeqRef.current;
  const beginSheetRequest = () => {
    const requestSeq = ++sheetRequestSeqRef.current;
    useSettingsStore.getState().set({ tableGenerated: false });
    setError(null);
    return requestSeq;
  };

  const loadHeaders = async (
    spreadsheetId: string,
    sheetTitle: string,
    requestSeq: number,
  ): Promise<Column[] | null> => {
      const { headers, sample } = await fetchHeaderAndSample(spreadsheetId, sheetTitle);
      if (!isCurrentSheetRequest(requestSeq)) return null;
      // v0.38.0 — 사용자 설정과 기존 id는 정확히 같은 스프레드시트·탭의 재연결에서만 보존한다.
      // 다른 농가 시트가 같은 헤더를 써도 id가 같아지는 탓에 이전 fixed 자동값이 새 시트에
      // 복사되던 침묵 오염을 차단한다. 출처는 sheetUrl/sheetTab보다 늦게 바뀌는 columns와 함께
      // 저장하므로, 호출부가 대상 시트 상태를 먼저 써도 비교 기준이 흔들리지 않는다.
      const current = useSettingsStore.getState();
      const freshlyInferred = inferColumns(headers, sample);
      const inferred = mergeInferredColumnsForSheet(
        freshlyInferred,
        current.columns,
        { spreadsheetId: current.columnsSheetId, sheetTab: current.columnsSheetTab },
        { spreadsheetId, sheetTab: sheetTitle },
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
      return enriched.length && isCurrentSheetRequest(requestSeq) ? enriched : null;
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
        setSheetUrlDraft(result.url);
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
      ++sheetRequestSeqRef.current;
      setSheetUrlDraft(entry.url);
      s.set({ sheetUrl: entry.url, availableSheets: [], sheetTab: '', tableGenerated: false });
      setConfirmedUrl('');
      setError('연결이 만료되었습니다. Google 로그인을 다시 하면 이 시트로 자동 연결됩니다.');
      return;
    }
    setSheetUrlDraft(entry.url);
    setConfirmedUrl('');
    await onUrlConfirmWithUrl(entry.url);
  };

  const onUrlConfirmWithUrl = async (url: string) => {
    const requestSeq = beginSheetRequest();
    const id = parseSpreadsheetId(url);
    if (!id) {
      if (isCurrentSheetRequest(requestSeq)) setError('스프레드시트 URL 형식이 올바르지 않습니다.');
      return;
    }
    try {
      setLoading('시트 정보 조회 중...');
      const meta = await fetchSpreadsheetMeta(id);
      if (!isCurrentSheetRequest(requestSeq)) return;
      const tabs = meta.sheets.map((sh) => sh.title);
      const sheetTab = tabs[0] || '';
      if (!sheetTab) throw new Error('사용할 수 있는 시트 탭이 없습니다.');
      setLoading('컬럼 분석 중...');
      const columns = await loadHeaders(id, sheetTab, requestSeq);
      if (!columns || !isCurrentSheetRequest(requestSeq)) return;
      useSettingsStore.getState().set({
        sheetUrl: url,
        availableSheets: tabs,
        sheetTab,
        columns,
        columnsSheetId: id,
        columnsSheetTab: sheetTab,
        tableGenerated: false,
      });
      setSheetUrlDraft(url);
      setConfirmedUrl(url);
      // v0.13.0 R1 — 연결에 성공한 시트를 '파일명'(meta.title)으로 저장 목록에 자동 등록한다(민구
      // 요청). sheetId 기준 dedupe(saveSheet) — 같은 시트 재연결 시 최근 사용으로 갱신만 된다.
      s.saveSheet({ name: meta.title || url, url, sheetId: id, addedAt: Date.now() });
      // v0.34.0 C9(b) — 시트 연결 확정 직후 프리페치. 이 함수는 Drive Picker 선택·저장목록 선택·
      // URL 확인·재로그인 자동 재연결의 공통 종점이라 여기 1곳 배선으로 전부 커버된다(단일 배선).
      // 컬럼은 위 loadHeaders가 방금 교체했을 수 있으므로 getState()로 최신을 읽는다.
      if (shouldPreparePastIndex({ requireAuth: true })) { resetPastIndexRetries(); prefetchPastIndex(); }
    } catch (err) {
      if (isCurrentSheetRequest(requestSeq)) setError((err as Error).message);
    } finally {
      if (isCurrentSheetRequest(requestSeq)) setLoading(null);
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
    if (isSheetSourceBlocked(useSettingsStore.getState())) {
      setError('시트 연결을 다시 확인해 주세요.');
      return;
    }
    // v0.33.0 B-10 — 생성 게이트 열림 계측(생성 퍼널 가시화 — 이전엔 무로깅).
    logger.log({ type: 'command', parsed: 'ui_open', extra: 'generate_gate' });
    setGenerateGateOpen(true);
  };

  // "확인(생성)" — 여기서만 실제 생성 부수효과 실행.
  const onGenerateConfirm = () => {
    if (isSheetSourceBlocked(useSettingsStore.getState())) {
      setGenerateGateOpen(false);
      setError('시트 연결을 다시 확인해 주세요.');
      return;
    }
    const total = computeTotalRows(s.columns);
    const sessionAutoLabel = prospectiveSessionLabel();
    s.set({ tableGenerated: true, totalRows: total, sessionAutoLabel });
    // v0.33.0 항목5 — 테이블 생성 시점 프리페치(세션 시작 start()와 동일 조건). 생성 직후엔 대개
    // 토큰이 살아 있으므로 여기서 미리 당겨 두면, 세션 시작이 늦어져 토큰이 만료돼도 IDB
    // write-through 스냅샷이 폴백으로 남는다(07-13 §4 침묵 창 축소).
    // v0.34.0 C9(a) — 토큰 조건은 (토큰 || API key)다(readonlySheetsAuth SSOT). 공개 시트면
    // 미로그인 생성 직후에도 과거값이 준비된다(민구: "시트가 연결되면 자동으로 작동해야 함").
    // v0.38.0 리뷰#1 — 판단은 shouldPreparePastIndex 단일 술어로(호출부마다 복붙하지 않는다).
    if (shouldPreparePastIndex({ requireAuth: true })) { resetPastIndexRetries(); prefetchPastIndex(); }
    setGenerateGateOpen(false);
  };

  /** v0.32.0 설정탭 UX(Vance) B3 — 전체 초기화. 컬럼·행수·세션명·다이얼·음성/검토 옵션·생성 상태를
   *  기본값(makeSettingsDefaults SSOT)으로 되돌린다. Google 로그인·시트 URL·저장된 시트는 기본
   *  **보존**(민구 확정) — 모달 체크박스로만 opt-in 삭제. 세션 데이터·클립·로그(IDB)는 건드리지 않는다. */
  const onResetConfirm = async ({ clearLogin, clearSheets }: { clearLogin: boolean; clearSheets: boolean }) => {
    const d = makeSettingsDefaults();
    s.set({
      columns: d.columns, // fresh copy — makeSettingsDefaults가 호출마다 새 객체를 만든다
      // v0.38.0 리뷰#3 — 컬럼과 **출처는 항상 함께** 움직여야 한다. 초기화가 컬럼만 샘플 기본값
      // (농가명=이원창 등)으로 되돌리고 출처를 이전 시트로 남겨두면, 그 시트를 다시 불러올 때
      // 샘플 기본값을 "그 시트의 사용자 설정"으로 오인해 새 표본보다 우선 보존한다.
      columnsSheetId: d.columnsSheetId,
      columnsSheetTab: d.columnsSheetTab,
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
      // 진행 중인 조회까지 낡은 세대로 만든 뒤 메모리·IDB를 함께 비운다. 삭제 완료를 기다려야
      // 모달이 닫힌 직후 같은 시트를 재연결해 만든 새 스냅샷을 늦은 delete가 지우지 않는다.
      await invalidatePastIndex();
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

  return {
    loading, error,
    confirmedUrl, sheetUrlDraft,
    typeReview, setTypeReview,
    tablePreviewOpen, setTablePreviewOpen,
    generateGateOpen, setGenerateGateOpen,
    showUrlInput, setShowUrlInput,
    savedSheetsOpen, setSavedSheetsOpen,
    resetOpen, setResetOpen,
    tipDismissed, dismissTip,
    previewRowCount, pickerAvailable,
    onGoogleClick, onUrlTyping, onUrlConfirm, onSheetTabChange, reviewTypes,
    onPickerClick, onSelectSavedSheet,
    prospectiveSessionLabel, onGenerate, onGenerateConfirm, onResetConfirm,
  };
}
