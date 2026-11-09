/**
 * 직전 배포의 가이드 · 팁 스냅샷 이어 쓰기 (#21) — guides-snapshot.ts 가 빌드 때 저장소를 못 읽으면 부른다.
 * Astro 에 기대지 않는 따로 떼어 둔 모듈이라 검사(scratchpad apitest21/reuse.mts)에서 바로 부를 수 있다.
 */
import { GUIDE_BODY_MAX, GUIDE_IMAGES_TOTAL, excerptOf, GUIDE_TITLE_MAX, SECTION_BODY_MAX, SECTION_IMAGES_MAX, SECTION_TITLE_MAX, SECTIONS_MAX, type Guide } from '../lib/guide-format';
import { TIP_MAX_LENGTH, type PublicTip } from '../lib/tips';

/** 스냅샷에 싣는 가이드 수 — 목록 화면이 한 번에 보여 주는 만큼(영웅별 60 · 전체 200). guides-snapshot.ts 도 이 값을 쓴다 */
export const SNAPSHOT_GUIDES_MAX = 200;
/** 영웅마다 팁 수 — /api/tips 와 같게 */
export const SNAPSHOT_TIPS_MAX = 100;
/** 받은 사본이 '지금보다 미래' 라고 우겨 늘 이기지 못하게 — 시계 차이만큼만 봐준다 */
const FUTURE_SLACK_S = 10 * 60;

/**
 * 받은 사본을 실제 서버 한도로 다시 자른다 (#78 점검 — 종류만 보던 때는 가이드 1000편 · 구역 50개 × 1만 자 · 남의 사진 주소 ·
 * builtAt 9e15 가 그대로 들어가 510MB 파일이 됐다). 대체 출처나 www 배포가 털려도 길이 · 개수 · 사진 주소는 서버 한도 안으로 들어온다
 * (링크 · 욕설 검사는 다시 하지 않는다 — 화면은 textContent 로만 그려 스크립트는 못 넣는다).
 */
const imagePrefix = () => {
  const v = (process.env.R2_PUBLIC_URL ?? '').trim().replace(/\/+$/, '');
  // R2 주소가 없는 빌드(Pages 예비 빌드 — Actions 에 R2 변수가 없다)는 지금 운영 주소로.
  // R2_PUBLIC_URL 을 옮기면 이 값도 같이 바꿀 것 — 안 바꾸면 예비 빌드의 이어 쓰기가 사진을 모두 빈 칸으로 만든다 (CLAUDE.md '사진')
  return /^https:\/\/[a-z0-9.-]+$/i.test(v) ? `${v}/` : 'https://img.urnlock.com/';
};
const IMAGE_NAME = /^guides\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$/;

export interface ReusedSnapshot {
  builtAt: number;
  ok: true;
  guides: Guide[];
  tips: Record<number, PublicTip[]>;
}

/**
 * 직전 배포의 스냅샷 — 사이트 주소(SITE_URL · Vercel 빌드는 www)와 SNAPSHOT_FALLBACK_URL(쉼표로 여럿 — Pages 예비 빌드는 자기 pages.dev 주소)의 두 파일.
 * 여러 곳에서 받으면 **본문 · 요약이 다 있는 곳 중 가장 최근(builtAt)** 을 쓴다 — Vercel 이 멈춰 www 가 죽으면 Pages 예비 빌드는 www 대신
 * 자기 직전 사본을 이어 쓴다 (#21 3차 리뷰: 전환 절차 1번 '최신으로 맞추기' 가 빈 스냅샷을 굽던 문제).
 * 내가 굽던 공개 파일을 다시 싣는 것이지만, 받은 값은 알려진 칸만 골라 다시 만든다(모르는 칸은 버리고, 익명이면 계정 0 · 닉네임 '').
 * SNAPSHOT_REUSE=0 이면 이어 쓰지 않는다(guides-snapshot.ts) — 운영자가 내린 글이 옛 사본에 남아 있을 때 빈 스냅샷으로 끊는 비상 스위치.
 */
