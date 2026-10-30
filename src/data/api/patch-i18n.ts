/**
 * 패치노트 번역 — 공식 패치노트는 영어뿐이라 줄 단위 번역을 src/data/patch-i18n/{ko,zh}.json 에 두고 쓴다
 * (키 = 영어 원문 줄, 값 = 번역). 한 번 번역한 줄은 다시 번역하지 않고, 틀린 줄은 파일에서 고친다.
 *
 * 번역을 쓰기 전 자동 검사 — 하나라도 걸리면 그 줄은 영어 원문으로 둔다:
 *   1) 숫자: 원문과 번역의 숫자 목록이 같아야 한다 (34s → 38s 가 34초 → 36초 로 바뀌는 사고 방지)
 *   2) 공식 이름: 원문에 영웅·능력·아이템·NPC 이름이 있으면 번역에 그 언어의 공식 이름(API 현지화 값)이 그대로 있어야 한다
 * 번역이 없거나 검사에 걸린 줄은 .cache/patch-i18n/todo-{언어}.json 에 용어와 함께 적는다 → 이걸 보고 사전을 채운다.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Locale } from '../../i18n/locales';
import type { Hero, Item, PatchBlock, PatchLine, PatchNote, PatchSummary } from '../types';
import ko from '../patch-i18n/ko.json';
import zh from '../patch-i18n/zh.json';
import { warn } from './fetch';

const DICTS: Partial<Record<Locale, Record<string, string>>> = { ko, zh };
const TODO_DIR = path.join(process.cwd(), '.cache', 'patch-i18n');

/** 영어 공식 이름 → 언어별 공식 이름 */
export type Glossary = Map<string, Partial<Record<Locale, string>>>;

interface NamedLists {
  heroes: Record<Locale, Hero[]>;
  items: Record<Locale, Item[]>;
  npcs: Partial<Record<Locale, Array<{ class_name: string; name: string }>>>;
}

