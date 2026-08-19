/**
 * v0.50 r2 [DD-5] — **시트 표시 자리수 서식 적용의 배선**(주입형).
 *
 * ## 왜 훅에서 빼냈나
 * 콜드 리뷰 DD-5: 종전 구현은 `useSettingsTableGeneration` 안의 지역 함수라
 * `grep -rn "applyDecimalFormats|sheet_number_format" tests/` → **0건**이었다.
 * 즉 `void applyDecimalFormats();` **한 줄을 지워도 전 스펙이 green**이고, 민구가 실제로 요구한
 * 것(**시트에 `40.0`이 보인다**)을 지키는 검사가 하나도 없었다.
 * 실계정 `batchUpdate` 실호출은 개발 환경에서 못 부르지만 **배선(호출이 일어나는가·무엇을
 * 넘기는가·실패해도 흐름을 안 끊는가)은 주입으로 잠글 수 있다** — 그게 이 파일이다.
 *
 * ## 계약
 *  · 시트 URL/탭이 없으면 **아무것도 하지 않는다**(연결 전 상태).
 *  · 대상 열(float + `decimals`)이 없으면 **네트워크를 치지 않는다**(빈 batchUpdate 금지).
 *  · 실패는 **throw하지 않는다** — 로그만 남기고 끝낸다(PRINCIPLES §3: 꺼짐/실패 시 조용한 no-op,
 *    단 [REVIEW-1]에 따라 **침묵은 아니다**).
 */
import { buildNumberFormatRequests, planNumberFormats, type NumberFormatColumn } from './sheetNumberFormat';

export interface DecimalFormatDeps {
  /** 현재 설정 스냅샷 — 시트 URL·탭·컬럼. */
  getSettings: () => { sheetUrl: string; sheetTab: string; columns: readonly NumberFormatColumn[] };
  parseSpreadsheetId: (url: string) => string | null;
  fetchHeaderRow: (spreadsheetId: string, sheetTab: string) => Promise<string[]>;
  /** 탭 제목 → gid. 못 찾으면 null. */
  resolveSheetId: (spreadsheetId: string, sheetTab: string) => Promise<number | null>;
  applyFormats: (
    spreadsheetId: string,
    requests: readonly unknown[],
  ) => Promise<{ ok: boolean; status?: number; message?: string }>;
  log: (extra: string) => void;
}

export async function applyDecimalFormats(deps: DecimalFormatDeps): Promise<void> {
  const st = deps.getSettings();
  const spreadsheetId = deps.parseSpreadsheetId(st.sheetUrl);
  if (!spreadsheetId || !st.sheetTab) return;
  try {
    const headers = await deps.fetchHeaderRow(spreadsheetId, st.sheetTab);
    const specs = planNumberFormats(st.columns, headers);
    if (specs.length === 0) return; // float+decimals 열이 없다 — 조용히 끝낸다.
    const sheetId = await deps.resolveSheetId(spreadsheetId, st.sheetTab);
    if (sheetId == null) {
      deps.log('sheet_number_format:no_sheet_id');
      return;
    }
    const res = await deps.applyFormats(spreadsheetId, buildNumberFormatRequests(sheetId, specs));
    // 실패도 남긴다 — 권한 없는 시트(403)에서 조용히 아무 일도 안 일어나면 「왜 40.0이 안 되나」를
    // 다음 회차가 처음부터 다시 조사한다([REVIEW-1] 빈 catch 금지).
    deps.log(
      `sheet_number_format:${res.ok ? 'ok' : 'failed'}:cols=${specs.length}${res.status ? `:status=${res.status}` : ''}`,
    );
  } catch (e) {
    deps.log(`sheet_number_format:error:${e instanceof Error ? e.name : 'unknown'}`);
  }
}
