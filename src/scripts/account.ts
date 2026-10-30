/**
 * 헤더 계정 단추 — 표시 쿠키(ul_who = '계정ID.닉네임')만 읽어 그린다 (서버 요청 없음).
 * 로그인 · 로그아웃은 지금 보던 페이지로 돌아온다.
 */
const root = document.querySelector<HTMLElement>('[data-account]');
export {};

if (root) {
  const raw = document.cookie
    .split('; ')
    .find((c) => c.startsWith('ul_who='))
    ?.slice('ul_who='.length);
  let who: { id: number; name: string } | null = null;
  try {
    const value = raw ? decodeURIComponent(raw) : '';
    const dot = value.indexOf('.');
    const id = Number(value.slice(0, dot));
    if (dot > 0 && Number.isInteger(id) && id > 0) who = { id, name: value.slice(dot + 1) || `ID ${id}` };
  } catch {}

  const back = () => encodeURIComponent(location.pathname + location.search + location.hash);
  const login = root.querySelector<HTMLAnchorElement>('[data-account-login]')!;
  const inBox = root.querySelector<HTMLElement>('[data-account-in]')!;
  // 누르는 순간의 주소로 (탭·해시가 바뀌었을 수 있으니)
  login.addEventListener('click', () => (login.href = `/api/auth/steam?return=${back()}`));

  if (who) {
    login.hidden = true;
    inBox.hidden = false;
    root.querySelectorAll('[data-account-name]').forEach((n) => (n.textContent = who!.name));
    root.querySelector<HTMLAnchorElement>('[data-account-record]')!.href = `${root.dataset.players}?id=${who.id}`;
    const logout = root.querySelector<HTMLAnchorElement>('[data-account-logout]')!;
    logout.addEventListener('click', () => (logout.href = `/api/auth/logout?return=${back()}`));

    const toggle = root.querySelector<HTMLButtonElement>('[data-account-toggle]')!;
    const pop = root.querySelector<HTMLElement>('[data-account-pop]')!;
    // 닉네임이 잘렸을 때만 전체 이름을 툴팁으로 (sm–md 는 단추가 6rem 이고 메뉴 안 이름 줄도 없다). 문서의 툴팁 처리보다 먼저 돈다
    const nameEl = toggle.querySelector<HTMLElement>('[data-account-name]')!;
    toggle.addEventListener('pointerover', () => {
      if (nameEl.scrollWidth > nameEl.clientWidth) {
        toggle.setAttribute('data-tip', who!.name);
        toggle.setAttribute('data-tip-delay', '');
      } else toggle.removeAttribute('data-tip');
    });
    const show = (on: boolean) => {
      pop.hidden = !on;
      toggle.setAttribute('aria-expanded', String(on));
    };
    toggle.addEventListener('click', () => show(Boolean(pop.hidden)));
    document.addEventListener('click', (e) => {
      if (!root.contains(e.target as Node)) show(false);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') show(false);
    });
  }
}

// 로그아웃 링크(헤더 · 팁 · 가이드 쓰기)는 POST 로 쿠키를 지운 뒤 돌아갈 주소로 간다 — GET 로그아웃은 다른 사이트가 몰래 부를 수 있어 막았다 (2026-10-14)
document.addEventListener('click', (e) => {
  const a = (e.target as Element).closest?.<HTMLAnchorElement>('a[href^="/api/auth/logout"]');
  if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
  e.preventDefault();
  const back = new URL(a.href, location.href).searchParams.get('return') || '/';
  void fetch('/api/auth/logout', { method: 'POST' })
    .catch(() => undefined)
    .finally(() => location.assign(back.startsWith('/') && !back.startsWith('//') ? back : '/'));
});
