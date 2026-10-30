/**
 * 티어 한 줄 근거 · 지난주 대비 변동 (2026-10-05) — 티어 보드(마우스를 올리면)와 영웅 상세 지표 탭이 같이 쓴다.
 * 근거는 티어를 매긴 영웅들 사이 순위 'n/N' (값이 큰 쪽이 1위). 점수 공식·가중치는 내보내지 않는다 (공식 비공개).
 */
import type { TierBoard, TierHero, TierLetter } from '../data/types';
import type { Dictionary } from '../i18n';
import { fill } from './format';

const ORDER: TierLetter[] = ['S', 'A', 'B', 'C', 'D'];

/** 지난주 대비 칸 수 (+ 오름, − 내림). 둘 중 하나라도 티어가 없으면 null */
export function tierChange(now: TierLetter | null, prev: TierLetter | null | undefined): number | null {
  if (!now || !prev) return null;
  return ORDER.indexOf(prev) - ORDER.indexOf(now);
}

/** 영웅별 근거 문장 — 숙련자 판수가 적어 전체 승률로 매긴 영웅은 그렇게 적는다 (tier-score.ts 의 MIN_EXP_GAMES 와 같은 200판) */
export function tierReasons(board: TierBoard, t: Dictionary['tiers'], pct: (n: number) => string): Map<number, string> {
  const rated = board.heroes.filter((h) => h.tier !== null);
  const n = rated.length;
  const rankOf = (key: (h: TierHero) => number) => {
    const sorted = [...rated].sort((a, b) => key(b) - key(a));
    return (h: TierHero) => 1 + sorted.filter((x) => key(x) > key(h)).length;
  };
  const exp = rankOf((h) => (h.expMatches >= 200 ? h.expWinRate : -1));
  const nExp = rated.filter((h) => h.expMatches >= 200).length;
  const nov = rankOf((h) => h.novWinRate);
  const wr = rankOf((h) => h.winRate);
  const pick = rankOf((h) => h.pickRate);
  return new Map(
    rated.map((h) => [
      h.heroId,
      h.expMatches >= 200
        ? fill(t.reason, { exp: pct(h.expWinRate), expRank: `${exp(h)}/${nExp}`, nov: pct(h.novWinRate), novRank: `${nov(h)}/${n}`, pick: pct(h.pickRate), pickRank: `${pick(h)}/${n}` })
        : fill(t.reasonNoExp, { wr: pct(h.winRate), wrRank: `${wr(h)}/${n}`, pick: pct(h.pickRate), pickRank: `${pick(h)}/${n}` }),
    ]),
  );
}
