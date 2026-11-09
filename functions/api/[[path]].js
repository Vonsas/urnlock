// Cloudflare Pages `/api` 프록시 함수 (#52 = #46-③, 2026-10-30) — 설계 docs/plan-cloudflare-split.md 3절 '프록시 함수(③)가 할 일'.
// `/api/` 아래 모든 경로를 Vercel(origin.urnlock.com)로 그대로 넘긴다. 정적 파일은 dist/_routes.json 이 이 함수를 안 거치게 한다
// (tools/build-pages-config.mjs 가 만든다 — 정적 요청은 함수 호출로 세지 않아 무료 · 무제한, 함수는 하루 10만 건 무료).
//
// 프록시 → Vercel 계약 (②(#51) 가 api/_lib/http.ts 에서 같은 이름으로 읽는다):
//   x-urnlock-proxy-key   Pages 시크릿 PROXY_SECRET — Vercel 의 PROXY_SECRET(또는 교체 중 PROXY_SECRET_PREV)과 같아야 아래 두 값을 믿는다
//   x-urnlock-client-ip   방문자 IP (cf-connecting-ip)
//   x-urnlock-origin      방문자가 연 주소의 origin (www · urnlock.pages.dev) — 스팀 realm · return_to · 같은 사이트 검사 기준
// 방문자가 이 이름들을 직접 넣어 보내도 새 헤더를 만들며 버리고 다시 붙인다 (위조 막기).
//
// 환경 변수 (Pages 프로젝트 urnlock → Settings → Variables and Secrets, Production):
//   PROXY_SECRET  (시크릿, 필수) — 없으면 Vercel 로 보내지 않고 503: 비밀값 없이 보내면 모든 방문자가 Cloudflare 출구 IP 몇 개로 묶여 세진다
//   PROXY_ORIGIN  (선택) — 기본 https://origin.urnlock.com. 로컬 확인(`wrangler pages dev --binding PROXY_ORIGIN=…`) 때만 바꾼다.
//                 https 만 받는다(로컬 127.0.0.1 · localhost 만 http). wrangler.toml 이 있으면 일반 변수는 그 파일이 기준이라 대시보드 값이 안 먹을 수 있다 — 운영엔 넣지 않는다
// 호환 날짜는 wrangler.toml 의 compatibility_date(2024-11-11 이후 — fetch 의 cache: 'no-store' 가 그때부터 동작).
// cache: 'no-store' 면 workerd 가 Vercel 로 가는 요청에 cache-control: no-cache · pragma: no-cache 를 붙인다 — 그래도 Vercel CDN 은 HIT 이 난다
// (2026-11-06 확인: MISS 가 잦은 건 지역마다 캐시가 따로라서). 공개 GET 은 아래 #75 캐시가 먼저 받는다.
// 시간 제한 30초에는 요청 본문을 올리는 시간도 들어간다 — 아주 느린 회선의 1MB 사진은 걸릴 수 있다.
//
// 공개 GET 캐시 (#75, 2026-11-06) — 가이드 목록 · 한 편 · 팁 목록을 Cloudflare 캐시(caches.default, 데이터센터마다)에 60초 담아 둔다.
// Vercel CDN 의 60초 캐시(#19)는 지역마다 따로라(hnd1 · kix1 · hkg1 …) 프록시 경유에선 MISS 가 잦았고, 맞아도 Vercel 요청 한도는 그대로 쓴다.
// 담는 조건은 isCacheable(요청) · storable(응답) 둘 다 — 주소만으로 키를 만들고(쿠키 · 헤더 무시) 사람마다 다른 응답(?me=1 · 세션 · 쓰기 · 관리자)은 절대 담지 않는다.
// 동작은 Vercel 쪽 cache-control(s-maxage=60, stale-while-revalidate=300, stale-if-error=86400)을 그대로 흉내 낸다 — Vercel 이 s-maxage 를
// 떼고 'public' 만 넘겨 주므로 시간은 여기 숫자로 둔다 (api/guides.ts · api/tips.ts 의 값을 바꾸면 같이).
// 함수 호출 수는 줄지 않는다(함수가 먼저 돈 뒤 캐시를 본다 — Pages 함수 앞에서 Cache Rule 로 받는 방법은 없다). 줄어드는 건 Vercel 요청 · 함수 · Upstash 명령.
// 응답에 x-urnlock-cache: HIT · STALE · MISS (캐시 대상일 때만) — 확인용.

const DEFAULT_ORIGIN = 'https://origin.urnlock.com';
/** 스팀 로그인 콜백은 스팀 확인에 8초까지 기다린 뒤 저장소 · 작성자 조회를 하고, 함수가 처음 깨어나는 시간도 있다 — 짧으면 Vercel 은 끝까지 처리해
 *  nonce 를 써 버리는데 로그인 쿠키는 버려진다 (설계 2차 리뷰). 사진 올리기(1MB)도 같은 값 */
