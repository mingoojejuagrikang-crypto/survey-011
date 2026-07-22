/**
 * v0.32.0 설정탭 UX(Vance) — B1·B2·B3·B4 검증.
 *   B1 — 생성 게이트('설정값 확인')가 무스크롤: 테이블 본문 제거, 요약(SettingsSummary)만.
 *        ≤12컬럼(1줄씩)·15컬럼(2열 그리드) 둘 다 카드가 스크롤 없이 들어간다.
 *        게이트 안 "생성될 테이블 미리보기"로 닫기 전용 테이블 미리보기를 오버레이.
 *   B2 — 설정 요약 팝업(설정탭 전용): 로그인/시트/생성 상태 + 요약 + 다이얼 한 줄, 무스크롤.
 *   B3 — 초기화: 기본값 복귀 + Google 로그인·시트 URL은 기본 보존, 체크박스로 opt-in 삭제.
 *   B4 — 생성 완료 후 "입력탭으로 이동 →" 버튼(자동 탭 전환 없음 — 민구 확정).
 *
 * 375×812 시뮬레이션(GL-005). localStorage 시드는 persist version 11 — v12 migrate를 타고 승격된다.
 */
import { test, expect, type Page } from '@playwright/test';

const BASE = 'http://localhost:5175';
const STORE_KEY = 'survey-011-settings-v3';
const PHONE_375 = { width: 375, height: 812 };

// settingsStore.ts MOCK_COLUMNS와 동일한 신규 설치 기본 10컬럼(시드용 사본).
const DEFAULT_COLUMNS = [
  { id: 'c1',  name: '조사일자', type: 'date',  input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '오늘' } },
  { id: 'c2',  name: '기준일자', type: 'date',  input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '2026-05-13' } },
  { id: 'c3',  name: '농가명',   type: 'text',  input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '이원창' } },
  { id: 'c4',  name: '라벨',     type: 'text',  input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: 'A' } },
  { id: 'c5',  name: '처리',     type: 'text',  input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '시험' } },
  { id: 'c6',  name: '조사나무', type: 'int',   input: 'auto', ttsAnnounce: true,  auto: { kind: 'seq', from: 1, to: 10 } },
  { id: 'c7',  name: '조사과실', type: 'int',   input: 'auto', ttsAnnounce: true,  auto: { kind: 'seq', from: 1, to: 5 } },
  { id: 'c8',  name: '횡경',     type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1 },
  { id: 'c9',  name: '종경',     type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1 },
  { id: 'c10', name: '비고',     type: 'text',  input: 'touch', ttsAnnounce: false, auto: { kind: 'fixed', value: '' } },
];

/** 2열 그리드 경로(>12컬럼) 검증용 — 기본 10 + 자동입력 텍스트 5 = 15컬럼. */
const FIFTEEN_COLUMNS = [
  ...DEFAULT_COLUMNS,
  ...Array.from({ length: 5 }, (_, i) => ({
    id: `x${i + 1}`, name: `추가항목${i + 1}`, type: 'text', input: 'auto',
    ttsAnnounce: false, auto: { kind: 'fixed', value: `값${i + 1}` },
  })),
];

// ─── helpers ─────────────────────────────────────────────────────────────────

/** localStorage 초기화 후 설정탭 진입(신규 설치 기본 상태). */
async function freshSettings(page: Page) {
  await page.setViewportSize(PHONE_375);
  await page.goto(BASE);
  await page.waitForLoadState('domcontentloaded');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(400);
  await page.locator('[data-testid="tab-settings"]').click();
  await page.waitForTimeout(300);
}

/** persist version 11 페이로드로 부분 상태를 시드하고 설정탭 진입(migrate가 v12로 승격). */
async function seedSettings(page: Page, state: Record<string, unknown>) {
  await page.setViewportSize(PHONE_375);
  await page.goto(BASE);
  await page.waitForLoadState('domcontentloaded');
  await page.evaluate(({ key, payload }) => {
    localStorage.clear();
    localStorage.setItem(key, JSON.stringify(payload));
  }, { key: STORE_KEY, payload: { state, version: 11 } });
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(400);
  await page.locator('[data-testid="tab-settings"]').click();
  await page.waitForTimeout(300);
}

async function readStore(page: Page): Promise<{ version: number; state: Record<string, unknown> }> {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? 'null'), STORE_KEY);
}

/** "입력 테이블 생성"(또는 재생성) 클릭 → 게이트 오픈 대기. */
async function openGate(page: Page) {
  await page.locator('text=입력 테이블 생성').first().click();
  await page.waitForTimeout(400);
  await expect(page.locator('[data-testid="gate-card"]')).toBeVisible({ timeout: 3000 });
}

