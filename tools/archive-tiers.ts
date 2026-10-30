// 티어 조각 보관 — 랭크 단계별 전체 · 숙련자 수치를 하루(+ 패치 경계) 조각으로 받아 src/data/tier-archive.json 에 쌓는다
// (2026-10-29, 설명은 src/data/api/tier-pieces.ts 머리 · docs/deploy-failures.md).
//   pnpm exec tsx tools/archive-tiers.ts [--budget 분]   → 바뀌었으면 'changed' 를 출력
// 6시간마다 GitHub Actions(.github/workflows/daily-rebuild.yml)가 돌려 커밋 · 푸시한다 (Vercel 이 그 푸시로 다시 배포).
// 새 조각 → 다시 받을 때가 된 조각 순으로 받고, --budget(기본 25분)을 넘기면 멈춘다 — 남은 건 다음 실행에서.
// 504 가 난 칸은 반으로 나눠 다시 묻고(fetchExp), 그래도 못 받으면 예전 값을 그대로 두고 다음 실행에서 다시.
import { readFileSync, writeFileSync } from 'node:fs';
import {
  ARCHIVE_FILE,
  EXPERIENCED_GAMES,
  PIECE_STEPS,
  type TierPiece,
  fetchPiece,
  floorHour,
  patchStarts,
  pieceGrid,
  readArchive,
  refreshDue,
  serializeArchive,
} from '../src/data/api/tier-pieces';

const budgetIdx = process.argv.indexOf('--budget');
const budgetMs = (budgetIdx > 0 ? Number(process.argv[budgetIdx + 1]) : 25) * 60_000;
const startedAt = Date.now();

const now = Math.floor(Date.now() / 1000);
const end = floorHour(now);
const starts = await patchStarts();
if (starts.length < 2) {
  console.error('패치 목록을 받지 못해 조각 경계를 정할 수 없음');
  process.exit(1);
}

const old = await readArchive();
const grid = pieceGrid(starts, end);
// 경계가 같은 조각은 그대로 쓰고, 새 경계(오늘 조각의 끝 · 새 패치)는 빈 조각으로 시작
const pieces: TierPiece[] = grid.map(([from, to]) => old?.pieces.find((p) => p.from === from && p.to === to) ?? { from, to, steps: {} });

let before = '';
try {
  before = readFileSync(ARCHIVE_FILE, 'utf8');
} catch {}
/** 조각마다 저장 — 도중에 멈춰도(시간 초과 · 취소) 받은 만큼은 남게 */
const save = (archiveEnd: number) => {
  const out = serializeArchive({ version: 1, exp: EXPERIENCED_GAMES, end: archiveEnd, pieces });
  writeFileSync(ARCHIVE_FILE, out);
  return out;
};

let fetched = 0;
let failed = 0;
let stoppedEarly = false;
// 새 조각(최근)부터 — 오늘 조각이 빠지면 빌드가 직접 받아야 한다
for (const piece of [...pieces].sort((a, b) => b.to - a.to)) {
  const due = PIECE_STEPS.filter((n) => refreshDue(piece, piece.steps[n], now));
  if (!due.length) continue;
  if (Date.now() - startedAt > budgetMs) {
    stoppedEarly = true;
    break;
  }
  const got = await fetchPiece(piece.from, piece.to, due, (msg) => {
    failed++;
    console.warn(`[dldb:api] ${msg}`);
  });
  Object.assign(piece.steps, got);
  fetched += Object.keys(got).length;
  save(end);
}

const missing = pieces.reduce((n, p) => n + PIECE_STEPS.filter((s) => !p.steps[s]).length, 0);
const out = save(end);
const summary = `조각 ${pieces.length}개 · 받은 칸 ${fetched} · 실패 ${failed} · 빈 칸 ${missing}${stoppedEarly ? ' · 시간이 다 돼 멈춤' : ''} · ${(out.length / 1024).toFixed(0)}KB`;
console.log(`${out !== before ? 'changed' : 'no change'}: ${summary}`);
