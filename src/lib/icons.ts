/**
 * 게임 공식 아이콘 (deadlock-api 에셋, 게임 상점 툴팁의 계수 표시). 빌드 때 받아 사이트에서 직접 제공한다 (lib/images.ts).
 * deadlock.wiki 의 Boon_scaling / Spirit_scaling 과 같은 그림이다 (크기·색 비교로 확인).
 */

/** 부운 계수 — 하늘빛 민트 지그재그 화살표. 원본 79×55 중 그림은 왼쪽 46×55 (오른쪽은 투명 여백) */
export const BOON_ICON_URL = 'https://assets-bucket.deadlock-api.com/assets-api-res/icons/shop/keystat_boon_arrow.png';

/** 마력 계수 — 보라 오각별 + 지그재그 화살표. 76×53, 여백 없음 */
export const SPIRIT_ICON_URL = 'https://assets-bucket.deadlock-api.com/assets-api-res/icons/shop/keystat_spirit_arrow.png';

/** 무기 피해 계수 — 주황 과녁 + 지그재그 화살표 (위키 Weapon_scaling 과 같은 그림). 70×54, 그림은 x 6–70 */
export const WEAPON_ICON_URL = 'https://assets-bucket.deadlock-api.com/assets-api-res/icons/shop/keystat_courage_arrow.png';

/** 근접 피해 계수 — 주황 주먹 + 지그재그 화살표. 70×54, 그림은 x 6–69 */
export const MELEE_ICON_URL = 'https://assets-bucket.deadlock-api.com/assets-api-res/icons/shop/keystat_melee_arrow.png';

/** 소울(게임 화폐) — 게임 HUD·상점의 S 자 소울 아이콘 (흰색 SVG, 사이트에선 마스크로 색을 입힌다). 2026-10-06 가격 옆 다이아(◆) 대신 */
export const SOUL_ICON_URL = 'https://assets-bucket.deadlock-api.com/assets-api-res/icons/hud/icons/icon_soul.svg';
