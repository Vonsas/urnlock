/**
 * 영웅 플레이 지표 — 최근 2주 모든 매치(일반 + 랭크)의 경기당 평균과 영웅들 사이 순위.
 * 영웅 상세의 육각형 그래프와 '지표' 탭 표가 쓴다. 성향 비교라 랭크를 거르지 않고 가장 큰 표본을 쓴다.
 */
import type { HeroMetricKey, HeroProfile, HeroProfileAxis } from '../types';
import { API_BASE, load } from './fetch';

const DAY = 86_400;
export const PROFILE_DAYS = 14;
/** 판수가 이보다 적은 영웅(갓 나온 영웅 등)은 비교에서 뺀다 — 평균이 크게 흔들려 순위가 무의미 */
const MIN_MATCHES = 1000;

const FIELDS = [
  'hero_id',
  'matches',
  'total_kills',
  'total_deaths',
  'total_assists',
  'total_net_worth',
  'total_last_hits',
  'total_denies',
  'total_player_damage',
  'total_player_damage_taken',
  'total_boss_damage',
  'total_shots_hit',
  'total_shots_missed',
] as const;
type RawProfileStat = Record<(typeof FIELDS)[number], number>;

/** 표 순서대로 — 경기당 값 계산식 */
const METRICS: Array<{ key: HeroMetricKey; value: (h: RawProfileStat) => number }> = [
  { key: 'kills', value: (h) => h.total_kills / h.matches },
  { key: 'deaths', value: (h) => h.total_deaths / h.matches },
  { key: 'assists', value: (h) => h.total_assists / h.matches },
  { key: 'kda', value: (h) => (h.total_kills + h.total_assists) / Math.max(h.total_deaths, 1) },
  { key: 'souls', value: (h) => h.total_net_worth / h.matches },
  { key: 'lastHits', value: (h) => h.total_last_hits / h.matches },
  { key: 'denies', value: (h) => h.total_denies / h.matches },
  { key: 'damage', value: (h) => h.total_player_damage / h.matches },
  { key: 'taken', value: (h) => h.total_player_damage_taken / h.matches },
  { key: 'objective', value: (h) => h.total_boss_damage / h.matches },
  { key: 'accuracy', value: (h) => (h.total_shots_hit / Math.max(h.total_shots_hit + h.total_shots_missed, 1)) * 100 },
];

/** 육각형 축 — 위에서부터 시계 방향 */
export const PROFILE_AXES: HeroProfileAxis[] = ['kills', 'damage', 'souls', 'objective', 'taken', 'assists'];

/** 값이 영웅들 사이에서 어디쯤인지 0(최하)–100(최고), 같은 값은 중간 순위 */
function percentile(values: number[], v: number): number {
  const n = values.length;
  const below = values.filter((x) => x < v).length;
  const equal = values.filter((x) => x === v).length - 1;
  return n > 1 ? ((below + equal / 2) / (n - 1)) * 100 : 50;
}

export async function loadHeroProfiles(): Promise<HeroProfile[] | null> {
  const from = Math.floor(Date.now() / 1000) - PROFILE_DAYS * DAY;
  const raw = await load(
    'hero-metrics2-14d',
    `${API_BASE}/v1/analytics/hero-stats?game_mode=normal&min_unix_timestamp=${from}`,
    (json) => (json as RawProfileStat[]).map((h) => Object.fromEntries(FIELDS.map((k) => [k, h[k]])) as RawProfileStat),
  );
  if (!raw?.length) return null;
  const heroes = raw.filter((h) => h.matches >= MIN_MATCHES);
  const columns = METRICS.map((m) => heroes.map(m.value));
  return heroes.map((h, i) => ({
    heroId: h.hero_id,
    matches: h.matches,
    heroCount: heroes.length,
    from,
    metrics: METRICS.map((m, j) => {
      const values = columns[j];
      const value = values[i];
      return {
        key: m.key,
        value,
        average: values.reduce((s, x) => s + x, 0) / values.length,
        rank: 1 + values.filter((x) => x > value).length,
        percentile: percentile(values, value),
      };
    }),
  }));
}
