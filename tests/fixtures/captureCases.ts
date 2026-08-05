/**
 * **어떤 화면을 뽑는가** — F3 입력화면 상태 목록의 SSOT.
 *
 * 캡처·검증 기계(`capture-current-states.spec.ts`)와 분리해 둔 이유: 뽑을 상태를 더하거나 빼는 일과,
 * 프리뷰를 만들고 실화면과 대조하는 일은 서로 다른 책임이다(GL-006 §3). 민구가 "이 상태도 보고 싶다"고
 * 하면 이 파일만 고치면 된다 — 검증 로직은 손대지 않는다.
 *
 * 상태 선정 근거: `Deliverables/2026-07-27-survey-011-log-analysis.md` §3(개선요청 9건의 원인·소스 매핑).
 */
import { expect, type Page } from '@playwright/test';

import { injectLevel, triggerAnomaly, fillAllRows } from './activeZones';
import { fireStt, fireSttInterim } from './stt';
import type { CardMeta } from './previewCapture';

/** 카드마다 추가로 남길 실측값(리포트에 그대로 인쇄된다). */
export type Measurements = Record<string, string | number>;

export interface StateCase extends CardMeta {
  /** 부팅 직후의 페이지를 이 카드가 보여줄 상태로 몬다. 필요하면 실측값을 돌려준다. */
  drive: (page: Page) => Promise<Measurements | void>;
  /** 과도 상태 카드용 — 캡처가 끝난 뒤에도 이 노드가 남아 있어야 한다(창이 닫힌 뒤 찍은 게 아님을 증명). */
  holdSelector?: string;
}

/** 목 TTS의 onend 지연을 **런타임에** 늘린다.
 *  ⚠️ initScript로 처음부터 늘리면 부팅 안내 TTS가 물려 있는 동안 STT 결과가 postTtsGuard에 막혀
 *  알람 자체가 발화하지 않는다(첫 실행에서 실제로 그렇게 깨졌다). 알람이 뜬 뒤에 늘려야 한다. */
async function readFontSize(page: Page, selector: string): Promise<number> {
  return page.locator(selector).evaluate((el) => parseFloat(getComputedStyle(el as HTMLElement).fontSize));
}

async function widenTtsWindow(page: Page, ms: number): Promise<void> {
  await page.evaluate((d) => {
    (window as unknown as { __ttsOnendDelayMs?: number }).__ttsOnendDelayMs = d;
  }, ms);
}

