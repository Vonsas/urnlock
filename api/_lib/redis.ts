/**
 * Upstash Redis REST — 명령 하나를 JSON 배열로 보낸다 (["SET", "k", "v"]). 패키지 없이 fetch 만.
 * 주소·토큰은 Vercel 에 연결한 Upstash 가 넣어 준 환경 변수 (KV_ 접두어, 2026-10-06 연결).
 * 파일 이름이 _ 로 시작하는 폴더는 Vercel 이 함수로 만들지 않는다 (공용 코드).
 */
const URL_ = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;

/**
 * 저장소에 닿지 못함 (#21) — timeout(2.5초 안에 응답 없음) · limit(무료 한도 초과) · error(그 밖의 오류 · 네트워크).
 * 핸들러는 이걸 잡아 503 'readonly' 로 돌려준다 (http.ts storeDown) — 쓰기는 잠시 막히고 읽기는 CDN 옛 응답 · 정적 스냅샷으로.
 */
export class StoreError extends Error {
  constructor(
    message: string,
    readonly kind: 'timeout' | 'limit' | 'error' = 'error',
  ) {
    super(message);
  }
}
/** 응답이 이보다 늦으면 포기한다 — 함수가 끝까지 기다리며 실행 시간(이것도 한도)을 쓰지 않게, 수용 기준 '3초 안에 503' */
const TIMEOUT_MS = 2500;

/** Upstash 에 요청 — 시간 제한 · 실패 종류 구분 · 로그 한 줄 (redis · pipeline 공용) */
async function send(path: string, body: unknown, what: string): Promise<unknown> {
  if (!URL_ || !TOKEN) throw fail(new StoreError('저장소 환경 변수가 없습니다 (KV_REST_API_URL / KV_REST_API_TOKEN)'));
  let res: Response;
  try {
    res = await fetch(`${URL_.replace(/\/$/, '')}${path}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    const timeout = (e as Error)?.name === 'TimeoutError' || (e as Error)?.name === 'AbortError';
    throw fail(new StoreError(`redis ${what}: ${timeout ? `${TIMEOUT_MS}ms 안에 응답 없음` : String(e)}`, timeout ? 'timeout' : 'error'));
  }
  const parsed = (await res.json().catch(() => null)) as { error?: string } | unknown[] | null;
  const error = !Array.isArray(parsed) ? parsed?.error : undefined;
  if (!res.ok || error) throw fail(new StoreError(`redis ${what}: ${error ?? res.status}`, limitHit(error, res.status) ? 'limit' : 'error'));
  return parsed;
}
/** Upstash 한도 초과 응답 — 'ERR max requests limit exceeded …' · 'max daily request limit' 류 (문서에 정확한 문구가 없어 넓게) */
const limitHit = (error: string | undefined, status: number) => status === 429 || /limit (exceeded|reached)|exceeded.*limit|quota/i.test(error ?? '');
function fail(e: StoreError) {
  console.error(`[dldb:store] ${e.kind}: ${e.message}`);
  return e;
}

export async function redis<T = unknown>(...command: Array<string | number>): Promise<T> {
  const body = (await send('', command.map(String), String(command[0]))) as { result?: T };
  return body.result as T;
}

/**
 * 여러 명령을 HTTP 한 번에 (Upstash REST /pipeline, #20). 결과는 보낸 순서대로. 하나라도 오류면 StoreError.
 * 요금 · 한도는 줄지 않는다 — Upstash 는 파이프라인 안의 명령도 하나씩 센다 (2026-10-29 문서 확인). 줄어드는 건 왕복 시간뿐이라
 * 서로 기다릴 필요가 없는 명령만 묶는다. 원자적이지 않다 (사이에 다른 요청의 명령이 끼어들 수 있음).
 */
export async function pipeline<T extends unknown[] = unknown[]>(commands: Array<Array<string | number>>): Promise<T> {
  if (!commands.length) return [] as unknown as T;
  const body = (await send('/pipeline', commands.map((c) => c.map(String)), 'pipeline')) as Array<{ result?: unknown; error?: string }>;
  if (!Array.isArray(body) || body.length !== commands.length) throw fail(new StoreError('redis pipeline: 결과 개수가 다름'));
  const failed = body.findIndex((x) => x.error);
  if (failed >= 0) throw fail(new StoreError(`redis ${commands[failed][0]}: ${body[failed].error}`, limitHit(body[failed].error, 200) ? 'limit' : 'error'));
  return body.map((x) => x.result) as T;
}

/**
 * 세는 키 — 처음 만들 때만 만료를 건다. 올린 뒤의 값을 돌려준다.
 * 명령 1회(기간의 첫 회만 2회)로 이미 최소다: Lua 로 묶으면 EVAL + INCR + EXPIRE = 3회, 파이프라인(INCR + EXPIRE NX)은 늘 2회로 센다 (#20 확인)
 */
export async function bump(key: string, ttlSeconds: number): Promise<number> {
  const n = await redis<number>('INCR', key);
  if (n === 1) await redis('EXPIRE', key, ttlSeconds);
  return n;
}
