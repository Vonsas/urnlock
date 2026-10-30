/**
 * 영웅 상세 '지표'·'빌드' 탭 — 티어와 같은 기준(전령사+ 랭크 · 최근 2주)의 아이템·스킬 순서·판수별 승률.
 * 요청: 아이템 1(영웅별 묶음) + 판수 구간 4 + 스킬 순서 영웅 수만큼 (맞대결은 2026-10-28 뺌). analytics 는 IP 당 분당 200회를 티어(50회)와 나눠 쓴다.
 */
import { API_BASE, load } from './fetch';
import { pool } from './tiers';

/** 티어의 상위권(upper = high + top) 과 같은 휘장 범위 */
const RANK_MIN = 71;
const RANK_MAX = 116;
export interface RawItemStat {
  /** bucket=hero 일 때 영웅 id */
  bucket: number;
  item_id: number;
  matches: number;
  avg_buy_time_s: number;
}
interface RawAbilityOrder {
  abilities: number[];
  matches: number;
  wins: number;
}
/** 선마 순서 하나 — 포인트를 많이 넣은 능력 순서(위 3개), 그 순서를 따른 매치 비율(%) · 판수 · 승률(%), 그 안에서 가장 많이 쓴 찍는 순서(path) */
export interface MaxOrder {
  order: number[];
  /** 포인트 MAX_ORDER_POINTS 까지 실제로 찍은 순서 (해금 포함) — 이 선마 순서 안에서 가장 많은 것 */
  path: number[];
  share: number;
  matches: number;
  winRate: number;
}
export interface AbilityOrder {
  path: number[];
  matches: number;
  /** 많이 쓴 선마 순서 (비율 높은 순, 최대 MAX_ORDER_TOP 개) */
  maxOrders: MaxOrder[];
}
const MAX_ORDER_TOP = 3;

/** 숙련 곡선 — 그 영웅을 평생 몇 판 했는지(일반·랭크·난투 합) 구간. 랭크는 일반전 15승이 있어야 해서 15판부터 */
export const MASTERY_BUCKETS: Array<{ min: number; max?: number }> = [{ min: 15, max: 29 }, { min: 30, max: 99 }, { min: 100, max: 299 }, { min: 300 }];

export interface RawHeroWins {
  hero_id: number;
  wins: number;
  matches: number;
}

export interface HeroInsightsRaw {
  items: RawItemStat[];
  orders: Map<number, AbilityOrder>;
  /** MASTERY_BUCKETS 순서대로, 구간마다 영웅별 판수·승수 */
  mastery: RawHeroWins[][];
}

function query(from: number, extra: Record<string, string> = {}) {
  return new URLSearchParams({
    game_mode: 'normal',
    min_unix_timestamp: String(from),
    min_average_badge: String(RANK_MIN),
    max_average_badge: String(RANK_MAX),
    ...extra,
  });
}

/**
 * 가장 많이 고른 스킬 순서 — 행은 매치 하나의 전체 순서라, 갈림길마다 지금까지의 순서를 따른 매치들 중
 * 다수가 고른 능력을 이어 붙인다. 칸마다 따로 다수결하면 강화가 네 번 찍히는 식의 불가능한 순서가 나올 수 있어 이렇게 한다.
 */
function modalPath(rows: RawAbilityOrder[]): AbilityOrder {
  const path: number[] = [];
  let rest = rows;
  for (let step = 0; step < 16; step++) {
    const tally = new Map<number, number>();
    for (const r of rest) if (r.abilities.length > step) tally.set(r.abilities[step], (tally.get(r.abilities[step]) ?? 0) + r.matches);
    const best = [...tally].sort((a, b) => b[1] - a[1])[0];
    if (!best) break;
    path.push(best[0]);
    rest = rest.filter((r) => r.abilities[step] === best[0]);
  }
  return { path, matches: rows.reduce((s, r) => s + r.matches, 0), maxOrders: maxOrders(rows) };
}

/**
 * 스킬 선마 (2026-10-08 사용자 요청, 2026-10-09 기준 변경) — 강화에 포인트를 MAX_ORDER_POINTS 까지 쓴 시점에 포인트를 많이 넣은 능력 순서 위 3개
 * (같으면 그 포인트에 먼저 닿은 순). 해금은 포인트가 들지 않고 강화는 1 · 2 · 5 (능력 하나 마스터 = 8).
 * 예전엔 '실제로 마스터한 순서' 였는데, 마스터까지 가려면 레벨(= 소울)이 필요해 지는 판일수록 빠졌다 — 3개 마스터한 판만 세면 승률이 전체보다
 * 5–8%p 높게 나왔다 (비밥 48.7% → 57%). 20포인트(둘 마스터 + 셋째 4)는 99% 의 판이 닿고, 셋째 순서도 끝까지 간 판과 거의 같다 (16 은 셋째가 이르다).
 * 순서 전체를 통째로 세어 비율 · 승률을 낸다. 1위는 늘, 2·3위는 MAX_ORDER_MIN_MATCHES 판 이상일 때만.
 * 화면은 선마마다 그 안에서 가장 많이 쓴 찍는 순서(path)를 칸으로 보여 주고 마스터 칸에 표시한다 (2026-10-09 사용자: 선마 · 찍는 순서를 하나로).
 */
