# Vercel 무료 한도 비상 대응 (설계, 2026-10-30)

> 2026-11-01 부터 www 는 Cloudflare Pages, Vercel 은 `/api` 만 (아래 비상 조치 4 를 11/1 에 실제로 했고 #55 로 굳힘). Vercel 이 멈춰도 화면은 그대로이고 `/api` 만 멈춘다 -
> `docs/plan-pages-standby.md` 'Vercel 이 멈추면'. 아래는 그때의 설계 · 절차 기록. 비상 조치 3(static 캐시)은 #56 에서 static 을 지워 해당 없다.

관련: #22 감시 · #23 무료 한도 결정 · #33 예비 배포 · #21 읽기 전용 · #46 정적 = Cloudflare 구조 변경 · PR #44 static 서브도메인

## 왜 필요한가

- Vercel Hobby 는 추가 요금을 낼 수 없어서 한도를 넘으면 대개 30일 동안 그 기능이 멈춘다 (사이트 전체가 꺼질 수 있다).
- 한도는 매달 초기화가 아니라 최근 30일 합계다 (`vercel.com/docs/plans/hobby` - "no billing cycles … wait until 30 days have passed").
- 2026-10-29 CDN 요청이 98% 까지 갔다. PR #44 로 페이지뷰당 Vercel 요청이 약 27건 → 약 6.7건으로 줄었지만,
  트래픽 급증 · 봇 폭주 · 설정 실수가 생기면 다시 닿을 수 있다. 100% 에 닿기 전에 움직이는 절차가 있어야 한다.

## 감시 신호 - 무엇을 보고 움직이나

Hobby 에선 사용량을 API 로 읽을 수 없다. `tools/check-usage.mjs` 의 `GET /v1/billing/charges` 는 Hobby 에서 404 `costs_not_found`.
그래서 쓸 수 있는 자동 신호는 Vercel 이 보내는 경고 메일뿐이고, `tools/gmail-usage-alert.gs` 가 1시간마다 디스코드 알라밍 채널로 옮긴다.

- 실제로 받은 메일: 75% (10/24), 90% (10/29 08:29). 97% 같은 더 촘촘한 메일은 없다.
- 그래서 '남은 양 3% 이하' 를 자동으로 알아챌 방법은 없다. 사람이 대시보드(Usage → CDN Requests)를 보면 알 수 있을 뿐이다.
- 결정 (제안): 90% 메일 = 비상 단계 시작. 90% 면 남은 양이 10만 건이라, 지금 속도(하루 약 8천–1만 건)로 열흘 안팎 여유가 있다.
  3% 를 기다리면 사흘밖에 안 남고, 그 사흘이 주말 · 야간이면 대응이 늦는다.
- 90% 메일이 오면 그때부터 하루 한 번 대시보드 숫자를 사람이 확인한다 (Usage 의 CDN Requests, Observability → CDN Requests → Hostname 별).

## 단계

| 단계 | 신호 | 할 일 |
|---|---|---|
| 평소 | - | 아래 '평소에 해 둘 것' 유지 |
| 주의 | 75% 메일 | 원인 확인만 (Observability: Routes · Bot Name · Hostname). 평소보다 빠르게 오르면 비상 조치 1 · 2 를 미리 켠다 |
| 비상 | 90% 메일 | 비상 조치 1 → 2 → 3 순서로 켜고, 하루 한 번 숫자 확인. 하루 증가량 × 남은 날로 100% 도달일을 계산해 디스코드에 적는다 |
| 최후 | 100% 도달이 이틀 안으로 보일 때 | 비상 조치 4 (www 를 예비 배포로) |
| 복구 | 30일 합계가 70% 아래 | 비상 조치를 되돌린다 (아래 '되돌리기') |

## 비상 조치 (가벼운 순서, 모두 DNS only 원칙 · IP 판별 코드와 무관)

1. 봇 차단 - Vercel Firewall 사용자 규칙 (무료, 규칙 3개까지).
   Firewall 이 막은 요청은 CDN 요청 · 전송량에 세지 않는다 (`vercel.com/docs/vercel-firewall/vercel-waf/usage-and-pricing`).
   - 막을 것(예): AI 학습 수집기(GPTBot · ClaudeBot · CCBot · Bytespider · Amazonbot · meta-externalagent 등)와 정체를 밝히지 않는 수집기.
   - 막지 않을 것: Googlebot · Yeti(네이버) - 검색 노출. Bingbot · OAI-SearchBot · ChatGPT-User 처럼 '검색 결과에 링크를 거는' 봇은 결정.
   - `/api/*` 요청 수 제한은 CLAUDE.md 보안 절의 '남은 권장' 과 같은 설정이라 이때 함께.
   - 효과: HTML 요청의 절반 정도가 봇이라 전체의 약 20–40% (2026-10-30 Observability 기준 추정).
2. ~~Vercel Web Analytics 끄기~~ - 2026-10-30 Cloudflare Web Analytics 로 바꿔 평소에도 꺼 둔다 (페이지뷰마다 스크립트 + 수집 요청, 약 15%).
   대시보드에서 끄기만 하면 BaseLayout 의 스크립트가 계속 요청을 보내서, 코드에서 스크립트를 뺐다. 통계는 끊기지 않는다.
3. ~~Cloudflare 캐시 점검~~ (#56 에서 static 을 지워 해당 없음): static 캐시 적중률(Cloudflare Analytics → Traffic, 호스트 `static.urnlock.com`)이 낮으면
   Tiered Cache 가 켜져 있는지, 캐시 규칙이 살아 있는지 확인. 배포 직후 MISS 가 몰리는 건 정상.
4. 최후 - www 를 예비 배포(#33)로: Cloudflare Pages 에 같은 사이트를 올려 두고 DNS 의 www 만 돌린다.
   `/api` 는 Pages 프록시 함수(#52)가 받지만 `PROXY_SECRET` 이 없으면 503 JSON 이라 로그인 · 글쓰기 · 팁은 멈추고 읽기만 된다 (#21 - 가이드 · 팁은 빌드 때 구운 스냅샷).
   자세한 배경 · 처음 설정은 `docs/plan-pages-standby.md`, 아래는 실제로 돌릴 때의 순서 (2026-10-31 낮 미리 넘기기로 결정 - Vercel CDN 요청 99.4%, 10/31 밤–11/1 100% 예상).

### 비상 조치 4 - 전환 절차 (사용자 승인 후, 낮 시간에)

0. 전날 · 당일 아침 확인
- `https://urnlock.pages.dev/health.json` 의 `builtAt` 이 최근이고 `problems: []`. `/guides-snapshot.json` 에 `"ok":true`. `/api/session` 이 503 JSON(404 HTML 이면 #52 함수가 없는 옛 판).
- `curl -s https://urnlock.pages.dev/ko/ | grep -c static.urnlock.com` 이 0 - 1 이상이면 Vercel 운영 빌드가 올린 판(static = Vercel 을 씀)이라 전환하면 그림 · 스크립트를 Vercel 에서 받는다. 아래 1번으로 덮는다.
- 저장소 변수 `PAGES_DEPLOY` 는 비워 둔다 (아래 '전환 중 점검 · 갱신').

1. 마지막 판 올리기 - Actions → pages-standby → Run workflow (약 6–15분) → 성공하면 0번 확인을 다시.
   이 빌드는 자기 `/_astro` 를 쓰고(Vercel 이 멈춰도 산다) canonical 이 www 다. 전환 직전의 마지막 Pages 배포는 반드시 이 판이어야 한다.

2. www 를 Pages 에 붙이기 - Cloudflare → Workers & Pages → `urnlock` → Custom domains → Set up a custom domain → `www.urnlock.com`.
   - 같은 계정의 존이라 Cloudflare 가 `www` 를 `urnlock.pages.dev` 를 가리키는 Proxied(주황) CNAME 으로 만든다 - 'DNS only' 원칙의 비상 예외.
   - 기존 `www` CNAME(`208acfa57af275f1.vercel-dns-017.com`, DNS only)과 부딪힌다고 나오면 지우지 말고 고친다: DNS → Records → 그 `www` 줄 Edit →
     대상 `urnlock.pages.dev` · Proxied(주황) 로 저장 → Pages 로 돌아가 Set up(또는 Check DNS records / Activate)을 다시.
     지우면 그 사이 www 를 물은 리졸버가 '없음' 을 SOA minimum(1800초)만큼 기억해 일부 방문자는 30분까지 www 가 안 열린다. 고치면 이름은 늘 풀리고,
     Pages 가 Active 가 되기 전 잠깐은 Cloudflare 522 가 날 수 있다(캐시되지 않음). 원래 값은 되돌릴 때 다시 넣는다.
     (Pages 가 이미 `urnlock.pages.dev` 를 가리키는 줄을 받아들이지 않으면 그때만 지우고 곧바로 Set up - 사람이 적은 낮 시간에.)
   - 인증서: Custom domains 의 상태가 Active 가 될 때까지 기다린다 (같은 존이면 보통 몇 분). SSL/TLS → Edge Certificates 의 Universal 인증서(`urnlock.com, *.urnlock.com`)가 Active 면 www 도 바로 덮인다.
     CAA 레코드는 없어서(`docs/plan-dns-cloudflare.md`) 발급을 막을 것이 없다. SSL 모드 Full (strict) 는 그대로 - Pages 원본은 Cloudflare 안이라 영향 없다.

3. 맨 도메인 `urnlock.com` - 같이 바꾼다 (그대로 둬도 당장은 되지만 권하지 않음):
   - 그대로 두면: A `216.198.79.1`(DNS only) → Vercel 이 www 로 308 → www(Pages). Vercel 이 살아 있는 동안은 되지만 맨 도메인으로 오는 요청마다 Vercel CDN 요청 1건이 계속 나가고,
     Vercel 이 한도로 멈추면 그 308 도 멈춰 `urnlock.com` 이 죽는다 - 비상 조치의 목적(Vercel 요청 0)과 어긋난다.
   - 바꾸기: DNS → `urnlock.com` A 줄 Edit → Proxied(주황) (값 `216.198.79.1` 그대로 - 아래 규칙이 Cloudflare 앞에서 끝내므로 Vercel 까지 가지 않는다).
     Rules → Redirect Rules → 템플릿 'Redirect from Root to WWW'(없으면 Create rule: 호스트 = `urnlock.com` → 동적 `concat("https://www.urnlock.com", http.request.uri.path)` · 301 · 쿼리 유지) → 저장.
     규칙을 먼저 저장하고 그다음 A 를 주황으로 - 규칙은 Proxied 요청에만 걸리므로 먼저 만들어 둬도 아무 일이 없고, 틈 없이 바로 Cloudflare 301 로 넘어간다.
   - Vercel → Domains 에 www · 맨 도메인이 'Invalid Configuration' 으로 보이는데 정상이다. Vercel 에서 도메인을 지우지 않는다 (되돌릴 때 그대로 쓴다).

4. 확인 (Vercel 주소가 아니라 Cloudflare 라 curl 이 막히지 않지만, 혹시 Vercel 로 가면 봇 규칙에 403 이니 브라우저 UA 로):
   ```
   curl -sI -A "Mozilla/5.0 Chrome/130.0" https://www.urnlock.com/ko/
   ```
   - `server: cloudflare` · `cf-ray` 가 있고 `x-vercel-id` 가 없다. CSP · X-Frame-Options 헤더가 있고 `X-Robots-Tag: noindex` 는 없다(pages.dev 에만).
   - `https://www.urnlock.com/health.json` 의 `builtAt` = 1번 실행 시각. `/api/session` → 503 JSON.
   - `https://urnlock.com/ko/heroes/` → `https://www.urnlock.com/ko/heroes/` 301 (Vercel 이면 308), `/ko/heroes/doorman` → 308.
   - 브라우저: 첫 페이지 · 영웅 상세 · 티어 · 가이드(‘잠시 글쓰기를 쉬고 있습니다’) 화면, 콘솔 오류 없음, 그림이 `/_astro/`(www) 에서 온다.
   - DNS 가 퍼지는 동안 몇 분은 Vercel 과 Pages 가 섞여 보일 수 있다 (TTL - Proxied 는 Cloudflare 가 바로 바꾼다).

### 비상 조치 4 - 되돌리기 (Vercel 이 다시 살았을 때 · 30일 합계가 내려갔을 때) - DNS 먼저, 그다음 Pages 에서 뺀다

거꾸로 하면(Pages 에서 먼저 빼면) www 가 몇 분 동안 오류.

0. #55 뒤(Vercel `REQUIRE_PROXY` · `PAGES_PRIMARY` 를 켠 뒤)라면 먼저 둘을 끄고 운영 재배포 - 그대로 DNS 를 돌리면 www → Vercel 로 바로 오는 `/api` 가 모두 403 이다 (`docs/plan-cloudflare-split.md` '순서').
1. DNS → Records:
   - `www` 줄 Edit → CNAME `208acfa57af275f1.vercel-dns-017.com` · DNS only(회색) (Pages 가 만든 줄을 고치거나, 지워졌으면 새로).
   - `urnlock.com` A 줄 → `216.198.79.1` · DNS only(회색).
2. Rules → Redirect Rules → 3번 규칙 끄기 (지우지 않음 - 다음 비상 때 다시 켠다).
3. 확인: `https://www.urnlock.com/health.json` 이 Vercel 배포 시각 · 응답에 `x-vercel-id`, `https://urnlock.com` → www 308(Vercel). Vercel → Domains 가 다시 Valid Configuration.
   Vercel 이 그동안 데이터를 안 받았으면 Deploy Hook(Actions → daily-rebuild 수동 실행)으로 한 번 새로.
4. 그다음 Workers & Pages → `urnlock` → Custom domains → `www.urnlock.com` Remove (DNS 는 이미 Vercel 이라 영향 없음).
   뺀 뒤 DNS → Records 의 `www` 가 여전히 Vercel 값 · DNS only 인지(Pages 가 줄을 지우지 않았는지), `https://www.urnlock.com/health.json` 에 `x-vercel-id` 가 있는지 한 번 더.
5. Vercel 운영 빌드는 되돌린 뒤에도 Pages 에 계속 올린다 (#55 부터 www 와 상관없이 - Vercel 에 Cloudflare 토큰이 있을 때). `PAGES_DEPLOY=1` 이면 그 반영도 알림이 본다.

### 전환 중 점검 · 6시간 갱신 - 어느 주소를 보고 무엇을 올리나

> 2026-11-01 기록: 이 비상 전환을 되돌리지 않고 #46 구조로 굳혔다 (#55). `assetsPrefix` 를 꺼서 Vercel 운영 빌드가 다시 Pages 에 바로 올리고(cf-ray 건너뛰기 없음),
> daily-rebuild 는 www 데이터가 9시간 넘게 그대로일 때만 pages-standby 를 부르며, `PAGES_DEPLOY=1` 로 Pages 반영을 알린다. 아래 표는 그 전(비상 전환 중)의 동작이다.

| 무엇 | 평소 (www = Vercel) | 전환 중 (www = Pages) |
|---|---|---|
| daily-rebuild (6시간) | 패치 · 티어 조각 보관 → 바뀌면 푸시, 아니면 Deploy Hook → Vercel 운영 빌드 | 같음 (Vercel 이 멈췄으면 Hook 이 실패해도 다음 단계는 돈다) + 마지막에 pages-standby 실행 (#62 - www 응답에 `cf-ray` 가 있으면) |
| Vercel 운영 빌드의 Pages 올리기 (`vercel-to-pages.mjs`) | 같은 `dist/` 를 Pages 에 (Vercel 에 Cloudflare 토큰이 있을 때) | 건너뜀 - www 의 `cf-ray` 로 알아봄. 이 빌드는 `/_astro` 를 static(= Vercel)에서 받게 돼 있어 덮으면 Vercel 요청이 다시 나가고, Vercel 이 멈추면 깨진다 |
| pages-standby | 수동 전용 | daily-rebuild 가 6시간마다 부름 → 방문자가 보는 www 가 갱신되는 유일한 길. 실패하면 직전 Pages 배포가 남는다 |
| `check-health --stale` (daily-rebuild 시작) | www = Vercel 의 데이터 시각 | www = Pages 의 데이터 시각 → pages-standby 가 계속 실패해 30시간 넘게 그대로면 '데이터 N시간째 그대로' 이슈 · 디스코드 (pages-standby 실패의 유일한 알림) |
| `check-health --status` (health-notify, Vercel 운영 배포마다) | 방금 배포한 www 의 health.json | www 가 Pages 라 '방금 빌드' 가 안 보여 3분 기다린 뒤 Pages 의 health.json 으로 판단 - 번역 · 새 패치 · 영웅 이슈는 Pages 기준으로 그대로 돈다. 배포 실패 이슈는 Vercel 빌드가 실패할 때만 |
| `PAGES_DEPLOY` (저장소 변수) | 켜면 Vercel 빌드 뒤 pages.dev 가 같은 빌드인지 확인 | 비워 둔다 - 켜 두면 배포마다 'Pages 올리기 실패' 이슈가 열린 채로 남기 쉽다 (Vercel 빌드가 일부러 안 올리므로) |

- 그래서 'Vercel 만 갱신되고 Pages 는 옛 판' 이 되지 않으려면 #62 가 main 에 있어야 한다. 없으면 pages-standby 를 손으로 6시간마다 돌려야 한다.
- 전환 직후 몇 분 안에 끝난 Vercel 빌드는 전환 전에 `cf-ray` 를 보고 Pages 에 올렸을 수 있다 → 4번 확인의 `static.urnlock.com` 0건을 한 번 더 보고, 남아 있으면 pages-standby 를 한 번 더.
- Actions 시간: 전환 중엔 pages-standby 한 번 약 6–15분 × 하루 4번 + health-notify 가 Vercel 배포마다 3분 더 기다림(하루 약 20분) → 하루 약 45–80분 더
  (비공개 저장소 무료 2,000분/월 - 며칠은 괜찮지만 한 달 내내면 넘을 수 있다. 공개 저장소면 무료).
- Vercel 쪽 Cloudflare 토큰(`CLOUDFLARE_API_TOKEN` · `CLOUDFLARE_ACCOUNT_ID`, Production · Sensitive)은 전환 중엔 쓰이지 않는다. 2026-10-30 현재 Vercel 빌드가 Pages 에 올리지 않고 있어(10/30 오후 운영 배포 뒤에도 pages.dev 가 옛 판) 이 환경 변수가 빠진 것으로 보인다 -
  Vercel → Deployments → 운영 배포 → Build Logs 끝에 `[pages] 올리지 않음 - Vercel 환경 변수 CLOUDFLARE_API_TOKEN · CLOUDFLARE_ACCOUNT_ID 가 없음` 이 있으면 확정. 되돌린 뒤 평소 자동 올리기에 필요하다 (`plan-pages-standby.md` '켜기').

## 평소에 해 둘 것 (비상 조치를 덜 쓰게)

- ~~파비콘 · `apple-touch-icon` 을 static 주소에서 받게~~ · ~~이미지 해시 줄이기~~ - #55 · #56 으로 해당 없음 (정적 파일은 모두 Pages).
- ~~장기: #46~~ - 2026-11-01 됨. 이 문서의 비상 조치 대부분이 필요 없어졌다.

## 되돌리기

- 봇 규칙: Vercel → Firewall → 규칙 끄기 (지우지 않고 꺼 둔다 - 다음 비상 때 다시 켠다).
- Web Analytics: 되돌리지 않는다 (Cloudflare Web Analytics 로 바꿨다 - 위 비상 조치 2).
- 예비 배포로 돌렸다면 위 '비상 조치 4 - 되돌리기' (DNS 먼저, 그다음 Pages 커스텀 도메인 빼기).

## 현재 구성 기록 (2026-10-29 · 30, PR #44 과 함께 바뀐 것)

(지금 구성은 CLAUDE.md '현재 상태' · `docs/plan-dns-cloudflare.md` '지금 레코드'.)

- `static.urnlock.com` 만 Proxied(주황) - CNAME → Vercel. `www` · 루트는 그대로 DNS only.
  Vercel 프로젝트 도메인에도 `static.urnlock.com` (Production) 추가. 인증서는 Vercel 이 HTTP-01 로 발급하므로 아래 리디렉트에서 `/.well-known/` 을 뺐다.
- `astro.config.mjs` `build.assetsPrefix` - 프로덕션 빌드에서만 `https://static.urnlock.com`. `vercel.json` CSP 에 static 주소, `/_astro/*` 에 `Access-Control-Allow-Origin: *`.
  → 2026-11-01 #55 에서 껐다 (www 가 Pages). #56 에서 static 레코드 · Vercel 도메인 · 아래 static 규칙 셋 · CSP 주소 · `/_astro` CORS 헤더를 지웠다 (아래는 다시 만들 때의 기록).
- SSL/TLS: Full (strict).
- Cloudflare 규칙:
  - Redirect: `static` 에서 `/_astro/` · `/masks/` · `/.well-known/` 이 아닌 경로 → `https://www.urnlock.com` 301 (HTML 중복 방지)
  - Response Header Transform: `static` 응답에 `Access-Control-Allow-Origin: *` (CSS 의 `/masks/*.svg` mask-image 에 필요)
  - Cache Rule: `static` 의 `/masks/` 는 Cache-Control 무시, Edge TTL 1일 (Vercel 이 public 파일에 짧은 캐시를 보내서)
  - Tiered Cache: Smart Tiered Cache 켬
- 배포 직후 CORS 헤더 없이 캐시된 파일이 남지 않도록 처음 한 번 Purge Everything 했다. 평소 배포는 파일 이름에 해시가 있어 비우지 않아도 된다.
