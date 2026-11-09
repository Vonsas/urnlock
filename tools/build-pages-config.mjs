// Cloudflare Pages 배포용 마무리 (#33, 2026-10-30 — 2026-11-01 부터 www 가 Pages) — `pnpm build` 뒤에 돌린다 (tools/vercel-to-pages.mjs · .github/workflows/pages-standby.yml).
//   node tools/build-pages-config.mjs [dist]
//
// 1. vercel.json 의 headers · redirects 를 Pages 형식 dist/_headers · dist/_redirects 로 옮긴다 — 손으로 베끼지 않아
//    vercel.json(CSP 등)을 고치면 다음 Pages 배포에 그대로 따라간다. Pages 가 못 읽는 꼴(정규식)이 오면 멈춘다.
// 2. Pages 한도(파일 2만 개 · 파일당 25MiB)를 넘으면 멈춘다.
// 3. HTML 이 static.urnlock.com 에서 파일을 받으면 멈춘다 — static 은 Cloudflare 를 거친 Vercel 이었고 #56 에서 DNS 레코드째 지웠다(그림 · 스크립트가 깨진다).
//    빌드는 자기 /_astro 를 써야 한다 (astro.config.mjs 의 assetsPrefix 는 #55 에서 껐다 — 다시 켜면 여기서 걸린다).
// 4. dist/health.json 의 problems 가 있으면 멈춘다 — 틀린 티어를 올리느니 직전 Pages 배포를 그대로 둔다 (Vercel 빌드와 같은 규칙).
// 5. dist/_routes.json — `/api/*` 만 Pages Function(functions/api/[[path]].js — Vercel 로 넘기는 프록시, #52)을 거치게. 정적 요청은 함수를 안 불러
//    무료 · 무제한이고 함수는 하루 10만 건 무료 (docs/plan-cloudflare-split.md 1절).
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const DIST = process.argv[2] ?? 'dist';
/** Vercel 전용 리디렉트의 호스트 — origin 주소에서 /api 가 아닌 경로를 www 로 보내는 줄(설계 3절 'origin 주소')은 Pages 에 옮기지 않는다 */
const VERCEL_ONLY_HOSTS = new Set(['origin.urnlock.com']);
const MAX_FILES = 20_000;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const fail = (msg) => {
  console.error(`[pages] ${msg}`);
  process.exit(1);
};

const vercel = JSON.parse(readFileSync('vercel.json', 'utf8'));

/** Vercel 경로 → Pages 경로. `/(.*)` 꼬리만 `/*` 로, 그 밖의 정규식은 받지 않는다 */
function headerPath(source) {
  const path = source.replace(/\/\(\.\*\)$/, '/*');
  if (/[()|?+\\[\]^$]/.test(path)) fail(`headers 의 source 를 Pages 꼴로 못 바꿈: ${source}`);
  return path;
}

/**
 * Vercel redirect source 의 `:name(a|b|c)` 를 하나씩 풀어 Pages 의 고정 경로 줄로 (Pages 는 자리 안의 정규식을 모른다).
 * destination 의 `:name` 도 같은 값으로 바꾼다. 풀 수 없는 꼴이면 멈춘다.
 */
function expandRedirect({ source, destination, permanent, statusCode, has, missing }) {
  // origin 호스트에만 걸리는 줄은 Vercel 전용 — Pages 엔 그 호스트로 오는 요청이 없으니 건너뛴다 (그 밖의 has · missing 은 지금처럼 멈춤)
  if (!missing && Array.isArray(has) && has.length === 1 && has[0].type === 'host' && VERCEL_ONLY_HOSTS.has(has[0].value)) return [];
  if (has || missing) fail(`redirects 의 has · missing 조건은 Pages 로 못 옮김: ${source}`);
  const status = statusCode ?? (permanent === false ? 307 : 308); // Vercel 은 permanent 를 안 적으면 308
  let rows = [{ src: source, dst: destination }];
  const group = /:(\w+)\(([^()]+)\)/;
  for (let m; (m = rows[0].src.match(group)); ) {
    const [whole, name, alts] = m;
    if (/[.*+?^$\\[\]{}]/.test(alts)) fail(`redirects 의 ${whole} 를 풀 수 없음 (목록만 됨): ${source}`);
    rows = rows.flatMap((r) =>
      alts.split('|').map((v) => ({ src: r.src.replace(whole, v), dst: r.dst.replaceAll(`:${name}`, v) })),
    );
  }
  for (const r of rows) if (/[()|?+\\[\]^$]/.test(r.src)) fail(`redirects 의 source 를 Pages 꼴로 못 바꿈: ${source}`);
  return rows.map((r) => `${r.src} ${r.dst} ${status}`);
}

