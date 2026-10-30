/**
 * 티어 데이터 자동 검사 (2026-10-05) — '티어는 오류가 있으면 안 된다' 를 사람이 매번 대조하지 않아도 되게.
 * 빌드 때 /health.json 을 만들며 돌리고, 문제(problems)가 있으면 Vercel 빌드에서는 빌드를 멈춘다
 * → 배포가 실패하면 Vercel 은 직전 배포를 그대로 두므로, 틀린 티어 대신 어제 티어가 보인다.
 * 로컬 빌드·개발 서버에서는 경고만 남긴다.
 *
 * 검사:
 *  1. 꼭 있어야 하는 보드 — 티어 화면(최근 2주·상위권, 현재 패치·상위권 · 최근 2주·하위권), 승률표(현재 패치·랭크 전체 · 현재 패치·일반)
 *  2. 영웅 수 — 출시 영웅의 90% 이상이 최근 2주 상위권에 있어야 (막 나온 영웅은 비어 있을 수 있어 여유를 둔다)
 *  3. 숫자 앞뒤 — 승수 ≤ 판수, 숙련자 판수 ≤ 전체 판수(요청 사이 시차로 1% 여유), 승률이 NaN 이 아님
 *  4. 승률 범위 — 5,000판 이상인 영웅의 승률이 30–70% 안 (밖이면 데이터가 깨진 것). 막 나온 영웅은 정말로 30% 아래일 수 있어
 *     (2026-10-14 데드맨 대니 1,800판 29.1% — 1,000판 기준이던 때 이것 때문에 하루 동안 배포가 모두 멈췄다)
 *  5. 판수 — 최근 2주 상위권 매치가 1만 판 이상, 그리고 직전 배포(/health.json)의 40% 이상 (갑자기 줄면 API 이상)
 *  6. 직접 대조 — 단계 7–11 을 더한 값과 '전령사+' 범위를 한 번에 물은 값이 같은지.
 *     2026-10-01 에 손으로 했던 대조를 매 빌드 자동으로. 끝 시각이 정해진 '이전 패치' 기간으로 한다 — 최근 2주는 끝이 열려 있어
 *     요청 사이에 매치가 늘어 (특히 막 나온 영웅) 단계 합과 직접 값이 어긋난다 (랫 킹 3%).
 *     2026-10-29 부터 단계 값은 쌓아 둔 조각의 합(tier-pieces.ts)이라, 받은 뒤 늦게 들어온 경기만큼 직접 값보다 조금 **적을 수** 있다.
 *     그래서 많으면(조각이 겹침) 엄격하게 — 전체 0.5% · 영웅별 2%, 적으면(조각이 빔) 넉넉하게 — 전체 5% · 영웅별 10%.
 */
import type { TierData } from '../types';
import { API_BASE, load, warn } from './fetch';

/** 승률 범위 검사를 할 최소 판수 — 막 나온 영웅을 '데이터 깨짐' 으로 보지 않게 */
const RANGE_MIN_MATCHES = 5000;

export interface TierCheckResult {
  problems: string[];
  notes: string[];
  summary: {
    upper14dMatches: number;
    upper14dHeroes: number;
    tierCounts: Record<string, number>;
    /** 직접 대조 — 영웅별 판수 차이 중 가장 큰 비율 (%) */
    crossCheckMaxDiff?: number;
  };
}

const pct = (a: number, b: number) => (b ? (Math.abs(a - b) / b) * 100 : a ? 100 : 0);

