// 링크 미리보기 카드 → public/og/{ko,en,zh}.png (1200×630). 개발 서버(http://localhost:4321)가 떠 있어야 한다.
//   node tools/build-og.mjs
// headless Chrome 을 디버깅 포트로 띄워 /og/{lang}/ 을 찍는다. 로고·문구·장면을 바꾸면 다시 실행해 PNG 를 커밋.
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const CHROME = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = process.env.OG_BASE ?? 'http://localhost:4321';
const port = 9341;
const proc = spawn(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(path.join(tmpdir(), 'og-'))}`, '--window-size=1200,630', 'about:blank']);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let targets = [];
for (let i = 0; i < 50 && !targets.length; i++) {
  try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); } catch {}
  await sleep(200);
}
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0;
const pending = new Map();
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const send = (method, params = {}) => new Promise((r) => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 630, deviceScaleFactor: 1, mobile: false });
mkdirSync('public/og', { recursive: true });
for (const lang of ['ko', 'en', 'zh']) {
  await send('Page.navigate', { url: `${BASE}/og/${lang}/` });
  await sleep(5000);
  // 개발 서버의 Astro 도구 막대는 지운다
  await send('Runtime.evaluate', { expression: "document.querySelector('astro-dev-toolbar')?.remove()" });
  await sleep(200);
  const shot = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 1200, height: 630, scale: 1 } });
  writeFileSync(`public/og/${lang}.png`, Buffer.from(shot.result.data, 'base64'));
  console.log(`public/og/${lang}.png`);
}
ws.close();
proc.kill();
