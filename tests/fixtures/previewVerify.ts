/**
 * 프리뷰 자기검증 — "프리뷰가 실화면과 같은가"를 눈이 아니라 **수치로** 증명한다.
 *
 * 🔴 왜 필수인가: 민구는 이 카드를 보고 UI 결정을 내린다. 카드가 실화면과 어긋나 있으면
 * 그 결정이 통째로 무효가 된다. 그래서 "프리뷰를 만들었다"로 끝내지 않고, 같은 상태의
 * 라이브 페이지와 렌더된 프리뷰에서 **같은 지문**을 뜬 뒤 대조한다.
 *
 * 픽셀 diff를 쓰지 않는 이유: 지문(폰트 크기·상자 좌표·opacity)이 더 진단적이다. 어긋났을 때
 * "몇 px 어디가"까지 바로 나오고, 애니메이션 위상 같은 무해한 차이로 오탐하지 않는다.
 * 사람 눈을 위한 증거는 `_live/*.png` 이미지 쌍이 따로 담당한다.
 */
import fs from 'node:fs';
import type { Page } from '@playwright/test';

/** 카드에서 의미를 지닌 노드 전부. 없는 상태에서는 그냥 빠진다(상태별 목록을 따로 두지 않는다). */
const TRACKED_SELECTORS = [
  '[data-testid="voice-active-state"]',
  '[data-testid="voice-chip-grid"]',
  '[data-testid="voice-center-stage"]',
  '[data-testid="voice-control-bar"]',
  '[data-testid="live-listen-band"]',
  '[data-testid="state-dots"]',
  '[data-testid="voice-status-control"]',
  '[data-testid="column-chip"][data-active="true"]',
  '[data-hero-state]',
  '[data-testid="interim-value"]',
  '[data-testid="anomaly-alert"]',
  '[data-testid="anomaly-headline"]',
  '[data-testid="anomaly-comparison"]',
  '[data-testid="anomaly-prev-value"]',
  '[data-testid="anomaly-next-value"]',
  '[data-testid="anomaly-confirm-btn"]',
  '[data-testid="anomaly-modify-btn"]',
  '[data-testid="paused-card"]',
  '[data-testid="complete-summary"]',
  '[data-testid="complete-count"]',
  '[data-testid="session-complete-badge"]',
  '[data-testid="input-control-panel"]',
  '[data-testid="input-control-toggle"]',
  '[data-testid="stepper-tolerance"]',
  '[data-testid="stepper-tts-rate"]',
  'button[aria-label="이전"]',
  'button[aria-label="다음"]',
] as const;

export interface NodePrint {
  text: string;
  fontSize: string;
  lineHeight: string;
  opacity: string;
  rect: [number, number, number, number];
}

export interface Fingerprint {
  nodes: Record<string, NodePrint>;
  /** 단일 도트 격자의 실제 마스크. 삭제된 파형 레이어를 요구하면 이 진단이 조용히 null이 된다. */
  dotMask: { mode: string; lit: number; partial: number; off: number } | null;
  /** 도트 그리드가 밴드 상자를 넘친 px — fb-27-5(F2) 겹침의 정량 지표. */
  dotsOverflow: {
    top: number; right: number; bottom: number; left: number;
    dotsW: number; dotsH: number; bandW: number; bandH: number;
  } | null;
  /** 조절판의 실제 hit-test. `ok=false`면 넘친 도트/다른 상자가 터치 타깃을 가린 것이다. */
  controlHitTest: Array<{ target: string; hit: string; ok: boolean }> | null;
  /** 화면에 실제로 보이는 텍스트 전체(공백 정규화). */
  allText: string;
  chipScrollTop: number;
  chipScrollLeft: number;
}

