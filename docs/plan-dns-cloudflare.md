# DNS 를 가비아 → Cloudflare 로 (#32)

2026-10-29 결정: 네임서버만 Cloudflare(무료)로 옮긴다. 도메인 등록 · 연장은 가비아 그대로.
이유: #34 사진(R2)을 자기 도메인으로 내려면 Cloudflare 존이 필요하고, #33 예비 배포 때 맨 도메인(urnlock.com)까지 돌리려면
가비아 DNS 로는 안 된다 (맨 도메인에 CNAME 불가 - Cloudflare 는 CNAME 평탄화로 된다).

## 지금 레코드 (2026-10-29 가비아 네임서버에 직접 물어 확인)

| 이름 | 종류 | 값 | TTL |
|---|---|---|---|
| `urnlock.com` | A | `216.198.79.1` (Vercel) | 600 |
| `urnlock.com` | TXT | `google-site-verification=endYBNzcT6PuCftxuV69xl4kp9suYTJ5FTYE9hjMDzw` (구글 서치 콘솔 - 지우면 안 됨) | 600 |
| `www.urnlock.com` | CNAME | `208acfa57af275f1.vercel-dns-017.com` (Vercel) | 600 |

- MX(메일) · CAA 없음. DNSSEC 꺼져 있음(DS 레코드 없음) - 그대로 옮겨도 된다.
- 네임서버: `ns.gabia.co.kr` · `ns1.gabia.co.kr` · `ns.gabia.net`.
- 네이버 서치어드바이저는 DNS 가 아니라 HTML meta 라 상관없다.
- 위 표는 밖에서 물어본 것이라, 가비아 DNS 관리 화면에 다른 줄이 더 있으면 그것도 옮긴다.

## 순서 (직접 - 계정 만들기 · 로그인 · 네임서버 변경)

저녁(19–24시)은 피한다. 옮기는 동안 두 곳이 같은 레코드를 주므로 사이트는 끊기지 않는다.

1. Cloudflare 가입 → 바로 2단계 인증 켜기 (DNS 를 쥐면 계정 탈취 = 도메인 탈취).
2. Onboard a domain → `urnlock.com` → Free 플랜. 자동 검색된 레코드를 위 표와 대조한다.
   - 세 줄 모두 DNS only (회색 구름) 으로. 주황(프록시)이면 Vercel 인증서 발급 · 도메인 확인이 깨진다.
   - 표에 없는 줄이 자동으로 들어왔으면 지운다.
3. Cloudflare 가 알려 주는 네임서버 2개(`○○○.ns.cloudflare.com`)를 적어 둔다.
4. 가비아: 도메인 안전잠금이 네임서버 변경을 막으면 잠시 풀고 → 네임서버 설정에서 가비아 3개를 지우고 Cloudflare 2개를 넣는다 → 안전잠금 다시 켜기.
   가비아 DNS 의 레코드는 지우지 않는다 (되돌릴 때 그대로 쓴다).
5. Cloudflare 에서 Active 가 될 때까지 기다린다 (보통 몇 시간, 최대 24시간 - 메일이 온다).
6. Active 가 되면 Claude 에게 '확인해 줘' → 아래 확인 목록.

## 결과 (2026-10-29)

가비아 네임서버를 `kara.ns.cloudflare.com` · `matteo.ns.cloudflare.com` 로 바꿨고, 몇 분 만에 Verisign(.com 등록소) · Google · Cloudflare 공용 DNS 에 반영됐다.
Cloudflare 네임서버의 세 레코드가 위 표와 글자까지 같고, `urnlock.com` → www 308 · 페이지 · `/api/session` 200 · Vercel 인증서(Let's Encrypt) 정상, 응답 IP 가 Vercel 것(DNS only).
Cloudflare 가입 때 Bot Preference Sync 는 끄도록 안내함 (우리 robots.txt 를 바꾸지 않게 - DNS only 라 지금은 효과 없음).

## 확인 (Claude)

- [x] 네임서버가 Cloudflare 로 보인다 (`Resolve-DnsName urnlock.com -Type NS`)
- [x] 세 레코드 값이 위 표와 같다, 응답 IP 가 Cloudflare 가 아니라 Vercel 것(DNS only 확인)
- [x] `https://urnlock.com` → `https://www.urnlock.com` 308, 인증서 정상
- [ ] 첫 페이지 · 영웅 · 티어 · 가이드 열림, 스팀 로그인 · 로그아웃 (www)
- [ ] Vercel Domains 화면 'Valid Configuration' (직접 확인)
- [ ] 구글 서치 콘솔 '도메인' 속성 확인 상태 유지 (직접 확인)

## 끝난 뒤

- DNSSEC 켜기 (권장): Cloudflare DNS → DNSSEC 켜기 → 주는 DS 값을 가비아 DNSSEC 설정에 넣는다. 위조 응답을 막는다.
  넣고 나면 네임서버를 다시 바꿀 때 DNSSEC 를 먼저 끄고 바꿔야 한다 (안 그러면 도메인이 안 열린다).
- 2주쯤 문제없으면 가비아 DNS 레코드는 남겨 둬도 되고 지워도 된다 (안 쓰이는 상태).
- CLAUDE.md '현재 상태' 의 DNS 설명을 Cloudflare 로 고친다.

## 되돌리기

가비아 네임서버 설정을 `ns.gabia.co.kr` · `ns1.gabia.co.kr` · `ns.gabia.net` 로 되돌린다 (가비아 레코드가 그대로 있으므로 그걸로 끝).
DNSSEC 를 켰다면 가비아에서 DS 를 먼저 지운다.
