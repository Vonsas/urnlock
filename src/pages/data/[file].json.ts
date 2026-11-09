/**
 * /data/ 아래 따로 받는 JSON — 이름에 데이터 시각이 들어 있어 vercel.json 에서 1년 캐시 (데이터가 바뀌면 이름이 바뀜). 숫자 위주라 세 언어가 같은 파일을 쓴다.
 *
 * stats-steps-{시각}: 통계(승률표) 랭크 범위용 단계별 원본 (2026-10-03).
 *   페이지에 싣지 않고 따로 둔다: 대부분은 기본값('전체')만 보므로, 범위 막대를 처음 건드릴 때만 받는다 (사용자: 사이트가 무거워지는 건 싫다).
 *   내용: { [기간]: { totals: 단계 1–11 총 매치 수, heroes: { [heroId]: [판수, 승수, 숙련자 판수, 숙련자 승수] × 11 } } }
 * leaderboard-{지역}-{시각}: 전적 페이지 순위표의 계정 · 프로필 사진 · 주 영웅 (2026-11-02, src/data/api/leaderboard.ts).
 *   그 지역 순위표를 열 때만 받는다. 내용: { names: { 이름: 계정 }, accounts: { 계정: { a: 사진 해시, h: [영웅 id] } } }
 * build-notes-{영웅 id}-{내용 해시}: 빌드 페이지 작은 창의 작성자 설명 (2026-11-06, src/lib/build-notes.ts). 그 영웅 빌드 창을 처음 열 때만 받는다.
 */
import type { APIRoute } from 'astro';
import { getLeaderboardInfo, getTierData } from '../../data';
import { statsStepsFile, statsStepsPayload } from '../../lib/tier-page';
import { leaderboardFile } from '../../data/api/leaderboard';
import { buildNotes } from '../../lib/build-notes';

export async function getStaticPaths() {
  const [data, lb, notes] = await Promise.all([getTierData(), getLeaderboardInfo(), buildNotes()]);
  return [
    ...(data ? [{ params: { file: statsStepsFile(data.generatedAt) } }] : []),
    ...(lb ? Object.entries(lb.regions).map(([region, info]) => ({ params: { file: leaderboardFile(region as keyof typeof lb.regions, lb.generatedAt) }, props: { info } })) : []),
    ...notes.map((n) => ({ params: { file: n.file }, props: { info: n.payload } })),
  ];
}

export const GET: APIRoute = async ({ props }) => {
  if (props.info) return new Response(JSON.stringify(props.info), { headers: { 'Content-Type': 'application/json' } });
  const data = await getTierData();
  return new Response(JSON.stringify(data ? statsStepsPayload(data) : {}), { headers: { 'Content-Type': 'application/json' } });
};