/** 라이브 페이지와 렌더된 프리뷰에서 **같은 코드**로 지문을 뜬다(대조가 성립하려면 같아야 한다). */
export async function fingerprint(page: Page): Promise<Fingerprint> {
  return page.evaluate((selectors: readonly string[]) => {
    const root = document.getElementById('root');
    if (!root) throw new Error('#root 없음');
    const origin = root.getBoundingClientRect();
    const round = (n: number) => Math.round(n * 100) / 100;
    const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

    const nodes: Record<string, NodePrint> = {};
    for (const sel of selectors) {
      const el = root.querySelector<HTMLElement>(sel);
      if (!el) continue;
      // v0.44.0 §C5-b — 접힌 조절판이 anomaly/paused에서 display:none으로 **마운트 유지**된다
      // (단일 인스턴스 계약 — ActiveControlBar 주석). 비가시 노드는 rect가 0이라 원점 차이가
      // 가짜 drift로 잡힌다 — 지문은 화면에 **보이는** 것만 잰다.
      if (el.getClientRects().length === 0) continue;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      nodes[sel] = {
        text: norm(el.textContent ?? '').slice(0, 160),
        fontSize: cs.fontSize,
        lineHeight: cs.lineHeight,
        // v0.44.0 §C4 — mono 점멸(pauseMonoPulse)이 도는 노드의 opacity는 샘플링 위상에 따라
        // 0.66~1 사이 아무 값이다. 라이브·프리뷰가 각자 다른 위상을 찍으므로 값 대신
        // "점멸 중" 마커로 정규화한다 — 점멸 실동작 자체는 v0440-c4-mono가 잰다.
        opacity: cs.animationName === 'pauseMonoPulse' ? 'animated(pauseMonoPulse)' : cs.opacity,
        rect: [round(r.x - origin.x), round(r.y - origin.y), round(r.width), round(r.height)],
      };
    }

    const band = root.querySelector<HTMLElement>('[data-testid="live-listen-band"]');
    const dotsEl = root.querySelector<HTMLElement>('[data-testid="state-dots"]');
    let dotMask: Fingerprint['dotMask'] = null;
    let dotsOverflow: Fingerprint['dotsOverflow'] = null;
    if (dotsEl) {
      const opacities = Array.from(dotsEl.querySelectorAll('span'))
        .map((cell) => Number(getComputedStyle(cell).opacity));
      dotMask = {
        mode: dotsEl.dataset.mode ?? '',
        lit: opacities.filter((opacity) => opacity >= 0.98).length,
        partial: opacities.filter((opacity) => opacity > 0.02 && opacity < 0.98).length,
        off: opacities.filter((opacity) => opacity <= 0.02).length,
      };
    }
    if (band && dotsEl) {
      const b = band.getBoundingClientRect();
      const d = dotsEl.getBoundingClientRect();
      dotsOverflow = {
        top: round(Math.max(0, b.top - d.top)),
        right: round(Math.max(0, d.right - b.right)),
        bottom: round(Math.max(0, d.bottom - b.bottom)),
        left: round(Math.max(0, b.left - d.left)),
        dotsW: round(d.width),
        dotsH: round(d.height),
        bandW: round(b.width),
        bandH: round(b.height),
      };
    }

    const hitTargets = [
      '[data-testid="input-control-toggle"]',
      '[data-testid="stepper-tolerance"]',
      '[data-testid="stepper-tts-rate"]',
    ];
    const controlHitTest = hitTargets.flatMap((selector) => {
      const target = root.querySelector<HTMLElement>(selector);
      if (!target || target.getClientRects().length === 0) return [];
      const rect = target.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      const hitOwner = hit?.closest<HTMLElement>('[data-testid]');
      return [{
        target: target.dataset.testid ?? selector,
        hit: hitOwner?.dataset.testid ?? hit?.tagName.toLowerCase() ?? 'none',
        ok: hit !== null && (hit === target || target.contains(hit)),
      }];
    });

    const chipGrid = root.querySelector<HTMLElement>('[data-testid="voice-chip-grid"]');
    return {
      nodes,
      dotMask,
      dotsOverflow,
      controlHitTest: controlHitTest.length > 0 ? controlHitTest : null,
      allText: norm(root.innerText ?? ''),
      chipScrollTop: chipGrid ? Math.round(chipGrid.scrollTop) : 0,
      // v0.40.0 — 칩존이 가로 스크롤이 되면서 복원 검증 축이 늘었다.
      chipScrollLeft: chipGrid ? Math.round(chipGrid.scrollLeft) : 0,
    };
  }, TRACKED_SELECTORS);
}

