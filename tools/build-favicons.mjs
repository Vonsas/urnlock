// public/favicon.svg(항아리)로 검색엔진·휴대폰용 비트맵 아이콘을 만든다. 심볼을 바꾸면 다시 실행:
//   node tools/build-favicons.mjs
// 구글 검색 결과의 사이트 아이콘은 /favicon.ico 나 48px 배수 PNG 를 쓴다 — 2026-10-08 구글에 첫 뼈대 때의 마름모 favicon.ico 가 떠서 만들었다.
// favicon.ico = 16·32·48px PNG 를 담은 ICO (PNG 를 넣은 ICO 는 모든 최신 브라우저·구글이 읽는다).
import fs from 'node:fs';
import sharp from 'sharp';

const svg = fs.readFileSync('public/favicon.svg');
const png = (size) => sharp(svg, { density: Math.ceil((72 * size) / 32) * 2 }).resize(size, size).png().toBuffer();

fs.writeFileSync('public/favicon-96.png', await png(96));
fs.writeFileSync('public/apple-touch-icon.png', await png(180));

const sizes = [16, 32, 48];
const images = await Promise.all(sizes.map(png));
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2); // 1 = 아이콘
header.writeUInt16LE(sizes.length, 4);
let offset = 6 + 16 * sizes.length;
const entries = sizes.map((size, i) => {
  const e = Buffer.alloc(16);
  e.writeUInt8(size, 0);
  e.writeUInt8(size, 1);
  e.writeUInt16LE(1, 4); // 색 평면
  e.writeUInt16LE(32, 6); // 픽셀당 비트
  e.writeUInt32LE(images[i].length, 8);
  e.writeUInt32LE(offset, 12);
  offset += images[i].length;
  return e;
});
fs.writeFileSync('public/favicon.ico', Buffer.concat([header, ...entries, ...images]));
console.log('favicon.ico (16·32·48), favicon-96.png, apple-touch-icon.png');
