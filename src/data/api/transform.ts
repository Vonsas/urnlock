/**
 * API 응답(./raw) → 화면 타입(../types) 변환.
 * 매핑에 없는 값은 화면에 내지 않고 빌드 로그에 한 번씩 경고한다.
 */
import type { Locale } from '../../i18n/locales';
import { useTranslations } from '../../i18n';
import type {
  Ability,
  AbilityScale,
  AbilityScaleStat,
  AbilityStat,
  AbilityUpgrade,
  Hero,
  HeroBaseStats,
  HeroDetailData,
  HeroImages,
  HeroWeapon,
  Item,
  ItemCategory,
  ItemEffectSection,
  ItemEffectValue,
  ItemStat,
  ItemStatKey,
  ItemTier,
  RichText,
  PatchChange,
  PatchBlock,
  PatchLine,
  PatchNote,
  PatchSection,
  PatchSummary,
  ScalingStat,
} from '../types';
import type { RawHero, RawItem, RawPatch, RawPopularItem, RawProperty } from './raw';
import { warn } from './fetch';
import { isPatchPost } from './patch-posts';
import heroKo from '../hero-i18n/ko.json';
import heroZh from '../hero-i18n/zh.json';
import fs from 'node:fs';

/**
 * 새 영웅 임시 번역 (2026-10-10 사용자: 공식 번역이 나오기 전까지 우리가 번역해서 보여 주기 — 솔로몬부터).
 * 키 = 그 언어 API 가 지금 주는 문자열(아직 영어 그대로이거나 영어·한국어가 섞인 것), 값 = 우리 번역. 공식 번역이 들어오면 API 문자열이 바뀌어
 * 키가 안 맞으므로 자동으로 공식 번역이 쓰인다. 번역이 없는 영어 문자열은 `.cache/hero-i18n/todo-{lang}.json` 에 남는다 → 새 영웅이 나오면 그걸 번역해 사전에 추가.
 * 스킬 이름 · 설명 · 강화 문구 · 수치 이름 · 무기 이름 · 소개에 쓴다. 패치노트 용어집도 이 결과(번역된 스킬 이름)를 쓴다.
 */
const HERO_I18N: Partial<Record<Locale, Record<string, string>>> = { ko: heroKo as Record<string, string>, zh: heroZh as Record<string, string> };
const heroTodo: Partial<Record<Locale, Map<string, string>>> = {};
function tr(text: string, lang: Locale, where: string): string {
  if (!text || lang === 'en') return text;
  const hit = HERO_I18N[lang]?.[text];
  if (hit) return hit;
  // 영어 단어(네 글자 이상)가 남아 있으면 번역할 거리로 적어 둔다
  if (/[A-Za-z]{4,}/.test(text)) (heroTodo[lang] ??= new Map()).set(text, where);
  return text;
}
function writeHeroTodo(lang: Locale) {
  const todo = heroTodo[lang];
  if (!todo) return;
  try {
    fs.mkdirSync('.cache/hero-i18n', { recursive: true });
    fs.writeFileSync(`.cache/hero-i18n/todo-${lang}.json`, JSON.stringify(Object.fromEntries([...todo].map(([k, w]) => [k, `(${w})`])), null, 1));
  } catch {}
}

const warned = new Set<string>();
/** 같은 key 의 경고는 한 번만 (세 언어를 모두 변환하므로) */
function warnOnce(message: string, key = message): void {
  if (warned.has(key)) return;
  warned.add(key);
  warn(message);
}

/** 'Mo & Krill' → 'mo-krill', 'The Doorman' → 'the-doorman' (영어 이름 기준, 언어와 무관하게 같은 URL) */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, ' ')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'", '#039': "'" };

