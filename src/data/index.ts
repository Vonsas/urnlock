/**
 * 데이터 접근 계층 — 페이지는 이 파일의 함수만 호출한다.
 *
 * DATA_SOURCE 가 'api' 면 빌드 시점에 deadlock-api.com 에서 받아(./api) 변환한 값을,
 * 'mock' 이거나 API·캐시가 모두 실패하면 src/data/mock/ 의 샘플을 돌려준다.
 * 실제로 어느 쪽을 썼는지는 getDataSource() 로 확인한다 (샘플 안내 표시용).
 */
import type { Locale } from '../i18n/locales';
import type { Ability, Hero, HeroDetailData, HeroSummary, Item, ItemCategory, ItemTier, PatchNote, PatchSummary, ProBuild, Rank, TopBuild, HeroCharts, TierData, HeroProfile, HeroInsights, LaneStats } from './types';
import { loadApiData } from './api';
import { loadTierRaw } from './api/tiers';
import { loadLaneStats } from './api/lanes';
import { scoreDataset } from './api/tier-score';
import { loadHeroProfiles } from './api/profiles';
import { loadHeroInsights, MASTERY_BUCKETS } from './api/insights';
import { loadAuthorBuilds, loadGameBuild, loadSteamNames, warn } from './api/fetch';
import { loadBuildPerf, loadStandings, loadTopBuildUsage } from './api/builds';
import { DURATION_BUCKETS, loadHeroCharts } from './api/hero-charts';
import { loadLeaderboardInfo } from './api/leaderboard';
import { loadItemTopHeroes, type ItemTopHeroes } from './api/item-stats';
import { PRO_BUILDS } from './pro-builds';
import { PRO_PLAYERS } from './pro-players';
import { isPatchBanner } from './patch-banners';
import { mockHeroes, type MockHero } from './mock/heroes';
import { mockItems, TIER_COST } from './mock/items';
import { mockPatch } from './mock/patch';
import { pick } from './mock/localized';

export type * from './types';
export type { ItemTopHeroes } from './api/item-stats';

/** 사용할 데이터 출처. 'mock' 으로 바꾸면 네트워크 없이 샘플로 빌드한다 */
export const DATA_SOURCE: 'mock' | 'api' = 'api';

/**
 * 게임 이미지(영웅 초상·아이템 그림·능력 아이콘) 사용 여부.
 * false 로 바꾸고 다시 빌드하면 모든 이미지가 머리글자 자리로 돌아간다 (Valve 요청 시 즉시 대응용).
 */
export const GAME_IMAGES = true;
/**
 * 가벼운 빌드 — Vercel 미리보기(main 이 아닌 브랜치)에서는 무거운 통계(티어·승률표 120여 요청, 지표 그래프, 영웅별 지표)를 받지 않는다. 빌드는 받는다 (2026-10-23 — 빌드 화면을 미리보기로 보려고).
 * 가이드 같은 화면만 테스트할 때 4–5분 걸리던 미리보기를 줄이려고 (2026-10-06 사용자). 해당 화면은 '데이터 없음' 으로 보인다.
 * 실제 배포(production)는 언제나 전체. 로컬에서 써 보려면 LIGHT_BUILD=1 pnpm build.
 */
export const LIGHT_BUILD = process.env.VERCEL_ENV === 'preview' || process.env.LIGHT_BUILD === '1';

/** 게임 상점 순서: 무기 · 마법 · 생명 */
export const ITEM_CATEGORIES: ItemCategory[] = ['weapon', 'spirit', 'vitality'];
export const ITEM_TIERS: ItemTier[] = [1, 2, 3, 4];

export function tierCost(tier: ItemTier): number {
  return TIER_COST[tier];
}

const api = () => (DATA_SOURCE === 'api' ? loadApiData({ images: GAME_IMAGES }) : Promise.resolve(null));

/** 실제로 화면에 쓰인 출처 — API 요청과 캐시가 모두 실패하면 'mock' */
export async function getDataSource(): Promise<'mock' | 'api'> {
  return (await api()) ? 'api' : 'mock';
}

function toSummary(h: MockHero, lang: Locale): HeroSummary {
  return {
    slug: h.slug,
    name: pick(h.name, lang),
    complexity: h.complexity,
    health: h.health,
    weaponDps: h.weaponDps,
    moveSpeed: h.moveSpeed,
    hasDetail: Boolean(h.detail),
  };
}

