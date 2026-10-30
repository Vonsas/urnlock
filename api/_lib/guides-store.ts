/**
 * 가이드 저장 구조 (Upstash Redis, 2026-10-06)
 *   guide:{id}                가이드 하나 (JSON) — 추천 수는 여기 없고 아래 guides:votes 점수가 원본
 *   guides:new / :{hero}      최신순 (sorted set, 점수 = 올린 시각)
 *   guides:votes / :{hero}    추천순 (sorted set, 점수 = 추천 수). 전체(guides:votes)가 원본이고 영웅별은 그 사본 —
 *                             추천 · 취소 · 영웅 바꾸기 때 함께 고친다. 영웅별 추천순 목록은 사본 점수를 그대로 화면에 낸다 (#20)
 *   guide:voters:{id}         추천한 계정 ID (set) — 계정당 한 번, 다시 누르면 취소
 *   tips:banned               차단 계정 (팁과 같이 쓴다)
 *   guides:pending-images     운영자 확인을 기다리는 사진이 있는 가이드 (점수 = 올린 시각)
 *   guides:reported · reports:{id}   신고된 가이드(점수 = 신고 수) · 신고 내용 (api/guide-report.ts)
 */
import { excerptOf, publicAuthor, type AuthorDisplay, type Guide, type GuideSection, type GuideSummary } from '../../src/lib/guide-format.js';
import { deleteImages } from './images.js';
import { pipeline, redis } from './redis.js';

export interface StoredGuide {
  id: string;
  hero: number;
  title: string;
  sections: GuideSection[];
  video: string | null;
  accountId: number;
  name: string;
  rank: { tier: number; sub: number } | null;
  games: number | null;
  /** 작성자 표시 — 없으면 공개 */
  display?: AuthorDisplay;
  createdAt: number;
  updatedAt: number;
}

export const guideKey = (id: string) => `guide:${id}`;
export const PENDING_IMAGES = 'guides:pending-images';
export const REPORTED = 'guides:reported';
export const reportsKey = (id: string) => `reports:${id}`;
export const votersKey = (id: string) => `guide:voters:${id}`;
/** hero 를 안 주면 전체, 0 이면 일반 가이드 묶음 */
export const newKey = (hero?: number) => (hero === undefined ? 'guides:new' : `guides:new:${hero}`);
export const votesKey = (hero?: number) => (hero === undefined ? 'guides:votes' : `guides:votes:${hero}`);

/** 주소에 쓰는 짧은 ID — 소문자·숫자 10자 */
export function newGuideId() {
  const abc = 'abcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from(crypto.getRandomValues(new Uint8Array(10)), (b) => abc[b % abc.length]).join('');
}
export const isGuideId = (v: unknown): v is string => typeof v === 'string' && /^[a-z0-9]{10}$/.test(v);

export async function loadGuides(ids: string[]): Promise<StoredGuide[]> {
  if (!ids.length) return [];
  return parseGuides(await redis<Array<string | null>>('MGET', ...ids.map(guideKey)));
}

/** MGET 결과 → 가이드 (파이프라인 안에서 MGET 을 같이 보낸 곳도 쓴다) */
export function parseGuides(raw: Array<string | null>): StoredGuide[] {
  return raw.flatMap((r) => {
    if (!r) return [];
    try {
      return [JSON.parse(r) as StoredGuide];
    } catch {
      return [];
    }
  });
}

/** 추천 수 여러 개 한 번에 */
export async function loadVotes(ids: string[]): Promise<Map<string, number>> {
  if (!ids.length) return new Map();
  const scores = await redis<Array<string | null>>('ZMSCORE', votesKey(), ...ids);
  return new Map(ids.map((id, i) => [id, Number(scores[i] ?? 0)]));
}

const author = (g: StoredGuide) => publicAuthor(g, g.display);

export const toSummary = (g: StoredGuide, votes: number): GuideSummary => ({
  id: g.id,
  hero: g.hero,
  title: g.title,
  excerpt: excerptOf(g.sections),
  sectionTitles: g.sections.map((x) => x.title),
  votes,
  hasVideo: !!g.video,
  createdAt: g.createdAt,
  updatedAt: g.updatedAt,
  ...author(g),
});

/**
 * 보는 사람용. 사진은 올리면 바로 공개 (2026-10-09 — 예전 '확인 전' 사진도 이제 모두에게 보인다).
 * 운영자가 지운 사진은 빼지 않고 주소만 비운다: 내용의 '[사진 2]' 자리 표시가 번호로 사진을 가리키므로 순서가 밀리면 안 된다.
 */
export const toGuide = (g: StoredGuide, votes: number, viewer: number | null): Guide => ({
  ...toSummary(g, votes),
  video: g.video,
  sections: g.sections.map((x) => ({ ...x, images: x.images.map(({ pending: _p, ...im }) => (void viewer, im)) })),
});

/** 가이드를 지우면 사진도 저장소에서 지운다. 저장소는 한 번에 (#20 — DEL 셋을 하나로 합쳐 명령 8 → 7, 왕복 8 → 1) */
export async function removeGuide(g: StoredGuide) {
  await deleteImages(g.sections.flatMap((x) => x.images.map((im) => im.url)).filter(Boolean));
  await pipeline([
    ['ZREM', PENDING_IMAGES, g.id],
    ['ZREM', REPORTED, g.id],
    ['ZREM', newKey(), g.id],
    ['ZREM', newKey(g.hero), g.id],
    ['ZREM', votesKey(), g.id],
    ['ZREM', votesKey(g.hero), g.id],
    ['DEL', guideKey(g.id), votersKey(g.id), reportsKey(g.id)],
  ]);
}
