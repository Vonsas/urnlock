/**
 * 유저 가이드 — 목록 / 보기 / 쓰기 (2026-10-06). 페이지마다 #guides-config 의 mode 로 갈린다.
 * 가이드는 글쓴이가 직접 만든 구역(상자) 여러 개 — '라인전 · 중반 운영 · 템트리 선택 …' (lib/guide-format).
 * 글은 /api/guides 에서 받아 그리고, 사용자 글은 모두 textContent 로만 넣는다 (서식은 블록 → 직접 만든 노드).
 * 욕설·링크는 쓰는 동안 구역 아래에 바로 알려 주고, 올릴 때 걸리면 그 말과 자리를 짚어 준다 (사용자: 고생해서 쓴 글이 왜 안 올라가는지 알려 줘야).
 * 개발 서버에서 ?guidemock 을 붙이면 예시 글로 그린다 (=in 이면 인증된 상태) — 화면 확인용.
 */
import type { Dictionary } from '../i18n';
import {
  AUTHOR_DISPLAYS,
  IMAGE_TOKEN_G,
  placedImages,
  GENERAL,
  saveDisplay,
  savedDisplay,
  checkGuide,
  excerptOf,
  findLink,
  normalizeBody,
  normalizeTitle,
  parseGuide,
  youtubeId,
  type AuthorDisplay,
  type Block,
  type Guide,
  type GuideError,
  type GuideImage,
  type GuideProblem,
  type GuideSection,
  type GuideSummary,
  type Run,
} from '../lib/guide-format';
import { findProfanity } from '../lib/profanity';
import { getJson, isDown, loadFullSnapshot, loadSnapshot } from './api-result';

export interface GuidesConfig {
  /** list = 영웅 가이드 목록, game = 게임 가이드 목록 (2026-11-04) */
  mode: 'list' | 'game' | 'view' | 'write';
  locale: string;
  heroes: Record<number, { name: string; slug: string; icon?: string }>;
  ranks: Record<number, { name: string; icon?: string }>;
  paths: { list: string; game: string; view: string; write: string; heroes: string; players: string };
  limits: {
    titleMin: number;
    titleMax: number;
    bodyMin: number;
    bodyMax: number;
    sectionTitleMax: number;
    sectionBodyMax: number;
    sectionsMax: number;
    imagesMax: number;
    imagesTotal: number;
  };
  /** 사진 올리기 켜짐 (lib/guide-format GUIDE_IMAGES) */
  images: boolean;
  t: Dictionary['guides'];
}
interface Session {
  account?: { id: number; name: string };
}

const cfgEl = document.getElementById('guides-config');
const root = document.querySelector<HTMLElement>('[data-guides-view]');
// 페이지가 잡아 둔 한 화면 높이(화면 밀림 방지) — 보기 화면은 글을 그린 뒤 푼다. 목록은 그대로 둔다:
// 지금은 가이드가 적어 목록이 짧은데, 풀면 푸터가 화면 안으로 올라와 밀림이 0.24 다 (빈 칸이 생기는 쪽을 골랐다, 2026-11-05)
const settle = () => root?.classList.remove('min-h-svh');

