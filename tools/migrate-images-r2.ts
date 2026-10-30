// 가이드 사진 옮기기 — Vercel Blob → Cloudflare R2 (#34, 2026-10-30). 여러 번 돌려도 된다 (가이드에 남은 Blob 주소만 다시 찾는다).
//   pnpm exec tsx --env-file=.env.production tools/migrate-images-r2.ts                → 옮길 사진만 세고 아무것도 바꾸지 않는다
//   … tools/migrate-images-r2.ts --apply --id=<가이드 ID>                               → 그 한 편만 옮긴다 (처음엔 이걸로 시험)
//   … tools/migrate-images-r2.ts --apply                                               → 전부 R2 에 복사하고 가이드의 사진 주소를 바꾼다
//   … tools/migrate-images-r2.ts --delete-blob                                         → Blob 저장소의 사진 파일을 모두 지운다 (따로 돌린다)
// --delete-blob 은 사이트에서 R2 사진이 보이는 걸 확인한 뒤에, 그리고 R2 환경 변수를 넣고 **이틀 뒤**에 — 그 전에 Blob 으로 올린 사진은
// 올린 사람 기록(img:{주소}, 2일)이 남아 있어 아직 글에 붙을 수 있다. 가이드에 Blob 주소가 하나라도 있거나 그런 기록이 남아 있으면 지우지 않고 멈춘다.
// 모르는 옵션은 거절한다 (오타로 '한 편 시험' 이 전체 실행이 되지 않게).
// 환경 변수: KV_REST_API_URL · KV_REST_API_TOKEN (Upstash), R2_* 다섯 개 (api/_lib/r2.ts), --delete-blob 이면 BLOB_READ_WRITE_TOKEN.
// `vercel env pull --environment=production .env.production` 로 받는다 — 값을 화면이나 다른 파일에 옮겨 적지 않고, 끝나면 그 파일을 지운다.
//
// 주소 바꾸기는 가이드 JSON 안의 옛 주소 글자를 새 주소로 바꾸는 Lua 스크립트 한 번 (EVAL — 그 사이 다른 요청이 끼지 못한다).
// 사진 배열 순서 · 크기 · 확인 상태는 그대로 — '[사진 n]' 자리 표시가 번호로 사진을 고르기 때문 (CLAUDE.md '사진').
// 사람이 가이드를 고치는 중이면 그 저장이 옛 주소를 다시 넣을 수 있다 → 조용한 시간에 돌리고, 끝나면 세기만 다시 돌려 0 인지 본다.
import { del, list } from '@vercel/blob';
import { R2_KEY, r2Configured, r2Delete, r2Prefix, r2Put } from '../api/_lib/r2.js';
import { redis } from '../api/_lib/redis.js';
import { webpSize } from '../api/_lib/images.js';
import { guideKey, isGuideId, newKey, type StoredGuide } from '../api/_lib/guides-store.js';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const deleteBlob = args.includes('--delete-blob');
const idArg = args.find((a) => a.startsWith('--id='));
const onlyId = idArg?.slice(5);
const BLOB_URL = /^https:\/\/[a-z0-9]+\.public\.blob\.vercel-storage\.com\//i;

/** 옛 주소 → 새 주소를 JSON 문자열 안에서 그대로(패턴 아님) 바꾼다. 바꾼 개수를 돌려준다. TTL 은 그대로 */
const REPLACE = `
local v = redis.call('GET', KEYS[1])
if not v then return 0 end
local n = 0
for i = 1, #ARGV, 2 do
  local from, to = ARGV[i], ARGV[i + 1]
  local s, e = string.find(v, from, 1, true)
  while s do
    v = string.sub(v, 1, s - 1) .. to .. string.sub(v, e + 1)
    n = n + 1
    s, e = string.find(v, from, s + #to, true)
  end
end
if n > 0 then redis.call('SET', KEYS[1], v, 'KEEPTTL') end
return n`;

const stop = (msg: string) => {
  console.error(msg);
  process.exit(1);
};
const unknown = args.filter((a) => a !== '--apply' && a !== '--delete-blob' && a !== idArg);
if (unknown.length) stop(`모르는 옵션: ${unknown.join(' ')} — 쓸 수 있는 것: --apply · --id=<가이드 ID> · --delete-blob`);
if (idArg !== undefined && !isGuideId(onlyId)) stop(`--id 값이 가이드 ID 꼴이 아닙니다 (소문자 · 숫자 10자): ${onlyId}`);
if (apply && deleteBlob) stop('--apply 와 --delete-blob 은 따로 돌린다 (옮긴 뒤 사이트에서 사진을 확인하고 지운다)');
// 지우기는 저장소 전체라, 검사도 가이드 전체를 봐야 한다
if (deleteBlob && idArg !== undefined) stop('--delete-blob 은 --id 와 같이 쓸 수 없다 (Blob 저장소 전체를 지우므로 모든 가이드를 검사한다)');
if (!deleteBlob && !r2Configured()) stop('R2 환경 변수가 없습니다 (R2_ACCOUNT_ID · R2_ACCESS_KEY_ID · R2_SECRET_ACCESS_KEY · R2_BUCKET · R2_PUBLIC_URL)');
if (deleteBlob && !process.env.BLOB_READ_WRITE_TOKEN) stop('--delete-blob 에는 BLOB_READ_WRITE_TOKEN 이 필요합니다');

