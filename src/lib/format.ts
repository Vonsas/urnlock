import { LOCALE_META, type Locale } from '../i18n/locales';
import type { ItemStat } from '../data/types';

/** '영웅 {n}명' 같은 문구의 자리표시자를 채운다 */
export function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(vars[key] ?? `{${key}}`));
}

export function formatNumber(lang: Locale, value: number, maxFraction = 2): string {
  return new Intl.NumberFormat(LOCALE_META[lang].htmlLang, {
    maximumFractionDigits: maxFraction,
  }).format(value);
}

/** 퍼센트 — 소수 자릿수를 고정해 47.0% 처럼 줄이 맞게 (승률표와 같은 표기) */
export function formatPercent(lang: Locale, value: number, fraction = 1): string {
  return `${new Intl.NumberFormat(LOCALE_META[lang].htmlLang, { minimumFractionDigits: fraction, maximumFractionDigits: fraction }).format(value)}%`;
}

export function formatDate(lang: Locale, iso: string): string {
  return new Intl.DateTimeFormat(LOCALE_META[lang].htmlLang, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(iso));
}

/** 아이템 효과 값 → '+12%', '+160', '+2 m/s' */
export function formatItemStatValue(lang: Locale, stat: ItemStat): string {
  const n = formatNumber(lang, stat.value);
  const sign = stat.value > 0 ? '+' : '';
  switch (stat.unit) {
    case '%':
      return `${sign}${n}%`;
    case 'flat':
      return `${sign}${n}`;
    default:
      return `${sign}${n} ${stat.unit}`;
  }
}
