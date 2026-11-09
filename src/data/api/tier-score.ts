/**
 * 티어 점수 — 빌드 때만 쓰고 브라우저로는 결과(티어·태그)만 보낸다.
 *
 * ※ 공개 저장소용 단순화 버전. 실제 사이트(urnlock.com)의 점수 공식 · 가중치 · 자르는 기준은 비공개라 여기 없다.
 *   이 파일은 같은 입력 · 출력 모양을 지키는 자리표시 공식이다:
 *   점수 = 판수만큼 평균 쪽으로 당긴 전체 승률의 표준점수 → 표준점수 구간으로 S–D.
 *
 * - 전체 판수가 MIN_GAMES 미만이면 티어를 매기지 않는다 ('제외'). LOW_SAMPLE_GAMES 미만은 티어를 매기되 '표본 부족' 표시.
 * - 태그(숙련 권장 · 입문 추천)는 숙련자 − 비숙련 승률 차이를 그 데이터의 평균 차이와 비교한다.
 */
import type { TierHero, TierLetter, TierTag } from '../types';
import type { TierDataset } from './tiers';

const PRIOR_GAMES = 500;
export const MIN_GAMES = 500;
/** 근거 툴팁에 숙련자 승률을 보여 주는 숙련자 판수 */
export const EXP_MIN_GAMES = 3000;
/** 티어는 매기되 '표본 부족' 을 붙이는 판수 */
export const LOW_SAMPLE_GAMES = 3000;
const CUTS: Array<[TierLetter, number]> = [['S', 1.2], ['A', 0.4], ['B', -0.4], ['C', -1.2], ['D', -Infinity]];

/** '숙련 권장' = 숙련자 − 비숙련 ≥ 그 데이터의 평균 차이 + 이 값 (%p) */
export const TAG_SKILL_OVER_AVG = 2.0;
/** 태그를 붙이려면 숙련자 · 비숙련 모두 이 판수 이상 — 두 승률의 차라 오차가 크다 */
export const TAG_MIN_GAMES = 3000;
/** '입문 추천' = 숙련자 − 비숙련 ≤ 그 데이터의 평균 차이 − 이 값 (%p) */
export const TAG_EASY_UNDER_AVG = 0.8;
/** '입문 추천' 은 비숙련자도 이만큼 이겨야 붙는다 (약한 영웅에 붙지 않게) */
export const TAG_EASY_MIN_WR = 50;

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
function zScores(xs: number[]): number[] {
  const m = mean(xs);
  const sd = Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
  return xs.map((x) => (sd ? (x - m) / sd : 0));
}
/** 판수가 적을수록 평균 승률 쪽으로 당긴 승률 (%) */
const shrunk = (wins: number, games: number, prior: number) => ((wins + (prior / 100) * PRIOR_GAMES) / (games + PRIOR_GAMES)) * 100;

export function scoreDataset(ds: TierDataset): TierHero[] {
  const heroes = ds.heroes.map((h) => {
    const novMatches = h.matches - h.expMatches;
    const novWins = h.wins - h.expWins;
    return {
      heroId: h.heroId,
      matches: h.matches,
      wins: h.wins,
      winRate: h.matches ? (h.wins / h.matches) * 100 : 0,
      expMatches: h.expMatches,
      expWinRate: h.expMatches ? (h.expWins / h.expMatches) * 100 : 0,
      novMatches,
      novWinRate: novMatches ? (novWins / novMatches) * 100 : 0,
      pickRate: ds.totalMatches ? (h.matches / ds.totalMatches) * 100 : 0,
      kills: h.kills,
      deaths: h.deaths,
      assists: h.assists,
    };
  });

  const eligible = heroes.filter((h) => h.matches >= MIN_GAMES);
  const tiers = new Map<number, TierLetter>();
  const scores = new Map<number, number>();
  if (eligible.length >= 5) {
    const prior = (eligible.reduce((n, h) => n + h.wins, 0) / eligible.reduce((n, h) => n + h.matches, 0)) * 100;
    const score = zScores(eligible.map((h) => shrunk(h.wins, h.matches, prior)));
    eligible.forEach((h, i) => {
      scores.set(h.heroId, score[i]);
      tiers.set(h.heroId, CUTS.find(([, min]) => score[i] >= min)![0]);
    });
  }

  // 평균 차이 — 티어를 매기는 영웅들의 숙련자 전체 승률 − 비숙련 전체 승률 (판수 가중)
  const pool = eligible.length ? eligible : heroes;
  const poolExp = pool.reduce((n, h) => n + h.expMatches, 0);
  const poolNov = pool.reduce((n, h) => n + h.novMatches, 0);
  const avgGap =
    poolExp && poolNov
      ? (pool.reduce((n, h) => n + (h.expWinRate / 100) * h.expMatches, 0) / poolExp -
          pool.reduce((n, h) => n + (h.novWinRate / 100) * h.novMatches, 0) / poolNov) *
        100
      : 0;

  return heroes.map((h): TierHero => {
    const gap = h.expWinRate - h.novWinRate;
    const tier = tiers.get(h.heroId) ?? null;
    const enough = tier !== null && h.expMatches >= TAG_MIN_GAMES && h.novMatches >= TAG_MIN_GAMES;
    const upper = tier === 'S' || tier === 'A' || tier === 'B';
    const tag: TierTag | null = !enough
      ? null
      : gap >= avgGap + TAG_SKILL_OVER_AVG
        ? 'skill'
        : upper && gap <= avgGap - TAG_EASY_UNDER_AVG && h.novWinRate >= TAG_EASY_MIN_WR
          ? 'easy'
          : null;
    return {
      heroId: h.heroId,
      matches: h.matches,
      winRate: h.winRate,
      expMatches: h.expMatches,
      expWinRate: h.expWinRate,
      novMatches: h.novMatches,
      novWinRate: h.novWinRate,
      pickRate: h.pickRate,
      kills: h.kills,
      deaths: h.deaths,
      assists: h.assists,
      tier,
      lowSample: tier !== null && h.matches < LOW_SAMPLE_GAMES,
      score: scores.get(h.heroId) ?? null,
      tag,
    };
  });
}
