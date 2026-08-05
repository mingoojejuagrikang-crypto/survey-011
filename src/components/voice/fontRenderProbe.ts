/**
 * v0.44.0 §5-1 ④ — 음성 화면 주요 슬롯의 **폰트 실렌더값** 세션당 1회 계측.
 *
 * 왜: 실기기 점검 항목 "곡선 3항만 값 변화"를 세 회차째 판정 못 했다 — 히어로 값·알람 비교
 * 라벨/값·활성 칩 라벨/값의 실렌더 fontSize가 로그에 없어서, 뷰포트별 clamp 곡선이 그 기기에서
 * 실제 몇 px로 해석됐는지를 추론으로만 세워야 했다.
 *
 * 계약:
 *  - **세션당 1회.** 안정 시점(세션 시작 FONT_RENDER_DELAY_MS 후 + rAF 2회 안정) 방출.
 *    모듈 레벨 `emittedForSession`(sessionId 키)이 1회 계약을 코드로 보장한다 — ActiveState가
 *    탭 전환 등으로 재마운트돼 다시 예약해도 같은 세션엔 두 번째 방출이 없다(링버퍼 잠식 금지).
 *  - **계측은 읽기만 한다.** 음성 컴포넌트의 fontSize를 바꾸지 않는다. 실렌더 요소가 없는
 *    슬롯(세션 시작 직후 히어로 값 슬롯은 비어 있고 알람 카드는 미마운트)만, 같은 컨테이너에
 *    보이지 않는 프로브 노드를 잠깐 붙여 곡선(heroLayout 계약 상수)을 해석해 읽고 즉시 뗀다.
 *    그 값은 `probe=` 마커로 출처가 남는다 — 실측과 곡선 해석이 로그에서 구분돼야 한다.
 *  - 칩 슬롯은 cq 단위(컨테이너 쿼리)라 실 요소/칩존 컨테이너 안에서만 해석된다 — 프로브도
 *    칩존 그리드 안에 붙인다(문서 body에 붙이면 cq가 소기준을 잃는다).
 *
 * 이벤트: `session` / extra `font_render:hero=..,alarmLabel=..,alarmValue=..,chipLabel=..,
 * chipValue=..,w=..,h=..,probe=..` (빌더 SSOT: logEvents.fontRenderSnapshot — 바이트 계약은
 * tests/logEvents.spec.ts, 발화는 tests/v0440-instrumentation.spec.ts가 잰다).
 */
import { logger } from '../../lib/logger';
import { fontRenderEcho, fontRenderSnapshot } from '../../lib/logEvents';
import { useSessionStore } from '../../stores/sessionStore';
import { CHIP_TYPE, HERO_TYPE, STATE_TYPE } from './heroLayout';

/** 안정 시점 — 세션 시작 TTS·칩존 정렬·fit 이진탐색이 정착한 뒤. 링버퍼 영향 없음(1회 계약). */
const FONT_RENDER_DELAY_MS = 3000;

/** 이미 방출한 세션 id — 재마운트/재예약을 관통하는 1회 계약의 SSOT. */
let emittedForSession = '';

function computedPx(el: Element): number {
  return Number.parseFloat(getComputedStyle(el).fontSize) || 0;
}

/** 실렌더 요소가 없을 때: 같은 컨테이너에 숨김 프로브를 붙여 곡선을 해석해 읽고 즉시 뗀다.
 *  컨테이너 상속(--fit-* 변수·cq 소기준)을 그대로 받으므로 "그 자리에 렌더됐다면 몇 px였나"다. */
function probePx(host: Element | null, fontSize: string): number {
  const parent = (host ?? document.body) as HTMLElement;
  const el = document.createElement('span');
  el.style.position = 'absolute';
  el.style.visibility = 'hidden';
  el.style.pointerEvents = 'none';
  el.style.fontSize = fontSize;
  el.textContent = '0';
  parent.appendChild(el);
  const px = computedPx(el);
  el.remove();
  return px;
}

