/**
 * 스팀 인증 시작 — 스팀 공식 로그인 창(OpenID 2.0)으로 보낸다. 비밀번호는 스팀에서만 입력하고 우리는 받지 않는다.
 * 돌아올 곳: /api/auth/steam-callback (원래 보던 페이지 주소를 return 으로 들고 간다)
 * state — 무작위 값을 쿠키(ul_st)와 돌아올 주소 양쪽에 넣어, 돌아왔을 때 이 브라우저가 시작한 로그인인지 확인한다 (로그인 위조 막기, 2026-10-14)
 */
import { originOf, proxyBlocked, redirect, safeReturn, setCookie } from '../_lib/http.js';

// 요청 수 제한(#18)은 걸지 않는다 — 저장소를 안 쓰는 이동뿐이라, 걸면 다른 사이트가 방문자 브라우저로 11번 불러 로그인을 막을 수 있다
export function GET(request: Request): Response {
  const blocked = proxyBlocked(request); // 세지는 않아도 입구 검사(#51)는 한다
  if (blocked) return blocked;
  const url = new URL(request.url);
  const origin = originOf(request);
  const back = safeReturn(url.searchParams.get('return'));
  // 이 브라우저에서 시작한 로그인인지 돌아올 때 확인한다 (10분, 인증 경로에만)
  const state = crypto.randomUUID().replaceAll('-', '');
  const params = new URLSearchParams({
    'openid.ns': 'http://specs.openid.net/auth/2.0',
    'openid.mode': 'checkid_setup',
    'openid.return_to': `${origin}/api/auth/steam-callback?return=${encodeURIComponent(back)}&state=${state}`,
    'openid.realm': origin,
    'openid.identity': 'http://specs.openid.net/auth/2.0/identifier_select',
    'openid.claimed_id': 'http://specs.openid.net/auth/2.0/identifier_select',
  });
  return redirect(`https://steamcommunity.com/openid/login?${params}`, { 'set-cookie': setCookie('ul_st', state, { maxAge: 600, path: '/api/auth' }) });
}
