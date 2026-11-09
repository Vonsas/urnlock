/**
 * 관리자 API 의 Cloudflare Access 확인 (#76, 2026-11-02) — 비밀번호 앞에 한 겹 더.
 * www 의 /admin* · /api/admin/* 는 Cloudflare Access(이메일 일회용 코드)를 통과해야 닿는다. 그런데 urnlock.pages.dev 와 지난 Pages 배포 주소
 * (xxxx.urnlock.pages.dev — 옛 프록시 코드가 그대로 돈다)는 Access 를 거치지 않고 같은 비밀값으로 Vercel 에 닿아 비밀번호만 남았다.
 * 그래서 Vercel 이 Access 가 붙여 주는 서명 토큰(헤더 `Cf-Access-Jwt-Assertion` · 쿠키 `CF_Authorization`, RS256)을 직접 확인한다 — Access 를 거치지 않은 길은 모두 403.
 *
 * 환경 변수 (Vercel, **Production 에만** — 미리보기 주소엔 Access 가 없어 넣으면 미리보기 관리 화면이 막힌다):
 *   ACCESS_TEAM_DOMAIN  팀 도메인 (예 <팀>.cloudflareaccess.com — Zero Trust → Settings → Team name)
 *   ACCESS_AUD          그 Access 앱의 Application Audience (AUD) Tag (64자 16진 — 앱 → Overview / Basic information)
 * 둘 다 없으면 확인하지 않는다(예전처럼 비밀번호만 — 로컬 · 미리보기). 하나만 있거나 꼴이 틀리면 막는다(503) — 켜려던 것이 조용히 꺼지지 않게.
 * 비밀값이 아니다(공개 키로 확인). 토큰 · 이메일은 로그에 찍지 않는다.
 */
import { cookies, json } from './http.js';

const HEADER = 'cf-access-jwt-assertion';
/** Access 가 브라우저에 심는 같은 토큰 — 헤더가 프록시에서 빠졌을 때 대비 (쿠키는 www 에만 실린다) */
const COOKIE = 'CF_Authorization';
/** 공개 키는 10분 기억 — 받기는 성공 · 실패 상관없이 1분에 한 번까지(모르는 kid · 받기 실패가 이어져도 요청마다 나가지 않게), 동시에 온 요청은 한 번을 같이 기다린다 */
const KEYS_TTL_MS = 10 * 60 * 1000;
const KEYS_RETRY_MS = 60 * 1000;
/** 시계 차이 봐주기 */
const SKEW_S = 60;

type Config = { team: string; aud: string } | 'off' | 'bad';
const warned = new Set<string>();
const warnOnce = (key: string, text: string) => {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(`[dldb:access] ${text}`);
};

function config(): Config {
  const team = (process.env.ACCESS_TEAM_DOMAIN ?? '').trim().toLowerCase();
  const aud = (process.env.ACCESS_AUD ?? '').trim().toLowerCase();
  if (!team && !aud) {
    if (process.env.VERCEL_ENV === 'production') warnOnce('off', 'ACCESS_TEAM_DOMAIN · ACCESS_AUD 가 없어 관리자 API 의 Access 확인이 꺼져 있음 (비밀번호만)');
    return 'off';
  }
  if (/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(team) && /^[0-9a-f]{64}$/.test(aud)) return { team, aud };
  warnOnce('bad', 'ACCESS_TEAM_DOMAIN · ACCESS_AUD 중 하나가 없거나 꼴이 틀림 — 관리자 API 를 막는다 (값은 찍지 않음)');
  return 'bad';
}

/** 마지막으로 받은 키 — 다시 받기에 실패하면 이걸 그대로 쓴다(10분이 지나도 버리지 않음) */
let keys: { at: number; team: string; byKid: Map<string, CryptoKey> } | null = null;
let inflight: Promise<void> | null = null;
let lastAttempt = 0;

