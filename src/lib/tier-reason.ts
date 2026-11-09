/**
 * 티어 근거 · 지난주 대비 변동 (2026-10-05) — 근거는 티어 보드에 마우스를 올리면 보이는 표(lib/tip.ts, 2026-11-03), 변동은 영웅 상세 지표 탭도 쓴다.
 * 근거는 티어를 매긴 영웅들 사이 순위 'n/N' (값이 큰 쪽이 1위). 점수 공식·가중치는 내보내지 않는다 (공식 비공개).
 */
import type { TierBoard, TierHero, TierLetter } from '../data/types';
import type { Dictionary } from '../i18n';
import { EXP_MIN_GAMES } from '../data/api/tier-score';
import { winTone, type TipRow, type TipSpec } from './tip';

const ORDER: TierLetter[] = ['S', 'A', 'B', 'C', 'D'];

/** 지난주 대비 칸 수 (+ 오름, − 내림). 둘 중 하나라도 티어가 없으면 null */
export function tierChange(now: TierLetter | null, prev: TierLetter | null | undefined): number | null {
  if (!now || !prev) return null;
  return ORDER.indexOf(prev) - ORDER.indexOf(now);
}

/** 영웅별 근거 — 툴팁 표의 줄 (점수에 쓰는 승률 · 숙련자 승률 · 픽률, tier-score.ts). 숙련자 승률을 점수에 안 쓴 영웅은 그 줄을 뺀다 */
export function tierReasons(board: TierBoard, t: Dictionary['tiers'], pct: (n: number) => string): Map<number, Pick<TipSpec, 'rows' | 'f'>> {
  const rated = board.heroes.filter((h) => h.tier !== null);
  const n = rated.length;
  const rankOf = (key: (h: TierHero) => number) => {
    const sorted = [...rated].sort((a, b) => key(b) - key(a));
    return (h: TierHero) => 1 + sorted.filter((x) => key(x) > key(h)).length;
  };
  const wr = rankOf((h) => h.winRate);
  const hasExp = (h: TierHero) => h.expMatches >= EXP_MIN_GAMES;
  const exp = rankOf((h) => (hasExp(h) ? h.expWinRate : -1));
  const nExp = rated.filter(hasExp).length;
  const pick = rankOf((h) => h.pickRate);
  return new Map(
    rated.map((h) => [
      h.heroId,
      {
        rows: [
          [t.winRate, pct(h.winRate), winTone(h.winRate), `${wr(h)}/${n}`],
          ...(hasExp(h) ? [[t.tipExp, pct(h.expWinRate), winTone(h.expWinRate), `${exp(h)}/${nExp}`] as TipRow] : []),
          [t.pickRate, pct(h.pickRate), 0, `${pick(h)}/${n}`],
        ],
      },
    ]),
  );
}
