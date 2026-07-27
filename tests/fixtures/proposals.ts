/**
 * **개선안 정의** — 개선요청 9건을 화면으로 옮긴 제안 카드들.
 *
 * 🔴 원칙: **캡처본을 포크해서 고친다(백지 금지).** 각 제안은 `design-sync/_previews/`의 실렌더
 * 카드를 열어 그 DOM 위에서 편집한다. 그래야 앱의 토큰·폰트·치수·safe-area가 그대로 유지되고,
 * **변경분이 곧 제안 내용**이 된다. 새로 그리면 앱 제약에서 떠버린다.
 *
 * 🔴 다시 얼리지 않는다. 현재상태 캡처는 타이포를 px로 동결하지만(뷰포트 독립 목적), 제안은
 * 민구 요구 "기기 변경 되어도 일정 비율로 조절되어서 어색하지 않아야 함"을 지켜야 하므로
 * 새로 짜는 부분은 **컨테이너 쿼리 단위(`cqh`/`cqw`)** 로 둔다. 동결하면 그 요구가 깨진다.
 *
 * 앱 이식 노트: 컨테이너는 `voice-chip-grid`(=25% 트랙)다. React로 옮길 때 `cqh`는 그 트랙
 * 높이의 %라는 뜻 그대로이고, 지금처럼 `container-type: size`만 걸면 같은 값이 그대로 산다.
 */
import type { Page } from '@playwright/test';

import {
  ALERT_FIELD, ALERT_ICON_CANDIDATES, MIC_FIELD, SPEAKING_AMPLITUDES,
  dotFieldHtml, waveField,
} from './proposalDots';

export interface Proposal {
  name: string;
  /** `screen` = 앱 화면의 제안. `sheet` = 비교 시트(아이콘 후보) — 앱 골격 단언 대상이 아니다. */
  kind?: 'screen' | 'sheet';
  /** 이 카드가 실제로 재설계하는 영역 — 오라클을 그 영역에만 건다(안 건드린 곳까지 단언하면 헛발). */
  redesigns: ('chips' | 'anomaly' | 'panel' | 'indicator')[];
  /** 기각된 안 — 파일·리포트 기록은 남기되 Design 패널 카드 마커를 내린다. */
  rejected?: boolean;
  /** 칩존 스크롤 축. 기본은 가로(민구 재판단). 기각된 안 B만 세로. */
  chipScroll?: 'x' | 'y';
  group: '개선안 (제안)' | '개선안 · 칩존 대안' | '개선안 · 아이콘 후보';
  title: string;
  /** 포크한 현재상태 카드 파일명(확장자 제외). */
  source: string;
  /** 반영한 개선요청 ID. */
  feedback: string;
  /** 민구 원문 중 이 카드가 대응하는 문장. */
  quote: string;
  /** 무엇을 어떻게 바꿨는지 — 카드 주석과 리포트에 그대로 들어간다. */
  changes: string[];
  apply: (page: Page) => Promise<void>;
}

// ── 공통 조각 ────────────────────────────────────────────────────────────────

/** 제안 스타일시트 주입. 프레임 상속분(동결 px)을 이기려고 `!important`를 남발하지 않는다 —
 *  바꿀 속성은 `removeProperty`로 먼저 걷어내고(아래 `unfreeze`) 여기서 새로 정의한다. */
async function injectCss(page: Page, css: string): Promise<void> {
  await page.evaluate((text) => {
    const style = document.createElement('style');
    style.setAttribute('data-proposal', '');
    style.textContent = text;
    document.head.appendChild(style);
  }, css);
}

/** 재설계하는 노드에서 **캡처가 박아둔 값만** 골라 제거한다. 남겨두면 제안 CSS가 조용히 지고,
 *  카드가 "제안"이라는 이름으로 현재 화면을 보여주게 된다. */
async function unfreeze(page: Page, selector: string, props: string[]): Promise<void> {
  await page.evaluate(({ sel, list }) => {
    document.querySelectorAll<HTMLElement>(sel).forEach((el) => {
      for (const p of list) el.style.removeProperty(p);
    });
  }, { sel: selector, list: props });
}

/** 칩존 재설계 공통 — 컨테이너 지정 + 동결 해제. 안 A(1행)와 안 B(목록)가 같이 쓴다. */
async function prepareChipZone(page: Page): Promise<void> {
  // 🔴 `flex-wrap`까지 걷어야 한다. ChipZone은 인라인 `flexWrap:'wrap'`을 들고 있어서, 안 B에서
  //    `flex-direction:column`만 바꾸면 칩이 **세로로 쌓이는 대신 여러 열로 감긴다** — 세로 스크롤이
  //    아예 생기지 않아 "목록형"이 성립하지 않는다.
  await unfreeze(page, '[data-testid="voice-chip-grid"]',
    ['--chip-row-h', 'flex-wrap', 'flex-direction', 'justify-content', 'align-items', 'align-content',
      'overflow', 'overflow-x', 'overflow-y']);
  // 🔴 `min-width`/`max-width`를 빼먹으면 안 된다. ColumnChip은 인라인으로 `minWidth:0`을 들고 있어
  //    제안의 `min-width`가 조용히 지고, 칩이 글자 밑으로 찌그러진다(첫 시안에서 항목명이 "조" 한 글자).
  await unfreeze(page, '[data-testid="column-chip"]',
    ['height', 'width', 'min-width', 'max-width', 'font-size', 'padding', 'min-height', 'flex']);
  // 🔴 overflow/text-overflow까지 걷어야 한다. 남겨두면 ① 글자가 "조사…"로 잘리고 ② span의 내재 폭
  //    기여가 0이라 칩이 값을 담을 만큼 자라지 않는다. 게다가 **넘침 오라클까지 속인다** —
  //    잘린 글자는 상자 안에 머무르므로 기하 검사가 통과해버린다. 그래서 아래 verifyProposal은
  //    `overflow-x: visible`을 직접 단언해 "의도한 해제가 실제로 먹었는지"를 따로 확인한다.
  //    그리고 `width`/`height`를 반드시 포함해야 한다 — 현재상태 캡처는 뷰포트 단위가 섞인 노드의
  //    **계산된 상자까지 px로 동결**한다(뷰포트 독립 목적). 값 span에 `width:69.125px`가 박혀 있어서
  //    글자를 키워도 상자가 69px에 묶여 그대로 잘렸다. 제안이 다시 계산해야 할 상자는 전부 풀어준다.
  await unfreeze(page, '[data-testid="column-chip"] > span', [
    'font-size', 'line-height', 'width', 'height', 'max-width', 'min-width',
    'max-height', 'min-height', 'overflow', 'text-overflow', 'flex-shrink', 'padding',
  ]);
}

