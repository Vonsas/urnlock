/** 검색용 문자열 정규화 — 대소문자, 공백, 구두점 차이를 무시 */
export const norm = (s: string) => s.toLowerCase().replace(/[\s·&'.-]/g, '');
