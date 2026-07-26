// 문서 정합성 가드: 깨진 상대 링크 + 중복 이슈 ID.
//
// 배경(2026-07-26 문서 정리): 문서가 4층(현재 계약 / 현재 문제 / 재발 방지 / 역사)으로 나뉘면서
// 문서 간 상대 링크가 크게 늘었다. 링크가 조용히 깨지면 레포만 클론한 에이전트가 계약 문서에
// 도달하지 못한다. 또 서로 다른 두 문제가 같은 이슈 ID(`[CLIP-1]`)를 쓰고 있어 검색·자동 링크가
// 불가능했다 — 같은 일이 다시 벌어지는 것을 막는다.
//
// 직접 실행: node scripts/check-docs.mjs
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, relative } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** 검사 대상: 레포 루트의 .md + docs/ 의 .md (node_modules·dist 등은 제외). */
function collectDocs() {
  const out = [];
  for (const f of readdirSync(root)) {
    if (f.endsWith('.md') && statSync(join(root, f)).isFile()) out.push(join(root, f));
  }
  const docsDir = join(root, 'docs');
  if (existsSync(docsDir)) {
    for (const f of readdirSync(docsDir)) {
      if (f.endsWith('.md')) out.push(join(docsDir, f));
    }
  }
  return out.sort();
}

const problems = [];

// ── (1) 깨진 상대 링크 ────────────────────────────────────────────────
//
// ⚠️ 이 레포의 이슈 문서는 `[STT-12](OpenDots 소음 성능)` 처럼 **ID + 괄호 설명**을 즐겨 쓴다.
// 문법만 보면 markdown 링크와 같으므로, "파일 경로처럼 생긴 대상"만 검사한다:
//   - 슬래시를 포함하거나 (./docs/INDEX.md, src/lib/db.ts)
//   - 알려진 확장자로 끝나거나 (KNOWN-ISSUES.md)
// 나머지(공백 포함 산문, 한글 설명)는 링크가 아니므로 건너뛴다.
const LINK = /\[[^\]]*\]\(([^)]+)\)/g;
const FILE_EXT = /\.(md|ts|tsx|js|mjs|json|css|html|sh|yml|yaml)$/i;
const looksLikePath = (t) => t.includes('/') || FILE_EXT.test(t);

const docs = collectDocs();
for (const file of docs) {
  const text = readFileSync(file, 'utf8');
  const dir = dirname(file);
  for (const m of text.matchAll(LINK)) {
    const raw = m[1].trim();
    if (!raw || /^(https?:|mailto:|#)/.test(raw)) continue;
    const target = raw.split('#')[0];
    if (!target || !looksLikePath(target)) continue;
    if (!existsSync(resolve(dir, target))) {
      const line = text.slice(0, m.index).split('\n').length;
      problems.push(`${relative(root, file)}:${line} 깨진 링크 → ${raw}`);
    }
  }
}

// ── (2) 중복 이슈 ID ──────────────────────────────────────────────────
//
// 같은 ID가 서로 다른 두 **문제**를 가리키면 검색·자동 링크가 불가능해진다(구 [CLIP-1] 2건).
//
// 단, 항목을 다른 문서로 옮기고 원위치에 남긴 **전방 링크 스텁**은 중복이 아니다 — 같은 문제를
// 가리키는 포인터다. 스텁은 제목에 `→ **…로 이동**`을 달아 구분한다. 스텁이 아닌 정의가 2곳
// 이상이면 실패한다.
const ISSUE_FILES = ['KNOWN-ISSUES.md', 'KNOWN-ISSUES-ARCHIVE.md', 'ENGINEERING-GUARDRAILS.md'];
const HEADING = /^###\s*\[([^\]]+)\](.*)$/gm;
const IS_STUB = /→\s*\*\*[^*]*이동\*\*/;

const defs = new Map(); // id → [{where}]  (스텁 제외한 실제 정의)
let stubCount = 0;
for (const name of ISSUE_FILES) {
  const path = join(root, name);
  if (!existsSync(path)) continue;
  const text = readFileSync(path, 'utf8');
  for (const m of text.matchAll(HEADING)) {
    const [, id, title] = m;
    if (IS_STUB.test(title)) {
      stubCount++;
      continue;
    }
    const line = text.slice(0, m.index).split('\n').length;
    if (!defs.has(id)) defs.set(id, []);
    defs.get(id).push(`${name}:${line}`);
  }
}
for (const [id, places] of defs) {
  if (places.length > 1) {
    problems.push(
      `중복 이슈 ID [${id}] — ${places.join(', ')}\n` +
        `      → 고유 ID로 나누고 옛 ID는 "- **aliases:** \`${id}\`" 로 남기세요.`,
    );
  }
}

if (problems.length > 0) {
  console.error(`\n❌ 문서 정합성 검사 실패 (${problems.length}건)`);
  for (const p of problems) console.error(`   - ${p}`);
  console.error('');
  process.exit(1);
}

console.log(
  `✅ 문서 정합성 OK — 문서 ${docs.length}개의 상대 링크 유효, ` +
    `이슈 정의 ${defs.size}개 모두 고유(이관 스텁 ${stubCount}건 제외)`,
);
