/**
 * 스팀 인증 돌아옴 — 스팀이 붙여 준 값을 **스팀 서버에 다시 물어** 진짜인지 확인한 뒤(check_authentication) 서명된 쿠키를 준다.
 * 확인 항목: openid.* 값 중복 없음 · 돌아온 주소가 우리 콜백인지 · 스팀 로그인 주소인지 · 계정 주소 모양 · 같은 응답 재사용(nonce) 여부 · 스팀의 is_valid:true.
 */
import { cookies, originOf, redirect, safeReturn, setCookie } from '../_lib/http.js';
import { redis } from '../_lib/redis.js';
import { userCookies } from '../_lib/session.js';
import { authorSnapshot } from '../_lib/tips-store.js';
import { limited } from '../_lib/limit.js';

const STEAM_LOGIN = 'https://steamcommunity.com/openid/login';
const STEAM64_BASE = 76561197960265728n;
/** 스팀 OpenID 응답에 오는 이름 — 이 밖의 openid* 이름이 섞여 오면 거절 */
const OPENID_KEYS = new Set(
  ['ns', 'mode', 'op_endpoint', 'claimed_id', 'identity', 'return_to', 'response_nonce', 'assoc_handle', 'signed', 'sig', 'invalidate_handle'].map((k) => `openid.${k}`),
);
const SIGNED_REQUIRED = ['op_endpoint', 'claimed_id', 'identity', 'return_to', 'response_nonce'];
/** 로그인을 시작한 브라우저 확인용 쿠키 (api/auth/steam.ts 가 심는다) */
const STATE_COOKIE = 'ul_st';

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const q = url.searchParams;
  const back = safeReturn(q.get('return'));
  // 실패 표시는 # 앞에 붙인다 (/ko/heroes/x/#guide → /ko/heroes/x/?auth=failed#guide)
  const fail = () => {
    const [path, hash = ''] = back.split('#');
    return redirect(`${path}${path.includes('?') ? '&' : '?'}auth=failed${hash ? `#${hash}` : ''}`);
  };

  // openid* 는 정해진 이름만 · 한 번씩만 (2026-10-14 점검) — 같은 이름이 두 번 오거나 'openid.claimed.id' 처럼 스팀이 같은 이름으로 읽을 수 있는 변형이 오면
  // 여기서 검사한 값과 스팀이 확인하는 값이 달라져 남의 계정으로 로그인하는 위조가 가능했다
  const keys = [...q.keys()].filter((k) => k.startsWith('openid'));
  if (new Set(keys).size !== keys.length || keys.some((k) => !OPENID_KEYS.has(k))) return fail();
  // 서명에 계정 · 돌아올 주소 · nonce 가 들어 있어야 한다
  const signed = new Set((q.get('openid.signed') ?? '').split(','));
  if (!SIGNED_REQUIRED.every((k) => signed.has(k)) || !q.get('openid.sig') || !q.get('openid.assoc_handle')) return fail();

  const state = cookies(request)[STATE_COOKIE] ?? '';
  const claimed = q.get('openid.claimed_id') ?? '';
  const match = /^https:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/.exec(claimed);
  const returnTo = q.get('openid.return_to') ?? '';
  if (
    q.get('openid.mode') !== 'id_res' ||
    q.get('openid.op_endpoint') !== STEAM_LOGIN ||
    !match ||
    q.get('openid.identity') !== claimed ||
    !returnTo.startsWith(`${originOf(request)}/api/auth/steam-callback`) ||
    // 로그인을 시작한 이 브라우저인지 — 남이 자기 로그인 결과 주소를 보내 '그 사람 계정으로 로그인된 상태' 를 만들지 못하게
    // (스팀 서명 안의 return_to 에 든 state 와 쿠키를 비교)
    !state ||
    new URL(returnTo).searchParams.get('state') !== state
  ) {
    return fail();
  }

  // 요청 수 제한(#18)은 이 브라우저가 시작한 로그인인지 본 뒤에 센다 — 앞에서 세면 다른 사이트가 방문자 브라우저로 이 주소를 불러
  // 방문자 IP 를 막을 수 있다. 여기까지 오려면 state 쿠키와 돌아올 주소의 state 가 맞아야 해서(스팀 서명 확인은 이 뒤) 저장소 · 스팀 확인으로 가는 길만 센다
  const busy = limited(request, 'auth');
  if (busy) return busy;

  // 스팀에 직접 확인 — 받은 openid.* 값을 그대로 돌려보내고 mode 만 바꾼다
  const check = new URLSearchParams();
  for (const k of keys) check.set(k, q.get(k)!);
  check.set('openid.mode', 'check_authentication');
  try {
    const res = await fetch(STEAM_LOGIN, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: check,
      signal: AbortSignal.timeout(8000),
    });
    if (!/is_valid\s*:\s*true/.test(await res.text())) return fail();
    // 같은 응답을 다시 쓰는 것 막기 — 한 번 쓴 nonce 는 하루 동안 기억
    const nonce = q.get('openid.response_nonce');
    if (!nonce || (await redis('SET', `nonce:${nonce}`, '1', 'NX', 'EX', 86400)) !== 'OK') return fail();
  } catch {
    return fail();
  }

  const accountId = Number(BigInt(match[1]) - STEAM64_BASE);
  const { name } = await authorSnapshot(accountId, 0);
  const done: Array<[string, string]> = [...(await userCookies(accountId, (name ?? `ID ${accountId}`).slice(0, 40))), ['set-cookie', setCookie(STATE_COOKIE, '', { maxAge: 0, path: '/api/auth' })]];
  return redirect(back, done);
}