const CHIP_ZONE_CONTAINER = `
/* 🔴 컨테이너는 칩존(=25% 트랙)이다. 스테이지가 아니라 여기에 걸어야 \`cqh\`가 "트랙 높이의 %"라는
   뜻이 되고, 그대로 React로 옮겨진다. 칩 자체에 걸면 안 된다 — 칩은 flex:0 1 auto라
   size containment가 내용 기반 폭을 0으로 무너뜨린다. */
[data-testid="voice-chip-grid"] {
  container-type: size;
  container-name: chipzone;
}`;

/** 활성 칩을 보이는 줄로 끌어온다.
 *  앱은 `activeChipRef.scrollIntoView({block:'nearest'})`로 "지금 어디"를 항상 보이게 유지한다
 *  (와이어프레임 §공통규칙4). 칩이 커지면 한 줄에 들어가는 칩 수가 줄어 활성 칩이 더 쉽게 줄 밖으로
 *  밀리므로, 제안 카드도 앱과 같은 상태를 보여야 한다 — 안 그러면 "활성 칸이 안 보이는 설계"로 오독된다. */
async function scrollActiveChipIntoView(page: Page, axis: 'x' | 'y' = 'x'): Promise<void> {
  await page.evaluate((ax) => {
    const grid = document.querySelector<HTMLElement>('[data-testid="voice-chip-grid"]');
    const active = document.querySelector<HTMLElement>('[data-testid="column-chip"][data-active="true"]');
    if (!grid || !active) return;
    if (ax === 'y') {
      // 기각된 안 B(세로 목록형)만 이 경로를 쓴다 — 기록 보존용이라 동작은 유지한다.
      const dy = active.getBoundingClientRect().top - grid.getBoundingClientRect().top;
      grid.scrollTop = Math.max(0, Math.min(grid.scrollHeight - grid.clientHeight, grid.scrollTop + dy - 6));
      grid.setAttribute('data-ds-scroll', `${Math.round(grid.scrollTop)},0`);
      return;
    }
    // 🔴 화면 좌표 차이로 잰다. `offsetLeft`는 offsetParent 기준이라 스크롤 컨테이너와 어긋난다.
    const gr = grid.getBoundingClientRect();
    const ar = active.getBoundingClientRect();
    const pad = 8;
    // 진행중 칩의 **오른쪽 끝**을 보이는 영역의 오른쪽 끝에 맞춘다.
    const next = grid.scrollLeft + (ar.left - gr.left) - (grid.clientWidth - ar.width) + pad;
    // clamp(0, …)이 "넘침 전"을 자동으로 처리한다 — 스크롤할 것이 없으면 0에 머물고,
    // 칩은 왼쪽부터 채워지며 하이라이트가 자연히 좌→우로 이동한다.
    grid.scrollLeft = Math.max(0, Math.min(grid.scrollWidth - grid.clientWidth, next));
    // outerHTML은 scroll 위치를 담지 못한다([TEST-DOM-SNAPSHOT-1]) — 복원 스크립트가 읽을 값을 다시 쓴다.
    grid.setAttribute('data-ds-scroll', `${Math.round(grid.scrollTop)},${Math.round(grid.scrollLeft)}`);
  }, axis);
}

/** 이미 입력을 마친 칩에 값을 채운다 — 우측 끝 정렬의 **왼쪽에 남는 것**이 무엇인지 보이게 한다.
 *  원본 캡처는 세션 초반이라 음성 컬럼이 전부 '—'이고, 그 상태로는 "입력 확인 영역"이 성립하지 않는다. */
async function fillCompletedChips(page: Page, upToIndex: number, values: string[]): Promise<void> {
  await page.evaluate(({ limit, vals }) => {
    const chips = Array.from(document.querySelectorAll<HTMLElement>('[data-testid="column-chip"]'));
    let v = 0;
    for (let i = 0; i < limit && i < chips.length; i++) {
      const spans = chips[i].querySelectorAll<HTMLElement>(':scope > span');
      const value = spans[1];
      if (!value || value.textContent?.trim() !== '—') continue;
      value.textContent = vals[v % vals.length];
      v++;
      // 입력 완료 칩은 값이 밝은 톤이다(ColumnChip의 isDone 처리와 같은 읽기).
      value.style.setProperty('color', '#F5F5F7');
    }
  }, { limit: upToIndex, vals: values });
}

/** 활성 칩을 다른 컬럼으로 옮긴다(③ "중간 컬럼 진행 중" 재현).
 *  하이라이트는 인라인 스타일에 실려 있으므로 두 칩의 `style`과 자식 span의 `style`을 통째로 맞바꾼다 —
 *  색·테두리·점멸이 한꺼번에 따라간다. 텍스트는 각 칩에 남아 있어 이름/값은 제자리다. */
async function moveActiveChip(page: Page, targetIndex: number): Promise<void> {
  await page.evaluate((idx) => {
    const chips = Array.from(document.querySelectorAll<HTMLElement>('[data-testid="column-chip"]'));
    const from = chips.find((c) => c.getAttribute('data-active') === 'true');
    const to = chips[idx];
    if (!from || !to || from === to) return;
    const swap = (a: HTMLElement, b: HTMLElement) => {
      const tmp = a.getAttribute('style') ?? '';
      a.setAttribute('style', b.getAttribute('style') ?? '');
      b.setAttribute('style', tmp);
    };
    swap(from, to);
    const fs = Array.from(from.querySelectorAll<HTMLElement>(':scope > span'));
    const ts = Array.from(to.querySelectorAll<HTMLElement>(':scope > span'));
    for (let i = 0; i < Math.min(fs.length, ts.length); i++) swap(fs[i], ts[i]);
    from.setAttribute('data-active', 'false');
    to.setAttribute('data-active', 'true');
  }, targetIndex);
}

/** 중앙 히어로의 **항목명 삭제**(fb-27-2) — 칩이 커지고 활성칩이 하이라이트되므로 중복이다.
 *  비운 자리는 인식값을 크게 쓰는 데 쓴다(제안 ②·⑥·⑦). */
async function dropHeroColumnName(page: Page): Promise<void> {
  await page.evaluate(() => {
    const hero = document.querySelector('[data-testid="hero-primary"]');
    if (!hero) return;
    // 래퍼 span까지 걷어야 빈 줄 간격이 남지 않는다.
    const wrapper = hero.parentElement;
    (wrapper && wrapper.children.length === 1 ? wrapper : hero).remove();
  });
}

/** 인디케이터를 **단일 도트 필드**로 교체한다(교차페이드 제거). 도트/파형 두 레이어를 걷고
 *  같은 격자 하나만 남긴다 — 겹칠 상대가 없어지는 것이 fb-27-1의 구조적 해법이다. */
