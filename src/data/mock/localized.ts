import type { Locale } from '../../i18n/locales';

/** 목업에서만 쓰는 다국어 문자열. API 는 언어별로 따로 요청하므로 이 형태가 필요 없다. */
export type L = Record<Locale, string>;

export const pick = (text: L, lang: Locale): string => text[lang];
