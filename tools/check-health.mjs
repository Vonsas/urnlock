// 배포된 /health.json 을 읽어, 사람이 봐야 할 일이 있으면 GitHub 이슈 + 디스코드로 알린다 (2026-10-05, 디스코드 2026-10-29).
// 이슈는 저장소 주인에게 메일·앱 알림으로 가고, 저장소 시크릿 DISCORD_WEBHOOK 이 있으면 그 채널에도 보낸다.
//
//   node tools/check-health.mjs --status success|failure   ← Vercel 이 Production 배포 결과를 GitHub 에 알릴 때 (health-notify.yml)
//   node tools/check-health.mjs --stale                     ← 6시간마다 갱신 시작 때 (daily-rebuild.yml) — 사이트 데이터가 오래됐는지만
//
//   - 배포: Production 빌드가 실패했거나(데이터 점검에 걸려 멈춤 · 빌드 오류) 데이터가 30시간 넘게 그대로면 → 이슈. 성공한 배포가 오면 닫는다.
//   - 번역: 패치노트에 번역 안 된 줄이 있으면 (새 패치) → 이슈. 0 이 되면 닫는다.
//   - 영웅: 데이터가 덜 들어온 영웅(능력 이름 미번역·상세 없음·이미지 없음)이나 새 영웅이 있으면 → 이슈. 없어지면 닫는다.
//   - Pages (#53, PAGES_DEPLOY=1 일 때): 성공한 배포인데 pages.dev 가 그 빌드가 아니면 → '데이터 점검 실패 — Pages 에 안 올림' 또는 'Pages 올리기 실패'. 반영되면 닫는다.
//     Vercel 배포를 되돌렸을 때(Instant Rollback)도 성공 알림이 와서 Pages 를 같이 안 되돌렸으면 열린다 — 되돌릴 땐 둘 다 (plan-cloudflare-split.md 2절).
// 같은 종류의 이슈는 하나만 열어 두고, 내용이 바뀌면 본문을 고치고 댓글로 알린다. 본문의 숨은 표시(<!-- urnlock-health:종류 -->)로 찾는다.
// 예전엔 갱신 작업이 배포 반영을 최대 20분 기다렸는데, 그 대기가 Actions 무료 시간 대부분을 썼다 (10월 71번 668분) → 결과 알림을 받아 도는 방식으로.
import { discord, syncReports } from './health-issues.mjs';

const SITE = process.env.SITE_URL || 'https://www.urnlock.com';
/** Vercel 이 남긴 배포 결과 설명 (실패면 'npx vercel inspect dpl_… --logs') · 배포 주소 */
const DEPLOY_DESC = process.env.DEPLOY_DESCRIPTION || '';
const DEPLOY_URL = process.env.DEPLOY_URL || '';

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const status = arg('--status'); // success | failure | error
const staleOnly = process.argv.includes('--stale');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const STALE_HOURS = 30;

/** Pages 반영 확인 (#53): 저장소 변수 PAGES_DEPLOY=1 (Vercel 에 Cloudflare 토큰을 넣은 뒤 켬) — 그 전엔 올리기를 안 하므로 확인하지 않는다 */
const PAGES_CHECK = process.env.PAGES_DEPLOY === '1';
const PAGES = process.env.PAGES_URL || 'https://urnlock.pages.dev';
/** Vercel 이 방금 만든 health.json — www 가 Pages 로 넘어간 뒤(⑥)엔 www 가 아니라 여기서 (vercel.json 의 origin 리디렉트가 /health.json 은 뺀다) */
const ORIGIN = process.env.ORIGIN_URL || 'https://origin.urnlock.com';

async function health(base = SITE, init = {}) {
  const res = await fetch(`${base}/health.json?t=${Date.now()}`, { headers: { 'cache-control': 'no-cache' }, ...init });
  if (!res.ok) throw new Error(`health.json ${res.status}`);
  return res.json();
}

let h = await health().catch(() => null);
// 성공 알림이 사이트 주소 연결보다 먼저 올 수 있어, 방금 빌드한 health.json(빌드 시각이 20분 안)이 보일 때까지 최대 3분 기다린다
const fresh = (x) => x && Date.now() / 1000 - x.builtAt < 20 * 60;
for (let i = 0; status === 'success' && i < 6 && !fresh(h); i++) {
  await sleep(30_000);
  h = await health().catch(() => h);
}
const dataAge = h ? (Date.now() / 1000 - (h.dataAt ?? h.builtAt)) / 3600 : Infinity;
console.log(`health: status=${status ?? '-'} stale=${staleOnly} builtAt=${h?.builtAt} dataAge=${dataAge.toFixed(1)}h`);

