// Vercel 함수 개수 검사 — 무료(Hobby) 요금제는 한 배포에 함수를 12개까지만 만든다 (2026-10-29).
// Astro 같은 프레임워크에선 api/ 폴더의 파일 하나가 함수 하나다. 13개가 되면 사이트 빌드를 다 마친 뒤 함수를 올리는 단계에서
// 배포가 실패한다 — #31 이 api/guide-me.ts 를 더해 13개가 되자 main · 모든 미리보기 배포가 실패했다 (docs/deploy-failures.md).
//   node tools/check-functions.mjs   → 12개 넘으면 실패 (pnpm build 맨 앞 · PR 검사 workflow 에서 돈다)
// 함수로 세는 파일 = api/ 아래 .js · .mjs · .cjs · .ts · .mts · .cts · .jsx · .tsx (.d.ts 제외), 이름이 _ 또는 . 로 시작하는 파일 · 폴더는 빼고 (api/_lib/ 같은 공용 코드).
// 새 API 가 필요하면 파일을 늘리지 말고 기존 함수에 합친다 — 같은 파일 안에서 메서드 · 쿼리로 나누거나, vercel.json rewrites 로 주소만 따로 둔다.
import { readdirSync } from 'node:fs';
import path from 'node:path';

const LIMIT = 12;
const EXT = /\.(c|m)?(j|t)sx?$/;

function walk(dir) {
  let out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('_') || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out = out.concat(walk(p));
    else if (EXT.test(e.name) && !e.name.endsWith('.d.ts')) out.push(p.split(path.sep).join('/'));
  }
  return out;
}

const fns = walk('api').sort();
if (fns.length > LIMIT) {
  console.error(`[dldb:functions] Vercel 함수가 ${fns.length}개 — 무료 요금제 한도 ${LIMIT}개를 넘어 배포가 실패한다. 기존 함수에 합칠 것 (tools/check-functions.mjs 머리 주석):`);
  for (const f of fns) console.error(`  ${f}`);
  process.exit(1);
}
console.log(`[dldb:functions] Vercel 함수 ${fns.length}/${LIMIT}개`);
