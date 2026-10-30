/**
 * API 데이터 한 벌 — 세 언어의 영웅·아이템과 최근 패치를 한 번만 받아 변환해 둔다.
 * 영웅·아이템 중 하나라도 받지 못하면 null (호출하는 쪽이 목업으로 폴백).
 */
import { LOCALES, type Locale } from '../../i18n/locales';
import type { Hero, Item, PatchNote, PatchSummary, Rank } from '../types';
import { inspectImages, loadHeroes, loadItems, loadNpcNames, loadPatches, loadRanks, warn } from './fetch';
import { buildGlossary, translateNotes, translateSummary, translator } from './patch-i18n';
import { toHeroes, toItems, toPatch, toPatchNotes } from './transform';

export interface ApiData {
  heroes: Record<Locale, Hero[]>;
  items: Record<Locale, Item[]>;
  /** 랭크 이름·휘장 (전적 페이지). 받지 못하면 빈 배열 */
  ranks: Record<Locale, Rank[]>;
  /** 패치노트를 받지 못하면 null — 패치 요약만 목업으로 둔다 */
  patch: Record<Locale, PatchSummary> | null;
  /** 공식 패치노트 전체 (최신순). 받지 못하면 빈 배열 */
  patchNotes: Record<Locale, PatchNote[]>;
}

export interface LoadOptions {
  /** false 면 게임 이미지 URL 을 모두 지워 머리글자 자리로 보인다 */
  images: boolean;
}

async function build(options: LoadOptions): Promise<ApiData | null> {
  const [rawHeroes, rawItems, rawPatches, rawRanks, rawNpcs] = await Promise.all([
    Promise.all(LOCALES.map(loadHeroes)),
    Promise.all(LOCALES.map(loadItems)),
    loadPatches(),
    Promise.all(LOCALES.map(loadRanks)),
    Promise.all(LOCALES.map(loadNpcNames)),
  ]);
  if (rawHeroes.some((h) => !h) || rawItems.some((i) => !i)) {
    warn('영웅·아이템 데이터를 받지 못해 목업 데이터로 빌드합니다');
    return null;
  }

  const en = LOCALES.indexOf('en');
  const heroes = {} as ApiData['heroes'];
  const items = {} as ApiData['items'];
  const ranks = {} as ApiData['ranks'];
  LOCALES.forEach((lang, i) => {
    heroes[lang] = toHeroes(rawHeroes[i]!, rawItems[i]!, rawHeroes[en]!, lang);
    items[lang] = toItems(rawItems[i]!, rawItems[en]!);
    ranks[lang] = (rawRanks[i] ?? [])
      .map((r) => ({ tier: r.tier, name: r.name, image: r.images?.large_webp || r.images?.large || undefined }))
      .sort((a, b) => a.tier - b.tier);
  });
  await filterImages(heroes, items, ranks, options);

  // 패치노트는 영어뿐 — 줄 단위 번역 사전(src/data/patch-i18n)을 공식 이름 용어집으로 검사해 쓴다
  const npcs = Object.fromEntries(LOCALES.map((l, i) => [l, rawNpcs[i] ?? []]));
  const glossary = buildGlossary({ heroes, items, npcs }, LOCALES);
  let patch: ApiData['patch'] = null;
  const patchNotes = {} as ApiData['patchNotes'];
  for (const lang of LOCALES) {
    const tr = translator(lang, glossary);
    const summary = rawPatches && toPatch(rawPatches, heroes[lang], heroes.en, items[lang], items.en);
    if (summary) (patch ??= {} as NonNullable<ApiData['patch']>)[lang] = translateSummary(summary, tr);
    patchNotes[lang] = rawPatches ? translateNotes(toPatchNotes(rawPatches, heroes[lang], heroes.en, items[lang], items.en), tr) : [];
    await tr.flush();
  }
  if (patch && LOCALES.some((l) => !patch![l])) patch = null;
  if (!patch) warn('패치노트를 받지 못해 패치 요약은 목업으로 표시합니다');

  return { heroes, items, ranks, patch, patchNotes };
}

/**
 * 이미지 주소 정리. 빌드에서는 주소를 모두 확인해 받을 수 없는 이미지만 지운다
 * (개발 서버는 확인하지 않는다 — 깨져도 그 이미지만 안 보일 뿐).
 */
async function filterImages(heroes: ApiData['heroes'], items: ApiData['items'], ranks: ApiData['ranks'], options: LoadOptions) {
  const allHeroes = Object.values(heroes).flat();
  const allItems = Object.values(items).flat();
  const allRanks = Object.values(ranks).flat();
  const abilities = allHeroes.flatMap((h) => h.detail?.abilities ?? []);

  let keep = (url: string | undefined) => (options.images ? url : undefined);
  if (options.images && !import.meta.env.DEV) {
    const urls = [
      ...allHeroes.flatMap((h) => [h.image?.card, h.image?.small, h.image?.name]),
      ...allItems.map((i) => i.image),
      ...abilities.map((a) => a.image),
      ...allRanks.map((r) => r.image),
    ].filter((u): u is string => Boolean(u));
    const { broken, versions } = await inspectImages(urls);
    if (broken.size) warn(`이미지 ${broken.size}개를 받을 수 없어 머리글자로 표시: ${[...broken].slice(0, 3).join(', ')}…`);
    // 파일 버전을 주소에 붙여 그림이 바뀌면 Astro 이미지 캐시도 새로 받게 한다 (inspectImages 주석 참고)
    keep = (url) => {
      if (!url || broken.has(url)) return undefined;
      const v = versions.get(url);
      return v ? `${url}${url.includes('?') ? '&' : '?'}v=${v}` : url;
    };
  }

  for (const h of allHeroes) {
    if (h.image) h.image = { card: keep(h.image.card), small: keep(h.image.small), name: keep(h.image.name) };
  }
  for (const i of allItems) i.image = keep(i.image);
  for (const a of abilities) a.image = keep(a.image);
  for (const r of allRanks) r.image = keep(r.image);
}

let pending: Promise<ApiData | null> | undefined;

/** 빌드 한 번에 한 번만 요청한다 (페이지마다 호출해도 같은 결과) */
export function loadApiData(options: LoadOptions): Promise<ApiData | null> {
  pending ??= build(options);
  return pending;
}