// 1. _headers · _redirects
for (const key of ['cleanUrls', 'trailingSlash', 'rewrites']) if (vercel[key] !== undefined) fail(`vercel.json 의 ${key} 는 Pages 로 옮기는 법을 아직 안 정함`);
const headers = [
  ...(vercel.headers ?? []).map(({ source, headers: list }) => [headerPath(source), ...list.map(({ key, value }) => `  ${key}: ${value}`)].join('\n')),
  // 예비 주소(*.pages.dev)는 검색에 잡히지 않게 — canonical 도 www 지만 한 겹 더. www 로 돌렸을 땐 이 줄이 걸리지 않는다
  'https://:project.pages.dev/*\n  X-Robots-Tag: noindex',
].join('\n');
writeFileSync(join(DIST, '_headers'), `# vercel.json 에서 만든 파일 — 고치려면 vercel.json 을 고친다 (tools/build-pages-config.mjs)\n${headers}\n`);
const redirects = (vercel.redirects ?? []).flatMap(expandRedirect);
writeFileSync(join(DIST, '_redirects'), `# vercel.json 에서 만든 파일 — 고치려면 vercel.json 을 고친다 (tools/build-pages-config.mjs)\n${redirects.join('\n')}\n`);
console.log(`[pages] _headers ${(vercel.headers?.length ?? 0) + 1}묶음 · _redirects ${redirects.length}줄`);

// 5. _routes.json — /api/* 만 함수로 (정적 파일 · 리디렉트는 함수를 안 거침)
writeFileSync(join(DIST, '_routes.json'), `${JSON.stringify({ version: 1, include: ['/api/*'], exclude: [] })}\n`);
console.log('[pages] _routes.json /api/* 만 함수');

// 2. 파일 수 · 크기, 3. HTML 의 static 주소
let files = 0;
const big = [];
const staticRefs = [];
for (const entry of readdirSync(DIST, { recursive: true, withFileTypes: true })) {
  if (!entry.isFile()) continue;
  const path = join(entry.parentPath ?? entry.path, entry.name);
  files++;
  if (statSync(path).size > MAX_FILE_BYTES) big.push(relative(DIST, path));
  if (entry.name.endsWith('.html') && readFileSync(path, 'utf8').includes('https://static.urnlock.com/')) staticRefs.push(relative(DIST, path));
}
console.log(`[pages] 파일 ${files}개 (한도 ${MAX_FILES})`);
if (files > MAX_FILES) fail(`파일이 ${files}개 — Pages 한도 ${MAX_FILES}개를 넘음`);
if (big.length) fail(`25MiB 넘는 파일: ${big.join(', ')}`);
if (staticRefs.length) fail(`HTML 이 static.urnlock.com 을 씀 (astro.config.mjs 의 assetsPrefix 를 확인): ${staticRefs.slice(0, 3).join(', ')} 외 ${Math.max(0, staticRefs.length - 3)}개`);

// 4. 점검 결과
const health = JSON.parse(readFileSync(join(DIST, 'health.json'), 'utf8'));
if (health.problems?.length) fail(`health.json 점검 실패 — 올리지 않음 (직전 Pages 배포 유지):\n- ${health.problems.join('\n- ')}`);
console.log(`[pages] health.json 문제 없음 (데이터 시각 ${new Date((health.dataAt ?? health.builtAt) * 1000).toISOString()})`);
