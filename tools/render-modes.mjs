// Renders every debug mode into one 2x2 contact sheet and asserts that the
// modes actually differ (a broken shader switch would produce 4 identical tiles).
import fs from 'node:fs';
import { createScene, createRenderer, renderFrame, MODES } from '../src/scene.js';
import { encodePNG } from './png.mjs';

const TW = 480, TH = 300;
const sheet = new Uint8ClampedArray(TW * 2 * TH * 2 * 4);
const hashes = [];

for (let i = 0; i < MODES.length; i++) {
  const scene = createScene();
  scene.time = 3.2;
  scene.options.mode = MODES[i];
  if (MODES[i] === 'shaded') scene.options.wireframe = false;
  const renderer = createRenderer(TW, TH, 768);
  const { rgba, stats } = renderFrame(renderer, scene);

  let h = 0;
  for (let p = 0; p < rgba.length; p += 97) h = (h * 31 + rgba[p]) >>> 0;
  hashes.push(h);

  const ox = (i % 2) * TW, oy = Math.floor(i / 2) * TH;
  for (let y = 0; y < TH; y++) {
    const src = y * TW * 4;
    const dst = ((oy + y) * TW * 2 + ox) * 4;
    sheet.set(rgba.subarray(src, src + TW * 4), dst);
  }
  console.log(`mode=${MODES[i].padEnd(8)} tris=${stats.triangles} frags=${stats.fragments} hash=${h}`);
}

// wireframe variant as an extra correctness check (lines must add fragments)
const wscene = createScene();
wscene.time = 3.2;
wscene.options.wireframe = true;
const wframe = renderFrame(createRenderer(TW, TH, 768), wscene);
fs.mkdirSync('docs', { recursive: true });
fs.writeFileSync('docs/wireframe.png', encodePNG(wframe.rgba, TW, TH));
fs.writeFileSync('docs/modes.png', encodePNG(sheet, TW * 2, TH * 2));

if (new Set(hashes).size !== MODES.length) {
  console.error('FAILED: render modes are not distinct');
  process.exit(1);
}
console.log('wrote docs/modes.png, docs/wireframe.png — all modes distinct, OK');
