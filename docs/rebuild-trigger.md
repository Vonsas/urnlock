# 6시간 재빌드 깨우기 Worker (2026-11-02)

GitHub Actions 예약 실행이 3–4시간씩 밀리거나 통째로 빠져서(11/2 07:37 · 13:37 KST 둘 다 안 돎) 사이트 데이터가 멈췄다.
Cloudflare Worker 예약이 정시에 `daily-rebuild` 를 `workflow_dispatch` 로 부르고, GitHub 예약은 예비로 남긴다.

| 누가 | 언제 | 무엇을 |
|---|---|---|
| Worker `urnlock-rebuild-trigger` | 01:37 · 07:37 · 13:37 · 19:37 KST | 1시간 안에 시작해 성공했거나 도는 중인 수동 · Worker 실행이 없으면 `workflow_dispatch` (입력 `source=worker` → 실행 이름 'daily-rebuild (Worker)'). 도는 중인 예약은 곧 스스로 취소될 수 있어 세지 않는다 |
| Worker (새 Steam 글 감시, 2026-11-04) | 2분마다 | deadlock-api `/v2/patches` 의 가장 최근 Steam 글이 하루 안에 올라왔고 www `health.json` 의 `currentPatch` 와 다르면 `workflow_dispatch` (입력 `source=patch-{글 번호}` → 실행 이름 'daily-rebuild (patch-…)'). 글마다 한 번 - 그 이름의 실행이 성공했거나 도는 중이면 건너뛰고, 실패 · 취소면 1시간 뒤 다시 |
| GitHub 예약 (예비) | 같은 시각 - 실제로는 +23m – +5h57m 늦게 옴 (10/31 – 11/2), 빠지기도 함 | 첫 단계: 최근 6시간 10분 안에 'daily-rebuild (Worker)' · '(patch-…)' 실행이 있으면(Worker 가 살아 있음) 스스로 취소. 없으면 그대로 빌드 |

- 수동 실행(Actions 탭)은 이름이 그냥 'daily-rebuild' 라 세지 않는다 - Worker 가 없을 때 수동 실행이 다음 차례 예약까지 지우지 않게. 수동 실행의 `source` 칸은 비워 둔다 (`worker` 를 넣으면 대소문자 상관없이 Worker 실행으로 셈).
- 취소되는 예약 실행도 Actions 1분으로 센다 - Worker 가 살아 있으면 하루 약 3번 · 월 약 90분 (비공개 저장소 무료 월 2,000분).
- Worker 가 멈추면(토큰 만료 등) dispatch 가 끊겨 예약이 다시 돈다 - 늦을 뿐 멈추지는 않는다. 디스코드 웹후크를 넣어 두면 실패 때 알림.
- 소스 = `workers/rebuild-trigger/index.js` (원본). 대시보드에 붙여 넣으면 `wrangler.toml` 은 적용되지 않으므로 아래 설정을 손으로 맞춘다.

## 만들기 (대시보드)

이 PR(#84)이 main 에 머지된 뒤에 만들 것 - 그 전엔 main 워크플로에 `source` 입력이 없어 실행 요청이 422 로 실패한다 (디스코드엔 '토큰 · 권한 확인' 알림).

1. GitHub 토큰 - GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token
   - Token name `urnlock-rebuild-trigger` · Expiration 1년(최대) - 만료일을 달력에 적어 둘 것
   - Repository access: Only select repositories → `Vonsas/dldb`
   - Permissions → Repository permissions → Actions: Read and write (나머지는 모두 No access. Metadata: Read-only 는 자동으로 붙음)
2. Worker - Cloudflare → Workers & Pages → Create → Workers → Hello World 로 만들기 → 이름 `urnlock-rebuild-trigger` → Deploy
   → Edit code → 내용을 `workers/rebuild-trigger/index.js` 로 모두 바꾸고 Deploy
3. 주소 끄기 - 그 Worker → Settings → Domains & Routes → `workers.dev` · Preview URLs 를 Disable (이 Worker 는 HTTP 처리기가 없지만 주소 자체를 닫아 둔다)
4. 예약 - Settings → Trigger Events(또는 Triggers) → Add → Cron Triggers → `37 4,10,16,22 * * *` (UTC), 하나 더 `*/2 * * * *` (새 Steam 글 감시 - `index.js` 의 `WATCH_CRON` 과 글자까지 같아야 한다)
5. 비밀값 - Settings → Variables and Secrets → Add → Type Secret
   - `GITHUB_TOKEN` = 1번 토큰
   - (선택) `DISCORD_WEBHOOK` = 알림 채널 웹후크 주소
6. 확인 - 다음 정시 뒤 GitHub Actions → daily-rebuild 에 'daily-rebuild (Worker)' 실행이 생기는지, 그 뒤 늦게 온 예약 실행이 '취소됨' 인지. Worker → Logs 에 '실행 요청' · '건너뜀'.

2026-11-04 부터 wrangler 로 배포 (이 PC 에 `npx wrangler login` - 감시 · 로그 켜기를 함께 올림). 대시보드 설정은 wrangler.toml 이 덮어쓰므로 설정은 그 파일에서 바꾼다.

`wrangler` 로 올릴 때: 이 폴더에서 `npx wrangler deploy` → `npx wrangler secret put GITHUB_TOKEN` (wrangler.toml 이 주소 끄기 · 예약까지 맞춘다).

## 고치기 · 되돌리기

- 코드를 고치면 이 저장소에서 고치고(PR) 머지한 뒤 이 폴더에서 `npx wrangler deploy` (2026-11-04 부터 - 대시보드에 붙여 넣으면 toml 설정과 어긋난다). `workers/` 만 바뀐 커밋은 Vercel 빌드를 건너뛴다(`tools/ignore-build.sh`).
- 토큰 교체: 새 토큰을 만들어 `GITHUB_TOKEN` 비밀값만 바꾸고, 옛 토큰은 GitHub 에서 지운다.
- 새 Steam 글 감시를 켤 때 순서 (#106): ① 이 PR 이 main 에 머지된 뒤(실행 이름 'daily-rebuild (patch-…)' 가 main 워크플로에 있어야 '글마다 한 번' 이 듣는다)
  ② 새 `index.js` 를 배포하고 Worker → Deployments 에 새 버전이 올라간 것을 확인 ③ 그 다음 `*/2 * * * *` Cron Trigger 추가. 옛 코드에 새 예약이 먼저 붙으면 옛 코드는 모든 예약을 6시간 차례로 본다.
  안전장치: 한 글에 3번 · 글 뒤 dispatch 실행 8개면 멈추고, 모르는 예약 글자는 아무것도 안 한다. 예비 예약 취소는 '(patch-…)' 실행도 Worker 가 살아 있다는 신호로 센다.
- 새 Steam 글 감시만 끄기: `wrangler.toml` 의 `crons` 에서 `*/2 * * * *` 를 빼고 `npx wrangler deploy` (대시보드에서 지우면 다음 배포 때 toml 이 되살린다) (영어 원문 · 번역은 6시간 차례에 따라온다). 영웅 출시 공지도 Steam 글이라 한 번 재빌드한다 - 새 영웅 데이터가 빨리 들어오는 덤.
- 끄기: `wrangler.toml` 의 `crons` 를 비우고 `npx wrangler deploy` → GitHub 예약만 돈다 (마지막 Worker 실행에서 6시간 10분 뒤부터 취소되지 않음).
