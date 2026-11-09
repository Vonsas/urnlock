/**
 * 패치노트 영웅 묶음 정리 (2026-11-06 사용자):
 * 능력 이름을 제목으로 한 번만 쓰고 줄에서는 뺀다 · 영웅을 두 단으로 나눌 자리를 정한다.
 * 데이터(번역 사전 · 영웅 상세의 최근 패치 칸)는 그대로 두고 패치노트 화면에서만 쓴다.
 */
import type { PatchBlock } from '../data';

type Group = Extract<PatchBlock, { type: 'group' }>;

/** 이름 다음에 오면 줄이 그 능력만 얘기하는 게 아니므로 이름을 남긴다 ('반격 및 돌진 …') */
const JOINED = /^(?:and\b|or\b|&|,|및\s|와\s|과\s|和|、|与|及)/i;
/** 이름과 내용을 잇는 부분 — 구분 기호, 조사, 공백 */
const AFTER_NAME = /^(?:\s*[-–—]\s+|\s*[:：]\s*|['’]s\s+|(?:의|이|가|은|는)\s+|的|\s+)/; // 대시는 뒤에 공백이 있을 때만 — 'Slam -5s' 의 음수 부호를 지우지 않게 (#144 리뷰)

const HAN_END = /\p{Script=Han}$/u;
const HAN_NEXT = /^[\p{Script=Han}A-Za-z0-9+]/u;

/** 줄 맨 앞의 능력 이름을 뺀다. 빼면 말이 안 되는 줄은 그대로 */
export function withoutAbilityName(text: string, names: readonly (string | undefined)[]): string {
  const lower = text.toLowerCase();
  // 긴 이름부터 — 번역 줄에 영어 이름이 남은 경우까지 (언어마다 이름이 하나씩)
  for (const name of [...names].filter((n): n is string => !!n).sort((a, b) => b.length - a.length)) {
    if (!lower.startsWith(name.toLowerCase())) continue;
    const rest = text.slice(name.length);
    const sep = rest.match(AFTER_NAME);
    // 중국어는 띄어 쓰지 않는다 ('炫目戏法冷却时间…')
    if (!sep && !(HAN_END.test(name) && HAN_NEXT.test(rest))) continue;
    const body = sep ? rest.slice(sep[0].length) : rest;
    if (!body || JOINED.test(body)) return text;
    return body[0].toUpperCase() + body.slice(1);
  }
  return text;
}

/** 줄이 차지할 칸 수 — 한글 · 한자는 라틴 글자 두 칸 폭 */
const lineCount = (text: string) => {
  let units = 0;
  for (const ch of text) units += ch.charCodeAt(0) > 0x2e7f ? 2 : 1;
  return Math.max(1, Math.ceil(units / 70));
};

/** 묶음의 어림 높이(px) — 머리 · 일반 줄 · 능력마다 이름 + 줄. 글꼴을 재지 않는 빌드 때 계산이라 대강이다 */
function estimate(g: Group): number {
  const lines = (ls: Group['lines']) => ls.reduce((sum, l) => sum + lineCount(l.text) * 21 + 4, 0);
  let height = 68 + lines(g.lines.filter((l) => !l.ability));
  for (const a of g.abilities ?? []) height += 14 + Math.max(44, 22 + lines(g.lines.filter((l) => l.ability === a.slot)));
  return height;
}

/**
 * 묶음을 순서 그대로 두 단으로 — 두 단 높이 차이가 가장 작은 자리에서 자른다.
 * CSS columns 는 아래쪽 끝을 맞출 수 없어 직접 나눈다 (남는 높이는 화면에서 flex-grow 로 나눠 끝을 맞춘다).
 */
export function splitColumns(groups: readonly Group[]): [Group[], Group[]] {
  const heights = groups.map(estimate);
  const total = heights.reduce((a, b) => a + b, 0);
  let best = 1;
  let bestGap = Infinity;
  let left = 0;
  for (let i = 1; i < groups.length; i++) {
    left += heights[i - 1];
    const gap = Math.abs(total - 2 * left);
    if (gap < bestGap) {
      bestGap = gap;
      best = i;
    }
  }
  return [groups.slice(0, best), groups.slice(best)];
}
