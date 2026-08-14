/**
 * sessionLabel — 순수 단위 테스트 (autoValue/koreanNum 패턴: Node 직접 import, 서버 불필요).
 *
 * v0.22.0 — 세션명 SSOT(buildSessionLabel/sessionConstantValue)와 같은-날 고유화
 * (ensureUniqueSessionLabel)를 검증한다.
 *
 * 핵심 회귀(P2 근인):
 *  - 세션 식별 스키마: 농가명=고정 / 라벨=단일선택 options / 처리=다중선택(순환).
 *    이전 구현은 fixed만 봐 단일선택 options(라벨=A)를 놓쳐 `2026-06-25 강남호`로 잘렸다.
 *    이제 `2026-06-25 강남호 A`가 나와야 한다.
 *  - 날짜·순환(seq·다중옵션) 컬럼은 라벨에서 제외.
 *  - 자유입력(customName)이 있으면 무엇보다 우선(날짜 미접두).
 */

import { test, expect } from '@playwright/test';
import {
  buildSessionLabel,
  sessionConstantValue,
  ensureUniqueSessionLabel,
} from '../src/lib/sessionLabel';
import { localTodayIso } from '../src/lib/weekTuesday';
import type { Column } from '../src/types';

function col(over: Partial<Column>): Column {
  return {
    id: 'c1', name: 't', type: 'text', input: 'auto', ttsAnnounce: false,
    auto: { kind: 'fixed', value: '' }, ...over,
  };
}

