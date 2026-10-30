# /api 요청 수 제한 (#18, 2026-10-30)

두 겹으로 막는다. 앞단(Vercel 방화벽)은 함수에 닿기 전에, 뒷단(함수 안)은 저장소에 닿기 전에.

## 1. Vercel 방화벽 규칙 - 대시보드에서 직접 (직접 할 일)

무료(Hobby) 요금제의 요청 수 제한 규칙은 프로젝트당 1개, 사용자 정의 규칙은 모두 합쳐 3개까지다 (Vercel 문서 'WAF Rate Limiting' · 2026-10-30 확인).
`vercel.json` 으로는 만들 수 없다 - `vercel.json` 의 방화벽 규칙(`routes[].mitigate`)은 '차단' · '확인(challenge)' 만 되고 요청 수 제한은 안 된다. 대시보드 또는 `vercel firewall` CLI 로 만든다.
세는 기준은 IP(또는 JA4), 고정 창 10초–10분, 무료로 허용 요청 100만 건/월.

만드는 곳: Vercel → urnlock(dldb) 프로젝트 → Firewall → Configure → New Rule

| 칸 | 값 |
|---|---|
| Name | `api rate limit` |
| If | Request Path · Starts with · `/api/` |
| Then | Rate Limit |
| 기준 | IP · Fixed window · 실제 수치는 공개 저장소에서 뺐다 (함수 안 제한보다 넉넉하게) |
| 넘으면 | Default (429 - 화면이 '잠시 후 다시' 로 보여 준다. Deny 는 403 이라 일반 오류로 보이니 고르지 말 것) |

- 수치는 함수 안 제한(아래)보다 넉넉하게 - 방화벽은 모든 인스턴스를 합쳐 세므로 정상 사용을 막지 않는 선에서 반복 공격만 거른다.
- 규칙이 1개뿐이라 로그인 · 운영자 주소를 따로 더 낮게 둘 수 없다 → 그쪽은 함수 안 제한(10회/분)과 원래 있던 저장소 한도(운영자 로그인 15분 5회)가 맡는다.
- 저장 뒤 Publish 를 눌러야 적용된다. Firewall → Overview 에서 막힌 요청 수를 볼 수 있다.
- Cloudflare 프록시(주황 구름)를 켜면 안 된다 - 켜면 Vercel 이 보는 IP 가 Cloudflare 것이 되어 모든 방문자가 몇 개 IP 로 묶여 세진다 (방화벽 · 함수 안 제한 둘 다). DNS 를 Cloudflare 로 옮겨도 DNS only(회색 구름) 그대로 (`docs/plan-dns-cloudflare.md`).

## 2. 함수 안 1차 제한 - 코드 (`api/_lib/limit.ts`)

함수 인스턴스 메모리에 IP별 1분 고정 창. 저장소(Redis)를 쓰지 않는다 - 세는 데 명령을 쓰면 그 자체가 무료 한도를 깎으므로.
인스턴스마다 따로라 느슨하지만 한 곳에서 되풀이하는 요청은 저장소에 닿기 전에 거른다.

| 묶음 | 1분 · IP · 인스턴스당 | 쓰는 곳 |
|---|---|---|
| read | 60 | 가이드 목록 · 한 편 · 내 정보, 팁 목록, `/api/session`, 운영자 목록 (CDN 이 놓친 요청만 닿는다) |
| write | 20 | 글 · 수정 · 삭제 · 추천 · 신고 · 사진 · 운영자 처리 |
| auth | 10 | 스팀 로그인 결과 확인 · 로그아웃(POST) · 운영자 로그인 |

- 카운터는 함수 파일마다 따로다 (Vercel 은 `api/` 파일마다 다른 인스턴스) - 같은 read 묶음이어도 가이드 · 팁 · 세션은 각각 60.
- 남의 IP 로 세게 만들어 막는 일 막기 (1차 리뷰): 다른 사이트가 방문자 브라우저로 요청을 보내게 하면 방문자 IP 로 세진다.
  - POST · PUT · DELETE 는 같은 사이트 요청만 센다 - 다른 사이트에서 온 것(Origin 없음 포함)은 `limited()` 가 세지 않고 바로 403. 핸들러의 같은 사이트 확인에 기대지 않는다 (2차 리뷰).
  - 저장소를 안 쓰는 GET(스팀 로그인 시작 · 로그아웃 GET)에는 걸지 않는다. 스팀 결과 확인은 state 쿠키와 돌아올 주소의 state 가 맞은 뒤(스팀 서명 확인 전)에 센다.
  - 읽기 GET 은 그래도 센다 - 요청 헤더는 위조할 수 있어 거를 수 없고, 막혀도 1분이며 대부분 CDN 에서 끝난다.

- 넘으면 429 + `Retry-After`(창이 끝날 때까지 남은 초), 본문 `{ ok: false, error: 'busy', problem: { error: 'busy' } }`, `cache-control: no-store`.
- `busy` 는 저장소에 있는 하루 한도(`rate` - '오늘은 더 올릴 수 없습니다')와 다른 문구다: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.' (`guides.errBusy` · `guide.errBusy`, 세 언어).
- 핸들러 맨 앞에서 부른다 - 로그인 확인 · 저장소보다 먼저 (스팀 결과 확인만 위 이유로 state 확인 뒤).
- IP 는 `x-vercel-forwarded-for` → `x-real-ip` → `x-forwarded-for` 첫 값 순 (`clientIp`). Vercel 은 `x-forwarded-for` 를 덮어써 바깥 값을 넘기지 않지만,
  Vercel 앞에 프록시를 두면 그 프록시 것이 될 수 있어 `x-vercel-forwarded-for` 를 먼저 본다.
- 기억하는 IP 는 1만 개까지 - 넘으면 끝난 창부터, 그래도 많으면 오래된 창부터 지운다 (막혀 있는 최근 IP 는 남는다).
- 운영자 화면(`/admin`)도 429 면 '요청이 너무 많습니다' (그 화면은 원래 한국어 고정).
- 검사: scratchpad `apitest18/limit.mts` (가짜 Upstash + 함수 직접 호출).