async function replaceIndicatorWithDotField(page: Page, bitmap: readonly string[], glyph: string): Promise<void> {
  const html = dotFieldHtml(bitmap, { testId: 'state-dots', glyph });
  await page.evaluate(({ markup }) => {
    const band = document.querySelector<HTMLElement>('[data-testid="live-listen-band"]');
    if (!band) throw new Error('live-listen-band 없음');
    const old = band.querySelector<HTMLElement>('[data-testid="state-dots"]');
    const stack = old?.parentElement?.parentElement;
    if (!old || !stack) throw new Error('인디케이터 스택 없음');
    // 상태 톤(green/amber/red)은 도트 격자의 `color`에 실려 있다 — 교체 전에 읽어 그대로 이어받는다.
    // 놓치면 도트가 상속색(어두운 회색)으로 떨어져 상태를 말하지 못한다.
    const tone = getComputedStyle(old).color;
    stack.innerHTML = markup;
    stack.style.setProperty('display', 'flex');
    stack.style.setProperty('align-items', 'center');
    stack.style.setProperty('justify-content', 'center');
    stack.style.setProperty('color', tone);
    stack.style.removeProperty('--voice-level');
    band.style.setProperty('overflow', 'hidden');
  }, { markup: html });
}

// ── ① 대기 ───────────────────────────────────────────────────────────────────

const CHIP_ZONE_ONE_ROW = `${CHIP_ZONE_CONTAINER}
/* fb-27-2 + **민구 재판단(2026-07-27, 화면을 보고 스크롤 방향을 뒤집음)**:
     "한 행에 칩 여러개, 칩 내부엔 2행 구조(1행:항목, 2행:값), 스크롤은 가로 스크롤
      (세로 스크롤 영역이 너무 작기에 가로 스크롤, 대신 진행중인 항목 하이라이트,
      진행중인 항목에 맞춰서 자동 스크롤)."
   ⚠️ fb-27-2 **원문은 "가로가 아닌 세로"** 였다. 실제 화면을 보고 판단이 바뀐 것이므로 원문이 아니라
      이 지시를 따른다. 근거는 "세로 스크롤 영역이 너무 작기에" — 25% 트랙은 한 줄이면 이미 꽉 찬다.
   유지: 한 행에 칩 여러 개 · 칩 내부 2행(항목 위 / 값 아래) · 진행중 하이라이트 · 비율 사이즈업.

   🔴 **자동 스크롤 정렬 = 진행중 칩이 가장 우측 끝**(민구 확정 2026-07-27).
      근거(민구): "한국인들은 글을 읽을때 좌>우로 읽어. 그러니 진행칩의 하이라이트도 좌>우로 이동해야 해."
      규칙 두 줄로 정리하면 —
        · 넘침 **전**: 스크롤 없음. 칩이 왼쪽부터 채워지고 하이라이트가 자연히 좌→우로 이동한다.
        · 넘침 **후**: 진행중 칩이 보이는 영역의 **오른쪽 끝**에 오도록 민다.
      이 앱에서 이 정렬이 맞는 이유: 칩이 '항목+값'을 함께 보여주므로 **왼쪽에 남는 것이 입력 확인
      영역**이 된다. 다음 항목은 값이 아직 '—'라 미리 볼 실익이 적다. */
[data-testid="voice-chip-grid"] {
  --chip-row-h: 100%;
  flex-wrap: nowrap;          /* 한 줄에 전부 늘어서고 넘치는 건 가로로 민다 */
  overflow-x: auto;
  overflow-y: hidden;
  justify-content: flex-start;
  align-items: stretch;
  /* ⚠️ scroll-behavior: smooth 를 걸지 않는다. 걸면 scrollLeft 대입 직후 읽은 값이 **애니메이션
     중간값**이라, 측정도 틀리고 data-ds-scroll 에 저장되는 복원값도 틀어진다(실제로 그렇게 깨졌다).
     부드러운 스크롤은 앱에서 붙일 것이고, 정적 카드에는 의미가 없다. */
}
[data-testid="column-chip"] {
  height: var(--chip-row-h);
  min-height: 44px;                 /* 장갑 조작 하한 — PRINCIPLES §2 */
  flex-direction: column;
  justify-content: center;
  align-items: center;
  gap: 1.5cqh;
  padding: 2cqh 3.5cqw;
  /* 🔴 줄이지 않는다. 원본은 flex:0 1 auto라 한 행에 다 넣으려고 칩이 글자 밑으로 찌그러졌다
     (첫 시안에서 항목명이 "조" 한 글자로 잘렸다). 폭은 내용이 정하고, 넘치면 가로로 민다. */
  flex: 0 0 auto;
  min-width: 24cqw;   /* "—"뿐인 칩이 슬리버로 쪼그라들지 않게 */
  max-width: 96cqw;   /* 폭은 내용이 정한다 — 긴 값(2026-07-27)을 …으로 자르지 않기 위해 상한을 열어둔다 */
}
/* 비율 사이즈업 — 민구 "기기 변경 되어도 일정 비율". 고정 px 단독 금지, 전부 cq 비례 + clamp 하한/상한.
   높이(cqh)뿐 아니라 폭(cqw)으로도 상한을 걸어야 긴 값("2026-07-27")이 칩을 가로로 터뜨리지 않는다. */
/* 🔴 overflow:hidden 을 span에 남겨두면 안 된다 — 그 순간 span의 내재 폭 기여가 0이 돼서
   칩이 값을 담을 만큼 자라지 않는다(값이 96px 칩 안에서 178px로 잘렸다). 잘라내는 일은
   칩(이미 overflow:hidden)에 맡기고, span은 제 폭을 그대로 주장하게 둔다. */
[data-testid="column-chip"] > span {
  overflow: visible;
  text-overflow: clip;
  max-width: none;
  white-space: nowrap;
}
[data-testid="column-chip"] > span:first-child {
  font-size: clamp(11px, min(11cqh, 3.4cqw), 22px);
}
[data-testid="column-chip"] > span:last-child {
  font-size: clamp(18px, min(30cqh, 9cqw), 52px);
}`;

/** 🔴 **합의된 기준 레이아웃**을 얹는다 — 칩존 안 A(1행 + 세로배열 + 세로스크롤 + 비율 사이즈업),
 *  중앙 항목명 없음, 하단은 도트 필드.
 *
 *  왜 모든 화면 카드가 이걸 공유해야 하나(민구 지적, 2026-07-27): ⑤⑥⑦⑧이 **옛 칩존**을 달고 있으면,
 *  민구가 조절판 수정을 승인하면서 보는 칩은 **앞으로 존재하지 않을 칩**이고, 실제로 합쳐진 화면은
 *  어느 카드도 보여주지 못한다. 카드마다 고유 변경은 이 기준 **위에** 얹는다.
 *
 *  ⚠️ 칩존 A/B는 아직 민구 미결이다. 기준은 **A로 통일**하고 B는 ④번 대안 카드로 남긴다 —
 *  B가 선택되면 ⑤⑥⑦⑧의 칩존만 B로 갈아끼우면 된다(고유 변경은 그대로 산다). */
async function applyBaselineLayout(page: Page, bitmap: readonly string[], glyph: string): Promise<void> {
  await prepareChipZone(page);
  await injectCss(page, CHIP_ZONE_ONE_ROW);
  await dropHeroColumnName(page);
  await replaceIndicatorWithDotField(page, bitmap, glyph);
  await scrollActiveChipIntoView(page);
}

