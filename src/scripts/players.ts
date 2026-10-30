/**
 * 전적 검색 — 브라우저에서 deadlock-api 를 호출해 그린다.
 *
 *   (검색어 없음) 지역별 게임 순위표 (?region=Asia …, 2026-10-05)
 *   ?q=이름      Steam 이름 검색 결과
 *   ?id=계정ID   플레이어: 랭크, 요약, 최근 매치, 영웅별 기록 (전체 / 랭크 / 일반 으로 나눠 보기)
 *   ?match=ID&from=계정ID   매치 상세: 두 팀 12명의 K/D/A·소울·피해·최종 아이템 (from 플레이어 강조)
 *
 * 검색창에 계정 ID(숫자), SteamID64(7656…), 프로필 주소를 넣으면 곧바로 플레이어로 간다.
 * 사용자 이름 등 API 값은 모두 textContent 로만 넣는다 (HTML 로 해석하지 않음).
 */
import type { Dictionary } from '../i18n';
import { parsePlayerInput } from './steam-id';

export interface PlayerPageConfig {
  api: string;
  /** Intl 용 언어 태그 (ko, en, zh-CN) */
  locale: string;
  /** 영웅 상세 링크 앞부분 (/ko/heroes/) */
  heroPath: string;
  heroes: Record<number, { name: string; slug: string; icon?: string }>;
  /** 상점 아이템 (id → 이름·분류·아이콘) — 매치 상세의 최종 아이템 */
  items: Record<number, { name: string; category: 'weapon' | 'vitality' | 'spirit'; icon?: string }>;
  ranks: Record<number, { name: string; icon?: string }>;
  t: Dictionary['players'] & { souls: string };
}

interface SteamProfile {
  account_id: number;
  personaname: string;
  profileurl?: string;
  avatarmedium?: string;
  avatarfull?: string;
}
interface MatchEntry {
  match_id: number;
  hero_id: number;
  hero_level: number;
  start_time: number;
  /** 1 일반 6v6, 4 길거리 난투 */
  game_mode: number;
  /** 1 일반, 2 사설, 3 봇전, 4 랭크, 8 신규 배치 */
  match_mode: number;
  player_team: number;
  match_result: number;
  /** 1 승, 2 패, 3·4 제재, 5 점수 없음. 0 은 판정 기록 이전 매치 */
  player_match_outcome?: number;
  player_kills: number;
  player_deaths: number;
  player_assists: number;
  net_worth: number;
  match_duration_s: number;
  /** 랭크 매치 후 표시 휘장 — 앞자리 단계, 끝자리 하위 등급 (33 = 수행자 3). 0 이면 배치 중 */
  ranked_display_badge?: number | null;
  /** 랭크 진행도 변화 (하위 등급 하나 = 1000) */
  ranked_delta?: number | null;
  ranked_calibration_match?: number | null;
  /** 매치 참가자 평균 휘장 — /v1/matches/metadata 에서 붙인다 (없으면 undefined) */
  avg_badge?: number;
  /** 이 플레이어의 매치 순위 (1 = MVP) — 같은 요청에서 붙인다 */
  mvp_rank?: number;
}
interface MatchMeta {
  match_id: number;
  average_badge?: number | null;
  average_badge_team0?: number | null;
  average_badge_team1?: number | null;
  /** only_filtered_players 라 검색한 플레이어 한 명만 온다 */
  players?: Array<{ account_id: number; mvp_rank?: number | null }>;
}
/** /v1/matches/{id}/metadata 의 match_info 중 쓰는 부분 */
interface MatchDetail {
  match_id: number;
  start_time: number;
  duration_s: number;
  winning_team: number;
  game_mode: number;
  match_mode: number;
  average_badge_team0?: number | null;
  average_badge_team1?: number | null;
  players: Array<{
    account_id: number;
    player_slot: number;
    team: number;
    hero_id: number;
    level: number;
    kills: number;
    deaths: number;
    assists: number;
    net_worth: number;
    last_hits: number;
    denies: number;
    items?: Array<{ item_id: number; game_time_s: number; sold_time_s: number }>;
    /** 매치 전체 순위 1–3 (1 = MVP), 나머지는 null */
    mvp_rank?: number | null;
    /** 시간순 누적 기록 — 마지막 항목이 최종 값 */
    stats?: Array<{
      time_stamp_s: number;
      net_worth?: number;
      player_damage?: number;
      player_damage_taken?: number;
      player_healing?: number;
      boss_damage?: number;
    }>;
    player_match_outcome?: number;
  }>;
}
interface PlayerRank {
  rank?: number;
  subrank?: number;
  last_match?: { start_time?: number; player_rank_final_flat_progress?: number } | null;
}

type Mode = 'all' | 'ranked' | 'unranked' | 'brawl';

/** /v1/leaderboard/{region} — Valve 순위표 (1시간마다 갱신). 이름만 오고 계정은 후보 여러 개일 수 있다 */
interface LeaderboardEntry {
  account_name?: string;
  possible_account_ids?: number[];
  rank: number;
  top_hero_ids?: number[];
}
/** 순위표에서 같은 이름 후보가 이보다 많으면 계정 찾기를 하지 않고 이름 검색으로 (주소가 너무 길어지고 흔한 이름은 맞힐 수 없다) */
const CANDIDATES_MAX = 150;
const REGIONS = ['Asia', 'Europe', 'NAmerica', 'SAmerica', 'Oceania'] as const;
type Region = (typeof REGIONS)[number];
const LB_PAGE = 50;

const PAGE_SIZE = 20;
const HERO_PAGE = 10;
const RANKED = 4;
const UNRANKED = 1;
const NORMAL_GAME = 1;
const STREET_BRAWL = 4;
const ETERNUS = 11;

const configEl = document.getElementById('player-config');
const form = document.querySelector<HTMLFormElement>('[data-player-search]');
const view = document.querySelector<HTMLElement>('[data-player-view]');

