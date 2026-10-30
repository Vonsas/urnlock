/**
 * 상위권 인기 빌드 — 예지자+(휘장 81–116) 매치에서 (2026-10-03 사용자 요청으로 초월자+ 91 → 예지자+ 81, 표본이 적어서) 플레이어가 게임 시작 때 고른 게임 빌드를 많이 쓴 순으로.
 * hero-build-stats 는 영웅마다 1회(analytics, IP 당 분당 200회를 티어·지표와 나눠 씀 → 동시 4개).
 * 표본이 작아(영웅당 14일 수십~수백 판) 승률은 보지 않고 쓴 판수·사람 수만 쓴다.
 * 리플레이 분석된 매치만 집계되어 판수가 적다 — API 기본값(min_matches=20)이면 켈빈·그레이브즈 등 9명이 하나도 안 나와서
 * 10판으로 낮췄다 (2026-10-03, 보여주는 건 1–3위뿐이라 사용자 확인).
 * 막 나온 영웅은 예지자+ 판수가 모자라 하나도 안 나온다 (2026-10-07 바바: 출시 반나절 예지자+ 7판) → 그런 영웅만 **전체 랭크**로 한 번 더 받고
 * allRanks 로 표시해 화면이 '상위권 인기' 대신 '인기 빌드' 로 부른다 (사용자: 신캐가 빌드에 바로 들어오게, 영웅 탭처럼).
 */
import { createHash } from 'node:crypto';
import { API_BASE, load } from './fetch';
import { pool } from './tiers';

const TOP_MIN = 81;
const TOP_MAX = 116;
/** 빌드 하나가 이 판수 이상 쓰여야 순위에 넣는다 */
const MIN_MATCHES = 10;

export interface BuildUsage {
  buildId: number;
  matches: number;
  players: number;
  /** 예지자+ 가 아니라 전체 랭크에서 센 순위 (막 나온 영웅) */
  allRanks?: boolean;
}

const rowsOf = (json: unknown) =>
  (json as Array<{ hero_build_id: number; matches: number; players: number }>)
    .map((r) => ({ buildId: r.hero_build_id, matches: r.matches, players: r.players }))
    .sort((a, b) => b.matches - a.matches);

export async function loadTopBuildUsage(from: number, heroIds: number[]): Promise<Map<number, BuildUsage[]>> {
  const rows = await pool(
    heroIds.map((id) => () =>
      load(
        `top-builds-${id}-14d-b${TOP_MIN}-m${MIN_MATCHES}`,
        `${API_BASE}/v1/analytics/hero-build-stats/${id}?min_unix_timestamp=${from}&min_average_badge=${TOP_MIN}&max_average_badge=${TOP_MAX}&min_matches=${MIN_MATCHES}`,
        rowsOf,
      ).then((r) => [id, r] as const),
    ),
    4,
  );
  const usage = new Map<number, BuildUsage[]>(rows.map(([id, r]) => [id, r ?? []]));
  // 예지자+ 에 하나도 없는 영웅(막 나온 영웅) → 전체 랭크. 요청이 실패한 영웅(null)은 빼둔다 — 실패를 '빌드 없음' 으로 보면
  // 잘 알려진 영웅도 전체 랭크 순위로 바뀌어 '상위권 인기' 표시가 사라졌다 (2026-10-14 점검)
  const empty = rows.filter(([, r]) => r !== null && r.length === 0).map(([id]) => id);
  const fallback = await pool(
    empty.map((id) => () =>
      load(`top-builds-${id}-14d-all-m${MIN_MATCHES}`, `${API_BASE}/v1/analytics/hero-build-stats/${id}?min_unix_timestamp=${from}&min_matches=${MIN_MATCHES}`, rowsOf).then(
        (r) => [id, (r ?? []).map((u) => ({ ...u, allRanks: true }))] as const,
      ),
    ),
    4,
  );
  for (const [id, r] of fallback) if (r.length) usage.set(id, r);
  return usage;
}

/**
 * 빌드별 성적 (2026-10-22 사용자 요청: 빌드마다 승률 · 사용률 · 작성자 랭킹) — 최근 14일 **전체 랭크**, 플레이어가 매치 시작 때 고른 빌드 기준.
 * 예지자+ 로 좁히면 판수가 1/10 로 줄어 승률이 크게 흔들려(실버 1위 486판) 전체로 센다 (헤이즈 1위 빌드 2.1만 판).
 * 사용률의 분모 = 이 영웅의 '빌드가 기록된' 판 전체(모든 빌드의 판수 합). min_matches=1 로 받아 합을 내고, 캐시엔 5판 이상 빌드만 남긴다.
 * 영웅마다 1회 (analytics, 분당 200회를 티어 · 지표와 나눠 씀 → 동시 4개).
 */