/** 카드 자신 + 내부 어디에도 세로 스크롤이 없어야 한다(무스크롤 원칙). */
async function expectNoScroll(page: Page, testid: string) {
  const card = page.locator(`[data-testid="${testid}"]`);
  const metrics = await card.evaluate((el) => {
    const scrollables = Array.from(el.querySelectorAll('*')).filter((n) => {
      const cs = getComputedStyle(n);
      return (
        (cs.overflowY === 'auto' || cs.overflowY === 'scroll') &&
        n.scrollHeight > n.clientHeight + 1
      );
    }).length;
    return { sh: el.scrollHeight, ch: el.clientHeight, scrollables };
  });
  console.log(`${testid}: scrollHeight=${metrics.sh} clientHeight=${metrics.ch} innerScrollables=${metrics.scrollables}`);
  expect(metrics.sh).toBeLessThanOrEqual(metrics.ch + 1);
  expect(metrics.scrollables).toBe(0);
}

// ─── B1. 게이트 무스크롤 ─────────────────────────────────────────────────────

test('B1 — 게이트(기본 10컬럼)가 스크롤 없이 다 보인다 + 제목/확인 버튼', async ({ page }) => {
  await freshSettings(page);
  await openGate(page);

  // 제목은 기존 그대로(v5-ui.spec.ts:176 정확 일치 보호).
  await expect(page.locator('text=입력 테이블 생성 — 설정값 확인')).toBeVisible();

  await expectNoScroll(page, 'gate-card');

  // 확인 버튼 문구 '이대로 생성'(마지막 '생성' 포함 버튼 = 게이트 확인 — 기존 헬퍼 호환).
  const confirmBtn = page.locator('button', { hasText: '이대로 생성' });
  await expect(confirmBtn).toBeVisible();
  const lastGen = page.locator('button', { hasText: '생성' }).last();
  await expect(lastGen).toHaveText(/이대로 생성/);
  console.log('✓ 게이트 무스크롤 + 이대로 생성 확인');
});

test('B1 — 게이트(15컬럼, 2열 그리드)도 스크롤 없이 다 보인다', async ({ page }) => {
  await seedSettings(page, { columns: FIFTEEN_COLUMNS, totalRows: 50 });
  await openGate(page);

  // 15컬럼 → 2열 그리드 경로. 그리드 셀에 추가 컬럼이 실제 렌더됐는지 확인.
  await expect(page.locator('[data-testid="gate-card"]')).toContainText('추가항목5');
  await expectNoScroll(page, 'gate-card');
  console.log('✓ 15컬럼 게이트 무스크롤(2열 그리드)');
});

test('B1 — 게이트의 "생성될 테이블 미리보기"로 테이블 미리보기 오버레이', async ({ page }) => {
  await freshSettings(page);
  await openGate(page);

  await page.locator('button', { hasText: '생성될 테이블 미리보기' }).click();
  await page.waitForTimeout(300);

  // 닫기 전용 미리보기(제목 정확 일치 — 게이트 버튼 문구와 구분)가 게이트 위에 열린다.
  const previewCard = page.locator('[data-testid="table-preview-card"]');
  await expect(previewCard).toBeVisible({ timeout: 2000 });
  await expect(page.getByText('테이블 미리보기', { exact: true })).toBeVisible();
  // 테이블 헤더(첫 컬럼명)가 실제 렌더된다.
  await expect(previewCard).toContainText('조사일자');

  // 닫으면 게이트는 그대로 남아 있다.
  await previewCard.locator('button', { hasText: '확인' }).click();
  await page.waitForTimeout(200);
  await expect(previewCard).toBeHidden();
  await expect(page.locator('[data-testid="gate-card"]')).toBeVisible();
  console.log('✓ 게이트 → 미리보기 오버레이 → 닫기 → 게이트 유지');
});

// ─── B2. 설정 요약 팝업 ──────────────────────────────────────────────────────

test('B2 — 설정 요약 팝업: 컬럼 수·행수·다이얼 표시 + 무스크롤 + 닫기', async ({ page }) => {
  await freshSettings(page);

  await page.locator('[data-testid="settings-summary-open"]').click();
  await page.waitForTimeout(300);

  const modal = page.locator('[data-testid="settings-summary-modal"]');
  await expect(modal).toBeVisible({ timeout: 2000 });
  await expect(modal).toContainText('전체 항목');
  await expect(modal).toContainText('총 행수');
  await expect(modal).toContainText('인식 60%');   // recognitionTolerance 기본 0.60
  await expect(modal).toContainText('미생성');      // 생성 전 상태
  await expect(modal).toContainText('미연결');      // 로그인/시트 미연결
  await expectNoScroll(page, 'settings-summary-card');

  await modal.locator('button', { hasText: '닫기' }).click();
  await page.waitForTimeout(200);
  await expect(modal).toBeHidden();
  console.log('✓ 설정 요약 팝업 표시·무스크롤·닫기');
});

