/**
 * 가이드 페이지(목록 · 보기 · 쓰기)에 심는 설정 JSON — 영웅·랭크 이름과 그림, 문구, 주소.
 * 글 자체는 브라우저가 /api/guides 에서 받아 그린다 (scripts/guides.ts).
 */
import { getHeroes, getRanks } from '../data';
import { LOCALE_META, localePath, useTranslations, type Locale } from '../i18n';
import { gameImage } from './images';
import {
  GUIDE_BODY_MAX,
  GUIDE_IMAGES,
  GUIDE_IMAGES_TOTAL,
  GUIDE_BODY_MIN,
  GUIDE_TITLE_MAX,
  GUIDE_TITLE_MIN,
  SECTION_BODY_MAX,
  SECTION_IMAGES_MAX,
  SECTION_TITLE_MAX,
  SECTIONS_MAX,
} from './guide-format';
import type { GuidesConfig } from '../scripts/guides';

export async function guidesPageConfig(lang: Locale, mode: GuidesConfig['mode']): Promise<string> {
  const [heroes, ranks] = await Promise.all([getHeroes(lang), getRanks(lang)]);
  const t = useTranslations(lang);
  const config: GuidesConfig = {
    mode,
    locale: LOCALE_META[lang].htmlLang,
    heroes: Object.fromEntries(
      await Promise.all(
        heroes
          .filter((h) => h.id !== undefined)
          .map(async (h) => [h.id!, { name: h.name, slug: h.slug, icon: await gameImage(h.image?.small, 128, 128) }] as const),
      ),
    ),
    ranks: Object.fromEntries(await Promise.all(ranks.map(async (r) => [r.tier, { name: r.name, icon: await gameImage(r.image, 48, 48) }] as const))),
    paths: {
      list: localePath(lang, 'guides'),
      game: localePath(lang, 'guides/game'),
      view: localePath(lang, 'guides/view'),
      write: localePath(lang, 'guides/write'),
      heroes: localePath(lang, 'heroes'),
      players: localePath(lang, 'players'),
    },
    limits: {
      titleMin: GUIDE_TITLE_MIN,
      titleMax: GUIDE_TITLE_MAX,
      bodyMin: GUIDE_BODY_MIN,
      bodyMax: GUIDE_BODY_MAX,
      sectionTitleMax: SECTION_TITLE_MAX,
      sectionBodyMax: SECTION_BODY_MAX,
      sectionsMax: SECTIONS_MAX,
      imagesMax: SECTION_IMAGES_MAX,
      imagesTotal: GUIDE_IMAGES_TOTAL,
    },
    images: GUIDE_IMAGES,
    t: t.guides,
  };
  return JSON.stringify(config).replace(/</g, '\\u003c');
}
