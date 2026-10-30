// 점검 결과를 GitHub 이슈 + 디스코드로 알리는 공용 부분 (check-health.mjs · check-usage.mjs, 2026-10-29 나눔).
// 같은 종류의 이슈는 하나만 열어 두고, 본문의 숨은 표시(<!-- urnlock-health:종류 -->)로 찾는다.
const REPO = process.env.GITHUB_REPOSITORY; // owner/repo
const TOKEN = process.env.GITHUB_TOKEN;
const OWNER = process.env.GITHUB_REPOSITORY_OWNER || REPO?.split('/')[0];
const DISCORD = process.env.DISCORD_WEBHOOK;

/** GitHub 에 쓸 수 있는지 (로컬 실행이면 false — 이슈 대신 콘솔에 찍는다) */
export const canReport = Boolean(REPO && TOKEN);

/** 디스코드 채널로 한 줄 알림 (웹후크가 없으면 건너뜀). 실패해도 이슈 처리는 계속 */
export async function discord(text) {
  if (!DISCORD) return false;
  const res = await fetch(DISCORD, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content: text.slice(0, 1900), allowed_mentions: { parse: [] } }),
  }).catch((e) => e);
  if (res instanceof Error || !res.ok) console.warn(`디스코드 알림 실패: ${res instanceof Error ? res.message : res.status}`);
  return true;
}
/** 디스코드에 보낼 요약 — 제목 + 본문 첫 단락 + 이슈 주소 */
const brief = (report, url) => `**${report.title}**\n${report.body.split('\n\n')[0]}\n${url}`;

const gh = async (method, url, body) => {
  const res = await fetch(`https://api.github.com/repos/${REPO}${url}`, {
    method,
    headers: { authorization: `Bearer ${TOKEN}`, accept: 'application/vnd.github+json', 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`GitHub ${method} ${url} → ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
};

/**
 * 종류마다: 알릴 내용이 있으면 이슈를 열거나 고치고, 없으면(null) 열려 있던 이슈를 닫는다.
 * `notifyOnTitleOnly` 인 종류는 제목이 바뀔 때만 댓글 · 디스코드로 알리고, 본문만 바뀌면 조용히 고친다
 * (사용량처럼 숫자가 매번 바뀌는 알림 — 단계(70% → 90%)가 바뀔 때만 알리려고).
 */
export async function syncReports(reports, kinds, { notifyOnTitleOnly = [] } = {}) {
  if (!canReport) {
    console.log('GITHUB_REPOSITORY / GITHUB_TOKEN 이 없어 이슈는 만들지 않음 (로컬 실행)');
    console.log(JSON.stringify(Object.fromEntries(kinds.map((k) => [k, reports[k]])), null, 1));
    return;
  }
  const open = await gh('GET', '/issues?state=open&per_page=100');
  for (const kind of kinds) {
    const report = reports[kind];
    const marker = `<!-- urnlock-health:${kind} -->`;
    const existing = open.find((i) => !i.pull_request && i.body?.includes(marker));
    if (!report) {
      if (existing) {
        await gh('POST', `/issues/${existing.number}/comments`, { body: '해결되어 자동으로 닫습니다.' });
        await gh('PATCH', `/issues/${existing.number}`, { state: 'closed' });
        console.log(`closed #${existing.number} (${kind})`);
        await discord(`[해결됨] ${existing.title}\n${existing.html_url}`);
      }
      continue;
    }
    const body = `${report.body}\n\n@${OWNER}\n${marker}`;
    if (!existing) {
      const created = await gh('POST', '/issues', { title: report.title, body });
      console.log(`opened #${created.number} (${kind})`);
      await discord(brief(report, created.html_url));
    } else if (existing.body !== body || existing.title !== report.title) {
      await gh('PATCH', `/issues/${existing.number}`, { title: report.title, body });
      if (notifyOnTitleOnly.includes(kind) && existing.title === report.title) {
        console.log(`updated #${existing.number} quietly (${kind})`);
        continue;
      }
      await gh('POST', `/issues/${existing.number}/comments`, { body: `내용이 바뀌었습니다.\n\n${report.body}` });
      console.log(`updated #${existing.number} (${kind})`);
      await discord(brief(report, existing.html_url));
    }
  }
}
