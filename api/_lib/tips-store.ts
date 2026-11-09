/**
 * 팁 저장 구조 (Upstash Redis)
 *   tip:{id}               팁 하나 (JSON) — 상태 pending / approved
 *   tips:pending           승인 대기 (sorted set, 점수 = 보낸 시각)
 *   tips:approved:{hero}   공개된 팁 (sorted set, 점수 = 승인 시각)
 *   tips:banned            차단한 계정 ID (set)
 *   rate:*                 보내기 횟수 제한 (만료되는 숫자)
 */
import { publicAuthor, type AuthorDisplay } from '../../src/lib/guide-format.js';
import type { PublicTip } from '../../src/lib/tips.js';
import { redis } from './redis.js';

export interface StoredTip extends Omit<PublicTip, 'at' | 'anonymous'> {
  hero: number;
  /** 작성자 표시 — 없으면(예전 팁) 공개 */
  display?: AuthorDisplay;
  createdAt: number;
  status: 'pending' | 'approved';
  approvedAt?: number;
}

const API = 'https://api.deadlock-api.com';

/** 쓴 사람 정보 — 스팀 이름 · 랭크 · 이 영웅 판수 (deadlock-api 기록 기준, 실패하면 비워 둔다) */
export async function authorSnapshot(accountId: number, hero: number) {
  const get = async <T>(path: string): Promise<T | null> => {
    try {
      const res = await fetch(`${API}${path}`, { signal: AbortSignal.timeout(5000) });
      return res.ok ? ((await res.json()) as T) : null;
    } catch {
      return null;
    }
  };
  const [profiles, rank, stats] = await Promise.all([
    get<Array<{ account_id: number; personaname: string }>>(`/v1/players/steam?account_ids=${accountId}`),
    get<{ rank?: number; subrank?: number }>(`/v1/players/${accountId}/rank`),
    // hero 0 = 게임 가이드 — 영웅 판수는 없다
    hero ? get<Array<{ hero_id: number; matches_played: number }>>(`/v1/players/hero-stats?account_ids=${accountId}&hero_ids=${hero}`) : Promise.resolve(null),
  ]);
  return {
    name: profiles?.[0]?.personaname,
    rank: rank?.rank ? { tier: rank.rank, sub: rank.subrank ?? 1 } : null,
    games: stats?.find((s) => s.hero_id === hero)?.matches_played ?? null,
  };
}

export const tipKey = (id: string) => `tip:${id}`;
export const approvedKey = (hero: number) => `tips:approved:${hero}`;

export async function loadTips(ids: string[]): Promise<StoredTip[]> {
  if (!ids.length) return [];
  const raw = await redis<Array<string | null>>('MGET', ...ids.map(tipKey));
  return raw.flatMap((r) => {
    if (!r) return [];
    try {
      return [JSON.parse(r) as StoredTip];
    } catch {
      return [];
    }
  });
}

export const toPublic = (t: StoredTip): PublicTip => ({
  id: t.id,
  text: t.text,
  ...publicAuthor(t, t.display),
  at: t.approvedAt ?? t.createdAt,
});
