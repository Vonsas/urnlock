/**
 * 가이드 사진 올리기 (2026-10-06) — POST /api/guide-image, 본문 = WebP 파일 그대로 (브라우저가 긴 변 1600px 로 줄여 보낸다)
 * 스팀 인증한 사람만 · 같은 사이트 요청만 · 차단 계정 안 됨 · WebP 인지 파일 머리로 확인 · 1MB · 긴 변 1600px · 사이트 하루 150장 · 계정 하루 20장.
 * 파일 이름에 계정 ID 를 넣지 않는다 — 공개 주소라 익명 가이드의 글쓴이가 드러났다 (2026-10-14 점검). 올린 사람은 img:{주소} 기록에 있다.
 * 올리면 바로 공개 (2026-10-09 — 운영자는 /admin [사진] 에서 지우기만). 저장소는 Cloudflare R2 (#34).
 */
import { json, sameOrigin, storeDown } from './_lib/http.js';
import { IMAGE_MAX_BYTES, IMAGE_MAX_SIDE, IMAGES_PER_DAY_ACCOUNT, IMAGES_PER_DAY_SITE, UNUSED, imageKey, imagesConfigured, storeImage, sweepUnused, webpSize } from './_lib/images.js';
import { bump, pipeline, redis } from './_lib/redis.js';
import { userSession } from './_lib/session.js';
import { limited } from './_lib/limit.js';

export async function POST(request: Request): Promise<Response> {
  const busy = limited(request, 'write');
  if (busy) return busy;
  if (!sameOrigin(request)) return json({ error: 'auth' }, 403);
  const session = await userSession(request).catch(() => null);
  if (!session) return json({ error: 'auth' }, 401);
  if (!imagesConfigured()) return json({ error: 'off' }, 503);
  if (Number(request.headers.get('content-length') ?? 0) > IMAGE_MAX_BYTES) return json({ error: 'size' }, 413);

  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.length > IMAGE_MAX_BYTES) return json({ error: 'size' }, 413);
  const size = webpSize(bytes);
  if (!size || !size.w || !size.h || size.w > IMAGE_MAX_SIDE || size.h > IMAGE_MAX_SIDE) return json({ error: 'type' }, 415);

  try {
    if ((await redis<number>('SISMEMBER', 'tips:banned', session.a)) === 1) return json({ error: 'banned' }, 403);
    const day = new Date().toISOString().slice(0, 10);
    if ((await bump(`rate:img:${session.a}:${day}`, 2 * 86400)) > IMAGES_PER_DAY_ACCOUNT) return json({ error: 'rate' }, 429);
    if ((await bump(`rate:img:site:${day}`, 2 * 86400)) > IMAGES_PER_DAY_SITE) return json({ error: 'rate' }, 429);

    // 저장소는 Cloudflare R2 (#34, images.ts)
    const url = await storeImage(bytes);
    const now = Math.floor(Date.now() / 1000);
    await pipeline([
      ['SET', imageKey(url), JSON.stringify({ a: session.a, w: size.w, h: size.h }), 'EX', 2 * 86400],
      ['ZADD', UNUSED, now, url],
    ]);
    await sweepUnused().catch(() => {});
    return json({ url, w: size.w, h: size.h });
  } catch (e) {
    return storeDown(e) ?? json({ error: 'server' }, 500);
  }
}
