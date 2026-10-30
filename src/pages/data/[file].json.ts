/**
 * 통계(승률표) 랭크 범위용 단계별 원본 — /data/stats-steps-{데이터 시각}.json (2026-10-03).
 * 페이지에 싣지 않고 따로 둔다: 대부분은 기본값('전체')만 보므로, 범위 막대를 처음 건드릴 때만 받는다 (사용자: 사이트가 무거워지는 건 싫다).
 * 숫자뿐이라 세 언어가 같은 파일을 쓴다. 이름에 데이터 시각이 들어 있어 vercel.json 에서 1년 캐시 (데이터가 바뀌면 이름이 바뀜).
 * 내용: { [기간]: { totals: 단계 1–11 총 매치 수, heroes: { [heroId]: [판수, 승수, 숙련자 판수, 숙련자 승수] × 11 } } }
 */
import type { APIRoute } from 'astro';
import { getTierData } from '../../data';
import { statsStepsFile, statsStepsPayload } from '../../lib/tier-page';

export async function getStaticPaths() {
  const data = await getTierData();
  return data ? [{ params: { file: statsStepsFile(data.generatedAt) } }] : [];
}

export const GET: APIRoute = async () => {
  const data = await getTierData();
  return new Response(JSON.stringify(data ? statsStepsPayload(data) : {}), { headers: { 'Content-Type': 'application/json' } });
};
