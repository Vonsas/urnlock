/** 함수 공용 — 응답·쿠키·주소 검사 */
import { StoreError } from './redis.js';

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } });

/** 이동 — 쿠키를 여러 개 심을 수 있게 [이름, 값] 목록도 받는다 (set-cookie 는 겹쳐 보내야 해서) */
export function redirect(location: string, headers: Record<string, string> | Array<[string, string]> = {}) {
  const h = new Headers({ location, 'cache-control': 'no-store' });
  for (const [k, v] of Array.isArray(headers) ? headers : Object.entries(headers)) h.append(k, v);
  return new Response(null, { status: 302, headers: h });
}

export function cookies(request: Request): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (request.headers.get('cookie') ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function setCookie(name: string, value: string, opts: { maxAge: number; path?: string; sameSite?: 'Lax' | 'Strict' }) {
  return `${name}=${encodeURIComponent(value)}; Path=${opts.path ?? '/'}; Max-Age=${opts.maxAge}; HttpOnly; Secure; SameSite=${opts.sameSite ?? 'Lax'}`;
}

/** 사이트 주소 (요청이 들어온 주소 기준 — www.urnlock.com, 미리보기 배포도 그대로 동작) */
export const originOf = (request: Request) => new URL(request.url).origin;

/**
 * 다른 사이트가 사용자 몰래 보내는 요청(CSRF) 막기 — 글쓰기·관리 요청은 같은 사이트에서 온 것만.
 * 브라우저가 붙이는 Origin(없으면 Sec-Fetch-Site)으로 판단한다.
 */
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (origin) return origin === originOf(request);
  return request.headers.get('sec-fetch-site') === 'same-origin';
}

/** 로그인 뒤 돌아갈 주소 — 우리 사이트 안의 경로만 (다른 사이트로 넘기는 데 악용되지 않게) */
export function safeReturn(value: string | null, fallback = '/'): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return fallback;
  // 공백·제어 문자도 막는다 — 브라우저는 주소 속 탭·줄바꿈을 지워서 '/<탭>/evil.com' 이 '//evil.com' 이 됐다 (2026-10-14 점검)
  // 인쇄 가능한 ASCII 만 — 한글 등이 그대로 오면 Location 헤더에서 500 이 났다
  if (/[^\x21-\x7e]/.test(value)) return fallback;
  return value.slice(0, 300);
}

/**
 * 캐시되는 GET 의 주소가 화면이 보내는 꼴 그대로인지 — 같은 내용을 다른 주소(?id=x&, ?&id=x, ?%69d=x, 값 퍼센트 인코딩 …)로
 * 불러 CDN 캐시를 비켜 가며 함수 · 저장소 한도를 쓰지 못하게 (#19 리뷰, 2026-10-29). keys 순서대로, 있는 값만, 그대로 이어 붙인 꼴만 받는다
 */
export function canonicalQuery(request: Request, keys: string[]): boolean {
  const url = new URL(request.url);
  const q = url.searchParams;
  const parts = keys.filter((k) => q.has(k)).map((k) => `${k}=${encodeURIComponent(q.get(k)!)}`);
  return url.search === (parts.length ? `?${parts.join('&')}` : '');
}

/**
 * 방문자 IP — Vercel 이 넣는 x-vercel-forwarded-for 를 먼저 (Vercel 은 x-forwarded-for 도 덮어써서 위조된 값을 넘기지 않지만,
 * Vercel 앞에 프록시를 두면 x-forwarded-for 는 그 프록시 것이 될 수 있다 — Vercel 문서 'Request headers', #18 확인)
 */
export const clientIp = (request: Request) =>
  (request.headers.get('x-vercel-forwarded-for') ?? request.headers.get('x-real-ip') ?? request.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown';

/**
 * 저장소에 닿지 못했으면(#21 — 시간 초과 · 한도 초과 · 오류) 503 'readonly', 아니면 null. 핸들러의 catch 에서 `return storeDown(e) ?? 원래 오류`.
 * 503 이라 CDN 이 캐시해 둔 옛 응답을 대신 준다(stale-if-error). 화면은 쓰기를 잠시 막고 읽기는 정적 스냅샷으로 그린다.
 */
export const storeDown = (e: unknown): Response | null =>
  e instanceof StoreError ? json({ ok: false, error: 'readonly', problem: { error: 'readonly' } }, 503, { 'retry-after': '60' }) : null;
