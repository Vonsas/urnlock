/**
 * 화면이 소비하는 데이터 타입.
 * 페이지는 이 타입만 알고, 데이터가 목업인지 API 인지는 src/data/index.ts 가 감춘다.
 * 모든 문자열은 이미 요청한 언어로 번역된 상태로 전달된다.
 */

/** 레벨(부운)에 따라 오르는 수치 */
export interface ScalingStat {
  base: number;
  perBoon?: number;
}

export interface HeroBaseStats {
  spiritPower: ScalingStat;
  health: ScalingStat;
  healthRegen: ScalingStat;
  moveSpeed: ScalingStat;
  sprintSpeed: ScalingStat;
  stamina: ScalingStat;
  bulletResist: ScalingStat;
  spiritResist: ScalingStat;
  lightMelee: ScalingStat;
  heavyMelee: ScalingStat;
}
export type HeroStatKey = keyof HeroBaseStats;

export interface HeroWeapon {
  name: string;
  /** 무기 특성 태그 (산탄, 근거리 …) */
  traits: string[];
  bulletDamage: ScalingStat;
  pellets: number;
  fireRate: number;
  dps: number;
  ammo: number;
  reloadTime: number;
  /** 피해 감소가 시작·끝나는 거리 (m) */
  falloffRange: [number, number];
  bulletVelocity: number;
}

/** 능력 수치가 비례하는 스탯 — 마력, 부운(레벨) 수, 무기 피해 보너스, 약한 근접 피해 */
export type AbilityScaleStat = 'spiritPower' | 'boons' | 'weaponDamage' | 'lightMelee';

export interface AbilityScale {
  stat: AbilityScaleStat;
  factor: number;
}

/** 게임 툴팁의 주요 수치: '피해 100 (+마력 × 2.33)' */
export interface AbilityStat {
  /** API 가 주는 현지화된 이름 */
  label: string;
  value: number;
  /** '초', 'm', '%' … (현지화된 접미사, 없으면 빈 문자열) */
  unit: string;
  scale?: AbilityScale;
}

export interface AbilityUpgrade {
  /** 강화에 드는 능력 포인트 — 게임 규칙상 1 / 2 / 5 */
  cost: 1 | 2 | 5;
  text: string;
  /** 계수를 올리는 강화: '초당 피해 마력 계수 +0.12' */
  scaleBonus?: Array<AbilityScale & { label: string }>;
}

export interface Ability {
  /** 게임 능력 id — 스킬 순서 통계(ability-order-stats)와 연결. 목업에는 없다 */
  id?: number;
  slot: 1 | 2 | 3 | 4;
  name: string;
  /** 게임 아이콘 원본 URL (흰색 그림). 없으면 번호만 */
  image?: string;
  kind: 'active' | 'passive';
  cooldown?: number;
  charges?: number;
  duration?: number;
  range?: number;
  /** 재사용 대기·지속·사거리 외의 주요 수치 (피해량, 치유량, 기절 시간 …) */
  stats: AbilityStat[];
  description: string;
  upgrades: [AbilityUpgrade, AbilityUpgrade, AbilityUpgrade];
}

export interface HeroImages {
  /** 세로 초상 (280×380) — 큰 타일·상세 머리 */
  card?: string;
  /** 정사각 얼굴 (128×128) — 작은 타일·표 */
  small?: string;
  /** 게임이 영웅마다 디자인한 이름 로고 (흰색 SVG, 영어뿐) — 영웅 상세 제목 */
  name?: string;
}

export interface HeroSummary {
  slug: string;
  /** 게임 영웅 id — 전적(매치 기록)의 hero_id 와 연결. 목업에는 없다 */
  id?: number;
  name: string;
  /** 게임 이미지 원본 URL. 없으면 머리글자 자리 */
  image?: HeroImages;
  complexity: 1 | 2 | 3;
  health: number;
  weaponDps: number;
  moveSpeed: number;
  /** 상세 데이터(스탯·무기·능력)가 있는지 — 없으면 상세 페이지는 '준비 중' 상태 */
  hasDetail: boolean;
}

/** 게임 안 '인기 아이템' 한 개 — 그 구간에 산 매치 비율 */
export interface PopularItem {
  itemId: number;
  pickRate: number;
  winRate: number;
}

