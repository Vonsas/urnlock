/**
 * 유저 가이드 글 규칙 · 서식 (2026-10-06) — 쓰기 화면 · 보기 화면 · 서버(api/guides.ts)가 같이 쓴다.
 * 가이드 = 글쓴이가 직접 만든 **구역(상자)** 여러 개 (사용자 요청: '라인전 · 중반 운영 · 템트리 선택 · 후반 교전' 처럼 이름을 붙여 하나씩).
 * 구역마다 이름 · 내용 · 사진(최대 3장, 운영자 확인 뒤 공개). 보기 화면은 구역마다 상자 하나 + 옆에 목차.
 * 내용 서식은 간단한 것만: '- 목록' · '**굵게**' · 빈 줄로 문단 ('## 소제목' 도 읽긴 한다). HTML 은 받지 않고, 그릴 때도 글자(textContent)로만 넣는다.
 * 영상은 본문 링크가 아니라 유튜브 칸 하나 (본문 링크는 광고·이상한 사이트 막으려고 금지).
 */
import { findProfanity } from './profanity.js';

export const GUIDE_TITLE_MIN = 5;
export const GUIDE_TITLE_MAX = 60;
/** 모든 구역 내용을 합친 글자 수 */
export const GUIDE_BODY_MIN = 100;
export const GUIDE_BODY_MAX = 8000;
export const SECTION_TITLE_MAX = 30;
export const SECTION_BODY_MAX = 3000;
export const SECTIONS_MAX = 12;
export const SECTION_IMAGES_MAX = 3;
/** 신고 사유 (2026-10-07) — 욕설·비하 / 광고·도배 / 틀린 정보 / 기타 */
export const REPORT_REASONS = ['abuse', 'spam', 'wrong', 'other'] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];
/** 사진 올리기 — 저장소(2026-10-30 부터 Cloudflare R2, 그 전 Vercel Blob — api/_lib/images.ts) 연결 후 켬 (2026-10-06). 끄면 쓰기 화면에 사진 버튼이 없고 서버도 사진을 받지 않는다 */
export const GUIDE_IMAGES = true;
/** 가이드 한 편의 사진 전체 (2026-10-06 사용자: 10장이면 충분) — 구역마다 3장과 함께 */
export const GUIDE_IMAGES_TOTAL = 10;
/** 계정당 하루에 올릴 수 있는 가이드 */
export const GUIDE_DAILY_LIMIT = 3;
/** 영웅 칸 0 = 일반 가이드 (특정 영웅이 아닌 운영·맵·입문 등 — 2026-10-06 사용자: 주제 분류는 두지 않음, 제목으로 충분) */
export const GENERAL = 0;

export type GuideError =
  | 'hero'
  | 'titleShort'
  | 'titleLong'
  | 'bodyShort'
  | 'bodyLong'
  | 'video'
  | 'sections'
  | 'sectionTitle'
  | 'sectionEmpty'
  | 'sectionLong'
  | 'images'
  | 'link'
  | 'profanity'
  | 'rate'
  /** 짧은 시간에 요청이 너무 많음 (함수 안 1차 제한, #18) — 'rate' 는 오늘 한도 */
  | 'busy'
  /** 저장소에 닿지 못함 — 잠시 글쓰기를 쉰다 (#21) */
  | 'readonly'
  | 'banned'
  | 'auth'
  | 'server';

/**
 * 작성자 표시 (2026-10-06 사용자: 계정 공개는 쓰는 사람이 고른다)
 *   public 스팀 닉네임 · 랭크 · 판수 / anon '익명' + 랭크 · 판수 / hidden '익명' 만
 * 익명이어도 서버에는 계정이 남아 차단 · 하루 한도 · 추천 1번에 쓴다. 보는 사람에게는 계정 ID 도 넘기지 않는다.
 */
