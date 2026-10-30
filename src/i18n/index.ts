import { ko, type Dictionary } from './ko';
import { en } from './en';
import { zh } from './zh';
import { DEFAULT_LOCALE, LOCALES, isLocale, type Locale } from './locales';

export * from './locales';
export type { Dictionary };

const dictionaries: Record<Locale, Dictionary> = { ko, en, zh };

/** 라우트 파라미터를 Locale 로 좁힌다. 알 수 없는 값이면 기본 언어. */
export function toLocale(value: unknown): Locale {
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

export function useTranslations(lang: Locale): Dictionary {
  return dictionaries[lang];
}

/** 모든 언어의 사전 — 푸터처럼 세 언어를 동시에 보여줄 때 사용 */
export function allDictionaries(): Array<[Locale, Dictionary]> {
  return LOCALES.map((l) => [l, dictionaries[l]]);
}

/** `/ko/heroes/abrams/` → `heroes/abrams/` (언어 접두어를 뗀 경로) */
export function stripLocale(pathname: string): string {
  const [, first, ...rest] = pathname.split('/');
  return isLocale(first) ? rest.join('/') : pathname.replace(/^\//, '');
}

/** 언어 접두어가 붙은 내부 링크를 만든다. path 는 'heroes/abrams' 처럼 앞뒤 슬래시 없이. */
export function localePath(lang: Locale, path = ''): string {
  const clean = path.replace(/^\/+|\/+$/g, '');
  return clean ? `/${lang}/${clean}/` : `/${lang}/`;
}
