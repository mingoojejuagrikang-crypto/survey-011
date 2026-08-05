import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * KNOWN-ISSUES [TYPO-CONTRACT-1]:
 * "계약이 지켜지는지 확인하는 테스트가 없다면 그 계약은 주석일 뿐이다."
 *
 * 이 검사기는 src/components/voice/ 이하의 인라인 fontSize 사용이
 * heroLayout.ts의 계약 상수를 참조하는지 정적으로 검증합니다.
 *
 * ESLint 규칙 대신 [node] 백그라운드 테스트로 작성된 이유:
 * eslint.config.js:5 에 명시된 "규칙은 max-lines 하나뿐인 최소 구성 ... 필요 이상 도입 금지"
 * (GL-006 헌장 §5, 민구 채택) 원칙을 준수하기 위함입니다.
 *
 * ALLOWLIST는 라인 번호가 아닌 "내용 기반"으로 관리되므로,
 * 추후 남아있는 상한(clamp) 부채가 제거되면 이 검사기가 자동으로 알리고
 * ALLOWLIST에서 해당 항목을 지워 부채 관리를 자동화합니다.
 */

const ALLOWLIST_ITEMS = [
  // 1. CompleteSummary:87 — 부채: 상한 26px 잔존 (규칙 2 위반, UI-g 이후 제거 대상)
  "'max(15px, calc(clamp(17px, min(5vw, 2.6vh), 26px) * var(--fit-lo, 1)))'",
  // (구 2. CompleteSummary:132 — v0.44.0 §C3에서 중앙 종료 버튼 자체가 삭제돼 부채도 소멸.
  //  상한 5건 부채 중 1건이 이렇게 닫혔다 — TODO.md 「상한 5건」 표 참조.)
  // 3. ReaskCue:39 — 부채: 상한 17px 잔존 (규칙 2 위반, UI-g 이후 제거 대상)
  "'calc(clamp(13px, min(4.2vw, 2.1vh), 17px) * var(--fit-lo, 1))'",
  // 4. ModifyIndicatorPill:57 — 부채: 상한 18px 잔존 (규칙 2 위반, UI-g 이후 제거 대상)
  "'max(12px, calc(clamp(14px, 2.1vh, 18px) * var(--fit-lo, 1)))'",
  // 5. ModifyIndicatorPill:88 — 부채: 상한 17px 잔존 (규칙 2 위반, UI-g 이후 제거 대상)
  "'max(12px, calc(clamp(14px, 2vh, 17px) * var(--fit-lo, 1)))'",
  // 6. ActiveControlBar — 영구 예외: calc(70cqh...)는 컨테이너 비례라 이미 상한이 없음.
  //    (v0.44.0 §C2 F02: 50→70% 상향. 비율 단정은 v039 UI-e1과 v0440-c2c3-buttons가 잰다.)
  'calc(70cqh + ',
] as const;

const VALID_CONTRACT_PREFIXES = [
  'HERO_TYPE.',
  'CHIP_TYPE.',
  'STATE_TYPE.',
  'VOICE_TYPE.',
] as const;

function getTsxFilesRecursive(dir: string): string[] {
  let results: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results = results.concat(getTsxFilesRecursive(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.tsx')) {
      results.push(fullPath);
    }
  }
  return results;
}

