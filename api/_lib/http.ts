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
    if (i <= 0) continue;
    // 잘못된 % 가 든 쿠키(우리 것이 아니어도) 하나 때문에 함수 전체가 500 이 나지 않게 그 쿠키만 건너뛴다 (#78)
    try {
      out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      /* 건너뜀 */
    }
  }
  return out;
}

export function setCookie(name: string, value: string, opts: { maxAge: number; path?: string; sameSite?: 'Lax' | 'Strict' }) {
  return `${name}=${encodeURIComponent(value)}; Path=${opts.path ?? '/'}; Max-Age=${opts.maxAge}; HttpOnly; Secure; SameSite=${opts.sameSite ?? 'Lax'}`;
}

/*
 * 프록시 뒤 판별 (#51, 설계 docs/plan-cloudflare-split.md 3절) — www 가 Cloudflare Pages 가 되면 /api 는 Pages 함수가
 * https://origin.urnlock.com 으로 넘긴다. 그때 요청 주소 · IP 는 프록시 것이므로, 프록시가 붙인 헤더를 **비밀값이 맞을 때만** 믿는다.
 *   x-urnlock-proxy-key  비밀값 (Vercel 환경 변수 PROXY_SECRET, 교체 중엔 PROXY_SECRET_PREV 도)
 *   x-urnlock-client-ip  방문자 IP (cf-connecting-ip)
 *   x-urnlock-origin     방문자가 연 주소의 origin — PUBLIC_ORIGINS 목록에 정확히 있을 때만 쓴다
 * 비밀값이 없거나 틀리면 지금처럼(호환 모드). REQUIRE_PROXY=1 이면 그런 /api 요청은 403 (전환 ⑥ 에서 켬).
 */
const PROXY_KEY = 'x-urnlock-proxy-key';
const PROXY_IP = 'x-urnlock-client-ip';
const PROXY_ORIGIN = 'x-urnlock-origin';

/** 일정 시간 비교 — 길이가 달라도 끝까지 돈다 (빈 기대값은 언제나 거짓) */
function sameSecret(given: string, expected: string): boolean {
  if (!expected) return false;
  let diff = given.length ^ expected.length;
  for (let i = 0; i < expected.length; i++) diff |= (given.charCodeAt(i) || 0) ^ expected.charCodeAt(i);
  return diff === 0;
}

/** 비밀값 최소 길이 — 설계는 32바이트 base64url(43자) */
const SECRET_MIN = 32;
const warnedEnv = new Set<string>();
/** 환경 변수 꼴이 틀렸을 때 한 번만 경고 (값은 찍지 않는다) — 전환 때 쓰기 · 로그인이 이유 없이 멈추지 않게 원인을 남긴다 (#59 1차 리뷰) */
function warnEnv(name: string, why: string) {
  if (warnedEnv.has(`${name}:${why}`)) return;
  warnedEnv.add(`${name}:${why}`);
  console.warn(`[dldb:proxy] ${name} ${why} — 없는 값으로 본다`);
}
/** 비밀값 환경 변수 — 앞뒤 공백 · 줄바꿈을 지우고, 32자 미만이면 없는 값으로 본다 */
function secretEnv(name: 'PROXY_SECRET' | 'PROXY_SECRET_PREV'): string {
  const v = (process.env[name] ?? '').trim();
  if (v && v.length < SECRET_MIN) {
    warnEnv(name, `이 ${SECRET_MIN}자보다 짧다`);
    return '';
  }
  return v;
}

/** 프록시(Pages 함수)를 거쳐 온 요청인지 — PROXY_SECRET 이 비어 있으면 언제나 거짓. 헤더가 두 번 오면 ', ' 로 붙어 틀린 값이 된다 */
export function proxied(request: Request): boolean {
  const given = request.headers.get(PROXY_KEY);
  if (given === null) return false;
  const now = secretEnv('PROXY_SECRET');
  const prev = secretEnv('PROXY_SECRET_PREV');
  // 둘 다 비교한다 (어느 쪽이 맞는지에 따라 걸리는 시간이 달라지지 않게)
  const a = sameSecret(given, now);
  const b = sameSecret(given, prev);
  return Boolean(now) && (a || b);
}

