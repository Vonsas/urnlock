/**
 * 빌드 페이지 — 모든 영웅의 추천 빌드(최상위권에서 많이 쓰이면 순위 표시)를 브라우저용 JSON(BuildsPageConfig)으로 모은다.
 * 영웅 상세 빌드 탭과 같은 getHeroBuilds 를 쓰므로 같은 빌드가 나온다 (요청은 data/index.ts 안에서 한 번만).
 * 카드를 누르면 뜨는 작은 창에 쓰도록 아이템 묶음 전체와 스킬 순서, 영웅 능력(이름·아이콘)까지 싣는다.
 */
import { getHero, getHeroBuilds, getHeroes, getItems, getRanks, type AuthorStanding, type BuildPerf, type GameBuild } from '../data';
import { LOCALE_META, localePath, useTranslations, type Locale } from '../i18n';
import { gameImage } from './images';
import { groupName, skillOrder } from './build-groups';
import type { BuildEntry, BuildsPageConfig } from '../scripts/builds';

export async function buildsPageConfig(lang: Locale): Promise<string> {
  const t = useTranslations(lang);
  const [heroes, items] = await Promise.all([getHeroes(lang), getItems(lang)]);
  const shop = new Map(items.filter((i) => i.id !== undefined).map((i) => [i.id!, i]));

  const heroMap: BuildsPageConfig['heroes'] = {};
  const itemMap: BuildsPageConfig['items'] = {};
  const builds: BuildEntry[] = [];
  let patchFrom: number | undefined;

  for (const h of heroes) {
    if (h.id === undefined) continue;
    const { pro, top, patchFrom: from } = await getHeroBuilds(h.slug);
    patchFrom ??= from;
    // 빌드가 아직 없는 영웅(막 나온 영웅)도 초상 줄에는 넣는다 — 흐리게 보이고, 빌드가 생기면 다음 빌드 때 바로 들어온다

    const abilities = [...((await getHero(h.slug, lang))?.detail?.abilities ?? [])].sort((a, b) => a.slot - b.slot);
    heroMap[h.id] = {
      name: h.name,
      slug: h.slug,
      icon: await gameImage(h.image?.small, 128, 128),
      abilities: await Promise.all(
        abilities.flatMap((a) => (a.id === undefined ? [] : [a])).map(async (a) => ({ id: a.id!, name: a.name, icon: await gameImage(a.image, 72, 72) })),
      ),
    };
    const abilityIds = new Set(heroMap[h.id].abilities.map((a) => a.id));

    const content = (b: GameBuild) => {
      const order = skillOrder(b.abilityOrder);
      return {
        groups: b.groups
          .map((g) => ({ name: groupName(g.name, t), items: g.items.map((it) => it.itemId).filter((id) => shop.has(id)) }))
          .filter((g) => g.items.length),
        // 능력 id 가 하나라도 이 영웅 것이 아니면 스킬 순서는 싣지 않는다
        order: order.length >= 4 && order.every((id) => abilityIds.has(id)) ? order : [],
      };
    };

    // 빌드 성적 · 작성자 랭킹 — 짧게 (승률은 브라우저가 판수 100 이상일 때만 보여 준다)
    const stats = (perf?: BuildPerf, author?: AuthorStanding) => ({
      ...(perf && { perf: [perf.matches, perf.wins, Math.round(perf.share * 10) / 10] as [number, number, number] }),
      ...(author && (author.rank || author.badge) && { stand: { ...(author.region && { r: author.region }), ...(author.rank && { n: author.rank }), ...(author.badge && { b: author.badge }) } }),
    });

    // 추천 빌드이면서 상위권 인기 1–3위이기도 하면 한 장으로 합친다 (같은 영웅 · 같은 빌드 ID)
    const byBuild = new Map<number, BuildEntry>();
    for (const p of pro) {
      if (!p.build || byBuild.has(p.buildId)) continue;
      const entry: BuildEntry = {
        hero: h.id,
        pro: p.pro,
        buildId: p.buildId,
        name: p.build.name,
        updatedAt: p.build.updatedAt,
        ...(p.usage && { rank: p.usage.rank, players: p.usage.players, matches: p.usage.matches }),
        ...stats(p.perf, p.author),
        ...content(p.build),
      };
      byBuild.set(p.buildId, entry);
      builds.push(entry);
    }
    for (const b of top) {
      const topInfo = { topN: b.rank, players: b.players, matches: b.matches, author: b.authorName, ...(b.allRanks && { allRanks: true }), ...stats(b.perf, b.author) };
      const same = byBuild.get(b.build.buildId);
      if (same) Object.assign(same, topInfo);
      else builds.push({ hero: h.id, ...topInfo, buildId: b.build.buildId, name: b.build.name, updatedAt: b.build.updatedAt, ...content(b.build) });
    }
  }

  // 아이템 · 능력 id 는 10자리 숫자라 빌드 수천 칸에 그대로 실으면 JSON 이 무겁다 → 페이지 안에서만 쓰는 짧은 번호로 바꿔 싣는다
  // (2026-10-14 최적화, 빌드 JSON 약 290KB 의 절반 이상이 id 글자였다). 브라우저는 번호로 cfg.items · hero.abilities 를 찾으므로 그대로 동작한다
  const itemNo = new Map<number, number>();
  for (const id of new Set(builds.flatMap((b) => b.groups.flatMap((g) => g.items)))) {
    const item = shop.get(id)!;
    itemNo.set(id, itemNo.size);
    itemMap[itemNo.get(id)!] = { name: item.name, cat: item.category, tier: item.tier, icon: await gameImage(item.image, 112, 112) };
  }
  const abilityNo = new Map<number, Map<number, number>>();
  for (const [heroId, hero] of Object.entries(heroMap)) {
    const m = new Map(hero.abilities.map((a, i) => [a.id, i]));
    abilityNo.set(Number(heroId), m);
    hero.abilities = hero.abilities.map((a, i) => ({ ...a, id: i }));
  }
  for (const b of builds) {
    b.groups = b.groups.map((g) => ({ ...g, items: g.items.map((id) => itemNo.get(id)!) }));
    b.order = b.order.map((id) => abilityNo.get(b.hero)!.get(id)!);
  }

  const ranks = Object.fromEntries(
    await Promise.all((await getRanks(lang)).map(async (r) => [r.tier, { name: r.name, icon: await gameImage(r.image, 40, 40) }] as const)),
  );
  const config: BuildsPageConfig = {
    locale: LOCALE_META[lang].htmlLang,
    ranks,
    heroPath: localePath(lang, 'heroes'),
    heroes: heroMap,
    items: itemMap,
    patchFrom,
    builds: builds.sort((a, b) => b.updatedAt - a.updatedAt),
    t: {
      ...t.buildsPage,
      unlock: t.heroes.unlock,
      upgrade: t.heroes.upgrade,
      skillOrder: t.heroes.skillOrderTitle,
      winRate: t.heroes.buildWinRate,
      games: t.heroes.buildGames,
      share: t.heroes.buildShare,
      rankPos: t.heroes.buildRankPos,
      author: t.heroes.buildAuthor,
      gamesN: t.heroes.buildGamesN,
      regions: { Asia: t.players.regionAsia, Europe: t.players.regionEurope, NAmerica: t.players.regionNAmerica, SAmerica: t.players.regionSAmerica, Oceania: t.players.regionOceania },
    },
  };
  // </script> 로 JSON 이 끊기지 않게
  return JSON.stringify(config).replace(/</g, '\\u003c');
}
