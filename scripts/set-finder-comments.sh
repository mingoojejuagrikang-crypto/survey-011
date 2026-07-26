#!/bin/bash
# macOS Finder 설명(코멘트) 설정 — 파인더에서 문서를 클릭하고 Cmd+I 를 누르면
# "설명" 칸에 이 문장이 보인다. Spotlight 검색에도 잡힌다.
#
# 왜 필요한가: 레포 루트에 마크다운이 9개라 파일명만으로는 무엇이 무엇인지 알기 어렵다.
# 특히 KNOWN-ISSUES / ENGINEERING-GUARDRAILS / KNOWN-ISSUES-ARCHIVE 셋은 이름이 비슷한데
# 역할이 완전히 다르다(현재 문제 / 지켜야 할 계약 / 종결된 역사).
#
# 실행:  bash scripts/set-finder-comments.sh
# 확인:  파인더에서 파일 선택 → Cmd+I → "설명" 칸
#
# 안전: 기존 코멘트를 덮어쓴다. 여러 번 돌려도 결과는 같다(멱등).
# 주의: Finder 코멘트는 파일의 확장 속성(xattr)에 저장되며 **git이 추적하지 않는다.**
#       다른 컴퓨터에서 클론하면 이 스크립트를 다시 돌려야 한다.
#       파일을 옮기거나 일부 도구로 덮어쓰면 코멘트가 사라질 수 있다.

set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"

# 파일:설명 — 문서가 늘어나면 여기만 고친다.
# 설명은 "이게 뭔지"와 "언제 여는지"를 한 문장으로. 파인더 설명 칸은 좁으니 짧게.
# bash 함정 3가지를 피해 쓴 함수다(볼트 스크립트에서 실제로 밟았다):
#  ① `local a="$1" b="$2"` 다중 선언 금지 — 변수명이 깨질 수 있다. 한 줄에 하나씩.
#  ② `POSIX file` 은 **절대 경로만** 해석한다. 상대 경로는 조용히 실패한다.
#  ③ `"$var개"` 처럼 변수 뒤에 한글이 붙으면 bash가 `var개`라는 변수명으로 읽는다 → `${var}개`.
set_comment() {
  local file="$1"
  local comment="$2"
  if [ ! -e "$ROOT/$file" ]; then
    echo "  건너뜀 (없음): $file"
    return
  fi
  if ! osascript - "$ROOT/$file" "$comment" <<'APPLESCRIPT' >/dev/null 2>&1
on run argv
  set p to item 1 of argv
  set c to item 2 of argv
  tell application "Finder" to set comment of (POSIX file p as alias) to c
end run
APPLESCRIPT
  then
    echo "  ⚠️ 실패: $file"
    return
  fi
  echo "  ✓ $file"
}

echo "Finder 설명 설정 중 — $ROOT"
echo

echo "[사용자용]"
set_comment "README.md" \
  "📱 앱 소개·설치·음성 명령·빠른 사용법. 여기서 시작하세요. 문서 지도도 여기 있습니다."
set_comment "CHANGELOG.md" \
  "📋 버전별 변경 이력 (v0.1.0~현재). 어떤 버전에서 무엇이 바뀌었는지 쉬운 말로."

echo
echo "[현재 계약 — 작업 전에 읽는 것]"
set_comment "AGENTS.md" \
  "🤖 AI·개발자 진입점. 지켜야 할 6항목 계약 + 코드 손대기 전 30초 체크. 작업을 시작할 때 가장 먼저."
set_comment "PRINCIPLES.md" \
  "⚖️ 앱 고유 설계 원칙 (우선순위 순). 판단이 갈릴 때의 기준이자, 외부 헌장이 없을 때의 최소 계약."
set_comment "CONTRIBUTING.md" \
  "🛠️ 개발·테스트·릴리스 절차. 명령어는 package.json scripts가 SSOT. GCP 설정도 여기."

echo
echo "[현재 문제 / 재발 방지 / 역사 — 이름이 비슷하니 주의]"
set_comment "KNOWN-ISSUES.md" \
  "🔴 지금 열려 있는 문제 + 실기기 판정 대기 항목. 1000줄이 넘으니 전체를 읽지 말고 관련 카테고리·ID만 검색하세요."
set_comment "ENGINEERING-GUARDRAILS.md" \
  "🛡️ 해결됐지만 다시 어기면 같은 방식으로 또 터지는 계약. 코드를 쓰기 '전에' 해당 절만 훑으세요."
set_comment "KNOWN-ISSUES-ARCHIVE.md" \
  "📦 종결된 사건 기록 (역사). 줄 번호·경로는 당시 기준이라 현재 코드 위치를 보장하지 않습니다."

echo
echo "[상세 문서]"
set_comment "docs" \
  "📁 상세 문서 — 문서 색인·코드 구조·실기기 검증 절차."
set_comment "docs/INDEX.md" \
  "🗺️ 문서 색인. 무엇을 찾는지에 따라 어느 문서를 열어야 하는지 4층으로 정리."
set_comment "docs/ARCHITECTURE.md" \
  "🏗️ 현재 코드 구조 — 화면·상태(VoicePhase)·lib 모듈 지도, 파일 크기 규약."
set_comment "docs/REAL-DEVICE-TEST.md" \
  "📲 실기기 검증 절차. iOS·STT·마이크 변경은 여기를 거치기 전엔 '해결'로 선언하지 않습니다."

echo
echo "[코드·설정]"
set_comment "src" \
  "📁 앱 소스 — components(표현) / screens(조립) / stores(상태) / lib(도메인 로직) / styles."
set_comment "tests" \
  "📁 Playwright 테스트 (러너는 이것 하나). 서버는 Playwright가 직접 띄웁니다(5177)."
set_comment "scripts" \
  "📁 릴리스·문서 가드 스크립트. npm run check:release / predeploy 가 여기를 호출합니다."
set_comment "package.json" \
  "📦 의존성 + 명령어 SSOT. 문서에 적힌 실행 방법은 전부 여기 scripts를 가리킵니다."
set_comment "playwright.config.ts" \
  "⚙️ 테스트 설정. webServer가 5177을 직접 소유 — 사람이 dev 서버를 미리 띄울 필요 없습니다."

echo
echo "완료. 파인더에서 파일 선택 → Cmd+I → '설명' 칸에서 확인하세요."
echo "※ 이 설명은 git이 추적하지 않습니다(확장 속성). 다른 컴퓨터에선 이 스크립트를 다시 돌리세요."
