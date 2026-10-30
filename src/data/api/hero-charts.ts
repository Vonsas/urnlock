/**
 * 영웅 상세 '지표' 탭 그래프 데이터 — 모두 전 영웅을 한 번에 받는 요청이라 영웅 수와 상관없이 6회 (analytics, IP 당 분당 200회를 나눠 씀).
 *   추이: 최근 30일 일별 승률·판수 (모든 매치 — 하루 단위라 표본이 큰 쪽)
 *   랭크별: 최근 14일 랭크 매치의 평균 휘장 → 단계(1–11)별 승률 (휘장은 랭크 매치에만 있다)
 *   경기 길이별: 최근 14일 모든 매치, 25분 미만 · 25–35 · 35–45 · 45분 이상
 */
import { API_BASE, load } from './fetch';

const DAY = 86_400;
export const TREND_DAYS = 30;
/** 경기 길이 구간 (분) — 마지막은 끝 없음 */
export const DURATION_BUCKETS: Array<{ min: number; max?: number }> = [{ min: 0, max: 25 }, { min: 25, max: 35 }, { min: 35, max: 45 }, { min: 45 }];

interface Row {
  hero_id: number;
  bucket?: number;
  wins: number;
  matches: number;
}
export interface HeroChartsRaw {
  trend: Row[];
  badges: Row[];
  durations: Row[][];
}

const trim = (json: unknown) => (json as Row[]).map(({ hero_id, bucket, wins, matches }) => ({ hero_id, bucket, wins, matches }));

export async function loadHeroCharts(from14: number): Promise<HeroChartsRaw | null> {
  const from30 = Math.floor(Date.now() / 1000) - TREND_DAYS * DAY;
  const base = `${API_BASE}/v1/analytics/hero-stats?game_mode=normal`;
  const [trend, badges, ...durations] = await Promise.all([
    load('chart-trend-30d', `${base}&bucket=start_time_day&min_unix_timestamp=${from30}`, trim),
    load('chart-badges-14d', `${base}&bucket=avg_badge&min_unix_timestamp=${from14}`, trim),
    ...DURATION_BUCKETS.map((b) =>
      load(
        `chart-duration-${b.min}-14d`,
        `${base}&min_unix_timestamp=${from14}&min_duration_s=${b.min * 60}${b.max !== undefined ? `&max_duration_s=${b.max * 60 - 1}` : ''}`,
        trim,
      ),
    ),
  ]);
  if (!trend && !badges && durations.every((d) => !d)) return null;
  return { trend: trend ?? [], badges: badges ?? [], durations: durations.map((d) => d ?? []) };
}
