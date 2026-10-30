# 계획서 - 패치가 올라오면 최대한 빨리 사이트 반영 + 자동 번역

작성 2026-10-15. 다른 PC 에서 이어 할 것. 진행 상황은 맨 아래 체크리스트에 표시.

## 왜 (현재 문제)

1. 정기 재빌드가 실제로는 하루 1~3번뿐
   - `.github/workflows/daily-rebuild.yml` 은 `37 4,10,16,22 * * *`(KST 01:37 · 07:37 · 13:37 · 19:37) 로 6시간마다인데,
     GitHub 이 예약 실행을 몇 시간씩 미루거나 건너뛴다.
   - 실제 기록 (UTC): 10-13 01:13 / 10-13 23:14 / 10-14 15:27 · 20:19 / 10-15 00:49.
   - 그래서 Steam 에 패치가 올라와도 사이트(패치노트 · 티어 '현재 패치' 기간)에 뜨기까지 반나절 넘게 걸릴 수 있다.
2. 패치노트 번역이 사람 손을 기다린다
   - 번역 안 된 줄은 영어 원문으로 보인다 (`health.json` 의 `untranslated`).
   - 예) 10/14 마이너 업데이트 27줄 - 2026-10-15 대화에서 수동 번역해 넣음.

## 목표

패치 후 20~30분 안에 영어 원문으로, 40분~1시간 안에 한국어·중국어 번역까지 사이트에 반영. 비용은 무료 범위, 토큰은 새 패치가 있을 때만.

## 설계

```
cron-job.org (10분마다, 무료)
   └─▶ GET https://www.urnlock.com/api/patch-watch?key=<비밀값>      (Vercel 함수, 새로 만듦)
          1) deadlock-api /v2/patches 에서 가장 최근 '패치' 글(Steam, isPatchPost 통과)의 link 를 구함
          2) 우리 사이트 /health.json 의 currentPatch.url 과 비교
          3) 다르면 → GitHub repository_dispatch (event_type: "new-patch") 호출
             (같으면 아무것도 안 함 - 배포가 도는 10~20분 동안 여러 번 호출돼도 워크플로 concurrency 로 한 번만 돈다)
   
GitHub Actions  (daily-rebuild.yml 에 repository_dispatch: [new-patch] 추가 - 같은 워크플로 재사용)
   └─▶ 패치 보관(tools/archive-patches.mjs) → 바뀌었으면 커밋·푸시 → Vercel 이 배포 (영어 원문으로 먼저 뜸)

Claude 예약 작업 'Urnlock 패치노트 자동 번역' (이미 만들어 둠)
   └─▶ 위 커밋(push to main, src/data/patch-archive.json 변경)을 신호로 즉시 실행 (webhook trigger 추가)
       번역 → 검사 → ko.json/zh.json 커밋·푸시 → Vercel 재배포
```

### 정기 재빌드도 같이 고치기 (선택)
- cron-job.org 에 6시간마다 GitHub `repository_dispatch`(event_type: "rebuild") 를 직접 부르는 작업을 하나 더 두면
  GitHub 예약 실행의 지연·누락 없이 정확히 6시간마다 돈다. (또는 patch-watch 함수가 6시간마다 한 번은 무조건 dispatch)
- GitHub schedule 은 그대로 남겨 두고 예비로 쓴다.

## 할 일 - Claude (코드)