export type AuthorDisplay = 'public' | 'anon' | 'hidden';
export const AUTHOR_DISPLAYS: AuthorDisplay[] = ['public', 'anon', 'hidden'];
export const DEFAULT_DISPLAY: AuthorDisplay = 'anon';
export const isAuthorDisplay = (v: unknown): v is AuthorDisplay => v === 'public' || v === 'anon' || v === 'hidden';

/** 보는 사람에게 넘기는 작성자 — 익명이면 계정 ID(0)·닉네임('')을 비운다. 예전 글(표시 값 없음)은 공개로 올렸던 것 */
export function publicAuthor(a: { accountId: number; name: string; rank: GuideAuthor['rank']; games: number | null }, display: AuthorDisplay = 'public'): GuideAuthor {
  if (display === 'public') return { accountId: a.accountId, name: a.name, rank: a.rank, games: a.games, anonymous: false };
  return { accountId: 0, name: '', rank: display === 'anon' ? a.rank : null, games: display === 'anon' ? a.games : null, anonymous: true };
}

/** 작성자 표시 — 마지막 고른 값을 이 브라우저에 기억 (팁 · 가이드 쓰기 화면 공용, 처음엔 익명) */
const DISPLAY_KEY = 'dldb:author-display';
export function savedDisplay(): AuthorDisplay {
  try {
    const v = localStorage.getItem(DISPLAY_KEY);
    if (isAuthorDisplay(v)) return v;
  } catch {}
  return DEFAULT_DISPLAY;
}
export function saveDisplay(v: AuthorDisplay) {
  try {
    localStorage.setItem(DISPLAY_KEY, v);
  } catch {}
}

export interface GuideAuthor {
  /** 익명이면 0 — 전적 링크를 만들지 않는다 */
  accountId: number;
  name: string;
  anonymous: boolean;
  /** 쓸 때 랭크 (단계 1–11, 하위 1–6), 없으면 null */
  rank: { tier: number; sub: number } | null;
  /** 이 영웅 판수 (deadlock-api 기록 기준 최소치), 모르면 null */
  games: number | null;
}

