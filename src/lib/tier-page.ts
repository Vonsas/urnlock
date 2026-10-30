/**
 * 티어·승률표 페이지 공통 — 빌드 데이터(getTierData)를 브라우저용 JSON(TierPageConfig)으로 바꾼다.
 * 티어 화면에는 티어·태그만, 승률표에는 수치만 싣는다 (점수는 싣지 않음).
 */
import { getHeroes, getRanks, getTierData } from '../data';
import { LOCALE_META, localePath, useTranslations, type Locale } from '../i18n';
import { gameImage } from './images';
import { tierChange, tierReasons } from './tier-reason';
import { formatPercent } from './format';
import type { StatCell, StepsData, TierCell, TierPageConfig } from '../scripts/tiers';

/** 단계별 원본에서 영웅 · 단계 하나의 칸 수 (scripts/tiers.ts 의 STEP_FIELDS 와 같게) */
const STEP_FIELDS = 6;
import type { TierData } from '../data';

/** 승률표에서 흐리게 표시할 판수 (tier-score.ts 의 MIN_GAMES 와 같게) */
const LOW_SAMPLE = 500;

export async function tierPageConfig(lang: Locale, mode: 'tier' | 'stats'): Promise<string> {
  const [data, heroes, ranks] = await Promise.all([getTierData(), getHeroes(lang), getRanks(lang)]);
  const heroMap: TierPageConfig['heroes'] = {};
  await Promise.all(
    heroes
      .filter((h) => h.id !== undefined)
      .map(async (h) => {
        // HeroPortrait md 와 같은 크기라 같은 이미지 파일을 쓴다
        heroMap[h.id!] = { name: h.name, slug: h.slug, icon: await gameImage(h.image?.small, 128, 128) };
      }),
  );

  // 티어 화면은 고정 기준(상위권 · 하위권 × 최근 2주 / 현재 패치)만, 승률표는 랭크 전체 · 일반 — 좁힌 랭크 범위는 단계별 원본(steps)으로 브라우저가 더한다
  const source = (data?.boards ?? []).filter((b) =>
    mode === 'stats' ? b.rank === 'ranked' || b.rank === 'normal' : (b.rank === 'upper' || b.rank === 'lower') && (b.window === '14d' || b.window === 'patch'),
  );
  const t = useTranslations(lang);
  const reasons = new Map(mode === 'tier' ? source.map((b) => [b, tierReasons(b, t.tiers, (n) => formatPercent(lang, n))] as const) : []);
  const boards: TierPageConfig['boards'] = source.map((b) => ({
    window: b.window,
    // 위에서 'ranked' · 'normal' · 'upper' · 'lower' 만 남겼다
    rank: b.rank as 'ranked' | 'normal' | 'upper' | 'lower',
    totalMatches: Math.round(b.totalMatches),
    cells:
      mode === 'tier'
        ? [...b.heroes]
            .sort((x, y) => (y.score ?? -Infinity) - (x.score ?? -Infinity))
            .map((h): TierCell => {
              // 변동은 '최근 2주' 보드에만 (일주일 전 '최근 2주' 와 비교), 근거는 마우스를 올리면 보이는 한 줄
              const prev = b.rank === 'upper' || b.rank === 'lower' ? data?.prevTiers?.[b.rank] : undefined;
              const change = b.window === '14d' ? tierChange(h.tier, prev?.[h.heroId]) : null;
              return [h.heroId, h.tier, h.tag, h.lowSample ? 1 : 0, change, reasons.get(b)?.get(h.heroId) ?? ''];
            })
        : b.heroes.map(
            // 승수는 승률 × 판수로 되돌린다 (빌드 때 정확한 값) — 브라우저가 기간끼리 빼서 '변화' 를 계산하므로 반올림한 승률을 싣지 않는다
            (h): StatCell => [
              h.heroId,
              h.matches,
              Math.round((h.winRate / 100) * h.matches),
              h.expMatches,
              Math.round((h.expWinRate / 100) * h.expMatches),
              // 일반 보기는 승률 · 픽률 · 판수만 보이므로 KDA 재료는 싣지 않는다
              b.rank === 'normal' ? 0 : h.kills + h.assists,
              b.rank === 'normal' ? 0 : h.deaths,
            ],
          ),
  }));

  const config: TierPageConfig = {
    mode,
    locale: LOCALE_META[lang].htmlLang,
    heroPath: localePath(lang, 'heroes'),
    heroes: heroMap,
    generatedAt: data?.generatedAt ?? 0,
    windows: data?.windows ?? [],
    boards,
    // 승률표 랭크 범위의 단계별 원본은 따로 둔 파일 — 범위 막대를 처음 건드릴 때 받는다
    stepsUrl: mode === 'stats' && data ? `/data/${statsStepsFile(data.generatedAt)}.json` : undefined,
    rankSteps: await Promise.all(
      Array.from({ length: 11 }, async (_, i) => {
        const r = ranks.find((x) => x.tier === i + 1);
        return { name: r?.name ?? `#${i + 1}`, icon: await gameImage(r?.image, 64, 64) };
      }),
    ),
    lowSample: LOW_SAMPLE,
    t: useTranslations(lang).tiers,
  };
  // </script> 로 JSON 이 끊기지 않게
  return JSON.stringify(config).replace(/</g, '\\u003c');
}

/** 단계별 원본 파일 이름 (데이터 시각이 들어가 데이터가 바뀌면 이름도 바뀐다) */
export const statsStepsFile = (generatedAt: number) => `stats-steps-${generatedAt}`;

/** 기간마다 단계 1–11 총 매치 수와 영웅별 [판수, 승수, 숙련자 판수, 숙련자 승수, 킬 + 어시스트, 데스] × 11 (단계 순서대로 이어 붙임) */
export function statsStepsPayload(data: TierData): StepsData {
  return Object.fromEntries(
    data.windows.map((w) => {
      const list = Array.from({ length: 11 }, (_, i) => data.steps.find((s) => s.window === w.key && s.step === i + 1));
      const heroes: Record<number, number[]> = {};
      list.forEach((s, i) => {
        for (const [id, m, wins, em, ew, k, d, a] of s?.heroes ?? []) {
          heroes[id] ??= new Array(11 * STEP_FIELDS).fill(0);
          heroes[id].splice(i * STEP_FIELDS, STEP_FIELDS, m, wins, em, ew, k + a, d);
        }
      });
      return [w.key, { totals: list.map((s) => Math.round(s?.totalMatches ?? 0)), heroes }];
    }),
  );
}
