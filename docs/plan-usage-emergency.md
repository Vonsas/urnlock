# Vercel 무료 한도 비상 대응 (설계, 2026-10-30)

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
3. Cloudflare 캐시 점검: static 캐시 적중률(Cloudflare Analytics → Traffic, 호스트 `static.urnlock.com`)이 낮으면
   Tiered Cache 가 켜져 있는지, 캐시 규칙이 살아 있는지 확인. 배포 직후 MISS 가 몰리는 건 정상.
4. 최후 - www 를 예비 배포(#33)로: Cloudflare Pages 에 같은 `dist/` 를 올려 두고 DNS 의 www 만 돌린다.
   `/api` 가 없으므로 로그인 · 글쓰기 · 팁은 멈추고 읽기만 된다 (#21). 예비 배포는 하루 한 번 Actions 가 올린다(2026-10-30, #33) -
   돌리기 직전 pages-standby 수동 실행 → Pages 커스텀 도메인에 www, 맨 도메인은 Proxied + Redirect Rule. 절차 · 되돌리기는 `docs/plan-pages-standby.md`.

## 평소에 해 둘 것 (비상 조치를 덜 쓰게)

- 파비콘 · `apple-touch-icon` 을 static 주소에서 받게 (지금 www 로 페이지뷰마다 1–2건).
- 6시간 데이터 배포 때 바뀌는 이미지 해시 줄이기 (같은 그림인데 이름이 바뀌어 static 캐시 MISS 가 반복되는지 확인).
- 장기: #46 (정적 페이지 = Cloudflare, `/api` = Vercel) 이 되면 이 문서의 비상 조치 대부분이 필요 없어진다.

## 되돌리기

- 봇 규칙: Vercel → Firewall → 규칙 끄기 (지우지 않고 꺼 둔다 - 다음 비상 때 다시 켠다).
- Web Analytics: 되돌리지 않는다 (Cloudflare Web Analytics 로 바꿨다 - 위 비상 조치 2).
- 예비 배포로 돌렸다면 DNS 먼저 - www CNAME(`208acfa57af275f1.vercel-dns-017.com`) · 맨 도메인 A(`216.198.79.1`)를 DNS only 로, 맨 도메인 Redirect Rule 끄기, 그다음 Pages 커스텀 도메인 빼기 (`docs/plan-pages-standby.md`).

## 현재 구성 기록 (2026-10-29 · 30, PR #44 과 함께 바뀐 것)

CLAUDE.md DNS 설명에 아직 없다 - 반영 필요.

- `static.urnlock.com` 만 Proxied(주황) - CNAME → Vercel. `www` · 루트는 그대로 DNS only.
  Vercel 프로젝트 도메인에도 `static.urnlock.com` (Production) 추가. 인증서는 Vercel 이 HTTP-01 로 발급하므로 아래 리디렉트에서 `/.well-known/` 을 뺐다.
- `astro.config.mjs` `build.assetsPrefix` - 프로덕션 빌드에서만 `https://static.urnlock.com`. `vercel.json` CSP 에 static 주소, `/_astro/*` 에 `Access-Control-Allow-Origin: *`.
- SSL/TLS: Full (strict).
- Cloudflare 규칙:
  - Redirect: `static` 에서 `/_astro/` · `/masks/` · `/.well-known/` 이 아닌 경로 → `https://www.urnlock.com` 301 (HTML 중복 방지)
  - Response Header Transform: `static` 응답에 `Access-Control-Allow-Origin: *` (CSS 의 `/masks/*.svg` mask-image 에 필요)
  - Cache Rule: `static` 의 `/masks/` 는 Cache-Control 무시, Edge TTL 1일 (Vercel 이 public 파일에 짧은 캐시를 보내서)
  - Tiered Cache: Smart Tiered Cache 켬
- 배포 직후 CORS 헤더 없이 캐시된 파일이 남지 않도록 처음 한 번 Purge Everything 했다. 평소 배포는 파일 이름에 해시가 있어 비우지 않아도 된다.
