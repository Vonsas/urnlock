/**
 * 티어·승률표 데이터 — 빌드 때 기간 × 랭크 구간 조합마다 영웅별 승률을 받아 둔다.
 *
 * - 숙련자 = 그 영웅을 평생 EXPERIENCED_GAMES(80) 판 이상 한 플레이어 (min_hero_matches_total). 2026-10-02 사용자 결정으로 30 → 50 → 80.
 *   min_hero_matches 는 '조회 기간 안의' 판수라 쓰면 안 된다 (패치 2주 안에 80판 = 극소수 장인만 걸림).
 * - 비숙련 = 전체 − 숙련자 (겹치지 않게).
 * - 랭크 구간(min/max_average_badge)을 고르면 랭크 매치만 남는다 — 2026-07-30 매칭 업데이트 이후
 *   평균 랭크는 랭크 매치에만 기록된다.
 * - 밴은 넣지 않는다: API 밴 기록이 매치당 0.06건 수준이라 불완전해 보인다 (statlocker 밴률과도 안 맞음).
 * - 랭크 단계별 수치는 하루(+ 패치 경계) 조각을 더해 만든다 — 조각은 GitHub Actions 가 src/data/tier-archive.json 에 쌓는다 (tier-pieces.ts, 2026-10-29).
 *   기간을 통째로 물으면 숙련자 요청이 API 시간 제한에 걸려 504 → 배포가 멈췄다 (docs/deploy-failures.md).
 * - 승률표는 [랭크 | 일반] (2026-10-29 사용자 — 예전 '전체(일반 포함)' 대신). 랭크 = 단계 1–11 합(ranked), 일반 = match_mode=unranked 를
 *   기간마다 한 번에 묻고 숙련자 수치는 비운다 — 일반 매치 숙련자 요청은 1시간 조각도 붐비는 시간엔 20초를 넘는다.
 */
import { API_BASE, load, warn } from './fetch';
import { type PieceStep, type TierPiece, coveringPieces, fetchPiece, floorHour, patchStarts, pieceGrid, readArchive, tierRanges } from './tier-pieces';

export { EXPERIENCED_GAMES, pool } from './tier-pieces';

/** 14d = 티어 탭의 고정 기간 (최근 2주). 나머지는 승률표에서 고른다 */
// '3d' 는 2026-10-06 뺐다 (표본이 적어 흔들리고 패치 직후 최신 흐름은 '현재 패치' 가 맡는다 — 사용자 피드백)
export const TIER_WINDOWS = ['patch', 'prev', '7d', '14d', '30d'] as const;
export type TierWindowKey = (typeof TIER_WINDOWS)[number];

/**
 * 랭크는 **단계별로**(1 개척가 … 11 불멸자) 받는다 — 휘장 번호 = 단계×10 + 하위 등급(1–6), 사색가(0)는 랭크가 없어 뺀다.
 * 승률표에서 사용자가 범위를 직접 고르면(2026-10-03, 예: 파수꾼–예지자) 브라우저가 단계별 판수·승수를 더해 계산한다.
 * 판수·승수는 서로 겹치지 않는 휘장 범위끼리 더하면 그대로 맞다 (예전처럼 구간을 직접 받은 값과 대조해 확인).
 * 예전 구간(low/mid/high/top)과 상위권(upper)은 단계별 데이터를 더해 만든다 — 티어 점수 · 영웅 지표가 쓴다.
 */