/** 공개 키 다시 받기 — 1분에 한 번 · 동시에 하나. 실패하면 경고만 하고 옛 키를 둔다 */
function refresh(team: string): Promise<void> {
  if (inflight) return inflight;
  const now = Date.now();
  if (now - lastAttempt < KEYS_RETRY_MS) return Promise.resolve();
  lastAttempt = now;
  inflight = (async () => {
    try {
      const res = await fetch(`https://${team}/cdn-cgi/access/certs`, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) throw new Error(`access certs ${res.status}`);
      const body = (await res.json()) as { keys?: Array<JsonWebKey & { kid?: string }> };
      const byKid = new Map<string, CryptoKey>();
      for (const k of Array.isArray(body.keys) ? body.keys : []) {
        if (typeof k?.kid !== 'string' || k.kty !== 'RSA') continue;
        // 키 하나가 깨져도 나머지는 쓴다
        try {
          byKid.set(k.kid, await crypto.subtle.importKey('jwk', { kty: 'RSA', n: k.n, e: k.e }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']));
        } catch {
          /* 건너뜀 */
        }
      }
      if (!byKid.size) throw new Error('access certs empty');
      keys = { at: Date.now(), team, byKid };
    } catch (e) {
      console.warn(`[dldb:access] 공개 키 받기 실패 (${e instanceof Error && e.message.startsWith('access ') ? e.message : 'error'}) — 가진 키로 확인`);
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

async function keyFor(team: string, kid: string): Promise<CryptoKey | undefined> {
  const mine = () => (keys && keys.team === team ? keys : null);
  if (!mine() || Date.now() - mine()!.at >= KEYS_TTL_MS) await refresh(team);
  const k = mine()?.byKid.get(kid);
  if (k) return k;
  // 모르는 kid — 키 교체일 수 있어 한 번 더 (1분 제한 안에서)
  await refresh(team);
  return mine()?.byKid.get(kid);
}

const b64url = (s: string): Uint8Array<ArrayBuffer> => {
  const t = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(t + '='.repeat((4 - (t.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};
const jsonPart = (s: string): Record<string, unknown> | null => {
  try {
    const v = JSON.parse(new TextDecoder().decode(b64url(s)));
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
};

/** 토큰이 이 팀 · 이 앱 것으로 서명됐고 지금 유효한지 */
export async function verifyAccessToken(token: string, team: string, aud: string, nowS = Math.floor(Date.now() / 1000)): Promise<boolean> {
  const parts = token.split('.');
  if (parts.length !== 3 || token.length > 8192 || parts.some((p) => !/^[A-Za-z0-9_-]+$/.test(p))) return false;
  const head = jsonPart(parts[0]);
  const body = jsonPart(parts[1]);
  if (!head || !body || head.alg !== 'RS256' || typeof head.kid !== 'string') return false;
  // 내용 확인을 먼저 — 아무 토큰으로나 공개 키 받기를 일으키지 못하게 (서명은 아래에서 반드시 확인)
  const auds = Array.isArray(body.aud) ? body.aud : [body.aud];
  if (!auds.includes(aud)) return false;
  if (body.iss !== `https://${team}`) return false;
  if (typeof body.exp !== 'number' || body.exp < nowS - SKEW_S) return false;
  if (body.nbf !== undefined && (typeof body.nbf !== 'number' || body.nbf > nowS + SKEW_S)) return false;
  const key = await keyFor(team, head.kid);
  if (!key) return false;
  return crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64url(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
}

/** 관리자 API 입구 — Access 를 거치지 않았으면 응답(403 access · 설정이 틀리면 503 access-config), 아니면 null. 각 관리자 핸들러가 `limited()` 바로 뒤에 부른다 */
export async function accessBlocked(request: Request): Promise<Response | null> {
  const c = config();
  if (c === 'off') return null;
  // 화면이 비밀번호 · 저장소 문제와 나눠 보여 주도록 이름을 따로 (admin.ts failText)
  if (c === 'bad') return json({ ok: false, error: 'access-config' }, 503);
  // 빈 헤더면 쿠키로 (|| — ?? 는 빈 문자열에서 멈춘다)
  const token = request.headers.get(HEADER) || cookies(request)[COOKIE] || '';
  try {
    if (token && (await verifyAccessToken(token, c.team, c.aud))) return null;
  } catch {
    // 꼴이 이상한 토큰 등 — 막는다(문을 열어 두지 않음)
  }
  return json({ ok: false, error: 'access' }, 403);
}
