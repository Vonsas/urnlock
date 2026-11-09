/**
 * 유저 가이드 (2026-10-06)
 *   GET    /api/guides?hero=영웅ID&sort=votes|new   목록 (최대 60개, 요약만). CDN 60초 캐시
 *   GET    /api/guides?id=가이드ID                   한 편 공개 본문 + 추천 수. 쿠키와 무관해 목록처럼 CDN 60초 캐시 (#19, 2026-10-29)
 *   GET    /api/guides?id=가이드ID&me=1              그 글의 '내 정보' — 추천했는지 · 내 글인지 · 지금 추천 수, 내 글이면 수정용 원본 · 작성자 표시.
 *                                                    캐시 없음. 화면은 로그인 표시 쿠키(ul_who)가 있을 때만 부른다. 로그인 안 했으면 저장소를 읽지 않고 빈 값.
 *                                                    따로 함수(api/guide-me.ts)였다가 무료 요금제 함수 12개 한도를 넘어 여기로 합침 (2026-10-29, tools/check-functions.mjs)
 *   POST   /api/guides {hero, title, sections, video, display}       새 글 — 스팀 인증한 사람만. 검사를 통과하면 바로 공개
 *   PUT    /api/guides {id, hero, title, sections, video, display}   글쓴이 본인만 수정 (2026-10-07). 추천 수·올린 시각은 그대로
 *   DELETE /api/guides?id=가이드ID                   글쓴이 본인만 삭제 (사진도 저장소에서 지움)
 * 검사는 쓰기 화면과 같은 checkGuide — 막히면 {problem: 이유·자리·걸린 말} 을 돌려줘 화면이 그 자리를 짚는다.
 * 안전장치: 같은 사이트 요청만 · 서명 쿠키 · 차단 계정 · 새 글 계정당 하루 3편 · IP 당 시간당 10편 · 수정 계정당 하루 30번.
 * 사진: 이 사람이 /api/guide-image 로 올린 주소만 받는다 (img:{주소} 기록으로 확인). 올리면 바로 공개 (2026-10-09 사용자: 검토는 빼고 운영자 삭제만 —
 *   /admin [사진] 에서 지운다). 수정할 때 원래 있던 사진은 그대로, 빠진 사진은 저장소에서 지운다.
 */
import {
  DEFAULT_DISPLAY,
  GENERAL,
  isAuthorDisplay,
  GUIDE_DAILY_LIMIT,
  GUIDE_IMAGES,
  SECTIONS_MAX,
  checkGuide,
  normalizeBody,
  normalizeTitle,
  youtubeId,
  type AuthorDisplay,
  type GuideError,
  type GuideImage,
  type GuideProblem,
  type GuideSection,
} from '../src/lib/guide-format.js';
import { canonicalQuery, clientIp, json, sameOrigin, storeDown } from './_lib/http.js';
import { bump, pipeline, redis } from './_lib/redis.js';
import { userSession, type UserSession } from './_lib/session.js';
import { PENDING_IMAGES, guideKey, isGuideId, loadGuides, newGuideId, newKey, parseGuides, removeGuide, toGuide, toSummary, votersKey, votesKey, type StoredGuide } from './_lib/guides-store.js';
import { authorSnapshot } from './_lib/tips-store.js';
import { isHeroId } from './_lib/heroes.js';
import { UNUSED, deleteImages, imageKey } from './_lib/images.js';
import { limited } from './_lib/limit.js';

const heroParam = (v: unknown) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n < 10_000 ? n : null; // 0 = 게임 가이드
};

/** 목록 · 한 편 · 내 정보(me) GET 이 받는 값 — 그 밖의 값이 붙은 주소는 저장소를 읽기 전에 거절 (아무 값이나 붙여 CDN 캐시를 비켜 가며 무료 한도를 쓰지 못하게, 2026-10-14 점검) */
const GET_PARAMS = new Set(['id', 'hero', 'sort', 'me']);
// stale-if-error — 저장소가 멈춰 503 이면 CDN 이 하루 동안 옛 응답을 대신 준다 (Vercel CDN 지원, #21)
// CDN 이 주소만으로 캐시하므로, 이 응답은 요청 헤더 · 쿠키 · 방문자(clientIp · originOf)에 따라 달라지면 안 된다 (#59 리뷰)
const PUBLIC_CACHE = { 'cache-control': 'public, s-maxage=60, stale-while-revalidate=300, stale-if-error=86400' };

