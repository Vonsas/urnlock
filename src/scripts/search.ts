/**
 * 헤더 검색 — 플레이어 전용. 치는 동안 잠깐 멈추면(DEBOUNCE_MS) deadlock-api 에서 Steam 이름으로 찾고,
 * 마지막 줄은 전적 페이지의 '검색 결과 모두 보기'.
 * 계정 ID·SteamID64·프로필 주소를 넣으면 그 계정 전적으로 바로 가는 항목을 보여준다. '/' 키로 포커스.
 * (영웅·아이템은 각 페이지에 검색이 있어 헤더에서는 찾지 않는다)
 */
import { parsePlayerInput } from './steam-id';

export interface SearchConfig {
  api: string;
  /** 전적 페이지 경로 (/ko/players/) */
  playersPath: string;
  t: { searching: string; noPlayers: string; allPlayers: string; byId: string };
}

interface SteamProfile {
  account_id: number;
  personaname: string;
  avatar?: string;
}

/** 목록에서 고를 수 있는 항목 (머리글·안내 줄은 제외) */
interface Option {
  href: string;
  el: HTMLAnchorElement;
}

const DEBOUNCE_MS = 250;
const MAX_PLAYERS = 8;
/** 한 글자 이름 검색은 결과가 너무 많아 두 글자부터 */
const MIN_PLAYER_QUERY = 2;

