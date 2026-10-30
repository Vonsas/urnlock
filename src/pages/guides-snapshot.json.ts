/**
 * 가이드 · 팁 정적 스냅샷 (요약) — /guides-snapshot.json (#21). 만드는 곳은 src/data/guides-snapshot.ts.
 * 가이드 목록 · 영웅 탭용: 가이드 요약(본문 · 영상 없이) + 영웅마다 공개 팁. 본문은 /guides-snapshot-full.json (보기 화면만).
 * 화면(scripts/api-result.ts)은 /api 가 실패했을 때만 받는다 — 평소 페이지 무게에는 들어가지 않는다.
 * 이름이 고정이라 /data/(1년 캐시) 밖에 두고 vercel.json 에서 매번 확인(max-age=0, must-revalidate) — 운영자가 내린 글이 옛 사본으로 남지 않게.
 */
import type { APIRoute } from 'astro';
import { loadGuidesSnapshot } from '../data/guides-snapshot';

export const GET: APIRoute = async () => {
  const { builtAt, ok, guides, tips } = await loadGuidesSnapshot();
  const summaries = guides.map(({ sections: _s, video: _v, ...summary }) => summary);
  return new Response(JSON.stringify({ builtAt, ok, guides: summaries, tips }), { headers: { 'Content-Type': 'application/json' } });
};
