// ---------------------------------------------------------------------------
// main.js — browser front-end: canvas blit, orbit controls, HUD, UI wiring.
// The renderer itself knows nothing about the DOM.
// ---------------------------------------------------------------------------

import { createScene, createRenderer, renderFrame, MODES } from './scene.js';
import { clamp } from './math.js';

const canvas = document.getElementById('view');
const ctx2d = canvas.getContext('2d', { alpha: false });
const scene = createScene();

const view = {
  scale: 0.75,        // internal resolution multiplier
  shadowSize: 768,
  running: true,
  lastFrames: [],
};

let renderer = null;
let imageData = null;
let cssW = 0, cssH = 0;

function sizeUp() {
  const rect = canvas.parentElement.getBoundingClientRect();
  cssW = Math.max(320, Math.floor(rect.width));
  cssH = Math.max(240, Math.floor(rect.height));
  canvas.style.width = cssW + 'px';
  canvas.style.height = cssH + 'px';
  const w = Math.max(120, Math.round(cssW * view.scale));
  const h = Math.max(90, Math.round(cssH * view.scale));
  canvas.width = w;
  canvas.height = h;
  renderer = createRenderer(w, h, view.shadowSize);
  imageData = ctx2d.createImageData(w, h);
  ctx2d.imageSmoothingEnabled = true;
  el('res').textContent = `${w}x${h}`;
}

const el = (id) => document.getElementById(id);

// --- orbit / zoom controls --------------------------------------------------
let dragging = false, lastX = 0, lastY = 0;
canvas.addEventListener('pointerdown', (e) => {
  dragging = true; lastX = e.clientX; lastY = e.clientY;
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointerup', (e) => {
  dragging = false;
  try { canvas.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
});
canvas.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  scene.camera.yaw -= (e.clientX - lastX) * 0.008;
  scene.camera.pitch = clamp(scene.camera.pitch + (e.clientY - lastY) * 0.006, -0.25, 1.35);
  lastX = e.clientX; lastY = e.clientY;
});
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  scene.camera.dist = clamp(scene.camera.dist * (1 + Math.sign(e.deltaY) * 0.08), 3.2, 22);
}, { passive: false });

// --- UI ---------------------------------------------------------------------
function bindUI() {
  const modeSel = el('mode');
  MODES.forEach((m) => {
    const o = document.createElement('option');
    o.value = m; o.textContent = m;
    modeSel.appendChild(o);
  });
  modeSel.value = scene.options.mode;
  modeSel.onchange = () => { scene.options.mode = modeSel.value; };

  el('shadows').onchange = (e) => { scene.options.shadows = e.target.checked; };
  el('wire').onchange = (e) => { scene.options.wireframe = e.target.checked; };
  el('spin').onchange = (e) => { scene.options.spin = e.target.checked; };
  el('exposure').oninput = (e) => {
    scene.options.exposure = Number(e.target.value);
    el('exposureVal').textContent = scene.options.exposure.toFixed(2);
  };
  el('scale').oninput = (e) => {
    view.scale = Number(e.target.value);
    el('scaleVal').textContent = view.scale.toFixed(2) + 'x';
    sizeUp();
  };
  el('shot').onclick = () => {
    const a = document.createElement('a');
    a.download = `scanline-${Date.now()}.png`;
    a.href = canvas.toDataURL('image/png');
    a.click();
  };
  el('pause').onclick = () => {
    view.running = !view.running;
    el('pause').textContent = view.running ? 'Pause' : 'Resume';
  };

  addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (k === 'w') { el('wire').checked = !el('wire').checked; el('wire').onchange({ target: el('wire') }); }
    if (k === 's') { el('shadows').checked = !el('shadows').checked; el('shadows').onchange({ target: el('shadows') }); }
    if (k === ' ') { e.preventDefault(); el('pause').click(); }
    if (k >= '1' && k <= String(MODES.length)) {
      modeSel.value = MODES[Number(k) - 1];
      modeSel.onchange();
    }
  });

  addEventListener('resize', () => sizeUp());
}

// --- main loop --------------------------------------------------------------
let prev = performance.now();

function loop(t) {
  const dt = Math.min(0.05, (t - prev) / 1000);
  prev = t;
  if (view.running) scene.time += dt;

  const frame = renderFrame(renderer, scene);
  imageData.data.set(frame.rgba);
  ctx2d.putImageData(imageData, 0, 0);

  view.lastFrames.push(frame.timings.total);
  if (view.lastFrames.length > 30) view.lastFrames.shift();
  const avg = view.lastFrames.reduce((a, b) => a + b, 0) / view.lastFrames.length;

  el('fps').textContent = (1000 / Math.max(avg, 0.001)).toFixed(0);
  el('ms').textContent = avg.toFixed(1);
  el('tris').textContent = frame.stats.triangles.toLocaleString('en-US');
  el('frags').textContent = frame.stats.fragments.toLocaleString('en-US');
  el('clip').textContent = frame.stats.clipped.toLocaleString('en-US');
  el('tShadow').textContent = frame.timings.shadow.toFixed(1);
  el('tGeo').textContent = frame.timings.geometry.toFixed(1);
  el('tRes').textContent = frame.timings.resolve.toFixed(1);

  requestAnimationFrame(loop);
}

bindUI();
sizeUp();
requestAnimationFrame(loop);
