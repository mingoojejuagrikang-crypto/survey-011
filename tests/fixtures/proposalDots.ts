/**
 * 개선안 전용 **도트 필드** — fb-27-1 + fb-27-3을 한 설계로 푼다.
 *
 * 현행은 도트(대기)와 세로막대 파형(입력)이 **다른 두 레이어**이고 `--voice-level`로 교차페이드한다.
 * 그 교차 구간이 fb-27-1의 결함이다(레벨 0.06에서 도트 0.52 / 파형 0.48 동시 렌더 — 실측).
 *
 * 민구가 fb-27-3에서 "파형도 도트들의 집합으로"를 요청하면서 두 요청이 하나로 합쳐진다:
 * **대기도 도트, 입력도 도트 → 같은 격자에서 켜지는 칸만 달라진다.** 겹칠 상대가 없으므로
 * 교차페이드 자체가 사라지고 fb-27-1의 결함이 **구조적으로 불가능**해진다.
 *
 * 셀은 `1fr`(유동)이고 필드는 `height:100% + aspect-ratio`라 **어떤 높이에서도 상자를 넘지 않는다** —
 * fb-27-5(91px 도트가 40.75px 밴드를 넘침)도 같은 변경으로 함께 막힌다. 클램프가 아니라 기하 자체다.
 *
 * 앱 이식 노트: 이 격자는 `StateDots`의 비트맵 렌더러와 같은 결이다. React에서는
 * `GLYPHS`에 13열 비트맵을 두고, 파형은 레벨→열 높이 함수 하나로 같은 격자에 그리면 된다.
 */

/** 격자 폭 — 현행 `VoiceWaveform`의 `BAR_COUNT = 13`을 그대로 승계한다(막대 13개 = 열 13개). */
export const FIELD_COLS = 13;
/** 격자 높이 — 현행 `GLYPHS.mic`이 7행이라 그대로 맞춘다(마이크 글리프가 그대로 들어간다). */
export const FIELD_ROWS = 7;

/** 5열 마이크 글리프를 13열 격자 한가운데로 옮긴 것(현행 `StateDots.GLYPHS.mic`과 같은 그림). */
export const MIC_FIELD: readonly string[] = [
  '....' + '.###.' + '....',
  '....' + '.###.' + '....',
  '....' + '.###.' + '....',
  '....' + '#...#' + '....',
  '....' + '.###.' + '....',
  '....' + '..#..' + '....',
  '....' + '.###.' + '....',
];

/** 알람 글리프 — **민구 확정(2026-07-27): 후보 1번 "굵은 느낌표".** fb-27-4 종결.
 *  외곽(삼각형)을 버리고 획에 도트를 몰아줘서, 같은 밴드 높이에서 획이 가장 굵다.
 *  야외·원거리·장갑 환경에서 1초 안에 읽히는 것이 판정 기준이었다.
 *  5열 글리프를 13열 격자 한가운데로 옮긴 것(마이크와 같은 격자·같은 셀 크기). */
export const ALERT_FIELD: readonly string[] = [
  '....' + '.###.' + '....',
  '....' + '.###.' + '....',
  '....' + '.###.' + '....',
  '....' + '.###.' + '....',
  '....' + '.###.' + '....',
  '....' + '.....' + '....',
  '....' + '.###.' + '....',
  '....' + '.###.' + '....',
];

/** 열별 진폭(0~3) → 중앙 행에서 위아래로 대칭으로 켠다. 현행 파형이 scaleY로 중앙 기준
 *  확대되는 것과 같은 읽기다. 정지 카드라 한 프레임을 고정값으로 굳힌다. */
export function waveField(amplitudes: readonly number[]): string[] {
  const center = (FIELD_ROWS - 1) / 2;
  return Array.from({ length: FIELD_ROWS }, (_, r) =>
    amplitudes.map((a) => (Math.abs(r - center) <= a ? '#' : '.')).join(''),
  );
}

/** 발화 중 한 프레임(실제 파형 캡처의 형태를 따른 값). */
export const SPEAKING_AMPLITUDES = [1, 2, 3, 2, 3, 3, 2, 3, 3, 2, 3, 2, 1] as const;

