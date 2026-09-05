// Bundles index.html + every ES module into ONE portable .html file.
// No bundler dependency: imports/exports are stripped and the modules are
// concatenated in dependency order, then inlined as a classic <script>.
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const ORDER = ['math.js', 'framebuffer.js', 'geometry.js', 'raster.js', 'scene.js', 'main.js'];

function strip(src) {
  return src
    .replace(/^\s*import\s+[\s\S]*?from\s+['"][^'"]+['"];\s*$/gm, '')
    .replace(/^\s*import\s+['"][^'"]+['"];\s*$/gm, '')
    .replace(/^export\s+/gm, '')
    .replace(/^\s*export\s*\{[\s\S]*?\};\s*$/gm, '');
}

const parts = ORDER.map((f) => {
  const code = strip(fs.readFileSync(path.join(root, 'src', f), 'utf8'));
  return `/* ===== src/${f} ${'='.repeat(Math.max(0, 60 - f.length))} */\n${code.trim()}\n`;
});

const bundle = parts.join('\n');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const out = html.replace(
  /<script type="module"[^>]*><\/script>/,
  `<script>\n(function(){\n"use strict";\n${bundle}\n})();\n</script>`
);

if (out === html) {
  console.error('build failed: module script tag not found in index.html');
  process.exit(1);
}
if (/\bimport\s|\bexport\s/.test(bundle)) {
  console.error('build failed: leftover import/export in bundle');
  process.exit(1);
}

const dest = path.join(root, 'dist', 'scanline.html');
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, out);
console.log(`wrote ${path.relative(root, dest)} — ${(out.length / 1024).toFixed(1)} KB, ${ORDER.length} modules inlined`);