function setup(root: HTMLElement, cfg: SearchConfig) {
  const input = root.querySelector<HTMLInputElement>('[data-search-input]');
  const list = root.querySelector<HTMLUListElement>('[data-search-results]');
  if (!input || !list) return;
  const t = cfg.t;

  let options: Option[] = [];
  let active = -1;
  let timer: number | undefined;
  let controller: AbortController | undefined;
  // 플레이어 쪽 상태 — 검색어가 바뀌면 이전 결과는 버린다
  let players: { query: string; state: 'loading' | 'done' | 'error'; list: SteamProfile[] } | undefined;

  const close = () => {
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    active = -1;
  };

  // ─── 그리기 ────────────────────────────────────────────────
  const note = (text: string) => {
    const li = document.createElement('li');
    li.setAttribute('role', 'presentation');
    li.className = 'px-2.5 py-2 text-sm text-paper-500';
    li.textContent = text;
    return li;
  };
  /** 고를 수 있는 한 줄: [그림] 이름 · 보조 문구 */
  const option = (href: string, label: string, sub?: string, image?: string) => {
    const li = document.createElement('li');
    li.setAttribute('role', 'option');
    const a = document.createElement('a');
    a.href = href;
    a.className = 'flex items-center gap-2.5 rounded-sm px-2.5 py-1.5 hover:bg-ink-800';
    if (image) {
      const img = document.createElement('img');
      img.src = image;
      img.alt = '';
      img.className = 'size-7 flex-none rounded-sm bg-ink-800 object-cover';
      a.append(img);
    }
    const name = document.createElement('span');
    name.className = 'min-w-0 flex-1 truncate text-paper-50';
    name.textContent = label;
    a.append(name);
    if (sub) {
      const s = document.createElement('span');
      s.className = 'flex-none text-xs text-paper-500 tabular-nums';
      s.textContent = sub;
      a.append(s);
    }
    li.append(a);
    li.id = `search-opt-${options.length}`;
    options.push({ href, el: a });
    return li;
  };

  const render = () => {
    const raw = input.value.trim();
    if (!raw) return close();
    options = [];
    const rows: HTMLLIElement[] = [];

    const parsed = parsePlayerInput(raw);
    if ('id' in parsed) {
      rows.push(option(`${cfg.playersPath}?id=${parsed.id}`, t.byId.replace('{id}', String(parsed.id))));
    } else {
      // 한 글자는 결과가 너무 많아 바로 찾지 않고 '모두 보기' 만
      if (raw.length >= MIN_PLAYER_QUERY) {
        if (!players || players.query !== raw || players.state === 'loading') rows.push(note(t.searching));
        else if (players.state === 'error' || !players.list.length) rows.push(note(t.noPlayers));
        else for (const p of players.list) rows.push(option(`${cfg.playersPath}?id=${p.account_id}`, p.personaname, `ID ${p.account_id}`, p.avatar));
      }
      rows.push(option(`${cfg.playersPath}?q=${encodeURIComponent(raw)}`, t.allPlayers.replace('{q}', raw)));
    }

    if (active >= options.length) active = options.length - 1;
    if (active < 0 && options.length) active = 0;
    options.forEach((o, i) => {
      o.el.parentElement!.setAttribute('aria-selected', String(i === active));
      o.el.classList.toggle('bg-ink-800', i === active);
    });
    list.replaceChildren(...rows);
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    input.setAttribute('aria-activedescendant', active >= 0 ? `search-opt-${active}` : '');
  };

  // ─── 플레이어 이름 검색 (치는 동안) ─────────────────────────
  const searchPlayers = (query: string) => {
    controller?.abort();
    controller = new AbortController();
    players = { query, state: 'loading', list: [] };
    const url = `${cfg.api}/v1/players/steam-search?search_query=${encodeURIComponent(query)}&limit=${MAX_PLAYERS}`;
    fetch(url, { signal: controller.signal })
      .then(async (res) => {
        // 일치하는 플레이어가 없으면 404
        const found = res.status === 404 ? [] : res.ok ? ((await res.json()) as SteamProfile[]) : null;
        if (players?.query !== query) return;
        players = found ? { query, state: 'done', list: found.slice(0, MAX_PLAYERS) } : { query, state: 'error', list: [] };
        if (!list.hidden) render();
      })
      .catch((error: unknown) => {
        if ((error as Error).name === 'AbortError' || players?.query !== query) return;
        players = { query, state: 'error', list: [] };
        if (!list.hidden) render();
      });
  };

  input.addEventListener('input', () => {
    active = 0;
    const raw = input.value.trim();
    window.clearTimeout(timer);
    const parsed = parsePlayerInput(raw);
    // 이미 받은 결과가 있는 검색어가 아니면 (다시) 예약한다 — 위에서 이전 예약을 지웠으므로
    const settled = players?.query === raw && players.state !== 'loading';
    if (!('id' in parsed) && raw.length >= MIN_PLAYER_QUERY && !settled) {
      players = { query: raw, state: 'loading', list: [] };
      timer = window.setTimeout(() => searchPlayers(raw), DEBOUNCE_MS);
    }
    render();
  });

  const go = (href: string) => {
    close();
    input.blur();
    location.href = href;
  };

  input.addEventListener('keydown', (ev) => {
    // IME(한글) 조합 중 엔터는 글자 확정이라 이동하지 않는다
    if (ev.key === 'Enter' && !ev.isComposing) {
      ev.preventDefault();
      const raw = input.value.trim();
      if (!raw) return;
      if (options[active]) return go(options[active].href);
      const parsed = parsePlayerInput(raw);
      return go('id' in parsed ? `${cfg.playersPath}?id=${parsed.id}` : `${cfg.playersPath}?q=${encodeURIComponent(raw)}`);
    }
    if (list.hidden) return;
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      if (!options.length) return;
      active = (active + (ev.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
      render();
      options[active]?.el.scrollIntoView({ block: 'nearest' });
    } else if (ev.key === 'Escape') {
      close();
    }
  });

  input.addEventListener('focus', () => {
    if (input.value.trim()) render();
  });
  input.addEventListener('blur', () => setTimeout(close, 150));

  document.addEventListener('keydown', (ev) => {
    const target = ev.target as HTMLElement;
    if (ev.key === '/' && !['INPUT', 'TEXTAREA'].includes(target.tagName)) {
      ev.preventDefault();
      input.focus();
    }
  });
}

const configEl = document.getElementById('search-config');
if (configEl) {
  const cfg = JSON.parse(configEl.textContent || '{}') as SearchConfig;
  document.querySelectorAll<HTMLElement>('[data-search]').forEach((root) => setup(root, cfg));
}