/** Valve 공식 인기 아이템 (게임 상점의 '인기 아이템' 탭과 같은 데이터, 패치 때 갱신되는 스냅샷) */
export interface HeroPopularItems {
  /** 집계 시각 (unix 초) */
  updatedAt: number;
  early: PopularItem[];
  mid: PopularItem[];
  late: PopularItem[];
}

export interface HeroDetailData {
  lore: string;
  /** 최대 레벨까지 얻는 부운 수 — 최대 레벨 수치 = base + perBoon × maxBoons */
  maxBoons: number;
  stats: HeroBaseStats;
  weapon: HeroWeapon;
  abilities: [Ability, Ability, Ability, Ability];
  popular?: HeroPopularItems;
}

export interface Hero extends HeroSummary {
  detail?: HeroDetailData;
}

export type ItemCategory = 'weapon' | 'vitality' | 'spirit';
export type ItemTier = 1 | 2 | 3 | 4;

export type ItemStatKey =
  | 'weaponDamage'
  | 'fireRate'
  | 'ammo'
  | 'bulletLifesteal'
  | 'bulletResist'
  | 'headshotDamage'
  | 'closeRangeDamage'
  | 'bonusHealth'
  | 'healthRegen'
  | 'moveSpeed'
  | 'sprintSpeed'
  | 'spiritPower'
  | 'spiritResist'
  | 'spiritLifesteal'
  | 'cooldownReduction'
  | 'abilityCharges'
  | 'abilityRange'
  | 'abilityDuration'
  | 'outOfCombatRegen'
  | 'bulletVelocity'
  | 'meleeDamage'
  | 'meleeResist'
  | 'stamina'
  | 'staminaRecovery'
  | 'debuffResist';

export interface ItemStat {
  key: ItemStatKey;
  value: number;
  unit: '%' | 'flat' | 'm/s' | 'm';
}

/** 아이템 툴팁 설명의 한 조각 — 외부 HTML 을 그대로 넣지 않고 조각으로 나눠 직접 그린다 */
export interface RichText {
  text: string;
  /** highlight: 게임이 강조한 낱말, dim: 흐리게 쓴 보충 설명. 없으면 보통 글자. '\n' 은 줄바꿈 */
  style?: 'highlight' | 'dim';
}

/** 툴팁의 수치 한 줄 */
export interface ItemEffectValue {
  label: string;
  /** 단위·부호까지 붙인 표시 문자열 (예: '+8%', '70초', '-0.7m') */
  value: string;
  /** 수치 종류 색 — weapon(총탄)·spirit(영혼)·vitality(체력·회복)·neutral */
  tone: 'weapon' | 'spirit' | 'vitality' | 'neutral';
  /** 불리한 효과 */
  negative?: boolean;
  /** 조건 문구 (예: '비영웅 대상') */
  condition?: string;
  /** 액티브·발동 중에만 적용되는 수치 */
  whileActive?: boolean;
  /** 계수 — 마력 1당 / 부운 1당 증가량 */
  scale?: { kind: 'spirit' | 'boon'; amount: number };
}

/** 툴팁 구역 — 게임 툴팁과 같은 순서: 기본 효과 → 패시브 → 액티브 */
export interface ItemEffectSection {
  kind: 'innate' | 'passive' | 'active';
  /** 액티브·패시브 재사용 대기 (초) */
  cooldown?: number;
  blocks: Array<{
    description?: RichText[];
    /** 크게 보여줄 핵심 수치 */
    key: ItemEffectValue[];
    values: ItemEffectValue[];
  }>;
}

export interface Item {
  slug: string;
  /** 게임 아이템 id — 매치 상세의 구매 기록(item_id)과 연결. 목업에는 없다 */
  id?: number;
  name: string;
  /** 상점 그림 원본 URL. 없으면 머리글자 자리 */
  image?: string;
  /** 짧은 효과 설명 (툴팁) */
  description?: string;
  category: ItemCategory;
  tier: ItemTier;
  cost: number;
  isActive: boolean;
  stats: ItemStat[];
  /** 게임 툴팁 구성 (API 데이터에만 있음) */
  effects?: ItemEffectSection[];
  /** 하위 아이템(조합 재료) slug */
  components?: string[];
  /** 이 아이템을 재료로 쓰는 상위 아이템 slug */
  upgradesTo?: string[];
}