/** 목록에 쓰는 요약 */
export interface GuideSummary extends GuideAuthor {
  id: string;
  hero: number;
  title: string;
  /** 첫 구역 내용 앞부분 (서식 기호를 뺀 평문) */
  excerpt: string;
  /** 구역 이름들 (카드에 '라인전 · 중반 운영 · …') */
  sectionTitles: string[];
  votes: number;
  hasVideo: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface GuideImage {
  url: string;
  w: number;
  h: number;
  /** 운영자 확인 전 — 글쓴이 본인에게만 '검토 중' 으로 보인다 */
  pending?: boolean;
}
export interface GuideSection {
  title: string;
  body: string;
  images: GuideImage[];
}

export interface Guide extends GuideSummary {
  sections: GuideSection[];
  /** 유튜브 영상 ID (11자) */
  video: string | null;
}

export type Run = { text: string; bold?: boolean };
/** 들여쓰기 단계 — 줄 앞 공백 1–2칸 = 1단계, 3–4칸 = 2단계 …, 최대 3 (2026-10-06 사용자: 띄어쓴 앞 공백이 사라짐) */
export const INDENT_MAX = 3;
export type ListItem = { runs: Run[]; level: number };
export type Block = { type: 'h'; text: string } | { type: 'p'; lines: Array<{ runs: Run[]; level: number }> } | { type: 'ul'; items: ListItem[] } | { type: 'img'; n: number };

/**
 * 사진 자리 표시 — 내용 칸에 한 줄로 '[사진 1]' 이 있으면 그 자리에 그 구역의 1번 사진 (2026-10-06 사용자: 원하는 곳에 사진 배치).
 * 세 언어 표기를 모두 읽는다. 표시가 없는 사진은 구역 맨 아래에 나온다.
 */
export const IMAGE_TOKEN = /^\[(?:사진|image|图片)\s*(\d{1,2})\]$/i;
export const IMAGE_TOKEN_G = /^\[(?:사진|image|图片)\s*(\d{1,2})\]$/gim;
/** 내용에 자리 표시가 있는 사진 번호들 (1부터) */
export const placedImages = (body: string) => new Set([...body.matchAll(IMAGE_TOKEN_G)].map((m) => Number(m[1])));

/** 줄 앞 공백(탭 = 2칸, 전각 공백 = 2칸)의 칸 수 */
const leadWidth = (l: string) => (/^[ \t\u3000]*/.exec(l)?.[0] ?? '').replace(/[\t\u3000]/g, '  ').length;
/** 줄 앞 공백 → 들여쓰기 단계 */
export const indentLevel = (l: string) => Math.min(Math.ceil(leadWidth(l) / 2), INDENT_MAX);

/**
 * 줄바꿈 정리 · 줄 끝 공백 · 빈 줄 3개 이상은 2개로. 줄 안의 연속 공백은 하나로 줄이되,
 * **줄 앞 공백(들여쓰기)은 남긴다** — 단계(2칸)로 맞춰 최대 3단계.
 */
export const normalizeBody = (raw: string) =>
  raw
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => {
      const rest = l.replace(/^[ \t\u3000]+/, '').replace(/[ \t]+/g, ' ').trimEnd();
      return rest ? '  '.repeat(indentLevel(l)) + rest : '';
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+/, '')
    .trimEnd();
export const normalizeTitle = (raw: string) => raw.replace(/\s+/g, ' ').trim();

function runs(line: string): Run[] {
  const out: Run[] = [];
  const parts = line.split('**');
  // '**' 가 짝이 안 맞으면 마지막 조각은 그냥 글자로
  parts.forEach((text, i) => {
    if (!text) return;
    const bold = i % 2 === 1 && i < parts.length - (parts.length % 2 === 0 ? 1 : 0);
    out.push(bold ? { text, bold: true } : { text });
  });
  return out;
}

export function parseGuide(body: string): Block[] {
  const blocks: Block[] = [];
  let para: string[] = [];
  let list: ListItem[] | null = null;
  const paraBlock = (): Block => ({ type: 'p', lines: para.map((l) => ({ runs: runs(l.trim()), level: indentLevel(l) })) });
  const flush = () => {
    if (para.length) blocks.push(paraBlock());
    if (list) blocks.push({ type: 'ul', items: list });
    para = [];
    list = null;
  };
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    if (!line) {
      flush();
      continue;
    }
    const img = IMAGE_TOKEN.exec(line);
    if (img) {
      flush();
      blocks.push({ type: 'img', n: Number(img[1]) });
      continue;
    }
    const h = /^#{1,3}\s+(.+)$/.exec(line);
    if (h) {
      flush();
      blocks.push({ type: 'h', text: h[1].replace(/\*\*/g, '') });
      continue;
    }
    const li = /^[-•*]\s+(.+)$/.exec(line);
    if (li) {
      if (para.length) {
        blocks.push(paraBlock());
        para = [];
      }
      (list ??= []).push({ runs: runs(li[1]), level: indentLevel(raw) });
      continue;
    }
    if (list) {
      blocks.push({ type: 'ul', items: list });
      list = null;
    }
    para.push(raw.trimEnd());
  }
  flush();
  return blocks;
}