const withoutDetail = ({ detail: _detail, ...summary }: Hero): HeroSummary => summary;

export async function getHeroes(lang: Locale): Promise<HeroSummary[]> {
  const data = await api();
  if (data) return data.heroes[lang].map(withoutDetail);
  return mockHeroes.map((h) => toSummary(h, lang));
}

/** 모든 영웅 slug (상세 페이지 생성용). 상세 데이터가 없는 영웅도 페이지는 만든다. */
export async function getHeroSlugs(): Promise<string[]> {
  const data = await api();
  if (data) return data.heroes.en.map((h) => h.slug);
  return mockHeroes.map((h) => h.slug);
}

/** 기본 스탯 탭에서 영웅 간 순위를 보여주는 스탯 */
export type HeroStatKey =
  | 'dps' | 'bulletDamage' | 'pellets' | 'ammo' | 'fireRate' | 'reloadTime' | 'bulletVelocity'
  | 'lightMelee' | 'heavyMelee' | 'health' | 'healthRegen' | 'bulletResist' | 'spiritResist'
  | 'moveSpeed' | 'sprintSpeed' | 'stamina' | 'spiritPower';
export interface StatRank {
  rank: number;
  total: number;
}
type StatRanks = Partial<Record<HeroStatKey, { base?: StatRank; max?: StatRank }>>;
let statRanksPending: Promise<Map<string, StatRanks>> | undefined;

/**
 * 영웅 기본 스탯의 영웅 간 순위 (2026-10-03 사용자 요청) — 기본값과 최대 레벨 값 각각, 값이 큰 쪽이 1위
 * (지표 탭과 같은 규칙: 재장전 시간처럼 작을수록 좋은 수치도 큰 쪽이 1위). 같은 값은 같은 순위.
 * 영웅 대부분이 같은 값이라 순위가 의미 없는 스탯(서로 다른 값이 3개 미만)은 싣지 않는다.
 * 최대 레벨 순위는 그 영웅의 수치가 축복으로 오를 때만.
 */
export function getHeroStatRanks(slug: string): Promise<StatRanks> {
  statRanksPending ??= (async () => {
    const heroes = (await Promise.all((await getHeroSlugs()).map((s) => getHero(s, 'en')))).filter(
      (h): h is Hero & { detail: HeroDetailData } => !!h?.detail,
    );
    const rows = heroes.map((h) => {
      const d = h.detail;
      const n = d.maxBoons;
      const sc = (s: { base: number; perBoon?: number }) => ({ base: s.base, max: s.perBoon && n ? s.base + s.perBoon * n : undefined });
      const b = d.weapon.bulletDamage;
      const vals: Record<HeroStatKey, { base: number; max?: number }> = {
        dps: { base: d.weapon.dps, max: b.perBoon && b.base && n ? (d.weapon.dps * (b.base + b.perBoon * n)) / b.base : undefined },
        bulletDamage: sc(b),
        pellets: { base: d.weapon.pellets },
        ammo: { base: d.weapon.ammo },
        fireRate: { base: d.weapon.fireRate },
        reloadTime: { base: d.weapon.reloadTime },
        bulletVelocity: { base: d.weapon.bulletVelocity },
        lightMelee: sc(d.stats.lightMelee),
        heavyMelee: sc(d.stats.heavyMelee),
        health: sc(d.stats.health),
        healthRegen: sc(d.stats.healthRegen),
        bulletResist: sc(d.stats.bulletResist),
        spiritResist: sc(d.stats.spiritResist),
        moveSpeed: sc(d.stats.moveSpeed),
        sprintSpeed: sc(d.stats.sprintSpeed),
        stamina: sc(d.stats.stamina),
        spiritPower: sc(d.stats.spiritPower),
      };
      return { slug: h.slug, vals };
    });
    const r3 = (v: number) => Math.round(v * 1000) / 1000;
    const out = new Map<string, StatRanks>(rows.map((r) => [r.slug, {}]));
    for (const key of Object.keys(rows[0]?.vals ?? {}) as HeroStatKey[]) {
      for (const which of ['base', 'max'] as const) {
        // 최대 레벨 값이 없는 영웅(오르지 않는 수치)은 기본값으로 비교한다
        const list = rows.map((r) => ({
          slug: r.slug,
          v: r3(which === 'max' ? (r.vals[key].max ?? r.vals[key].base) : r.vals[key].base),
          own: which === 'base' || r.vals[key].max !== undefined,
        }));
        if (new Set(list.map((x) => x.v)).size < 3) continue;
        for (const x of list) {
          if (!x.own) continue;
          const rank = 1 + list.filter((y) => y.v > x.v).length;
          const cur = out.get(x.slug)!;
          cur[key] = { ...cur[key], [which]: { rank, total: list.length } };
        }
      }
    }
    return out;
  })();
  return statRanksPending.then((m) => m.get(slug) ?? {});
}

