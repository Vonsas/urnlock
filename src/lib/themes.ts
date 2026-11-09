/**
 * 사이트 색 테마 (2026-11-04 사용자 요청 — 방문자가 푸터에서 고른다). 색 값은 global.css 의 :root[data-theme=…] 에만 있다.
 * 'teal'(청록 달밤)이 기본이라 <html> 에 data-theme 를 붙이지 않는다. 고른 테마는 이 브라우저에만 저장 (언어 선택과 같은 방식).
 */
export const THEMES = ['teal', 'navy', 'ink', 'dawn', 'forest', 'olive'] as const;
export type Theme = (typeof THEMES)[number];

export const THEME_STORAGE_KEY = 'dldb:theme';

/** 휴대폰 주소창 색(meta theme-color) — 테마마다 상단 띠(`band`) 색 */
export const THEME_BAND: Record<Theme, string> = {
  teal: '#0b1a20',
  navy: '#0c1628',
  ink: '#141414',
  dawn: '#121a27',
  forest: '#101c16',
  olive: '#1a1a13',
};

/**
 * <head> 맨 앞에서 그리기 전에 테마를 붙이는 한 줄 — 늦게 붙이면 처음에 청록이 잠깐 비친다.
 * 저장소를 못 읽거나(사생활 보호 창) 모르는 값이면 기본 테마 그대로
 */
export const THEME_BOOT = `try{var t=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)}),b=${JSON.stringify(THEME_BAND)};if(t&&t!=='teal'&&b.hasOwnProperty(t)){document.documentElement.dataset.theme=t;var m=document.querySelector('meta[name="theme-color"]');if(m)m.content=b[t]}}catch(e){}`;