const PROPOSAL_1: Proposal = {
  name: 'proposal-1-idle',
  redesigns: ['chips', 'indicator'],
  group: '개선안 (제안)',
  title: '대기 — 칩존 1행 + 도트만',
  source: '01-active-listening',
  feedback: 'fb-27-2 · fb-27-1 · fb-27-3',
  quote: '"칩은 1행으로 제한 … 항목과 값은 세로로 … 넘어가는 항목은 세로 스크롤 … 기기 변경 되어도 일정 비율로 조절되어서 어색하지 않아야 함" / "기본 도트 마이크 상태에서 음성 인식시만 파형 애니메이션이 나와야 함"',
  changes: [
    '칩존이 한 행을 통째로 쓴다(--chip-row-h: 100%) → 칩 높이 약 2배',
    '칩 내부를 세로 배열로(항목명 위 / 값 아래)',
    '글자를 cqh 비례로 키움 — 고정 px 없음(기기 비례 요구)',
    '넘치는 칩은 세로 스크롤(가로 스크롤 폐지)',
    '중앙 히어로의 항목명 삭제 — 활성 칩 하이라이트가 같은 정보를 준다',
    '하단은 도트 필드 하나만 — 파형 레이어 자체를 제거해 교차페이드가 불가능해진다',
  ],
  apply: async (page) => {
    await prepareChipZone(page);
    await injectCss(page, CHIP_ZONE_ONE_ROW);
    await dropHeroColumnName(page);
    await replaceIndicatorWithDotField(page, MIC_FIELD, 'mic');
    await scrollActiveChipIntoView(page);
  },
};

// ── ② 인식 중 ────────────────────────────────────────────────────────────────

/** 중앙 히어로를 **큰 값 한 줄**로 바꾼다. ①에서 항목명을 지워 생긴 공간이 여기 쓰인다.
 *  컨테이너는 중앙 50% 트랙이라 `cqh`가 그 트랙 높이의 %다 — 기기가 바뀌어도 비율이 산다. */
async function setHeroValue(page: Page, text: string, caption?: string): Promise<void> {
  await page.evaluate(({ value, cap }) => {
    const stage = document.querySelector<HTMLElement>('[data-testid="voice-center-stage"]');
    const hero = document.querySelector<HTMLElement>('[data-hero-state]');
    if (!stage || !hero) throw new Error('중앙 스테이지 없음');
    hero.innerHTML = (cap ? `<span data-proposal-caption>${cap}</span>` : '')
      + `<span data-testid="interim-value" data-proposal-hero-value>${value}</span>`;
    hero.style.removeProperty('width');
    hero.style.removeProperty('height');
    hero.style.setProperty('display', 'flex');
    hero.style.setProperty('flex-direction', 'column');
    hero.style.setProperty('align-items', 'center');
    hero.style.setProperty('justify-content', 'center');
    hero.style.setProperty('gap', '2cqh');
  }, { value: text, cap: caption });
}

const HERO_VALUE_CSS = `
/* 중앙 50% 트랙을 컨테이너로 삼는다 — 인식값 크기가 그 트랙에 비례한다(기기 무관 비율). */
[data-testid="voice-center-stage"] { container-type: size; container-name: centerstage; }
[data-proposal-hero-value] {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-weight: 900;
  letter-spacing: -0.02em;
  line-height: 1.02;
  white-space: nowrap;
  /* fb-27-7 5항 "정상 진행될때의 수준만큼 커야 함" — 정상 진행 InterimLine 실측 **90.13px**에 맞춘다.
     구속하는 쪽은 폭(cqw)이므로 그 항으로 크기가 정해진다. */
  font-size: clamp(32px, min(26cqh, 24cqw), 112px);
}
[data-proposal-caption] {
  font-size: clamp(11px, min(4.5cqh, 4cqw), 20px);
  font-weight: 800;
  letter-spacing: 0.02em;
  color: #A4A8B0;
}`;

const PROPOSAL_2: Proposal = {
  name: 'proposal-2-listening',
  redesigns: ['chips', 'indicator'],
  group: '개선안 (제안)',
  title: '인식 중 — 도트 파형 + 큰 인식값',
  source: '03-active-highlevel',
  feedback: 'fb-27-3 · fb-27-1 · fb-27-2',
  quote: '"파형 애니메이션도 세로 선이 아닌 도트들의 집합형태로 표현." / "기본 도트 마이크 상태에서 음성 인식시만 파형 애니메이션이 나와야 함."',
  changes: [
    '파형을 세로 막대 → **도트 집합**으로(같은 13×7 격자, 열 높이로 소리를 표현)',
    '🔴 대기(①)와 인식 중(②)이 **같은 격자 하나**를 쓴다 → 겹칠 레이어가 없어 fb-27-1의 교차페이드 결함이 **구조적으로 불가능**해진다',
    '도트 셀이 유동(1fr)이라 밴드가 아무리 낮아져도 넘치지 않는다 — fb-27-5의 넘침도 같은 변경으로 막힌다',
    '중앙에 실시간 인식값을 정상 크기(90px급)로 — ①에서 항목명을 지워 생긴 공간',
    '칩존은 ①과 동일(1행 + 세로 배열 + 비율 사이즈업)',
  ],
  apply: async (page) => {
    await prepareChipZone(page);
    await injectCss(page, CHIP_ZONE_ONE_ROW + HERO_VALUE_CSS);
    await dropHeroColumnName(page);
    await setHeroValue(page, '118.2', '인식 중');
    await replaceIndicatorWithDotField(page, waveField(SPEAKING_AMPLITUDES), 'wave');
    await scrollActiveChipIntoView(page);
  },
};

// ── ③ 칩존 스크롤 ─────────────────────────────────────────────────────────────

const PROPOSAL_3: Proposal = {
  name: 'proposal-3-chipzone-scrolled',
  redesigns: ['chips', 'indicator'],
  group: '개선안 (제안)',
  title: '중간 컬럼 진행 중 — 자동 스크롤된 상태',
  source: '09-chipzone-overflow',
  feedback: 'fb-27-2 (민구 재판단 2026-07-27)',
  quote: '"스크롤은 가로 스크롤(세로 스크롤 영역이 너무 작기에 가로 스크롤, 대신 진행중인 항목 하이라이트, 진행중인 항목에 맞춰서 자동 스크롤)."',
  changes: [
    '**진행이 중간 컬럼(측정항목06)까지 갔을 때** 칩존이 자동으로 그 칩에 맞춰 스크롤된 상태',
    '🔴 정렬 = **진행중 칩이 가장 우측 끝**(민구 확정) — 근거: "한국인은 좌→우로 읽으니 하이라이트도 좌→우로 이동해야 한다"',
    '그래서 **왼쪽에 남는 것이 입력을 마친 칩들**(값이 찍혀 있다) = 입력 확인 영역이 된다',
    '다음 항목은 값이 아직 "—"라 미리 볼 실익이 적다 — 그래서 오른쪽이 아니라 왼쪽을 보여준다',
    '가로 1행에 13컬럼이면 대부분이 화면 밖이다 — 자동 스크롤이 없으면 못 쓰는 화면이 된다',
    '⚠️ 왼쪽 칩의 값은 이 상태를 보여주기 위해 채운 것이다(원본 캡처는 세션 초반이라 전부 "—"였다)',
  ],
  apply: async (page) => {
    await prepareChipZone(page);
    await injectCss(page, CHIP_ZONE_ONE_ROW);
    await dropHeroColumnName(page);
    await replaceIndicatorWithDotField(page, MIC_FIELD, 'mic');
    // 진행이 중간까지 간 상태를 만든다(원본 캡처는 첫 음성 컬럼이 활성).
    await moveActiveChip(page, 8);
    await fillCompletedChips(page, 8, ['21.0', '22.0', '23.0', '24.0', '25.0']);
    await scrollActiveChipIntoView(page);
  },
};

