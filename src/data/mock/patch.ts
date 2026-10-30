/** 목업 패치 요약 — 레이아웃 확인용. 실제 패치 내용이 아니다. */
import type { PatchChange } from '../types';
import type { L } from './localized';

export interface MockPatch {
  version: string;
  date: string;
  changes: Array<Omit<PatchChange, 'target' | 'text'> & { target: L; text: L }>;
}

export const mockPatch: MockPatch = {
  version: '2026.09.12',
  date: '2026-09-12',
  changes: [
    {
      kind: 'nerf',
      target: { ko: '에이브럼스', en: 'Abrams', zh: '艾布拉姆斯' },
      text: {
        ko: '어깨 돌진 재사용 대기 30초 → 34초',
        en: 'Shoulder Charge cooldown 30s → 34s',
        zh: '冲肩冷却 30 秒 → 34 秒',
      },
    },
    {
      kind: 'buff',
      target: { ko: '그레이 탈론', en: 'Grey Talon', zh: '灰爪' },
      text: { ko: '기본 체력 560 → 580', en: 'Base health 560 → 580', zh: '基础生命值 560 → 580' },
    },
    {
      kind: 'change',
      target: { ko: '테슬라 탄환', en: 'Tesla Bullets', zh: '特斯拉子弹' },
      text: {
        ko: '발동 확률 20% → 25%, 연쇄 피해 감소',
        en: 'Proc chance 20% → 25%, reduced chain damage',
        zh: '触发几率 20% → 25%，连锁伤害降低',
      },
    },
    {
      kind: 'nerf',
      target: { ko: '유리 대포', en: 'Glass Cannon', zh: '玻璃大炮' },
      text: { ko: '무기 피해 45% → 40%', en: 'Weapon damage 45% → 40%', zh: '武器伤害 45% → 40%' },
    },
    {
      kind: 'buff',
      target: { ko: '추가 충전', en: 'Extra Charge', zh: '额外充能' },
      text: {
        ko: '충전 간격 −2초',
        en: 'Charge interval −2s',
        zh: '充能间隔 −2 秒',
      },
    },
  ],
};
