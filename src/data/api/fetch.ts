/**
 * deadlock-api.com 요청 + 로컬 캐시.
 *
 * - 빌드: 항상 새로 받고, 성공하면 .cache/api/ 에 필요한 필드만 추려 저장한다.
 * - 개발 서버: 캐시가 DEV_CACHE_HOURS 안쪽이면 캐시를 그대로 쓴다 (items 응답이 언어당 약 6MB).
 * - 번역 사전만 바뀐 커밋의 빌드: 캐시가 REUSE_HOURS 안쪽이면 그대로 쓴다 (DATA_REUSE — 아래). 배포 5–7분 중 대부분이 데이터 받기라서.
 * - 요청이 실패하면 캐시를 쓰고, 캐시도 없으면 null — 호출하는 쪽이 목업으로 폴백한다.
 */
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import patchArchive from '../patch-archive.json';
import type { GameBuild } from '../types';
import type { Locale } from '../../i18n/locales';
import type { RawHero, RawItem, RawPatch, RawProperty, RawRank, RawTooltipDetails } from './raw';

export const API_BASE = 'https://api.deadlock-api.com';
/** 추려 저장하는 필드가 바뀌면 올린다 — 옛 캐시를 쓰지 않도록 */
const CACHE_VERSION = 9;
// Vercel 은 빌드 사이에 node_modules 를 남겨 두고 다음 빌드에 되살린다 (Astro 이미지 캐시 node_modules/.astro 도 그래서 남는다).
// 그래서 Vercel 에선 캐시를 그 안에 둬서 DATA_REUSE 빌드가 직전 빌드가 받은 데이터를 쓸 수 있게 한다.
const CACHE_DIR = process.env.VERCEL
  ? path.join(process.cwd(), 'node_modules', '.cache', 'dldb-api', `v${CACHE_VERSION}`)
  : path.join(process.cwd(), '.cache', 'api', `v${CACHE_VERSION}`);
const DEV_CACHE_HOURS = 12;

/**
 * 번역 사전 · 패치 보관 파일만 바뀐 커밋(새 패치 보관 · 번역 · 용어 고치기)은 데이터를 새로 받지 않고 캐시를 쓴다 (2026-11-05 — 패치 직후 번역 반영이 배포에서만 5–7분 걸렸다).
 * 판단은 지금 커밋(HEAD)이 바꾼 파일만 본다 — 코드는 언제나 지금 커밋으로 빌드하므로 틀려도 데이터가 최대 REUSE_HOURS 묵을 뿐이다.
 * 6시간 갱신(티어 조각 커밋)은 다른 파일을 바꾸니 늘 새로 받는다. 캐시가 REUSE_HOURS 를 넘었거나 없는 항목은 평소처럼 받는다.
 * 끄기: 환경 변수 DATA_REUSE=0
 */
const REUSE_HOURS = 6;
// 패치 보관 파일도 — 새 패치 글은 이 파일에서 들어오므로(loadPatches 가 API 캐시와 합친다) 데이터를 다시 받을 필요가 없다
const REUSE_ONLY = /^src\/data\/(patch-i18n\/|hero-i18n\/|patch-archive\.json$)/;
export const DATA_REUSE = ((): boolean => {
  if (process.env.DATA_REUSE === '0' || import.meta.env?.DEV) return false;
  if (process.env.DATA_REUSE === '1') return true;
  // 로컬 빌드는 언제나 새로 받는다 (CLAUDE.md '빌드는 항상 새로 받고') — 켜는 건 Vercel 운영 빌드만
  if (!process.env.VERCEL) return false;
  try {
    const changed = execSync('git diff --name-only HEAD~1 HEAD', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10_000 })
      .split('\n')
      .filter(Boolean);
    // 커밋 메시지의 [data-reuse] — 새 패치 보관 커밋(daily-rebuild source=patch-…): 티어 조각 파일도 바뀌지만 티어는 그 파일로 계산하고, 나머지만 캐시로
    const message = execSync('git log -1 --format=%B', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10_000 });
    const reuse = (message.startsWith('chore(data): archive') && message.includes('[data-reuse]')) || (changed.length > 0 && changed.every((f) => REUSE_ONLY.test(f)));
    if (reuse) console.log(`[dldb:api] 데이터 재사용 커밋 — ${REUSE_HOURS}시간 안쪽 캐시를 그대로 씀 (${changed.join(', ')})`);
    return reuse;
  } catch {
    return false;
  }
})();

