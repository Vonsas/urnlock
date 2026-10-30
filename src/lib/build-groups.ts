/** 게임 빌드 공통 손질 — 영웅 빌드 탭(BuildCard)과 빌드 페이지가 같이 쓴다 */
import type { Dictionary } from '../i18n';

// 묶음 이름을 안 바꾼 빌드는 게임 내부 이름('#Citadel_HeroBuilds_MidGame')이 온다 → 게임에서 보이는 이름으로
const GROUP_KEYS: Record<string, keyof Dictionary['heroes']['buildGroup']> = {
  early: 'early',
  earlygame: 'early',
  mid: 'mid',
  midgame: 'mid',
  late: 'late',
  lategame: 'late',
  lane: 'lane',
};

export function groupName(name: string, t: Dictionary): string {
  const m = name.match(/^#Citadel_HeroBuilds_(\w+)$/);
  if (!m) return name;
  const key = GROUP_KEYS[m[1].toLowerCase()];
  return key ? t.heroes.buildGroup[key] : m[1].replace(/([a-z])([A-Z])/g, '$1 $2');
}

/**
 * 스킬 순서를 그릴 수 있는지 — 정리한 순서가 4칸 이상이고 모든 id 가 이 영웅의 능력이어야 한다.
 * 능력이 바뀐 뒤(리워크·출시 전 빌드) 옛 id 가 남은 빌드는 표가 비어서 제목만 남았다 (2026-10-05 모바일 점검).
 */
export function skillOrderFits(order: number[], abilityIds: Array<number | undefined>): boolean {
  const o = skillOrder(order);
  return o.length >= 4 && o.every((id) => abilityIds.includes(id));
}

/** 스킬 순서 정리 — 능력마다 해금 1번 + 강화 3번까지 (작성자가 순서를 여러 번 고친 빌드는 기록이 길게 쌓여 온다) */
export function skillOrder(order: number[]): number[] {
  const used = new Map<number, number>();
  return order.filter((id) => {
    const n = (used.get(id) ?? 0) + 1;
    used.set(id, n);
    return n <= 4;
  });
}