export interface BuildPerfTable {
  total: number;
  /** [빌드 ID, 판수, 승수] */
  rows: Array<[number, number, number]>;
}
const PERF_KEEP = 5;
export async function loadBuildPerf(from: number, heroIds: number[]): Promise<Map<number, BuildPerfTable>> {
  const rows = await pool(
    heroIds.map((id) => () =>
      load(`build-perf-${id}-14d-all`, `${API_BASE}/v1/analytics/hero-build-stats/${id}?min_unix_timestamp=${from}&min_matches=1`, (json) => {
        const all = json as Array<{ hero_build_id: number; matches: number; wins: number }>;
        return {
          total: all.reduce((n, r) => n + r.matches, 0),
          rows: all.filter((r) => r.matches >= PERF_KEEP).map((r) => [r.hero_build_id, r.matches, r.wins] as [number, number, number]),
        };
      }).then((r) => [id, r] as const),
    ),
    4,
  );
  return new Map(rows.flatMap(([id, r]) => (r ? [[id, r] as const] : [])));
}

/**
 * 작성자 랭킹 — Valve 공식 순위표(지역마다 최대 1,000명, 이름만 준다)에서 이 계정을 찾고, 없으면 지금 랭크 휘장.
 * 순위표 줄의 후보 계정(deadlock-api 가 이름으로 붙인 추측)에 이 계정이 있고, 후보가 하나뿐이거나 이름이 작성자 Steam 이름 · 등록 이름과 같을 때만 인정
 * (이름이 흔하면 엉뚱한 사람이 잡히므로). 여러 지역에 잡히면 더 높은 순위.
 * 랭크는 /v1/players/rank?account_ids= 한 번에 (매치 끝났을 때 랭크 — 랭크를 안 하면 없음).
 */
export const REGIONS = ['Asia', 'Europe', 'NAmerica', 'SAmerica', 'Oceania'] as const;
export type Region = (typeof REGIONS)[number];
export interface Standing {
  region?: Region;
  rank?: number;
  /** 휘장 번호 (113 = 불멸자 3) */
  badge?: number;
}
let boards: Promise<Array<{ region: Region; entries: Array<{ name: string; rank: number; ids: number[] }> }>> | undefined;
const loadBoards = () =>
  (boards ??= Promise.all(
    REGIONS.map((region) =>
      load(`leaderboard-${region}`, `${API_BASE}/v1/leaderboard/${region}`, (json) =>
        ((json as { entries?: Array<{ account_name?: string; rank: number; possible_account_ids?: number[] }> }).entries ?? [])
          // 후보가 너무 많은 줄(흔한 이름)은 어차피 인정하지 않으므로 버린다 — 캐시 크기
          .filter((e) => (e.possible_account_ids?.length ?? 0) > 0 && (e.possible_account_ids?.length ?? 0) <= 300)
          .map((e) => ({ name: e.account_name ?? '', rank: e.rank, ids: e.possible_account_ids ?? [] })),
      ).then((entries) => ({ region, entries: entries ?? [] })),
    ),
  ));

export async function loadStandings(authors: Array<{ id: number; names: string[] }>): Promise<Map<number, Standing>> {
  const out = new Map<number, Standing>();
  if (!authors.length) return out;
  const norm = (s: string) => s.trim().toLowerCase();
  for (const { region, entries } of await loadBoards()) {
    for (const a of authors) {
      const names = new Set(a.names.filter(Boolean).map(norm));
      const hit = entries.find((e) => e.ids.includes(a.id) && (e.ids.length === 1 || names.has(norm(e.name))));
      const current = out.get(a.id)?.rank;
      if (hit && (current === undefined || hit.rank < current)) out.set(a.id, { region, rank: hit.rank });
    }
  }
  const ids = [...new Set(authors.map((a) => a.id))].sort((x, y) => x - y);
  for (let i = 0; i < ids.length; i += 100) {
    const part = ids.slice(i, i + 100);
    // 캐시 이름은 계정 목록 전체의 해시로 — 처음 · 끝 · 개수만 쓰면 다른 목록이 같은 캐시를 읽어 랭크가 빠졌다
    const key = createHash('sha1').update(part.join(',')).digest('hex').slice(0, 16);
    const ranks = await load(`ranks-${key}`, `${API_BASE}/v1/players/rank?account_ids=${part.join(',')}`, (json) =>
      (json as Array<{ account_id: number; badge?: number }>).map((r) => [r.account_id, r.badge ?? 0] as [number, number]),
    );
    for (const [id, badge] of ranks ?? []) if (badge > 0) out.set(id, { ...out.get(id), badge });
  }
  return out;
}
