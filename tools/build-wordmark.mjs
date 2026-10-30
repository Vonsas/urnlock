// Urnlock 워드마크를 글꼴 없이 그리는 SVG 경로로 만든다 → src/lib/wordmark.ts
// 글자를 CSS 로 한 자씩 기울이면 윈도우 Chrome 에서 작은 크기(헤더)일 때 색 번짐·계단이 생겨서(2026-10-03 사용자 지적)
// 글자 모양을 미리 도형으로 뽑아 기울기까지 반영해 둔다. 글자 배치를 바꾸면 LETTERS 를 고치고 다시 실행:
//   node tools/build-wordmark.mjs   (Abril Fatface TTF 를 처음 한 번 Google Fonts 저장소에서 받아 .cache/ 에 둔다 — OFL 글꼴)
import fs from 'node:fs';
import path from 'node:path';
import opentype from 'opentype.js';

const FONT_URL = 'https://github.com/google/fonts/raw/main/ofl/abrilfatface/AbrilFatface-Regular.ttf';
const FONT_FILE = path.resolve('.cache/fonts/AbrilFatface-Regular.ttf');
if (!fs.existsSync(FONT_FILE)) {
  fs.mkdirSync(path.dirname(FONT_FILE), { recursive: true });
  const res = await fetch(FONT_URL);
  if (!res.ok) throw new Error(`글꼴을 받지 못함: ${res.status}`);
  fs.writeFileSync(FONT_FILE, Buffer.from(await res.arrayBuffer()));
}
const font = opentype.parse(fs.readFileSync(FONT_FILE).buffer);

// [글자, 기울기(°), 위아래(em), 크기(em)] — null = 항아리 자리. 사용자가 고른 '1단계' 뒤틀기
const LETTERS = [
  ['U', -3, 0.02, 1.2],
  ['r', 2, -0.03, 1],
  ['n', -2, 0.02, 1],
  ['l', 3, -0.02, 1],
  [null, 0, 0.06, 1],
  ['c', -2, 0.03, 1],
  ['k', 4, -0.04, 1.12],
];
const EM = 100; // 기본 글자 크기 = 100 단위
const URN = { h: 0.74, ratio: 100 / 140, margin: 0.03 };

const asc = font.ascender / font.unitsPerEm;
const desc = font.descender / font.unitsPerEm; // 음수
let pen = 0;
const parts = [];
let urnBox = null;
let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
const grow = (x, y) => { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); };

for (const [ch, rot, dy, size] of LETTERS) {
  if (!ch) {
    const h = URN.h * EM, w = h * URN.ratio, m = URN.margin * EM;
    const x = pen + m, y = -h + dy * EM;
    urnBox = { x, y, w, h };
    grow(x, y); grow(x + w, y + h);
    pen += w + 2 * m;
    continue;
  }
  const fs_ = EM * size;
  const glyph = font.charToGlyph(ch);
  const adv = (glyph.advanceWidth / font.unitsPerEm) * fs_;
  const p = font.getPath(ch, 0, 0, fs_);
  // CSS 와 같게: 글자 상자(가로 = 진행폭, 세로 = 줄 상자) 가운데를 축으로 회전, 그다음 아래로 dy(그 글자 크기의 em)
  const cx = adv / 2, cy = (-(asc * fs_) + -desc * fs_) / 2;
  const a = (rot * Math.PI) / 180, cos = Math.cos(a), sin = Math.sin(a);
  const tx = (x, y) => {
    const rx = cx + (x - cx) * cos - (y - cy) * sin;
    const ry = cy + (x - cx) * sin + (y - cy) * cos;
    return [pen + rx, ry + dy * fs_];
  };
  let d = '';
  for (const c of p.commands) {
    const pt = (x, y) => { const [X, Y] = tx(x, y); grow(X, Y); return `${X.toFixed(2)} ${Y.toFixed(2)}`; };
    if (c.type === 'M') d += `M${pt(c.x, c.y)}`;
    else if (c.type === 'L') d += `L${pt(c.x, c.y)}`;
    else if (c.type === 'Q') d += `Q${pt(c.x1, c.y1)} ${pt(c.x, c.y)}`;
    else if (c.type === 'C') d += `C${pt(c.x1, c.y1)} ${pt(c.x2, c.y2)} ${pt(c.x, c.y)}`;
    else if (c.type === 'Z') d += 'Z';
  }
  parts.push(d);
  pen += adv;
}

const pad = 2;
const box = { x: minX - pad, y: minY - pad, w: maxX - minX + 2 * pad, h: maxY - minY + 2 * pad };
const out = `// 자동 생성 — tools/build-wordmark.mjs 가 만든다. 직접 고치지 말 것.
// Urnlock 워드마크(Abril Fatface 글자를 도형으로, 1단계 뒤틀기 반영). 단위: 기본 글자 크기 = ${EM}
export const WORDMARK = {
  viewBox: '${box.x.toFixed(2)} ${box.y.toFixed(2)} ${box.w.toFixed(2)} ${box.h.toFixed(2)}',
  /** 글자 크기 1em 기준 높이·너비 (em) */
  heightEm: ${(box.h / EM).toFixed(4)},
  widthEm: ${(box.w / EM).toFixed(4)},
  letters: '${parts.join('')}',
  /** 항아리(UrnMark, viewBox 0 0 100 140) 자리 */
  urn: { x: ${urnBox.x.toFixed(2)}, y: ${urnBox.y.toFixed(2)}, w: ${urnBox.w.toFixed(2)}, h: ${urnBox.h.toFixed(2)} },
} as const;
`;
fs.writeFileSync('src/lib/wordmark.ts', out);
console.log('src/lib/wordmark.ts', (out.length / 1024).toFixed(1) + 'KB', box);