interface SlotReading {
  px: number;
  probed: boolean;
}

function readSlot(liveSelectors: string[], probeHost: Element | null, probeFont: string): SlotReading {
  for (const sel of liveSelectors) {
    const el = document.querySelector(sel);
    if (el) return { px: computedPx(el), probed: false };
  }
  return { px: probePx(probeHost, probeFont), probed: true };
}

/** 활성 칩(없으면 첫 칩)의 라벨/값 span. 값 span은 라벨 다음 형제(ColumnChip 구조 계약 —
 *  편집 중이면 input이라 값 span이 없고, 그 경우 칩존 그리드 프로브로 폴백한다). */
function readChipSlots(): { label: SlotReading; value: SlotReading } {
  const chip =
    document.querySelector('[data-testid="column-chip"][data-active="true"]') ??
    document.querySelector('[data-testid="column-chip"]');
  const grid = document.querySelector('[data-testid="voice-chip-grid"]');
  const labelEl = chip?.querySelector('[data-testid="column-chip-label"]') ?? null;
  const label: SlotReading = labelEl
    ? { px: computedPx(labelEl), probed: false }
    : { px: probePx(grid, CHIP_TYPE.name), probed: true };
  let valueEl: Element | null = null;
  if (labelEl) {
    const next = labelEl.nextElementSibling;
    if (next && next.tagName === 'SPAN') valueEl = next;
  }
  const value: SlotReading = valueEl
    ? { px: computedPx(valueEl), probed: false }
    : { px: probePx(grid, CHIP_TYPE.value), probed: true };
  return { label, value };
}

/** 슬롯 5종 실측(+프로브 폴백). 음성 화면 루트가 없으면 null — 거짓 데이터를 만들지 않는다. */
function measureSlots(): Parameters<typeof fontRenderSnapshot>[0] | null {
  const root = document.querySelector('[data-testid="voice-active-state"]');
  if (!root) return null;

  const probed: string[] = [];
  // 히어로 값 — 확정값/interim 실렌더 우선. 대기 화면(값 슬롯 빈 상태)이면 히어로 루트에 프로브
  // (--fit-value 변수를 상속받는 자리 — 곡선 그대로의 해석값).
  const heroHost = document.querySelector('[data-hero-state]') ?? root;
  const hero = readSlot(
    ['[data-testid="hero-primary"]', '[data-testid="interim-value"]'],
    heroHost, HERO_TYPE.value,
  );
  if (hero.probed) probed.push('hero');

  // 알람 비교 라벨/값 — 알람 카드가 떠 있으면 실렌더(--fit-compare-* 반영), 아니면 vw 곡선 해석.
  const alarmLabel = readSlot(['[data-testid="anomaly-prev-label"]'], root, STATE_TYPE.compareLabel);
  if (alarmLabel.probed) probed.push('alarmLabel');
  const alarmValue = readSlot(['[data-testid="anomaly-prev-value"]'], root, STATE_TYPE.compareValue);
  if (alarmValue.probed) probed.push('alarmValue');

  // 활성 칩 라벨/값 — cq 단위라 실 요소(칩)가 기본. 세션 중엔 칩이 항상 있다.
  const chip = readChipSlots();
  if (chip.label.probed) probed.push('chipLabel');
  if (chip.value.probed) probed.push('chipValue');

  return {
    hero: hero.px,
    alarmLabel: alarmLabel.px,
    alarmValue: alarmValue.px,
    chipLabel: chip.label.px,
    chipValue: chip.value.px,
    w: window.innerWidth,
    h: window.innerHeight,
    probe: probed.length > 0 ? probed.join('+') : 'none',
  };
}

/**
 * 세션당 1회 폰트 실렌더 계측 예약. ActiveState 마운트 시 호출한다(반환값은 effect cleanup —
 * 언마운트 시 대기 중 타이머를 취소해, 화면이 사라진 뒤 body 프로브만으로 찍힌 거짓 스냅샷을
 * 막는다. 같은 세션의 재마운트가 다시 예약하면 1회 계약 가드가 이중 방출을 막는다).
 */
