/**
 * Steam 공지 중 '패치' 인 것 — 티어의 현재/이전 패치 기간, 패치노트 목록, 첫 화면 패치 요약이 모두 이 판별을 쓴다.
 *
 * 예전엔 Steam 글을 모두 패치로 봤다 (제목에 'Update' 가 없는 대형 패치 'City Never Sleeps' 를 제목 필터가 놓친 일 때문).
 * 그런데 2026-10-02 부터 새 영웅이 화·금마다 출시되며 소개 공지("Listen up, Crumbums! Your King is here.")가 올라와,
 * 이게 패치로 잡히면 '현재 패치' 기간이 하루로 줄어 승률표 기본 화면의 표본이 사라진다. 그래서 영웅 출시 공지는 뺀다.
 * - 자동: 출시 문구('available to play' · 'available now' · 'introduce our next hero')가 있고 **변경 목록('- ' 줄)이 거의 없는** 글.
 *   2026-10-07 바바 공지 'Mind the Birds!' 가 'available now' 라 예전 판별('available to play' 만)을 빠져나가 패치로 잡혔다.
 *   변경 목록 조건은 진짜 패치가 '… is available now' 를 쓰더라도 빠지지 않게 하려는 것 (패치 13편은 모두 목록이 있거나 출시 문구가 없음, 2026-10-07 확인).
 *   2026-10-21 너스 해로우 공지는 'joins us on the streets' · 'joining us today' 라 그 문구도 더했다.
 *   2026-10-14 솔로몬 'Make Your Move.' · 데드맨 대니 'Fairfax Industries Employee Spotlight' 가 'available in-game now' 라 또 빠져나가 'in-game' 을 더했다.
 * - 수동: 자동 판별이 틀리면 NOT_PATCH_LINKS 에 공지 주소를 넣는다
 * 빠진 글은 빌드 로그에 [dldb:api] 로 남는다 — 새 공지가 오면 확인할 것.
 */
import type { RawPatch } from './raw';
import { warn } from './fetch';

/** 패치가 아닌 Steam 공지 주소 (자동 판별이 놓친 것) */
const NOT_PATCH_LINKS: string[] = [
  // 2026-10-07 바바 출시 'Mind the Birds!' — 자동 판별을 고치기 전에 패치로 잡혔던 글 (자동으로도 걸러지지만 확실히)
  'https://store.steampowered.com/news/app/1422450/view/703281025618282871',
  // 2026-10-21 너스 해로우 출시 'Shh... This Won't Hurt a Bit.' — 'available' 문구 없이 'joins us' 로 와서 빠져나갈 뻔했다
  'https://store.steampowered.com/news/app/1422450/view/669505296465396778',
];

const RELEASE_RE = /available (to play|now|in-game)|introduce our next hero|(joins|joining) us (today|on the streets)/i;
/** 변경 목록 줄이 이만큼 있으면 출시 문구가 있어도 패치로 본다 */
const PATCH_LIST_LINES = 5;

const reported = new Set<string>();

export function isPatchPost(p: RawPatch): boolean {
  if (p.source !== 'steam') return false;
  const text = p.content.replace(/<[^>]+>/g, '\n');
  const listLines = text.split('\n').filter((l) => l.trim().startsWith('- ')).length;
  const release = RELEASE_RE.test(text.replace(/\s+/g, ' ')) && listLines < PATCH_LIST_LINES;
  const skip = (p.link && NOT_PATCH_LINKS.includes(p.link)) || release;
  if (skip && !reported.has(p.pub_date)) {
    reported.add(p.pub_date);
    warn(`패치가 아닌 공지로 보고 뺌: ${p.pub_date.slice(0, 10)} '${p.title.trim()}'`);
  }
  return !skip;
}
