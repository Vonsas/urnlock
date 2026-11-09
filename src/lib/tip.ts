/**
 * 수치 툴팁 (2026-11-03 사용자: 글자만 있던 툴팁을 표로 — '이름 | 값 | 순위', 승률은 초록·빨강) — 요소에 data-tip-rows(JSON)를 심으면
 * scripts/tooltip.ts 가 표로 그린다. 화면 낭독기용 글이 필요한 요소(링크 · 칸)는 title 에 tipText() 를 같이 둔다
 * (그래프 칸처럼 마우스 전용이면 data-tip-rows 만). 서버(astro)와 브라우저 스크립트가 같이 쓴다.
 */

/** 값 색 — 1 좋음(초록) · −1 나쁨(빨강) · 0 보통 */
export type TipTone = 1 | -1 | 0;
/** [이름, 값, 값 색, 오른쪽 작은 글씨(순위 등)] */
export type TipRow = [label: string, value: string, tone?: TipTone, sub?: string];
export interface TipSpec {
  /** 머리 (영웅 이름 · 날짜 …) */
  h: string;
  /** 머리 오른쪽 (▲1 · 패치 …) */
  hr?: [text: string, tone?: TipTone];
  /** 머리 앞 아이콘 (랭크 휘장) — 사이트 안 주소만 */
  icon?: string;
  rows: TipRow[];
  /** 아래 작은 글씨 */
  f?: string;
}

/** 승률 색 — 빌드 카드 · 승률표와 같은 기준 (51% 이상 초록, 49% 이하 빨강) */
export const winTone = (wr: number): TipTone => (wr >= 51 ? 1 : wr <= 49 ? -1 : 0);
/** 오르내림 색 (%p · 칸) */
export const signTone = (n: number): TipTone => (n > 0 ? 1 : n < 0 ? -1 : 0);

export const tipAttr = (spec: TipSpec) => JSON.stringify(spec);

/** 같은 내용의 글 — title(화면 낭독기 · 스크립트 없을 때)용 */
export const tipText = (spec: TipSpec) =>
  [
    spec.hr ? `${spec.h} ${spec.hr[0]}` : spec.h,
    ...spec.rows.map(([label, value, , sub]) => `${label} ${value}${sub ? ` (${sub})` : ''}`),
    spec.f,
  ]
    .filter(Boolean)
    .join('\n');
