/**
 * 티어 · 승률표의 랭크 단계별 수치를 **짧은 조각으로 받아 쌓기** (2026-10-29, docs/deploy-failures.md).
 *
 * 숙련자(평생 80판) 필터가 붙은 요청은 deadlock-api 가 미리 집계한 표를 못 써서 무겁다. 2026-10-20 API 변경 뒤로 7 · 14 · 30일 요청이
 * API 시간 제한(20초)에 걸려 504 가 나고 배포가 멈췄다. 하루 · 단계 하나짜리 조각은 5–6초에 끝나므로:
 *  - 기간을 조각으로 나눈다 — 경계 = 한국 0시 + 현재 · 이전 패치 시각(정각으로 내림). 판수 · 승수 · 킬은 더할 수 있어 기간 = 조각 합.
 *  - GitHub Actions(tools/archive-tiers.ts)가 조각을 받아 src/data/tier-archive.json 에 쌓고, 빌드는 그 파일을 더하기만 한다.
 *    파일에 없는 조각(새 패치로 경계가 생김 등)만 빌드가 직접 받는다.
 *  - 경기는 며칠에 걸쳐 늦게 들어온다(2026-10-29 측정: 1시간 사이 어제 경기 +1.1%, 사흘 전 +0.2%). 그래서 끝난 지 3일 안 된 조각은
 *    매번, 15일 안 된 조각은 하루 한 번 다시 받고, 끝나고 15일 뒤에 받은 값으로 굳힌다 (refreshDue).
 * API 는 시각을 정각으로 맞추고(시작 내림 · 끝 올림) 양 끝을 포함한다 — 경계를 정각으로 두면 조각이 그대로 이어진다
 * (정각 0초에 시작한 경기만 이웃 조각에 한 번 더 들어간다 — 무시할 만큼 적다).
 *
 * '전체(일반 포함)' 의 숙련자 수치는 받지 않는다 — 일반 매치는 1시간 조각도 붐비는 시간엔 20초를 넘는다 (tiers.ts 가 '—' 로 둔다).
 * 이 파일은 tsx 로 도는 수집 스크립트도 import 하므로 import.meta.env 같은 Astro 전용 기능을 쓰지 않는다.
 */
import { API_BASE, loadPatches } from './fetch';
import { startsPatchWindow } from './patch-posts';

/** 숙련자 = 그 영웅을 평생 이만큼 이상 한 플레이어 (min_hero_matches_total) */
export const EXPERIENCED_GAMES = 80;
export const PIECE_STEPS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] as const;

const HOUR = 3600;
const DAY = 86_400;
const KST = 9 * HOUR;

/** 조각 한 칸(랭크 단계 하나) — a: [영웅, 판수, 승수, 킬, 데스, 어시] 전체, e: [영웅, 판수, 승수] 숙련자. at = 받은 시각 */
export interface PieceStep {
  at: number;
  a: number[][];
  e: number[][];
}

export interface TierPiece {
  from: number;
  to: number;
  steps: Record<string, PieceStep>;
}

export interface TierArchive {
  version: 1;
  /** 숙련자 기준 — 바뀌면 옛 조각을 쓰지 않는다 */
  exp: number;
  /** 마지막으로 쌓은 시각 (정각) — 빌드는 여기까지를 '지금' 으로 본다 */
  end: number;
  pieces: TierPiece[];
}

/**
 * 현재·이전 패치 시작 시각 — Steam 패치노트 게시 시각, 최신 순.
 * 제목으로 거르지 않는다 ('Update' 가 없는 대형 패치 'City Never Sleeps'). 영웅 출시 공지는 뺀다 (patch-posts.ts).
 */
export async function patchStarts(): Promise<number[]> {
  const patches = await loadPatches();
  // 같은 시각이 두 번이면 '이전 패치' 기간이 0 이 된다 → 한 번만
  return [...new Set((patches ?? []).filter(startsPatchWindow).map((p) => Math.floor(Date.parse(p.pub_date) / 1000)))].sort((a, b) => b - a);
}

export const floorHour = (t: number) => Math.floor(t / HOUR) * HOUR;
/** 한국 0시 */
export const kstDayStart = (t: number) => Math.floor((t + KST) / DAY) * DAY - KST;

/** 기간 정의 — 최근 n일 = n일 전 한국 0시부터 (2026-10-29 사용자 결정, 예전엔 지금으로부터 딱 n일), 패치 기간 = 패치 시각(정각 내림)부터 */
export function tierRanges(patchStarts: number[], end: number) {
  const today = kstDayStart(end);
  const day = (n: number) => today - n * DAY;
  const [p0, p1] = patchStarts.map(floorHour);
  return {
    patch: { from: p0, to: end },
    prev: { from: p1, to: p0 },
    '7d': { from: day(7), to: end },
    '14d': { from: day(14), to: end },
    '30d': { from: day(30), to: end },
    /** 일주일 전 시점의 '최근 2주' — 티어 변동 표시용 */
    weekAgo: { from: day(21), to: day(7) },
  };
}

