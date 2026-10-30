# Deadlock 패치노트 번역 규칙

새 패치가 나오면: `pnpm build` → `.cache/patch-i18n/todo-{ko,zh}.json` 에 번역이 없거나 검사에 걸린 줄이 용어(terms)와 함께 쌓인다
→ 이 규칙대로 번역해 `ko.json` / `zh.json` 에 `"영어 원문": "번역"` 으로 추가 → 다시 빌드해 todo 가 비었는지 확인.
검사(숫자·공식 이름)는 `src/data/api/patch-i18n.ts` 가 빌드 때 한다. 걸린 줄은 영어 원문으로 보인다.

정한 표기 (2026-10-01): Spirit Power → 마력(API 공식), Stamina → 스태미나(활력은 Vitality 분류와 겹쳐서), Urn → 항아리(Urn) / 魂瓮（Urn）,
Street Brawl → 길거리 난투(게임 한국어판 공식 표기, 2026-10-15 확인 - 예전 '스트리트 브롤' 은 틀림) / 街头乱斗, Cursed Apple(게임 속 뉴욕) → 저주받은 사과 / 诅咒的纽约城 (영웅 소개 공식 표기),
Rejuv(미드보스 보상 버프) → 소생의 보석 버프, double sinner buildings → 영혼 슬롯머신 두 개가 붙어 있는 건물 / 迷失者抉择,
Lasso → 마법 밧줄(홀리데이 궁극기 Spirit Lasso), Weighted Bola → 포박 올가미(실버 3번, 확인), King of the Hill = 불안정한 균열의 옛 이름(영어 그대로),
Urn 중국어는 공식 Soul Urn 표기 灵瓮 (한국어 공식은 '영혼 단지' 지만 결정으로 '항아리'), 상태 Unstoppable → 저지 불가 / 不可阻挡, 스탯 Bullet/Spirit/Melee Lifesteal → 총탄/마법/근접 체력 흡수 · 子弹/元灵/近战吸取生命.

입력: `todo-<lang>-<n>.json` - 배열, 항목마다 `en`(영어 원문 한 줄)과 `terms`(이 줄에 나온 공식 이름 → 그 언어 공식 이름).
출력: `out-<lang>-<n>.json` - JSON 객체 `{ "<en 원문 그대로>": "<번역>" }`. 입력의 모든 `en` 을 키로, 글자 하나 바꾸지 말고 그대로 복사.

## 반드시 지킬 것 (자동 검사 - 어기면 그 줄은 버려진다)
1. 숫자: 원문에 나온 숫자를 모두, 같은 개수로, 그대로 쓴다 (34 → 34, 0.035 → 0.035, 1.7 → 1.7). 숫자를 더하거나 빼거나 바꾸지 말 것.
   'T1/T2/T3' 의 숫자도 숫자다 → 'T3' 그대로 둔다. 'I – VI' 같은 로마 숫자는 숫자 아님. 숫자를 글자로 바꾸지 말 것('two' 가 원문에 글자면 그대로 글자로 옮겨도 됨).
2. 공식 이름: `terms` 에 있는 값(그 언어 공식 이름)을 번역문에 글자 그대로 넣는다. 띄어쓰기도 바꾸지 말 것. 한국어 조사는 뒤에 붙여도 됨.

## 용어
- `stat-glossary.json` 의 스탯 이름(게임 공식 번역)을 우선 쓴다. 예: Cooldown → 쿨다운 / 冷却, Spirit Power → 마력 / 元灵力量, Bullet Resist → 총탄 저항 / 子弹抗性.
- 공식 이름이 없는 게임 고유 명사(Unstable Rift, Urn, Rift Troopers, Mid-Boss, Soul Orb 등)는 자연스럽게 번역하고 처음 나올 때마다 괄호로 영어를 붙인다: '불안정한 균열(Unstable Rift)', '不稳定裂隙（Unstable Rift）'.
- 일반 게임 용어 (ko / zh): souls 소울 / 魂, boon 축복(커뮤니티 표기, API 에 공식 한국어 없음) / 恩赐, parry 패리 / 格挡, dash 대시 / 冲刺, slide 슬라이드 / 滑铲, stamina 스태미나 / 耐力,
  melee 근접 / 近战, light melee 약한 근접 / 轻近战, heavy melee 강한 근접 / 重近战, lane 라인 / 兵线, trooper 트루퍼 / 小兵, net worth 순자산 / 净值,
  comeback 역전 / 翻盘, bounty 현상금 / 赏金, stun 기절 / 眩晕, silence 침묵 / 沉默, unstoppable 저지 불가 / 不可阻挡, headshot 헤드샷 / 爆头,
  spirit damage 마법 피해 / 元灵伤害, bullet damage 총탄 피해 / 子弹伤害, scaling 계수 / 加成系数, ultimate 궁극기 / 终极技能, AP(ability point) 능력 포인트 / 技能点.
- 'T1/T2/T3' 은 능력 강화 단계 - 그대로 'T3' 로 둔다.
- 단위: s → 초 / 秒, m 은 그대로 'm' (예: 20m), % 그대로.
- URL·콘솔 변수(convar 이름)는 원문 그대로.

## 문체
- 변경 줄(대부분): 짧은 개조식.
  - ko: '쿨다운이 34초에서 38초로 증가', '반경이 16.5m에서 15.5m로 감소', '…가 더 이상 … 하지 않음', '…를 수정'. 끝에 '~했습니다/~함' 붙이지 말 것.
  - zh: 官方更新日志风格, 简洁: '冷却时间从34秒增加至38秒', '半径从16.5m减少至15.5m', '修复了……的问题'.
- 공지 문단(긴 글): 자연스러운 문장. ko 는 '~합니다' 체, zh 는 书面语.
- 'increased/reduced/decreased/changed from X to Y' 의 X, Y 가 문장(따옴표 안 강화 효과)이면 안의 문장도 번역하되 숫자 규칙 지킬 것.
- 원문에 없는 설명을 더하지 말 것. 의미가 모호하면 직역에 가깝게.

## 마무리 검사 (꼭 실행)
파일을 쓴 뒤 node 로 검사: 입력의 모든 en 이 키로 있는지, JSON 이 올바른지, 각 줄의 숫자 목록(정규식 /\d+(?:\.\d+)?/g 정렬)이 같은지, terms 값이 모두 들어 있는지.
걸린 줄은 고쳐서 다시 검사. 끝나면 줄 수와 남은 문제(없어야 함)를 보고.