if (configEl && form && view) {
  const cfg = JSON.parse(configEl.textContent ?? '{}') as PlayerPageConfig;
  const t = cfg.t;
  const input = form.querySelector<HTMLInputElement>('input[name="q"]')!;
  const nf = new Intl.NumberFormat(cfg.locale, { maximumFractionDigits: 1 });
  const nf0 = new Intl.NumberFormat(cfg.locale, { maximumFractionDigits: 0 });
  const rtf = new Intl.RelativeTimeFormat(cfg.locale, { numeric: 'auto' });
  let request = 0; // 늦게 도착한 이전 요청 결과를 버리기 위한 번호
  /** 매치 평균 랭크 · MVP 를 아직 받는 중이면, 도착했을 때 다시 그릴 칸들 (다 받으면 null). final = 전체(limit 1000)가 왔을 때 */
  let metaPending: Set<(final: boolean) => void> | null = null;
  /** 지금 보고 있는 플레이어 (재시도할지 판단 — A → B → 다시 A 면 처음 A 의 요청도 계속 쓸모 있다) */
  let viewingPlayer: number | undefined;
  /** metadata 응답(include_info 라 매치마다 큼)에서 쓰는 것만 — 캐시에 넣을 크기를 줄인다 */
  const trimMeta = (list: MatchMeta[]): MatchMeta[] =>
    list.map((x) => ({
      match_id: x.match_id,
      average_badge: x.average_badge,
      average_badge_team0: x.average_badge_team0,
      average_badge_team1: x.average_badge_team1,
      players: x.players?.map((p) => ({ account_id: p.account_id, mvp_rank: p.mvp_rank })),
    }));
  /** 매치 기록도 쓰는 칸만 (원본은 매치마다 칸이 많아 3,000판이면 약 100만 자) */
  const trimHistory = (list: MatchEntry[]): MatchEntry[] =>
    list.map((m) => ({
      match_id: m.match_id,
      hero_id: m.hero_id,
      hero_level: m.hero_level,
      start_time: m.start_time,
      game_mode: m.game_mode,
      match_mode: m.match_mode,
      player_team: m.player_team,
      match_result: m.match_result,
      player_match_outcome: m.player_match_outcome,
      player_kills: m.player_kills,
      player_deaths: m.player_deaths,
      player_assists: m.player_assists,
      net_worth: m.net_worth,
      match_duration_s: m.match_duration_s,
      ranked_display_badge: m.ranked_display_badge,
      ranked_delta: m.ranked_delta,
      ranked_calibration_match: m.ranked_calibration_match,
    }));

  // ─── DOM 도우미 ─────────────────────────────────────────────
  type Child = Node | string | number | null | undefined | false;
  function el<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    attrs: Record<string, string | undefined> = {},
    ...children: Child[]
  ): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) if (v !== undefined) node.setAttribute(k, v);
    for (const c of children) if (c !== null && c !== undefined && c !== false) node.append(typeof c === 'number' ? String(c) : c);
    return node;
  }
  const clean = (nodes: Child[]) => nodes.filter((n) => n !== null && n !== undefined && n !== false).map((n) => (typeof n === 'number' ? String(n) : n)) as (Node | string)[];
  const show = (...nodes: Child[]) => view.replaceChildren(...clean(nodes));
  const message = (text: string, tone = 'text-paper-400') => el('p', { class: `py-8 text-center ${tone}` }, text);
  const fill = (s: string, vars: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''));

  /** 404 는 '결과 없음' 으로 본다 (이름 검색은 일치하는 플레이어가 없으면 404) */
  async function get<T>(path: string, empty: T): Promise<T> {
    const res = await fetch(`${cfg.api}${path}`);
    if (res.status === 404) return empty;
    if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
    return (await res.json()) as T;
  }

  /**
   * 같은 플레이어를 다시 열 때(뒤로 가기 · 다른 페이지에서 돌아옴) 몇 분 동안은 받은 결과를 다시 쓴다 (#24).
   * 진행 중인 요청은 메모리에서 함께 기다리고, 끝난 결과는 sessionStorage 에도 둔다 (막히거나 꽉 차면 메모리만).
   * 매치 기록 · 랭크는 1분만 — 내 전적을 방금 끝낸 판까지 보려고 다시 열 때 옛 결과가 보이지 않게
   */
  const CACHE_TTL = 5 * 60_000;
  const FRESH_TTL = 60_000;
  const CACHE_PREFIX = 'dldb:pc:';
  const STORE_MAX = 600_000;
  const memo = new Map<string, { at: number; value: Promise<unknown>; done?: boolean }>();
  function storeRead<T>(path: string, ttl = CACHE_TTL): T | undefined {
    try {
      const raw = sessionStorage.getItem(CACHE_PREFIX + path);
      if (!raw) return undefined;
      const { at, value } = JSON.parse(raw) as { at: number; value: T };
      return Date.now() - at < ttl ? value : undefined;
    } catch {
      return undefined;
    }
  }
  function storeWrite(path: string, value: unknown) {
    const raw = JSON.stringify({ at: Date.now(), value });
    if (raw.length > STORE_MAX) return; // 매치가 아주 많은 사람은 메모리만 (sessionStorage 는 약 500만 자)
    try {
      sessionStorage.setItem(CACHE_PREFIX + path, raw);
    } catch {
      // 꽉 찼으면 우리 것만 비우고 한 번 더
      try {
        for (const k of Object.keys(sessionStorage)) if (k.startsWith(CACHE_PREFIX)) sessionStorage.removeItem(k);
        sessionStorage.setItem(CACHE_PREFIX + path, raw);
      } catch {
        /* 메모리만 */
      }
    }
  }
  /** 이미 받아 둔 결과가 있는지 (받는 중인 것은 아님) */
  const isCached = (path: string) => {
    const hit = memo.get(path);
    return (hit?.done === true && Date.now() - hit.at < CACHE_TTL) || storeRead(path) !== undefined;
  };
  interface CacheOptions<T> {
    trim?: (v: T) => T;
    ttl?: number;
    /**
     * 실패하면 3초 뒤 한 번 더 — 무거운 metadata 요청은 처음에 504 가 났다가 다시 부르면 되는 일이 있다.
     * 5xx · 네트워크 오류이고 이 함수가 true(아직 그 플레이어를 보는 중)일 때만. 429 는 분당 한도라 3초 뒤에도 안 풀린다
     */
    retryIf?: () => boolean;
  }
  function cachedGet<T>(path: string, empty: T, { trim = (v) => v, ttl = CACHE_TTL, retryIf }: CacheOptions<T> = {}): Promise<T> {
    const hit = memo.get(path);
    if (hit && Date.now() - hit.at < ttl) return hit.value as Promise<T>;
    const stored = storeRead<T>(path, ttl);
    const retryable = (e: unknown) => {
      const status = (e as { status?: number }).status;
      return (status === undefined || status >= 500) && retryIf?.() === true;
    };
    const fetched = async (): Promise<T> => {
      try {
        return await get<T>(path, empty);
      } catch (e) {
        if (!retryable(e)) throw e;
        await new Promise((r) => setTimeout(r, 3000));
        if (!retryIf?.()) throw e;
        return get<T>(path, empty);
      }
    };
    const value = stored !== undefined ? Promise.resolve(stored) : fetched().then(trim);
    const entry: { at: number; value: Promise<unknown>; done?: boolean } = { at: Date.now(), value };
    memo.set(path, entry);
    value.then(
      (v) => {
        entry.done = true;
        if (stored === undefined) storeWrite(path, v);
      },
      () => memo.delete(path),
    );
    return value;
  }

  // ─── 공통 조각 ─────────────────────────────────────────────
  function heroIcon(heroId: number, size = 'size-9') {
    const hero = cfg.heroes[heroId];
    const box = `${size} flex-none overflow-hidden rounded-sm bg-ink-800`;
    return hero?.icon
      ? el('img', { src: hero.icon, alt: '', class: `${box} object-cover`, loading: 'lazy', decoding: 'async' })
      : el('span', { class: `${box} grid place-items-center text-2xs font-bold text-paper-400`, 'aria-hidden': 'true' }, hero?.name.slice(0, 1) ?? '?');
  }
  function heroLink(heroId: number, ...children: Child[]) {
    const hero = cfg.heroes[heroId];
    return hero
      ? el('a', { href: `${cfg.heroPath}${hero.slug}/`, class: 'flex min-w-0 items-center gap-2.5 hover:text-brass-200' }, ...children)
      : el('span', { class: 'flex min-w-0 items-center gap-2.5' }, ...children);
  }
  const heroName = (id: number) => cfg.heroes[id]?.name ?? `#${id}`;
  const kdaRatio = (k: number, d: number, a: number) => nf.format((k + a) / Math.max(1, d));
  const percent = (n: number) => `${Math.round(n * 100)}%`;
  function ago(unix: number) {
    const diff = unix - Date.now() / 1000;
    const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
      ['year', 31536000], ['month', 2592000], ['day', 86400], ['hour', 3600], ['minute', 60],
    ];
    for (const [unit, sec] of units) if (Math.abs(diff) >= sec) return rtf.format(Math.round(diff / sec), unit);
    return rtf.format(0, 'minute');
  }
  const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  const panel = (title: string, meta: Child, ...body: Child[]) =>
    el('section', { class: 'panel' }, el('div', { class: 'panel-head' }, el('h2', { class: 'panel-title' }, title), meta), ...body);

  /** 휘장 번호(33) → 단계 3 · 하위 등급 3 */
  const decodeBadge = (badge: number) => ({ tier: Math.floor(badge / 10), sub: badge % 10 });
  /**
   * 휘장 평균 — 번호를 그대로 평균하면 단계 경계(36 → 41)가 어긋나므로
   * 하위 등급 1–6 을 일렬로 편 순번으로 평균한 뒤 휘장 번호로 되돌린다.
   */
  function averageBadge(badges: number[]): number | undefined {
    if (!badges.length) return undefined;
    const idx = badges.map((b) => { const { tier, sub } = decodeBadge(b); return tier * 6 + Math.max(0, sub - 1); });
    const mean = Math.round(idx.reduce((n, i) => n + i, 0) / idx.length);
    return Math.floor(mean / 6) * 10 + (mean % 6) + 1;
  }
  function badgeView(badge: number, icon: string, text = 'text-sm font-semibold text-paper-200') {
    const { tier, sub } = decodeBadge(badge);
    return el('span', { class: 'flex min-w-0 items-center gap-1.5' }, rankIcon(tier, icon), el('span', { class: `truncate ${text}` }, rankLabel(tier, sub)));
  }
  function rankLabel(tier: number, sub?: number) {
    const name = cfg.ranks[tier]?.name ?? `#${tier}`;
    return sub ? `${name} ${sub}` : name;
  }
  function rankIcon(tier: number, size: string) {
    const icon = cfg.ranks[tier]?.icon;
    return icon ? el('img', { src: icon, alt: '', class: `${size} flex-none object-contain`, loading: 'lazy' }) : null;
  }

  // ─── 매치 판정 ─────────────────────────────────────────────
  type Outcome = 'win' | 'loss' | 'penalized' | 'void';
  /**
   * 게임이 기록한 판정을 우선, 없으면 승리 팀과 비교.
   * 0 은 '무효'가 아니라 판정이 기록되기 전(2026-06 이전) 매치라 승리 팀으로 판단한다.
   */
  function outcome(m: MatchEntry): Outcome {
    switch (m.player_match_outcome) {
      case 1: return 'win';
      case 2: return 'loss';
      case 3: case 4: return 'penalized';
      case 5: return 'void';
      default: return m.match_result === m.player_team ? 'win' : 'loss';
    }
  }
  const OUTCOME_TONE: Record<Outcome, { bar: string; text: string }> = {
    win: { bar: 'bg-buff', text: 'text-buff' },
    loss: { bar: 'bg-nerf', text: 'text-nerf' },
    penalized: { bar: 'bg-copper-400', text: 'text-copper-400' },
    void: { bar: 'bg-ink-600', text: 'text-paper-500' },
  };
  const outcomeText = (o: Outcome) => ({ win: t.win, loss: t.loss, penalized: t.penalized, void: t.notScored })[o];
  const isRanked = (m: MatchEntry) => m.match_mode === RANKED;
  const isBrawl = (m: MatchEntry) => m.game_mode === STREET_BRAWL;
  // 길거리 난투는 다른 탭과 겹치지 않게 따로 (2026-10-16 사용자 요청) — '전체' 는 난투를 뺀 나머지
  const inMode = (m: MatchEntry, mode: Mode) =>
    mode === 'brawl'
      ? isBrawl(m)
      : !isBrawl(m) && (mode === 'all' || (mode === 'ranked' ? isRanked(m) : m.match_mode === UNRANKED && m.game_mode === NORMAL_GAME));
  function modeText(m: MatchEntry) {
    if (m.game_mode === STREET_BRAWL) return t.modeBrawl;
    if (isRanked(m)) return t.modeRanked;
    if (m.match_mode === UNRANKED) return t.modeUnranked;
    return t.modeOther;
  }

  // ─── 검색 결과 ─────────────────────────────────────────────
  async function renderSearch(query: string) {
    const my = ++request;
    show(message(t.loading));
    try {
      const list = await get<SteamProfile[]>(`/v1/players/steam-search?search_query=${encodeURIComponent(query)}&limit=24`, []);
      if (my !== request) return;
      if (!list.length) return show(message(t.noResults));
      show(
        el('h2', { class: 'mb-3 text-sm font-semibold text-paper-400' }, t.results),
        el(
          'ul',
          { class: 'grid gap-2 sm:grid-cols-2 lg:grid-cols-3' },
          ...list.map((p) =>
            el(
              'li',
              {},
              el(
                'a',
                { href: `?id=${p.account_id}`, 'data-nav': '', class: 'flex items-center gap-3 rounded-md bg-ink-900 p-2.5 ring-1 ring-line transition-colors duration-150 ring-inset hover:bg-ink-850' },
                p.avatarmedium ? el('img', { src: p.avatarmedium, alt: '', class: 'size-11 flex-none rounded-sm', loading: 'lazy' }) : null,
                el(
                  'span',
                  { class: 'min-w-0' },
                  el('span', { class: 'block truncate font-semibold text-paper-50' }, p.personaname),
                  el('span', { class: 'block text-xs text-paper-500 tabular-nums' }, `ID ${p.account_id}`),
                ),
              ),
            ),
          ),
        ),
      );
    } catch {
      if (my === request) show(message(t.error, 'text-nerf'));
    }
  }

  // ─── 순위표 (검색어 없이 들어왔을 때) ─────────────────────────
  // 한 화면에 50명, 넓은 화면은 두 단. 이름·주 영웅만 — 휘장은 순위표에 없고, 플레이어마다 따로 부르면 무거워진다
  const lbCache = new Map<Region, Promise<LeaderboardEntry[]>>();
  async function renderLeaderboard(region: Region) {
    const my = ++request;
    let shown = LB_PAGE;
    const regionButtons = REGIONS.map((r) => {
      const b = el('button', { type: 'button', 'aria-pressed': String(r === region) }, t[`region${r}`]);
      b.addEventListener('click', () => {
        if (r === region) return;
        history.replaceState(null, '', `${location.pathname}?region=${r}`);
        void renderLeaderboard(r);
      });
      return b;
    });
    const body = el('div', {}, message(t.loading));
    show(
      panel(
        t.lbTitle,
        el('span', { class: 'ml-auto text-xs text-paper-500' }, t.lbMeta),
        el(
          'div',
          { class: 'flex flex-wrap items-center gap-2 px-4 pt-3' },
          el('div', { role: 'group', 'aria-label': t.lbRegion, class: 'seg max-w-full max-sm:flex-wrap' }, ...regionButtons),
        ),
        body,
      ),
      el('p', { class: 'mt-3 max-w-3xl text-xs text-paper-400' }, t.lbNote),
    );

    let pending = lbCache.get(region);
    if (!pending) {
      pending = get<{ entries?: LeaderboardEntry[] }>(`/v1/leaderboard/${region}`, {}).then((r) => r.entries ?? []);
      pending.catch(() => lbCache.delete(region));
      lbCache.set(region, pending);
    }
    let entries: LeaderboardEntry[];
    try {
      entries = await pending;
    } catch {
      if (my === request) body.replaceChildren(message(t.error, 'text-nerf'));
      return;
    }
    if (my !== request) return;

    const row = (e: LeaderboardEntry) => {
      const ids = e.possible_account_ids ?? [];
      const name = e.account_name || '—';
      const href = ids.length === 1 ? `?id=${ids[0]}` : `?q=${encodeURIComponent(name)}`;
      // 같은 이름 계정이 여럿이면(아시아 639명 중 234명) 누를 때 그중 상위 랭크 판을 한 계정을 찾아 바로 전적으로 (2026-10-16 사용자 지적 —
      // 예전엔 이름 검색으로 넘어갔다). 후보가 너무 많으면(흔한 이름) 이름 검색 그대로
      const candidates = ids.length > 1 && ids.length <= CANDIDATES_MAX ? { 'data-candidates': ids.join(',') } : {};
      return el(
        'li',
        { class: 'break-inside-avoid border-b border-line' },
        el(
          'a',
          { href, 'data-nav': '', ...candidates, class: 'flex items-center gap-3 px-4 py-2 transition-colors duration-150 hover:bg-ink-800 aria-busy:opacity-50' },
          el('span', { class: `w-9 flex-none text-right text-sm font-bold tabular-nums ${e.rank <= 3 ? 'text-brass-400' : 'text-paper-400'}` }, e.rank),
          // 주 영웅 아이콘 칸은 뺐다 (2026-10-16) — API 가 top_hero_ids 를 빈 값으로 줘서 빈 칸 · 회색 네모만 보였다
          el('span', { class: 'min-w-0 flex-1 truncate text-sm font-semibold text-paper-100' }, name),
        ),
      );
    };
    const draw = () => {
      const list = entries;
      if (!list.length) return body.replaceChildren(message(t.lbEmpty));
      const more = el('button', { type: 'button', class: 'mx-auto mt-3 block rounded-md bg-ink-850 px-4 py-1.5 text-sm font-semibold text-paper-200 hover:bg-ink-800' }, t.more);
      more.addEventListener('click', () => {
        shown += LB_PAGE;
        draw();
      });
      body.replaceChildren(
        ...clean([
        el('ol', { class: 'mt-2 lg:columns-2 lg:gap-0' }, ...list.slice(0, shown).map(row)),
        shown < list.length ? more : null,
        el('div', { class: 'h-3' }),
        ]),
      );
    };
    draw();
  }

  // ─── 플레이어 ──────────────────────────────────────────────
  async function renderPlayer(id: number) {
    const my = ++request;
    viewingPlayer = id;
    show(message(t.loading));
    // 나눠 그린다 (#24): 프로필 · 랭크(0.5초) → 머리, 매치 기록(처음엔 Steam 에서 받아 9초쯤) → 요약 · 목록.
    // 매치 평균 랭크 · MVP(metadata)는 장식이라 화면을 막지 않고 뒤에서 채운다 — limit=1000 은 19초쯤 걸려(2026-10-29 측정)
    // 첫 50판을 따로 먼저 받아 보이는 줄부터 채우고, 전체(요약의 평균 매치 랭크)는 이어서. 이 주소는 IP 당 분당 30회
    const steamP = cachedGet<SteamProfile[]>(`/v1/players/steam?account_ids=${id}`, []);
    const rankP = cachedGet<PlayerRank>(`/v1/players/${id}/rank`, {}, { ttl: FRESH_TTL });
    const historyP = cachedGet<MatchEntry[]>(`/v1/players/${id}/match-history`, [], { trim: trimHistory, ttl: FRESH_TTL });
    const metaUrl = (limit: number) =>
      `/v1/matches/metadata?account_ids=${id}&include_info=true&extra_player_columns=mvp_rank&only_filtered_players=true&limit=${limit}&game_mode=normal&match_mode=ranked,unranked`;
    const metaAllCached = isCached(metaUrl(1000));
    const metaAll = cachedGet<MatchMeta[]>(metaUrl(1000), [], { trim: trimMeta, retryIf: () => viewingPlayer === id });
    const metaFirst = metaAllCached ? metaAll : cachedGet<MatchMeta[]>(metaUrl(50), [], { trim: trimMeta });
    // 전체를 이미 받아 뒀으면(다시 연 플레이어) 그리기 전에 채우므로 기다릴 칸이 없다
    const listeners = new Set<(final: boolean) => void>();
    metaPending = metaAllCached ? null : listeners;
    const metaDone = () => {
      if (metaPending === listeners) metaPending = null;
    };

    const [steam, rank] = await Promise.allSettled([steamP, rankP]);
    if (my !== request) return;
    const profile = steam.status === 'fulfilled' ? steam.value[0] : undefined;
    // 랭크 매치 기록이 없으면 { rank: 0, last_match: null } 이 온다 → 랭크 없음
    const r = rank.status === 'fulfilled' && rank.value.last_match ? rank.value : undefined;
    const list = el('div', { class: 'space-y-4' }, message(t.historyLoading));
    show(
      el('p', { class: 'mb-3' }, el('a', { href: '?', 'data-nav': '', class: 'text-sm text-paper-400 hover:text-paper-50' }, `← ${t.back}`)),
      el('div', { class: 'space-y-4' }, renderHeader(id, profile, r), list),
    );

    let history: MatchEntry[];
    try {
      history = await historyP;
    } catch {
      // 매치 기록을 못 받았으면 '0판' 이 아니라 오류로 (429 · 5xx 때 기록이 없는 사람처럼 보였다)
      if (my === request) list.replaceChildren(message(t.error, 'text-nerf'));
      return;
    }
    if (my !== request) return;
    const matches = [...history].sort((a, b) => b.start_time - a.start_time);
    const applyMeta = (meta: MatchMeta[], final: boolean) => {
      if (my !== request) return;
      const byMatch = new Map(meta.map((x) => [x.match_id, x]));
      for (const m of matches) {
        const x = byMatch.get(m.match_id);
        if (!x) continue;
        const teams = [x.average_badge_team0, x.average_badge_team1].filter((b): b is number => Boolean(b));
        m.avg_badge = x.average_badge || averageBadge(teams);
        m.mvp_rank = x.players?.find((p) => p.account_id === id)?.mvp_rank ?? undefined;
      }
      listeners.forEach((update) => update(final));
      if (final) metaDone();
    };
    // 실패(429 · 5xx)하면 평균 랭크 칸만 빈다
    if (metaAllCached) {
      applyMeta(await metaAll.catch(() => []), true);
      if (my !== request) return;
    } else {
      void metaFirst.then((meta) => applyMeta(meta, false), () => undefined);
      void metaAll.then((meta) => applyMeta(meta, true), metaDone);
    }

    const body = el('div', { class: 'space-y-4' });
    let mode: Mode = 'all';
    const counts: Record<Mode, number> = {
      all: matches.filter((m) => inMode(m, 'all')).length,
      ranked: matches.filter((m) => inMode(m, 'ranked')).length,
      unranked: matches.filter((m) => inMode(m, 'unranked')).length,
      brawl: matches.filter((m) => inMode(m, 'brawl')).length,
    };
    // 난투 탭은 난투 기록이 있을 때만
    const modes = (['all', 'ranked', 'unranked', 'brawl'] as const).filter((m) => m !== 'brawl' || counts.brawl > 0);
    const modeButtons = modes.map((m) => {
      const b = el(
        'button',
        { type: 'button', 'aria-pressed': String(m === mode) },
        { all: t.modeAll, ranked: t.modeRanked, unranked: t.modeUnranked, brawl: t.modeBrawl }[m],
        el('span', { class: 'ml-1.5 text-xs text-paper-500 tabular-nums' }, nf.format(counts[m])),
      );
      b.addEventListener('click', () => {
        mode = m;
        modeButtons.forEach((o, i) => o.setAttribute('aria-pressed', String(modes[i] === m)));
        body.replaceChildren(...clean(renderStats(matches.filter((x) => inMode(x, mode)), id, mode)));
      });
      return b;
    });

    list.replaceChildren(
      el(
        'div',
        { class: 'flex flex-wrap items-center gap-x-4 gap-y-2' },
        // 난투 탭까지 넷이면 375px 보다 길다 → 모바일은 줄바꿈 (옆으로 숨으면 마지막 탭이 없는 줄 안다)
        el('div', { role: 'group', 'aria-label': t.modeFilter, class: 'seg max-sm:flex-wrap' }, ...modeButtons),
        // 공식 기록이 아님을 결과 바로 위에 (2026-10-09 사용자 요청 — 페이지 맨 아래 안내는 안 보였다)
        el('p', { class: 'text-xs text-paper-200', title: t.partialTip }, t.partialNote),
      ),
      body,
    );
    body.replaceChildren(...clean(renderStats(matches.filter((x) => inMode(x, 'all')), id, 'all')));
  }

  /** 머리: 아바타·이름·Steam 링크 | 현재 랭크 (진행도·마지막 랭크 매치) */
  function renderHeader(id: number, profile: SteamProfile | undefined, r: PlayerRank | undefined) {
    const progress = r?.last_match?.player_rank_final_flat_progress;
    const showBar = r?.rank !== undefined && r.rank !== ETERNUS && progress !== undefined;
    const pct = showBar ? (progress! % 1000) / 1000 : 0;
    const rankBlock = el(
      'div',
      { class: 'flex items-center gap-3' },
      r?.rank !== undefined ? rankIcon(r.rank, 'size-16') : null,
      el(
        'div',
        { class: 'min-w-44' },
        el('p', { class: 'text-xs text-paper-500' }, t.rankLabel),
        el('p', { class: 'text-xl font-bold' }, r?.rank !== undefined ? rankLabel(r.rank, r.subrank) : t.unranked),
        showBar
          ? el(
              'div',
              { class: 'mt-1.5' },
              el('div', { class: 'h-1.5 overflow-hidden rounded-full bg-ink-700' }, el('div', { class: 'h-full rounded-full bg-brass-400', style: `width:${Math.round(pct * 100)}%` })),
              el('p', { class: 'mt-1 text-2xs text-paper-500 tabular-nums' }, fill(t.rankProgress, { n: nf0.format(progress! % 1000) })),
            )
          : null,
        r?.last_match?.start_time ? el('p', { class: 'text-2xs text-paper-500' }, fill(t.lastRanked, { when: ago(r.last_match.start_time) })) : null,
      ),
    );
    return el(
      'header',
      { class: 'panel flex flex-wrap items-center gap-x-8 gap-y-4 p-5' },
      el(
        'div',
        // 좁은 화면에선 랭크 칸이 아래 줄로 내려가게 (한 줄에 밀어 넣으면 ID·프로필 링크가 찌그러졌다)
        { class: 'flex min-w-0 flex-[1_1_16rem] items-center gap-4' },
        profile?.avatarfull ? el('img', { src: profile.avatarfull, alt: '', class: 'size-16 flex-none rounded-md' }) : null,
        el(
          'div',
          { class: 'min-w-0' },
          el('h2', { class: 'truncate text-2xl font-extrabold tracking-tight' }, profile?.personaname ?? `ID ${id}`),
          el(
            'p',
            { class: 'mt-0.5 flex flex-wrap gap-x-3 text-xs text-paper-500 tabular-nums' },
            profile ? `ID ${id}` : null,
            /^https:\/\/steamcommunity\.com\//.test(profile?.profileurl ?? '') ? el('a', { href: profile!.profileurl, target: '_blank', rel: 'noopener noreferrer', class: 'text-brass-400 hover:text-brass-200' }, `${t.steamProfile} ↗`) : null,
          ),
        ),
      ),
      rankBlock,
    );
  }

  /** 선택한 종류의 매치로 요약·최근 매치·영웅별 기록을 만든다 */
  function renderStats(matches: MatchEntry[], playerId: number, mode: Mode): Child[] {
    const scored = matches.filter((m) => ['win', 'loss'].includes(outcome(m)));
    const wins = scored.filter((m) => outcome(m) === 'win').length;
    const sum = (k: 'player_kills' | 'player_deaths' | 'player_assists') => matches.reduce((n, m) => n + m[k], 0);
    const stat = (label: string, value: string, sub?: string) =>
      el(
        'div',
        { class: 'rounded-md bg-ink-900 px-4 py-3 ring-1 ring-line ring-inset' },
        el('p', { class: 'text-xs text-paper-500' }, label),
        el('p', { class: 'mt-0.5 text-2xl font-bold tracking-tight tabular-nums' }, value),
        sub ? el('p', { class: 'text-xs text-paper-400 tabular-nums' }, sub) : null,
      );
    // 매치 평균 랭크 — 진짜 랭크와 헷갈리지 않게 (2026-10-16 사용자): 전체 · 일반 탭은 '일반 MMR(추정)' = 일반 매치만의 평균,
    // 랭크 탭은 '랭크 매치 평균'. 난투는 평균 랭크가 없어 칸을 뺀다
    const avgFrom = mode === 'ranked' ? matches : matches.filter((m) => inMode(m, 'unranked'));
    const avgTileFor = () => {
      const avgBadges = avgFrom.map((m) => m.avg_badge).filter((b): b is number => Boolean(b));
      const avg = averageBadge(avgBadges);
      return el(
        'div',
        { class: 'rounded-md bg-ink-900 px-4 py-3 ring-1 ring-line ring-inset', title: mode === 'ranked' ? t.avgRankedHint : t.normalMmrHint },
        el('p', { class: 'text-xs text-paper-500' }, mode === 'ranked' ? t.avgRanked : t.normalMmr),
        avg ? el('div', { class: 'mt-1' }, badgeView(avg, 'size-8', 'text-lg font-bold tracking-tight')) : el('p', { class: 'mt-1 flex h-8 items-center text-2xl font-bold' }, '–'),
        // 뒤늦게 채워져도 칸 높이가 그대로이게 빈 줄을 둔다
        el('p', { class: 'text-xs text-paper-400 tabular-nums' }, avg ? fill(t.avgRankCount, { n: avgBadges.length }) : ' '),
      );
    };
    let avgTile = mode === 'brawl' ? null : avgTileFor();
    if (avgTile)
      // 요약은 전체가 왔을 때만 — 첫 50판 평균을 먼저 보이면 값이 크게 바뀌어(수행자 6 → 전령사 4) 헷갈린다
      metaPending?.add((final) => {
        if (!final) return;
        const next = avgTileFor();
        avgTile!.replaceWith(next);
        avgTile = next;
      });
    const summary = matches.length
      ? el(
          'div',
          { class: `grid grid-cols-2 gap-2 ${avgTile ? 'sm:grid-cols-4' : 'sm:grid-cols-3'}` },
          avgTile,
          stat(t.matches, nf.format(matches.length)),
          stat(t.winRate, scored.length ? percent(wins / scored.length) : '–', fill(t.record, { w: wins, l: scored.length - wins })),
          stat(
            t.kda,
            kdaRatio(sum('player_kills'), sum('player_deaths'), sum('player_assists')),
            `${nf.format(sum('player_kills') / matches.length)} / ${nf.format(sum('player_deaths') / matches.length)} / ${nf.format(sum('player_assists') / matches.length)}`,
          ),
        )
      : null;

    // 최근 매치
    const matchList = el('ul', { class: 'divide-y divide-line' });
    let shown = 0;
    const moreMatches = el('button', { type: 'button', class: 'w-full py-3 text-sm font-semibold text-brass-400 hover:text-brass-200' }, t.more);
    const showMoreMatches = () => {
      matchList.append(...matches.slice(shown, shown + PAGE_SIZE).map((m) => matchRow(m, playerId)));
      shown += PAGE_SIZE;
      moreMatches.hidden = shown >= matches.length;
    };
    moreMatches.addEventListener('click', showMoreMatches);
    showMoreMatches();

    // 영웅별 기록 — 같은 매치 목록에서 계산해 위 요약과 항상 맞는다
    const byHero = new Map<number, { hero: number; n: number; w: number; scored: number; k: number; d: number; a: number }>();
    for (const m of matches) {
      const s = byHero.get(m.hero_id) ?? { hero: m.hero_id, n: 0, w: 0, scored: 0, k: 0, d: 0, a: 0 };
      const o = outcome(m);
      s.n++;
      if (o === 'win') s.w++;
      if (o === 'win' || o === 'loss') s.scored++;
      s.k += m.player_kills;
      s.d += m.player_deaths;
      s.a += m.player_assists;
      byHero.set(m.hero_id, s);
    }
    const heroes = [...byHero.values()].sort((a, b) => b.n - a.n);
    const heroList = el('ul', { class: 'divide-y divide-line' });
    const heroRow = (s: (typeof heroes)[number]) =>
      el(
        'li',
        { class: 'flex items-center gap-3 px-4 py-2.5' },
        el('span', { class: 'min-w-0 flex-1' }, heroLink(s.hero, heroIcon(s.hero, 'size-8'), el('span', { class: 'min-w-0' }, el('span', { class: 'block truncate text-sm font-semibold' }, heroName(s.hero)), el('span', { class: 'block text-2xs text-paper-500 tabular-nums' }, `${nf.format(s.n)} ${t.matches}`)))),
        el(
          'span',
          { class: 'w-16 text-right' },
          el('span', { class: 'block text-sm font-semibold tabular-nums' }, s.scored ? percent(s.w / s.scored) : '–'),
          el('span', { class: 'block text-2xs text-paper-500 tabular-nums' }, fill(t.record, { w: s.w, l: s.scored - s.w })),
        ),
        el('span', { class: 'w-12 text-right text-sm text-paper-200 tabular-nums' }, kdaRatio(s.k, s.d, s.a)),
      );
    let heroShown = 0;
    const moreHeroes = el('button', { type: 'button', class: 'w-full py-3 text-sm font-semibold text-brass-400 hover:text-brass-200' }, t.more);
    const showMoreHeroes = () => {
      heroList.append(...heroes.slice(heroShown, heroShown + HERO_PAGE).map(heroRow));
      heroShown += HERO_PAGE;
      moreHeroes.hidden = heroShown >= heroes.length;
    };
    moreHeroes.addEventListener('click', showMoreHeroes);
    showMoreHeroes();

    return [
      summary,
      el(
        'div',
        { class: 'grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]' },
        panel(t.recent, el('span', { class: 'ml-auto text-xs text-paper-500 tabular-nums' }, nf.format(matches.length)), matches.length ? matchList : message(t.empty), matches.length ? moreMatches : null),
        panel(t.heroStats, el('span', { class: 'ml-auto flex gap-9 text-2xs text-paper-500' }, el('span', {}, t.winRate), el('span', {}, t.kda)), heroes.length ? heroList : message(t.empty), heroes.length ? moreHeroes : null),
      ),
    ];
  }

  /** 매치 한 줄 (누르면 매치 상세): 결과 띠 · 영웅 · 결과 · K/D/A · 소울 · 평균 랭크/종류 · 시간 */
  function matchRow(m: MatchEntry, playerId: number) {
    const o = outcome(m);
    const tone = OUTCOME_TONE[o];
    // 랭크 칸: 매치 평균 랭크 + 아래 줄에 종류 (랭크 매치는 진행도 변화 · 배치)
    let note: Child = el('span', { class: 'text-2xs text-paper-500' }, modeText(m));
    if (isRanked(m)) {
      const calibrating = Boolean(m.ranked_calibration_match) || !m.ranked_display_badge;
      const delta = m.ranked_delta ?? 0;
      note = el(
        'span',
        { class: 'flex gap-1.5 text-2xs' },
        el('span', { class: 'font-semibold text-brass-400' }, t.modeRanked),
        calibrating
          ? el('span', { class: 'text-paper-400' }, t.calibration)
          : delta
            ? // 실제 점수 그대로 (하위 등급 하나 = 1000). 예전엔 % 로 바꿔 보였다(300 → 30%) — 2026-10-08 사용자: 진짜 점수대로
              el('span', { class: `tabular-nums ${delta > 0 ? 'text-buff' : 'text-nerf'}`, title: t.rankChange }, `${delta > 0 ? '▲' : '▼'} ${nf0.format(Math.abs(delta))}`)
            : null,
      );
    }
    // 휘장: 랭크 매치는 그 판 뒤 '이 플레이어의' 랭크, 그 밖(일반 · 배치 중)은 매치 참가자 평균 랭크 (2026-10-16 사용자 지적 —
    // 랭크 매치에도 평균을 보여 줘서, 불멸자 1 인 1위 줄에 예지자 · 초월자가 찍혀 본인 랭크처럼 보였다)
    const own = isRanked(m) && m.ranked_display_badge ? m.ranked_display_badge : undefined;
    // 평균 랭크가 붙을 수 있는 매치(일반 6v6 의 랭크 · 일반)는 값이 없어도 휘장 줄 자리를 둔다 — 뒤늦게 채워지거나
    // 탭을 바꿔 다시 그려도 줄 높이가 같게 (#24). 본인 휘장이 있는 랭크 매치는 처음부터 휘장이 있다
    const reserved = !own && m.game_mode === NORMAL_GAME && [RANKED, UNRANKED].includes(m.match_mode);
    const rankCellFor = () => {
      const shown = own ?? m.avg_badge;
      const avgText = m.avg_badge ? rankLabel(decodeBadge(m.avg_badge).tier, decodeBadge(m.avg_badge).sub) : '';
      return el(
        'span',
        { class: 'min-w-0 leading-tight', title: own ? (avgText ? fill(t.ownRankHint, { avg: avgText }) : t.ownRankOnly) : m.avg_badge ? t.avgRankHint : undefined },
        shown ? badgeView(shown, 'size-6', 'text-xs font-semibold text-paper-200') : reserved ? el('span', { class: 'block h-6', 'aria-hidden': 'true' }) : null,
        el('span', { class: shown ? 'mt-0.5 block pl-7.5' : reserved ? 'mt-0.5 block' : 'block' }, note),
      );
    };
    let rankCell = rankCellFor();
    const nameLine = el('span', { class: 'flex min-w-0 items-center gap-1.5' }, el('span', { class: 'truncate text-sm font-semibold' }, heroName(m.hero_id)), mvpStar(m.mvp_rank));
    metaPending?.add(() => {
      if (!own) {
        const next = rankCellFor();
        rankCell.replaceWith(next);
        rankCell = next;
      }
      const star = mvpStar(m.mvp_rank);
      if (star && nameLine.childElementCount === 1) nameLine.append(star);
    });
    const row = el(
      'button',
      {
        type: 'button',
        title: t.showMatch,
        class: 'grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 px-4 py-2.5 text-left transition-colors duration-150 hover:bg-ink-850 aria-expanded:bg-ink-850 sm:grid-cols-[minmax(0,1.3fr)_4rem_7.5rem_5.5rem_8rem_3.5rem]',
      },
      el(
        'span',
        { class: 'flex min-w-0 items-center gap-2.5' },
        el('span', { class: `h-9 w-1 flex-none rounded-full ${tone.bar}`, 'aria-hidden': 'true' }),
        heroIcon(m.hero_id),
        el(
          'span',
          { class: 'min-w-0' },
          nameLine,
          el('span', { class: 'block text-xs text-paper-500' }, ago(m.start_time)),
        ),
      ),
      el('span', { class: `text-right text-sm font-bold sm:text-left ${tone.text}` }, outcomeText(o)),
      el(
        'span',
        { class: 'text-sm tabular-nums' },
        `${m.player_kills} / `,
        el('span', { class: 'text-nerf' }, m.player_deaths),
        ` / ${m.player_assists}`,
        el('span', { class: 'ml-1.5 text-xs text-paper-500' }, kdaRatio(m.player_kills, m.player_deaths, m.player_assists)),
      ),
      el('span', { class: 'text-right text-sm text-paper-200 tabular-nums sm:text-left' }, `${nf.format(m.net_worth)} `, el('span', { class: 'text-xs text-paper-500' }, t.souls)),
      rankCell,
      el('span', { class: 'text-right text-sm text-paper-400 tabular-nums sm:text-left' }, clock(m.match_duration_s)),
    );
    // 누르면 이 줄 아래로 매치 상세가 펼쳐진다 (다시 누르면 접힘)
    const region = el('div', { class: 'border-t border-line bg-ink-950/60 p-3' });
    expandable(row, region, async () => matchView(await loadMatch(m.match_id), playerId));
    return el('li', {}, row, region);
  }

  // ─── 매치 상세 (펼치기) ─────────────────────────────────────
  // 매치 줄을 누르면 그 아래에 두 팀이 펼쳐지고, 그 안에서 플레이어를 누르면
  // 그 플레이어의 이 매치 기록(구매 순서·피해 등)이 다시 펼쳐진다. 전적으로 가는 건 그 안의 이름 링크.
  type MatchPlayer = MatchDetail['players'][number];
  interface LoadedMatch {
    detail: MatchDetail;
    names: Map<number, string>;
  }
  const itemTone = { weapon: 'ring-weapon/60', vitality: 'ring-vitality/60', spirit: 'ring-spirit/60' } as const;
  const dateFmt = new Intl.DateTimeFormat(cfg.locale, { dateStyle: 'medium', timeStyle: 'short' });
  /** 같은 매치를 다시 펼칠 때 다시 받지 않는다 (응답이 약 1.4MB) */
  const matchCache = new Map<number, Promise<LoadedMatch>>();

  function loadMatch(matchId: number): Promise<LoadedMatch> {
    let pendingMatch = matchCache.get(matchId);
    if (!pendingMatch) {
      pendingMatch = (async () => {
        const detail = (await get<{ match_info?: MatchDetail }>(`/v1/matches/${matchId}/metadata`, {})).match_info;
        if (!detail) throw new Error('empty');
        // 12명 이름을 한 번에 (봇·익명은 account_id 0)
        const ids = [...new Set(detail.players.map((p) => p.account_id).filter(Boolean))];
        const names = new Map<number, string>();
        try {
          const profiles = await get<SteamProfile[]>(`/v1/players/steam?account_ids=${ids.join(',')}`, []);
          for (const p of profiles) names.set(p.account_id, p.personaname);
        } catch {
          /* 이름 없이 표시 */
        }
        return { detail, names };
      })();
      // 실패한 요청은 다음에 다시 시도할 수 있게 지운다
      pendingMatch.catch(() => matchCache.delete(matchId));
      matchCache.set(matchId, pendingMatch);
    }
    return pendingMatch;
  }

  /** 팔지 않고 끝까지 가진 상점 아이템 (구매 순서). 능력 강화 기록은 빠진다 */
  function finalItems(p: MatchPlayer) {
    const seen = new Set<number>();
    return (p.items ?? [])
      .filter((i) => !i.sold_time_s && cfg.items[i.item_id])
      .sort((a, b) => a.game_time_s - b.game_time_s)
      .filter((i) => !seen.has(i.item_id) && seen.add(i.item_id))
      .map((i) => i.item_id);
  }
  const lastStat = (p: MatchPlayer) => [...(p.stats ?? [])].sort((a, b) => b.time_stamp_s - a.time_stamp_s)[0];

  /** MVP(매치 1위) 별 — 마우스를 올리면 'MVP' */
  const mvpStar = (rank: number | null | undefined) =>
    rank === 1 ? el('span', { title: t.mvp, 'aria-label': t.mvp, role: 'img', class: 'flex-none text-sm leading-none text-brass-400' }, '★') : null;

  function itemIcon(id: number, size: string, dim = false) {
    const it = cfg.items[id];
    const cls = `${size} flex-none rounded-sm ring-1 ring-inset ${itemTone[it.category]} ${dim ? 'opacity-40 grayscale' : ''}`;
    return it.icon
      ? el('img', { src: it.icon, alt: it.name, title: it.name, loading: 'lazy', class: cls })
      : el('span', { title: it.name, class: `grid place-items-center bg-ink-800 text-2xs ${cls}` }, it.name.slice(0, 2));
  }

  /**
   * 펼침 토글 — 버튼 아래 영역을 처음 열 때만 content() 로 채운다.
   * 버튼과 영역은 aria-expanded / aria-controls 로 연결.
   */
  let panelSeq = 0;
  function expandable(button: HTMLButtonElement, region: HTMLElement, content: () => Promise<Node> | Node) {
    const regionId = `expand-${++panelSeq}`;
    region.id = regionId;
    region.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-controls', regionId);
    let filled = false;
    button.addEventListener('click', async () => {
      const open = button.getAttribute('aria-expanded') !== 'true';
      button.setAttribute('aria-expanded', String(open));
      region.hidden = !open;
      if (!open || filled) return;
      filled = true;
      region.replaceChildren(message(t.loading));
      try {
        region.replaceChildren(await content());
      } catch {
        filled = false; // 실패하면 다음에 다시 시도
        region.replaceChildren(message(t.matchError, 'text-nerf'));
      }
    });
  }

  /** 한 플레이어의 이 매치 기록: 이름(→ 전적) · 주요 수치 · 아이템 구매 순서 */
  function playerDetail(p: MatchPlayer, names: Map<number, string>) {
    const stat = lastStat(p);
    const name = names.get(p.account_id);
    const figure = (label: string, value: number | undefined) =>
      el(
        'div',
        { class: 'rounded-md bg-ink-900 px-3 py-2' },
        el('p', { class: 'text-2xs text-paper-500' }, label),
        el('p', { class: 'text-sm font-semibold tabular-nums' }, value !== undefined ? nf.format(value) : '–'),
      );
    const purchases = (p.items ?? []).filter((i) => cfg.items[i.item_id]).sort((a, b) => a.game_time_s - b.game_time_s);
    return el(
      'div',
      { class: 'space-y-3 px-4 pt-1 pb-4 sm:pl-16' },
      el(
        'p',
        { class: 'flex flex-wrap items-baseline gap-x-3 gap-y-1' },
        p.account_id
          ? el('a', { href: `?id=${p.account_id}`, 'data-nav': '', class: 'text-base font-bold text-brass-400 hover:text-brass-200' }, `${name ?? `ID ${p.account_id}`} · ${t.viewProfile} →`)
          : el('span', { class: 'text-base font-bold text-paper-400' }, '—'),
        mvpStar(p.mvp_rank),
        el('span', { class: 'text-xs text-paper-500' }, `${heroName(p.hero_id)} · ${t.level} ${p.level}`),
      ),
      el(
        'div',
        { class: 'grid grid-cols-3 gap-1.5 sm:grid-cols-6' },
        figure(t.damage, stat?.player_damage),
        figure(t.damageTaken, stat?.player_damage_taken),
        figure(t.healing, stat?.player_healing),
        figure(t.bossDamage, stat?.boss_damage),
        figure(t.lastHits, p.last_hits),
        figure(t.denies, p.denies),
      ),
      el(
        'div',
        {},
        el('p', { class: 'mb-1.5 text-xs font-semibold text-paper-400' }, t.purchaseOrder),
        purchases.length
          ? el(
              'ol',
              { class: 'grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-1.5' },
              ...purchases.map((i) => {
                const sold = Boolean(i.sold_time_s);
                return el(
                  'li',
                  { class: 'flex items-center gap-2 rounded-md bg-ink-900 px-2 py-1.5' },
                  el('span', { class: 'w-10 flex-none text-xs text-paper-500 tabular-nums' }, clock(i.game_time_s)),
                  itemIcon(i.item_id, 'size-7', sold),
                  el(
                    'span',
                    { class: 'min-w-0 leading-tight' },
                    el('span', { class: `block truncate text-xs font-semibold ${sold ? 'text-paper-500 line-through' : 'text-paper-200'}` }, cfg.items[i.item_id].name),
                    sold ? el('span', { class: 'block text-2xs text-paper-500 tabular-nums' }, fill(t.sold, { t: clock(i.sold_time_s) })) : null,
                  ),
                );
              }),
            )
          : el('p', { class: 'text-sm text-paper-500' }, '–'),
      ),
    );
  }

  /**
   * 팀 소울 차이 — 기록 시점(약 3분마다)의 팀 1 − 팀 2 소울 합. 위 = 팀 1 앞섬, 아래 = 팀 2 앞섬.
   * 선은 늘어나는 SVG(non-scaling-stroke), 점·글씨는 HTML 이라 화면 폭과 상관없이 같은 크기. 점에 마우스를 올리면 시각·차이.
   */
  function soulGraph(detail: MatchDetail): Node | null {
    const at = new Map<number, [number, number]>([[0, [0, 0]]]);
    for (const p of detail.players) {
      for (const s of p.stats ?? []) {
        const sums = at.get(s.time_stamp_s) ?? [0, 0];
        sums[p.team === 0 ? 0 : 1] += s.net_worth ?? 0;
        at.set(s.time_stamp_s, sums);
      }
    }
    const points = [...at.entries()].sort((a, b) => a[0] - b[0]).map(([ts, [a, b]]) => ({ ts, diff: a - b }));
    if (points.length < 3) return null;
    const end = points[points.length - 1].ts || 1;
    const max = Math.max(1000, ...points.map((p) => Math.abs(p.diff)));
    const x = (ts: number) => (ts / end) * 100;
    const y = (d: number) => 50 - (d / max) * 46;
    const line = points.map((p) => `${x(p.ts).toFixed(2)},${y(p.diff).toFixed(2)}`).join(' ');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('class', 'absolute inset-0 size-full overflow-visible');
    svg.innerHTML = `<line x1="0" x2="100" y1="50" y2="50" stroke="currentColor" class="text-line-strong" stroke-dasharray="3 3" vector-effect="non-scaling-stroke"/><polyline points="${line}" fill="none" stroke="currentColor" class="text-brass-400" stroke-width="2" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>`;
    const teamName = (n: number) => fill(t.team, { n });
    const signed = (d: number) => `${d > 0 ? '+' : d < 0 ? '−' : ''}${nf.format(Math.abs(d))}`;
    return el(
      'section',
      { class: 'rounded-md bg-ink-900 px-4 py-3 ring-1 ring-line ring-inset' },
      el('h3', { class: 'text-sm font-bold' }, t.soulGraph),
      el(
        'div',
        { class: 'mt-2 grid grid-cols-[minmax(0,1fr)_auto] gap-x-3' },
        el(
          'div',
          { class: 'relative h-28' },
          svg,
          ...points.slice(1).map((p) =>
            el('span', {
              title: `${clock(p.ts)} · ${p.diff ? fill(t.soulAhead, { team: teamName(p.diff > 0 ? 1 : 2) }) : ''} ${nf.format(Math.abs(p.diff))}`.trim(),
              class: 'absolute size-2.5 -translate-1/2 rounded-full bg-brass-400 ring-2 ring-ink-900',
              style: `left:${x(p.ts)}%;top:${y(p.diff)}%`,
            }),
          ),
        ),
        el(
          'div',
          { class: 'flex flex-col justify-between text-right text-2xs text-paper-500 tabular-nums' },
          el('span', {}, fill(t.soulAhead, { team: teamName(1) }), el('span', { class: 'block' }, signed(max))),
          el('span', {}, '0'),
          el('span', {}, el('span', { class: 'block' }, signed(-max)), fill(t.soulAhead, { team: teamName(2) })),
        ),
        el('div', { class: 'flex justify-between text-2xs text-paper-500 tabular-nums' }, el('span', {}, '0:00'), el('span', {}, clock(end))),
      ),
    );
  }

  /** 두 팀 12명. 플레이어 줄을 누르면 그 플레이어의 기록이 아래로 펼쳐진다 */
  function matchView({ detail, names }: LoadedMatch, from?: number) {
    const teams = [0, 1].map((team) => detail.players.filter((p) => p.team === team).sort((a, b) => a.player_slot - b.player_slot));
    const teamBadge = [detail.average_badge_team0, detail.average_badge_team1];

    const playerRow = (p: MatchPlayer) => {
      const stat = lastStat(p);
      const button = el(
        'button',
        {
          type: 'button',
          title: t.showPlayer,
          class: `group grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-4 py-2 text-left transition-colors duration-150 hover:bg-ink-800 aria-expanded:bg-ink-800 lg:grid-cols-[minmax(0,1fr)_6.5rem_4.5rem_4.5rem_minmax(0,1.2fr)] ${p.account_id && p.account_id === from ? 'bg-brass-400/8' : ''}`,
        },
        el(
          'span',
          { class: 'flex min-w-0 items-center gap-2.5' },
          el('span', { class: 'w-3 flex-none text-xs text-paper-500 transition-transform duration-150 group-aria-expanded:rotate-90', 'aria-hidden': 'true' }, '›'),
          heroIcon(p.hero_id, 'size-9'),
          el(
            'span',
            { class: 'min-w-0' },
            el(
              'span',
              { class: 'flex min-w-0 items-center gap-1.5' },
              el('span', { class: `truncate text-sm font-semibold ${p.account_id ? '' : 'text-paper-400'}` }, p.account_id ? (names.get(p.account_id) ?? `ID ${p.account_id}`) : '—'),
              mvpStar(p.mvp_rank),
            ),
            el('span', { class: 'block truncate text-xs text-paper-500' }, `${heroName(p.hero_id)} · ${t.level} ${p.level}`),
          ),
        ),
        el(
          'span',
          { class: 'text-right text-sm tabular-nums lg:text-left' },
          `${p.kills} / `,
          el('span', { class: 'text-nerf' }, p.deaths),
          ` / ${p.assists}`,
          el('span', { class: 'block text-xs text-paper-500' }, `${t.kda} ${kdaRatio(p.kills, p.deaths, p.assists)}`),
        ),
        el('span', { class: 'text-sm tabular-nums' }, nf.format(p.net_worth), el('span', { class: 'block text-xs text-paper-500' }, t.souls)),
        el(
          'span',
          { class: 'text-right text-sm tabular-nums lg:text-left' },
          stat?.player_damage !== undefined ? nf.format(stat.player_damage) : '–',
          el('span', { class: 'block text-xs text-paper-500' }, t.damage),
        ),
        el('span', { class: 'col-span-2 flex flex-wrap gap-1 lg:col-span-1' }, ...finalItems(p).map((id) => itemIcon(id, 'size-7'))),
      );
      const region = el('div', { class: 'bg-ink-850' });
      expandable(button, region, () => playerDetail(p, names));
      return el('li', {}, button, region);
    };

    const teamBlock = (team: number) => {
      const players = teams[team];
      const won = detail.winning_team === team;
      const kills = players.reduce((n, p) => n + p.kills, 0);
      const souls = players.reduce((n, p) => n + p.net_worth, 0);
      const badge = teamBadge[team];
      return el(
        'section',
        { class: `overflow-hidden rounded-md bg-ink-900 ring-1 ring-inset ${won ? 'ring-buff/30' : 'ring-line'}` },
        el(
          'div',
          { class: 'flex flex-wrap items-center gap-2 px-4 py-2.5' },
          el('h3', { class: 'text-sm font-bold' }, fill(t.team, { n: team + 1 })),
          won ? el('span', { class: 'chip bg-buff/12 text-buff' }, t.teamWon) : null,
          badge ? badgeView(badge, 'size-5', 'text-xs font-semibold text-paper-200') : null,
          el('span', { class: 'ml-auto text-xs text-paper-400 tabular-nums' }, `${kills} K · ${nf.format(souls)} ${t.souls}`),
        ),
        el('ul', { class: 'divide-y divide-line border-t border-line' }, ...players.map(playerRow)),
      );
    };

    return el(
      'div',
      { class: 'space-y-3' },
      el(
        'p',
        { class: 'flex flex-wrap gap-x-3 text-xs text-paper-400 tabular-nums' },
        fill(t.matchId, { id: detail.match_id }),
        el('span', {}, `${dateFmt.format(new Date(detail.start_time * 1000))} · ${clock(detail.duration_s)}`),
        el('span', { class: detail.match_mode === RANKED ? 'font-semibold text-brass-400' : '' }, modeText(detail as unknown as MatchEntry)),
      ),
      teamBlock(0),
      teamBlock(1),
      soulGraph(detail),
    );
  }

  /** 주소로 바로 들어온 매치 (?match=ID) — 펼치기와 같은 화면을 페이지에 */
  async function renderMatch(matchId: number, from?: number) {
    const my = ++request;
    show(message(t.loading));
    try {
      const loaded = await loadMatch(matchId);
      if (my !== request) return;
      show(backLink(from), el('h2', { class: 'mb-3 text-2xl font-extrabold tracking-tight' }, t.matchTitle), matchView(loaded, from));
    } catch {
      if (my === request) show(backLink(from), message(t.matchError, 'text-nerf'));
    }
  }

  function backLink(from?: number) {
    return el(
      'p',
      { class: 'mb-3' },
      el('a', { href: from ? `?id=${from}` : '?', 'data-nav': '', class: 'text-sm text-paper-400 hover:text-paper-50' }, `← ${from ? t.backToPlayer : t.back}`),
    );
  }

  // ─── 주소 ↔ 화면 ───────────────────────────────────────────
  function route() {
    metaPending = null; // 다른 화면으로 가면 이전 플레이어의 뒤늦은 칸 갱신 목록을 버린다
    viewingPlayer = undefined;
    const params = new URLSearchParams(location.search);
    const id = params.get('id');
    const q = params.get('q');
    const match = params.get('match');
    const from = params.get('from');
    if (match && /^\d+$/.test(match)) {
      input.value = '';
      void renderMatch(Number(match), from && /^\d+$/.test(from) ? Number(from) : undefined);
    } else if (id && /^\d+$/.test(id)) {
      input.value = '';
      // 주소에 SteamID64 를 직접 넣어도 계정 ID 로 (검색창과 같은 해석)
      const parsed = parsePlayerInput(id);
      void renderPlayer('id' in parsed ? parsed.id : Number(id));
    } else if (q) {
      input.value = q;
      void renderSearch(q);
    } else {
      input.value = '';
      const region = params.get('region');
      const fallback: Region = cfg.locale.startsWith('en') ? 'NAmerica' : 'Asia';
      void renderLeaderboard(REGIONS.includes(region as Region) ? (region as Region) : fallback);
    }
  }
  const go = (search: string) => {
    history.pushState(null, '', `${location.pathname}${search}`);
    route();
    window.scrollTo({ top: 0 });
  };

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const parsed = parsePlayerInput(input.value);
    if (!('id' in parsed) && !parsed.query) return;
    go('id' in parsed ? `?id=${parsed.id}` : `?q=${encodeURIComponent(parsed.query)}`);
  });
  /**
   * 순위표 이름 → 계정. 후보 계정들이 함께 나온 최근 상위 랭크 매치를 한 번에 받아 가장 많이 나온 계정 (순위표는 랭크 최상위권이므로).
   * 먼저 승천자+(평균 휘장 101+) 매치로 찾고(2026-10-16 사용자: 전령사+ 보다 좁게), 없으면 전령사+(71+) 로 한 번 더 —
   * 남미 · 오세아니아는 100위 근처가 초월자라 승천자+ 판이 없을 수 있다. 둘 다 없으면 null → 이름 검색. 이 주소는 IP 당 분당 30회라 누를 때만 부른다.
   */
  async function pickCandidate(ids: string): Promise<number | null> {
    for (const minBadge of ['101', '71']) {
      try {
        const q = new URLSearchParams({
          account_ids: ids,
          only_filtered_players: 'true',
          include_player_info: 'true',
          match_mode: 'ranked',
          min_average_badge: minBadge,
          order_by: 'start_time',
          order_direction: 'desc',
          limit: '300',
        });
        const res = await fetch(`${cfg.api}/v1/matches/metadata?${q}`);
        if (!res.ok) continue;
        const counts = new Map<number, number>();
        for (const m of (await res.json()) as Array<{ players?: Array<{ account_id: number }> }>)
          for (const p of m.players ?? []) counts.set(p.account_id, (counts.get(p.account_id) ?? 0) + 1);
        const best = [...counts].sort((x, y) => y[1] - x[1])[0];
        if (best) return best[0];
      } catch {
        /* 다음 기준으로 */
      }
    }
    return null;
  }

  // 결과·뒤로 링크는 페이지를 다시 읽지 않고 전환
  view.addEventListener('click', (e) => {
    const a = (e.target as HTMLElement).closest<HTMLAnchorElement>('a[data-nav]');
    if (!a || e.metaKey || e.ctrlKey || e.shiftKey) return;
    e.preventDefault();
    const href = a.getAttribute('href') === '?' ? '' : a.getAttribute('href')!;
    const ids = a.dataset.candidates;
    if (!ids) return go(href);
    if (a.getAttribute('aria-busy') === 'true') return;
    a.setAttribute('aria-busy', 'true');
    void pickCandidate(ids).then((id) => {
      a.removeAttribute('aria-busy');
      go(id ? `?id=${id}` : href);
    });
  });
  window.addEventListener('popstate', route);
  route();
}
