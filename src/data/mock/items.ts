/**
 * 목업 아이템 데이터 — 화면 확인용 샘플. 가격 체계만 게임 규칙(티어별 고정가)을 따른다.
 */
import type { ItemCategory, ItemStat, ItemTier } from '../types';
import type { L } from './localized';

export const TIER_COST: Record<ItemTier, number> = { 1: 800, 2: 1600, 3: 3200, 4: 6400 };

export interface MockItem {
  slug: string;
  category: ItemCategory;
  tier: ItemTier;
  isActive: boolean;
  name: L;
  stats: ItemStat[];
}

const pct = (key: ItemStat['key'], value: number): ItemStat => ({ key, value, unit: '%' });
const flat = (key: ItemStat['key'], value: number): ItemStat => ({ key, value, unit: 'flat' });
const speed = (key: ItemStat['key'], value: number): ItemStat => ({ key, value, unit: 'm/s' });

function item(
  slug: string,
  category: ItemCategory,
  tier: ItemTier,
  name: L,
  stats: ItemStat[],
  isActive = false,
): MockItem {
  return { slug, category, tier, isActive, name, stats };
}

// [slug, 분류, 티어, en, ko, zh, 효과, 액티브]
type Row = [string, ItemCategory, ItemTier, string, string, string, ItemStat[], boolean?];