/** DATA_REUSE 빌드에서 캐시를 쓴 항목 · 새로 받은 항목 수 — 빌드 끝에 한 줄로. hit 가 0 이면 캐시가 빌드 사이에 안 남은 것 (기능이 조용히 꺼짐) */
const reuseCount = { hit: 0, miss: 0, missed: [] as string[] };
if (DATA_REUSE) {
  process.on('exit', () => {
    const sample = reuseCount.missed.slice(0, 8).join(', ');
    const msg = `[dldb:api] 데이터 재사용: 캐시 ${reuseCount.hit}건 · 새로 받음 ${reuseCount.miss}건${sample ? ` (${sample}${reuseCount.miss > 8 ? ' …' : ''})` : ''}`;
    if (reuseCount.hit === 0) console.warn(`${msg} — 캐시가 빌드 사이에 남지 않은 것 같음`);
    else console.log(msg);
  });
}
const TIMEOUT_MS = 60_000;

/** deadlock-api 는 Steam 식 언어 코드를 쓴다 (`korean` 은 400 오류) */
export const API_LANG: Record<Locale, string> = { ko: 'koreana', en: 'english', zh: 'schinese' };

export function warn(message: string): void {
  console.warn(`[dldb:api] ${message}`);
}

async function readCache<T>(file: string): Promise<{ data: T; ageHours: number } | null> {
  try {
    const [text, info] = await Promise.all([readFile(file, 'utf8'), stat(file)]);
    return { data: JSON.parse(text) as T, ageHours: (Date.now() - info.mtimeMs) / 3_600_000 };
  } catch {
    return null;
  }
}

/**
 * 여러 요청을 묶어 만든 결과 하나를 통째로 캐시 — 캐시 이름이 시각마다 바뀌는 묶음(라인전 3시간 칸 75개 등)은 load() 캐시로는 DATA_REUSE 가
 * 듣지 않는다 (2026-11-05 첫 번역 배포: 라인전만 3분 28초). 평소엔 compute 후 결과를 남기고, DATA_REUSE 면 REUSE_HOURS 안쪽 결과를 그대로 쓴다.
 */
export async function reusable<T>(name: string, compute: () => Promise<T | null>): Promise<T | null> {
  const file = path.join(CACHE_DIR, `result-${name}.json`);
  if (DATA_REUSE) {
    const saved = await readCache<T>(file);
    if (saved && saved.ageHours < REUSE_HOURS) {
      reuseCount.hit++;
      return saved.data;
    }
  }
  const data = await compute();
  if (data !== null) {
    try {
      await mkdir(CACHE_DIR, { recursive: true });
      await writeFile(file, JSON.stringify(data));
    } catch {
      // 남기지 못해도 빌드는 계속
    }
  }
  return data;
}

