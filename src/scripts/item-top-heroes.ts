/**
 * 아이템 상세 창 [정보 | 통계] 의 '통계' 탭 = 많이 산 영웅 3명 (2026-11-04 — 사용자: 영웅 3등 말고는 굳이, 스크롤도 싫다 → 다른 그래프는 뺐다, src/data/api/item-stats.ts).
 * 영웅 아래 한 줄 = 평균 구매 시각 · 되판 비율 (2026-11-05).
 * 숫자는 아이템 페이지의 #item-heroes-config 에 함께 심는다 (따로 받는 파일 없음). 외부 문자열은 textContent 로만.
 */
import type { ItemTopHeroes } from '../data/api/item-stats';
import { winTone } from '../lib/tip';

export interface ItemHeroesConfig {
  locale: string;
  heroPath: string;
  heroes: Record<number, { name: string; slug: string; icon?: string }>;
  top: ItemTopHeroes;
  t: Record<'title' | 'hint' | 'share' | 'winRate' | 'matches' | 'buyTime' | 'buyTimeValue' | 'sold' | 'soldHint', string>;
}

const cfgEl = document.getElementById('item-heroes-config');
const cfg: ItemHeroesConfig | null = cfgEl ? (JSON.parse(cfgEl.textContent ?? 'null') as ItemHeroesConfig) : null;

type Child = Node | string | null | undefined | false;
function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string | undefined> = {}, ...children: Child[]) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined) node.setAttribute(k, v);
  for (const c of children) if (c) node.append(c);
  return node;
}

/** 이 아이템에 통계(영웅 3명)가 있나 — 없으면 탭 줄을 안 띄운다 */
export const itemHeroesAvailable = (itemId: number) => Boolean(cfg?.top[itemId]?.h.length);

/** container 에 영웅 3명을 그린다 */
export function renderItemTopHeroes(container: HTMLElement, itemId: number) {
  const data = cfg?.top[itemId];
  const list = data?.h;
  if (!cfg || !data || !list?.length) return;
  const { t } = cfg;
  const nf = new Intl.NumberFormat(cfg.locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const nf0 = new Intl.NumberFormat(cfg.locale, { maximumFractionDigits: 0 });
  const pct = (permille: number) => `${nf.format(permille / 10)}%`;
  /** 오른쪽 숫자 칸 — 위 작은 이름, 아래 값 */
  const stat = (label: string, value: string, valueClass = 'text-paper-50', extra = '') =>
    el(
      'span',
      { class: `w-14 flex-none text-right text-xs leading-tight text-paper-400 tabular-nums ${extra}` },
      el('span', { class: 'block whitespace-nowrap' }, label),
      el('span', { class: `block text-sm font-bold ${valueClass}` }, value),
    );

  const rows = list.map(([heroId, share, wr, matches]) => {
    const hero = cfg.heroes[heroId];
    const tone = winTone(wr / 10);
    return el(
      'li',
      {},
      el(
        hero ? 'a' : 'span',
        {
          href: hero ? `${cfg.heroPath}${hero.slug}/` : undefined,
          // 좁은 화면은 간격을 줄여 이름 자리를 넓힌다 (320px 에서 'Abrams' 도 잘렸다)
          class: 'flex items-center gap-2 rounded-md bg-ink-900 px-2.5 py-2 ring-1 ring-line ring-inset transition-colors duration-150 hover:bg-ink-800 sm:gap-3 sm:px-3',
        },
        hero?.icon
          ? el('img', { src: hero.icon, alt: '', width: '32', height: '32', class: 'size-8 flex-none rounded-sm object-cover', loading: 'lazy', decoding: 'async' })
          : el('span', { class: 'size-8 flex-none rounded-sm bg-ink-800' }),
        // 이름은 자르지 않고 두 줄까지 (320px 영어에서 이름 칸이 56px)
        el('span', { class: 'line-clamp-2 min-w-0 flex-1 text-sm leading-tight font-semibold break-words text-paper-50' }, hero?.name ?? `#${heroId}`),
        stat(t.share, pct(share)),
        stat(t.winRate, pct(wr), tone > 0 ? 'text-buff' : tone < 0 ? 'text-nerf' : 'text-paper-50'),
        // 판수는 좁은 화면에선 뺀다 (이름 자리가 모자람)
        stat(t.matches, nf0.format(matches), 'text-paper-50', 'max-sm:hidden'),
      ),
    );
  });

  container.replaceChildren(
    el(
      'section',
      { class: 'px-5 pb-5' },
      // 기준은 제목에 마우스를 올리거나 포커스하면 (Panel 의 hint 와 같은 방식)
      el('h3', { class: 'mb-2 w-fit text-sm font-bold text-paper-50', 'data-tip': t.hint, tabindex: '0', 'aria-description': t.hint }, t.title),
      // grid-cols-1 — 자동 열은 긴 글자에 밀려 320px 에서 넘친다 (#119 리뷰)
      el('ol', { class: 'grid grid-cols-1 gap-1.5' }, ...rows),
      // 아래 한 줄 — 평균 구매 시각 · 되판 비율 (모든 영웅 합계)
      el(
        'p',
        { class: 'mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-paper-400 tabular-nums' },
        el('span', {}, `${t.buyTime} `, el('b', { class: 'text-sm font-bold text-paper-50' }, t.buyTimeValue.replace('{m}', nf0.format(Math.round(data.t / 60))))),
        el(
          'span',
          // 설명은 제목처럼 data-tip — 터치 · 키보드로도 보이게 (#126 리뷰)
          { 'data-tip': t.soldHint, tabindex: '0', 'aria-description': t.soldHint },
          `${t.sold} `,
          // 소수 첫째 자리 — 4티어는 1% 아래가 많다 (#126 리뷰)
          el('b', { class: 'text-sm font-bold text-paper-50' }, pct(data.s)),
        ),
      ),
    ),
  );
}