// ── ④ 칩존 대안(안 B) ─────────────────────────────────────────────────────────

const CHIP_ZONE_LIST = `${CHIP_ZONE_CONTAINER}
/* fb-27-2 "칩 1행 제한" 해석 B — **칩 하나가 한 줄을 다 차지**하고 세로로 쌓인다(목록형).
   항목명과 값이 좌우로 넓게 퍼져 글자를 훨씬 크게 쓸 수 있지만, 한 번에 보이는 항목 수가 준다.
   어느 해석이 맞는지는 민구가 A(①③)와 나란히 보고 고른다. */
[data-testid="voice-chip-grid"] {
  flex-direction: column;
  flex-wrap: nowrap;
  align-items: stretch;
  overflow-x: hidden;
  overflow-y: auto;
}
[data-testid="column-chip"] {
  width: 100%;
  flex: 0 0 auto;
  height: calc((100% - 8px) / 2);   /* 한 화면에 두 줄 */
  min-height: 44px;
  min-width: 0;
  max-width: none;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  padding: 0 5cqw;
  gap: 4cqw;
}
[data-testid="column-chip"] > span {
  overflow: visible;
  text-overflow: clip;
  max-width: none;
  white-space: nowrap;
}
[data-testid="column-chip"] > span:first-child {
  font-size: clamp(13px, min(17cqh, 4.6cqw), 32px);
}
[data-testid="column-chip"] > span:last-child {
  font-size: clamp(22px, min(34cqh, 9.5cqw), 68px);
}`;

const PROPOSAL_4: Proposal = {
  name: 'proposal-4a-chipzone-alt',
  // 🔴 민구 기각(2026-07-27). 파일과 리포트 기록은 남기되 Design 패널 카드 마커는 내린다.
  rejected: true,
  redesigns: ['chips', 'indicator'],
  chipScroll: 'y',
  group: '개선안 · 칩존 대안',
  title: '칩존 대안 B — 한 줄에 칩 하나(목록형)',
  source: '01-active-listening',
  feedback: 'fb-27-2 (대안 해석)',
  quote: '"칩은 1행으로 제한하고" — 이 문장이 두 갈래로 읽힌다.',
  changes: [
    '🔴 **선택지 카드다.** 안 A(①③) = 보이는 줄이 하나, 그 줄 안에 칩 여러 개.',
    '안 B(이 카드) = 칩 하나가 한 줄을 다 차지하고 세로로 쌓인다(목록형).',
    '항목명 왼쪽 / 값 오른쪽으로 넓게 퍼져 **글자를 A보다 훨씬 크게** 쓸 수 있다',
    '대신 한 번에 보이는 항목이 2개로 준다 — A는 더 많이 보이고 글자는 조금 작다',
    '🔴 **민구 기각(2026-07-27).** 안 A(한 행에 칩 여러 개)로 확정됐다. 기록으로만 남기고 Design 패널에는 카드로 올리지 않는다.',
    '기각 사유(민구 판단): 세로 스크롤 영역이 너무 작다 — 25% 트랙은 한 줄이면 이미 꽉 찬다. 그래서 스크롤을 가로로 되돌렸다.',
  ],
  apply: async (page) => {
    await prepareChipZone(page);
    await injectCss(page, CHIP_ZONE_LIST);
    await dropHeroColumnName(page);
    await replaceIndicatorWithDotField(page, MIC_FIELD, 'mic');
    await scrollActiveChipIntoView(page, 'y');
  },
};

// ── ⑤ 조절판 확장 ─────────────────────────────────────────────────────────────

const PANEL_OPEN_CSS = `
/* fb-27-5 "하단 최상단까지 확장하여 겹치지 않게 표현" + fb-27-6 "해당 영역의 버튼을 비활성화"
   → **민구 선택(2026-07-27): 완전히 숨긴다.**
   인디케이터와 \`<\` \`>\`를 흐리게 남기는 대신 아예 걷어내고 조절판이 하단 트랙을 다 쓴다.
   겹칠 상자가 존재하지 않으므로 오탭 가능성이 0이고, 조절 버튼은 그만큼 커진다. */
[data-testid="voice-control-bar"] {
  display: flex;
  flex-direction: column;
  justify-content: center;
}
[data-proposal-nav-row] { display: none; }
[data-testid="input-control-panel"] {
  flex: 1 1 auto;
  min-height: 0;
  justify-content: center;
  gap: 10px;
}
/* 남는 높이를 실제로 쓴다 — 장갑 낀 손으로 조절하는 곳이라 클수록 좋다. */
[data-testid="input-control-panel"] [data-testid$="-minus"],
[data-testid="input-control-panel"] [data-testid$="-plus"] {
  width: 100%;
  height: 100%;
  min-height: 56px;
  font-size: 32px;
}
[data-testid="stepper-tolerance"], [data-testid="stepper-tts-rate"] {
  height: 100%;
  align-content: center;
}
[data-testid="input-control-toggle"] { min-height: 48px; font-size: 16px; }
/* 조절판이 접히면 인디케이터가 돌아온다. 그때도 넘치지 않도록 도트 격자는 유동 셀(1fr)로 바꿔둔다 —
   현행은 밴드에 maxHeight만 걸고 StateDots에는 클램프 **전** 값을 넘겨서 91px 도트가 40.75px 밴드를
   50.75px 넘쳤다(실측). maxHeight로는 자식 overflow를 못 막는다. */
[data-testid="live-listen-band"] { height: 100%; max-height: 100%; overflow: hidden; }`;