export async function GET(request: Request): Promise<Response> {
  const busy = limited(request, 'read');
  if (busy) return busy;
  const q = new URL(request.url).searchParams;
  if ([...q.keys()].some((k) => !GET_PARAMS.has(k))) return json({ error: 'missing' }, 400);
  try {
    const id = q.get('id');
    if (id !== null && q.has('me')) {
      // 내 정보는 정확히 ?id=…&me=1 만 (캐시 없음 — 사람마다 다른 응답)
      if (!isGuideId(id) || q.get('me') !== '1' || !canonicalQuery(request, ['id', 'me']) || q.has('hero') || q.has('sort')) return json({ error: 'missing' }, 404);
      return await guideMe(request, id);
    }
    if (id !== null) {
      // 한 편은 정확히 ?id=… 하나만 — 다른 값 · 다른 꼴의 주소로 캐시를 비켜 가지 못하게
      if (!isGuideId(id) || !canonicalQuery(request, ['id']) || q.has('hero') || q.has('sort')) return json({ error: 'missing' }, 404);
      const [g] = await loadGuides([id]);
      // 없는 글도 짧게 캐시 — 지운 · 내린 글의 옛 200 응답이 재검증 동안 오래 남지 않게, 같은 없는 주소가 저장소를 계속 읽지 않게
      if (!g) return json({ error: 'missing' }, 404, PUBLIC_CACHE);
      const votes = Number((await redis<string | null>('ZSCORE', votesKey(), id)) ?? 0);
      // 쿠키를 읽지 않는다 — 누가 받아도 같은 응답이라 CDN 이 나눠 줘도 된다 (익명 글은 toGuide 가 계정을 지운 값)
      return json({ guide: toGuide(g, votes, null) }, 200, PUBLIC_CACHE);
    }
    // hero=heroes → 영웅 가이드 전체 (게임 가이드 빼고), hero=0 → 게임 가이드. 따로 묶음이 없어 전체 앞쪽 200편에서 거른다
    const heroesOnly = q.get('hero') === 'heroes';
    const hero = q.has('hero') && !heroesOnly ? heroParam(q.get('hero')) : undefined;
    if (hero === null) return json({ error: 'hero' }, 400);
    // 목록도 화면이 보내는 꼴만 (?hero=7&sort=votes — '07' · 순서 바꾼 주소 · 모르는 sort 는 거절)
    const sort = q.get('sort');
    if ((hero !== undefined && q.get('hero') !== String(hero)) || (sort !== null && sort !== 'votes' && sort !== 'new') || !canonicalQuery(request, ['hero', 'sort']))
      return json({ error: 'hero' }, 400);
    // 추천순은 목록의 점수가 곧 추천 수라 WITHSCORES 로 같이 받는다 (#20 — 추천 수 읽기 1회를 덜어 3 → 2회).
    // 영웅별 추천 점수는 전체 점수와 함께 움직인다 (추천 · 취소 · 영웅 바꾸기 모두 둘 다 고침)
    const byVotes = q.get('sort') !== 'new';
    const range = await redis<string[]>('ZRANGE', byVotes ? votesKey(hero) : newKey(hero), 0, heroesOnly ? 199 : 59, 'REV', ...(byVotes ? ['WITHSCORES'] : []));
    const ids = byVotes ? range.filter((_, i) => i % 2 === 0) : range;
    const votes = new Map<string, number>(byVotes ? ids.map((id, i) => [id, Number(range[i * 2 + 1])]) : []);
    let loaded: StoredGuide[] = [];
    if (ids.length) {
      // 최신순은 추천 수를 따로 — 글과 같은 왕복으로
      const [raw, scores] = await pipeline<[Array<string | null>, Array<string | null>?]>([['MGET', ...ids.map(guideKey)], ...(byVotes ? [] : [['ZMSCORE', votesKey(), ...ids]])]);
      loaded = parseGuides(raw);
      if (scores) ids.forEach((id, i) => votes.set(id, Number(scores[i] ?? 0)));
    }
    // 영웅별 목록엔 지금 그 영웅인 글만 — 영웅을 바꾸는 사이 추천이 들어오면 옛 영웅 목록에 다시 생길 수 있다 (#20 리뷰)
    const guides = heroesOnly ? loaded.filter((g) => g.hero !== GENERAL).slice(0, 60) : hero !== undefined ? loaded.filter((g) => g.hero === hero) : loaded;
    return json({ guides: guides.map((g) => toSummary(g, votes.get(g.id) ?? 0)) }, 200, PUBLIC_CACHE);
  } catch (e) {
    return storeDown(e) ?? json({ error: 'server' }, 500);
  }
}