/** 영웅 상세 '지표' 탭의 경기당 평균 항목. 육각형은 이 중 여섯 개를 쓴다 */
export type HeroMetricKey = 'kills' | 'deaths' | 'assists' | 'kda' | 'souls' | 'lastHits' | 'denies' | 'damage' | 'taken' | 'objective' | 'accuracy';

/** 플레이 성향 육각형의 축 */
export type HeroProfileAxis = Extract<HeroMetricKey, 'kills' | 'assists' | 'damage' | 'taken' | 'souls' | 'objective'>;

export interface HeroMetric {
  key: HeroMetricKey;
  /** 경기당 평균 (KDA 는 비율, 명중률은 %) */
  value: number;
  /** 비교한 영웅들의 평균 */
  average: number;
  /** 값이 큰 순서 (1 = 가장 큼) */
  rank: number;
  /** 영웅들 사이 위치 0(최하)–100(최고), 같은 값은 중간 */
  percentile: number;
}

/** 한 영웅의 플레이 지표 — 최근 기간 모든 매치의 경기당 평균과 영웅들 사이 순위 */
export interface HeroProfile {
  heroId: number;
  matches: number;
  /** 비교한 영웅 수 */
  heroCount: number;
  /** 집계 시작 (unix 초) */
  from: number;
  metrics: HeroMetric[];
}

/** 영웅 상세 '지표' 탭 그래프 (src/data/api/hero-charts.ts) */
/** 라인전 (매치 9분 라인 소울 비교 — src/data/api/lanes.ts) */
export interface LaneHero {
  heroId: number;
  /** 라인 수 (= 이 영웅이 2:2 라인에 선 매치 수) */
  lanes: number;
  /** % */
  win: number;
  draw: number;
  loss: number;
  /** 9분에 라인(두 명 합)이 상대 라인보다 앞선 소울, 평균 */
  lead: number;
}
export interface LaneStats {
  from: number;
  to: number;
  matches: number;
  /** 라인 승리 비율 높은 순 */
  heroes: LaneHero[];
}

export interface HeroCharts {
  /** 최근 30일 일별 (모든 매치, 오늘처럼 덜 끝난 날은 뺌) */
  trend: Array<{ day: number; matches: number; winRate: number }>;
  /** 랭크 단계(1 개척가 … 11 불멸자)별, 최근 14일 랭크 매치 */
  ranks: Array<{ tier: number; matches: number; winRate: number }>;
  /** 경기 길이(분)별, 최근 14일 모든 매치. average = 그 구간 전 영웅 승률 */
  durations: Array<{ min: number; max?: number; matches: number; winRate: number; average: number }>;
}


/** 이 영웅 매치에서 많이 산 상점 아이템 */
export interface HeroItemPick {
  itemId: number;
  /** 이 영웅 매치 중 산 비율 (%) */
  buyRate: number;
  /** 평균 구매 시각 (초) */
  buyTime: number;
}

/** 영웅 상세 '지표'·'빌드' 탭 — 티어와 같은 기준(전령사+ 랭크 · 최근 2주) */
export interface HeroInsights {
  from: number;
  /** 티어 보드의 이 영웅 (없으면 null) */
  tier: TierHero | null;
  /** 갈림길마다 가장 많이 고른 스킬 순서 (능력 id) */
  abilityOrder: number[];
  abilityOrderMatches: number;
  /** 스킬 선마 — 능력을 끝까지 올린 순서 (능력 id) 와 그 순서를 따른 매치 비율(%), 많은 순 */
  maxOrders: Array<{ order: number[]; path: number[]; share: number; matches: number; winRate: number }>;
  items: HeroItemPick[];
  /** 숙련 곡선 — 평생 판수 구간별 승률 (티어와 같은 기준) */
  mastery: HeroMasteryBucket[];
}

export interface HeroMasteryBucket {
  /** 평생 판수 구간 (max 없으면 min 이상) */
  min: number;
  max?: number;
  matches: number;
  /** 판수가 MASTERY_MIN_GAMES 미만이면 null */
  winRate: number | null;
  /** 같은 구간의 모든 영웅 평균 승률 */
  average: number;
}

export type TierLetter = 'S' | 'A' | 'B' | 'C' | 'D';
/** skill = 숙련 권장 (익숙해질수록 승률이 크게 오름), easy = 입문 추천 */
export type TierTag = 'skill' | 'easy';