if (cfgEl && root) {
  const cfg = JSON.parse(cfgEl.textContent ?? '{}') as GuidesConfig;
  const t = cfg.t;
  const L = cfg.limits;
  const params = new URLSearchParams(location.search);
  const mock = import.meta.env.DEV && params.has('guidemock') ? params.get('guidemock') || 'out' : null;
  const nf = new Intl.NumberFormat(cfg.locale);
  const df = new Intl.DateTimeFormat(cfg.locale, { dateStyle: 'medium' });
  const fill = (s: string, v: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k: string) => String(v[k] ?? ''));
  // 'general' = 게임 가이드 (영웅 칸 0)
  const heroBySlug = new Map<string, number>([['general', GENERAL], ...Object.entries(cfg.heroes).map(([id, h]) => [h.slug, Number(id)] as [string, number])]);
  const heroName = (id: number) => (id === GENERAL ? t.generalGuide : (cfg.heroes[id]?.name ?? ''));
  const pad = (n: number) => String(n).padStart(2, '0');

  type Child = Node | string | null | undefined | false;
  function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string | undefined> = {}, ...children: Child[]) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) if (v !== undefined) node.setAttribute(k, v);
    for (const c of children) if (c) node.append(c);
    return node;
  }
  const svg = (path: string, cls: string) => {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 16 16');
    s.setAttribute('aria-hidden', 'true');
    s.setAttribute('class', cls);
    s.innerHTML = path; // 고정된 아이콘 모양만 (사용자 글 아님)
    return s;
  };
  const ICON_UP = '<path d="M8 3 3 9h3.5v4h3V9H13z" fill="currentColor"/>';
  const ICON_PLAY = '<path d="M5 3.5v9l7.5-4.5z" fill="currentColor"/>';
  const ICON_PLUS = '<path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/>';
  const ICON_X = '<path d="m4 4 8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"/>';
  const ICON_ARROW_UP = '<path d="M8 12V4M4.5 7.5 8 4l3.5 3.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/>';
  const ICON_ARROW_DOWN = '<path d="M8 4v8M4.5 8.5 8 12l3.5-3.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/>';
  const ICON_IMAGE = '<rect x="2" y="3" width="12" height="10" rx="1" stroke="currentColor" stroke-width="1.5" fill="none"/><path d="m3.5 11.5 3-3 2 2 2-2.5 2 3.5" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linejoin="round"/><circle cx="6" cy="6.5" r="1" fill="currentColor"/>';
  // 게임 가이드 자리 표시 — 펼친 책 모양
  const ICON_BOOK = '<path d="M8 4.5C6.5 3.4 4.4 3 2 3v9.5c2.4 0 4.5.4 6 1.5 1.5-1.1 3.6-1.5 6-1.5V3c-2.4 0-4.5.4-6 1.5Zm0 0V14" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" fill="none"/>';
  const heroIcon = (id: number, cls: string) => {
    if (id === GENERAL) return el('span', { class: `${cls} grid place-items-center bg-ink-800 text-brass-400`, title: t.generalGuide }, svg(ICON_BOOK, 'size-1/2'));
    const h = cfg.heroes[id];
    return h?.icon ? el('img', { src: h.icon, alt: '', class: `${cls} object-cover`, loading: 'lazy' }) : el('span', { class: `${cls} grid place-items-center bg-ink-800 text-xs font-bold` }, h?.name.slice(0, 1));
  };
  const returnTo = () => encodeURIComponent(location.pathname + location.search);
  const signInHref = () => `/api/auth/steam?return=${returnTo()}`;
  const iconBtn = (icon: string, label: string, act: () => void, cls = '') => {
    const b = el('button', { type: 'button', title: label, 'aria-label': label, class: `grid size-8 flex-none place-items-center rounded-sm text-paper-400 transition-colors duration-150 hover:bg-ink-800 hover:text-paper-50 disabled:opacity-30 disabled:hover:bg-transparent ${cls}` }, svg(icon, 'size-4'));
    b.addEventListener('click', act);
    return b;
  };

  /** 작성자 줄 — 휘장 · 닉네임(전적) · 랭크 · 기록상 n판 */
  function authorLine(g: GuideSummary, size: 'sm' | 'md') {
    const rank = g.rank ? cfg.ranks[g.rank.tier] : undefined;
    const rankText = g.rank && rank ? `${rank.name} ${g.rank.sub}` : t.unranked;
    const icon = size === 'md' ? 'size-7' : 'size-5';
    return el(
      'span',
      { class: 'flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5' },
      // 랭크가 없으면 빈 칸 — 단, 완전 익명(랭크·판수 모두 숨김)은 빈 칸도 두지 않는다
      rank?.icon ? el('img', { src: rank.icon, alt: '', title: rankText, class: `${icon} flex-none` }) : g.anonymous ? null : el('span', { class: `${icon} flex-none rounded-sm bg-ink-800`, title: rankText }),
      // 익명이면 닉네임 대신 '익명', 전적 링크 없음
      g.anonymous
        ? el('span', { class: `font-semibold text-paper-300 ${size === 'md' ? 'text-sm' : 'text-xs'}` }, t.anonymous)
        : el('a', { href: `${cfg.paths.players}?id=${g.accountId}`, class: `font-semibold text-paper-100 hover:text-brass-200 ${size === 'md' ? 'text-sm' : 'text-xs'}` }, g.name),
      g.rank || !g.anonymous ? el('span', {}, rankText) : null,
      g.games ? el('span', { class: 'tabular-nums' }, fill(t.games, { n: nf.format(g.games) })) : null,
    );
  }

  // ─── 데이터 (개발 서버 ?guidemock 예시) ───────────────────────
  /** 예시 스크린샷 — 회색 판에 글자만 (실제 게임 화면 대신) */
  const mockShot = (label: string): GuideImage => {
    const c = document.createElement('canvas');
    c.width = 960;
    c.height = 540;
    const g = c.getContext('2d')!;
    g.fillStyle = '#1b2d33';
    g.fillRect(0, 0, 960, 540);
    g.fillStyle = '#5b7a80';
    g.font = 'bold 44px sans-serif';
    g.textAlign = 'center';
    g.fillText(label, 480, 285);
    return { url: c.toDataURL('image/png'), w: 960, h: 540 };
  };
  const mockSections = (): GuideSection[] => [
    { title: '라인전', body: '- 1레벨엔 무리하지 말고 1번으로 견제만\n- 상대가 근접형이면 **패리 타이밍**을 먼저 익히기\n[사진 1]\n- 6분 첫 상점에서 체력 아이템 하나는 꼭', images: [mockShot('글 사이에 넣은 사진')] },
    { title: '중반 운영', body: '가디언을 민 다음엔 바로 옆 라인으로 합류하지 말고 **정글 소울을 먼저** 챙기세요.\n워커를 밀면 아이템 칸이 하나 더 열립니다.', images: [mockShot('스크린샷 예시 2'), { ...mockShot('검토 중 예시'), pending: true }] },
    { title: '템트리 선택', body: '초반엔 마력 위주로 가다가, 15분 전후로 생존 아이템을 하나 섞는 게 좋습니다.\n상대에 순간이동 영웅이 많으면 쿨다운 감소를 먼저.', images: [] },
    { title: '후반 교전', body: '궁은 **진입용이 아니라 마무리용**. 상대 탈출기가 빠진 걸 확인하고 쓰세요.\n- 2번으로 시야 밖에서 위치를 바꾸고\n- 3번은 뒤로 빠지는 적에게', images: [] },
  ];
  let mockList: Guide[] | null = null;
  const MOCK = () =>
    (mockList ??= [
      { id: 'g1', hero: heroBySlug.get('sinclair') ?? 13, title: '라인전부터 한타까지, 싱클레어 기본기', video: 'aaaaaaaaaaa', votes: 42, accountId: 1, name: 'Elendili', anonymous: false, rank: { tier: 11, sub: 2 }, games: 1312, createdAt: 1791100000, updatedAt: 1791190000 },
      { id: 'g2', hero: heroBySlug.get('sinclair') ?? 13, title: '싱클레어 궁 쓰는 타이밍 정리', video: null, votes: 17, accountId: 0, name: '', anonymous: true, rank: { tier: 8, sub: 4 }, games: 214, createdAt: 1791000000, updatedAt: 1791000000 },
      { id: 'g3', hero: heroBySlug.get('abrams') ?? 6, title: '에이브럼스 탱커 빌드와 진입 각 보는 법', video: null, votes: 9, accountId: 0, name: '', anonymous: true, rank: null, games: null, createdAt: 1790900000, updatedAt: 1790900000 },
      { id: 'g5', hero: GENERAL, title: '처음 하는 사람을 위한 데드락 운영 기초', video: null, votes: 31, accountId: 5, name: 'Vonsas', anonymous: false, rank: { tier: 7, sub: 3 }, games: null, createdAt: 1791050000, updatedAt: 1791050000 },
      { id: 'g4', hero: heroBySlug.get('infernus') ?? 2, title: '인페르누스 초반 소울 관리 요령', video: 'aaaaaaaaaaa', votes: 3, accountId: 4, name: 'crayon', anonymous: false, rank: { tier: 9, sub: 1 }, games: 88, createdAt: 1790800000, updatedAt: 1790800000 },
    ].map((g, i) => {
      const sections =
        g.hero === GENERAL
          ? [
              { title: '이기는 방법', body: '상대 본진의 **파트론**을 부수면 이깁니다. 그 전에 라인마다 가디언 → 워커 → 기지 순서로 밀어야 합니다.', images: [] },
              { title: '가디언과 워커', body: '- 가디언을 밀면 그 라인이 열립니다\n- **워커를 밀면 아이템 칸이 하나 더 열립니다**\n- 워커는 혼자 치지 말고 트루퍼와 같이', images: [] },
              { title: '소울 관리', body: '라인 트루퍼 막타와 정글이 소울의 대부분입니다. 싸움이 없을 땐 가까운 정글을 도세요.', images: [] },
            ]
          : i === 0
            ? mockSections()
            : mockSections().slice(0, 2 + (i % 3));
      return { ...g, sections, excerpt: excerptOf(sections), sectionTitles: sections.map((x) => x.title), hasVideo: !!g.video };
    }));

  /** 로그인 표시 쿠키(ul_who)가 있는지 — 없으면 '내 정보' 요청을 아예 보내지 않는다 (#19) */
  const signedIn = () => (mock ? mock === 'in' : document.cookie.split('; ').some((c) => c.startsWith('ul_who=')));
  interface GuideMe {
    voted: boolean;
    mine: boolean;
    votes?: number;
    display?: AuthorDisplay;
    /** 내 글이면 캐시를 안 거친 원본 */
    guide?: Guide;
  }
  /** 로그인 안 했거나 없는 글이면 null, 짧은 시간에 너무 많이 불러 막혔으면 'busy' (#18), 저장소에 닿지 못하면 'down' (#21) */
  async function getMe(id: string): Promise<GuideMe | 'busy' | 'down' | null> {
    if (!signedIn()) return null;
    const res = await getJson<GuideMe>(`/api/guides?id=${encodeURIComponent(id)}&me=1`);
    return res.kind === 'ok' ? res.data : res.kind === 'busy' || res.kind === 'down' ? res.kind : null;
  }

  /** 저장소 · /api 에 닿지 못했는지 — 세션 확인이 실패하면 쓰기 화면이 로그인 대신 '잠시 쉼' 을 보여 준다 (#21) */
  let apiDown = false;
  async function getSession(): Promise<Session> {
    if (mock) return mock === 'in' ? { account: { id: 1, name: 'Vonsas' } } : {};
    const res = await getJson<Session>('/api/session');
    if (res.kind === 'down') apiDown = true;
    return res.kind === 'ok' ? res.data : {};
  }

  const message = (text: string, tone = 'text-paper-400') => el('p', { class: `py-10 text-center ${tone}` }, text);

  // ─── 서식 블록 → 노드 ────────────────────────────────────────
  const runNodes = (rs: Run[]) => rs.map((r) => (r.bold ? el('strong', { class: 'font-bold text-paper-50' }, r.text) : document.createTextNode(r.text)));
  type ShownImage = { url: string; pending?: boolean; w?: number; h?: number };
  /** 들여쓰기 단계별 왼쪽 여백 (0–3단계) */
  const INDENT = ['', 'ml-5', 'ml-10', 'ml-15'];
  /** 내용 블록 → 노드. '[사진 n]' 줄은 그 자리에 n번 사진 (없거나 확인 전이라 비어 있으면 아무것도 안 그림) */
  function renderBlocks(blocks: Block[], images: ShownImage[] = []) {
    return blocks.flatMap((b) => {
      if (b.type === 'img') {
        const im = images[b.n - 1];
        return im?.url ? [figure(im)] : [];
      }
      return [
        b.type === 'h'
          ? el('h3', { class: 'mt-5 text-base font-bold tracking-tight text-paper-50 first:mt-0' }, b.text)
          : b.type === 'ul'
            ? el('ul', { class: 'mt-3 list-disc space-y-1.5 pl-5 marker:text-brass-400 first:mt-0' }, ...b.items.map((it) => el('li', { class: INDENT[it.level] }, ...runNodes(it.runs))))
            : el('p', { class: 'mt-3 first:mt-0' }, ...b.lines.map((l) => el('span', { class: `block ${INDENT[l.level]}` }, ...runNodes(l.runs)))),
      ];
    });
  }
  /** 사진 — 안 뜨면(저장소가 멈췄거나 주소가 바뀜, #21 · #34) 깨진 그림 대신 같은 자리의 빈 칸 */
  function photo(attrs: Record<string, string | undefined>, holder: string) {
    const img = el('img', attrs);
    img.addEventListener(
      'error',
      () => img.replaceWith(el('span', { class: holder, 'aria-hidden': 'true', ...(attrs.width && attrs.height ? { style: `aspect-ratio:${attrs.width}/${attrs.height}` } : {}) })),
      { once: true },
    );
    return img;
  }
  /** 글 사이에 넣은 사진 한 장 — 넓게, 누르면 크게 */
  function figure(im: ShownImage) {
    // 작은 사진은 늘리지 않고 원래 크기로 (늘리면 흐려진다), 큰 사진은 칸 너비·36rem 높이 안으로. 가로세로를 알면 자리를 미리 잡아 글이 덜컹이지 않게
    const size = im.w && im.h ? { width: String(im.w), height: String(im.h) } : {};
    const btn = el(
      'button',
      { type: 'button', class: 'block w-full overflow-hidden rounded-sm bg-ink-850' },
      photo({ src: im.url, alt: '', loading: 'lazy', ...size, class: `mx-auto block h-auto max-h-[36rem] max-w-full object-contain ${im.pending ? 'opacity-40' : ''}` }, 'mx-auto block aspect-video w-full max-h-[36rem] bg-ink-850'),
    );
    btn.addEventListener('click', () => openImage(im.url));
    return el(
      'figure',
      { class: 'relative mt-4 first:mt-0' },
      btn,
      im.pending ? el('span', { class: 'pointer-events-none absolute top-2 left-2 rounded-sm bg-ink-950/90 px-2 py-0.5 text-xs font-semibold text-paper-200' }, t.imagePending) : null,
    );
  }

  // 사진 크게 보기 — 창 하나를 같이 쓴다
  let lightbox: HTMLDialogElement | undefined;
  function openImage(src: string) {
    if (!lightbox) {
      const img = el('img', { alt: '', class: 'max-h-[85vh] max-w-full object-contain' });
      const close = el('button', { type: 'button', class: 'absolute top-2 right-2 grid size-9 place-items-center rounded-sm bg-ink-950/85 text-paper-100 hover:text-paper-50', 'aria-label': t.close }, svg(ICON_X, 'size-4'));
      lightbox = el('dialog', { class: 'm-auto max-w-[min(96vw,1400px)] bg-transparent p-0 backdrop:bg-ink-950/90' }, el('div', { class: 'relative' }, img, close));
      close.addEventListener('click', () => lightbox!.close());
      lightbox.addEventListener('click', (e) => e.target === lightbox && lightbox.close());
      document.body.append(lightbox);
    }
    lightbox.querySelector('img')!.src = src;
    lightbox.showModal();
  }
  /** 구역 사진 줄 — 1장이면 넓게, 여러 장이면 칸 나눔. 검토 중인 사진은 흐리게 + 표시 (글쓴이 본인만 받는다) */
  function imageGrid(images: { url: string; pending?: boolean }[], extra?: (i: number) => Node | null, compact = false) {
    return el(
      'div',
      { class: `grid gap-2 ${compact ? 'grid-cols-3' : `mt-4 ${images.length === 1 ? 'grid-cols-1' : 'grid-cols-2 sm:grid-cols-3'}`}` },
      ...images.map((im, i) => {
        const btn = el('button', { type: 'button', class: 'block w-full overflow-hidden rounded-sm bg-ink-850' }, photo({ src: im.url, alt: '', loading: 'lazy', class: `aspect-video w-full object-cover ${im.pending ? 'opacity-40' : ''}` }, 'block aspect-video w-full bg-ink-850'));
        btn.addEventListener('click', () => openImage(im.url));
        return el(
          'div',
          { class: 'relative' },
          btn,
          im.pending ? el('span', { class: 'pointer-events-none absolute top-2 left-2 rounded-sm bg-ink-950/90 px-2 py-0.5 text-xs font-semibold text-paper-200' }, t.imagePending) : null,
          extra?.(i) ?? null,
        );
      }),
    );
  }
  /** 구역 상자 하나 (보기 화면 · 쓰기 미리 보기 공용) */
  function sectionBox(x: { title: string; body: string; images: ShownImage[] }, i: number) {
    // 자리 표시가 없는 사진은 구역 맨 아래에 모아서
    const placed = placedImages(x.body);
    const rest = x.images.filter((im, k) => im.url && !placed.has(k + 1));
    return el(
      'section',
      { id: `s${i + 1}`, class: 'panel scroll-mt-6' },
      el(
        'h2',
        { class: 'flex items-baseline gap-3 border-b border-line px-5 py-3.5 sm:px-6' },
        el('span', { class: 'text-sm font-bold text-brass-400 tabular-nums' }, pad(i + 1)),
        el('span', { class: 'text-lg font-extrabold tracking-tight text-paper-50' }, x.title),
      ),
      el('div', { class: 'px-5 py-4 text-[0.9375rem] leading-7 text-paper-200 sm:px-6 sm:py-5' }, ...renderBlocks(parseGuide(x.body), x.images), rest.length ? imageGrid(rest) : null),
    );
  }
  const videoCard = (id: string) =>
    el(
      'a',
      { href: `https://www.youtube.com/watch?v=${id}`, target: '_blank', rel: 'noopener noreferrer', class: 'panel group flex items-center gap-4 p-3 transition-colors duration-150 hover:bg-ink-850' },
      el(
        'span',
        { class: 'relative block aspect-video w-36 flex-none overflow-hidden rounded-sm bg-ink-850 sm:w-44' },
        el('img', { src: `https://i.ytimg.com/vi/${id}/mqdefault.jpg`, alt: '', loading: 'lazy', class: 'size-full object-cover' }),
        el('span', { class: 'absolute inset-0 grid place-items-center' }, el('span', { class: 'grid size-9 place-items-center rounded-sm bg-ink-950/85 text-paper-50' }, svg(ICON_PLAY, 'size-4'))),
      ),
      el('span', { class: 'min-w-0' }, el('span', { class: 'block font-bold text-paper-50 group-hover:text-brass-200' }, t.watch), el('span', { class: 'mt-0.5 block text-xs text-paper-500' }, 'YouTube ↗')),
    );

  // ─── 목록 ───────────────────────────────────────────────────
  async function renderList(game: boolean) {
    // hero: 'heroes' 영웅 가이드 전체 · 영웅 slug · 'general' 게임 가이드(영웅 칸 0).
    // 게임 가이드는 2026-10-09 목록에서 뺐다가 2026-11-04 따로 페이지로 (/guides/game/, 사용자: 메뉴 '가이드' 아래 영웅 · 게임 가이드로 아예 분리)
    const fromUrl = params.get('hero');
    // 예전 주소 ?hero=general 은 게임 가이드 페이지로
    if (!game && fromUrl === 'general') {
      const keep = new URLSearchParams();
      if (params.get('sort') === 'new') keep.set('sort', 'new');
      if (mock) keep.set('guidemock', mock);
      location.replace(`${cfg.paths.game}${keep.toString() ? `?${keep}` : ''}`);
      return;
    }
    const state = { hero: game ? 'general' : fromUrl && fromUrl !== 'general' && heroBySlug.has(fromUrl) ? fromUrl : 'heroes', sort: params.get('sort') === 'new' ? 'new' : 'votes' };
    // 위: 영웅 초상 줄 → 아래: [추천순 | 최신순]
    const sortBtns = (['votes', 'new'] as const).map((k) => {
      const b = el('button', { type: 'button' }, k === 'votes' ? t.sortVotes : t.sortNew);
      b.addEventListener('click', () => {
        state.sort = k;
        void load();
      });
      return [k, b] as const;
    });
    const count = el('span', { class: 'ml-auto text-xs text-paper-500 tabular-nums' });
    const strip = el('div', { class: '-mx-4 flex gap-1.5 overflow-x-auto px-4 py-1 [scrollbar-width:none] sm:-mx-1 sm:flex-wrap sm:px-1 [&::-webkit-scrollbar]:hidden', role: 'group', 'aria-label': t.heroLabel });
    const heroBtns = Object.entries(cfg.heroes)
      .sort((a, b) => a[1].name.localeCompare(b[1].name, cfg.locale))
      .map(([id, h]) => {
        const b = el('button', { type: 'button', title: h.name, 'aria-label': h.name, class: 'grid size-10 flex-none place-items-center overflow-hidden rounded-sm bg-ink-850 transition-opacity duration-150' }, heroIcon(Number(id), 'size-full'));
        b.addEventListener('click', () => {
          // 고른 초상을 다시 누르면 영웅 가이드 전체로
          state.hero = state.hero === h.slug ? 'heroes' : h.slug;
          void load();
        });
        return [h.slug, b] as const;
      });
    strip.append(...heroBtns.map(([, b]) => b));
    const sortBar = el('div', { class: 'mt-4 flex flex-wrap items-center gap-3' }, el('div', { class: 'seg', role: 'group' }, ...sortBtns.map(([, b]) => b)), count);
    const grid = el('ul', { class: 'mt-5 grid grid-cols-1 gap-3 md:grid-cols-2' });
    // 게임 가이드엔 영웅 초상 줄이 없다
    root!.replaceChildren(...(game ? [] : [strip]), sortBar, grid);

    const card = (g: GuideSummary) =>
      el(
        'li',
        {},
        el(
          'a',
          { href: `${cfg.paths.view}?id=${g.id}`, class: 'panel flex h-full flex-col gap-2.5 p-4 transition-colors duration-150 hover:bg-ink-850' },
          el(
            'span',
            { class: 'flex items-start gap-3' },
            heroIcon(g.hero, 'size-11 flex-none rounded-sm'),
            el(
              'span',
              { class: 'min-w-0 flex-1' },
              el('span', { class: 'block text-xs font-semibold text-brass-200' }, heroName(g.hero)),
              el('span', { class: 'mt-0.5 line-clamp-2 block text-base leading-snug font-bold tracking-tight text-paper-50' }, g.title),
            ),
            el('span', { class: 'flex flex-none items-center gap-1 rounded-sm bg-ink-850 px-2 py-1 text-xs font-bold text-brass-200 tabular-nums', title: fill(t.votes, { n: g.votes }) }, svg(ICON_UP, 'size-3'), nf.format(g.votes)),
          ),
          // 구역 이름들 — 이 가이드가 무엇을 다루는지 한눈에
          el('span', { class: 'flex flex-wrap gap-1' }, ...g.sectionTitles.slice(0, 6).map((s) => el('span', { class: 'rounded-sm bg-ink-850 px-1.5 py-0.5 text-xs text-paper-300' }, s))),
          el('span', { class: 'line-clamp-2 text-sm leading-relaxed text-paper-400' }, g.excerpt),
          el(
            'span',
            { class: 'mt-auto flex items-center gap-3 pt-1 text-xs text-paper-500' },
            authorLine(g, 'sm'),
            g.hasVideo ? el('span', { class: 'flex flex-none items-center text-paper-400', title: t.watch }, svg(ICON_PLAY, 'size-3')) : null,
            el('span', { class: 'ml-auto flex-none tabular-nums' }, df.format(new Date(g.createdAt * 1000))),
          ),
        ),
      );

    // 빨리 다른 영웅을 누르면 늦게 온 앞 요청이 목록을 덮지 않게 (마지막 요청만 그린다)
    let seq = 0;
    async function load() {
      const my = ++seq;
      sortBtns.forEach(([k, b]) => b.setAttribute('aria-pressed', String(k === state.sort)));
      const picked = state.hero !== 'heroes';
      heroBtns.forEach(([slug, b]) => {
        const on = slug === state.hero;
        b.setAttribute('aria-pressed', String(on));
        b.classList.toggle('ring-2', on);
        b.classList.toggle('ring-brass-400', on);
        b.classList.toggle('opacity-60', picked && !on);
      });
      const q = new URLSearchParams();
      if (!game && state.hero !== 'heroes') q.set('hero', state.hero);
      if (state.sort === 'new') q.set('sort', 'new');
      if (mock) q.set('guidemock', mock);
      history.replaceState(null, '', q.toString() ? `?${q}` : location.pathname);
      grid.replaceChildren(el('li', { class: 'md:col-span-2' }, message(t.loading)));
      const heroId = state.hero ? heroBySlug.get(state.hero) : undefined;
      let list: GuideSummary[];
      // 저장소에 닿지 못해 빌드 때 구운 스냅샷으로 그렸는지 (#21)
      let stale = false;
      try {
        if (mock) list = MOCK().filter((g) => (state.hero === 'heroes' ? g.hero !== GENERAL : heroId === undefined || g.hero === heroId)).sort((a, b) => (state.sort === 'new' ? b.createdAt - a.createdAt : b.votes - a.votes));
        else {
          const res = await getJson<{ guides: GuideSummary[] }>(`/api/guides?${new URLSearchParams({ ...(state.hero === 'heroes' ? { hero: 'heroes' } : heroId !== undefined ? { hero: String(heroId) } : {}), sort: state.sort })}`);
          if (res.kind === 'busy') throw new Error('busy');
          if (res.kind === 'ok') list = res.data.guides;
          else {
            // 저장소가 멈췄거나 /api 가 없다(예비 배포) — 빌드 때 구운 스냅샷에서 같은 조건으로 (#21)
            const snap = await loadSnapshot();
            if (!snap) throw new Error();
            stale = true;
            list = snap.guides
              .filter((g) => (state.hero === 'heroes' ? g.hero !== GENERAL : heroId === undefined || g.hero === heroId))
              .sort((a, b) => (state.sort === 'new' ? b.createdAt - a.createdAt : b.votes - a.votes))
              .slice(0, 60);
          }
        }
      } catch (e) {
        // 짧은 시간에 너무 많이 부르면 함수가 429 'busy' 를 준다 (#18) — 일반 오류와 문구를 나눈다
        if (my === seq) grid.replaceChildren(el('li', { class: 'md:col-span-2' }, message((e as Error).message === 'busy' ? t.errBusy : t.loadError, 'text-nerf')));
        return;
      }
      if (my !== seq) return;
      count.textContent = fill(t.count, { n: nf.format(list.length) });
      grid.replaceChildren(
        ...(stale ? [el('li', { class: 'text-sm text-paper-200 md:col-span-2' }, t.staleNote)] : []),
        ...(list.length ? list.map(card) : [el('li', { class: 'md:col-span-2' }, message(t.empty))]),
      );
      // 글쓰기 버튼은 지금 고른 영웅을 들고 간다 (게임 가이드 페이지는 'general')
      const write = document.querySelector<HTMLAnchorElement>('[data-guides-write-link]');
      const pre = state.hero === 'heroes' ? '' : state.hero;
      if (write) write.href = `${cfg.paths.write}${pre ? `?hero=${pre}` : ''}${mock ? `${pre ? '&' : '?'}guidemock=${mock}` : ''}`;
    }
    void load();
  }

  // ─── 보기 ───────────────────────────────────────────────────
  async function renderView() {
    const id = params.get('id') ?? '';
    root!.replaceChildren(message(t.loading));
    let guide: Guide | undefined;
    let voted = false;
    let mine = false;
    let stale = false;
    try {
      if (mock) {
        guide = MOCK().find((g) => g.id === id) ?? MOCK()[0];
        mine = mock === 'in' && guide.accountId === 1;
      }
      else {
        // 공개 본문(CDN 60초)과 내 정보(로그인했을 때만)를 같이 받는다
        const [res, meRes] = await Promise.all([getJson<{ guide: Guide }>(`/api/guides?id=${encodeURIComponent(id)}`), getMe(id)]);
        // 내 정보가 막혀도 공개 본문은 그대로 보인다 (추천 · 수정 단추만 늦게)
        const me = meRes === 'busy' || meRes === 'down' ? null : meRes;
        if (res.kind === 'missing') guide = undefined;
        else if (res.kind === 'busy') throw new Error('busy');
        else if (res.kind === 'ok') guide = res.data.guide;
        else {
          // 저장소가 멈췄거나 /api 가 없다(예비 배포) — 스냅샷에서 (#21). 스냅샷에도 없으면 '못 불러옴' (없는 글이라고 단정하지 않는다)
          guide = (await loadFullSnapshot())?.guides.find((x) => x.id === id);
          if (!guide) throw new Error();
          stale = true;
        }
        // 올린 직후라 캐시된 404 가 남았어도 내 글이면 원본으로
        if (!guide && me?.guide) guide = me.guide;
        if (guide && me) {
          ({ voted, mine } = me);
          // 캐시된 본문이 1분쯤 늦을 수 있어 — 내 글은 원본으로(고친 직후 옛 내용이 보이지 않게), 추천 수는 지금 값으로
          if (me.guide) guide = me.guide;
          else if (me.votes !== undefined) guide.votes = me.votes;
        }
      }
    } catch (e) {
      root!.replaceChildren(message((e as Error).message === 'busy' ? t.errBusy : t.loadError, 'text-nerf'));
      settle();
      return;
    }
    // 게임 가이드는 게임 가이드 목록으로
    const listPath = guide?.hero === GENERAL ? cfg.paths.game : cfg.paths.list;
    const back = el('a', { href: listPath, class: 'text-sm text-paper-400 hover:text-paper-50' }, `← ${t.back}`);
    if (!guide) {
      root!.replaceChildren(back, message(t.notFound));
      settle();
      return;
    }
    const g = guide;
    document.title = `${g.title} · ${document.title}`;
    const hero = cfg.heroes[g.hero];
    const voteCount = el('span', { class: 'tabular-nums' }, nf.format(g.votes));
    const voteLabel = el('span', {}, voted ? t.voted : t.vote);
    const voteBtn = el('button', { type: 'button', 'aria-pressed': String(voted), class: 'flex items-center gap-1.5 rounded-md bg-ink-850 px-3 py-2 text-sm font-bold text-paper-100 ring-1 ring-line transition-colors duration-150 ring-inset hover:bg-ink-800 aria-pressed:bg-brass-400 aria-pressed:text-ink-950' }, svg(ICON_UP, 'size-3.5'), voteLabel, voteCount);
    const status = el('p', { class: 'text-xs text-paper-500', role: 'status' });
    voteBtn.addEventListener('click', async () => {
      const session = await getSession();
      // 저장소 · /api 에 닿지 못하면 '로그인 필요' 가 아니라 '잠시 쉼' (#21)
      if (apiDown || stale) return void (status.textContent = t.errReadonly);
      if (!session.account) {
        status.replaceChildren(t.voteNeedAuth, ' ', el('a', { href: signInHref(), class: 'font-semibold text-brass-400 hover:text-brass-200' }, t.signIn));
        return;
      }
      if (mock) {
        voted = !voted;
        g.votes += voted ? 1 : -1;
      } else {
        const r = await fetch('/api/guide-vote', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: g.id }) });
        if (!r.ok) {
          const { error } = (await r.json().catch(() => ({}))) as { error?: string };
          status.textContent = isDown(r) ? t.errReadonly : error === 'self' ? t.voteSelf : error === 'auth' ? t.voteNeedAuth : error === 'busy' ? t.errBusy : t.errServer;
          return;
        }
        ({ voted, votes: g.votes } = (await r.json()) as { voted: boolean; votes: number });
      }
      voteBtn.setAttribute('aria-pressed', String(voted));
      voteLabel.textContent = voted ? t.voted : t.vote;
      voteCount.textContent = nf.format(g.votes);
    });
    const share = el('button', { type: 'button', class: 'rounded-md px-3 py-2 text-sm font-semibold text-paper-400 hover:bg-ink-850 hover:text-paper-50' }, t.share);
    const quiet = 'rounded-md px-3 py-2 text-sm font-semibold text-paper-500 hover:bg-ink-850 hover:text-paper-50';
    // 내 글이면 수정 · 삭제, 아니면 신고 (2026-10-07 사용자)
    const editLink = mine ? el('a', { href: `${cfg.paths.write}?edit=${g.id}${mock ? `&guidemock=${mock}` : ''}`, class: quiet }, t.edit) : null;
    const delBtn = mine ? el('button', { type: 'button', class: `${quiet} hover:text-nerf` }, t.remove) : null;
    delBtn?.addEventListener('click', async () => {
      if (!confirm(t.deleteConfirm)) return;
      const ok = mock ? true : (await fetch(`/api/guides?id=${g.id}`, { method: 'DELETE' }).catch(() => null))?.ok;
      if (ok) location.href = listPath;
      else status.textContent = t.deleteFailed;
    });
    const reportBtn = mine ? null : el('button', { type: 'button', class: `${quiet} ml-auto` }, t.report);
    const reportBox = el('div', { class: 'mt-3 grid gap-3 rounded-md bg-ink-850 p-4', hidden: '' });
    // 신고는 로그인 없이도 (2026-10-07 사용자) — 같은 글 중복·하루 한도는 서버가 계정 또는 접속 주소로 막는다
    reportBtn?.addEventListener('click', () => (reportBox.hidden = !reportBox.hidden));
    // 신고 사유 — 하나 고르고 (선택) 설명
    let reason = '';
    const reasons = (
      [
        ['abuse', t.reasonAbuse],
        ['spam', t.reasonSpam],
        ['wrong', t.reasonWrong],
        ['other', t.reasonOther],
      ] as const
    ).map(([key, label]) => {
      const b = el('button', { type: 'button', 'aria-pressed': 'false' }, label);
      b.addEventListener('click', () => {
        reason = key;
        reasons.forEach(([k, x]) => x.setAttribute('aria-pressed', String(k === key)));
        send.disabled = false;
      });
      return [key, b] as const;
    });
    const reportText = el('input', { type: 'text', maxlength: '200', placeholder: t.reportPlaceholder, class: 'field h-9' });
    const send = el('button', { type: 'button', disabled: '', class: 'rounded-md bg-ink-800 px-4 py-2 text-sm font-bold text-paper-100 hover:bg-ink-700 disabled:opacity-40' }, t.reportSend);
    const cancel = el('button', { type: 'button', class: 'rounded-md px-3 py-2 text-sm text-paper-400 hover:text-paper-50' }, t.cancel);
    cancel.addEventListener('click', () => (reportBox.hidden = true));
    send.addEventListener('click', async () => {
      send.disabled = true;
      const res = mock
        ? null
        : await fetch('/api/guide-report', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: g.id, reason, text: reportText.value }) }).catch(() => null);
      const ok = mock || !!res?.ok;
      reportBox.hidden = true;
      const error = res && !ok ? ((await res.json().catch(() => ({}))) as { error?: string }).error : undefined;
      status.textContent = ok ? t.reportDone : res && isDown(res) ? t.errReadonly : error === 'busy' ? t.errBusy : t.errServer;
      if (ok) reportBtn!.disabled = true;
    });
    reportBox.append(
      el('p', { class: 'text-sm font-semibold text-paper-200' }, t.reportTitle),
      el('div', { class: 'seg w-fit max-sm:flex-wrap' }, ...reasons.map(([, b]) => b)),
      reportText,
      el('div', { class: 'flex gap-2' }, send, cancel),
    );
    share.addEventListener('click', async () => {
      await navigator.clipboard.writeText(location.href.replace(/[?&]guidemock(=[^&]*)?/, '')).catch(() => {});
      share.textContent = t.copied;
      setTimeout(() => (share.textContent = t.share), 1500);
    });
    const heroHref = g.hero === GENERAL ? cfg.paths.game : `${cfg.paths.heroes}${hero?.slug ?? ''}/#guide`;

    const head = el(
      'header',
      { class: 'panel mt-4 p-5 sm:p-6' },
      el(
        'div',
        { class: 'flex items-start gap-4' },
        el('a', { href: heroHref, class: 'flex-none' }, heroIcon(g.hero, 'size-14 rounded-md sm:size-16')),
        el(
          'div',
          { class: 'min-w-0 flex-1' },
          el('a', { href: heroHref, class: 'text-sm font-semibold text-brass-200 hover:text-brass-100' }, heroName(g.hero)),
          el('h1', { class: 'mt-0.5 text-2xl leading-tight font-extrabold tracking-tight text-paper-50 sm:text-3xl' }, g.title),
          el(
            'p',
            { class: 'mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-paper-500' },
            authorLine(g, 'md'),
            el('span', { class: 'tabular-nums' }, df.format(new Date(g.createdAt * 1000))),
            g.updatedAt > g.createdAt + 60 ? el('span', {}, fill(t.updated, { date: df.format(new Date(g.updatedAt * 1000)) })) : null,
          ),
        ),
      ),
      el('div', { class: 'mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-4' }, voteBtn, share, editLink, delBtn, status, reportBtn),
      reportBox,
    );

    // 목차 — 넓은 화면은 오른쪽에 붙어 따라오고, 좁은 화면은 머리 아래 한 줄
    const tocLinks = (cls: string) => g.sections.map((x, i) => el('a', { href: `#s${i + 1}`, class: cls }, el('span', { class: 'text-brass-400 tabular-nums' }, pad(i + 1)), ' ', x.title));
    const toc = el(
      'nav',
      { class: 'panel hidden p-4 lg:sticky lg:top-6 lg:block', 'aria-label': t.contents },
      el('p', { class: 'mb-2 text-xs font-semibold text-paper-500' }, t.contents),
      el('div', { class: 'grid gap-0.5' }, ...tocLinks('block truncate rounded-sm px-2 py-1.5 text-sm text-paper-300 hover:bg-ink-850 hover:text-paper-50')),
    );
    const tocMobile = el('nav', { class: '-mx-4 mt-3 flex gap-1.5 overflow-x-auto px-4 [scrollbar-width:none] lg:hidden [&::-webkit-scrollbar]:hidden', 'aria-label': t.contents }, ...tocLinks('flex-none rounded-sm bg-ink-900 px-2.5 py-1.5 text-sm text-paper-300'));

    root!.replaceChildren(
      el(
        'div',
        { class: 'mx-auto max-w-5xl' },
        back,
        stale ? el('p', { class: 'mt-3 text-sm text-paper-200' }, t.staleNote) : null,
        head,
        tocMobile,
        el(
          'div',
          { class: 'mt-4 grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_14rem]' },
          el('div', { class: 'grid gap-4' }, g.video ? videoCard(g.video) : null, ...g.sections.map(sectionBox)),
          toc,
        ),
      ),
    );
    settle();
    if (location.hash) document.querySelector(location.hash)?.scrollIntoView();
  }

  // ─── 쓰기 ───────────────────────────────────────────────────
  interface DraftImage {
    url: string;
    w: number;
    h: number;
    blob?: Blob;
    /** 서버에 올린 뒤 받은 주소 (수정할 때 원래 사진도 여기) */
    uploaded?: GuideImage;
    /** 운영자 확인 전 */
    pending?: boolean;
  }
  interface DraftSection {
    title: string;
    body: string;
    images: DraftImage[];
    /** 내용 칸의 마지막 커서 위치 — 사진 자리 표시를 넣을 곳 */
    caret?: number;
  }
  const DRAFT_KEY = 'dldb:guide-draft';

  /** 사진은 올리기 전에 브라우저에서 줄인다 (긴 변 1600px, WebP) — 저장 공간 · 보는 사람 데이터 아끼기 */
  async function shrink(file: File): Promise<DraftImage> {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * scale);
    const h = Math.round(bmp.height * scale);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    c.getContext('2d')!.drawImage(bmp, 0, 0, w, h);
    // 서버는 1MB 까지 — 복잡한 그림이라 넘으면 화질을 낮춰 다시
    let blob!: Blob;
    for (const quality of [0.82, 0.7, 0.55]) {
      blob = await new Promise<Blob>((ok, fail) => c.toBlob((b) => (b ? ok(b) : fail(new Error())), 'image/webp', quality));
      if (blob.size <= 1024 * 1024) break;
    }
    return { url: URL.createObjectURL(blob), w, h, blob };
  }

  async function renderWrite() {
    const session = await getSession();
    if (apiDown) return void root!.replaceChildren(message(t.errReadonly, 'text-paper-200'));
    if (!session.account) {
      root!.replaceChildren(
        el(
          'section',
          { class: 'panel max-w-2xl p-6 sm:p-8' },
          el('h2', { class: 'text-xl font-extrabold tracking-tight' }, t.authNeeded),
          el('p', { class: 'mt-3 leading-relaxed text-paper-300' }, t.authWhy),
          el('p', { class: 'mt-2 text-sm text-paper-500' }, t.rules),
          el('a', { href: signInHref(), class: 'mt-6 inline-flex items-center gap-2 rounded-md bg-brass-400 px-5 py-2.5 font-bold text-ink-950 transition-colors duration-150 hover:bg-brass-200' }, t.signIn),
        ),
      );
      return;
    }

    // 수정 (?edit=ID) — 내 글을 받아 채운다 (2026-10-07). 임시 저장은 쓰지 않는다
    const editId = params.get('edit');
    let editing: Guide | undefined;
    let editDisplay: AuthorDisplay | undefined;
    if (editId) {
      try {
        if (mock) {
          editing = MOCK().find((g) => g.id === editId);
          editDisplay = 'public';
        } else {
          // 캐시된 공개 본문이 아니라 원본으로 채운다 — 고친 직후 다시 고칠 때 옛 내용이 들어가지 않게 (#19)
          const j = await getMe(editId);
          if (j === 'busy') return void root!.replaceChildren(message(t.errBusy, 'text-nerf'));
          // 저장소가 멈췄으면 '내 글만 수정' 이 아니라 '잠시 쉼' (#21 리뷰)
          if (j === 'down') return void root!.replaceChildren(message(t.errReadonly, 'text-paper-200'));
          if (j?.mine && j.guide) ({ guide: editing, display: editDisplay } = j);
        }
      } catch {}
      if (!editing) {
        root!.replaceChildren(message(t.notMine, 'text-nerf'));
        return;
      }
      const h1 = document.querySelector('h1');
      if (h1) h1.textContent = t.editTitle;
      document.title = document.title.replace(t.write, t.editTitle);
    }

    // 임시 저장 — 이 브라우저에만, 글자만 (사진은 안 남는다)
    let draft: { hero?: string; title?: string; video?: string; sections?: { title: string; body: string }[] } = {};
    try {
      if (!editing) draft = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? '{}');
    } catch {}
    const sections: DraftSection[] = editing
      ? editing.sections.map((x) => {
          // 운영자가 뺀 사진(주소가 빈 자리)은 버리고 '[사진 n]' 번호를 다시 매긴다
          const renumber = new Map<number, number>();
          const images: DraftImage[] = [];
          x.images.forEach((im, k) => {
            if (!im.url) return;
            images.push({ url: im.url, w: im.w, h: im.h, pending: im.pending, uploaded: im });
            renumber.set(k + 1, images.length);
          });
          const body = x.body.replace(IMAGE_TOKEN_G, (m, d: string) => (renumber.has(Number(d)) ? `[${t.imageToken} ${renumber.get(Number(d))}]` : ''));
          return { title: x.title, body, images };
        })
      : draft.sections?.length
        ? draft.sections.map((x) => ({ ...x, images: [] }))
        : [{ title: '', body: '', images: [] }];
    if (editing) draft = { hero: String(editing.hero), title: editing.title, video: editing.video ? `https://youtu.be/${editing.video}` : '' };

    const field = (label: string, control: Node, extra?: Node | null) =>
      el('label', { class: 'grid gap-1.5' }, el('span', { class: 'flex items-baseline justify-between text-sm font-semibold text-paper-200' }, label, extra ?? null), control);

    const heroGroup = el('optgroup', { label: t.heroesGroup });
    Object.entries(cfg.heroes)
      .sort((a, b) => a[1].name.localeCompare(b[1].name, cfg.locale))
      .forEach(([id, h]) => heroGroup.append(new Option(h.name, id)));
    // 게임 가이드(영웅 칸 0)는 영웅 묶음 위에 (2026-10-09 뺐다가 2026-11-04 다시)
    const heroSel = el('select', { class: 'field h-10' }, new Option(t.pickHero, ''), new Option(t.generalOption, String(GENERAL)), heroGroup);
    const pre = params.get('hero');
    if (pre && heroBySlug.has(pre) && !editing) heroSel.value = String(heroBySlug.get(pre));
    else if (draft.hero) heroSel.value = draft.hero;

    const title = el('input', { type: 'text', maxlength: String(L.titleMax), placeholder: t.titlePlaceholder, class: 'field h-11 text-base font-semibold' });
    title.value = draft.title ?? '';
    const titleCount = el('span', { class: 'text-xs font-normal text-paper-500 tabular-nums' });
    const titleWarn = el('p', { class: 'text-sm text-nerf', hidden: '' });
    const video = el('input', { type: 'url', placeholder: t.videoPlaceholder, class: 'field h-10' });
    video.value = draft.video ?? '';
    const totalCount = el('span', { class: 'text-xs text-paper-500 tabular-nums' });

    /** 쓰는 동안 바로: 욕설 · 링크가 있으면 그 말을 알려 준다 */
    const warnFor = (text: string) => {
      const bad = findProfanity(text);
      if (bad) return fill(t.warnWord, { word: bad.word });
      const link = findLink(text);
      return link ? fill(t.warnLink, { word: link.word }) : '';
    };
    const showWarn = (p: HTMLElement, text: string) => {
      p.textContent = text;
      p.hidden = !text;
    };

    let saveTimer = 0;
    const save = () => {
      if (editing) return;
      clearTimeout(saveTimer);
      saveTimer = window.setTimeout(() => {
        try {
          localStorage.setItem(DRAFT_KEY, JSON.stringify({ hero: heroSel.value, title: title.value, video: video.value, sections: sections.map(({ title, body }) => ({ title, body })) }));
        } catch {}
      }, 400);
    };
    const counts = () => {
      titleCount.textContent = fill(t.chars, { n: title.value.length, max: L.titleMax });
      totalCount.textContent = fill(t.chars, { n: sections.reduce((n, x) => n + x.body.length, 0), max: L.bodyMax });
    };
    let warnTimer = 0;
    title.addEventListener('input', () => {
      counts();
      save();
      clearTimeout(warnTimer);
      warnTimer = window.setTimeout(() => showWarn(titleWarn, warnFor(title.value)), 300);
    });
    heroSel.addEventListener('change', save);
    video.addEventListener('input', save);

    // 구역 상자들
    const list = el('div', { class: 'grid gap-3' });
    const boxes: { box: HTMLElement; name: HTMLInputElement; body: HTMLTextAreaElement; warn: HTMLElement; addFiles: (f: File[]) => Promise<void> }[] = [];
    // 그림 파일이면 형식은 상관없다 (어차피 WebP 로 다시 만든다). SVG 는 그림 안에 글·스크립트가 들 수 있어 받지 않는다
    const isImage = (f: File) => f.type.startsWith('image/') && f.type !== 'image/svg+xml';
    /** 붙여 넣은 것 중 그림 — 캡처 도구에 따라 files 가 비고 items 에만 오는 경우가 있어 둘 다 본다 */
    const clipboardImages = (data: DataTransfer | null) => {
      if (!data) return [];
      const fromItems = [...data.items].filter((it) => it.kind === 'file').map((it) => it.getAsFile()).filter((f): f is File => !!f && isImage(f));
      return fromItems.length ? fromItems : [...data.files].filter(isImage);
    };
    // 마지막으로 누른 구역 — 붙여 넣은 사진이 들어갈 곳
    let lastSection = 0;
    const presetRow = el('div', { class: 'flex flex-wrap items-center gap-1.5' });
    const addBtn = el('button', { type: 'button', class: 'inline-flex items-center gap-1.5 rounded-md bg-ink-850 px-3.5 py-2 text-sm font-bold text-paper-100 ring-1 ring-line transition-colors duration-150 ring-inset hover:bg-ink-800 disabled:opacity-40' }, svg(ICON_PLUS, 'size-3.5'), t.addSection);
    addBtn.addEventListener('click', () => addSection(''));

    function addSection(name: string) {
      if (sections.length >= L.sectionsMax) return;
      // 처음 빈 상자 하나뿐이면 거기에 이름만 넣는다
      if (name && sections.length === 1 && !sections[0].title && !sections[0].body && !sections[0].images.length) sections[0].title = name;
      else sections.push({ title: name, body: '', images: [] });
      drawSections();
      const last = boxes[sections.length - 1];
      (name ? last.body : last.name).focus();
      save();
    }

    function drawSections() {
      boxes.length = 0;
      list.replaceChildren(
        ...sections.map((x, i) => {
          const name = el('input', { type: 'text', maxlength: String(L.sectionTitleMax), placeholder: t.sectionTitlePlaceholder, 'aria-label': t.sectionTitlePlaceholder, class: 'field h-9 min-w-0 flex-1 font-bold' });
          name.value = x.title;
          const body = el('textarea', { maxlength: String(L.sectionBodyMax), placeholder: t.bodyPlaceholder, 'aria-label': `${pad(i + 1)} ${t.fieldBody}`, class: 'field block min-h-40 w-full resize-none overflow-hidden py-2.5 text-[0.9375rem] leading-7' });
          body.value = x.body;
          // 쓰는 만큼 칸이 길어진다 — 칸 안에서 따로 스크롤하지 않게 (2026-10-06 사용자)
          const grow = () => {
            body.style.height = 'auto';
            body.style.height = `${body.scrollHeight + 2}px`;
          };
          requestAnimationFrame(grow);
          // 사진 자리 표시를 넣을 곳 — 마지막 커서 위치
          const keepCaret = () => (x.caret = body.selectionStart);
          for (const ev of ['keyup', 'click', 'select', 'focus']) body.addEventListener(ev, keepCaret);
          const warn = el('p', { class: 'text-sm text-nerf', hidden: '' });
          const count = el('span', { class: 'ml-auto text-xs text-paper-500 tabular-nums' });
          const recount = () => (count.textContent = fill(t.chars, { n: body.value.length, max: L.sectionBodyMax }));
          recount();
          let timer = 0;
          const check = () => {
            clearTimeout(timer);
            timer = window.setTimeout(() => showWarn(warn, warnFor(name.value) || warnFor(body.value)), 300);
          };
          name.addEventListener('input', () => {
            x.title = name.value;
            box.classList.remove('ring-nerf!');
            save();
            check();
          });
          body.addEventListener('input', () => {
            grow();
            keepCaret();
            x.body = body.value;
            box.classList.remove('ring-nerf!');
            recount();
            counts();
            save();
            check();
          });
          check();

          // 서식 도구 — 고른 글자를 감싸거나 줄 앞에 기호를 붙인다
          const tool = (label: string, act: () => void) => {
            const b = el('button', { type: 'button', class: 'rounded-sm px-2 py-1 text-xs font-semibold text-paper-400 hover:bg-ink-800 hover:text-paper-50' }, label);
            b.addEventListener('click', () => {
              act();
              body.focus();
              body.dispatchEvent(new Event('input'));
            });
            return b;
          };
          const bold = tool(t.toolBold, () => {
            const { selectionStart: s, selectionEnd: e, value } = body;
            body.setRangeText(`**${value.slice(s, e)}**`, s, e, 'end');
          });
          const bullet = tool(t.toolList, () => {
            const lineStart = body.value.lastIndexOf('\n', body.selectionStart - 1) + 1;
            body.setRangeText('- ', lineStart, lineStart, 'end');
          });

          // 사진
          const file = el('input', { type: 'file', accept: 'image/*', multiple: '', class: 'hidden' });
          const imgStatus = el('span', { class: 'text-xs text-paper-500' });
          const addImg = el('button', { type: 'button', class: 'inline-flex items-center gap-1.5 rounded-sm px-2 py-1 text-xs font-semibold text-paper-400 hover:bg-ink-800 hover:text-paper-50 disabled:opacity-40' }, svg(ICON_IMAGE, 'size-4'), `${t.addImage} ${x.images.length}/${L.imagesMax}`);
          const totalImages = () => sections.reduce((n, s) => n + s.images.length, 0);
          if (x.images.length >= L.imagesMax || totalImages() >= L.imagesTotal) addImg.setAttribute('disabled', '');
          addImg.addEventListener('click', () => file.click());
          /** 사진 추가 — 파일 고르기 · 붙여 넣기(Ctrl+V) · 끌어다 놓기 모두 여기로 */
          const addFiles = async (files: File[]) => {
            imgStatus.textContent = '';
            for (const f of files) {
              if (x.images.length >= L.imagesMax) {
                imgStatus.textContent = fill(t.errImageLimit, { n: L.imagesMax });
                break;
              }
              if (totalImages() >= L.imagesTotal) {
                imgStatus.textContent = fill(t.errImagesTotal, { n: L.imagesTotal });
                break;
              }
              if (!isImage(f)) {
                imgStatus.textContent = t.errImage;
                continue;
              }
              try {
                x.images.push(await shrink(f));
                // 커서가 있던 자리(없으면 끝)에 한 줄로 '[사진 n]' — 보기 화면에서 그 자리에 사진이 나온다
                const token = `[${t.imageToken} ${x.images.length}]`;
                // 문장 중간을 자르지 않게 커서가 있는 줄의 끝(다음 줄)에 넣는다
                const caret = Math.min(x.caret ?? x.body.length, x.body.length);
                const lineEnd = x.body.indexOf('\n', caret);
                const at = lineEnd < 0 ? x.body.length : lineEnd;
                const before = x.body.slice(0, at);
                const after = x.body.slice(at);
                const pre = before && !before.endsWith('\n') ? '\n' : '';
                const post = after.startsWith('\n') ? '' : '\n';
                x.body = `${before}${pre}${token}${post}${after}`;
                x.caret = (before + pre + token + post).length;
              } catch {
                imgStatus.textContent = t.errImage;
              }
            }
            const msg = imgStatus.textContent;
            drawSections();
            counts();
            save();
            if (msg) boxes[i].box.querySelector('[data-img-status]')!.textContent = msg;
            // 붙여 넣던 자리(자리 표시 다음 줄)로 돌아간다
            const b = boxes[i].body;
            b.focus();
            b.setSelectionRange(x.caret ?? b.value.length, x.caret ?? b.value.length);
          };
          file.addEventListener('change', () => {
            const files = [...(file.files ?? [])];
            file.value = '';
            void addFiles(files);
          });
          // 스크린샷을 복사해 내용 칸에 붙여 넣으면 이 구역 사진으로 (글자는 평소대로 붙여 넣어진다)
          imgStatus.setAttribute('data-img-status', '');

          const move = (d: -1 | 1) => () => {
            [sections[i], sections[i + d]] = [sections[i + d], sections[i]];
            drawSections();
            save();
          };
          const up = iconBtn(ICON_ARROW_UP, t.moveUp, move(-1));
          const down = iconBtn(ICON_ARROW_DOWN, t.moveDown, move(1));
          const del = iconBtn(ICON_X, t.removeSection, () => {
            sections.splice(i, 1);
            if (!sections.length) sections.push({ title: '', body: '', images: [] });
            drawSections();
            counts();
            save();
          }, 'hover:text-nerf');
          if (i === 0) up.setAttribute('disabled', '');
          if (i === sections.length - 1) down.setAttribute('disabled', '');

          const box = el(
            'div',
            { class: 'rounded-md bg-ink-850 ring-1 ring-line ring-inset' },
            el('div', { class: 'flex items-center gap-2 border-b border-line p-2 pl-3' }, el('span', { class: 'w-6 flex-none text-sm font-bold text-brass-400 tabular-nums' }, pad(i + 1)), name, up, down, del),
            el(
              'div',
              { class: 'grid gap-2 p-3' },
              el('div', { class: 'flex flex-wrap items-center gap-1' }, bold, bullet, cfg.images ? addImg : null, count),
              body,
              warn,
              x.images.length
                ? imageGrid(
                    x.images,
                    (k) =>
                      el(
                        'span',
                        {},
                        el('span', { class: 'pointer-events-none absolute bottom-1.5 left-1.5 rounded-sm bg-ink-950/85 px-1.5 py-0.5 text-xs font-semibold text-paper-100' }, `[${t.imageToken} ${k + 1}]`),
                        iconBtn(ICON_X, t.removeImage, () => {
                          URL.revokeObjectURL(x.images[k].url);
                          x.images.splice(k, 1);
                          const n = k + 1;
                          x.body = x.body
                            .replace(IMAGE_TOKEN_G, (m, d: string) => (Number(d) === n ? '\u0000' : Number(d) > n ? `[${t.imageToken} ${Number(d) - 1}]` : m))
                            .replace(/\n?\u0000\n?/g, '\n')
                            .replace(/^\n+/, '');
                          drawSections();
                          counts();
                          save();
                        }, 'absolute top-1.5 right-1.5 bg-ink-950/85 text-paper-100'),
                      ),
                    true,
                  )
                : null,
              file,
              imgStatus,
            ),
          );
          // 사진 파일을 상자에 끌어다 놓아도 된다
          box.addEventListener('dragover', (e) => {
            if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
          });
          box.addEventListener('drop', (e) => {
            const imgs = [...(e.dataTransfer?.files ?? [])].filter(isImage);
            if (!imgs.length) return;
            e.preventDefault();
            void addFiles(imgs);
          });
          boxes.push({ box, name, body, warn, addFiles });
          return box;
        }),
      );
      addBtn.disabled = sections.length >= L.sectionsMax;
      // 빠르게 추가 — 아직 안 쓴 이름만
      const used = new Set(sections.map((x) => x.title.trim()));
      const presets = t.sectionPresets.filter((p) => !used.has(p));
      presetRow.replaceChildren(
        ...(presets.length && sections.length < L.sectionsMax
          ? [
              el('span', { class: 'mr-1 text-xs text-paper-500' }, t.sectionPresetsLabel),
              ...presets.map((p) => {
                const b = el('button', { type: 'button', class: 'rounded-sm bg-ink-850 px-2.5 py-1 text-xs font-semibold text-paper-300 transition-colors duration-150 hover:bg-ink-800 hover:text-paper-50' }, `+ ${p}`);
                b.addEventListener('click', () => addSection(p));
                return b;
              }),
            ]
          : []),
      );
    }
    drawSections();
    counts();

    // 쓰기 / 미리 보기 (글 전체를 실제 보기 화면처럼)
    const preview = el('div', { class: 'grid gap-3', hidden: '' });
    const editArea = el('div', { class: 'grid gap-3' }, list, el('div', { class: 'flex flex-wrap items-center gap-3' }, addBtn, presetRow), el('p', { class: 'text-xs text-paper-500' }, cfg.images ? `${t.formatHelp} · ${t.imagePaste}` : t.formatHelp));
    const tabWrite = el('button', { type: 'button', 'aria-pressed': 'true' }, t.tabWrite);
    const tabPrev = el('button', { type: 'button', 'aria-pressed': 'false' }, t.tabPreview);
    const showPreview = (on: boolean) => {
      tabWrite.setAttribute('aria-pressed', String(!on));
      tabPrev.setAttribute('aria-pressed', String(on));
      editArea.hidden = on;
      preview.hidden = !on;
      if (on)
        preview.replaceChildren(
          ...sections.filter((x) => x.title.trim() || x.body.trim() || x.images.length).map((x, i) => sectionBox({ title: x.title.trim() || pad(i + 1), body: normalizeBody(x.body), images: x.images }, i)),
        );
    };
    tabWrite.addEventListener('click', () => showPreview(false));
    tabPrev.addEventListener('click', () => showPreview(true));

    let display = editDisplay ?? savedDisplay();
    const displayBtns = AUTHOR_DISPLAYS.map((d) => {
      const [label, hint] = d === 'public' ? [t.displayPublic, t.displayPublicHint] : d === 'anon' ? [t.displayAnon, t.displayAnonHint] : [t.displayHidden, t.displayHiddenHint];
      const b = el(
        'button',
        { type: 'button', class: 'flex items-baseline justify-between gap-2 rounded-sm px-3 py-2 text-left text-sm transition-colors duration-150 hover:bg-ink-800 aria-pressed:bg-ink-800 aria-pressed:ring-1 aria-pressed:ring-brass-400 aria-pressed:ring-inset' },
        el('span', { class: 'font-semibold text-paper-100' }, label),
        el('span', { class: 'text-xs text-paper-500' }, hint),
      );
      b.addEventListener('click', () => {
        display = d;
        saveDisplay(d);
        displayBtns.forEach(([k, x]) => x.setAttribute('aria-pressed', String(k === d)));
      });
      return [d, b] as const;
    });
    displayBtns.forEach(([k, x]) => x.setAttribute('aria-pressed', String(k === display)));
    const displayBox = el('div', { class: 'grid gap-1', role: 'group', 'aria-label': t.authorDisplay }, el('p', { class: 'mb-1 text-xs font-semibold text-paper-400' }, t.authorDisplay), ...displayBtns.map(([, b]) => b));

    const status = el('p', { class: 'text-sm', role: 'status' });
    const publish = el('button', { type: 'submit', class: 'w-full rounded-md bg-brass-400 px-5 py-2.5 font-bold text-ink-950 transition-colors duration-150 hover:bg-brass-200 disabled:opacity-50' }, editing ? t.saveEdit : t.publish);
    const where = (p: GuideProblem) =>
      p.field === 'title' ? t.whereTitle : p.section !== undefined ? (sections[p.section]?.title.trim() ? fill(t.whereSection, { name: sections[p.section].title.trim() }) : fill(t.whereSectionNo, { n: p.section + 1 })) : '';
    const errorText = (p: GuideProblem) =>
      ({
        hero: t.errHero,
        titleShort: fill(t.errTitleShort, { n: L.titleMin }),
        titleLong: fill(t.errTitleLong, { n: L.titleMax }),
        bodyShort: fill(t.errBodyShort, { n: L.bodyMin }),
        bodyLong: fill(t.errBodyLong, { n: L.bodyMax }),
        video: t.errVideo,
        sections: fill(t.errSections, { n: L.sectionsMax }),
        sectionTitle: fill(t.errSectionTitle, { n: L.sectionTitleMax }),
        sectionEmpty: t.errSectionEmpty,
        sectionLong: fill(t.errSectionLong, { n: L.sectionBodyMax }),
        images: fill(t.errImagesTotal, { n: L.imagesTotal }),
        link: fill(t.errLink, { word: p.word ?? '', where: where(p) }),
        profanity: fill(t.errProfanity, { word: p.word ?? '', where: where(p) }),
        rate: t.errRate,
        busy: t.errBusy,
        readonly: t.errReadonly,
        banned: t.errBanned,
        auth: t.errAuth,
        server: t.errServer,
      })[p.error];
    /** 문제 자리로 데려가고, 걸린 말이 있으면 그 글자를 골라 둔다 */
    function pointAt(p: GuideProblem) {
      showPreview(false);
      let target: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | undefined;
      if (p.error === 'hero') target = heroSel;
      else if (p.field === 'title') target = title;
      else if (p.section !== undefined && boxes[p.section]) {
        const b = boxes[p.section];
        b.box.classList.add('ring-nerf!');
        target = p.field === 'sectionTitle' ? b.name : b.body;
      }
      if (!target) return;
      target.scrollIntoView({ block: 'center' });
      target.focus();
      if (p.start !== undefined && p.end !== undefined && !(target instanceof HTMLSelectElement)) target.setSelectionRange(p.start, p.end);
    }

    const form = el(
      'form',
      { class: 'grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_18rem]' },
      el(
        'div',
        { class: 'panel grid gap-5 p-5 sm:p-6' },
        field(t.fieldHero, heroSel),
        el('div', { class: 'grid gap-1.5' }, field(t.fieldTitle, title, titleCount), titleWarn),
        el(
          'div',
          { class: 'grid gap-3' },
          el('div', { class: 'flex flex-wrap items-center gap-3' }, el('span', { class: 'text-sm font-semibold text-paper-200' }, t.fieldSections), el('div', { class: 'seg' }, tabWrite, tabPrev), el('span', { class: 'ml-auto' }, totalCount)),
          editArea,
          preview,
        ),
        field(t.fieldVideo, video),
      ),
      el(
        'aside',
        { class: 'panel grid gap-3 p-5 lg:sticky lg:top-6' },
        displayBox,
        publish,
        status,
        el(
          'p',
          { class: 'flex flex-wrap gap-x-3 text-xs text-paper-500' },
          fill(t.signedIn, { name: session.account.name }),
          el('a', { href: `/api/auth/logout?return=${returnTo()}`, class: 'text-paper-400 hover:text-paper-50' }, t.logout),
        ),
        el('p', { class: 'border-t border-line pt-3 text-xs leading-relaxed text-paper-500' }, t.rules),
      ),
    );
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const clean = sections.map((x) => ({ title: normalizeTitle(x.title), body: normalizeBody(x.body), images: x.images }));
      const input = { hero: heroSel.value === '' ? null : Number(heroSel.value), title: normalizeTitle(title.value), video: video.value.trim() };
      const problem = checkGuide({ ...input, sections: clean.map((x) => ({ ...x, images: x.images.length })) });
      status.className = 'text-sm text-nerf';
      if (problem) {
        // 정리(앞뒤 공백 등)로 위치가 어긋날 수 있어, 걸린 말은 원래 칸에서 다시 찾는다
        if (problem.word && problem.section !== undefined) {
          const raw = problem.field === 'sectionTitle' ? sections[problem.section].title : sections[problem.section].body;
          const at = raw.indexOf(problem.word);
          if (at >= 0) Object.assign(problem, { start: at, end: at + problem.word.length });
        }
        status.textContent = errorText(problem);
        pointAt(problem);
        return;
      }
      publish.disabled = true;
      status.className = 'text-sm text-paper-400';
      status.textContent = t.publishing;
      try {
        let id: string | undefined;
        let err: GuideProblem | undefined;
        if (mock) id = editing?.id ?? 'g1';
        else {
          // 사진을 먼저 올려 주소를 받고, 글에는 주소만 넣는다
          const withUrls = [];
          for (const x of clean) {
            const images = [];
            for (const im of x.images) {
              // 한 번 올린 사진은 다시 올리지 않는다 (글이 검사에 걸려 고쳐 올릴 때 한도를 아끼려고)
              if (!im.uploaded) {
                const r = await fetch('/api/guide-image', { method: 'POST', headers: { 'content-type': 'image/webp' }, body: im.blob });
                if (!r.ok) {
                  const { error } = (await r.json().catch(() => ({}))) as { error?: string };
                  status.className = 'text-sm text-nerf';
                  status.textContent = error === 'off' ? t.errImageUpload : isDown(r) ? t.errReadonly : error === 'rate' ? t.errImageRate : error === 'busy' ? t.errBusy : t.errImageUpload;
                  return;
                }
                im.uploaded = (await r.json()) as GuideImage;
              }
              images.push(im.uploaded);
            }
            withUrls.push({ ...x, images });
          }
          const r = await fetch('/api/guides', {
            method: editing ? 'PUT' : 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ ...(editing && { id: editing.id }), ...input, video: youtubeId(input.video) ?? '', sections: withUrls, display }),
          });
          ({ id, problem: err } = (await r.json().catch(() => ({}))) as { id?: string; problem?: GuideProblem });
          // 저장소가 멈췄거나 /api 가 없다(예비 배포) — 문제 자리가 아니라 '잠시 쉼' (#21)
          if (!id && isDown(r)) err = { error: 'readonly' };
        }
        if (id) {
          try {
            localStorage.removeItem(DRAFT_KEY);
          } catch {}
          location.href = `${cfg.paths.view}?id=${id}${mock ? `&guidemock=${mock}` : ''}`;
        } else {
          status.className = 'text-sm text-nerf';
          status.textContent = errorText(err ?? { error: 'server' as GuideError });
          if (err) pointAt(err);
        }
      } catch {
        status.className = 'text-sm text-nerf';
        status.textContent = t.errServer;
      } finally {
        publish.disabled = false;
      }
    });
    // 쓰기 화면 어디서든 Ctrl+V 로 사진을 붙여 넣으면 마지막으로 누른 구역(처음엔 첫 구역)에 들어간다. 글자는 평소대로
    const remember = (e: Event) => {
      const at = boxes.findIndex((b) => b.box.contains(e.target as Node));
      if (at >= 0) lastSection = at;
    };
    list.addEventListener('focusin', remember);
    list.addEventListener('pointerdown', remember);
    document.addEventListener('paste', (e) => {
      const imgs = clipboardImages(e.clipboardData);
      if (!imgs.length || !cfg.images) return;
      e.preventDefault();
      showPreview(false);
      void boxes[Math.min(lastSection, boxes.length - 1)]?.addFiles(imgs);
    });
    root!.replaceChildren(form);
  }

  if (cfg.mode === 'list' || cfg.mode === 'game') void renderList(cfg.mode === 'game');
  else if (cfg.mode === 'view') void renderView();
  else void renderWrite();
}
