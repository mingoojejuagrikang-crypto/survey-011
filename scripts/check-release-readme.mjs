// 릴리스 일관성 가드: package.json 버전 ↔ README 버전 배지 ↔ 변경 내역 맨 위 항목.
//
// 배경: v0.10.0 배포 때 package.json 버전만 올리고 README의 "현재 버전" 배지와
// "## 변경 내역" 최신 항목을 빠뜨려, 레포 초기 페이지의 변경 내역이 v0.9.0에서
// 멈췄다. 같은 누락을 배포 시점에 자동으로 막는다.
//
// npm 의 predeploy 훅으로 묶여 `npm run deploy` 직전에 자동 실행된다(package.json).
// 셋이 모두 일치하지 않으면 exit 1 로 배포를 중단한다.
//
// 직접 실행: node scripts/check-release-readme.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SEMVER = '\\d+\\.\\d+\\.\\d+';

const pkgVersion = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
const readme = readFileSync(join(root, 'README.md'), 'utf8');

// (a) "현재 버전: vX.Y.Z" 배지
const badge = readme.match(new RegExp(`현재 버전:\\s*v(${SEMVER})`));
// (b) "## 변경 내역" 아래 맨 위 항목 "- **vX.Y.Z**"
const changelogIdx = readme.search(/##\s*변경 내역/);
const topEntry =
  changelogIdx >= 0
    ? readme.slice(changelogIdx).match(new RegExp(`-\\s*\\*\\*v(${SEMVER})\\*\\*`))
    : null;

const badgeVersion = badge?.[1] ?? null;
const topEntryVersion = topEntry?.[1] ?? null;

const problems = [];
if (badgeVersion === null) {
  problems.push('README에서 "현재 버전: vX.Y.Z" 배지를 찾지 못했습니다.');
} else if (badgeVersion !== pkgVersion) {
  problems.push(`README 버전 배지(v${badgeVersion})가 package.json(v${pkgVersion})과 다릅니다.`);
}
if (topEntryVersion === null) {
  problems.push('README "## 변경 내역" 아래에서 "- **vX.Y.Z**" 항목을 찾지 못했습니다.');
} else if (topEntryVersion !== pkgVersion) {
  problems.push(
    `README 변경 내역 맨 위 항목(v${topEntryVersion})이 package.json(v${pkgVersion})과 다릅니다.`,
  );
}

if (problems.length > 0) {
  console.error(`\n❌ 릴리스 일관성 검사 실패 (package.json = v${pkgVersion})`);
  for (const p of problems) console.error(`   - ${p}`);
  console.error(
    '\n   → README.md 의 "현재 버전" 배지와 "## 변경 내역" 맨 위에 v' +
      pkgVersion +
      ' 항목을 추가한 뒤 다시 배포하세요.\n',
  );
  process.exit(1);
}

console.log(`✅ 릴리스 일관성 OK — package.json·README 배지·변경 내역 모두 v${pkgVersion}`);
