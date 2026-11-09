/** 색 테마 고르기 — 푸터 칸 · 헤더 단추의 펼침 (lib/themes.ts). 처음 붙이는 건 <head> 의 THEME_BOOT, 여기는 누를 때만 */
import { THEME_BAND, THEME_STORAGE_KEY, THEMES, type Theme } from '../lib/themes';

const isTheme = (v: unknown): v is Theme => typeof v === 'string' && (THEMES as readonly string[]).includes(v);
const buttons = [...document.querySelectorAll<HTMLButtonElement>('[data-theme-pick]')];

function current(): Theme {
  const t = document.documentElement.dataset.theme;
  return isTheme(t) ? t : 'teal';
}

function mark() {
  const on = current();
  for (const b of buttons) b.setAttribute('aria-pressed', String(b.dataset.themePick === on));
}

function apply(theme: Theme) {
  const root = document.documentElement;
  if (theme === 'teal') delete root.dataset.theme;
  else root.dataset.theme = theme;
  document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute('content', THEME_BAND[theme]);
  try {
    if (theme === 'teal') localStorage.removeItem(THEME_STORAGE_KEY);
    else localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // 저장소를 못 쓰는 창(사생활 보호 등) — 이 페이지에서만 바뀐다
  }
  mark();
}

for (const b of buttons) {
  b.addEventListener('click', () => {
    const t = b.dataset.themePick;
    if (isTheme(t)) apply(t);
  });
}
mark();

// 헤더 단추의 펼침 — 단추 바로 아래, 오른쪽 끝을 맞춰 놓는다. 열리기 전(beforetoggle)에 자리를 잡아야
// 첫 프레임에 화면 왼쪽 위에 그려졌다 옮겨지지 않는다 (#112 리뷰) — 그때는 폭을 모르니 오른쪽 기준으로
const trigger = document.querySelector<HTMLElement>('[data-theme-trigger]');
const menu = document.querySelector<HTMLElement>('[data-theme-menu]');
if (trigger && menu) {
  menu.addEventListener('beforetoggle', (e) => {
    if ((e as ToggleEvent).newState !== 'open') return;
    const r = trigger.getBoundingClientRect();
    menu.style.top = `${r.bottom + 4}px`;
    // clientWidth — innerWidth 는 세로 스크롤 막대까지 넣어 그만큼(약 15px) 왼쪽으로 밀렸다
    menu.style.right = `${Math.max(8, document.documentElement.clientWidth - r.right)}px`;
  });
  // 키보드로 단추와 펼침 밖으로 나가면 닫는다 ('랭킹' 펼침과 같게)
  for (const n of [trigger, menu])
    n.addEventListener('focusout', (e) => {
      const to = e.relatedTarget as Node | null;
      if (to && (to === trigger || menu.contains(to))) return;
      if (to && menu.matches(':popover-open')) menu.hidePopover();
    });
  // 열린 채로 화면이 움직이면 단추와 떨어지므로 닫는다
  const hide = () => menu.matches(':popover-open') && menu.hidePopover();
  addEventListener('scroll', hide, { passive: true });
  addEventListener('resize', hide);
}
