import type { Dictionary } from '../i18n';

/** 사이트의 장(章) 구성 — 헤더 메뉴, 첫 페이지 목차, 준비 중 페이지가 함께 쓴다 */
export type SectionKey = 'tiers' | 'stats' | 'heroes' | 'items' | 'players' | 'builds' | 'guides' | 'patches';

export interface Section {
  key: SectionKey;
  no: number;
  /** false 면 '준비 중' 페이지로 연결 */
  ready: boolean;
}

export const SECTIONS: Section[] = [
  { key: 'tiers', no: 1, ready: true },
  // 통계 = 예전 티어 페이지의 '승률표' 탭을 메뉴로 뺀 것 (2026-10-03 사용자 요청)
  { key: 'stats', no: 2, ready: true },
  { key: 'heroes', no: 3, ready: true },
  { key: 'items', no: 4, ready: true },
  { key: 'players', no: 5, ready: true },
  { key: 'builds', no: 6, ready: true },
  { key: 'guides', no: 7, ready: true },
  { key: 'patches', no: 8, ready: true },
];

export const PENDING_SECTIONS = SECTIONS.filter((s) => !s.ready);
/** 헤더·푸터 메뉴 — 준비 중인 장(가이드)은 숨긴다 (2026-10-05: 빈 메뉴가 미완성처럼 보여서). 주소로 들어가면 '준비 중' 페이지는 그대로 */
export const MENU_SECTIONS = SECTIONS.filter((s) => s.ready);

export const sectionNo = (no: number) => String(no).padStart(2, '0');

export const sectionTitle = (t: Dictionary, key: SectionKey) => t.nav[key];