export async function getHero(slug: string, lang: Locale): Promise<Hero | undefined> {
  const data = await api();
  if (data) return data.heroes[lang].find((h) => h.slug === slug);

  const h = mockHeroes.find((hero) => hero.slug === slug);
  if (!h) return undefined;
  if (!h.detail) return toSummary(h, lang);
  const { lore, stats, weapon, abilities } = h.detail;
  const detail: HeroDetailData = {
    lore: pick(lore, lang),
    maxBoons: 35,
    stats,
    weapon: { ...weapon, name: pick(weapon.name, lang), traits: weapon.traits.map((t) => pick(t, lang)) },
    abilities: abilities.map((a) => ({
      ...a,
      name: pick(a.name, lang),
      stats: [] as Ability['stats'],
      description: pick(a.description, lang),
      upgrades: a.upgrades.map((u) => ({ cost: u.cost, text: pick(u.text, lang) })),
    })) as HeroDetailData['abilities'],
  };
  return { ...toSummary(h, lang), detail };
}

export async function getItems(lang: Locale): Promise<Item[]> {
  const data = await api();
  if (data) return data.items[lang];
  return mockItems.map((i) => ({
    slug: i.slug,
    name: pick(i.name, lang),
    category: i.category,
    tier: i.tier,
    cost: TIER_COST[i.tier],
    isActive: i.isActive,
    stats: i.stats,
  }));
}

let itemTopHeroesPending: Promise<ItemTopHeroes | null> | undefined;
/** 아이템 상세 창 '많이 산 영웅' 3명 — 최근 14일 랭크 매치 (src/data/api/item-stats.ts). 목업·API 실패면 null */
export async function getItemTopHeroes(): Promise<ItemTopHeroes | null> {
  if (DATA_SOURCE !== 'api') return null;
  itemTopHeroesPending ??= Promise.all([getItems('en'), getHeroes('en')]).then(([items, heroes]) =>
    loadItemTopHeroes(
      items.flatMap((i) => (i.id === undefined ? [] : [i.id])),
      heroes.flatMap((h) => (h.id === undefined ? [] : [h.id])),
    ),
  );
  return itemTopHeroesPending;
}

/** 랭크 단계 이름·휘장 (전적 페이지). 목업에는 없어 빈 배열 — 화면은 단계 번호로 표시 */
export async function getRanks(lang: Locale): Promise<Rank[]> {
  const data = await api();
  return data?.ranks[lang] ?? [];
}

let leaderboardPending: Promise<{ generatedAt: number; regions: NonNullable<Awaited<ReturnType<typeof loadLeaderboardInfo>>> } | null> | undefined;
/**
 * 전적 페이지 순위표의 계정 · 프로필 사진 · 주 영웅 (src/data/api/leaderboard.ts). 순위는 브라우저가 지금 순위표로 그리고 이건 덧붙이는 정보.
 * 가벼운 빌드(미리보기)에서도 받는다 — 요청 20번쯤 · 약 40초. 실패하면 null → 순위표는 이름만.
 */
export function getLeaderboardInfo() {
  if (DATA_SOURCE !== 'api') return Promise.resolve(null);
  leaderboardPending ??= loadLeaderboardInfo().then((regions) => (regions ? { generatedAt: Math.floor(Date.now() / 1000), regions } : null));
  return leaderboardPending;
}

let profilePending: ReturnType<typeof loadHeroProfiles> | undefined;

/** 영웅 플레이 지표 (최근 2주 모든 매치의 경기당 평균과 영웅 간 순위). 목업·판수 부족이면 null → 그래프·표를 숨긴다 */
export async function getHeroProfile(heroId: number | undefined): Promise<HeroProfile | null> {
  if (DATA_SOURCE !== 'api' || heroId === undefined) return null;
  profilePending ??= loadHeroProfiles();
  return (await profilePending)?.find((p) => p.heroId === heroId) ?? null;
}

