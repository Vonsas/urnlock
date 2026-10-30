// 패치노트 보관 — deadlock-api /v2/patches 는 최근 글 30개(포럼 글 섞임)만 줘서 새 글이 올라오면 오래된 패치가 목록에서 밀려난다.
// 받은 Steam 글을 src/data/patch-archive.json 에 쌓아 두고, 빌드는 API 결과와 이 파일을 합쳐 쓴다 (src/data/api/fetch.ts loadPatches).
//   node tools/archive-patches.mjs   → 새 글이 있으면 파일을 고치고 'changed' 를 출력
// 매일 GitHub Actions(.github/workflows/daily-rebuild.yml)가 돌려 바뀌었으면 커밋·푸시한다 (Vercel 이 그 푸시로 다시 배포).
import fs from 'node:fs';

const FILE = 'src/data/patch-archive.json';
const KEYS = ['source', 'title', 'link', 'pub_date', 'content'];
// 같은 글 판별은 Steam 글 주소 — 주소가 없는 옛 글만 게시 시각 + 제목. 제목으로 가르면 Steam 에서 제목을 고친 글이 둘로 남았다 (2026-10-14 점검)
const keyOf = (p) => p.link || `${p.pub_date}|${p.title.trim()}`;

const res = await fetch('https://api.deadlock-api.com/v2/patches', { signal: AbortSignal.timeout(30_000) });
if (!res.ok) {
  console.error(`패치 목록을 받지 못함: HTTP ${res.status}`);
  process.exit(1);
}
const fresh = (await res.json())
  .filter((p) => p.source === 'steam')
  .map((p) => Object.fromEntries(KEYS.filter((k) => k in p).map((k) => [k, p[k]])));

const archive = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : [];
const byKey = new Map(archive.map((p) => [keyOf(p), p]));
let added = 0;
let updated = 0;
for (const p of fresh) {
  const old = byKey.get(keyOf(p));
  if (!old) added++;
  else if (JSON.stringify(old) !== JSON.stringify(p)) updated++;
  byKey.set(keyOf(p), p); // 같은 글이 고쳐졌으면 새 내용으로
}
const merged = [...byKey.values()].sort((a, b) => b.pub_date.localeCompare(a.pub_date));
const out = JSON.stringify(merged, null, 1) + '\n';
if (!fs.existsSync(FILE) || fs.readFileSync(FILE, 'utf8') !== out) {
  fs.writeFileSync(FILE, out);
  console.log(`changed: 새 글 ${added}, 고친 글 ${updated}, 전체 ${merged.length}`);
} else {
  console.log(`no change: 전체 ${merged.length}`);
}
