/**
 * 가이드 사진 (2026-10-06) — WebP 로 공개 저장소에 둔다.
 * 2026-10-30 (#34) Cloudflare R2 로 옮김 (r2.ts) — R2 환경 변수가 다 있으면 새 사진은 R2, 없으면 예전처럼 Vercel Blob(BLOB_READ_WRITE_TOKEN).
 * 지우기는 주소로 나눈다: R2 공개 주소면 R2, Blob 주소면 Blob — 옮기기 전에 올린 사진도 지울 수 있게.
 * Blob 무료(Hobby) 한도는 올리기 월 2,000번 · 보기 월 10GB, 넘기면 사진이 30일 멈춘다. R2 무료는 쓰기 월 100만 · 읽기 1,000만 · 전송량 무료,
 * 넘기면 정지 대신 요금. 하루 사이트 60장 · 계정 20장 제한은 그대로 둔다 (Blob 때 정한 값이지만 도배 · 저장 용량 막이로도 쓴다).
 *
 * 흐름: 쓰기 화면이 올리기 직전에 사진을 한 장씩 POST /api/guide-image → 주소를 받아 가이드 글에 넣는다.
 *   img:{주소}      누가 올렸는지 (가이드에 넣을 때 본인 사진인지 확인) — 2일 뒤 만료
 *   imgs:unused     아직 가이드에 안 들어간 사진 (점수 = 올린 시각). 하루 지나도 안 쓰였으면 다음 업로드 때 지운다
 */
import { del, put } from '@vercel/blob';
import { R2_KEY, r2Configured, r2Delete, r2Prefix, r2Put } from './r2.js';
import { redis } from './redis.js';

// 브라우저가 긴 변 1600px WebP 로 줄여 보내므로 그 크기만 받는다 — 큰 사진을 여러 번 받아 보기 한도(월 10GB)를 빨리 쓰지 못하게 (2026-10-14 점검, 예전 2MB · 4096px)
export const IMAGE_MAX_BYTES = 1024 * 1024;
export const IMAGE_MAX_SIDE = 1600;
export const IMAGES_PER_DAY_SITE = 60;
export const IMAGES_PER_DAY_ACCOUNT = 20;

export const imageKey = (url: string) => `img:${url}`;
export const UNUSED = 'imgs:unused';

const blobConfigured = () => !!process.env.BLOB_READ_WRITE_TOKEN;
export const imagesConfigured = () => r2Configured() || blobConfigured();
/** Vercel Blob 공개 주소 (옮기기 전 사진) */
const BLOB_URL = /^https:\/\/[a-z0-9]+\.public\.blob\.vercel-storage\.com\//i;

/** 사진 저장 → 공개 주소. 이름은 새 UUID — 계정 ID 를 넣지 않는다 (공개 주소라 익명 글쓴이가 드러났다, 2026-10-14 점검) */
export async function storeImage(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const key = `guides/${crypto.randomUUID()}.webp`;
  if (r2Configured()) return r2Put(key, bytes);
  const blob = await put(key, Buffer.from(bytes), { access: 'public', contentType: 'image/webp', cacheControlMaxAge: 365 * 86400 });
  return blob.url;
}

/** WebP 파일인지 보고 가로·세로를 읽는다 (VP8 · VP8L · VP8X). 아니면 null */
export function webpSize(b: Uint8Array): { w: number; h: number } | null {
  const ascii = (o: number, n: number) => String.fromCharCode(...b.subarray(o, o + n));
  if (b.length < 30 || ascii(0, 4) !== 'RIFF' || ascii(8, 4) !== 'WEBP') return null;
  const chunk = ascii(12, 4);
  if (chunk === 'VP8X') return { w: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), h: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) };
  if (chunk === 'VP8 ') {
    // 키 프레임 시작 표시 9d 01 2a 뒤에 14비트 가로·세로
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
    return { w: (b[26] | (b[27] << 8)) & 0x3fff, h: (b[28] | (b[29] << 8)) & 0x3fff };
  }
  if (chunk === 'VP8L') {
    if (b[20] !== 0x2f) return null;
    const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
    return { w: (bits & 0x3fff) + 1, h: ((bits >>> 14) & 0x3fff) + 1 };
  }
  return null;
}

/** 저장소에서 사진 지우기 (둘 다 지우기는 무료). 주소로 저장소를 고른다 — 어느 쪽 꼴도 아닌 주소는 건드리지 않는다. 실패해도 글 처리는 계속한다 */
export async function deleteImages(urls: string[]) {
  const prefix = r2Configured() ? r2Prefix() : null;
  const r2Keys = prefix ? urls.filter((u) => u.startsWith(prefix)).map((u) => u.slice(prefix.length)).filter((k) => R2_KEY.test(k)) : [];
  const blobUrls = urls.filter((u) => BLOB_URL.test(u));
  await Promise.all([
    ...r2Keys.map((k) => r2Delete(k).catch(() => {})),
    blobUrls.length && blobConfigured() ? del(blobUrls).catch(() => {}) : null,
  ]);
}

/** 하루 넘게 가이드에 안 쓰인 사진 몇 장 정리 */
export async function sweepUnused(limit = 5) {
  const cutoff = Math.floor(Date.now() / 1000) - 86400;
  const old = await redis<string[]>('ZRANGE', UNUSED, '-inf', cutoff, 'BYSCORE', 'LIMIT', 0, limit);
  if (!old.length) return;
  await deleteImages(old);
  await redis('ZREM', UNUSED, ...old);
}