const rows: Row[] = [
  // 무기
  ['close-quarters', 'weapon', 1, 'Close Quarters', '근접전', '近身作战', [pct('closeRangeDamage', 20)]],
  ['extended-magazine', 'weapon', 1, 'Extended Magazine', '확장 탄창', '扩容弹匣', [pct('ammo', 25), pct('weaponDamage', 6)]],
  ['headshot-booster', 'weapon', 1, 'Headshot Booster', '헤드샷 강화', '爆头增幅', [flat('headshotDamage', 40), pct('fireRate', 4)]],
  ['high-velocity-rounds', 'weapon', 1, 'High-Velocity Rounds', '고속탄', '高速弹', [pct('weaponDamage', 8)]],
  ['monster-rounds', 'weapon', 1, 'Monster Rounds', '괴물 사냥탄', '猎怪弹', [pct('weaponDamage', 12), flat('bonusHealth', 35)]],
  ['rapid-rounds', 'weapon', 1, 'Rapid Rounds', '속사탄', '速射弹', [pct('fireRate', 9)]],
  ['active-reload', 'weapon', 2, 'Active Reload', '액티브 재장전', '主动换弹', [pct('fireRate', 10), pct('ammo', 20)]],
  ['fleetfoot', 'weapon', 2, 'Fleetfoot', '재빠른 발', '疾行', [speed('moveSpeed', 1), pct('ammo', 25)], true],
  ['kinetic-dash', 'weapon', 2, 'Kinetic Dash', '운동 에너지 대시', '动能冲刺', [pct('fireRate', 12)]],
  ['mystic-shot', 'weapon', 2, 'Mystic Shot', '신비한 사격', '神秘射击', [pct('weaponDamage', 8)]],
  ['slowing-bullets', 'weapon', 2, 'Slowing Bullets', '감속탄', '减速子弹', [pct('weaponDamage', 10)]],
  ['swift-striker', 'weapon', 2, 'Swift Striker', '신속 타격', '迅捷打击', [pct('fireRate', 22), pct('ammo', 10)]],
  ['berserker', 'weapon', 3, 'Berserker', '광전사', '狂战士', [pct('weaponDamage', 14), pct('bulletResist', 8)]],
  ['burst-fire', 'weapon', 3, 'Burst Fire', '점사', '爆发射击', [pct('fireRate', 12), speed('moveSpeed', 1)]],
  ['headhunter', 'weapon', 3, 'Headhunter', '헤드헌터', '猎头者', [flat('headshotDamage', 70)]],
  ['hollow-point', 'weapon', 3, 'Hollow Point', '할로 포인트', '空尖弹', [pct('weaponDamage', 20)]],
  ['sharpshooter', 'weapon', 3, 'Sharpshooter', '명사수', '神射手', [pct('weaponDamage', 18), pct('abilityRange', 15)]],
  ['tesla-bullets', 'weapon', 3, 'Tesla Bullets', '테슬라 탄환', '特斯拉子弹', [pct('fireRate', 12)]],
  ['armor-piercing-rounds', 'weapon', 4, 'Armor Piercing Rounds', '철갑탄', '穿甲弹', [pct('weaponDamage', 25)]],
  ['crippling-headshot', 'weapon', 4, 'Crippling Headshot', '불구 헤드샷', '致残爆头', [flat('headshotDamage', 60), pct('weaponDamage', 15)]],
  ['frenzy', 'weapon', 4, 'Frenzy', '광란', '狂乱', [pct('fireRate', 25), speed('moveSpeed', 2)]],
  ['glass-cannon', 'weapon', 4, 'Glass Cannon', '유리 대포', '玻璃大炮', [pct('weaponDamage', 40), pct('fireRate', 12)]],
  ['lucky-shot', 'weapon', 4, 'Lucky Shot', '행운의 한 발', '幸运一击', [pct('weaponDamage', 30), pct('ammo', 20)]],
  ['silencer', 'weapon', 4, 'Silencer', '소음기', '消音器', [pct('weaponDamage', 18), pct('spiritResist', 10)]],

  // 활력
  ['extra-health', 'vitality', 1, 'Extra Health', '추가 체력', '额外生命', [flat('bonusHealth', 160)]],
  ['extra-regen', 'vitality', 1, 'Extra Regen', '추가 재생', '额外回复', [flat('healthRegen', 3)]],
  ['extra-stamina', 'vitality', 1, 'Extra Stamina', '추가 스태미나', '额外耐力', [flat('bonusHealth', 40), speed('sprintSpeed', 1)]],
  ['healing-rite', 'vitality', 1, 'Healing Rite', '치유 의식', '治疗仪式', [flat('bonusHealth', 60), speed('sprintSpeed', 1)], true],
  ['melee-lifesteal', 'vitality', 1, 'Melee Lifesteal', '근접 흡혈', '近战吸血', [flat('bonusHealth', 75)]],
  ['sprint-boots', 'vitality', 1, 'Sprint Boots', '질주 장화', '疾跑靴', [speed('sprintSpeed', 2), flat('healthRegen', 1)]],
  ['bullet-lifesteal', 'vitality', 2, 'Bullet Lifesteal', '탄환 흡혈', '子弹吸血', [pct('bulletLifesteal', 22), flat('bonusHealth', 75)]],
  ['combat-barrier', 'vitality', 2, 'Combat Barrier', '전투 방벽', '战斗屏障', [pct('weaponDamage', 8), flat('bonusHealth', 50)]],
  ['enduring-speed', 'vitality', 2, 'Enduring Speed', '지속 속도', '持久速度', [speed('moveSpeed', 2)]],
  ['healbane', 'vitality', 2, 'Healbane', '치유 저주', '治疗诅咒', [flat('bonusHealth', 75), flat('spiritPower', 5)]],
  ['reactive-barrier', 'vitality', 2, 'Reactive Barrier', '반응형 방벽', '反应屏障', [flat('bonusHealth', 90)]],
  ['spirit-lifesteal', 'vitality', 2, 'Spirit Lifesteal', '영혼 흡혈', '灵魂吸血', [pct('spiritLifesteal', 20), flat('bonusHealth', 75)]],
  ['bullet-resilience', 'vitality', 3, 'Bullet Resilience', '탄환 내성', '子弹韧性', [pct('bulletResist', 25)]],
  ['fortitude', 'vitality', 3, 'Fortitude', '불굴', '坚韧', [flat('bonusHealth', 300), flat('healthRegen', 4)]],
  ['majestic-leap', 'vitality', 3, 'Majestic Leap', '위엄의 도약', '雄伟之跃', [pct('bulletResist', 10)], true],
  ['metal-skin', 'vitality', 3, 'Metal Skin', '강철 피부', '金属皮肤', [pct('bulletResist', 12), flat('bonusHealth', 100)], true],
  ['rescue-beam', 'vitality', 3, 'Rescue Beam', '구조 광선', '救援光束', [flat('bonusHealth', 125), pct('abilityRange', 10)], true],
  ['spirit-resilience', 'vitality', 3, 'Spirit Resilience', '영혼 내성', '灵魂韧性', [pct('spiritResist', 25)]],
  ['colossus', 'vitality', 4, 'Colossus', '거상', '巨像', [flat('bonusHealth', 400), pct('bulletResist', 15)], true],
  ['diviners-kevlar', 'vitality', 4, "Diviner's Kevlar", '점술가의 방탄복', '占卜者护甲', [flat('spiritPower', 20), flat('bonusHealth', 200)]],
  ['inhibitor', 'vitality', 4, 'Inhibitor', '억제기', '抑制器', [pct('weaponDamage', 15), flat('bonusHealth', 175)]],
  ['leech', 'vitality', 4, 'Leech', '흡혈귀', '吸血鬼', [pct('bulletLifesteal', 25), pct('spiritLifesteal', 25)]],
  ['phantom-strike', 'vitality', 4, 'Phantom Strike', '유령 일격', '幻影打击', [flat('bonusHealth', 150), speed('moveSpeed', 1)], true],
  ['unstoppable', 'vitality', 4, 'Unstoppable', '저지 불가', '势不可挡', [flat('bonusHealth', 250), pct('spiritResist', 15)], true],

  // 영혼
  ['extra-charge', 'spirit', 1, 'Extra Charge', '추가 충전', '额外充能', [flat('abilityCharges', 1)]],
  ['extra-spirit', 'spirit', 1, 'Extra Spirit', '추가 영혼력', '额外灵魂', [flat('spiritPower', 10)]],
  ['mystic-burst', 'spirit', 1, 'Mystic Burst', '신비 폭발', '神秘爆发', [flat('spiritPower', 6)]],
  ['mystic-expansion', 'spirit', 1, 'Mystic Expansion', '신비 확장', '神秘扩展', [pct('abilityRange', 15)]],
  ['mystic-regeneration', 'spirit', 1, 'Mystic Regeneration', '신비 재생', '神秘再生', [flat('healthRegen', 2), flat('spiritPower', 4)]],
  ['spirit-strike', 'spirit', 1, 'Spirit Strike', '영혼 일격', '灵魂打击', [flat('spiritPower', 5), flat('bonusHealth', 40)]],
  ['duration-extender', 'spirit', 2, 'Duration Extender', '지속 시간 연장', '持续时间延长', [flat('spiritPower', 5)]],
  ['improved-cooldown', 'spirit', 2, 'Improved Cooldown', '재사용 개선', '冷却强化', [pct('cooldownReduction', 10)]],
  ['mystic-vulnerability', 'spirit', 2, 'Mystic Vulnerability', '신비 취약', '神秘易伤', [flat('spiritPower', 8)]],
  ['quicksilver-reload', 'spirit', 2, 'Quicksilver Reload', '수은 재장전', '水银换弹', [flat('spiritPower', 6), pct('ammo', 15)]],
  ['slowing-hex', 'spirit', 2, 'Slowing Hex', '감속 주술', '减速咒术', [flat('spiritPower', 6)], true],
  ['withering-whip', 'spirit', 2, 'Withering Whip', '시드는 채찍', '枯萎之鞭', [pct('spiritResist', 8)], true],
  ['decay', 'spirit', 3, 'Decay', '부패', '腐朽', [flat('spiritPower', 12)], true],
  ['improved-spirit', 'spirit', 3, 'Improved Spirit', '영혼력 강화', '灵魂强化', [flat('spiritPower', 25)]],
  ['knockdown', 'spirit', 3, 'Knockdown', '넉다운', '击倒', [flat('spiritPower', 10), pct('abilityRange', 10)], true],
  ['rapid-recharge', 'spirit', 3, 'Rapid Recharge', '급속 충전', '快速充能', [flat('abilityCharges', 1), pct('cooldownReduction', 10)]],
  ['superior-cooldown', 'spirit', 3, 'Superior Cooldown', '상급 재사용', '高级冷却', [pct('cooldownReduction', 20)]],
  ['surge-of-power', 'spirit', 3, 'Surge of Power', '힘의 쇄도', '力量涌动', [flat('spiritPower', 22), speed('moveSpeed', 1)]],
  ['boundless-spirit', 'spirit', 4, 'Boundless Spirit', '무한한 영혼', '无尽灵魂', [flat('spiritPower', 60)]],
  ['curse', 'spirit', 4, 'Curse', '저주', '诅咒', [flat('spiritPower', 20), pct('spiritResist', 10)], true],
  ['echo-shard', 'spirit', 4, 'Echo Shard', '메아리 파편', '回响碎片', [pct('cooldownReduction', 10), flat('spiritPower', 15)], true],
  ['ethereal-shift', 'spirit', 4, 'Ethereal Shift', '에테르 전환', '以太转移', [flat('spiritPower', 20), flat('bonusHealth', 100)], true],
  ['magic-carpet', 'spirit', 4, 'Magic Carpet', '마법 양탄자', '魔毯', [flat('spiritPower', 15), speed('moveSpeed', 2)], true],
  ['refresher', 'spirit', 4, 'Refresher', '리프레셔', '刷新器', [flat('spiritPower', 10), flat('bonusHealth', 100)], true],
];

export const mockItems: MockItem[] = rows.map(([slug, category, tier, en, ko, zh, stats, isActive = false]) =>
  item(slug, category, tier, { ko, en, zh }, stats, isActive),
);