/** 알람 아이콘 후보 — fb-27-4. **임의로 하나 고르지 않는다**(민구 명시: 후보를 제출해 선택받을 것). */
export interface IconCandidate {
  no: number;
  label: string;
  /** 민구가 고른 후보(2026-07-27 확정). 카드에 표시만 하고 후보 자체는 기록으로 남긴다. */
  selected?: boolean;
  /** 이 형태가 무엇을 뜻하는지 — 야외·원거리·장갑에서 1초 안에 구별되는가가 판정 기준이다. */
  meaning: string;
  bitmap: readonly string[];
}

export const ALERT_ICON_CANDIDATES: readonly IconCandidate[] = [
  {
    no: 1,
    label: '굵은 느낌표',
    selected: true,
    meaning: '외곽이 없어 획이 가장 굵다. 멀리서 제일 크게 보인다.',
    bitmap: ['.###.', '.###.', '.###.', '.###.', '.###.', '.....', '.###.', '.###.'],
  },
  {
    no: 2,
    label: '삼각형 + 느낌표 (현행)',
    meaning: '표준 경고 기호. 뜻은 분명하나 외곽이 도트를 나눠 써 획이 얇다.',
    bitmap: ['...#...', '..#.#..', '.#...#.', '.#.#.#.', '#..#..#', '#.....#', '#..#..#', '#######'],
  },
  {
    no: 3,
    label: '원형 테두리 + 느낌표',
    meaning: '외곽이 단순해 안쪽 획이 굵다. 하단 톤 글로우와도 잘 맞는다.',
    bitmap: ['..###..', '.#...#.', '#..#..#', '#..#..#', '#..#..#', '#.....#', '.#.#.#.', '..###..'],
  },
  {
    no: 4,
    label: '증가 화살표',
    meaning: '경고가 아니라 무엇이 일어났는지를 말한다. 감소 알람은 상하 반전.',
    bitmap: ['...#...', '..###..', '.#.#.#.', '#..#..#', '...#...', '...#...', '...#...', '...#...'],
  },
];

/** 비트맵을 도트 격자 HTML로.
 *
 * 🔴 상자를 절대 넘지 않는 것이 이 함수의 계약이다(fb-27-5가 바로 그 넘침 결함이다).
 * `height:100% + aspect-ratio`로는 부족하다 — 높이가 확정되면 `max-width`가 폭을 줄여도
 * 비율이 깨지면서 가로로 삐져나온다(아이콘 후보 시트에서 실제로 그렇게 새어나갔다).
 * 그래서 **셀 크기를 두 축에서 동시에 계산**한다: `min(100cqw/열, 100cqh/행)`.
 * 어느 축이 좁든 그 축이 셀을 정하므로 정사각 셀을 유지한 채 항상 들어간다. */
export function dotFieldHtml(bitmap: readonly string[], opts: { testId?: string; glyph?: string } = {}): string {
  const rows = bitmap.length;
  const cols = bitmap[0].length;
  const attrs = [
    opts.testId ? ` data-testid="${opts.testId}"` : '',
    opts.glyph ? ` data-glyph="${opts.glyph}"` : '',
  ].join('');
  const cells = bitmap
    .flatMap((row, r) =>
      Array.from(row).map((ch, c) =>
        ch === '#'
          ? `<span style="grid-column:${c + 1};grid-row:${r + 1};width:72%;height:72%;border-radius:50%;`
            + 'background:currentColor;box-shadow:0 0 0.5em currentColor;justify-self:center;align-self:center"></span>'
          : '',
      ),
    )
    .join('');
  // 슬롯이 컨테이너다 — 셀 크기가 이 상자의 두 변에서 동시에 계산된다.
  return '<div data-proposal-dotslot style="container-type:size;width:100%;height:100%;display:grid;place-items:center">'
    + `<div${attrs} role="img" aria-hidden="true" data-proposal-dotfield="${cols}x${rows}" style="`
    + `--dot-cell:min(calc(100cqw / ${cols}), calc(100cqh / ${rows}));`
    + `display:grid;grid-template-columns:repeat(${cols}, var(--dot-cell));`
    + `grid-template-rows:repeat(${rows}, var(--dot-cell))">${cells}</div></div>`;
}