export async function reuseSnapshot(urls: Array<string | undefined>): Promise<ReusedSnapshot | null> {
  const sources = urls
    .map((x) => (x ?? '').trim())
    // https 만 — http 는 로컬 시험 서버(localhost · 127.0.0.1)일 때만 (#78)
    .filter((x) => /^https:\/\/[^/\s]+/.test(x) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(x));
  if (!sources.length) return null;
  const get = async (site: string, path: string) => {
    try {
      const res = await fetch(new URL(path, site), { signal: AbortSignal.timeout(10_000) });
      return res.ok ? ((await res.json()) as Partial<{ builtAt: number; ok: boolean; guides: unknown[]; tips: Record<string, unknown> }>) : null;
    } catch {
      return null;
    }
  };
  const found = await Promise.all(
    sources.map(async (site) => {
      const [full, summary] = await Promise.all([get(site, '/guides-snapshot-full.json'), get(site, '/guides-snapshot.json')]);
      const now = Math.floor(Date.now() / 1000);
      if (full?.ok !== true || !Array.isArray(full.guides) || typeof full.builtAt !== 'number') return null;
      if (!Number.isFinite(full.builtAt) || full.builtAt <= 0 || full.builtAt > now + FUTURE_SLACK_S) return null;
      const hasTips = summary?.ok === true && !!summary.tips && typeof summary.tips === 'object' && !Array.isArray(summary.tips);
      return { builtAt: full.builtAt, guides: full.guides, tips: hasTips ? summary!.tips! : null };
    }),
  );
  // 요약(팁)까지 있는 곳을 먼저, 그다음 최근 순 — 요약만 못 받은 곳을 쓰면 모든 영웅 탭이 '팁 없음' 으로 보인다
  const best = found
    .filter((x): x is NonNullable<typeof x> => !!x)
    .sort((a, b) => Number(!!b.tips) - Number(!!a.tips) || b.builtAt - a.builtAt)[0];
  if (!best) return null;
  const prefix = imagePrefix();
  blanked = 0;
  const guides = best.guides
    .map((g) => cleanGuide(g, prefix))
    .filter((g): g is Guide => !!g)
    .slice(0, SNAPSHOT_GUIDES_MAX);
  if (blanked) console.warn(`[dldb:snapshot] 이어 쓴 사본의 사진 ${blanked}장이 ${prefix} 주소가 아니라 빈 칸으로 — R2_PUBLIC_URL 을 옮겼다면 snapshot-reuse.ts 의 기본 주소도 바꿀 것`);
  return {
    builtAt: best.builtAt,
    ok: true,
    guides,
    tips: cleanTips(best.tips ?? {}),
  };
}