/** 한 기간 × 랭크 구간에서 한 영웅의 수치와 티어 */
export interface TierHero {
  heroId: number;
  matches: number;
  winRate: number;
  /** 숙련자 = 그 영웅을 평생 80판 이상 한 플레이어 (EXPERIENCED_GAMES) */
  expMatches: number;
  expWinRate: number;
  novMatches: number;
  novWinRate: number;
  /** 등장한 매치 비율 (%) */
  pickRate: number;
  /** 킬·데스·어시스트 합 (KDA 계산용) */
  kills: number;
  deaths: number;
  assists: number;
  /** 판수가 너무 적으면 null (티어 없이 '제외') */
  tier: TierLetter | null;
  /** 티어는 매겼지만 숙련자 판수가 적어 티어가 바뀔 수 있음 ('표본 부족' 표시) */
  lowSample: boolean;
  /** 티어 점수 (표준점수). 빌드에서 정렬에만 쓰고 페이지로 보내지 않는다 */
  score: number | null;
  tag: TierTag | null;
}

export interface TierBoard {
  window: 'patch' | 'prev' | '7d' | '14d' | '30d';
  /** upper = 상위권(전령사+, high + top), lower = 하위권(전령사 미만, low + mid), ranked = 랭크 전체(단계 1–11), normal = 일반 매치, s1 … s11 = 랭크 단계 하나 */
  rank: 'ranked' | 'normal' | 'upper' | 'lower' | 'low' | 'mid' | 'high' | 'top' | `s${number}`;
  totalMatches: number;
  heroes: TierHero[];
}

/** 승률표 범위 계산용 — 한 기간 · 한 랭크 단계의 영웅별 원본 판수·승수 */
export interface TierStep {
  window: TierBoard['window'];
  /** 랭크 단계 1(개척가) … 11(불멸자) */
  step: number;
  totalMatches: number;
  /** [heroId, 판수, 승수, 숙련자 판수, 숙련자 승수, 킬, 데스, 어시스트] */
  heroes: Array<[number, number, number, number, number, number, number, number]>;
}

export interface TierData {
  /** 승률표 랭크 범위 선택용 단계별 원본 (2026-10-03) */
  steps: TierStep[];
  /** 일주일 전의 상위권·하위권 티어 (영웅 id → 티어, 그때 티어가 없었으면 null) — 티어 변동 표시 */
  prevTiers?: Partial<Record<'upper' | 'lower', Record<number, TierLetter | null>>>;
  /** 데이터를 받은 시각 (unix 초) */
  generatedAt: number;
  /** 기간별 시작·끝 (unix 초) */
  windows: Array<{ key: TierBoard['window']; from: number; to?: number }>;
  boards: TierBoard[];
}

/** 랭크 단계 (0 사색가 … 11 불멸자). 각 단계에 하위 등급 1–6 이 있다 */
export interface Rank {
  tier: number;
  name: string;
  /** 단계 휘장 이미지 원본 URL */
  image?: string;
}

export interface PatchChange {
  kind: 'buff' | 'nerf' | 'change';
  target: string;
  text: string;
}

export interface PatchSummary {
  /** 표시용 버전 표기 (Deadlock 은 날짜로 패치를 구분) */
  version: string;
  /** ISO 날짜 */
  date: string;
  /** 패치 공지 제목 ('City Never Sleeps', 'Minor Update - 09-16-2026' …) */
  title?: string;
  /** 공식 패치노트 주소 */
  url?: string;
  /** 영웅·아이템 변경 몇 줄. 공지만 있는 대형 패치는 비어 있을 수 있다 */
  changes: PatchChange[];
}

/** 패치노트 본문 조각 — 원문(영어) 문장 그대로, 영웅·아이템 이름만 현재 언어 */
export type PatchBlock =
  /** rule = 공지에서 원문(Steam)의 가로줄이 이 조각 바로 앞에 있다 */
  | { type: 'p'; text: string; orig?: string; rule?: boolean }
  /** 공지 속 소제목 (원문의 대문자 줄 'STANDARD MODE' · 줄 전체가 굵은 글씨 'Seasonal Rank Reset') */
  | { type: 'h'; text: string; orig?: string; rule?: boolean }
  | { type: 'li'; text: string; orig?: string; rule?: boolean }
  /** 영웅·아이템별 묶음. slug 가 없으면 사이트에 없는 대상(원문 이름) */
  | {
      type: 'group';
      kind: 'hero' | 'item' | 'other';
      slug?: string;
      name: string;
      lines: PatchLine[];
      /** 영웅 묶음에서 줄이 가리키는 능력 (현재 언어 이름 · 아이콘) — 화면이 능력별로 아이콘 옆에 모은다 */
      abilities?: PatchAbility[];
    };

