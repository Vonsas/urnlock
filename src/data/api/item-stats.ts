/**
 * 아이템 상세 창의 '많이 산 영웅' 3명 — 최근 14일(14일 전 한국 0시부터, 티어의 '최근 14일' 과 같은 시작) 랭크 매치.
 * 요청은 `item-stats?bucket=hero` 하나 (아이템 전체를 한 번에 준다).
 *
 * 2026-11-04 처음엔 상세 창에 [정보 | 통계] 탭 — 요약(구매율 · 승률 · 같은 소울 대비 · 평균 구매) · 구매 시각별 승률 · 랭크별 구매율 · 30일 추이 · 많이 산 영웅 —
 * 을 두었으나 같은 날 사용자: '영웅 3등까지 말고는 굳이, 모든 지표가 스크롤해야 하는 것도 그렇다' → 영웅 3명만 정보 화면 맨 위에 남겼다.
 * 같은 응답에 평균 구매 시각 · 되판 수가 있어 영웅 아래 한 줄로 둔다 (2026-11-05 사용자가 후보 중 골랐다, 요청은 그대로 하나).
 * 예전 계산(같은 소울 대비 = 산 순간 소울 5,000 구간이 같은 다른 아이템 구매와의 승률 차, 랭크별은 승률 대신 구매율)은 git 기록에.
 */
import { API_BASE, load, warn } from './fetch';
import { kstDayStart } from './tier-pieces';

const DAY = 86_400;
export const ITEM_STATS_DAYS = 14;
const TOP_HEROES = 3;
/** 이 아이템 구매가 이보다 적으면 비율이 흔들려 영웅을 싣지 않는다 */
const MIN_ITEM_MATCHES = 500;

/** 아이템 id → { h: [영웅 id, 이 아이템 구매 중 그 영웅 비율(‰), 그 영웅으로 샀을 때 승률(‰), 판수] × 최대 3 (판수 순),
 *  t: 평균 구매 시각(초), s: 산 판 중 경기 중에 되판 비율(‰) } — t · s 는 모든 영웅(뺀 영웅 포함) 합계 */
export type ItemTopHeroes = Record<number, { h: Array<[number, number, number, number]>; t: number; s: number }>;

/** heroIds = 화면에 그릴 수 있는 영웅 — 그 밖의 영웅(아직 자료가 없는 새 영웅 등)은 셋을 고르기 전에 빼고 경고만 (#119 리뷰: '#id' 가 화면에 나가지 않게) */
export async function loadItemTopHeroes(shopIds: number[], heroIds: number[], now = Date.now() / 1000): Promise<ItemTopHeroes | null> {
  const from = kstDayStart(now) - ITEM_STATS_DAYS * DAY;
  // [아이템, 영웅, 판수, 승수, 평균 구매 시각(초), 되판 수]
  const rows = await load<Array<[number, number, number, number, number, number]>>(
    'item-top-heroes2',
    `${API_BASE}/v1/analytics/item-stats?game_mode=normal&match_mode=ranked&min_unix_timestamp=${from}&bucket=hero`,
    (json) =>
      (json as Array<Record<string, number>>).map((r) => [r.item_id, r.bucket, r.matches, r.wins, Math.round(r.avg_buy_time_s ?? 0), r.sold ?? 0]),
  );
  if (!rows?.length) return null;
  const shop = new Set(shopIds);
  const known = new Set(heroIds);
  const unknown = new Set<number>();
  const byItem = new Map<number, Array<[number, number, number]>>();
  /** 아이템마다 [구매 판 전체, 구매 시각 × 판수 합, 되판 수] (뺀 영웅 포함 — 비율의 분모) */
  const totals = new Map<number, [number, number, number]>();
  for (const [item, hero, m, w, buyS, sold] of rows) {
    if (!shop.has(item) || !m) continue;
    const sum = totals.get(item);
    if (sum) {
      sum[0] += m;
      sum[1] += buyS * m;
      sum[2] += sold;
    } else totals.set(item, [m, buyS * m, sold]);
    if (!known.has(hero)) {
      unknown.add(hero);
      continue;
    }
    const list = byItem.get(item);
    if (list) list.push([hero, m, w]);
    else byItem.set(item, [[hero, m, w]]);
  }
  if (unknown.size) warn(`아이템 '많이 산 영웅' — 영웅 목록에 없는 영웅 id 를 뺌: ${[...unknown].join(', ')}`);
  const out: ItemTopHeroes = {};
  for (const [item, list] of byItem) {
    const [total, buySum, sold] = totals.get(item) ?? [0, 0, 0];
    if (total < MIN_ITEM_MATCHES) continue;
    out[item] = {
      h: list
        .sort((a, b) => b[1] - a[1])
        .slice(0, TOP_HEROES)
        .map(([hero, m, w]) => [hero, Math.round((m / total) * 1000), Math.round((w / m) * 1000), m]),
      t: Math.round(buySum / total),
      s: Math.min(1000, Math.round((sold / total) * 1000)),
    };
  }
  return Object.keys(out).length ? out : null;
}