// Pages 반영 확인 (#53) — Vercel 운영 빌드가 같은 dist 를 Pages 에도 올리므로, 성공한 배포 뒤 pages.dev 의 builtAt 이 이 빌드와 같아야 한다.
// 이 빌드의 health.json: origin = 늘 Vercel 의 지금 운영 배포 (리디렉트를 따라가면 www = Pages 일 수 있어 따라가지 않음 · 알림이 늦어도 되게 20분 기준을 걸지 않음)
// → origin 이 없으면(⑥ 전) www 가 방금 것일 때 www (그때 www = Vercel)
let vercelH = null;
let pagesH = null;
if (PAGES_CHECK && status === 'success') {
  vercelH = await health(ORIGIN, { redirect: 'error' }).catch(() => null);
  if (!vercelH) vercelH = fresh(h) ? h : null;
  const uploaded = (x) => x && (vercelH ? x.builtAt >= vercelH.builtAt : fresh(x));
  pagesH = await health(PAGES).catch(() => null);
  // 올리기는 Vercel 빌드 도중이라 보통 이미 반영돼 있다 — 늦게 퍼질 때만 최대 1분 더
  for (let i = 0; i < 2 && !uploaded(pagesH); i++) {
    await sleep(30_000);
    pagesH = await health(PAGES).catch(() => pagesH);
  }
  if (uploaded(pagesH)) pagesH = { ...pagesH, ok: true };
  console.log(`pages: vercel builtAt=${vercelH?.builtAt ?? '?'} pages builtAt=${pagesH?.builtAt ?? '?'} ok=${Boolean(pagesH?.ok)}`);
}

