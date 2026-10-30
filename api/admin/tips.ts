/**
 * 관리 — 팁 승인 대기·공개 목록과 처리 (관리자 쿠키가 있어야 한다)
 *   GET  /api/admin/tips?status=pending|approved
 *   POST /api/admin/tips {id, action: approve | reject | unpublish | ban}
 *     approve   공개 (쓴 사람 랭크·판수를 승인 시점으로 다시 받는다)
 *     reject    지우기 (대기 중인 것)
 *     unpublish 공개한 것 내리고 지우기
 *     ban       그 계정 차단 + 그 계정의 대기 중인 팁 지우기
 */
import { json, sameOrigin, storeDown } from '../_lib/http.js';
import { redis } from '../_lib/redis.js';
import { adminSession } from '../_lib/session.js';
import { approvedKey, authorSnapshot, loadTips, tipKey, type StoredTip } from '../_lib/tips-store.js';
import { limited } from '../_lib/limit.js';

async function handleGet(request: Request): Promise<Response> {
  const busy = limited(request, 'read');
  if (busy) return busy;
  if (!(await adminSession(request))) return json({ error: 'auth' }, 401);
  const status = new URL(request.url).searchParams.get('status') === 'approved' ? 'approved' : 'pending';
  if (status === 'pending') {
    const ids = await redis<string[]>('ZRANGE', 'tips:pending', 0, 199);
    return json({ tips: await loadTips(ids) });
  }
  // 공개된 것 — 영웅별 묶음을 모두 훑는다 (팁 수가 많지 않아 충분)
  const keys = await redis<string[]>('KEYS', 'tips:approved:*');
  const ids = (await Promise.all(keys.map((k) => redis<string[]>('ZRANGE', k, '+inf', '-inf', 'BYSCORE', 'REV', 'LIMIT', 0, 100)))).flat();
  return json({ tips: (await loadTips(ids)).sort((a, b) => (b.approvedAt ?? 0) - (a.approvedAt ?? 0)), banned: await redis<string[]>('SMEMBERS', 'tips:banned') });
}

async function handlePost(request: Request): Promise<Response> {
  const busy = limited(request, 'write');
  if (busy) return busy;
  if (!sameOrigin(request)) return json({ ok: false }, 403);
  if (!(await adminSession(request))) return json({ ok: false, error: 'auth' }, 401);
  const { id, action } = (await request.json().catch(() => ({}))) as { id?: unknown; action?: unknown };
  if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/.test(id)) return json({ ok: false, error: 'id' }, 400);
  const [tip] = await loadTips([id]);
  if (!tip) return json({ ok: false, error: 'missing' }, 404);

  const remove = async (t: StoredTip) => {
    await redis('ZREM', 'tips:pending', t.id);
    await redis('ZREM', approvedKey(t.hero), t.id);
    await redis('DEL', tipKey(t.id));
  };

  switch (action) {
    case 'approve': {
      const who = await authorSnapshot(tip.accountId, tip.hero);
      const now = Math.floor(Date.now() / 1000);
      const next: StoredTip = { ...tip, status: 'approved', approvedAt: now, name: who.name ?? tip.name, rank: who.rank ?? tip.rank, games: who.games ?? tip.games };
      await redis('SET', tipKey(id), JSON.stringify(next));
      await redis('ZREM', 'tips:pending', id);
      await redis('ZADD', approvedKey(tip.hero), now, id);
      return json({ ok: true });
    }
    case 'reject':
    case 'unpublish':
      await remove(tip);
      return json({ ok: true });
    case 'ban': {
      await redis('SADD', 'tips:banned', tip.accountId);
      const pending = await loadTips(await redis<string[]>('ZRANGE', 'tips:pending', 0, -1));
      await Promise.all(pending.filter((t) => t.accountId === tip.accountId).map(remove));
      await remove(tip);
      return json({ ok: true });
    }
    default:
      return json({ ok: false, error: 'action' }, 400);
  }
}

export async function GET(request: Request): Promise<Response> {
  try {
    return await handleGet(request);
  } catch (e) {
    // 저장소에 닿지 못하면 503 readonly (#21) — 예전엔 처리 안 된 오류로 Vercel 기본 500 이었다
    return storeDown(e) ?? json({ ok: false, error: 'server' }, 500);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    return await handlePost(request);
  } catch (e) {
    // 저장소에 닿지 못하면 503 readonly (#21) — 예전엔 처리 안 된 오류로 Vercel 기본 500 이었다
    return storeDown(e) ?? json({ ok: false, error: 'server' }, 500);
  }
}
