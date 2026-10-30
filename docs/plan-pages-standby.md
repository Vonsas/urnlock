# 예비 배포 - Cloudflare Pages (#33, 2026-10-30)

Vercel 이 무료 한도로 멈추면(Hobby 는 대개 30일) `www` 를 Cloudflare Pages 로 돌려 읽기만이라도 살린다.
평소엔 아무도 Pages 로 오지 않는다 - `www` 는 Vercel 그대로. 언제 돌리는지는 `docs/plan-usage-emergency.md` '비상 조치 4'.

## 어떻게 만들어지나

`.github/workflows/pages-standby.yml` - 하루 한 번 04:17 KST + 수동 실행.

1. Actions 에서 전체 빌드 (`pnpm build`). 조건:
   - `VERCEL_ENV` 없음 → `assetsPrefix` 꺼짐 → 페이지가 자기 `/_astro/...` 를 쓴다.
     `static.urnlock.com` 은 Cloudflare 를 거친 Vercel 이라 Vercel 이 멈추면 같이 죽는다(캐시에 남은 것만 산다).
   - `SITE_URL=https://www.urnlock.com` → canonical · hreflang · sitemap 이 www 를 가리킨다. `*.pages.dev` 가 검색에 따로 잡히지 않는다.
   - `HEALTH_STRICT=1` → Vercel 빌드처럼 직전 배포(www 의 health.json)와 비교하고, 점검 문제가 있으면 빌드를 멈춘다.
2. `node tools/build-pages-config.mjs dist`
   - `vercel.json` 의 headers · redirects → `dist/_headers` · `dist/_redirects` (손으로 베끼지 않음 - vercel.json 을 고치면 따라간다).
     Vercel 의 `:lang(ko|en|zh)` 같은 목록은 Pages 가 모르므로 줄마다 풀어 쓴다(지금 30줄). 못 푸는 정규식이 오면 멈춘다.
   - Pages 한도: 파일 2만 개 · 파일당 25MiB (지금 약 1,050개 · 54MB).
   - HTML 에 `static.urnlock.com` 이 남아 있으면 멈춘다. `dist/health.json` 의 problems 가 있으면 멈춘다 → 직전 Pages 배포가 남는다.
   - `*.pages.dev` 주소에만 `X-Robots-Tag: noindex` (www 로 돌렸을 땐 안 붙는다).
3. `npx wrangler@4.20.0 pages deploy dist` (직접 올리기 - wrangler-action 은 pnpm-lock.yaml 을 보고 러너에 없는 pnpm 을 써서 안 씀 - Cloudflare 가 빌드하지 않으므로 '빌드 월 500번' 한도와 무관). 프로젝트가 없으면 처음에 만든다.

Actions 시간: 시크릿이 없으면 아무것도 안 함. 있으면 한 번 약 10분 → 월 약 300분 (비공개 저장소 무료 월 2,000분 - daily-rebuild 와 합쳐 본다). deadlock-api 부담도 하루 한 번만 는다.

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

DNS 는 Cloudflare 에 있다(#32). 평소 원칙은 'DNS only(회색)' 지만, Pages 커스텀 도메인은 Proxied(주황) 로 붙는다 - 비상 때만의 예외.

1. 최신으로 맞추기: Actions → pages-standby → Run workflow → 성공 확인 → `https://<프로젝트>.pages.dev/ko/` 열어 보기.
   가이드 · 팁 스냅샷도 확인: `https://<프로젝트>.pages.dev/guides-snapshot.json` 이 `"ok":true` 인지 (이 빌드엔 저장소가 없어 www · pages.dev 의 직전 사본 중 최근 것을 이어 쓴다 - #21).
   운영자가 내린 글이 사본에 남아 있으면 저장소 변수 `SNAPSHOT_REUSE=0` 으로 한 번 돌려 빈 사본으로 끊는다.
2. www: Cloudflare → Workers & Pages → <프로젝트> → Custom domains → Set up a custom domain → `www.urnlock.com`.
   같은 계정의 존이라 Cloudflare 가 `www` 를 `<프로젝트>.pages.dev` 를 가리키는 Proxied CNAME 으로 바꿔 준다.
   기존 `www` CNAME(Vercel)과 부딪힌다고 나오면 DNS → Records 에서 그 `www` 줄을 지우고 다시 Set up 한다. 보통 몇 분 안에 인증서까지 붙는다.
3. 맨 도메인 → www 리디렉트: 지금 `urnlock.com` → www 308 은 Vercel 이 해 주는데, Vercel 이 멈추면 그것도 멈춘다.
   Pages 에 맨 도메인을 붙이면 같은 내용이 두 주소로 나오므로, 대신 Cloudflare 가 리디렉트하게 한다:
   - DNS → `urnlock.com` A 줄(`216.198.79.1`) Edit → Proxied(주황) 로 (값은 그대로 - Cloudflare 가 앞에서 받아 리디렉트하므로 Vercel 까지 가지 않는다).
   - Rules → Redirect Rules → 템플릿 'Redirect from Root to WWW'(없으면 Create rule: 호스트 = `urnlock.com` → 동적 `concat("https://www.urnlock.com", http.request.uri.path)` · 301 · 쿼리 유지) → 저장.
4. 확인: `curl -I https://www.urnlock.com/ko/` 에 `server: cloudflare` · `cf-ray` · CSP 헤더, `/health.json` 의 `builtAt` 이 1번 실행 시각,
   `curl -I https://urnlock.com/ko/heroes/` → `https://www.urnlock.com/ko/heroes/` 301, `/ko/heroes/doorman` → 308.
5. 그동안 6시간 daily-rebuild 는 Vercel 로 계속 배포한다(아무도 안 봄 - 그대로 둬도 됨). 데이터를 새로 하려면 pages-standby 를 수동 실행.
   check-health(배포 알림)는 www 의 health.json 을 읽으므로 Pages 쪽 상태를 보게 된다.

## Vercel 로 되돌리기 - DNS 먼저, 그다음 Pages 에서 뺀다 (거꾸로 하면 몇 분 동안 오류)

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
