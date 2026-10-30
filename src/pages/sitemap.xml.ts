/**
 * 사이트맵 — 검색 엔진(구글·네이버)이 페이지를 찾게 (2026-10-05). robots.txt 가 이 주소를 알려 준다.
 * 세 언어의 같은 페이지는 xhtml:link 로 서로 묶는다 (각 페이지 <head> 의 hreflang 과 같은 내용).
 * 넣지 않는 것: 준비 중 페이지(가이드) · 링크 미리보기 카드(/og/) · `/`(저장된 언어로 넘기는 페이지) · 검색 결과처럼 주소 뒤 ?가 붙는 화면.
 */
import type { APIRoute } from 'astro';
import { getHeroSlugs, getPatchNotes } from '../data';
import { LOCALES, LOCALE_META, localePath } from '../i18n';
import { SECTIONS } from '../lib/sections';

export const GET: APIRoute = async ({ site }) => {
  if (!site) return new Response('', { status: 404 });
  const [slugs, notes] = await Promise.all([getHeroSlugs(), getPatchNotes('en')]);
  const paths = [
    '',
    ...SECTIONS.filter((s) => s.ready).map((s) => s.key),
    ...slugs.map((slug) => `heroes/${slug}`),
    ...notes.map((n) => `patches/${n.id}`),
  ];
  const url = (lang: (typeof LOCALES)[number], path: string) => new URL(localePath(lang, path), site).href;
  const entries = paths.flatMap((path) =>
    LOCALES.map(
      (lang) =>
        `<url><loc>${url(lang, path)}</loc>${LOCALES.map((alt) => `<xhtml:link rel="alternate" hreflang="${LOCALE_META[alt].htmlLang}" href="${url(alt, path)}"/>`).join('')}</url>`,
    ),
  );
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${entries.join('\n')}\n</urlset>\n`;
  return new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
};