/** 게임 툴팁 HTML(인라인 SVG 아이콘, span 강조) → 평문 */
export function plainText(html: string | undefined): string {
  if (!html) return '';
  return html
    .replace(/<svg[\s\S]*?<\/svg>/gi, '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#?\w+);/g, (m, code: string) => ENTITIES[code] ?? m)
    .replace(/\s+/g, ' ')
    // 아이콘을 뺀 자리의 공백 — 중국어는 글자 사이를 띄우지 않는다
    .replace(/([　-鿿＀-￯]) (?=[　-鿿＀-￯])/g, '$1')
    .trim();
}

const num = (v: number | string | undefined): number => {
  const n = typeof v === 'number' ? v : Number.parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : 0;
};
const round = (n: number, digits = 2) => Math.round(n * 10 ** digits) / 10 ** digits;
const positive = (n: number) => (n > 0 ? n : undefined);

/** 게임 단위(인치) → 미터 */
const toMeters = (units: number | undefined) => Math.round(num(units) / 39.37);

// ─── 영웅 ────────────────────────────────────────────────────────────

function toComplexity(hero: RawHero): 1 | 2 | 3 {
  const c = Math.round(num(hero.complexity));
  if (c >= 1 && c <= 3) return c as 1 | 2 | 3;
  warnOnce(`영웅 ${hero.class_name}: complexity ${hero.complexity} → 1–3 범위로 맞춤`);
  return c < 1 ? 1 : 3;
}

/** 레벨 1 을 뺀 모든 레벨이 부운을 준다 (2026-09 기준 36레벨, 부운 35개) */
function maxBoons(hero: RawHero): number {
  const boons = Object.values(hero.level_info ?? {}).filter((l) => l.use_standard_upgrade).length;
  if (!boons) warnOnce(`영웅 ${hero.class_name}: level_info 가 없어 최대 레벨 수치를 계산할 수 없음`, 'maxBoons');
  return boons;
}

function stats(hero: RawHero): HeroBaseStats {
  const s = (key: string) => num(hero.starting_stats[key]?.value);
  const lv = (key: string) => positive(round(num(hero.standard_level_up_upgrades?.[`MODIFIER_VALUE_${key}`])));
  const stat = (base: number, perBoon?: number): ScalingStat => (perBoon ? { base: round(base), perBoon } : { base: round(base) });
  const light = s('light_melee_damage');
  const heavy = s('heavy_melee_damage');
  const meleePerBoon = num(hero.standard_level_up_upgrades?.MODIFIER_VALUE_BASE_MELEE_DAMAGE_FROM_LEVEL);
  return {
    spiritPower: stat(0, lv('TECH_POWER')),
    health: stat(s('max_health'), lv('BASE_HEALTH_FROM_LEVEL')),
    healthRegen: stat(s('base_health_regen')),
    moveSpeed: stat(s('max_move_speed')),
    sprintSpeed: stat(s('sprint_speed')),
    stamina: stat(s('stamina')),
    bulletResist: stat(0, lv('BULLET_ARMOR_DAMAGE_RESIST')),
    spiritResist: stat(0, lv('TECH_RESIST')),
    // 근접 피해는 약·강 공통 계수로 오른다 — 강한 근접은 기본값 비율만큼
    lightMelee: stat(light, positive(round(meleePerBoon))),
    heavyMelee: stat(heavy, light > 0 ? positive(round((meleePerBoon * heavy) / light)) : undefined),
  };
}

function weapon(hero: RawHero, item: RawItem, lang: Locale): HeroWeapon {
  const w = item.weapon_info ?? {};
  // 일부 무기는 이름이 번역되지 않아 class_name 이 그대로 온다 → 무기 유형(gun_tag)으로 대신
  const hasName = item.name && item.name !== item.class_name;
  const pellets = Math.max(1, num(w.bullets));
  return {
    name: hasName ? tr(item.name, lang, `${hero.class_name} 무기`) : (hero.gun_tag ?? useTranslations(lang).heroes.weapon),
    traits: hasName && hero.gun_tag ? [hero.gun_tag] : [],
    bulletDamage: {
      base: round(num(w.bullet_damage)),
      perBoon: positive(round(num(hero.standard_level_up_upgrades?.MODIFIER_VALUE_BASE_BULLET_DAMAGE_FROM_LEVEL))),
    },
    pellets,
    fireRate: round(num(w.bullets_per_second) / pellets),
    dps: Math.round(num(w.damage_per_second)),
    ammo: num(w.clip_size),
    reloadTime: round(num(w.reload_duration)),
    falloffRange: [toMeters(w.damage_falloff_start_range), toMeters(w.damage_falloff_end_range)],
    bulletVelocity: toMeters(w.bullet_speed),
  };
}

const UPGRADE_COST = [1, 2, 5] as const;

/** 강화 설명이 없는 단계는 수치 변경(property_upgrades)으로 문구를 만든다: '쿨다운 -20초' */
function upgradeText(item: RawItem, tier: number, heroName: string, lang: Locale): string {
  const desc = plainText(item.description?.[`t${tier}_desc`]);
  if (desc) return tr(desc.replaceAll('{s:hero_name}', heroName), lang, `${item.class_name} 강화 ${tier}`);
  const parts = (item.upgrades?.[tier - 1]?.property_upgrades ?? [])
    .filter((u) => !u.upgrade_type)
    .map((u) => {
      const prop: RawProperty = item.properties?.[u.name] ?? {};
      const value = num(u.bonus);
      if (!prop.label || !value) return '';
      return `${tr(prop.label, lang, `${item.class_name} 수치 이름`)} ${value > 0 ? '+' : ''}${round(value)}${prop.postfix ?? ''}`;
    })
    .filter(Boolean);
  return parts.join(', ');
}

/** 마법 피해·치유 계산식은 대상 스탯이 비어 있어도 마력에 비례한다 */
const SPIRIT_SCALE_FUNCTIONS = ['scale_function_tech_damage', 'scale_function_healing_spirit_scale'];
const SCALE_STATS: Record<string, AbilityScaleStat> = {
  ETechPower: 'spiritPower',
  ELevelUpBoons: 'boons',
  EWeaponPower: 'weaponDamage',
  EBaseWeaponDamageIncrease: 'weaponDamage',
  ELightMeleeDamage: 'lightMelee',
};

function scaleStat(statType: string | undefined, fn: string | undefined): AbilityScaleStat | undefined {
  if (statType) return SCALE_STATS[statType];
  return fn && SPIRIT_SCALE_FUNCTIONS.includes(fn) ? 'spiritPower' : undefined;
}

function toScale(prop: RawProperty): AbilityScale | undefined {
  const sf = prop.scale_function;
  const factor = round(num(sf?.stat_scale));
  const stat = scaleStat(sf?.specific_stat_scale_type, sf?.class_name);
  return factor && stat ? { stat, factor } : undefined;
}

/** 카드 머리(재사용 대기·지속·충전)에 이미 나오는 속성. 사거리로 쓴 속성은 따로 넘긴다 */
const HEADER_PROPS = ['AbilityCooldown', 'AbilityDuration', 'AbilityCharges', 'AbilityCastRange'];

/**
 * 게임 툴팁이 강조하는 수치(important_property) + 기본 속성(basic_properties), 게임과 같은 순서.
 * 상태 효과(기절 등)는 지속 시간 속성으로, 강화해야 생기는 수치는 뺀다.
 */
function abilityStats(item: RawItem, rangeKey: string | undefined, lang: Locale): AbilityStat[] {
  const keys: string[] = [];
  for (const section of item.tooltip_details?.info_sections ?? []) {
    for (const block of section.properties_block ?? []) {
      for (const prop of block.properties ?? []) {
        if (prop.requires_ability_upgrade) continue;
        const key = prop.important_property?.startsWith('StatusEffect') ? prop.status_effect_value : prop.important_property;
        if (key) keys.push(key);
      }
    }
    keys.push(...(section.basic_properties ?? []));
  }
  keys.push(...(item.tooltip_details?.additional_header_properties ?? []));

  const out: AbilityStat[] = [];
  for (const key of new Set(keys)) {
    if (HEADER_PROPS.includes(key) || key === rangeKey) continue;
    const prop = item.properties?.[key];
    const value = round(num(prop?.value));
    if (!prop?.label || !value) continue;
    out.push({ label: tr(prop.label, lang, `${item.class_name} 수치 이름`), value, unit: prop.postfix?.trim() ?? '', scale: toScale(prop) });
  }
  return out;
}

/** 계수를 올리는 강화 (upgrade_type 'EAddToScale') */
function scaleBonus(item: RawItem, tier: number, lang: Locale): AbilityUpgrade['scaleBonus'] {
  const bonus = (item.upgrades?.[tier - 1]?.property_upgrades ?? []).flatMap((u) => {
    if (u.upgrade_type !== 'EAddToScale') return [];
    const prop = item.properties?.[u.name];
    const stat = scaleStat(u.scale_stat_filter, prop?.scale_function?.class_name);
    const factor = round(num(u.bonus));
    return prop?.label && stat && factor ? [{ label: tr(prop.label, lang, `${item.class_name} 수치 이름`), stat, factor }] : [];
  });
  return bonus.length ? bonus : undefined;
}

function ability(item: RawItem, slot: 1 | 2 | 3 | 4, heroName: string, lang: Locale): Ability {
  const p = (key: string) => num(item.properties?.[key]?.value);
  const cooldown = positive(p('AbilityCooldown'));
  const charges = p('AbilityCharges');
  const rangeKey = ['AbilityCastRange', 'Radius'].find((k) => p(k) > 0);
  return {
    id: item.id,
    slot,
    name: tr(item.name, lang, `${item.class_name} 이름`),
    image: item.image_webp || item.image || undefined,
    // 재사용 대기가 없는 능력은 게임에서도 패시브다 (행동 목록만으로는 구분되지 않음)
    kind: cooldown ? 'active' : 'passive',
    cooldown,
    charges: charges > 1 ? charges : undefined,
    duration: positive(p('AbilityDuration')),
    range: rangeKey ? p(rangeKey) : undefined,
    stats: abilityStats(item, rangeKey, lang),
    // 설명이 desc 대신 passive 에만 오는 능력이 있다 (쉬브 결정타 · 드리프터 혈향 · 바이올렛 살아 있는 잉크 — 2026-10-17 까지 빈칸이었다). 둘 다 있으면 이어 붙인다
    description: tr(
      plainText([item.description?.desc, item.description?.passive].filter(Boolean).join('<br><br>')).replaceAll('{s:hero_name}', heroName),
      lang,
      `${item.class_name} 설명`,
    ),
    upgrades: UPGRADE_COST.map(
      (cost, i): AbilityUpgrade => ({ cost, text: upgradeText(item, i + 1, heroName, lang), scaleBonus: scaleBonus(item, i + 1, lang) }),
    ) as Ability['upgrades'],
  };
}

function heroImages(hero: RawHero): HeroImages | undefined {
  const i = hero.images ?? {};
  const card = i.icon_hero_card_webp || i.icon_hero_card;
  const small = i.icon_image_small_webp || i.icon_image_small;
  const name = i.name_image || undefined;
  return card || small ? { card, small, name } : undefined;
}

/** 게임 안 '인기 아이템' — 구간별 구매율 순 */
function popularItems(h: RawHero): HeroDetailData['popular'] {
  const p = h.popular_items;
  if (!p?.timestamp) return undefined;
  const list = (rows: RawPopularItem[] | undefined) =>
    (rows ?? []).map((r) => ({ itemId: r.item_id, pickRate: r.pick_pct, winRate: r.winrate_pct })).sort((a, b) => b.pickRate - a.pickRate);
  return { updatedAt: p.timestamp, early: list(p.early_game), mid: list(p.mid_game), late: list(p.late_game) };
}

/**
 * @param enHeroes 같은 영웅의 영어 응답 — URL slug 를 언어와 무관하게 영어 이름으로 만든다
 */
export function toHeroes(raw: RawHero[], items: RawItem[], enHeroes: RawHero[], lang: Locale): Hero[] {
  const byClass = new Map(items.map((i) => [i.class_name, i]));
  const enName = new Map(enHeroes.map((h) => [h.id, h.name]));

  const heroes = raw
    .map((h): Hero => {
      const s = stats(h);
      const weaponItem = byClass.get(h.items.weapon_primary);
      const abilityItems = ([1, 2, 3, 4] as const).map((n) => byClass.get(h.items[`signature${n}`]));
      const w = weaponItem && weapon(h, weaponItem, lang);

      let detail: HeroDetailData | undefined;
      if (w && abilityItems.every(Boolean)) {
        detail = {
          lore: tr(plainText(h.description?.playstyle || h.description?.role), lang, `${h.class_name} 소개`),
          maxBoons: maxBoons(h),
          stats: s,
          weapon: w,
          abilities: abilityItems.map((a, i) => ability(a!, (i + 1) as 1 | 2 | 3 | 4, h.name, lang)) as HeroDetailData['abilities'],
          popular: popularItems(h),
        };
      } else {
        warnOnce(`영웅 ${h.class_name}: 무기·능력 항목을 찾지 못해 상세 없이 표시`);
      }

      return {
        slug: slugify(enName.get(h.id) ?? h.class_name.replace(/^hero_/, '')),
        id: h.id,
        name: h.name,
        image: heroImages(h),
        complexity: toComplexity(h),
        health: s.health.base,
        weaponDps: w?.dps ?? 0,
        moveSpeed: s.moveSpeed.base,
        hasDetail: Boolean(detail),
        detail,
      };
    })
    .sort((a, b) => a.slug.localeCompare(b.slug));
  writeHeroTodo(lang);
  return heroes;
}

// ─── 아이템 ──────────────────────────────────────────────────────────

const CATEGORIES: readonly ItemCategory[] = ['weapon', 'vitality', 'spirit'];

/**
 * 아이템 기본 효과(tooltip 의 innate 구역) 속성 이름 → 화면 스탯 키.
 * 속성 이름으로 매핑하는 이유: provided_property_type 은 '충전 능력 전용 마력' 같은 조건부 효과도
 * 일반 마력(MODIFIER_VALUE_TECH_POWER)으로 보고한다.
 */
const ITEM_STATS: Record<string, { key: ItemStatKey; unit: ItemStat['unit'] }> = {
  BaseAttackDamagePercent: { key: 'weaponDamage', unit: '%' },
  BonusFireRate: { key: 'fireRate', unit: '%' },
  BonusClipSizePercent: { key: 'ammo', unit: '%' },
  BulletLifestealPercent: { key: 'bulletLifesteal', unit: '%' },
  BulletResist: { key: 'bulletResist', unit: '%' },
  BonusBulletSpeedPercent: { key: 'bulletVelocity', unit: '%' },
  BonusMeleeDamagePercent: { key: 'meleeDamage', unit: '%' },
  MeleeResistPercent: { key: 'meleeResist', unit: '%' },
  BonusHealth: { key: 'bonusHealth', unit: 'flat' },
  BonusHealthRegen: { key: 'healthRegen', unit: 'flat' },
  OutOfCombatHealthRegen: { key: 'outOfCombatRegen', unit: 'flat' },
  BonusMoveSpeed: { key: 'moveSpeed', unit: 'm/s' },
  BonusSprintSpeed: { key: 'sprintSpeed', unit: 'm/s' },
  Stamina: { key: 'stamina', unit: 'flat' },
  StaminaCooldownReduction: { key: 'staminaRecovery', unit: '%' },
  StatusResistancePercent: { key: 'debuffResist', unit: '%' },
  InnateStatusResistancePercent: { key: 'debuffResist', unit: '%' },
  TechPower: { key: 'spiritPower', unit: 'flat' },
  SpiritPower: { key: 'spiritPower', unit: 'flat' },
  SpiritPowerInnate: { key: 'spiritPower', unit: 'flat' },
  TechResist: { key: 'spiritResist', unit: '%' },
  AbilityLifestealPercentHero: { key: 'spiritLifesteal', unit: '%' },
  AbilityLifestealPercentHeroPassive: { key: 'spiritLifesteal', unit: '%' },
  CooldownReduction: { key: 'cooldownReduction', unit: '%' },
  BonusAbilityCharges: { key: 'abilityCharges', unit: 'flat' },
  TechRangeMultiplier: { key: 'abilityRange', unit: '%' },
  BonusAbilityDurationPercent: { key: 'abilityDuration', unit: '%' },
};

function itemStats(item: RawItem): ItemStat[] {
  const names = new Set<string>();
  for (const section of item.tooltip_sections ?? []) {
    if (section.section_type !== 'innate') continue;
    for (const attr of section.section_attributes ?? []) {
      for (const n of [...(attr.elevated_properties ?? []), ...(attr.properties ?? [])]) names.add(n);
    }
  }
  const out: ItemStat[] = [];
  for (const n of names) {
    const value = round(num(item.properties?.[n]?.value));
    if (!value) continue;
    const map = ITEM_STATS[n];
    if (!map) {
      warnOnce(`아이템 효과 '${n}' (${item.properties?.[n]?.label ?? '?'}) 매핑 없음 — 표시 안 함`, `stat:${n}`);
      continue;
    }
    if (!out.some((s) => s.key === map.key)) out.push({ key: map.key, value, unit: map.unit });
  }
  return out;
}

// ─── 아이템 툴팁 ─────────────────────────────────────────────────────

/** 툴팁 설명 HTML → 조각 목록. 강조(highlight·속성 이름)와 흐린 글씨(diminish), 줄바꿈만 살리고 나머지 태그는 버린다 */
export function richText(html: string | undefined): RichText[] | undefined {
  if (!html) return undefined;
  const decode = (raw: string) =>
    raw
      .replace(/<[^>]+>/g, '')
      .replace(/&(#?\w+);/g, (m, code: string) => ENTITIES[code] ?? m)
      .replace(/[ \t\r\f\v]+/g, ' ');
  const out: RichText[] = [];
  const push = (text: string, style?: RichText['style']) => {
    if (!text) return;
    const prev = out.at(-1);
    if (prev && prev.style === style) prev.text += text;
    else out.push(style ? { text, style } : { text });
  };
  const lines = html.replace(/<svg[\s\S]*?<\/svg>/gi, '').split(/<br\s*\/?>/i);
  lines.forEach((line, n) => {
    if (n > 0) push('\n');
    const re = /<span class="([^"]*)">([\s\S]*?)<\/span>/g;
    let last = 0;
    for (let m = re.exec(line); m; m = re.exec(line)) {
      push(decode(line.slice(last, m.index)));
      const cls = m[1];
      push(decode(m[2]), cls.includes('diminish') ? 'dim' : cls.includes('highlight') || cls.includes('attribute-label') ? 'highlight' : undefined);
      last = m.index + m[0].length;
    }
    push(decode(line.slice(last)));
  });
  // 줄 앞뒤 공백 정리, 아이콘을 뺀 자리의 중국어 글자 사이 공백 제거
  for (const seg of out) seg.text = seg.text.replace(/ *\n */g, '\n').replace(/([\u3000-\u9fff\uff00-\uffef]) (?=[\u3000-\u9fff\uff00-\uffef])/g, '$1');
  if (out[0]) out[0].text = out[0].text.trimStart();
  if (out.at(-1)) out.at(-1)!.text = out.at(-1)!.text.trimEnd();
  const kept = out.filter((seg) => seg.text);
  return kept.length ? kept : undefined;
}

/** css_class → 수치 색. 게임 툴팁처럼 총탄=주황, 영혼=보라, 체력·회복=초록 */
function toneOf(css: string | undefined): ItemEffectValue['tone'] {
  if (!css) return 'neutral';
  if (/tech|spirit/.test(css)) return 'spirit';
  if (/bullet|fire_rate|clipsize|reload|melee/.test(css)) return 'weapon';
  if (/heal|health|regen|barrier/.test(css)) return 'vitality';
  return 'neutral';
}

/** 마력·부운 계수. 쿨다운·지속시간·범위 증가 아이템의 영향(EItemCooldown 등)은 계수로 보지 않는다 */
function scaleOf(prop: RawProperty): ItemEffectValue['scale'] {
  const sf = prop.scale_function;
  const amount = round(num(sf?.stat_scale), 3);
  if (!sf || !(amount > 0)) return undefined;
  const cls = sf.class_name ?? '';
  if (sf.specific_stat_scale_type === 'ETechPower' || /tech_damage|spirit_scale|tech_power/.test(cls)) return { kind: 'spirit', amount };
  if (sf.specific_stat_scale_type === 'ELevelUpBoons' || /boon_scale/.test(cls)) return { kind: 'boon', amount };
  return undefined;
}

function effectValue(item: RawItem, key: string, signed: boolean): ItemEffectValue | null {
  const prop = item.properties?.[key];
  if (!prop || !prop.label || prop.value === undefined || prop.value === '') return null;
  const n = Number.parseFloat(String(prop.value));
  if (Number.isFinite(n) && n === 0) return null;
  let value = String(prop.value).trim();
  // 값에 단위가 이미 붙어 오는 경우가 있다 ('30m' + 'm')
  if (prop.postfix && !value.endsWith(prop.postfix)) value += prop.postfix;
  // 속도는 게임 툴팁처럼 m/s ('질주 속도 +1m' → '+1m/s')
  if (/move_?speed|movement_speed/.test(prop.css_class ?? '') && value.endsWith('m')) value += '/s';
  if (signed && n > 0 && !value.startsWith('+')) value = `+${value}`;
  const flags = Array.isArray(prop.usage_flags) ? prop.usage_flags : prop.usage_flags ? [prop.usage_flags] : [];
  const out: ItemEffectValue = { label: prop.label, value, tone: toneOf(prop.css_class) };
  if (prop.negative_attribute) out.negative = true;
  // 이름에 이미 조건이 들어 있으면 ('비영웅 대상 무기 피해') 다시 적지 않는다
  if (typeof prop.conditional === 'string' && prop.conditional && !prop.label.includes(prop.conditional)) out.condition = prop.conditional;
  if (flags.includes('ConditionallyApplied')) out.whileActive = true;
  const scale = scaleOf(prop);
  if (scale) out.scale = scale;
  return out;
}

/** 게임 툴팁 구성 그대로: 구역(기본 효과·패시브·액티브) → 설명 + 핵심 수치 + 나머지 수치 */
function itemEffects(item: RawItem): ItemEffectSection[] {
  const sections: ItemEffectSection[] = [];
  for (const raw of item.tooltip_sections ?? []) {
    const kind = (['innate', 'passive', 'active'] as const).find((k) => k === raw.section_type) ?? 'passive';
    const section: ItemEffectSection = { kind, blocks: [] };
    for (const attr of raw.section_attributes ?? []) {
      const seen = new Set<string>();
      const pick = (keys: string[] | undefined) =>
        (keys ?? []).flatMap((k) => {
          if (seen.has(k)) return [];
          seen.add(k);
          // 재사용 대기는 구역 머리에 따로 적는다
          if (k === 'AbilityCooldown' && kind !== 'innate') {
            const cd = num(item.properties?.[k]?.value);
            if (cd > 0) section.cooldown = cd;
            return [];
          }
          const v = effectValue(item, k, kind === 'innate');
          return v ? [v] : [];
        });
      const key = pick([...(attr.important_properties ?? []), ...(attr.important_properties_with_icon ?? [])]);
      const values = pick([...(attr.elevated_properties ?? []), ...(attr.properties ?? [])]);
      const description = richText(attr.loc_string);
      if (description || key.length || values.length) section.blocks.push({ ...(description && { description }), key, values });
    }
    if (section.blocks.length || section.cooldown) sections.push(section);
  }
  return sections;
}

/**
 * 상점 아이템 = type 'upgrade' + shopable, 티어 1–4.
 * 티어 5 는 가격이 9999 인 특수 아이템이라 상점 목록에서 뺀다.
 */
export function toItems(raw: RawItem[], enItems: RawItem[]): Item[] {
  const enName = new Map(enItems.map((i) => [i.class_name, i.name]));
  const shop = raw.filter((i) => i.type === 'upgrade' && i.shopable);

  const skipped = shop.filter((i) => !(num(i.item_tier) >= 1 && num(i.item_tier) <= 4));
  if (skipped.length) warnOnce(`티어 1–4 가 아닌 상점 아이템 ${skipped.length}개 제외 (티어 5, 가격 9999)`);

  const slugOf = (i: RawItem) => slugify(enName.get(i.class_name) ?? i.class_name.replace(/^upgrade_/, ''));
  const classToSlug = new Map(shop.map((i) => [i.class_name, slugOf(i)]));

  const items = shop
    .filter((i) => !skipped.includes(i))
    .flatMap((i): Item[] => {
      const category = i.item_slot_type as ItemCategory;
      if (!CATEGORIES.includes(category)) {
        warnOnce(`아이템 ${i.class_name}: 분류 '${i.item_slot_type}' 를 알 수 없어 제외`);
        return [];
      }
      return [
        {
          slug: slugOf(i),
          id: i.id,
          name: i.name,
          // 상점 그림이 기본, 없으면 흰색 아이콘
          image: i.shop_image_webp || i.shop_image || i.image_webp || i.image || undefined,
          description: plainText(i.description?.desc) || undefined,
          category,
          tier: num(i.item_tier) as ItemTier,
          cost: num(i.cost),
          isActive: Boolean(i.is_active_item),
          stats: itemStats(i),
          effects: itemEffects(i),
          components: (i.component_items ?? []).flatMap((c) => classToSlug.get(c) ?? []),
        },
      ];
    })
    .sort((a, b) => a.tier - b.tier || a.slug.localeCompare(b.slug));

  // 하위 아이템의 반대 방향 — 이 아이템을 재료로 쓰는 상위 아이템
  for (const item of items) {
    const parents = items.filter((p) => p.components?.includes(item.slug)).map((p) => p.slug);
    if (parents.length) item.upgradesTo = parents;
  }
  return items;
}

// ─── 패치 ────────────────────────────────────────────────────────────

const CHANGE_LIMIT = { hero: 3, item: 2, total: 5 };

/** 'Minor Update - 09-16-2026' → '2026-09-16' (제목에 날짜가 없으면 게시일) */
function patchDate(p: RawPatch): string {
  const m = p.title.match(/(\d{2})-(\d{2})-(\d{4})/);
  return m ? `${m[3]}-${m[1]}-${m[2]}` : p.pub_date.slice(0, 10);
}

/** 패치노트 본문 HTML → '- 대상: 내용' 줄 목록 */
function changeLines(html: string): Array<{ target: string; text: string }> {
  return html
    .replace(/<br\s*\/?>|<\/(p|li|div|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#?\w+);/g, (m, code: string) => ENTITIES[code] ?? m)
    .split('\n')
    .map((line) => line.trim().match(/^-\s*([^:]{2,40}):\s*(.+)$/))
    .filter((m): m is RegExpMatchArray => Boolean(m))
    .map((m) => ({ target: m[1].trim(), text: m[2].trim() }));
}

/**
 * 가장 최근 Steam 패치노트(전문이 들어 있음)에서 영웅·아이템 변경 몇 줄을 뽑는다.
 * 패치노트는 영어로만 제공되므로 대상 이름만 현재 언어로 바꾸고 내용은 원문 그대로 둔다.
 * 상향/하향은 문장만으로 판단할 수 없어 모두 'change' 로 둔다.
 */
export function toPatch(raw: RawPatch[], heroes: Hero[], enHeroes: Hero[], items: Item[], enItems: Item[]): PatchSummary | null {
  // Steam 쪽 글은 모두 패치 공지 — 제목에 'Update' 가 없는 대형 패치도 있다 ('City Never Sleeps')
  const latest = raw.filter(isPatchPost).sort((a, b) => b.pub_date.localeCompare(a.pub_date))[0];
  if (!latest) return null;

  const localName = (list: { slug: string; name: string }[], enList: { slug: string; name: string }[]) => {
    const bySlug = new Map(list.map((x) => [x.slug, x.name]));
    return new Map(enList.map((x) => [x.name.toLowerCase(), bySlug.get(x.slug) ?? x.name]));
  };
  const heroName = localName(heroes, enHeroes);
  const itemName = localName(items, enItems);

  const heroChanges: PatchChange[] = [];
  const itemChanges: PatchChange[] = [];
  for (const { target, text } of changeLines(latest.content)) {
    const key = target.toLowerCase();
    if (heroName.has(key)) heroChanges.push({ kind: 'change', target: heroName.get(key)!, text });
    else if (itemName.has(key)) itemChanges.push({ kind: 'change', target: itemName.get(key)!, text });
  }
  const picked = [...heroChanges.slice(0, CHANGE_LIMIT.hero), ...itemChanges.slice(0, CHANGE_LIMIT.item)];
  const rest = [...heroChanges.slice(CHANGE_LIMIT.hero), ...itemChanges.slice(CHANGE_LIMIT.item)];
  const changes = [...picked, ...rest].slice(0, CHANGE_LIMIT.total);

  const date = patchDate(latest);
  // 대형 패치는 항목별 변경 없이 공지로만 나오기도 한다 → 화면이 제목과 공식 링크를 대신 보여준다
  return { version: date.replaceAll('-', '.'), date, title: latest.title.trim(), url: latest.link, changes };
}

/** 패치노트 HTML → 평문 줄 (태그를 지우고 문단·줄바꿈만 남긴다. 외부 HTML 을 그대로 넣지 않기 위해) */
function noteLines(html: string): string[] {
  return html
    .replace(/<br\s*\/?>|<\/(p|li|div|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#?\w+);/g, (m, code: string) => ENTITIES[code] ?? m)
    .split('\n')
    // 원문은 구역 머리를 '\[ General ]' 처럼 역슬래시로 감싼다
    .map((line) => line.replace(/\\\[/g, '[').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

/** 공지형 글의 줄 — noteLines 와 같은 글자에 Steam 이 쓴 구조만 더한다: 앞에 가로줄(<hr> 또는 대시만 있는 줄 '------')이 있는지, 줄 전체가 굵은 글씨 · bb_h 머리인지, <li> 인지 (2026-11-06 사용자: 공지는 Steam 처럼 필요한 곳만 줄로) */
function noticeLines(html: string): Array<{ text: string; head: boolean; bold: boolean; li: boolean; rule: boolean }> {
  const out: Array<{ text: string; head: boolean; bold: boolean; li: boolean; rule: boolean }> = [];
  let rule = false;
  const pieces = html
    .replace(/<hr\b[^>]*>(?:<\/hr>)?/gi, '\n<hr>\n')
    .replace(/<br\s*\/?>|<\/(p|li|div|h\d)>/gi, '\n')
    .split('\n');
  for (const piece of pieces) {
    if (piece.trim() === '<hr>') {
      rule = true;
      continue;
    }
    // 줄 앞의 목록 · 문단 태그는 판정에서 뺀다. 닫는 태그도 — </ul> 뒤에서 줄이 안 바뀌어 다음 줄이 '</ul><b>제목</b>' 으로 온다
    const inner = piece.replace(/^(?:\s*<\/?(?:p|ul|ol|li)\b[^>]*>)+/i, '').trim();
    const head = /^<div[^>]*\bbb_h\d\b/i.test(inner);
    const bold = /^(?:<div[^>]*>)?<(b|strong)>(?:(?!<\/?\1>).)*<\/\1>$/i.test(inner);
    const li = /^(?:\s*<\/?(?:ul|ol)\b[^>]*>)*\s*<li\b/i.test(piece);
    const text = piece
      .replace(/<[^>]+>/g, '')
      .replace(/&(#?\w+);/g, (m, code: string) => ENTITIES[code] ?? m)
      .replace(/\\\[/g, '[')
      .replace(/\s+/g, ' ')
      .trim();
    if (!text) continue;
    // 대시만 있는 줄('------')은 글로 쓴 가로줄 — 번역할 글이 아니다 (2026-11-06 랭크 공지가 API 에 들어오며 번역 대상으로 잡혔다)
    if (/^-{3,}$/.test(text)) {
      rule = true;
      continue;
    }
    out.push({ text, head, bold, li, rule });
    rule = false;
  }
  return out;
}

/**
 * 공식 패치노트 전체 (Steam 쪽 글, 최신순). 포럼 글은 같은 패치의 Steam 링크뿐이라 뺀다.
 *
 * - 변경 목록 패치('- 대상: 내용' 줄이 대부분): 영웅 · 아이템 · 일반 · (기타 머리) 구역으로 나눈다. '[ Heroes ]' 같은 머리가 없는 패치도
 *   많아서, 대상이 영웅·아이템 이름이면 머리와 상관없이 그 구역에 대상별로 묶는다. 나머지 줄은 머리 구역(없으면 일반)에.
 * - 공지형 패치(문단 위주, 'City Never Sleeps'): 문단과 목록을 원래 순서대로.
 * 문장은 원문(영어) 그대로 — 상향/하향은 문장만으로 판단할 수 없어 표시하지 않는다.
 */
export function toPatchNotes(raw: RawPatch[], heroes: Hero[], enHeroes: Hero[], items: Item[], enItems: Item[]): PatchNote[] {
  // 원문은 'The Doorman' 을 'Doorman' 으로, 'Mo & Krill' 을 'Mo and Krill' 로 쓰기도 해서 이름을 느슨하게 맞춘다
  const norm = (name: string) =>
    name
      .toLowerCase()
      .replace(/^the\s+/, '')
      .replace(/&/g, 'and')
      .replace(/[^a-z0-9]+/g, '');
  const lookup = (list: { slug: string; name: string }[], enList: { slug: string; name: string }[]) => {
    const bySlug = new Map(list.map((x) => [x.slug, x.name]));
    const map = new Map(enList.map((x) => [norm(x.name), { slug: x.slug, name: bySlug.get(x.slug) ?? x.name }]));
    return { get: (name: string) => map.get(norm(name)) };
  };
  const heroBy = lookup(heroes, enHeroes);
  const itemBy = lookup(items, enItems);
  // 원문이 새 영웅을 이름 한 단어로만 쓰기도 한다 ('Nurse: …' = Nurse Harrow, 2026-10-30 패치) → 한 영웅에만 있는 단어면 그 영웅으로 (아이템 이름이 먼저)
  const heroWords = new Map<string, Hero | null>();
  for (const h of enHeroes)
    for (const w of h.name.toLowerCase().split(/[^a-z0-9]+/).filter((x) => x.length > 2 && x !== 'the' && x !== 'and'))
      heroWords.set(w, heroWords.has(w) ? null : h);
  const heroByWord = (name: string) => {
    const h = heroWords.get(norm(name));
    return h ? heroBy.get(h.name) : undefined;
  };
  // 영웅 줄이 어느 능력 얘기인지 — 원문(영어) 속 능력 영어 이름 중 가장 앞에 나온 것. 이름이 바뀐 옛 능력은 못 찾아 기본 줄로 남는다
  const escapeRe = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const abilityRe = (name: string) => new RegExp(`(^|[^a-z])${escapeRe(name.toLowerCase())}($|[^a-z])`);
  const enAbilities = new Map(
    enHeroes.map((h) => [h.slug, (h.detail?.abilities ?? []).filter((a) => a.name).map((a) => ({ slot: a.slot, name: a.name, re: abilityRe(a.name) }))]),
  );
  const localAbilities = new Map(heroes.map((h) => [h.slug, h.detail?.abilities ?? []]));
  const abilityOf = (slug: string, text: string): PatchLine['ability'] => {
    const lower = text.toLowerCase();
    let best: { slot: 1 | 2 | 3 | 4; at: number } | undefined;
    for (const a of enAbilities.get(slug) ?? []) {
      const m = a.re.exec(lower);
      if (m && (!best || m.index < best.at)) best = { slot: a.slot, at: m.index };
    }
    return best?.slot;
  };
  const seen = new Map<string, number>();

  return raw
    .filter(isPatchPost)
    .sort((a, b) => b.pub_date.localeCompare(a.pub_date))
    .map((p) => {
      const lines = noteLines(p.content);
      // 구역 머리: '[ General ]', 또는 굵은 글씨 'General:' (2026-10-30 패치부터 — 'Heroes:' 같은 머리가 있는 글에서만. 공지형 글의 'Primary details:' 는 머리가 아니다)
      const colonHeads = lines.some((l) => /^(General|Items|Heroes):$/.test(l));
      const headOf = (l: string) => l.match(/^\[\s*(.+?)\s*\]$/)?.[1] ?? (colonHeads ? l.match(/^([A-Z][A-Za-z &]{1,24}):$/)?.[1] : undefined);
      const isHead = (l: string) => headOf(l) !== undefined;
      const bullets = lines.filter((l) => l.startsWith('-')).length;
      const listMode = lines.some(isHead) || bullets >= lines.length * 0.7;

      const heroSlugs = new Set<string>();
      const itemSlugs = new Set<string>();
      let sections: PatchSection[];

      if (!listMode) {
        const intro: PatchSection = { key: 'intro', blocks: [] };
        let ruleNext = false;
        for (const { text: l, head, bold, li: inList, rule } of noticeLines(p.content)) {
          ruleNext ||= rule;
          if (l === '-') continue;
          const b = l.match(/^-\s*(.+)$/);
          // 소문자 없이 짧은 줄은 소제목 ('STANDARD MODE', 'UPDATED RANKS & BADGES') — 콜론은 뗀다.
          // 줄 전체가 굵은 글씨면 Steam 에서도 소제목처럼 보이는 줄 ('Seasonal Rank Reset') — 번역 사전 키가 원문 그대로라 글자는 안 바꾼다
          const caps = !b && l.length <= 60 && /[A-Z]/.test(l) && !/[a-z]/.test(l);
          // 굵기만 한 줄은 주소가 들었거나 마침표 · 느낌표로 끝나면 문장 ('Check out everything that's new at: 주소'). 물음표는 소제목일 수 있어 둔다. bb_h 는 Steam 이 머리로 쓴 줄이라 그대로 소제목
          const heading = caps || (!b && l.length <= 80 && (head || (bold && !/https?:\/\/|[.!]$/.test(l))));
          const li = b ? b[1] : inList ? l : undefined;
          const block: PatchBlock = li !== undefined ? { type: 'li', text: li } : heading ? { type: 'h', text: caps ? l.replace(/:$/, '') : l } : { type: 'p', text: l };
          // 맨 앞 가로줄은 그을 필요가 없다 (머리 띠 바로 아래)
          if (ruleNext && intro.blocks.length) block.rule = true;
          ruleNext = false;
          intro.blocks.push(block);
        }
        sections = intro.blocks.length ? [intro] : [];
      } else {
        const general: PatchSection = { key: 'general', blocks: [] };
        const itemSec: PatchSection = { key: 'items', blocks: [] };
        const heroSec: PatchSection = { key: 'heroes', blocks: [] };
        const others: PatchSection[] = [];
        let current = general;
        const groups = new Map<string, Extract<PatchBlock, { type: 'group' }>>();
        let last: { block: PatchBlock } | null = null;
        const group = (sec: PatchSection, kind: 'hero' | 'item' | 'other', key: string, name: string, slug?: string) => {
          const id = `${sec.key}:${sec.heading ?? ''}:${key}`;
          let g = groups.get(id);
          if (!g) {
            g = { type: 'group', kind, slug, name, lines: [] };
            groups.set(id, g);
            sec.blocks.push(g);
          }
          return g;
        };

        for (const line of lines) {
          if (line === '-') continue;
          const head = headOf(line);
          if (head) {
            const key = head.toLowerCase();
            if (key === 'general') current = general;
            else if (key === 'items') current = itemSec;
            else if (key === 'heroes') current = heroSec;
            else {
              current = { key: 'other', heading: head, blocks: [] };
              others.push(current);
            }
            last = null;
            continue;
          }
          const bullet = line.match(/^-\s*(.+)$/);
          if (!bullet) {
            // '-' 없는 줄은 앞 줄이 줄바꿈된 것. 앞 줄이 없으면 문단
            if (last?.block.type === 'group') last.block.lines[last.block.lines.length - 1].text += ` ${line}`;
            else if (last) last.block.text += ` ${line}`;
            else {
              const b: PatchBlock = { type: 'p', text: line };
              current.blocks.push(b);
              last = { block: b };
            }
            continue;
          }
          const target = bullet[1].match(/^([^:]{2,40}):\s*(.+)$/);
          const name = target?.[1].trim() ?? '';
          const exact = target && heroBy.get(name);
          const item = target && !exact && itemBy.get(name);
          const hero = exact || (target && !item ? heroByWord(name) : undefined);
          // 기타 구역('Street Brawl:' 등) 안의 영웅·아이템 줄은 그 구역 안에서 묶는다 — 일반 영웅 변경과 섞이면 영웅 상세 '최근 패치 변경' 에 그 모드 전용 줄이 나온다
          const inOther = current.key === 'other';
          if (target && hero) {
            const g = group(inOther ? current : heroSec, 'hero', hero.slug, hero.name, hero.slug);
            const text = target[2].trim();
            const slot = abilityOf(hero.slug, text);
            const a = slot && localAbilities.get(hero.slug)?.find((x) => x.slot === slot);
            g.lines.push(a ? { text, ability: a.slot } : { text });
            if (a && !g.abilities?.some((x) => x.slot === a.slot)) (g.abilities ??= []).push({ slot: a.slot, name: a.name, enName: enAbilities.get(hero.slug)?.find((x) => x.slot === a.slot)?.name, image: a.image });
            if (!inOther) heroSlugs.add(hero.slug);
            last = { block: g };
          } else if (target && item) {
            const g = group(inOther ? current : itemSec, 'item', item.slug, item.name, item.slug);
            g.lines.push({ text: target[2].trim() });
            if (!inOther) itemSlugs.add(item.slug);
            last = { block: g };
          } else if (target && (current === heroSec || current === itemSec)) {
            // 영웅·아이템 구역인데 사이트에 없는 대상 (예전 이름 등) → 원문 이름으로 묶는다
            const g = group(current, 'other', name.toLowerCase(), name);
            g.lines.push({ text: target[2].trim() });
            last = { block: g };
          } else {
            const b: PatchBlock = { type: 'li', text: bullet[1] };
            current.blocks.push(b);
            last = { block: b };
          }
        }
        // 영웅 → 아이템 → 일반 순 (사용자들이 영웅·아이템 변경부터 찾아서)
        sections = [heroSec, itemSec, general, ...others].filter((s) => s.blocks.length);
      }

      const date = patchDate(p);
      const n = (seen.get(date) ?? 0) + 1;
      seen.set(date, n);
      return {
        id: n > 1 ? `${date}-${n}` : date,
        date,
        title: p.title.trim(),
        url: p.link,
        // 공지 머리 그림 (Steam 공지 이미지 서버의 첫 그림, 파비콘 등은 제외). 화면에 쓸지는 data/patch-banners.ts 가 정한다
        image: p.content.match(/<img[^>]+src="(https:\/\/clan\.[a-z]+\.steamstatic\.com\/images\/[^"]+)"/)?.[1],
        sections,
        heroCount: heroSlugs.size,
        itemCount: itemSlugs.size,
      };
    });
}
