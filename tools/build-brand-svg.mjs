// 사이트 밖에서 쓸 로고 원본 — 배경 없는(투명) 순수 벡터 SVG 를 brand/ 에 만든다. 워드마크·심볼을 바꾸면 다시 실행:
//   node tools/build-brand-svg.mjs
// 크기를 아무리 키워도 깨지지 않는다 (일러스트레이터·피그마에서 그대로 열림). 색은 사이트와 같은 paper-50 · brass-400.
import fs from 'node:fs';
import sharp from 'sharp';

const wordmark = fs.readFileSync('src/lib/wordmark.ts', 'utf8');
const urnPath = fs.readFileSync('src/lib/urn-path.ts', 'utf8').match(/'([^']+)'/)[1];
const pick = (key) => wordmark.match(new RegExp(`${key}: '([^']+)'`))[1];
const urn = Object.fromEntries([...wordmark.match(/urn: \{([^}]+)\}/)[1].matchAll(/(\w+): (-?[\d.]+)/g)].map((m) => [m[1], Number(m[2])]));
const viewBox = pick('viewBox');
const [, , w, h] = viewBox.split(' ').map(Number);

const TEXT = '#eef5f4';
const ACCENT = '#9de5da';
// 항아리(viewBox 0 0 100 140)를 워드마크 좌표로 옮기는 변환
const urnTransform = `translate(${urn.x} ${urn.y}) scale(${(urn.w / 100).toFixed(5)} ${(urn.h / 140).toFixed(5)})`;

const files = {
  'urnlock-wordmark.svg': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="${(w * 4).toFixed(0)}" height="${(h * 4).toFixed(0)}">
  <path fill="${TEXT}" d="${pick('letters')}"/>
  <path fill="${ACCENT}" fill-rule="evenodd" transform="${urnTransform}" d="${urnPath}"/>
</svg>
`,
  // 밝은 바탕용 — 글자를 짙은 청록으로
  'urnlock-wordmark-dark.svg': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="${(w * 4).toFixed(0)}" height="${(h * 4).toFixed(0)}">
  <path fill="#0b181e" d="${pick('letters')}"/>
  <path fill="#2a8f82" fill-rule="evenodd" transform="${urnTransform}" d="${urnPath}"/>
</svg>
`,
  'urnlock-mark.svg': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 140" width="400" height="560">
  <path fill="${ACCENT}" fill-rule="evenodd" d="${urnPath}"/>
</svg>
`,
};
// 스팀 프로필용 정사각형 184×184 (2026-10-09) — 'Urn' 윗줄 · 'lock' 아랫줄(o 자리 항아리), 사이트 배경색 위에.
// 글자 도형은 한 줄짜리 워드마크에서 x 위치로 나눈다 (U · r · n 이 앞 세 덩어리, 나머지가 l · c · k)
{
  const parts = pick('letters').split(/(?=M)/);
  const bbox = (d) => {
    const pts = [...d.matchAll(/(-?[\d.]+) (-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
    return { x0: Math.min(...pts.map((p) => p[0])), x1: Math.max(...pts.map((p) => p[0])), y0: Math.min(...pts.map((p) => p[1])), y1: Math.max(...pts.map((p) => p[1])) };
  };
  const top = parts.slice(0, 3).join('');
  const bottom = parts.slice(3).join('');
  const bt = bbox(top);
  const bb = bbox(bottom);
  bb.x0 = Math.min(bb.x0, urn.x);
  bb.x1 = Math.max(bb.x1, urn.x + urn.w);
  const S = 184;
  const PAD = 14;
  const GAP = 8; // 두 줄 사이 (글자 단위)
  const width = Math.max(bt.x1 - bt.x0, bb.x1 - bb.x0);
  const height = bt.y1 - bt.y0 + GAP + (bb.y1 - bb.y0);
  const k = Math.min((S - PAD * 2) / width, (S - PAD * 2) / height);
  const y1 = (S - height * k) / 2 - bt.y0 * k; // 윗줄 기준선
  const y2 = y1 + (bt.y1 + GAP - bb.y0) * k; // 아랫줄 기준선
  const x1 = S / 2 - ((bt.x0 + bt.x1) / 2) * k;
  const x2 = S / 2 - ((bb.x0 + bb.x1) / 2) * k;
  files['urnlock-avatar.svg'] = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}" width="${S}" height="${S}">
  <rect width="${S}" height="${S}" fill="#0b181e"/>
  <path fill="${TEXT}" transform="translate(${x1.toFixed(2)} ${y1.toFixed(2)}) scale(${k.toFixed(5)})" d="${top}"/>
  <g transform="translate(${x2.toFixed(2)} ${y2.toFixed(2)}) scale(${k.toFixed(5)})">
    <path fill="${TEXT}" d="${bottom}"/>
    <path fill="${ACCENT}" fill-rule="evenodd" transform="${urnTransform}" d="${urnPath}"/>
  </g>
</svg>
`;
}
fs.mkdirSync('brand', { recursive: true });
for (const [name, svg] of Object.entries(files)) {
  fs.writeFileSync(`brand/${name}`, svg);
  // SVG 를 못 올리는 곳(디스코드·갤러리 등)용 투명 PNG — 워드마크 가로 4000px, 심볼 1000px
  const px = name === 'urnlock-avatar.svg' ? 184 : name.includes('mark.svg') && !name.includes('word') ? 1000 : 4000;
  await sharp(Buffer.from(svg), { density: 600 }).resize({ width: px }).png().toFile(`brand/${name.replace('.svg', '.png')}`);
}
console.log(Object.keys(files).map((n) => `brand/${n}`).join('\n'));
