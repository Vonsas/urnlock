/**
 * 사이트 공용 툴팁 (BaseLayout 에서 한 번 불러온다) — 브라우저 기본 title 툴팁(흰 상자)을 사이트 색의 작은 상자로 바꾼다 (2026-10-05).
 *
 * - data-tip: 그래프 칸 등. 마우스를 올리면 바로, 터치는 누르면(다른 곳을 누르거나 스크롤하면 닫힘), 키보드는 포커스하면 보인다 (예전 chart-tip.ts).
 * - data-tip-rows: 수치 툴팁을 표로 (lib/tip.ts, 2026-11-03) — 있으면 data-tip 글 대신 이걸 그린다.
 * - title: 마우스를 처음 올릴 때 data-tip 으로 옮기고 title 은 지운다 (기본 흰 상자가 같이 뜨지 않게). 기본 툴팁처럼 조금 기다렸다 보인다.
 *   글자 없는 아이콘 버튼은 title 이 이름 노릇을 하므로 aria-label 이 없으면 그 글을 aria-label 로 남긴다.
 *   스크립트가 나중에 붙이는 title 도 처음 올릴 때 바뀌므로 페이지마다 따로 할 일은 없다.
 * - data-tip-first (링크): 터치는 첫 탭에 툴팁, 다음 탭에 이동 — 설명을 볼 길이 툴팁뿐인 링크 (빌드 작성자 설명, 2026-11-06). 마우스 · 키보드는 그대로.
 * 글은 textContent 로만 넣는다.
 */
import type { TipSpec, TipTone } from '../lib/tip';

const tip = document.createElement('div');
tip.setAttribute('aria-hidden', 'true');
tip.className =
  'pointer-events-none fixed z-[60] hidden max-w-[min(24rem,calc(100vw-1rem))] rounded-sm border border-line-strong bg-ink-850 px-2.5 py-1.5 text-xs leading-relaxed break-words whitespace-pre-line text-paper-50 shadow-[0_8px_24px_rgb(0_0_0/0.5)]';
document.body.append(tip);

/** 툴팁이 있는 요소 */
const TIP = '[data-tip],[data-tip-rows]';
const TONE: Record<TipTone, string> = { 1: 'text-buff', [-1]: 'text-nerf', 0: 'text-paper-50' };
const span = (cls: string, text: string) => {
  const s = document.createElement('span');
  s.className = cls;
  s.textContent = text;
  return s;
};
/** 표 모양 — 머리(아이콘 · 이름 | 오른쪽) → 이름 | 값 | 작은 글씨 → 아래 글. 글은 textContent 로만 */
function rows(spec: TipSpec): Node[] {
  const head = document.createElement('div');
  head.className = 'mb-0.5 flex items-center justify-between gap-3 font-bold';
  const name = span('flex items-center gap-1.5', '');
  // 사이트 안 주소만 ('//다른 호스트' 는 뺀다)
  if (spec.icon && /^\/(?!\/)/.test(spec.icon)) {
    const img = document.createElement('img');
    img.src = spec.icon;
    img.alt = '';
    img.className = 'size-4';
    name.append(img);
  }
  name.append(spec.h);
  head.append(name);
  if (spec.hr) head.append(span(TONE[spec.hr[1] ?? 0], spec.hr[0]));
  const grid = document.createElement('div');
  const subs = spec.rows.some((r) => r[3]);
  grid.className = `grid items-baseline gap-x-3 tabular-nums ${subs ? 'grid-cols-[auto_auto_auto]' : 'grid-cols-[auto_auto]'}`;
  for (const [label, value, tone, sub] of spec.rows) {
    grid.append(span('text-paper-400', label), span(`text-right font-bold ${TONE[tone ?? 0]}`, value));
    if (subs) grid.append(span('text-right text-2xs text-paper-500', sub ?? ''));
  }
  const out: Node[] = [head, grid];
  if (spec.f) out.push(span('mt-0.5 block text-2xs text-paper-400', spec.f));
  return out;
}
const parse = (raw: string | null): TipSpec | null => {
  if (!raw) return null;
  try {
    const spec = JSON.parse(raw) as TipSpec;
    return typeof spec?.h === 'string' && Array.isArray(spec.rows) && spec.rows.every(Array.isArray) ? spec : null;
  } catch {
    return null;
  }
};

const TITLE_DELAY = 300;
let timer = 0;
/** data-tip-first: 터치로 한 번 눌러 툴팁이 떠 있는 링크 */
let tapped: Element | null = null;
let touching = false;
let last = { x: 0, y: 0 };

