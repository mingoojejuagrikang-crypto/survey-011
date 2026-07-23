import { test, expect } from '@playwright/test';
import { hasMatchingSheetSource, sessionTargetFromSettings } from '../src/lib/sheetConnection';

const MATCHED = {
  sheetUrl: 'https://docs.google.com/spreadsheets/d/SHEET_A/edit',
  sheetTab: '농가',
  columnsSheetId: 'SHEET_A',
  columnsSheetTab: '농가',
};

test('입력 게이트 — URL id와 탭이 columns 출처에 모두 일치할 때만 열린다', () => {
  expect(hasMatchingSheetSource(MATCHED)).toBe(true);
  expect(hasMatchingSheetSource({ ...MATCHED, columnsSheetId: 'SHEET_B' })).toBe(false);
  expect(hasMatchingSheetSource({ ...MATCHED, columnsSheetTab: '다른탭' })).toBe(false);
  expect(hasMatchingSheetSource({ ...MATCHED, sheetUrl: 'invalid' })).toBe(false);
});

test('검증된 설정만 Session.target 스냅샷으로 변환한다', () => {
  expect(sessionTargetFromSettings(MATCHED)).toEqual({ spreadsheetId: 'SHEET_A', sheetTab: '농가' });
  expect(sessionTargetFromSettings({ ...MATCHED, columnsSheetId: null })).toBeNull();
});
