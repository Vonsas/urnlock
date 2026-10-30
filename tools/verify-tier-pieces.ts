// 티어 조각 검증 — 조각 합이 API 에 기간을 직접 물은 값과 맞는지 (2026-10-29).
//   pnpm exec tsx tools/verify-tier-pieces.ts
// 1. 휘장 묶음(bucket=avg_badge)으로 받은 단계 값 = 단계 범위를 직접 물은 값 (같은 순간, 정확히 같아야 함)
// 2. 최근 14일 전령사+ 조각 합 vs 직접 (전체 판수 — 조각을 받은 뒤 늦게 들어온 경기만큼 조각이 조금 적을 수 있음)
// 3. 숙련자: 조각 2개(이틀) 합 vs 이틀을 직접 물은 값 (사람 적은 단계 10 — 직접 요청이 시간 안에 끝나게)
import { API_BASE } from '../src/data/api/fetch';
import { EXPERIENCED_GAMES, coveringPieces, patchStarts, pieceGrid, readArchive, tierRanges } from '../src/data/api/tier-pieces';

const archive = await readArchive();
if (!archive) throw new Error('보관 파일 없음');
const starts = await patchStarts();
const url = (q: Record<string, string | number>) => `${API_BASE}/v1/analytics/hero-stats?${new URLSearchParams(Object.fromEntries(Object.entries({ game_mode: 'normal', ...q }).map(([k, v]) => [k, String(v)])))}`;
const get = async (q: Record<string, string | number>) => {
  const res = await fetch(url(q), { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url(q)}`);
  return (await res.json()) as Array<{ hero_id: number; bucket?: number; matches: number; wins: number }>;
};
const total = (rows: Array<{ matches: number }>) => rows.reduce((n, r) => n + r.matches, 0);
const pct = (a: number, b: number) => `${(((a - b) / b) * 100).toFixed(3)}%`;

// 1. 같은 조각 범위를 묶음 vs 단계 범위로 — 가장 최근에 끝난 하루 조각
const grid = pieceGrid(starts, archive.end);
const [from, to] = grid[grid.length - 2];
const bucket = await get({ min_unix_timestamp: from, max_unix_timestamp: to, bucket: 'avg_badge' });
for (const n of [3, 9]) {
  const viaBucket = bucket.filter((r) => Math.floor((r.bucket ?? 0) / 10) === n);
  const direct = await get({ min_unix_timestamp: from, max_unix_timestamp: to, min_average_badge: n * 10 + 1, max_average_badge: n * 10 + 6 });
  console.log(`1. 단계 ${n} 묶음 ${total(viaBucket)} / 직접 ${total(direct)} → ${pct(total(viaBucket), total(direct))}`);
}

// 2. 최근 14일 전령사+ — 조각 합 vs 직접
const r = tierRanges(starts, archive.end);
const cover = coveringPieces(archive.pieces, r['14d'].from, r['14d'].to);
if (!cover) console.log('2. 14일 조각이 모자람');
else {
  const summed = cover.reduce((n, p) => n + [7, 8, 9, 10, 11].reduce((m, s) => m + (p.steps[s]?.a.reduce((k, row) => k + row[1], 0) ?? 0), 0), 0);
  const direct = await get({ min_unix_timestamp: r['14d'].from, max_unix_timestamp: r['14d'].to, min_average_badge: 71, max_average_badge: 116 });
  console.log(`2. 14일 전령사+ 조각 합 ${summed} / 직접 ${total(direct)} → ${pct(summed, total(direct))}`);
}

// 3. 숙련자 — 끝난 하루 조각 2개(단계 10) 합 vs 이틀 직접
const days = grid.filter(([a, b]) => b - a === 86_400).slice(-3, -1);
const pieces = days.map(([a, b]) => archive.pieces.find((p) => p.from === a && p.to === b));
if (pieces.some((p) => !p?.steps[10])) console.log('3. 단계 10 조각이 모자람');
else {
  const summed = pieces.reduce((n, p) => n + p!.steps[10].e.reduce((k, row) => k + row[1], 0), 0);
  const direct = await get({ min_unix_timestamp: days[0][0], max_unix_timestamp: days[1][1], min_average_badge: 101, max_average_badge: 106, min_hero_matches_total: EXPERIENCED_GAMES });
  console.log(`3. 단계 10 숙련자 이틀 조각 합 ${summed} / 직접 ${total(direct)} → ${pct(summed, total(direct))}`);
}
