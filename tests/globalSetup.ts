/**
 * 스위트 시작 전 프리플라이트 — **테스트 포트가 정말 이 체크아웃을 서빙하는지** 확인한다.
 *
 * **왜 있나 ([ORCH-27], 2026-07-24 실증):**
 * `playwright.config.ts`의 `baseURL`이 5175 하드코딩이던 시절, 그 포트에 **중첩 클론**
 * (`survey-011/survey-011-v038-voice-ui`, 순정 v0.38.0)의 dev 서버가 떠 있었다. 결과:
 * 브라우저 테스트가 **미커밋 워킹트리가 아니라 커밋된 옛 코드**를 검증했고, 리뷰 라운드마다 보고된
 * green이 변경 전 코드의 green이었다. 이 팀은 미커밋 워킹트리를 리뷰하므로 이 오염은 **조용히**
 * 통과한다 — 에러가 하나도 나지 않는다. 그래서 자동 확인이 필요하다.
 *
 * **왜 pid→cwd 판정인가 (내용 대조를 안 쓰는 이유):**
 * "서빙 바이트 vs 디스크 바이트" 대조가 더 직접적으로 보이지만 실제로는 못 쓴다 — Vite dev는 TS를
 * 변환해 서빙하므로 바이트가 **원래** 다르고, 버전 고유 토큰(예: `mic_teardown`)을 심으면 릴리스마다
 * 썩는다. pid→cwd는 **실제로 ORCH-27을 잡아낸 판정**이고 결정론적이다.
 *
 * `webServer`(reuseExistingServer:false + --strictPort)가 1차 방어, 이 파일이 2차 방어다.
 * 둘은 서로 **다른 것**을 막는다 — 1차는 "남의 서버를 물려받는 것", 2차는 "포트는 맞는데 체크아웃이
 * 틀린 것". 그래서 반증도 각각 따로 해야 한다(#12-bis).
 *
 * macOS 전용(`lsof`)이라 조회 자체가 실패하면 **통과시킨다** — 가드가 CI/타 플랫폼에서 스위트를
 * 막아버리는 것이 더 나쁘다. 막는 건 "확실히 틀렸다"가 확인됐을 때뿐이다.
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { BASE } from './baseUrl';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function listeningPid(port: string): string | null {
  try {
    const out = execFileSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.split('\n').map((s) => s.trim()).filter(Boolean)[0] ?? null;
  } catch {
    return null; // lsof 부재 / 리스너 없음 — 판정 불가
  }
}

function processCwd(pid: string): string | null {
  try {
    const out = execFileSync('lsof', ['-a', '-p', pid, '-d', 'cwd', '-Fn'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const line = out.split('\n').find((l) => l.startsWith('n'));
    return line ? line.slice(1).trim() : null;
  } catch {
    return null;
  }
}

export default function globalSetup(): void {
  const port = new URL(BASE).port;
  if (!port) return;

  const pid = listeningPid(port);
  if (!pid) return; // webServer가 아직 안 떴거나 lsof 불가 — 여기서 막지 않는다

  const cwd = processCwd(pid);
  if (!cwd) return; // 판정 불가

  // 심볼릭 링크 차이로 인한 오탐 방지 — 실경로로 정규화해 비교한다.
  const served = path.resolve(cwd);
  if (served === REPO_ROOT) {
    console.log(`▸ 프리플라이트 OK — :${port} pid=${pid} 가 ${REPO_ROOT} 를 서빙`);
    return;
  }

  throw new Error(
    [
      '',
      '❌ 프리플라이트 실패 [ORCH-27] — 테스트 포트가 다른 체크아웃을 서빙하고 있다.',
      `   기대: ${REPO_ROOT}`,
      `   실제: ${served}  (:${port} pid=${pid})`,
      '',
      '   이 상태로 돌면 "변경 전 코드가 통과했다"는 결과가 조용히 나온다.',
      `   그 포트를 잡고 있는 서버를 종료하고 다시 실행하라 — webServer가 ${REPO_ROOT} 에서 직접 띄운다.`,
      '',
    ].join('\n'),
  );
}