const MAX_ORDER_POINTS = 20;
const UPGRADE_COST = [0, 1, 2, 5];
const MAX_ORDER_MIN_MATCHES = 1000;
function maxOrders(rows: RawAbilityOrder[]): MaxOrder[] {
  const tally = new Map<string, { order: number[]; matches: number; wins: number; paths: Map<string, number> }>();
  let total = 0;
  for (const r of rows) {
    const points = new Map<number, number>();
    const reached = new Map<string, number>();
    let spent = 0;
    let steps = 0;
    for (let i = 0; i < r.abilities.length; i++) {
      const id = r.abilities[i];
      const n = points.get(id) ?? 0;
      const cost = UPGRADE_COST[n] ?? Infinity;
      if (spent + cost > MAX_ORDER_POINTS) break;
      spent += cost;
      points.set(id, n + 1);
      reached.set(`${id}:${n + 1}`, i);
      steps = i + 1;
    }
    // 그 포인트 근처까지 못 간 판(일찍 끝난 판, 약 1%)은 뺀다
    if (spent < MAX_ORDER_POINTS - 4) continue;
    const at = (id: number) => reached.get(`${id}:${points.get(id)}`)!;
    const order = [...points.keys()].sort((a, b) => points.get(b)! - points.get(a)! || at(a) - at(b)).slice(0, 3);
    if (order.length < 3) continue;
    const key = order.join(',');
    const entry = tally.get(key) ?? { order, matches: 0, wins: 0, paths: new Map<string, number>() };
    entry.matches += r.matches;
    entry.wins += r.wins;
    const path = r.abilities.slice(0, steps).join(',');
    entry.paths.set(path, (entry.paths.get(path) ?? 0) + r.matches);
    tally.set(key, entry);
    total += r.matches;
  }
  return [...tally.values()]
    .sort((a, b) => b.matches - a.matches)
    .filter((e, i) => i === 0 || e.matches >= MAX_ORDER_MIN_MATCHES)
    .slice(0, MAX_ORDER_TOP)
    .map((e) => ({
      order: e.order,
      path: [...e.paths].sort((a, b) => b[1] - a[1])[0][0].split(',').map(Number),
      share: total ? (e.matches / total) * 100 : 0,
      matches: e.matches,
      winRate: (e.wins / e.matches) * 100,
    }));
}

export async function loadHeroInsights(from: number, heroIds: number[]): Promise<HeroInsightsRaw | null> {
  const [items, ...mastery] = await Promise.all([
    load('insight-items-14d', `${API_BASE}/v1/analytics/item-stats?${query(from, { bucket: 'hero' })}`, (json) =>
      (json as RawItemStat[]).map(({ bucket, item_id, matches, avg_buy_time_s }) => ({ bucket, item_id, matches, avg_buy_time_s })),
    ),
    ...MASTERY_BUCKETS.map((b) =>
      load(
        `insight-mastery-${b.min}-14d`,
        `${API_BASE}/v1/analytics/hero-stats?${query(from, {
          min_hero_matches_total: String(b.min),
          ...(b.max !== undefined && { max_hero_matches_total: String(b.max) }),
        })}`,
        (json) => (json as RawHeroWins[]).map(({ hero_id, wins, matches }) => ({ hero_id, wins, matches })),
      ),
    ),
  ]);
  const orders = await pool(
    heroIds.map((id) => () =>
      load(`insight-order5-${id}-14d`, `${API_BASE}/v1/analytics/ability-order-stats?${query(from, { hero_id: String(id), min_matches: '5' })}`, (json) =>
        modalPath(json as RawAbilityOrder[]),
      ).then((o) => [id, o] as const),
    ),
    4,
  );
  if (!items && orders.every(([, o]) => !o)) return null;
  return {
    items: items ?? [],
    orders: new Map(orders.filter((e): e is readonly [number, AbilityOrder] => Boolean(e[1]))),
    mastery: mastery.map((m) => (m as RawHeroWins[] | null) ?? []),
  };
}
