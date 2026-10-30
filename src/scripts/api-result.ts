/**
 * /api 응답 판정 + 정적 스냅샷 (#21, 2026-10-30) — scripts/guides.ts · guide.ts 공용.
 *   ok      정상 JSON
 *   missing JSON 404 (진짜 없는 글)
 *   busy    429 — 짧은 시간에 너무 많이 부름 (함수 안 제한 · Vercel 방화벽, #18)
 *   down    저장소에 닿지 못함 — 503 readonly · 5xx · 네트워크 오류 · JSON 이 아닌 응답
 *           (Cloudflare Pages 예비 배포(#33)엔 /api 가 없어 404 HTML 이 온다 → 이것도 down)
 * down 이면 화면은 빌드 때 구운 /guides-snapshot.json(요약 · 팁) · /guides-snapshot-full.json(본문, 보기 화면만)으로 대신 그린다 — 이때만 받는다.
 */
import type { Guide, GuideSummary } from '../lib/guide-format';
import type { PublicTip } from '../lib/tips';

export type ApiResult<T> = { kind: 'ok'; data: T } | { kind: 'missing' } | { kind: 'busy' } | { kind: 'down' };

const isJson = (r: Response) => (r.headers.get('content-type') ?? '').includes('application/json');

export async function getJson<T>(url: string): Promise<ApiResult<T>> {
  let r: Response;
  try {
    r = await fetch(url);
  } catch {
    return { kind: 'down' };
  }
  if (r.status === 429) return { kind: 'busy' };
  if (!isJson(r) || r.status >= 500) return { kind: 'down' };
  if (r.status === 404) return { kind: 'missing' };
  if (!r.ok) return { kind: 'down' };
  try {
    return { kind: 'ok', data: (await r.json()) as T };
  } catch {
    return { kind: 'down' };
  }
}

/** 쓰기 응답이 '지금 저장소를 못 씀' 인지 — 503 readonly · 5xx · JSON 아님(예비 배포) */
export const isDown = (r: Response) => r.status >= 500 || !isJson(r);

/** src/pages/guides-snapshot.json.ts 가 굽는 요약 파일 (만드는 코드는 서버 코드를 불러서 여기선 모양만 따로) */
export interface GuidesSnapshot {
  builtAt: number;
  ok: boolean;
  guides: GuideSummary[];
  tips: Record<number, PublicTip[]>;
}
/** 한 번만 받는다. 못 받았거나 빈 스냅샷(ok: false — 빌드 때 저장소도 직전 사본도 없었음)이면 null → 화면은 '없음' 이 아니라 '못 불러옴' */
const once = <T extends { ok: boolean }>(url: string) => {
  let p: Promise<T | null> | undefined;
  return () =>
    (p ??= fetch(url)
      .then((r) => (r.ok ? (r.json() as Promise<T>) : null))
      .then((s) => (s?.ok ? s : null))
      .catch(() => null));
};
/** 가이드 요약 · 팁 — 목록 · 영웅 탭. 한 번만 받고, 못 받으면 null */
export const loadSnapshot = once<GuidesSnapshot>('/guides-snapshot.json');
/** 가이드 본문 — 보기 화면만 (본문이 들어 있어 클 수 있다) */
export const loadFullSnapshot = once<{ builtAt: number; ok: boolean; guides: Guide[] }>('/guides-snapshot-full.json');