const PROPOSAL_5: Proposal = {
  name: 'proposal-5-panel-open',
  redesigns: ['chips', 'panel', 'indicator'],
  group: '개선안 (제안)',
  title: '조절판 확장 — 겹침 제거 + 영역 비활성',
  source: '06-panel-open',
  feedback: 'fb-27-5 · fb-27-6',
  quote: '"진행 설정 탭 확장시 겹치는 영역 발생. 하단 최상단까지 확장하여 겹치지 않게 표현." / "겹치는 영역의 토트 아이콘 클릭되어서 진행에 문제 생김. 진행설정탭을 확장시 해당 영역의 버튼을 비활성화 할 것."',
  changes: [
    '🔴 **민구 선택(2026-07-27): 하단 인디케이터·`<`·`>`를 완전히 숨긴다.** 흐리게 남기는 안과 둘 중 고른 결과다',
    '조절판이 하단 트랙을 통째로 쓴다 → 겹칠 상자가 **존재하지 않으므로** 오탭 가능성이 0이다',
    '남는 높이만큼 조절 버튼이 커진다(장갑 조작 — 최소 56px)',
    '접히면 인디케이터가 그대로 돌아온다(현재상태 카드 06과 대비해서 보면 된다)',
    '돌아왔을 때도 넘치지 않도록 도트 격자를 유동 셀(1fr)로 바꿔뒀다 — 실측 50.75px 넘침의 근본 원인 제거',
    'maxHeight만으로는 자식 overflow를 못 막는다(현행이 그 증거). 크기를 전달하는 대신 기하로 푼다',
    '칩존·중앙·하단은 **합의된 기준 레이아웃**(안 A: 1행 + 세로배열 + 세로스크롤 + 비율 사이즈업, 중앙 항목명 없음, 하단 도트)을 그대로 얹었다 — 조절판 수정만 이 카드의 고유 변경이다',
  ],
  apply: async (page) => {
    await page.evaluate(() => {
      const bar = document.querySelector<HTMLElement>('[data-testid="voice-control-bar"]');
      const band = document.querySelector<HTMLElement>('[data-testid="live-listen-band"]');
      if (!bar || !band) throw new Error('컨트롤 바 없음');
      // 인디케이터가 들어 있는 행(= `<` `>`와 같은 줄)을 찾아 표식을 단다.
      const navRow = band.parentElement as HTMLElement;
      navRow.setAttribute('data-proposal-nav-row', '');
      // 높이·flex를 다 걷어야 조절판이 위로 올라간 뒤에도 이 행이 44px 아래로 눌리지 않는다.
      // 🔴 `display`를 반드시 포함한다 — 인라인 `display:flex`가 남으면 제안의 `display:none`이 져서
      //    "숨겼다"는 카드가 실제로는 그대로 보인다(오라클이 잡았다).
      for (const prop of ['display', 'height', 'min-height', 'max-height', 'flex', 'flex-basis', 'flex-shrink', 'padding']) {
        navRow.style.removeProperty(prop);
      }
      const note = document.createElement('span');
      note.setAttribute('data-proposal-disabled-note', '');
      note.textContent = '조절판 열림 — 이 영역 비활성';
      navRow.appendChild(note);
      // 비활성은 보이기만 하는 게 아니라 실제로 눌리지 않아야 한다(원인 제거).
      navRow.querySelectorAll('button').forEach((b) => b.setAttribute('disabled', ''));
    });
    await prepareChipZone(page);
    await injectCss(page, CHIP_ZONE_ONE_ROW + PANEL_OPEN_CSS);
    await dropHeroColumnName(page);
    await replaceIndicatorWithDotField(page, MIC_FIELD, 'mic');
    await scrollActiveChipIntoView(page);
  },
};

// ── ⑥⑦ 알람 카드 ─────────────────────────────────────────────────────────────

const ANOMALY_CSS = `
/* fb-27-7 — 알람값 키우기 / 직전·현재를 상하로 / 날짜는 mm-dd로 값 앞에 / 인식값을 정상 크기로.
   🔴 인라인 폰트로 박지 않는다. 지금 결함(알람 중 인식값이 32.16px로 고정)의 원인이 바로
      AlarmInterimStrip의 **인라인 하드코딩**이고, heroLayout.ts가 "상태별 인라인 정의 금지"로
      막아둔 계약이다. 아래 값들은 전부 STATE_TYPE 같은 상수 계층으로 올릴 수 있는 형태다. */
/* 컨테이너는 **중앙 50% 트랙**이다. 알람 카드 자신에 걸면 height:100%가 size containment와 맞물려
   cq 단위가 0으로 떨어진다(첫 시안에서 모든 폰트가 clamp 하한으로 주저앉았다). */
[data-testid="voice-center-stage"] { container-type: size; container-name: centerstage; }
[data-testid="anomaly-headline"] {
  font-size: clamp(24px, min(11cqh, 8.5cqw), 56px);   /* 알람값 키우기 */
  line-height: 1.1;
}
/* 좌우 2열 → 상하 2줄. 라벨이 값 앞에 오도록 순서를 재배치한다(DOM은 라벨·라벨·값·값 순). */
[data-testid="anomaly-comparison"] {
  grid-template-columns: max-content 1fr;
  align-items: baseline;
  justify-items: start;
  column-gap: 4cqw;
  row-gap: 2cqh;
  padding: 0 3cqw;
}
[data-testid="anomaly-comparison"] > *:nth-child(1) { order: 0; }
[data-testid="anomaly-comparison"] > *:nth-child(3) { order: 1; }
[data-testid="anomaly-comparison"] > *:nth-child(2) { order: 2; }
[data-testid="anomaly-comparison"] > *:nth-child(4) { order: 3; }
[data-testid="anomaly-comparison"] > * {
  overflow: visible;
  text-overflow: clip;
  max-width: none;
  white-space: nowrap;
}
[data-testid="anomaly-comparison"] > *:nth-child(1),
[data-testid="anomaly-comparison"] > *:nth-child(2) {
  font-size: clamp(13px, min(7cqh, 5cqw), 30px);
}
[data-testid="anomaly-prev-value"], [data-testid="anomaly-next-value"] {
  font-size: clamp(26px, min(17cqh, 13cqw), 78px);   /* 값도 함께 키운다 */
  justify-self: end;
}`;

/** 알람 카드 공통 손질 — 날짜 라벨 축약 + 동결 해제. ⑥⑦이 같이 쓴다. */
async function reshapeAnomalyCard(page: Page): Promise<void> {
  await unfreeze(page, '[data-testid="anomaly-alert"]', ['width', 'height', 'padding', 'font-size']);
  await unfreeze(page, '[data-testid="anomaly-headline"]', ['width', 'height', 'font-size', 'line-height', 'max-width']);
  // 🔴 `grid-template-columns`를 걷지 않으면 인라인 `1fr 1fr`이 남아 좌우 2열이 그대로다 —
  //    order만 바꿔봐야 "상하 배치"가 되지 않는다.
  await unfreeze(page, '[data-testid="anomaly-comparison"]',
    ['width', 'height', 'column-gap', 'row-gap', 'padding', 'grid-template-columns', 'grid-template-rows', 'align-items', 'justify-items']);
  await unfreeze(page, '[data-testid="anomaly-comparison"] > *',
    ['width', 'height', 'font-size', 'line-height', 'max-width', 'min-width', 'overflow', 'text-overflow']);
  await page.evaluate(() => {
    // fb-27-7 3항 — "날짜는 연도 빼고 mm-dd, 값 앞에". `직전(2026-07-26)` → `07-26`.
    const label = document.querySelector('[data-testid="anomaly-comparison"] > *:nth-child(1)');
    if (label) {
      const m = (label.textContent ?? '').match(/(\d{4})-(\d{2})-(\d{2})/);
      label.textContent = m ? `${m[2]}-${m[3]}` : '직전';
    }
  });
}

