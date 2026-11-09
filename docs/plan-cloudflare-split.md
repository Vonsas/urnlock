# 정적 페이지는 Cloudflare, `/api` 만 Vercel - 설계 결정 (#46-①, #50, 2026-10-30)

상위: #46. 이 문서의 결정을 ②(#51 서버) · ③(#52 프록시 함수) · ④(#53 파이프라인) · ⑤(#54 점검) · ⑥(#55 전환) · ⑦(#56 정리)가 그대로 따른다.
구현은 이 문서 범위 밖. 바뀌면 이 문서를 먼저 고치고 해당 이슈에 알린다.

```
브라우저 ──https://www.urnlock.com (또는 urnlock.pages.dev)──▶ Cloudflare Pages (urnlock)
                                        ├─ 정적 파일(dist/) - 무료 · 개수 제한 없음
                                        └─ /api/* 만 Pages Function ──비밀 헤더 + 방문자 IP + 방문 주소──▶ https://origin.urnlock.com (Vercel, DNS only)
```

## 1. Pages 재사용 - Workers static assets 가 아니라 (결정)

#33 의 Pages 프로젝트 `urnlock` 에 `/api` 프록시 함수만 더한다. (#46 본문의 'Workers static assets' 안은 쓰지 않는다.)

- 이미 있는 것: 프로젝트 · `_headers` · `_redirects` 자동 변환(`tools/build-pages-config.mjs`) · 한도 · health 검사 · 매일 업로드(`pages-standby.yml`) · 실제 업로드 확인(`docs/plan-pages-standby.md`).
- 함수: `functions/api/[[path]].js` (`/api/` 아래 모든 깊이) + `dist/_routes.json` 에 `{"version":1,"include":["/api/*"],"exclude":[]}`
  → 정적 요청은 함수를 부르지 않아 무료 · 무제한, 함수 호출은 `/api` 만 (무료 하루 10만 건 - Workers 와 합산, UTC 0시 초기화).
  `_routes.json` 은 `build-pages-config.mjs` 가 만든다 (③). 호환 날짜(compatibility date)는 2024-11-11 이후로 (`fetch` 의 `cache: 'no-store'` 가 그때부터 동작).
- Workers static assets 를 고르지 않은 이유: 같은 일을 하는데 배포 방식(wrangler.toml · `run_worker_first`)을 새로 만들어야 하고, #33 에서 확인한 것을 다시 확인해야 한다.

## 2. 빌드 위치 - Vercel 빌드가 Pages 에도 올린다 (결정 'C', 사용자 2026-10-30)

Vercel 운영(Production) 빌드가 끝나면 같은 `dist/` 를 Pages 프로젝트 `urnlock` 에 `wrangler pages deploy` 로 올린다. 새 Cloudflare 항목을 만들지 않고, Actions 시간을 쓰지 않는다.

고른 이유 (B = Cloudflare Git 연결 빌드 · A = Actions 빌드와 비교):
- 방문자가 보는 사이트 속도는 셋이 같다(같은 `dist/` 를 Cloudflare 가 내보냄). 차이는 데이터를 올리는 길뿐.
- A 는 Actions 월 약 1,700–2,300분(무료 2,000분)으로 첫 달부터 넘칠 수 있었다(1차 리뷰에서 실행 기록으로 다시 셈).
- B 는 직접 올리기 항목을 Git 연결로 못 바꿔 새 항목 · 도메인 · 환경 변수 · 비밀값을 다시 만들어야 하고, 빌드 제한 20분 · 동시 1개라 데이터 반영이 느리고 실패할 수 있다.
- C 는 지금도 main 푸시 · 6시간마다(daily-rebuild → Deploy Hook) 도는 Vercel 빌드를 그대로 쓴다. Vercel 'Limits' 문서에 Hobby 는 한 번 45분 · 하루 100번 배포만 적혀 있다
  (월 빌드 시간 한도 표기는 확인 필요 - 있더라도 지금 규모 월 약 1,300분이면 넉넉하다).
  빌드 안의 health 검사가 문제를 찾으면 빌드가 멈추므로 불량 데이터는 Pages 에도 안 올라간다. 빌드 갈래가 하나라 두 번 빌드할 일도 없다.

