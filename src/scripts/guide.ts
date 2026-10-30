/**
 * 영웅 '가이드' 탭 — 공개된 유저 팁을 그리고, 스팀 인증한 사람에게 쓰기 칸을 보여준다 (2026-10-06).
 * 탭이 화면에 처음 보일 때만 /api/tips · /api/session 을 부른다. API 에서 온 글은 모두 textContent 로만 넣는다.
 * 개발 서버에서 주소에 ?guidemock 을 붙이면 예시 팁으로 그린다 (?guidemock=in 이면 인증된 상태) — 화면 확인용.
 */
import type { Dictionary } from '../i18n';
import { checkTip, normalizeTip, type PublicTip, type TipError } from '../lib/tips';
import { AUTHOR_DISPLAYS, saveDisplay, savedDisplay, type AuthorDisplay, type GuideSummary } from '../lib/guide-format';
import { findProfanity } from '../lib/profanity';
import { getJson, isDown, loadSnapshot } from './api-result';

export interface GuideConfig {
  heroId: number;
  locale: string;
  maxLength: number;
  /** 전적 페이지 (/ko/players/) — 이름을 누르면 그 사람 전적으로 */
  playerPath: string;
  ranks: Record<number, { name: string; icon?: string }>;
  t: Dictionary['guide'];
  /** 위쪽 '이 영웅 가이드' 칸 */
  guides: { heroName: string; list: string; view: string; write: string; t: Dictionary['guides'] };
}

interface Session {
  account?: { id: number; name: string };
}

const root = document.querySelector<HTMLElement>('[data-guide]');
const cfgEl = root?.querySelector('[data-guide-config]');

