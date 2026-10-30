/**
 * 게임 이미지 → 사이트에 함께 올릴 최적화 이미지.
 * 빌드 때 Astro 가 원본을 받아 WebP 로 줄여 dist/_astro/ 에 넣는다 (개발 서버는 요청 때 변환).
 * 원본 URL 이 없거나 변환에 실패하면 undefined — 호출하는 쪽이 머리글자 자리를 그린다.
 */
import { getImage } from 'astro:assets';

/**
 * @param width  출력 너비(px). 화면 표시 크기의 2배 정도 (고해상도 화면)
 * @param height 출력 높이(px). 원본 비율과 같게
 */
export async function gameImage(url: string | undefined, width: number, height: number): Promise<string | undefined> {
  if (!url) return undefined;
  try {
    const img = await getImage({ src: url, width, height, format: 'webp', quality: 85 });
    return img.src;
  } catch (error) {
    console.warn(`[dldb:image] ${url}: ${error instanceof Error ? error.message : error}`);
    return undefined;
  }
}

/** SVG 그대로 (줄이거나 바꾸지 않고 사이트에 함께 올린다) — 영웅 이름 로고처럼 크게 키워도 선명해야 하는 그림 */
export async function gameSvg(url: string | undefined): Promise<string | undefined> {
  if (!url) return undefined;
  try {
    const img = await getImage({ src: url, inferSize: true, format: 'svg' });
    return img.src;
  } catch (error) {
    console.warn(`[dldb:image] ${url}: ${error instanceof Error ? error.message : error}`);
    return undefined;
  }
}

/** gameSvg + 원래 가로·세로 (비율로 크기를 맞출 때) */
export async function gameSvgSized(url: string | undefined): Promise<{ src: string; width: number; height: number } | undefined> {
  if (!url) return undefined;
  try {
    const img = await getImage({ src: url, inferSize: true, format: 'svg' });
    const width = Number(img.attributes.width ?? img.options.width);
    const height = Number(img.attributes.height ?? img.options.height);
    return width > 0 && height > 0 ? { src: img.src, width, height } : { src: img.src, width: 4, height: 1 };
  } catch (error) {
    console.warn(`[dldb:image] ${url}: ${error instanceof Error ? error.message : error}`);
    return undefined;
  }
}