1. `api/patch-watch.ts` (Vercel 함수, 다른 api/*.ts 와 같은 형식 · import 는 `.js` 확장자 · 지역 hnd1)
   - `?key=` 가 환경 변수 `PATCH_WATCH_KEY` 와 같을 때만 동작 (아니면 404) - 아무나 호출해 빌드를 돌리지 못하게.
   - deadlock-api `/v2/patches` → `source === 'steam'` 이고 `isPatchPost()`(src/data/api/patch-posts.ts 의 판별을 그대로 쓰거나 같은 규칙) 인 글 중 최신의 `link`.
   - `https://www.urnlock.com/health.json` 의 `currentPatch.url` 과 다르면 GitHub API
     `POST /repos/Vonsas/dldb/dispatches` `{ "event_type": "new-patch", "client_payload": { "link": … } }` (헤더 `Authorization: Bearer ${GITHUB_DISPATCH_TOKEN}`).
   - 응답은 `{ checked, latest, live, dispatched }` 정도의 짧은 JSON. 실패해도 500 대신 200 + 이유 (cron-job.org 가 실패로 끄지 않게).
   - `vercel.json` CSP 와 무관 (서버 → 서버 요청).
2. `.github/workflows/daily-rebuild.yml`: `on:` 에 `repository_dispatch: types: [new-patch, rebuild]` 추가.
   - `concurrency: group: rebuild` 가 이미 있어 겹쳐 오면 차례로 돈다 (cancel-in-progress: false).
   - new-patch 일 때 `check-health.mjs --wait` 는 그대로 둬도 됨.
3. 번역 예약 작업을 push 에 연결: `RemoteTrigger` 의 `create_webhook_trigger` 로
   GitHub `push` 이벤트 · 저장소 Vonsas/dldb · 브랜치 main · 변경 파일 `src/data/patch-archive.json` 필터 → routine `<루틴 ID>` 실행.
   - 예약(오전 10시 · 오후 10시)은 예비로 남겨 둔다.
4. CLAUDE.md '검색 노출 · 자동 점검' 근처에 이 흐름을 한 단락으로 기록, 이 계획서는 완료 표시.
5. 시험: Steam 새 글을 기다리지 말고 - patch-watch 를 `?key=…&force=1`(시험용, dispatch 만 강제) 로 한 번 불러 워크플로가 도는지,
   빈 커밋 대신 번역 예약 작업은 `RemoteTrigger run` 으로 따로 시험.

## 할 일 - 직접 (각 5분)

1. Claude 클라우드 네트워크 허용 (번역 예약 작업이 deadlock-api 를 못 불러 멈춰 있음 - 아래 '현재 예약 작업 상태')
   - https://claude.ai/code → 환경(Environments) → Default → 네트워크 접근 → 사용자 지정 → 허용 도메인:
     `api.deadlock-api.com`, `assets-bucket.deadlock-api.com`
2. GitHub 토큰 (빌드 신호용)
   - GitHub → Settings → Developer settings → Fine-grained tokens → 새 토큰: 저장소 Vonsas/dldb 만,
     권한 Contents: Read and write (repository_dispatch 에 필요), 만료 1년.
   - Vercel 프로젝트 → Settings → Environment Variables (Production) 에
     `GITHUB_DISPATCH_TOKEN` = 그 토큰, `PATCH_WATCH_KEY` = 아무 긴 무작위 문자열 (Claude 가 만들어 줌).
3. cron-job.org
   - 가입 → Create cronjob → URL `https://www.urnlock.com/api/patch-watch?key=<PATCH_WATCH_KEY>` · 10분마다 · GET.
   - (선택) 6시간마다 재빌드 작업 - 2번 토큰으로 GitHub dispatch 를 직접 부르거나, Claude 가 patch-watch 에 `mode=rebuild` 를 만들어 그 주소를 등록.

## 현재 예약 작업 상태 (2026-10-15)

- 이름 'Urnlock 패치노트 자동 번역', id `<루틴 ID>`, (claude.ai 루틴 주소)
- 매일 KST 10:00 · 22:00 (`0 1,13 * * *` UTC), 모델 claude-sonnet-5-5, 환경 Default(`env_01XP8ZNnDSiTgg25MPLoSbFW`, 이때 처음 만들어짐), 커넥터 없음.
- 하는 일: main 최신화 → `npm i -g pnpm@12.6.0`(corepack 은 클라우드에서 안 됨) → API 접속 확인 → `LIGHT_BUILD=1 pnpm build` →
  `.cache/patch-i18n/todo-{ko,zh}.json` 이 비었으면 끝 / 있으면 RULES.md 대로 번역 → 숫자·공식 이름 검사 → 다시 빌드로 확인 → 두 JSON 만 커밋·푸시.
- 첫 시험 결과: 저장소 열기·설치 성공, deadlock-api 접속이 클라우드 네트워크 정책에 막힘(403) → 커밋 없이 멈춤 (안전장치대로).
  직접 할 일 1번을 하기 전까지는 예약 시간마다 같은 이유로 멈춘다 (사이트 영향 없음).
- GitHub 연결: claude.ai 에 GitHub 계정 연결 + Claude GitHub App 을 Vonsas 계정에 설치 완료 (처음엔 앱 미설치로 'repo_access_denied').

## 참고 수치

- 정기 재빌드 한 번: GitHub Actions 약 4~20분 (check-health 가 배포 반영을 최대 20분 기다림). 비공개 저장소 무료 2,000분/월 -
  10분 감시를 Actions 로 하면 한 달 4,000분을 넘어서 Vercel 함수 + 외부 크론으로 하는 것.
- 전체 빌드는 라인전 데이터(일주일 전체, 요청 약 75번) 때문에 약 3분 더 걸린다 -: 사이트가 무거워지지 않으면 괜찮음.

## 체크리스트

- [ ] 직접 1 - 클라우드 네트워크 허용 → Claude 가 `RemoteTrigger run` 으로 번역 예약 작업 다시 시험
- [ ] Claude 1 - api/patch-watch.ts
- [ ] Claude 2 - 워크플로 repository_dispatch
- [ ] 직접 2 - GitHub 토큰 · Vercel 환경 변수
- [ ] 직접 3 - cron-job.org 등록
- [ ] Claude 3 - 번역 예약 작업 webhook 연결
- [ ] Claude 4·5 - 기록 · 시험