let insightPending: ReturnType<typeof loadHeroInsights> | undefined;
/** 아이템 구매율이 이보다 낮으면 싣지 않는다 (%) */
const MIN_BUY_RATE = 8;
/** 숙련 곡선 구간의 판수가 이보다 적으면 승률을 싣지 않는다 (300판 → 95% 오차 약 ±5.7%p) */
const MASTERY_MIN_GAMES = 300;

/**
 * 영웅 상세 '지표'·'빌드' 탭 — 티어 탭과 같은 기준(전령사+ 랭크 · 최근 2주, 같은 시작 시각).
 * 아이템 구매율의 분모는 티어 보드의 이 영웅 판수. 목업·API 실패면 null.
 */
export async function getHeroInsights(heroId: number | undefined): Promise<HeroInsights | null> {
  if (DATA_SOURCE !== 'api' || LIGHT_BUILD || heroId === undefined) return null;
  const tiers = await getTierData();
  const window = tiers?.windows.find((w) => w.key === '14d');
  const board = tiers?.boards.find((b) => b.window === '14d' && b.rank === 'upper');
  if (!window || !board) return null;
  insightPending ??= loadHeroInsights(
    window.from,
    board.heroes.map((h) => h.heroId),
  );
  const raw = await insightPending;
  if (!raw) return null;

  const tier = board.heroes.find((h) => h.heroId === heroId) ?? null;
  const shopIds = new Set((await getItems('en')).map((i) => i.id));
  const items = tier?.matches
    ? raw.items
        .filter((r) => r.bucket === heroId && shopIds.has(r.item_id))
        .map((r) => ({ itemId: r.item_id, buyRate: (r.matches / tier.matches) * 100, buyTime: r.avg_buy_time_s }))
        .filter((r) => r.buyRate >= MIN_BUY_RATE)
    : [];
  const order = raw.orders.get(heroId);
  // 숙련 곡선 — 구간별 이 영웅 승률과, 같은 구간 모든 영웅의 평균 승률
  const mastery = MASTERY_BUCKETS.map((b, i) => {
    const rows = raw.mastery[i] ?? [];
    const own = rows.find((r) => r.hero_id === heroId);
    const allGames = rows.reduce((n, r) => n + r.matches, 0);
    const matches = own?.matches ?? 0;
    return {
      ...b,
      matches,
      winRate: own && matches >= MASTERY_MIN_GAMES ? (own.wins / matches) * 100 : null,
      average: allGames ? (rows.reduce((n, r) => n + r.wins, 0) / allGames) * 100 : 0,
    };
  });
  return { from: window.from, tier, abilityOrder: order?.path ?? [], abilityOrderMatches: order?.matches ?? 0, maxOrders: order?.maxOrders ?? [], items, mastery };
}

let tierPending: Promise<TierData | null> | undefined;

/**
 * 티어·승률표 — 기간(현재 패치·이전 패치·3/7/30일) × 랭크 구간 5개 조합을 빌드 때 받아 점수를 매긴다.
 * 목업은 없다 (API·캐시가 모두 실패하면 null → 페이지가 안내만 보여준다).
 */
export function getTierData(): Promise<TierData | null> {
  if (DATA_SOURCE !== 'api' || LIGHT_BUILD) return Promise.resolve(null);
  tierPending ??= loadTierRaw().then((raw) => {
    if (!raw) return null;
    const steps = raw.datasets
      .filter((ds) => /^s\d+$/.test(ds.rank))
      .map((ds) => ({
        window: ds.window,
        step: Number(ds.rank.slice(1)),
        totalMatches: ds.totalMatches,
        heroes: ds.heroes.map((h): [number, number, number, number, number, number, number, number] => [h.heroId, h.matches, h.wins, h.expMatches, h.expWins, h.kills, h.deaths, h.assists]),
      }));
    // 단계 하나짜리 보드는 페이지에서 쓰지 않는다 (범위는 steps 로 브라우저가 계산)
    const boards = raw.datasets.filter((ds) => !/^s\d+$/.test(ds.rank)).map((ds) => ({
      window: ds.window,
      rank: ds.rank,
      totalMatches: ds.totalMatches,
      heroes: scoreDataset(ds),
    }));
    const prevTiers = Object.fromEntries(
      Object.entries(raw.weekAgo ?? {}).map(([rank, ds]) => [rank, Object.fromEntries(scoreDataset(ds).map((h) => [h.heroId, h.tier]))]),
    );
    return { generatedAt: raw.generatedAt, windows: raw.windows, boards, steps, prevTiers };
  });
  return tierPending;
}

