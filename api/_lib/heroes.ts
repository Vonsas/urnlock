/**
 * 실제 영웅인지 확인 (2026-10-14 점검) — 가이드의 영웅 칸에 아무 숫자나 넣으면 없는 영웅의 목록 키가 생기고 목록에 '알 수 없는 영웅' 글이 섞였다.
 * 출시 영웅 id 를 deadlock-api 에서 받아 Redis 에 6시간 둔다 (새 영웅은 화·금마다 나와서 고정 목록으로 두면 그날 글을 못 쓴다).
 * API 가 안 되고 저장된 목록도 없으면 1–999 범위만 본다 — 글쓰기가 통째로 막히지 않게.
 */
import { redis } from './redis.js';

const KEY = 'heroes:ids';
const TTL = 6 * 3600;
/** 같은 함수 인스턴스 안에서는 10분 동안 저장소를 다시 읽지 않는다 (#20 — 글쓰기 · 팁마다 GET 1회를 덜음). 새 영웅이 늦어도 10분 */
const MEMO_MS = 10 * 60_000;
let memo: { ids: number[]; at: number } | null = null;

async function heroIds(): Promise<number[] | null> {
  if (memo && Date.now() - memo.at < MEMO_MS) return memo.ids;
  const ids = await loadHeroIds();
  if (ids) memo = { ids, at: Date.now() };
  return ids;
}

async function loadHeroIds(): Promise<number[] | null> {
  // 저장소가 멈췄으면(StoreError) 그대로 올려보낸다 — 이 확인은 글 · 팁 쓰기 앞에서만 쓰고, 저장소 없이는 어차피 못 쓰므로
  // 여기서 삼키면 시간 초과를 두세 번 기다린 뒤에야 503 이 났다 (#21: 2.5초 × 3)
  const cached = await redis<string | null>('GET', KEY);
  if (cached) return JSON.parse(cached) as number[];
  try {
    const res = await fetch('https://api.deadlock-api.com/v1/assets/heroes?only_active=true', { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const ids = ((await res.json()) as Array<{ id: number; player_selectable?: boolean }>).filter((h) => h.player_selectable !== false).map((h) => h.id);
    if (!ids.length) return null;
    await redis('SET', KEY, JSON.stringify(ids), 'EX', TTL).catch(() => {});
    return ids;
  } catch {
    return null;
  }
}

export async function isHeroId(id: number): Promise<boolean> {
  if (!Number.isInteger(id) || id < 1 || id > 999) return false;
  const ids = await heroIds();
  return ids ? ids.includes(id) : true;
}