export function scheduleFontRenderSnapshot(): () => void {
  const sessionId = useSessionStore.getState().sessionId;
  if (!sessionId || emittedForSession === sessionId) return () => {};
  let cancelled = false;
  const timer = window.setTimeout(() => {
    // rAF 2회 — 레이아웃·fit 이진탐색(useFitGroup rAF 스케줄) 정착 후 읽는다.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (cancelled) return;
      if (useSessionStore.getState().sessionId !== sessionId) return; // 세션이 이미 끝났다
      if (emittedForSession === sessionId) return; // 재마운트 경합의 이중 방출 방지(1회 계약)
      const snap = measureSlots();
      if (!snap) return;
      emittedForSession = sessionId;
      logger.log({ type: 'session', extra: fontRenderSnapshot(snap) });
    }));
  }, FONT_RENDER_DELAY_MS);
  return () => {
    cancelled = true;
    window.clearTimeout(timer);
  };
}

/** v0.45.0 WP-1② — 확정(에코) 플래시가 실제로 그린 프레임의 hero 실렌더 계측. 세션당 1회.
 *  리뷰 C9 — 모듈 변수는 reload에서 초기화되는데 세션은 reload를 넘어 복원된다(sessionId 보존).
 *  sessionStorage를 병행 가드로 써서 같은 sessionId의 2중 방출을 막는다(같은 탭 수명 유지). */
let echoEmittedForSession = '';
const ECHO_EMIT_SS_KEY = 'survey-011.fontRenderEcho.sessionId';

function echoAlreadyEmitted(sessionId: string): boolean {
  if (echoEmittedForSession === sessionId) return true;
  try { return sessionStorage.getItem(ECHO_EMIT_SS_KEY) === sessionId; } catch { return false; }
}

function markEchoEmitted(sessionId: string): void {
  echoEmittedForSession = sessionId;
  try { sessionStorage.setItem(ECHO_EMIT_SS_KEY, sessionId); } catch { /* 프라이빗 모드 등 — 모듈 가드만 */ }
}

/** 확정 플래시가 뜬 뒤 fit 이진탐색이 정착할 시간 — 플래시 창(1500ms)의 앞 1/5 지점에서 읽는다.
 *  즉시(rAF 2회만) 읽으면 useFitGroup의 rAF 스케줄 탐색 중간값을 실측으로 오인할 수 있다. */
const ECHO_SETTLE_MS = 300;

/**
 * VoiceHero가 confirm 플래시 진입에서 호출한다(fire-and-forget). C3(확정값 잘림) 판정 축:
 * 세션 시작 스냅샷(`font_render`)은 확정값 슬롯이 대개 프로브라, **확정 순간의 실렌더**가
 * 로그에 없었다. hero-primary가 이미 사라졌으면(플래시 종료·상태 전환) 방출하지 않고 가드도
 * 세우지 않는다 — 다음 확정에서 다시 시도한다(프로브 폴백 금지: fontRenderEcho 주석 참조).
 */
export function scheduleEchoFontRender(): void {
  const sessionId = useSessionStore.getState().sessionId;
  if (!sessionId || echoAlreadyEmitted(sessionId)) return;
  window.setTimeout(() => {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (useSessionStore.getState().sessionId !== sessionId) return; // 세션이 이미 끝났다
      if (echoAlreadyEmitted(sessionId)) return; // 연속 확정 경합의 이중 방출 방지
      const el = document.querySelector('[data-testid="hero-primary"]');
      if (!el) return;
      markEchoEmitted(sessionId);
      logger.log({
        type: 'session',
        extra: fontRenderEcho({
          hero: computedPx(el),
          w: window.innerWidth,
          h: window.innerHeight,
        }),
      });
    }));
  }, ECHO_SETTLE_MS);
}