// 실제 세션 식별 스키마(농가명 고정 / 라벨 단일선택 / 처리 다중선택 / 조사일자 날짜 / 조사나무 seq).
function schema(): Column[] {
  return [
    col({ id: 'c1', name: '조사일자', type: 'date', auto: { kind: 'fixed', value: '오늘' } }),
    col({ id: 'c2', name: '농가명', auto: { kind: 'fixed', value: '강남호' } }),
    col({ id: 'c3', name: '라벨', type: 'options', auto: { kind: 'options', available: ['A', 'B'], selected: ['A'] } }),
    col({ id: 'c4', name: '처리', type: 'options', auto: { kind: 'options', available: ['시험', '관행'], selected: ['시험', '관행'] } }),
    col({ id: 'c5', name: '조사나무', type: 'int', auto: { kind: 'seq', from: 1, to: 10 } }),
    col({ id: 'c6', name: '횡경', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' } }),
  ];
}

test.describe('sessionConstantValue — 세션 상수(행마다 안 바뀌는 유효 자동입력값)', () => {
  test('fixed 값 있음 → 그 값', () => {
    expect(sessionConstantValue(col({ auto: { kind: 'fixed', value: '강남호' } }))).toBe('강남호');
  });
  test('fixed 빈값 → ""', () => {
    expect(sessionConstantValue(col({ auto: { kind: 'fixed', value: '' } }))).toBe('');
  });
  test("fixed '오늘'(placeholder) → \"\"", () => {
    expect(sessionConstantValue(col({ type: 'date', auto: { kind: 'fixed', value: '오늘' } }))).toBe('');
  });
  test('단일선택 options → selected[0] (P2 신규 — 기존 누락분)', () => {
    expect(
      sessionConstantValue(col({ type: 'options', auto: { kind: 'options', available: ['A', 'B'], selected: ['A'] } })),
    ).toBe('A');
  });
  test('다중선택 options(순환) → "" (행마다 바뀜)', () => {
    expect(
      sessionConstantValue(col({ type: 'options', auto: { kind: 'options', available: ['A', 'B'], selected: ['A', 'B'] } })),
    ).toBe('');
  });
  test('seq(순환) → ""', () => {
    expect(sessionConstantValue(col({ type: 'int', auto: { kind: 'seq', from: 1, to: 10 } }))).toBe('');
  });
  test('date 컬럼(고정값) → "" (생성일이 이미 접두)', () => {
    expect(sessionConstantValue(col({ type: 'date', auto: { kind: 'fixed', value: '2026-05-13' } }))).toBe('');
  });
  test('voice 입력은 상수 아님 → ""', () => {
    expect(sessionConstantValue(col({ input: 'voice', auto: { kind: 'fixed', value: 'x' } }))).toBe('');
  });
});

test.describe('buildSessionLabel — 세션명 SSOT', () => {
  test('생성일 + 농가명 + 단일선택 라벨 (P2 기대 디폴트)', () => {
    expect(buildSessionLabel(schema(), { isoDate: '2026-06-25' })).toBe('2026-06-25 강남호 A');
  });
  test('상수가 하나도 없으면 생성일 단독', () => {
    const cols = [
      col({ id: 'c1', name: '조사일자', type: 'date', auto: { kind: 'fixed', value: '오늘' } }),
      col({ id: 'c2', name: '조사나무', type: 'int', auto: { kind: 'seq', from: 1, to: 10 } }),
      col({ id: 'c3', name: '횡경', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' } }),
    ];
    expect(buildSessionLabel(cols, { isoDate: '2026-06-25' })).toBe('2026-06-25');
  });
  test('상수 join 순서는 columns 순서를 따른다', () => {
    const cols = [
      col({ id: 'c1', name: '농가명', auto: { kind: 'fixed', value: '강남호' } }),
      col({ id: 'c2', name: '라벨', type: 'options', auto: { kind: 'options', available: ['A'], selected: ['A'] } }),
      col({ id: 'c3', name: '구역', auto: { kind: 'fixed', value: '북1' } }),
    ];
    expect(buildSessionLabel(cols, { isoDate: '2026-06-25' })).toBe('2026-06-25 강남호 A 북1');
  });
  test('자유입력(customName)이 있으면 무엇보다 우선 — 날짜 미접두', () => {
    expect(buildSessionLabel(schema(), { isoDate: '2026-06-25', customName: '오전 1차' })).toBe('오전 1차');
  });
  test('자유입력 공백만이면 무시하고 자동 라벨로 폴백', () => {
    expect(buildSessionLabel(schema(), { isoDate: '2026-06-25', customName: '   ' })).toBe('2026-06-25 강남호 A');
  });
  test('isoDate 미지정이면 오늘 날짜(YYYY-MM-DD)로 시작', () => {
    // 🔴 v0.49 r5 Z1 — 기준은 **로컬** 오늘이다. 종전 이 줄은 `toISOString()`으로 기대값을
    //   만들어, 제품이 UTC를 쓰는 결함과 **같은 방향으로 함께 틀려** 결함을 가리고 있었다.
    expect(buildSessionLabel(schema())).toBe(`${localTodayIso()} 강남호 A`);
  });
});

/**
 * 🔴 v0.49 r5 Z1(codex R4-F1) — 접두 날짜가 UTC면 KST 00:00~08:59에 세션명이 **전날**로 찍힌다.
 *
 * 이 describe가 **벽시계에 기대지 않는** 이유: 결함 자체가 「특정 시간대에만 드러난다」이므로,
 * `new Date()`에 의존하는 오라클은 낮에 돌리면 조용히 vacuous가 된다 — 정확히
 * [TEST-MIDNIGHT-UTC-1]이 남긴 교훈의 반대편 함정이다. 그래서 `opts.now`로 순간을 주입하고,
 * 로컬/UTC가 **갈리는 순간**을 런타임 오프셋에서 역산한다(TZ 무관 — UTC 실행만 예외 처리).
 */
test.describe('Z1 — 접두 날짜는 로컬(UTC 금지)', () => {
  /** 로컬 날짜와 UTC 날짜가 반드시 갈리는 순간. getTimezoneOffset() = UTC-로컬(분). */
  function straddling(): { at: Date; local: string; utc: string } | null {
    const probe = new Date(2026, 7, 14, 12, 0, 0);
    const offsetMin = probe.getTimezoneOffset(); // KST(UTC+9) → -540
    if (offsetMin === 0) return null; // UTC 실행에서는 갈릴 수 있는 순간이 없다
    // 동경(offset<0): 로컬 자정 직후가 UTC로는 전날 / 서경(offset>0): 로컬 자정 직전이 UTC로 다음날
    const at = offsetMin < 0 ? new Date(2026, 7, 14, 0, 1, 0) : new Date(2026, 7, 14, 23, 59, 0);
    return { at, local: '2026-08-14', utc: at.toISOString().slice(0, 10) };
  }

  test('로컬 자정 경계에서 세션명 접두 = 로컬 날짜(≠ UTC 날짜)', () => {
    const s = straddling();
    test.skip(s === null, 'UTC 실행 — 로컬/UTC가 갈리는 순간이 존재하지 않는다');
    expect(s!.utc, '전제: 이 순간은 실제로 로컬/UTC 날짜가 갈린다').not.toBe(s!.local);
    // 반증: `localTodayIso` 대신 `toISOString()`로 되돌리면 이 단언이 UTC 날짜를 받아 red.
    expect(buildSessionLabel(schema(), { now: s!.at })).toBe(`${s!.local} 강남호 A`);
  });

  test('customName은 여전히 날짜를 접두하지 않는다(Z1이 우선순위를 건드리지 않음)', () => {
    const s = straddling();
    test.skip(s === null, 'UTC 실행 — 위와 같은 이유');
    expect(buildSessionLabel(schema(), { now: s!.at, customName: '오전 1차' })).toBe('오전 1차');
  });

  test('명시 isoDate는 now보다 우선한다(호출부 계약 불변)', () => {
    expect(buildSessionLabel(schema(), { isoDate: '2026-06-25', now: new Date(2026, 7, 14) }))
      .toBe('2026-06-25 강남호 A');
  });

  /**
   * 🔴 헬퍼만 고치면 **반쪽이다.** 세션명 접두를 만드는 호출부 3곳은 `isoDate`를 **직접 계산해**
   * 넘긴다 — 거기가 UTC로 남으면 기본값 수정은 우회된다(실측: 이 라운드에서 게이트 W3-3·W3-4를
   * red로 만든 건 `sessionLabel.ts`가 아니라 `useSettingsActions.prospectiveSessionLabel`이었다).
   * 그중 둘(`SessionOptionsSection`의 select/input onChange)은 e2e 도달 경로가 없어 소스 계약으로
   * 잠근다(이 레포의 `[node]` 계약 테스트 관례 — v049-prev-survey W3-7·W3-10).
   */
  test('[node] Z1 — 세션명 접두를 만드는 호출부가 UTC로 되돌아가지 않는다', async () => {
    const fs = await import('node:fs');
    const sites = [
      // v0.49 R1 P1-2 — prospectiveSessionLabel이 useSettingsActions.ts에서 서브 훅으로 이동.
      'src/lib/useSettingsTableGeneration.ts',
      'src/components/settings/SessionOptionsSection.tsx',
      'src/lib/sessionLabel.ts',
    ];
    for (const path of sites) {
      const src = fs.readFileSync(path, 'utf-8');
      // 주석은 제외한다 — 이 결함의 근거 설명이 본문에 `toISOString()`을 인용한다.
      const code = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
      expect(code, `${path}: 세션명 날짜를 UTC(toISOString)로 만들면 KST 새벽에 전날로 찍힌다`)
        .not.toContain('toISOString().slice(0, 10)');
      expect(code, `${path}: 로컬 날짜 SSOT(localTodayIso)를 쓰지 않는다`)
        .toContain('localTodayIso');
    }
  });
});

test.describe('ensureUniqueSessionLabel — 같은-날 중복 방지(기존 유지)', () => {
  test('충돌 없으면 그대로', () => {
    expect(ensureUniqueSessionLabel('2026-06-25 강남호 A', [])).toBe('2026-06-25 강남호 A');
  });
  test('충돌하면 -2, -3 … 부여', () => {
    expect(
      ensureUniqueSessionLabel('2026-06-25 강남호 A', ['2026-06-25 강남호 A', '2026-06-25 강남호 A-2']),
    ).toBe('2026-06-25 강남호 A-3');
  });
});
