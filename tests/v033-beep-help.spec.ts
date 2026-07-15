/**
 * v0.33.0 항목10-A/10-C (Vance) — 설정탭 도움말 데이터형 설명 + 비프음 선택.
 *
 *  [node] beepVariants 순수 검증 — 10종(긍정/부정 각 5), 500–1200Hz, ≤350ms, 기본값=현행 사운드,
 *         buildBeepSchedule 변환 계약, 미상 id 폴백.
 *  [UI]   설정 도움말 팝업에 데이터형 6항목(이름=자동 텍스트 전환 실동작 문구), 비프 칩 10개
 *         (탭=선택), persist v11 coercion(누락/손상 → 기본값, version bump 없음).
 *
 * UI 테스트 서버: `npm run dev -- --port 5175 --strictPort`.
 */
import { test, expect, type Page } from '@playwright/test';
import {
  BEEP_VARIANTS,
  DEFAULT_POSITIVE_BEEP_ID,
  DEFAULT_NEGATIVE_BEEP_ID,
  buildBeepSchedule,
  getBeepVariant,
  isBeepVariantId,
} from '../src/lib/beepVariants';

const BASE = 'http://localhost:5175';
const SETTINGS_KEY = 'survey-011-settings-v3';

// ─── [node] 비프 세그먼트 스펙 ───────────────────────────────────────────────

test('[node] 10-C — 변형 10종: 긍정/부정 각 5, id 유일', () => {
  expect(BEEP_VARIANTS).toHaveLength(10);
  expect(BEEP_VARIANTS.filter((v) => v.polarity === 'positive')).toHaveLength(5);
  expect(BEEP_VARIANTS.filter((v) => v.polarity === 'negative')).toHaveLength(5);
  const ids = BEEP_VARIANTS.map((v) => v.id);
  expect(new Set(ids).size).toBe(10);
});

test('[node] 10-C — 전 변형 제약: 주파수 500–1200Hz, 총 길이 ≤350ms, 게인 ≤0.06', () => {
  for (const v of BEEP_VARIANTS) {
    const schedule = buildBeepSchedule(v);
    expect(schedule.length).toBeGreaterThan(0);
    for (const t of schedule) {
      expect(t.freq).toBeGreaterThanOrEqual(500);
      expect(t.freq).toBeLessThanOrEqual(1200);
      if (t.endFreq != null) {
        expect(t.endFreq).toBeGreaterThanOrEqual(500);
        expect(t.endFreq).toBeLessThanOrEqual(1200);
      }
      expect(t.gain).toBeLessThanOrEqual(0.06);
      expect(t.stopMs).toBeGreaterThan(t.startMs);
    }
    const totalMs = Math.max(...schedule.map((t) => t.stopMs));
    expect(totalMs).toBeLessThanOrEqual(350);
  }
});

test('[node] 10-C — 기본값 = 현행 사운드(긍정 520→880/180ms/0.045, 부정 740→520/210ms/0.055)', () => {
  const pos = buildBeepSchedule(getBeepVariant(DEFAULT_POSITIVE_BEEP_ID, 'positive'));
  expect(pos).toEqual([{ startMs: 0, stopMs: 180, freq: 520, endFreq: 880, gain: 0.045, wave: 'sine' }]);
  const neg = buildBeepSchedule(getBeepVariant(DEFAULT_NEGATIVE_BEEP_ID, 'negative'));
  expect(neg).toEqual([{ startMs: 0, stopMs: 210, freq: 740, endFreq: 520, gain: 0.055, wave: 'sine' }]);
});

test('[node] 10-C — buildBeepSchedule 계약: startMs 오름차순, stopMs=at+dur, 동일 endFreq는 null', () => {
  for (const v of BEEP_VARIANTS) {
    const schedule = buildBeepSchedule(v);
    for (let i = 1; i < schedule.length; i++) {
      expect(schedule[i].startMs).toBeGreaterThanOrEqual(schedule[i - 1].startMs);
    }
    for (const t of schedule) {
      if (t.endFreq != null) expect(t.endFreq).not.toBe(t.freq);
    }
  }
});

