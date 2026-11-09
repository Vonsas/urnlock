# Cloudflare Pages 배포 (#33 예비 배포로 시작, 2026-10-30 - 2026-11-01 부터 본 배포)

지금 `www` 는 Cloudflare Pages 다 (2026-11-01 - Vercel CDN 한도 초과로 비상 전환한 뒤 그대로 #46 의 구조로 굳힘, #55). `/api` 만 Pages 함수가 Vercel(`origin.urnlock.com`)로 넘긴다.
아래 '평소' · '비상 빌드' 는 그대로 쓰고, 'www 를 Pages 로 돌리기' 는 그때의 절차 기록 · 'Vercel 로 되돌리기' 는 되돌릴 때의 절차다.

## Vercel 이 멈추면 (한도 · 장애)

- 화면은 그대로 - www 는 Pages 가 내보내므로 마지막으로 올린 판이 계속 열린다.
- `/api` 만 멈춘다 - 로그인 · 글쓰기 · 추천 · 신고 · 사진 올리기. 가이드 · 팁은 빌드 때 구운 스냅샷으로 보인다(#21 - 프록시가 Vercel 에 못 닿으면 5xx 라 화면이 스냅샷으로 그림).
- 데이터 갱신은 Actions 로 - Vercel 빌드가 안 돌면 www 의 health.json 이 9시간 넘게 그대로가 되고, daily-rebuild 마지막 단계가 pages-standby 를 부른다(아래 '비상 빌드').

## 평소 - Vercel 운영 빌드가 함께 올린다 (#53, 2026-10-30)

설계 `docs/plan-cloudflare-split.md` 2절 (결정 'C'). `vercel.json` buildCommand = `pnpm run build && node tools/vercel-to-pages.mjs`.

- main 푸시 · 6시간 갱신(daily-rebuild)마다 도는 Vercel 운영 빌드가 끝나면 같은 `dist/` 를 Pages `urnlock` 에 올린다. 문서만 바뀐 커밋은 `ignore-build.sh` 가 Vercel 빌드째 건너뛰므로 Pages 도 안 올라간다.
- `tools/vercel-to-pages.mjs`: `VERCEL_ENV=production` 이고 Cloudflare 토큰이 있을 때만 → `build-pages-config.mjs dist`
  → `wrangler pages deploy`(저장소 바닥에서, `functions/` 같이) → 끝나면 언제나 `dist/_headers` · `_redirects` · `_routes.json` 을 지운다(Vercel 이 그대로 공개하므로).
  실패해도 Vercel 빌드는 계속(`/api` 배포가 막히지 않게) - 빌드 로그에 `[pages] 올리기 실패`. wrangler 에는 Cloudflare 토큰과 실행에 필요한 값만 넘긴다.
  ⑥(#55) 전엔 운영 빌드가 `/_astro` 를 `static.urnlock.com`(= Vercel)에서 받아 `--allow-static` 으로 올렸고, www 가 Cloudflare 를 거치면(cf-ray) 건너뛰었다.
  #55 에서 `assetsPrefix` 를 끄며 둘 다 뺐다 - 이제 static 참조가 남으면 build-pages-config 가 올리기를 막는다.
- health 점검 문제: ⑥ 전엔 지금처럼 Vercel 빌드가 멈춘다(Pages 도 안 올라감, '배포 빌드가 실패했어요' 이슈). ⑥ 뒤 `PAGES_PRIMARY=1` 이면 Vercel 빌드는 계속되고 `build-pages-config` 가 Pages 올리기만 막는다.
- 알림 (`health-notify.yml` → `check-health --status success`, 저장소 변수 `PAGES_DEPLOY=1` 일 때): Vercel 성공 알림 뒤 `urnlock.pages.dev/health.json` 의 `builtAt` 이 이 빌드(origin → 없으면 www 의 health.json)와 같은지 본다.
  다르면 이 빌드의 problems 가 있으면 '데이터 점검 실패 - Pages 에 안 올림', 없으면 'Pages 올리기 실패'(수동 pages-standby 안내) 이슈 + 디스코드. 다음 배포에 반영되면 닫힌다.

### 켜기

1. Cloudflare → API Tokens → 새 토큰 (pages-standby 용 GitHub 시크릿과 다른 것): Account → Cloudflare Pages → Edit 하나, 만료일 1년.
2. Vercel → urnlock → Settings → Environment Variables, Production 만 · Sensitive: `CLOUDFLARE_API_TOKEN` · `CLOUDFLARE_ACCOUNT_ID`.
3. Vercel 운영 재배포 → Build Logs 끝에 `[pages] 올리기 성공` 확인 → `https://urnlock.pages.dev/health.json` 의 `builtAt` 이 www 와 같은지.
4. 3번이 된 뒤 GitHub 저장소 Settings → Variables → Actions: `PAGES_DEPLOY` = `1`. 이 값이 없으면 알림이 Pages 를 보지 않는다 (토큰 없이 켜면 배포마다 'Pages 올리기 실패' 이슈가 열리므로 순서대로).
5. 토큰 교체: 새 토큰 → Vercel 환경 변수 바꾸고 운영 재배포 → `올리기 성공` 확인 → 옛 토큰 Revoke.

`origin.urnlock.com`(Cloudflare DNS · DNS only + Vercel Domains)은 ③/⑥ 에서 만든다. 없어도 ⑥ 전엔 www 가 Vercel 이라 알림이 www 로 비교한다.
`vercel.json` 에 origin 호스트에서 `/api` · `/health.json` 이 아닌 경로를 www 로 308 하는 줄이 있다 (build-pages-config 는 이 줄을 건너뛴다 - #52).

### Actions 사용 시간 (월, 비공개 저장소 무료 2,000분)

| 작업 | 전 | 후 |
|---|---|---|
| pages-standby (한 번 약 10분) | 매일 1번 ≈ 300분 | 평소 수동 때만 ≈ 0분 (www 데이터가 9시간 넘게 밀렸을 때 daily-rebuild 가 부름 - #55. 11/1 비상 전환 중엔 하루 4번 - #62) |
| health-notify (운영 배포마다 1번, 1분 단위 올림) | 하루 6–8번 ≈ 200–250분 | 같음. Pages 확인은 보통 바로 끝나고, 늦게 퍼질 때만 최대 1분 더 |
| daily-rebuild | 그대로 | 그대로 |

→ 월 약 300분 줄어든다. Pages 올리기는 Vercel 빌드 안에서 돌아 Actions 시간을 쓰지 않는다 (Vercel 빌드가 wrangler 받기 · 올리기로 약 30초–1분 길어진다).

## 비상 빌드 - Actions (수동)

`.github/workflows/pages-standby.yml` - 수동 실행, 그리고 www 의 health.json 이 9시간 넘게 그대로면 daily-rebuild 마지막 단계가 부른다 (#55 - 그 전엔 비상 전환 중 6시간마다(#62), #53 전엔 하루 한 번 04:17 KST).
단, pages-standby 가 아직 도는 중이거나 바로 앞 차례(daily-rebuild 의 직전 실행 이후)에 실패 · 시간 초과 · 취소됐으면 그 차례는 건너뛴다 - 티어 점검에 걸린 데이터는 pages-standby 도 같은 점검에 걸려 6시간마다 헛돌기 때문. 실패가 이어지면 한 차례 걸러 한 번 돈다
(#56 - 예전 '12시간 안' 창은 예약 실행이 23분–6시간 늦게 시작해 간격이 4–10시간으로 흔들려, 두 차례를 연달아 건너뛰기도 했다).
Vercel 이 멈춰 빌드 · 올리기가 안 될 때, 또는 'Pages 올리기 실패' 이슈 때.

1. Actions 에서 전체 빌드 (`pnpm build`). 조건:
   - 페이지가 자기 `/_astro/...` 를 쓴다 (예전 `static.urnlock.com` 은 Cloudflare 를 거친 Vercel 이었다 - #55 에서 안 쓰게 되고 #56 에서 지움).
   - `SITE_URL=https://www.urnlock.com` → canonical · hreflang · sitemap 이 www 를 가리킨다. `*.pages.dev` 가 검색에 따로 잡히지 않는다.
   - `HEALTH_STRICT=1` → Vercel 빌드처럼 직전 배포(www 의 health.json)와 비교하고, 점검 문제가 있으면 빌드를 멈춘다.
2. `node tools/build-pages-config.mjs dist`
   - `vercel.json` 의 headers · redirects → `dist/_headers` · `dist/_redirects` (손으로 베끼지 않음 - vercel.json 을 고치면 따라간다).
     Vercel 의 `:lang(ko|en|zh)` 같은 목록은 Pages 가 모르므로 줄마다 풀어 쓴다(지금 30줄). 못 푸는 정규식이 오면 멈춘다.
   - Pages 한도: 파일 2만 개 · 파일당 25MiB (지금 약 1,050개 · 54MB).
   - HTML 에 `static.urnlock.com` 이 남아 있으면 멈춘다. `dist/health.json` 의 problems 가 있으면 멈춘다 → 직전 Pages 배포가 남는다.
   - `*.pages.dev` 주소에만 `X-Robots-Tag: noindex` (www 로 돌렸을 땐 안 붙는다).
3. `npx wrangler@4.20.0 pages deploy dist` (직접 올리기 - wrangler-action 은 pnpm-lock.yaml 을 보고 러너에 없는 pnpm 을 써서 안 씀 - Cloudflare 가 빌드하지 않으므로 '빌드 월 500번' 한도와 무관). 프로젝트가 없으면 처음에 만든다.

Actions 시간: 시크릿이 없으면 아무것도 안 함. 있으면 한 번 약 6–15분 (수동 · www 데이터가 밀렸을 때만).

### 처음 설정 (직접)

1. Cloudflare → 오른쪽 위 사람 아이콘 → My Profile → API Tokens → Create Token → Custom token
   - 권한: Account → Cloudflare Pages → Edit (이것 하나), Account Resources: 내 계정
   - 만료일 지정
2. GitHub 저장소 Settings → Secrets → Actions:
   - `CLOUDFLARE_API_TOKEN` = 위 토큰
   - `CLOUDFLARE_ACCOUNT_ID` = 대시보드 주소 `dash.cloudflare.com/<여기>/...` 의 32자
3. (선택) 저장소 변수(Variables) `PAGES_PROJECT` - Pages 프로젝트 이름. 없으면 `urnlock` (주소 `urnlock.pages.dev`, 이미 쓰인 이름이면 Cloudflare 가 뒤에 글자를 붙인다).
4. Actions → pages-standby → Run workflow → 끝나면 로그 끝의 주소(`https://….pages.dev`)를 열어 확인.

## 확인한 것 (2026-10-30, 로컬 `wrangler pages dev` - Pages 와 같은 규칙)

- 첫 페이지 · 영웅 · 영웅 상세 · 가이드 · `health.json` 200, 없는 주소 404(사이트 404 화면).
- 리디렉트: `/ko/heroes/doorman` → `/ko/heroes/the-doorman/` · 옛 패치 주소 → `/ko/patches/` (308), `/ko/tiers/stats` → 통계(Astro 리디렉트 페이지).
- 헤더: CSP · X-Frame-Options · Referrer-Policy 가 모든 페이지에, `/_astro/*` 1년 캐시 + CORS - vercel.json 과 같다.
- `/api/*` 는 404 HTML. 가이드 목록 · 영웅 가이드 탭은 '가이드를 불러오지 못했습니다' · '팁을 불러오지 못했습니다' 로 끝난다(깨지지 않음).
  로그인 단추는 `/api/auth/steam` 404 화면으로 간다. 가이드 · 팁은 #21(읽기 전용)로 빌드 때 구운 스냅샷(`/guides-snapshot*.json` - KV 가 없는 Pages 빌드는 Vercel 쪽 직전 사본을 이어 씀)을 그리고,
  쓰기 · 추천은 '잠시 글쓰기를 쉬고 있습니다', 운영자 로그인은 '저장소에 잠시 닿지 못합니다'.
- 모바일 375px 가로 넘침 없음.

## www 를 Pages 로 돌리기 (비상 때만 - 승인 후)

실제로 돌릴 때의 순서 · 확인 · 맨 도메인 판단은 `docs/plan-usage-emergency.md` '비상 조치 4 - 전환 절차' 가 기준이다 (아래는 처음 적은 요약).

DNS 는 Cloudflare 에 있다(#32). 그때 원칙은 'DNS only(회색)' 였고 Pages 커스텀 도메인은 Proxied(주황) 로 붙는다 - 비상 예외로 시작해 11/1 부터 평소 구성(`docs/plan-dns-cloudflare.md` '지금 레코드').

1. 최신으로 맞추기: Actions → pages-standby → Run workflow → 성공 확인 → `https://<프로젝트>.pages.dev/ko/` 열어 보기.
   가이드 · 팁 스냅샷도 확인: `https://<프로젝트>.pages.dev/guides-snapshot.json` 이 `"ok":true` 인지 (이 빌드엔 저장소가 없어 www · pages.dev 의 직전 사본 중 최근 것을 이어 쓴다 - #21).
   운영자가 내린 글이 사본에 남아 있으면 저장소 변수 `SNAPSHOT_REUSE=0` 으로 한 번 돌려 빈 사본으로 끊는다.
2. www: Cloudflare → Workers & Pages → <프로젝트> → Custom domains → Set up a custom domain → `www.urnlock.com`.
   같은 계정의 존이라 Cloudflare 가 `www` 를 `<프로젝트>.pages.dev` 를 가리키는 Proxied CNAME 으로 바꿔 준다.
   기존 `www` CNAME(Vercel)과 부딪힌다고 나오면 지우지 말고 그 줄을 `urnlock.pages.dev` · Proxied 로 고친 뒤 다시 Set up 한다 (지우면 '없음' 이 최대 30분 캐시된다 - `docs/plan-usage-emergency.md` 비상 조치 4). 보통 몇 분 안에 인증서까지 붙는다.
3. 맨 도메인 → www 리디렉트: 지금 `urnlock.com` → www 308 은 Vercel 이 해 주는데, Vercel 이 멈추면 그것도 멈춘다.
   Pages 에 맨 도메인을 붙이면 같은 내용이 두 주소로 나오므로, 대신 Cloudflare 가 리디렉트하게 한다:
   - 먼저 Rules → Redirect Rules → 템플릿 'Redirect from Root to WWW'(없으면 Create rule: 호스트 = `urnlock.com` → 동적 `concat("https://www.urnlock.com", http.request.uri.path)` · 301 · 쿼리 유지) → 저장.
   - 그다음 DNS → `urnlock.com` A 줄(`216.198.79.1`) Edit → Proxied(주황) 로 (값은 그대로 - Cloudflare 가 앞에서 받아 리디렉트하므로 Vercel 까지 가지 않는다. 규칙이 먼저 있어 틈이 없다).
4. 확인: `curl -I https://www.urnlock.com/ko/` 에 `server: cloudflare` · `cf-ray` · CSP 헤더, `/health.json` 의 `builtAt` 이 1번 실행 시각,
   `curl -I https://urnlock.com/ko/heroes/` → `https://www.urnlock.com/ko/heroes/` 301, `/ko/heroes/doorman` → 308.
5. (#55 전의 동작 - 지금은 Vercel 운영 빌드가 바로 올리고, daily-rebuild 는 데이터가 9시간 넘게 밀릴 때만 pages-standby 를 부른다)
   그동안 6시간 daily-rebuild 는 Vercel 로 계속 배포하지만 Pages 에는 안 올린다 - `vercel-to-pages.mjs` 가 www 응답의 `cf-ray` 로 비상 전환 중임을 알아보고 건너뛴다
   (그 빌드는 `/_astro` 를 static(= Vercel)에서 받게 돼 있어 www 를 덮으면 Vercel 요청이 다시 나가고, Vercel 이 멈추면 그림 · 스크립트가 깨진다). 빌드 로그에 `[pages] 올리지 않음 - www 가 Cloudflare 를 거침`.
   대신 daily-rebuild 마지막 단계가 www 의 `cf-ray` 를 보고 pages-standby 를 6시간마다 실행한다 (#62). (`PAGES_DEPLOY` 는 전환 중 비워 둔다 - 켜 두면 'Pages 올리기 실패' 이슈가 열린 채로 남는다.)
   전환 중 무엇이 어디를 보는지 표는 `docs/plan-usage-emergency.md` '전환 중 점검 · 6시간 갱신'.
   check-health(배포 알림)는 www 의 health.json 을 읽으므로 Pages 쪽 상태를 보게 된다.

## Vercel 로 되돌리기 - DNS 먼저, 그다음 Pages 에서 뺀다 (거꾸로 하면 몇 분 동안 오류)

0. #55 뒤라면 먼저 Vercel 환경 변수 `REQUIRE_PROXY` · `PAGES_PRIMARY` 를 끄고 운영 재배포 (`docs/plan-cloudflare-split.md` '순서' - 거꾸로 하면 그 사이 www 로 바로 오는 `/api` 가 403).
   `/_astro` 는 페이지와 같은 주소에서 받으므로 Vercel 빌드 그대로 www 를 맡을 수 있다 (static 레코드 · 규칙은 #56 에서 지웠다 - 다시 쓰려면 `docs/plan-usage-emergency.md` '현재 구성 기록' 대로 만들고 `assetsPrefix` 를 되살리는 PR).
1. DNS → Records:
   - `www` 줄 Edit → CNAME `208acfa57af275f1.vercel-dns-017.com` · DNS only(회색) 로 (Pages 가 만든 줄을 고치거나, 지워졌으면 새로).
   - `urnlock.com` A 줄 → `216.198.79.1` · DNS only(회색) 로.
2. Rules → Redirect Rules → 3번에서 만든 규칙 끄기(지우지 않고 - 다음 비상 때 다시 켠다).
3. 확인: `https://urnlock.com` → www 308(Vercel), `https://www.urnlock.com/health.json` 이 Vercel 배포 시각, 응답에 `x-vercel-id`.
   Vercel → Settings → Domains 가 다시 Valid Configuration.
4. 그다음 Workers & Pages → <프로젝트> → Custom domains → `www.urnlock.com` Remove (DNS 는 이미 Vercel 이라 영향 없음).

## 첫 실제 업로드 (2026-10-30, Actions 수동 실행)

- 프로젝트 `urnlock` 을 만들고 1,053개 파일 업로드 → https://urnlock.pages.dev (전체 빌드 · health 문제 없음, 데이터 시각 2026-10-30 11:00 KST).
- `curl`: `/ko/` · 영웅 · 티어 · 통계 · `/health.json` · `/sitemap.xml` 200, `/nope/` 404, `/api/session` 404,
  `/ko/heroes/doorman` → `/ko/heroes/the-doorman/` 308, 옛 패치 주소 308.
- 헤더: CSP(작업 A 의 cloudflareinsights 포함) · X-Frame-Options · Referrer-Policy · X-Robots-Tag: noindex(pages.dev), `/_astro/*` 1년 캐시 + CORS.
  canonical 은 `https://www.urnlock.com/ko/`, HTML 에 `static.urnlock.com` 0건.
- 브라우저: 티어 보드 · 영웅 상세 지표 정상, 콘솔 오류 없음. 처음 열 때 그림이 늦게 뜬다(Cloudflare 캐시가 빈 상태) - 깨진 그림 0.
