/**
 * 직전 배포의 가이드 · 팁 스냅샷 이어 쓰기 (#21) — guides-snapshot.ts 가 빌드 때 저장소를 못 읽으면 부른다.
 * Astro 에 기대지 않는 따로 떼어 둔 모듈이라 검사(scratchpad apitest21/reuse.mts)에서 바로 부를 수 있다.
 */
import type { Guide } from '../lib/guide-format';
import type { PublicTip } from '../lib/tips';

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
    .filter((x) => /^https?:\/\/[^/\s]+/.test(x));
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
      if (full?.ok !== true || !Array.isArray(full.guides) || typeof full.builtAt !== 'number') return null;
      const hasTips = summary?.ok === true && !!summary.tips && typeof summary.tips === 'object' && !Array.isArray(summary.tips);
      return { builtAt: full.builtAt, guides: full.guides, tips: hasTips ? summary!.tips! : null };
    }),
  );
  // 요약(팁)까지 있는 곳을 먼저, 그다음 최근 순 — 요약만 못 받은 곳을 쓰면 모든 영웅 탭이 '팁 없음' 으로 보인다
  const best = found
    .filter((x): x is NonNullable<typeof x> => !!x)
    .sort((a, b) => Number(!!b.tips) - Number(!!a.tips) || b.builtAt - a.builtAt)[0];
  if (!best) return null;
  return { builtAt: best.builtAt, ok: true, guides: best.guides.map(cleanGuide).filter((g): g is Guide => !!g), tips: cleanTips(best.tips ?? {}) };
}

const str = (v: unknown, max = 10_000) => (typeof v === 'string' ? v.slice(0, max) : '');
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const rankOf = (v: unknown) => {
  const r = v as { tier?: unknown; sub?: unknown } | null;
  return r && typeof r.tier === 'number' && typeof r.sub === 'number' ? { tier: r.tier, sub: r.sub } : null;
};
/** 받은 가이드 하나를 알려진 칸만으로 다시 만든다 — 모양이 틀리면 버림 */
function cleanGuide(v: unknown): Guide | null {
  const g = v as Record<string, unknown>;
  if (!g || typeof g.id !== 'string' || !/^[a-z0-9]{10}$/.test(g.id) || !Array.isArray(g.sections)) return null;
  const anonymous = g.anonymous === true;
  const sections = (g.sections as Array<Record<string, unknown>>).map((x) => ({
    title: str(x?.title, 100),
    body: str(x?.body),
    images: Array.isArray(x?.images)
      ? (x.images as Array<Record<string, unknown>>).map((im) => ({ url: /^https:\/\//.test(str(im?.url, 300)) ? str(im?.url, 300) : '', w: num(im?.w), h: num(im?.h) }))
      : [],
  }));
  return {
    id: g.id,
    hero: num(g.hero),
    title: str(g.title, 200),
    excerpt: str(g.excerpt, 500),
    sectionTitles: sections.map((x) => x.title),
    votes: num(g.votes),
    hasVideo: !!g.video,
    createdAt: num(g.createdAt),
    updatedAt: num(g.updatedAt),
    accountId: anonymous ? 0 : num(g.accountId),
    name: anonymous ? '' : str(g.name, 40),
    rank: rankOf(g.rank),
    games: typeof g.games === 'number' ? g.games : null,
    anonymous,
    video: typeof g.video === 'string' && /^[A-Za-z0-9_-]{11}$/.test(g.video) ? g.video : null,
    sections,
  };
}
/** 받은 팁을 알려진 칸만으로 — 영웅 ID 가 숫자인 것만 */
function cleanTips(v: Record<string, unknown>): Record<number, PublicTip[]> {
  const out: Record<number, PublicTip[]> = {};
  for (const [hero, list] of Object.entries(v)) {
    if (!/^\d+$/.test(hero) || !Array.isArray(list)) continue;
    out[Number(hero)] = (list as Array<Record<string, unknown>>)
      .filter((t) => t && typeof t.id === 'string' && typeof t.text === 'string')
      .map((t) => {
        const anonymous = t.anonymous === true;
        return { id: str(t.id, 64), text: str(t.text, 500), accountId: anonymous ? 0 : num(t.accountId), name: anonymous ? '' : str(t.name, 40), rank: rankOf(t.rank), games: typeof t.games === 'number' ? t.games : null, anonymous, at: num(t.at) };
      });
  }
  return out;
}