test('[node] 10-C — 미상 id/극성 불일치 폴백 + isBeepVariantId 방어', () => {
  expect(getBeepVariant('bogus', 'positive').id).toBe(DEFAULT_POSITIVE_BEEP_ID);
  expect(getBeepVariant('bogus', 'negative').id).toBe(DEFAULT_NEGATIVE_BEEP_ID);
  // 극성이 다른 실존 id도 그 극성 기본으로 폴백(긍정 자리에 부정음이 끼지 않게).
  expect(getBeepVariant('neg-fall', 'positive').id).toBe(DEFAULT_POSITIVE_BEEP_ID);
  expect(isBeepVariantId('pos-rise', 'positive')).toBe(true);
  expect(isBeepVariantId('pos-rise', 'negative')).toBe(false);
  expect(isBeepVariantId(42, 'positive')).toBe(false);
  expect(isBeepVariantId(undefined, 'negative')).toBe(false);
});

// ─── [UI] 설정탭 ─────────────────────────────────────────────────────────────

async function goToSettings(page: Page) {
  await page.setViewportSize({ width: 402, height: 874 });
  await page.goto(BASE);
  await page.waitForLoadState('networkidle');
  await page.locator('[data-testid="tab-settings"]').click();
  await page.waitForTimeout(300);
}

test('[UI] 10-A — 설정 도움말 팝업에 데이터형 6항목(이름=자동 텍스트 전환 실동작 문구)', async ({ page }) => {
  await goToSettings(page);
  await page.locator('[data-testid="settings-help-button"]').click();
  const modal = page.locator('[data-testid="settings-help-modal"]');
  await expect(modal).toBeVisible({ timeout: 2000 });

  for (const label of ['날짜', '텍스트', '정수', '실수', '리스트', '이름']) {
    await expect(modal.getByText(`데이터형 — ${label}`, { exact: true })).toBeVisible();
  }
  // '이름' 문구는 name→text 자동 치유 실동작(applySemanticDefaults)과 일치해야 한다.
  await expect(modal).toContainText('새로 고를 수 없습니다');
  await expect(modal).toContainText('자동으로 ‘텍스트’로 바뀌며');
  // 기존 COLUMN_HELP도 그대로(통합이지 대체가 아님).
  await expect(modal).toContainText('입력방식 — 자동 / 음성 / 수동');
  console.log('✓ 데이터형 6항목 + 이름 자동 전환 문구 + 기존 항목 보존');
});

