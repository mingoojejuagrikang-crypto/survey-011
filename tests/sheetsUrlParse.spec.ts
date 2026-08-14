/**
 * parseSpreadsheetId — 순수 단위 테스트 (sessionLabel/koreanNum 패턴: Node 직접 import, 서버 불필요).
 *
 * v0.49 R1 리뷰 CX-1 — P4에서 삭제한 `scripts/test-sheets-url.mjs`의 4케이스 이관.
 * 삭제 시점 문서(CONTRIBUTING §남아 있는 수동 스크립트)는 "연결 흐름 스펙과 tsc가 덮는다"고
 * 적었으나 실측 0곳이었다(연결 스펙들은 URL을 store에 직접 seed해 파서를 우회한다).
 * 이 스펙이 그 자리를 정식으로 잇는다 — 실 프로덕션 시트 식별 경로의 유일한 직접 오라클.
 * 반증 실측(08-14): `parseSpreadsheetId`를 `return null`로 변이하면 3/4 red.
 */

import { test, expect } from '@playwright/test';
import { parseSpreadsheetId } from '../src/lib/sheets';

test.describe('parseSpreadsheetId — 시트 URL → ID (구 test-sheets-url.mjs 4케이스)', () => {
  test('[node] 표준 편집 URL — 긴 실사용 ID(언더스코어 포함) + 쿼리스트링', () => {
    expect(
      parseSpreadsheetId(
        'https://docs.google.com/spreadsheets/d/1_d5L8jI583LN1n6rJ1H8_mPcsKMgEiYnYXhS_JOppDU/edit?usp=drive_link',
      ),
    ).toBe('1_d5L8jI583LN1n6rJ1H8_mPcsKMgEiYnYXhS_JOppDU');
  });

  test('[node] 하이픈 포함 ID', () => {
    expect(parseSpreadsheetId('https://docs.google.com/spreadsheets/d/abc-123/edit')).toBe('abc-123');
  });

  test('[node] 언더스코어 ID + #gid 프래그먼트', () => {
    expect(parseSpreadsheetId('https://docs.google.com/spreadsheets/d/xyz_456/edit#gid=0')).toBe(
      'xyz_456',
    );
  });

  test('[node] URL이 아니면 null', () => {
    expect(parseSpreadsheetId('not a url')).toBeNull();
  });
});
