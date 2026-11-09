// 패치노트 번역할 줄만 빠르게 뽑기 — 사이트 빌드(2분+) 없이 영웅 · 아이템 · 패치 데이터만 받아 빌드와 같은 번역 검사를 돌린다 (약 5–10초).
//   npx --yes tsx@4.23.15 tools/patch-todo.ts
//   → .cache/patch-i18n/todo-{ko,zh}.json (빌드가 쓰는 것과 같은 꼴) 을 쓰고, 언어별 줄 수를 출력한다.
// 번역 예약 작업(claude.ai 루틴)이 이걸로 번역할 줄을 찾는다 — 예전엔 LIGHT_BUILD 빌드를 통째로 돌려 10분 넘게 걸렸다 (2026-11-05).
// 이미지 확인(HEAD 수백 번)은 번역과 상관없어 끈다.
import { readFile } from 'node:fs/promises';
import { loadApiData } from '../src/data/api/index';

// 패치 · NPC 이름 요청이 실패하면 loadApiData 는 경고만 남기고 보관 파일 · 빈 목록으로 이어 간다 → 새 패치를 못 보고 '0줄' 로 끝나
// 루틴이 '번역할 것 없음' 으로 멈추지 않게, 그 경고가 나오면 실패로 끝낸다
const failures: string[] = [];
const warnOrig = console.warn;
console.warn = (...args: unknown[]) => {
  const text = args.map(String).join(' ');
  if (/\[dldb:api\] (patches|npc[^:]*):.*요청 실패/.test(text)) failures.push(text);
  warnOrig(...args);
};
const data = await loadApiData({ images: false });
console.warn = warnOrig;
if (failures.length) {
  console.error(['패치 · NPC 데이터를 받지 못함 — 번역할 줄을 알 수 없다:', ...failures].join('\n'));
  process.exit(1);
}
if (!data) {
  console.error('영웅 · 아이템 데이터를 받지 못함 — 번역할 줄을 알 수 없다');
  process.exit(1);
}
if (!data.patchNotes.en.length) {
  console.error('패치노트를 받지 못함');
  process.exit(1);
}
for (const lang of ['ko', 'zh'] as const) {
  const list = JSON.parse(await readFile(`.cache/patch-i18n/todo-${lang}.json`, 'utf8')) as unknown[];
  console.log(`${lang}: ${list.length}`);
}