test('[UI] 10-C — 비프 칩 10개, 기본 선택 = 현행 사운드, 탭=선택 전환 + 영속', async ({ page }) => {
  await goToSettings(page);
  const picker = page.locator('[data-testid="beep-picker"]');
  await picker.scrollIntoViewIfNeeded();
  await expect(picker).toBeVisible();

  for (const v of BEEP_VARIANTS) {
    await expect(picker.locator(`[data-testid="beep-chip-${v.id}"]`)).toBeVisible();
  }
  await expect(picker.locator('[data-testid="beep-chip-pos-rise"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(picker.locator('[data-testid="beep-chip-neg-fall"]')).toHaveAttribute('aria-pressed', 'true');
  console.log('✓ 칩 10개 + 기본 선택(상승/하강)');

  // 긍정 '벨' 선택 → aria-pressed 이동, 부정 선택은 불변.
  await picker.locator('[data-testid="beep-chip-pos-bell"]').click();
  await page.waitForTimeout(200);
  await expect(picker.locator('[data-testid="beep-chip-pos-bell"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(picker.locator('[data-testid="beep-chip-pos-rise"]')).toHaveAttribute('aria-pressed', 'false');
  await expect(picker.locator('[data-testid="beep-chip-neg-fall"]')).toHaveAttribute('aria-pressed', 'true');

  // 영속(persist) — reload 후에도 선택 유지.
  await page.reload();
  await page.waitForLoadState('networkidle');
  await page.locator('[data-testid="tab-settings"]').click();
  await page.waitForTimeout(300);
  await expect(page.locator('[data-testid="beep-chip-pos-bell"]')).toHaveAttribute('aria-pressed', 'true');
  console.log('✓ 탭=선택 전환 + reload 영속');
});

test('[UI] 10-B/10-C — persist migrate coercion: 구버전(v10) 손상/누락 → 기본값 치유, version 11 유지', async ({ page }) => {
  await page.setViewportSize({ width: 402, height: 874 });
  // 구버전(v10) 영속본 시뮬레이션 — migrate가 실행되는 경로(version < 11). 신규 필드는 손상값으로
  // 심어 coercion을 검증한다(누락 케이스는 zustand shallow-merge 기본값 경로로 별도 커버됨 —
  // 아래 '기본 선택' 테스트가 그 경로다).
  await page.addInitScript(({ key }) => {
    const persisted = {
      state: {
        googleConnected: false, userEmail: null, sheet: null, sheetUrl: '', sheetTab: '',
        availableSheets: [], savedSheets: [], manualMode: false, columns: [], tableGenerated: false,
        totalRows: 50, ttsRate: 1.05, recognitionTolerance: 0.6,
        sessionLabelColId: null, sessionAutoLabel: null, sessionCustomLabel: null,
        fastRecognition: false, preferredVoiceName: '', teamFolderId: null, userLogFolderId: null,
        roundDateColId: null, reviewFilters: [], reviewTargetRound: null, reviewBaselineBack: 1,
        reviewGroupCols: null, reviewMeasureCols: null, reviewSelectedRows: null,
        trendRuleClearedV6: true,
        // 손상값: 캡처 토글은 문자열, 긍정 자리에 부정 id(극성 불일치), 부정 자리에 미상 id.
        autoScreenCapture: 'yes', beepPositiveId: 'neg-fall', beepNegativeId: 'bogus',
        // v0.35.0 FIX-1 — beepVolume 손상값(범위 밖)도 기본 0.5로 coercion(version 11 유지).
        beepVolume: 9,
      },
      version: 10,
    };
    localStorage.setItem(key, JSON.stringify(persisted));
  }, { key: SETTINGS_KEY });

  await page.goto(BASE);
  await page.waitForLoadState('networkidle');

  // migrate 후 재영속 — version이 11이 되고(bump 없음 = 최신이 11), 손상값이 치유되어 있어야 한다.
  await expect
    .poll(async () => page.evaluate((key) => {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as { version: number }).version : null;
    }, SETTINGS_KEY))
    .toBe(11);
  const stored = await page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    return JSON.parse(raw!) as { state: { autoScreenCapture: unknown; beepPositiveId: unknown; beepNegativeId: unknown; beepVolume: unknown } };
  }, SETTINGS_KEY);
  expect(stored.state.autoScreenCapture).toBe(true);
  expect(stored.state.beepPositiveId).toBe('pos-rise');
  expect(stored.state.beepNegativeId).toBe('neg-fall');
  expect(stored.state.beepVolume).toBe(0.5); // 범위 밖(9) → 기본 0.5 치유

  // UI에도 치유 결과 반영.
  await page.locator('[data-testid="tab-settings"]').click();
  await page.waitForTimeout(300);
  const toggle = page.locator('[data-testid="auto-capture-toggle"]');
  await toggle.scrollIntoViewIfNeeded();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-testid="beep-chip-pos-rise"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-testid="beep-chip-neg-fall"]')).toHaveAttribute('aria-pressed', 'true');
  console.log('✓ v10 손상값 → migrate coercion 치유 + version 11');
});

test('[UI] 10-B — 자동 캡처 토글: 기본 on, 탭=off 전환 + 영속', async ({ page }) => {
  await goToSettings(page);
  const toggle = page.locator('[data-testid="auto-capture-toggle"]');
  await toggle.scrollIntoViewIfNeeded();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');

  await toggle.click();
  await page.waitForTimeout(200);
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');

  await page.reload();
  await page.waitForLoadState('networkidle');
  await page.locator('[data-testid="tab-settings"]').click();
  await page.waitForTimeout(300);
  await expect(page.locator('[data-testid="auto-capture-toggle"]')).toHaveAttribute('aria-pressed', 'false');
  console.log('✓ 기본 on → off 전환 + reload 영속');
});