let lanePending: Promise<LaneStats | null> | undefined;
/** 라인 판수가 이보다 적은 영웅은 비율을 싣지 않는다 (막 나온 영웅 등) */
const LANE_MIN = 300;

/** 라인전 승·무·패 — 최근 7일 · 전령사+ 랭크 · 매치 9분 라인 소울 ±10% (src/data/api/lanes.ts) */
export function getLaneStats(): Promise<LaneStats | null> {
  if (DATA_SOURCE !== 'api' || LIGHT_BUILD) return Promise.resolve(null);
  lanePending ??= loadLaneStats().then((raw) => {
    if (!raw) return null;
    const heroes = Object.entries(raw.heroes)
      .map(([id, [w, d, l, lead]]) => {
        const n = w + d + l;
        return { heroId: Number(id), lanes: n, win: (w / n) * 100, draw: (d / n) * 100, loss: (l / n) * 100, lead: lead / n };
      })
      .filter((h) => h.lanes >= LANE_MIN)
      .sort((a, b) => b.win - a.win);
    return { from: raw.from, to: raw.to, matches: raw.matches, heroes };
  });
  return lanePending;
}

/** 전적 페이지가 브라우저에서 직접 호출하는 API 주소 (플레이어 데이터는 빌드 때 받을 수 없다) */
export { API_BASE as PLAYER_API_BASE } from './api/fetch';

let chartsPending: ReturnType<typeof loadHeroCharts> | undefined;

/** 영웅 상세 '지표' 탭 그래프 — 추이 · 랭크별 · 경기 길이별 · 시너지 (전 영웅 한 번에 받아 영웅별로 나눈다) */
export async function getHeroCharts(heroId: number | undefined): Promise<HeroCharts | null> {
  if (DATA_SOURCE !== 'api' || heroId === undefined) return null;
  const from = (await getTierData())?.windows.find((w) => w.key === '14d')?.from;
  if (!from) return null;
  chartsPending ??= loadHeroCharts(from);
  const raw = await chartsPending;
  if (!raw) return null;
  const wr = (wins: number, matches: number) => (matches ? (wins / matches) * 100 : 0);
  const today = Math.floor(Date.now() / 86_400_000) * 86_400;

  const trend = raw.trend
    .filter((r) => r.hero_id === heroId && r.bucket !== undefined && r.bucket < today)
    .sort((a, b) => a.bucket! - b.bucket!)
    .map((r) => ({ day: r.bucket!, matches: r.matches, winRate: wr(r.wins, r.matches) }));

  // 휘장(단계×10 + 하위 등급) → 단계. 0 은 랭크 없는 매치라 뺀다
  const byTier = new Map<number, { wins: number; matches: number }>();
  for (const r of raw.badges) {
    if (r.hero_id !== heroId || !r.bucket) continue;
    const tier = Math.floor(r.bucket / 10);
    const t = byTier.get(tier) ?? { wins: 0, matches: 0 };
    t.wins += r.wins;
    t.matches += r.matches;
    byTier.set(tier, t);
  }
  const ranks = [...byTier].sort((a, b) => a[0] - b[0]).map(([tier, t]) => ({ tier, matches: t.matches, winRate: wr(t.wins, t.matches) }));

  const durations = DURATION_BUCKETS.map((b, i) => {
    const rows = raw.durations[i] ?? [];
    const mine = rows.find((r) => r.hero_id === heroId);
    const all = rows.reduce((s, r) => ({ wins: s.wins + r.wins, matches: s.matches + r.matches }), { wins: 0, matches: 0 });
    return { ...b, matches: mine?.matches ?? 0, winRate: wr(mine?.wins ?? 0, mine?.matches ?? 0), average: wr(all.wins, all.matches) };
  });

  return { trend, ranks, durations };
}

/** 영웅 하나에 프로 한 명당 보여줄 빌드 수 (가장 최근 수정) */
const PRO_BUILDS_PER_HERO = 1;
/**
 * 이보다 오래 손대지 않은 게임 빌드는 보여주지 않는다 (일) — 프로 · 직접 적은 ID · 최상위권 모두.
 * 2026-10-02 사용자 결정: 오래 갱신 안 된 빌드는 패치를 못 따라가 있을 가능성이 크다. 2026-11-08 사용자: 45일 → 21일.
 */
