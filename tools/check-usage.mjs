// 무료 한도 사용량 감시 (#22, 2026-10-29) — 6시간마다 갱신 시작 때 (daily-rebuild.yml).
// 한도의 70% · 90% · 100% 에 닿으면 종류마다 이슈 하나 + 디스코드, 단계가 바뀔 때만 알리고 70% 아래로 내려가면 닫는다.
// 넘기면 무엇이 멈추는지 · 어떻게 대응하는지는 CLAUDE.md '무료 한도 · 장애 대비'.
//
//   node tools/check-usage.mjs              ← 시크릿이 없는 서비스는 건너뛴다 (다른 점검은 그대로)
//   node tools/check-usage.mjs --scale 0.001 ← 한도를 일부러 낮춰 이슈가 열리는지 시험 (Actions 수동 실행)
//
// 시크릿 (GitHub 저장소 Settings → Secrets → Actions, 사용자가 넣음):
//   VERCEL_TOKEN      Vercel Account Settings → Tokens. 범위 = 이 팀만, 만료일 지정 (Vercel 토큰은 읽기 전용이 따로 없다)
//   UPSTASH_EMAIL · UPSTASH_API_KEY   Upstash 콘솔 Account → Developer API → 키 만들기(Read Only).
//                    Vercel 등 다른 곳을 통해 만든 Upstash 계정은 이 API 를 못 쓴다 (공식 문서) — 그러면 이 둘을 넣지 않는다
// 토큰 값은 로그에 찍지 않는다 (요청 머리에만).
import { syncReports } from './health-issues.mjs';

const VERCEL_TOKEN = process.env.VERCEL_TOKEN;
const VERCEL_TEAM = process.env.VERCEL_TEAM_SLUG || '';
const UPSTASH_EMAIL = process.env.UPSTASH_EMAIL;
const UPSTASH_KEY = process.env.UPSTASH_API_KEY;

const scaleArg = process.argv.indexOf('--scale');
const SCALE = scaleArg > 0 ? Number(process.argv[scaleArg + 1]) : 1;
if (!(SCALE > 0)) throw new Error('--scale 은 0 보다 큰 수');
const LEVELS = [100, 90, 70];
/** 요청마다 시간 제한 — 응답이 없으면 재배포 단계까지 밀리지 않게 */
const TIMEOUT_MS = 30_000;
/** 오류 응답 본문은 짧게 한 줄로만 (이슈 본문은 Actions 로그처럼 가려지지 않는다) */
const errText = async (res) => (await res.text()).replace(/\s+/g, ' ').slice(0, 120);

const GB = 1e9;
const HOUR = 3600;
/** 값 종류마다 기준 단위로 바꾸는 표 (데이터 = 바이트, 시간 = 초, 메모리·시간 = GB·시간, 개수 = 1) */
const UNITS = {
  data: { b: 1, byte: 1, bytes: 1, kb: 1e3, mb: 1e6, gb: GB, tb: 1e12 },
  time: { ms: 1e-3, millisecond: 1e-3, milliseconds: 1e-3, s: 1, sec: 1, second: 1, seconds: 1, min: 60, minute: 60, minutes: 60, h: HOUR, hr: HOUR, hrs: HOUR, hour: HOUR, hours: HOUR },
  memtime: { 'gb-hr': 1, 'gb-hrs': 1, 'gb-hour': 1, 'gb-hours': 1, 'gb hours': 1, 'gb-h': 1 },
  count: { '': 1, unit: 1, units: 1, count: 1, request: 1, requests: 1, invocation: 1, invocations: 1, operation: 1, operations: 1, transformation: 1, transformations: 1, event: 1, events: 1 },
};

/**
 * Vercel Hobby 무료 한도 (2026-10-29 vercel.com/docs/plans/hobby · vercel-blob/usage-and-pricing).
 * `ServiceName` 을 이름으로 찾는다 — 실제 이름 · 단위가 다르면 로그의 '모르는 항목' 을 보고 고친다.
 * size: 저장 용량처럼 쌓이는 값은 날마다 더하지 않고 가장 큰 날 값.
 */
