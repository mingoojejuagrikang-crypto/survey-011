/**
 * v0.12.0 D1 — 다중 세션 CSV 내보내기는 세션별 CSV 1개씩을 ZIP으로 묶는다(병합 금지).
 * 단일 세션은 평문 .csv(상위 handleExport 분기). 여기선 순수 함수 sessionsToCsvZip을 검증한다.
 *
 * Node 런너(브라우저 불필요): JSZip 로드 + Blob → 엔트리 파싱.
 * 실행: npx playwright test tests/csv-export.spec.ts
 */
import { test, expect } from '@playwright/test';
import JSZip from 'jszip';
import { sessionsToCsv, sessionsToCsvZip } from '../src/lib/csv';
import type { Session, Column } from '../src/types';

const COLS_A: Column[] = [
  { id: 'c8', name: '횡경', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' } },
];
const COLS_B: Column[] = [
  { id: 'c9', name: '종경', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' } },
];

function mkSession(id: string, label: string | undefined, cols: Column[]): Session {
  return {
    id, date: '2026-06-17', label, columns: cols,
    rows: [{ index: 1, values: { [cols[0].id]: '10.0' }, complete: true }],
    completedRows: 1, syncedRows: 0, startedAt: 0,
  };
}

async function entryNames(blob: Blob): Promise<string[]> {
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  return Object.keys(zip.files).sort();
}

test('다중 세션 → 세션마다 CSV 1개씩 ZIP', async () => {
  const sessions = [mkSession('s1', 'A구역', COLS_A), mkSession('s2', 'B구역', COLS_B)];
  const blob = await sessionsToCsvZip(sessions);
  const names = await entryNames(blob);
  expect(names).toHaveLength(2);
  expect(names).toContain('A구역_2026-06-17.csv');
  expect(names).toContain('B구역_2026-06-17.csv');

  // 각 엔트리는 자기 세션만 담는다(병합 안 함) + BOM 보존.
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const a = await zip.file('A구역_2026-06-17.csv')!.async('string');
  expect(a.startsWith('﻿')).toBe(true);
  expect(a).toContain('횡경');
  expect(a).not.toContain('종경'); // B 세션 컬럼이 섞이지 않음
});

test('라벨 충돌 → -n 카운터로 분리', async () => {
  const sessions = [mkSession('s1', '같은이름', COLS_A), mkSession('s2', '같은이름', COLS_B)];
  const names = await entryNames(await sessionsToCsvZip(sessions));
  expect(names).toHaveLength(2);
  expect(names).toContain('같은이름_2026-06-17.csv');
  expect(names).toContain('같은이름_2026-06-17-1.csv');
});

test('라벨 없으면 id 폴백 + 경로 불법문자 치환', async () => {
  const sessions = [mkSession('s/x:1', undefined, COLS_A)];
  const names = await entryNames(await sessionsToCsvZip(sessions));
  expect(names[0]).toBe('s_x_1_2026-06-17.csv'); // / 와 : → _
});

test('단일 세션은 평문 sessionsToCsv와 동일 내용', async () => {
  const s = mkSession('solo', '단독', COLS_A);
  const zip = await JSZip.loadAsync(await (await sessionsToCsvZip([s])).arrayBuffer());
  const inZip = await zip.file('단독_2026-06-17.csv')!.async('string');
  expect(inZip).toBe(sessionsToCsv([s])); // ZIP 내 엔트리 == 평문 CSV
});