const fmtDate = (s) => new Date(s * 1000).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
const failed = status === 'failure' || status === 'error';
const stale = dataAge > STALE_HOURS;
const reports = {
  deploy:
    !failed && !stale
      ? null
      : {
          title: failed ? '[Urnlock] 배포 빌드가 실패했어요' : `[Urnlock] 사이트 데이터가 ${Math.round(dataAge)}시간째 그대로예요`,
          body: [
            failed
              ? `Production 빌드가 실패해 사이트는 직전 배포 그대로입니다${h ? ` (마지막 반영 ${fmtDate(h.builtAt)})` : ''}.`
              : `사이트 데이터가 ${h ? fmtDate(h.dataAt ?? h.builtAt) : '?'} 이후 바뀌지 않았습니다 — 6시간마다 갱신이 돌지 않거나 빌드가 계속 실패하고 있습니다.`,
            ...(DEPLOY_DESC ? ['', `Vercel: ${DEPLOY_DESC}`] : []),
            ...(DEPLOY_URL ? [DEPLOY_URL] : []),
            '',
            '가능한 원인',
            '- 티어 데이터 자동 점검에 걸려 빌드를 멈춤 — 틀린 티어 대신 어제 티어를 유지한 것 (Vercel 빌드 로그에 `[dldb:health]` 로 이유가 남음)',
            '- deadlock-api 가 응답하지 않음(504 등) · 빌드 오류 · GitHub Actions 갱신 작업 실패',
            '',
            '확인: Vercel 대시보드 → urnlock → Deployments 의 실패한 배포 → Build Logs. Claude 에게 로그를 보여 주면 됩니다. 지난 기록은 `docs/deploy-failures.md`.',
          ].join('\n'),
        },
  // 배포는 성공했는데 pages.dev 가 이 빌드가 아님 — 점검 문제로 안 올렸거나(PAGES_PRIMARY=1 일 때) 올리기가 실패. 다음 배포에서 반영되면 닫힌다
  pages:
    !PAGES_CHECK || status !== 'success' || pagesH?.ok
      ? null
      : vercelH?.problems?.length
        ? {
            title: '[Urnlock] 데이터 점검 실패 — Pages 에 안 올림',
            body: [
              `Vercel 빌드(${fmtDate(vercelH.builtAt)})의 데이터 점검에 걸려 Cloudflare Pages 에는 올리지 않았습니다. Pages(${PAGES})는 직전 배포 그대로입니다${pagesH ? ` (${fmtDate(pagesH.builtAt)})` : ''}.`,
              '',
              '점검에 걸린 것',
              ...vercelH.problems.map((p) => `- ${p}`),
              '',
              '데이터가 나아지면 다음 6시간 갱신 빌드에 저절로 올라갑니다 (수동 pages-standby 도 같은 점검에 걸리므로 돌리지 않아도 됩니다). 지난 기록은 `docs/deploy-failures.md`.',
            ].join('\n'),
          }
        : {
            title: '[Urnlock] Pages 올리기 실패',
            body: [
              `Vercel 운영 배포는 성공했지만 Cloudflare Pages(${PAGES})에 이 빌드가 올라가지 않았습니다${pagesH ? ` — Pages 는 ${fmtDate(pagesH.builtAt)} 빌드` : ' — Pages 의 health.json 을 읽지 못함'}.`,
              ...(vercelH ? [] : ['', `이번 빌드의 health.json 을 찾지 못해(${ORIGIN} · www 모두) 점검 실패인지 올리기 실패인지 구분하지 못했습니다.`]),
              ...(DEPLOY_URL ? ['', DEPLOY_URL] : []),
              '',
              '확인: Vercel → Deployments 의 이 배포 → Build Logs 에서 `[pages]` 줄 (토큰 만료 · 권한 · wrangler 오류).',
              '바로 새로 하려면 Actions → **pages-standby → Run workflow** (Vercel 과 따로 빌드해 올린다). 다음 배포에서 반영되면 이 이슈는 자동으로 닫힙니다.',
            ].join('\n'),
          },
  untranslated:
    h && Object.values(h.untranslated ?? {}).some((n) => n > 0)
      ? {
          title: `[Urnlock] 패치노트 번역 필요 (${Object.entries(h.untranslated)
            .filter(([, n]) => n > 0)
            .map(([l, n]) => `${l} ${n}줄`)
            .join(' · ')})`,
          body: [
            '새 패치노트에 아직 번역이 없는 줄이 있어 그 줄은 영어 원문으로 보이고 있습니다.',
            '',
            'Claude 에게 "새 패치 번역해줘" 라고 하면 `.cache/patch-i18n/todo-*.json` 을 보고 사전(`src/data/patch-i18n/`)에 채워 넣습니다.',
            '번역이 들어가 0줄이 되면 이 이슈는 자동으로 닫힙니다.',
          ].join('\n'),
        }
      : null,
  // 사이트가 새 글을 '현재 패치' 로 잡았을 때 — 진짜 패치인지 한번 보게 (영웅 출시 공지가 패치로 잡히면 티어·승률표 '현재 패치' 기간이 몇 시간으로 줄어든다)
  patch:
    h?.currentPatch && Date.now() - Date.parse(h.currentPatch.date) < 36 * 3600 * 1000
      ? {
          title: `[Urnlock] 새 패치로 인식: ${h.currentPatch.title}`,
          body: [
            `사이트가 이 글을 새 '현재 패치' 로 보고 티어·승률표·패치노트에 반영했습니다: **${h.currentPatch.title}** (${h.currentPatch.date.slice(0, 10)})`,
            ...(h.currentPatch.url ? [h.currentPatch.url] : []),
            '',
            '진짜 패치(밸런스 변경)면 할 일 없습니다. **영웅 출시 소개 공지**처럼 패치가 아닌 글이면 Claude 에게 "이건 패치 아니야" 라고 알려 주세요',
            '(`src/data/api/patch-posts.ts` 의 판별을 고칩니다). 하루 반이 지나면 이 이슈는 자동으로 닫힙니다.',
          ].join('\n'),
        }
      : null,
  heroes:
    h && (h.heroes?.issues?.length || h.notes?.some((n) => n.startsWith('새 영웅')))
      ? {
          title: '[Urnlock] 영웅 데이터 확인 필요',
          body: [
            '막 출시된 영웅은 deadlock-api 에 데이터가 덜 들어온 채로 사이트에 올라갑니다. 화면이 어색하지 않은지 한번 봐 주세요.',
            '',
            ...(h.notes ?? []).filter((n) => n.startsWith('새 영웅')).map((n) => `- **${n}**`),
            ...(h.heroes?.issues ?? []).map((x) => `- ${x.name}: ${x.issues.join(', ')}`),
            '',
            '능력 이름 번역은 API 가 채우면 다음 재빌드에 자동으로 바뀝니다. 기다리지 않으려면 Claude 에게 "새 영웅 번역해줘" — `src/data/hero-i18n/` 임시 번역 사전에 넣습니다. 모두 해결되면 이 이슈는 자동으로 닫힙니다.',
          ].join('\n'),
        }
      : null,
};

// 실패한 배포 · 오래됨 확인에선 사이트가 직전 배포 그대로라 배포 알림만 다룬다. 오래됨 확인은 열기만 하고 닫는 건 성공한 배포가 한다
const kinds = failed ? ['deploy'] : staleOnly ? (stale ? ['deploy'] : []) : Object.keys(reports);

// --test: 디스코드 연결 확인 (health-notify.yml 을 Actions 탭에서 수동 실행)
if (process.argv.includes('--test')) {
  if (!(await discord(`[Urnlock] 알림 연결 확인 — 사이트 데이터 시각 ${h ? fmtDate(h.dataAt ?? h.builtAt) : '?'}`))) console.log('DISCORD_WEBHOOK 시크릿이 없음');
  process.exit(0);
}

await syncReports(reports, kinds);