const VERCEL_LIMITS = [
  { label: 'Fast Data Transfer', match: /fast data transfer/i, kind: 'data', limit: 100 * GB },
  { label: 'Fast Origin Transfer', match: /fast origin transfer/i, kind: 'data', limit: 10 * GB },
  { label: 'CDN 요청', match: /(edge|cdn) requests?/i, kind: 'count', limit: 1_000_000 },
  { label: '함수 호출', match: /function invocations?/i, kind: 'count', limit: 1_000_000 },
  { label: 'Active CPU', match: /active cpu/i, kind: 'time', limit: 4 * HOUR },
  { label: 'Provisioned Memory', match: /provisioned memory/i, kind: 'memtime', limit: 360 },
  { label: '이미지 변환', match: /image (optimization )?transformations?/i, kind: 'count', limit: 5_000 },
  { label: 'Blob 저장', match: /blob storage/i, kind: 'data', limit: 1 * GB, size: true },
  { label: 'Blob 읽기(캐시 안 됨)', match: /blob simple operations?/i, kind: 'count', limit: 10_000 },
  { label: 'Blob 올리기 · 목록', match: /blob advanced operations?/i, kind: 'count', limit: 2_000 },
  { label: 'Blob 전송', match: /blob data transfer/i, kind: 'data', limit: 10 * GB },
];

/** Upstash Redis 무료 (2026-10-29 upstash.com/pricing/redis) — 데이터베이스마다 */
const UPSTASH_LIMITS = [
  { label: '명령', field: 'total_monthly_requests', limit: 500_000 },
  { label: '저장', field: 'current_storage', limit: 250e6, data: true },
  { label: '전송', field: 'total_monthly_bandwidth', limit: 10 * GB, data: true },
];

const nf = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 1 });
/** 사람이 읽는 값 — 데이터는 한도(`ref`)가 1GB 보다 작으면 MB 로 */
const show = (v, kind, ref = v) =>
  kind === 'data' ? (ref < GB ? `${nf.format(v / 1e6)}MB` : `${nf.format(v / GB)}GB`) : kind === 'time' ? `${nf.format(v / HOUR)}시간` : kind === 'memtime' ? `${nf.format(v)}GB·시간` : nf.format(v);

/** 단위 문자열 → 기준 단위 배수 (모르면 undefined) */
const factor = (kind, unit) => UNITS[kind][String(unit ?? '').trim().toLowerCase()];

/** 줄마다 { label, used, limit, pct, text } — 가장 높은 단계(0 · 70 · 90 · 100)도 같이 */
function summarize(rows) {
  const level = Math.max(0, ...rows.map((r) => LEVELS.find((l) => r.pct >= l) ?? 0));
  return { rows: rows.sort((a, b) => b.pct - a.pct), level };
}