// ─── B3. 초기화 ──────────────────────────────────────────────────────────────

const CUSTOMIZED_STATE = {
  columns: [...DEFAULT_COLUMNS, {
    id: 'x9', name: '임시항목', type: 'text', input: 'auto',
    ttsAnnounce: false, auto: { kind: 'fixed', value: 'tmp' },
  }],
  totalRows: 77,
  tableGenerated: true,
  fastRecognition: true,
  ttsRate: 1.3,
  recognitionTolerance: 0.8,
  beepVolume: 0.95, // v0.35.0 FIX-5 — 비기본 볼륨 시드(초기화가 기본 0.5로 복원하는지 검증)
  sessionCustomLabel: '내세션',
  googleConnected: true,
  userEmail: 'tester@example.com',
  sheetUrl: 'https://docs.google.com/spreadsheets/d/abc123def/edit',
  sheetTab: '시트1',
  savedSheets: [{ name: '측정시트A', url: 'https://docs.google.com/spreadsheets/d/abc123def/edit', sheetId: 'abc123def', addedAt: 1 }],
};

test('B3 — 초기화(체크박스 없음): 기본값 복귀 + 로그인·시트 보존', async ({ page }) => {
  await seedSettings(page, CUSTOMIZED_STATE);

  await page.locator('[data-testid="settings-reset-open"]').click();
  await page.waitForTimeout(300);
  const modal = page.locator('[data-testid="settings-reset-modal"]');
  await expect(modal).toBeVisible({ timeout: 2000 });
  // 보존 항목 안내가 보인다.
  await expect(modal).toContainText('Google 로그인');

  await page.locator('[data-testid="settings-reset-confirm"]').click();
  await page.waitForTimeout(500);
  await expect(modal).toBeHidden();

  const stored = await readStore(page);
  // 초기화됨 — 기본값 복귀.
  expect(stored.state.totalRows).toBe(50);
  expect(stored.state.tableGenerated).toBe(false);
  expect(stored.state.fastRecognition).toBe(false);
  expect(stored.state.ttsRate).toBe(1.05);
  expect(stored.state.recognitionTolerance).toBe(0.6);
  expect(stored.state.beepVolume).toBe(0.5); // v0.35.0 FIX-5 — 볼륨도 기본값 복원
  expect(stored.state.sessionCustomLabel).toBeNull();
  expect((stored.state.columns as unknown[]).length).toBe(10); // 임시항목 제거 → 기본 10항목
  // 보존됨 — 로그인·시트(기본 opt-out).
  expect(stored.state.userEmail).toBe('tester@example.com');
  expect(stored.state.sheetUrl).toContain('abc123def');
  expect((stored.state.savedSheets as unknown[]).length).toBe(1);
  // 행수 힌트도 기본 50행으로 돌아온다(UI 검증).
  await expect(page.locator('text=생성 예정')).toContainText('50행');
  // 첫 진입 안내 배너 재노출(SETTINGS_TIP_SEEN_KEY 제거).
  await expect(page.locator('[data-testid="settings-first-tip"]')).toBeVisible();
  console.log('✓ 초기화: 기본값 복귀 + 로그인/시트 보존 + 안내 배너 재노출');
});

test('B3 — 초기화(체크박스 2개): 로그인 해제 + 시트 URL·저장 시트 삭제', async ({ page }) => {
  await seedSettings(page, CUSTOMIZED_STATE);

  await page.locator('[data-testid="settings-reset-open"]').click();
  await page.waitForTimeout(300);
  await expect(page.locator('[data-testid="settings-reset-modal"]')).toBeVisible({ timeout: 2000 });

  // 두 opt-in 체크박스 모두 선택(기본은 unchecked).
  const loginCb = page.locator('[data-testid="settings-reset-clear-login"]');
  const sheetsCb = page.locator('[data-testid="settings-reset-clear-sheets"]');
  await expect(loginCb).not.toBeChecked();
  await expect(sheetsCb).not.toBeChecked();
  await loginCb.check();
  await sheetsCb.check();

  // googleSignOut()은 토큰이 없으면 no-op — throw 없이 진행돼야 한다.
  await page.locator('[data-testid="settings-reset-confirm"]').click();
  await page.waitForTimeout(600);
  await expect(page.locator('[data-testid="settings-reset-modal"]')).toBeHidden();

  const stored = await readStore(page);
  expect(stored.state.googleConnected).toBe(false);
  expect(stored.state.userEmail).toBeNull();
  expect(stored.state.sheetUrl).toBe('');
  expect(stored.state.sheetTab).toBe('');
  expect((stored.state.savedSheets as unknown[]).length).toBe(0);
  expect(stored.state.totalRows).toBe(50);
  console.log('✓ 초기화 + opt-in 삭제: 로그인 해제 · 시트 URL/저장 시트 삭제');
});

