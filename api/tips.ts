/**
 * 유저 팁 (2026-10-06)
 *   GET  /api/tips?hero=영웅ID   공개된 팁 (최근 승인 순, 최대 100개). CDN 이 60초 캐시 — 승인하면 1분 안에 보인다
 *   POST /api/tips {hero, text}  스팀 인증한 사람만. 검사를 통과하면 바로 공개 (2026-10-06 — 승인은 사진 팁에만 붙일 예정)
 * 안전장치: 같은 사이트 요청만 · 서명 쿠키 · 봇 함정 칸 · 글 검사(길이·링크·욕설) · 차단 계정 · 계정당 하루 3개 · IP 당 시간당 10개
 */
import { isHeroId } from './_lib/heroes.js';
import { DEFAULT_DISPLAY, isAuthorDisplay } from '../src/lib/guide-format.js';
import { TIP_DAILY_LIMIT, checkTip, normalizeTip, type TipError } from '../src/lib/tips.js';
import { canonicalQuery, clientIp, json, sameOrigin, storeDown } from './_lib/http.js';
import { bump, pipeline, redis } from './_lib/redis.js';
import { userSession } from './_lib/session.js';
import { approvedKey, authorSnapshot, loadTips, tipKey, toPublic, type StoredTip } from './_lib/tips-store.js';
import { limited } from './_lib/limit.js';

const heroParam = (v: unknown) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 && n < 10_000 ? n : null;
};

export async function GET(request: Request): Promise<Response> {
  const busy = limited(request, 'read');
  if (busy) return busy;
  const q = new URL(request.url).searchParams;
  // 모르는 값이 붙은 주소는 저장소를 읽기 전에 거절 — 아무 값이나 붙여 CDN 캐시를 비켜 가며 무료 한도를 쓰지 못하게 (2026-10-14 점검)
  if ([...q.keys()].some((k) => k !== 'hero')) return json({ error: 'hero' }, 400);
  const hero = heroParam(q.get('hero'));
  // 화면이 보내는 꼴(?hero=7)만 — '07' · ?hero=7& 같은 다른 주소로 CDN 캐시를 비켜 가지 못하게 (#19 리뷰)
  if (!hero || q.get('hero') !== String(hero) || !canonicalQuery(request, ['hero'])) return json({ error: 'hero' }, 400);
  try {
    const ids = await redis<string[]>('ZRANGE', approvedKey(hero), '+inf', '-inf', 'BYSCORE', 'REV', 'LIMIT', 0, 100);
    const tips = (await loadTips(ids)).filter((t) => t.status === 'approved').map(toPublic);
    // stale-if-error — 저장소가 멈춰 503 이면 CDN 이 하루 동안 옛 응답을 대신 준다 (#21)
    return json({ tips }, 200, { 'cache-control': 'public, s-maxage=60, stale-while-revalidate=300, stale-if-error=86400' });
  } catch (e) {
    return storeDown(e) ?? json({ error: 'server' }, 500);
  }
}

const fail = (error: TipError, status = 400) => json({ ok: false, error }, status);

export async function POST(request: Request): Promise<Response> {
  const busy = limited(request, 'write');
  if (busy) return busy;
  if (!sameOrigin(request)) return fail('auth', 403);
  const session = await userSession(request).catch(() => null);
  if (!session) return fail('auth', 401);

  let body: { hero?: unknown; text?: unknown; website?: unknown; display?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return fail('server');
  }
  if (!body || typeof body !== 'object') return fail('server'); // JSON null · 숫자 (#78)
  // 봇 함정 칸에 뭔가 들어왔으면 성공한 척하고 버린다 (봇이 다시 시도하지 않게)
  if (typeof body.website === 'string' && body.website.trim()) return json({ ok: true });
  const hero = heroParam(body.hero);
  if (!hero || typeof body.text !== 'string') return fail('server');
  const text = normalizeTip(body.text);
  const problem = checkTip(text);
  if (problem) return fail(problem);

  try {
    if (!(await isHeroId(hero))) return fail('server'); // 실제 출시 영웅만 (2026-10-14 점검) — 저장소를 읽으니 try 안에서 (#21)
    if ((await redis<number>('SISMEMBER', 'tips:banned', session.a)) === 1) return fail('banned', 403);
    const day = new Date().toISOString().slice(0, 10);
    const hour = new Date().toISOString().slice(0, 13);
    if ((await bump(`rate:ip:${clientIp(request)}:${hour}`, 7200)) > 10) return fail('rate', 429);
    if ((await bump(`rate:acct:${session.a}:${day}`, 2 * 86400)) > TIP_DAILY_LIMIT) return fail('rate', 429);

    const who = await authorSnapshot(session.a, hero);
    const now = Math.floor(Date.now() / 1000);
    const tip: StoredTip = {
      id: crypto.randomUUID(),
      hero,
      text,
      accountId: session.a,
      name: (who.name ?? session.n).slice(0, 40),
      rank: who.rank,
      games: who.games,
      display: isAuthorDisplay(body.display) ? body.display : DEFAULT_DISPLAY,
      createdAt: now,
      status: 'approved',
      approvedAt: now,
    };
    await pipeline([
      ['SET', tipKey(tip.id), JSON.stringify(tip)],
      ['ZADD', approvedKey(hero), now, tip.id],
    ]);
    // 쓴 사람 화면에 바로 붙일 수 있게 공개된 모양 그대로 돌려준다 (목록은 CDN 이 1분 캐시)
    return json({ ok: true, tip: toPublic(tip) });
  } catch (e) {
    return storeDown(e) ?? fail('server', 500);
  }
}
