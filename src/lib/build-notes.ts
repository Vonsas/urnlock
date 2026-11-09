/**
 * 빌드 작성자가 단 설명 (2026-11-06) — 빌드 페이지의 작은 창을 열 때 그 영웅 것만 받는 파일 /data/build-notes-{영웅 id}-{해시}.json 을 만든다.
 * 전체를 한 파일에 두면 압축 약 85KB 라 영웅별로 나눴다 (사용자: 사이트가 무거워지는 건 싫다). 페이지에는 주소만 심는다.
 * 작성자 글 그대로(대부분 영어, 번역 없음)라 세 언어가 같은 파일을 쓴다.
 * 이름이 내용 해시라 그 영웅 설명이 그대로면 6시간마다 다시 빌드해도 주소가 같아 브라우저 캐시가 이어진다.
 *
 * 내용: { 빌드 id: [묶음마다 { d?: 묶음 설명, n?: { 묶음 안 아이템 순번: 설명 } } 또는 0] }
 * 칸 순서는 페이지 JSON 과 같은 shopGroups 를 따른다. 설명이 하나도 없는 빌드 · 영웅은 뺀다.
 */
import { createHash } from 'node:crypto';
import { getHeroBuilds, getHeroes, getItems, type GameBuild } from '../data';
import { shopGroups } from './build-groups';

export type BuildNotes = Record<number, Array<{ d?: string; n?: Record<number, string> } | 0>>;

let cached: Promise<Array<{ heroId: number; file: string; payload: BuildNotes }>> | undefined;

/** 빌드 한 번에 한 번만 모은다 (세 언어 페이지와 파일 경로가 같이 부른다) */
export function buildNotes() {
  cached ??= (async () => {
    const [heroes, items] = await Promise.all([getHeroes('ko'), getItems('ko')]);
    const shop = new Set(items.flatMap((i) => (i.id === undefined ? [] : [i.id])));
    const files: Array<{ heroId: number; file: string; payload: BuildNotes }> = [];
    for (const h of heroes) {
      if (h.id === undefined) continue;
      const payload: BuildNotes = {};
      const seen = new Set<number>();
      const add = (b: GameBuild) => {
        // 설명이 없는 판도 기억한다 — 같은 빌드의 다른 판(상위권 쪽이 옛 판일 수 있다)이 들어오면 칸 번호가 어긋난다
        if (seen.has(b.buildId)) return;
        seen.add(b.buildId);
        const groups = shopGroups(b.groups, (id) => shop.has(id)).map((g) => {
          const n: Record<number, string> = {};
          g.items.forEach((it, i) => {
            if (it.note) n[i] = it.note;
          });
          const hasNotes = Object.keys(n).length > 0;
          return g.desc || hasNotes ? { ...(g.desc && { d: g.desc }), ...(hasNotes && { n }) } : (0 as const);
        });
        if (groups.some(Boolean)) payload[b.buildId] = groups;
      };
      const { pro, top } = await getHeroBuilds(h.slug);
      // 빌드 페이지와 같은 순서 — 같은 빌드가 둘 다 있으면 추천 쪽 내용을 쓴다
      for (const p of pro) if (p.build) add(p.build);
      for (const t of top) add(t.build);
      if (!Object.keys(payload).length) continue;
      const hash = createHash('sha1').update(JSON.stringify(payload)).digest('hex').slice(0, 10);
      files.push({ heroId: h.id, file: `build-notes-${h.id}-${hash}`, payload });
    }
    return files;
  })();
  return cached;
}

/** 페이지에 심을 주소 — 영웅 id → 파일 주소 (설명이 없는 영웅은 없음) */
export async function buildNotesFiles(): Promise<Record<number, string>> {
  return Object.fromEntries((await buildNotes()).map((f) => [f.heroId, `/data/${f.file}.json`]));
}
