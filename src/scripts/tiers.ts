/**
 * 티어·승률표 화면 — 빌드 때 페이지에 심은 JSON(#tier-config)으로 그린다.
 * 기간 버튼을 누르면 해당 조합으로 다시 그리고 주소(?window=)에 반영한다.
 * 승률표는 [랭크 | 일반](?mode=normal, 2026-10-29). 랭크는 단계 1–11 범위(?from=&to=) — 전체 범위는 빌드 때 심은 보드, 좁히면 단계별 원본
 * 판수·승수를 더해 브라우저에서 계산한다 (서로 겹치지 않는 평균 랭크 범위끼리는 더해도 정확). 예전 주소의 ?rank=low|mid|high|top|upper 도 범위로 바꿔 받는다.
 * 일반은 승률 · 픽률 · 판수만. [승률표 | 랭크별 | 라인전] 보기는 2026-10-29 뺐다 (사용자: 가독성).
 * 티어 화면에는 티어·태그만 온다 (점수 공식과 수치는 빌드에서만 쓴다).
 */
import type { Dictionary } from '../i18n';
import { TIER_TONE } from '../lib/tier-tone';

type WindowKey = 'patch' | 'prev' | '7d' | '14d' | '30d';
type RankKey = 'ranked' | 'normal' | 'upper' | 'lower' | 'low' | 'mid' | 'high' | 'top';

/**
 * 표본 경고 — 매치 수에 따른 티어 흔들림을 재표본으로 재 본 결과 (2026-09-30):
 * 5만 판 이상 흔들림 13% 이하, 2~5만 판 17~20%, 2만 판 미만 23~38% (2칸 이상 뒤집힘도 생김).
 */
const SAMPLE_WARN = 50_000;
const SAMPLE_WARN_STRONG = 20_000;
type Tier = 'S' | 'A' | 'B' | 'C' | 'D';
type Tag = 'skill' | 'easy';

/** 티어 화면: [heroId, 티어|null, 태그|null, 표본 부족 1|0, 지난주 대비 칸 수(+오름)|null, 근거 한 줄] */
export type TierCell = [number, Tier | null, Tag | null, 0 | 1, number | null, string];
/**
 * 승률표: [heroId, 판수, 승수, 숙련자 판수, 숙련자 승수, 킬 + 어시스트, 데스] — 비율은 브라우저가 계산한다
 * (KDA 에는 킬과 어시스트의 합만 쓰므로 한 칸으로 — 단계별 원본 파일을 줄이려고)
 * (기간끼리 빼서 '변화' 를 내려고 반올림한 승률 대신 원본 수를 싣는다, 2026-10-09)
 */
export type StatCell = [number, number, number, number, number, number, number];
/** 단계별 원본에서 영웅 · 단계 하나의 칸 수 [판수, 승수, 숙련자 판수, 숙련자 승수, 킬 + 어시스트, 데스] (lib/tier-page.ts 와 같게) */
const STEP_FIELDS = 6;
/** 단계별 원본: 기간마다 단계 1–11 총 매치 수와 영웅별 STEP_FIELDS 칸 × 11 */
export type StepsData = Partial<Record<WindowKey, { totals: number[]; heroes: Record<number, number[]> }>>;
/** 승률표 열 */
type ColKey = 'wr' | 'change' | 'pick' | 'kda' | 'gap' | 'matches';

export interface TierPageConfig {
  mode: 'tier' | 'stats';
  locale: string;
  heroPath: string;
  heroes: Record<number, { name: string; slug: string; icon?: string }>;
  generatedAt: number;
  windows: Array<{ key: WindowKey; from: number; to?: number }>;
  boards: Array<{ window: WindowKey; rank: RankKey; totalMatches: number; cells: Array<TierCell | StatCell> }>;
  /** 승률표 랭크 범위용 단계별 원본 파일 주소 — 범위를 처음 고를 때 받는다 */
  stepsUrl?: string;
  /** 랭크 단계 1–11 이름 · 휘장 */
  rankSteps: Array<{ name: string; icon?: string }>;
  /** 승률표에서 '표본 적음' 으로 흐리게 할 판수 */
  lowSample: number;
  t: Dictionary['tiers'];
}