export const RANK_STEPS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] as const;
const BUCKETS: Array<{ key: 'low' | 'mid' | 'high' | 'top'; steps: number[] }> = [
  { key: 'low', steps: [1, 2, 3] },
  { key: 'mid', steps: [4, 5, 6] },
  { key: 'high', steps: [7, 8] },
  { key: 'top', steps: [9, 10, 11] },
];
/** s1 … s11 = 랭크 단계 하나, ranked = 단계 1–11 전부, normal = 일반 매치 */
export type TierRankKey = 'ranked' | 'normal' | 'low' | 'mid' | 'high' | 'top' | 'upper' | 'lower' | `s${number}`;
/** 티어 탭에서 고르는 두 구간 */
export type TierBoardRank = 'upper' | 'lower';
/**
 * 상위권 = 전령사+ (high + top). 티어 탭의 기본 구간.
 * 초월자+ 만으로는 표본이 적어 티어가 크게 흔들리고(흔들림 약 20%), 전체 매치로는 상위권과 38명 중 10명의 티어가 달라서 택했다.
 *
 * scoreWeights = 점수를 매길 때만 구간별로 판수에 곱하는 가중치 (공개 저장소에선 모두 1 — 실제 값은 비공개).
 * 화면에 보이는 판수·승률·픽률과 표본 기준은 가중 없는 실제 값이다.
 */
/**
 * 하위권 = 전령사 미만 (개척가–의식술사, low + mid). 2026-10-08 사용자 요청 — 저티어용 티어 보드. 가중 없음.
 */
const MERGED_RANKS: Array<{ key: TierBoardRank; parts: TierRankKey[]; steps: number[]; scoreWeights: Partial<Record<TierRankKey, number>> }> = [
  { key: 'upper', parts: ['high', 'top'], steps: [7, 8, 9, 10, 11], scoreWeights: {} },
  { key: 'lower', parts: ['low', 'mid'], steps: [1, 2, 3, 4, 5, 6], scoreWeights: {} },
];

export interface TierWindow {
  key: TierWindowKey;
  /** unix 초 */
  from: number;
  to?: number;
}

export interface HeroWindowStat {
  heroId: number;
  matches: number;
  wins: number;
  expMatches: number;
  expWins: number;
  /** 킬·데스·어시스트 합 (전체 요청의 값 — 승률표 KDA, 2026-10-09) */
  kills: number;
  deaths: number;
  assists: number;
}

export interface TierDataset {
  window: TierWindowKey;
  rank: TierRankKey;
  /** 이 조합의 전체 매치 수 (영웅-매치 합 / 12) */
  totalMatches: number;
  heroes: HeroWindowStat[];
  /** 점수 계산에만 쓰는 가중 판수 (합친 구간에서 일부 구간을 더 무겁게 칠 때). 없으면 heroes 그대로 */
  scoring?: { totalMatches: number; heroes: HeroWindowStat[] };
}

export interface TierRawData {
  /** 데이터를 받은 시각 (unix 초) */
  generatedAt: number;
  windows: TierWindow[];
  datasets: TierDataset[];
  /** 일주일 전 시점의 '최근 2주' (21일 전 ~ 7일 전) — 티어 변동 표시용 (2026-10-05, 하위권은 2026-10-08) */
  weekAgo?: Partial<Record<TierBoardRank, TierDataset>>;
}

const DAY = 86_400;


/** 조각 칸 → 영웅별 수치 (전체 a, 숙련자 e) */
function stepStats(steps: PieceStep[]): HeroWindowStat[] {
  const byHero = new Map<number, HeroWindowStat>();
  const get = (id: number) => {
    let h = byHero.get(id);
    if (!h) byHero.set(id, (h = { heroId: id, matches: 0, wins: 0, expMatches: 0, expWins: 0, kills: 0, deaths: 0, assists: 0 }));
    return h;
  };
  for (const s of steps) {
    for (const [id, m, w, k, d, a] of s.a) {
      const h = get(id);
      h.matches += m;
      h.wins += w;
      h.kills += k;
      h.deaths += d;
      h.assists += a;
    }
    for (const [id, m, w] of s.e) {
      const h = get(id);
      h.expMatches += m;
      h.expWins += w;
    }
  }
  return [...byHero.values()].filter((h) => h.matches > 0);
}

