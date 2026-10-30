/**
 * 라인전 승·무·패 (2026-10-15 사용자 요청, statlocker '라인전' 참고).
 *
 * - 판정: **매치 9분(540초) 기록**의 라인 소울 — 같은 라인 2:2 의 두 사람 합을 비교해 상대보다 10% 이상 많으면 승, 10% 이상 적으면 패, 그 사이는 무.
 *   두 사람이 같은 결과를 갖는다 (라인 결과). 시점은 가디언 파괴 분포로 정했다: 15분 넘게 버틴 것을 빼면 평균 10:25(전령사+ 9:50) —
 *   9분은 가디언이 대부분 아직 서 있는 때. 기록이 3분 간격(3·6·9·12분)이라 10분은 고를 수 없다.
 *   가디언을 먼저 깬 쪽을 승으로 치는 안도 봤지만 사용자 결정으로 소울만 (가디언 보상이 소울에 들어가고, 소울이 앞서면 밀 주도권이 있다).
 * - 범위: 최근 7일 · 전령사+ 랭크 (티어와 같은 상위권). 매치 묶음 요청(/v1/matches/metadata, IP 당 분당 30회)에 필요한 열만
 *   (assigned_lane · stats.net_worth · stats.time_stamp_s — 1,000판에 약 3MB, 전체 기록을 받으면 100판에 37MB) 받아,
 *   7일을 3시간 칸으로 나눠 받고, 한 칸이 요청 한도(1,000판)에 닿으면 반으로 다시 나눠 **일주일 전체**를 받는다 (처음엔 칸마다 1,000판 = 약 45% 표본이었는데
   판수가 실제의 절반으로 보여 2026-10-15 전체로 바꿈). 요청 약 60번 · 분당 30회 제한이라 빌드에 약 2분. 받은 즉시 영웅별 합계로 줄여 캐시에 둔다.
 * - statlocker 는 같은 '9분' 인데 1인당 소울이 7,400–8,100 으로 우리(원본 매치 9분 약 6,100–6,500)보다 높다 — 계산 시점이 다른 것으로 보이며
 *   방식이 공개돼 있지 않아 숫자를 1:1 로 맞추지 않는다.
 */
import { API_BASE, load, warn } from './fetch';
import { pool } from './tiers';

export const LANE_SAMPLE_S = 540;
export const LANE_LEAD = 0.1;
export const LANE_DAYS = 7;
/** 처음 나누는 칸 수 (3시간씩). 한 칸이 요청 한도(1,000판)에 닿으면 반으로 다시 나눠 빠짐없이 받는다 */
const SLICES = 56;
const PAGE = 1000;
/** 상위권 = 전령사+ (휘장 71 이상) */
const MIN_BADGE = 71;

/** 영웅별 [승, 무, 패, 소울 차이 합(라인 두 명 합 기준)] */
export type LaneTally = Record<number, [number, number, number, number]>;

export interface LaneRaw {
  from: number;
  to: number;
  /** 집계한 매치 수 (9분 넘게 간 매치) */
  matches: number;
  heroes: LaneTally;
}

interface BulkPlayer {
  hero_id: number;
  team: string;
  assigned_lane: number;
  stats_net_worth?: number[];
  stats_time_stamp_s?: number[];
}
interface BulkMatch {
  duration_s: number;
  players?: BulkPlayer[];
}

