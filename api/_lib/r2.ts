/**
 * Cloudflare R2 — 가이드 사진 저장소 (#34, 2026-10-30). S3 호환 API 를 패키지 없이 fetch + Web Crypto 로 (AWS 서명 V4).
 * 환경 변수 (Vercel, Production · Preview):
 *   R2_ACCOUNT_ID · R2_ACCESS_KEY_ID · R2_SECRET_ACCESS_KEY   R2 → API 토큰 (그 버킷만 Object Read & Write)
 *   R2_BUCKET                                                 버킷 이름
 *   R2_PUBLIC_URL                                             버킷에 붙인 공개 도메인 (예 https://img.urnlock.com, 끝 / 없이)
 * 다섯 개가 다 있어야 R2 를 쓴다 — 하나라도 없으면 사진 올리기는 503 off (2026-11-01 Blob 대신 쓰던 길을 뺐다).
 *
 * 지운 사진이 Cloudflare 캐시에 남지 않게 (2026-11-01, #54 점검에서 발견 — 원본은 지워져도 1년 캐시로 주소가 계속 열렸다):
 *   ① 올릴 때 캐시를 하루로 (`IMAGE_CACHE`) — 비우기가 실패해도 하루 안에 사라진다
 *   ② 지운 뒤 Cloudflare 캐시 비우기 (`purgeUrls`) — 환경 변수 두 개가 있을 때만:
 *   CF_ZONE_ID       urnlock.com 존 ID (대시보드 존 개요 오른쪽 아래 32자)
 *   CF_PURGE_TOKEN   API 토큰 — 권한 Zone · Cache Purge · Purge 하나, 그 존만
 */

const env = () => ({
  account: process.env.R2_ACCOUNT_ID ?? '',
  keyId: process.env.R2_ACCESS_KEY_ID ?? '',
  secret: process.env.R2_SECRET_ACCESS_KEY ?? '',
  bucket: process.env.R2_BUCKET ?? '',
  publicUrl: (process.env.R2_PUBLIC_URL ?? '').replace(/\/+$/, ''),
});

let warned = false;
export const r2Configured = () => {
  const e = env();
  const ok = /^[0-9a-f]{32}$/i.test(e.account) && !!e.keyId && !!e.secret && /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(e.bucket) && /^https:\/\/[a-z0-9.-]+$/i.test(e.publicUrl);
  // 일부만 넣었거나 꼴이 틀리면 왜 사진이 꺼졌는지 로그에 남긴다 (값은 찍지 않음)
  if (!ok && !warned && Object.keys(process.env).some((k) => k.startsWith('R2_'))) {
    warned = true;
    console.warn('[dldb:r2] R2 환경 변수가 빠졌거나 꼴이 틀려 사진 올리기를 끈다 (R2_ACCOUNT_ID 32자 · R2_BUCKET · R2_PUBLIC_URL=https://호스트)');
  }
  return ok;
};

/** 공개 주소 앞부분 (끝에 /) — 이 주소로 시작하는 사진만 R2 에서 지운다 */
export const r2Prefix = () => `${env().publicUrl}/`;

/** 우리가 만드는 사진 이름 꼴만 — 저장된 주소가 어떻게 되든 이 꼴이 아니면 R2 에 요청하지 않는다 */
export const R2_KEY = /^guides\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$/;

const enc = new TextEncoder();
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
const sha256 = async (data: Uint8Array<ArrayBuffer> | string) => hex(await crypto.subtle.digest('SHA-256', typeof data === 'string' ? enc.encode(data) : data));
async function hmac(key: Uint8Array<ArrayBuffer> | string, msg: string) {
  const k = await crypto.subtle.importKey('raw', typeof key === 'string' ? enc.encode(key) : key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(msg)));
}

/**
 * AWS 서명 V4 — Authorization 머리글 값. headers 는 소문자 이름, 모두 서명한다 (host · x-amz-date · x-amz-content-sha256 포함).
 * path 는 이미 인코딩된 경로, 쿼리는 쓰지 않는다. 시험용으로 내보낸다 (AWS 문서의 예제 서명과 대조).
 */