const TIERS: Tier[] = ['S', 'A', 'B', 'C', 'D'];

const configEl = document.getElementById('tier-config');
const view = document.querySelector<HTMLElement>('[data-tier-view]');

if (configEl && view) {
  const cfg = JSON.parse(configEl.textContent ?? '{}') as TierPageConfig;
  const t = cfg.t;
  const out: HTMLElement = view;
  const nf = new Intl.NumberFormat(cfg.locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const nf0 = new Intl.NumberFormat(cfg.locale, { maximumFractionDigits: 0 });
  // 기간이 한국 0시로 잘리므로(tier-pieces.ts, 2026-10-29) 날짜도 한국 시간으로 — UTC 면 시작일이 하루 앞으로 보였다
  const dateFmt = new Intl.DateTimeFormat(cfg.locale, { month: 'short', day: 'numeric', timeZone: 'Asia/Seoul' });
  const stampFmt = new Intl.DateTimeFormat(cfg.locale, { dateStyle: 'medium', timeStyle: 'short' });
  const windowButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-tier-window]')];
  const rankButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-tier-rank]')];
  const basis = document.querySelector<HTMLElement>('[data-tier-basis]');
  const sampleNote = document.querySelector<HTMLElement>('[data-tier-sample-note]');
  /**
   * 티어는 최근 2주 · 상위권(전령사+) 이 기본, [전령사 미만] 으로 하위권 (2026-10-08). 패치 2주 미만이면 '현재 패치만' 선택 가능,
   * 승률표는 현재 패치 · 랭크 전체가 기본 — TierControls.astro 와 같게
   */
  const defaultRank: RankKey = 'upper';
  const defaultWindow: WindowKey = cfg.mode === 'tier' ? '14d' : 'patch';

  const params = new URLSearchParams(location.search);
  const isWindow = (v: string | null): v is WindowKey => windowButtons.some((b) => b.dataset.tierWindow === v);
  const isRank = (v: string | null): v is RankKey => rankButtons.some((b) => b.dataset.tierRank === v);
  // 예전 '최근 3일'(2026-10-06 뺌)로 공유된 주소는 '최근 7일' 로
  if (params.get('window') === '3d') params.set('window', '7d');
  let win: WindowKey = isWindow(params.get('window')) ? (params.get('window') as WindowKey) : defaultWindow;
  let rank: RankKey = isRank(params.get('rank')) ? (params.get('rank') as RankKey) : defaultRank;
  // 승률표 [랭크 | 일반] 과 랭크 범위 (예전 '전체(일반 포함)' 주소는 랭크 전체로)
  const FULL: [number, number] = [1, 11];
  const LEGACY_RANGE: Record<string, [number, number]> = { low: [1, 3], mid: [4, 6], high: [7, 8], top: [9, 11], upper: [7, 11] };
  let matchMode: 'ranked' | 'normal' = params.get('mode') === 'normal' ? 'normal' : 'ranked';
  let range: [number, number] = FULL;
  if (cfg.mode === 'stats') {
    const from = Number(params.get('from'));
    const to = Number(params.get('to'));
    if (Number.isInteger(from) && Number.isInteger(to) && from >= 1 && to <= 11 && from <= to) range = [from, to];
    else range = LEGACY_RANGE[params.get('rank') ?? ''] ?? FULL;
  }
  const isFull = () => range[0] === 1 && range[1] === 11;
  let sort: { col: ColKey; desc: boolean } = { col: 'wr', desc: true };
  const modeButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-match-mode]')];
  const picker = document.querySelector<HTMLElement>('[data-rank-range]');
  /**
   * 숙련 차이 · 변화는 비교하는 쪽 판수가 이보다 적으면 '—' (마우스를 올리면 판수). 막 나온 영웅은 숙련자(평생 80판+) 경기가 1판뿐이라 100% 로 보였다
   * (2026-10-06 사용자 제보 — 랫 킹 현재 패치 숙련자 1판 1승). 티어 점수의 MIN_EXP_GAMES(tier-score.ts)와 같은 200판.
   */
  const MIN_RATE_GAMES = 200;

  // ─── DOM 도우미 ───────────────────────────────────────────
  type Child = Node | string | null | undefined | false;
  function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string | undefined> = {}, ...children: Child[]) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) if (v !== undefined) node.setAttribute(k, v);
    for (const c of children) if (c) node.append(c);
    return node;
  }
  const pct = (n: number) => `${nf.format(n)}%`;
  const heroLink = (id: number) => `${cfg.heroPath}${cfg.heroes[id]?.slug ?? ''}/`;
  const heroIcon = (id: number, cls: string) => {
    const icon = cfg.heroes[id]?.icon;
    return icon
      ? el('img', { src: icon, alt: '', loading: 'lazy', class: `${cls} object-cover` })
      : el('span', { class: `${cls} grid place-items-center bg-ink-800 text-xs font-bold text-paper-400` }, cfg.heroes[id]?.name.slice(0, 1));
  };
  const tagChip = (tag: Tag) =>
    el(
      'span',
      {
        title: tag === 'skill' ? t.tagSkillHint : t.tagEasyHint,
        class: `rounded-xs px-1.5 text-[0.625rem] leading-4 font-bold ${tag === 'skill' ? 'bg-spirit/15 text-spirit' : 'bg-vitality/15 text-vitality'}`,
      },
      tag === 'skill' ? t.tagSkill : t.tagEasy,
    );

  // ─── 티어 보드 ────────────────────────────────────────────
  function tierBoard(cells: TierCell[]) {
    const row = (label: Node, list: TierCell[], empty = '—') =>
      el(
        'section',
        { class: 'grid grid-cols-[2.5rem_minmax(0,1fr)] overflow-hidden sm:grid-cols-[3.5rem_minmax(0,1fr)] rounded-lg bg-ink-900 ring-1 ring-line ring-inset' },
        label,
        el(
          'ul',
          { class: 'flex min-h-24 flex-wrap gap-2 p-2.5' },
          ...(list.length
            ? list.map(([id, tier, tag, lowSample, change, reason]) => {
                // 지난주 대비 — 초상 오른쪽 위 작은 화살표 (변동이 없으면 아무것도 없다). 설명 문장은 마우스를 올렸을 때 근거와 함께
                const changeText = change
                  ? (change > 0 ? t.changeUp : t.changeDown).replace('{n}', String(Math.abs(change))).replace('{tier}', TIERS[TIERS.indexOf(tier!) + change] ?? '')
                  : '';
                const title = [cfg.heroes[id]?.name, reason, changeText].filter(Boolean).join('\n');
                return el(
                  'li',
                  { class: 'relative w-[5.5rem]' },
                  change
                    ? el(
                        'span',
                        {
                          'aria-label': changeText,
                          class: `pointer-events-none absolute top-1 right-1 z-10 rounded-xs bg-ink-950/85 px-1 text-[0.625rem] leading-4 font-bold tabular-nums ${change > 0 ? 'text-buff' : 'text-nerf'}`,
                        },
                        `${change > 0 ? '▲' : '▼'}${Math.abs(change)}`,
                      )
                    : null,
                  el(
                    'a',
                    { href: heroLink(id), class: 'group block', title },
                    heroIcon(id, 'aspect-square w-full rounded-md ring-1 ring-line ring-inset group-hover:ring-brass-400/70'),
                    el('p', { class: 'mt-1 truncate text-center text-xs font-semibold text-paper-200 group-hover:text-paper-50' }, cfg.heroes[id]?.name ?? `#${id}`),
                    tag || lowSample
                      ? el(
                          'p',
                          { class: 'mt-1 flex flex-wrap justify-center gap-1' },
                          tag ? tagChip(tag) : null,
                          lowSample
                            ? el('span', { title: t.lowSampleHint, class: 'rounded-xs bg-ink-700 px-1.5 text-[0.625rem] leading-4 font-bold text-paper-200' }, t.lowSample)
                            : null,
                        )
                      : null,
                  ),
                );
              })
            : [el('li', { class: 'self-center px-2 text-sm text-paper-500' }, empty)]),
        ),
      );
    // 티어 안은 빌드에서 점수 순으로 보낸 순서 그대로 (강한 영웅이 앞). 제외(티어 없음)는 이름순
    const byName = (a: TierCell, b: TierCell) => (cfg.heroes[a[0]]?.name ?? '').localeCompare(cfg.heroes[b[0]]?.name ?? '', cfg.locale);
    const rows: Node[] = TIERS.map((tier) =>
      row(el('h2', { class: `grid place-items-center text-2xl font-extrabold ${TIER_TONE[tier]}` }, tier), cells.filter((c) => c[1] === tier)),
    );
    const low = cells.filter((c) => c[1] === null).sort(byName);
    if (low.length) {
      rows.push(
        row(
          el('h2', { class: 'grid place-items-center bg-ink-850 px-1 text-center text-xs font-bold text-paper-500', title: t.excludedHint }, t.excluded),
          low,
        ),
      );
    }
    return el('div', { class: 'space-y-2' }, ...rows);
  }

  // ─── 승률표 ───────────────────────────────────────────────
  /**
   * 열 (2026-10-09 사용자 요청 — 숙련자·비숙련 승률을 나란히 두는 대신): 승률 · 변화 · 픽률 · KDA · 숙련 차이 · 판수.
   * 변화 = 직전 기간 대비 승률 — 현재 패치 ↔ 이전 패치, 최근 7일 ↔ 8–14일 전, 최근 14일 ↔ 15–30일 전 (긴 기간에서 짧은 기간을 빼서 만든다).
   * 이전 패치 · 최근 30일은 비교할 기간이 없어 열을 숨긴다.
   */
  const CHANGE_BASE: Partial<Record<WindowKey, { whole: WindowKey; minus?: WindowKey; hint: 'changeHintPatch' | 'changeHint7d' | 'changeHint14d' }>> = {
    patch: { whole: 'prev', hint: 'changeHintPatch' },
    '7d': { whole: '14d', minus: '7d', hint: 'changeHint7d' },
    '14d': { whole: '30d', minus: '14d', hint: 'changeHint14d' },
  };
  function baseRates(): Map<number, { m: number; w: number }> | null {
    const spec = CHANGE_BASE[win];
    const whole = spec && boardFor(spec.whole);
    const minus = spec?.minus ? boardFor(spec.minus) : undefined;
    if (!spec || !whole || (spec.minus && !minus)) return null;
    const out = new Map<number, { m: number; w: number }>();
    for (const c of whole.cells as StatCell[]) out.set(c[0], { m: c[1], w: c[2] });
    for (const c of (minus?.cells ?? []) as StatCell[]) {
      const b = out.get(c[0]);
      if (b) out.set(c[0], { m: b.m - c[1], w: b.w - c[2] });
    }
    return out;
  }
  const nf2 = new Intl.NumberFormat(cfg.locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const nfSigned = new Intl.NumberFormat(cfg.locale, { minimumFractionDigits: 1, maximumFractionDigits: 1, signDisplay: 'exceptZero' });
  type Row = { id: number; m: number; wr: number; pick: number; kda: number | null; change: number | null; prevWr: number | null; gap: number | null; expWr: number | null; novWr: number | null; expM: number; novM: number };

  function statsTable(board: TierPageConfig['boards'][number]) {
    // 일반은 승률 · 픽률 · 판수만 (2026-10-29 사용자)
    const normal = matchMode === 'normal';
    const base = normal ? null : baseRates();
    const rows: Row[] = (board.cells as StatCell[]).map(([id, m, w, em, ew, ka, d]) => {
      const wr = m ? (w / m) * 100 : 0;
      const nm = m - em;
      const b = base?.get(id);
      const prevWr = b && b.m >= MIN_RATE_GAMES ? (b.w / b.m) * 100 : null;
      const expWr = em >= MIN_RATE_GAMES ? (ew / em) * 100 : null;
      const novWr = nm >= MIN_RATE_GAMES ? ((w - ew) / nm) * 100 : null;
      return {
        id,
        m,
        wr,
        pick: board.totalMatches ? (m / board.totalMatches) * 100 : 0,
        kda: d ? ka / d : null,
        change: prevWr !== null && m >= MIN_RATE_GAMES ? wr - prevWr : null,
        prevWr,
        gap: expWr !== null && novWr !== null ? expWr - novWr : null,
        expWr,
        novWr,
        expM: em,
        novM: nm,
      };
    });
    const signed = (n: number) => `${nfSigned.format(Math.round(n * 10) / 10)}${t.pp}`;
    const dash = (title?: string) => el('span', { class: 'text-paper-500', title }, '—');
    const cols: Array<{ key: ColKey; label: string; hint?: string; value: (r: Row) => number | null; fmt: (r: Row) => Node | string }> = [
      { key: 'wr', label: t.winRate, value: (r) => r.wr, fmt: (r) => pct(r.wr) },
      ...(base
        ? [
            {
              key: 'change' as const,
              label: t.change,
              hint: t[CHANGE_BASE[win]!.hint],
              value: (r: Row) => r.change,
              fmt: (r: Row) =>
                r.change === null
                  ? dash()
                  : el(
                      'span',
                      {
                        class: r.change >= 0.05 ? 'text-buff' : r.change <= -0.05 ? 'text-nerf' : '',
                        title: t.changeCell.replace('{from}', pct(r.prevWr!)).replace('{to}', pct(r.wr)),
                      },
                      signed(r.change),
                    ),
            },
          ]
        : []),
      { key: 'pick', label: t.pickRate, hint: t.pickHint, value: (r) => r.pick, fmt: (r) => pct(r.pick) },
      ...(normal ? [] : [{ key: 'kda' as const, label: t.kda, hint: t.kdaHint, value: (r: Row) => r.kda, fmt: (r: Row) => (r.kda === null ? dash() : nf2.format(r.kda)) }]),
      // 숙련자 수치가 없으면(일반 — 일반 매치 숙련자 요청이 API 시간 제한에 걸림, 2026-10-29) 열을 숨긴다
      ...(!normal && rows.some((r) => r.expM > 0)
        ? [
            {
              key: 'gap' as const,
              label: t.skillGap,
              hint: t.skillGapHint,
              value: (r: Row) => r.gap,
              fmt: (r: Row) =>
                r.gap === null
                  ? dash(t.tooFewGames.replace('{n}', nf0.format(Math.min(r.expM, r.novM))))
                  : el('span', { title: t.skillGapCell.replace('{exp}', pct(r.expWr!)).replace('{nov}', pct(r.novWr!)) }, signed(r.gap)),
            },
          ]
        : []),
      { key: 'matches', label: t.matches, value: (r) => r.m, fmt: (r) => nf0.format(r.m) },
    ];
    // 고른 열이 없어졌으면(변화 열이 없는 기간) 승률로
    const active = cols.find((c) => c.key === sort.col) ?? cols[0];
    // '—' 칸은 늘 맨 아래
    const sorted = [...rows].sort((a, b) => {
      const x = active.value(a);
      const y = active.value(b);
      if (x === null) return y === null ? 0 : 1;
      if (y === null) return -1;
      return sort.desc ? y - x : x - y;
    });
    // 일반(열 3개)은 휴대폰에서 한 화면에 들어가게 — 숫자 열 폭을 고정하지 않고, 여백 · 영웅 아이콘을 줄이고, 머리글('Win rate')과 긴 이름은 두 줄로
    const numPad = normal ? 'px-2 sm:px-4' : 'px-3 sm:px-4';
    const head = el(
      'tr',
      { class: 'border-b border-line' },
      // 영웅 열은 왼쪽에 붙여 둔다 — 휴대폰에서 표를 옆으로 밀어도 어느 영웅 줄인지 보이게 (2026-10-05 모바일 점검)
      el('th', { class: `sticky left-0 z-[1] bg-ink-900 ${numPad} py-3 text-left font-semibold` }, t.hero),
      // 숫자 열은 모두 같은 폭, 머리글 글자 끝을 숫자 끝에 맞춘다 — 정렬 화살표·ⓘ 는 글자 왼쪽 고정 칸에 (2026-10-03 '표가 흐트러져 보인다')
      ...cols.map((c) => {
        const on = active.key === c.key;
        const btn = el(
          'button',
          { type: 'button', title: c.hint, class: `inline-flex items-center justify-end gap-1 ${normal ? 'sm:whitespace-nowrap' : 'whitespace-nowrap'} hover:text-paper-50 ${on ? 'text-paper-50' : ''}` },
          el('span', { class: 'w-2.5 text-center', 'aria-hidden': 'true' }, on ? (sort.desc ? '↓' : '↑') : ''),
          c.hint ? el('span', { class: 'text-paper-500', 'aria-hidden': 'true' }, 'ⓘ') : null,
          c.label,
        );
        btn.addEventListener('click', () => {
          sort = { col: c.key, desc: active.key === c.key ? !sort.desc : true };
          render();
        });
        return el('th', { class: `${numPad} py-3 text-right font-semibold ${normal ? 'sm:w-[7.5rem]' : 'w-24 sm:w-[7.5rem]'}`, 'aria-sort': on ? (sort.desc ? 'descending' : 'ascending') : undefined }, btn);
      }),
    );
    const body = sorted.map((r) => {
      const low = r.m < cfg.lowSample;
      return el(
        'tr',
        { class: `group border-t border-line hover:bg-ink-850 ${low ? 'opacity-60' : ''}` },
        el(
          'th',
          // 일반은 긴 이름('레이디 가이스트')을 두 줄로 — 그래야 휴대폰 폭에 숫자 열 셋이 다 들어간다
          { scope: 'row', class: `sticky left-0 z-[1] bg-ink-900 ${numPad} py-2 text-left font-semibold group-hover:bg-ink-850 ${normal ? '' : 'whitespace-nowrap'}` },
          el(
            'a',
            { href: heroLink(r.id), class: `flex items-center hover:text-brass-200 ${normal ? 'gap-2 sm:gap-2.5' : 'gap-2.5'}` },
            heroIcon(r.id, `${normal ? 'size-7 sm:size-8' : 'size-8'} flex-none rounded-sm`),
            cfg.heroes[r.id]?.name ?? `#${r.id}`,
            low ? el('span', { class: 'text-2xs font-semibold text-copper-400' }, t.lowSampleShort) : null,
          ),
        ),
        // 지금 정렬한 열을 굵게 (예전엔 '승률' 열만 늘 굵어서 정렬 기준이 안 보였다)
        ...cols.map((col) => el('td', { class: `${numPad} py-2 text-right tabular-nums ${col.key === active.key ? 'font-bold text-paper-50' : 'text-paper-200'}` }, col.fmt(r))),
      );
    });
    return el(
      'div',
      { class: 'panel overflow-x-auto' },
      // 일반(열 3개)은 휴대폰 폭 안에 들어가게 최소 폭을 두지 않는다
      el('table', { class: `w-full text-sm ${normal ? '' : 'min-w-[40rem] sm:min-w-[46rem]'}` }, el('thead', { class: 'text-xs text-paper-500' }, head), el('tbody', {}, ...body)),
    );
  }

  // ─── 승률표 범위 계산 ─────────────────────────────────────
  // 단계별 원본은 범위를 처음 고를 때 한 번만 받는다 (그 뒤로는 받은 것으로 바로 계산 · 파일은 브라우저 캐시)
  let steps: StepsData | null = null;
  let stepsLoading: Promise<void> | null = null;
  let stepsFailed = false;
  /**
   * 단계별 원본 파일 이름엔 데이터 시각이 들어 있어, 페이지를 열어 둔 사이 새 배포가 나가면 옛 파일이 없어진다(404).
   * 그땐 '데이터 없음' 대신 새로고침 안내 (2026-10-06 — 배포 시각에 '사이트 터졌다' 는 댓글)
   */
  let stepsOutdated = false;
  const loadSteps = () =>
    (stepsLoading ??= fetch(cfg.stepsUrl ?? '')
      .then((r) => {
        if (r.status === 404) stepsOutdated = true;
        return r.ok ? r.json() : Promise.reject(new Error(String(r.status)));
      })
      .then((d: StepsData) => {
        steps = d;
      })
      .catch(() => {
        stepsFailed = true; // 받지 못하면 '데이터 없음' 안내 (무한 재시도 방지)
      }));

  /** 승률표 데이터 — 일반 · 랭크 전체면 빌드 때 심은 보드, 좁힌 랭크 범위면 단계별 원본을 더한다. '변화' 의 비교 기간도 이걸로 만든다 */
  function boardFor(key: WindowKey): TierPageConfig['boards'][number] | undefined {
    if (matchMode === 'normal' || isFull()) return cfg.boards.find((b) => b.window === key && b.rank === matchMode);
    const data = steps?.[key];
    if (!data) return undefined;
    const [lo, hi] = range;
    let total = 0;
    for (let i = lo - 1; i < hi; i++) total += data.totals[i] ?? 0;
    const cells: StatCell[] = [];
    for (const [id, arr] of Object.entries(data.heroes)) {
      const sum = [0, 0, 0, 0, 0, 0];
      for (let i = lo - 1; i < hi; i++) for (let f = 0; f < STEP_FIELDS; f++) sum[f] += arr[i * STEP_FIELDS + f] ?? 0;
      if (!sum[0]) continue;
      cells.push([Number(id), sum[0], sum[1], sum[2], sum[3], sum[4], sum[5]]);
    }
    return { window: key, rank: 'ranked', totalMatches: total, cells };
  }

  // ─── 랭크 범위 막대 ───────────────────────────────────────
  const lo = document.querySelector<HTMLInputElement>('[data-range-lo]');
  const hi = document.querySelector<HTMLInputElement>('[data-range-hi]');
  const band = document.querySelector<HTMLElement>('[data-range-band]');
  const fill = document.querySelector<HTMLElement>('[data-range-fill]');
  const rangeLabel = document.querySelector<HTMLElement>('[data-range-label]');
  const stepButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-step]')];
  function syncRange() {
    if (!picker || !lo || !hi) return;
    const [a, b] = range;
    lo.value = String(a);
    hi.value = String(b);
    if (band) {
      band.style.left = `${((a - 1) / 11) * 100}%`;
      band.style.width = `${((b - a + 1) / 11) * 100}%`;
    }
    if (fill) {
      fill.style.left = `calc(7px + (100% - 14px) * ${(a - 1) / 10})`;
      fill.style.width = `calc((100% - 14px) * ${(b - a) / 10})`;
    }
    stepButtons.forEach((btn) => {
      const n = Number(btn.dataset.step);
      btn.toggleAttribute('data-in', n >= a && n <= b);
    });
    if (rangeLabel) {
      const name = (n: number) => cfg.rankSteps[n - 1]?.name ?? `#${n}`;
      rangeLabel.textContent = a === b ? name(a) : `${name(a)} – ${name(b)}`;
    }
  }
  lo?.addEventListener('input', () => {
    const b = Number(hi?.value ?? 11);
    const a = Math.min(Number(lo.value), b);
    range = [a, b];
    render();
  });
  hi?.addEventListener('input', () => {
    const a = Number(lo?.value ?? 1);
    const b = Math.max(Number(hi.value), a);
    range = [a, b];
    render();
  });
  stepButtons.forEach((btn) =>
    btn.addEventListener('click', () => {
      const n = Number(btn.dataset.step);
      if (n < range[0]) range = [n, range[1]];
      else if (n > range[1]) range = [range[0], n];
      // 범위 안을 누르면 가까운 끝을 옮긴다
      else range = n - range[0] <= range[1] - n ? [n, range[1]] : [range[0], n];
      render();
    }),
  );

  // ─── 그리기 ───────────────────────────────────────────────
  function render() {
    windowButtons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tierWindow === win)));
    if (cfg.mode === 'stats') {
      modeButtons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.matchMode === matchMode)));
      // 일반은 랭크 범위가 없다
      if (picker) picker.hidden = matchMode === 'normal';
      if (rangeLabel) rangeLabel.hidden = matchMode === 'normal';
      syncRange();
      const q = new URLSearchParams();
      if (matchMode === 'normal') q.set('mode', 'normal');
      if (win !== defaultWindow) q.set('window', win);
      if (matchMode === 'ranked' && !isFull()) {
        q.set('from', String(range[0]));
        q.set('to', String(range[1]));
      }
      history.replaceState(null, '', q.toString() ? `?${q}` : location.pathname);
    } else {
      rankButtons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tierRank === rank)));
      // 기본값이면 주소를 깨끗하게
      const isDefault = win === defaultWindow && rank === defaultRank;
      history.replaceState(null, '', isDefault ? location.pathname : `?window=${win}&rank=${rank}`);
    }

    // 범위를 골랐는데 단계별 원본을 아직 안 받았으면 받은 뒤 다시 그린다 (처음 한 번, 보통 0.1초 안팎)
    if (cfg.mode === 'stats' && matchMode === 'ranked' && !isFull() && !steps && !stepsFailed) {
      void loadSteps().then(render);
      return;
    }
    const board = cfg.mode === 'stats' ? boardFor(win) : cfg.boards.find((b) => b.window === win && b.rank === rank);
    const w = cfg.windows.find((x) => x.key === win);
    if (basis) {
      basis.textContent = board && w
        ? `${t.basis
            .replace('{from}', dateFmt.format(new Date(w.from * 1000)))
            .replace('{to}', dateFmt.format(new Date((w.to ?? cfg.generatedAt) * 1000)))
            .replace('{n}', nf0.format(board.totalMatches))} · ${t.updated.replace('{when}', stampFmt.format(new Date(cfg.generatedAt * 1000)))}`
        : '';
    }
    if (sampleNote) {
      const n = board?.totalMatches ?? 0;
      sampleNote.hidden = !board || n >= SAMPLE_WARN;
      sampleNote.textContent = n < SAMPLE_WARN_STRONG ? t.sampleWarnStrong : t.sampleWarn;
    }
    if (!board) {
      if (stepsOutdated) {
        const again = el('button', { type: 'button', class: 'mt-3 rounded-md bg-brass-400 px-4 py-1.5 text-sm font-bold text-ink-950 hover:bg-brass-200' }, t.reload);
        again.addEventListener('click', () => location.reload());
        out.replaceChildren(el('div', { class: 'py-10 text-center text-paper-300' }, el('p', {}, t.siteUpdated), again));
        return;
      }
      out.replaceChildren(el('p', { class: 'py-10 text-center text-paper-400' }, t.noData));
      return;
    }
    out.replaceChildren(cfg.mode === 'tier' ? tierBoard(board.cells as TierCell[]) : statsTable(board));
  }

  windowButtons.forEach((b) =>
    b.addEventListener('click', () => {
      win = b.dataset.tierWindow as WindowKey;
      render();
    }),
  );
  modeButtons.forEach((b) =>
    b.addEventListener('click', () => {
      matchMode = b.dataset.matchMode === 'normal' ? 'normal' : 'ranked';
      render();
    }),
  );
  rankButtons.forEach((b) =>
    b.addEventListener('click', () => {
      rank = b.dataset.tierRank as RankKey;
      render();
    }),
  );
  render();
}
