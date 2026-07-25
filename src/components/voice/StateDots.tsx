/** 와이어프레임 §공통규칙5 — 하단 인디케이터의 **도트 아이콘**.
 *  "아이콘을 도트로 구성, 숨쉬듯 크기 반복, 색=상태 배경톤" → 음성 입력이 들어오면 같은 자리의
 *  역동 세로파형으로 전환된다(전환은 StateIndicator가 --voice-level로 처리한다).
 *
 *  상태별 글리프(와이어프레임): 대기=마이크 / 이상치=경고(!) / 일시정지=`||` / 완료=`V`(체크).
 *  구현: 비트맵 한 장에서 1인 칸만 원형 span으로 그린다(SVG 대신 도트 그리드 — "아이콘을 도트로
 *  구성"이 스펙 그대로다). 호흡은 CSS 키프레임(`dot-breathe`, transform/opacity 전용)이고
 *  rAF를 새로 돌리지 않는다 — 오디오 반응은 파형이 담당한다. reduced-motion은 global.css가 끈다. */
export type DotGlyph = 'mic' | 'alert' | 'pause' | 'check';

/** 각 글리프의 도트 비트맵(행 문자열, `#`=도트). 열 수는 글리프마다 다르다(마이크는 좁고, 경고/
 *  체크는 넓다). 렌더러가 행/열 수를 읽어 정사각 셀 그리드를 만든다. */
const GLYPHS: Record<DotGlyph, readonly string[]> = {
  // 마이크: 캡슐(3열) + 수음 아크 + 스탠드/받침.
  mic: [
    '.###.',
    '.###.',
    '.###.',
    '#...#',
    '.###.',
    '..#..',
    '.###.',
  ],
  // 경고: 삼각 외곽선 + 안쪽 `!`(획 2칸 + 점 1칸).
  alert: [
    '...#...',
    '..#.#..',
    '.#...#.',
    '.#.#.#.',
    '#..#..#',
    '#.....#',
    '#..#..#',
    '#######',
  ],
  // 일시정지: 2칸 폭 막대 두 개.
  pause: [
    '##.##',
    '##.##',
    '##.##',
    '##.##',
    '##.##',
  ],
  // 완료: 체크(짧은 하강 + 긴 상승).
  check: [
    '......#',
    '.....#.',
    '#...#..',
    '.#.#...',
    '..#....',
  ],
};

/** 호흡 주기 — EdgeGlow/voice-status-fade와 같은 상태별 cadence(경고는 빠르게, 일시정지는 느리게). */
const BREATHE_S: Record<DotGlyph, number> = { mic: 1.75, alert: 0.7, pause: 2.4, check: 2 };

export function StateDots({ glyph, color, size }: { glyph: DotGlyph; color: string; size: number }) {
  const rows = GLYPHS[glyph];
  const cols = rows[0].length;
  // 셀은 정사각. 세로 기준으로 크기를 잡아 밴드 높이를 넘지 않게 한다(가로는 항상 더 여유롭다).
  const cell = Math.max(3, Math.floor(size / rows.length));
  const dot = Math.max(2, Math.round(cell * 0.72));
  const cx = (cols - 1) / 2;
  const cy = (rows.length - 1) / 2;
  return (
    <div
      data-testid="state-dots"
      data-glyph={glyph}
      role="img"
      aria-hidden
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${cols}, ${cell}px)`,
        gridTemplateRows: `repeat(${rows.length}, ${cell}px)`,
        justifyItems: 'center',
        alignItems: 'center',
        color,
      }}
    >
      {rows.flatMap((row, r) =>
        Array.from(row).map((ch, c) => {
          if (ch !== '#') return null;
          // 중심에서 멀수록 늦게 부푼다 = 안에서 밖으로 번지는 호흡(원거리에서 "살아 있음"으로 읽힌다).
          const delay = (Math.hypot(c - cx, r - cy) / Math.hypot(cx + 1, cy + 1)) * 0.45;
          return (
            <span
              key={`${r}-${c}`}
              style={{
                gridColumn: c + 1,
                gridRow: r + 1,
                width: dot,
                height: dot,
                borderRadius: '50%',
                background: 'currentColor',
                boxShadow: `0 0 ${Math.round(dot * 0.9)}px currentColor`,
                animation: `dot-breathe ${BREATHE_S[glyph]}s ease-in-out ${delay.toFixed(2)}s infinite`,
                willChange: 'transform, opacity',
              }}
            />
          );
        }),
      )}
    </div>
  );
}
