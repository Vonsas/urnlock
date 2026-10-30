/**
 * 유저 팁 공용 규칙 (2026-10-06) — 쓰기 화면(scripts/guide.ts)과 서버(src/pages/api/tips.ts)가 같은 검사를 쓴다.
 * 서버가 최종 판단: 브라우저 검사는 바로 알려 주기 위한 것일 뿐이다.
 */
import { hasProfanity } from './profanity.js';

/** 가이드 탭(유저 팁) 켜기 — 서버(Vercel 함수 + 저장소)가 준비되기 전엔 false 로 탭을 숨긴다 */
export const TIPS_ENABLED = true;

export const TIP_MIN_LENGTH = 10;
export const TIP_MAX_LENGTH = 200;
/**
 * 글 팁은 검사(길이·링크·욕설)를 통과하면 **바로 공개** (2026-10-06 사용자 결정 — 승인은 나중에 붙일 사진 팁에만).
 * 공개 후 이상한 글은 운영자가 /admin/ 에서 내리거나 계정을 차단한다.
 */
/** 계정당 하루에 보낼 수 있는 팁 */
export const TIP_DAILY_LIMIT = 3;

export type TipError = 'tooShort' | 'tooLong' | 'link' | 'profanity' | 'rate' | 'busy' | 'readonly' | 'banned' | 'auth' | 'server';

/** 공개된 팁 — /api/tips 가 돌려주는 모양 */
export interface PublicTip {
  id: string;
  text: string;
  /** 쓴 사람 (스팀 계정 ID = SteamID3) */
  accountId: number;
  name: string;
  /** 쓸 때 기록한 랭크 (단계 1–11, 하위 1–6). 랭크가 없으면 null */
  rank: { tier: number; sub: number } | null;
  /** 이 영웅 판수 — deadlock-api 기록 기준(빠진 판이 있을 수 있어 최소치). 모르면 null */
  games: number | null;
  /** 공개(승인) 시각, unix 초 */
  at: number;
  /** 익명으로 올린 팁 — accountId 0 · name '' (lib/guide-format AuthorDisplay) */
  anonymous: boolean;
}

/** 줄바꿈·공백 정리 — 줄은 최대 3줄, 연속 공백은 하나로 */
export function normalizeTip(raw: string): string {
  return raw
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, 3)
    .join('\n');
}

const LINK = /(https?:\/\/|www\.|\.(com|net|org|gg|kr|io|tv|me|ly)\b|discord\.gg)/i;

export function checkTip(text: string): TipError | null {
  if (text.length < TIP_MIN_LENGTH) return 'tooShort';
  if (text.length > TIP_MAX_LENGTH) return 'tooLong';
  if (LINK.test(text)) return 'link';
  if (hasProfanity(text)) return 'profanity';
  return null;
}