const str = (v: unknown, max = 10_000) => (typeof v === 'string' ? v.slice(0, max) : '');
/** 0 이상 정수 (위로 max) — 아니면 0 */
const count = (v: unknown, max = Number.MAX_SAFE_INTEGER) => (Number.isSafeInteger(v) && (v as number) >= 0 ? Math.min(v as number, max) : 0);
const rankOf = (v: unknown) => {
  const r = v as { tier?: unknown; sub?: unknown } | null;
  // 단계 0–11 · 하위 등급 0–6 (휘장 n1–n6) 만
  return r && Number.isInteger(r.tier) && Number.isInteger(r.sub) && (r.tier as number) >= 0 && (r.tier as number) <= 11 && (r.sub as number) >= 0 && (r.sub as number) <= 6
    ? { tier: r.tier as number, sub: r.sub as number }
    : null;
};
const gamesOf = (v: unknown) => (Number.isSafeInteger(v) && (v as number) >= 0 ? (v as number) : null);
/** 사진 주소는 우리 R2 공개 주소 + 우리가 만드는 이름 꼴만 — 그 밖(남의 사이트 추적 이미지 등)은 빈 칸(운영자가 지운 사진과 같은 모양) */
let blanked = 0;
const imageUrl = (v: unknown, prefix: string) => {
  const u = str(v, 300);
  if (u.startsWith(prefix) && IMAGE_NAME.test(u.slice(prefix.length))) return u;
  if (u) blanked++;
  return '';
};
/** 받은 가이드 하나를 알려진 칸만으로, 서버 한도 안에서 다시 만든다 — 모양이 틀리거나 한도를 넘으면 버림 */
function cleanGuide(v: unknown, prefix: string): Guide | null {
  const g = v as Record<string, unknown>;
  if (!g || typeof g.id !== 'string' || !/^[a-z0-9]{10}$/.test(g.id) || !Array.isArray(g.sections)) return null;
  if (!g.sections.length || g.sections.length > SECTIONS_MAX) return null;
  const anonymous = g.anonymous === true;
  let imageCount = 0;
  const sections = (g.sections as Array<Record<string, unknown>>).map((x) => ({
    title: str(x?.title, SECTION_TITLE_MAX),
    body: str(x?.body, SECTION_BODY_MAX),
    images: (Array.isArray(x?.images) ? (x.images as Array<Record<string, unknown>>) : [])
      .slice(0, SECTION_IMAGES_MAX)
      .filter(() => ++imageCount <= GUIDE_IMAGES_TOTAL)
      .map((im) => {
        const url = imageUrl(im?.url, prefix);
        // 빈 칸은 운영자가 지운 사진과 같은 꼴 (가로 · 세로 0)
        return url ? { url, w: count(im?.w, 1600), h: count(im?.h, 1600) } : { url: '', w: 0, h: 0 };
      }),
  }));
  if (sections.reduce((n, x) => n + x.body.length, 0) > GUIDE_BODY_MAX) return null;
  const video = typeof g.video === 'string' && /^[A-Za-z0-9_-]{11}$/.test(g.video) ? g.video : null;
  return {
    id: g.id,
    hero: count(g.hero, 999),
    title: str(g.title, GUIDE_TITLE_MAX),
    excerpt: excerptOf(sections), // 받은 값을 쓰지 않고 자른 본문에서 다시 만든다 (서버 toGuide 와 같게)
    sectionTitles: sections.map((x) => x.title),
    votes: count(g.votes),
    hasVideo: video !== null,
    createdAt: count(g.createdAt),
    updatedAt: count(g.updatedAt),
    accountId: anonymous ? 0 : count(g.accountId),
    name: anonymous ? '' : str(g.name, 40),
    rank: rankOf(g.rank),
    games: gamesOf(g.games),
    anonymous,
    video,
    sections,
  };
}
/** 받은 팁을 알려진 칸만으로 — 영웅 ID 가 숫자인 것만, 영웅마다 SNAPSHOT_TIPS_MAX 개 · 팁 글자 수 한도까지 */
function cleanTips(v: Record<string, unknown>): Record<number, PublicTip[]> {
  const out: Record<number, PublicTip[]> = {};
  for (const [hero, list] of Object.entries(v)) {
    if (!/^\d{1,3}$/.test(hero) || !Array.isArray(list)) continue;
    out[Number(hero)] = (list as Array<Record<string, unknown>>)
      .filter((t) => t && typeof t.id === 'string' && typeof t.text === 'string')
      .slice(0, SNAPSHOT_TIPS_MAX)
      .map((t) => {
        const anonymous = t.anonymous === true;
        return { id: str(t.id, 64), text: str(t.text, TIP_MAX_LENGTH), accountId: anonymous ? 0 : count(t.accountId), name: anonymous ? '' : str(t.name, 40), rank: rankOf(t.rank), games: gamesOf(t.games), anonymous, at: count(t.at) };
      });
  }
  return out;
}