export async function checkTierData(data: TierData | null, activeHeroIds: number[], previous?: { upper14dMatches?: number }): Promise<TierCheckResult> {
  const problems: string[] = [];
  const notes: string[] = [];
  const empty = { upper14dMatches: 0, upper14dHeroes: 0, tierCounts: {} };
  if (!data) return { problems: ['티어 데이터를 받지 못함 (API 실패)'], notes, summary: empty };

  // 1. 꼭 있어야 하는 보드
  const board = (window: string, rank: string) => data.boards.find((b) => b.window === window && b.rank === rank);
  for (const [w, r] of [
    ['14d', 'upper'],
    ['patch', 'upper'],
    ['14d', 'lower'],
    ['patch', 'ranked'],
    ['patch', 'normal'],
  ] as const) {
    if (!board(w, r)) problems.push(`보드 없음: ${w}/${r}`);
  }
  for (const b of data.boards.filter((b) => b.rank === 'ranked' || b.rank === 'normal' || b.rank === 'upper' || b.rank === 'lower')) {
    // 3. 숫자 앞뒤
    for (const h of b.heroes) {
      if (![h.winRate, h.expWinRate, h.novWinRate, h.pickRate].every(Number.isFinite)) problems.push(`${b.window}/${b.rank} 영웅 ${h.heroId}: 승률이 숫자가 아님`);
      if (h.expMatches > h.matches * 1.01 + 5) problems.push(`${b.window}/${b.rank} 영웅 ${h.heroId}: 숙련자 판수(${h.expMatches}) > 전체 판수(${h.matches})`);
      if (h.winRate > 100 || h.winRate < 0) problems.push(`${b.window}/${b.rank} 영웅 ${h.heroId}: 승률 ${h.winRate}`);
      // 4. 승률 범위
      if (h.matches >= RANGE_MIN_MATCHES && (h.winRate < 30 || h.winRate > 70)) problems.push(`${b.window}/${b.rank} 영웅 ${h.heroId}: 승률 ${h.winRate.toFixed(1)}% (${h.matches}판) — 30–70% 밖`);
    }
  }

  const upper = board('14d', 'upper');
  const tierCounts: Record<string, number> = {};
  for (const h of upper?.heroes ?? []) tierCounts[h.tier ?? '-'] = (tierCounts[h.tier ?? '-'] ?? 0) + 1;
  const summary: TierCheckResult['summary'] = { upper14dMatches: Math.round(upper?.totalMatches ?? 0), upper14dHeroes: upper?.heroes.length ?? 0, tierCounts };

  if (upper) {
    // 2. 영웅 수
    const present = new Set(upper.heroes.map((h) => h.heroId));
    const missing = activeHeroIds.filter((id) => !present.has(id));
    if (activeHeroIds.length && present.size < activeHeroIds.length * 0.9) problems.push(`최근 2주 상위권에 영웅 ${present.size}/${activeHeroIds.length}명뿐`);
    else if (missing.length) notes.push(`최근 2주 상위권에 없는 영웅: ${missing.join(', ')} (막 나온 영웅이면 정상)`);
    if (!upper.heroes.some((h) => h.tier)) problems.push('최근 2주 상위권에 티어가 매겨진 영웅이 없음');

    // 5. 판수
    if (upper.totalMatches < 10_000) problems.push(`최근 2주 상위권 매치 ${Math.round(upper.totalMatches)}판 — 1만 판 미만`);
    if (previous?.upper14dMatches && upper.totalMatches < previous.upper14dMatches * 0.4)
      problems.push(`최근 2주 상위권 매치가 직전 배포의 ${Math.round((upper.totalMatches / previous.upper14dMatches) * 100)}% 로 급감 (${previous.upper14dMatches} → ${Math.round(upper.totalMatches)})`);

    // 6. 직접 대조 — 단계 합 vs 범위 한 번에
    const wPrev = data.windows.find((w) => w.key === 'prev');
    const stepRows = data.steps.filter((s) => s.window === 'prev' && s.step >= 7);
    if (wPrev?.to && stepRows.length === 5) {
      const summed = new Map<number, number>();
      for (const s of stepRows) for (const [id, m] of s.heroes) summed.set(id, (summed.get(id) ?? 0) + m);
      const q = new URLSearchParams({ game_mode: 'normal', min_unix_timestamp: String(wPrev.from), max_unix_timestamp: String(wPrev.to), min_average_badge: '71', max_average_badge: '116' });
      const direct = await load(`tiercheck-prev-upper-${wPrev.from}-${wPrev.to}`, `${API_BASE}/v1/analytics/hero-stats?${q}`, (json) =>
        (json as Array<{ hero_id: number; matches: number }>).map(({ hero_id, matches }) => ({ hero_id, matches })),
      );
      if (!direct) notes.push('직접 대조 요청 실패 — 대조 생략');
      else {
        // 많으면 겹침(엄격), 적으면 늦게 들어온 경기 또는 빈 조각(넉넉) — 위 머리 주석 6
        let maxDiff = 0;
        for (const d of direct) {
          if (d.matches < 300) continue;
          const s = summed.get(d.hero_id) ?? 0;
          const diff = pct(s, d.matches);
          maxDiff = Math.max(maxDiff, diff);
          if (s > d.matches ? diff > 2 : diff > 10) problems.push(`직접 대조: 영웅 ${d.hero_id} 단계 합 ${s} / 직접 ${d.matches} — ${diff.toFixed(2)}% ${s > d.matches ? '많음' : '적음'}`);
        }
        const totalSum = [...summed.values()].reduce((a, b) => a + b, 0);
        const totalDirect = direct.reduce((a, d) => a + d.matches, 0);
        const totalDiff = pct(totalSum, totalDirect);
        summary.crossCheckMaxDiff = Math.round(maxDiff * 100) / 100;
        if (totalSum > totalDirect ? totalDiff > 0.5 : totalDiff > 5)
          problems.push(`직접 대조: 전체 판수가 ${totalDiff.toFixed(2)}% ${totalSum > totalDirect ? '많음' : '적음'} (단계 합 ${totalSum} / 직접 ${totalDirect})`);
      }
    } else notes.push('이전 패치 단계별 데이터가 모자라 직접 대조 생략');
  }

  for (const p of problems) warn(`티어 검사: ${p}`);
  return { problems, notes, summary };
}
