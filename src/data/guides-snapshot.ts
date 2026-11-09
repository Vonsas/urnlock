/**
 * 가이드 · 팁 정적 스냅샷 (#21, 2026-10-30) — 빌드 때 Upstash 에서 공개된 글을 읽어 /guides-snapshot.json(요약 · 팁) · /guides-snapshot-full.json(본문) 으로 굽는다.
 * 저장소가 멈추거나(무료 한도 초과 · 장애) /api 가 없을 때(Cloudflare Pages 예비 배포, #33) 화면이 이걸로 대신 그린다 — 화면은 API 가 실패했을 때만 받는다.
 * 6시간 재빌드마다 새로 구워진다. **공개 형태만** 싣는다: 가이드는 toGuide(→ publicAuthor, 익명 글 계정 0 · 닉네임 '', 사진 pending 제거), 팁은 toPublic.
 * 저장소 명령은 파이프라인 2번에 영웅 수 + 3개 정도 (한 빌드 약 50 — 하루 4번 빌드면 월 6천 남짓, 무료 50만의 약 1%).
 * 못 읽으면 직전 배포의 스냅샷(사이트 주소의 두 파일)을 받아 이어 쓴다 — Upstash 한도를 넘긴 달의 6시간 재빌드 · KV 가 없는 Pages 예비 빌드(#33)가
 * 좋은 스냅샷을 빈 파일로 덮어쓰지 않게 (#21 2차 리뷰). 그것도 못 받으면 빈 스냅샷(ok: false). 어느 쪽이든 빌드는 그대로, health.json notes 에 경고.
 * 한 빌드에서 스냅샷 파일 · health.json 이 같이 부르므로 한 번만 읽는다 (memo).
 */
import type { Guide } from '../lib/guide-format';
import type { PublicTip } from '../lib/tips';
import { StoreError, pipeline } from '../../api/_lib/redis';
import { guideKey, parseGuides, toGuide, votesKey } from '../../api/_lib/guides-store';
import { approvedKey, tipKey, toPublic, type StoredTip } from '../../api/_lib/tips-store';
import { getHeroes } from './index';
import { SNAPSHOT_GUIDES_MAX as GUIDES_MAX, SNAPSHOT_TIPS_MAX as TIPS_MAX, reuseSnapshot } from './snapshot-reuse';

export interface GuidesSnapshot {
  builtAt: number;
  ok: boolean;
  /** 추천 수 많은 순 — 화면이 영웅 · 최신순으로 다시 거른다 */
  guides: Guide[];
  /** 영웅 ID → 공개된 팁 (최근 승인 순) */
  tips: Record<number, PublicTip[]>;
  /** 못 읽었을 때 종류 (health.json notes 용 — 공개 파일이라 오류 원문은 싣지 않는다) */
  error?: string;
  /** 저장소를 못 읽어 직전 배포의 스냅샷을 이어 썼는지 (health.json notes 용) */
  reused?: boolean;
}

let memo: Promise<GuidesSnapshot> | undefined;
export const loadGuidesSnapshot = () => (memo ??= build());

async function build(): Promise<GuidesSnapshot> {
  const builtAt = Math.floor(Date.now() / 1000);
  try {
    const heroIds = (await getHeroes('en')).map((h) => h.id).filter((id): id is number => id !== undefined);
    // 1) 추천순 가이드 · 영웅마다 공개 팁 ID — 한 왕복
    const [ranked, ...tipIds] = await pipeline<[string[], ...string[][]]>([
      ['ZRANGE', votesKey(), 0, GUIDES_MAX - 1, 'REV', 'WITHSCORES'],
      ...heroIds.map((h) => ['ZRANGE', approvedKey(h), '+inf', '-inf', 'BYSCORE', 'REV', 'LIMIT', 0, TIPS_MAX]),
    ]);
    const ids = ranked.filter((_, i) => i % 2 === 0);
    const votes = new Map(ids.map((id, i) => [id, Number(ranked[i * 2 + 1])]));
    const allTipIds = tipIds.flat();
    // 2) 글 본문 — 한 왕복
    const [rawGuides, rawTips] = await pipeline<[Array<string | null>, Array<string | null>]>([
      ...(ids.length ? [['MGET', ...ids.map(guideKey)]] : [['MGET', guideKey('none')]]),
      ...(allTipIds.length ? [['MGET', ...allTipIds.map(tipKey)]] : [['MGET', tipKey('none')]]),
    ]);
    const guides = (ids.length ? parseGuides(rawGuides) : []).map((g) => toGuide(g, votes.get(g.id) ?? 0, null));
    const byId = new Map<string, StoredTip>();
    if (allTipIds.length)
      rawTips.forEach((r, i) => {
        try {
          if (r) byId.set(allTipIds[i], JSON.parse(r) as StoredTip);
        } catch {
          /* 깨진 팁은 건너뜀 */
        }
      });
    const tips: Record<number, PublicTip[]> = {};
    heroIds.forEach((h, i) => {
      const list = tipIds[i].map((id) => byId.get(id)).filter((t): t is StoredTip => t?.status === 'approved').map(toPublic);
      if (list.length) tips[h] = list;
    });
    return { builtAt, ok: true, guides, tips };
  } catch (e) {
    // 빌드 로그엔 원문, health.json(공개)엔 종류만 — timeout · limit · error, 저장소 오류가 아니면 'other'
    const error = e instanceof StoreError ? e.kind : 'other';
    const prev = await previousSnapshot();
    console.warn(`[dldb:snapshot] 저장소를 못 읽음 — ${prev ? '직전 배포의 스냅샷을 이어 씀' : '빈 스냅샷으로 진행'}: ${String((e as Error)?.message ?? e)}`);
    return prev ? { ...prev, error, reused: true } : { builtAt, ok: false, guides: [], tips: {}, error };
  }
}

/** 직전 배포의 스냅샷 — 받을 곳: 사이트 주소(SITE_URL · Vercel 빌드는 www) + SNAPSHOT_FALLBACK_URL(쉼표로 여럿). 고르는 규칙은 snapshot-reuse.ts */
async function previousSnapshot() {
  if (process.env.SNAPSHOT_REUSE === '0') return null;
  return reuseSnapshot([import.meta.env.SITE, ...(process.env.SNAPSHOT_FALLBACK_URL ?? '').split(',')]);
}
