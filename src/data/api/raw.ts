/**
 * deadlock-api.com 응답 중 이 사이트가 쓰는 필드만 적은 타입.
 * 캐시(.cache/api/)에도 이 모양으로 추려서 저장한다 — 이미지는 화면에 쓰는 URL 만, 영상은 저장하지 않는다.
 */

export interface RawStat {
  value: number;
}

export interface RawPopularItem {
  item_id: number;
  class_name: string;
  pick_pct: number;
  winrate_pct: number;
}

export interface RawHero {
  id: number;
  class_name: string;
  name: string;
  complexity: number;
  gun_tag?: string;
  description?: { lore?: string; role?: string; playstyle?: string };
  /** max_health, max_move_speed, sprint_speed, stamina, base_health_regen, light/heavy_melee_damage … */
  starting_stats: Record<string, RawStat>;
  /** 부운(레벨)당 오르는 값. MODIFIER_VALUE_BASE_HEALTH_FROM_LEVEL … */
  standard_level_up_upgrades?: Record<string, number>;
  /** 레벨 1–36. use_standard_upgrade 인 레벨마다 부운 1개 */
  level_info?: Record<string, { use_standard_upgrade?: boolean }>;
  /** 게임 안 '인기 아이템' (Valve 공식 집계, 게임 파일에 든 스냅샷) — 구간별 구매율·승률 */
  popular_items?: { timestamp?: number } & Partial<Record<'early_game' | 'mid_game' | 'late_game', RawPopularItem[]>>;
  /** weapon_primary, signature1–4 → items 의 class_name */
  items: Record<string, string>;
  /** icon_hero_card(_webp), icon_image_small(_webp) 만 저장 */
  images?: Record<string, string>;
}

export interface RawScaleFunction {
  class_name?: string;
  /** ETechPower(마력), ELevelUpBoons … 마법 피해 계산식은 비어 있어도 마력 */
  specific_stat_scale_type?: string;
  stat_scale?: number;
}

export interface RawProperty {
  value?: number | string;
  label?: string;
  postfix?: string;
  scale_function?: RawScaleFunction;
  /** 수치 종류 (bullet_damage, tech_damage, healing, cooldown …) — 툴팁 색 구분용 */
  css_class?: string;
  /** 불리한 효과 (예: 이동 속도 -0.7) */
  negative_attribute?: boolean;
  /** 조건 문구 (예: '비영웅 대상', '범위 밖') */
  conditional?: string;
  /** 'ConditionallyApplied' — 액티브·발동 중에만 적용 */
  usage_flags?: string[] | string;
}

export interface RawPropertyUpgrade {
  name: string;
  bonus: number | string;
  /** 'EAddToScale' 이면 bonus 가 계수 증가량 */
  upgrade_type?: string;
  scale_stat_filter?: string;
}

/** 능력 툴팁에 게임이 보여주는 수치 목록 */
export interface RawTooltipDetails {
  info_sections?: Array<{
    properties_block?: Array<{
      properties?: Array<{ important_property?: string; status_effect_value?: string; requires_ability_upgrade?: boolean }>;
    }>;
    basic_properties?: string[];
  }>;
  additional_header_properties?: string[];
}

export interface RawWeaponInfo {
  bullet_damage?: number;
  bullets?: number;
  clip_size?: number;
  reload_duration?: number;
  bullet_speed?: number;
  damage_falloff_start_range?: number;
  damage_falloff_end_range?: number;
  bullets_per_second?: number;
  damage_per_second?: number;
}

export interface RawTooltipSection {
  /** innate(기본 효과) / passive / active */
  section_type?: string;
  section_attributes?: Array<{
    /** 설명 (highlight·diminish span, <br>, 인라인 SVG 가 섞인 HTML) */
    loc_string?: string;
    properties?: string[];
    elevated_properties?: string[];
    /** 게임 툴팁에서 크게 보여주는 핵심 수치 */
    important_properties?: string[];
    important_properties_with_icon?: string[];
  }>;
}

export interface RawItem {
  id?: number;
  class_name: string;
  name: string;
  type: 'upgrade' | 'ability' | 'weapon';
  /** 흰색 그림 아이콘 (능력·일부 상점 아이템) */
  image?: string;
  image_webp?: string;
  /** 상점 그림 (200×200) */
  shop_image?: string;
  shop_image_webp?: string;
  properties?: Record<string, RawProperty>;
  description?: Record<string, string>;
  // 능력
  ability_type?: string;
  upgrades?: Array<{ property_upgrades?: RawPropertyUpgrade[] }>;
  tooltip_details?: RawTooltipDetails;
  // 무기
  weapon_info?: RawWeaponInfo;
  // 상점 아이템
  item_slot_type?: string;
  item_tier?: number;
  cost?: number;
  is_active_item?: boolean;
  shopable?: boolean;
  tooltip_sections?: RawTooltipSection[];
  /** 하위 아이템(조합 재료)의 class_name */
  component_items?: string[];
}

export interface RawRank {
  tier: number;
  name: string;
  /** large(_webp) 만 저장 */
  images?: Record<string, string>;
}

export interface RawPatch {
  source: string;
  title: string;
  /** 공식 패치노트 주소 */
  link?: string;
  pub_date: string;
  content: string;
}
