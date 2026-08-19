/**
 * v0.49 R1 리팩토링 P1-2 — 설정탭 «테이블 생성·타입 검토» 서브 훅 (useSettingsActions에서 순수 이동).
 * 타입 검토(S-2)·테이블 미리보기·생성 게이트(v0.19.0 W3)·예상 세션명 계산의 상태와 핸들러를
 * 소유한다. loading/error는 시트 연결 서브 훅(useSettingsSheetConnection) 소유 — 조립 훅이
 * 배선하는 공유 번들(SettingsActionsShared)로 받는다. 로직·계측은 이동 전과 바이트 동일
 * (SOP-003 파서 계약).
 */
import { useState } from 'react';
import { useSettingsStore } from '../stores/settingsStore';
import {
  prefetchPastIndex,
  resetPastIndexRetries,
  shouldPreparePastIndex,
} from './pastValues';
import type { DataType } from '../types';
import {
  applySheetFormatRequests, fetchHeaderRow, fetchHeaderAndSample, fetchSpreadsheetMeta,
  inferColumns, parseSpreadsheetId,
} from './sheets';
import { buildNumberFormatRequests, planNumberFormats } from './sheetNumberFormat';
import { computeTotalRows } from './autoValue';
import { buildSessionLabel, pickSessionLabelValue } from './sessionLabel';
import { localTodayIso } from './weekTuesday';
import { logger } from './logger';
import { isSheetSourceBlocked } from './sheetConnection';
import type { SettingsActionsShared } from './useSettingsSheetConnection';

/** S-2: a column whose saved type differs from the sheet's inferred data type.
 *  (임포터 0 — TypeReviewModal은 구조 동일 인터페이스를 로컬 재선언한다. export하면 knip 신규
 *  검출이 생겨 비공개로 둔다 — 종전 useSettingsActions의 export도 검출 0이었던 것과 파리티.) */
interface TypeMismatch { id: string; name: string; saved: DataType; sheet: DataType; }

/** 타입 검토 상태 (null = not run; checked = columns compared) — 초기화 서브 훅이 setter를 받는다. */
export type TypeReviewState = { mismatches: TypeMismatch[]; checked: number } | null;

export function useSettingsTableGeneration(shared: SettingsActionsShared) {
  const { setLoading, setError } = shared;
  const s = useSettingsStore();
  // S-2: result of "타입 검토" (null = not run; checked = columns compared).
  const [typeReview, setTypeReview] = useState<TypeReviewState>(null);
  const [tablePreviewOpen, setTablePreviewOpen] = useState(false);
  // v0.19.0 W3 — "입력 테이블 생성/재생성" 클릭 시 먼저 뜨는 '최종 설정값 확인' 게이트.
  const [generateGateOpen, setGenerateGateOpen] = useState(false);
  const previewRowCount = computeTotalRows(s.columns);

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
    // v0.49 r5 Z1 — 로컬 날짜(UTC 금지). 이 미리보기가 곧 세션명이므로 buildSessionLabel과
    //   같은 출처를 써야 한다 — 근거는 sessionLabel.buildSessionLabel 헤더.
    const isoDate = localTodayIso();
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

  /** v0.50 [DECIMAL-DISPLAY-1] — 시트의 float 열에 **표시 자리수 서식**을 씌운다(민구 08-19 제보:
   *  `40` → `40.0`). 값은 숫자 그대로 두고 표시만 바꾼다 — `USER_ENTERED` 때문에 문자열 패딩은
   *  애초에 무효다(`sheetNumberFormat.ts` 헤더).
   *
   *  🔴 **여기서 부르는 이유**: 자리수(`col.decimals`)가 확정되는 유일한 시점이 테이블 생성이다.
   *  매 sync마다 치면 시트 쓰기가 행 입력 빈도로 늘어난다 — 서식은 스키마성 설정이라 1회면 된다.
   *  🔴 **await하지 않는다**: 서식은 부가 기능이고, 실패해도 생성·세션 흐름을 막지 않는다
   *  (PRINCIPLES §3 기능 격리 — 꺼짐/실패 시 조용한 no-op). 결과는 로그로만 남긴다. */
  const applyDecimalFormats = async (): Promise<void> => {
    const st = useSettingsStore.getState();
    const spreadsheetId = parseSpreadsheetId(st.sheetUrl);
    if (!spreadsheetId || !st.sheetTab) return;
    try {
      const headers = await fetchHeaderRow(spreadsheetId, st.sheetTab);
      const specs = planNumberFormats(st.columns, headers);
      if (specs.length === 0) return; // float+decimals 컬럼이 없다 — 조용히 끝낸다.
      const meta = await fetchSpreadsheetMeta(spreadsheetId);
      const sheetId = meta.sheets.find((sh) => sh.title === st.sheetTab)?.sheetId;
      if (sheetId == null) return;
      const res = await applySheetFormatRequests(spreadsheetId, buildNumberFormatRequests(sheetId, specs));
      logger.log({
        type: 'app',
        // 실패도 남긴다 — 권한 없는 시트(403)에서 조용히 아무 일도 안 일어나면 「왜 40.0이 안 되나」를
        // 다음 회차가 처음부터 다시 조사한다([REVIEW-1] 빈 catch 금지).
        extra: `sheet_number_format:${res.ok ? 'ok' : 'failed'}:cols=${specs.length}${res.status ? `:status=${res.status}` : ''}`,
      });
    } catch (e) {
      logger.log({ type: 'app', extra: `sheet_number_format:error:${e instanceof Error ? e.name : 'unknown'}` });
    }
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
    // v0.50 [DECIMAL-DISPLAY-1] — 시트 표시 자리수 서식(부가 · 실패 무해 · 흐름 비차단).
    void applyDecimalFormats();
    setGenerateGateOpen(false);
  };

  return {
    typeReview, setTypeReview,
    tablePreviewOpen, setTablePreviewOpen,
    generateGateOpen, setGenerateGateOpen,
    previewRowCount,
    reviewTypes, prospectiveSessionLabel, onGenerate, onGenerateConfirm,
  };
}