/** 매치 묶음 하나 → 영웅별 합계 (캐시엔 이것만 남긴다) */
function tallyPage(json: unknown): { rows: number; matches: number; heroes: LaneTally } {
  const heroes: LaneTally = {};
  let matches = 0;
  const list = (json as BulkMatch[]) ?? [];
  for (const m of list) {
    if (m.duration_s < LANE_SAMPLE_S || !m.players) continue;
    const lanes = new Map<string, Array<{ hero: number; souls: number }>>();
    for (const p of m.players) {
      const i = p.stats_time_stamp_s?.indexOf(LANE_SAMPLE_S) ?? -1;
      const souls = i >= 0 ? p.stats_net_worth?.[i] : undefined;
      if (souls === undefined) continue;
      const key = `${p.team}|${p.assigned_lane}`;
      lanes.set(key, [...(lanes.get(key) ?? []), { hero: p.hero_id, souls }]);
    }
    let counted = false;
    for (const [key, side] of lanes) {
      const [team, lane] = key.split('|');
      if (team !== 'Team0') continue;
      const enemy = lanes.get(`Team1|${lane}`);
      // 2:2 라인만 (deadlock-api 라인 통계와 같은 조건)
      if (side.length !== 2 || enemy?.length !== 2) continue;
      counted = true;
      const a = side[0].souls + side[1].souls;
      const b = enemy[0].souls + enemy[1].souls;
      for (const [mine, theirs, duo] of [
        [a, b, side],
        [b, a, enemy],
      ] as const) {
        const result = mine >= theirs * (1 + LANE_LEAD) ? 0 : theirs >= mine * (1 + LANE_LEAD) ? 2 : 1;
        for (const { hero } of duo) {
          const t = (heroes[hero] ??= [0, 0, 0, 0]);
          t[result]++;
          t[3] += mine - theirs;
        }
      }
    }
    if (counted) matches++;
  }
  return { rows: list.length, matches, heroes };
}

export async function loadLaneStats(): Promise<LaneRaw | null> {
  // 한 시간 단위로 맞춰 캐시 이름이 실행마다 바뀌지 않게
  const to = Math.floor(Date.now() / 1000 / 3600) * 3600;
  const from = to - LANE_DAYS * 86_400;
  const fetchSlice = (a: number, b: number) => {
    const q = new URLSearchParams({
      game_mode: 'normal',
      match_mode: 'ranked',
      min_average_badge: String(MIN_BADGE),
      min_unix_timestamp: String(a),
      max_unix_timestamp: String(b),
      limit: String(PAGE),
      extra_player_columns: 'assigned_lane,stats.net_worth,stats.time_stamp_s',
    });
    return load(`lanes-${a}-${b}`, `${API_BASE}/v1/matches/metadata?${q}`, tallyPage);
  };
  const step = Math.floor((to - from) / SLICES);
  let slices: Array<[number, number]> = Array.from({ length: SLICES }, (_, i) => [from + i * step, i === SLICES - 1 ? to : from + (i + 1) * step]);
  const pages: Array<{ matches: number; heroes: LaneTally }> = [];
  let failed = 0;
  // 한도에 닿은 칸은 반으로 나눠 다시 (세 번까지 — 3시간 → 1.5 → 45분 → 22분)
  for (let round = 0; round < 4 && slices.length; round++) {
    const results = await pool(slices.map(([a, b]) => () => fetchSlice(a, b)), 2, 2100);
    const again: Array<[number, number]> = [];
    results.forEach((r, i) => {
      const [a, b] = slices[i];
      if (!r) failed++;
      else if (r.rows >= PAGE && round < 3) {
        const mid = Math.floor((a + b) / 2);
        again.push([a, mid], [mid, b]);
      } else pages.push(r);
    });
    slices = again;
  }
  if (failed > SLICES / 2 || !pages.length) {
    warn(`라인전 데이터를 받지 못해 싣지 않음 (실패 ${failed}칸)`);
    return null;
  }
  if (failed) warn(`라인전 데이터 ${failed}칸을 받지 못함 (나머지로 계산)`);
  const heroes: LaneTally = {};
  let matches = 0;
  for (const p of pages) {
    matches += p.matches;
    for (const [id, t] of Object.entries(p.heroes)) {
      const acc = (heroes[Number(id)] ??= [0, 0, 0, 0]);
      for (let k = 0; k < 4; k++) acc[k] += t[k];
    }
  }
  return { from, to, matches, heroes };
}
