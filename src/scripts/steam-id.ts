/** 플레이어 검색어 해석 — 헤더 검색과 전적 페이지가 함께 쓴다 */

const STEAM64_BASE = 76561197960265728n;

/**
 * 계정 ID 로 바로 갈 수 있으면 { id }, 아니면 이름 검색어 { query }.
 * 계정 ID(숫자), SteamID64(7656…), 프로필 주소(/profiles/7656…), 사용자 지정 주소(/id/이름) 를 알아본다.
 */
export function parsePlayerInput(raw: string): { id: number } | { query: string } {
  const s = raw.trim();
  const profile = s.match(/steamcommunity\.com\/profiles\/(\d{17})/);
  const steam64 = profile?.[1] ?? (/^7656\d{13}$/.test(s) ? s : undefined);
  if (steam64) return { id: Number(BigInt(steam64) - STEAM64_BASE) };
  if (/^\d{1,10}$/.test(s)) return { id: Number(s) };
  const vanity = s.match(/steamcommunity\.com\/id\/([^/?#]+)/);
  if (!vanity) return { query: s };
  try {
    return { query: decodeURIComponent(vanity[1]) };
  } catch {
    return { query: vanity[1] }; // 깨진 %xx — 그대로 (던지면 검색창이 글자마다 오류가 났다)
  }
}