const RECT_TOLERANCE_PX = 1.0;
const OPACITY_TOLERANCE = 0.01;

/** 라이브 지문 ↔ 프리뷰 지문. 반환 배열이 비어 있어야 "실화면과 같다"고 말할 수 있다. */
export function diffFingerprints(live: Fingerprint, preview: Fingerprint): string[] {
  const problems: string[] = [];

  for (const [sel, l] of Object.entries(live.nodes)) {
    const p = preview.nodes[sel];
    if (!p) { problems.push(`${sel}: 프리뷰에 노드가 없다`); continue; }
    if (l.text !== p.text) problems.push(`${sel}: 텍스트 다름 live="${l.text}" preview="${p.text}"`);
    if (l.fontSize !== p.fontSize) problems.push(`${sel}: fontSize ${l.fontSize} → ${p.fontSize}`);
    if (l.lineHeight !== p.lineHeight) problems.push(`${sel}: lineHeight ${l.lineHeight} → ${p.lineHeight}`);
    if (Math.abs(Number(l.opacity) - Number(p.opacity)) > OPACITY_TOLERANCE) {
      problems.push(`${sel}: opacity ${l.opacity} → ${p.opacity}`);
    }
    const axes = ['x', 'y', 'w', 'h'];
    l.rect.forEach((v, i) => {
      const delta = Math.abs(v - p.rect[i]);
      if (delta > RECT_TOLERANCE_PX) {
        problems.push(`${sel}: rect.${axes[i]} ${v} → ${p.rect[i]} (Δ${round1(delta)}px)`);
      }
    });
  }

  const extra = Object.keys(preview.nodes).filter((k) => !(k in live.nodes));
  if (extra.length > 0) problems.push(`프리뷰에만 있는 노드: ${extra.join(', ')}`);

  if (live.dotMask && preview.dotMask) {
    // §C5-①(F19) idle 웨이브는 **매 프레임 위상이 흐르는** 애니메이션이다 — 라이브 지문과
    // 프리뷰 직렬화가 각자 다른 순간을 찍으므로 lit/partial/off 셀 수가 몇 개씩 어긋나는 게
    // 정상이다(§C4 pauseMonoPulse의 opacity 정규화와 같은 클래스 — 위 nodes 주석 참조).
    // v0.44.0 §C8 F18이 세션 시작 타이밍을 프레임 경계만큼 옮기면서 이 위상 어긋남이 실측됐다
    // (09-chipzone-overflow: lit 88↔92 플레이크). idle 모드는 mode 일치만 대조하고 셀 수는
    // 건너뛴다 — 격자 무결성(25×14=350)은 capture 스펙이 라이브 마스크로 따로 고정한다.
    const idlePhaseFlows = live.dotMask.mode === 'idle' && preview.dotMask.mode === 'idle';
    for (const key of ['mode', 'lit', 'partial', 'off'] as const) {
      if (idlePhaseFlows && key !== 'mode') continue;
      if (live.dotMask[key] !== preview.dotMask[key]) {
        problems.push(`도트 마스크 ${key}: ${live.dotMask[key]} → ${preview.dotMask[key]}`);
      }
    }
  } else if (Boolean(live.dotMask) !== Boolean(preview.dotMask)) {
    problems.push('도트 마스크 진단 존재 여부가 다르다');
  }

  if (live.dotsOverflow && preview.dotsOverflow) {
    for (const key of ['top', 'right', 'bottom', 'left', 'dotsW', 'dotsH', 'bandW', 'bandH'] as const) {
      const delta = Math.abs(live.dotsOverflow[key] - preview.dotsOverflow[key]);
      if (delta > RECT_TOLERANCE_PX) {
        problems.push(`도트 넘침 ${key}: ${live.dotsOverflow[key]} → ${preview.dotsOverflow[key]}`);
      }
    }
  } else if (Boolean(live.dotsOverflow) !== Boolean(preview.dotsOverflow)) {
    problems.push('도트 넘침 진단 존재 여부가 다르다');
  }

  if (live.controlHitTest && preview.controlHitTest) {
    if (JSON.stringify(live.controlHitTest) !== JSON.stringify(preview.controlHitTest)) {
      problems.push(`조절판 hit-test: ${JSON.stringify(live.controlHitTest)} → ${JSON.stringify(preview.controlHitTest)}`);
    }
  } else if (Boolean(live.controlHitTest) !== Boolean(preview.controlHitTest)) {
    problems.push('조절판 hit-test 진단 존재 여부가 다르다');
  }

  if (live.chipScrollTop !== preview.chipScrollTop) {
    problems.push(`칩존 scrollTop: ${live.chipScrollTop} → ${preview.chipScrollTop}`);
  }
  if (live.chipScrollLeft !== preview.chipScrollLeft) {
    problems.push(`칩존 scrollLeft: ${live.chipScrollLeft} → ${preview.chipScrollLeft}`);
  }

  // 라이브에 보이던 텍스트 토큰이 프리뷰에서 사라지지 않았는지(브리핑의 "주요 텍스트 동일 존재").
  const missing = live.allText.split(' ').filter((t) => t.length > 0 && !preview.allText.includes(t));
  if (missing.length > 0) problems.push(`프리뷰에 없는 텍스트: ${[...new Set(missing)].join(' | ')}`);

  return problems;
}