const PROPOSAL_6: Proposal = {
  name: 'proposal-6-anomaly',
  redesigns: ['chips', 'anomaly', 'indicator'],
  group: '개선안 (제안)',
  title: '알람 — 값 키우고 상하 배치',
  source: '04-anomaly',
  feedback: 'fb-27-7',
  quote: '"알람 값 너무 작음. 이전값과 다음값을 좌우가 아닌 상하로 배치. 날짜는 연도 빼고 월일만 값 앞에. 현재도 값 앞에. 실시간 인식 문자 너무 작음 — 정상 진행될때의 수준만큼 커야 함."',
  changes: [
    '알람 헤드라인을 키움(29.7px → 카드 높이 비례)',
    '직전/현재를 **좌우 2열 → 상하 2줄**로',
    '날짜를 `2026-07-26` → **`07-26`**, 값 **앞**에 배치',
    '"현재"도 값 앞에 — 라벨과 값이 한 줄로 읽힌다',
    '직전·현재 값 자체도 함께 키움',
    '칩존·중앙·하단은 **합의된 기준 레이아웃**(안 A)을 얹었다 — 알람 표현만 이 카드의 고유 변경이다',
    '이 카드는 **인식 전** 상태다(현재값 표시). 인식 중은 ⑦번 카드 — fb-27-7 5항의 "공간이 안 나오면 현재값 자리를 임시로 쓴다"를 그렇게 푼다',
    '🔴 인라인 폰트로 박지 않았다 — 현행 32.16px 고정의 원인이 그 인라인 하드코딩이고 heroLayout이 금지한 계약이다. 전부 STATE_TYPE 상수로 올릴 수 있는 형태',
  ],
  apply: async (page) => {
    await applyBaselineLayout(page, ALERT_FIELD, 'alert');
    await reshapeAnomalyCard(page);
    await injectCss(page, ANOMALY_CSS);
    // 인식 전 상태 — 알람 중 인식 스트립은 아직 비어 있다.
    await page.evaluate(() => {
      document.querySelector<HTMLElement>('[data-testid="interim-value"]')?.remove();
    });
  },
};

const PROPOSAL_7: Proposal = {
  name: 'proposal-7-anomaly-interim',
  redesigns: ['chips', 'anomaly', 'indicator'],
  group: '개선안 (제안)',
  title: '알람 중 음성 인식 — 현재값 자리를 인식값이 쓴다',
  source: '04-anomaly',
  feedback: 'fb-27-7 (5항)',
  quote: '"실시간 인식 문자 너무 작음. 정상 진행될때의 수준만큼 커야 함. 만약 공간이 안나온다면, 현재의 값을 표현하는 부분을 임시로 사용 할 것."',
  changes: [
    '칩존·중앙·하단은 **합의된 기준 레이아웃**(안 A)을 얹었다 — 알람 표현만 이 카드의 고유 변경이다',
    '⑥과 같은 알람 카드에서, **인식 중에는 "현재" 자리에 실시간 인식값이 크게** 들어간다',
    '민구의 조건부 지시("공간이 안 나오면 현재값 자리를 임시로")를 그대로 구현한 상태',
    '🔴 **민구 선택(2026-07-27): 직전값을 줄여 90px급을 확보한다.** 현행 32.16px → 약 90px',
    '헤드라인과 직전 행이 작아지지만 **계속 보인다** — 비교 정보를 잃지 않는다',
    '⑥과 나란히 보면 인식 전/중 전환이 이해된다',
    '라벨을 "현재" → "인식 중"으로 바꿔 임시 점유임을 밝힌다',
  ],
  apply: async (page) => {
    await applyBaselineLayout(page, ALERT_FIELD, 'alert');
    await reshapeAnomalyCard(page);
    await injectCss(page, ANOMALY_CSS + `
/* 🔴 민구 선택(2026-07-27): **직전값 줄이고 90px 확보.**
   fb-27-7 5항 "정상 진행될때의 수준만큼 커야 함"을 알람 카드 안에서도 지키기 위해,
   헤드라인과 직전 행을 눌러 공간을 만들고 인식값을 정상 진행 InterimLine과 같은 급으로 올린다.
   직전값은 계속 보이되 작아진다(비교 정보를 잃지 않는다). */
[data-testid="anomaly-headline"] { font-size: clamp(16px, min(6.5cqh, 5.5cqw), 32px); }
[data-testid="anomaly-comparison"] {
  /* 값 행이 하나뿐이라 우측 정렬하면 라벨과 멀어져 읽기 어렵다 — 붙여서 가운데로. */
  grid-template-columns: max-content max-content;
  justify-content: center;
  column-gap: 12px;
}
[data-testid="anomaly-comparison"] > *:nth-child(1) { font-size: clamp(11px, min(4cqh, 3.4cqw), 18px); }
[data-testid="anomaly-prev-value"] { font-size: clamp(14px, min(6cqh, 5cqw), 30px); justify-self: start; }
/* '인식 중' 라벨과 값은 한 줄을 통째로 써서 값이 최대 폭을 쓸 수 있게 한다. */
[data-testid="anomaly-comparison"] > *:nth-child(2) {
  grid-column: 1 / -1; justify-self: center;
  font-size: clamp(11px, min(4cqh, 3.4cqw), 18px);
  color: #A4A8B0;
}
[data-proposal-interim] {
  grid-column: 1 / -1; justify-self: center;
  font-size: clamp(48px, min(26cqh, 24cqw), 112px);
  color: #F5F5F7;
}`);
    await page.evaluate(() => {
      document.querySelector<HTMLElement>('[data-testid="interim-value"]')?.remove();
      const label = document.querySelector<HTMLElement>('[data-testid="anomaly-comparison"] > *:nth-child(2)');
      const value = document.querySelector<HTMLElement>('[data-testid="anomaly-next-value"]');
      if (label) { label.textContent = '인식 중'; label.setAttribute('data-proposal-interim-label', ''); }
      // 현재값 자리를 실시간 인식값이 점유한다(fb-27-7 5항의 조건부 지시).
      // 🔴 testid를 갈아끼우지 않는다 — "현재" 슬롯의 자리를 그대로 두어야 상하 배치 오라클이 성립한다.
      //    임시 점유는 별도 표식으로 나타낸다.
      if (value) { value.textContent = '118.2'; value.setAttribute('data-proposal-interim', ''); }
    });
  },
};

// ── ⑧ 정정 후 ────────────────────────────────────────────────────────────────

