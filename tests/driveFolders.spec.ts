/**
 * ensureEmailSubFolder — [RACE-6] 회귀 단위 테스트 (v0.35.1 Stage 1-3에서 통합하며 신설).
 *
 * [RACE-6] "ensureTeamSubFolder race → 중복 Drive 폴더"의 방어 계약을 고정한다:
 *  1) 캐시는 parent별로 주입·분리된다 — 로그 폴더 캐시가 다른 parent(feedback) 호출에 새면 오업로드.
 *  2) 중복 폴더가 있어도 createdTime asc 첫 번째(최고참)를 선택해 일관성 유지.
 *  3) 검색 실패는 silent fall-through(곧바로 생성 시도) 하지 않고 throw.
 *  4) 미존재 시 해당 parent 아래 생성 + 캐시 기록.
 *  5) Drive Q 리터럴 escape(backslash·single-quote).
 *
 * DOM 의존이 없는 주입형 서비스(src/lib/driveFolders.ts)라 Node에서 fetch 스텁만으로 실행한다
 * (koreanNum.spec.ts와 동일 러너, 서버 불필요).
 */

import { test, expect } from '@playwright/test';
import { ensureEmailSubFolder, escapeDriveQ, FILES_API } from '../src/lib/driveFolders';

const HEADERS = { Authorization: 'Bearer test-token' };
const LABELS = { search: '검색 실패', create: '생성 실패' };

interface RecordedCall {
  url: string;
  method: string;
  body?: unknown;
}

/** fetch 스텁: 호출 기록 + 시나리오별 응답. searchFiles=null이면 검색 자체가 !ok. */
function stubFetch(opts: {
  searchFiles: { id: string }[] | null;
  createdId?: string;
}): { calls: RecordedCall[]; restore: () => void } {
  const calls: RecordedCall[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (method === 'GET') {
      if (opts.searchFiles === null) {
        return { ok: false, status: 500, text: async () => 'boom' } as Response;
      }
      return { ok: true, json: async () => ({ files: opts.searchFiles }) } as Response;
    }
    return { ok: true, json: async () => ({ id: opts.createdId ?? 'created-id' }) } as Response;
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

test.describe('ensureEmailSubFolder — [RACE-6] 계약', () => {
  test('캐시 히트: 네트워크 0회, 캐시 ID 반환', async () => {
    const { calls, restore } = stubFetch({ searchFiles: [] });
    try {
      const id = await ensureEmailSubFolder('parent-log', 'a@b.c', {
        headers: HEADERS,
        readCache: () => 'cached-sub',
        errorLabels: LABELS,
      });
      expect(id).toBe('cached-sub');
      expect(calls.length).toBe(0);
    } finally { restore(); }
  });

  test('parent별 캐시 분리: 무캐시 호출(feedback 경로)은 다른 parent 캐시와 무관하게 자기 parent를 검색한다', async () => {
    const { calls, restore } = stubFetch({ searchFiles: [{ id: 'feedback-sub' }] });
    try {
      // 로그 폴더 캐시(cached-sub)가 존재하는 상황을 가정해도, feedback 호출은 readCache를
      // 주입받지 않으므로 그 캐시를 절대 볼 수 없다 — parent-feedback을 직접 검색해야 한다.
      const id = await ensureEmailSubFolder('parent-feedback', 'a@b.c', {
        headers: HEADERS,
        errorLabels: LABELS,
      });
      expect(id).toBe('feedback-sub');
      expect(calls.length).toBe(1);
      expect(decodeURIComponent(calls[0].url)).toContain(`'parent-feedback' in parents`);
    } finally { restore(); }
  });

  test('중복 폴더: createdTime asc 첫 번째(최고참) 선택 + 캐시 기록', async () => {
    const { calls, restore } = stubFetch({ searchFiles: [{ id: 'oldest' }, { id: 'newer' }] });
    try {
      let written: string | null = null;
      const id = await ensureEmailSubFolder('parent-log', 'a@b.c', {
        headers: HEADERS,
        readCache: () => null,
        writeCache: (v) => { written = v; },
        errorLabels: LABELS,
      });
      expect(id).toBe('oldest');
      expect(written).toBe('oldest');
      expect(calls[0].url).toContain('orderBy=createdTime');
    } finally { restore(); }
  });

  test('검색 실패: silent fall-through(생성 시도) 없이 throw', async () => {
    const { calls, restore } = stubFetch({ searchFiles: null });
    try {
      await expect(
        ensureEmailSubFolder('parent-log', 'a@b.c', { headers: HEADERS, errorLabels: LABELS }),
      ).rejects.toThrow('검색 실패: boom');
      expect(calls.length).toBe(1); // POST(생성)로 넘어가지 않았다
    } finally { restore(); }
  });

  test('미존재: 해당 parent 아래 생성 + 캐시 기록', async () => {
    const { calls, restore } = stubFetch({ searchFiles: [], createdId: 'new-sub' });
    try {
      let written: string | null = null;
      const id = await ensureEmailSubFolder('parent-log', 'a@b.c', {
        headers: HEADERS,
        writeCache: (v) => { written = v; },
        errorLabels: LABELS,
      });
      expect(id).toBe('new-sub');
      expect(written).toBe('new-sub');
      const create = calls[1];
      expect(create.method).toBe('POST');
      expect(create.url).toBe(FILES_API);
      expect(create.body).toEqual({
        name: 'a@b.c',
        mimeType: 'application/vnd.google-apps.folder',
        parents: ['parent-log'],
      });
    } finally { restore(); }
  });

  test('Drive Q escape: single-quote·backslash가 리터럴로 이스케이프된다', async () => {
    expect(escapeDriveQ(`o'brien\\x`)).toBe(`o\\'brien\\\\x`);
    const { calls, restore } = stubFetch({ searchFiles: [{ id: 'sub' }] });
    try {
      await ensureEmailSubFolder(`p'id`, `o'brien@x.y`, { headers: HEADERS, errorLabels: LABELS });
      const q = decodeURIComponent(calls[0].url);
      expect(q).toContain(`'p\\'id' in parents`);
      expect(q).toContain(`name='o\\'brien@x.y'`);
    } finally { restore(); }
  });
});
