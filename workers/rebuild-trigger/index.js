/**
 * 6시간 재빌드 깨우기 — Cloudflare Worker 예약 실행 (2026-11-02).
 * GitHub Actions 예약(daily-rebuild.yml 의 schedule)이 3–4시간씩 밀리거나 통째로 빠져(11/2 07:37 · 13:37 KST 둘 다 안 돎) 사이트 데이터가 멈췄다.
 * Cloudflare 예약은 거의 정시에 돌므로 여기서 daily-rebuild 를 workflow_dispatch 로 부른다. GitHub 예약은 예비로 남긴다:
 *   - 여기서 부를 때 입력 source=worker 를 넣어 실행 이름이 'daily-rebuild (Worker)' 가 된다. 워크플로 첫 단계는 그 이름의 실행이 최근 6시간 10분 안에 있으면
 *     (= 이 Worker 가 살아 있음) 늦게 온 예약 실행을 스스로 취소한다. 수동 실행은 세지 않는다.
 *   - 여기서는 1시간 안에 시작한 실행이 성공했거나, 예약이 아닌 실행(수동 · Worker)이 도는 중일 때만 건너뛴다.
 *     도는 중인 예약 실행은 세지 않는다 — 6시간 넘게 늦은 예약이 이 차례 직전에 와서 스스로 취소하는 중일 수 있어서 (#84 3차 리뷰, 10/31 에 2분 28초 전 도착).
 *     직전 Worker 차례가 실패해 제때 온 예약이 빌드 중이면 concurrency 대기열로 한 번 더 빌드한다(대기는 하나만 남아 그 이상 쌓이지 않음).
 *     창을 넓게 잡으면(예전 안 3시간) 3시간 넘게 늦은 예약을 '최근' 으로 보고 정시 차례를 건너뛰어 GitHub 의 늦은 시각으로 끌려간다 (#84 1차 리뷰).
 *
 * 비밀값 (Worker → Settings → Variables and Secrets, 코드 · wrangler.toml 에 적지 않는다):
 *   GITHUB_TOKEN     fine-grained 토큰 — 저장소 Vonsas/dldb 하나, 권한 Actions: Read and write 만 (만료일은 토큰에 — 끝나기 전에 새로 만들 것)
 *   DISCORD_WEBHOOK  (선택) 부르기에 실패하면 알림 — 토큰 만료를 알아채려고
 *
 * 새 Steam 글 감시 (2026-11-04, docs/plan-patch-watch.md): 2분마다 deadlock-api /v2/patches 의 가장 최근 Steam 글을 보고, 하루 안에 올라왔는데
 * www 의 health.json currentPatch 와 다르면 daily-rebuild 를 source=patch-{글 번호} 로 부른다 (실행 이름 'daily-rebuild (patch-…)').
 *   - 글마다 한 번만: 그 이름의 실행이 성공했거나 도는 중이면 건너뛴다. 실패 · 취소면 1시간 뒤 다시 부르되 한 글에 3번까지.
 *   - 이름과 상관없는 상한: 글이 올라온 뒤 생긴 workflow_dispatch 실행이 8개(6시간 차례 4번 + 여유)면 더 부르지 않는다 —
 *     run-name 이 어긋나도(새 워크플로가 main 에 들어가기 전 배포 등) 2분마다 빌드하는 일이 없게 (#106 리뷰).
 *   - 영웅 출시 공지도 Steam 글이라 한 번 부른다 (패치가 아니어서 currentPatch 와 끝내 같아지지 않지만 위 '한 번만' 으로 멈춤 — 새 영웅 데이터가 빨리 들어오는 덤).
 *   - 그 빌드가 패치 보관 파일을 커밋 · 푸시하면 Vercel 이 영어 원문으로 먼저 배포한다. 번역은 claude.ai 예약 작업이 따로 한다.
 *   - 실패는 로그만 (2분마다 디스코드가 울리지 않게 — 토큰 문제는 6시간 차례가 알린다).
 * HTTP 주소는 열지 않는다(fetch 처리기 없음 · workers_dev 끔) — 바깥에서 이 Worker 로 재빌드를 부를 수 없다.
 * 소스는 저장소의 이 파일이 원본 — 대시보드에서 고치지 말고 여기서 고친 뒤 다시 붙여 넣거나 `wrangler deploy`. 만들기 · 고치기 절차는 docs/rebuild-trigger.md.
 */
const REPO = 'Vonsas/dldb';
const WORKFLOW = 'daily-rebuild.yml';
/** 예약 글자 — wrangler.toml · 대시보드 Cron Trigger 와 글자까지 같아야 한다. 둘 다 아니면 아무것도 안 한다 (모르는 예약이 6시간 차례로 빠지지 않게) */
const REBUILD_CRON = '37 4,10,16,22 * * *';
const WATCH_CRON = '*/2 * * * *';
/** 이보다 오래된 Steam 글은 보지 않는다 */
const WATCH_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** 같은 글로 부른 실행이 실패 · 취소됐을 때 다시 부르기까지 · 한 글에 부르는 최대 횟수 */
const WATCH_RETRY_MS = 60 * 60 * 1000;
const WATCH_MAX_TRIES = 3;
/** 글이 올라온 뒤 생긴 workflow_dispatch 실행이 이만큼이면 이름과 상관없이 멈춘다 */
const WATCH_MAX_RUNS = 8;
const SITE = 'https://www.urnlock.com';
const PATCHES = 'https://api.deadlock-api.com/v2/patches';
/** 이 안에 시작해 성공했거나 도는 중인 수동 · Worker 실행이 있으면 부르지 않는다 (위 머리 주석) */
const RECENT_MS = 60 * 60 * 1000;