/** 조각 경계 — 필요한 가장 이른 시각부터 end 까지 한국 0시마다 + 패치 시각 */
export function pieceGrid(patchStarts: number[], end: number): Array<[number, number]> {
  const r = tierRanges(patchStarts, end);
  const start = Math.min(...Object.values(r).map((x) => x.from));
  const cuts = new Set<number>([start, end, r.patch.from, r.prev.from]);
  for (let d = kstDayStart(start) + DAY; d < end; d += DAY) cuts.add(d);
  const sorted = [...cuts].filter((t) => t >= start && t <= end).sort((a, b) => a - b);
  return sorted.slice(1).map((to, i) => [sorted[i], to]);
}

/** 다시 받아야 하는 칸인가 — 끝난 지 3일 안 = 매번, 15일 안 = 하루 한 번, 그 뒤 = 끝나고 15일 뒤에 받은 값으로 굳힘 */
export function refreshDue(piece: { to: number }, step: PieceStep | undefined, now: number): boolean {
  if (!step) return true;
  const age = now - piece.to;
  if (age < 3 * DAY) return true;
  if (step.at >= piece.to + 15 * DAY) return false;
  return now - step.at >= 20 * HOUR;
}

/**
 * 작업을 동시에 limit 개씩 (analytics 는 IP 당 분당 200회를 여러 주소가 나눠 쓴다).
 * gapMs = 작업 시작 사이 최소 간격.
 */
export async function pool<T>(tasks: Array<() => Promise<T>>, limit: number, gapMs = 0): Promise<T[]> {
  const out: T[] = new Array(tasks.length);
  let next = 0;
  let lastStart = 0;
  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (next < tasks.length) {
        const i = next++;
        if (gapMs) {
          const wait = lastStart + gapMs - Date.now();
          lastStart = Math.max(Date.now(), lastStart + gapMs);
          if (wait > 0) await new Promise((r) => setTimeout(r, wait));
        }
        out[i] = await tasks[i]();
      }
    }),
  );
  return out;
}

interface RawRow {
  hero_id: number;
  bucket?: number | null;
  wins: number;
  matches: number;
  total_kills: number;
  total_deaths: number;
  total_assists: number;
}

/** 요청 하나 — fetch.ts 의 load() 와 같은 재시도(429 · 504 외 5xx · 연결 끊김은 두 번 더, 504 는 10분 fail fast 라 바로 포기). 캐시는 쓰지 않는다 */
async function getRows(url: string): Promise<RawRow[] | string> {
  const get = () => fetch(url, { signal: AbortSignal.timeout(60_000) }).catch((e: unknown) => e as Error);
  let res = await get();
  for (let attempt = 1; attempt <= 2 && (res instanceof Error || res.status === 429 || (res.status >= 500 && res.status !== 504)); attempt++) {
    const after = res instanceof Error ? 0 : Math.min(Number(res.headers.get('retry-after')) || 0, 60);
    await new Promise((r) => setTimeout(r, (after > 0 ? after : 15 * attempt) * 1000));
    res = await get();
  }
  if (res instanceof Error) return res.message;
  if (!res.ok) return `HTTP ${res.status}`;
  return (await res.json()) as RawRow[];
}

const statsUrl = (from: number, to: number, extra: Record<string, string>) =>
  `${API_BASE}/v1/analytics/hero-stats?${new URLSearchParams({ game_mode: 'normal', min_unix_timestamp: String(from), max_unix_timestamp: String(to), ...extra })}`;

/** 504 가 나면 반으로 나눠 다시 묻는 가장 작은 폭 — 하루 → 12시간 → 6시간 */
const MIN_SPLIT = 6 * HOUR;

/**
 * 랭크 단계 하나의 숙련자 수치 [영웅, 판수, 승수]. 504(시간 제한)면 정각 기준 반으로 나눠 각각 물어 더한다 —
 * API 는 같은 요청만 10분 동안 바로 거절하므로 나눈 요청은 바로 물을 수 있고, 폭이 작을수록 빨리 끝난다.
 * 하위 단계(2–6)는 사람이 많아 하루치가 붐비는 때 20초를 넘었다 (2026-10-29 첫 수집).
 */