export interface PatchAbility {
  slot: 1 | 2 | 3 | 4;
  name: string;
  /** 영어 이름 — 원문 · 번역 안 된 줄에서 능력 이름을 뺄 때 */
  enName?: string;
  image?: string;
}

/** 패치노트 문장 — text 는 화면 언어(번역이 없거나 검사에 걸리면 영어 원문), 번역됐으면 orig 에 원문 */
export interface PatchLine {
  text: string;
  orig?: string;
  /** 영웅 묶음에서 이 줄이 다루는 능력 칸 (원문에 능력 영어 이름이 있을 때). 없으면 기본 스탯 · 무기 등 */
  ability?: 1 | 2 | 3 | 4;
}

export interface PatchSection {
  /** 원문 '[ General ]' · '[ Items ]' · '[ Heroes ]' → general/items/heroes, 그 밖의 머리는 other(heading 에 원문), 머리 없는 공지는 intro */
  key: 'intro' | 'general' | 'items' | 'heroes' | 'other';
  heading?: string;
  blocks: PatchBlock[];
}

/** 패치노트 한 편 (Steam 공지 전문) */
export interface PatchNote {
  /** 주소용 — 적용일 '2026-09-16' (같은 날 두 편이면 '-2') */
  id: string;
  date: string;
  title: string;
  /** 공식 원문 주소 */
  url?: string;
  sections: PatchSection[];
  /** 변경된 영웅·아이템 수 */
  heroCount: number;
  itemCount: number;
  /** 공지 머리 그림 원본 주소 (있을 때만) */
  image?: string;
}

/** 게임 내 빌드 (게임 빌드 화면에 올라온 빌드, deadlock-api 로 받음) */
export interface GameBuild {
  heroId: number;
  buildId: number;
  authorId: number;
  name: string;
  version: number;
  /** 마지막 수정 (unix 초) */
  updatedAt: number;
  /** 작성자가 나눈 아이템 묶음 ('Early Game' …, 작성자가 쓴 이름 그대로) · desc = 묶음 설명 · note = 아이템 설명 (작성자 글 그대로, 번역 없음) */
  groups: Array<{ name: string; desc?: string; items: Array<{ itemId: number; note?: string }> }>;
  /** 작성자가 정한 능력 포인트 순서 (능력 id, 처음 나오면 해금 · 이후 강화) */
  abilityOrder: number[];
}

/** 프로 빌드 — 등록한 프로가 올린 빌드(자동) 또는 직접 적은 빌드 ID */
export interface ProBuild {
  pro: string;
  note?: string;
  /** 출처 주소 (방송·영상 등) */
  source?: string;
  buildId: number;
  /** 받지 못하면 null — 적은 정보만 보인다 */
  build: GameBuild | null;
  /** 최상위권(초월자+, 14일)이 매치 시작 때 고른 빌드 순위 — 그 안에 있을 때만 */
  usage?: { rank: number; players: number; matches: number };
  perf?: BuildPerf;
  author?: AuthorStanding;
}

/** 빌드 성적 — 최근 14일 전체 랭크, 매치 시작 때 고른 빌드 (2026-10-22) */
export interface BuildPerf {
  matches: number;
  wins: number;
  /** 이 영웅의 빌드 기록된 판 중 이 빌드 비율 (%) */
  share: number;
}

/** 빌드 작성자의 공식 순위표 순위(지역) 또는 지금 랭크 휘장 */
export interface AuthorStanding {
  region?: 'Asia' | 'Europe' | 'NAmerica' | 'SAmerica' | 'Oceania';
  rank?: number;
  badge?: number;
}

/** 예지자+ 가 실제 매치에서 많이 고른 게임 빌드 1–5위 (100판 이상, 오래된 빌드를 뺀 뒤 많이 쓴 순) */
export interface TopBuild {
  rank: number;
  matches: number;
  players: number;
  build: GameBuild;
  authorName?: string;
  /** 막 나온 영웅이라 예지자+ 대신 전체 랭크에서 센 순위 — '인기 빌드' 로 부른다 */
  allRanks?: boolean;
  perf?: BuildPerf;
  author?: AuthorStanding;
}