test('[node] 인라인 fontSize 계약 강제 검사기 (UI-g)', () => {
  const voiceDir = path.resolve(process.cwd(), 'src/components/voice');
  const tsxFiles = getTsxFilesRecursive(voiceDir);

  let contractCount = 0;
  let allowlistCount = 0;
  let commentCount = 0;
  let violationCount = 0;

  const violations: string[] = [];
  // 🔴 comment·allowlist도 **목록으로** 남긴다 — 숫자만 보면 분류가 조용히 바뀐 것을
  //    못 알아챈다. 실패했을 때 무엇이 어디로 갔는지 바로 보여야 한다. (독립 리뷰 C1)
  const comments: string[] = [];
  const allowlisted: string[] = [];

  for (const filePath of tsxFiles) {
    const relativePath = path.relative(process.cwd(), filePath);
    const fileContent = fs.readFileSync(filePath, 'utf-8');
    const lines = fileContent.split('\n');

    lines.forEach((line, index) => {
      if (!line.includes('fontSize')) {
        return;
      }

      // 1. 주석 처리 — 🔴 **줄 선두**로만 판정한다.
      //    종전엔 `line.indexOf('//') < indexOf('fontSize')`였는데, 그러면 줄 어디든 `//`가
      //    앞서기만 하면(예: URL `https://…`) **위반이 violation이 아니라 comment로 조용히
      //    집계**된다. 위반 목록도 안 찍히므로 "숫자만 갱신"하면 그대로 통과한다.
      //    (독립 리뷰 C1)
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) {
        commentCount++;
        comments.push(`${relativePath}:${index + 1} ${line.trim()}`);
        return;
      }

      // 2. ALLOWLIST 검사 — 줄 단위다.
      //    값 추출(`[^,}\n]+`)은 계약 문자열 내부의 콤마에서 끊기므로 allowlist는 줄로 본다.
      if (ALLOWLIST_ITEMS.some((allowItem) => line.includes(allowItem))) {
        allowlistCount++;
        allowlisted.push(`${relativePath}:${index + 1} ${line.trim()}`);
        return;
      }

      // 3. 🔴 한 줄에 `fontSize:`가 여러 개일 수 있으므로 **전부** 순회한다.
      //    종전엔 첫 매치만 봐서 두 번째 이후가 검사를 빠져나갔다. (독립 리뷰 M2)
      const matches = [...line.matchAll(/fontSize:\s*([^,}\n]+)/g)];
      if (matches.length === 0) {
        // `fontSize`는 있으나 `fontSize:` 형태가 아니다(예: 백틱 문자열 안의 언급).
        // 계약 대상이 아니므로 세지 않는다.
        return;
      }
      for (const m of matches) {
        const value = m[1];
        if (VALID_CONTRACT_PREFIXES.some((prefix) => value.includes(prefix))) {
          contractCount++;
        } else {
          violationCount++;
          violations.push(`${relativePath}:${index + 1} ${line.trim()}`);
        }
      }
    });
  }

  console.log(
    `[typo-contract-summary] contract=${contractCount} allowlist=${allowlistCount} ` +
      `comment=${commentCount} violation=${violationCount}`,
  );
  comments.forEach((c) => console.log(`  [comment]   ${c}`));
  allowlisted.forEach((a) => console.log(`  [allowlist] ${a}`));

  if (violations.length > 0) {
    console.error('🔴 [TYPO-CONTRACT-VIOLATIONS]:');
    violations.forEach((v) => console.error(`  - ${v}`));
  }

  // 🔴 리터럴 단언 (제품 상수를 import하지 마라 [TEAMOPS-38])
  //
  // ⚠️ 합계(total) 단언은 **두지 않는다.** 위 네 값의 산술 귀결이라 지워도 green인
  //    「압력 없는 오라클」이었다(독립 리뷰 C2). 재발 방지 검사기가 그런 단언을 들고
  //    나가는 모양이 나쁘다 — `UI-b` 리뷰가 지적한 것과 같은 계열이다.
  // v0.44.0 §C2·C3: ExitConfirmInline 3행(+2 계약) · CompleteSummary 중앙 버튼 삭제(allowlist −1).
  // v0.44.0 §D1: ActiveControlSteppers 말끊기 토글(BargeInToggle) 4건(+4 계약 — captionXs·
  // stepperValue·captionXxs·stepperValueLg 전부 VOICE_TYPE 참조, 위반 0 유지).
  // v0.44.1 [CLIP-INIT-SILENT-1]: MicReconnectBanner 부제 1건(+1 계약 — VOICE_TYPE.caption,
  // "값 입력은 계속 됩니다·앱 재시작" 안내줄. 위반 0 유지).
  // v0.46.0 WP-B(중앙 유동 크기): **정당 파손 — 방향이 계약 쪽이다. 위반은 0 그대로.**
  //   ① CompleteSummary 영수증이 인라인 리터럴 `max(15px, calc(clamp(17px,…,26px)*--fit-lo))`
  //      → `STATE_TYPE.completeReceipt` 참조로 **승격**(allowlist −1, 계약 +1).
  //   ② AlarmInterimStrip이 `STATE_TYPE.alarmInterim`을 새로 참조(계약 +1).
  //   ③ VoiceHero의 fontRenderProbe 유지 근거 주석 2줄(주석 +2 — 실렌더는 안쪽 span인데
  //      계측이 바깥 요소의 computed fontSize를 읽으므로 바깥 fontSize를 남긴다).
  // v0.46.0 WP-F: BlackoutOverlay 힌트 1건(+1 계약 — VOICE_TYPE.caption,
  //   "길게 눌러 화면 켜기 / 음성 입력은 계속됩니다". 위반 0 유지).
  expect(contractCount, '계약 참조 (통과)').toBe(59);
  expect(allowlistCount, 'ALLOWLIST (허용)').toBe(4);
  expect(commentCount, '주석 (skip)').toBe(3);
  expect(violationCount, '위반 (0건이어야 함)').toBe(0);
});
