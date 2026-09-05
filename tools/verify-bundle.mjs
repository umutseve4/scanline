// Runs the single-file build in Node against a minimal DOM stub, so CI proves
// the browser bundle really produces pixels (not just that it parses).
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const html = fs.readFileSync(path.join(root, 'dist', 'scanline.html'), 'utf8');
const m = html.match(/<script>\n([\s\S]*?)<\/script>/);
if (!m) { console.error('no inline script found'); process.exit(1); }
const code = m[1];

const putCalls = [];
const listeners = {};
const store = new Map();

function makeEl(id) {
  return {
    id, textContent: '', value: '', checked: true, style: {}, children: [],
    onchange: null, oninput: null, onclick: null,
    appendChild(c) { this.children.push(c); },
    addEventListener() {}, setPointerCapture() {}, releasePointerCapture() {},
    getBoundingClientRect: () => ({ width: 900, height: 560 }),
    click() {},
  };
}

const canvas = Object.assign(makeEl('view'), {
  width: 0, height: 0,
  parentElement: { getBoundingClientRect: () => ({ width: 900, height: 560 }) },
  getContext: () => ({
    createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    putImageData: (img) => putCalls.push(img),
    imageSmoothingEnabled: true,
  }),
  toDataURL: () => 'data:image/png;base64,',
});
store.set('view', canvas);

const document = {
  getElementById: (id) => {
    if (!store.has(id)) store.set(id, makeEl(id));
    return store.get(id);
  },
  createElement: () => makeEl('tmp'),
};

let rafCount = 0;
const sandbox = {
  document, console,
  performance: { now: () => Date.now() },
  requestAnimationFrame: (fn) => { if (rafCount++ < 3) fn(Date.now() + rafCount * 16); },
  addEventListener: (k, f) => { (listeners[k] ||= []).push(f); },
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;

try {
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { timeout: 60000 });
} catch (e) {
  console.error('bundle threw:', e && e.stack || e);
  process.exit(1);
}

if (putCalls.length === 0) { console.error('bundle never drew a frame'); process.exit(1); }
const img = putCalls[putCalls.length - 1];
let lit = 0, max = 0;
for (let i = 0; i < img.data.length; i += 4) {
  const l = (img.data[i] + img.data[i + 1] + img.data[i + 2]) / 3;
  if (l > 40) lit++;
  if (l > max) max = l;
}
const cov = lit / (img.data.length / 4);
console.log(`bundle drew ${putCalls.length} frame(s) at ${img.width}x${img.height}`);
console.log(`coverage=${(cov * 100).toFixed(1)}%  maxLuma=${max}`);
if (cov < 0.05 || max < 150) { console.error('bundle output looks blank'); process.exit(1); }

// Also exercise the interactive callbacks the UI wires up.
const wire = document.getElementById('wire');
if (typeof wire.onchange !== 'function') { console.error('UI not wired'); process.exit(1); }
wire.onchange({ target: { checked: true } });
document.getElementById('exposure').oninput({ target: { value: '1.4' } });
console.log('bundle verification OK');