④(#53)가 만들 것:
- `vercel.json` `buildCommand` 끝에 올리기 단계(예 `tools/vercel-to-pages.mjs`): `VERCEL_ENV=production` 이고 Cloudflare 토큰이 있을 때만.
  순서: `build-pages-config.mjs dist` 를 자식 프로세스로(문제가 있으면 `process.exit(1)` 로 끝나므로) → `npx --yes wrangler@4.20.0 pages deploy dist --project-name=urnlock --branch=main --commit-hash=<VERCEL_GIT_COMMIT_SHA> --commit-message=<짧게>`
  (저장소 바닥에서 - `functions/` 도 같이) → 성공이든 실패든 `finally` 에서 `dist/_headers` · `_redirects` · `_routes.json` 을 지운다 (Vercel 은 buildCommand 가 끝난 뒤 `dist/` 를 그대로 공개하므로 남기면 `/_headers` 가 주소로 열린다).
- 올리기 실패는 Vercel 빌드를 멈추지 않는다(`/api` 배포가 막히면 안 되므로) - 빌드 로그에 `[pages] 올리기 실패` 를 남기고 넘어간다.
  감지(④): ⑥ 뒤 `check-health --status success`(Vercel 운영 배포 성공 알림)는 이미 www 의 health.json 이 새것이 될 때까지 최대 3분 기다린다 -
  3분이 지나도 새것이 아니면 Vercel 이 방금 만든 health.json 을 `https://origin.urnlock.com/health.json` 에서 읽어 둘로 나눈다 (다음에 www 가 새것이면 닫힘):
  - 그 health.json 에 problems 가 있으면 '[Urnlock] 데이터 점검 실패 - Pages 에 안 올림' 이슈 + 디스코드, 본문에 problems 목록 (pages-standby 도 같은 점검에 걸리므로 수동 실행은 안내하지 않는다 - 데이터가 나아지면 다음 6시간 빌드에 저절로 올라간다).
  - problems 가 없는데 www 가 그대로면 '[Urnlock] Pages 올리기 실패' 이슈 + 디스코드, 본문에 '수동 pages-standby 실행' 안내.
  - origin 은 `/api` 가 아닌 경로를 www 로 308 하므로 `/health.json` 은 그 규칙에서 뺀다(아래 origin 주소). 배포마다 생기는 `*.vercel.app` 주소는 배포 보호로 401 일 수 있어 쓰지 않는다.
- health 점검 실패와 `/api` 배포를 떼어 놓는다 (⑥ 부터): 지금은 점검 문제가 Vercel 빌드를 멈춰 직전 배포를 남긴다. Vercel 빌드를 줄이지 않기로 했으므로 그대로 두면
  티어 데이터가 며칠 깨질 때 `/api` 보안 수정도 배포되지 않는다. → ⑥ 에서 www 전환을 확인한 뒤 Vercel 운영 환경 변수 `PAGES_PRIMARY=1` 을 켜면 `health.json.ts` 는 빌드를 멈추지 않고,
  `build-pages-config.mjs` 가 problems 를 보고 Pages 올리기만 하지 않는다(직전 Pages 배포 = 어제 데이터가 www 에 남음). Vercel 쪽 정적 파일은 아무도 안 보므로 상관없다. (②④⑥ - #46 4차 리뷰)
- 판이 잠깐 어긋날 수 있다: Pages 는 Vercel 빌드 도중에 올라가므로, 그 뒤 Vercel 배포가 실패하면 화면만 새 판, 올리기만 실패하면 `/api` 만 새 판이다.
  → `/api` 를 바꿀 땐 앞뒤 한 배포 동안 서로 맞게(새 필드는 있어도 없어도 되게) 만든다. 되돌릴 땐 둘 다 되돌린다 - Vercel Instant Rollback 과 Cloudflare → Workers & Pages → urnlock → Deployments 에서 이전 배포 'Rollback'.
- Vercel 환경 변수(Production 만, Sensitive 로): `CLOUDFLARE_API_TOKEN` · `CLOUDFLARE_ACCOUNT_ID`.
  - GitHub 시크릿(pages-standby 용)과 다른 토큰을 새로 만든다 - 권한은 Account → Cloudflare Pages: Edit 하나, 만료일 1년. 한쪽이 새도 다른 쪽을 따로 끊을 수 있게.
  - 교체: Cloudflare 에서 새 토큰 → Vercel 환경 변수 바꾸고 운영 재배포 → 빌드 로그에 '올리기 성공' 확인 → 옛 토큰 Revoke.
- `static.urnlock.com` 참조: Vercel 운영 빌드는 `assetsPrefix` 로 `/_astro` 를 static 에서 받게 만든다. `build-pages-config.mjs` 는 이걸 막으므로
  전환 전까지는 Vercel 경로에서만 `--allow-static` 으로 허용한다(pages.dev 에서 static 이 살아 있어 점검은 된다).
  ⑥ 전환 때 `assetsPrefix` 를 끄고(static 을 안 씀) `--allow-static` 도 뺀다 - 같은 커밋으로 - 원래 ⑦ 의 static 정리 중 이 부분만 ⑥ 으로 당긴다. 그러지 않으면 Pages 가 본 사이트가 된 뒤에도 그림 · 스크립트가 Vercel(static)에서 온다.
- `pages-standby.yml`(Actions)은 예약을 빼고 수동 실행만 남긴다 - Vercel 이 멈춰 빌드 · 올리기가 안 될 때 Pages 를 Actions 에서 따로 새로 하는 비상 길(Vercel 과 무관하게 돈다). Actions 시간은 그때만 쓴다.
- 결과 (2026-11-01, #55 · PR #71): `assetsPrefix` 와 `--allow-static`(옵션째)을 한 커밋으로 뺐다. pages-standby 는 수동 + www 의 health.json 이 9시간 넘게 그대로면 daily-rebuild 가 부른다
  (Vercel 이 한도로 멈춘 동안에도 www 데이터가 갱신되게 - pages-standby 가 도는 중이거나 바로 앞 차례에 실패했으면 건너뜀 - #56 에서 '12시간 안' 창을 바꿈). www 전환은 비상 전환(11/1)으로 먼저 일어났다.

약점과 대비:
- Vercel 이 멈추면 Pages 데이터 갱신도 멈춘다 - 사이트는 마지막 데이터로 Pages 에서 계속 열린다. 그때 위의 수동 `pages-standby` 로 새로 한다.
  전환 뒤 Vercel 사용량은 `/api` 뿐이라 한도로 멈출 가능성 자체가 낮다.
- #46 ⑦ 의 'Vercel 빌드 줄이기(함수만)' 는 하지 않는다 - Vercel 이 계속 사이트 전체를 빌드해야 하므로. 비용 문제는 아니다(빌드 시간 무료).

## 3. 프록시 → Vercel 계약 (②③ 공용, 결정)

| 항목 | 값 |
|---|---|
| 비밀 헤더 | `x-urnlock-proxy-key: <PROXY_SECRET>` |
| 방문자 IP 헤더 | `x-urnlock-client-ip: <cf-connecting-ip>` |
| 방문 주소 헤더 | `x-urnlock-origin: <방문자가 연 주소의 origin>` (예 `https://www.urnlock.com`, `https://urnlock.pages.dev`) |
| 비밀값 | 무작위 32바이트 → base64url (43자). Cloudflare Pages 시크릿 `PROXY_SECRET` (Production) · Vercel 환경 변수 `PROXY_SECRET` (Production) |
| 허용 주소 | Vercel 환경 변수 `PUBLIC_ORIGINS=https://www.urnlock.com,https://urnlock.pages.dev` (첫 값이 기본) |
| 직접 접근 거절 | Vercel 환경 변수 `REQUIRE_PROXY=1` (⑥ 에서 켬 - 그 전엔 '호환 모드') |

### 프록시 함수(③)가 할 일
- 받은 요청 헤더를 새 Headers 로 복사하면서 `x-urnlock-` 로 시작하는 것은 빼고 담는다(방문자가 넣어 보낸 값으로 위조 못 하게 - 원본을 돌면서 지우면 항목을 건너뛰니 새로 만든다). 그다음 위 세 헤더를 붙인다.
  `x-urnlock-origin` 은 `new URL(request.url).origin` (방문자가 실제로 연 주소). `cf-connecting-ip` 가 없으면 Vercel 로 보내지 않고 400.
- 주소만 `https://origin.urnlock.com` 으로 바꾸고 경로 · 쿼리 · 메서드 · 본문 · 나머지 헤더(`cookie` · `origin` · `sec-fetch-site` · `content-type` …)는 그대로 넘긴다. 리디렉트는 따라가지 않는다(`redirect: 'manual'`).
- 응답은 상태 · 본문 · 헤더를 그대로 돌려준다. `set-cookie` 가 여러 개여도 모두 (`Response` 를 감싸 그대로 넘기면 유지된다 - ③에서 로그인으로 확인).
  `Location` 이 `https://origin.urnlock.com/...` 이면 방문 주소(`x-urnlock-origin`)로 바꾼다(지금 코드는 상대 경로 · 스팀 주소만 내지만 안전망).
- 캐시하지 않는다: `fetch(…, { cache: 'no-store' })`, 응답의 `Cache-Control` 은 Vercel 것 그대로 (가이드 목록의 CDN 60초는 Vercel CDN 에서 처리).
  예외 (#75, 2026-11-06): 공개 GET 셋(가이드 목록 · 한 편 `?id=` · 팁 목록 - `?me=1` 제외)은 함수가 Cloudflare 캐시(`caches.default`, 데이터센터마다)에 담는다.
  키 = 방문 주소만(쿠키 · 헤더 무시), 담는 응답 = 200 · `Set-Cookie` 없음 · `public`. 60초는 새것 · 360초까지는 옛것을 주며 뒤에서 새로 받음 · Vercel 이 5xx · 닿지 못함이면 하루 안 옛것
  (Vercel 의 `s-maxage=60, stale-while-revalidate=300, stale-if-error=86400` 과 같게 - Vercel 이 `s-maxage` 를 떼고 `public` 만 넘겨서 함수에 숫자로 둔다).
  캐시에서 나갈 때 방문자가 gzip 을 받으면 `Content-Encoding: gzip` 을 붙여 런타임이 압축한다(안 붙이면 Cloudflare 가 압축하지 않아 3–4배 크게 나갔다 - #75 머지 뒤 확인).
  Vercel 이 준 `Age` 만큼 먼저 담은 것으로 쳐 두 캐시가 겹쳐도 옛 본문이 더 오래 남지 않는다. 응답에 `x-urnlock-cache: HIT · STALE · MISS`.
  함수 호출 수는 그대로(함수가 먼저 돈다 - Pages 함수 앞에서 Cache Rule 로 받는 방법은 없다), 줄어드는 건 Vercel 요청 · 함수 · Upstash 명령.
  재검증에서 우리 서버가 '없는 글' 이라고 답하면(404 + `public`, `x-vercel-mitigated` 없음) 옛것을 지운다 - 그래서 지운 · 내린 글은 예전처럼
  60초 뒤 재검증 무렵 한두 번 더 보이고 사라지며(동시에 돈 재검증 · Vercel CDN 의 지역별 옛 응답 때문에 드물게 몇 번), 그 뒤 Vercel 이 고장 나도 다시 나오지 않는다.
  그 밖의 답(봇 규칙 403 · 401 · 429 · 5xx)으로는 지우지 않는다 - 프록시가 방문자 User-Agent 를 넘겨 Vercel 봇 규칙이 curl 같은 요청에 403 을 주므로,
  그걸로 지우면 봇 하나가 모두의 캐시를 날린다. 캐시에 맞은 GET 은 Vercel 봇 규칙을 거치지 않는다(공개 자료라 그대로 둔다 - 앞단은 Cloudflare WAF 요청 수 제한). 캐시 비우기(purge)는 넣지 않았다(데이터센터마다라 Zone 비우기로 다 지워지는지 확인 안 됨).
  캐시 대상 요청엔 쿠키 · `authorization` 을 Vercel 로 보내지 않는다 (서버가 실수로 읽어도 섞이지 않게).
- 시간 제한 30초 - 스팀 로그인 콜백은 스팀 확인에 8초까지 기다린 뒤 저장소 · 작성자 조회를 하고, 함수가 처음 깨어나는 시간도 있다. 짧게 잡으면 프록시가 먼저 503 을 내는 사이
  Vercel 은 끝까지 처리해 nonce 를 써 버리고 로그인 쿠키는 버려져 다시 해도 실패한다(2차 리뷰). 사진 올리기(1MB)도 느린 회선을 생각해 같은 값.
- Vercel 에 닿지 못하면(연결 실패 · 30초 초과 · Vercel 이 502/504): 503 + `Retry-After: 30` + JSON `{"ok":false,"error":"unavailable","problem":{"error":"unavailable"}}` (`cache-control: no-store`)
  - `limit.ts` 의 429 와 같은 모양(엔드포인트마다 `error` · `problem.error` 를 따로 읽어서 둘 다).
  #21 의 읽기 전용 폴백이 503 을 '저장소 장애' 로 보고 스냅샷으로 그리는 것과 같은 꼴 - #21 이 이 응답도 처리하게 한다. Vercel 이 Hobby 한도로 멈췄을 때가 이 경우다.

### Vercel 쪽(②)이 할 일 - `api/_lib/http.ts` 한 곳에서
- `proxied(request)`: `PROXY_SECRET` 이 비어 있으면 언제나 거짓. 아니면 `x-urnlock-proxy-key` 가 `PROXY_SECRET`(또는 교체 중의 `PROXY_SECRET_PREV`)와 상수 시간 비교로 같을 때만 참.
- `clientIp`: `proxied` 면 `x-urnlock-client-ip` - IP 꼴이 아니면 400. 아니면 지금처럼 `x-vercel-forwarded-for` → … (호환 모드).
  IPv6 는 앞 64비트(/64)로 줄여 센다 - 집 회선 하나가 /64 를 통째로 받아 주소를 바꿔 가며 IP 당 제한(관리자 로그인 15분 5회 · 비로그인 신고 1번 · 시간당 10개 · `limit.ts`)을 비켜 갈 수 있어서.
  IPv4 는 그대로. 이건 프록시와 상관없이 지금 경로에도 적용한다.
- `originOf`: `proxied` 이고 `x-urnlock-origin` 이 `PUBLIC_ORIGINS` 에 정확히 있으면 그 값, 목록에 없으면 첫 값(www). `proxied` 가 아니면 지금처럼 요청 주소(미리보기 배포 · 전환 전 www 그대로).
  → 스팀 `openid.realm` · `return_to` · 콜백 검사, `sameOrigin`, `limited()` 의 같은 사이트 검사가 방문자가 연 주소 기준으로 맞는다 - www 에서도, ⑤ 의 `urnlock.pages.dev` 점검에서도.
  (`sameOrigin` 은 브라우저가 붙인 `Origin` · `Sec-Fetch-Site` 를 보는데, 프록시가 그대로 넘기므로 바뀌지 않는다. 배포마다 생기는 `<해시>.urnlock.pages.dev` 는 목록에 없어 거기선 쓰기가 안 된다 - 의도.)
  전환(⑥) 뒤에도 `urnlock.pages.dev` 는 목록에 남긴다 - 다음 점검 · 되돌리기 시험 때 쓰고, 같은 프록시 · 같은 IP 제한을 거치므로 더 열리는 길이 아니다(검색엔 noindex). ⑦ 에서 다시 본다.
- `REQUIRE_PROXY=1` 이고 `proxied` 가 아니면 `/api` 는 403 - origin 주소 · `*.vercel.app` 으로 바로 보내 IP 제한을 비켜 가는 것을 막는다. 미리보기 배포(Preview 환경)엔 이 변수를 넣지 않는다.
- 쿠키: 지금처럼 `Domain` 없이 심는다 → 브라우저는 자기가 연결한 주소(www 또는 pages.dev)에 저장한다. `Domain=` 을 붙이지 않는다.
- 위조 시나리오 검사(scratchpad apitest): 비밀값 없음 · 틀림 · 옛 값 · 빈 `PROXY_SECRET` · 헤더 중복 · 방문자가 `x-urnlock-client-ip` · `x-urnlock-origin` 을 직접 넣음 · 목록 밖 origin · IPv6 /64 안의 다른 주소 · origin 직접 요청 · `REQUIRE_PROXY` 켜고 끔.

### 비밀값 바꾸기 · 거절 켜고 끄기 (Vercel 환경 변수는 다시 배포해야 적용된다)
- 바꾸기: Vercel 에 새 값을 `PROXY_SECRET`, 옛 값을 `PROXY_SECRET_PREV` 로 넣고 Production 재배포(빌드 · health 검사 통과 확인) → Pages 시크릿을 새 값으로 바꾸고 Pages 재배포 → `/api` 정상 확인 → Vercel 에서 `PROXY_SECRET_PREV` 지우고 재배포.
- ⑥ 켜기: www 를 Pages 로 돌리고 확인한 뒤에 `REQUIRE_PROXY=1` · `PAGES_PRIMARY=1` + 재배포. (`PAGES_PRIMARY` 를 먼저 켜면 www 가 아직 Vercel 인 동안 점검에 걸린 데이터가 www 에 그대로 나간다.)
- 되돌리기는 거꾸로: `REQUIRE_PROXY` · `PAGES_PRIMARY` 를 먼저 끄고 재배포 → 그다음 DNS 를 Vercel 로 (`docs/plan-pages-standby.md` 되돌리기). 반대로 하면 그 사이 www 로 바로 오는 `/api` 가 모두 403 이고, 점검에 걸린 빌드가 www(Vercel)에 나간다.

### origin 주소
- `origin.urnlock.com` - Cloudflare DNS 에 CNAME → Vercel Domains 화면이 알려 주는 값(www 와 같은 `208acfa57af275f1.vercel-dns-017.com` 일 가능성이 크다) · DNS only(회색).
  Vercel 프로젝트 Domains 에 추가하되 도메인 단위 리디렉트는 걸지 않는다(그대로 Production). `urnlock.vercel.app` · `dldb.vercel.app` 은 www 로 308 하므로 쓸 수 없다.
- `/api` 가 아닌 경로는 www 로 308 - 인증서 공개 로그로 주소가 드러나 봇이 origin 으로 정적 페이지를 긁으면 Vercel 한도를 다시 쓴다.
  `vercel.json` redirects 에 `has: [{ type: 'host', value: 'origin.urnlock.com' }]` 조건 한 줄(`/((?!api/|health\.json$).*)` → `https://www.urnlock.com/$1`) - `/health.json` 은 check-health 가 Vercel 쪽 점검 결과를 읽어야 해서 뺀다(2절).
  이 줄은 Vercel 전용이라 `build-pages-config.mjs` 가 origin 호스트 조건이 붙은 리디렉트는 건너뛰게 고친다(지금은 `has` 가 있으면 멈춤 - ③/④).

## 4. 'DNS only(회색)' 원칙 바꾸기 (결정 - 문서 고치기는 ⑦ #56)

| 레코드 | 지금 | 바뀐 뒤 |
|---|---|---|
| `www` | CNAME → Vercel · DNS only | Pages 커스텀 도메인 · Proxied (⑥) |
| `urnlock.com` | A → Vercel · DNS only (Vercel 이 www 로 308) | Proxied + Redirect Rule 로 www 301 (`docs/plan-pages-standby.md` 의 절차) |
| `static` | CNAME → Vercel · Proxied (PR #44, 이미 예외) | `assetsPrefix` 는 ⑥ 에서 끄고(2절), 레코드는 ⑦ 에서 지운다 - 2026-11-01 지움 (#56) |
| `origin` | 없음 | CNAME → Vercel · DNS only (새로) |
| 구글 TXT | DNS only | 그대로 (지우지 말 것) |

- 새 원칙: 사이트 주소(www · 맨 도메인)는 Proxied, Vercel 로 가는 주소(origin)는 DNS only.
- Proxied 가 되면 Cloudflare 설정이 실제로 작동한다: SSL/TLS Full (strict) (⑥ 전에 대시보드에서 실제 값을 확인), Bot Preference Sync 는 끈다(robots.txt 를 우리 것 그대로 - `docs/plan-dns-cloudflare.md`),
  봇 차단이 필요하면 Vercel Firewall 대신 Cloudflare WAF 로(구글 · 네이버 Yeti 는 막지 않는다 - ⑦ 에서는 켜지 않기로 함, 아래 '봇 (⑦ 결과)').
- Vercel 방화벽의 `/api` IP 요청 수 제한(`docs/rate-limit.md` 1절)은 ⑥ 직전에 끈다 - www 가 Proxied 가 되면 Vercel 이 보는 IP 는 Cloudflare 출구 몇 개뿐이라
  방문자 전체가 한 칸에서 세져 `/api` 가 모두 429 를 받는다. 대신 Cloudflare WAF 요청 수 제한 규칙(무료 1개)을 같은 조건(`/api/` · IP · 넉넉하게)으로 ⑥ 에서 만든다.
  실제 (2026-11-01): Vercel 규칙은 처음부터 만든 적이 없어 끌 것이 없었고, Cloudflare 규칙도 만들지 않았다 - 지금 `/api` 제한은 함수 안 제한뿐 (필요하면 Cloudflare 규칙을 그때 만든다).
  함수 안 제한(`limit.ts`)은 `clientIp` 가 프록시 헤더를 쓰게 되므로(②) 그대로 동작한다.
- 캐시하지 않을 것(#46 조건 2): `/api/*`(함수가 처리) · `/admin/*` · `/health.json` - Pages 정적 파일은 배포마다 바뀌므로 Pages 기본 캐시로 충분, Cache Rule 로 HTML 을 길게 잡지 않는다.
- ⑦ 에서 고칠 문서: CLAUDE.md('모든 레코드는 DNS only' 두 곳 - static 때문에 이미 맞지 않음) · `docs/plan-dns-cloudflare.md` · `docs/rate-limit.md`('주황 구름 금지') - 2026-11-01 고침 (#56).
- 봇 (⑦ 결과): Cloudflare 봇 차단은 켜지 않았다 - 정적은 무제한이라 막을 이유가 없고, www 에서 Googlebot · Yeti UA 200 · robots.txt 가 우리 것 그대로임을 확인.

## 순서

① 이 문서 → ② 서버(호환 모드라 지금 배포해도 동작 같음) → ③ 프록시 함수(pages.dev 에서) → ④ 파이프라인 → ⑤ pages.dev 통합 점검 → ⑥ Vercel 방화벽 제한 끄기 · Cloudflare 제한 켜기(둘 다 실제로는 해당 없음 - 위 '실제') · `assetsPrefix` 끄기 · www 전환 → 확인 뒤 `REQUIRE_PROXY=1` · `PAGES_PRIMARY=1`(낮, 사용자 승인) → ⑦ 정리.
#46 본문: 10/6 트래픽이 30일 합계에서 빠지는 11/5 이후 전환 권장.