const BUILD_MAX_AGE_DAYS = 21;
let topUsagePending: ReturnType<typeof loadTopBuildUsage> | undefined;
let perfPending: ReturnType<typeof loadBuildPerf> | undefined;
/** 영웅 페이지 38개 × 3개 언어가 같은 빌드를 부르므로 한 번 받은 결과를 재사용 (빌드는 캐시 없이 매번 새로 받기 때문) */
const memo = <K, V>(fn: (key: K) => Promise<V>) => {
  const cache = new Map<string, Promise<V>>();
  return (key: K) => {
    const k = JSON.stringify(key);
    if (!cache.has(k)) cache.set(k, fn(key));
    return cache.get(k)!;
  };
};
const authorBuilds = memo((accountId: number) => loadAuthorBuilds(accountId));
const gameBuild = memo(([heroId, buildId]: [number, number]) => loadGameBuild(heroId, buildId));
const steamNames = memo((ids: number[]) => loadSteamNames(ids));
const standingsOf = memo((authors: Array<{ id: number; names: string[] }>) => loadStandings(authors));
/** 상위권 인기 빌드 수 (2026-11-08 사용자: 3 → 5개. 최소 100판은 loadTopBuildUsage) */
const TOP_BUILDS = 5;

/**
 * 영웅 빌드 탭의 게임 빌드들.
 * - 프로: src/data/pro-players.ts 의 선수가 올린 빌드(자동) + src/data/pro-builds.ts 에 직접 적은 빌드 ID.
 *   직접 적은 ID 를 그 영웅의 빌드로 찾지 못하면 빌드 로그에 경고하고 적은 정보만 보여준다.
 * - 상위권 인기 1–5위 (top) — 추천 빌드가 그 안에 있으면 태그만 (usage).
 */