/** 그 글의 '내 정보' (GET ?id=&me=1) — 공개 본문은 CDN 이 나눠 주므로 사람마다 다른 것만. 응답은 언제나 no-store (json 기본값) */
async function guideMe(request: Request, id: string): Promise<Response> {
  const session = await userSession(request).catch(() => null);
  if (!session) return json({ voted: false, mine: false });
  // 글 · 추천 수 · 추천 여부를 한 왕복으로 (#20, 명령 수는 같음)
  const [raw, score, voted] = await pipeline<[Array<string | null>, string | null, number]>([
    ['MGET', guideKey(id)],
    ['ZSCORE', votesKey(), id],
    ['SISMEMBER', votersKey(id), session.a],
  ]);
  const [g] = parseGuides(raw);
  if (!g) return json({ error: 'missing' }, 404);
  const votes = Number(score ?? 0);
  const mine = session.a === g.accountId;
  // 원본 · 작성자 표시는 본인에게만 — 수정 화면이 채우고, 고친 직후 보기 화면도 캐시된 옛 본문 대신 이걸 쓴다
  return json({ voted: voted === 1, mine, votes, ...(mine && { display: g.display ?? 'public', guide: toGuide(g, votes, session.a) }) });
}

const fail = (error: GuideError, status = 400, extra: Partial<GuideProblem> = {}) => json({ problem: { error, ...extra } }, status);

interface Parsed {
  hero: number;
  title: string;
  sections: GuideSection[];
  video: string | null;
  display: AuthorDisplay;
}

/** 요청 본문 → 정리 · 검사한 글. 문제가 있으면 바로 돌려줄 응답 */
async function parse(request: Request): Promise<{ body: Record<string, unknown>; input: Parsed } | Response> {
  let body: { hero?: unknown; title?: unknown; sections?: unknown; video?: unknown; display?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return fail('server');
  }
  if (!body || typeof body !== 'object') return fail('server'); // JSON null · 숫자 (#78)
  // 숫자만 — Number('') · Number(false) · Number([]) 가 0(게임 가이드)이 되지 않게 (#115 리뷰)
  const hero = typeof body.hero === 'number' ? heroParam(body.hero) : null;
  if (typeof body.title !== 'string' || !Array.isArray(body.sections) || body.sections.length > SECTIONS_MAX) return fail('server');
  const sections: GuideSection[] = [];
  for (const raw of body.sections as unknown[]) {
    const x = raw as { title?: unknown; body?: unknown; images?: unknown };
    if (typeof x?.title !== 'string' || typeof x.body !== 'string') return fail('server');
    const imgs = Array.isArray(x.images) ? (x.images as unknown[]) : [];
    if (imgs.length && !GUIDE_IMAGES) return fail('server');
    const images: GuideImage[] = [];
    for (const im of imgs) {
      const url = (im as { url?: unknown })?.url;
      if (typeof url !== 'string' || !url.startsWith('https://') || url.length > 300) return fail('server');
      images.push({ url, w: 0, h: 0 });
    }
    sections.push({ title: normalizeTitle(x.title), body: normalizeBody(x.body), images });
  }
  // 화면은 유튜브 ID 를 보내지만, 주소가 와도 받는다
  const rawVideo = typeof body.video === 'string' ? body.video.trim() : '';
  const video = /^[A-Za-z0-9_-]{11}$/.test(rawVideo) ? rawVideo : youtubeId(rawVideo);
  if (rawVideo && !video) return fail('video');
  const title = normalizeTitle(body.title);
  const problem = checkGuide({ hero, title, sections: sections.map((x) => ({ ...x, images: x.images.length })), video: '' });
  if (problem) return json({ problem }, 400);
  return { body, input: { hero: hero!, title, sections, video: video ?? null, display: isAuthorDisplay(body.display) ? body.display : DEFAULT_DISPLAY } };
}

