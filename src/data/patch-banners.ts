/**
 * 첫 페이지에 크게 띄울 패치 그림 — 공식 패치 공지의 머리 그림 중 **직접 보고 허락한 것만** (주소 그대로).
 *
 * 마이너 패치 그림은 모두 'DEADLOCK MINOR UPDATE' 배너라 데드락 로고가 크게 들어 있다 → 로고는 넣지 않는다는 규칙(CLAUDE.md 법적 주의)
 * 때문에 쓰지 않는다. 메이저 패치 그림은 패치마다 달라서, 로고가 없는지 확인하고 여기에 주소를 추가한다.
 * 목록에 없는 패치는 그림 없이 제목만 나온다. GAME_IMAGES = false 면 이 그림도 꺼진다.
 */
export const PATCH_BANNERS: string[] = [
  // City Never Sleeps (2026-09-29) — 패치 제목 글씨 + 새 영웅 6명, 데드락 로고 없음 (2026-10-02 확인)
  'https://clan.fastly.steamstatic.com/images/45164767/4cb96ab54e327aefdcfeef87a67414bdf8f03c6f.png',
];