/** 영웅·능력·아이템·NPC 의 영어 이름 → 각 언어 이름. 세 글자 미만 이름은 다른 낱말과 헷갈려 뺀다 */
export function buildGlossary({ heroes, items, npcs }: NamedLists, locales: readonly Locale[]): Glossary {
  const glossary: Glossary = new Map();
  const add = (en: string | undefined, lang: Locale, name: string | undefined) => {
    if (!en || !name || en.length < 3) return;
    const entry = glossary.get(en) ?? {};
    entry[lang] ??= name;
    glossary.set(en, entry);
  };
  for (const lang of locales) {
    const heroBySlug = new Map(heroes[lang].map((h) => [h.slug, h]));
    for (const en of heroes.en) {
      const h = heroBySlug.get(en.slug);
      add(en.name, lang, h?.name);
      en.detail?.abilities.forEach((a, i) => add(a.name, lang, h?.detail?.abilities[i]?.name));
    }
    const itemBySlug = new Map(items[lang].map((i) => [i.slug, i.name]));
    for (const en of items.en) add(en.name, lang, itemBySlug.get(en.slug));
    const npcByClass = new Map((npcs[lang] ?? []).map((n) => [n.class_name, n.name]));
    for (const en of npcs.en ?? []) add(en.name, lang, npcByClass.get(en.class_name));
  }
  return glossary;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * 이름과 철자가 같지만 이름이 아닌 표현 — 검사에서 뺀다.
 * 'Improved Spirit Scaling'(마력 계수 향상 ≠ 아이템 Improved Spirit), '6s Unstoppable'(저지 불가 상태 ≠ 아이템 Unstoppable),
 * '+10% Bullet Lifesteal'(스탯 ≠ 같은 이름의 아이템 — 아이템 자체의 변경은 '- Bullet Lifesteal: …' 묶음 머리로 따로 온다)
 */
const NOT_TERMS = [/Improved Spirit Scaling/g, /\bUnstoppable\b/g, /\b(Bullet|Spirit|Melee) Lifesteal\b/g];

/** 문장 속 공식 이름 — 긴 이름 먼저 (Base Guardian 이 Guardian 으로 잘리지 않게), 겹치지 않게 */
function termsIn(text: string, glossary: Glossary): string[] {
  const found: string[] = [];
  let rest = NOT_TERMS.reduce((s, re) => s.replace(re, ' '), text);
  for (const en of [...glossary.keys()].sort((a, b) => b.length - a.length)) {
    const re = new RegExp(`(^|[^A-Za-z])${escape(en)}(?![A-Za-z])`);
    if (re.test(rest)) {
      found.push(en);
      rest = rest.replace(new RegExp(escape(en), 'g'), ' ');
    }
  }
  return found;
}

/** 번역 속에 영어 이름이 그대로 남아 있고 그 언어 공식 이름이 따로 있으면 공식 이름으로 바꾼다 (원문에 있는 이름만) */
function withOfficialNames(tr: string | undefined, terms: string[], glossary: Glossary, lang: Locale): string | undefined {
  if (!tr) return tr;
  let out = tr;
  for (const en of terms) {
    const local = glossary.get(en)?.[lang];
    if (local && local !== en && !out.includes(local) && out.includes(en)) out = out.split(en).join(local);
  }
  return out;
}

const numbers = (text: string) => (text.match(/\d+(?:\.\d+)?/g) ?? []).sort().join(',');

/** 언어별 번역 안 된 줄 수 — 마지막 flush 기준. /health.json 이 싣고, 매일 점검이 0 이 아니면 GitHub 이슈로 알린다 (2026-10-05) */
export const untranslatedCounts: Partial<Record<Locale, number>> = {};

export interface Translator {
  line(text: string): PatchLine;
  /** 번역이 없거나 검사에 걸린 줄을 기록 파일로 */
  flush(): Promise<void>;
}

export function translator(lang: Locale, glossary: Glossary): Translator {
  const dict = DICTS[lang];
  const todo = new Map<string, { terms: Record<string, string>; problem?: string }>();
  let failed = 0;
  return {
    line(text) {
      if (!dict) return { text };
      const terms = termsIn(text, glossary);
      // 번역할 때 공식 이름이 아직 영어였던 줄 (새 영웅 출시 직후 — 랫 킹 능력 이름) → 나중에 공식 이름이 생기면 영어 이름을 그 이름으로 바꿔 쓴다.
      // 안 그러면 '공식 이름 없음' 검사에 걸려 줄 전체가 영어로 돌아간다 (2026-10-07 랫 킹 10/5 패치 줄에서 겪음)
      const tr = withOfficialNames(dict[text], terms, glossary, lang);
      let problem: string | undefined;
      if (tr) {
        if (numbers(tr) !== numbers(text)) problem = `숫자 불일치 (${numbers(text)} ≠ ${numbers(tr)})`;
        else {
          const missing = terms.filter((en) => glossary.get(en)?.[lang] && !tr.includes(glossary.get(en)![lang]!));
          if (missing.length) problem = `공식 이름 없음: ${missing.map((en) => `${en} → ${glossary.get(en)![lang]}`).join(', ')}`;
        }
        if (!problem) return { text: tr, orig: text };
        failed++;
      }
      todo.set(text, { terms: Object.fromEntries(terms.map((en) => [en, glossary.get(en)?.[lang] ?? en])), ...(problem && { problem }) });
      return { text };
    },
    async flush() {
      if (!dict) return;
      if (failed) warn(`패치노트 ${lang} 번역 ${failed}줄이 검사에 걸려 원문으로 표시 — .cache/patch-i18n/todo-${lang}.json`);
      await mkdir(TODO_DIR, { recursive: true });
      const list = [...todo].map(([en, v]) => ({ en, ...v }));
      untranslatedCounts[lang] = list.length;
      await writeFile(path.join(TODO_DIR, `todo-${lang}.json`), JSON.stringify(list, null, 1));
    },
  };
}

const lines = (t: Translator, b: PatchBlock): PatchBlock =>
  b.type === 'group' ? { ...b, lines: b.lines.map((l) => ({ ...l, ...t.line(l.text) })) } : { ...b, ...t.line(b.text) };

export function translateNotes(notes: PatchNote[], t: Translator): PatchNote[] {
  return notes.map((n) => ({ ...n, sections: n.sections.map((s) => ({ ...s, blocks: s.blocks.map((b) => lines(t, b)) })) }));
}

/** 첫 페이지 패치 요약의 변경 줄도 같은 사전으로 */
export function translateSummary(patch: PatchSummary, t: Translator): PatchSummary {
  return { ...patch, changes: patch.changes.map((c) => ({ ...c, text: t.line(c.text).text })) };
}
