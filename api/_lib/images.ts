/**
 * 가이드 사진 (2026-10-06) — WebP 로 공개 저장소에 둔다.
 * 2026-10-30 (#34) Vercel Blob → Cloudflare R2 (r2.ts). 2026-11-01 Blob 코드를 뺐다 — R2 환경 변수가 다 있지 않으면 업로드는 503 off.
 * R2 무료는 쓰기 월 100만 · 읽기 1,000만 · 전송량 무료, 넘기면 정지 대신 요금. 하루 사이트 150장 · 계정 20장
 * (2026-11-02 #78 — Blob 올리기 한도 때문에 둔 60장은 계정 3개면 그날 모두 막혀서 올림. 150 = 사진 10장 가이드 15편.
 *  더 올리지 않는 이유는 Vercel 원본 전송량(월 10GB, /api 전체 공용) — 매일 1MB × 150 을 채워도 월 4.5GB).
 *
 * 흐름: 쓰기 화면이 올리기 직전에 사진을 한 장씩 POST /api/guide-image → 주소를 받아 가이드 글에 넣는다.
 *   img:{주소}      누가 올렸는지 (가이드에 넣을 때 본인 사진인지 확인) — 2일 뒤 만료
 *   imgs:unused     아직 가이드에 안 들어간 사진 (점수 = 올린 시각). 하루 지나도 안 쓰였으면 다음 업로드 때 지운다
 */
import { R2_KEY, purgeConfigured, purgeUrls, r2Configured, r2Delete, r2Prefix, r2Put } from './r2.js';
import { redis } from './redis.js';

// 브라우저가 긴 변 1600px WebP 로 줄여 보내므로 그 크기만 받는다 — 큰 사진으로 Vercel 원본 전송량(월 10GB)을 빨리 쓰지 못하게 (2026-10-14 점검, 예전 2MB · 4096px. 그땐 Blob 보기 한도 때문)
export const IMAGE_MAX_BYTES = 1024 * 1024;
export const IMAGE_MAX_SIDE = 1600;
export const IMAGES_PER_DAY_SITE = 150;
export const IMAGES_PER_DAY_ACCOUNT = 20;

export const imageKey = (url: string) => `img:${url}`;
export const UNUSED = 'imgs:unused';

export const imagesConfigured = r2Configured;

/** 사진 저장 → 공개 주소. 이름은 새 UUID — 계정 ID 를 넣지 않는다 (공개 주소라 익명 글쓴이가 드러났다, 2026-10-14 점검) */
export async function storeImage(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const key = `guides/${crypto.randomUUID()}.webp`;
  return r2Put(key, bytes);
}

/** WebP 파일인지 보고 가로·세로를 읽는다 (VP8 · VP8L · VP8X). 아니면 null */
export function webpSize(b: Uint8Array): { w: number; h: number } | null {
  const ascii = (o: number, n: number) => String.fromCharCode(...b.subarray(o, o + n));
  if (b.length < 30 || ascii(0, 4) !== 'RIFF' || ascii(8, 4) !== 'WEBP') return null;
  // RIFF 크기 칸 = 파일 길이 − 8 이어야 한다 — 올바른 머리 뒤에 아무 바이트나 붙인 파일을 받지 않게 (#78).
  // 첫 덩어리 크기도 파일 안에 들어가야 한다 (덩어리 안에 숨긴 바이트까지는 디코딩해야 알 수 있어 거기까지는 안 본다)
  const u32 = (o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
  if (u32(4) + 8 !== b.length || 20 + u32(16) > b.length) return null;
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

let purgeWarned = false;

/** R2 에서 사진 지우기 (지우기는 무료) → 실제로 지운 주소들. 우리 R2 공개 주소 + `guides/{UUID}.webp` 꼴만 — 그 밖의 주소(옛 Blob 주소 포함)는 건드리지 않는다. 실패해도 글 처리는 계속한다 */
export async function deleteImages(urls: string[]): Promise<Set<string>> {
  const prefix = r2Configured() ? r2Prefix() : null;
  const r2Keys = prefix ? urls.filter((u) => u.startsWith(prefix)).map((u) => u.slice(prefix.length)).filter((k) => R2_KEY.test(k)) : [];
  // 지워진 것만 캐시를 비운다 — 원본이 남아 있으면 비워도 다음 요청이 다시 캐시한다
  const deleted = await Promise.all(
    r2Keys.map((k) =>
      r2Delete(k).then(
        () => `${prefix}${k}`,
        (err: unknown) => {
          console.warn(`[dldb:r2] 사진 지우기 실패 (${errText(err, 'r2 ')}) — 원본이 남음`);
          return null;
        },
      ),
    ),
  );
  const ok = deleted.filter((u): u is string => u !== null);
  await purgeR2Cache(ok);
  return new Set(ok);
}

/** 로그에 남길 오류 글 — 우리가 만든 메시지(`purge 403` · `r2 DELETE 500`)만 그대로, 그 밖에는 오류 이름만 (fetch 오류 메시지에 토큰 · 서명이 섞일 수 있어서) */
const errText = (err: unknown, ours: string) => (err instanceof Error ? (err.message.startsWith(ours) ? err.message : err.name) : 'error');

/** 지운 R2 사진을 Cloudflare 캐시에서도 지운다. 설정이 없거나 실패하면 로그만 — 그래도 올릴 때 캐시가 하루라 하루 안에 사라진다 */
async function purgeR2Cache(urls: string[]) {
  if (!urls.length) return;
  if (!purgeConfigured()) {
    if (!purgeWarned) {
      purgeWarned = true;
      console.warn('[dldb:r2] CF_ZONE_ID · CF_PURGE_TOKEN 이 없거나 꼴이 틀려 지운 사진의 Cloudflare 캐시를 비우지 못함 — 캐시가 끝날 때까지(최대 하루, 예전 사진은 1년) 주소가 열린다');
    }
    return;
  }
  await purgeUrls(urls).catch((err: unknown) => console.warn(`[dldb:r2] 캐시 비우기 실패 (${errText(err, 'purge ')}) — 최대 하루 뒤 사라진다`));
}

/** 하루 넘게 가이드에 안 쓰인 사진 몇 장 정리 */
export async function sweepUnused(limit = 5) {
  const cutoff = Math.floor(Date.now() / 1000) - 86400;
  const old = await redis<string[]>('ZRANGE', UNUSED, '-inf', cutoff, 'BYSCORE', 'LIMIT', 0, limit);
  if (!old.length || !r2Configured()) return;
  // 실제로 지운 것만 목록에서 뺀다 — R2 지우기가 실패하면 다음에 다시 시도한다 (예전엔 실패해도 빼서 아무도 모르는 사진이 남았다, #78).
  // 우리 R2 주소 꼴이 아닌 것(옛 Blob 주소 등)은 지울 수 없으니 그냥 뺀다
  const gone = await deleteImages(old);
  const prefix = r2Prefix();
  const done = old.filter((u) => gone.has(u) || !(u.startsWith(prefix) && R2_KEY.test(u.slice(prefix.length))));
  if (done.length) await redis('ZREM', UNUSED, ...done);
}