/** 요청 → 추리기 → 캐시 저장. 실패하면 캐시, 캐시도 없으면 null */
/** beforeFetch: 요청을 실제로 보내기 직전(재시도 포함)에 기다릴 일 — 요청 수 제한이 빡빡한 주소용 (loadRank) */
export async function load<T>(name: string, url: string, trim: (json: unknown) => T, beforeFetch?: () => Promise<void>): Promise<T | null> {
  const file = path.join(CACHE_DIR, `${name}.json`);
  const cached = await readCache<T>(file);
  // import.meta.env 는 Astro 밖(tsx 로 도는 tools/archive-tiers.ts)에선 없다
  if (import.meta.env?.DEV && cached && cached.ageHours < DEV_CACHE_HOURS) return cached.data;
  if (DATA_REUSE) {
    if (cached && cached.ageHours < REUSE_HOURS) {
      reuseCount.hit++;
      return cached.data;
    }
    reuseCount.miss++;
    reuseCount.missed.push(name);
  }

  try {
    // 요청 제한(429)·서버 오류(5xx)는 잠시 기다렸다 두 번까지 다시 — 빌드 서버엔 캐시가 없어 실패하면 데이터가 빠진다
    // 시간 초과 · 연결 끊김도 다시 (예전엔 바로 실패 → 티어 단계 하나만 빠져도 그 갱신의 배포가 멈췄다, 2026-10-14 점검)
    // 504 만은 다시 하지 않는다 — deadlock-api 는 시간 제한(20초)에 걸린 쿼리를 10분 동안 바로 504 로 돌려보내서(2026-10-26~)
    // 15·30초 뒤 재시도는 늘 같은 504 를 받고 실패 한 건에 1분씩 빌드만 늘렸다 (docs/deploy-failures.md)
    const get = async () => {
      await beforeFetch?.();
      return fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) }).catch((e: unknown) => e as Error);
    };
    let res = await get();
    for (let attempt = 1; attempt <= 2 && (res instanceof Error || res.status === 429 || (res.status >= 500 && res.status !== 504)); attempt++) {
      // retry-after 는 60초까지만 따른다 — 시간당 한도에 걸리면 수십 분을 주는데, 그걸 두 번 기다리다 빌드가 멈춘 채 45분 제한에 걸렸다 (2026-10-23)
      const after = res instanceof Error ? 0 : Math.min(Number(res.headers.get('retry-after')) || 0, 60);
      await new Promise((r) => setTimeout(r, (after > 0 ? after : 15 * attempt) * 1000));
      res = await get();
    }
    if (res instanceof Error) throw res;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = trim(await res.json());
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(file, JSON.stringify(data));
    return data;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    // Vercel 에선 캐시가 빌드 사이에 남는다 — 예전엔 빌드 서버에 캐시가 없어 실패하면 null → health 검사가 배포를 멈췄다.
    // 며칠 묵은 데이터(패치 전 스탯 등)가 조용히 배포되지 않게, 거기선 REUSE_HOURS 안쪽 캐시만 폴백으로 쓴다
    if (cached && (!process.env.VERCEL || cached.ageHours < REUSE_HOURS)) {
      warn(`${name}: 요청 실패(${reason}) — ${cached.ageHours.toFixed(1)}시간 전 캐시 사용`);
      return cached.data;
    }
    warn(`${name}: 요청 실패(${reason}), 캐시 없음`);
    return null;
  }
}

/**
 * /v1/players/rank?account_ids= 는 IP 당 분당 20회 — 빌드 안에서 부르는 곳(빌드 작성자 랭크 · 순위표 계정 고르기)이 여럿이라
 * 실제로 보낼 때마다 3.2초 간격의 자리를 차례로 잡는다 (#83 1차 리뷰: 따로 보내다 작성자 랭크 9건이 429). 캐시에서 읽을 때는 기다리지 않는다.
 */
const RANK_GAP_MS = 3_200;
let rankNext = 0;
async function rankSlot() {
  const at = Math.max(Date.now(), rankNext);
  rankNext = at + RANK_GAP_MS;
  if (at > Date.now()) await new Promise((r) => setTimeout(r, at - Date.now()));
}
export const loadRank = <T>(name: string, url: string, trim: (json: unknown) => T) => load(name, url, trim, rankSlot);

function pickKeys<T extends object>(obj: T, keys: readonly string[]): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const k of keys) if (k in obj) out[k] = (obj as Record<string, unknown>)[k];
  return out as Partial<T>;
}

function trimProperties(props: Record<string, RawProperty> | undefined) {
  if (!props) return undefined;
  const out: Record<string, RawProperty> = {};
  for (const [k, v] of Object.entries(props)) {
    const p: RawProperty = pickKeys(v, ['value', 'label', 'postfix', 'css_class', 'negative_attribute', 'conditional', 'usage_flags']);
    if (v.scale_function) p.scale_function = pickKeys(v.scale_function, ['class_name', 'specific_stat_scale_type', 'stat_scale']);
    out[k] = p;
  }
  return out;
}

/** 툴팁 문구(SVG 가 섞인 HTML)는 버리고 어떤 수치를 보여주는지만 남긴다 */
function trimTooltipDetails(details: RawTooltipDetails | undefined): RawTooltipDetails | undefined {
  if (!details) return undefined;
  return {
    info_sections: details.info_sections?.map((s) => ({
      properties_block: s.properties_block?.map((b) => ({
        properties: b.properties?.map((p) => pickKeys(p, ['important_property', 'status_effect_value', 'requires_ability_upgrade'])),
      })),
      basic_properties: s.basic_properties,
    })),
    additional_header_properties: details.additional_header_properties,
  };
}

