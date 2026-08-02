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
  // 2. CompleteSummary:132 — 부채: 상한 30px 잔존 (규칙 2 위반, UI-g 이후 제거 대상)
  "'max(18px, calc(clamp(20px, min(6vw, 3.2vh), 30px) * var(--fit-lo, 1)))'",
  // 3. ReaskCue:39 — 부채: 상한 17px 잔존 (규칙 2 위반, UI-g 이후 제거 대상)
  "'calc(clamp(13px, min(4.2vw, 2.1vh), 17px) * var(--fit-lo, 1))'",
  // 4. ModifyIndicatorPill:57 — 부채: 상한 18px 잔존 (규칙 2 위반, UI-g 이후 제거 대상)
  "'max(12px, calc(clamp(14px, 2.1vh, 18px) * var(--fit-lo, 1)))'",
  // 5. ModifyIndicatorPill:88 — 부채: 상한 17px 잔존 (규칙 2 위반, UI-g 이후 제거 대상)
  "'max(12px, calc(clamp(14px, 2vh, 17px) * var(--fit-lo, 1)))'",
  // 6. ActiveControlBar:241 — 영구 예외: calc(50cqh...)는 컨테이너 비례라 이미 상한이 없음. v039 0.5 비율 단정 보존.
  'calc(50cqh + ',
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

  for (const filePath of tsxFiles) {
    const relativePath = path.relative(process.cwd(), filePath);
    const fileContent = fs.readFileSync(filePath, 'utf-8');
    const lines = fileContent.split('\n');

    lines.forEach((line, index) => {
      if (!line.includes('fontSize')) {
        return;
      }

      const fontSizeIdx = line.indexOf('fontSize');
      const commentIdx = line.indexOf('//');

      // 1. 주석 처리 (fontSize 앞부분에 //가 있음)
      if (commentIdx !== -1 && commentIdx < fontSizeIdx) {
        commentCount++;
        return;
      }

      // 2. ALLOWLIST 검사
      const isAllowlisted = ALLOWLIST_ITEMS.some((allowItem) => line.includes(allowItem));
      if (isAllowlisted) {
        allowlistCount++;
        return;
      }

      // 3. 계약 참조 검사 (fontSize: 뒤의 값에서만 계약 키 존재 여부를 확인)
      const m = /fontSize:\s*([^,}\n]+)/.exec(line);
      const fontSizeValue = m ? m[1] : '';
      const hasValidContract = VALID_CONTRACT_PREFIXES.some((prefix) => fontSizeValue.includes(prefix));
      if (hasValidContract) {
        contractCount++;
        return;
      }

      // 4. 위반 처리
      violationCount++;
      violations.push(`${relativePath}:${index + 1} ${line.trim()}`);
    });
  }

  const total = contractCount + allowlistCount + commentCount + violationCount;

  console.log(`[typo-contract-summary] contract=${contractCount} allowlist=${allowlistCount} comment=${commentCount} violation=${violationCount} total=${total}`);

  if (violations.length > 0) {
    console.error('🔴 [TYPO-CONTRACT-VIOLATIONS]:');
    violations.forEach((v) => console.error(`  - ${v}`));
  }

  // 🔴 리터럴 단언 (제품 상수를 import하지 마라 [TEAMOPS-38])
  expect(contractCount, '계약 참조 (통과)').toBe(49);
  expect(allowlistCount, 'ALLOWLIST (허용)').toBe(6);
  expect(commentCount, '주석 (skip)').toBe(1);
  expect(violationCount, '위반 (0건이어야 함)').toBe(0);
  expect(total, '전체 매칭 항목 합계').toBe(56);
});
