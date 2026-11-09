// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

import { LOCALES, DEFAULT_LOCALE } from './src/i18n/locales.ts';

// https://astro.build/config
export default defineConfig({
  // 예전 주소 — 승률표가 티어 페이지 탭이던 때 (2026-10-03 상단 메뉴 '통계' 로 이동)
  redirects: {
    '/[lang]/tiers/stats': '/[lang]/stats',
    // 아이템 통계 페이지(2026-11-04 하루)는 아이템 상세 창 '통계' 탭으로 옮겼다
    '/[lang]/items/stats': '/[lang]/items',
  },
  // 사이트 주소 (hreflang / canonical). SITE_URL 이 있으면 그것(도메인을 연결하면 Vercel 환경 변수로),
  // 없으면 Vercel 이 빌드 때 주는 정식 주소(VERCEL_PROJECT_PRODUCTION_URL), 로컬에선 비워 둔다
  // 2026-10-04 주소를 urnlock.vercel.app 으로 (dldb.vercel.app 은 Vercel 에서 새 주소로 넘김). VERCEL_PROJECT_PRODUCTION_URL 은
  // 더 짧은 dldb.vercel.app 을 돌려줘서 Vercel 빌드에선 새 주소를 직접 쓴다
  // 2026-10-06 도메인 urnlock.com 구매(가비아, 만기 2027-10-06) → 정식 주소 www.urnlock.com (Vercel 권장대로 urnlock.com 은 www 로 308).
  site: process.env.SITE_URL ?? (process.env.VERCEL ? 'https://www.urnlock.com' : undefined),

  // 빌드 파일(/_astro)은 페이지와 같은 주소에서 받는다. 2026-10-29 – 11-01 엔 Vercel 한도 절약으로 프로덕션 빌드만
  // static.urnlock.com(Cloudflare 캐시를 거친 Vercel)에서 받았다 — www 가 Cloudflare Pages 로 넘어가며(#55) 껐다.

  i18n: {
    locales: [...LOCALES],
    defaultLocale: DEFAULT_LOCALE,
    routing: {
      prefixDefaultLocale: true,
      // `/` 는 src/pages/index.astro 에서 저장된 언어로 직접 보낸다
      redirectToDefaultLocale: false,
    },
  },

  // 폰트는 빌드 시 다운로드해 사이트에서 직접 제공한다 (중국 본토에서 Google CDN 차단 대비).
  // Pretendard 는 npm 패키지의 dynamic-subset CSS 를 레이아웃에서 import 한다.
  // 중국어 본문은 시스템 폰트(PingFang SC / Microsoft YaHei / Noto Sans CJK)가 충분히 좋아서
  // 웹폰트로 받지 않고 global.css 의 폴백 스택에만 Noto Sans SC 를 둔다.
  // 웹폰트는 받지 않는다 — 본문은 Pretendard(npm 패키지), 로고는 SVG 도형(src/lib/wordmark.ts). 2026-10-03 까지는 Bodoni · Noto Serif · Abril Fatface 를 받았다.

  // 게임 이미지는 빌드 때 받아 WebP 로 줄여 사이트에 함께 올린다 (src/lib/images.ts)
  image: {
    domains: ['assets-bucket.deadlock-api.com'],
    // 패치 공지 머리 그림 (Steam 공지 이미지 서버 — clan.fastly / clan.akamai … 여러 이름을 쓴다)
    remotePatterns: [{ protocol: 'https', hostname: '**.steamstatic.com' }],
  },

  vite: {
    plugins: [tailwindcss()],
  },
});
