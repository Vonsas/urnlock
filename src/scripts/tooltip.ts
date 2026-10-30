/**
 * 사이트 공용 툴팁 (BaseLayout 에서 한 번 불러온다) — 브라우저 기본 title 툴팁(흰 상자)을 사이트 색의 작은 상자로 바꾼다 (2026-10-05).
 *
 * - data-tip: 그래프 칸 등. 마우스를 올리면 바로, 터치는 누르면(다른 곳을 누르거나 스크롤하면 닫힘), 키보드는 포커스하면 보인다 (예전 chart-tip.ts).
 * - title: 마우스를 처음 올릴 때 data-tip 으로 옮기고 title 은 지운다 (기본 흰 상자가 같이 뜨지 않게). 기본 툴팁처럼 조금 기다렸다 보인다.
 *   글자 없는 아이콘 버튼은 title 이 이름 노릇을 하므로 aria-label 이 없으면 그 글을 aria-label 로 남긴다.
 *   스크립트가 나중에 붙이는 title 도 처음 올릴 때 바뀌므로 페이지마다 따로 할 일은 없다.
 * 글은 textContent 로만 넣는다.
 */
const tip = document.createElement('div');
tip.setAttribute('aria-hidden', 'true');
tip.className =
  'pointer-events-none fixed z-[60] hidden max-w-96 rounded-sm border border-line-strong bg-ink-850 px-2.5 py-1.5 text-xs leading-relaxed whitespace-pre-line text-paper-50 shadow-[0_8px_24px_rgb(0_0_0/0.5)]';
document.body.append(tip);

const TITLE_DELAY = 300;
let timer = 0;
let last = { x: 0, y: 0 };

const place = (x: number, y: number) => {
  const r = tip.getBoundingClientRect();
  const left = Math.min(x + 14, innerWidth - r.width - 8);
  const top = y - r.height - 12 < 8 ? y + 18 : y - r.height - 12;
  tip.style.left = `${Math.max(8, left)}px`;
  tip.style.top = `${top}px`;
};
const show = (el: Element) => {
  const text = el.getAttribute('data-tip');
  if (!text) return;
  tip.textContent = text;
  // 열린 창(<dialog> showModal) 은 맨 위 층이라 body 의 상자가 그 뒤에 가려진다 → 창 안에 넣는다
  const host = el.closest('dialog[open]') ?? document.body;
  if (tip.parentElement !== host) host.append(tip);
  tip.classList.remove('hidden');
  place(last.x, last.y);
};
const hide = () => {
  clearTimeout(timer);
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
  const el = target.closest?.('[data-tip]');
  if (!el) return;
  clearTimeout(timer);
  if (el.hasAttribute('data-tip-delay') && tip.classList.contains('hidden')) timer = window.setTimeout(() => show(el), TITLE_DELAY);
  else show(el);
});
document.addEventListener('pointermove', (e) => {
  last = { x: e.clientX, y: e.clientY };
  if (!tip.classList.contains('hidden') && (e.target as Element).closest?.('[data-tip]')) place(e.clientX, e.clientY);
});
// 터치는 손을 떼면 바로 pointerout 이 와서 닫혀 버린다 → 마우스만 여기서 닫고, 터치는 다른 곳을 누르거나 스크롤할 때 닫는다
document.addEventListener('pointerout', (e) => {
  if (e.pointerType !== 'mouse') return;
  const from = (e.target as Element).closest?.('[data-tip]');
  const to = (e.relatedTarget as Element | null)?.closest?.('[data-tip]');
  if (from && from !== to) hide();
});
// 누르면(링크 이동·펼치기) 기본 툴팁처럼 닫는다 — 그래프 칸(data-tip, 지연 없음)은 터치로 보는 용도라 그대로
document.addEventListener('pointerdown', (e) => {
  const target = e.target as Element;
  if (target.closest?.('[data-tip-delay]') || (e.pointerType !== 'mouse' && !target.closest?.('[data-tip]'))) hide();
});
// 키보드로 포커스하면 그 요소 위에 (패널 머리의 기준 설명처럼 tabindex 를 준 data-tip) — 마우스 클릭 포커스는 위 pointer 처리에 맡긴다
let focusTip: Element | null = null;
document.addEventListener('focusin', (e) => {
  const el = (e.target as Element).closest?.('[data-tip]');
  if (!el || !el.matches(':focus-visible')) return;
  const r = el.getBoundingClientRect();
  last = { x: r.left, y: r.top };
  focusTip = el;
  show(el);
});
// 포커스가 빠질 때는 키보드 포커스로 띄운 상자만 닫는다 — 터치로 기준 글자를 누른 뒤 다른 칸을 누르면
// 앞 글자의 focusout 이 방금 띄운 새 상자를 닫아 두 번 눌러야 했다 (PR #13 3차 리뷰). 터치 쪽 닫기는 pointerdown · 스크롤이 맡는다
document.addEventListener('focusout', (e) => {
  if (focusTip && (e.target as Element).closest?.('[data-tip]') === focusTip) {
    focusTip = null;
    hide();
  }
});
addEventListener('scroll', hide, { passive: true });
