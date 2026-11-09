/**
 * 사이트 상태 점검 결과 — /health.json (2026-10-05). 빌드 때 만든다.
 *
 *  - tiers: 티어 데이터 자동 검사 (src/data/api/tier-check.ts). 문제가 있으면 **Vercel 빌드를 멈춘다** → 직전 배포가 그대로 남는다.
 *  - source: 데이터 출처 — 'mock'(API 가 통째로 실패해 샘플 데이터)이어도 Vercel 빌드를 멈춘다.
 *  - untranslated: 패치노트에서 번역 안 된 줄 수 (새 패치가 나오면 생긴다)
 *  - heroes: 데이터가 덜 들어온 영웅 (막 출시된 영웅 — 능력 이름이 영어 그대로, 소개 없음 …) + 이번에 처음 보이는 영웅
 *
 * 매일 GitHub Actions(daily-rebuild.yml → tools/check-health.mjs)가 배포된 이 파일을 읽어, 문제·번역 필요·새 영웅이 있으면
 * 저장소에 이슈를 열어 알린다 (해결되면 닫는다). 데이터 시각이 36시간 넘게 그대로면(빌드가 계속 멈춤) 그것도 이슈로.
 */
import type { APIRoute } from 'astro';
import type { Hero } from '../data';
import { LIGHT_BUILD, getDataSource, getHero, getHeroes, getPatchNotes, getTierData } from '../data';
import { loadGuidesSnapshot } from '../data/guides-snapshot';
import { checkTierData } from '../data/api/tier-check';
import { untranslatedCounts } from '../data/api/patch-i18n';
import { LOCALES } from '../i18n';

/**
 * 실제 배포 빌드인지 — Vercel 이거나, Cloudflare Pages 예비 배포를 만드는 Actions 빌드(HEALTH_STRICT=1, pages-standby.yml).
 * 이때만 직전 배포와 비교하고, 문제가 있으면 빌드를 멈춘다.
 */
const STRICT = Boolean(process.env.VERCEL) || process.env.HEALTH_STRICT === '1';
/**
 * www 가 Cloudflare Pages 로 넘어간 뒤(⑥, Vercel 환경 변수 PAGES_PRIMARY=1)엔 Vercel 빌드를 멈추지 않는다 — 점검 문제로 `/api` 배포까지 막히지 않게.
 * 대신 tools/build-pages-config.mjs 가 problems 를 보고 Pages 올리기만 하지 않는다 (www = 직전 Pages 배포). docs/plan-cloudflare-split.md 2절
 */
const STOP_BUILD = STRICT && !(process.env.VERCEL && process.env.PAGES_PRIMARY === '1');

interface Health {
  builtAt: number;
  dataAt?: number;
  source: 'api' | 'mock';
  problems: string[];
  notes: string[];
  tiers?: Awaited<ReturnType<typeof checkTierData>>['summary'];
  untranslated: Partial<Record<string, number>>;
  /** 사이트가 '현재 패치' 로 보는 글 — 새로 잡히면 점검이 알린다 (영웅 출시 공지를 패치로 잡은 일이 있어서, 2026-10-07) */
  currentPatch?: { date: string; title: string; url?: string };
  heroes: { ids: number[]; issues: Array<{ id?: number; name: string; issues: string[] }> };
}

/** 직전 배포의 점검 결과 — 판수 급감·새 영웅 비교용 (실제 배포 빌드에서만, 없으면 건너뜀. Pages 빌드도 site = www 라 Vercel 쪽 직전 배포와 비교) */
async function previousHealth(site: URL | undefined): Promise<Partial<Health> | undefined> {
  if (!site || !STRICT) return undefined;
  try {
    const res = await fetch(new URL('/health.json', site), { signal: AbortSignal.timeout(10_000) });
    return res.ok ? ((await res.json()) as Partial<Health>) : undefined;
  } catch {
    return undefined;
  }
}

