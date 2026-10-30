/**
 * 가이드 신고 (2026-10-07) — POST /api/guide-report {id, reason, text}
 * 로그인 없이도 신고할 수 있다 (사용자: 신고에 인증까지 받을 필요 없다).
 *   같은 글은 한 사람당 한 번 — 스팀 인증했으면 계정으로, 아니면 접속 주소(IP)를 섞어 만든 값으로 센다 (IP 원문은 남기지 않음).
 *   하루 한도: 계정 20번 · 비로그인은 접속 주소당 10번.
 * 자동으로 내리지는 않는다 (몰려와서 신고하면 멀쩡한 글도 내려가므로) — 운영자가 /admin [신고] 에서 보고 내리거나 무시한다.
 *   reports:{가이드ID}     신고 내용 (list, 최근 50개)
 *   guides:reported        신고된 가이드 (sorted set, 점수 = 신고 수)
 *   report:seen:{가이드}:{계정 a… | 주소 i…}   같은 사람의 두 번째 신고 막기 (30일)
 */
import { REPORT_REASONS, type ReportReason } from '../src/lib/guide-format.js';
import { clientIp, json, sameOrigin, storeDown } from './_lib/http.js';
import { bump, pipeline, redis } from './_lib/redis.js';
import { userSession } from './_lib/session.js';
import { REPORTED, isGuideId, loadGuides, reportsKey } from './_lib/guides-store.js';
import { limited } from './_lib/limit.js';

/** 접속 주소를 그대로 남기지 않게 비밀값과 섞어 짧게 */
async function ipTag(ip: string) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${process.env.SESSION_SECRET ?? ''}:${ip}`)));
  return Array.from(bytes.slice(0, 8), (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function POST(request: Request): Promise<Response> {
  const busy = limited(request, 'write');
  if (busy) return busy;
  if (!sameOrigin(request)) return json({ error: 'auth' }, 403);
  const session = await userSession(request).catch(() => null);
  const { id, reason, text } = (await request.json().catch(() => ({}))) as { id?: unknown; reason?: unknown; text?: unknown };
  if (!isGuideId(id) || !REPORT_REASONS.includes(reason as ReportReason)) return json({ error: 'server' }, 400);
  const note = typeof text === 'string' ? text.replace(/\s+/g, ' ').trim().slice(0, 200) : '';
  try {
    // 한도를 먼저 센다 — 같은 요청을 되풀이해 저장소 사용량을 깎지 못하게 (2026-10-14 점검)
    const who = session ? `a${session.a}` : `i${await ipTag(clientIp(request))}`;
    const day = new Date().toISOString().slice(0, 10);
    if ((await bump(`rate:report:${who}:${day}`, 2 * 86400)) > (session ? 20 : 10)) return json({ error: 'rate' }, 429);
    const [g] = await loadGuides([id]);
    if (!g) return json({ error: 'missing' }, 404);
    if (session && (await redis<number>('SISMEMBER', 'tips:banned', session.a)) === 1) return json({ error: 'banned' }, 403);
    // 같은 글 두 번째 신고는 조용히 성공으로 (다시 눌러도 숫자가 늘지 않게)
    if ((await redis<string | null>('SET', `report:seen:${id}:${who}`, '1', 'NX', 'EX', 30 * 86400)) !== 'OK') return json({ ok: true, already: true });
    const entry = JSON.stringify({ reason, text: note, by: session?.a ?? 0, name: session ? session.n.slice(0, 40) : '', tag: session ? undefined : who, at: Math.floor(Date.now() / 1000) });
    await pipeline([
      ['LPUSH', reportsKey(id), entry],
      ['LTRIM', reportsKey(id), 0, 49],
      ['ZINCRBY', REPORTED, 1, id],
    ]);
    return json({ ok: true });
  } catch (e) {
    return storeDown(e) ?? json({ error: 'server' }, 500);
  }
}
