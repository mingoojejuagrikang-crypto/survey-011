import { test, expect } from '@playwright/test';
import { hasMatchingSheetSource, sessionTargetFromSettings , isSheetSourceBlocked } from '../src/lib/sheetConnection';

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

// ── v0.38.0 리뷰#4 후속 — 시트 미연결(로컬 기록 모드)을 막으면 PRINCIPLES §5 위반 ──────────
//
// 이 앱은 미로그인·시트 미연결 상태에서도 기록할 수 있어야 한다(나중에 업로드). 처음 만든
// 게이트는 "출처가 일치하지 않으면 차단"이라 **시트를 연결하지 않은 정상 사용까지 막았다**
// (전체 스위트에서 입력 시작 불가 회귀 4건으로 드러났다). 차단 대상은 오직
// "연결된 시트가 있는데 columns가 그 시트 것이 아닌" 경우다.
test.describe('isSheetSourceBlocked — 차단 경계', () => {
  const local = { sheetUrl: '', sheetTab: '', columnsSheetId: null, columnsSheetTab: null };
  const connected = {
    sheetUrl: 'https://docs.google.com/spreadsheets/d/SHEET_A/edit',
    sheetTab: '농가A',
  };

  test('시트 미연결(로컬 기록 모드)은 막지 않는다 — PRINCIPLES §5', () => {
    expect(isSheetSourceBlocked(local)).toBe(false);
  });

  test('출처만 있고 시트 미연결이어도 막지 않는다', () => {
    expect(isSheetSourceBlocked({ ...local, columnsSheetId: 'SHEET_A', columnsSheetTab: '농가A' }))
      .toBe(false);
  });

  test('연결된 시트와 출처가 같으면 막지 않는다', () => {
    expect(isSheetSourceBlocked({ ...connected, columnsSheetId: 'SHEET_A', columnsSheetTab: '농가A' }))
      .toBe(false);
  });

  test('연결된 시트가 있는데 출처가 다르면 막는다', () => {
    expect(isSheetSourceBlocked({ ...connected, columnsSheetId: 'SHEET_B', columnsSheetTab: '농가A' }))
      .toBe(true);
    expect(isSheetSourceBlocked({ ...connected, columnsSheetId: 'SHEET_A', columnsSheetTab: '다른탭' }))
      .toBe(true);
  });

  test('연결된 시트가 있는데 출처가 미상(v11 업그레이드 직후)이면 막는다', () => {
    expect(isSheetSourceBlocked({ ...connected, columnsSheetId: null, columnsSheetTab: null }))
      .toBe(true);
  });
});
