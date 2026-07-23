import { parseSpreadsheetId } from './sheets';
import type { SessionTarget } from '../types';

export interface SheetSourceState {
  sheetUrl: string;
  sheetTab: string;
  columnsSheetId: string | null;
  columnsSheetTab: string | null;
}

/** 입력·테이블 생성이 사용해도 되는 시트와 현재 columns의 출처가 정확히 같은가. */
export function hasMatchingSheetSource(state: SheetSourceState): boolean {
  const spreadsheetId = parseSpreadsheetId(state.sheetUrl);
  return !!spreadsheetId
    && !!state.sheetTab
    && spreadsheetId === state.columnsSheetId
    && state.sheetTab === state.columnsSheetTab;
}

/** 검증된 현재 설정을 새 세션/legacy 확인에 쓸 불변 목적지 스냅샷으로 바꾼다. */
export function sessionTargetFromSettings(state: SheetSourceState): SessionTarget | null {
  if (!hasMatchingSheetSource(state)) return null;
  return {
    spreadsheetId: parseSpreadsheetId(state.sheetUrl)!,
    sheetTab: state.sheetTab,
  };
}