export async function getHeroBuilds(heroSlug: string): Promise<{ pro: ProBuild[]; top: TopBuild[]; patchFrom?: number }> {
  // 미리보기(가벼운 빌드)에도 빌드는 받는다 (2026-10-23: 빌드 화면을 고쳐도 미리보기에서 볼 수 없었다). 티어 데이터가 없으면 14일은 지금 기준으로
  if (DATA_SOURCE !== 'api') return { pro: [], top: [] };
  const heroes = await getHeroes('en');
  const heroId = heroes.find((h) => h.slug === heroSlug)?.id;
  if (heroId === undefined) return { pro: [], top: [] };
  const tiers = await getTierData();

  const pro: ProBuild[] = [];
  // 선수들의 빌드는 동시에 받는다
  const perPro = await Promise.all(PRO_PLAYERS.map((p) => authorBuilds(p.accountId)));
  for (const [i, p] of PRO_PLAYERS.entries()) {
    const builds = (perPro[i] ?? [])
      .filter((b) => b.heroId === heroId)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, PRO_BUILDS_PER_HERO);
    for (const b of builds) pro.push({ pro: p.name, note: p.note, source: p.source, buildId: b.buildId, build: b });
  }
  const cutoff = Date.now() / 1000 - BUILD_MAX_AGE_DAYS * 86_400;
  const fresh = pro.filter((p) => p.build && p.build.updatedAt >= cutoff).sort((a, b) => (b.build?.updatedAt ?? 0) - (a.build?.updatedAt ?? 0));
  pro.length = 0;
  pro.push(...fresh);
  for (const e of PRO_BUILDS.filter((b) => b.hero === heroSlug)) {
    const b = await gameBuild([heroId, e.buildId]);
    if (!b) warn(`프로 빌드 ${e.buildId}: ${heroSlug} 의 빌드로 찾지 못함 — 빌드 ID 를 확인하세요`);
    else if (b.updatedAt < cutoff) continue;
    pro.push({ pro: e.pro, note: e.note, source: e.source, buildId: e.buildId, build: b });
  }

  const from = tiers?.windows.find((w) => w.key === '14d')?.from ?? (LIGHT_BUILD ? Math.floor(Date.now() / 1000) - 14 * 86_400 : undefined);
  let top: TopBuild[] = [];
  // 상위권(예지자+)이 매치 시작 때 고른 빌드 순위
  if (from) {
    topUsagePending ??= loadTopBuildUsage(
      from,
      heroes.flatMap((h) => (h.id === undefined ? [] : [h.id])),
    );
    const usage = (await topUsagePending).get(heroId) ?? [];
    // 상위권 인기 1–5위 — 2026-10-02 에 뺐다가 10-03 사용자 요청으로 다시 (오래된 빌드를 뺀 뒤 많이 쓴 순)
    const builds = await Promise.all(usage.map((u) => gameBuild([heroId, u.buildId])));
    top = usage
      .flatMap((u, i) => (builds[i] && builds[i]!.updatedAt >= cutoff ? [{ matches: u.matches, players: u.players, build: builds[i]!, ...(u.allRanks && { allRanks: true }) }] : []))
      .slice(0, TOP_BUILDS)
      .map((b, i) => ({ rank: i + 1, ...b }));
    // '상위권 인기' 태그는 이 순위 안의 추천 빌드에만 (예전엔 사용 순위 어디든 붙어 57위 142판에도 붙었다 — 2026-11-08 사용자). 전체 랭크 순위(막 나온 영웅)엔 달지 않는다
    if (!top[0]?.allRanks) {
      for (const p of pro) {
        const t = top.find((b) => b.build.buildId === p.buildId);
        if (t) p.usage = { rank: t.rank, players: t.players, matches: t.matches };
      }
    }
    if (top.length) {
      const names = (await steamNames(top.map((b) => b.build.authorId))) ?? {};
      top = top.map((b) => ({ ...b, authorName: names[b.build.authorId] || undefined }));
    }
  }
  // 빌드 성적(최근 14일 전체 랭크) · 작성자 랭킹 (2026-10-22)
  if (from) {
    perfPending ??= loadBuildPerf(
      from,
      heroes.flatMap((h) => (h.id === undefined ? [] : [h.id])),
    );
    const table = (await perfPending).get(heroId);
    if (table?.total) {
      const byId = new Map(table.rows.map(([id, m, w]) => [id, { matches: m, wins: w, share: (m / table.total) * 100 }]));
      for (const p of pro) p.perf = byId.get(p.buildId);
      for (const b of top) b.perf = byId.get(b.build.buildId);
    }
  }
  const authorIds = [...pro.flatMap((p) => (p.build ? [p.build.authorId] : [])), ...top.map((b) => b.build.authorId)];
  if (authorIds.length) {
    const names = (await steamNames(authorIds)) ?? {};
    const proName = new Map(PRO_PLAYERS.map((p) => [p.accountId, p.name]));
    const standings = await standingsOf(
      [...new Set(authorIds)].map((id) => ({ id, names: [names[id] ?? '', proName.get(id) ?? ''] })),
    );
    for (const p of pro) if (p.build) p.author = standings.get(p.build.authorId);
    for (const b of top) b.author = standings.get(b.build.authorId);
  }
  // 현재 패치 시작 — 그보다 먼저 수정된 빌드에 '이전 패치' 표시
  return { pro, top, patchFrom: tiers?.windows.find((w) => w.key === 'patch')?.from };
}

/** 공식 패치노트 전체 (최신순, API 가 주는 최근 글까지). 목업은 없다 → 빈 배열이면 페이지가 안내만 보여준다 */
export async function getPatchNotes(lang: Locale): Promise<PatchNote[]> {
  return (await api())?.patchNotes[lang] ?? [];
}

/**
 * 첫 페이지 패치 그림 — 그림이 허락된(data/patch-banners.ts) 가장 최근 패치. 없으면 null.
 * 그 뒤에 마이너 패치가 나와도 메이저 패치 그림이 남는다.
 */
export async function getPatchBanner(lang: Locale): Promise<(PatchNote & { image: string }) | null> {
  if (!GAME_IMAGES) return null;
  const note = (await getPatchNotes(lang)).find((n) => n.image && isPatchBanner(n.image));
  return note ? (note as PatchNote & { image: string }) : null;
}

export async function getCurrentPatch(lang: Locale): Promise<PatchSummary> {
  const data = await api();
  if (data?.patch) return data.patch[lang];
  return {
    version: mockPatch.version,
    date: mockPatch.date,
    changes: mockPatch.changes.map((c) => ({
      kind: c.kind,
      target: pick(c.target, lang),
      text: pick(c.text, lang),
    })),
  };
}

/** 영웅 상세 탭의 기준 안내 문구용 */
export { PROFILE_DAYS, PROFILE_AXES } from './api/profiles';
export { TREND_DAYS } from './api/hero-charts';
export { MASTERY_BUCKETS } from './api/insights';