/** 가이드마다 아직 Blob 주소인 사진 */
async function blobPhotos() {
  const ids = onlyId ? [onlyId] : await redis<string[]>('ZRANGE', newKey(), 0, -1);
  const out: { id: string; urls: string[] }[] = [];
  for (const id of ids) {
    const raw = await redis<string | null>('GET', guideKey(id));
    if (!raw) continue;
    const g = JSON.parse(raw) as StoredGuide;
    const urls = [...new Set(g.sections.flatMap((x) => x.images.map((im) => im.url)).filter((u) => BLOB_URL.test(u)))];
    if (urls.length) out.push({ id, urls });
  }
  return { total: ids.length, out };
}

const { total, out } = await blobPhotos();
const found = out.reduce((n, x) => n + x.urls.length, 0);

if (deleteBlob) {
  if (found) stop(`가이드 ${out.length}편에 Blob 사진 ${found}장이 아직 남아 있어 지우지 않습니다 — 먼저 --apply (${out.map((x) => x.id).join(', ')})`);
  // 올렸지만 아직 글에 안 붙은 Blob 사진 — 기록(img:{주소})이 2일 동안 남아 그 사이 글에 붙을 수 있다
  let scan = '0';
  let pending = 0;
  do {
    const [next, keys] = await redis<[string, string[]]>('SCAN', scan, 'MATCH', 'img:https://*.public.blob.vercel-storage.com/*', 'COUNT', 1000);
    pending += keys.length;
    scan = next;
  } while (scan !== '0');
  if (pending) stop(`아직 글에 붙지 않은 Blob 사진 기록이 ${pending}개 남아 있어 지우지 않습니다 — R2 로 바꾸고 이틀 뒤에 다시 (기록은 2일 뒤 사라짐)`);
  let removed = 0;
  let cursor: string | undefined;
  do {
    // 사진(guides/)만 — 저장소에 다른 파일이 있어도 건드리지 않는다
    const page = await list({ cursor, limit: 1000, prefix: 'guides/' });
    if (page.blobs.length) await del(page.blobs.map((b) => b.url));
    removed += page.blobs.length;
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  console.log(`Blob 파일 ${removed}개 지움 — 이제 Vercel 에서 Blob 저장소 · BLOB_READ_WRITE_TOKEN 을 지우고 @vercel/blob 을 코드에서 뺀다`);
  process.exit(0);
}

for (const x of out) console.log(`${x.id}: Blob 사진 ${x.urls.length}장`);
if (!apply) {
  console.log(`확인만: 옮길 Blob 사진 ${found}장 (가이드 ${total}편 중) — 옮기려면 --apply (한 편만: --apply --id=<ID>)`);
  process.exit(0);
}

let moved = 0;
let failed = 0;
for (const { id, urls } of out) {
  const pairs: string[] = [];
  for (const url of urls) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
      if (!res.ok) throw new Error(`받기 ${res.status}`);
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (!webpSize(bytes)) throw new Error('WebP 가 아님');
      pairs.push(url, await r2Put(`guides/${crypto.randomUUID()}.webp`, bytes));
    } catch (e) {
      failed++;
      console.warn(`  ${id}: 옮기지 못함 ${url} — ${(e as Error).message}`);
    }
  }
  if (!pairs.length) continue;
  try {
    const n = await redis<number>('EVAL', REPLACE, 1, guideKey(id), ...pairs);
    moved += pairs.length / 2;
    console.log(`  ${id}: R2 로 ${pairs.length / 2}장, 주소 ${n}곳 바꿈`);
  } catch (e) {
    // 실패로 보여도 실제로는 바뀌었을 수 있다 (응답만 늦은 시간 초과 등) — 가이드를 다시 읽어 거기 안 들어간 사본만 지운다.
    // 다시 읽기도 실패하면 아무것도 지우지 않는다 (고아 사본이 남는 쪽이 사진이 깨지는 쪽보다 낫다)
    const current = await redis<string | null>('GET', guideKey(id)).catch(() => undefined);
    if (current === undefined) {
      failed += pairs.length / 2;
      console.warn(`  ${id}: 주소 바꾸기 실패 — ${(e as Error).message}. 가이드를 다시 읽지 못해 R2 사본은 그대로 둠 — 세기만 다시 돌려 확인`);
      continue;
    }
    const prefix = r2Prefix();
    let applied = 0;
    let removed = 0;
    for (let i = 1; i < pairs.length; i += 2) {
      const key = pairs[i].slice(prefix.length);
      if (current?.includes(pairs[i])) {
        applied++;
        continue;
      }
      failed++;
      if (!R2_KEY.test(key)) continue;
      await r2Delete(key).catch(() => {});
      removed++;
    }
    moved += applied;
    console.warn(`  ${id}: 주소 바꾸기 응답 실패 — ${(e as Error).message}. 다시 읽어 보니 ${applied}장은 바뀌어 있음, 쓰이지 않는 R2 사본 ${removed}개 지움`);
  }
}

console.log(`끝: Blob 사진 ${found}장 중 ${moved}장 옮김, 실패 ${failed} — 세기만 다시 돌려 0 인지 보고, 사이트에서 사진을 확인한 뒤 --delete-blob`);
if (failed) process.exit(1);
