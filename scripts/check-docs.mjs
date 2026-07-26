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

const defs = new Map(); // id → [where]  (스텁 제외한 실제 정의)
const aliases = new Set(); // 고유화 이전 ID — 참조로는 쓰지 않지만 존재는 인정
const subDefs = new Set(); // 상위 항목 본문 안의 굵은 글씨 하위 정의
const ALIAS_LINE = /^-\s*\*\*aliases:\*\*\s*(.+)$/gm;
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
  for (const m of text.matchAll(ALIAS_LINE)) {
    for (const a of m[1].matchAll(/`([A-Z][A-Z0-9-]*-\d+)`/g)) aliases.add(a[1]);
  }
  // 굵은 글씨 하위 정의 — `- **[CLIP-BLANK-1] …:**` 처럼 상위 항목 본문 안에서 정의되는
  // 파생 이슈. 헤딩은 아니지만 엄연한 정의이므로 참조 대상으로 인정한다.
  for (const m of text.matchAll(/^-\s*\*\*\[([A-Z][A-Z0-9-]*-\d+)\]/gm)) subDefs.add(m[1]);
}
for (const [id, places] of defs) {
  if (places.length > 1) {
    problems.push(
      `중복 이슈 ID [${id}] — ${places.join(', ')}\n` +
        `      → 고유 ID로 나누고 옛 ID는 "- **aliases:** \`${id}\`" 로 남기세요.`,
    );
  }
}

// ── (3) 정의되지 않은 이슈 ID 참조 ────────────────────────────────────
//
// ID 이름을 바꾸면 **들어오는 참조**가 조용히 매달린다. 2026-07-26 고유화에서 실제로 그랬다 —
// 헤딩은 CLIP-POINTER-1인데 소스 주석·다른 항목 본문은 여전히 [CLIP-3]을 가리켰고, 그 ID는
// 이제 아카이브의 **다른 문제**(CLIP-EPOCH-1)를 뜻했다. 헤딩만 검사하면 이걸 못 잡는다.
//
// 산문 속 `[ID]` 참조가 정의된 헤딩(aliases·하위 정의 포함)으로 해석되는지 확인한다.
// 대상: 이슈 문서 3종 + src/ 의 주석. 형태는 대문자-하이픈-숫자(예: STT-14, CLIP-POINTER-1).
//
// **네임스페이스 스코프:** 이 레포에 정의가 하나도 없는 네임스페이스는 검사하지 않는다.
// 이 레포의 이슈가 아닌 것들이 같은 형태를 공유하기 때문이다 —
//   - `ORCH-27`·`GL-004`·`SOP-004` : myPKA 볼트의 팀 지식 네임스페이스(레포 밖, external/private)
//   - `MEDIUM-4` : 조상 레포 growth-survey-010 리뷰의 심각도 라벨
// 즉 `[STT-99]`(STT는 정의된 네임스페이스)는 잡히지만 `[FOO-1]`은 잡히지 않는다.
//
// ⚠️ 네임스페이스는 **첫 마디**다(`CLIP-POINTER-1` → `CLIP`). 처음엔 뒤의 `-숫자`만 떼서
// `CLIP-POINTER`를 네임스페이스로 삼았는데, 그러면 **ID를 개명하는 순간 그 네임스페이스가 함께
// 사라져** 매달린 참조가 "레포 밖"으로 오분류된다 — 이 검사가 잡으려던 바로 그 경우를 스코프가
// 삼킨다. 반증(헤딩만 개명하고 참조는 그대로 두기)에서 실패해야 할 것이 통과해 드러났다.
// 백틱으로 감싼 `[ID]` 는 **논의 대상 문자열**이지 살아있는 상호참조가 아니다(제거된 옛 ID를
// 문서에서 설명할 때 쓴다). aliases 줄이 이미 그 표기를 쓰므로 같은 규칙을 적용한다.
const REF = /(.?)\[([A-Z][A-Z0-9-]*-\d+)\](.?)/g;
const known = new Set([...defs.keys(), ...aliases, ...subDefs]);
const ns = (id) => id.split('-')[0];
const knownNamespaces = new Set([...known].map(ns));

function srcFiles(dir) {
  const out = [];
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) out.push(...srcFiles(p));
    else if (/\.(ts|tsx)$/.test(f)) out.push(p);
  }
  return out;
}

const refTargets = [
  ...ISSUE_FILES.map((n) => join(root, n)).filter(existsSync),
  ...(existsSync(join(root, 'src')) ? srcFiles(join(root, 'src')) : []),
];
const dangling = new Map(); // id → [where]
for (const file of refTargets) {
  const text = readFileSync(file, 'utf8');
  for (const m of text.matchAll(REF)) {
    const [, before, id, after] = m;
    if (before === '`' && after === '`') continue; // 인용된 문자열(설명 대상)
    if (known.has(id)) continue;
    if (!knownNamespaces.has(ns(id))) continue; // 레포 밖 네임스페이스
    const line = text.slice(0, m.index).split('\n').length;
    if (!dangling.has(id)) dangling.set(id, []);
    dangling.get(id).push(`${relative(root, file)}:${line}`);
  }
}
for (const [id, places] of dangling) {
  problems.push(
    `정의 없는 이슈 ID 참조 [${id}] — ${places.slice(0, 6).join(', ')}` +
      (places.length > 6 ? ` 외 ${places.length - 6}곳` : '') +
      `\n      → 현재 ID로 고치거나, 그 ID를 쓰는 항목에 "- **aliases:** \`${id}\`" 를 추가하세요.`,
  );
}

if (problems.length > 0) {
  console.error(`\n❌ 문서 정합성 검사 실패 (${problems.length}건)`);
  for (const p of problems) console.error(`   - ${p}`);
  console.error('');
  process.exit(1);
}

console.log(
  `✅ 문서 정합성 OK — 문서 ${docs.length}개의 상대 링크 유효, ` +
    `이슈 정의 ${defs.size}개 모두 고유(이관 스텁 ${stubCount}건 제외), ` +
    `참조는 전부 정의/별칭(${aliases.size}건)으로 해석됨`,
);
