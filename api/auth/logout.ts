/**
 * 로그아웃 — POST 로만 (2026-10-14 점검: GET 이면 다른 사이트가 <img src="/api/auth/logout"> 로 몰래 로그아웃시킬 수 있었다).
 * 같은 사이트 요청만 받아 서명 쿠키와 헤더 표시 쿠키를 지운다. 화면은 scripts/account.ts 가 로그아웃 링크를 누르면 이걸 부른 뒤 돌아갈 주소로 간다.
 * GET 은 쿠키를 건드리지 않고 돌아갈 주소로만 보낸다 (예전 링크·열려 있던 옛 페이지용).
 */
import { json, proxyBlocked, redirect, safeReturn, sameOrigin } from '../_lib/http.js';
import { clearUserCookies } from '../_lib/session.js';
import { limited } from '../_lib/limit.js';

export function POST(request: Request): Response {
  const busy = limited(request, 'auth');
  if (busy) return busy;
  if (!sameOrigin(request)) return json({ ok: false }, 403);
  const h = new Headers({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  for (const [k, v] of clearUserCookies()) h.append(k, v);
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: h });
}

// GET 은 이동뿐이라 요청 수 제한을 걸지 않는다 (#18 — 다른 사이트가 불러 방문자 IP 를 막지 못하게)
export function GET(request: Request): Response {
  const blocked = proxyBlocked(request); // 세지는 않아도 입구 검사(#51)는 한다
  if (blocked) return blocked;
  return redirect(safeReturn(new URL(request.url).searchParams.get('return')));
}