export const GET: APIRoute = async ({ site }) => {
  const [source, tierData, heroesEn, prev] = await Promise.all([getDataSource(), getTierData(), getHeroes('en'), previousHealth(site)]);
  const [patchesEn] = await Promise.all(LOCALES.map((l) => getPatchNotes(l))); // 번역 수를 세려면 패치노트 변환이 끝나 있어야 한다

  const ids = heroesEn.map((h) => h.id).filter((id): id is number => id !== undefined);
  const check = await checkTierData(tierData, ids, prev?.tiers);
  const problems = [...check.problems];
  if (source === 'mock') problems.unshift('deadlock-api 를 받지 못해 샘플 데이터로 빌드됨');

  // 데이터가 덜 들어온 영웅 — 출시 직후엔 능력 이름이 영어 그대로이거나 소개가 비어 있다 (랫 킹 때 겪음)
  const issues: Health['heroes']['issues'] = [];
  for (const en of heroesEn) {
    const [ko, zh] = await Promise.all([getHero(en.slug, 'ko'), getHero(en.slug, 'zh')]);
    const list: string[] = [];
    if (!en.image?.card) list.push('이미지 없음');
    if (!ko?.detail) list.push('상세 데이터(능력·스탯) 없음');
    else {
      const enHero = await getHero(en.slug, 'en');
      const same = (h: Hero | undefined) => h?.detail?.abilities.filter((a, i) => a.name === enHero?.detail?.abilities[i]?.name).length ?? 0;
      if (same(ko) >= 2) list.push(`능력 이름 ${same(ko)}개가 한국어 번역 없음`);
      if (same(zh) >= 2) list.push(`능력 이름 ${same(zh)}개가 중국어 번역 없음`);
      // 소개(playstyle)는 API 에 원래 비어 있는 영웅이 12명이라 (아폴로·빌리 …) 알림 조건에서 뺀다 — 화면은 소개 줄 없이 나온다
    }
    if (list.length) issues.push({ id: en.id, name: ko?.name ?? en.name, issues: list });
  }
  const notes = [...check.notes];
  const newHeroes = prev?.heroes?.ids ? heroesEn.filter((h) => h.id !== undefined && !prev.heroes!.ids.includes(h.id)) : [];
  if (newHeroes.length) notes.push(`새 영웅: ${newHeroes.map((h) => h.name).join(', ')}`);
  // 가이드 · 팁 스냅샷(#21) — 못 만들어도 배포는 막지 않는다 (저장소가 멈췄을 때 화면이 쓰는 예비 자료일 뿐)
  const snapshot = await loadGuidesSnapshot();
  if (snapshot.reused) notes.push(`가이드 · 팁 스냅샷: 저장소를 못 읽어 직전 배포의 사본을 이어 씀 (${snapshot.error}, 사본 ${new Date(snapshot.builtAt * 1000).toISOString().slice(0, 16).replace('T', ' ')} UTC)`);
  else if (!snapshot.ok) notes.push(`가이드 · 팁 스냅샷을 못 만듦 (빈 스냅샷): ${snapshot.error}`);

  const health: Health = {
    builtAt: Math.floor(Date.now() / 1000),
    dataAt: tierData?.generatedAt,
    source,
    problems,
    notes,
    tiers: check.summary,
    untranslated: { ...untranslatedCounts },
    currentPatch: patchesEn[0] && { date: patchesEn[0].date, title: patchesEn[0].title.trim(), url: patchesEn[0].url },
    heroes: { ids, issues },
  };

  // 배포 빌드에서 문제가 있으면 멈춘다 — 틀린 티어를 올리느니 어제 것을 그대로 둔다. 로컬에선 경고만 (tier-check 가 남김)
  // 미리보기(가벼운 빌드)는 티어 데이터를 일부러 안 받으므로 멈추지 않는다 — 실제 배포만
  if (problems.length && STOP_BUILD && !LIGHT_BUILD) {
    throw new Error(`[dldb:health] 점검 실패로 배포를 멈춤 (직전 배포 유지):\n- ${problems.join('\n- ')}`);
  }
  return new Response(JSON.stringify(health, null, 1), { headers: { 'Content-Type': 'application/json' } });
};
