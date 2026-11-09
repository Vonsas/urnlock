/**
 * 관리자 로그인 — 환경 변수 ADMIN_PASSWORD 와 같으면 12시간짜리 관리자 쿠키 (관리 요청 경로에만 실려 간다).
 * 틀린 시도는 IP 당 15분에 5번까지 (비밀번호 맞히기 막기). 그 앞에 Cloudflare Access 확인 (#76, _lib/access.ts).
 */
import { clientIp, json, proxyBlocked, sameOrigin, storeDown } from '../_lib/http.js';
import { bump, redis } from '../_lib/redis.js';
import { adminCookie, clearAdminCookie, safeEqual } from '../_lib/session.js';
import { limited } from '../_lib/limit.js';
import { accessBlocked } from '../_lib/access.js';

async function handlePost(request: Request): Promise<Response> {
  const busy = limited(request, 'auth');
  if (busy) return busy;
  // Access(#76)를 거치지 않았으면 비밀번호 시도로 세지도 않는다
  const denied = await accessBlocked(request);
  if (denied) return denied;
  if (!sameOrigin(request)) return json({ ok: false }, 403);
  const expected = process.env.ADMIN_PASSWORD ?? '';
  if (expected.length < 12) return json({ ok: false, error: 'not-configured' }, 500);
  const key = `rate:login:${clientIp(request)}`;
  // 먼저 세고 판단한다 — 읽고 나서 틀릴 때만 세면 동시에 여러 번 보내 5번 제한을 넘길 수 있었다 (2026-10-14 점검)
  if ((await bump(key, 900)) > 5) return json({ ok: false, error: 'rate' }, 429);
  const { password } = (await request.json().catch(() => ({}))) as { password?: unknown };
  if (typeof password !== 'string' || !(await safeEqual(password, expected))) return json({ ok: false, error: 'wrong' }, 401);
  await redis('DEL', key);
  return json({ ok: true }, 200, { 'set-cookie': await adminCookie() });
}

/** 관리자 로그아웃 */
export function DELETE(request: Request): Response {
  const blocked = proxyBlocked(request); // 세지는 않아도 입구 검사(#51)는 한다
  if (blocked) return blocked;
  return json({ ok: true }, 200, { 'set-cookie': clearAdminCookie() });
}

export async function POST(request: Request): Promise<Response> {
  try {
    return await handlePost(request);
  } catch (e) {
    // 저장소에 닿지 못하면 503 readonly (#21) — 예전엔 처리 안 된 오류로 Vercel 기본 500 이었다
    return storeDown(e) ?? json({ ok: false, error: 'server' }, 500);
  }
}