const TIMEOUT_MS = 30_000;
/** 넘기지 않는 요청 헤더 — 우리 계약 헤더(다시 붙임, 밑줄 변형 포함) · Cloudflare · Vercel 이 붙이는 값 · 방문자 IP 를 흉내 내는 이름 · 연결 정보(fetch 가 주소로 다시 만든다) */
const DROP_EXACT = new Set(['host', 'x-forwarded-for', 'x-forwarded-proto', 'x-forwarded-host', 'forwarded', 'x-real-ip', 'true-client-ip', 'x-client-ip', 'cdn-loop']);
/** cf- 로 시작해도 넘기는 것 — Cloudflare Access 가 www 의 /api/admin/* 에 붙이는 서명 토큰 (#76, Vercel 이 api/_lib/access.ts 에서 확인. 서명돼 있어 흉내 낼 수 없다) */
const KEEP = new Set(['cf-access-jwt-assertion']);
const DROP = (name) => !KEEP.has(name) && (/^x[-_]urnlock[-_]/.test(name) || name.startsWith('cf-') || name.startsWith('x-vercel-') || DROP_EXACT.has(name));
/** origin 은 https 만 — 로컬 확인(wrangler pages dev)의 127.0.0.1 · localhost 만 http 허용. 다른 값이면 비밀값을 엉뚱한 곳에 보내지 않게 503 */
const allowedOrigin = (u) => u.protocol === 'https:' || (u.protocol === 'http:' && (u.hostname === '127.0.0.1' || u.hostname === 'localhost'));

/** 캐시 — 새것으로 주는 시간 · 그 뒤 옛것을 주며 뒤에서 새로 받는 시간 · Vercel 이 고장 났을 때 옛것을 주는 시간 (초) */
const FRESH_S = 60;
const REVALIDATE_S = 300;
const IF_ERROR_S = 86_400;
const CACHED_AT = 'x-urnlock-cached-at';

/** 캐시해도 되는 요청 — 공개 GET 세 가지만. 주소 꼴(canonicalQuery)은 Vercel 이 가린다: 다른 꼴은 400 · 404 라 아래 storable 에서 걸러진다 */
function isCacheable(request, url) {
  if (request.method !== 'GET') return false;
  if (url.pathname === '/api/tips') return true;
  // ?me=1(그 글의 내 정보 — 추천 여부 · 내 글 · 작성자 원본)은 사람마다 다르다
  return url.pathname === '/api/guides' && !url.searchParams.has('me');
}

/** 담아도 되는 응답 — 200 · Set-Cookie 없음 · Vercel 이 public 으로 낸 것 (no-store · private 면 안 됨). 오류 · 404 는 담지 않는다 */
function storable(res) {
  if (res.status !== 200 || res.headers.has('set-cookie')) return false;
  const cc = (res.headers.get('cache-control') ?? '').toLowerCase();
  if (!/\bpublic\b/.test(cc) || /\b(no-store|private|no-cache)\b/.test(cc)) return false;
  return !(res.headers.get('vary') ?? '').includes('*');
}

/** 우리 서버의 '없는 글' 답인가 — 404 · public · Vercel 방화벽이 막은 응답이 아님 */
function goneAnswer(res) {
  if (res.status !== 404 || res.headers.has('x-vercel-mitigated')) return false;
  return /\bpublic\b/.test((res.headers.get('cache-control') ?? '').toLowerCase());
}

/** Vercel 에 닿지 못함 — 503 + Retry-After 30. limit.ts(429) · storeDown(503) 와 같은 모양(error · problem.error 둘 다)이라 화면의 #21 읽기 전용이 그대로 알아본다 */
const unavailable = () =>
  new Response(JSON.stringify({ ok: false, error: 'unavailable', problem: { error: 'unavailable' } }), {
    status: 503,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'retry-after': '30' },
  });

