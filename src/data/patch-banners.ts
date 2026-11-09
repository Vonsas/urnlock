/**
 * 첫 페이지에 크게 띄울 패치 그림 — 공식 패치 공지의 머리 그림 중 **직접 보고 허락한 것만** (주소 그대로).
 *
 * 마이너 패치 그림은 모두 'DEADLOCK MINOR UPDATE' 배너라 데드락 로고가 크게 들어 있다 → 로고는 넣지 않는다는 규칙(CLAUDE.md 법적 주의)
 * 때문에 쓰지 않는다. 메이저 패치 그림은 패치마다 달라서, 로고가 없는지 확인하고 여기에 주소를 추가한다.
 * 목록에 없는 패치는 그림 없이 제목만 나온다. GAME_IMAGES = false 면 이 그림도 꺼진다.
 * 비교는 /images/ 뒤 경로로 한다 — 같은 그림을 clan.fastly · clan.akamai 등 여러 호스트로 주며, API 가 호스트를 바꾸면
 * (2026-11-03 fastly → akamai) 주소 전체 비교로는 그림이 사라졌다.
 */
export const PATCH_BANNERS: string[] = [
  // City Never Sleeps (2026-09-29) — 패치 제목 글씨 + 새 영웅 6명, 데드락 로고 없음 (2026-10-02 확인)
  'https://clan.fastly.steamstatic.com/images/45164767/4cb96ab54e327aefdcfeef87a67414bdf8f03c6f.png',
];

const imagePath = (url: string) => url.match(/^https:\/\/clan\.[a-z]+\.steamstatic\.com(\/images\/.+)$/)?.[1];
const ALLOWED = new Set(PATCH_BANNERS.map(imagePath));

/** 허락한 패치 그림인가 (호스트는 보지 않음) */
export function isPatchBanner(url: string): boolean {
  const path = imagePath(url);
  return path !== undefined && ALLOWED.has(path);
}
