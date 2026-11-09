/**
 * 검색엔진용 사이트 정보 (schema.org WebSite, JSON-LD) — 구글 검색 결과에 뜨는 사이트 이름을 'Urnlock' 으로 (2026-10-31).
 * 'urnlock' 을 치면 구글이 'urn' 으로 알아들어서, 이름 · 한글 읽기('언락')를 알려 준다. 첫 화면(`/` · `/ko/` …)에만 싣는다.
 * 2026-11-03: 운영 주체(Organization)도 함께 — 로고(apple-touch-icon 180px, 구글 최소 112px)와 공식 계정 주소(SAME_AS)로 이름을 묶는다.
 */

/** 'Urnlock' 이름으로 만든 공식 계정 주소 (스팀 그룹 · 유튜브 · X …). 만들면 여기에 https 주소를 넣는다 */
const SAME_AS: string[] = [];

export function siteSchema(site: URL): string {
  const home = new URL('/', site).href;
  const org = {
    '@type': 'Organization',
    '@id': `${home}#organization`,
    name: 'Urnlock',
    alternateName: '언락',
    url: home,
    logo: new URL('/apple-touch-icon.png', site).href,
    ...(SAME_AS.length > 0 && { sameAs: SAME_AS }),
  };
  const data = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebSite',
        '@id': `${home}#website`,
        name: 'Urnlock',
        alternateName: ['언락', 'Urnlock Deadlock'],
        url: home,
        publisher: { '@id': org['@id'] },
      },
      org,
    ],
  };
  // 페이지에 심는 JSON 은 '<' 를 이스케이프 (보안 규칙 — 지금은 고정 값뿐이지만 같은 방식으로)
  return JSON.stringify(data).replace(/</g, '\\u003c');
}
