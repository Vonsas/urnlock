/**
 * 지금 로그인한 사람 — 가이드 탭이 쓰기 칸을 보여줄지 정할 때 (서명 쿠키는 스크립트가 못 읽으므로).
 * 헤더 표시 쿠키(ul_who)가 생기기 전에 로그인한 사람이면 여기서 붙여 준다.
 */
import { cookies, json } from './_lib/http.js';
import { WHO_COOKIE, userSession, whoCookieFor } from './_lib/session.js';
import { limited } from './_lib/limit.js';

export async function GET(request: Request): Promise<Response> {
  const busy = limited(request, 'read');
  if (busy) return busy;
  const s = await userSession(request).catch(() => null);
  if (!s) return json({});
  return json({ account: { id: s.a, name: s.n } }, 200, cookies(request)[WHO_COOKIE] ? {} : { 'set-cookie': whoCookieFor(s) });
}