export const CASES: StateCase[] = [
  {
    name: '01-active-listening',
    group: '입력화면 현재상태',
    title: '입력 대기(도트)',
    feedback: 'fb-27-1 기준선',
    why: '무음(레벨 0) 기준선. 단일 도트 격자가 마이크 글리프를 그리는 상태 — 02와 대조하면 같은 격자의 모드 전환이 보인다.',
    drive: async (page) => { await injectLevel(page, 0); },
  },
  {
    name: '02-active-lowlevel',
    group: '입력화면 현재상태',
    title: '저레벨 입력 — 단일 도트 파형',
    feedback: 'fb-27-1 (F4)',
    why: 'B세션 실측 평균 레벨 0.06 주입. 별도 파형 레이어 없이 같은 25×14 도트 격자가 파형 모드로 전환된다.',
    drive: async (page) => { await injectLevel(page, 0.06); },
  },
  {
    name: '03-active-highlevel',
    group: '입력화면 현재상태',
    title: '고레벨 입력 — 단일 도트 파형',
    feedback: 'fb-27-1 대조군',
    why: 'A세션 실측 평균 레벨 0.20 주입. 같은 25×14 도트 격자가 더 큰 진폭의 파형을 그리는 상태.',
    drive: async (page) => { await injectLevel(page, 0.20); },
  },
  {
    name: '04-anomaly',
    group: '알람 카드',
    title: '이상치 알람 + 실시간 인식값',
    feedback: 'fb-27-7 (F8) · fb-27-9 (F3)',
    why: '알람 중 실시간 인식값(AlarmInterimStrip)이 정상 진행의 InterimLine보다 얼마나 작은지 육안 확인용. 알람값·직전/현재 배치(F9)도 여기서 본다.',
    drive: async (page) => {
      // fb-27-7의 핵심 주장("알람 중 인식값이 정상 진행보다 훨씬 작다")을 **같은 세션에서** 잰다.
      // 정상 진행의 InterimLine 먼저 — 알람이 뜨면 렌더러가 AlarmInterimStrip으로 갈린다.
      await fireSttInterim(page, '118.2', 200);
      const normal = await readFontSize(page, '[data-testid="interim-value"]');
      await triggerAnomaly(page);
      await fireSttInterim(page, '118.2', 300);
      await expect(page.locator('[data-testid="interim-value"]')).toBeVisible({ timeout: 3000 });
      const alarm = await readFontSize(page, '[data-testid="interim-value"]');
      return {
        '정상 진행 InterimLine': `${normal}px`,
        '알람 중 AlarmInterimStrip': `${alarm}px`,
        '비율(알람/정상)': `${Math.round((alarm / normal) * 100)}%`,
      };
    },
  },
  {
    name: '05-anomaly-corrected',
    group: '알람 카드',
    title: '정정 완료 — 문구 없이 복귀',
    feedback: 'fb-27-8 (F10)',
    why: '정정값을 수용한 뒤 `정상 : 복귀` 문구를 다시 띄우지 않고 진행으로 돌아가는 과도 상태.',
    // 이 카드는 에코 TTS 동안에만 떠 있다 — 캡처 뒤에도 살아 있는지 반드시 확인한다.
    holdSelector: '[data-testid="anomaly-alert"][data-status="corrected"]',
    drive: async (page) => {
      await triggerAnomaly(page);
      // 알람이 뜬 뒤에 TTS 창을 넓힌다 — 정정 카드는 에코 TTS가 끝나면 advance로 닫힌다.
      await widenTtsWindow(page, 3000);
      // 직전값 100.0 · trendRule=increase(=커지면 알람) → 100 미만 값은 통과 = 정정 완료.
      await fireStt(page, '80.5', 0);
      await expect(page.locator('[data-testid="anomaly-alert"][data-status="corrected"]'))
        .toBeVisible({ timeout: 4000 });
    },
  },
  {
    name: '06-panel-open',
    group: '입력화면 현재상태',
    title: '조절판 확장 — 하단 행동행 완전 숨김',
    feedback: 'fb-27-5 (F2) · fb-27-6 (F1)',
    why: '확장 중에는 도트·양끝 행동행을 통째로 숨겨 겹칠 상자와 오탭 경로를 없앤 상태. 토글·스테퍼는 실제 hit-test로 가림이 없는지 검증한다.',
    drive: async (page) => {
      await injectLevel(page, 0);
      await page.locator('[data-testid="input-control-toggle"]').click();
      await expect(page.locator('[data-testid="stepper-tolerance"]')).toBeVisible({ timeout: 3000 });
      await page.waitForTimeout(300);
    },
  },
  {
    name: '07-paused',
    group: '입력화면 현재상태',
    title: '일시정지',
    feedback: '§[3] 기준선',
    why: '중앙·상단 상태어 비움 + aria 상태 + 하단 도트와 `<`=재시작 / `>`=종료.',
    drive: async (page) => {
      await page.locator('button[title="일시정지"]').click({ force: true });
      await expect(page.locator('[data-testid="paused-card"]')).toBeVisible({ timeout: 3000 });
      await page.waitForTimeout(300);
    },
  },
  {
    name: '08-complete',
    group: '입력화면 현재상태',
    title: '완료',
    feedback: '§[4] 기준선',
    why: '시각 상태어 없이 `X / N` 수치 + 종료 버튼으로 정착한 상태(영수증이 걷힌 뒤).',
    drive: async (page) => {
      await fillAllRows(page);
      await expect(page.locator('[data-testid="complete-receipt"]')).toHaveCount(0, { timeout: 8000 });
      await expect(page.locator('[data-testid="complete-count"]')).toBeVisible();
      await page.waitForTimeout(300);
    },
  },
  {
    name: '09-chipzone-overflow',
    group: '입력화면 현재상태',
    title: '칩존 오버플로 — 한 행 밖으로 밀린 칩(가로 스크롤)',
    feedback: 'fb-27-2 (F11)',
    why: '15개 칩이 한 행에 늘어서고 402px 폭을 넘긴다. 넘치는 칩은 **가로** 스크롤로만 접근 가능하다(v0.40.0 민구 확정). 진행중 칩이 우측 끝에 오도록 자동 스크롤된 상태로 굳혔다.',
    drive: async (page) => {
      await injectLevel(page, 0);
      const overflow = await page.locator('[data-testid="voice-chip-grid"]').evaluate((el) => {
        const g = el as HTMLElement;
        return { scrollLeft: g.scrollLeft, scrollWidth: g.scrollWidth, clientWidth: g.clientWidth };
      });
      // 공허 방지 — 실제로 넘치지 않으면 이 카드는 아무것도 보여주지 못한다.
      expect(overflow.scrollWidth, '칩존이 실제로 가로로 넘친다').toBeGreaterThan(overflow.clientWidth);
      await page.waitForTimeout(200);
    },
  },
];
