/**
 * 서명된 쿠키 — 내용(계정 ID·이름·만료) + HMAC-SHA256 서명. 서명 키는 환경 변수 SESSION_SECRET (사용자가 Vercel 에 넣음).
 * 쿠키를 고쳐 다른 계정인 척하면 서명이 맞지 않아 버려진다. 브라우저 스크립트는 읽을 수 없다(HttpOnly).
 */
import { cookies, setCookie } from './http.js';

const SECRET = process.env.SESSION_SECRET ?? '';
const enc = new TextEncoder();

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

async function key() {
  if (SECRET.length < 32) throw new Error('SESSION_SECRET 이 없거나 짧습니다 (32자 이상)');
  return crypto.subtle.importKey('raw', enc.encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export async function sign(payload: object): Promise<string> {
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', await key(), enc.encode(body)));
  return `${body}.${b64url(sig)}`;
}

export async function verify<T extends { e: number }>(token: string | undefined): Promise<T | null> {
  if (!token) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  try {
    const ok = await crypto.subtle.verify('HMAC', await key(), fromB64url(sig), enc.encode(body));
    if (!ok) return null;
    const data = JSON.parse(new TextDecoder().decode(fromB64url(body))) as T;
    return data.e > Date.now() / 1000 ? data : null;
  } catch {
    return null;
  }
}

/** 팁 쓰는 사람 — 스팀 인증 후 30일 */
export interface UserSession {
  a: number;
  n: string;
  e: number;
}
export const USER_COOKIE = 'ul_s';
/** 로그인 유지 기간 — 2026-10-07 30 → 90일 (사용자: 매번 인증하는 느낌이 불편) */
export const USER_DAYS = 90;
/**
 * 헤더가 로그인 상태를 서버에 묻지 않고 바로 그리게 하는 표시 쿠키 — '계정ID.닉네임' 만 (비밀 아님, 스크립트가 읽음).
 * 실제 권한은 언제나 서명 쿠키(USER_COOKIE)로만 판단한다. 같은 기간으로 같이 심고 같이 지운다.
 */
export const WHO_COOKIE = 'ul_who';
const whoCookie = (value: string, maxAge: number) => `${WHO_COOKIE}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; Secure; SameSite=Lax`;

export const userSession = (request: Request) => verify<UserSession>(cookies(request)[USER_COOKIE]);

export async function userCookie(accountId: number, name: string) {
  const e = Math.floor(Date.now() / 1000) + USER_DAYS * 86400;
  return setCookie(USER_COOKIE, await sign({ a: accountId, n: name, e }), { maxAge: USER_DAYS * 86400 });
}
/** 로그인 때 심는 두 쿠키 (서명 쿠키 + 헤더 표시) */
export async function userCookies(accountId: number, name: string): Promise<Array<[string, string]>> {
  return [
    ['set-cookie', await userCookie(accountId, name)],
    ['set-cookie', whoCookie(`${accountId}.${name}`, USER_DAYS * 86400)],
  ];
}
/** 표시 쿠키만 — 이미 로그인한 사람에게 나중에 붙일 때 (서명 쿠키의 남은 기간에 맞춰) */
export const whoCookieFor = (s: UserSession) => whoCookie(`${s.a}.${s.n}`, Math.max(0, Math.floor(s.e - Date.now() / 1000)));
export const clearUserCookie = () => setCookie(USER_COOKIE, '', { maxAge: 0 });
export const clearUserCookies = (): Array<[string, string]> => [
  ['set-cookie', clearUserCookie()],
  ['set-cookie', whoCookie('', 0)],
];

/** 관리자 — 비밀번호 확인 후 12시간, 관리 요청 경로에만 보낸다 */
export interface AdminSession {
  r: 'admin';
  e: number;
}
export const ADMIN_COOKIE = 'ul_admin';
export const adminSession = async (request: Request) => (await verify<AdminSession>(cookies(request)[ADMIN_COOKIE]))?.r === 'admin';

export async function adminCookie() {
  const e = Math.floor(Date.now() / 1000) + 12 * 3600;
  return setCookie(ADMIN_COOKIE, await sign({ r: 'admin', e }), { maxAge: 12 * 3600, path: '/api/admin', sameSite: 'Strict' });
}
export const clearAdminCookie = () => setCookie(ADMIN_COOKIE, '', { maxAge: 0, path: '/api/admin', sameSite: 'Strict' });

/** 길이가 달라도 시간 차로 비밀번호가 새지 않게 비교 */
export async function safeEqual(a: string, b: string): Promise<boolean> {
  const [ha, hb] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(a)), crypto.subtle.digest('SHA-256', enc.encode(b))]);
  const x = new Uint8Array(ha);
  const y = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0 && a.length > 0;
}
