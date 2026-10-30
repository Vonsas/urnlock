#!/usr/bin/env bash
# Vercel 'Ignored Build Step' (vercel.json ignoreCommand) — 문서만 바뀐 커밋은 빌드하지 않는다 (2026-10-29).
# Vercel 무료 요금제는 빌드를 한 번에 하나만 돌려서, 문서 PR 도 7분짜리 전체 빌드로 다른 배포를 막았다.
#   exit 0 = 건너뜀(배포는 '취소됨'으로 남고 사이트는 그대로), exit 1 = 빌드
# 비교 기준은 이 브랜치에서 마지막으로 성공한 배포의 커밋(VERCEL_GIT_PREVIOUS_SHA) — 그 사이 바뀐 파일이 모두 문서면 건너뛴다.
# 애매하면 언제나 빌드한다: 이전 배포가 없음 · 같은 커밋을 다시 배포(Deploy Hook · 수동 재배포) · 비교 커밋을 못 찾음.
# Deploy Hook 인지 알려 주는 값은 없어서, 문서 커밋이 main 맨 위에 있을 때 Hook 으로 다시 돌리면 건너뛸 수 있다 —
# 6시간 갱신은 조각 파일(src/data/tier-archive.json) 커밋으로 배포되므로 Hook 은 그 보관이 실패했을 때의 예비일 뿐이다.
set -u

prev="${VERCEL_GIT_PREVIOUS_SHA:-}"
cur="${VERCEL_GIT_COMMIT_SHA:-$(git rev-parse HEAD)}"

if [ -z "$prev" ] || [ "$prev" = "$cur" ]; then
  echo "빌드: 이 브랜치의 이전 배포가 없거나 같은 커밋을 다시 배포"
  exit 1
fi

# Vercel 은 최근 커밋 10개만 받아 둔다 — 비교할 커밋이 없으면 가져오고, 그래도 없으면 빌드
if ! git cat-file -e "${prev}^{commit}" 2>/dev/null; then
  git fetch --quiet --depth=200 origin "$prev" 2>/dev/null || true
fi
if ! changed="$(git diff --name-only "$prev" "$cur" 2>/dev/null)"; then
  echo "빌드: 이전 배포 커밋(${prev:0:7})과 비교하지 못함"
  exit 1
fi

# 문서 = docs/ · 모든 .md · 에이전트 설정(.claude/) · GitHub 워크플로(.github/) — 사이트 빌드 결과에 들어가지 않는 것
code="$(printf '%s\n' "$changed" | grep -vE '^(docs/|\.claude/|\.github/)|\.md$' | grep -v '^$' || true)"
if [ -z "$code" ]; then
  echo "건너뜀: ${prev:0:7}..${cur:0:7} 사이에 문서만 바뀜"
  printf '%s\n' "$changed" | sed 's/^/  /'
  exit 0
fi
echo "빌드: ${prev:0:7}..${cur:0:7} 사이에 바뀐 코드"
printf '%s\n' "$code" | head -20 | sed 's/^/  /'
exit 1
