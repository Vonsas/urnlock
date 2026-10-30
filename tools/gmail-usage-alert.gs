// Gmail → 디스코드: Vercel · Upstash 가 보내는 무료 한도 사용량 경고 메일을 알라밍 채널로 (2026-10-29, #22).
// Hobby 는 Vercel 사용량을 API 로 읽을 수 없어서(청구 API 가 404 costs_not_found) Vercel 이 보내는 경고 메일을 옮긴다.
// 저장소에서 실행되는 코드가 아니다 — 사용자가 script.google.com 새 프로젝트에 붙여 넣고 1시간마다 돌린다.
//
// 처음 설정 (순서대로):
//   1. 프로젝트 설정(톱니) → 스크립트 속성 → DISCORD_WEBHOOK = 알라밍 채널의 디스코드 웹후크 주소 (코드에 적지 않는다)
//   2. preview() 실행 → 권한 승인(Gmail · 외부 요청) → 실행 로그에서 지난 1년 vercel.com · upstash.com 메일 제목과 '걸림' 여부 확인 (보내지 않음)
//   3. test() → 채널에 시험 한 줄
//   4. setup() → 1시간마다 run() 예약
// Gmail 전체 권한을 쓰는 프로젝트라 다른 사람과 공유하지 않는다.

/** 찾을 메일 — 보낸 곳 + 제목 낱말. 보낸 메일엔 라벨을 붙여 다시 보내지 않는다 */
const QUERIES = [
  { name: 'Vercel', q: 'from:vercel.com subject:(usage OR limit OR limits OR exceeded OR paused OR reached OR approaching OR suspended)' },
  { name: 'Upstash', q: 'from:upstash.com subject:(usage OR limit OR limits OR quota OR exceeded OR reached OR approaching)' },
];
const SENT_LABEL = 'urnlock-discord-sent'; // 검색에 쓰므로 영문
/** 처음 켰을 때 옛 메일이 한꺼번에 가지 않게 최근 며칠만 */
const RECENT = 'newer_than:7d'; // 웹후크가 며칠 실패해도 다시 보낼 수 있게 일주일

function run() {
  const hook = webhook_();
  const label = GmailApp.getUserLabelByName(SENT_LABEL) || GmailApp.createLabel(SENT_LABEL);
  for (const { name, q } of QUERIES) {
    const threads = GmailApp.search(`${q} ${RECENT} -label:${SENT_LABEL}`, 0, 20);
    for (const thread of threads.reverse()) {
      const msg = thread.getMessages().pop();
      const when = Utilities.formatDate(msg.getDate(), 'Asia/Seoul', 'M월 d일 HH:mm');
      // 본문 앞부분만 — 메일 주소 모양은 가린다
      const snippet = msg.getPlainBody().replace(/\s+/g, ' ').trim().replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '(메일 주소)').slice(0, 300);
      post_(hook, `[${name} 메일] (${when}): ${msg.getSubject()}\n${snippet}`);
      thread.addLabel(label);
    }
  }
}

/** 1시간마다 run() — 여러 번 눌러도 예약은 하나만 */
function setup() {
  for (const t of ScriptApp.getProjectTriggers()) if (t.getHandlerFunction() === 'run') ScriptApp.deleteTrigger(t);
  ScriptApp.newTrigger('run').timeBased().everyHours(1).create();
  webhook_();
  Logger.log('1시간마다 실행하도록 예약했습니다');
}

/** 보내지 않고 확인만 — 지난 1년 두 곳에서 온 메일 제목과, 위 검색어에 걸리는지 (실행 로그에) */
function preview() {
  for (const { name, q } of QUERIES) {
    const from = q.split(' ')[0];
    const matched = new Set(GmailApp.search(`${q} newer_than:365d`, 0, 100).map((t) => t.getId()));
    const all = GmailApp.search(`${from} newer_than:365d`, 0, 100);
    Logger.log(`${name}: ${from} 메일 ${all.length}개 중 ${matched.size}개가 걸림`);
    for (const t of all) Logger.log(`  ${matched.has(t.getId()) ? '걸림' : '안 걸림'}  ${Utilities.formatDate(t.getLastMessageDate(), 'Asia/Seoul', 'yyyy-MM-dd')}  ${t.getFirstMessageSubject()}`);
  }
}

function test() {
  post_(webhook_(), '[연결 확인] Gmail → 디스코드 (Vercel · Upstash 사용량 경고 메일을 이 채널로 보냅니다)');
}

function webhook_() {
  const hook = PropertiesService.getScriptProperties().getProperty('DISCORD_WEBHOOK');
  if (!hook || !/^https:\/\/(discord|discordapp)\.com\/api\/webhooks\//.test(hook)) throw new Error('스크립트 속성 DISCORD_WEBHOOK 에 디스코드 웹후크 주소를 넣어 주세요');
  return hook;
}

function post_(hook, text) {
  UrlFetchApp.fetch(hook, {
    method: 'post',
    contentType: 'application/json',
    // 멘션 막음 · 링크 미리 보기 끔(flags 4)
    payload: JSON.stringify({ content: text.slice(0, 1900), allowed_mentions: { parse: [] }, flags: 4 }),
  });
}
