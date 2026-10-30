/**
 * 가이드 정적 스냅샷 (본문) — /guides-snapshot-full.json (#21). 가이드 보기 화면이 /api 가 실패했을 때만 받는다.
 * 본문이 들어 있어 커질 수 있다 (추천순 200편 · 한 편 최대 8,000자 — 최대 수 MB). 목록 · 영웅 탭은 요약 파일만 쓴다.
 */
import type { APIRoute } from 'astro';
import { loadGuidesSnapshot } from '../data/guides-snapshot';

export const GET: APIRoute = async () => {
  const { builtAt, ok, guides } = await loadGuidesSnapshot();
  return new Response(JSON.stringify({ builtAt, ok, guides }), { headers: { 'Content-Type': 'application/json' } });
};