/** 서식 기호를 뺀 평문 앞부분 (목록 카드용) */
export function excerptOf(sections: { body: string }[], max = 140): string {
  const plain = sections
    // 구역마다 따로 기호를 지운 뒤 잇는다 (이어 붙인 뒤 지우면 둘째 구역 첫 줄의 '- ' 가 남는다)
    .map((x) => x.body.replace(IMAGE_TOKEN_G, '').replace(/^#{1,3}\s+/gm, '').replace(/^[-•*]\s+/gm, ''))
    .join(' ')
    .replace(/\*\*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return plain.length > max ? `${plain.slice(0, max - 1)}…` : plain;
}

/** 유튜브 주소 → 영상 ID. 유튜브가 아니면 null */
export function youtubeId(url: string): string | null {
  const s = url.trim();
  if (!s) return null;
  const m =
    /^https?:\/\/(?:www\.|m\.)?youtube\.com\/watch\?(?:.*&)?v=([A-Za-z0-9_-]{11})/.exec(s) ??
    /^https?:\/\/(?:www\.|m\.)?youtube\.com\/(?:shorts|live|embed)\/([A-Za-z0-9_-]{11})/.exec(s) ??
    /^https?:\/\/youtu\.be\/([A-Za-z0-9_-]{11})/.exec(s);
  return m ? m[1] : null;
}

const LINK = /(https?:\/\/|www\.|\.(com|net|org|gg|kr|io|tv|me|ly)\b|discord\.gg)/i;

/** 링크로 보이는 부분 (없으면 null) — 쓰는 동안 바로 알려 주려고 화면도 쓴다. 'abc.com' 처럼 붙은 앞뒤 글자까지 */
export function findLink(text: string): { word: string; start: number; end: number } | null {
  const m = LINK.exec(text);
  if (!m) return null;
  const start = text.slice(0, m.index).search(/\S*$/);
  const end = m.index + m[0].length + (/^\S*/.exec(text.slice(m.index + m[0].length))?.[0].length ?? 0);
  return { word: text.slice(start, end), start, end };
}

/** 막힌 이유 + 어디서 (section: 몇 번째 구역, 0부터) + 걸린 말 — 쓰기 화면이 그 자리를 짚어 준다 */
export interface GuideProblem {
  error: GuideError;
  section?: number;
  field?: 'title' | 'sectionTitle' | 'body';
  /** 욕설 검사에 걸린 표현 (원문 그대로) 과 그 위치 */
  word?: string;
  start?: number;
  end?: number;
}

export interface GuideInput {
  hero: number | null;
  title: string;
  sections: { title: string; body: string; images: number }[];
  video: string;
}

export function checkGuide(input: GuideInput): GuideProblem | null {
  if (input.hero === null || input.hero < 0) return { error: 'hero' };
  if (input.title.length < GUIDE_TITLE_MIN) return { error: 'titleShort', field: 'title' };
  if (input.title.length > GUIDE_TITLE_MAX) return { error: 'titleLong', field: 'title' };
  if (!input.sections.length || input.sections.length > SECTIONS_MAX) return { error: 'sections' };
  for (const [i, x] of input.sections.entries()) {
    if (!x.title || x.title.length > SECTION_TITLE_MAX) return { error: 'sectionTitle', section: i, field: 'sectionTitle' };
    if (!x.body && !x.images) return { error: 'sectionEmpty', section: i, field: 'body' };
    if (x.body.length > SECTION_BODY_MAX) return { error: 'sectionLong', section: i, field: 'body' };
  }
  for (const [i, x] of input.sections.entries()) if (x.images > SECTION_IMAGES_MAX) return { error: 'images', section: i };
  if (input.sections.reduce((n, x) => n + x.images, 0) > GUIDE_IMAGES_TOTAL) return { error: 'images' };
  const total = input.sections.reduce((n, x) => n + x.body.length, 0);
  if (total < GUIDE_BODY_MIN) return { error: 'bodyShort' };
  if (total > GUIDE_BODY_MAX) return { error: 'bodyLong' };
  if (input.video.trim() && !youtubeId(input.video)) return { error: 'video' };
  // 링크 · 욕설은 어디에서 걸렸는지 같이 알려 준다
  type Spot = [GuideProblem['field'], string, number | undefined];
  const fields: Spot[] = [['title', input.title, undefined], ...input.sections.flatMap((x, i): Spot[] => [['sectionTitle', x.title, i], ['body', x.body, i]])];
  for (const [field, text, section] of fields) {
    const link = findLink(text);
    if (link) return { error: 'link', field, section, ...link };
    const bad = findProfanity(text);
    if (bad) return { error: 'profanity', field, section, ...bad };
  }
  return null;
}
