/**
 * v0.15.0 A3 — 자동 세션명 같은-날 중복 방지.
 *
 * 배경: 자동 세션 라벨은 `${ISO날짜} ${픽업값}`(또는 픽업값이 없으면 `${ISO날짜}` 단독)으로 만들어진다.
 * 같은 날 같은 농가/같은 자동값으로 여러 세션을 시작하면 라벨이 완전히 동일해져, 데이터탭에서 세션이
 * 서로 구분되지 않는다(실기기 로그에서 3세션 전부 `2026-06-19`로 확인된 실제 버그).
 *
 * 해결: 세션 *생성 시점*(useVoiceSession.start)에 기존 세션 라벨과 충돌을 검사해, 충돌하면 겹치지 않는
 * 순번 접미(`-2`, `-3`, …)를 붙인다. 생성 시점에서 한 번만 적용하므로, 라벨 출처(설정탭 sessionAutoLabel /
 * 입력탭 buildAutoLabel)와 무관하게 일관되게 고유성이 보장된다 — 미리 저장된 sessionAutoLabel을 같은 날
 * N개 세션이 공유해도 각 start()마다 다음 빈 순번을 집어 고유해진다.
 *
 * 순번을 택한 이유(HH:MM 대신): 라벨이 한 줄로 짧게 유지되고, 같은 날 N번째 세션이라는 의미가 직관적이다.
 */

/**
 * `base` 라벨이 `existingLabels`에 이미 있으면 `-2`, `-3`, … 를 붙여 처음으로 충돌하지 않는 라벨을
 * 돌려준다. 충돌이 없으면 `base`를 그대로 돌려준다. 비교는 trim 후 정확 일치.
 */
export function ensureUniqueSessionLabel(base: string, existingLabels: Iterable<string | undefined>): string {
  const taken = new Set<string>();
  for (const l of existingLabels) {
    const t = (l ?? '').trim();
    if (t) taken.add(t);
  }
  const baseTrim = base.trim();
  if (!taken.has(baseTrim)) return baseTrim;
  for (let n = 2; ; n++) {
    const candidate = `${baseTrim}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}