async function vercelUsage() {
  // Hobby 는 결제 주기가 없어 최근 30일로 본다 (한도는 월 단위). 하루 단위 자료라 UTC 자정에 맞춘다 (to 는 내일 0시, 미포함)
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const to = new Date(today.getTime() + 86400_000);
  const from = new Date(to.getTime() - 30 * 86400_000);
  const url = `https://api.vercel.com/v1/billing/charges?slug=${encodeURIComponent(VERCEL_TEAM)}&from=${from.toISOString()}&to=${to.toISOString()}`;
  const res = await fetch(url, { headers: { authorization: `Bearer ${VERCEL_TOKEN}` }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) {
    const text = await errText(res);
    // Hobby 는 청구가 없어 청구 자료 자체가 없다 (2026-10-29 실제 응답 404 costs_not_found) — 고장이 아니라 '이 요금제는 못 읽음'
    // → 그때는 Vercel 이 보내는 사용량 경고 메일을 디스코드로 옮긴다 (tools/gmail-usage-alert.gs)
    if (res.status === 404 && text.includes('costs_not_found')) return null;
    throw new Error(`Vercel billing/charges ${res.status} ${text}`);
  }
  const lines = (await res.text()).split('\n').filter((l) => l.trim());
  /** ServiceName + 단위별 합계 · 하루 최대 — 로그로 실제 이름을 확인할 수 있게 */
  const groups = new Map();
  for (const line of lines) {
    const c = JSON.parse(line);
    if (c.ChargeCategory && c.ChargeCategory !== 'Usage') continue;
    const q = Number(c.ConsumedQuantity);
    if (!Number.isFinite(q)) continue;
    const key = `${c.ServiceName} [${c.ConsumedUnit ?? ''}]`;
    const g = groups.get(key) ?? { name: c.ServiceName, unit: c.ConsumedUnit, sum: 0, max: 0 };
    g.sum += q;
    g.max = Math.max(g.max, q);
    groups.set(key, g);
  }
  console.log(`Vercel: 30일 청구 줄 ${lines.length}개`);
  for (const [key, g] of groups) console.log(`  ${key}: 합 ${g.sum} · 하루 최대 ${g.max}`);

  // 한도 항목마다 합친다 (이름이 조금 다른 줄이 여럿 — 예: 함수 호출이 런타임별로 — 같은 한도에 들어갈 수 있다)
  const used = new Map();
  const unknown = [];
  for (const g of groups.values()) {
    const def = VERCEL_LIMITS.find((d) => d.match.test(g.name));
    const f = def && factor(def.kind, g.unit);
    if (!def || f === undefined) {
      unknown.push(`${g.name} [${g.unit ?? ''}]`);
      continue;
    }
    used.set(def, (used.get(def) ?? 0) + (def.size ? g.max : g.sum) * f);
  }
  if (unknown.length) console.log(`  모르는 항목(알림에서 뺌 — 한도표에 넣을지 확인): ${unknown.join(', ')}`);
  const rows = [...used].map(([def, u]) => {
    const limit = def.limit * SCALE;
    return { label: def.label, used: u, limit, pct: (u / limit) * 100, text: `${show(u, def.kind, limit)} / ${show(limit, def.kind)}` };
  });
  // 응답은 왔는데 맞는 항목이 없으면 0% 로 보지 않는다 — 열린 '넘음' 이슈를 잘못 닫지 않게
  if (!rows.length) throw new Error(`응답은 왔지만 한도표와 맞는 항목이 없음 (청구 줄 ${lines.length}개 — Actions 로그의 항목 이름 · 단위 확인)`);
  return summarize(rows);
}

async function upstashUsage() {
  const auth = `Basic ${Buffer.from(`${UPSTASH_EMAIL}:${UPSTASH_KEY}`).toString('base64')}`;
  const get = async (path) => {
    const res = await fetch(`https://api.upstash.com/v2${path}`, { headers: { authorization: auth }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) throw new Error(`Upstash ${path} ${res.status} ${await errText(res)}`);
    return res.json();
  };
  const dbs = await get('/redis/databases');
  const rows = [];
  for (const db of dbs) {
    const stats = await get(`/redis/stats/${encodeURIComponent(db.database_id)}`);
    const name = dbs.length > 1 ? `${db.database_name} ` : '';
    for (const def of UPSTASH_LIMITS) {
      const used = Number(stats[def.field]);
      if (!Number.isFinite(used)) continue;
      const limit = def.limit * SCALE;
      const kind = def.data ? 'data' : 'count';
      rows.push({ label: `${name}${def.label}`, used, limit, pct: (used / limit) * 100, text: `${show(used, kind, limit)} / ${show(limit, kind)}` });
    }
  }
  console.log(`Upstash: 데이터베이스 ${dbs.length}개 — ${rows.map((r) => `${r.label} ${nf.format(r.pct)}%`).join(' · ')}`);
  if (!rows.length) throw new Error(`응답은 왔지만 사용량 값이 없음 (데이터베이스 ${dbs.length}개)`);
  return summarize(rows);
}

const SERVICES = {
  vercel: {
    name: 'Vercel',
    ready: Boolean(VERCEL_TOKEN),
    read: vercelUsage,
    effect: 'Hobby 는 추가 요금을 낼 수 없어 넘기면 대개 30일 동안 그 기능이 멈추고, 사이트 전체가 꺼질 수 있습니다.',
    plan: '대응: 원인(트래픽 급증 · 봇)을 Vercel 대시보드 Usage 에서 확인 → 필요하면 Firewall 로 막기. 멈추면 Cloudflare Pages 예비 배포로 DNS 전환 (#33).',
  },
  upstash: {
    name: 'Upstash Redis',
    ready: Boolean(UPSTASH_EMAIL && UPSTASH_KEY),
    read: upstashUsage,
    effect: '무료 한도를 넘기면 가이드 · 팁 쓰기 · 추천 · 로그인 저장이 멈춥니다 (읽기는 정적 스냅샷 — #21).',
    plan: '대응: 무료 유지가 결정이라 다음 달 초기화까지 읽기 전용. 명령이 왜 늘었는지 확인 (#20 명령 줄이기 · #18 요청 제한).',
  },
};

const reports = {};
const kinds = [];
const failures = [];
for (const [key, s] of Object.entries(SERVICES)) {
  if (!s.ready) {
    console.log(`${s.name}: 시크릿이 없어 건너뜀`);
    continue;
  }
  const kind = `usage-${key}`;
  let result;
  try {
    result = await s.read();
  } catch (e) {
    // 못 읽으면 그 종류의 이슈는 건드리지 않고(열려 있으면 그대로), 읽기 실패만 따로 알린다
    console.warn(`${s.name} 사용량을 못 읽음: ${e.message}`);
    failures.push({ name: s.name, message: e.message });
    continue;
  }
  if (result === null) {
    // 이 요금제에선 읽을 자료가 없음 — 열려 있는 사용량 이슈도 건드리지 않는다
    console.log(`${s.name}: 이 요금제는 API 로 사용량을 주지 않음 (Hobby) — 메일 알림(tools/gmail-usage-alert.gs)으로 본다`);
    continue;
  }
  kinds.push(kind);
  if (!result.level) {
    reports[kind] = null;
    continue;
  }
  // 제목엔 단계만 — 1위 항목이 바뀔 때마다 알림이 가지 않게 (항목은 본문 표에)
  reports[kind] = {
    title: `[Urnlock] ${s.name} 무료 한도 ${result.level >= 100 ? '넘음' : `${result.level}%`}`,
    body: [
      `${s.name} 무료 한도 사용량이 ${result.level}% 를 넘었습니다${SCALE !== 1 ? ` (시험 실행 — 한도 × ${SCALE})` : ''}. ${s.effect}`,
      '',
      '| 항목 | 사용 / 한도 | % |',
      '|---|---|---|',
      ...result.rows.map((r) => `| ${r.label} | ${r.text} | ${nf.format(r.pct)}% |`),
      '',
      s.plan,
      '70% 아래로 내려가면 자동으로 닫힙니다 (Vercel 은 최근 30일, Upstash 는 이번 달 기준). 숫자는 6시간마다 고쳐지고, 단계(70 · 90 · 넘음)가 바뀔 때만 알립니다.',
    ].join('\n'),
  };
}
if (Object.values(SERVICES).some((s) => s.ready)) {
  kinds.push('usage-read');
  reports['usage-read'] = failures.length
    ? {
        // 제목에 서비스 이름 — 다른 서비스도 못 읽게 되면 제목이 바뀌어 다시 알린다
        title: `[Urnlock] 무료 한도 사용량을 읽지 못했어요 (${failures.map((f) => f.name).join(' · ')})`,
        body: [
          '사용량 감시가 아래 서비스의 사용량을 읽지 못해, 한도에 가까워져도 알림이 오지 않습니다.',
          '',
          ...failures.map((f) => `- ${f.name}: ${f.message}`),
          '',
          '401 · 403 이면 토큰이 만료됐거나 권한이 없는 것 — GitHub 시크릿(VERCEL_TOKEN · UPSTASH_EMAIL · UPSTASH_API_KEY)을 새로 넣어 주세요.',
          '맞는 항목이 없다면 Actions 로그의 항목 이름 · 단위를 보고 `tools/check-usage.mjs` 의 한도표를 고친다. 다시 읽히면 자동으로 닫힙니다.',
        ].join('\n'),
      }
    : null;
}

// 숫자 · 오류 문구는 실행마다 달라지므로 제목(단계)이 바뀔 때만 알린다
await syncReports(reports, kinds, { notifyOnTitleOnly: kinds });
