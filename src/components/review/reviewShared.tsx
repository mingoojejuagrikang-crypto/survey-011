/**
 * 비교탭 컴포넌트 공용 토큰·포맷터·셀 변화 계산(표준 0: 표현 로직 SSOT 1곳).
 *
 * 반응형 폰트(FS)는 ReviewScreen의 clamp 패턴을 그대로 따른다(픽셀 고정 금지 — portrait
 * 스마트폰~태블릿 균형). 셀 직전→target 변화(computeChange)는 표시 SSOT로, checkAnomaly를
 * 재구현하지 않고 그대로 호출한다(이상치 강조).
 */
import { isTrendEligible } from '../../lib/columnFlags';
import { checkAnomaly, parseNumeric } from '../../lib/trendCheck';
import { isoWeek } from '../../lib/isoWeek';
import type { Column } from '../../types';

export const MONO = 'JetBrains Mono, ui-monospace, monospace';

/** 반응형 폰트 토큰(픽셀 고정 대신 clamp — portrait 스마트폰~태블릿 균형). */
export const FS = {
  label: 'clamp(13px, 3.4vw, 16px)',
  value: 'clamp(15px, 4vw, 20px)',
  delta: 'clamp(12px, 3vw, 14px)',
  cardLabel: 'clamp(15px, 4.2vw, 18px)',
  small: 'clamp(12px, 3vw, 13px)',
} as const;

/** 회차 ISO → "YYYY. NN주차 (mm-dd ~ mm-dd)". 파싱 불가는 ISO 그대로, null은 '—'. */
export function roundLabel(iso: string | null): string {
  if (!iso) return '—';
  const w = isoWeek(iso);
  if (!w) return iso;
  const md = (s: string) => s.slice(5); // 'YYYY-MM-DD' → 'MM-DD'
  return `${w.year}. ${w.week}주차 (${md(w.start)} ~ ${md(w.end)})`;
}

/** 한 측정 셀의 baseline→target 변화(표시 SSOT). 두 회차 값 모두 시트 인덱스에서 온다. */
export interface CellChange {
  prev: string | null;
  latest: string | null;
  arrow: 'up' | 'down' | 'flat' | null;
  /** 절대 변화 표시(예 "+2.4", "−1.0", "±0"). 비교 불가면 null. */
  delta: string | null;
  /** 변동률 표시(예 "+12.5%"). prev===0이거나 비교 불가면 null. */
  pct: string | null;
  violation: boolean;
}

export function computeChange(
  col: Column,
  prev: string | null,
  latest: string | null,
): CellChange {
  const decimals = col.type === 'float' ? col.decimals ?? 1 : 0;
  const prevN = parseNumeric(prev);
  const latestN = parseNumeric(latest);
  let arrow: CellChange['arrow'] = null;
  let delta: string | null = null;
  let pct: string | null = null;
  let violation = false;
  if (prevN !== null && latestN !== null) {
    const d = latestN - prevN;
    arrow = d > 0 ? 'up' : d < 0 ? 'down' : 'flat';
    delta = d === 0 ? '±0' : `${d > 0 ? '+' : '−'}${Math.abs(d).toFixed(decimals)}`;
    // %변화 = (latest-prev)/|prev|*100 — prev===0/subnormal로 인한 Infinity는 null로(누출 차단).
    if (prevN !== 0) {
      const p = (d / Math.abs(prevN)) * 100;
      if (Number.isFinite(p)) {
        pct = `${p > 0 ? '+' : p < 0 ? '−' : '±'}${Math.abs(p).toFixed(1)}%`;
      }
    }
    // 위반 판정은 checkAnomaly가 SSOT — 여기서 규칙을 재구현하지 않는다.
    if (isTrendEligible(col)) violation = checkAnomaly(col, prev, latest ?? '') !== null;
  }
  return { prev, latest, arrow, delta, pct, violation };
}
