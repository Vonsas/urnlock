/**
 * 게임 이미지 → 사이트에 함께 올릴 최적화 이미지.
 * 빌드 때 Astro 가 원본을 받아 WebP 로 줄여 dist/_astro/ 에 넣는다 (개발 서버는 요청 때 변환).
 * 원본 URL 이 없거나 변환에 실패하면 undefined — 호출하는 쪽이 머리글자 자리를 그린다.
 */
import { getImage } from 'astro:assets';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

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

/**
 * SVG 그대로 (줄이거나 바꾸지 않고 사이트에 함께 올린다) — 영웅 이름 로고처럼 크게 키워도 선명해야 하는 그림.
 * 크기를 알려고 inferSize 를 쓰면 Astro 가 부를 때마다 원본을 받는다 — BaseLayout 이 모든 페이지에서 소울 아이콘을 부르고
 * 영웅 페이지가 이름 로고를 불러, Vercel 빌드에서 영웅 페이지 차례에만 3분 넘게 걸렸다 (2026-11-05).
 * 그래서 주소마다 한 번만 재고(빌드 안 memo), 잰 크기는 캐시 파일에 남겨 다음 빌드는 받지 않는다 (주소에 파일 버전 ?v= 가 붙어 그림이 바뀌면 주소도 바뀐다).
 */
const SIZE_FILE = path.join(
  process.cwd(),
  ...(process.env.VERCEL ? ['node_modules', '.cache', 'dldb-api'] : ['.cache', 'api']),
  'svg-sizes.json',
);
let sizes: Promise<Record<string, [number, number]>> | undefined;
const loadSizes = () =>
  (sizes ??= readFile(SIZE_FILE, 'utf8')
    .then((t) => JSON.parse(t) as Record<string, [number, number]>)
    .catch((): Record<string, [number, number]> => ({})));
let saveTimer: ReturnType<typeof setTimeout> | undefined;
const saveSizes = () => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      await mkdir(path.dirname(SIZE_FILE), { recursive: true });
      await writeFile(SIZE_FILE, JSON.stringify(await loadSizes()));
    } catch {
      // 남기지 못해도 다음 빌드가 다시 잴 뿐
    }
  }, 500);
};

const svgMemo = new Map<string, Promise<{ src: string; width: number; height: number } | undefined>>();

async function svgOnce(url: string): Promise<{ src: string; width: number; height: number } | undefined> {
  try {
    const known = (await loadSizes())[url];
    if (known) {
      const img = await getImage({ src: url, width: known[0], height: known[1], format: 'svg' });
      return { src: img.src, width: known[0], height: known[1] };
    }
    const img = await getImage({ src: url, inferSize: true, format: 'svg' });
    const width = Number(img.attributes.width ?? img.options.width);
    const height = Number(img.attributes.height ?? img.options.height);
    if (width > 0 && height > 0) {
      (await loadSizes())[url] = [width, height];
      saveSizes();
      return { src: img.src, width, height };
    }
    return { src: img.src, width: 4, height: 1 };
  } catch (error) {
    console.warn(`[dldb:image] ${url}: ${error instanceof Error ? error.message : error}`);
    return undefined;
  }
}

/** gameSvg + 원래 가로·세로 (비율로 크기를 맞출 때) */
export function gameSvgSized(url: string | undefined): Promise<{ src: string; width: number; height: number } | undefined> {
  if (!url) return Promise.resolve(undefined);
  let p = svgMemo.get(url);
  if (!p) svgMemo.set(url, (p = svgOnce(url)));
  return p;
}

export async function gameSvg(url: string | undefined): Promise<string | undefined> {
  return (await gameSvgSized(url))?.src;
}
