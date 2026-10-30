/**
 * 관리자 화면 — 유저 팁 승인 대기 / 공개됨, 가이드 목록과 처리 버튼. API 글은 textContent 로만 넣는다.
 */
interface AdminTip {
  id: string;
  hero: number;
  text: string;
  accountId: number;
  name: string;
  rank: { tier: number; sub: number } | null;
  games: number | null;
  createdAt: number;
  approvedAt?: number;
  status: 'pending' | 'approved';
  display?: 'public' | 'anon' | 'hidden';
}
interface AdminGuide {
  id: string;
  hero: number;
  title: string;
  sections: { title: string; body: string; images: { url: string; pending?: boolean }[] }[];
  accountId: number;
  name: string;
  rank: { tier: number; sub: number } | null;
  games: number | null;
  createdAt: number;
  votes: number;
  display?: 'public' | 'anon' | 'hidden';
  reports?: Array<{ reason: string; text: string; name: string; by: number; at: number; tag?: string }>;
}

const root = document.querySelector<HTMLElement>('[data-admin]');
if (root) {
  const cfg = JSON.parse(document.getElementById('admin-config')?.textContent ?? '{}') as {
    heroes: Record<number, { name: string; slug: string }>;
    ranks: Record<number, string>;
  };
  const login = root.querySelector<HTMLFormElement>('[data-admin-login]')!;
  const msg = root.querySelector<HTMLElement>('[data-admin-msg]')!;
  const view = root.querySelector<HTMLElement>('[data-admin-view]')!;
  const list = root.querySelector<HTMLElement>('[data-admin-list]')!;
  const statusButtons = [...root.querySelectorAll<HTMLButtonElement>('[data-status]')];
  let status: 'pending' | 'approved' | 'guides' | 'photos' | 'reports' = 'approved';
  const df = new Intl.DateTimeFormat('ko', { dateStyle: 'short', timeStyle: 'short' });

  function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text?: string) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  async function act(id: string, action: string, url?: string) {
    const guides = status === 'guides' || status === 'photos' || status === 'reports';
    if (action === 'ban' && !confirm(guides ? '이 계정을 차단하고 이 가이드를 지울까요?' : '이 계정을 차단하고 그 사람의 대기 중인 팁을 모두 지울까요?')) return;
    if (action === 'unpublish' && guides && !confirm('이 가이드를 내릴까요? (지워지고 되돌릴 수 없습니다)')) return;
    const res = await fetch(guides ? '/api/admin/guides' : '/api/admin/tips', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, action, url }) });
    if (res.status === 401) return showLogin('다시 로그인해 주세요.');
    msg.textContent = res.ok ? '처리했습니다.' : res.status === 429 ? '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.' : res.status === 503 ? '저장소에 잠시 닿지 못합니다. 잠시 후 다시 시도해 주세요.' : '처리하지 못했습니다.';
    void load();
  }

  /** 익명 글이면 표시 — 운영자는 실제 계정을 본다 (차단용) */
  const displayLabel = (d?: string) => (d === 'anon' ? el('span', 'text-copper-400', '익명 (랭크·판수)') : d === 'hidden' ? el('span', 'text-copper-400', '완전 익명') : el('span', '', '닉네임 공개'));

  function row(t: AdminTip) {
    const li = el('li', 'grid gap-2 px-4 py-3');
    const head = el('p', 'flex flex-wrap gap-x-3 text-xs text-paper-500');
    const hero = cfg.heroes[t.hero];
    head.append(
      el('span', 'font-semibold text-brass-200', hero?.name ?? `#${t.hero}`),
      el('span', 'text-paper-200', t.name),
      displayLabel(t.display),
      el('span', '', t.rank ? `${cfg.ranks[t.rank.tier] ?? t.rank.tier} ${t.rank.sub}` : '랭크 없음'),
      el('span', '', t.games ? `기록상 ${t.games}판` : '판수 기록 없음'),
      el('span', '', `ID ${t.accountId}`),
      el('span', 'ml-auto', df.format(new Date((t.approvedAt ?? t.createdAt) * 1000))),
    );
    const body = el('p', 'text-sm whitespace-pre-line text-paper-50', t.text);
    const buttons = el('div', 'flex flex-wrap gap-2');
    const btn = (label: string, action: string, cls: string) => {
      const b = el('button', `rounded-sm px-3 py-1 text-xs font-bold ${cls}`, label);
      b.type = 'button';
      b.addEventListener('click', () => void act(t.id, action));
      return b;
    };
    if (t.status === 'pending') buttons.append(btn('공개', 'approve', 'bg-buff/20 text-buff hover:bg-buff/30'), btn('지우기', 'reject', 'bg-ink-800 text-paper-200 hover:bg-ink-700'));
    else buttons.append(btn('내리기', 'unpublish', 'bg-ink-800 text-paper-200 hover:bg-ink-700'));
    buttons.append(btn('계정 차단', 'ban', 'bg-nerf/15 text-nerf hover:bg-nerf/25'));
    if (hero) {
      const a = el('a', 'ml-auto text-xs text-paper-400 hover:text-paper-50', '영웅 페이지 →');
      a.href = `/ko/heroes/${hero.slug}/#guide`;
      a.target = '_blank';
      buttons.append(a);
    }
    li.append(head, body, buttons);
    return li;
  }

  function guideRow(g: AdminGuide) {
    const li = el('li', 'grid gap-2 px-4 py-3');
    const hero = cfg.heroes[g.hero];
    const head = el('p', 'flex flex-wrap gap-x-3 text-xs text-paper-500');
    head.append(
      el('span', 'font-semibold text-brass-200', g.hero === 0 ? '일반' : (hero?.name ?? `#${g.hero}`)),
      el('span', 'text-paper-200', g.name),
      displayLabel(g.display),
      el('span', '', g.rank ? `${cfg.ranks[g.rank.tier] ?? g.rank.tier} ${g.rank.sub}` : '랭크 없음'),
      el('span', '', `추천 ${g.votes}`),
      el('span', '', `ID ${g.accountId}`),
      el('span', 'ml-auto', df.format(new Date(g.createdAt * 1000))),
    );
    const title = el('a', 'font-bold text-paper-50 hover:text-brass-200', g.title);
    (title as HTMLAnchorElement).href = `/ko/guides/view/?id=${g.id}`;
    (title as HTMLAnchorElement).target = '_blank';
    const sections = el('p', 'text-xs text-paper-400', g.sections.map((x) => `${x.title} (${x.body.length}자)`).join(' · '));
    const buttons = el('div', 'flex flex-wrap gap-2');
    const btn = (label: string, action: string, cls: string) => {
      const b = el('button', `rounded-sm px-3 py-1 text-xs font-bold ${cls}`, label);
      b.type = 'button';
      b.addEventListener('click', () => void act(g.id, action));
      return b;
    };
    buttons.append(btn('내리기', 'unpublish', 'bg-ink-800 text-paper-200 hover:bg-ink-700'), btn('계정 차단', 'ban', 'bg-nerf/15 text-nerf hover:bg-nerf/25'));
    li.append(head, title, sections, buttons);
    return li;
  }

  const REASONS: Record<string, string> = { abuse: '욕설·비하', spam: '광고·도배', wrong: '틀린 정보', other: '기타' };
  /** 신고 — 가이드 하나에 신고 내용들, [내리기] [계정 차단] [신고 무시] */
  function reportRow(g: AdminGuide) {
    const li = guideRow(g);
    const reports = g.reports ?? [];
    const box = el('ul', 'grid gap-1 rounded-sm bg-ink-850 p-3 text-xs');
    for (const r of reports) {
      const line = el('li', 'flex flex-wrap gap-x-2 text-paper-300');
      line.append(el('span', 'font-semibold text-nerf', REASONS[r.reason] ?? r.reason), el('span', 'text-paper-100', r.text || '(설명 없음)'), el('span', 'ml-auto text-paper-500', `${r.name || `비로그인 ${r.tag?.slice(1, 7) ?? ''}`} · ${df.format(new Date(r.at * 1000))}`));
      box.append(line);
    }
    li.insertBefore(el('p', 'text-sm font-bold text-nerf', `신고 ${reports.length}건`), li.firstChild);
    const buttons = li.querySelector('div:last-child')!;
    const dismiss = el('button', 'rounded-sm bg-ink-800 px-3 py-1 text-xs font-bold text-paper-200 hover:bg-ink-700', '신고 무시');
    (dismiss as HTMLButtonElement).type = 'button';
    dismiss.addEventListener('click', () => void act(g.id, 'dismissReports'));
    buttons.append(dismiss);
    li.insertBefore(box, buttons);
    return li;
  }

  /** 사진 — 가이드 하나에 남아 있는 사진들, 사진마다 [삭제] (올리면 바로 공개 — 2026-10-09 검토 단계 뺌) */
  function photoRow(g: AdminGuide) {
    const li = el('li', 'grid gap-3 px-4 py-3');
    const head = el('p', 'flex flex-wrap items-baseline gap-x-3 text-xs text-paper-500');
    const title = el('a', 'text-sm font-bold text-paper-50 hover:text-brass-200', g.title) as HTMLAnchorElement;
    title.href = `/ko/guides/view/?id=${g.id}`;
    title.target = '_blank';
    head.append(title, el('span', 'text-paper-200', g.name), displayLabel(g.display), el('span', '', `ID ${g.accountId}`), el('span', 'ml-auto', df.format(new Date(g.createdAt * 1000))));
    const grid = el('div', 'grid grid-cols-2 gap-3 sm:grid-cols-3');
    for (const x of g.sections)
      for (const im of x.images.filter((i) => i.url)) {
        const box = el('div', 'grid gap-1.5');
        const link = el('a', 'block overflow-hidden rounded-sm bg-ink-850') as HTMLAnchorElement;
        link.href = im.url;
        link.target = '_blank';
        const img = el('img', 'aspect-video w-full object-cover') as HTMLImageElement;
        img.src = im.url;
        img.alt = '';
        link.append(img);
        const buttons = el('div', 'flex gap-2');
        const btn = (label: string, action: string, cls: string) => {
          const b = el('button', `rounded-sm px-3 py-1 text-xs font-bold ${cls}`, label);
          b.type = 'button';
          b.addEventListener('click', () => void act(g.id, action, im.url));
          return b;
        };
        buttons.append(btn('삭제', 'rejectImage', 'bg-nerf/15 text-nerf hover:bg-nerf/25'));
        box.append(link, el('span', 'text-xs text-paper-400', x.title), buttons);
        grid.append(box);
      }
    li.append(head, grid);
    return li;
  }

  async function load() {
    if (status === 'reports') {
      const res = await fetch('/api/admin/guides?reports=1');
      if (res.status === 401) return showLogin();
      if (!res.ok) return void (msg.textContent = res.status === 429 ? '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.' : res.status === 503 ? '저장소에 잠시 닿지 못합니다. 잠시 후 다시 시도해 주세요.' : '목록을 불러오지 못했습니다.');
      const { guides } = (await res.json()) as { guides: AdminGuide[] };
      login.hidden = true;
      view.hidden = false;
      list.replaceChildren(...(guides.length ? guides.map(reportRow) : [el('li', 'px-4 py-6 text-sm text-paper-500', '신고된 가이드가 없습니다.')]));
      return;
    }
    if (status === 'photos') {
      const res = await fetch('/api/admin/guides?images=1');
      if (res.status === 401) return showLogin();
      if (!res.ok) return void (msg.textContent = res.status === 429 ? '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.' : res.status === 503 ? '저장소에 잠시 닿지 못합니다. 잠시 후 다시 시도해 주세요.' : '목록을 불러오지 못했습니다.');
      const { guides } = (await res.json()) as { guides: AdminGuide[] };
      login.hidden = true;
      view.hidden = false;
      list.replaceChildren(...(guides.length ? guides.map(photoRow) : [el('li', 'px-4 py-6 text-sm text-paper-500', '사진이 있는 가이드가 없습니다.')]));
      return;
    }
    if (status === 'guides') {
      const res = await fetch('/api/admin/guides');
      if (res.status === 401) return showLogin();
      if (!res.ok) return void (msg.textContent = res.status === 429 ? '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.' : res.status === 503 ? '저장소에 잠시 닿지 못합니다. 잠시 후 다시 시도해 주세요.' : '목록을 불러오지 못했습니다.');
      const { guides } = (await res.json()) as { guides: AdminGuide[] };
      login.hidden = true;
      view.hidden = false;
      list.replaceChildren(...(guides.length ? guides.map(guideRow) : [el('li', 'px-4 py-6 text-sm text-paper-500', '올라온 가이드가 없습니다.')]));
      return;
    }
    const res = await fetch(`/api/admin/tips?status=${status}`);
    if (res.status === 401) return showLogin();
    if (!res.ok) return void (msg.textContent = res.status === 429 ? '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.' : res.status === 503 ? '저장소에 잠시 닿지 못합니다. 잠시 후 다시 시도해 주세요.' : '목록을 불러오지 못했습니다.');
    const { tips } = (await res.json()) as { tips: AdminTip[] };
    login.hidden = true;
    view.hidden = false;
    list.replaceChildren(...(tips.length ? tips.map(row) : [el('li', 'px-4 py-6 text-sm text-paper-500', status === 'pending' ? '승인 대기 중인 팁이 없습니다.' : '공개된 팁이 없습니다.')]));
  }

  function showLogin(text = '') {
    login.hidden = false;
    view.hidden = true;
    msg.textContent = text;
  }

  login.addEventListener('submit', async (e) => {
    e.preventDefault();
    const password = (new FormData(login).get('password') as string) ?? '';
    const res = await fetch('/api/admin/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password }) });
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (res.ok) {
      login.reset();
      msg.textContent = '';
      return void load();
    }
    // JSON 이 아닌 응답(예비 배포엔 /api 가 없어 404 HTML)도 '저장소에 닿지 못함' (#21)
    const notJson = !(res.headers.get('content-type') ?? '').includes('application/json');
    msg.textContent = notJson ? '저장소에 잠시 닿지 못합니다. 잠시 후 다시 시도해 주세요.' : body.error === 'busy' ? '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.' : body.error === 'readonly' ? '저장소에 잠시 닿지 못합니다. 잠시 후 다시 시도해 주세요.' : body.error === 'rate' ? '시도가 너무 많습니다. 15분 뒤에 다시 해 주세요.' : body.error === 'not-configured' ? '관리자 비밀번호가 설정되지 않았습니다 (Vercel 환경 변수).' : '비밀번호가 맞지 않습니다.';
  });
  root.querySelector('[data-admin-logout]')?.addEventListener('click', async () => {
    await fetch('/api/admin/login', { method: 'DELETE' });
    showLogin('로그아웃했습니다.');
  });
  statusButtons.forEach((b) =>
    b.addEventListener('click', () => {
      status = b.dataset.status as typeof status;
      statusButtons.forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      void load();
    }),
  );
  void load();
}