/** 공개 주소 목록 — 첫 값이 기본 (예 https://www.urnlock.com,https://urnlock.pages.dev). origin 꼴(https://호스트, 끝 '/' 없음)인 값만 */
function publicOrigins(): string[] {
  const list = (process.env.PUBLIC_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const good = list.filter((s) => {
    try {
      return new URL(s).origin === s && s.startsWith('https://');
    } catch {
      return false;
    }
  });
  if (good.length !== list.length) warnEnv('PUBLIC_ORIGINS', '에 https://호스트 꼴이 아닌 값이 있다(끝 / · scheme 빠짐 등)');
  return good;
}

/**
 * 사이트 주소 — 스팀 로그인 realm · return_to · 콜백 검사, sameOrigin 이 이 값으로 맞춘다.
 * 프록시를 거쳤으면 방문자가 연 주소(목록에 있을 때만, 없으면 목록의 첫 값), 아니면 요청이 들어온 주소(지금 www · 미리보기 배포 그대로).
 */
export function originOf(request: Request): string {
  if (proxied(request)) {
    const list = publicOrigins();
    const seen = request.headers.get(PROXY_ORIGIN) ?? '';
    if (list.includes(seen)) return seen;
    if (list[0]) return list[0];
    warnEnv('PUBLIC_ORIGINS', '이 비어 있어 프록시 뒤에서 요청 주소(origin)를 쓴다 — 스팀 로그인 · 쓰기가 막힌다');
  }
  return new URL(request.url).origin;
}

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
  // 점 구간(/.//evil.com · /..//evil.com)은 정규화하면 '//evil.com' 경로가 된다 — 지금은 우리 호스트 안이지만 막아 둔다 (#78)
  if (new URL(value, 'https://x.invalid').pathname.startsWith('//')) return fallback;
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

/** IPv4 네 칸 */
const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

/** IPv6 → 여덟 칸(16비트씩) 숫자, 꼴이 아니면 null. 끝에 IPv4 가 붙은 꼴(::ffff:1.2.3.4)도 받는다 */
function v6Groups(ip: string): number[] | null {
  // 영역 표시(fe80::1%eth0)는 받지 않는다 — 방문자 IP 에 올 일이 없다 (#59 1차 리뷰, 더 엄격하게)
  if (ip.includes('%')) return null;
  let s = ip.toLowerCase();
  const v4 = /:(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (v4) {
    if (!IPV4.test(v4[1])) return null;
    const [a, b, c, d] = v4[1].split('.').map(Number);
    s = `${s.slice(0, v4.index)}:${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const part = (h: string) => (h === '' ? [] : h.split(':'));
  const head = part(halves[0]);
  const tail = halves.length === 2 ? part(halves[1]) : [];
  const fill = 8 - head.length - tail.length;
  if (halves.length === 1 ? fill !== 0 : fill < 1) return null;
  const all = [...head, ...Array<string>(halves.length === 2 ? fill : 0).fill('0'), ...tail];
  if (!all.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return null;
  return all.map((g) => parseInt(g, 16));
}

/**
 * 셀 때 쓰는 IP 꼴 — IPv4 는 그대로, **IPv6 는 앞 64비트(/64)** 로 줄인다 (집 회선 하나가 /64 를 통째로 받아 주소를 바꿔 가며
 * IP 당 제한을 비켜 갈 수 있어서 — #50 설계 1차 리뷰). IPv4 가 담긴 IPv6(::ffff:a.b.c.d)는 IPv4 로. 꼴이 아니면 null.
 */
export function ipKey(raw: string): string | null {
  const ip = raw.trim();
  if (IPV4.test(ip)) return ip;
  const g = v6Groups(ip);
  if (!g) return null;
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return `${g[6] >> 8}.${g[6] & 255}.${g[7] >> 8}.${g[7] & 255}`;
  return `${g.slice(0, 4).map((x) => x.toString(16)).join(':')}::/64`;
}

/**
 * 방문자 IP(셀 때 쓰는 꼴 — ipKey). 프록시를 거쳤으면 프록시가 넘긴 x-urnlock-client-ip, 아니면 Vercel 이 넣는 x-vercel-forwarded-for 를 먼저
 * (Vercel 은 x-forwarded-for 도 덮어써서 위조된 값을 넘기지 않지만, Vercel 앞에 프록시를 두면 x-forwarded-for 는 그 프록시 것이 될 수 있다 — #18 확인).
 * 프록시가 넘긴 IP 가 꼴이 아니면 'invalid' — 요청 입구(proxyBlocked)가 400 으로 막으므로 여기까지 오지 않는다.
 */
export function clientIp(request: Request): string {
  if (proxied(request)) return ipKey(request.headers.get(PROXY_IP) ?? '') ?? 'invalid';
  const raw = (request.headers.get('x-vercel-forwarded-for') ?? request.headers.get('x-real-ip') ?? request.headers.get('x-forwarded-for') ?? '').split(',')[0].trim();
  return raw ? (ipKey(raw) ?? raw) : 'unknown';
}

/**
 * /api 입구 검사 — 막아야 하면 응답, 아니면 null. 모든 핸들러 맨 앞에서 (`limited()` 가 부르고, 요청 수 제한을 걸지 않는 핸들러는 직접).
 *  - REQUIRE_PROXY=1 인데 프록시를 거치지 않았으면 403 — origin 주소 · *.vercel.app 으로 바로 보내 IP 제한을 비켜 가지 못하게 (전환 ⑥ 에서 켬)
 *  - 프록시를 거쳤는데 방문자 IP 헤더가 없거나 꼴이 아니면 400
 */
export function proxyBlocked(request: Request): Response | null {
  if (proxied(request)) {
    return ipKey(request.headers.get(PROXY_IP) ?? '') ? null : json({ ok: false, error: 'bad-request', problem: { error: 'bad-request' } }, 400);
  }
  if (process.env.REQUIRE_PROXY === '1') return json({ ok: false, error: 'auth', problem: { error: 'auth' } }, 403);
  return null;
}

/**
 * 저장소에 닿지 못했으면(#21 — 시간 초과 · 한도 초과 · 오류) 503 'readonly', 아니면 null. 핸들러의 catch 에서 `return storeDown(e) ?? 원래 오류`.
 * 503 이라 CDN 이 캐시해 둔 옛 응답을 대신 준다(stale-if-error). 화면은 쓰기를 잠시 막고 읽기는 정적 스냅샷으로 그린다.
 */
export const storeDown = (e: unknown): Response | null =>
  e instanceof StoreError ? json({ ok: false, error: 'readonly', problem: { error: 'readonly' } }, 503, { 'retry-after': '60' }) : null;