export async function onRequest(context) {
  const { request, env } = context;
  const secret = env.PROXY_SECRET;
  if (!secret) {
    console.error('[proxy] PROXY_SECRET 이 없어 Vercel 로 보내지 않음');
    return unavailable();
  }
  const ip = request.headers.get('cf-connecting-ip');
  if (!ip) return new Response(JSON.stringify({ ok: false, error: 'bad-request', problem: { error: 'bad-request' } }), { status: 400, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

  const visited = new URL(request.url);
  let origin;
  try {
    origin = new URL(env.PROXY_ORIGIN || DEFAULT_ORIGIN);
  } catch {
    origin = null;
  }
  if (!origin || !allowedOrigin(origin)) {
    console.error('[proxy] PROXY_ORIGIN 이 https 주소가 아님 — Vercel 로 보내지 않음');
    return unavailable();
  }
  // 주소는 이어 붙여 만든다 — new URL(경로, origin) 은 경로가 '//다른호스트/…' 면 origin 호스트를 버려 비밀값 · 쿠키가 그쪽으로 간다 (#52 1차 리뷰).
  // 이 함수는 /api/* 에만 걸리지만, 경로가 /api/ 로 시작하는지 · 만든 주소가 origin 그대로인지 한 번 더 본다
  const notFound = () => new Response(JSON.stringify({ ok: false, error: 'missing', problem: { error: 'missing' } }), { status: 404, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
  if (!visited.pathname.startsWith('/api/')) return notFound();
  let target;
  try {
    target = new URL(origin.origin + visited.pathname + visited.search);
  } catch {
    return notFound();
  }
  if (target.origin !== origin.origin) return notFound();

  // 원본을 돌면서 지우면 항목을 건너뛰므로 새 Headers 에 골라 담는다
  const headers = new Headers();
  for (const [name, value] of request.headers) if (!DROP(name.toLowerCase())) headers.append(name, value);
  headers.set('x-urnlock-proxy-key', secret);
  headers.set('x-urnlock-client-ip', ip);
  headers.set('x-urnlock-origin', visited.origin);

  if (!isCacheable(request, visited)) return toOrigin(request, target, headers, origin, visited);
  // 캐시 대상은 누구에게나 같은 응답이어야 하므로 로그인 쿠키 · 인증 헤더를 Vercel 에 보내지 않는다 — 서버가 실수로 읽어도 섞이지 않게 (#135 1차 리뷰)
  headers.delete('cookie');
  headers.delete('authorization');
  // waitUntil 은 context 에 묶여 있어 떼어 부르지 않는다
  return cached(request, target, headers, origin, visited, (p) => context.waitUntil(p));
}

/** 공개 GET — 캐시에서 주거나, Vercel 에서 받아 담는다. 캐시를 못 쓰면(pages.dev · 로컬 등) 그냥 Vercel 로 */
async function cached(request, target, headers, origin, visited, waitUntil) {
  // 키는 주소만 — 방문자의 쿠키 · 헤더는 넣지 않는다 (응답이 주소로만 정해지는 엔드포인트라)
  const key = new Request(visited.origin + visited.pathname + visited.search, { method: 'GET' });
  let cache = null;
  let hit = null;
  try {
    cache = caches.default;
    hit = await cache.match(key);
  } catch (e) {
    console.error(`[proxy] 캐시를 읽지 못함: ${e?.message ?? e}`);
  }
  const age = hit ? (Date.now() - Number(hit.headers.get(CACHED_AT) || 0)) / 1000 : Infinity;
  /** 뒤에서 할 일 — 함수로 받아 바로 던지는 오류까지 잡는다 (캐시 일이 실패해도 방문자 응답은 그대로) */
  const later = (job) => {
    const p = Promise.resolve()
      .then(job)
      .catch((e) => console.error(`[proxy] 캐시 일 실패: ${e?.message ?? e}`));
    try {
      waitUntil(p);
    } catch {
      /* waitUntil 이 없으면 기다리지 않는다 */
    }
  };
  /** Vercel 에서 받아 담을 수 있으면 담는다 — 받은 응답은 방문자용으로 한 번 더 만들어 돌려준다 */
  const refresh = async () => {
    const res = await toOrigin(request, target, headers, origin, visited);
    if (!cache) return res;
    if (!storable(res)) {
      // 우리 서버가 '그 글은 없다' 고 확실히 답했으면(404 + public — api/guides.ts 의 없는 글 응답) 옛것을 지운다 — 지운 · 내린 글이 360초 · 고장 때 하루까지
      // 남지 않게 (#135 1차 리뷰). 그 밖의 403 · 401 · 429 · 5xx 는 지우지 않는다: 프록시가 방문자 User-Agent 를 넘겨 Vercel 봇 규칙이 curl 같은 요청에
      // 403(x-vercel-mitigated)을 주므로, 그걸로 지우면 봇 하나가 모두의 캐시 · 고장 대비 사본을 날린다 (#135 2차 리뷰)
      if (goneAnswer(res)) later(() => cache.delete(key));
      return res;
    }
    let body;
    try {
      body = await res.arrayBuffer();
    } catch (e) {
      // 본문을 받다 끊기면 Vercel 고장으로 본다 — 아래에서 옛것이 있으면 그걸 준다
      console.error(`[proxy] Vercel 응답을 끝까지 받지 못함: ${e?.message ?? e}`);
      return unavailable();
    }
    const keep = new Headers(res.headers);
    // Vercel CDN 에서 이미 묵은 응답이면(age) 그만큼 먼저 담은 것으로 친다 — 두 캐시의 60초가 겹쳐 옛 본문이 더 오래 남지 않게
    const upstreamAge = Math.min(Math.max(Number(res.headers.get('age')) || 0, 0), FRESH_S);
    keep.set(CACHED_AT, String(Date.now() - upstreamAge * 1000));
    // Cloudflare 캐시가 들고 있을 시간 = 고장 때 옛것을 주는 시간까지 (새것인지는 CACHED_AT 으로 따로 본다)
    keep.set('cache-control', `public, max-age=${IF_ERROR_S}`);
    keep.delete('x-urnlock-cache');
    // 받은 본문은 이미 풀린 것(fetch 가 압축을 푼다) — 압축 표시 · 길이 · Vary 는 떼고 담는다 (꺼낼 때 Cloudflare 가 다시 압축한다)
    for (const h of ['content-encoding', 'content-length', 'vary']) keep.delete(h);
    later(() => cache.put(key, new Response(body, { status: res.status, headers: keep })));
    return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
  };
  if (hit && age < FRESH_S) return fromCache(hit, age, 'HIT', request);
  if (hit && age < FRESH_S + REVALIDATE_S) {
    // 옛것을 주고 뒤에서 새로 받는다 (stale-while-revalidate)
    later(refresh);
    return fromCache(hit, age, 'STALE', request);
  }
  const res = await refresh();
  // Vercel 이 고장(5xx · 닿지 못함)이면 하루 안의 옛것을 준다 (stale-if-error — Vercel CDN 과 같다)
  if (hit && res.status >= 500 && age < IF_ERROR_S) return fromCache(hit, age, 'STALE', request);
  const out = new Headers(res.headers);
  out.set('x-urnlock-cache', 'MISS');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: out });
}

/** 캐시에 담긴 응답을 방문자에게 — 담을 때 바꾼 cache-control 은 Vercel 이 준 값('public')으로 되돌린다 */
function fromCache(hit, age, state, request) {
  const out = new Headers(hit.headers);
  out.delete(CACHED_AT);
  out.set('cache-control', 'public');
  out.set('age', String(Math.max(0, Math.floor(age))));
  out.set('x-urnlock-cache', state);
  // 담긴 본문은 풀린 것 — 방문자가 gzip 을 받으면 Content-Encoding 만 붙이면 런타임이 압축해 보낸다 (Workers 의 encodeBody 'automatic').
  // 안 붙이면 Cloudflare 가 압축하지 않아 목록 · 한 편이 3–4배 크게 나간다 (#75 머지 뒤 www 에서 확인)
  out.append('vary', 'accept-encoding');
  if (acceptsGzip(request)) out.set('content-encoding', 'gzip');
  return new Response(hit.body, { status: hit.status, headers: out });
}

/** Accept-Encoding 에 gzip 이 있고 q=0(거절)이 아닌가 */
function acceptsGzip(request) {
  return (request.headers.get('accept-encoding') ?? '')
    .toLowerCase()
    .split(',')
    .some((part) => {
      const [name, ...params] = part.split(';').map((x) => x.trim());
      if (name !== 'gzip' && name !== '*') return false;
      const q = params.find((x) => x.startsWith('q='));
      return !q || Number(q.slice(2)) > 0;
    });
}

/** Vercel 로 그대로 넘긴다 */
async function toOrigin(request, target, headers, origin, visited) {
  let res;
  try {
    res = await fetch(target, {
      method: request.method,
      headers,
      body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
      redirect: 'manual',
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    console.error(`[proxy] Vercel 에 닿지 못함: ${e?.name ?? ''} ${e?.message ?? e}`);
    return unavailable();
  }
  // Vercel 이 게이트웨이 오류(502 · 504)를 내면 우리 503 으로 — Vercel 이 직접 낸 503(저장소 readonly 등)은 그대로 넘긴다
  if (res.status === 502 || res.status === 504) return unavailable();

  // 상태 · 본문 · 헤더 그대로 (set-cookie 가 여러 개여도 모두). Location 이 origin 주소면 방문 주소로 (지금 코드는 상대 경로 · 스팀만 내지만 안전망)
  const out = new Headers(res.headers);
  const location = out.get('location');
  if (location) {
    try {
      const loc = new URL(location, origin);
      if (loc.origin === origin.origin) out.set('location', visited.origin + loc.pathname + loc.search + loc.hash);
    } catch {
      /* 주소가 아니면 그대로 */
    }
  }
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: out });
}