/**
 * 사진 확인 — keep 에 있는 주소(수정 전 글의 사진)는 원래 기록 그대로, 그 밖의 주소는 이 계정이 올린 것만 (가로·세로도 그때 읽은 값으로).
 * 아니면 false. 새로 들어온 주소 목록을 돌려준다
 */
async function attachImages(sections: GuideSection[], session: UserSession, keep: Map<string, GuideImage> = new Map()): Promise<string[] | false> {
  const fresh = sections.flatMap((x) => x.images.map((im) => im.url)).filter((u) => !keep.has(u));
  const byUrl = new Map<string, { a: number; w: number; h: number }>();
  if (fresh.length) {
    const recs = await redis<Array<string | null>>('MGET', ...fresh.map(imageKey));
    for (const [i, r] of recs.entries()) {
      const rec = r ? (JSON.parse(r) as { a: number; w: number; h: number }) : null;
      if (!rec || rec.a !== session.a) return false;
      byUrl.set(fresh[i], rec);
    }
  }
  for (const x of sections)
    x.images = x.images.map((im) => {
      const old = keep.get(im.url);
      if (old) return old;
      const rec = byUrl.get(im.url)!;
      return { url: im.url, w: rec.w, h: rec.h };
    });
  return fresh;
}

/** 새로 쓰인 사진 — 정리 대상에서 뺀다 (guideId · now 는 예전 확인 줄용으로 남은 인자) */
async function claimImages(fresh: string[], guideId: string, now: number) {
  if (!fresh.length) return;
  await pipeline([
    ['ZREM', UNUSED, ...fresh],
    ['DEL', ...fresh.map(imageKey)],
  ]);
  void guideId;
  void now;
}

async function guard(request: Request): Promise<UserSession | Response> {
  if (!sameOrigin(request)) return fail('auth', 403);
  const session = await userSession(request).catch(() => null);
  if (!session) return fail('auth', 401);
  if ((await redis<number>('SISMEMBER', 'tips:banned', session.a)) === 1) return fail('banned', 403);
  return session;
}

export async function POST(request: Request): Promise<Response> {
  const busy = limited(request, 'write');
  if (busy) return busy;
  try {
    const session = await guard(request);
    if (session instanceof Response) return session;
    const parsed = await parse(request);
    if (parsed instanceof Response) return parsed;
    const { input } = parsed;
    // 게임 가이드(0, 2026-11-04 다시 받음) 또는 실제 출시 영웅만 — 없는 번호는 안 됨
    if (input.hero !== GENERAL && !(await isHeroId(input.hero))) return fail('hero');
    // 사진 확인을 한도 세기 전에 — 거절된 글이 하루 3편을 깎지 않게
    const fresh = await attachImages(input.sections, session);
    if (!fresh) return fail('server');

    const day = new Date().toISOString().slice(0, 10);
    const hour = new Date().toISOString().slice(0, 13);
    if ((await bump(`rate:gip:${clientIp(request)}:${hour}`, 7200)) > 10) return fail('rate', 429);
    if ((await bump(`rate:guide:${session.a}:${day}`, 2 * 86400)) > GUIDE_DAILY_LIMIT) return fail('rate', 429);

    const who = await authorSnapshot(session.a, input.hero);
    const now = Math.floor(Date.now() / 1000);
    const guide: StoredGuide = {
      id: newGuideId(),
      ...input,
      accountId: session.a,
      name: (who.name ?? session.n).slice(0, 40),
      rank: who.rank,
      games: who.games,
      createdAt: now,
      updatedAt: now,
    };
    if ((await redis<string | null>('SET', guideKey(guide.id), JSON.stringify(guide), 'NX')) !== 'OK') return fail('server', 500);
    await pipeline([
      ['ZADD', newKey(), now, guide.id],
      ['ZADD', newKey(guide.hero), now, guide.id],
      ['ZADD', votesKey(), 0, guide.id],
      ['ZADD', votesKey(guide.hero), 0, guide.id],
    ]);
    await claimImages(fresh, guide.id, now);
    return json({ id: guide.id });
  } catch (e) {
    return storeDown(e) ?? fail('server', 500);
  }
}

