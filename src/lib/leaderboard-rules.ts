/**
 * 순위표 이름 → 계정 고르기 · 티어 규칙 — 빌드의 지역 순위표(src/data/api/leaderboard.ts)와 브라우저의 영웅 순위표(scripts/players.ts)가 같이 쓴다
 * (#102 리뷰: 규칙이 #86 · #88 에서 두 번 바뀌어 한쪽만 고치기 쉬웠다).
 */

/** 이 휘장 이상으로 이 기간(일) 안에 경기한 후보를 앞에서부터 차례로 찾는다 — 30일 100+, 없으면 81+(남미 · 오세아니아 100위 근처는 84–96), 그래도 없으면 60일 안 100+ */
export const PICK_PASSES = [
  { badge: 100, days: 30 },
  { badge: 81, days: 30 },
  { badge: 100, days: 60 },
] as const;
/** 티어(휘장)는 마지막 랭크 매치가 이 기간 안일 때만 싣는다 (#88 리뷰 — 아시아 61위가 69일 전 예지자 6 으로 불멸자 사이에 끼었다) */
export const BADGE_DAYS = 60;

export interface RankRow {
  badge: number;
  /** 마지막 랭크 매치 시작 시각 (초) */
  at: number;
}

/** 후보 중 PICK_PASSES 를 처음 만족하는 후보들 (없으면 빈 배열). 하나면 그 계정, 여럿이면 스팀 이름 대조로 넘긴다 */
export function fitCandidates(ids: readonly number[], ranks: ReadonlyMap<number, RankRow>, now: number): number[] {
  for (const pass of PICK_PASSES) {
    const fit = ids.filter((id) => {
      const r = ranks.get(id);
      return r !== undefined && r.badge >= pass.badge && now - r.at < pass.days * 86_400;
    });
    if (fit.length) return fit;
  }
  return [];
}

/** 화면에 실을 휘장 — 60일 안이고 휘장 번호 꼴(단계 1–11 · 하위 등급 1–6)일 때만, 아니면 0 ('#12' 같은 값이 나가지 않게) */
export function shownBadge(r: RankRow | undefined, now: number): number {
  if (!r || now - r.at >= BADGE_DAYS * 86_400) return 0;
  const sub = r.badge % 10;
  return sub >= 1 && sub <= 6 && r.badge >= 11 && r.badge <= 116 ? r.badge : 0;
}
