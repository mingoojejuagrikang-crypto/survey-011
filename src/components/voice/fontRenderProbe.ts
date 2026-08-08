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

/** 🔴 v0.47.0 W5ⓐ(민구 FB-F 확정 08-08) — **세션당 1회 가드를 걷어낸다. 에코 표시마다 1건.**
 *
 *  종전 계약(v0.45.0 WP-1②)은 `echoEmittedForSession` + `sessionStorage` 2중 가드로 세션당
 *  정확히 1건을 보장했다. 그 계약이 FB-F를 **판정 불가로 만든 당사자다**: 민구가 관찰한 것은
 *  *"nn.n만, 확정 시에만"* 인데, 표본이 세션 첫 확정 1건뿐이면 그 조건에 해당하는 에코가
 *  로그에 들어올 보장이 없다. 실제로 08-08 새벽 제보의 로그에도 `len=4,ovX=0` 한 건뿐이었고,
 *  그 1건이 "정상"이라 후보 3안 중 무엇도 죽지 않았다.
 *
 *  🔑 **세션 순번(`n`)이 종전 가드의 역할을 대신한다** — 이중 방출·누락은 순번의 중복/구멍으로
 *  로그에서 드러난다. 가드를 없앤 것이 아니라 **가드를 관측 가능한 형태로 바꾼 것이다.**
 *  ⚠️ 순번은 모듈 변수라 reload에서 1로 되돌아간다(세션은 reload를 넘어 복원된다). 같은
 *  sessionId에 `n=1`이 두 번 보이면 그건 이중 방출이 아니라 **재적재**다. */
let echoSessionId = '';
let echoSeq = 0;

function nextEchoSeq(sessionId: string): number {
  if (echoSessionId !== sessionId) { echoSessionId = sessionId; echoSeq = 0; }
  return ++echoSeq;
}

/** 확정 플래시가 뜬 뒤 fit 이진탐색이 정착할 시간 — 플래시 창(1500ms)의 앞 1/5 지점에서 읽는다.
 *  즉시(rAF 2회만) 읽으면 useFitGroup의 rAF 스케줄 탐색 중간값을 실측으로 오인할 수 있다.
 *  🔴 W5ⓐ 이후로는 **그 중간값 자체가 관측 대상이다**(후보 ①). 두 시점을 다 읽되 정착값을
 *  대표값(`hero`/`ovX`)으로 두고 전환 직후 값은 `px0`/`ovX0`/`fit0`로 **한 이벤트에** 싣는다. */
const ECHO_SETTLE_MS = 300;

interface EchoReading {
  px: number; ovX: number; ovY: number; len: number; text: string; ell: boolean; fit: number;
}

/** hero 확정 라인의 실렌더 1회 판독. 요소가 없으면 null — **프로브 폴백을 두지 않는다**
 *  (폴백을 남기면 "확정 순간 실렌더"라는 이 계측의 존재 이유가 사라진다 · fontRenderEcho 주석). */
function readEcho(): EchoReading | null {
  const el = document.querySelector('[data-testid="hero-primary"]') as HTMLElement | null;
  if (!el) return null;
  const cs = getComputedStyle(el);
  const text = (el.textContent ?? '').trim();
  return {
    px: computedPx(el),
    // 🔴 v0.46.1 WP-3 — **넘침 실측**(민구 FB-6·7). `ovX > 0`이면 브라우저가 실제로 잘라 그린
    //    것 = 민구가 본 `33…`의 직접 증거. 폰트 크기만으로는 판정할 수 없었다.
    ovX: el.scrollWidth - el.clientWidth,
    ovY: el.scrollHeight - el.clientHeight,
    len: text.length,
    text,
    // W5ⓑ 이후로는 상시 false여야 한다 — 배포된 번들이 처방을 담았는지의 지표로 남긴다.
    ell: cs.textOverflow === 'ellipsis',
    fit: Number.parseFloat(cs.getPropertyValue('--fit-value')) || 0,
  };
}

/**
 * VoiceHero가 confirm 플래시 **진입마다** 호출한다(fire-and-forget). C3(확정값 잘림) 판정 축:
 * 세션 시작 스냅샷(`font_render`)은 확정값 슬롯이 대개 프로브라, **확정 순간의 실렌더**가
 * 로그에 없었다. hero-primary가 두 시점 모두에서 사라졌으면 방출하지 않는다(거짓 데이터 금지).
 */
export function scheduleEchoFontRender(): void {
  const sessionId = useSessionStore.getState().sessionId;
  if (!sessionId) return;
  const n = nextEchoSeq(sessionId);
  // ① 전환 직후(rAF 2회) — fit이 아직 이전 상태의 배율일 수 있는 그 프레임이 후보 ①의 현장이다.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const early = readEcho();
    // ② 정착 후 — 대표값. 둘의 차이가 곧 "첫 프레임에만 넘쳤는가"의 답이다.
    window.setTimeout(() => {
      if (useSessionStore.getState().sessionId !== sessionId) return; // 세션이 이미 끝났다
      const settled = readEcho();
      const base = settled ?? early;
      if (!base) return; // 두 시점 모두 요소가 없었다 — 방출하지 않는다
      logger.log({
        type: 'session',
        extra: fontRenderEcho({
          hero: base.px,
          w: window.innerWidth,
          h: window.innerHeight,
          ovX: base.ovX,
          ovY: base.ovY,
          len: base.len,
          n,
          ell: base.ell,
          fit: base.fit,
          ...(early ? { px0: early.px, ovX0: early.ovX, fit0: early.fit } : {}),
          txt: base.text,
        }),
      });
    }, ECHO_SETTLE_MS);
  }));
}