export async function signV4(o: { method: string; path: string; headers: Record<string, string>; payloadHash: string; keyId: string; secret: string; region: string; service: string; amzDate: string }) {
  const names = Object.keys(o.headers).sort();
  const canonical = [o.method, o.path, '', names.map((n) => `${n}:${o.headers[n].trim()}\n`).join(''), names.join(';'), o.payloadHash].join('\n');
  const day = o.amzDate.slice(0, 8);
  const scope = `${day}/${o.region}/${o.service}/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', o.amzDate, scope, await sha256(canonical)].join('\n');
  let k = await hmac(`AWS4${o.secret}`, day);
  for (const part of [o.region, o.service, 'aws4_request']) k = await hmac(k, part);
  const signature = hex((await hmac(k, toSign)).buffer as ArrayBuffer);
  return `AWS4-HMAC-SHA256 Credential=${o.keyId}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}`;
}

async function r2Fetch(method: 'PUT' | 'DELETE', key: string, body?: Uint8Array<ArrayBuffer>, extra: Record<string, string> = {}) {
  if (!R2_KEY.test(key)) throw new Error(`r2: 사진 이름이 아님 ${key}`);
  const e = env();
  const host = `${e.account}.r2.cloudflarestorage.com`;
  const path = `/${encodeURIComponent(e.bucket)}/${key}`;
  const payloadHash = await sha256(body ?? new Uint8Array());
  const amzDate = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const headers: Record<string, string> = { host, 'x-amz-date': amzDate, 'x-amz-content-sha256': payloadHash, ...extra };
  const authorization = await signV4({ method, path, headers, payloadHash, keyId: e.keyId, secret: e.secret, region: 'auto', service: 's3', amzDate });
  const { host: _h, ...sent } = headers;
  const res = await fetch(`https://${host}${path}`, { method, headers: { ...sent, authorization }, body, signal: AbortSignal.timeout(10_000) });
  await res.body?.cancel(); // 응답 본문은 쓰지 않는다 — 연결을 바로 놓아 준다
  if (!res.ok) throw new Error(`r2 ${method} ${res.status}`);
}

/** 사진 캐시 — 이름이 새 UUID 라 바뀔 일은 없지만, 운영자가 지운 사진이 엣지 · 브라우저에 오래 남지 않게 하루만 (예전 1년 immutable) */
export const IMAGE_CACHE = 'public, max-age=86400';

/** 사진 올리기 → 공개 주소. 이름은 새 UUID (계정 ID 를 넣지 않는다 — 익명 글쓴이가 드러나지 않게) */
export async function r2Put(key: string, bytes: Uint8Array<ArrayBuffer>) {
  await r2Fetch('PUT', key, bytes, { 'content-type': 'image/webp', 'cache-control': IMAGE_CACHE });
  return `${r2Prefix()}${key}`;
}

/** 사진 지우기 (없는 이름도 성공으로 온다) */
export const r2Delete = (key: string) => r2Fetch('DELETE', key);

const purgeEnv = () => ({ zone: process.env.CF_ZONE_ID ?? '', token: process.env.CF_PURGE_TOKEN ?? '' });
/** 토큰은 인쇄 가능한 ASCII 만 — 줄바꿈 등이 섞이면 fetch 가 머리글 오류 메시지에 토큰을 그대로 넣어 던져 로그에 남는다 (#70 1차 리뷰) */
export const purgeConfigured = () => {
  const e = purgeEnv();
  return /^[0-9a-f]{32}$/i.test(e.zone) && /^[\x21-\x7e]{20,200}$/.test(e.token);
};
/** 무료 요금제의 파일 비우기는 요청 하나에 주소 30개까지 */
const PURGE_BATCH = 30;

/**
 * Cloudflare 캐시에서 주소 지우기 — 원본을 지운 **뒤에** 부른다 (먼저 비우면 그 사이 요청이 원본을 다시 캐시한다).
 * R2 공개 주소 + 우리 사진 이름 꼴만 보낸다. 실패는 던진다 — 부르는 쪽이 로그만 남기고 글 처리는 계속한다.
 */
export async function purgeUrls(urls: string[]) {
  const prefix = r2Prefix();
  const files = urls.filter((u) => u.startsWith(prefix) && R2_KEY.test(u.slice(prefix.length)));
  if (!files.length) return;
  const e = purgeEnv();
  for (let i = 0; i < files.length; i += PURGE_BATCH) {
    const res = await fetch(`https://api.cloudflare.com/client/v4/zones/${e.zone}/purge_cache`, {
      method: 'POST',
      headers: { authorization: `Bearer ${e.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ files: files.slice(i, i + PURGE_BATCH) }),
      signal: AbortSignal.timeout(5_000),
    });
    const body = (await res.json().catch(() => null)) as { success?: boolean } | null;
    if (!res.ok || !body?.success) throw new Error(`purge ${res.status}`);
  }
}
