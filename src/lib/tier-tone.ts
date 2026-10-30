/** 티어 글자 배지 색 — 티어 화면(scripts/tiers.ts)과 영웅 상세가 같이 쓴다. S·A·B 는 사이트 색과 따로 고정된 tier-* 토큰 */
export const TIER_TONE: Record<'S' | 'A' | 'B' | 'C' | 'D', string> = {
  S: 'bg-tier-s text-ink-950',
  A: 'bg-tier-a text-ink-950',
  B: 'bg-tier-b text-ink-950',
  C: 'bg-ink-600 text-paper-50',
  D: 'bg-ink-700 text-paper-400',
};
