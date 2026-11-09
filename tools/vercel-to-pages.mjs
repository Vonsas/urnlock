// Vercel 운영 빌드가 끝나면 같은 dist/ 를 Cloudflare Pages(`urnlock`)에도 올린다 (#53, docs/plan-cloudflare-split.md 2절).
// vercel.json buildCommand 끝에서 돈다:  pnpm run build && node tools/vercel-to-pages.mjs
//
// - VERCEL_ENV=production 이고 CLOUDFLARE_API_TOKEN · CLOUDFLARE_ACCOUNT_ID 가 있을 때만. 아니면 한 줄 남기고 끝 (미리보기 · 로컬 · 토큰 전).
// - 순서: build-pages-config.mjs 를 자식 프로세스로(문제가 있으면 exit 1 로 끝나므로) → wrangler pages deploy (저장소 바닥에서 — functions/ 도 같이).
//   build-pages-config 가 health.json 의 problems 를 보고 멈추면 올리지 않는다 = 직전 Pages 배포 유지 (PAGES_PRIMARY=1 일 때만 여기까지 온다 —
//   아니면 health.json.ts 가 빌드를 먼저 멈춘다).
// - **어떤 실패도 Vercel 빌드를 멈추지 않는다** (`/api` 배포가 막히면 안 되므로) — `[pages] 올리기 실패` 를 남기고 exit 0.
//   감지는 배포 뒤 check-health --status success 가 pages.dev 의 health.json 을 보고 한다.
// - 성공이든 실패든 dist/_headers · _redirects · _routes.json 을 지운다 — Vercel 은 이 명령이 끝난 dist/ 를 그대로 공개해서, 남기면 /_headers 가 주소로 열린다.
// - wrangler 에는 Cloudflare 토큰과 실행에 필요한 값만 넘긴다 (SESSION_SECRET · 저장소 토큰 같은 다른 Vercel 환경 변수를 외부 도구에 주지 않게).
//   토큰은 어디에도 찍지 않는다. `api/` 코드는 이 이름들을 읽지 않는다 (plan-cloudflare-split.md 2절 — 리뷰 검사 항목).
import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { join } from 'node:path';

const DIST = 'dist';
const PROJECT = 'urnlock';
const WRANGLER = 'wrangler@4.20.0';
const DEPLOY_TIMEOUT_MS = 10 * 60_000; // 보통 1분 안 — 걸려도 Vercel 빌드 45분 제한 안에서 끝나게
const GENERATED = ['_headers', '_redirects', '_routes.json'];

const log = (msg) => console.log(`[pages] ${msg}`);

if (process.env.VERCEL_ENV !== 'production') {
  log(`올리지 않음 — 운영 빌드가 아님 (VERCEL_ENV=${process.env.VERCEL_ENV || '없음'})`);
  process.exit(0);
}
if (!process.env.CLOUDFLARE_API_TOKEN || !process.env.CLOUDFLARE_ACCOUNT_ID) {
  log('올리지 않음 — Vercel 환경 변수 CLOUDFLARE_API_TOKEN · CLOUDFLARE_ACCOUNT_ID 가 없음');
  process.exit(0);
}

/** wrangler(npx) 가 도는 데 필요한 값 + Cloudflare 토큰만 */
function wranglerEnv() {
  const keep = /^(PATH|HOME|TMPDIR|TMP|TEMP|USER|LANG|LC_ALL|CI|NODE_OPTIONS|npm_config_.+|NPM_CONFIG_.+|XDG_.+)$/;
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => keep.test(k)));
  env.CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
  env.CLOUDFLARE_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
  env.WRANGLER_SEND_METRICS = 'false';
  return env;
}

const sha = process.env.VERCEL_GIT_COMMIT_SHA ?? '';
// 첫 줄만, 길면 자름 — Pages 배포 목록에서 어떤 커밋인지 알아볼 만큼
const message = (process.env.VERCEL_GIT_COMMIT_MESSAGE ?? '').split('\n')[0].slice(0, 80) || 'vercel build';

let ok = false;
try {
  // static.urnlock.com 참조가 있으면 build-pages-config 가 멈춘다 (#55 에서 assetsPrefix 를 껐다 — 다시 켜지면 Pages 에 안 올라감)
  const config = spawnSync(process.execPath, ['tools/build-pages-config.mjs', DIST], { stdio: 'inherit' });
  if (config.status !== 0) {
    log('올리기 실패 — Pages 마무리(build-pages-config) 단계에서 멈춤, 위 로그 참고. 직전 Pages 배포가 그대로 남음');
  } else {
    const args = ['--yes', WRANGLER, 'pages', 'deploy', DIST, `--project-name=${PROJECT}`, '--branch=main', '--commit-dirty=true', `--commit-message=${message}`];
    if (/^[0-9a-f]{7,40}$/.test(sha)) args.push(`--commit-hash=${sha}`);
    const deploy = spawnSync('npx', args, { stdio: 'inherit', env: wranglerEnv(), timeout: DEPLOY_TIMEOUT_MS, shell: process.platform === 'win32' });
    if (deploy.status === 0) ok = true;
    else log(`올리기 실패 — wrangler ${deploy.error ? deploy.error.message : `종료 코드 ${deploy.status ?? deploy.signal}`}. 직전 Pages 배포가 그대로 남음`);
  }
} catch (e) {
  log(`올리기 실패 — ${e instanceof Error ? e.message : e}`);
} finally {
  for (const name of GENERATED) rmSync(join(DIST, name), { force: true });
}
if (ok) log(`올리기 성공 — ${PROJECT}.pages.dev (${sha.slice(0, 7) || '커밋 모름'})`);
process.exit(0);