if (root && cfgEl) {
  const cfg = JSON.parse(cfgEl.textContent ?? '{}') as GuideConfig;
  const t = cfg.t;
  const list = root.querySelector<HTMLElement>('[data-guide-list]')!;
  const count = root.querySelector<HTMLElement>('[data-guide-count]')!;
  const write = root.querySelector<HTMLElement>('[data-guide-write]')!;
  const guideList = root.querySelector<HTMLElement>('[data-guide-guides]');
  const nf = new Intl.NumberFormat(cfg.locale);
  const df = new Intl.DateTimeFormat(cfg.locale, { dateStyle: 'medium' });
  const fill = (s: string, v: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k: string) => String(v[k] ?? ''));
  const params = new URLSearchParams(location.search);
  const mock = import.meta.env.DEV && params.has('guidemock') ? params.get('guidemock') || 'out' : null;

  type Child = Node | string | null | undefined | false;
  function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string | undefined> = {}, ...children: Child[]) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) if (v !== undefined) node.setAttribute(k, v);
    for (const c of children) if (c) node.append(c);
    return node;
  }

  function tipRow(tip: PublicTip) {
    const rank = tip.rank ? cfg.ranks[tip.rank.tier] : undefined;
    const rankText = tip.rank && rank ? `${rank.name} ${tip.rank.sub}` : t.unranked;
    return el(
      'li',
      { class: 'flex gap-3 px-4 py-3.5' },
      rank?.icon
        ? el('img', { src: rank.icon, alt: '', title: rankText, width: '28', height: '28', class: 'mt-0.5 size-7 flex-none', loading: 'lazy' })
        : // 완전 익명은 빈 회색 칸 대신 자리만 (팁 글줄이 나란히 맞게)
          el('span', { class: `mt-0.5 size-7 flex-none rounded-sm ${tip.anonymous ? '' : 'bg-ink-800'}`, title: tip.anonymous ? undefined : rankText }),
      el(
        'div',
        { class: 'min-w-0 flex-1' },
        el(
          'p',
          { class: 'flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs text-paper-500' },
          tip.anonymous
            ? el('span', { class: 'text-sm font-semibold text-paper-300' }, t.anonymous)
            : el('a', { href: `${cfg.playerPath}?id=${tip.accountId}`, class: 'text-sm font-semibold text-paper-100 hover:text-brass-200' }, tip.name),
          tip.rank || !tip.anonymous ? el('span', {}, rankText) : null,
          tip.games ? el('span', { class: 'tabular-nums' }, fill(t.games, { n: nf.format(tip.games) })) : null,
          el('span', { class: 'ml-auto tabular-nums' }, df.format(new Date(tip.at * 1000))),
        ),
        // 줄바꿈은 그대로 (최대 3줄로 정리돼 온다)
        el('p', { class: 'mt-1 text-sm leading-relaxed whitespace-pre-line text-paper-200' }, tip.text),
      ),
    );
  }

  let shown: PublicTip[] = [];
  function renderTips(tips: PublicTip[]) {
    shown = tips;
    count.textContent = tips.length ? fill(t.count, { n: tips.length }) : '';
    list.replaceChildren(...(tips.length ? tips.map(tipRow) : [el('li', { class: 'px-4 py-6 text-sm text-paper-500' }, t.empty)]));
  }

  const returnTo = () => encodeURIComponent(`${location.pathname}#guide`);

  function renderWrite(session: Session, readonly = false) {
    // 저장소에 닿지 못하면 쓰기 칸 대신 안내 (#21)
    if (readonly) return void write.replaceChildren(el('p', { class: 'text-sm text-paper-200' }, t.errReadonly));
    const note = el('p', { class: 'mt-2 text-xs text-paper-500' }, t.writeNote);
    if (!session.account) {
      // 스팀 인증이 실패해 돌아왔으면 (?auth=failed) 알려 준다
      const failed = params.get('auth') === 'failed' ? el('p', { class: 'mb-2 text-sm text-nerf' }, t.authFailed) : null;
      write.replaceChildren(
        ...(failed ? [failed] : []),
        el(
          'a',
          { href: `/api/auth/steam?return=${returnTo()}`, class: 'inline-flex items-center gap-2 rounded-md bg-brass-400 px-4 py-2 text-sm font-bold text-ink-950 transition-colors duration-150 hover:bg-brass-200' },
          t.write,
        ),
        note,
      );
      return;
    }
    const area = el('textarea', { name: 'tip', rows: '3', maxlength: String(cfg.maxLength), placeholder: t.placeholder, class: 'field block h-20 w-full resize-y py-2 text-sm leading-relaxed' });
    // 봇 거르기 — 사람에겐 안 보이는 칸. 채워져 오면 서버가 버린다
    const trap = el('input', { name: 'website', tabindex: '-1', autocomplete: 'off', 'aria-hidden': 'true', class: 'absolute -left-[9999px] size-px opacity-0' });
    const counter = el('span', { class: 'text-xs text-paper-500 tabular-nums' }, `0/${cfg.maxLength}`);
    const status = el('p', { class: 'text-sm', role: 'status' });
    const displaySel = el('select', { class: 'field h-8 w-auto py-0 text-xs', 'aria-label': t.authorDisplay, title: t.authorDisplay });
    for (const d of AUTHOR_DISPLAYS) displaySel.append(new Option(d === 'public' ? t.displayPublic : d === 'anon' ? t.displayAnon : t.displayHidden, d));
    displaySel.value = savedDisplay();
    displaySel.addEventListener('change', () => saveDisplay(displaySel.value as AuthorDisplay));
    const send = el('button', { type: 'submit', class: 'rounded-md bg-brass-400 px-4 py-1.5 text-sm font-bold text-ink-950 transition-colors duration-150 hover:bg-brass-200 disabled:opacity-50' }, t.submit);
    const form = el(
      'form',
      { class: 'relative grid gap-2' },
      area,
      trap,
      el('div', { class: 'flex flex-wrap items-center gap-x-3 gap-y-2' }, send, displaySel, counter, status),
      el(
        'p',
        { class: 'flex flex-wrap gap-x-3 text-xs text-paper-500' },
        fill(t.signedIn, { name: session.account.name }),
        el('a', { href: `/api/auth/logout?return=${returnTo()}`, class: 'text-paper-400 underline-offset-2 hover:text-paper-50 hover:underline' }, t.logout),
      ),
      note,
    );
    area.addEventListener('input', () => (counter.textContent = `${area.value.length}/${cfg.maxLength}`));
    const errorText = (e: TipError) =>
      e === 'tooLong'
        ? fill(t.errTooLong, { n: cfg.maxLength })
        : e === 'profanity'
          ? // 어느 말에 걸렸는지 짚어 주고 그 자리를 골라 둔다 (고생해서 쓴 글이 왜 안 올라가는지 모르면 답답하니까)
            (() => {
              const hit = findProfanity(area.value);
              if (hit) area.setSelectionRange(hit.start, hit.end);
              area.focus();
              return fill(t.errProfanity, { word: hit?.word ?? '' });
            })()
          : t[`err${e[0].toUpperCase()}${e.slice(1)}` as keyof typeof t];
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const text = normalizeTip(area.value);
      const local = checkTip(text);
      status.className = 'text-sm text-nerf';
      if (local) return void (status.textContent = errorText(local));
      send.disabled = true;
      status.className = 'text-sm text-paper-400';
      status.textContent = t.sending;
      try {
        const res = mock
          ? new Response(JSON.stringify({ ok: true, tip: { id: String(Date.now()), ...(displaySel.value === 'public' ? { accountId: 1, name: 'Vonsas', anonymous: false } : { accountId: 0, name: '', anonymous: true }), rank: displaySel.value === 'hidden' ? null : { tier: 9, sub: 3 }, games: displaySel.value === 'hidden' ? null : 120, at: Math.floor(Date.now() / 1000), text } }))
          : await fetch('/api/tips', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ hero: cfg.heroId, text, website: trap.value, display: displaySel.value }) });
        const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: TipError; tip?: PublicTip };
        if (body.ok) {
          // 방금 쓴 팁을 목록 맨 위에 바로 붙인다
          if (body.tip) {
            shown.unshift(body.tip);
            renderTips(shown);
          }
          area.value = '';
          counter.textContent = `0/${cfg.maxLength}`;
          status.className = 'text-sm text-buff';
          status.textContent = t.sent;
        } else {
          status.className = 'text-sm text-nerf';
          // 저장소가 멈췄거나 /api 가 없다(예비 배포) — '잠시 쉼' (#21)
          status.textContent = errorText(isDown(res) ? 'readonly' : (body.error ?? 'server'));
        }
      } catch {
        status.className = 'text-sm text-nerf';
        status.textContent = t.errServer;
      } finally {
        send.disabled = false;
      }
    });
    write.replaceChildren(form);
  }

  const MOCK_TIPS: PublicTip[] = [
    { id: 'a', accountId: 1, name: 'Elendili', anonymous: false, rank: { tier: 11, sub: 2 }, games: 1312, at: 1791190000, text: '궁은 진입용이 아니라 마무리용. 상대 탈출기 빠진 걸 보고 쓰기.' },
    { id: 'b', accountId: 0, name: '', anonymous: true, rank: { tier: 8, sub: 4 }, games: 214, at: 1791100000, text: '라인전엔 1번으로 견제만 하고 무리하지 말 것.\n6분 첫 상점에서 체력 아이템 하나는 꼭.' },
    { id: 'c', accountId: 0, name: '', anonymous: true, rank: null, games: null, at: 1791000000, text: '근접 패리 타이밍을 익히면 상대 근접형 영웅한테 훨씬 덜 죽음.' },
  ];

  /** 이 영웅 가이드 — 추천 많은 순 5개 */
  function renderGuides(guides: GuideSummary[] | null, busy = false, stale = false) {
    if (!guideList) return;
    const g = cfg.guides;
    const row = (x: GuideSummary) =>
      el(
        'li',
        {},
        el(
          'a',
          { href: `${g.view}?id=${x.id}`, class: 'flex items-center gap-3 px-4 py-3 transition-colors duration-150 hover:bg-ink-850' },
          el('span', { class: 'w-10 flex-none text-center text-sm font-bold text-brass-200 tabular-nums', title: fill(g.t.votes, { n: x.votes }) }, `▲ ${nf.format(x.votes)}`),
          el(
            'span',
            { class: 'min-w-0 flex-1' },
            el('span', { class: 'block truncate font-semibold text-paper-50' }, x.title),
            el('span', { class: 'mt-0.5 block truncate text-xs text-paper-500' }, [x.anonymous ? cfg.guides.t.anonymous : x.name, x.rank && cfg.ranks[x.rank.tier] ? `${cfg.ranks[x.rank.tier].name} ${x.rank.sub}` : '', df.format(new Date(x.createdAt * 1000))].filter(Boolean).join(' · ')),
          ),
        ),
      );
    guideList.replaceChildren(
      ...(stale ? [el('li', { class: 'px-4 pt-3 text-xs text-paper-200' }, g.t.staleNote)] : []),
      ...(guides === null
        ? [el('li', { class: 'px-4 py-6 text-sm text-nerf' }, busy ? g.t.errBusy : g.t.loadError)]
        : guides.length
          ? guides.slice(0, 5).map(row)
          : [el('li', { class: 'px-4 py-6 text-sm text-paper-500' }, g.t.empty)]),
    );
  }
  const MOCK_GUIDES: GuideSummary[] = [
    { id: 'g1', hero: cfg.heroId, title: '라인전부터 한타까지, 기본기 정리', excerpt: '', sectionTitles: ['라인전', '한타'], votes: 42, hasVideo: true, accountId: 1, name: 'Elendili', anonymous: false, rank: { tier: 11, sub: 2 }, games: 1312, createdAt: 1791100000, updatedAt: 1791100000 },
    { id: 'g2', hero: cfg.heroId, title: '궁 쓰는 타이밍 정리', excerpt: '', sectionTitles: ['궁'], votes: 17, hasVideo: false, accountId: 0, name: '', anonymous: true, rank: { tier: 8, sub: 4 }, games: 214, createdAt: 1791000000, updatedAt: 1791000000 },
  ];

  let loaded = false;
  async function load() {
    if (loaded) return;
    loaded = true;
    if (mock) {
      renderGuides(MOCK_GUIDES);
      renderTips(MOCK_TIPS);
      renderWrite(mock === 'in' ? { account: { id: 1, name: 'Vonsas' } } : {});
      return;
    }
    const [guides, tips, session] = await Promise.all([
      getJson<{ guides: GuideSummary[] }>(`/api/guides?hero=${cfg.heroId}&sort=votes`),
      getJson<{ tips: PublicTip[] }>(`/api/tips?hero=${cfg.heroId}`),
      getJson<Session>('/api/session'),
    ]);
    // 저장소가 멈췄거나 /api 가 없으면(예비 배포) 빌드 때 구운 스냅샷으로 그리고 쓰기는 잠시 쉰다 (#21)
    const down = [guides, tips, session].some((x) => x.kind === 'down' || x.kind === 'missing');
    // 스냅샷은 가이드 · 팁 자체가 실패했을 때만 받는다 (세션만 실패하면 쓰기 칸만 '잠시 쉼')
    const failed = (x: { kind: string }) => x.kind === 'down' || x.kind === 'missing';
    const snap = failed(guides) || failed(tips) ? await loadSnapshot() : null;
    const guidesFromSnap = !!snap && failed(guides);
    const guideItems = guides.kind === 'ok' ? guides.data.guides : guidesFromSnap ? snap!.guides.filter((g) => g.hero === cfg.heroId).sort((a, b) => b.votes - a.votes) : null;
    const tipItems = tips.kind === 'ok' ? tips.data.tips : snap && failed(tips) ? (snap.tips[cfg.heroId] ?? []) : null;
    // 짧은 시간에 너무 많이 부르면 함수가 429 'busy' 를 준다 (#18) — 일반 오류와 문구를 나눈다
    renderGuides(guideItems, guides.kind === 'busy', guidesFromSnap);
    if (tipItems) renderTips(tipItems);
    else list.replaceChildren(el('li', { class: 'px-4 py-6 text-sm text-nerf' }, tips.kind === 'busy' ? t.errBusy : t.loadError));
    renderWrite(session.kind === 'ok' ? session.data : {}, down);
  }
  // 탭이 화면에 보일 때 처음 한 번만 (숨겨진 탭은 겹치지 않으므로 열 때 불린다)
  new IntersectionObserver((entries, obs) => {
    if (entries.some((e) => e.isIntersecting)) {
      obs.disconnect();
      void load();
    }
  }).observe(root);
}
