/**
 * 욕설 거르기 (2026-10-06 사용자 결정: 글 팁은 바로 공개하되 욕설·비하·음란어·패드립은 자동으로 막는다).
 * 쓰기 화면과 서버가 같이 쓴다. 걸리면 글을 받지 않는다 (공개 후 운영자가 [내리기]·[계정 차단] 도 가능).
 *
 * 변형 잡기: 소문자로 바꾸고, 글자 사이에 끼워 넣은 숫자·기호(시1발, 시*발, s.h.i.t)는 지운다.
 * 띄어쓰기는 지우지 않는다 — '능력 사용 시 발동' 같은 정상 문장이 '시발' 로 잡히지 않게. 자음만 쓴 것(ㅅ ㅂ)만 띄어쓰기도 지운다.
 * 목록은 여기서 고치면 된다. '존나' 같은 가벼운 강조어는 일부러 넣지 않았다 (게임 팁에 흔히 쓰여서) — 막으려면 STRONG 에 추가.
 */
const STRONG = [
  // 한국어 욕설
  '시발', '씨발', '씌발', '쉬발', '씨빨', '시빨', '씨팔', '시팔', '씨바', '씹', '병신', '븅신', '빙신', '븡신',
  '개새끼', '개새기', '개색기', '새끼', '쌔끼', '좆', '좇', '지랄', '염병', '닥쳐', '미친놈', '미친년', '또라이',
  // 패드립 · 비하
  '느금', '니애미', '니미', '애미', '애비', '엠창', '앰창', '느개비', '김치녀', '한남충', '틀딱', '장애새끼', '정신병자',
  // 음란어
  // ('보지'·'자지' 는 '보지 말고'·'자지 말고' 같은 정상 문장과 겹쳐 뺐다, '꺼져' 도 '꺼져 있을 때' 때문에 뺐다)
  '섹스', '야동', '딸딸이',
  // 영어
  'fuck', 'shit', 'bitch', 'cunt', 'nigg', 'faggot', 'retard', 'asshole', 'whore', 'slut', 'motherfucker',
  // 중국어
  '傻逼', '煞笔', '沙比', '他妈的', '操你', '草泥马', '尼玛', '狗日', '婊子', '贱人', '脑残', '你妈',
];
/** 자음만으로 쓰는 욕 — 띄어쓰기까지 지우고 본다 */
const JAMO = ['ㅅㅂ', 'ㅆㅂ', 'ㅂㅅ', 'ㅄ', 'ㅈㄹ', 'ㄲㅈ', 'ㅅㅍ'];

/** 글자 사이에 끼워 넣는 숫자·기호 — 지우고 본다 (띄어쓰기·줄바꿈은 남긴다) */
const FILLER = /[0-9_.,·*~!@#$%^&()+=|\\/?'"`:;<>\[\]{}-]/;

/**
 * 걸린 표현을 **원문 그대로** 돌려준다 (없으면 null) — 쓰기 화면이 '어느 말 때문에' 막혔는지 보여주고 그 자리를 골라 준다.
 * 숫자·기호를 지운 글에서 찾고, 원문 위치로 되돌린다 ('시1발' 이 걸리면 '시1발' 을 돌려줌).
 */
export function findProfanity(text: string): { word: string; start: number; end: number } | null {
  const look = (dropSpace: boolean, words: string[]) => {
    let kept = '';
    const at: number[] = [];
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (FILLER.test(c) || (dropSpace && /\s/.test(c))) continue;
      kept += c.toLowerCase();
      at.push(i);
    }
    for (const w of words) {
      const k = kept.indexOf(w);
      if (k >= 0) {
        const start = at[k];
        const end = at[k + w.length - 1] + 1;
        return { word: text.slice(start, end), start, end };
      }
    }
    return null;
  };
  return look(false, STRONG) ?? look(true, JAMO);
}

export const hasProfanity = (text: string) => findProfanity(text) !== null;