// ─── C10(v0.34.0). 설정 요약 인라인(하단 배치) ───────────────────────────────

/** SettingsSummary pill(라벨 span + 값 span 2-child div)에서 라벨→값 맵 추출.
 *  '생성됨'/'생성 예정' 텍스트 로케이터에 민감한 기존 스펙 보호 — 단언은 testid + 구조 기반. */
async function summaryPills(page: Page, scopeSelector: string): Promise<Record<string, string>> {
  return page.locator(scopeSelector).evaluate((root) => {
    const wanted = ['음성입력', '자동입력', '수동입력', '전체 항목', '총 행수'];
    const out: Record<string, string> = {};
    root.querySelectorAll('div').forEach((d) => {
      if (
        d.children.length === 2 &&
        d.children[0].tagName === 'SPAN' &&
        d.children[1].tagName === 'SPAN'
      ) {
        const label = d.children[0].textContent?.trim() ?? '';
        if (wanted.includes(label)) out[label] = d.children[1].textContent?.trim() ?? '';
      }
    });
    return out;
  });
}

test('C10 — 설정 요약 인라인이 스크롤 말미(액션바 위)에 존재 + 팝업 요약과 동일 수치', async ({ page }) => {
  await freshSettings(page);

  // ① 인라인 요약 존재(스크롤 영역 안 — 스크롤해야 보인다) + 상단 팝업 버튼은 그대로 유지.
  await expect(page.locator('[data-testid="settings-summary-open"]')).toBeVisible();
  const inline = page.locator('[data-testid="settings-summary-inline"]');
  await inline.scrollIntoViewIfNeeded();
  await expect(inline).toBeVisible();

  // ② 인라인이 footer(무스크롤 액션바)가 아니라 스크롤 영역 안에 있다:
  //    scrollIntoView 없이도 위치가 스크롤에 따라 움직이는 요소인지 = offsetParent 체인이
  //    overflowY:auto 조상 안에 있는지로 판정.
  const inScrollArea = await inline.evaluate((el) => {
    for (let n = el.parentElement; n; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.overflowY === 'auto' || cs.overflowY === 'scroll') return true;
    }
    return false;
  });
  expect(inScrollArea, '인라인 요약이 스크롤 영역 안(footer 금지)').toBe(true);

  // v0.35.0 FB-E — 기본 접힘(온디맨드): 헤더는 있으나 요약 내용(pill)은 마운트 전. 헤더 탭으로 펼친다.
  const toggle = page.locator('[data-testid="settings-summary-toggle"]');
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(inline.locator('text=전체 항목')).toHaveCount(0); // 접힘 상태엔 내용 없음
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');

  const inlinePills = await summaryPills(page, '[data-testid="settings-summary-inline"]');
  expect(Object.keys(inlinePills).sort()).toEqual(['수동입력', '음성입력', '자동입력', '전체 항목', '총 행수'].sort());

  // ③ 팝업 요약과 수치 대조(같은 SettingsSummary SSOT — 동일 소스이므로 글자까지 동일).
  await page.locator('[data-testid="settings-summary-open"]').click();
  await page.waitForTimeout(300);
  await expect(page.locator('[data-testid="settings-summary-modal"]')).toBeVisible({ timeout: 2000 });
  const modalPills = await summaryPills(page, '[data-testid="settings-summary-card"]');
  expect(modalPills).toEqual(inlinePills);
  console.log(`✓ 인라인 요약 = 팝업 요약: ${JSON.stringify(inlinePills)}`);
});

// ─── B4. 생성 완료 → 입력탭 이동 ─────────────────────────────────────────────

test('B4 — 생성 완료 시 "입력탭으로 이동 →" 버튼 → 입력탭 전환', async ({ page }) => {
  await seedSettings(page, { columns: DEFAULT_COLUMNS, totalRows: 50, tableGenerated: true });

  const goBtn = page.locator('[data-testid="settings-go-input"]');
  await expect(goBtn).toBeVisible({ timeout: 3000 });
  // 기존 생성됨/재생성 행도 그대로 남아 있다.
  await expect(page.locator('text=생성됨').first()).toBeVisible();

  await goBtn.click();
  await page.waitForTimeout(400);

  // 입력탭(VoiceScreen)으로 전환 — 시작 버튼이 보인다.
  await expect(page.locator('text=음성 입력 시작').first()).toBeVisible({ timeout: 3000 });
  console.log('✓ 입력탭으로 이동 버튼 → VoiceScreen 전환');
});