export async function loadTierRaw(): Promise<TierRawData | null> {
  const now = Math.floor(Date.now() / 1000);
  const starts = await patchStarts();
  if (starts.length < 2) {
    warn('패치 목록을 받지 못해 티어 데이터를 만들 수 없습니다');
    return null;
  }
  // 보관 파일이 마지막으로 쌓인 시각까지를 '지금' 으로 본다 — 6시간마다 갱신 직전에 쌓으므로 보통 몇 분 전.
  // 하루 넘게 안 쌓였으면(Actions 가 멈춤) 지금 시각으로 하고 모자란 조각은 아래에서 직접 받는다
  const archive = await readArchive();
  const end = archive && now - archive.end < DAY ? archive.end : floorHour(now);
  if (!archive) warn('티어 조각 보관 파일이 없어 조각을 모두 직접 받습니다 (느림)');
  else if (archive.end !== end) warn(`티어 조각 보관 파일이 ${((now - archive.end) / 3600).toFixed(0)}시간 전 것이라 지금까지의 조각을 직접 받습니다`);

  // 보관 파일에 없는 칸만 직접 받는다 (새 패치로 경계가 생김 · 오늘 조각이 504 로 빠짐 등). 동시 1조각 × 단계 2개
  const pieces: TierPiece[] = pieceGrid(starts, end).map(([from, to]) => archive?.pieces.find((p) => p.from === from && p.to === to) ?? { from, to, steps: {} });
  const lacking = pieces.filter((p) => RANK_STEPS.some((n) => !p.steps[n]));
  if (lacking.length) warn(`티어 조각 ${lacking.length}개를 직접 받습니다`);
  for (const p of lacking) {
    const got = await fetchPiece(p.from, p.to, RANK_STEPS.filter((n) => !p.steps[n]), warn);
    p.steps = { ...p.steps, ...got };
  }

  const ranges = tierRanges(starts, end);
  const windows: TierWindow[] = [
    { key: 'patch', from: ranges.patch.from },
    { key: 'prev', from: ranges.prev.from, to: ranges.prev.to },
    { key: '7d', from: ranges['7d'].from },
    { key: '14d', from: ranges['14d'].from },
    { key: '30d', from: ranges['30d'].from },
  ];
  /** [from, to] 를 덮는 조각들의 단계 n 칸 — 하나라도 없으면 null */
  const stepRange = (from: number, to: number, n: number) => {
    const cover = coveringPieces(pieces, from, to);
    const steps = cover?.map((p) => p.steps[n]);
    return steps && steps.every(Boolean) ? (steps as PieceStep[]) : null;
  };
  const toDataset = (window: TierWindowKey, rank: TierRankKey, heroes: HeroWindowStat[]): TierDataset => ({
    window,
    rank,
    totalMatches: heroes.reduce((n, h) => n + h.matches, 0) / 12,
    heroes,
  });

  const datasets: TierDataset[] = [];
  for (const w of windows) {
    const to = w.to ?? end;
    for (const n of RANK_STEPS) {
      const steps = stepRange(w.from, to, n);
      if (!steps) {
        warn(`티어 데이터 ${w.key}/s${n} 조각이 모자라 제외`);
        continue;
      }
      datasets.push(toDataset(w.key, `s${n}`, stepStats(steps)));
    }
    // 일반 매치 — 숙련자 필터 없이 기간을 한 번에 (가볍다). 숙련자 수치는 받지 않아 0 (승률표 일반 보기는 승률 · 픽률 · 판수만)
    const normal = await load(`tiernormal-${w.from}-${to}`, `${API_BASE}/v1/analytics/hero-stats?${new URLSearchParams({ game_mode: 'normal', match_mode: 'unranked', min_unix_timestamp: String(w.from), max_unix_timestamp: String(to) })}`, (json) =>
      (json as Array<{ hero_id: number; matches: number; wins: number; total_kills: number; total_deaths: number; total_assists: number }>).map(
        (r): HeroWindowStat => ({ heroId: r.hero_id, matches: r.matches, wins: r.wins, expMatches: 0, expWins: 0, kills: r.total_kills, deaths: r.total_deaths, assists: r.total_assists }),
      ),
    );
    if (normal) datasets.push(toDataset(w.key, 'normal', normal));
    else warn(`티어 데이터 ${w.key}/normal 를 받지 못해 제외`);
  }

  /** 같은 기간의 여러 구간을 더한다 (평균 랭크 구간은 서로 겹치지 않으므로 판수·승수를 그대로 더해도 맞다). weightOf = 점수용 가중 */
  const sum = (parts: TierDataset[], weightOf: (rank: TierRankKey) => number = () => 1) => {
    const byHero = new Map<number, HeroWindowStat>();
    for (const part of parts) {
      const k = weightOf(part.rank);
      for (const h of part.heroes) {
        const acc = byHero.get(h.heroId) ?? { heroId: h.heroId, matches: 0, wins: 0, expMatches: 0, expWins: 0, kills: 0, deaths: 0, assists: 0 };
        acc.matches += h.matches * k;
        acc.wins += h.wins * k;
        acc.expMatches += h.expMatches * k;
        acc.expWins += h.expWins * k;
        acc.kills += h.kills * k;
        acc.deaths += h.deaths * k;
        acc.assists += h.assists * k;
        byHero.set(h.heroId, acc);
      }
    }
    return { totalMatches: parts.reduce((n, p) => n + p.totalMatches * weightOf(p.rank), 0), heroes: [...byHero.values()] };
  };
  for (const w of windows) {
    // 예전 구간 = 단계 더하기 (단계가 하나라도 빠지면 그 구간은 만들지 않는다)
    for (const b of BUCKETS) {
      const parts = b.steps.map((n) => datasets.find((d) => d.window === w.key && d.rank === `s${n}`));
      if (parts.some((p) => !p)) continue;
      datasets.push({ window: w.key, rank: b.key, ...sum(parts as TierDataset[]) });
    }
    // 랭크 전체 (승률표 [랭크] 기본 · 영웅 지표 요약) — 단계가 하나라도 빠지면 만들지 않는다
    const all = RANK_STEPS.map((n) => datasets.find((d) => d.window === w.key && d.rank === `s${n}`));
    if (all.every(Boolean)) datasets.push({ window: w.key, rank: 'ranked', ...sum(all as TierDataset[]) });
    // 합친 구간 — 점수용(scoring)은 구간별 가중치를 곱해 따로 더한다 (화면 수치는 가중 없는 값)
    for (const merged of MERGED_RANKS) {
      const parts = merged.parts.map((key) => datasets.find((d) => d.window === w.key && d.rank === key));
      if (parts.some((p) => !p)) continue;
      datasets.push({ window: w.key, rank: merged.key, ...sum(parts as TierDataset[]), scoring: sum(parts as TierDataset[], (rank) => merged.scoreWeights[rank] ?? 1) });
    }
  }

  if (!datasets.length) return null;

  // 일주일 전의 티어 — 같은 공식에 21일 전 ~ 7일 전(한국 0시) 데이터를 넣는다. 기록을 따로 저장하지 않고 빌드마다 같은 방식으로 다시 계산한다.
  const weekAgo: Partial<Record<TierBoardRank, TierDataset>> = {};
  for (const merged of MERGED_RANKS) {
    const per = merged.steps.map((n) => stepRange(ranges.weekAgo.from, ranges.weekAgo.to, n));
    if (!per.every(Boolean)) {
      warn(`일주일 전 티어 데이터(${merged.key}) 조각이 모자라 티어 변동은 표시하지 않음`);
      continue;
    }
    // 점수 가중(scoreWeights)을 지금과 똑같이 매기려고 단계를 구간 이름으로 묶어 둔다
    const parts = merged.steps.map((n, i) => toDataset('14d', BUCKETS.find((b) => b.steps.includes(n))!.key, stepStats(per[i]!)));
    weekAgo[merged.key] = { window: '14d', rank: merged.key, ...sum(parts), scoring: sum(parts, (rank) => merged.scoreWeights[rank] ?? 1) };
  }
  return { generatedAt: end, windows, datasets, weekAgo };
}
