/**
 * 목록 필터 — 영웅·아이템 페이지 공용. JS 가 없어도 전체 목록은 그대로 보인다.
 *
 *   [data-filter]                         루트
 *     input[data-filter-text]             이름 검색 (URL ?q= 로 미리 채움)
 *     button[data-filter-key][data-filter-value]   분할 버튼 (value "" = 전체)
 *     input[type=checkbox][data-filter-flag]       켜면 data-{flag}="true" 인 항목만
 *     [data-filter-item] data-name data-{key} data-{flag}   걸러질 항목
 *     [data-filter-group]                 안의 항목이 모두 숨으면 함께 숨김
 *     [data-filter-empty]                 결과가 없을 때 표시
 *     [data-filter-count][data-template]  '{n}개 표시'
 *     button[data-view]                   보기 전환 → 루트의 data-view 값 (localStorage 에 기억)
 *     button[data-sort] (table 안)        숫자 열 정렬
 */
import { norm } from './normalize';

function setup(root: HTMLElement) {
  const text = root.querySelector<HTMLInputElement>('[data-filter-text]');
  const buttons = [...root.querySelectorAll<HTMLButtonElement>('[data-filter-key]')];
  const flags = [...root.querySelectorAll<HTMLInputElement>('[data-filter-flag]')];
  const items = [...root.querySelectorAll<HTMLElement>('[data-filter-item]')];
  const groups = [...root.querySelectorAll<HTMLElement>('[data-filter-group]')];
  const empty = root.querySelector<HTMLElement>('[data-filter-empty]');
  const count = root.querySelector<HTMLElement>('[data-filter-count]');
  const selected: Record<string, string> = {};

  const apply = () => {
    const q = norm(text?.value ?? '');
    const onFlags = flags.filter((f) => f.checked).map((f) => f.dataset.filterFlag!);
    // 같은 항목이 격자·표 두 곳에 있으므로 이름 기준으로 센다
    const visible = new Set<string>();
    for (const el of items) {
      const ok =
        (!q || norm(el.dataset.name ?? '').includes(q) || norm(el.dataset.alt ?? '').includes(q)) &&
        Object.entries(selected).every(([k, v]) => !v || el.dataset[k] === v) &&
        onFlags.every((f) => el.dataset[f] === 'true');
      el.toggleAttribute('data-hidden', !ok);
      if (ok) visible.add(el.dataset.name ?? '');
    }
    for (const g of groups) {
      g.toggleAttribute('data-hidden', !g.querySelector('[data-filter-item]:not([data-hidden])'));
    }
    if (empty) empty.hidden = visible.size > 0;
    if (count) count.textContent = (count.dataset.template ?? '{n}').replace('{n}', String(visible.size));
  };

  for (const b of buttons) {
    b.addEventListener('click', () => {
      const key = b.dataset.filterKey!;
      selected[key] = b.dataset.filterValue ?? '';
      buttons
        .filter((o) => o.dataset.filterKey === key)
        .forEach((o) => o.setAttribute('aria-pressed', String(o === b)));
      apply();
    });
  }
  flags.forEach((f) => f.addEventListener('change', apply));
  if (text) {
    const q = new URLSearchParams(location.search).get('q');
    if (q) text.value = q;
    text.addEventListener('input', apply);
  }

  // 보기 전환 (카드 / 표)
  const views = [...root.querySelectorAll<HTMLButtonElement>('[data-view]')];
  const storeKey = `dldb:view:${root.dataset.filter}`;
  const setView = (v: string) => {
    root.dataset.viewMode = v;
    views.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === v)));
  };
  if (views.length) {
    try {
      const saved = localStorage.getItem(storeKey);
      if (saved && views.some((b) => b.dataset.view === saved)) setView(saved);
    } catch {
      /* 저장소 접근 불가 */
    }
    views.forEach((b) =>
      b.addEventListener('click', () => {
        setView(b.dataset.view!);
        try {
          localStorage.setItem(storeKey, b.dataset.view!);
        } catch {
          /* 무시 */
        }
      }),
    );
  }

  // 표 정렬
  root.querySelectorAll<HTMLButtonElement>('[data-sort]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const table = btn.closest('table');
      const body = table?.tBodies[0];
      if (!table || !body) return;
      const key = btn.dataset.sort!;
      const th = btn.closest('th')!;
      const desc = th.getAttribute('aria-sort') !== 'descending';
      table.querySelectorAll('th[aria-sort]').forEach((h) => h.removeAttribute('aria-sort'));
      th.setAttribute('aria-sort', desc ? 'descending' : 'ascending');
      const rows = [...body.rows].sort((a, b) => {
        const av = a.dataset[key] ?? '';
        const bv = b.dataset[key] ?? '';
        const diff = isNaN(+av) ? av.localeCompare(bv) : +av - +bv;
        return desc ? -diff : diff;
      });
      body.append(...rows);
    });
  });

  apply();
}

document.querySelectorAll<HTMLElement>('[data-filter]').forEach(setup);
