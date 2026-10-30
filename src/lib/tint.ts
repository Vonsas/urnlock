/**
 * 이미지가 없는 동안 영웅마다 구분되는 색을 준다.
 * 채도 낮은 보석 톤을 패널 면과 섞어 쓰므로 튀지 않는다. slug 로 고정 배정.
 */
const TINTS = ['#8a5a3c', '#6b7a45', '#3f7a74', '#8a4450', '#6a5a8c', '#9a7a3a', '#4a6488', '#7a4f36'];

export function tintFor(slug: string): string {
  let h = 0;
  for (const ch of slug) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return TINTS[h % TINTS.length];
}

/** 'grey-talon' → 'GT', 'abrams' → 'A' */
export function initialsFor(slug: string, max = 2): string {
  return slug
    .split('-')
    .filter((w) => w !== 'the')
    .slice(0, max)
    .map((w) => w.charAt(0).toUpperCase())
    .join('');
}