const HERO_KEYS = [
  'id', 'class_name', 'name', 'complexity', 'gun_tag', 'description',
  'starting_stats', 'standard_level_up_upgrades', 'level_info', 'items', 'popular_items',
] as const;

const WEAPON_INFO_KEYS = [
  'bullet_damage', 'bullets', 'clip_size', 'reload_duration', 'bullet_speed',
  'damage_falloff_start_range', 'damage_falloff_end_range', 'bullets_per_second', 'damage_per_second',
] as const;

const HERO_IMAGE_KEYS = ['icon_hero_card', 'icon_hero_card_webp', 'icon_image_small', 'icon_image_small_webp', 'name_image'] as const;
const ITEM_IMAGE_KEYS = ['image', 'image_webp', 'shop_image', 'shop_image_webp'] as const;

function trimHero(hero: RawHero): RawHero {
  const out = pickKeys(hero, HERO_KEYS) as RawHero;
  if (hero.images) out.images = pickKeys(hero.images, HERO_IMAGE_KEYS) as Record<string, string>;
  return out;
}

function trimItem(item: RawItem): RawItem {
  const base = {
    id: item.id,
    class_name: item.class_name,
    name: item.name,
    type: item.type,
    properties: trimProperties(item.properties),
    ...(item.type === 'weapon' ? {} : pickKeys(item, ITEM_IMAGE_KEYS)),
  };
  if (item.type === 'weapon') {
    return { ...base, weapon_info: item.weapon_info && pickKeys(item.weapon_info, WEAPON_INFO_KEYS) };
  }
  if (item.type === 'ability') {
    return {
      ...base,
      ability_type: item.ability_type,
      description: item.description,
      upgrades: item.upgrades,
      tooltip_details: trimTooltipDetails(item.tooltip_details),
    };
  }
  return {
    ...base,
    ...pickKeys(item, ['description', 'item_slot_type', 'item_tier', 'cost', 'is_active_item', 'shopable', 'tooltip_sections', 'component_items']),
  };
}

/** 상점 아이템 + 영웅 능력(시그니처·궁극기) + 무기만 남긴다 */
function keepItem(item: RawItem): boolean {
  if (item.type === 'upgrade') return Boolean(item.shopable);
  if (item.type === 'ability') return item.ability_type === 'signature' || item.ability_type === 'ultimate';
  return item.type === 'weapon';
}

export function loadHeroes(lang: Locale) {
  const code = API_LANG[lang];
  return load<RawHero[]>(`heroes-${code}`, `${API_BASE}/v1/assets/heroes?language=${code}&only_active=true`, (json) =>
    (json as RawHero[]).map(trimHero),
  );
}

export function loadItems(lang: Locale) {
  const code = API_LANG[lang];
  return load<RawItem[]>(`items-${code}`, `${API_BASE}/v1/assets/items?language=${code}`, (json) =>
    (json as RawItem[]).filter(keepItem).map(trimItem),
  );
}

/**
 * 이미지 주소 점검 (HEAD) — 두 가지를 알아낸다.
 * - 죽은 주소: 빌드 때 Astro 가 이미지를 받다가 실패하면 빌드 전체가 멈추므로 미리 걸러 낸다.
 * - 파일 버전(ETag / Last-Modified): 이미지 서버가 Cache-Control 을 주지 않아 Astro 이미지 캐시는 '마지막 수정 후 경과 시간의
 *   10%' 동안 파일을 새것으로 본다 (5월 파일이면 약 12일). 게임 패치로 같은 주소의 그림이 바뀌어도 그동안 옛 그림이 남으므로,
 *   버전을 주소에 붙여(?v=) 파일이 바뀌면 주소도 바뀌게 한다. 서버는 쿼리를 무시한다 (2026-09-30 확인).
 */
