/**
 * 목업 영웅 데이터.
 * 수치는 화면 확인용 샘플이며 실제 게임 수치가 아니다.
 * ko / zh 이름은 임시 음역 — 공식 현지화 명칭은 API 연동 시 받아온다.
 */
import type { Ability, HeroBaseStats, HeroWeapon } from '../types';
import type { L } from './localized';

type LocalizedAbility = Omit<Ability, 'name' | 'description' | 'upgrades' | 'stats'> & {
  name: L;
  description: L;
  upgrades: [LUpgrade, LUpgrade, LUpgrade];
};
type LUpgrade = { cost: 1 | 2 | 5; text: L };

export interface MockHero {
  slug: string;
  name: L;
  complexity: 1 | 2 | 3;
  health: number;
  weaponDps: number;
  moveSpeed: number;
  detail?: {
    lore: L;
    stats: HeroBaseStats;
    weapon: Omit<HeroWeapon, 'name' | 'traits'> & { name: L; traits: L[] };
    abilities: [LocalizedAbility, LocalizedAbility, LocalizedAbility, LocalizedAbility];
  };
}

export const mockHeroes: MockHero[] = [
  {
    slug: 'abrams',
    name: { ko: '에이브럼스', en: 'Abrams', zh: '艾布拉姆斯' },
    complexity: 1,
    health: 800,
    weaponDps: 51,
    moveSpeed: 6.4,
    detail: {
      lore: {
        ko: '적에게 곧장 돌진해 난전을 여는 근접 영웅. 입은 피해의 일부를 되돌려 받으며 오래 버틴다.',
        en: 'A frontline brawler who charges straight in to start fights, recovering part of the damage he takes to outlast opponents.',
        zh: '直接冲向敌人开启混战的近战英雄。能回复所受伤害的一部分，持久作战。',
      },
      stats: {
        spiritPower: { base: 0, perBoon: 1.1 },
        health: { base: 800, perBoon: 49 },
        healthRegen: { base: 1.5 },
        moveSpeed: { base: 6.4 },
        sprintSpeed: { base: 1.5 },
        stamina: { base: 3 },
        bulletResist: { base: 0 },
        spiritResist: { base: 0 },
        lightMelee: { base: 50, perBoon: 1.74 },
        heavyMelee: { base: 116, perBoon: 4.03 },
      },
      weapon: {
        name: { ko: '사건 종결', en: 'Case Closed', zh: '结案' },
        traits: [
          { ko: '산탄', en: 'Spreadshot', zh: '散射' },
          { ko: '근거리', en: 'Close range', zh: '近距离' },
        ],
        bulletDamage: { base: 3.6, perBoon: 0.1 },
        pellets: 9,
        fireRate: 1.59,
        dps: 51,
        ammo: 9,
        reloadTime: 0.35,
        falloffRange: [17, 40],
        bulletVelocity: 610,
      },
      abilities: [
        {
          slot: 1,
          kind: 'active',
          cooldown: 45,
          duration: 3,
          range: 10,
          name: { ko: '생명 흡수', en: 'Siphon Life', zh: '生命汲取' },
          description: {
            ko: '주변 적의 체력을 빼앗아 자신을 회복한다. 범위 안에 머무는 동안 계속 흡수한다.',
            en: 'Drains health from nearby enemies and heals himself while they stay in range.',
            zh: '吸取周围敌人的生命值为自己回复，敌人留在范围内时持续吸取。',
          },
          upgrades: [
            { cost: 1, text: { ko: '범위 +2m', en: '+2m radius', zh: '范围 +2 米' } },
            { cost: 2, text: { ko: '재사용 대기 −15초', en: '−15s cooldown', zh: '冷却 −15 秒' } },
            {
              cost: 5,
              text: {
                ko: '흡수 피해 +25, 회복량 2배',
                en: '+25 drain damage, doubled healing',
                zh: '汲取伤害 +25，回复量翻倍',
              },
            },
          ],
        },
        {
          slot: 2,
          kind: 'active',
          cooldown: 34,
          range: 12,
          name: { ko: '어깨 돌진', en: 'Shoulder Charge', zh: '冲肩' },
          description: {
            ko: '앞으로 돌진하며 부딪힌 적을 밀어낸다. 적을 벽에 부딪히면 잠시 기절시킨다.',
            en: 'Charges forward, pushing enemies ahead. Slamming them into a wall stuns them briefly.',
            zh: '向前冲刺并推开撞到的敌人。将敌人撞上墙壁时会使其短暂眩晕。',
          },
          upgrades: [
            {
              cost: 1,
              text: {
                ko: '영웅 적중 시 8초간 무기 피해 +25%',
                en: '+25% weapon damage for 8s after hitting a hero',
                zh: '命中英雄后 8 秒内武器伤害 +25%',
              },
            },
            { cost: 2, text: { ko: '재사용 대기 −8초', en: '−8s cooldown', zh: '冷却 −8 秒' } },
            { cost: 5, text: { ko: '기절 시간 +0.5초', en: '+0.5s stun duration', zh: '眩晕时间 +0.5 秒' } },
          ],
        },
        {
          slot: 3,
          kind: 'passive',
          name: { ko: '지옥의 회복력', en: 'Infernal Resilience', zh: '炼狱复原' },
          description: {
            ko: '받은 피해의 일부를 시간에 걸쳐 회복한다.',
            en: 'Regenerates a portion of damage taken over time.',
            zh: '在一段时间内回复所受伤害的一部分。',
          },
          upgrades: [
            { cost: 1, text: { ko: '체력 재생 +2', en: '+2 health regen', zh: '生命回复 +2' } },
            { cost: 2, text: { ko: '회복 비율 +8%', en: '+8% regenerated', zh: '回复比例 +8%' } },
            {
              cost: 5,
              text: {
                ko: '영혼 피해도 회복 대상에 포함',
                en: 'Also regenerates spirit damage',
                zh: '灵魂伤害也计入回复',
              },
            },
          ],
        },
        {
          slot: 4,
          kind: 'active',
          cooldown: 150,
          range: 40,
          name: { ko: '지진 강타', en: 'Seismic Impact', zh: '地震冲击' },
          description: {
            ko: '높이 뛰어올라 지정한 지점에 내려찍고, 착지 지점의 적을 기절시킨다.',
            en: 'Leaps high into the air and crashes down on a target point, stunning enemies where he lands.',
            zh: '高高跃起后砸向目标地点，使落点处的敌人眩晕。',
          },
          upgrades: [
            { cost: 1, text: { ko: '재사용 대기 −30초', en: '−30s cooldown', zh: '冷却 −30 秒' } },
            { cost: 2, text: { ko: '착지 범위 +3m', en: '+3m impact radius', zh: '落点范围 +3 米' } },
            {
              cost: 5,
              text: {
                ko: '착지 후 6초간 탄환 저항 +40%',
                en: '+40% bullet resist for 6s after landing',
                zh: '落地后 6 秒内子弹抗性 +40%',
              },
            },
          ],
        },
      ],
    },
  },
  // 아래는 목록용 요약만 있는 영웅 — 이름(ko/zh)은 임시 음역, 수치는 샘플
  ...(
    [
      ['apollo', 'Apollo', '아폴로', '阿波罗', 2, 700, 62, 6.8],
      ['bebop', 'Bebop', '비밥', '比博普', 2, 750, 55, 6.4],
      ['billy', 'Billy', '빌리', '比利', 1, 780, 57, 6.6],
      ['calico', 'Calico', '칼리코', '卡利科', 2, 640, 60, 6.9],
      ['celeste', 'Celeste', '셀레스트', '塞莱斯特', 3, 620, 48, 6.6],
      ['the-doorman', 'The Doorman', '도어맨', '门卫', 3, 680, 50, 6.4],
      ['drifter', 'Drifter', '드리프터', '漂泊者', 2, 650, 64, 6.8],
      ['dynamo', 'Dynamo', '다이나모', '迪纳摩', 1, 720, 46, 6.3],
      ['graves', 'Graves', '그레이브스', '格雷夫斯', 2, 660, 44, 6.4],
      ['grey-talon', 'Grey Talon', '그레이 탈론', '灰爪', 3, 580, 49, 6.6],
      ['haze', 'Haze', '헤이즈', '海兹', 2, 610, 74, 6.8],
      ['holliday', 'Holliday', '할리데이', '霍利迪', 2, 620, 66, 6.6],
      ['infernus', 'Infernus', '인퍼너스', '因弗诺斯', 2, 650, 62, 6.6],
      ['ivy', 'Ivy', '아이비', '艾薇', 2, 640, 47, 6.4],
      ['kelvin', 'Kelvin', '켈빈', '开尔文', 1, 760, 45, 6.3],
      ['lady-geist', 'Lady Geist', '레이디 가이스트', '盖斯特夫人', 2, 700, 52, 6.4],
      ['lash', 'Lash', '래시', '拉什', 3, 700, 53, 6.7],
      ['mcginnis', 'McGinnis', '맥기니스', '麦金尼斯', 1, 680, 58, 6.3],
      ['mina', 'Mina', '미나', '米娜', 3, 600, 63, 7.0],
      ['mirage', 'Mirage', '미라지', '米拉奇', 2, 650, 56, 6.5],
      ['mo-krill', 'Mo & Krill', '모 & 크릴', '莫与克里尔', 2, 820, 43, 6.3],
      ['paige', 'Paige', '페이지', '佩姬', 2, 600, 42, 6.5],
      ['paradox', 'Paradox', '패러독스', '帕拉多克斯', 3, 620, 59, 6.6],
      ['pocket', 'Pocket', '포켓', '波克特', 3, 610, 54, 6.8],
      ['rem', 'Rem', '렘', '雷姆', 2, 630, 45, 6.6],
      ['seven', 'Seven', '세븐', '赛文', 1, 690, 61, 6.4],
      ['shiv', 'Shiv', '시브', '希夫', 2, 720, 60, 6.8],
      ['silver', 'Silver', '실버', '西尔弗', 2, 740, 58, 6.9],
      ['sinclair', 'Sinclair', '싱클레어', '辛克莱', 3, 620, 50, 6.5],
      ['venator', 'Venator', '베나토르', '维纳托', 2, 640, 65, 6.6],
      ['victor', 'Victor', '빅터', '维克多', 2, 780, 52, 6.3],
      ['vindicta', 'Vindicta', '빈딕타', '文迪克塔', 2, 580, 68, 6.6],
      ['viscous', 'Viscous', '비스커스', '维斯科斯', 3, 700, 47, 6.4],
      ['vyper', 'Vyper', '바이퍼', '维珀', 2, 610, 57, 6.9],
      ['warden', 'Warden', '워든', '沃登', 1, 790, 56, 6.3],
      ['wraith', 'Wraith', '레이스', '雷斯', 2, 610, 72, 6.6],
      ['yamato', 'Yamato', '야마토', '大和', 3, 640, 58, 6.9],
    ] as const
  ).map(
    ([slug, en, ko, zh, complexity, health, weaponDps, moveSpeed]): MockHero => ({
      slug,
      name: { ko, en, zh },
      complexity,
      health,
      weaponDps,
      moveSpeed,
    }),
  ),
];