async function fetchExp(from: number, to: number, n: number): Promise<number[][] | string> {
  const rows = await getRows(statsUrl(from, to, { min_average_badge: String(n * 10 + 1), max_average_badge: String(n * 10 + 6), min_hero_matches_total: String(EXPERIENCED_GAMES) }));
  if (typeof rows !== 'string') return rows.map((r) => [r.hero_id, r.matches, r.wins]);
  const mid = floorHour((from + to) / 2);
  if (rows !== 'HTTP 504' || mid - from < MIN_SPLIT || to - mid < MIN_SPLIT) return rows;
  const left = await fetchExp(from, mid, n);
  if (typeof left === 'string') return left;
  const right = await fetchExp(mid, to, n);
  if (typeof right === 'string') return right;
  const byHero = new Map<number, number[]>();
  for (const [id, m, w] of [...left, ...right]) {
    const acc = byHero.get(id) ?? [id, 0, 0];
    acc[1] += m;
    acc[2] += w;
    byHero.set(id, acc);
  }
  return [...byHero.values()];
}

/** '전체(일반 포함)' 기간 하나 — 숙련자 필터가 없어 가볍다 (미리 집계한 표로 0.5–2초) */
export async function fetchAllScope(from: number, to: number) {
  const rows = await getRows(statsUrl(from, to, {}));
  if (typeof rows === 'string') return rows;
  return rows.map((r) => [r.hero_id, r.matches, r.wins, r.total_kills, r.total_deaths, r.total_assists]);
}

/**
 * 조각 하나를 받는다 — 전체는 평균 휘장별로 한 번에(bucket=avg_badge, 가볍다), 숙련자는 단계마다 한 번씩(무겁다, 동시 2개, 504 면 나눠서).
 * 숙련자를 못 받은 단계는 빠진다 (전체 · 숙련자가 같은 때 받은 값이어야 비숙련 = 전체 − 숙련자가 맞으므로 한 칸 단위로만 바꾼다).
 */
export async function fetchPiece(from: number, to: number, steps: readonly number[], onFail: (msg: string) => void): Promise<Record<string, PieceStep>> {
  const out: Record<string, PieceStep> = {};
  if (!steps.length) return out;
  const at = Math.floor(Date.now() / 1000);
  const label = `${new Date(from * 1000).toISOString().slice(0, 13)}–${new Date(to * 1000).toISOString().slice(5, 13)}`;
  const all = await getRows(statsUrl(from, to, { bucket: 'avg_badge' }));
  if (typeof all === 'string') {
    onFail(`조각 ${label} 전체: ${all}`);
    return out;
  }
  const byStep = new Map<number, Map<number, number[]>>();
  for (const r of all) {
    const step = Math.floor((r.bucket ?? 0) / 10);
    if (step < 1 || step > 11) continue; // 0 = 휘장 없음 (일반 매치)
    const heroes = byStep.get(step) ?? new Map<number, number[]>();
    const acc = heroes.get(r.hero_id) ?? [r.hero_id, 0, 0, 0, 0, 0];
    acc[1] += r.matches;
    acc[2] += r.wins;
    acc[3] += r.total_kills;
    acc[4] += r.total_deaths;
    acc[5] += r.total_assists;
    heroes.set(r.hero_id, acc);
    byStep.set(step, heroes);
  }
  await pool(
    steps.map((n) => async () => {
      const exp = await fetchExp(from, to, n);
      if (typeof exp === 'string') {
        onFail(`조각 ${label} 단계 ${n} 숙련자: ${exp}`);
        return;
      }
      out[n] = { at, a: [...(byStep.get(n)?.values() ?? [])], e: exp };
    }),
    2,
    350,
  );
  return out;
}

/** 저장소에 쌓는 파일 (작업 폴더 기준) */
export const ARCHIVE_FILE = 'src/data/tier-archive.json';

/** 보관 파일 읽기 — 없거나 형식 · 숙련자 기준이 다르면 null */
export async function readArchive(): Promise<TierArchive | null> {
  const { readFile } = await import('node:fs/promises');
  try {
    const a = JSON.parse(await readFile(ARCHIVE_FILE, 'utf8')) as TierArchive;
    return a.version === 1 && a.exp === EXPERIENCED_GAMES && Array.isArray(a.pieces) ? a : null;
  } catch {
    return null;
  }
}

/** 조각 하나에 한 줄 — 다시 받은 조각만 diff 에 보이게 */
export function serializeArchive(a: TierArchive): string {
  const head = JSON.stringify({ version: a.version, exp: a.exp, end: a.end });
  return `${head.slice(0, -1)},"pieces":[\n${a.pieces.map((p) => JSON.stringify(p)).join(',\n')}\n]}\n`;
}

/** [from, to] 를 빈틈 · 겹침 없이 덮는 조각들 — 하나라도 모자라면 null */
export function coveringPieces(pieces: TierPiece[], from: number, to: number): TierPiece[] | null {
  const inside = pieces.filter((p) => p.from >= from && p.to <= to).sort((a, b) => a.from - b.from);
  let at = from;
  for (const p of inside) {
    if (p.from !== at) return null;
    at = p.to;
  }
  return at === to ? inside : null;
}