export async function inspectImages(urls: string[], concurrency = 16): Promise<{ broken: Set<string>; versions: Map<string, string> }> {
  // 결과를 캐시에 남겨 DATA_REUSE 빌드는 HEAD 수백 번을 건너뛴다 (주소 목록이 같을 때만)
  const file = path.join(CACHE_DIR, 'image-inspect.json');
  const key = createHash('sha1').update([...new Set(urls)].sort().join('\n')).digest('hex');
  type Saved = { key: string; broken: string[]; versions: Array<[string, string]> };
  if (DATA_REUSE) {
    const saved = await readCache<Saved>(file);
    if (saved && saved.ageHours < REUSE_HOURS && saved.data.key === key) {
      return { broken: new Set(saved.data.broken), versions: new Map(saved.data.versions) };
    }
  }
  const result = await inspectImagesNow(urls, concurrency);
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(file, JSON.stringify({ key, broken: [...result.broken], versions: [...result.versions] } satisfies Saved));
  } catch {
    // 캐시를 못 남겨도 빌드는 계속 — 다음 DATA_REUSE 빌드가 HEAD 를 다시 할 뿐
  }
  return result;
}

async function inspectImagesNow(urls: string[], concurrency: number): Promise<{ broken: Set<string>; versions: Map<string, string> }> {
  const broken = new Set<string>();
  const versions = new Map<string, string>();
  const queue = [...new Set(urls)];
  const worker = async () => {
    for (let url = queue.shift(); url; url = queue.shift()) {
      try {
        const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(15_000) });
        if (!res.ok) {
          broken.add(url);
          continue;
        }
        const tag = (res.headers.get('etag') ?? res.headers.get('last-modified') ?? '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 12);
        if (tag) versions.set(url, tag);
      } catch {
        broken.add(url);
      }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  return { broken, versions };
}

export function loadRanks(lang: Locale) {
  const code = API_LANG[lang];
  return load<RawRank[]>(`ranks-${code}`, `${API_BASE}/v1/assets/ranks?language=${code}`, (json) =>
    (json as RawRank[]).map((r) => ({
      tier: r.tier,
      name: r.name,
      images: r.images && (pickKeys(r.images, ['large', 'large_webp']) as Record<string, string>),
    })),
  );
}

interface RawBuild {
  hero_build: {
    hero_id: number;
    hero_build_id: number;
    author_account_id: number;
    name: string;
    version: number;
    last_updated_timestamp: number;
    details?: {
      mod_categories?: Array<{ name?: string; description?: string | null; mods?: Array<{ ability_id: number; annotation?: string | null }> }>;
      /** 능력 포인트를 쓴 순서 — currency_type 2 = 해금, 1 = 강화 (delta 는 쓴 포인트) */
      ability_order?: { currency_changes?: Array<{ ability_id: number; currency_type: number; delta: number }> };
    };
  };
}

/** 능력 포인트 기록 → 찍은 순서. 음수 delta = 사용, 양수 = 되돌림(그 능력의 마지막 사용을 지운다) */
function abilityOrder(changes: Array<{ ability_id: number; delta: number }>): number[] {
  const order: number[] = [];
  for (const c of changes) {
    if (c.delta < 0) order.push(c.ability_id);
    else if (c.delta > 0) {
      const i = order.lastIndexOf(c.ability_id);
      if (i >= 0) order.splice(i, 1);
    }
  }
  return order;
}

/**
 * 작성자가 단 설명 한 칸 — 앞뒤 공백 · 긴 빈 줄 · 제어 문자를 정리하고 길이를 제한한다 (게임 안 입력이라 지금 긴 것도 200자 안쪽).
 * '#Citadel_…' 은 글이 아니라 게임 내부 이름이라 뺀다. 외부 글이라 화면에는 글자로만 넣는다.
 */
function authorNote(text?: string | null): string | undefined {
  const clean = (text ?? '')
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 500);
  return clean && !clean.startsWith('#Citadel_') ? clean : undefined;
}

/** 게임 내 빌드를 화면용으로 줄인다 (같은 빌드의 여러 버전 중 가장 최신) */
function trimBuild(rows: RawBuild[]): GameBuild | null {
  const b = rows.map((r) => r.hero_build).sort((x, y) => y.version - x.version)[0];
  if (!b) return null;
  return {
    heroId: b.hero_id,
    buildId: b.hero_build_id,
    authorId: b.author_account_id,
    name: b.name,
    version: b.version,
    updatedAt: b.last_updated_timestamp,
    groups: (b.details?.mod_categories ?? []).map((c) => {
      const desc = authorNote(c.description);
      return {
        name: c.name ?? '',
        ...(desc && { desc }),
        items: (c.mods ?? []).map((m) => {
          const note = authorNote(m.annotation);
          return { itemId: m.ability_id, ...(note && { note }) };
        }),
      };
    }),
    abilityOrder: abilityOrder(b.details?.ability_order?.currency_changes ?? []),
  };
}

