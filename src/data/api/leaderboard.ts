/**
 * 전적 페이지 순위표의 계정 · 프로필 사진 · 주 영웅 (2026-11-02 사용자 요청: 지역별 100위까지, 누군지 모르면 '식별불가').
 * Valve 순위표는 이름만 주고 deadlock-api 가 같은 이름의 계정 후보(possible_account_ids)를 붙인다. 브라우저에서 순위마다 계정을 찾고
 * 프로필 · 영웅 기록을 부르면 요청이 수천 번(후보가 지역마다 약 1,000개)이라 빌드 때 한 번 정해 /data/leaderboard-{지역}-{시각}.json 으로 둔다.
 * 순위 자체는 브라우저가 지금 순위표를 받아 그린다 (1시간마다 바뀜) — 이 파일은 이름 → 계정 · 계정 → 사진 · 영웅 표일 뿐.
 *
 * 계정 고르기: 후보 하나면 그 계정. 여럿이면 /v1/players/rank 로 후보의 마지막 랭크 매치를 보고
 * **최근 30일 안에 휘장 100+(승천자 이상)로 경기한 후보가 딱 하나**일 때만 그 계정. 하나도 없으면 81+(예지자 이상)로 한 번 더 —
 * 남미 · 오세아니아는 100위 근처가 휘장 84–96 이다 (#83 1차 리뷰). 그래도 0명이면 60일 안 100+ — 랭크 조회의 마지막 매치가
 * 30일을 막 넘긴 상위권이 있다 (StartDash 31일 · GBS 46일). 기간 없이 81+ 로 하면 같은 이름의 옛 계정(Jeb 휘장 82 · 89일 전,
 * 바로 위아래 순위는 113 · 111)을 골라 남의 사진 · 전적이 붙었다 (#86 1차 리뷰).
 * 맞는 후보가 둘 이상이면 **지금 스팀 이름이 순위표 이름과 같은 후보가 딱 하나**일 때 그 계정 (2026-11-02 사용자: lystic 이 식별불가 —
 * 후보에 이름을 바꾼 다른 상위권 계정 'cekcu' 가 섞여 있었다). 같은 지역에 같은 이름이 둘 이상이면(북미 basil 66 · 75위) 식별불가.
 * 2026-11-02 아시아 10명을 매치 기록 방식(전적 페이지에서 이름을 누를 때 쓰는 pickCandidate)과 대조해 10명 모두 같았다.
 * 0명 · 여럿 · 후보 150개 초과(흔한 이름)는 '식별불가' — 누르면 지금처럼 매치 기록으로 찾는다.
 * 주 영웅 = 최근 30일 일반 6v6(랭크 · 일반) 판수 상위 3명. 티어 = 고른 계정의 지금 휘장, 마지막 랭크 매치가 60일 안일 때만 (2026-11-03 사용자 — Valve 순위표엔 휘장이 없다).
 */
import { createHash } from 'node:crypto';
import { API_BASE, load, loadRank, warn } from './fetch';
import { REGIONS, type Region } from './builds';
// 후보 고르기(PICK_PASSES) · 티어 60일 규칙은 브라우저의 영웅 순위표와 같이 쓴다
import { fitCandidates, shownBadge } from '../../lib/leaderboard-rules';

/** 빌드 뒤 몇 시간 동안 순위가 움직여도 들어오게 100위보다 조금 더 받는다 */
const DEPTH = 120;
const CANDIDATES_MAX = 150;
const RECENT_S = 30 * 86_400;
const TOP_HEROES = 3;
/** /v1/players/rank 는 IP 당 분당 20회 — loadRank 가 다른 곳(빌드 작성자 랭크)과 한 줄로 세워 3.2초 간격. 지역 다섯 개 합쳐 15번쯤 */
const RANK_CHUNK = 400;
const AVATAR = /^[0-9a-f]{40}$/;

