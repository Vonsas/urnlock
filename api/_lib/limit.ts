/**
 * 함수 안 1차 요청 수 제한 (#18, 2026-10-30) — 함수 인스턴스 메모리에 IP별 1분 고정 창 카운터.
 * 저장소(Redis)는 쓰지 않는다: 세는 데 명령을 쓰면 그 자체가 무료 한도를 깎으므로. 인스턴스마다 따로라 느슨하지만
 * (인스턴스가 여럿이면 그만큼 더 받는다) 한 곳에서 같은 요청을 되풀이하는 건 저장소에 닿기 전에 거른다.
 * 앞단 방어는 Vercel 방화벽 요청 수 제한 규칙 — 무료 요금제는 프로젝트당 1개, 대시보드 또는 CLI 로 만든다 (docs/rate-limit.md).
 *
 *   read  — 가이드 · 팁 목록 · 한 편 · 세션 · 운영자 목록 (CDN 이 놓친 요청만 여기 닿는다)
 *   write — 글 · 수정 · 삭제 · 추천 · 신고 · 사진 · 운영자 처리 (오늘 한도 같은 쓰기 제한은 저장소에 따로 있다 — 그대로)
 *   auth  — 스팀 로그인 결과 확인 · 로그아웃 · 운영자 로그인
 * 카운터는 함수 파일마다 따로다 (Vercel 은 api/ 파일마다 다른 인스턴스) — 같은 묶음 이름이어도 가이드 · 팁 · 세션은 각각 센다.
 *
 * 남의 IP 로 세게 만들어 그 사람을 막는 일 (#18 리뷰): 다른 사이트가 방문자 브라우저로 요청을 보내게 하면 방문자 IP 로 세진다.
 *  - POST · PUT · DELETE 는 같은 사이트 요청만 센다 — 다른 사이트에서 온 것(Origin 없음 포함)은 여기서 세지 않고 바로 403 으로 돌려준다.
 *    핸들러의 같은 사이트 확인에 기대지 않으므로, 핸들러가 그 확인을 빠뜨려도 '안 세는 쓰기 요청' 이 생기지 않는다 (#18 2차 리뷰)
 *  - 저장소를 안 쓰는 GET(스팀 로그인 시작 · 로그아웃 GET)엔 걸지 않고, 스팀 결과 확인은 state 쿠키와 돌아올 주소의 state 가 맞은 뒤(스팀 서명 확인 전)에 센다
 *  - 읽기 GET 은 그래도 센다 (헤더는 위조할 수 있어 거를 수 없다) — 막혀도 1분이고 대부분 CDN 에서 끝난다
 * 넘으면 429 + Retry-After, 본문 error 'busy' — 하루 한도에 걸린 'rate' 와 화면 문구를 나눈다.
 */
import { clientIp, json, sameOrigin } from './http.js';

export type LimitKind = 'read' | 'write' | 'auth';
/** 1분에 IP 하나가 함수 인스턴스 하나에 보낼 수 있는 요청 수 — 보통 사용(가이드 탭 열기 = 요청 3개)은 걸리지 않게 넉넉히 */
export const LIMITS: Record<LimitKind, number> = { read: 60, write: 20, auth: 10 };
const WINDOW_MS = 60_000;
/** 기억하는 IP 수 상한 — 넘으면 끝난 창부터, 그래도 많으면 오래된 창부터 지운다 (막혀 있는 최근 IP 는 남는다) */
const MAX_KEYS = 10_000;
const hits = new Map<string, { start: number; n: number }>();

function prune(now: number) {
  for (const [k, v] of hits) if (now - v.start >= WINDOW_MS) hits.delete(k);
  // Map 은 넣은 순서 = 창을 시작한 순서 (새 창은 지웠다 다시 넣는다) → 앞에서부터가 가장 오래된 창. 10% 여유를 둬 매번 돌지 않게
  for (const k of hits.keys()) {
    if (hits.size < MAX_KEYS * 0.9) break;
    hits.delete(k);
  }
}

/** 넘었으면 돌려줄 429 응답(다른 사이트에서 온 쓰기 요청은 세지 않고 403), 아니면 null. 핸들러 맨 앞(저장소보다 먼저)에서 부른다 */
export function limited(request: Request, kind: LimitKind, now = Date.now()): Response | null {
  if (request.method !== 'GET' && request.method !== 'HEAD' && !sameOrigin(request)) return json({ ok: false, error: 'auth', problem: { error: 'auth' } }, 403);
  const key = `${kind}:${clientIp(request)}`;
  let e = hits.get(key);
  if (!e || now - e.start >= WINDOW_MS) {
    if (!e && hits.size >= MAX_KEYS) prune(now);
    hits.delete(key);
    e = { start: now, n: 0 };
    hits.set(key, e);
  }
  e.n++;
  if (e.n <= LIMITS[kind]) return null;
  const retry = Math.max(1, Math.ceil((e.start + WINDOW_MS - now) / 1000));
  // 엔드포인트마다 오류 모양이 달라(error · problem.error) 둘 다 넣는다
  return json({ ok: false, error: 'busy', problem: { error: 'busy' } }, 429, { 'retry-after': String(retry) });
}

/** 검사용 — 카운터 비우기 · 기억하는 키 수 */
export const resetLimits = () => hits.clear();
export const limitKeys = () => hits.size;