/** 뷰포트 독립성 — 카드가 402×874가 아닌 창에서 열려도 같은 지문이어야 한다(동결이 실제로 먹었는가). */
export function diffStability(base: Fingerprint, resized: Fingerprint): string[] {
  const problems: string[] = [];
  for (const [sel, b] of Object.entries(base.nodes)) {
    const r = resized.nodes[sel];
    if (!r) { problems.push(`${sel}: 창 크기 변경 후 사라짐`); continue; }
    if (b.fontSize !== r.fontSize) problems.push(`${sel}: 창 크기에 따라 fontSize가 흔들림 ${b.fontSize} → ${r.fontSize}`);
    b.rect.forEach((v, i) => {
      if (Math.abs(v - r.rect[i]) > RECT_TOLERANCE_PX) {
        problems.push(`${sel}: 창 크기에 따라 rect[${i}]가 흔들림 ${v} → ${r.rect[i]}`);
      }
    });
  }
  return problems;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export interface PixelDiff { width: number; height: number; changed: number; total: number; pct: number }

/** 라이브 PNG ↔ 프리뷰 PNG 화소 대조.
 *  외부 이미지 라이브러리를 들이지 않는다(PRINCIPLES §7 — 러너는 Playwright 단일, 새 도구 금지).
 *  이미 떠 있는 브라우저의 canvas로 재고, 두 이미지는 data: URI로 넣어 파일 접근 권한도 필요 없다. */
export async function pixelDiff(page: Page, aPath: string, bPath: string): Promise<PixelDiff> {
  const a = fs.readFileSync(aPath).toString('base64');
  const b = fs.readFileSync(bPath).toString('base64');
  return page.evaluate(async ([srcA, srcB]: string[]) => {
    const load = (data: string) => new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('PNG 디코드 실패'));
      img.src = `data:image/png;base64,${data}`;
    });
    const [imgA, imgB] = await Promise.all([load(srcA), load(srcB)]);
    if (imgA.width !== imgB.width || imgA.height !== imgB.height) {
      return { width: imgA.width, height: imgA.height, changed: -1, total: 0, pct: 100 };
    }
    const canvas = document.createElement('canvas');
    canvas.width = imgA.width; canvas.height = imgA.height;
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
    ctx.drawImage(imgA, 0, 0);
    const da = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(imgB, 0, 0);
    const db = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    // 채널당 16/255 이하는 안티에일리어싱·서브픽셀 잡음으로 본다(내용 차이가 아니다).
    let changed = 0;
    for (let i = 0; i < da.length; i += 4) {
      if (Math.abs(da[i] - db[i]) > 16 || Math.abs(da[i + 1] - db[i + 1]) > 16 || Math.abs(da[i + 2] - db[i + 2]) > 16) changed++;
    }
    const total = da.length / 4;
    return { width: imgA.width, height: imgA.height, changed, total, pct: Math.round((changed / total) * 10000) / 100 };
  }, [a, b]);
}
