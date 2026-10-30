/**
 * 가이드 추천 (2026-10-06) — POST /api/guide-vote {id}
 * 스팀 인증한 계정당 한 번, 다시 누르면 취소. 자기 글은 추천할 수 없다. 계정당 시간당 60번까지.
 */
import { json, sameOrigin, storeDown } from './_lib/http.js';
import { bump, pipeline, redis } from './_lib/redis.js';
import { userSession } from './_lib/session.js';
import { guideKey, isGuideId, parseGuides, votersKey, votesKey } from './_lib/guides-store.js';
import { limited } from './_lib/limit.js';

export async function POST(request: Request): Promise<Response> {
  const busy = limited(request, 'write');
  if (busy) return busy;
  if (!sameOrigin(request)) return json({ error: 'auth' }, 403);
  const session = await userSession(request).catch(() => null);
  if (!session) return json({ error: 'auth' }, 401);
  const { id } = (await request.json().catch(() => ({}))) as { id?: unknown };
  if (!isGuideId(id)) return json({ error: 'missing' }, 404);
  try {
    // 글과 차단 여부를 한 왕복으로 (#20). 판단 순서는 그대로: 없는 글 → 자기 글 → 차단
    const [raw, banned] = await pipeline<[Array<string | null>, number]>([['MGET', guideKey(id)], ['SISMEMBER', 'tips:banned', session.a]]);
    const [g] = parseGuides(raw);
    if (!g) return json({ error: 'missing' }, 404);
    if (g.accountId === session.a) return json({ error: 'self' }, 400);
    if (banned === 1) return json({ error: 'banned' }, 403);
    if ((await bump(`rate:vote:${session.a}:${new Date().toISOString().slice(0, 13)}`, 7200)) > 60) return json({ error: 'rate' }, 429);
    const added = (await redis<number>('SADD', votersKey(id), session.a)) === 1;
    // 실제로 지워졌을 때만 −1 — 동시에 두 번 취소하면 두 번 깎이던 문제 (2026-10-14 점검)
    const removed = !added && (await redis<number>('SREM', votersKey(id), session.a)) === 1;
    const d = added ? 1 : removed ? -1 : 0;
    // 전체 · 영웅별 추천 점수를 한 왕복으로. 영웅별은 XX — 글이 그사이 다른 영웅으로 옮겨졌으면 옛 영웅 목록에 다시 만들지 않는다 (#20 리뷰)
    const [votes] = d
      ? (await pipeline<[string, string | null]>([['ZINCRBY', votesKey(), d, id], ['ZADD', votesKey(g.hero), 'XX', 'INCR', d, id]])).map(Number)
      : [Number((await redis<string | null>('ZSCORE', votesKey(), id)) ?? 0)];
    return json({ voted: added, votes });
  } catch (e) {
    return storeDown(e) ?? json({ error: 'server' }, 500);
  }
}
