// Headless still render — the CI smoke test and the README hero image.
// Usage: node tools/render-still.mjs [out.png] [width] [height] [time]
import fs from 'node:fs';
import { createScene, createRenderer, renderFrame } from '../src/scene.js';
import { encodePNG } from './png.mjs';

const out = process.argv[2] || 'docs/still.png';
const W = Number(process.argv[3] || 960);
const H = Number(process.argv[4] || 600);
const T = Number(process.argv[5] || 3.2);

const scene = createScene();
scene.time = T;
const renderer = createRenderer(W, H, 1024);
const frame = renderFrame(renderer, scene);

// --- sanity checks: a black or uniform image means the pipeline is broken ---
const px = frame.rgba;
let sum = 0, min = 255, max = 0, nonBg = 0;
for (let i = 0; i < px.length; i += 4) {
  const l = (px[i] + px[i + 1] + px[i + 2]) / 3;
  sum += l; if (l < min) min = l; if (l > max) max = l;
  if (l > 40) nonBg++;
}
const mean = sum / (px.length / 4);
const coverage = nonBg / (px.length / 4);

fs.mkdirSync(out.replace(/\/[^/]+$/, ''), { recursive: true });
fs.writeFileSync(out, encodePNG(px, W, H));

const r = (n) => n.toFixed(2);
console.log(`wrote ${out}  ${W}x${H}`);
console.log(`triangles=${frame.stats.triangles}  fragments=${frame.stats.fragments}  clipped=${frame.stats.clipped}`);
console.log(`timings ms: shadow=${r(frame.timings.shadow)} geometry=${r(frame.timings.geometry)} resolve=${r(frame.timings.resolve)} total=${r(frame.timings.total)}`);
console.log(`pixels: mean=${r(mean)} min=${min} max=${max} subjectCoverage=${(coverage * 100).toFixed(1)}%`);

const fail = [];
if (frame.stats.triangles < 1000) fail.push('too few rasterized triangles');
if (frame.stats.fragments < W * H * 0.05) fail.push('almost nothing was shaded');
if (max < 200) fail.push('image never gets bright — shading is likely dead');
if (coverage < 0.05) fail.push('subject coverage below 5% — camera or projection is wrong');
if (fail.length) {
  console.error('SMOKE TEST FAILED: ' + fail.join('; '));
  process.exit(1);
}
console.log('smoke test OK');