const place = (x: number, y: number) => {
  // 이전 자리(오른쪽 끝)에 있으면 남은 폭만큼 좁게 재진다 → 왼쪽 끝에 두고 잰다
  tip.style.left = '0';
  const r = tip.getBoundingClientRect();
  const left = Math.min(x + 14, innerWidth - r.width - 8);
  const top = y - r.height - 12 < 8 ? y + 18 : y - r.height - 12;
  tip.style.left = `${Math.max(8, left)}px`;
  tip.style.top = `${top}px`;
};
const show = (el: Element) => {
  const spec = parse(el.getAttribute('data-tip-rows'));
  const text = el.getAttribute('data-tip');
  if (spec) tip.replaceChildren(...rows(spec));
  else if (text) tip.textContent = text;
  else return;
  // 열린 창(<dialog> showModal) 은 맨 위 층이라 body 의 상자가 그 뒤에 가려진다 → 창 안에 넣는다
  const host = el.closest('dialog[open]') ?? document.body;
  if (tip.parentElement !== host) host.append(tip);
  tip.classList.remove('hidden');
  place(last.x, last.y);
};
const hide = () => {
  clearTimeout(timer);
  tapped = null;
  tip.classList.add('hidden');
};

/** title → data-tip (한 번만) */
function adopt(el: Element) {
  const title = el.getAttribute('title');
  if (!title) return;
  el.removeAttribute('title');
  el.setAttribute('data-tip', title);
  el.setAttribute('data-tip-delay', '');
  const named = el.getAttribute('aria-label') || el.getAttribute('alt') || el.textContent?.trim();
  if (!named) el.setAttribute('aria-label', title);
}

document.addEventListener('pointerover', (e) => {
  const target = e.target as Element;
  last = { x: e.clientX, y: e.clientY };
  // 터치는 기본 title 도 안 뜨므로 그대로 둔다 (누를 때마다 상자가 뜨면 번거롭다)
  if (e.pointerType === 'mouse') {
    const titled = target.closest?.('[title]');
    if (titled) adopt(titled);
  }
  const el = target.closest?.(TIP);
  if (!el) return;
  clearTimeout(timer);
  if (el.hasAttribute('data-tip-delay') && tip.classList.contains('hidden')) timer = window.setTimeout(() => show(el), TITLE_DELAY);
  else show(el);
});
document.addEventListener('pointermove', (e) => {
  last = { x: e.clientX, y: e.clientY };
  if (!tip.classList.contains('hidden') && (e.target as Element).closest?.(TIP)) place(e.clientX, e.clientY);
});
// 터치는 손을 떼면 바로 pointerout 이 와서 닫혀 버린다 → 마우스만 여기서 닫고, 터치는 다른 곳을 누르거나 스크롤할 때 닫는다
document.addEventListener('pointerout', (e) => {
  if (e.pointerType !== 'mouse') return;
  const from = (e.target as Element).closest?.(TIP);
  const to = (e.relatedTarget as Element | null)?.closest?.(TIP);
  if (from && from !== to) hide();
});
// 누르면(링크 이동·펼치기) 기본 툴팁처럼 닫는다 — 그래프 칸(data-tip, 지연 없음)은 터치로 보는 용도라 그대로
document.addEventListener('pointerdown', (e) => {
  const target = e.target as Element;
  if (target.closest?.('[data-tip-delay]') || (e.pointerType !== 'mouse' && !target.closest?.(TIP))) hide();
});
document.addEventListener(
  'pointerdown',
  (e) => {
    touching = e.pointerType !== 'mouse';
  },
  true,
);
document.addEventListener('keydown', () => {
  touching = false;
});
document.addEventListener('click', (e) => {
  if (!touching) return;
  const link = (e.target as Element).closest?.('a[data-tip-first]');
  if (!link || tapped === link) return;
  e.preventDefault();
  tapped = link;
});
// 키보드로 포커스하면 그 요소 위에 (패널 머리의 기준 설명처럼 tabindex 를 준 data-tip) — 마우스 클릭 포커스는 위 pointer 처리에 맡긴다
let focusTip: Element | null = null;
document.addEventListener('focusin', (e) => {
  const el = (e.target as Element).closest?.(TIP);
  if (!el || !el.matches(':focus-visible')) return;
  const r = el.getBoundingClientRect();
  last = { x: r.left, y: r.top };
  focusTip = el;
  show(el);
});
// 포커스가 빠질 때는 키보드 포커스로 띄운 상자만 닫는다 — 터치로 기준 글자를 누른 뒤 다른 칸을 누르면
// 앞 글자의 focusout 이 방금 띄운 새 상자를 닫아 두 번 눌러야 했다 (PR #13 3차 리뷰). 터치 쪽 닫기는 pointerdown · 스크롤이 맡는다
document.addEventListener('focusout', (e) => {
  if (focusTip && (e.target as Element).closest?.(TIP) === focusTip) {
    focusTip = null;
    hide();
  }
});
// capture — 빌드 창처럼 안쪽에서 스크롤되는 영역도 잡는다. 키보드 포커스 툴팁은 닫지 않고 그 칸을 따라간다 (Tab 이 일으킨 스크롤에 닫히면 안 되고, 닫는 건 focusout 이 한다)
addEventListener(
  'scroll',
  () => {
    if (!focusTip) {
      hide();
      return;
    }
    const r = focusTip.getBoundingClientRect();
    last = { x: r.left, y: r.top };
    place(r.left, r.top);
  },
  { passive: true, capture: true },
);
// 링크로 떠났다가 뒤로 가기로 돌아오면(bfcache) 상자가 남아 있지 않게
addEventListener('pagehide', hide);