/**
 * 게임 내 빌드 하나. 같은 빌드 ID 에 여러 영웅의 버전이 섞여 있어(작성자가 빌드 칸을 다른 영웅에 다시 씀)
 * 영웅 id 와 함께 찾고, 그중 가장 최신 버전을 쓴다. 기본 조회는 100줄뿐이라 판이 100개를 넘는 빌드는 최신 판을 못 받아
 * 판 번호 내림차순 1줄로 묻는다 (only_latest 는 쓰지 않는다 — 문서는 최신 판이 필터에 안 맞으면 뺀다고 하는데 실제로는 그 영웅의 최신 판을 줘서, 어느 쪽에도 기대지 않는다).
 */
export function loadGameBuild(heroId: number, buildId: number) {
  return load(`gbuild4-${heroId}-${buildId}`, `${API_BASE}/v1/builds?hero_id=${heroId}&build_id=${buildId}&sort_by=version&sort_direction=desc&limit=1`, (json) => trimBuild(json as RawBuild[]));
}

/** 한 작성자(프로)가 올린 빌드 전부 — 빌드마다 최신 버전만 */
export function loadAuthorBuilds(accountId: number) {
  return load(`author-builds3-${accountId}`, `${API_BASE}/v1/builds?author_id=${accountId}&only_latest=true&limit=500`, (json) => {
    const groups = new Map<string, RawBuild[]>();
    for (const r of json as RawBuild[]) {
      const key = `${r.hero_build.hero_id}-${r.hero_build.hero_build_id}`;
      groups.set(key, [...(groups.get(key) ?? []), r]);
    }
    return [...groups.values()].map(trimBuild).filter((b): b is GameBuild => Boolean(b));
  });
}

/** Steam 이름 여러 명을 한 번에 (빌드 작성자 표시용) */
export function loadSteamNames(accountIds: number[]) {
  const ids = [...new Set(accountIds)].sort((a, b) => a - b);
  return load(`steam-names-${createHash('md5').update(ids.join(',')).digest('hex').slice(0, 12)}`, `${API_BASE}/v1/players/steam?account_ids=${ids.join(',')}`, (json) =>
    Object.fromEntries((json as Array<{ account_id: number; personaname?: string }>).map((p) => [p.account_id, p.personaname ?? ''])),
  );
}

/** NPC·오브젝트 이름 (가디언·워커 …) — 패치노트 번역 용어집용 */
export function loadNpcNames(lang: Locale) {
  const code = API_LANG[lang];
  return load<Array<{ class_name: string; name: string }>>(`npc-names-${code}`, `${API_BASE}/v1/assets/npc-units?language=${code}`, (json) =>
    (json as Array<{ class_name: string; name?: string }>).filter((n) => n.name).map((n) => ({ class_name: n.class_name, name: n.name! })),
  );
}

/**
 * 패치노트 — API 는 최근 글 30개(포럼 글 섞임)만 줘서 오래된 패치가 밀려난다. 저장소의 보관 파일(src/data/patch-archive.json,
 * 매일 GitHub Actions 가 tools/archive-patches.mjs 로 새 글을 쌓음)과 합친다. 같은 글(Steam 주소)은 API 쪽을 쓴다.
 */
export async function loadPatches(): Promise<RawPatch[] | null> {
  const fresh = await load<RawPatch[]>('patches', `${API_BASE}/v2/patches`, (json) =>
    (json as RawPatch[]).map((p) => pickKeys(p, ['source', 'title', 'link', 'pub_date', 'content']) as RawPatch),
  );
  // 같은 글 = 같은 Steam 주소 (주소 없는 옛 글만 게시 시각 + 제목) — 제목을 고친 글이 둘로 잡히지 않게
  const key = (p: RawPatch) => p.link || `${p.pub_date}|${p.title.trim()}`;
  const seen = new Set((fresh ?? []).map(key));
  const merged = [...(fresh ?? []), ...(patchArchive as RawPatch[]).filter((p) => !seen.has(key(p)))];
  return merged.length ? merged : null;
}
