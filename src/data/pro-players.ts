/**
 * 프로 선수 — 여기에 적으면 그 선수가 게임 빌드 화면에 올린 빌드를 영웅별로 자동으로 가져온다 (빌드할 때마다 최신 버전).
 * 선수가 직접 올린 빌드가 없으면 src/data/pro-builds.ts 에 빌드 ID 를 따로 적는다.
 *
 *   name      화면에 나올 이름
 *   accountId Steam 계정 ID — 사이트 전적 검색에서 이름으로 찾은 뒤 주소의 ?id= 숫자 (SteamID64 도 됨)
 *   note      한 줄 설명 (선택) · source 방송·영상 주소 (선택)
 *
 * 예) { name: 'ABL', accountId: 888853854, source: 'https://twitch.tv/ablkz' },
 */
export interface ProPlayer {
  name: string;
  accountId: number;
  note?: string;
  source?: string;
}

export const PRO_PLAYERS: ProPlayer[] = [
  // 2026-10-01 사용자가 고른 프로·방송인·장인. 계정은 공식 순위표 이름 → 후보 중 빌드를 올린 계정으로 골랐다.
  { name: 'TAS', accountId: 1444662928 }, // 빌드 제목 "Tas" 22개의 작성자
  { name: 'OSES', accountId: 1840902834 },
  { name: 'ABL', accountId: 888853854 },
  { name: 'LYSTIC', accountId: 97533101 },
  { name: 'together', accountId: 298155885 },
  { name: 'Saiah', accountId: 25821887 },
  { name: 'Lomein', accountId: 1871021649 }, // 같은 이름 계정 2개 중 빌드가 많은 쪽 (다른 하나 761854809)
  { name: 'crayon', accountId: 84379844 },
  { name: 'vraic', accountId: 344946432 }, // 사용자 확인 (2026-10-02)
  { name: 'eido', accountId: 1676299122 },
  { name: 'dew', accountId: 108710262 }, // 사용자 확인 (2026-10-02)
  { name: 'Piggy', accountId: 1144439143 },
  { name: 'Zerggy', accountId: 35187362 }, // 사용자 확인 (2026-10-02) — Steam 이름은 big floppa
  { name: 'vegas', accountId: 836484910 },
  { name: 'lordnm', accountId: 1387549649 },
  { name: 'Renon', accountId: 123795813 },
  { name: 'Parzelion', accountId: 278919272 },
  { name: 'basil', accountId: 280308116 },
  { name: 'adofan11', accountId: 1682391475 },
  { name: 'Xera', accountId: 100464868 },
  { name: 'wander', accountId: 17403205 },
  { name: 'Lefaa', accountId: 114943410 },
  { name: 'fargareko', accountId: 400239835 },
  { name: 'Dimov', accountId: 298305257 }, // Steam 프로필 주소 /id/Dimov8, 'Dimov infernus' 빌드 작성자 (Steam 이름은 Queasy)
  { name: 'hoot', accountId: 87241154 },
  { name: 'empty dreams', accountId: 5278896 },
  { name: 'sanya sniper', accountId: 906011648 }, // 같은 이름 계정 2개 중 최근에 수정한 쪽 (다른 하나 1085037074)
  { name: 'arzo', accountId: 124540485 },
  { name: 'Deathy', accountId: 87624911 },
  { name: 'cosmetical', accountId: 483770846 }, // 'cosmetical' 이름 빌드 작성자 (지금 Steam 이름은 domine)
  { name: 'apacycle', accountId: 1673876903 },
  { name: 'PreNut', accountId: 1017193917 }, // Steam 이름 PreNutPerplexity
  { name: 'saint', accountId: 1055638874 },
  { name: 'brady lobby', accountId: 1566937550 },
  { name: 'HERESY', accountId: 477467839 },
  { name: 'cory', accountId: 382734749 }, // 사용자 확인 (2026-10-02)
  { name: 'Tbird', accountId: 300474764 },
  { name: 'salty', accountId: 140792013 }, // 사용자 확인 — 빌드 126856 "salty's spirit talon" 작성자 (Steam 이름 Naked Snake)
  { name: 'avg', accountId: 271562520 }, // 사용자 확인 — 빌드 813187 "new gist" 작성자 (Steam 이름 a2)
  { name: 'Elendili', accountId: 114981637 }, // 사용자 추가 (맥기니스 장인) — 빌드 258863 작성자, Steam /id/Elen_dilli
];