/** 수정 — 글쓴이 본인만. 추천 수 · 올린 시각 · 작성자 기록(랭크·판수)은 그대로 */
export async function PUT(request: Request): Promise<Response> {
  const busy = limited(request, 'write');
  if (busy) return busy;
  try {
    const session = await guard(request);
    if (session instanceof Response) return session;
    const parsed = await parse(request);
    if (parsed instanceof Response) return parsed;
    const { body, input } = parsed;
    if (!isGuideId(body.id)) return fail('server', 404);
    const [old] = await loadGuides([body.id]);
    if (!old) return fail('server', 404);
    if (old.accountId !== session.a) return fail('auth', 403);
    // 게임 가이드(0) 또는 실제 출시 영웅만
    if (input.hero !== old.hero && input.hero !== GENERAL && !(await isHeroId(input.hero))) return fail('hero');
    if ((await bump(`rate:guide-edit:${session.a}:${new Date().toISOString().slice(0, 10)}`, 2 * 86400)) > 30) return fail('rate', 429);

    const keep = new Map(old.sections.flatMap((x) => x.images.filter((im) => im.url).map((im) => [im.url, im] as const)));
    const fresh = await attachImages(input.sections, session, keep);
    if (!fresh) return fail('server');
    const now = Math.floor(Date.now() / 1000);
    // 영웅을 바꾸면 '기록상 n판' 도 그 영웅 것으로 (게임 가이드는 판수 없음) — 옛 영웅 판수가 남지 않게 (#115 리뷰)
    const games = input.hero === old.hero ? old.games : input.hero === GENERAL ? null : (await authorSnapshot(session.a, input.hero)).games;
    const next: StoredGuide = { ...old, ...input, games, updatedAt: now };
    // XX — 읽은 뒤 그사이 지워졌으면(본인 삭제 · 운영자 내리기 · 차단) 되살리지 않는다 (#78)
    if ((await redis<string | null>('SET', guideKey(old.id), JSON.stringify(next), 'XX')) === null) return fail('server', 404);

    // 영웅을 바꿨으면 영웅별 목록도 옮긴다 (추천 수는 전체 목록의 점수가 원본)
    if (next.hero !== old.hero) {
      const votes = Number((await redis<string | null>('ZSCORE', votesKey(), old.id)) ?? 0);
      await pipeline([
        ['ZREM', newKey(old.hero), old.id],
        ['ZREM', votesKey(old.hero), old.id],
        ['ZADD', newKey(next.hero), old.createdAt, old.id],
        ['ZADD', votesKey(next.hero), votes, old.id],
      ]);
      // 옮기는 사이 들어온 추천은 옛 영웅 점수에만 더해졌을 수 있다 — 원본을 다시 읽어 새 영웅 사본을 맞춘다
      // (영웅별 추천순 목록이 사본 점수를 그대로 보여 주므로, #20 리뷰. 영웅을 바꿀 때만 +1 · 어긋났을 때만 +1)
      const nowVotes = Number((await redis<string | null>('ZSCORE', votesKey(), old.id)) ?? 0);
      if (nowVotes !== votes) await redis('ZADD', votesKey(next.hero), 'XX', nowVotes, old.id);
    }
    // 빠진 사진은 저장소에서 지운다
    const used = new Set(next.sections.flatMap((x) => x.images.map((im) => im.url)));
    await deleteImages([...keep.keys()].filter((u) => !used.has(u)));
    await claimImages(fresh, old.id, now);
    // 확인 대기 사진이 있던 글만 대기 목록에서 뺀다 — 없던 글까지 매번 지우던 명령 1회를 덜었다 (#20)
    const hadPending = old.sections.some((x) => x.images.some((im) => im.pending));
    if (hadPending && !next.sections.some((x) => x.images.some((im) => im.pending))) await redis('ZREM', PENDING_IMAGES, old.id);
    return json({ id: old.id });
  } catch (e) {
    return storeDown(e) ?? fail('server', 500);
  }
}

/** 삭제 — 글쓴이 본인만 */
export async function DELETE(request: Request): Promise<Response> {
  const busy = limited(request, 'write');
  if (busy) return busy;
  try {
    const session = await guard(request);
    if (session instanceof Response) return session;
    const id = new URL(request.url).searchParams.get('id');
    if (!isGuideId(id)) return json({ ok: false }, 404);
    const [g] = await loadGuides([id]);
    if (!g) return json({ ok: false }, 404);
    if (g.accountId !== session.a) return json({ ok: false }, 403);
    await removeGuide(g);
    return json({ ok: true });
  } catch (e) {
    return storeDown(e) ?? json({ ok: false }, 500);
  }
}
