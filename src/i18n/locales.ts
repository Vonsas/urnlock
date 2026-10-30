/**
 * 지원 언어 정의 — astro.config.mjs 와 UI 코드가 함께 참조하는 단일 출처.
 * URL 경로는 `/ko/`, `/en/`, `/zh/` 이고, zh 는 간체(zh-CN) 기준이다.
 */
export const LOCALES = ['ko', 'en', 'zh'] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'ko';

/** 사용자가 고른 언어를 저장하는 localStorage 키 */
export const LANG_STORAGE_KEY = 'dldb:lang';

export const LOCALE_META: Record<Locale, { htmlLang: string; label: string; short: string }> = {
  ko: { htmlLang: 'ko', label: '한국어', short: 'KO' },
  en: { htmlLang: 'en', label: 'English', short: 'EN' },
  zh: { htmlLang: 'zh-CN', label: '简体中文', short: '中文' },
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}