export default {
  async scheduled(event, env, ctx) {
    if (event.cron === REBUILD_CRON) ctx.waitUntil(run(env));
    else if (event.cron === WATCH_CRON) ctx.waitUntil(watch(env));
    else console.error(`[urnlock:rebuild-trigger] 모르는 예약 '${event.cron}' — 아무것도 안 함 (index.js 의 예약 글자와 맞출 것)`);
  },
};

async function run(env) {
  try {
    if (!env.GITHUB_TOKEN) throw new Error('GITHUB_TOKEN 비밀값이 없음');
    const runs = await gh(env, `/repos/${REPO}/actions/workflows/${WORKFLOW}/runs?per_page=5`);
    const now = Date.now();
    // 성공한 실행 · 도는 중인 수동/Worker 실행만 센다 — 실패 · 취소 뒤에는 다시 부르고, 도는 중인 예약은 곧 스스로 취소될 수 있어 세지 않는다 (머리 주석)
    const recent = (runs.workflow_runs ?? []).find(
      (r) =>
        now - Date.parse(r.created_at) < RECENT_MS &&
        (r.conclusion === 'success' || (r.status !== 'completed' && r.event !== 'schedule')),
    );
    if (recent) {
      console.log(`최근 실행 ${recent.created_at} (${recent.status}/${recent.conclusion ?? ''}) — 건너뜀`);
      return;
    }
    await gh(env, `/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`, { ref: 'main', inputs: { source: 'worker' } });
    console.log('daily-rebuild 실행 요청');
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'error';
    console.error(`[urnlock:rebuild-trigger] ${msg}`);
    if (env.DISCORD_WEBHOOK) {
      await fetch(env.DISCORD_WEBHOOK, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: `[Urnlock] 6시간 재빌드를 깨우지 못함 (${msg}) — GitHub 토큰 만료 · 권한을 확인할 것. GitHub 예약 실행은 따로 돈다` }),
      }).catch(() => {});
    }
    throw err;
  }
}

/** 새 Steam 글이 사이트에 아직 없으면 재빌드 (머리 주석 '새 Steam 글 감시') */
async function watch(env) {
  try {
    if (!env.GITHUB_TOKEN) throw new Error('GITHUB_TOKEN 비밀값이 없음');
    const posts = await getJson(PATCHES);
    const now = Date.now();
    const latest = (Array.isArray(posts) ? posts : [])
      .filter((p) => p && p.source === 'steam' && typeof p.link === 'string' && !Number.isNaN(Date.parse(p.pub_date)))
      .sort((a, b) => Date.parse(b.pub_date) - Date.parse(a.pub_date))[0];
    if (!latest || now - Date.parse(latest.pub_date) > WATCH_MAX_AGE_MS) return;
    const id = latest.link.match(/\/view\/(\d+)\/?$/)?.[1];
    if (!id) throw new Error('Steam 글 주소 꼴이 다름');
    const health = await getJson(`${SITE}/health.json`);
    if (health?.currentPatch?.url === latest.link) return;

    const title = `daily-rebuild (patch-${id})`;
    const runs = await gh(env, `/repos/${REPO}/actions/workflows/${WORKFLOW}/runs?event=workflow_dispatch&per_page=30`);
    const all = runs.workflow_runs ?? [];
    const mine = all.filter((r) => r.display_title === title);
    const done = mine.find((r) => r.status !== 'completed' || r.conclusion === 'success');
    const retryLater = mine.find((r) => now - Date.parse(r.created_at) < WATCH_RETRY_MS);
    if (done || retryLater) return;
    if (mine.length >= WATCH_MAX_TRIES) return console.log(`같은 글로 ${mine.length}번 불렀음 — 그만`);
    const since = all.filter((r) => Date.parse(r.created_at) > Date.parse(latest.pub_date)).length;
    if (since >= WATCH_MAX_RUNS) return console.error(`[urnlock:patch-watch] 글 뒤 실행 ${since}개 — 상한이라 멈춤 (실행 이름이 맞는지 확인)`);
    await gh(env, `/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`, { ref: 'main', inputs: { source: `patch-${id}` } });
    console.log(`새 Steam 글 '${String(latest.title).trim().slice(0, 80)}' — daily-rebuild 실행 요청`);
  } catch (err) {
    console.error(`[urnlock:patch-watch] ${err instanceof Error ? err.message : 'error'}`);
  }
}

/** 공개 JSON (deadlock-api · 우리 health.json) — 캐시 안 씀, 8초 제한 */
async function getJson(url) {
  const res = await fetch(url, {
    headers: { accept: 'application/json', 'user-agent': 'urnlock-rebuild-trigger' },
    cache: 'no-store', // compatibility_date 2024-11-11 부터 됨
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`GET ${new URL(url).host} ${res.status}`);
  return res.json();
}

/** GitHub API — body 가 있으면 POST. 오류 메시지엔 상태 코드만 (응답 본문 · 토큰을 남기지 않는다) */
async function gh(env, path, body) {
  const res = await fetch(`https://api.github.com${path}`, {
    method: body ? 'POST' : 'GET',
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${env.GITHUB_TOKEN}`,
      'x-github-api-version': '2022-11-28',
      'user-agent': 'urnlock-rebuild-trigger',
      ...(body && { 'content-type': 'application/json' }),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`github ${body ? 'POST' : 'GET'} ${res.status}`);
  return body ? null : res.json();
}
