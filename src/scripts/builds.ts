/**
 * 빌드 페이지 — 빌드 때 심은 JSON(#builds-config)으로 카드 목록을 그린다.
 * 걸러 보기: 작성자 · 영웅 · 정렬, 주소(?pro=&hero=&sort=)에 남는다. 추천과 상위권 인기는 한 목록 (2026-11-08 사용자: 종류 버튼 뺌).
 * 전체 목록은 최근 수정 순, 영웅을 고르면 추천이면서 상위권 인기 → 판수 순. 24개씩 더 보기.
 * 카드마다 빌드 ID 복사 버튼, 카드를 누르면 작은 창(<dialog>)에 아이템 묶음 전체와 스킬 순서. 주소 ?build=ID 로 바로 열린다.
 * 빌드 이름·작성자 이름은 외부 글이라 textContent 로만 넣는다.
 */
import type { Dictionary } from '../i18n';
import { tipAttr } from '../lib/tip';
import type { BuildNotes } from '../lib/build-notes';

/**
 * 빌드 카드 하나. pro = 추천 작성자 이름 (없으면 추천 빌드가 아님).
 * topN = 상위권 인기 1–5위 (author = 그 빌드 작성자 Steam 이름)
 */
export interface BuildEntry {
  hero: number;
  pro?: string;
  topN?: number;
  /** 상위권 인기 대신 전체 랭크 인기 (막 나온 영웅) */
  allRanks?: boolean;
  author?: string;
  buildId: number;
  name: string;
  updatedAt: number;
  /** 작성자가 나눈 묶음 (이름은 손질됨) · 상점 아이템 id */
  groups: Array<{ name: string; items: number[] }>;
  /** 능력 id 순서 (해금 → 강화), 없으면 빈 배열 */
  order: number[];
  /** 빌드 성적 [판수, 승수, 사용률 %] — 최근 14일 전체 랭크 (2026-10-22) */
  perf?: [number, number, number];
  /** 작성자: r 지역 · n 공식 순위표 순위 · b 지금 랭크 휘장 */
  stand?: { r?: string; n?: number; b?: number };
}

export interface BuildsPageConfig {
  locale: string;
  /** 랭크 단계 → 이름 · 휘장 */
  ranks: Record<number, { name: string; icon?: string }>;
  heroPath: string;
  heroes: Record<number, { name: string; slug: string; icon?: string; abilities: Array<{ id: number; name: string; icon?: string }> }>;
  items: Record<number, { name: string; cat: 'weapon' | 'spirit' | 'vitality'; tier: number; icon?: string }>;
  /** 현재 패치 시작 — 그 전에 수정된 빌드는 '이전 패치' */
  patchFrom?: number;
  /** 영웅 id → 작성자 설명 파일 — 그 영웅 빌드 창을 처음 열 때 받는다 (lib/build-notes.ts) */
  notesFiles: Record<number, string>;
  builds: BuildEntry[];
  t: Dictionary['buildsPage'] & {
    unlock: string;
    upgrade: string;
    tipOrder: string;
    tipStep: string;
    skillOrder: string;
    winRate: string;
    games: string;
    share: string;
    rankPos: string;
    author: string;
    gamesN: string;
    regions: Record<string, string>;
  };
}

const PAGE = 24;
/** 승률을 보여 주는 최소 판수 (BuildStats.astro 와 같다) */
const MIN_GAMES = 100;
/** 승률 글자색 — 통계 랭크별 보기와 같은 기준 (51% 이상 초록 · 49% 이하 빨강) */
const winTone = (wr: number) => (wr >= 51 ? 'text-buff' : wr <= 49 ? 'text-nerf' : 'text-paper-50');
const PREVIEW = 8;
const RING = { weapon: 'ring-weapon/50', spirit: 'ring-spirit/50', vitality: 'ring-vitality/50' };

const configEl = document.getElementById('builds-config');
const root = document.querySelector<HTMLElement>('[data-builds-view]');

