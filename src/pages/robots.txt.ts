/** 검색 엔진 안내 — 모두 허용, 링크 미리보기 카드 페이지만 제외, 사이트맵 위치 (2026-10-05) */
import type { APIRoute } from 'astro';

export const GET: APIRoute = ({ site }) => {
  const lines = ['User-agent: *', 'Allow: /', 'Disallow: /og/', 'Disallow: /admin/', 'Disallow: /api/'];
  if (site) lines.push('', `Sitemap: ${new URL('/sitemap.xml', site).href}`);
  return new Response(lines.join('\n') + '\n', { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
