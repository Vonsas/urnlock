/**
 * 프로 빌드 — 직접 고른 게임 내 빌드를 여기에 적는다. 빌드 이름·아이템 묶음·수정일은 빌드할 때 deadlock-api 에서 받는다.
 *
 *   hero    영웅 slug (영웅 상세 주소의 마지막 부분: /ko/heroes/lady-geist → 'lady-geist')
 *   buildId 게임 빌드 ID (게임 빌드 화면이나 statlocker 등에서 확인). 같은 ID 에 여러 영웅 버전이 있을 수 있어 hero 와 함께 찾는다
 *   pro     프로 이름 (화면에 그대로 나온다)
 *   note    한 줄 설명 (선택)
 *   source  출처 주소 — 방송·영상·트위터 등 (선택)
 *
 * 예) { hero: 'haze', buildId: 334667, pro: '이름', note: '초반 라인전 위주', source: 'https://…' },
 */
export interface ProBuildEntry {
  hero: string;
  buildId: number;
  pro: string;
  note?: string;
  source?: string;
}

export const PRO_BUILDS: ProBuildEntry[] = [];