if (configEl && root) {
  const cfg = JSON.parse(configEl.textContent ?? '{}') as BuildsPageConfig;
  const t = cfg.t;
  const fmt = (s: string, vars: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''));
  const num = new Intl.NumberFormat(cfg.locale);
  const date = new Intl.DateTimeFormat(cfg.locale, { month: 'long', day: 'numeric' });

  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text?: string) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };
  const img = (src: string | undefined, cls: string, alt = '') => {
    const i = el('img', cls);
    if (src) i.src = src;
    i.alt = alt;
    i.loading = 'lazy';
    return i;
  };
  const itemIcon = (id: number, size: string) => {
    const it = cfg.items[id];
    const box = el('span', `${size} block flex-none overflow-hidden rounded-xs bg-ink-850 ring-1 ring-inset ${it ? RING[it.cat] : ''}`);
    if (it) {
      box.title = it.name;
      if (it.icon) box.append(img(it.icon, 'size-full object-cover', it.name));
    }
    return box;
  };
  const oldPatch = (b: BuildEntry) => Boolean(cfg.patchFrom && b.updatedAt < cfg.patchFrom);

  // 빌드 ID 복사 버튼 — 복사 아이콘 + 'ID 123456', 누르면 잠깐 체크 아이콘 + '복사됨'. 게임 빌드 검색에 붙여 넣는다
  const COPY_ICONS = '<svg data-icon="copy" aria-hidden="true" viewBox="0 0 16 16" class="size-3.5 flex-none" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5"></rect><path d="M10.5 5.5V3.5A1.5 1.5 0 0 0 9 2H3.5A1.5 1.5 0 0 0 2 3.5V9a1.5 1.5 0 0 0 1.5 1.5h2"></path></svg><svg data-icon="check" aria-hidden="true" viewBox="0 0 16 16" class="hidden size-3.5 flex-none" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m3 8.5 3.2 3L13 4.5"></path></svg>';
  const copyButton = (id: number) => {
    const label = fmt(t.buildId, { id });
    const b = el('button', 'relative z-10 flex flex-none items-center gap-1.5 rounded-xs bg-ink-800 px-2 py-1 text-xs font-semibold text-paper-200 tabular-nums transition-colors duration-150 hover:bg-brass-400 hover:text-ink-950');
    b.type = 'button';
    b.title = t.copy;
    b.innerHTML = COPY_ICONS; // 고정된 아이콘 마크업만 (외부 글 아님)
    const text = el('span', '', label);
    b.append(text);
    const [copyIcon, checkIcon] = [...b.querySelectorAll('svg')];
    b.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        await navigator.clipboard.writeText(String(id));
        text.textContent = t.copied;
        copyIcon.classList.add('hidden');
        checkIcon.classList.remove('hidden');
        setTimeout(() => {
          text.textContent = label;
          copyIcon.classList.remove('hidden');
          checkIcon.classList.add('hidden');
        }, 1500);
      } catch {
        /* 복사가 막힌 브라우저 — ID 는 버튼 글자로 보인다 */
      }
    });
    return b;
  };

  // 제목 줄 — '추천 · 작성자' 와 '최상위권 n위'
  const titleLine = (b: BuildEntry, cls: string, withStanding = true) => {
    // 좁은 칸에선 이름을 자르지 않고 배지를 다음 줄로 (이름이 'D..' 로 잘리던 문제)
    const title = el('p', `flex min-w-0 flex-wrap items-baseline gap-x-1.5 font-bold tracking-tight text-paper-50 ${cls}`);
    // 배지는 상자 없이 작은 글자 — 추천과 상위권 인기가 한 목록에 있으니 언제나 표시
    if (b.pro) {
      title.append(el('span', 'flex-none text-2xs font-semibold text-paper-400', t.badge));
      title.append(el('span', 'max-w-full shrink-0 truncate', b.pro));
    }
    if (b.topN) title.append(el('span', 'flex-none text-2xs font-semibold text-copper-400', b.allRanks ? t.popularLabel : t.topLabel));
    // 추천이 아닌 상위권 인기 빌드는 작성자 이름을 제목으로
    if (!b.pro && b.author) title.append(el('span', 'max-w-full shrink-0 truncate', b.author));
    const stand = withStanding && standing(b);
    if (stand) title.append(stand);
    return title;
  };

  /** 작성자 랭킹 — 공식 순위표 '유럽 2위' 또는 지금 랭크 (휘장 아이콘) */
  const standing = (b: BuildEntry) => {
    const s = b.stand;
    if (!s) return null;
    const tier = s.b ? Math.floor(s.b / 10) : undefined;
    const rank = tier !== undefined ? cfg.ranks[tier] : undefined;
    const label = s.n && s.r ? fmt(t.rankPos, { region: t.regions[s.r] ?? s.r, n: num.format(s.n) }) : rank ? `${rank.name}${s.b! % 10 ? ` ${s.b! % 10}` : ''}` : '';
    if (!label) return null;
    const span = el('span', `flex flex-none items-center gap-1 text-xs font-semibold ${s.n ? 'text-tier-a' : 'text-paper-200'}`);
    if (rank?.icon) span.append(img(rank.icon, 'size-4 object-contain'));
    span.append(el('span', '', label));
    return span;
  };

  /** 성적 줄 — 승률(100판 이상) · 판수 · 사용률 */
  const perfLine = (b: BuildEntry, cls = '') => {
    const line = el('p', `flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-paper-400 tabular-nums ${cls}`);
    if (!b.perf || b.perf[0] < MIN_GAMES) return line;
    const [m, w, share] = b.perf;
    const stat = (label: string, value: string, tone = 'text-paper-50') => {
      const s = el('span', '');
      s.append(el('span', 'text-paper-400', `${label} `), el('span', `font-semibold ${tone}`, value));
      return s;
    };
    const wr = Math.round((w / m) * 1000) / 10;
    line.append(stat(t.winRate, `${num.format(wr)}%`, winTone(wr)));
    line.append(stat(t.games, num.format(m)), stat(t.share, shareText(share)));
    return line;
  };
  const shareText = (share: number) => (share < 0.1 ? `<${num.format(0.1)}%` : `${num.format(share)}%`);

  /**
   * 카드의 성적 줄 — 승률 하나만 크게, 판수는 바로 옆에 작게 (승률은 판수와 같이 봐야 해서), 사용률 · 작성자 랭크는 오른쪽 작은 글씨.
   * 2026-10-23: 같은 크기 칸 네 개를 늘어놓으니 대시보드 틀처럼 보인다는 의견으로 바꿈.
   */
  const statLine = (b: BuildEntry) => {
    const line = el('div', 'pointer-events-none flex min-h-7 items-end gap-x-3 gap-y-1');
    const main = el('p', 'flex items-baseline gap-2 tabular-nums');
    const side = el('div', 'ml-auto flex min-w-0 flex-col items-end gap-0.5 text-xs text-paper-400 tabular-nums');
    const stand = standing(b);
    if (stand) side.append(stand);
    // 판수가 100판 미만이면 승률 · 판수 · 사용률을 아예 싣지 않는다 ('—' 도 안 둠, 2026-10-24 사용자)
    if (b.perf && b.perf[0] >= MIN_GAMES) {
      const [m, w, share] = b.perf;
      const wr = Math.round((w / m) * 1000) / 10;
      main.append(
        el('span', `text-2xl leading-7 font-extrabold tracking-tight ${winTone(wr)}`, `${num.format(wr)}%`),
        el('span', 'text-sm text-paper-400', fmt(t.gamesN, { n: num.format(m) })),
      );
      side.append(el('span', '', `${t.share} ${shareText(share)}`));
    }
    line.append(main, side);
    return line;
  };

  // 상태 — 주소에서 시작
  const params = new URLSearchParams(location.search);
  const state = {
    pro: params.get('pro') ?? '',
    hero: Object.values(cfg.heroes).some((h) => h.slug === params.get('hero')) ? params.get('hero')! : '',
    shown: PAGE,
    open: Number(params.get('build')) || 0,
    // 직접 고른 정렬. 안 골랐으면 undefined — 영웅을 골랐을 땐 기본 순서(best), 전체 목록은 최근 수정
    sort: (['new', 'games', 'win'].includes(params.get('sort') ?? '') ? params.get('sort') : undefined) as 'new' | 'games' | 'win' | undefined,
  };
  const heroIdBySlug = new Map(Object.entries(cfg.heroes).map(([id, h]) => [h.slug, Number(id)]));
  const pros = [...new Set(cfg.builds.flatMap((b) => (b.pro ? [b.pro] : [])))].sort((a, b) => a.localeCompare(b));
  if (state.pro && !pros.includes(state.pro)) state.pro = '';

  const syncUrl = () => {
    const q = new URLSearchParams();
    if (state.pro) q.set('pro', state.pro);
    if (state.hero) q.set('hero', state.hero);
    if (state.sort) q.set('sort', state.sort);
    if (state.open) q.set('build', String(state.open));
    const qs = q.toString();
    history.replaceState(null, '', `${location.pathname}${qs ? `?${qs}` : ''}`);
  };

  // ─── 작은 창 ──────────────────────────────────────────────────
  const dialog = el('dialog', 'm-auto w-[min(52rem,calc(100vw-1.5rem))] overflow-hidden rounded-lg border border-line-strong bg-ink-850 p-0 text-paper-50 shadow-[0_24px_64px_rgb(0_0_0/0.6)] backdrop:bg-black/65');
  const body = el('div', 'max-h-[85dvh] overflow-y-auto overscroll-contain');
  dialog.append(body);
  document.body.append(dialog);
  // 바깥(배경)을 누르면 닫힌다
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });
  dialog.addEventListener('close', () => {
    state.open = 0;
    syncUrl();
  });

  // 스킬 순서 — 영웅 빌드 탭(SkillOrder.astro)과 같은 모양 (global.css .skill-track): 해금 = 보라 마름모, 강화 = 그 강화에 드는 포인트
  const COST = [0, 1, 2, 5];
  const skillGrid = (b: BuildEntry, abilities: BuildsPageConfig['heroes'][number]['abilities']) => {
    const track = el('div', 'skill-track');
    track.style.setProperty('--steps', String(b.order.length));
    track.setAttribute('role', 'img');
    track.setAttribute('aria-label', t.skillOrder);
    const seen = new Map<number, number>();
    const nth = b.order.map((id) => {
      const n = seen.get(id) ?? 0;
      seen.set(id, n + 1);
      return n;
    });
    for (const a of abilities) {
      const row = el('div', 'st-row');
      const icon = el('span', 'st-icon');
      icon.title = a.name;
      if (a.icon) icon.append(img(a.icon, ''));
      const line = el('span', 'st-line');
      b.order.forEach((id, i) => {
        if (id !== a.id) return;
        const mark = el('span', nth[i] === 0 ? 'st-mark st-unlock' : 'st-mark', nth[i] === 0 ? '' : String(COST[nth[i]]));
        mark.style.gridColumn = String(i + 1);
        // 칸 툴팁 표 — 영웅 빌드 탭(SkillTrack.astro)과 같은 내용
        mark.setAttribute('data-tip-rows', tipAttr({ h: a.name, rows: [[t.tipOrder, String(i + 1)], [t.tipStep, nth[i] === 0 ? t.unlock : `${t.upgrade} ${nth[i]}`]] }));
        line.append(mark);
      });
      row.append(icon, line);
      track.append(row);
    }
    return track;
  };

  // 작성자 설명 — 영웅마다 파일 하나, 그 영웅 빌드 창을 처음 열 때 한 번만 받는다. 실패하면(배포로 옛 파일이 사라진 경우 등) 설명 없이 그대로 둔다
  const notesByHero = new Map<number, Promise<BuildNotes | null>>();
  const loadNotes = (heroId: number) => {
    const file = cfg.notesFiles[heroId];
    if (!file) return Promise.resolve(null);
    let got = notesByHero.get(heroId);
    if (!got) {
      got = fetch(file)
        .then((r) => (r.ok ? (r.json() as Promise<BuildNotes>) : null))
        .catch(() => null);
      notesByHero.set(heroId, got);
    }
    return got;
  };

  /** 그린 묶음에 설명을 붙인다 — 묶음 설명은 이름 아래 글로, 아이템 설명은 점 표시 + 툴팁 (외부 글이라 textContent · 속성으로만) */
  const applyNotes = (b: BuildEntry, sections: Array<{ title: HTMLElement; items: HTMLElement[] }>, all: BuildNotes) => {
    all[b.buildId]?.forEach((g, i) => {
      const sec = sections[i];
      if (!g || !sec) return;
      if (g.d) sec.title.after(el('p', 'pb-2 text-xs leading-relaxed break-words whitespace-pre-line text-paper-200', g.d));
      for (const [no, note] of Object.entries(g.n ?? {})) {
        const li = sec.items[Number(no)];
        if (!li) continue;
        const box = li.querySelector('[data-note-icon]');
        const name = cfg.items[b.groups[i].items[Number(no)]]?.name ?? '';
        // 안쪽 아이콘의 이름 툴팁이 먼저 잡히지 않게 지운다 (이미 마우스를 올렸으면 data-tip 으로 옮겨 가 있다)
        for (const attr of ['title', 'data-tip', 'data-tip-delay']) box?.firstElementChild?.removeAttribute(attr);
        li.dataset.tip = `${name}\n${note}`;
        li.tabIndex = 0;
        box?.append(el('span', 'note-dot'));
        li.append(el('span', 'sr-only', note));
      }
    });
  };

  const openBuild = (b: BuildEntry) => {
    const hero = cfg.heroes[b.hero];
    body.replaceChildren();
    const head = el('header', 'sticky top-0 z-10 flex items-start gap-3 border-b border-line bg-ink-850 px-5 py-4');
    const icon = el('span', 'size-12 flex-none overflow-hidden rounded-sm bg-ink-800');
    if (hero.icon) icon.append(img(hero.icon, 'size-full object-cover'));
    const titles = el('div', 'min-w-0 flex-1');
    const sub = el('p', 'flex flex-wrap items-center gap-x-2 text-xs text-paper-500');
    sub.append(el('span', 'text-paper-400', hero.name), el('span', '', fmt(t.updated, { date: date.format(new Date(b.updatedAt * 1000)) })));
    if (oldPatch(b)) sub.append(el('span', 'text-copper-400', t.oldPatch));
    // 좁은 화면에선 빌드 이름을 자르지 않고, 복사 버튼은 제목 아래로 (오른쪽에 두면 이름·날짜가 찌그러졌다)
    const mobileCopy = copyButton(b.buildId);
    mobileCopy.classList.add('mt-2', 'sm:hidden');
    titles.append(titleLine(b, 'text-lg'), el('p', 'text-sm break-words text-paper-200 sm:truncate', b.name), sub, perfLine(b, 'mt-1'), mobileCopy);
    const close = el('button', 'flex-none rounded-sm px-2 py-1 text-xl leading-none text-paper-400 hover:bg-ink-800 hover:text-paper-50', '×');
    close.type = 'button';
    close.setAttribute('aria-label', t.close);
    close.addEventListener('click', () => dialog.close());
    const right = el('div', 'flex flex-none items-center gap-2');
    const desktopCopy = copyButton(b.buildId);
    desktopCopy.classList.add('max-sm:hidden');
    right.append(desktopCopy, close);
    head.append(icon, titles, right);

    const main = el('div', 'grid grid-cols-[minmax(0,1fr)] gap-5 px-5 py-4');
    const groups = el('div', 'grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-[repeat(2,minmax(0,1fr))]');
    const sections: Array<{ title: HTMLElement; items: HTMLElement[] }> = [];
    for (const g of b.groups) {
      const sec = el('section', 'rounded-sm bg-ink-900 p-2.5');
      const title = el('h3', 'truncate pb-2 text-xs font-semibold text-paper-400', g.name || '—');
      const lis: HTMLElement[] = [];
      sections.push({ title, items: lis });
      sec.append(title);
      const list = el('ul', 'grid grid-cols-[repeat(auto-fill,minmax(3.5rem,1fr))] gap-2');
      for (const id of g.items) {
        const li = el('li', 'flex flex-col items-center gap-1 text-center');
        const icon = el('span', 'relative block');
        icon.dataset.noteIcon = '';
        icon.append(itemIcon(id, 'size-10'));
        li.append(icon, el('span', 'line-clamp-2 text-[0.625rem] leading-tight text-paper-200', cfg.items[id]?.name ?? ''));
        lis.push(li);
        list.append(li);
      }
      sec.append(list);
      groups.append(sec);
    }
    main.append(groups);
    // 옛 능력 id 가 남은 빌드는 표가 비므로 제목째 뺀다 (lib/build-groups.ts skillOrderFits 와 같은 조건)
    if (b.order.length >= 4 && b.order.every((id) => hero.abilities.some((a) => a.id === id))) {
      const skills = el('section');
      skills.append(el('h3', 'pb-1.5 text-xs font-semibold text-paper-400', t.skillOrder), skillGrid(b, hero.abilities));
      main.append(skills);
    }
    const foot = el('p', 'flex flex-wrap items-center justify-between gap-2 text-xs text-paper-500');
    const link = el('a', 'font-semibold text-brass-400 hover:text-brass-200', `${t.openHero} →`);
    // 상위권 인기 1–5위는 작성자가 추천 명단에 없을 수 있다 → top:순위 (pro:undefined 로 가면 다른 빌드가 열렸다)
    link.href = `${cfg.heroPath}${hero.slug}/?build=${encodeURIComponent(b.pro ? `pro:${b.pro}` : `top:${b.topN}`)}#build`;
    foot.append(el('span', '', t.copyHint), link);
    main.append(foot);

    body.append(head, main);
    body.scrollTop = 0;
    state.open = b.buildId;
    syncUrl();
    if (!dialog.open) dialog.showModal();
    // 창은 바로 뜨고 설명은 도착하면 붙는다. 그사이 다른 빌드로 바뀌었으면(이 창의 묶음이 화면에 없으면) 붙이지 않는다
    void loadNotes(b.hero).then((all) => {
      if (all && main.isConnected) applyNotes(b, sections, all);
    });
  };

  // ─── 도구 막대 ────────────────────────────────────────────────
  const bar = el('div', 'flex flex-wrap items-center gap-3');
  const select = el('select', 'field w-auto min-w-40');
  select.setAttribute('aria-label', t.proLabel);
  select.append(new Option(t.allPros, ''));
  for (const p of pros) select.append(new Option(`${p} (${cfg.builds.filter((b) => b.pro === p).length})`, p));
  select.addEventListener('change', () => {
    state.pro = select.value;
    state.shown = PAGE;
    render();
  });
  // 정렬 — 최근 수정 · 판수 · 승률 (2026-10-22)
  const sortSeg = el('div', 'seg');
  sortSeg.setAttribute('role', 'group');
  sortSeg.setAttribute('aria-label', t.sortLabel);
  const sortButtons = (
    [
      ['new', t.sortNew],
      ['games', t.sortGames],
      ['win', t.sortWin],
    ] as const
  ).map(([key, label]) => {
    const b = el('button', '', label);
    b.type = 'button';
    b.addEventListener('click', () => {
      // 눌린 버튼을 다시 누르면 해제 — 영웅을 고른 기본 순서로 돌아갈 수 있게
      state.sort = state.sort === key ? undefined : key;
      state.shown = PAGE;
      render();
    });
    sortSeg.append(b);
    return [key, b] as const;
  });
  const count = el('span', 'ml-auto text-xs text-paper-400 tabular-nums');
  bar.append(select, sortSeg, count);

  // 영웅 고르기 — 줄바꿈 (모바일도 — 한 줄 가로 스크롤은 찾기 불편하다는 사용자 의견, 2026-11-03). 모바일은 초상을 조금 작게
  const strip = el('div', '-mx-1 mt-2 flex flex-wrap gap-1 px-1 py-1 sm:gap-1.5');
  strip.setAttribute('role', 'group');
  strip.setAttribute('aria-label', t.heroLabel);
  const allBtn = el('button', '', t.allHeroes);
  allBtn.type = 'button';
  allBtn.addEventListener('click', () => {
    state.hero = '';
    state.shown = PAGE;
    render();
  });
  strip.append(allBtn);
  const heroButtons = Object.values(cfg.heroes)
    .sort((a, b) => a.name.localeCompare(b.name, cfg.locale))
    .map((h) => {
      const b = el('button', 'grid size-8 flex-none place-items-center overflow-hidden rounded-sm bg-ink-850 sm:size-10');
      b.type = 'button';
      b.title = h.name;
      b.setAttribute('aria-label', h.name);
      if (h.icon) b.append(img(h.icon, 'size-full object-cover'));
      else b.append(el('span', 'text-xs font-bold', h.name.slice(0, 2)));
      b.addEventListener('click', () => {
        state.hero = state.hero === h.slug ? '' : h.slug;
        state.shown = PAGE;
        render();
      });
      strip.append(b);
      return [h.slug, b] as const;
    });

  const grid = el('ul', 'mt-5 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3');
  const empty = el('p', 'mt-8 text-center text-paper-400', t.empty);
  const more = el('button', 'mx-auto mt-5 block rounded-sm bg-ink-900 px-5 py-2 text-sm text-paper-200 ring-1 ring-line ring-inset hover:bg-ink-850 hover:text-paper-50', t.more);
  more.type = 'button';
  more.addEventListener('click', () => {
    state.shown += PAGE;
    render();
  });
  root.append(bar, strip, grid, empty, more);

  // ─── 카드 ─────────────────────────────────────────────────────
  // 카드 전체를 덮는 투명 버튼(작은 창 열기) 위에 복사 버튼만 올려 둔다 — 버튼 안에 버튼을 넣지 않기 위해
  const card = (b: BuildEntry) => {
    const hero = cfg.heroes[b.hero];
    const li = el('li', 'relative flex flex-col gap-3 rounded-md bg-ink-900 p-4 ring-1 ring-line ring-inset transition-colors duration-150 hover:bg-ink-800/60');
    const open = el('button', 'absolute inset-0 rounded-md');
    open.type = 'button';
    open.setAttribute('aria-label', `${hero.name} · ${b.pro ?? ''} · ${b.name}`);
    open.addEventListener('click', () => openBuild(b));

    const head = el('div', 'flex items-center gap-3');
    const icon = el('span', 'size-12 flex-none overflow-hidden rounded-sm bg-ink-850');
    if (hero.icon) icon.append(img(hero.icon, 'size-full object-cover'));
    const titles = el('div', 'min-w-0 flex-1');
    const sub = el('p', 'mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-paper-400');
    sub.append(el('span', 'font-semibold text-brass-200', hero.name), el('span', '', fmt(t.updated, { date: date.format(new Date(b.updatedAt * 1000)) })));
    if (oldPatch(b)) sub.append(el('span', 'text-copper-400', t.oldPatch));
    titles.append(titleLine(b, '', false), sub);
    head.append(icon, titles, copyButton(b.buildId));

    li.append(open, head, el('p', 'truncate text-sm font-semibold text-paper-50', b.name), statLine(b));
    // 미리 보기는 1티어를 빼고 2 → 3 → 4티어 순 (같은 티어 안은 산 순서) 8개 한 줄
    // (2026-10-23 사용자: 초반 아이템부터 다 깔 필요가 없다) — 전체는 창에서
    const items = el('div', 'pointer-events-none mt-auto grid grid-cols-8 gap-1');
    const all = [...new Set(b.groups.flatMap((g) => g.items))];
    const tierOf = (id: number) => cfg.items[id]?.tier ?? 0;
    const core = all.filter((id) => tierOf(id) >= 2).sort((x, y) => tierOf(x) - tierOf(y));
    const preview = (core.length ? core : all).slice(0, PREVIEW);
    for (const id of preview) items.append(itemIcon(id, 'aspect-square w-full'));
    li.append(items);
    return li;
  };

  // ─── 그리기 ───────────────────────────────────────────────────
  // 순서는 종류마다 처음 한 번만 계산해 두고, 그릴 때는 거르기만 한다 (cfg.builds 는 이미 최근 수정 순)
  const gamesOf = (b: BuildEntry) => b.perf?.[0] ?? 0;
  const winOf = (b: BuildEntry) => (b.perf && b.perf[0] >= MIN_GAMES ? b.perf[1] / b.perf[0] : -1);
  const groupOf = (b: BuildEntry) => (b.pro && b.topN ? 0 : gamesOf(b) >= MIN_GAMES ? 1 : 2);
  const compare = {
    games: (a: BuildEntry, b: BuildEntry) => gamesOf(b) - gamesOf(a),
    win: (a: BuildEntry, b: BuildEntry) => winOf(b) - winOf(a),
    // 영웅을 골랐을 때의 기본 순서 (정렬을 직접 고르면 그 정렬) — 추천이면서 상위권 인기 → 나머지 판수 순 → 100판 미만은 최근 수정 순 (2026-11-08 사용자)
    best: (a: BuildEntry, b: BuildEntry) => groupOf(a) - groupOf(b) || (groupOf(a) === 2 ? b.updatedAt - a.updatedAt : gamesOf(b) - gamesOf(a)),
  };
  const orders = new Map<keyof typeof compare, BuildEntry[]>();
  const ordered = (key: keyof typeof compare | 'new') => {
    if (key === 'new') return cfg.builds;
    let list = orders.get(key);
    if (!list) orders.set(key, (list = [...cfg.builds].sort(compare[key])));
    return list;
  };

  const render = () => {
    const heroId = state.hero ? heroIdBySlug.get(state.hero) : undefined;
    const key = state.sort ?? (heroId !== undefined ? 'best' : 'new');
    const list = ordered(key).filter(
      (b) => (!state.pro || b.pro === state.pro) && (heroId === undefined || b.hero === heroId),
    );
    // 지금 작성자 조건에 빌드가 없는 영웅은 흐리게
    const heroesWithBuilds = new Set((state.pro ? cfg.builds.filter((b) => b.pro === state.pro) : cfg.builds).map((b) => b.hero));
    for (const [k, b] of sortButtons) b.setAttribute('aria-pressed', String(key === k));
    select.value = state.pro;
    allBtn.className = `h-8 flex-none rounded-sm px-2.5 text-xs whitespace-nowrap sm:h-10 sm:px-3 sm:text-sm ${state.hero ? 'bg-ink-850 text-paper-400 hover:text-paper-50' : 'bg-brass-400 font-semibold text-ink-950'}`;
    for (const [slug, b] of heroButtons) {
      b.classList.toggle('ring-2', slug === state.hero);
      b.classList.toggle('ring-brass-400', slug === state.hero);
      b.classList.toggle('opacity-50', Boolean(state.hero) && slug !== state.hero);
      b.classList.toggle('opacity-25', !heroesWithBuilds.has(heroIdBySlug.get(slug)!));
    }
    count.textContent = fmt(t.count, { n: num.format(list.length) });
    grid.replaceChildren(...list.slice(0, state.shown).map(card));
    // 페이지가 잡아 둔 한 화면 높이(화면 밀림 방지)는 첫 그리기에서 푼다
    root!.classList.remove('min-h-svh');
    empty.hidden = list.length > 0;
    more.hidden = list.length <= state.shown;
    syncUrl();
  };
  render();

  // 주소에 ?build=ID 가 있으면 그 빌드 창을 연다 (링크 공유)
  const shared = state.open && cfg.builds.find((b) => b.buildId === state.open);
  if (shared) openBuild(shared);
}
