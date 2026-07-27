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
    why: '무음(레벨 0) 기준선. 도트만 보이고 파형은 물러나 있어야 하는 상태 — 02와 대조하면 결함이 드러난다.',
    drive: async (page) => { await injectLevel(page, 0); },
  },
  {
    name: '02-active-lowlevel',
    group: '결함 재현',
    title: '저레벨 입력 — 도트·파형 동시 렌더',
    feedback: 'fb-27-1 (F4)',
    why: 'B세션 실측 평균 레벨 0.06 주입. 크로스페이드 게이트가 오디오 레벨의 연속함수라 도트와 파형이 **동시에** 부분 가시가 된다. 결함 자체.',
    drive: async (page) => { await injectLevel(page, 0.06); },
  },
  {
    name: '03-active-highlevel',
    group: '입력화면 현재상태',
    title: '고레벨 입력 — 파형 전환',
    feedback: 'fb-27-1 대조군',
    why: 'A세션 실측 평균 레벨 0.20 주입. 파형이 완전히 올라온 정상 전환 상태 — 02와 나란히 봐야 대조가 성립한다.',
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
    title: '정정 완료 — `정상 : 복귀`',
    feedback: 'fb-27-8 (F10)',
    why: '삭제 대상 문구가 실제로 어떻게 보이는지. 오늘 실기기에서 19회 노출됐다.',
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
    group: '결함 재현',
    title: '조절판 확장 — 도트가 패널 위로 넘침',
    feedback: 'fb-27-5 (F2) · fb-27-6 (F1)',
    why: '🔴 가장 중요한 카드. 확장하면 인디케이터 행이 줄어드는데 StateDots에는 클램프 전 크기가 그대로 전달돼, 도트가 토글/스테퍼 위로 그려진다. 그 도트가 곧 일시정지 버튼이라 오탭이 났다(실기기 4회).',
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
    why: '중앙 비움 + 상단 배지 + 하단 `<`=재개 / `>`=종료. 오탭이 실제로 만들어낸 화면이기도 하다.',
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
    why: '`완료 : X / N` 요약 + 종료 버튼으로 정착한 상태(영수증이 걷힌 뒤).',
    drive: async (page) => {
      await fillAllRows(page);
      await expect(page.locator('[data-testid="complete-receipt"]')).toHaveCount(0, { timeout: 8000 });
      await expect(page.locator('[data-testid="complete-count"]')).toBeVisible();
      await page.waitForTimeout(300);
    },
  },
  {
    name: '09-chipzone-overflow',
    group: '결함 재현',
    title: '칩존 오버플로 — 2줄 밖으로 밀린 칩',
    feedback: 'fb-27-2 (F11)',
    why: '15개 칩이 4줄인데 25% 트랙에는 2줄만 보인다. 나머지는 구역 안 스크롤로만 접근 가능 — 재설계 대상. 스크롤을 끝까지 내린 상태로 굳혔다.',
    drive: async (page) => {
      await injectLevel(page, 0);
      const overflow = await page.locator('[data-testid="voice-chip-grid"]').evaluate((el) => {
        const g = el as HTMLElement;
        g.scrollTop = g.scrollHeight - g.clientHeight;
        return { scrollTop: g.scrollTop, scrollHeight: g.scrollHeight, clientHeight: g.clientHeight };
      });
      // 공허 방지 — 실제로 넘치지 않으면 이 카드는 아무것도 보여주지 못한다.
      expect(overflow.scrollHeight, '칩존이 실제로 넘친다').toBeGreaterThan(overflow.clientHeight);
      expect(overflow.scrollTop, '스크롤이 실제로 내려갔다').toBeGreaterThan(0);
      await page.waitForTimeout(200);
    },
  },
];
