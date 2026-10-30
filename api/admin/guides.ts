/**
 * 관리 — 가이드 (관리자 쿠키가 있어야 한다)
 *   GET  /api/admin/guides                 최근 200편
 *   GET  /api/admin/guides?images=1  사진이 있는 최근 가이드 (사진마다 삭제)
 *   GET  /api/admin/guides?reports=1       신고된 가이드 (신고 많은 순, 신고 내용 최근 20개씩)
 *   POST /api/admin/guides {id, action: unpublish | ban}
 *     unpublish 내리고 지우기 (사진도 저장소에서)
 *     ban       그 계정 차단(팁·가이드 모두) + 이 가이드 지우기
 *   POST /api/admin/guides {id, url, action: approveImage | rejectImage}
 *     approveImage 사진 공개 · rejectImage 사진 빼고 저장소에서 지우기
 *   POST /api/admin/guides {id, action: dismissReports}   신고 무시 (신고 목록에서 뺌)
 */
import { json, sameOrigin, storeDown } from '../_lib/http.js';
import { deleteImages } from '../_lib/images.js';
import { redis } from '../_lib/redis.js';
import { adminSession } from '../_lib/session.js';
import { PENDING_IMAGES, REPORTED, reportsKey, guideKey, isGuideId, loadGuides, loadVotes, newKey, removeGuide } from '../_lib/guides-store.js';
import { limited } from '../_lib/limit.js';

async function handleGet(request: Request): Promise<Response> {
  const busy = limited(request, 'read');
  if (busy) return busy;
  if (!(await adminSession(request))) return json({ error: 'auth' }, 401);
  const q = new URL(request.url).searchParams;
  if (q.get('reports')) {
    const ids = await redis<string[]>('ZRANGE', REPORTED, 0, 99, 'REV');
    const [guides, votes] = await Promise.all([loadGuides(ids), loadVotes(ids)]);
    const lists = await Promise.all(guides.map((g) => redis<string[]>('LRANGE', reportsKey(g.id), 0, 19)));
    return json({ guides: guides.map((g, i) => ({ ...g, votes: votes.get(g.id) ?? 0, reports: lists[i].map((r) => JSON.parse(r)) })) });
  }
  const ids = await redis<string[]>('ZRANGE', newKey(), 0, 199, 'REV');
  const [all, votes] = await Promise.all([loadGuides(ids), loadVotes(ids)]);
  // 사진 탭은 사진이 하나라도 남아 있는 가이드만
  const guides = q.get('images') ? all.filter((g) => g.sections.some((x) => x.images.some((im) => im.url))) : all;
  return json({ guides: guides.map((g) => ({ ...g, votes: votes.get(g.id) ?? 0 })) });
}

async function handlePost(request: Request): Promise<Response> {
  const busy = limited(request, 'write');
  if (busy) return busy;
  if (!sameOrigin(request)) return json({ ok: false }, 403);
  if (!(await adminSession(request))) return json({ ok: false, error: 'auth' }, 401);
  const { id, url, action } = (await request.json().catch(() => ({}))) as { id?: unknown; url?: unknown; action?: unknown };
  if (!isGuideId(id)) return json({ ok: false, error: 'id' }, 400);
  const [g] = await loadGuides([id]);
  if (!g) return json({ ok: false, error: 'missing' }, 404);
  switch (action) {
    case 'unpublish':
      await removeGuide(g);
      return json({ ok: true });
    case 'ban':
      await redis('SADD', 'tips:banned', g.accountId);
      await removeGuide(g);
      return json({ ok: true });
    case 'dismissReports':
      await redis('ZREM', REPORTED, g.id);
      await redis('DEL', reportsKey(g.id));
      return json({ ok: true });
    case 'approveImage':
    case 'rejectImage': {
      const found = g.sections.some((x) => x.images.some((im) => im.url === url));
      if (typeof url !== 'string' || !url || !found) return json({ ok: false, error: 'missing' }, 404);
      for (const x of g.sections) {
        if (action === 'approveImage') x.images = x.images.map((im) => (im.url === url ? { ...im, pending: false } : im));
        // 빼도 자리는 남긴다 (자리 표시 번호가 밀리지 않게) — 주소만 비움
        else x.images = x.images.map((im) => (im.url === url ? { url: '', w: 0, h: 0 } : im));
      }
      if (action === 'rejectImage') await deleteImages([url]);
      await redis('SET', guideKey(g.id), JSON.stringify(g));
      await redis('ZREM', PENDING_IMAGES, g.id);
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