export interface LeaderboardAccount {
  /** Steam 프로필 사진 해시 — https://avatars.steamstatic.com/{해시}_medium.jpg */
  a?: string;
  /** 지금 휘장 (116 = 단계 11 · 하위 6). 랭크 기록이 없으면 없음 */
  b?: number;
  /** 주 영웅 id (판수 순, 최대 3) */
  h: number[];
}
export interface LeaderboardInfo {
  /** 후보가 여럿이던 이름 → 고른 계정 (후보 하나인 이름은 브라우저가 바로 안다) */
  names: Record<string, number>;
  accounts: Record<number, LeaderboardAccount>;
}

interface Entry {
  name: string;
  ids: number[];
  heroes: number[];
}

/** /data/{이 이름}.json — 이름에 데이터 시각이 있어 1년 캐시 (stats-steps 와 같은 규칙) */
export const leaderboardFile = (region: Region, generatedAt: number) => `leaderboard-${region}-${generatedAt}`;

const hash = (ids: number[]) => createHash('sha1').update(ids.join(',')).digest('hex').slice(0, 16);

export async function loadLeaderboardInfo(): Promise<Partial<Record<Region, LeaderboardInfo>> | null> {
  const boards = await Promise.all(
    REGIONS.map((region) =>
      load(`lb-top-${region}`, `${API_BASE}/v1/leaderboard/${region}`, (json) =>
        ((json as { entries?: Array<{ account_name?: string; rank: number; possible_account_ids?: number[]; top_hero_ids?: number[] }> }).entries ?? [])
          .filter((e) => e.rank <= DEPTH)
          .map((e): Entry => ({ name: e.account_name ?? '', ids: e.possible_account_ids ?? [], heroes: e.top_hero_ids ?? [] })),
      ).then((entries) => [region, entries ?? []] as const),
    ),
  );
  if (boards.every(([, e]) => !e.length)) return null;

  // 모든 후보의 휘장 · 마지막 랭크 매치 — 여럿인 이름은 계정 고르기에, 고른 계정은 티어 표시에 쓴다
  const rankIds = [...new Set(boards.flatMap(([, es]) => es.filter((e) => e.ids.length && e.ids.length <= CANDIDATES_MAX).flatMap((e) => e.ids)))].sort((a, b) => a - b);
  const ranks = new Map<number, { badge: number; at: number }>();
  for (let i = 0; i < rankIds.length; i += RANK_CHUNK) {
    const part = rankIds.slice(i, i + RANK_CHUNK);
    const rows = await loadRank(`lb-ranks-${hash(part)}`, `${API_BASE}/v1/players/rank?account_ids=${part.join(',')}`, (json) =>
      (json as Array<{ account_id: number; badge?: number; last_match?: { start_time?: number } | null }>).map(
        (r) => [r.account_id, r.badge ?? 0, r.last_match?.start_time ?? 0] as [number, number, number],
      ),
    );
    for (const [id, badge, at] of rows ?? []) ranks.set(id, { badge, at });
  }

  const now = Math.floor(Date.now() / 1000);
  const fits = new Map<Region, Array<[string, number[]]>>();
  for (const [region, entries] of boards) {
    const count = new Map<string, number>();
    for (const e of entries) count.set(e.name, (count.get(e.name) ?? 0) + 1);
    const list: Array<[string, number[]]> = [];
    for (const e of entries) {
      if (!e.name || count.get(e.name)! > 1 || e.ids.length < 2 || e.ids.length > CANDIDATES_MAX) continue;
      const fit = fitCandidates(e.ids, ranks, now);
      if (fit.length) list.push([e.name, fit]);
    }
    fits.set(region, list);
  }

  // 맞는 후보가 여럿인 이름 → 그 후보들의 지금 스팀 이름
  const tied = [...new Set([...fits.values()].flatMap((l) => l.filter(([, f]) => f.length > 1).flatMap(([, f]) => f)))].sort((a, b) => a - b);
  const steamNames = new Map<number, string>();
  for (let i = 0; i < tied.length; i += 100) {
    const part = tied.slice(i, i + 100);
    const rows = await load(`lb-names-${hash(part)}`, `${API_BASE}/v1/players/steam?account_ids=${part.join(',')}`, (json) =>
      (json as Array<{ account_id: number; personaname?: string }>).map((p) => [p.account_id, p.personaname ?? ''] as [number, string]),
    );
    for (const [id, n] of rows ?? []) steamNames.set(id, n);
  }

  // 이름은 아무 글자나 올 수 있어('__proto__' 등) 객체 대신 Map 으로 모은다
  const picked = new Map<Region, { names: Map<string, number>; ids: number[] }>();
  for (const [region, entries] of boards) {
    const names = new Map<string, number>();
    const ids = entries.filter((e) => e.ids.length === 1).map((e) => e.ids[0]);
    for (const [name, fit] of fits.get(region)!) {
      const one = fit.length === 1 ? fit : fit.filter((id) => steamNames.get(id) === name);
      if (one.length !== 1) continue;
      names.set(name, one[0]);
      ids.push(one[0]);
    }
    picked.set(region, { names, ids });
  }

  // 고른 계정의 프로필 사진 · 최근 30일 영웅 판수 (둘 다 IP 당 초당 100회)
  const all = [...new Set([...picked.values()].flatMap((p) => p.ids))].sort((a, b) => a - b);
  const avatars = new Map<number, string>();
  const heroes = new Map<number, number[]>();
  const from = now - RECENT_S;
  for (let i = 0; i < all.length; i += 100) {
    const part = all.slice(i, i + 100);
    const [profiles, stats] = await Promise.all([
      load(`lb-avatars-${hash(part)}`, `${API_BASE}/v1/players/steam?account_ids=${part.join(',')}`, (json) =>
        (json as Array<{ account_id: number; avatarmedium?: string }>).map((p) => [p.account_id, /\/([0-9a-f]{40})_medium\.jpg$/.exec(p.avatarmedium ?? '')?.[1] ?? ''] as [number, string]),
      ),
      load(`lb-heroes-${hash(part)}`, `${API_BASE}/v1/players/hero-stats?account_ids=${part.join(',')}&game_mode=normal&min_unix_timestamp=${from - (from % 3600)}`, (json) => {
        const by = new Map<number, Array<[number, number]>>();
        for (const r of json as Array<{ account_id: number; hero_id: number; matches_played?: number }>)
          if (r.matches_played) by.set(r.account_id, [...(by.get(r.account_id) ?? []), [r.hero_id, r.matches_played]]);
        return [...by].map(([id, rows]) => [id, rows.sort((x, y) => y[1] - x[1]).slice(0, TOP_HEROES).map(([h]) => h)] as [number, number[]]);
      }),
    ]);
    for (const [id, a] of profiles ?? []) if (AVATAR.test(a)) avatars.set(id, a);
    for (const [id, hs] of stats ?? []) heroes.set(id, hs);
  }

  const out: Partial<Record<Region, LeaderboardInfo>> = {};
  for (const [region, entries] of boards) {
    const { names, ids } = picked.get(region)!;
    const accounts: Record<number, LeaderboardAccount> = {};
    for (const id of ids) {
      // 최근 30일 기록이 없으면 Valve 순위표의 주 영웅(4명 중 1명꼴로만 온다)
      const valve = entries.find((e) => (e.ids.length === 1 && e.ids[0] === id) || names.get(e.name) === id)?.heroes ?? [];
      // 마지막 랭크 매치가 60일 넘었거나 휘장 번호 꼴이 아니면 싣지 않는다 (shownBadge)
      const badge = shownBadge(ranks.get(id), now);
      accounts[id] = {
        ...(avatars.has(id) ? { a: avatars.get(id) } : {}),
        ...(badge > 0 ? { b: badge } : {}),
        h: heroes.get(id) ?? valve.slice(0, TOP_HEROES),
      };
    }
    out[region] = { names: Object.fromEntries(names), accounts };
    const unknown = entries.filter((e) => e.ids.length !== 1 && !names.has(e.name)).length;
    if (entries.length && unknown > entries.length / 2) warn(`순위표 ${region}: ${entries.length}명 중 ${unknown}명을 계정으로 특정하지 못함`);
  }
  return out;
}