const PROPOSAL_8: Proposal = {
  name: 'proposal-8-corrected',
  redesigns: ['chips', 'anomaly', 'indicator'],
  group: '개선안 (제안)',
  title: '정정 후 — `정상 : 복귀` 삭제',
  source: '05-anomaly-corrected',
  feedback: 'fb-27-8',
  quote: '"정상 : 복귀 라는 표현은 삭제. 이미 하단에 아이콘과 엣지 글로우로 알 수 있음."',
  changes: [
    '칩존·중앙·하단은 **합의된 기준 레이아웃**(안 A)을 얹었다 — 알람 표현만 이 카드의 고유 변경이다',
    '`정상 : 복귀` 헤드라인을 **삭제**했다(오늘 실기기에서 19회 노출됐던 문구)',
    '지운 자리는 비워두지 않고 **값 영역이 그만큼 커지도록** 했다 — 카드 높이는 그대로, 읽을 것만 남는다',
    '상태는 하단 도트 아이콘(초록)과 엣지 글로우가 이미 말한다 — 민구 근거 그대로이고 코드와도 정합한다',
    '직전/현재는 ⑥과 같은 상하 배치·mm-dd 라벨을 그대로 따른다(알람 카드 일관성)',
  ],
  apply: async (page) => {
    await applyBaselineLayout(page, MIC_FIELD, 'mic');
    await reshapeAnomalyCard(page);
    await injectCss(page, ANOMALY_CSS + `
/* 헤드라인이 사라진 만큼 값이 커진다 — 빈 자리를 남기지 않는다. */
[data-testid="anomaly-prev-value"], [data-testid="anomaly-next-value"] {
  font-size: clamp(30px, min(21cqh, 15cqw), 92px);
}`);
    await page.evaluate(() => {
      document.querySelector<HTMLElement>('[data-testid="anomaly-headline"]')?.remove();
      document.querySelector<HTMLElement>('[data-testid="interim-value"]')?.remove();
    });
  },
};

// ── ⑨ 알람 아이콘 후보 ────────────────────────────────────────────────────────

const PROPOSAL_9: Proposal = {
  name: 'proposal-9-alert-icons',
  kind: 'sheet',
  redesigns: [],
  group: '개선안 · 아이콘 후보',
  title: '알람 아이콘 후보 4종 — 번호로 골라주세요',
  source: '04-anomaly',
  feedback: 'fb-27-4',
  quote: '"알람 아이콘 변경. 좀 더 직관적인 도트 아이콘으로. 개선 작업시 후보 내게 제출하여 선택 여구 할 것."',
  changes: [
    '🔴 **민구 확정(2026-07-27): 1번 굵은 느낌표.** fb-27-4 종결 — 이 카드는 선택 기록으로 남긴다',
    '선택된 1번이 ⑥⑦의 하단 알람 글리프에 실제로 적용돼 있다(같은 격자·같은 셀 크기)',
    '전부 현행 `StateDots`와 같은 도트 매트릭스 방식, 같은 색(알람 빨강)·같은 밴드 높이 조건',
    '1 굵은 느낌표 / 2 삼각형+느낌표(현행) / 3 원형 테두리+느낌표 / 4 증가 화살표',
    '판정 기준은 야외·원거리·장갑에서 **1초 안에 구별되는가**다 — 각 후보 아래 한 줄로 뜻을 적었다',
  ],
  apply: async (page) => {
    const cards = ALERT_ICON_CANDIDATES.map((c) => `
      <div data-proposal-icon-card${c.selected ? ' data-proposal-icon-selected' : ''}>
        <div data-proposal-icon-no>${c.no}</div>
        ${c.selected ? '<div data-proposal-icon-badge>선택됨</div>' : ''}
        <div data-proposal-icon-slot>${dotFieldHtml(c.bitmap, { testId: `icon-candidate-${c.no}` })}</div>
        <div data-proposal-icon-label>${c.label}</div>
        <div data-proposal-icon-meaning>${c.meaning}</div>
      </div>`).join('');
    await page.evaluate(({ markup }) => {
      const stage = document.querySelector<HTMLElement>('.ds-stage');
      if (!stage) throw new Error('스테이지 없음');
      stage.innerHTML = `<div id="root" data-proposal-icon-sheet>
        <h1 data-proposal-sheet-title>알람 아이콘 후보</h1>
        <p data-proposal-sheet-sub>민구 확정(2026-07-27): <b>1번 굵은 느낌표</b>. 현행은 2번이었습니다. fb-27-4 종결.</p>
        <div data-proposal-icon-grid>${markup}</div>
      </div>`;
    }, { markup: cards });
    await injectCss(page, `
[data-proposal-icon-sheet] {
  height: 100%;
  display: flex; flex-direction: column;
  padding: 20px 16px; gap: 10px;
  background: #0E0F11; color: #F5F5F7;
  font-family: 'Pretendard', -apple-system, system-ui, sans-serif;
}
[data-proposal-sheet-title] { margin: 0; font-size: 22px; font-weight: 900; letter-spacing: -0.02em; }
[data-proposal-sheet-sub] { margin: 0; font-size: 13px; font-weight: 700; color: #A4A8B0; }
[data-proposal-icon-grid] {
  flex: 1; min-height: 0;
  display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr; gap: 10px;
}
[data-proposal-icon-card] {
  position: relative;
  min-height: 0; min-width: 0;
  border: 1px solid rgba(255,255,255,0.13); border-radius: 16px;
  background: #1A1C1F; padding: 10px 8px;
  display: grid; grid-template-rows: auto 1fr auto auto; gap: 4px;
  justify-items: center; text-align: center;
}
[data-proposal-icon-no] {
  width: 26px; height: 26px; border-radius: 50%;
  background: #FF5252; color: #0E0F11;
  font-size: 15px; font-weight: 950; line-height: 26px;
}
/* 크기·색은 현행과 동일 조건 — 밴드 높이(92px)에 놓인 알람 도트와 같은 상황에서 비교한다. */
[data-proposal-icon-slot] {
  min-height: 0; height: 100%; width: 100%;
  display: flex; align-items: center; justify-content: center;
  color: #FF5252;
}
[data-proposal-icon-selected] { border-color: #00C853; box-shadow: 0 0 0 1px #00C853 inset; }
[data-proposal-icon-badge] {
  position: absolute; top: 10px; left: 10px;
  background: #00C853; color: #0E0F11;
  font-size: 10px; font-weight: 950; letter-spacing: 0.02em;
  padding: 3px 7px; border-radius: 999px;
}
[data-proposal-icon-label] { font-size: 13px; font-weight: 850; }
[data-proposal-icon-meaning] { font-size: 10.5px; font-weight: 600; line-height: 1.35; color: #A4A8B0; }`);
  },
};

export const PROPOSALS: Proposal[] = [
  PROPOSAL_1, PROPOSAL_2, PROPOSAL_3, PROPOSAL_4,
  PROPOSAL_5, PROPOSAL_6, PROPOSAL_7, PROPOSAL_8, PROPOSAL_9,
];

