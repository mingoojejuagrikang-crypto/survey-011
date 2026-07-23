import { parseSpreadsheetId } from './sheets';
import type { SessionTarget } from '../types';

export interface SheetSourceState {
  sheetUrl: string;
  sheetTab: string;
  columnsSheetId: string | null;
  columnsSheetTab: string | null;
}

/** 현재 연결된 시트와 columns의 출처가 정확히 같은가(둘 다 있을 때만 참). */
export function hasMatchingSheetSource(state: SheetSourceState): boolean {
  const spreadsheetId = parseSpreadsheetId(state.sheetUrl);
  return !!spreadsheetId
    && !!state.sheetTab
    && spreadsheetId === state.columnsSheetId
    && state.sheetTab === state.columnsSheetTab;
}

/**
 * 입력·테이블 생성을 **막아야 하는가**(fail-closed 판정).
 *
 * ⚠️ "출처가 일치하지 않으면 막는다"로 만들면 **PRINCIPLES §5(오프라인·미로그인 내성)를 깬다** —
 * 이 앱은 시트를 연결하지 않은 상태에서도 기록할 수 있어야 하고(나중에 업로드), 그 경우
 * `sheetUrl`도 `columnsSheetId`도 비어 있는 것이 **정상**이다.
 *
 * 진짜 위험은 **"연결된 시트가 있는데 columns가 그 시트 것이 아닌"** 불일치다. 그 상태로
 * 입력하면 다른 농가 시트에 기록된다(리뷰#4 Critical). 그것만 막는다.
 *
 * - 시트 미연결(`sheetUrl` 없음) → 로컬 기록 모드. **허용**.
 * - 시트 연결됨 + 출처 일치 → **허용**.
 * - 시트 연결됨 + 출처 불일치(또는 출처 미상: v11 업그레이드 직후) → **차단**.
 */
export function isSheetSourceBlocked(state: SheetSourceState): boolean {
  const connected = !!parseSpreadsheetId(state.sheetUrl) && !!state.sheetTab;
  if (!connected) return false; // 로컬 기록 모드 — 막지 않는다
  return !hasMatchingSheetSource(state);
}

/** 검증된 현재 설정을 새 세션/legacy 확인에 쓸 불변 목적지 스냅샷으로 바꾼다. */
export function sessionTargetFromSettings(state: SheetSourceState): SessionTarget | null {
  if (!hasMatchingSheetSource(state)) return null;
  return {
    spreadsheetId: parseSpreadsheetId(state.sheetUrl)!,
    sheetTab: state.sheetTab,
  };
}
